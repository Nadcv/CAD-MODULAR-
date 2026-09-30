import { MATERIAL_FINISHES } from '../view3d/materials';

const STORAGE_KEY = 'cad-modular-prices-v1';

/** R$/m², keyed by material finish id (view3d/materials.ts) plus 'default' for anything without
 * a specific finish (placed 3D components, walls). A price list is a user preference, not
 * project data — it lives in localStorage, not the document/undo history, and carries over
 * between projects (the same person tends to price the same way across jobs). */
export type PriceTable = Record<string, number>;

const DEFAULT_PRICES: PriceTable = {
  default: 120,
  solid: 90,
  oak: 180,
  'white-oak': 190,
  walnut: 260,
  wenge: 240,
};

export function getPrices(): PriceTable {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_PRICES, ...(JSON.parse(saved) as PriceTable) };
  } catch {
    // localStorage unavailable or corrupted value — fall back to defaults.
  }
  return { ...DEFAULT_PRICES };
}

export function setPrice(key: string, value: number): void {
  const prices = getPrices();
  prices[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prices));
  } catch {
    // storage unavailable/full — the price just won't persist past this session.
  }
}

/** {key, label} pairs for every row the pricing UI should show, in a stable order. */
export function priceLabels(): { key: string; label: string }[] {
  return [{ key: 'default', label: 'Outros (componentes 3D, paredes)' }, ...MATERIAL_FINISHES.map((f) => ({ key: f.id, label: f.label }))];
}
