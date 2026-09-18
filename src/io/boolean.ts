import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Brush as BrushT } from 'three-bvh-csg';
import type { CadDocument } from '../core/Document';
import type { ModuleDef, PlacedComponentDef } from '../core/types';
import { loadLibraryComponentGroup } from './mesh';
import { saveGroupAsLibraryComponent } from './component';

export type BooleanOp = 'union' | 'subtract' | 'intersect';

const OP_LABEL: Record<BooleanOp, string> = { union: 'União', subtract: 'Subtração', intersect: 'Interseção' };

// three-bvh-csg is only needed for this one feature — lazy-load it instead of paying its weight
// in the main bundle for every visitor (same pattern as jsPDF in io/pdf.ts).
let csgPromise: Promise<typeof import('three-bvh-csg')> | undefined;
function getCsg(): Promise<typeof import('three-bvh-csg')> {
  if (!csgPromise) csgPromise = import('three-bvh-csg');
  return csgPromise;
}

/** Keeps only position+normal — the two attributes every geometry we build here reliably has.
 * Mixing geometries with different attribute sets (e.g. a BoxGeometry's 'uv' against an
 * imported STEP mesh with none) makes three-bvh-csg's evaluator and mergeGeometries() error out. */
function normalizeForCsg(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const clean = geometry.clone();
  if (!clean.attributes.normal) clean.computeVertexNormals();
  for (const name of Object.keys(clean.attributes)) {
    if (name !== 'position' && name !== 'normal') clean.deleteAttribute(name);
  }
  return clean;
}

function moduleGeometry(mod: ModuleDef): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(mod.width, mod.height, mod.depth);
  geo.translate(mod.width / 2, mod.height / 2, mod.depth / 2);
  return normalizeForCsg(geo);
}

/** Flattens a (possibly multi-mesh, possibly nested) library component template into one
 * BufferGeometry in the template's own local space, each mesh's transform baked in. */
async function componentGeometry(libraryId: string): Promise<THREE.BufferGeometry> {
  const template = await loadLibraryComponentGroup(libraryId);
  template.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  template.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = normalizeForCsg(mesh.geometry as THREE.BufferGeometry);
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push(geo);
  });
  if (parts.length === 0) throw new Error('Componente sem geometria própria.');
  return parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) ?? parts[0]);
}

interface Operand {
  kind: 'module' | 'component';
  id: string;
  brush: BrushT;
}

async function toBrush(doc: CadDocument, id: string, BrushCtor: typeof BrushT): Promise<Operand | undefined> {
  const mod = doc.modules.get(id);
  if (mod) {
    const brush = new BrushCtor(moduleGeometry(mod));
    brush.position.set(mod.position.x, mod.position.z, mod.position.y);
    brush.rotation.set(0, -mod.rotationZ, 0);
    brush.updateMatrixWorld(true);
    return { kind: 'module', id, brush };
  }
  const inst = doc.placedComponents.get(id);
  if (inst) {
    const geometry = await componentGeometry(inst.libraryId);
    const brush = new BrushCtor(geometry);
    brush.position.set(inst.position.x, inst.position.z, inst.position.y);
    brush.rotation.set(0, -inst.rotationZ, 0);
    brush.scale.setScalar(inst.scale);
    brush.updateMatrixWorld(true);
    return { kind: 'component', id, brush };
  }
  return undefined;
}

function removeOperand(doc: CadDocument, operand: Operand): void {
  if (operand.kind === 'module') doc.removeModule(operand.id);
  else doc.removePlacedComponent(operand.id);
}

/**
 * Combines exactly two selected modules/components into one new library component via CSG
 * (three-bvh-csg) — the result generally isn't a box any more, so it's saved as an imported-style
 * component (see io/component.ts's saveGroupAsLibraryComponent) and both originals are removed.
 * `subtract` is A − B, where A is whichever of the two ids is passed first.
 */
export async function applyBoolean(doc: CadDocument, idA: string, idB: string, op: BooleanOp): Promise<PlacedComponentDef> {
  const { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } = await getCsg();
  const opCode = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[op];

  const a = await toBrush(doc, idA, Brush);
  const b = await toBrush(doc, idB, Brush);
  if (!a || !b) throw new Error('Selecione dois módulos/componentes válidos.');

  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  const resultBrush = evaluator.evaluate(a.brush, b.brush, opCode);
  const resultGeometry = resultBrush.geometry;
  if (resultGeometry.attributes.position.count === 0) {
    throw new Error(`${OP_LABEL[op]} não gerou nenhuma geometria (as peças podem não se sobrepor).`);
  }

  const mesh = new THREE.Mesh(resultGeometry, new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.1, roughness: 0.75 }));
  const group = new THREE.Group();
  group.add(mesh);

  const { meta, worldAnchor } = await saveGroupAsLibraryComponent(OP_LABEL[op], 'boolean', group);

  doc.checkpoint();
  const newInst = doc.addPlacedComponent({
    libraryId: meta.id,
    name: meta.name,
    position: { x: worldAnchor.x, y: worldAnchor.z, z: worldAnchor.y },
    rotationZ: 0,
    scale: 1,
    width: meta.width,
    depth: meta.depth,
    height: meta.height,
  });
  removeOperand(doc, a);
  removeOperand(doc, b);
  doc.setSelection([newInst.id]);
  return newInst;
}
