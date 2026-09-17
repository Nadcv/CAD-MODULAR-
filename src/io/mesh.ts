import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CadDocument } from '../core/Document';
import { loadComponentGlb } from '../core/componentLibrary';

export type MeshFormat = 'stl' | 'obj' | 'gltf' | 'glb';

export function formatFromFilename(name: string): MeshFormat | undefined {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'stl') return 'stl';
  if (ext === 'obj') return 'obj';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'glb') return 'glb';
  return undefined;
}

/**
 * Parses an STL/OBJ/glTF/GLB file into a single three.js object, preserving whatever multi-part
 * structure the file already had (e.g. a multi-body glTF assembly stays one group with several
 * meshes/materials, instead of being flattened into unrelated pieces).
 */
export async function loadMeshGroup(file: File): Promise<THREE.Object3D> {
  const format = formatFromFilename(file.name);
  if (!format) throw new Error(`Formato não suportado: ${file.name}`);

  if (format === 'stl') {
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.1, roughness: 0.8 }));
  }

  if (format === 'obj') {
    const text = await file.text();
    return new OBJLoader().parse(text);
  }

  // gltf / glb
  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(buffer, '', (result) => resolve(result), (err) => reject(err));
  });
  return gltf.scene;
}

/** Loads a previously-imported component back from the persistent library, by its library id. */
export async function loadLibraryComponentGroup(libraryId: string): Promise<THREE.Object3D> {
  const glb = await loadComponentGlb(libraryId);
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(glb, '', (result) => resolve(result), (err) => reject(err));
  });
  return gltf.scene;
}

async function buildExportGroup(doc: CadDocument): Promise<THREE.Group> {
  const group = new THREE.Group();
  for (const m of doc.modules.values()) {
    const geometry = new THREE.BoxGeometry(m.width, m.height, m.depth);
    geometry.translate(m.width / 2, m.height / 2, m.depth / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: m.color }));
    mesh.position.set(m.position.x, m.position.z, m.position.y);
    mesh.rotation.set(0, -m.rotationZ, 0);
    mesh.name = m.name;
    group.add(mesh);
  }
  for (const wall of doc.walls.values()) {
    const dx = wall.end[0] - wall.start[0];
    const dy = wall.end[1] - wall.start[1];
    const length = Math.max(0.01, Math.hypot(dx, dy));
    const geometry = new THREE.BoxGeometry(length, wall.height, wall.thickness);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: wall.color }));
    mesh.position.set((wall.start[0] + wall.end[0]) / 2, wall.height / 2, (wall.start[1] + wall.end[1]) / 2);
    mesh.rotation.set(0, -Math.atan2(dy, dx), 0);
    mesh.name = 'Parede';
    group.add(mesh);
  }
  for (const inst of doc.placedComponents.values()) {
    try {
      const obj = await loadLibraryComponentGroup(inst.libraryId);
      obj.position.set(inst.position.x, inst.position.z, inst.position.y);
      obj.rotation.set(0, -inst.rotationZ, 0);
      obj.scale.setScalar(inst.scale);
      obj.name = inst.name;
      group.add(obj);
    } catch {
      // component removed from the library since it was placed — skip it rather than fail the export
    }
  }
  return group;
}

export async function exportToStl(doc: CadDocument): Promise<string> {
  return new STLExporter().parse(await buildExportGroup(doc));
}

export async function exportToObj(doc: CadDocument): Promise<string> {
  return new OBJExporter().parse(await buildExportGroup(doc));
}

export async function exportToGltf(doc: CadDocument): Promise<ArrayBuffer | object> {
  const exporter = new GLTFExporter();
  const group = await buildExportGroup(doc);
  return new Promise((resolve, reject) => {
    exporter.parse(group, (result) => resolve(result), (err) => reject(err), { binary: false });
  });
}
