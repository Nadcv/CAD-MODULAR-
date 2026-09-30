import { getPrices, setPrice, priceLabels } from '../core/pricing';

/** Configurable R$/m² used by the BOM/PDF cost estimate (io/bom.ts) — persisted in localStorage
 * (a price list is a user preference, not project data, so it isn't part of the document/undo
 * history and carries over between projects). */
export class PricingPanel {
  private root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'panel pricing-panel';
    container.appendChild(this.root);
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = 'Preços (R$/m²)';
    this.root.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Usado pra estimar custo na lista de materiais e no PDF. Fica salvo neste navegador.';
    this.root.appendChild(hint);

    const prices = getPrices();
    for (const { key, label } of priceLabels()) {
      const row = document.createElement('label');
      row.className = 'field-row';
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      input.value = String(prices[key] ?? 0);
      input.addEventListener('change', () => setPrice(key, parseFloat(input.value) || 0));
      row.append(span, input);
      this.root.appendChild(row);
    }
  }
}
