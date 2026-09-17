import type { CadDocument } from '../core/Document';

interface Preset {
  name: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Height off the floor to place the first instance at (e.g. wall cabinets, windows). */
  z?: number;
}

const PRESETS: Preset[] = [
  { name: 'Armário base 40', width: 0.4, depth: 0.6, height: 0.75, color: '#5b8cff' },
  { name: 'Armário base 60', width: 0.6, depth: 0.6, height: 0.75, color: '#5b8cff' },
  { name: 'Armário base 80', width: 0.8, depth: 0.6, height: 0.75, color: '#5b8cff' },
  { name: 'Gaveteiro 40', width: 0.4, depth: 0.6, height: 0.75, color: '#7a5bff' },
  { name: 'Armário aéreo 60', width: 0.6, depth: 0.35, height: 0.7, color: '#4dc9ff', z: 1.45 },
  { name: 'Armário aéreo 80', width: 0.8, depth: 0.35, height: 0.7, color: '#4dc9ff', z: 1.45 },
  { name: 'Torre/coluna 60', width: 0.6, depth: 0.6, height: 2.1, color: '#3a6bd6' },
  { name: 'Bancada', width: 1.2, depth: 0.6, height: 0.04, color: '#c9a35b' },
  { name: 'Porta 80', width: 0.8, depth: 0.04, height: 2.1, color: '#a97c50' },
  { name: 'Janela 120', width: 1.2, depth: 0.04, height: 1.2, color: '#88c0ff', z: 0.9 },
];

/** Palette of common cabinetry/furniture presets — instantiated (and reused as masters) with one click. */
export class PresetLibrary {
  private root: HTMLElement;
  private doc: CadDocument;

  constructor(container: HTMLElement, doc: CadDocument) {
    this.doc = doc;
    this.root = document.createElement('div');
    this.root.className = 'panel preset-library';

    const title = document.createElement('h3');
    title.textContent = 'Biblioteca';
    this.root.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Clique para inserir. Reaproveita o mesmo módulo mestre em inserções repetidas.';
    this.root.appendChild(hint);

    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = `${preset.name} (${preset.width}×${preset.depth}×${preset.height}m)`;
      btn.addEventListener('click', () => this.insert(preset));
      this.root.appendChild(btn);
    }

    container.appendChild(this.root);
  }

  private insert(preset: Preset): void {
    this.doc.checkpoint();
    let master = [...this.doc.masters.values()].find((m) => m.name === preset.name);
    if (!master) {
      master = this.doc.defineMaster({ name: preset.name, width: preset.width, depth: preset.depth, height: preset.height, color: preset.color });
    }
    const inst = this.doc.instantiateMaster(master.id, { x: 0, y: 0, z: preset.z ?? 0 });
    if (inst) this.doc.setSelection([inst.id]);
  }
}
