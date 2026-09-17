import DxfParser from 'dxf-parser';
import Drawing from 'dxf-writer';
import type { CadDocument } from '../core/Document';
import type { DxfEntity } from '../core/types';

interface RawDxfEntity {
  type: string;
  vertices?: { x: number; y: number }[];
  shape?: boolean;
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
}

/** Parses a DXF file's text content into flattened reference entities (lines/polylines/circles/arcs). */
export function parseDxf(text: string): DxfEntity[] {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text) as { entities: RawDxfEntity[] } | null;
  if (!dxf) return [];

  const entities: DxfEntity[] = [];
  for (const e of dxf.entities ?? []) {
    if (e.type === 'LINE' && e.startPoint && e.endPoint) {
      entities.push({ kind: 'line', from: [e.startPoint.x, e.startPoint.y], to: [e.endPoint.x, e.endPoint.y] });
    } else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) {
      entities.push({
        kind: 'polyline',
        points: e.vertices.map((v) => [v.x, v.y] as [number, number]),
        closed: !!e.shape,
      });
    } else if (e.type === 'CIRCLE' && e.center && e.radius !== undefined) {
      entities.push({ kind: 'circle', center: [e.center.x, e.center.y], radius: e.radius });
    } else if (e.type === 'ARC' && e.center && e.radius !== undefined) {
      entities.push({
        kind: 'arc',
        center: [e.center.x, e.center.y],
        radius: e.radius,
        startAngle: ((e.startAngle ?? 0) * Math.PI) / 180,
        endAngle: ((e.endAngle ?? 0) * Math.PI) / 180,
      });
    }
  }
  return entities;
}

export function importDxfIntoDocument(doc: CadDocument, text: string): void {
  doc.setDxfEntities(parseDxf(text));
}

/** Exports modules (as closed rectangles) and imported reference entities back out as DXF text. */
export function exportDocumentToDxf(doc: CadDocument): string {
  const d = new Drawing();
  d.addLayer('modules', Drawing.ACI.YELLOW, 'CONTINUOUS').setActiveLayer('modules');

  for (const m of doc.modules.values()) {
    const cos = Math.cos(m.rotationZ);
    const sin = Math.sin(m.rotationZ);
    const corners: [number, number][] = [
      [0, 0],
      [m.width, 0],
      [m.width, m.depth],
      [0, m.depth],
    ].map(([lx, ly]) => [m.position.x + lx * cos - ly * sin, m.position.y + lx * sin + ly * cos]);
    d.drawPolyline([...corners, corners[0]]);
  }

  d.addLayer('walls', Drawing.ACI.WHITE, 'CONTINUOUS').setActiveLayer('walls');
  for (const wall of doc.walls.values()) {
    const dx = wall.end[0] - wall.start[0];
    const dy = wall.end[1] - wall.start[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (wall.thickness / 2);
    const ny = (dx / len) * (wall.thickness / 2);
    const corners: [number, number][] = [
      [wall.start[0] + nx, wall.start[1] + ny],
      [wall.end[0] + nx, wall.end[1] + ny],
      [wall.end[0] - nx, wall.end[1] - ny],
      [wall.start[0] - nx, wall.start[1] - ny],
    ];
    d.drawPolyline([...corners, corners[0]]);
  }

  d.addLayer('dimensions', Drawing.ACI.RED, 'CONTINUOUS').setActiveLayer('dimensions');
  for (const dim of doc.dimensions.values()) {
    const [fx, fy] = dim.from;
    const [tx, ty] = dim.to;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * dim.offset;
    const ny = (dx / len) * dim.offset;
    d.drawLine(fx + nx, fy + ny, tx + nx, ty + ny);
    d.drawText(fx + nx + dx / 2, fy + ny + dy / 2, 0.1, 0, `${len.toFixed(2)}m`);
  }

  d.addLayer('components', Drawing.ACI.MAGENTA, 'CONTINUOUS').setActiveLayer('components');
  for (const inst of doc.placedComponents.values()) {
    const cos = Math.cos(inst.rotationZ);
    const sin = Math.sin(inst.rotationZ);
    const w = inst.width * inst.scale;
    const dp = inst.depth * inst.scale;
    const corners: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, dp],
      [0, dp],
    ].map(([lx, ly]) => [inst.position.x + lx * cos - ly * sin, inst.position.y + lx * sin + ly * cos]);
    d.drawPolyline([...corners, corners[0]]);
    d.drawText(inst.position.x, inst.position.y, 0.08, (inst.rotationZ * 180) / Math.PI, inst.name);
  }

  d.addLayer('reference', Drawing.ACI.BLUE, 'CONTINUOUS').setActiveLayer('reference');
  for (const e of doc.dxfEntities) {
    if (e.kind === 'line') d.drawLine(e.from[0], e.from[1], e.to[0], e.to[1]);
    else if (e.kind === 'polyline') d.drawPolyline(e.closed ? [...e.points, e.points[0]] : e.points);
    else if (e.kind === 'circle') d.drawCircle(e.center[0], e.center[1], e.radius);
    else if (e.kind === 'arc')
      d.drawArc(e.center[0], e.center[1], e.radius, (e.startAngle * 180) / Math.PI, (e.endAngle * 180) / Math.PI);
  }

  return d.toDxfString();
}
