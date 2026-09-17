import * as THREE from 'three';

/**
 * STEP/IGES import via opencascade.js (a WebAssembly port of the OpenCascade CAD kernel).
 *
 * This is best-effort/experimental: there is no free, reliable pure-JS STEP/IGES parser, and
 * opencascade.js ships ~65MB of WASM with an API surface that isn't fully typed. We lazy-load it
 * (only when the user actually imports a STEP/IGES file) and tessellate the resulting shape into
 * a triangle mesh for display. If a given file or opencascade.js API shape isn't supported, we
 * surface a clear error rather than silently failing.
 */

// oc's embind API isn't published with TS types, and its exact overload-suffix naming
// (e.g. `STEPControl_Reader_1`) is only knowable at runtime — hence `any` here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OC = any;

let ocPromise: Promise<OC> | undefined;

async function getOC(): Promise<OC> {
  if (!ocPromise) {
    ocPromise = (async () => {
      const [{ default: initOpenCascade }, wasmUrlModule] = await Promise.all([
        import('opencascade.js/dist/opencascade.wasm.js'),
        import('opencascade.js/dist/opencascade.wasm.wasm?url'),
      ]);
      const wasmUrl = (wasmUrlModule as { default: string }).default;
      return initOpenCascade({ locateFile: () => wasmUrl });
    })();
  }
  return ocPromise;
}

function isIges(filename: string): boolean {
  return /\.(igs|iges)$/i.test(filename);
}

/** Walks every face of a shape, tessellates it, and merges the triangles into one BufferGeometry. */
function shapeToGeometry(oc: OC, shape: OC): THREE.BufferGeometry {
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.3, false, 0.5, false);

  const positions: number[] = [];
  const normals: number[] = [];
  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  for (; explorer.More(); explorer.Next()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const location = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(face, location, 0 /* Poly_MeshPurpose_NONE */);
    if (triHandle.IsNull()) continue;
    const tri = triHandle.get();

    const trsf = location.Transformation();
    const nbNodes = tri.NbNodes();
    const nodeCache: THREE.Vector3[] = new Array(nbNodes + 1);
    for (let i = 1; i <= nbNodes; i++) {
      const p = tri.Node(i).Transformed(trsf);
      nodeCache[i] = new THREE.Vector3(p.X(), p.Y(), p.Z());
    }

    const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const nbTriangles = tri.NbTriangles();
    for (let i = 1; i <= nbTriangles; i++) {
      const t = tri.Triangle(i);
      let a = t.Value(1);
      let b = t.Value(2);
      let c = t.Value(3);
      if (reversed) [a, c] = [c, a];
      const pa = nodeCache[a];
      const pb = nodeCache[b];
      const pc = nodeCache[c];
      positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, pc.x, pc.y, pc.z);
      const normal = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa)).normalize();
      normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/**
 * Reads a STEP/IGES file and tessellates it into a single triangle mesh geometry. The caller
 * (io/component.ts) is responsible for turning that into a document entity — this module only
 * knows how to talk to the OpenCascade kernel.
 */
export async function loadStepOrIgesGeometry(file: File): Promise<THREE.BufferGeometry> {
  let oc: OC;
  try {
    oc = await getOC();
  } catch (err) {
    throw new Error(
      `Não foi possível carregar o motor OpenCascade (WASM, ~65MB) — verifique a ligação à internet. Detalhe: ${(err as Error).message}`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const virtualPath = `/${file.name}`;
  oc.FS.writeFile(virtualPath, bytes);

  try {
    const reader = isIges(file.name) ? new oc.IGESControl_Reader_1() : new oc.STEPControl_Reader_1();
    const status = reader.ReadFile(virtualPath);
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`Leitura do ficheiro falhou (status ${status}). O ficheiro pode estar corrompido ou usar um dialeto não suportado.`);
    }
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const shape = reader.OneShape();
    const geometry = shapeToGeometry(oc, shape);
    geometry.computeBoundingBox();
    return geometry;
  } finally {
    try {
      oc.FS.unlink(virtualPath);
    } catch {
      // best-effort cleanup of the in-memory FS
    }
  }
}
