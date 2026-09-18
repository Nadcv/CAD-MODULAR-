# CAD Modular

Editor web de "modulações" — blocos paramétricos reutilizáveis (como armários, painéis, bancadas)
editados em duas vistas sincronizadas: planta 2D e cena 3D. Feito com Vite + TypeScript + three.js.

## Rodar localmente

```sh
npm install
npm run dev
```

`npm run build` gera a versão de produção em `dist/`. A cada push em `main`, o
GitHub Actions builda e publica automaticamente em GitHub Pages (veja
`.github/workflows/deploy-pages.yml`).

## O que dá para fazer

- **Módulos paramétricos**: criar caixas (largura/profundidade/altura/posição/rotação/cor),
  mover e redimensionar tanto na planta 2D (arrastar/handle de canto) quanto na cena 3D
  (gizmo de mover/girar/escalar) — as duas vistas ficam sempre sincronizadas.
- **Módulos mestres reutilizáveis**: transformar um módulo num "bloco" reutilizável; inserir
  novas instâncias e editar dimensões/cor de uma delas atualiza todas as instâncias vinculadas
  (equivalente a blocks do AutoCAD).
- **Importar DXF (2D)**: entidades (linha, polilinha, círculo, arco) desenhadas como referência
  na planta 2D.
- **Importar componente 3D** (`.stl` / `.obj` / `.gltf` / `.glb` / `.step` / `.stp` / `.igs` / `.iges`):
  o arquivo inteiro — com todas as suas sub-peças — vira **um grupo rígido único** na Biblioteca de
  Componentes 3D (gravada no IndexedDB do navegador, sobrevive a reload) e uma instância já é
  colocada no projeto. Pensado para peças de catálogo de fabricante (ex: um conjunto de válvula da
  Danfoss em STEP): importa uma vez, depois é só clicar "+ inserir" na biblioteca para reaproveitar
  sem reimportar/reprocessar o arquivo original. Cada instância colocada é movível/girável/escalável
  tanto em 2D (arraste; a pegada é o bounding box do componente) quanto em 3D (gizmo), e entra no
  desfazer/refazer normalmente — só a geometria em si fica fora do histórico (vive na biblioteca).
  **Explodir**: selecione um componente com várias sub-peças e clique "Explodir" (no painel de
  propriedades) para separá-las em componentes independentes, cada uma exatamente na posição/rotação
  visual em que estava — igual ao comando EXPLODE do AutoCAD, um nível por vez (explodir de novo
  numa das partes resultantes desce mais um nível, se houver). Entra no desfazer/refazer.
  STEP/IGES via [occt-import-js](https://github.com/kovacsv/occt-import-js) (WASM, ~7.6MB, carregado
  sob demanda) — testado de ponta a ponta com arquivos STEP reais (um cubo simples e uma montagem
  CAX-IF de várias peças nomeadas: porca/parafuso/haste/suporte/placa), incluindo "Explodir" na
  montagem. Fica **verde** para arquivos STEP/IGES autocontidos num único arquivo; montagens
  fatiadas em múltiplos arquivos que se referenciam entre si (comum em exports "por peça" de alguns
  CADs) não resolvem essas referências externas — o erro aparece na barra de status, não trava a
  aplicação.
  **Sub-partes**: quando o componente selecionado tem várias sub-peças, o painel de propriedades
  mostra uma "árvore" com o nome de cada uma (igual à árvore de modelo do FreeCAD) — clique numa
  parte para destacá-la na vista 3D sem separá-la do componente; só depois, se quiser, use
  "Explodir" para de fato tornar aquela parte independente.
- **Materiais/texturas**: cada módulo pode usar uma textura de madeira procedural (carvalho,
  carvalho branco, nogueira, wengué) em vez de cor sólida — gerada por canvas, sem depender de
  arquivo de imagem externo. Escolha em "Material" no painel de propriedades.
- **Lista de materiais (BOM)**: `Exportar → Lista de materiais (CSV)` agrupa módulos, componentes
  3D e paredes por nome+dimensões, com quantidade — pronto pra abrir em planilha e usar num
  orçamento ou pedido de material.
- **Exportar PDF**: `Exportar → PDF` gera um PDF com a planta 2D e a vista 3D atuais lado a lado
  (exatamente o que está na tela: ângulo de câmera, zoom, pan) mais uma página com a lista de
  materiais — pra imprimir ou enviar a um cliente/marceneiro.
- **Operações estilo FreeCAD** (painel de propriedades, com um módulo ou componente selecionado):
  - **Array linear**: N cópias em linha, com espaçamento X/Y configurável.
  - **Array circular**: N cópias orbitando a peça original a um raio e ângulo total dados.
  - **Espelhar**: cria uma cópia refletida através do plano X=0 ou Y=0 do projeto — exato para
    módulos (uma caixa não tem "lado certo"); para um componente 3D importado, só a posição é
    espelhada de verdade, a malha em si não é invertida (o app não representa uma instância com
    escala negativa/refletida).
  - **Raio do canto** (só módulos): arredonda as arestas verticais e horizontais da caixa via
    [`RoundedBoxGeometry`](https://threejs.org/docs/#examples/en/geometries/RoundedBoxGeometry) —
    um fillet aproximado, não uma operação B-rep real.
  - **Booleanas** (União / Subtrair / Interseção): selecione exatamente 2 módulos/componentes
    (clique + Ctrl-clique) para combiná-los via CSG ([three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg),
    WASM-free, carregado sob demanda). O resultado deixa de ser uma caixa/instância parametrizável
    — vira um componente novo (geometria calculada, salva na biblioteca) e os dois originais são
    removidos; "Subtrair" é A − B, na ordem em que você selecionou.
- **Exportar**: `.dxf` (módulos + paredes + cotas + pegadas dos componentes + referências),
  `.stl`/`.obj`/`.gltf` (módulos + paredes + componentes colocados), ou `.json` (projeto completo,
  para reabrir depois — os componentes exportam só a referência à biblioteca, não a geometria).
- **Desfazer/Refazer**: `Ctrl+Z` / `Ctrl+Shift+Z`, ou os botões na toolbar. Cobre criação, edição,
  duplicação, exclusão, paredes, cotas, componentes colocados e "Novo projeto" — uma arrastada
  inteira (mover/redimensionar em 2D, ou mover/girar/escalar em 3D) vira um único passo de desfazer.
  Não cobre a geometria DXF de referência nem a biblioteca de componentes em si (adicionar/remover
  um componente *da biblioteca*), só a colocação de instâncias no projeto.
- **Ajustar à grade (snap)**: liga/desliga na toolbar — 5cm de posição/dimensão em 2D e 3D, 15° de
  rotação. Cotas e paredes também encaixam nos mesmos 5cm ao desenhar.
- **Paredes**: ferramenta "Parede" — clique para começar, clique de novo para terminar (encadeia
  automaticamente a próxima parede a partir do fim da anterior); `Esc` ou botão direito cancela.
  Aparecem como linha grossa em 2D e caixa extrudada em 3D.
- **Cotas**: ferramenta "Cota" — clique em dois pontos para medir a distância; desenha linha de
  cota com linhas de extensão e o valor em metros, sempre em 2D.
- **Excluir**: tecla `Delete`/`Backspace` com o módulo, parede ou componente selecionado (ferramenta "Selecionar").
- **Projeto**: autosave no `localStorage` do navegador a cada edição (recarregar a página restaura
  o último estado); "Abrir projeto..." carrega um `.json` exportado anteriormente; "Novo projeto"
  limpa tudo (desfazível).
- **Biblioteca de módulos pré-definidos**: painel à esquerda com presets comuns de marcenaria
  (armário base 40/60/80, gaveteiro, armário aéreo, torre, bancada, porta, janela) — clique para
  inserir; inserções repetidas do mesmo preset reaproveitam o mesmo módulo mestre.
- **Importar DXF/DWG (2D)**: `.dxf` via `dxf-parser`; `.dwg` via [LibreDWG](https://www.gnu.org/software/libredwg/)
  compilada para WebAssembly pelo pacote [@mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web)
  (GPL-3.0, ~10MB, carregada sob demanda). Testado de ponta a ponta com arquivos `.dwg` reais
  (AutoCAD 2018) do próprio conjunto de testes da biblioteca — linhas, círculos, arcos e
  polilinhas leem corretamente. Suporte a `.dwg` continua **experimental**: cobertura de
  entidades/versões do formato varia (ver limitações abaixo).

## O que NÃO dá para fazer (e por quê)

- **`.dwg` é melhor esforço, não perfeito.** A LibreDWG é a única implementação livre e mantida
  do formato, mas seu suporte de leitura varia por versão do AutoCAD e tipo de entidade — um
  arquivo pode ler parcialmente (algumas entidades ainda não mapeadas, como TEXT/INSERT/blocos)
  ou falhar. A alternativa "oficial" (SDK da Open Design Alliance) é paga e fechada; não é algo
  que dá para embutir de graça num site público.
- **STEP/IGES multi-arquivo não resolvem.** Algumas exportações CAD dividem uma montagem grande em
  vários arquivos `.stp`/`.step` que se referenciam por caminho relativo (ex: um `assembly.stp` que
  aponta para `parte1.stp`, `parte2.stp`...). Como a importação lê um único arquivo por vez, essas
  referências externas não são resolvidas — só o arquivo raiz é interpretado. Um STEP/IGES
  autocontido num único arquivo (o caso comum de peças de catálogo de fabricante) importa
  normalmente.
- **Não é o FreeCAD.** Esse app tem um subconjunto pequeno e deliberado do que o FreeCAD faz —
  booleanas, array, espelhar e fillet aproximado em caixas (ver acima), pensado especificamente
  pra módulos de marcenaria. Não há sketch paramétrico com restrições geométricas, modelagem por
  superfícies NURBS, FEM/simulação, CAM/toolpath, nem desenho técnico normatizado (TechDraw) — o
  FreeCAD é construído sobre um kernel B-rep completo (OpenCascade) com mais de uma dezena de
  workbenches; replicar tudo isso está fora do escopo de um editor de módulos de marcenaria.

## Arquitetura

```
src/
  core/       Document.ts (fonte única de verdade: módulos, mestres, paredes, cotas, componentes
              colocados, seleção, histórico de desfazer/refazer) + tipos + emissor de eventos +
              componentLibrary.ts (biblioteca persistente de geometria 3D via IndexedDB)
  view2d/     Canvas2D.ts — planta baixa (canvas 2D: pan/zoom/seleção/arraste/redimensionar,
              ferramentas de parede/cota, snap à grade, pegada dos componentes 3D)
  view3d/     Scene3D.ts — cena three.js (OrbitControls + TransformControls, snap, paredes extrudadas,
              componentes carregados/clonados da biblioteca) + materials.ts (texturas de madeira
              proceduais via canvas, cacheadas por acabamento)
  io/         dxf.ts, mesh.ts, step.ts, dwg.ts, component.ts — import/export por formato;
              component.ts unifica STL/OBJ/glTF/STEP/IGES em "salvar na biblioteca + colocar instância";
              bom.ts (lista de materiais) e pdf.ts (planta+vista+lista em PDF, via jsPDF sob demanda);
              arrange.ts (array linear/circular, espelhar) e boolean.ts (União/Subtrair/Interseção
              via three-bvh-csg sob demanda — ambos operam em módulos e componentes 3D igualmente)
  vendor/     libredwg-web.js — cópia do módulo WASM bruto da LibreDWG (o pacote não expõe esse
              subcaminho no `exports` do package.json, então é copiado em vez de importado)
  ui/         Toolbar.ts, ModuleList.ts, PropertiesPanel.ts, PresetLibrary.ts, ComponentLibraryPanel.ts
```

### Biblioteca de componentes 3D (ex: peças da Danfoss)

Qualquer arquivo 3D importado (STL/OBJ/glTF/STEP/IGES) é convertido para glTF binário e salvo no
IndexedDB do navegador como **um componente reutilizável** — o arquivo inteiro fica agrupado (várias
sub-peças de uma montagem não se espalham em pedaços soltos). Uma `PlacedComponentDef` leve
(`{libraryId, position, rotationZ, scale}`) é o que entra no documento/projeto/histórico; a geometria
pesada em si nunca trafega pelo autosave nem pelo undo/redo, só é buscada na biblioteca quando
precisa ser desenhada ou exportada. Isso significa: importe uma peça de catálogo (STEP de um
fabricante, por exemplo) uma única vez, e depois é só clicar em "+ inserir" no painel "Componentes
3D" para colocá-la de novo em qualquer projeto, sem reprocessar o arquivo original.

As views 2D e 3D nunca se comunicam diretamente: ambas leem/escrevem no `CadDocument` e
re-renderizam a cada evento `change`/`selectionChange`. Isso é o que mantém uma edição em 3D
(ex: arrastar um módulo) refletida instantaneamente na planta 2D, e vice-versa.
