import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CadDocument } from '../core/Document';
import type { ModuleDef } from '../core/types';
import { loadLibraryComponentGroup } from '../io/mesh';

type SelectableKind = 'module' | 'component';

/**
 * 3D editor built on three.js. Each ModuleDef is rendered as a box mesh, and each
 * PlacedComponentDef as a loaded/cloned group from the component library — both kept in sync
 * with the document; dragging one with TransformControls writes position/rotation/scale back
 * into the document so the 2D view (and, for components, the footprint rectangle) updates too.
 */
export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private doc: CadDocument;
  private meshes = new Map<string, THREE.Mesh>();
  private wallMeshes = new Map<string, THREE.Mesh>();
  private componentGroups = new Map<string, THREE.Object3D>();
  private componentTemplates = new Map<string, THREE.Object3D>();
  private componentLoading = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private frameHandle = 0;

  constructor(container: HTMLElement, doc: CadDocument) {
    this.container = container;
    this.doc = doc;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1e1e24);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);
    this.scene.add(new THREE.GridHelper(40, 40, 0x454552, 0x2c2c34));

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1000);
    this.camera.position.set(6, 6, 8);
    this.camera.lookAt(0, 0, 0);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.enableDamping = true;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.addEventListener('dragging-changed', (ev) => {
      const dragging = (ev as unknown as { value: boolean }).value;
      this.orbit.enabled = !dragging;
      if (dragging) this.doc.checkpoint();
    });
    this.transform.addEventListener('objectChange', () => this.writeBackTransform());
    this.scene.add(this.transform.getHelper());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('click', this.onClick);

    doc.events.on('change', () => this.sync());
    doc.events.on('selectionChange', () => this.applySelection());
    this.sync();
    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }

  setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transform.setMode(mode);
  }

  setSnap(enabled: boolean, translationStep = 0.05): void {
    this.transform.setTranslationSnap(enabled ? translationStep : null);
    this.transform.setRotationSnap(enabled ? THREE.MathUtils.degToRad(15) : null);
    this.transform.setScaleSnap(enabled ? 0.1 : null);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Walks up from a raycast hit to the top-level object that carries selection userData. */
  private findSelectable(obj: THREE.Object3D | null): { id: string; kind: SelectableKind; object: THREE.Object3D } | undefined {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData.moduleId) return { id: cur.userData.moduleId as string, kind: 'module', object: cur };
      if (cur.userData.componentInstanceId) return { id: cur.userData.componentInstanceId as string, kind: 'component', object: cur };
      cur = cur.parent;
    }
    return undefined;
  }

  private onClick = (ev: MouseEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [...this.meshes.values(), ...this.componentGroups.values()];
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      const found = this.findSelectable(hits[0].object);
      if (found) this.doc.setSelection([found.id]);
    } else if (!this.transform.dragging) {
      this.doc.setSelection([]);
    }
  };

  private writeBackTransform(): void {
    const obj = this.transform.object;
    if (!obj) return;
    if (obj.userData.moduleId) {
      const mod = this.doc.modules.get(obj.userData.moduleId as string);
      if (!mod) return;
      mod.position = { x: obj.position.x, y: obj.position.z, z: obj.position.y };
      mod.rotationZ = -obj.rotation.y;
      mod.width = Math.max(0.05, obj.scale.x * mod.width);
      mod.depth = Math.max(0.05, obj.scale.z * mod.depth);
      mod.height = Math.max(0.05, obj.scale.y * mod.height);
      obj.scale.set(1, 1, 1);
      this.rebuildGeometry(mod, obj as THREE.Mesh);
      this.doc.events.emit('change', { reason: 'transform3d' });
    } else if (obj.userData.componentInstanceId) {
      const inst = this.doc.placedComponents.get(obj.userData.componentInstanceId as string);
      if (!inst) return;
      inst.position = { x: obj.position.x, y: obj.position.z, z: obj.position.y };
      inst.rotationZ = -obj.rotation.y;
      inst.scale = (obj.scale.x + obj.scale.y + obj.scale.z) / 3;
      this.doc.events.emit('change', { reason: 'transform3d' });
    }
  }

  private rebuildGeometry(mod: ModuleDef, mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BoxGeometry(mod.width, mod.height, mod.depth);
    mesh.geometry.translate(mod.width / 2, mod.height / 2, mod.depth / 2);
  }

  /** Rebuild/refresh module meshes to match the document (cheap: small scene sizes expected). */
  private sync(): void {
    const seen = new Set<string>();
    for (const mod of this.doc.modules.values()) {
      seen.add(mod.id);
      let mesh = this.meshes.get(mod.id);
      if (!mesh) {
        const geometry = new THREE.BoxGeometry(mod.width, mod.height, mod.depth);
        geometry.translate(mod.width / 2, mod.height / 2, mod.depth / 2);
        const material = new THREE.MeshStandardMaterial({ color: mod.color, metalness: 0.1, roughness: 0.7 });
        mesh = new THREE.Mesh(geometry, material);
        mesh.userData.moduleId = mod.id;
        this.scene.add(mesh);
        this.meshes.set(mod.id, mesh);
      } else {
        const g = mesh.geometry as THREE.BoxGeometry;
        const params = g.parameters;
        if (params.width !== mod.width || params.height !== mod.height || params.depth !== mod.depth) {
          this.rebuildGeometry(mod, mesh);
        }
        (mesh.material as THREE.MeshStandardMaterial).color.set(mod.color);
      }
      mesh.position.set(mod.position.x, mod.position.z, mod.position.y);
      mesh.rotation.set(0, -mod.rotationZ, 0);
      mesh.scale.set(1, 1, 1);
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        // A module can disappear without a 'selectionChange' event first (e.g. undo/redo
        // restoring a state where it never existed) — detach the gizmo before the mesh is gone,
        // or TransformControls keeps updating a disposed object every frame.
        if (this.transform.object === mesh) this.transform.detach();
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.meshes.delete(id);
      }
    }
    this.syncWalls();
    this.syncPlacedComponents();
  }

  private syncWalls(): void {
    const seen = new Set<string>();
    for (const wall of this.doc.walls.values()) {
      seen.add(wall.id);
      const dx = wall.end[0] - wall.start[0];
      const dy = wall.end[1] - wall.start[1];
      const length = Math.max(0.01, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const midX = (wall.start[0] + wall.end[0]) / 2;
      const midY = (wall.start[1] + wall.end[1]) / 2;

      let mesh = this.wallMeshes.get(wall.id);
      if (!mesh) {
        const geometry = new THREE.BoxGeometry(length, wall.height, wall.thickness);
        const material = new THREE.MeshStandardMaterial({ color: wall.color, metalness: 0.05, roughness: 0.9 });
        mesh = new THREE.Mesh(geometry, material);
        mesh.userData.wallId = wall.id;
        this.scene.add(mesh);
        this.wallMeshes.set(wall.id, mesh);
      } else {
        const params = (mesh.geometry as THREE.BoxGeometry).parameters;
        if (params.width !== length || params.height !== wall.height || params.depth !== wall.thickness) {
          mesh.geometry.dispose();
          mesh.geometry = new THREE.BoxGeometry(length, wall.height, wall.thickness);
        }
        (mesh.material as THREE.MeshStandardMaterial).color.set(wall.color);
      }
      mesh.position.set(midX, wall.height / 2, midY);
      mesh.rotation.set(0, -angle, 0);
    }
    for (const [id, mesh] of this.wallMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.wallMeshes.delete(id);
      }
    }
  }

  private async getOrLoadTemplate(libraryId: string): Promise<THREE.Object3D | undefined> {
    const cached = this.componentTemplates.get(libraryId);
    if (cached) return cached;
    const group = await loadLibraryComponentGroup(libraryId);
    this.componentTemplates.set(libraryId, group);
    return group;
  }

  private syncPlacedComponents(): void {
    const seen = new Set<string>();
    for (const inst of this.doc.placedComponents.values()) {
      seen.add(inst.id);
      const existing = this.componentGroups.get(inst.id);
      if (existing) {
        existing.position.set(inst.position.x, inst.position.z, inst.position.y);
        existing.rotation.set(0, -inst.rotationZ, 0);
        existing.scale.setScalar(inst.scale);
        continue;
      }
      if (this.componentLoading.has(inst.id)) continue;
      this.componentLoading.add(inst.id);
      this.getOrLoadTemplate(inst.libraryId)
        .then((template) => {
          this.componentLoading.delete(inst.id);
          // The instance (or the whole document) may have changed/been removed while loading.
          if (!template || !this.doc.placedComponents.has(inst.id) || this.componentGroups.has(inst.id)) return;
          const clone = template.clone(true);
          // Object3D.clone() shares materials by reference — clone them too so that selection
          // highlighting (emissive) on one instance doesn't bleed into every other instance of
          // the same library component.
          clone.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
          });
          clone.userData.componentInstanceId = inst.id;
          clone.position.set(inst.position.x, inst.position.z, inst.position.y);
          clone.rotation.set(0, -inst.rotationZ, 0);
          clone.scale.setScalar(inst.scale);
          this.scene.add(clone);
          this.componentGroups.set(inst.id, clone);
        })
        .catch(() => {
          this.componentLoading.delete(inst.id);
          // Component missing from the library (e.g. deleted) — nothing to show for this instance.
        });
    }
    for (const [id, group] of this.componentGroups) {
      if (!seen.has(id)) {
        if (this.transform.object === group) this.transform.detach();
        this.scene.remove(group);
        // Only dispose materials here: geometries are shared with the cached template (and
        // potentially other instances), so disposing them would break everything else using it.
        group.traverse((child) => {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });
        this.componentGroups.delete(id);
      }
    }
  }

  private applySelection(): void {
    const [id] = [...this.doc.selectedIds];
    for (const [mid, m] of this.meshes) {
      (m.material as THREE.MeshStandardMaterial).emissive.set(mid === id ? 0x554400 : 0x000000);
    }
    for (const [cid, group] of this.componentGroups) {
      setEmissiveRecursive(group, cid === id ? 0x554400 : 0x000000);
    }
    const target = (id && this.meshes.get(id)) || (id && this.componentGroups.get(id));
    if (target) this.transform.attach(target);
    else this.transform.detach();
  }

  private animate = (): void => {
    this.frameHandle = requestAnimationFrame(this.animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function setEmissiveRecursive(object: THREE.Object3D, hex: number): void {
  object.traverse((child) => {
    const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) m.emissive?.set(hex);
  });
}

