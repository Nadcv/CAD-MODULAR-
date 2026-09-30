import type { CadDocument } from '../core/Document';
import { nextId } from '../core/Document';

/** All module/component ids sharing `groupId`, in no particular order. */
export function getGroupMembers(doc: CadDocument, groupId: string): string[] {
  const ids: string[] = [];
  for (const m of doc.modules.values()) if (m.groupId === groupId) ids.push(m.id);
  for (const c of doc.placedComponents.values()) if (c.groupId === groupId) ids.push(c.id);
  return ids;
}

/** Looks up whichever module/component `id` refers to and returns its groupId, if any. */
export function groupIdOf(doc: CadDocument, id: string): string | undefined {
  return doc.modules.get(id)?.groupId ?? doc.placedComponents.get(id)?.groupId;
}

/**
 * Groups the given ids under a fresh shared groupId — selecting any one member afterwards (in
 * the 2D/3D view) selects the whole group, and dragging one in 3D translates the rest with it
 * (rotate/scale/resize only ever apply to the one part actually grabbed). Re-grouping already-
 * grouped items (including items from two different existing groups) merges them into one group.
 */
export function groupSelection(doc: CadDocument, ids: string[]): string | undefined {
  if (ids.length < 2) return undefined;
  doc.checkpoint();
  const groupId = nextId('group');
  for (const id of ids) {
    if (doc.modules.has(id)) doc.updateModule(id, { groupId });
    else if (doc.placedComponents.has(id)) doc.updatePlacedComponent(id, { groupId });
  }
  doc.setSelection(ids);
  return groupId;
}

/** Clears groupId from every member of `groupId`, leaving each as an independent item again. */
export function ungroup(doc: CadDocument, groupId: string): void {
  const members = getGroupMembers(doc, groupId);
  if (members.length === 0) return;
  doc.checkpoint();
  for (const id of members) {
    if (doc.modules.has(id)) doc.updateModule(id, { groupId: undefined });
    else if (doc.placedComponents.has(id)) doc.updatePlacedComponent(id, { groupId: undefined });
  }
  doc.setSelection(members);
}
