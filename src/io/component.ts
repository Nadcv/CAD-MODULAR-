import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CadDocument } from '../core/Document';
import { nextId } from '../core/Document';
import type { LibraryComponentMeta, PlacedComponentDef } from '../core/types';
import { saveComponent } from '../core/componentLibrary';
import { loadMeshGroup, formatFromFilename } from './mesh';
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

  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);
  // Re-anchor so the component's footprint starts at its own local origin (matches how modules
  // are authored: position is the bottom-front-left corner, not an arbitrary import-time offset).
  group.position.sub(box.min);

  const glb = await exportGroupToGlb(group);

  const meta = await saveComponent(
    { id: nextId('lib'), name: file.name, sourceFormat, width: size.x || 0.01, depth: size.z || 0.01, height: size.y || 0.01 },
    glb,
  );

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
