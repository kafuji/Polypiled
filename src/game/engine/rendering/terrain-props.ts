import * as THREE from "three";
import { TILE_SIZE, WALL_HEIGHT } from "../../constants";
import type { TileMaterialKind } from "../../glyphs";
import {
  getTerrainCmapIndex,
  isBranchStairsCmapGlyph,
  isLadderCmapGlyph,
} from "../../glyphs/behavior";
import type { HiResTileFrame } from "../../hires-tiles/hires-tile-pack";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";

/** Terrain that the high-resolution tile mode shows as a small 3D model. */
export type TerrainPropKind =
  | "stairs_up"
  | "stairs_down"
  | "ladder_up"
  | "ladder_down"
  | "fountain"
  | "sink"
  | "altar"
  | "grave"
  | "throne"
  | "door";

export type AltarAlignment = "unaligned" | "chaotic" | "neutral" | "lawful" | "other";

export interface TerrainPropSpec {
  kind: TerrainPropKind;
  /** Leads to another dungeon branch; drawn in warmer stone. */
  branch: boolean;
  /** Altars only: picks the colour of the altar cloth. */
  alignment?: AltarAlignment;
  /** Doors only. */
  door?: DoorSpec;
}

/** Which way the wall a door sits in runs across the map. */
export type DoorAxis = "horizontal" | "vertical";

export interface DoorSpec {
  state: "closed" | "open";
  axis: DoorAxis;
}

/** Pack art the models borrow as surface textures. */
export type TerrainPropTextureSlot =
  | "floor"
  | "wall"
  | "rock"
  | "stairTread"
  | "stairRiser"
  | "door";

/** Where a texture slot's art comes from: a pack tile, or one part of it. */
export interface TerrainPropTextureSource {
  /** NetHack 5 tile index of the pack tile. */
  tileIndex: number;
  /** The part of the tile to use, as fractions of its width and height. */
  crop?: { x0: number; y0: number; x1: number; y1: number };
}

const STAIRS_DOWN_TILE_INDEX = NH5_TILE_KEYS.indexOf("other/staircase_down");

export const TERRAIN_PROP_TEXTURE_SOURCES: Readonly<
  Record<TerrainPropTextureSlot, TerrainPropTextureSource>
> = {
  floor: { tileIndex: NH5_TILE_KEYS.indexOf("other/floor_of_a_room") },
  wall: { tileIndex: NH5_TILE_KEYS.indexOf("other/main_walls_horizontal") },
  rock: { tileIndex: NH5_TILE_KEYS.indexOf("other/stone") },
  // The down-stairs art looks straight into a wooden flight: the lit tread
  // nearest the bottom and the dark plank framing the top are both flat.
  stairTread: {
    tileIndex: STAIRS_DOWN_TILE_INDEX,
    crop: { x0: 40 / 256, y0: 182 / 256, x1: 218 / 256, y1: 218 / 256 },
  },
  stairRiser: {
    tileIndex: STAIRS_DOWN_TILE_INDEX,
    crop: { x0: 30 / 256, y0: 6 / 256, x1: 226 / 256, y1: 28 / 256 },
  },
  // The closed door art is the face of a studded plank door.
  door: { tileIndex: NH5_TILE_KEYS.indexOf("other/horizontal_closed_door") },
};

const CMAP_OPEN_DOOR_VERTICAL = 13;
const CMAP_OPEN_DOOR_HORIZONTAL = 14;
const CMAP_CLOSED_DOOR_VERTICAL = 15;
const CMAP_CLOSED_DOOR_HORIZONTAL = 16;
const CMAP_ALTAR = 33;
const CMAP_GRAVE = 34;
const CMAP_THRONE = 35;
const CMAP_SINK = 36;
const CMAP_FOUNTAIN = 37;

export function resolveTerrainPropSpec(
  sourceGlyph: number | null,
  materialKind: TileMaterialKind | null,
  tileIndex: number = -1,
): TerrainPropSpec | null {
  if (materialKind === "stairs_up" || materialKind === "stairs_down") {
    const up = materialKind === "stairs_up";
    const ladder = sourceGlyph !== null && isLadderCmapGlyph(sourceGlyph);
    return {
      kind: ladder ? (up ? "ladder_up" : "ladder_down") : up ? "stairs_up" : "stairs_down",
      branch: sourceGlyph !== null && isBranchStairsCmapGlyph(sourceGlyph),
    };
  }
  if (materialKind === "fountain") {
    return { kind: "fountain", branch: false };
  }
  const cmapIndex = sourceGlyph !== null ? getTerrainCmapIndex(sourceGlyph) : null;
  switch (cmapIndex) {
    case CMAP_FOUNTAIN:
      return { kind: "fountain", branch: false };
    case CMAP_SINK:
      return { kind: "sink", branch: false };
    case CMAP_GRAVE:
      return { kind: "grave", branch: false };
    case CMAP_THRONE:
      return { kind: "throne", branch: false };
    case CMAP_ALTAR:
      return { kind: "altar", branch: false, alignment: resolveAltarAlignment(tileIndex) };
    case CMAP_OPEN_DOOR_VERTICAL:
    case CMAP_OPEN_DOOR_HORIZONTAL:
      return {
        kind: "door",
        branch: false,
        door: { state: "open", axis: cmapIndex === CMAP_OPEN_DOOR_VERTICAL ? "vertical" : "horizontal" },
      };
    case CMAP_CLOSED_DOOR_VERTICAL:
    case CMAP_CLOSED_DOOR_HORIZONTAL:
      return {
        kind: "door",
        branch: false,
        door: { state: "closed", axis: cmapIndex === CMAP_CLOSED_DOOR_VERTICAL ? "vertical" : "horizontal" },
      };
    default:
      return null;
  }
}

function resolveAltarAlignment(tileIndex: number): AltarAlignment {
  const key = tileIndex >= 0 ? NH5_TILE_KEYS[tileIndex] ?? "" : "";
  const match = /^other\/(unaligned|chaotic|neutral|lawful|other)_altar$/.exec(key);
  return (match?.[1] as AltarAlignment | undefined) ?? "unaligned";
}

/**
 * Stable name for one look of a prop; a change rebuilds the model. A door's
 * axis is left out: it only turns the model (see doorRotation).
 */
export function terrainPropSpecName(spec: TerrainPropSpec): string {
  return [spec.kind, spec.branch ? "branch" : "", spec.alignment ?? "", spec.door?.state ?? ""].join(":");
}

/**
 * Turn about the vertical axis for a prop. Door models are built in a wall
 * running east-west; a door in a north-south wall is turned a quarter.
 */
export function doorRotation(spec: TerrainPropSpec): number {
  return spec.door?.axis === "vertical" ? Math.PI / 2 : 0;
}

/**
 * Whether the model rises far enough to swallow a first-person camera
 * standing on its tile. Openings in the floor stay low, and an open door
 * stands aside of the passage.
 */
export function isRaisedTerrainPropKind(kind: TerrainPropKind): boolean {
  return kind !== "stairs_down" && kind !== "ladder_down" && kind !== "door";
}

/** Tint applied over a texture; plain white keeps the pack art as painted. */
const PLAIN = 0xffffff;
const BRANCH_TINT = 0xf2d08a;
const WOOD = 0x8a6236;
/** Stair wood used when the pack has no stairs art to borrow. */
const STAIR_TREAD_FALLBACK = 0xb7843f;
const STAIR_RISER_FALLBACK = 0x6b4223;
const DOOR_FALLBACK = 0x6a4b2c;
const DOOR_EDGE = 0x3a2817;
/** A door spans most of its cell, between the walls on either side. */
const DOOR_WIDTH = TILE_SIZE * 0.92;
/** As tall as the stone walls on either side. */
const DOOR_HEIGHT = WALL_HEIGHT;
/** Thick enough that a shut or open leaf reads clearly from above. */
const DOOR_THICKNESS = TILE_SIZE * 0.14;
const VOID = 0x050505;
const WATER = 0x3d7fc4;
const METAL = 0xa7adb3;
const EARTH_TINT = 0xb08a62;
const GOLD = 0xc9a23a;
const CUSHION = 0x8a1f2a;
const ALTAR_CLOTH: Record<AltarAlignment, number> = {
  lawful: 0xe2d9b0,
  neutral: 0x6f93b8,
  chaotic: 0x8e2a2a,
  unaligned: 0x4f4f4f,
  other: 0x3b2a4d,
};

/** Size of the opening that down stairs and ladders cut into the floor. */
const OPENING = TILE_SIZE * 0.78;
/** How far below the floor the shaft reaches. */
const SHAFT_DEPTH = WALL_HEIGHT * 0.9;
/**
 * The opening's depth mask sits above the floor and its occlusion strips
 * (z = 0.014) so neither is drawn across the hole.
 */
const OPENING_MASK_Z = 0.02;
/** How far below the floor the shaft lining ends. */
const LINING_TOP_GAP = 0.006;
const SHAFT_RENDER_ORDER = -2;
const OPENING_MASK_RENDER_ORDER = -1;

/** A surface: an optional pack texture under a colour tint. */
interface Surface {
  texture: TerrainPropTextureSlot | null;
  color: number;
  /** Colour (before the tint) to use when the texture is unavailable. */
  fallback?: number;
}

const surface = (
  texture: TerrainPropTextureSlot | null,
  color: number = PLAIN,
  fallback?: number,
): Surface => ({ texture, color, fallback });

const stairTread = (tint: number): Surface => surface("stairTread", tint, STAIR_TREAD_FALLBACK);
const stairRiser = (tint: number): Surface => surface("stairRiser", tint, STAIR_RISER_FALLBACK);

/**
 * Builds the stairs, ladder and dungeon feature models. Materials and
 * textures are shared by every placed copy; each prop owns its geometry,
 * whose texture coordinates follow world units so the borrowed floor and
 * wall art keep the same scale as the level around them.
 */
export class TerrainPropModels {
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  private readonly textures = new Map<TerrainPropTextureSlot, THREE.Texture | null>();

  private openingMaskMaterial: THREE.MeshBasicMaterial | null = null;

  constructor(
    private readonly patchMaterial: (material: THREE.Material) => void,
    private readonly resolveTextureFrame: (tileIndex: number) => HiResTileFrame | null = () => null,
    private readonly anisotropy: number = 1,
  ) {}

  build(spec: TerrainPropSpec): THREE.Group {
    const group = new THREE.Group();
    group.name = `terrain-prop:${terrainPropSpecName(spec)}`;
    switch (spec.kind) {
      case "stairs_up":
        this.buildStairsUp(group, spec.branch);
        break;
      case "stairs_down":
        this.buildStairsDown(group, spec.branch);
        break;
      case "ladder_up":
        this.buildLadderUp(group);
        break;
      case "ladder_down":
        this.buildLadderDown(group, spec.branch);
        break;
      case "fountain":
        this.buildFountain(group);
        break;
      case "sink":
        this.buildSink(group);
        break;
      case "altar":
        this.buildAltar(group, spec.alignment ?? "unaligned");
        break;
      case "grave":
        this.buildGrave(group);
        break;
      case "throne":
        this.buildThrone(group);
        break;
      case "door":
        this.buildDoor(group, spec.door?.state ?? "closed");
        break;
    }
    return group;
  }

  /** Frees one prop's geometry; materials and textures stay shared. */
  static disposeProp(prop: THREE.Object3D): void {
    prop.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  }

  dispose(): void {
    this.materials.forEach((material) => material.dispose());
    this.materials.clear();
    this.textures.forEach((texture) => texture?.dispose());
    this.textures.clear();
    this.openingMaskMaterial?.dispose();
    this.openingMaskMaterial = null;
  }

  /** A flight of steps climbing away from the viewer (toward the north). */
  private buildStairsUp(group: THREE.Group, branch: boolean): void {
    const tint = branch ? BRANCH_TINT : PLAIN;
    const steps = 5;
    const width = TILE_SIZE * 0.76;
    const front = -TILE_SIZE * 0.42;
    const depth = (TILE_SIZE * 0.84) / steps;
    const rise = (WALL_HEIGHT * 0.6) / steps;
    for (let i = 0; i < steps; i++) {
      const height = rise * (i + 1);
      this.addStepBox(
        group,
        stairTread(tint),
        stairRiser(tint),
        width,
        depth,
        height,
        0,
        front + depth * (i + 0.5),
        height / 2,
        rise,
      );
    }
  }

  /** Steps cut into the floor, sinking northward into darkness. */
  private buildStairsDown(group: THREE.Group, branch: boolean): void {
    const tint = branch ? BRANCH_TINT : PLAIN;
    this.addShaft(group, tint);
    const half = OPENING / 2;
    const steps = 6;
    const depth = OPENING / steps;
    const rise = SHAFT_DEPTH / steps;
    // The last tread is the shaft floor itself.
    for (let i = 0; i < steps - 1; i++) {
      const top = -rise * (i + 1);
      const height = SHAFT_DEPTH + top;
      const light = shadeForDepth(-top);
      this.addStepBox(
        group,
        stairTread(shade(tint, light)),
        stairRiser(shade(tint, light)),
        OPENING,
        depth,
        height,
        0,
        -half + depth * (i + 0.5),
        -SHAFT_DEPTH + height / 2,
        rise,
        SHAFT_RENDER_ORDER,
      );
    }
    // A passage leads on from the foot of the stairs.
    const passageHeight = rise * 2.2;
    this.addBox(
      group,
      surface(null, VOID),
      surface(null, VOID),
      OPENING * 0.6,
      0.01,
      passageHeight,
      0,
      half - 0.02,
      -SHAFT_DEPTH + passageHeight / 2,
      SHAFT_RENDER_ORDER,
    );
  }

  /** A wooden ladder leaning toward the north. */
  private buildLadderUp(group: THREE.Group): void {
    const ladder = new THREE.Group();
    this.addLadder(ladder, WALL_HEIGHT * 1.0, 0);
    ladder.position.set(0, -TILE_SIZE * 0.12, 0);
    ladder.rotation.x = -THREE.MathUtils.degToRad(14);
    group.add(ladder);
  }

  /** A square shaft with a ladder running down its far wall. */
  private buildLadderDown(group: THREE.Group, branch: boolean): void {
    this.addShaft(group, branch ? BRANCH_TINT : PLAIN);
    const ladder = new THREE.Group();
    const above = WALL_HEIGHT * 0.34;
    this.addLadder(ladder, SHAFT_DEPTH + above, SHAFT_RENDER_ORDER);
    // The ladder runs from the shaft floor, against the north wall.
    ladder.position.set(0, OPENING / 2 - TILE_SIZE * 0.05, -SHAFT_DEPTH);
    group.add(ladder);
  }

  /** A round stone basin with a spouting column in the middle. */
  private buildFountain(group: THREE.Group): void {
    const stone = surface("wall");
    const basinHeight = WALL_HEIGHT * 0.15;
    this.addCylinder(group, surface("floor"), stone, TILE_SIZE * 0.38, basinHeight, 0, 0, basinHeight / 2);
    this.addCylinder(group, surface(null, WATER), surface(null, WATER), TILE_SIZE * 0.32, 0.01, 0, 0, basinHeight + 0.002);
    const columnHeight = WALL_HEIGHT * 0.4;
    this.addCylinder(group, stone, stone, TILE_SIZE * 0.06, columnHeight, 0, 0, columnHeight / 2);
    const bowlHeight = WALL_HEIGHT * 0.05;
    this.addCylinder(group, surface("floor"), stone, TILE_SIZE * 0.15, bowlHeight, 0, 0, columnHeight + bowlHeight / 2);
    this.addCylinder(group, surface(null, WATER), surface(null, WATER), TILE_SIZE * 0.12, 0.01, 0, 0, columnHeight + bowlHeight + 0.002);
  }

  /** A stone counter with a dark basin and a metal tap at the back. */
  private buildSink(group: THREE.Group): void {
    const height = WALL_HEIGHT * 0.34;
    this.addBox(group, surface("floor"), surface("wall"), TILE_SIZE * 0.62, TILE_SIZE * 0.44, height, 0, 0, height / 2);
    const basin = surface(null, shade(METAL, 0.45));
    this.addBox(group, basin, basin, TILE_SIZE * 0.44, TILE_SIZE * 0.26, 0.01, 0, -TILE_SIZE * 0.02, height + 0.002);
    const metal = surface(null, METAL);
    const tapHeight = WALL_HEIGHT * 0.14;
    const tapY = TILE_SIZE * 0.16;
    this.addCylinder(group, metal, metal, TILE_SIZE * 0.025, tapHeight, 0, tapY, height + tapHeight / 2);
    this.addBox(group, metal, metal, TILE_SIZE * 0.04, TILE_SIZE * 0.12, TILE_SIZE * 0.035, 0, tapY - TILE_SIZE * 0.05, height + tapHeight);
  }

  /** A stone block draped with a cloth in the altar's alignment colour. */
  private buildAltar(group: THREE.Group, alignment: AltarAlignment): void {
    const height = WALL_HEIGHT * 0.4;
    const slab = WALL_HEIGHT * 0.06;
    this.addBox(group, surface("floor"), surface("wall"), TILE_SIZE * 0.66, TILE_SIZE * 0.42, height - slab, 0, 0, (height - slab) / 2);
    this.addBox(group, surface("floor"), surface("rock", 0xd0d0d0), TILE_SIZE * 0.76, TILE_SIZE * 0.5, slab, 0, 0, height - slab / 2);
    const cloth = surface(null, ALTAR_CLOTH[alignment]);
    const clothFront = surface(null, shade(ALTAR_CLOTH[alignment], 0.9));
    const clothWidth = TILE_SIZE * 0.24;
    const clothThickness = 0.012;
    // Runs across the top and hangs down the front face.
    this.addBox(group, cloth, cloth, clothWidth, TILE_SIZE * 0.5, clothThickness, 0, 0, height + clothThickness / 2);
    const drop = height * 0.6;
    this.addBox(group, clothFront, clothFront, clothWidth, clothThickness, drop, 0, -TILE_SIZE * 0.25 - clothThickness / 2, height - drop / 2);
  }

  /** A low earth mound with a round-topped headstone at its head. */
  private buildGrave(group: THREE.Group): void {
    const earth = surface("rock", EARTH_TINT);
    const mound = WALL_HEIGHT * 0.06;
    this.addBox(group, earth, earth, TILE_SIZE * 0.46, TILE_SIZE * 0.6, mound, 0, -TILE_SIZE * 0.08, mound / 2);
    const stone = surface("wall");
    const stoneWidth = TILE_SIZE * 0.42;
    const stoneDepth = TILE_SIZE * 0.09;
    const stoneHeight = WALL_HEIGHT * 0.4;
    const stoneY = TILE_SIZE * 0.28;
    this.addBox(group, stone, stone, stoneWidth, stoneDepth, stoneHeight, 0, stoneY, stoneHeight / 2);
    // A cylinder lying along the north axis rounds off the top.
    this.addCylinder(group, stone, stone, stoneWidth / 2, stoneDepth, 0, stoneY, stoneHeight, false);
  }

  /** A gilded seat with a tall back, facing the viewer. */
  private buildThrone(group: THREE.Group): void {
    const gold = surface(null, GOLD);
    const goldBack = surface(null, shade(GOLD, 0.92));
    const cushion = surface(null, CUSHION);
    const seatHeight = WALL_HEIGHT * 0.3;
    const width = TILE_SIZE * 0.52;
    const seatY = -TILE_SIZE * 0.02;
    this.addBox(group, gold, gold, width, TILE_SIZE * 0.46, seatHeight, 0, seatY, seatHeight / 2);
    this.addBox(group, cushion, cushion, width * 0.8, TILE_SIZE * 0.36, 0.03, 0, seatY - TILE_SIZE * 0.02, seatHeight + 0.015);
    const backHeight = WALL_HEIGHT * 0.88;
    const backDepth = TILE_SIZE * 0.09;
    const backY = TILE_SIZE * 0.25;
    this.addBox(group, goldBack, goldBack, width, backDepth, backHeight, 0, backY, backHeight / 2);
    this.addBox(group, cushion, cushion, width * 0.7, 0.02, backHeight * 0.5, 0, backY - backDepth / 2 - 0.01, seatHeight + backHeight * 0.28);
    const armHeight = WALL_HEIGHT * 0.12;
    for (const side of [-1, 1]) {
      this.addBox(group, gold, gold, TILE_SIZE * 0.07, TILE_SIZE * 0.42, armHeight, side * (width / 2 - TILE_SIZE * 0.035), seatY, seatHeight + armHeight / 2);
    }
  }

  /**
   * Just the door leaf, with no frame, so from above it reads at a glance.
   * The hinge sits in the south-west corner of the cell: shut, the leaf
   * runs along the south side; open, it turns a quarter about the hinge to
   * run along the west side. Both stay inside the cell. Built for a wall
   * running east-west (the passage runs north-south); doorRotation turns it
   * for the other axis.
   */
  private buildDoor(group: THREE.Group, state: DoorSpec["state"]): void {
    const width = DOOR_WIDTH;
    const height = DOOR_HEIGHT;
    const thickness = DOOR_THICKNESS;
    const edge0 = -width / 2;
    const geometry = new THREE.BoxGeometry(width, thickness, height);
    if (state === "open") {
      geometry.rotateZ(Math.PI / 2);
      geometry.translate(edge0 + thickness / 2, 0, height / 2);
    } else {
      geometry.translate(0, edge0 + thickness / 2, height / 2);
    }
    const face = this.material(surface("door", PLAIN, DOOR_FALLBACK));
    // The edges, mostly the top seen from above, are a dark wooden plank.
    const edge = this.material(surface("stairRiser", PLAIN, DOOR_EDGE));
    // BoxGeometry keeps one picture per face: the door art fills both faces.
    this.addMesh(group, geometry, [edge, edge, face, face, edge, edge], 0);
  }

  /**
   * A square shaft below the floor, lined with wall stone that darkens with
   * depth, plus the depth mask that keeps the floor tile from covering it.
   */
  private addShaft(group: THREE.Group, tint: number): void {
    const half = OPENING / 2;
    const thickness = TILE_SIZE * 0.06;
    const bands = 3;
    // The lining stops just under the floor: tops level with the floor
    // tile around the opening would z-fight with it.
    const bandHeight = (SHAFT_DEPTH - LINING_TOP_GAP) / bands;
    for (let band = 0; band < bands; band++) {
      const top = -LINING_TOP_GAP - bandHeight * band;
      const lining = surface("wall", shade(tint, shadeForDepth(-top + bandHeight / 2)));
      const z = top - bandHeight / 2;
      // Each side sits just outside the opening, under the floor around it.
      const sides: Array<[number, number, number, number]> = [
        [OPENING + thickness * 2, thickness, 0, -half - thickness / 2],
        [OPENING + thickness * 2, thickness, 0, half + thickness / 2],
        [thickness, OPENING, -half - thickness / 2, 0],
        [thickness, OPENING, half + thickness / 2, 0],
      ];
      for (const [width, depth, x, y] of sides) {
        this.addBox(group, lining, lining, width, depth, bandHeight, x, y, z, SHAFT_RENDER_ORDER);
      }
    }
    const bottom = surface("floor", shade(tint, shadeForDepth(SHAFT_DEPTH)));
    this.addBox(group, bottom, bottom, OPENING, OPENING, 0.02, 0, 0, -SHAFT_DEPTH - 0.01, SHAFT_RENDER_ORDER);

    const mask = new THREE.Mesh(new THREE.PlaneGeometry(OPENING, OPENING), this.openingMask());
    mask.position.set(0, 0, OPENING_MASK_Z);
    mask.renderOrder = OPENING_MASK_RENDER_ORDER;
    group.add(mask);
  }

  /**
   * Writes the opening's depth without colour, after the shaft and before
   * the floor. The floor tiles are transparent and drawn later, so they
   * fail the depth test inside the opening and the shaft shows through.
   */
  private openingMask(): THREE.MeshBasicMaterial {
    this.openingMaskMaterial ??= new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    return this.openingMaskMaterial;
  }

  private addLadder(group: THREE.Group, height: number, renderOrder: number): void {
    const wood = surface(null, WOOD);
    const rung = surface(null, shade(WOOD, 0.88));
    const railSpacing = TILE_SIZE * 0.36;
    const rail = TILE_SIZE * 0.05;
    for (const side of [-1, 1]) {
      this.addBox(group, wood, wood, rail, rail, height, (side * railSpacing) / 2, 0, height / 2, renderOrder);
    }
    const rungGap = WALL_HEIGHT * 0.15;
    const rungSize = TILE_SIZE * 0.035;
    for (let z = rungGap * 0.8; z < height - rungSize; z += rungGap) {
      this.addBox(group, rung, rung, railSpacing, rungSize, rungSize, 0, 0, z, renderOrder);
    }
  }

  /** A box whose top face uses `top` and the other faces `side`. */
  private addBox(
    group: THREE.Group,
    top: Surface,
    side: Surface,
    width: number,
    depth: number,
    height: number,
    x: number,
    y: number,
    z: number,
    renderOrder: number = 0,
  ): void {
    const geometry = new THREE.BoxGeometry(width, depth, height);
    geometry.translate(x, y, z);
    applyWorldUvs(geometry, null);
    const sideMaterial = this.material(side);
    // BoxGeometry face order: +x, -x, +y, -y, +z (top), -z.
    const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, this.material(top), sideMaterial];
    this.addMesh(group, geometry, materials, renderOrder);
  }

  /**
   * One step block: a whole tread plank across the top, and riser planks on
   * the other faces, one plank per `rise` so a tall block reads as stacked
   * steps from the side.
   */
  private addStepBox(
    group: THREE.Group,
    tread: Surface,
    riser: Surface,
    width: number,
    depth: number,
    height: number,
    x: number,
    y: number,
    z: number,
    rise: number,
    renderOrder: number = 0,
  ): void {
    const geometry = new THREE.BoxGeometry(width, depth, height);
    geometry.translate(x, y, z);
    const left = x - width / 2;
    const near = y - depth / 2;
    const top = z + height / 2;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      const nz = Math.abs(normal.getZ(i));
      const across = nx > ny ? (position.getY(i) - near) / depth : (position.getX(i) - left) / width;
      // The image's top edge (v = 1) meets the tread above it.
      const v = nz >= 0.5 ? (position.getY(i) - near) / depth : 1 + (position.getZ(i) - top) / rise;
      uv.setXY(i, across, v);
    }
    uv.needsUpdate = true;
    const riserMaterial = this.material(riser);
    // BoxGeometry face order: +x, -x, +y, -y, +z (top), -z.
    const materials = [riserMaterial, riserMaterial, riserMaterial, riserMaterial, this.material(tread), riserMaterial];
    this.addMesh(group, geometry, materials, renderOrder);
  }

  /**
   * Adds a cylinder standing upright, or lying along the north axis when
   * `upright` is false. `length` is its height or depth respectively.
   */
  private addCylinder(
    group: THREE.Group,
    cap: Surface,
    side: Surface,
    radius: number,
    length: number,
    x: number,
    y: number,
    z: number,
    upright: boolean = true,
  ): void {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 24);
    // Three.js cylinders run along Y (north here); the world's up axis is Z.
    if (upright) {
      geometry.rotateX(Math.PI / 2);
    }
    geometry.translate(x, y, z);
    applyWorldUvs(geometry, { x, y, z, radius, upright });
    // CylinderGeometry groups: side, top cap, bottom cap.
    const sideMaterial = this.material(side);
    const capMaterial = this.material(cap);
    this.addMesh(group, geometry, [sideMaterial, capMaterial, capMaterial], 0);
  }

  private addMesh(
    group: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    renderOrder: number,
  ): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }

  private material(look: Surface): THREE.MeshBasicMaterial {
    const texture = look.texture ? this.texture(look.texture) : null;
    const color =
      !texture && look.fallback !== undefined ? multiplyColors(look.fallback, look.color) : look.color;
    const key = `${texture ? look.texture : "plain"}|${color.toString(16)}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, map: texture, toneMapped: false });
      this.patchMaterial(material);
      this.materials.set(key, material);
    }
    return material;
  }

  private texture(slot: TerrainPropTextureSlot): THREE.Texture | null {
    if (!this.textures.has(slot)) {
      const source = TERRAIN_PROP_TEXTURE_SOURCES[slot];
      const frame = source.tileIndex >= 0 ? this.resolveTextureFrame(source.tileIndex) : null;
      this.textures.set(slot, frame ? createRepeatingTexture(frame, source.crop, this.anisotropy) : null);
    }
    return this.textures.get(slot) ?? null;
  }
}

/**
 * Copies a pack tile's first frame, or the cropped part of it, into a
 * texture that repeats.
 */
function createRepeatingTexture(
  frame: HiResTileFrame,
  crop: TerrainPropTextureSource["crop"],
  anisotropy: number,
): THREE.Texture | null {
  if (typeof document === "undefined") {
    return null;
  }
  const sx = frame.sx + Math.round((crop?.x0 ?? 0) * frame.width);
  const sy = frame.sy + Math.round((crop?.y0 ?? 0) * frame.height);
  const width = Math.max(1, Math.round(((crop?.x1 ?? 1) - (crop?.x0 ?? 0)) * frame.width));
  const height = Math.max(1, Math.round(((crop?.y1 ?? 1) - (crop?.y0 ?? 0)) * frame.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(frame.source, sx, sy, width, height, 0, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (frame.filter === "nearest") {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
  } else {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
  }
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Projects texture coordinates from position so one texture repeat spans a
 * tile across and a wall's height up, like the floor and walls around the
 * prop. Upright faces map horizontal position and height; flat faces map
 * the floor plan. Cylinder sides wrap around their axis.
 */
function applyWorldUvs(
  geometry: THREE.BufferGeometry,
  cylinder: { x: number; y: number; z: number; radius: number; upright: boolean } | null,
): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    let u: number;
    let v: number;
    if (cylinder && cylinder.upright && nz < 0.5) {
      u = (Math.atan2(py - cylinder.y, px - cylinder.x) * cylinder.radius) / TILE_SIZE;
      v = pz / WALL_HEIGHT;
    } else if (cylinder && !cylinder.upright && ny < 0.5) {
      u = (Math.atan2(pz - cylinder.z, px - cylinder.x) * cylinder.radius) / TILE_SIZE;
      v = py / TILE_SIZE;
    } else if (nz >= nx && nz >= ny) {
      u = px / TILE_SIZE + 0.5;
      v = py / TILE_SIZE + 0.5;
    } else if (nx >= ny) {
      u = py / TILE_SIZE + 0.5;
      v = pz / WALL_HEIGHT;
    } else {
      u = px / TILE_SIZE + 0.5;
      v = pz / WALL_HEIGHT;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

/** Brightness at a depth below the floor: lit at the rim, near black at the bottom. */
function shadeForDepth(depth: number): number {
  const t = THREE.MathUtils.clamp(depth / SHAFT_DEPTH, 0, 1);
  return 1 - 0.82 * Math.pow(t, 0.8);
}

function multiplyColors(a: number, b: number): number {
  const channel = (shift: number) => Math.round((((a >> shift) & 0xff) * ((b >> shift) & 0xff)) / 255);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function shade(color: number, factor: number): number {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * factor)));
  const r = clamp((color >> 16) & 0xff);
  const g = clamp((color >> 8) & 0xff);
  const b = clamp(color & 0xff);
  return (r << 16) | (g << 8) | b;
}
