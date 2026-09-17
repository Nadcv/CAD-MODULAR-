import * as THREE from 'three';

/**
 * STEP/IGES import via occt-import-js — a WebAssembly build of OpenCascade purpose-built for CAD
 * file import (as opposed to a generic OCCT binding), ~7.6MB, lazy-loaded only when a STEP/IGES
 * file is actually imported. Verified against real STEP files (a simple cube and a full CAX-IF
 * multi-part assembly with named sub-parts) — see the io/step.ts git history for how an earlier
 * attempt with a different WASM binding (opencascade.js) turned out to have broken/incomplete
 * STEP-schema support and was replaced with this one.
 */

// occt-import-js ships no TypeScript types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Occt = any;

let occtPromise: Promise<Occt> | undefined;

async function getOcct(): Promise<Occt> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: initOcctImportJs }, wasmUrlModule] = await Promise.all([
        import('occt-import-js/dist/occt-import-js.js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      const wasmUrl = (wasmUrlModule as { default: string }).default;
      return initOcctImportJs({ locateFile: () => wasmUrl });
    })();
  }
  return occtPromise;
}

function isIges(filename: string): boolean {
  return /\.(igs|iges)$/i.test(filename);
}

interface OcctMesh {
  name: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
}

interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

/** Rebuilds occt-import-js's result tree as a THREE.Object3D hierarchy, preserving part names —
 * so a multi-part assembly (e.g. a valve with several bodies) keeps its structure and can later
 * be "exploded" into its named sub-parts (see io/component.ts). */
function buildGroup(node: OcctNode, meshes: OcctMesh[]): THREE.Object3D {
  const group = new THREE.Group();
  group.name = node.name;
  for (const idx of node.meshes) {
    const m = meshes[idx];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(m.index.array);
    const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0x8899aa);
    const material = new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = m.name || node.name;
    group.add(mesh);
  }
  for (const child of node.children) {
    group.add(buildGroup(child, meshes));
  }
  return group;
}

/**
 * Reads a STEP/IGES file into a THREE.Object3D, in meters (occt-import-js handles the unit
 * conversion from whatever the file's own header declares — mm is the common CAD default).
 */
export async function loadStepOrIgesGroup(file: File): Promise<THREE.Object3D> {
  let occt: Occt;
  try {
    occt = await getOcct();
  } catch (err) {
    throw new Error(`Não foi possível carregar o motor de importação STEP/IGES (WASM): ${(err as Error).message}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const readFile = isIges(file.name) ? occt.ReadIgesFile : occt.ReadStepFile;
  const result = readFile(bytes, { linearUnit: 'meter' });

  if (!result.success) {
    throw new Error('Leitura do ficheiro falhou — pode estar corrompido ou usar um recurso não suportado.');
  }
  if (!result.meshes || result.meshes.length === 0) {
    throw new Error(
      'O ficheiro foi lido, mas nenhuma malha foi gerada — pode conter só metadados, ou referenciar arquivos externos que não foram incluídos na importação.',
    );
  }

  return buildGroup(result.root, result.meshes);
}
