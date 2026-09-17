import type { LibraryComponentMeta } from './types';

/**
 * Persistent catalog of imported 3D assets (glTF-binary blobs), stored in IndexedDB so a
 * component — e.g. a Danfoss valve STEP model — only needs to be imported/converted once and
 * can then be dropped into any project afterwards. Kept separate from CadDocument/localStorage:
 * binary geometry doesn't belong in the small JSON project file that undo/redo and autosave move
 * around on every edit.
 */
const DB_NAME = 'cad-modular-components';
const DB_VERSION = 1;
const STORE = 'components';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Não foi possível abrir o IndexedDB'));
  });
}

interface StoredComponent extends LibraryComponentMeta {
  glb: ArrayBuffer;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Falha na operação do IndexedDB'));
    });
  } finally {
    db.close();
  }
}

export async function saveComponent(meta: Omit<LibraryComponentMeta, 'addedAt'>, glb: ArrayBuffer): Promise<LibraryComponentMeta> {
  const record: StoredComponent = { ...meta, addedAt: Date.now(), glb };
  await withStore('readwrite', (store) => store.put(record));
  const { glb: _glb, ...publicMeta } = record;
  return publicMeta;
}

export async function listComponents(): Promise<LibraryComponentMeta[]> {
  const all = await withStore<StoredComponent[]>('readonly', (store) => store.getAll());
  return all.map(({ glb: _glb, ...meta }) => meta).sort((a, b) => b.addedAt - a.addedAt);
}

export async function loadComponentGlb(id: string): Promise<ArrayBuffer> {
  const record = await withStore<StoredComponent | undefined>('readonly', (store) => store.get(id));
  if (!record) throw new Error('Componente não encontrado na biblioteca (pode ter sido removido).');
  return record.glb;
}

export async function deleteComponent(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}
