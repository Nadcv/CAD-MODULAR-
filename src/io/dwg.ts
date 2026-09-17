import type { Dwg_File_Type as Dwg_File_TypeT, LibreDwg as LibreDwgT } from '@mlightcad/libredwg-web';
import type { DwgArcEntity, DwgCircleEntity, DwgLineEntity, DwgLWPolylineEntity } from '@mlightcad/libredwg-web';
import type { DxfEntity } from '../core/types';

export function isDwgFile(filename: string): boolean {
  return /\.dwg$/i.test(filename);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WasmInstance = any;

let libredwgPromise: Promise<{ libredwg: LibreDwgT; Dwg_File_Type: typeof Dwg_File_TypeT }> | undefined;

/**
 * Lazy-loads LibreDWG (the class, the enum, and the raw ~10MB WASM module) only when a .dwg file
 * is actually imported — otherwise every visitor's initial page load would pay for it up front,
 * the same reason STEP/IGES support in step.ts is dynamically imported too.
 */
async function getLibreDwg(): Promise<{ libredwg: LibreDwgT; Dwg_File_Type: typeof Dwg_File_TypeT }> {
  if (!libredwgPromise) {
    libredwgPromise = (async () => {
      const [{ LibreDwg, Dwg_File_Type }, { default: createLibreDwgWasm }] = await Promise.all([
        import('@mlightcad/libredwg-web'),
        // Vendored copy of @mlightcad/libredwg-web's raw Emscripten module factory. We can't import
        // it directly from the package (its package.json `exports` only exposes the root entry
        // point, not the `wasm/` subpath) — a copy lives in src/vendor/, see its header comment.
        // The matching .wasm binary is copied to public/libredwg-web.wasm as a static asset.
        import('../vendor/libredwg-web.js'),
      ]);
      const wasmUrl = `${import.meta.env.BASE_URL}libredwg-web.wasm`;
      const wasmInstance: WasmInstance = await createLibreDwgWasm({ locateFile: () => wasmUrl });
      const libredwg = LibreDwg.createByWasmInstance(wasmInstance);
      return { libredwg, Dwg_File_Type };
    })();
  }
  return libredwgPromise;
}

/**
 * DWG is Autodesk's proprietary binary format, but GNU LibreDWG (GPL-3.0) is a real, actively
 * maintained free implementation — compiled to WebAssembly by the @mlightcad/libredwg-web package
 * (~10MB, lazy-loaded only when a .dwg is actually imported). This is best-effort: LibreDWG's DWG
 * read support varies by AutoCAD version and entity type, so a given file may parse partially or
 * fail outright — errors are surfaced clearly rather than producing silently wrong geometry.
 */
export async function parseDwgToEntities(file: File): Promise<DxfEntity[]> {
  let libredwg: LibreDwgT;
  let Dwg_File_Type: typeof Dwg_File_TypeT;
  try {
    ({ libredwg, Dwg_File_Type } = await getLibreDwg());
  } catch (err) {
    throw new Error(`Não foi possível carregar o motor LibreDWG (WASM): ${(err as Error).message}`);
  }

  const buffer = await file.arrayBuffer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dwg: any;
  try {
    dwg = libredwg.dwg_read_data(buffer, Dwg_File_Type.DWG);
  } catch (err) {
    throw new Error(`Falha ao ler o ficheiro .dwg: ${(err as Error).message}`);
  }
  if (!dwg) {
    throw new Error('Falha ao ler o ficheiro .dwg — pode estar corrompido ou usar uma variante não suportada pela LibreDWG.');
  }

  try {
    const db = libredwg.convert(dwg);
    const entities: DxfEntity[] = [];
    for (const e of db.entities) {
      if (e.type === 'LINE') {
        const line = e as DwgLineEntity;
        entities.push({ kind: 'line', from: [line.startPoint.x, line.startPoint.y], to: [line.endPoint.x, line.endPoint.y] });
      } else if (e.type === 'CIRCLE') {
        const circle = e as DwgCircleEntity;
        entities.push({ kind: 'circle', center: [circle.center.x, circle.center.y], radius: circle.radius });
      } else if (e.type === 'ARC') {
        // LibreDWG's angles are already in radians (read straight from the binary format).
        const arc = e as DwgArcEntity;
        entities.push({ kind: 'arc', center: [arc.center.x, arc.center.y], radius: arc.radius, startAngle: arc.startAngle, endAngle: arc.endAngle });
      } else if (e.type === 'LWPOLYLINE') {
        const poly = e as DwgLWPolylineEntity;
        entities.push({
          kind: 'polyline',
          points: poly.vertices.map((v) => [v.x, v.y] as [number, number]),
          closed: (poly.flag & 1) === 1,
        });
      } else if (e.type === 'POLYLINE') {
        const poly = e as unknown as { vertices?: { point?: { x: number; y: number } }[]; flag?: number };
        if (poly.vertices) {
          entities.push({
            kind: 'polyline',
            points: poly.vertices.filter((v) => v.point).map((v) => [v.point!.x, v.point!.y] as [number, number]),
            closed: ((poly.flag ?? 0) & 1) === 1,
          });
        }
      }
    }
    if (entities.length === 0) {
      throw new Error(
        'O ficheiro foi lido, mas nenhuma entidade compatível (linha/polilinha/círculo/arco) foi encontrada — pode conter só blocos, texto ou outros tipos ainda não mapeados.',
      );
    }
    return entities;
  } finally {
    libredwg.dwg_free(dwg);
  }
}
