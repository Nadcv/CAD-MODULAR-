import * as THREE from 'three';

export interface MaterialFinish {
  id: string;
  label: string;
  kind: 'solid' | 'wood';
  /** Base tone. For 'wood', also the canvas fill color; for 'solid', unused (module.color rules). */
  base: string;
  /** Grain line color — only meaningful for 'wood'. */
  grain?: string;
}

/** "Cor sólida" keeps today's behavior (module.color drives the material directly); the rest are
 * procedural wood finishes — no external image assets, so importing/exporting a project never
 * depends on a texture file that might go missing. */
export const MATERIAL_FINISHES: MaterialFinish[] = [
  { id: 'solid', label: 'Cor sólida', kind: 'solid', base: '#5b8cff' },
  { id: 'oak', label: 'Carvalho', kind: 'wood', base: '#c9a06a', grain: '#8a5a2f' },
  { id: 'white-oak', label: 'Carvalho branco', kind: 'wood', base: '#e4d3b0', grain: '#b89a6a' },
  { id: 'walnut', label: 'Nogueira', kind: 'wood', base: '#5a3a26', grain: '#2c1a10' },
  { id: 'wenge', label: 'Wengué (escuro)', kind: 'wood', base: '#2b211d', grain: '#140f0c' },
];

export function getFinish(id: string | undefined): MaterialFinish {
  return MATERIAL_FINISHES.find((f) => f.id === id) ?? MATERIAL_FINISHES[0];
}

/** Small deterministic PRNG (LCG) so the same finish always generates the same grain pattern —
 * two modules with the same wood finish look consistent rather than each getting random noise. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function generateWoodCanvas(base: string, grain: string): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const rand = makeRng(1234567);
  ctx.strokeStyle = grain;
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const y0 = rand() * size;
    ctx.globalAlpha = 0.06 + rand() * 0.22;
    ctx.lineWidth = 0.5 + rand() * 2.2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    let y = y0;
    for (let x = 0; x <= size; x += 16) {
      y += (rand() - 0.5) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

const textureCache = new Map<string, THREE.Texture>();

function getBaseTexture(finish: MaterialFinish): THREE.Texture | undefined {
  if (finish.kind !== 'wood') return undefined;
  const cached = textureCache.get(finish.id);
  if (cached) return cached;
  const texture = new THREE.CanvasTexture(generateWoodCanvas(finish.base, finish.grain!));
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(finish.id, texture);
  return texture;
}

/**
 * Builds a MeshStandardMaterial for a module's current finish. `width`/`height` (meters) scale
 * the grain repeat so a 2m tall panel doesn't show the same tiny tile as a 0.1m drawer front —
 * each caller gets its own cloned texture (repeat/offset differ per mesh) sharing the same
 * underlying generated image.
 */
export function buildModuleMaterial(materialId: string | undefined, color: string, width: number, height: number): THREE.MeshStandardMaterial {
  const finish = getFinish(materialId);
  const base = getBaseTexture(finish);
  if (!base) {
    return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.7 });
  }
  const map = base.clone();
  map.needsUpdate = true;
  map.repeat.set(Math.max(1, width / 0.3), Math.max(1, height / 0.3));
  return new THREE.MeshStandardMaterial({ map, metalness: 0.05, roughness: 0.75 });
}
