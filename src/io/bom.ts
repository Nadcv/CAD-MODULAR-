import type { CadDocument } from '../core/Document';

export interface BomRow {
  category: 'Módulo' | 'Componente 3D' | 'Parede';
  name: string;
  quantity: number;
  width: number;
  depth: number;
  height: number;
}

/**
 * Aggregates the project into a bill-of-materials: one row per distinct (name, dimensions)
 * combination, with a quantity count — e.g. 3 identical "Armário base 60" instances become one
 * row with quantity 3, useful for ordering material instead of listing every instance separately.
 */
export function generateBom(doc: CadDocument): BomRow[] {
  const rows = new Map<string, BomRow>();

  const addRow = (category: BomRow['category'], name: string, width: number, depth: number, height: number): void => {
    const key = `${category}:${name}:${width.toFixed(3)}:${depth.toFixed(3)}:${height.toFixed(3)}`;
    const existing = rows.get(key);
    if (existing) existing.quantity += 1;
    else rows.set(key, { category, name, quantity: 1, width, depth, height });
  };

  for (const mod of doc.modules.values()) {
    addRow('Módulo', mod.name, mod.width, mod.depth, mod.height);
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

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with a semicolon delimiter — opens correctly pre-formatted in locales (e.g. pt-BR) where
 * Excel/LibreOffice treat comma as the decimal separator instead of a field delimiter. */
export function bomToCsv(rows: BomRow[]): string {
  const header = ['Categoria', 'Nome', 'Quantidade', 'Largura (m)', 'Profundidade (m)', 'Altura (m)'];
  const lines = rows.map((r) =>
    [r.category, csvCell(r.name), String(r.quantity), r.width.toFixed(3), r.depth.toFixed(3), r.height.toFixed(3)].join(';'),
  );
  return [header.join(';'), ...lines].join('\n');
}
