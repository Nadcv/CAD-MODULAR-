// Shared geometric/document types used by both the 2D and 3D views.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A parametric, reusable block — the "modulação" concept (e.g. a cabinet, drawer, panel). */
export interface ModuleDef {
  id: string;
  name: string;
  /** Position of the module's origin (bottom-front-left corner) in world units (meters). */
  position: Vec3;
  /** Rotation around the vertical (Z/up) axis, in radians. */
  rotationZ: number;
  /** Footprint/height in world units (meters). */
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Finish id from view3d/materials.ts (e.g. 'oak', 'walnut'). Undefined/'solid' = plain `color`. */
  material?: string;
  /** Id of the MasterModule this instance was placed from, if any. Enables "edit once, update all". */
  masterId?: string;
  locked?: boolean;
}

/** A reusable module template (like an AutoCAD block definition). Instances reference it by masterId. */
export interface MasterModuleDef {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  material?: string;
}

/** A straight wall segment, drawn in 2D as a thick line and extruded as a box in 3D. */
export interface WallDef {
  id: string;
  start: [number, number];
  end: [number, number];
  thickness: number;
  height: number;
  color: string;
}

/** A 2D linear dimension annotation (measures the distance between two points). */
export interface DimensionDef {
  id: string;
  from: [number, number];
  to: [number, number];
  /** Perpendicular offset (in meters) of the dimension line from the measured segment. */
  offset: number;
}

/** A flattened reference entity imported from DXF, drawn read-only in the 2D view. */
export type DxfEntity =
  | { kind: 'line'; from: [number, number]; to: [number, number] }
  | { kind: 'polyline'; points: [number, number][]; closed: boolean }
  | { kind: 'circle'; center: [number, number]; radius: number }
  | { kind: 'arc'; center: [number, number]; radius: number; startAngle: number; endAngle: number };

/**
 * Metadata for a 3D asset (a whole imported STL/OBJ/glTF/STEP/IGES file, kept as one rigid
 * group — e.g. a Danfoss valve assembly) saved in the persistent component library (IndexedDB,
 * see core/componentLibrary.ts). The binary geometry itself lives in IndexedDB, not here.
 */
export interface LibraryComponentMeta {
  id: string;
  name: string;
  sourceFormat: string;
  /** Local-space bounding box at import time, used to draw the 2D footprint without loading the mesh. */
  width: number;
  depth: number;
  height: number;
  addedAt: number;
}

/** A placed instance of a library component — positionable/movable, and light enough to be undoable. */
export interface PlacedComponentDef {
  id: string;
  libraryId: string;
  name: string;
  position: Vec3;
  rotationZ: number;
  scale: number;
  width: number;
  depth: number;
  height: number;
}
