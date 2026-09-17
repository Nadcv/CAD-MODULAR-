import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CadDocument } from '../core/Document';
import { nextId } from '../core/Document';
import type { LibraryComponentMeta, PlacedComponentDef } from '../core/types';
import { saveComponent } from '../core/componentLibrary';
import { loadMeshGroup, loadLibraryComponentGroup, formatFromFilename } from './mesh';
import { loadStepOrIgesGeometry } from './step';
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
    const geometry = await loadStepOrIgesGeometry(file);
    group = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.1, roughness: 0.8 }));
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
function findExplodableParts(root: THREE.Object3D): THREE.Object3D[] {
  let node = root;
  while (node.children.length === 1) node = node.children[0];
  return node.children;
}

/**
 * "Explode" a placed component one level deep: each of its top-level sub-parts (e.g. a multi-body
 * assembly's individual bodies) becomes its own independent library component + placed instance,
 * positioned/rotated exactly where it visually sat inside the original — and the combined instance
 * is removed. Mirrors AutoCAD's EXPLODE: one level per call: run it again on a result to go deeper.
 * Throws if the component has no more than one top-level part (nothing to explode).
 */
export async function explodeComponent(doc: CadDocument, inst: PlacedComponentDef): Promise<PlacedComponentDef[]> {
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

  doc.checkpoint();
  const newInstances: PlacedComponentDef[] = [];
  let idx = 0;
  for (const child of parts) {
    idx += 1;
    // Detach the child into its own standalone, un-parented object that carries its full world
    // transform baked into its own position/quaternion/scale (it has no parent any more, so its
    // "local" transform IS the world transform from here on).
    const worldMatrix = child.matrixWorld.clone();
    const standalone = child.clone(true);
    worldMatrix.decompose(standalone.position, standalone.quaternion, standalone.scale);
    standalone.updateMatrixWorld(true);

    const partName = child.name ? `${inst.name} – ${child.name}` : `${inst.name} – parte ${idx}`;
    const { meta, worldAnchor } = await saveGroupAsLibraryComponent(partName, 'exploded', standalone);

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
    newInstances.push(newInst);
  }

  doc.removePlacedComponent(inst.id);
  doc.setSelection(newInstances.map((i) => i.id));
  return newInstances;
}
