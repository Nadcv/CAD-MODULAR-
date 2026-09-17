import './style.css';
import { CadDocument } from './core/Document';
import { Canvas2D } from './view2d/Canvas2D';
import { Scene3D } from './view3d/Scene3D';
import { Toolbar } from './ui/Toolbar';
import { ModuleList } from './ui/ModuleList';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { PresetLibrary } from './ui/PresetLibrary';
import { ComponentLibraryPanel } from './ui/ComponentLibraryPanel';

const STORAGE_KEY = 'cad-modular-project-v1';

const app = document.getElementById('app')!;

const header = document.createElement('header');
header.className = 'app-header';
const title = document.createElement('h1');
title.textContent = 'CAD Modular';
header.appendChild(title);
const toolbarHost = document.createElement('div');
toolbarHost.style.flex = '1';
header.appendChild(toolbarHost);
app.appendChild(header);

const layout = document.createElement('main');
layout.className = 'layout';
app.appendChild(layout);

const leftPanelHost = document.createElement('div');
leftPanelHost.className = 'side-column';
layout.appendChild(leftPanelHost);

const pane2d = document.createElement('div');
pane2d.className = 'view-pane';
pane2d.innerHTML = '<span class="pane-label">2D — planta baixa</span>';
layout.appendChild(pane2d);

const pane3d = document.createElement('div');
pane3d.className = 'view-pane';
pane3d.innerHTML = '<span class="pane-label">3D</span>';
layout.appendChild(pane3d);

const rightPanelHost = document.createElement('div');
rightPanelHost.className = 'side-column';
layout.appendChild(rightPanelHost);

const footer = document.createElement('footer');
footer.className = 'status-bar';
footer.textContent = 'Pronto.';
app.appendChild(footer);

const doc = new CadDocument();

const canvas2d = new Canvas2D(pane2d, doc);
const scene3D = new Scene3D(pane3d, doc);
new PresetLibrary(leftPanelHost, doc);
new ModuleList(leftPanelHost, doc);
const componentLibrary = new ComponentLibraryPanel(leftPanelHost, doc);
new PropertiesPanel(rightPanelHost, doc);
new Toolbar(toolbarHost, doc, scene3D, canvas2d, componentLibrary, footer);

function seedExample(): void {
  const master = doc.defineMaster({ name: 'Armário base 60', width: 0.6, depth: 0.6, height: 0.75, color: '#5b8cff' });
  doc.instantiateMaster(master.id, { x: 0, y: 0, z: 0 });
  doc.instantiateMaster(master.id, { x: 0.6, y: 0, z: 0 });
  doc.addModule({
    name: 'Bancada',
    position: { x: 0, y: 0.6, z: 0.75 },
    rotationZ: 0,
    width: 1.2,
    depth: 0.05,
    height: 0.05,
    color: '#c9a35b',
  });
}

// Restore the last autosaved project, if any; otherwise seed a small example so the app isn't
// empty on first load. Either way, the initial state becomes the undo baseline (undoing past it
// would just erase everything, which isn't useful).
let restored = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    doc.loadJSON(saved);
    restored = true;
  }
} catch {
  // localStorage unavailable (private browsing, storage disabled) — fall through to the seed.
}
if (!restored) seedExample();
doc.resetHistory();

// Debounced autosave: persists modules/masters/walls/dimensions/placed components (the last one
// is just a lightweight {libraryId, position, rotation, scale} reference — the actual 3D geometry
// lives in the separate IndexedDB component library, not here) so a reload picks up where you left off.
let autosaveTimer: number | undefined;
doc.events.on('change', () => {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, doc.toJSON());
    } catch {
      // storage unavailable or full — autosave is best-effort, not critical.
    }
  }, 500);
});

// Global undo/redo shortcuts (ignored while typing in a form field).
window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  const modKey = ev.ctrlKey || ev.metaKey;
  if (!modKey || ev.key.toLowerCase() !== 'z') return;
  ev.preventDefault();
  if (ev.shiftKey) doc.redo();
  else doc.undo();
});
