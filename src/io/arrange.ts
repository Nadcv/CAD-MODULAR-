import type { CadDocument } from '../core/Document';

/**
 * Linear array: adds `count - 1` copies of the selected module/component, each further offset by
 * (dx, dy) meters from the previous one — the original stays where it is, as element 0.
 */
export function arrayLinear(doc: CadDocument, id: string, count: number, dx: number, dy: number): string[] {
  const mod = doc.modules.get(id);
  const inst = doc.placedComponents.get(id);
  if ((!mod && !inst) || count < 2) return [];

  doc.checkpoint();
  const newIds: string[] = [];
  for (let i = 1; i < count; i++) {
    if (mod) {
      const copy = doc.addModule({
        ...mod,
        id: undefined as unknown as string,
        masterId: undefined,
        position: { x: mod.position.x + dx * i, y: mod.position.y + dy * i, z: mod.position.z },
      });
      newIds.push(copy.id);
    } else if (inst) {
      const copy = doc.addPlacedComponent({
        ...inst,
        id: undefined as unknown as string,
        position: { x: inst.position.x + dx * i, y: inst.position.y + dy * i, z: inst.position.z },
      });
      newIds.push(copy.id);
    }
  }
  doc.setSelection([id, ...newIds]);
  return newIds;
}

/**
 * Circular (polar) array: adds `count - 1` copies arranged around the original at `radius`
 * meters, spread evenly across `totalAngleDeg` degrees — the original itself is the pivot the
 * copies orbit around, not one of the arranged positions.
 */
export function arrayCircular(doc: CadDocument, id: string, count: number, radius: number, totalAngleDeg: number): string[] {
  const mod = doc.modules.get(id);
  const inst = doc.placedComponents.get(id);
  if ((!mod && !inst) || count < 2) return [];

  const base = (mod ?? inst)!.position;
  const totalAngle = (totalAngleDeg * Math.PI) / 180;
  const step = totalAngle / count;

  doc.checkpoint();
  const newIds: string[] = [];
  for (let i = 1; i < count; i++) {
    const angle = step * i;
    const x = base.x + radius * Math.cos(angle);
    const y = base.y + radius * Math.sin(angle);
    if (mod) {
      const copy = doc.addModule({ ...mod, id: undefined as unknown as string, masterId: undefined, position: { x, y, z: mod.position.z } });
      newIds.push(copy.id);
    } else if (inst) {
      const copy = doc.addPlacedComponent({ ...inst, id: undefined as unknown as string, position: { x, y, z: inst.position.z } });
      newIds.push(copy.id);
    }
  }
  doc.setSelection([id, ...newIds]);
  return newIds;
}

export type MirrorAxis = 'x' | 'y';

/**
 * Duplicates across the world x=0 or y=0 plane — the new copy's footprint is the true mirror
 * image (position reflected, accounting for width/depth so the whole rectangle flips, not just
 * its origin corner; rotation negated to match). Useful for whole-layout symmetry (e.g. mirroring
 * a run of cabinets to the opposite side of a room centered on the origin).
 *
 * Boxes have no chirality, so this is exact for modules. For an imported 3D component, only the
 * *position* is a true mirror image — the component's own mesh isn't flipped (this app has no way
 * to represent a negatively-scaled/reflected instance), so a strongly asymmetric part won't have
 * its left/right handedness flipped, just its placement.
 */
export function mirror(doc: CadDocument, id: string, axis: MirrorAxis): string | undefined {
  const mod = doc.modules.get(id);
  const inst = doc.placedComponents.get(id);
  if (!mod && !inst) return undefined;

  doc.checkpoint();
  if (mod) {
    const position =
      axis === 'x'
        ? { x: -(mod.position.x + mod.width), y: mod.position.y, z: mod.position.z }
        : { x: mod.position.x, y: -(mod.position.y + mod.depth), z: mod.position.z };
    const copy = doc.addModule({ ...mod, id: undefined as unknown as string, masterId: undefined, name: `${mod.name} (espelho)`, position, rotationZ: -mod.rotationZ });
    doc.setSelection([copy.id]);
    return copy.id;
  }
  const width = inst!.width * inst!.scale;
  const depth = inst!.depth * inst!.scale;
  const position =
    axis === 'x'
      ? { x: -(inst!.position.x + width), y: inst!.position.y, z: inst!.position.z }
      : { x: inst!.position.x, y: -(inst!.position.y + depth), z: inst!.position.z };
  const copy = doc.addPlacedComponent({ ...inst!, id: undefined as unknown as string, name: `${inst!.name} (espelho)`, position, rotationZ: -inst!.rotationZ });
  doc.setSelection([copy.id]);
  return copy.id;
}
