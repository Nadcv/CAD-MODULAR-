import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CadDocument } from '../core/Document';
import { nextId } from '../core/Document';
import type { LibraryComponentMeta, PlacedComponentDef } from '../core/types';
import { saveComponent } from '../core/componentLibrary';
import { loadMeshGroup, loadLibraryComponentGroup, formatFromFilename } from './mesh';
import { loadStepOrIgesGroup } from './step';
import { isDwgFile } from './dwg';

function isStepOrIges(filename: string): boolean {
  return /\.(step|stp|igs|iges)$/i.test(filename);
}

function exportGroupToGlb(group: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('Exportação glTF binária retornou um formato inesperado'));
      },
      (err) => reject(err),
      { binary: true },
    );
  });
}

/** True if `object`'s subtree contains at least one mesh with actual vertex data. Real-world STEP
 * assemblies sometimes include nodes with no tessellated shape at all (reference axes, datum
 * planes, PMI/annotation entities, or a part whose geometry the CAD kernel couldn't mesh) — these
 * have a name and a place in the hierarchy but nothing to actually show. */
function hasGeometry(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    if (found) return;
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && (mesh.geometry as THREE.BufferGeometry).attributes.position?.count) found = true;
  });
  return found;
}

/**
 * Re-anchors `group` so its bounding box starts at its own local origin (matches how modules are
 * authored: position is the bottom-front-left corner, not an arbitrary offset), exports it to
 * binary glTF, and saves it as a new persistent library component.
 */
async function saveGroupAsLibraryComponent(
  name: string,
  sourceFormat: string,
  group: THREE.Object3D,
): Promise<{ meta: LibraryComponentMeta; worldAnchor: THREE.Vector3 }> {
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  const worldAnchor = box.min.clone();
  group.position.sub(worldAnchor);

  const glb = await exportGroupToGlb(group);
  const meta = await saveComponent(
    { id: nextId('lib'), name, sourceFormat, width: size.x || 0.01, depth: size.z || 0.01, height: size.y || 0.01 },
    glb,
  );
  return { meta, worldAnchor };
}

/**
 * Imports any supported 3D file (STL/OBJ/glTF/GLB/STEP/IGES) as ONE rigid component — the whole
 * file, sub-parts and all, stays grouped together (e.g. a multi-part Danfoss valve assembly moves
 * as a single unit, it isn't scattered into independent pieces). The parsed geometry is converted
 * to binary glTF and saved in the persistent component library (IndexedDB), so re-using the same
 * component later doesn't require re-importing or re-tessellating the source file; an instance is
 * then placed into the current document at the origin.
 */
export async function importFileAsComponent(
  doc: CadDocument,
  file: File,
): Promise<{ meta: LibraryComponentMeta; instance: PlacedComponentDef }> {
  if (isDwgFile(file.name)) {
    throw new Error('.dwg é um desenho 2D — use o botão "Importar DXF/DWG (2D)..." em vez deste.');
  }

  let group: THREE.Object3D;
  let sourceFormat: string;
  if (isStepOrIges(file.name)) {
    group = await loadStepOrIgesGroup(file);
    sourceFormat = /\.(igs|iges)$/i.test(file.name) ? 'iges' : 'step';
  } else {
    const format = formatFromFilename(file.name);
    if (!format) throw new Error(`Formato não suportado: ${file.name}`);
    group = await loadMeshGroup(file);
    sourceFormat = format;
  }

  const { meta } = await saveGroupAsLibraryComponent(file.name, sourceFormat, group);

  doc.checkpoint();
  const inst = doc.addPlacedComponent({
    libraryId: meta.id,
    name: meta.name,
    position: { x: 0, y: 0, z: 0 },
    rotationZ: 0,
    scale: 1,
    width: meta.width,
    depth: meta.depth,
    height: meta.height,
  });
  doc.setSelection([inst.id]);

  return { meta, instance: inst };
}

/**
 * Round-tripping through GLTFExporter/GLTFLoader (as every saved library component has) wraps
 * whatever object was originally exported in its own synthetic node — so if the original file had
 * two top-level parts ("Corpo", "Tampa"), the loaded result isn't a group with those two as direct
 * children; it's a group with ONE child (the wrapper), which in turn has the two real parts. Drill
 * through those single-child pass-through nodes to find the level that actually branches.
 */
export function findExplodableParts(root: THREE.Object3D): THREE.Object3D[] {
  let node = root;
  while (node.children.length === 1) node = node.children[0];
  return node.children;
}

/**
 * Names for a library component's top-level sub-parts (the same split "Explodir" would produce),
 * without loading geometry into the document — lets a UI preview a multi-part component's
 * structure (e.g. a parts tree, mirroring how FreeCAD shows an assembly's tree immediately on
 * import) before the user commits to actually separating anything.
 */
export async function listSubParts(libraryId: string): Promise<string[]> {
  const template = await loadLibraryComponentGroup(libraryId);
  const parts = findExplodableParts(template);
  if (parts.length <= 1) return [];
  return parts.map((child, i) => child.name || `Parte ${i + 1}`);
}

/**
 * "Explode" a placed component one level deep: each of its top-level sub-parts (e.g. a multi-body
 * assembly's individual bodies) becomes its own independent library component + placed instance,
 * positioned/rotated exactly where it visually sat inside the original — and the combined instance
 * is removed. Mirrors AutoCAD's EXPLODE: one level per call: run it again on a result to go deeper.
 * Throws if the component has no more than one top-level part (nothing to explode), or if none of
 * its top-level parts have actual geometry to show.
 */
export async function explodeComponent(
  doc: CadDocument,
  inst: PlacedComponentDef,
): Promise<{ instances: PlacedComponentDef[]; skipped: number }> {
  const template = await loadLibraryComponentGroup(inst.libraryId);

  // Reproduce exactly the placement Scene3D uses, so each child's matrixWorld reflects where it
  // is actually seen in the current document (accounts for any move/rotate/scale already applied
  // to this instance).
  template.position.set(inst.position.x, inst.position.z, inst.position.y);
  template.rotation.set(0, -inst.rotationZ, 0);
  template.scale.setScalar(inst.scale);
  template.updateMatrixWorld(true);

  const parts = findExplodableParts(template);
  if (parts.length <= 1) {
    throw new Error('Este componente é uma peça única — não há sub-partes para explodir.');
  }

  const saved: { meta: LibraryComponentMeta; worldAnchor: THREE.Vector3 }[] = [];
  let skipped = 0;
  let idx = 0;
  for (const child of parts) {
    idx += 1;
    // Some real-world assemblies name a sub-part (a reference axis, a datum, a part the CAD kernel
    // couldn't mesh) but give it no actual shape — skip those instead of creating a fake
    // placeholder component that shows nothing when inserted.
    if (!hasGeometry(child)) {
      skipped += 1;
      continue;
    }

    // Detach the child into its own standalone, un-parented object that carries its full world
    // transform baked into its own position/quaternion/scale (it has no parent any more, so its
    // "local" transform IS the world transform from here on).
    const worldMatrix = child.matrixWorld.clone();
    const standalone = child.clone(true);
    worldMatrix.decompose(standalone.position, standalone.quaternion, standalone.scale);
    standalone.updateMatrixWorld(true);

    const partName = child.name ? `${inst.name} – ${child.name}` : `${inst.name} – parte ${idx}`;
    saved.push(await saveGroupAsLibraryComponent(partName, 'exploded', standalone));
  }

  if (saved.length === 0) {
    throw new Error('Nenhuma das sub-partes tem geometria própria (podem ser referências/metadados sem forma) — nada para explodir.');
  }

  doc.checkpoint();
  const newInstances = saved.map(({ meta, worldAnchor }) =>
    doc.addPlacedComponent({
      libraryId: meta.id,
      name: meta.name,
      position: { x: worldAnchor.x, y: worldAnchor.z, z: worldAnchor.y },
      rotationZ: 0,
      scale: 1,
      width: meta.width,
      depth: meta.depth,
      height: meta.height,
    }),
  );

  doc.removePlacedComponent(inst.id);
  doc.setSelection(newInstances.map((i) => i.id));
  return { instances: newInstances, skipped };
}
