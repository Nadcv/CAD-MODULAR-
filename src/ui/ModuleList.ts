import type { CadDocument } from '../core/Document';

/** Left-hand list of masters (reusable blocks) + all module instances in the drawing. */
export class ModuleList {
  private root: HTMLElement;
  private doc: CadDocument;

  constructor(container: HTMLElement, doc: CadDocument) {
    this.doc = doc;
    this.root = document.createElement('div');
    this.root.className = 'panel module-list';
    container.appendChild(this.root);

    doc.events.on('change', () => this.render());
    doc.events.on('selectionChange', () => this.render());
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';

    const mastersTitle = document.createElement('h3');
    mastersTitle.textContent = 'Módulos reutilizáveis';
    this.root.appendChild(mastersTitle);

    if (this.doc.masters.size === 0) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Nenhum ainda. Selecione um módulo e clique "Tornar reutilizável".';
      this.root.appendChild(hint);
    }

    for (const master of this.doc.masters.values()) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = master.color;
      const label = document.createElement('span');
      label.textContent = `${master.name} (${master.width.toFixed(2)}×${master.depth.toFixed(2)}×${master.height.toFixed(2)}m)`;
      const insertBtn = document.createElement('button');
      insertBtn.textContent = '+ inserir';
      insertBtn.addEventListener('click', () => {
        this.doc.checkpoint();
        const inst = this.doc.instantiateMaster(master.id, { x: 0, y: 0, z: 0 });
        if (inst) this.doc.setSelection([inst.id]);
      });
      row.append(swatch, label, insertBtn);
      this.root.appendChild(row);
    }

    const instancesTitle = document.createElement('h3');
    instancesTitle.textContent = `Módulos no desenho (${this.doc.modules.size})`;
    this.root.appendChild(instancesTitle);

    for (const mod of this.doc.modules.values()) {
      const row = document.createElement('div');
      row.className = 'list-row' + (this.doc.selectedIds.has(mod.id) ? ' selected' : '');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = mod.color;
      const label = document.createElement('span');
      label.textContent = mod.name;
      row.append(swatch, label);
      row.addEventListener('click', () => this.doc.setSelection([mod.id]));
      this.root.appendChild(row);
    }

    if (this.doc.placedComponents.size > 0) {
      const componentsTitle = document.createElement('h3');
      componentsTitle.textContent = `Componentes 3D no desenho (${this.doc.placedComponents.size})`;
      this.root.appendChild(componentsTitle);

      for (const inst of this.doc.placedComponents.values()) {
        const row = document.createElement('div');
        row.className = 'list-row' + (this.doc.selectedIds.has(inst.id) ? ' selected' : '');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = '#c060ff';
        const label = document.createElement('span');
        label.textContent = inst.name;
        row.append(swatch, label);
        row.addEventListener('click', () => this.doc.setSelection([inst.id]));
        this.root.appendChild(row);
      }
    }
  }
}
