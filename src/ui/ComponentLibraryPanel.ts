import type { CadDocument } from '../core/Document';
import { listComponents, deleteComponent } from '../core/componentLibrary';
import type { LibraryComponentMeta } from '../core/types';

/**
 * Panel for the persistent 3D component library (IndexedDB) — imported STEP/IGES/STL/OBJ/glTF
 * files (e.g. Danfoss product models) land here once and can be re-inserted into any project
 * afterwards without re-importing the source file.
 */
export class ComponentLibraryPanel {
  private root: HTMLElement;
  private doc: CadDocument;
  private items: LibraryComponentMeta[] = [];

  constructor(container: HTMLElement, doc: CadDocument) {
    this.doc = doc;
    this.root = document.createElement('div');
    this.root.className = 'panel component-library';
    container.appendChild(this.root);
    this.refresh();
  }

  /** Call after importFileAsComponent() adds something new, so the list picks it up. */
  async refresh(): Promise<void> {
    try {
      this.items = await listComponents();
    } catch {
      this.items = [];
    }
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Componentes 3D';
    this.root.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Arquivos STEP/IGES/STL/OBJ/glTF importados (ex: peças da Danfoss) ficam salvos aqui — reaproveite sem reimportar.';
    this.root.appendChild(hint);

    if (this.items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Vazio. Use "Importar componente 3D..." na toolbar.';
      this.root.appendChild(empty);
      return;
    }

    for (const item of this.items) {
      const row = document.createElement('div');
      row.className = 'list-row component-row';

      const info = document.createElement('span');
      info.className = 'component-info';
      info.textContent = `${item.name} (${item.sourceFormat.toUpperCase()}, ${item.width.toFixed(2)}×${item.depth.toFixed(2)}×${item.height.toFixed(2)}m)`;
      row.appendChild(info);

      const insertBtn = document.createElement('button');
      insertBtn.textContent = '+ inserir';
      insertBtn.addEventListener('click', () => {
        this.doc.checkpoint();
        const inst = this.doc.addPlacedComponent({
          libraryId: item.id,
          name: item.name,
          position: { x: 0, y: 0, z: 0 },
          rotationZ: 0,
          scale: 1,
          width: item.width,
          depth: item.depth,
          height: item.height,
        });
        this.doc.setSelection([inst.id]);
      });
      row.appendChild(insertBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = 'Remover da biblioteca (instâncias já colocadas no projeto continuam, mas não poderão ser reinseridas)';
      delBtn.className = 'danger';
      delBtn.addEventListener('click', async () => {
        await deleteComponent(item.id);
        await this.refresh();
      });
      row.appendChild(delBtn);

      this.root.appendChild(row);
    }
  }
}
