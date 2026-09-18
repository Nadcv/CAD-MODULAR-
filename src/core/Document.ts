import { Emitter } from './events';
import type { DimensionDef, DxfEntity, MasterModuleDef, ModuleDef, PlacedComponentDef, WallDef } from './types';

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

interface DocEvents {
  change: { reason: string };
  selectionChange: { selectedIds: string[] };
  historyChange: { canUndo: boolean; canRedo: boolean };
  [key: string]: unknown;
}

interface SerializedDoc {
  modules: ModuleDef[];
  masters: MasterModuleDef[];
  walls: WallDef[];
  dimensions: DimensionDef[];
  placedComponents: PlacedComponentDef[];
}

const HISTORY_LIMIT = 100;

/**
 * The single source of truth for a drawing: modules, master blocks, walls, dimensions, and
 * imported reference geometry. The 2D and 3D views both read/write through this document and
 * re-render on `change`.
 *
 * Undo/redo works by snapshotting the serializable state. Continuous interactions (dragging a
 * module) call `checkpoint()` once *before* the drag starts, not on every intermediate move, so
 * a whole drag collapses into a single undo step — callers are responsible for calling it at the
 * right granularity (see Canvas2D/Scene3D pointerdown handlers and the UI panels).
 */
export class CadDocument {
  readonly events = new Emitter<DocEvents>();

  modules = new Map<string, ModuleDef>();
  masters = new Map<string, MasterModuleDef>();
  walls = new Map<string, WallDef>();
  dimensions = new Map<string, DimensionDef>();
  placedComponents = new Map<string, PlacedComponentDef>();
  dxfEntities: DxfEntity[] = [];

  selectedIds = new Set<string>();

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private restoring = false;

  private notify(reason: string): void {
    this.events.emit('change', { reason });
  }

  // --- History (undo/redo) --------------------------------------------

  /** Call once before starting a mutation (or a batch of them, e.g. a drag) that should be undoable. */
  checkpoint(): void {
    if (this.restoring) return;
    this.undoStack.push(this.serializeState());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistoryChange();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.serializeState());
    this.restoreState(prev);
    this.emitHistoryChange();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.serializeState());
    this.restoreState(next);
    this.emitHistoryChange();
  }

  /** Discards undo/redo history (e.g. right after an initial load, so undo can't erase it). */
  resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistoryChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private emitHistoryChange(): void {
    this.events.emit('historyChange', { canUndo: this.canUndo, canRedo: this.canRedo });
  }

  private restoreState(json: string): void {
    this.restoring = true;
    this.loadJSON(json);
    this.restoring = false;
  }

  // --- Modules -------------------------------------------------------

  addModule(partial: Omit<ModuleDef, 'id'> & { id?: string }): ModuleDef {
    // `id` must come last in the spread: a caller like duplicateModule() passes `id: undefined`
    // explicitly (not omitted), and object spread with `id` first would let that `undefined`
    // silently overwrite the freshly generated one, storing every such call under the same
    // `undefined` Map key (later calls would each clobber the previous one).
    const mod: ModuleDef = { ...partial, id: partial.id ?? nextId('mod') };
    this.modules.set(mod.id, mod);
    this.notify('addModule');
    return mod;
  }

  updateModule(id: string, patch: Partial<Omit<ModuleDef, 'id'>>): void {
    const mod = this.modules.get(id);
    if (!mod) return;
    Object.assign(mod, patch);

    // If this instance is linked to a master, keep sibling instances of the same master
    // in sync for dimension/color changes — "edit once, update everywhere".
    if (
      mod.masterId &&
      (patch.width !== undefined || patch.depth !== undefined || patch.height !== undefined || patch.color !== undefined || patch.material !== undefined)
    ) {
      const master = this.masters.get(mod.masterId);
      if (master) {
        if (patch.width !== undefined) master.width = patch.width;
        if (patch.depth !== undefined) master.depth = patch.depth;
        if (patch.height !== undefined) master.height = patch.height;
        if (patch.color !== undefined) master.color = patch.color;
        if (patch.material !== undefined) master.material = patch.material;
        for (const sibling of this.modules.values()) {
          if (sibling.masterId === mod.masterId && sibling.id !== id) {
            if (patch.width !== undefined) sibling.width = patch.width;
            if (patch.depth !== undefined) sibling.depth = patch.depth;
            if (patch.height !== undefined) sibling.height = patch.height;
            if (patch.color !== undefined) sibling.color = patch.color;
            if (patch.material !== undefined) sibling.material = patch.material;
          }
        }
      }
    }

    this.notify('updateModule');
  }

  removeModule(id: string): void {
    this.modules.delete(id);
    this.selectedIds.delete(id);
    this.notify('removeModule');
  }

  duplicateModule(id: string): ModuleDef | undefined {
    const src = this.modules.get(id);
    if (!src) return undefined;
    return this.addModule({
      ...src,
      id: undefined as unknown as string,
      name: `${src.name} (cópia)`,
      position: { x: src.position.x + src.width, y: src.position.y, z: src.position.z },
    });
  }

  // --- Master modules (reusable blocks) -------------------------------

  defineMaster(partial: Omit<MasterModuleDef, 'id'> & { id?: string }): MasterModuleDef {
    const master: MasterModuleDef = { ...partial, id: partial.id ?? nextId('master') };
    this.masters.set(master.id, master);
    this.notify('defineMaster');
    return master;
  }

  instantiateMaster(masterId: string, position = { x: 0, y: 0, z: 0 }): ModuleDef | undefined {
    const master = this.masters.get(masterId);
    if (!master) return undefined;
    return this.addModule({
      name: master.name,
      position,
      rotationZ: 0,
      width: master.width,
      depth: master.depth,
      height: master.height,
      color: master.color,
      material: master.material,
      masterId: master.id,
    });
  }

  // --- Walls -------------------------------------------------------------

  addWall(partial: Omit<WallDef, 'id'> & { id?: string }): WallDef {
    const wall: WallDef = { ...partial, id: partial.id ?? nextId('wall') };
    this.walls.set(wall.id, wall);
    this.notify('addWall');
    return wall;
  }

  updateWall(id: string, patch: Partial<Omit<WallDef, 'id'>>): void {
    const wall = this.walls.get(id);
    if (!wall) return;
    Object.assign(wall, patch);
    this.notify('updateWall');
  }

  removeWall(id: string): void {
    this.walls.delete(id);
    this.selectedIds.delete(id);
    this.notify('removeWall');
  }

  // --- Dimensions (2D annotations) ----------------------------------------

  addDimension(partial: Omit<DimensionDef, 'id'> & { id?: string }): DimensionDef {
    const dim: DimensionDef = { ...partial, id: partial.id ?? nextId('dim') };
    this.dimensions.set(dim.id, dim);
    this.notify('addDimension');
    return dim;
  }

  removeDimension(id: string): void {
    this.dimensions.delete(id);
    this.notify('removeDimension');
  }

  // --- Placed components (instances of the persistent 3D component library) ---------

  addPlacedComponent(partial: Omit<PlacedComponentDef, 'id'> & { id?: string }): PlacedComponentDef {
    const inst: PlacedComponentDef = { ...partial, id: partial.id ?? nextId('comp') };
    this.placedComponents.set(inst.id, inst);
    this.notify('addPlacedComponent');
    return inst;
  }

  updatePlacedComponent(id: string, patch: Partial<Omit<PlacedComponentDef, 'id'>>): void {
    const inst = this.placedComponents.get(id);
    if (!inst) return;
    Object.assign(inst, patch);
    this.notify('updatePlacedComponent');
  }

  removePlacedComponent(id: string): void {
    this.placedComponents.delete(id);
    this.selectedIds.delete(id);
    this.notify('removePlacedComponent');
  }

  // --- Selection -------------------------------------------------------

  setSelection(ids: string[]): void {
    this.selectedIds = new Set(ids);
    this.events.emit('selectionChange', { selectedIds: [...this.selectedIds] });
  }

  // --- Reference geometry (imported CAD data) ---------------------------

  setDxfEntities(entities: DxfEntity[]): void {
    this.dxfEntities = entities;
    this.notify('setDxfEntities');
  }

  clear(): void {
    this.modules.clear();
    this.masters.clear();
    this.walls.clear();
    this.dimensions.clear();
    this.placedComponents.clear();
    this.dxfEntities = [];
    this.selectedIds.clear();
    this.notify('clear');
  }

  private serializeState(): string {
    const data: SerializedDoc = {
      modules: [...this.modules.values()],
      masters: [...this.masters.values()],
      walls: [...this.walls.values()],
      dimensions: [...this.dimensions.values()],
      placedComponents: [...this.placedComponents.values()],
    };
    return JSON.stringify(data);
  }

  /** Pretty-printed export for downloads; identical shape to what loadJSON accepts. */
  toJSON(): string {
    const data: SerializedDoc = {
      modules: [...this.modules.values()],
      masters: [...this.masters.values()],
      walls: [...this.walls.values()],
      dimensions: [...this.dimensions.values()],
      placedComponents: [...this.placedComponents.values()],
    };
    return JSON.stringify(data, null, 2);
  }

  loadJSON(json: string): void {
    const data = JSON.parse(json) as Partial<SerializedDoc>;
    this.modules = new Map((data.modules ?? []).map((m) => [m.id, m]));
    this.masters = new Map((data.masters ?? []).map((m) => [m.id, m]));
    this.walls = new Map((data.walls ?? []).map((w) => [w.id, w]));
    this.dimensions = new Map((data.dimensions ?? []).map((d) => [d.id, d]));
    this.placedComponents = new Map((data.placedComponents ?? []).map((c) => [c.id, c]));
    this.selectedIds.clear();
    this.notify('loadJSON');
    this.events.emit('selectionChange', { selectedIds: [] });
  }
}
