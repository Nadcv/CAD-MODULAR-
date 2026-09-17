import type { CadDocument } from '../core/Document';
import type { ModuleDef, PlacedComponentDef } from '../core/types';
import { explodeComponent } from '../io/component';

/** Right-hand panel: shows and edits the numeric fields of the currently selected module(s). */
export class PropertiesPanel {
  private root: HTMLElement;
  private doc: CadDocument;
  private setStatus: (msg: string, isError?: boolean) => void;
  private onLibraryChanged: () => void;

  constructor(
    container: HTMLElement,
    doc: CadDocument,
    setStatus: (msg: string, isError?: boolean) => void = () => {},
    onLibraryChanged: () => void = () => {},
  ) {
    this.doc = doc;
    this.setStatus = setStatus;
    this.onLibraryChanged = onLibraryChanged;
    this.root = document.createElement('div');
    this.root.className = 'panel properties-panel';
    container.appendChild(this.root);

    doc.events.on('selectionChange', () => this.render());
    doc.events.on('change', () => this.render());
    this.render();
  }

  private field(label: string, value: number, step: number, onChange: (v: number) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'field-row';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = value.toFixed(3);
    input.addEventListener('change', () => {
      this.doc.checkpoint();
      onChange(parseFloat(input.value) || 0);
    });
    row.append(span, input);
    return row;
  }

  private render(): void {
    this.root.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Propriedades';
    this.root.appendChild(title);

    const ids = [...this.doc.selectedIds];
    if (ids.length !== 1) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = ids.length === 0 ? 'Nenhum módulo selecionado.' : `${ids.length} módulos selecionados.`;
      this.root.appendChild(hint);
      return;
    }

    const mod = this.doc.modules.get(ids[0]);
    if (mod) {
      this.renderModule(mod);
      return;
    }
    const component = this.doc.placedComponents.get(ids[0]);
    if (component) this.renderComponent(component);
  }

  private renderComponent(inst: PlacedComponentDef): void {
    const nameRow = document.createElement('label');
    nameRow.className = 'field-row';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = 'Nome';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = inst.name;
    nameInput.addEventListener('change', () => {
      this.doc.checkpoint();
      this.doc.updatePlacedComponent(inst.id, { name: nameInput.value });
    });
    nameRow.append(nameSpan, nameInput);
    this.root.appendChild(nameRow);

    this.root.appendChild(
      this.field('Posição X (m)', inst.position.x, 0.01, (v) => this.doc.updatePlacedComponent(inst.id, { position: { ...inst.position, x: v } })),
    );
    this.root.appendChild(
      this.field('Posição Y (m)', inst.position.y, 0.01, (v) => this.doc.updatePlacedComponent(inst.id, { position: { ...inst.position, y: v } })),
    );
    this.root.appendChild(
      this.field('Posição Z (m)', inst.position.z, 0.01, (v) => this.doc.updatePlacedComponent(inst.id, { position: { ...inst.position, z: v } })),
    );
    this.root.appendChild(
      this.field('Rotação (graus)', (inst.rotationZ * 180) / Math.PI, 1, (v) =>
        this.doc.updatePlacedComponent(inst.id, { rotationZ: (v * Math.PI) / 180 }),
      ),
    );
    this.root.appendChild(this.field('Escala', inst.scale, 0.05, (v) => this.doc.updatePlacedComponent(inst.id, { scale: Math.max(0.01, v) })));

    const dims = document.createElement('p');
    dims.className = 'hint';
    dims.textContent = `Tamanho original: ${inst.width.toFixed(2)}×${inst.depth.toFixed(2)}×${inst.height.toFixed(2)}m (antes da escala)`;
    this.root.appendChild(dims);

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicar';
    dupBtn.addEventListener('click', () => {
      this.doc.checkpoint();
      const copy = this.doc.addPlacedComponent({ ...inst, id: undefined as unknown as string, position: { ...inst.position, x: inst.position.x + inst.width * inst.scale } });
      this.doc.setSelection([copy.id]);
    });

    const explodeBtn = document.createElement('button');
    explodeBtn.textContent = 'Explodir';
    explodeBtn.title = 'Separa as sub-partes deste componente em peças independentes, mantendo a posição visual de cada uma';
    explodeBtn.addEventListener('click', async () => {
      try {
        const parts = await explodeComponent(this.doc, inst);
        this.onLibraryChanged();
        this.setStatus(`Explodido em ${parts.length} partes.`);
      } catch (err) {
        this.setStatus((err as Error).message, true);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Remover';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => {
      this.doc.checkpoint();
      this.doc.removePlacedComponent(inst.id);
    });

    actions.append(dupBtn, explodeBtn, delBtn);
    this.root.appendChild(actions);
  }

  private renderModule(mod: ModuleDef): void {
    const nameRow = document.createElement('label');
    nameRow.className = 'field-row';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = 'Nome';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = mod.name;
    nameInput.addEventListener('change', () => {
      this.doc.checkpoint();
      this.doc.updateModule(mod.id, { name: nameInput.value });
    });
    nameRow.append(nameSpan, nameInput);
    this.root.appendChild(nameRow);

    this.root.appendChild(this.field('Largura (X, m)', mod.width, 0.01, (v) => this.doc.updateModule(mod.id, { width: Math.max(0.01, v) })));
    this.root.appendChild(this.field('Profundidade (Y, m)', mod.depth, 0.01, (v) => this.doc.updateModule(mod.id, { depth: Math.max(0.01, v) })));
    this.root.appendChild(this.field('Altura (Z, m)', mod.height, 0.01, (v) => this.doc.updateModule(mod.id, { height: Math.max(0.01, v) })));
    this.root.appendChild(this.field('Posição X (m)', mod.position.x, 0.01, (v) => this.doc.updateModule(mod.id, { position: { ...mod.position, x: v } })));
    this.root.appendChild(this.field('Posição Y (m)', mod.position.y, 0.01, (v) => this.doc.updateModule(mod.id, { position: { ...mod.position, y: v } })));
    this.root.appendChild(this.field('Posição Z (m)', mod.position.z, 0.01, (v) => this.doc.updateModule(mod.id, { position: { ...mod.position, z: v } })));
    this.root.appendChild(
      this.field('Rotação (graus)', (mod.rotationZ * 180) / Math.PI, 1, (v) => this.doc.updateModule(mod.id, { rotationZ: (v * Math.PI) / 180 })),
    );

    const colorRow = document.createElement('label');
    colorRow.className = 'field-row';
    const colorSpan = document.createElement('span');
    colorSpan.textContent = 'Cor';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = mod.color;
    let colorCheckpointed = false;
    colorInput.addEventListener('focus', () => {
      colorCheckpointed = false;
    });
    colorInput.addEventListener('input', () => {
      if (!colorCheckpointed) {
        this.doc.checkpoint();
        colorCheckpointed = true;
      }
      this.doc.updateModule(mod.id, { color: colorInput.value });
    });
    colorRow.append(colorSpan, colorInput);
    this.root.appendChild(colorRow);

    if (mod.masterId) {
      const masterHint = document.createElement('p');
      masterHint.className = 'hint';
      masterHint.textContent = 'Vinculado a um módulo mestre — dimensões/cor sincronizam com todas as instâncias.';
      this.root.appendChild(masterHint);
    }

    const actions = document.createElement('div');
    actions.className = 'panel-actions';

    const dupBtn = document.createElement('button');
    dupBtn.textContent = 'Duplicar';
    dupBtn.addEventListener('click', () => {
      this.doc.checkpoint();
      const copy = this.doc.duplicateModule(mod.id);
      if (copy) this.doc.setSelection([copy.id]);
    });

    const makeMasterBtn = document.createElement('button');
    makeMasterBtn.textContent = 'Tornar reutilizável';
    makeMasterBtn.title = 'Cria um módulo mestre a partir deste, para inserir várias cópias sincronizadas';
    makeMasterBtn.addEventListener('click', () => {
      this.doc.checkpoint();
      const master = this.doc.defineMaster({ name: mod.name, width: mod.width, depth: mod.depth, height: mod.height, color: mod.color });
      this.doc.updateModule(mod.id, { masterId: master.id });
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Excluir';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => {
      this.doc.checkpoint();
      this.doc.removeModule(mod.id);
    });

    actions.append(dupBtn, makeMasterBtn, delBtn);
    this.root.appendChild(actions);
  }
}
