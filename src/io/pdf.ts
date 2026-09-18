import type { CadDocument } from '../core/Document';
import type { Canvas2D } from '../view2d/Canvas2D';
import type { Scene3D } from '../view3d/Scene3D';
import { generateBom } from './bom';

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Não foi possível ler a imagem capturada da vista.'));
    img.src = dataUrl;
  });
}

function fitWithin(natural: { width: number; height: number }, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = Math.min(maxW / natural.width, maxH / natural.height);
  return { w: natural.width * ratio, h: natural.height * ratio };
}

/**
 * A one-page snapshot (2D plan + 3D view side by side) plus a bill-of-materials page — for
 * printing or sending to a client/marceneiro. Captures whatever is currently visible in each
 * view (current camera angle, zoom, pan), not a fixed/idealized render.
 */
export async function exportProjectToPdf(doc: CadDocument, canvas2d: Canvas2D, scene3D: Scene3D): Promise<Blob> {
  // jsPDF (~150KB, plus an html2canvas dependency it pulls in) is only needed for this one export
  // format — lazy-load it instead of paying that weight in the main bundle for every visitor.
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('CAD Modular — Projeto', margin, 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(130);
  pdf.text(new Date().toLocaleString('pt-BR'), margin, 20);
  pdf.setTextColor(0);

  const img2d = canvas2d.getSnapshotDataUrl();
  const img3d = scene3D.getSnapshotDataUrl();
  const [size2d, size3d] = await Promise.all([imageSize(img2d), imageSize(img3d)]);

  const colW = (pageW - margin * 3) / 2;
  const imgTop = 30;
  const imgMaxH = pageH - imgTop - margin;
  const fit2d = fitWithin(size2d, colW, imgMaxH);
  const fit3d = fitWithin(size3d, colW, imgMaxH);

  pdf.setFontSize(10);
  pdf.text('Planta 2D', margin, imgTop - 4);
  pdf.addImage(img2d, 'PNG', margin, imgTop, fit2d.w, fit2d.h);

  const col2X = margin * 2 + colW;
  pdf.text('Vista 3D', col2X, imgTop - 4);
  pdf.addImage(img3d, 'PNG', col2X, imgTop, fit3d.w, fit3d.h);

  // --- Bill of materials page ---
  pdf.addPage();
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text('Lista de materiais', margin, 16);
  pdf.setFont('helvetica', 'normal');

  const rows = generateBom(doc);
  const colX = { category: margin, name: margin + 32, qty: margin + 130, w: margin + 150, d: margin + 178, h: margin + 206 };
  let y = 26;

  const drawHeader = (): void => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('Categoria', colX.category, y);
    pdf.text('Nome', colX.name, y);
    pdf.text('Qtd', colX.qty, y);
    pdf.text('Larg (m)', colX.w, y);
    pdf.text('Prof (m)', colX.d, y);
    pdf.text('Alt (m)', colX.h, y);
    pdf.setFont('helvetica', 'normal');
    y += 4;
    pdf.setDrawColor(180);
    pdf.line(margin, y, pageW - margin, y);
    y += 5;
  };
  drawHeader();

  for (const row of rows) {
    if (y > pageH - margin) {
      pdf.addPage();
      y = 16;
      drawHeader();
    }
    const name = row.name.length > 45 ? `${row.name.slice(0, 42)}…` : row.name;
    pdf.text(row.category, colX.category, y);
    pdf.text(name, colX.name, y);
    pdf.text(String(row.quantity), colX.qty, y);
    pdf.text(row.width.toFixed(2), colX.w, y);
    pdf.text(row.depth.toFixed(2), colX.d, y);
    pdf.text(row.height.toFixed(2), colX.h, y);
    y += 6;
  }

  if (rows.length === 0) {
    pdf.setTextColor(140);
    pdf.text('Projeto vazio.', margin, y);
    pdf.setTextColor(0);
  }

  return pdf.output('blob');
}
