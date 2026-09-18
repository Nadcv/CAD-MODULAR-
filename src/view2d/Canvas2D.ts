import type { CadDocument } from '../core/Document';
import type { DimensionDef, ModuleDef, PlacedComponentDef, WallDef } from '../core/types';

/** Minimal shape shared by anything drawn as a rotated footprint rectangle (modules, components). */
interface Footprint {
  position: { x: number; y: number };
  rotationZ: number;
  width: number;
  depth: number;
}

const HANDLE_SIZE = 8;
const WALL_HIT_TOLERANCE = 6; // px

export type ToolMode = 'select' | 'wall' | 'dimension';

type DragMode = { kind: 'move'; startX: number; startY: number; origins: Map<string, { x: number; y: number }> }
  | { kind: 'resize'; id: string; startX: number; startY: number; origin: { width: number; depth: number } }
  | { kind: 'pan'; startX: number; startY: number; originOffset: { x: number; y: number } }
  | null;

function distToSegment(px: number, py: number, [x1, y1]: [number, number], [x2, y2]: [number, number]): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Top-down (plan) 2D editor. World units are meters; screen units are pixels.
 * Renders imported DXF reference geometry plus editable module rectangles, walls and dimensions.
 */
export class Canvas2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private doc: CadDocument;
  private scale = 60; // px per meter
  private offset = { x: 0, y: 0 }; // world origin position on screen, in px
  private drag: DragMode = null;
  private resizeObserver: ResizeObserver;

  private tool: ToolMode = 'select';
  private snapEnabled = true;
  private snapStep = 0.05; // meters
  private pendingPoint: [number, number] | null = null;
  private previewPoint: [number, number] | null = null;
  private selectedWallId: string | null = null;

  constructor(container: HTMLElement, doc: CadDocument) {
    this.doc = doc;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'view-canvas';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;

    this.offset = { x: container.clientWidth / 2, y: container.clientHeight / 2 };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.cancelPending();
    });
    window.addEventListener('keydown', this.onKeyDown);

    doc.events.on('change', () => this.render());
    doc.events.on('selectionChange', () => this.render());
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /** PNG snapshot of the current plan view, for PDF export (io/pdf.ts). */
  getSnapshotDataUrl(): string {
    return this.canvas.toDataURL('image/png');
  }

  setTool(tool: ToolMode): void {
    this.tool = tool;
    this.pendingPoint = null;
    this.previewPoint = null;
    this.render();
  }

  setSnap(enabled: boolean, step?: number): void {
    this.snapEnabled = enabled;
    if (step !== undefined) this.snapStep = step;
    this.render();
  }

  private cancelPending(): void {
    this.pendingPoint = null;
    this.previewPoint = null;
    this.render();
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    if (ev.key === 'Escape') {
      this.cancelPending();
      return;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.tool === 'select') {
      let changed = false;
      if (this.doc.selectedIds.size > 0) {
        this.doc.checkpoint();
        for (const id of [...this.doc.selectedIds]) {
          if (this.doc.modules.has(id)) this.doc.removeModule(id);
          else if (this.doc.placedComponents.has(id)) this.doc.removePlacedComponent(id);
        }
        changed = true;
      }
      if (this.selectedWallId) {
        if (!changed) this.doc.checkpoint();
        this.doc.removeWall(this.selectedWallId);
        this.selectedWallId = null;
        changed = true;
      }
      if (changed) ev.preventDefault();
    }
  };

  private resize(): void {
    const parent = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = parent.clientWidth * dpr;
    this.canvas.height = parent.clientHeight * dpr;
    this.canvas.style.width = `${parent.clientWidth}px`;
    this.canvas.style.height = `${parent.clientHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  private worldToScreen(wx: number, wy: number): [number, number] {
    return [this.offset.x + wx * this.scale, this.offset.y - wy * this.scale];
  }

  private screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.offset.x) / this.scale, -(sy - this.offset.y) / this.scale];
  }

  private eventToCanvasXY(ev: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  private snap(v: number): number {
    if (!this.snapEnabled) return v;
    return Math.round(v / this.snapStep) * this.snapStep;
  }

  private snapPoint(wx: number, wy: number): [number, number] {
    return [this.snap(wx), this.snap(wy)];
  }

  private componentFootprint(inst: PlacedComponentDef): Footprint {
    return { position: inst.position, rotationZ: inst.rotationZ, width: inst.width * inst.scale, depth: inst.depth * inst.scale };
  }

  private moduleAt(wx: number, wy: number): ModuleDef | undefined {
    const list = [...this.doc.modules.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const local = this.toLocal(m, wx, wy);
      if (local.x >= 0 && local.x <= m.width && local.y >= 0 && local.y <= m.depth) return m;
    }
    return undefined;
  }

  private componentAt(wx: number, wy: number): PlacedComponentDef | undefined {
    const list = [...this.doc.placedComponents.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      const inst = list[i];
      const local = this.toLocal(this.componentFootprint(inst), wx, wy);
      if (local.x >= 0 && local.x <= inst.width * inst.scale && local.y >= 0 && local.y <= inst.depth * inst.scale) return inst;
    }
    return undefined;
  }

  private wallAtScreen(sx: number, sy: number): WallDef | undefined {
    for (const wall of this.doc.walls.values()) {
      const p1 = this.worldToScreen(...wall.start);
      const p2 = this.worldToScreen(...wall.end);
      const tolerance = Math.max(WALL_HIT_TOLERANCE, (wall.thickness * this.scale) / 2);
      if (distToSegment(sx, sy, p1, p2) <= tolerance) return wall;
    }
    return undefined;
  }

  private toLocal(f: Footprint, wx: number, wy: number): { x: number; y: number } {
    const dx = wx - f.position.x;
    const dy = wy - f.position.y;
    const cos = Math.cos(-f.rotationZ);
    const sin = Math.sin(-f.rotationZ);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  private resizeHandleScreen(f: Footprint): [number, number] {
    const cos = Math.cos(f.rotationZ);
    const sin = Math.sin(f.rotationZ);
    const wx = f.position.x + f.width * cos - f.depth * sin;
    const wy = f.position.y + f.width * sin + f.depth * cos;
    return this.worldToScreen(wx, wy);
  }

  private onMouseDown = (ev: MouseEvent): void => {
    const [sx, sy] = this.eventToCanvasXY(ev);
    const [wxRaw, wyRaw] = this.screenToWorld(sx, sy);

    if (ev.button === 1 || ev.shiftKey) {
      this.drag = { kind: 'pan', startX: sx, startY: sy, originOffset: { ...this.offset } };
      return;
    }

    if (ev.button === 2) return; // handled by contextmenu -> cancelPending

    if (this.tool === 'wall' || this.tool === 'dimension') {
      const point = this.snapPoint(wxRaw, wyRaw);
      if (!this.pendingPoint) {
        this.pendingPoint = point;
      } else {
        this.doc.checkpoint();
        if (this.tool === 'wall') {
          this.doc.addWall({ start: this.pendingPoint, end: point, thickness: 0.15, height: 2.6, color: '#8a8a9a' });
          this.pendingPoint = point; // chain: keep drawing from the end point
        } else {
          this.doc.addDimension({ from: this.pendingPoint, to: point, offset: 0.3 });
          this.pendingPoint = null; // dimensions don't chain
        }
      }
      this.render();
      return;
    }

    const [wx, wy] = [wxRaw, wyRaw];

    // Check resize handle on the (single) selected module first (components resize via
    // "Escala" in the properties panel or the 3D gizmo, not a 2D corner handle).
    if (this.doc.selectedIds.size === 1) {
      const id = [...this.doc.selectedIds][0];
      const m = this.doc.modules.get(id);
      if (m) {
        const [hx, hy] = this.resizeHandleScreen(m);
        if (Math.hypot(hx - sx, hy - sy) <= HANDLE_SIZE) {
          this.doc.checkpoint();
          this.drag = { kind: 'resize', id, startX: wx, startY: wy, origin: { width: m.width, depth: m.depth } };
          return;
        }
      }
    }

    const hit = this.moduleAt(wx, wy) ?? this.componentAt(wx, wy);
    if (hit) {
      this.selectedWallId = null;
      if (!this.doc.selectedIds.has(hit.id)) {
        this.doc.setSelection(ev.ctrlKey || ev.metaKey ? [...this.doc.selectedIds, hit.id] : [hit.id]);
      }
      this.doc.checkpoint();
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of this.doc.selectedIds) {
        const mod = this.doc.modules.get(id) ?? this.doc.placedComponents.get(id);
        if (mod) origins.set(id, { x: mod.position.x, y: mod.position.y });
      }
      this.drag = { kind: 'move', startX: wx, startY: wy, origins };
      return;
    }

    const wallHit = this.wallAtScreen(sx, sy);
    if (wallHit) {
      this.doc.setSelection([]);
      this.selectedWallId = wallHit.id;
      this.render();
      return;
    }

    this.selectedWallId = null;
    this.doc.setSelection([]);
  };

  private onMouseMove = (ev: MouseEvent): void => {
    const [sx, sy] = this.eventToCanvasXY(ev);

    if ((this.tool === 'wall' || this.tool === 'dimension') && this.pendingPoint) {
      const [wx, wy] = this.screenToWorld(sx, sy);
      this.previewPoint = this.snapPoint(wx, wy);
      this.render();
    }

    if (!this.drag) return;

    if (this.drag.kind === 'pan') {
      this.offset = { x: this.drag.originOffset.x + (sx - this.drag.startX), y: this.drag.originOffset.y + (sy - this.drag.startY) };
      this.render();
      return;
    }

    const [wx, wy] = this.screenToWorld(sx, sy);

    if (this.drag.kind === 'move') {
      const dx = this.snap(wx - this.drag.startX);
      const dy = this.snap(wy - this.drag.startY);
      for (const [id, origin] of this.drag.origins) {
        const target = this.doc.modules.get(id) ?? this.doc.placedComponents.get(id);
        if (target) target.position = { ...target.position, x: this.snap(origin.x + dx), y: this.snap(origin.y + dy) };
      }
      this.doc.events.emit('change', { reason: 'drag-move' });
      return;
    }

    if (this.drag.kind === 'resize') {
      const mod = this.doc.modules.get(this.drag.id);
      if (mod) {
        const local = this.toLocal(mod, wx, wy);
        mod.width = Math.max(this.snapEnabled ? this.snapStep : 0.05, this.snap(local.x));
        mod.depth = Math.max(this.snapEnabled ? this.snapStep : 0.05, this.snap(local.y));
      }
      this.doc.events.emit('change', { reason: 'drag-resize' });
    }
  };

  private onMouseUp = (): void => {
    this.drag = null;
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const [sx, sy] = this.eventToCanvasXY(ev);
    const [wxBefore, wyBefore] = this.screenToWorld(sx, sy);
    const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.scale = Math.min(800, Math.max(5, this.scale * factor));
    const [wxAfter, wyAfter] = this.screenToWorld(sx, sy);
    this.offset.x += (wxAfter - wxBefore) * this.scale;
    this.offset.y -= (wyAfter - wyBefore) * this.scale;
    this.render();
  };

  render(): void {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(0, 0, w, h);

    this.drawGrid(w, h);
    this.drawDxfEntities();
    for (const wall of this.doc.walls.values()) this.drawWall(wall);
    for (const mod of this.doc.modules.values()) this.drawModule(mod);
    for (const inst of this.doc.placedComponents.values()) this.drawComponent(inst);
    for (const dim of this.doc.dimensions.values()) this.drawDimension(dim);
    this.drawPendingTool();
  }

  private drawGrid(w: number, h: number): void {
    const ctx = this.ctx;
    const step = this.scale >= 40 ? 1 : this.scale >= 15 ? 5 : 10;
    ctx.strokeStyle = '#2c2c34';
    ctx.lineWidth = 1;
    const worldLeft = this.screenToWorld(0, 0)[0];
    const worldRight = this.screenToWorld(w, 0)[0];
    const worldTop = this.screenToWorld(0, 0)[1];
    const worldBottom = this.screenToWorld(0, h)[1];

    ctx.beginPath();
    for (let x = Math.floor(worldLeft / step) * step; x <= worldRight; x += step) {
      const [sx] = this.worldToScreen(x, 0);
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(worldBottom / step) * step; y <= worldTop; y += step) {
      const [, sy] = this.worldToScreen(0, y);
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    // Axes
    ctx.strokeStyle = '#454552';
    ctx.lineWidth = 1.5;
    const [ox, oy] = this.worldToScreen(0, 0);
    ctx.beginPath();
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.stroke();
  }

  private drawDxfEntities(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 1;
    for (const e of this.doc.dxfEntities) {
      ctx.beginPath();
      if (e.kind === 'line') {
        const [x1, y1] = this.worldToScreen(...e.from);
        const [x2, y2] = this.worldToScreen(...e.to);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      } else if (e.kind === 'polyline') {
        e.points.forEach((p, i) => {
          const [x, y] = this.worldToScreen(...p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (e.closed) ctx.closePath();
      } else if (e.kind === 'circle') {
        const [cx, cy] = this.worldToScreen(...e.center);
        ctx.arc(cx, cy, e.radius * this.scale, 0, Math.PI * 2);
      } else if (e.kind === 'arc') {
        const [cx, cy] = this.worldToScreen(...e.center);
        ctx.arc(cx, cy, e.radius * this.scale, -e.endAngle, -e.startAngle);
      }
      ctx.stroke();
    }
  }

  private drawModule(m: ModuleDef): void {
    const ctx = this.ctx;
    const [x, y] = this.worldToScreen(m.position.x, m.position.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-m.rotationZ);

    const pw = m.width * this.scale;
    const pd = m.depth * this.scale;
    const selected = this.doc.selectedIds.has(m.id);

    ctx.fillStyle = m.color + '55';
    ctx.fillRect(0, -pd, pw, pd);
    ctx.strokeStyle = selected ? '#ffd25b' : m.color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeRect(0, -pd, pw, pd);

    ctx.fillStyle = '#e8e8f0';
    ctx.font = '12px sans-serif';
    ctx.fillText(m.name, 4, -pd + 14);

    if (selected) {
      ctx.fillStyle = '#ffd25b';
      ctx.beginPath();
      ctx.arc(pw, 0, HANDLE_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawComponent(inst: PlacedComponentDef): void {
    const ctx = this.ctx;
    const [x, y] = this.worldToScreen(inst.position.x, inst.position.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-inst.rotationZ);

    const pw = inst.width * inst.scale * this.scale;
    const pd = inst.depth * inst.scale * this.scale;
    const selected = this.doc.selectedIds.has(inst.id);

    ctx.fillStyle = '#c060ff33';
    ctx.fillRect(0, -pd, pw, pd);
    ctx.strokeStyle = selected ? '#ffd25b' : '#c060ff';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(0, -pd, pw, pd);
    ctx.setLineDash([]);

    ctx.fillStyle = '#e8e8f0';
    ctx.font = '12px sans-serif';
    ctx.fillText(inst.name, 4, -pd + 14);
    ctx.restore();
  }

  private drawWall(wall: WallDef): void {
    const ctx = this.ctx;
    const [x1, y1] = this.worldToScreen(...wall.start);
    const [x2, y2] = this.worldToScreen(...wall.end);
    const selected = this.selectedWallId === wall.id;
    ctx.save();
    ctx.lineCap = 'square';
    ctx.strokeStyle = selected ? '#ffd25b' : wall.color;
    ctx.lineWidth = Math.max(2, wall.thickness * this.scale);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  private drawDimension(dim: DimensionDef): void {
    const ctx = this.ctx;
    const [fx, fy] = dim.from;
    const [tx, ty] = dim.to;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = -dy / len; // unit normal, used to offset the dimension line
    const ny = dx / len;
    const ox = nx * dim.offset;
    const oy = ny * dim.offset;

    const p1 = this.worldToScreen(fx + ox, fy + oy);
    const p2 = this.worldToScreen(tx + ox, ty + oy);
    const e1 = this.worldToScreen(fx, fy);
    const e2 = this.worldToScreen(tx, ty);

    ctx.save();
    ctx.strokeStyle = '#ff9d4d';
    ctx.fillStyle = '#ff9d4d';
    ctx.lineWidth = 1;

    // Extension lines from the measured points out to the dimension line.
    ctx.beginPath();
    ctx.moveTo(e1[0], e1[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.moveTo(e2[0], e2[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();

    // Dimension line with small perpendicular end ticks.
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
    const tick = 4;
    ctx.beginPath();
    ctx.moveTo(p1[0] - nx * tick, p1[1] + ny * tick);
    ctx.lineTo(p1[0] + nx * tick, p1[1] - ny * tick);
    ctx.moveTo(p2[0] - nx * tick, p2[1] + ny * tick);
    ctx.lineTo(p2[0] + nx * tick, p2[1] - ny * tick);
    ctx.stroke();

    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    let angle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // keep text upright

    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${len.toFixed(2)} m`, 0, -4);
    ctx.restore();
  }

  private drawPendingTool(): void {
    if (!this.pendingPoint) return;
    const ctx = this.ctx;
    const start = this.worldToScreen(...this.pendingPoint);
    const end = this.previewPoint ? this.worldToScreen(...this.previewPoint) : start;
    ctx.save();
    ctx.strokeStyle = this.tool === 'wall' ? '#8a8a9a' : '#ff9d4d';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = this.tool === 'wall' ? 4 : 1;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.previewPoint) {
      const len = Math.hypot(this.previewPoint[0] - this.pendingPoint[0], this.previewPoint[1] - this.pendingPoint[1]);
      ctx.fillStyle = '#e8e8f0';
      ctx.font = '11px sans-serif';
      ctx.fillText(`${len.toFixed(2)} m`, (start[0] + end[0]) / 2 + 6, (start[1] + end[1]) / 2 - 6);
    }
    ctx.restore();
  }
}
