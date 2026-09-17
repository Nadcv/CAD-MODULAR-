/**
 * DWG is Autodesk's proprietary binary CAD format. There is no free, reliable, actively
 * maintained JavaScript/WASM library that reads it — real support requires either licensing the
 * Open Design Alliance's Teigha/ODA SDK, or shelling out to Autodesk's own tools. Silently
 * "supporting" DWG by guessing at the binary format would produce corrupted/garbage geometry, so
 * instead we detect the file and explain the options clearly.
 */
export class UnsupportedDwgError extends Error {
  constructor() {
    super(
      'Ficheiros .dwg não podem ser abertos diretamente: é um formato binário fechado da Autodesk. ' +
        'Opções: (1) no AutoCAD/BricsCAD/LibreCAD, exporte como "Salvar como > DXF" e importe esse ficheiro aqui; ' +
        '(2) use o ODA File Converter gratuito (Open Design Alliance) para converter .dwg em .dxf localmente; ' +
        '(3) integre a SDK licenciada da ODA no backend, se precisar de suporte nativo a .dwg em produção.',
    );
    this.name = 'UnsupportedDwgError';
  }
}

export function isDwgFile(filename: string): boolean {
  return /\.dwg$/i.test(filename);
}
