import type { CadDocument } from '../core/Document';
import type { PriceTable } from '../core/pricing';

export interface BomRow {
  category: 'Módulo' | 'Componente 3D' | 'Parede';
  name: string;
  quantity: number;
  width: number;
  depth: number;
  height: number;
  /** Finish id (view3d/materials.ts) — only set for 'Módulo' rows, used to look up its price. */
  material?: string;
}

/**
 * Aggregates the project into a bill-of-materials: one row per distinct (name, dimensions,
 * material) combination, with a quantity count — e.g. 3 identical "Armário base 60" instances
 * become one row with quantity 3, useful for ordering material instead of listing every instance
 * separately.
 */
export function generateBom(doc: CadDocument): BomRow[] {
  const rows = new Map<string, BomRow>();

  const addRow = (category: BomRow['category'], name: string, width: number, depth: number, height: number, material?: string): void => {
    const key = `${category}:${name}:${width.toFixed(3)}:${depth.toFixed(3)}:${height.toFixed(3)}:${material ?? ''}`;
    const existing = rows.get(key);
    if (existing) existing.quantity += 1;
    else rows.set(key, { category, name, quantity: 1, width, depth, height, material });
  };

  for (const mod of doc.modules.values()) {
    addRow('Módulo', mod.name, mod.width, mod.depth, mod.height, mod.material ?? 'solid');
  }
  for (const inst of doc.placedComponents.values()) {
    addRow('Componente 3D', inst.name, inst.width * inst.scale, inst.depth * inst.scale, inst.height * inst.scale);
  }
  for (const wall of doc.walls.values()) {
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    addRow('Parede', 'Parede', length, wall.thickness, wall.height);
  }

  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/**
 * Rough cost estimate for one BOM row: (width × height, a stand-in for panel/wall face area) ×
 * R$/m² for its material × quantity. A real quote needs a lot more (cut optimization, edge
 * banding, hardware, labor) — this is meant as a ballpark, not a final number.
 */
export function estimateRowCost(row: BomRow, prices: PriceTable): number {
  const priceKey = row.category === 'Módulo' ? (row.material ?? 'solid') : 'default';
  const pricePerM2 = prices[priceKey] ?? prices.default ?? 0;
  return row.width * row.height * pricePerM2 * row.quantity;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with a semicolon delimiter — opens correctly pre-formatted in locales (e.g. pt-BR) where
 * Excel/LibreOffice treat comma as the decimal separator instead of a field delimiter.
 * `prices`, if given, adds unit/total cost columns and a grand-total row at the end. */
export function bomToCsv(rows: BomRow[], prices?: PriceTable): string {
  const header = ['Categoria', 'Nome', 'Quantidade', 'Largura (m)', 'Profundidade (m)', 'Altura (m)'];
  if (prices) header.push('Preço estimado (R$)');
  const lines = rows.map((r) => {
    const cells = [r.category, csvCell(r.name), String(r.quantity), r.width.toFixed(3), r.depth.toFixed(3), r.height.toFixed(3)];
    if (prices) cells.push(estimateRowCost(r, prices).toFixed(2));
    return cells.join(';');
  });
  if (prices) {
    const total = rows.reduce((sum, r) => sum + estimateRowCost(r, prices), 0);
    lines.push(['', '', '', '', '', 'Total estimado', total.toFixed(2)].join(';'));
  }
  return [header.join(';'), ...lines].join('\n');
}
