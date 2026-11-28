import * as THREE from "three";
import { TILE_SIZE } from "../../constants";
import { getGlyphCatalogEntry } from "../../glyphs/registry";
import type { RenderPipeline } from "../rendering/render-pipeline";
import type { TerminalRendering } from "../rendering/terminal-rendering";

export interface MapEffectsDependencies {
  readonly renderPipeline: Pick<RenderPipeline, "scene">;
  readonly terminalRendering: Pick<TerminalRendering, "isTerminalDisplayMode">;
}

/** One fading piece of an effect: a sprite or a flat glow plane. */
interface EffectPiece {
  readonly object: THREE.Sprite | THREE.Mesh;
  readonly material: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
  readonly velocity: THREE.Vector3 | null;
  readonly drag: number;
  readonly rise: number;
  readonly fromScale: number;
  readonly toScale: number;
  /** Stretch along the object's own x axis (streaks). */
  readonly stretch: number;
  readonly peakOpacity: number;
  readonly fadeInMs: number;
  readonly lifeMs: number;
  readonly delayMs: number;
  ageMs: number;
}

type BeamAxis = "vertical" | "horizontal" | "falling" | "rising" | null;

const BEAM_Z = 0.42;
const FLOOR_Z = 0.025;
const MAX_PIECES = 900;
/** A square reprinted with an effect glyph this soon only refreshes it. */
const RESPAWN_GUARD_MS = 70;

/**
 * NetHack colour index → effect hue. Effects are drawn additively, so dark
 * colours (black death rays, dark explosions) are lifted into a visible
 * violet rather than vanishing.
 */
const EFFECT_PALETTE: readonly number[] = [
  0x9a6bff, // black
  0xff4326, // red
  0x55ff6b, // green
  0xd08a3c, // brown
  0x4f7dff, // blue
  0xff4fd8, // magenta
  0x3fe6ff, // cyan
  0xd6d6d6, // gray
  0xffffff, // no colour
  0xff8a1c, // orange
  0x86ff4a, // bright green
  0xffe04a, // yellow
  0x62a8ff, // bright blue
  0xff70ff, // bright magenta
  0x86f6ff, // bright cyan
  0xf2f7ff, // white
];

/** Force bolts: pale, colourless force rather than an elemental hue. */
const FORCE_COLOR = new THREE.Color(0xb9c6ff);
const FORCE_HOT = new THREE.Color(0xe8eeff);
const FORCE_DUST = new THREE.Color(0x9a8f80);
const SHIELD_COLOR = new THREE.Color(0x7fe9ff);
const WHITE = new THREE.Color(0xffffff);

function effectColor(colorIndex: number | null | undefined): THREE.Color {
  const index =
    typeof colorIndex === "number" && Number.isFinite(colorIndex)
      ? Math.trunc(colorIndex) & 15
      : 8;
  return new THREE.Color(EFFECT_PALETTE[index]);
}

function beamAxisForChar(char: string | null | undefined): BeamAxis {
  switch (char) {
    case "|":
      return "vertical";
    case "-":
      return "horizontal";
    case "\\":
      return "falling";
    case "/":
      return "rising";
    default:
      return null;
  }
}

/** World-space angle (radians, about z) of a beam drawn with `axis`. */
function beamAngle(axis: Exclude<BeamAxis, null>): number {
  switch (axis) {
    case "vertical":
      return Math.PI / 2;
    case "horizontal":
      return 0;
    case "falling":
      // Map down-right is world (+x, -y).
      return -Math.PI / 4;
    case "rising":
      return Math.PI / 4;
  }
}

/**
 * Beams, rays and explosions as lasting light. The game draws a beam one
 * square at a time and erases it the moment it ends; each square it touches
 * leaves a glow, a streak and sparks here that fade over a fraction of a
 * second, so the path and the blast read as an effect rather than a flicker.
 */
export class MapEffects {
  constructor(private readonly dependencies: MapEffectsDependencies) {}

  private readonly pieces: EffectPiece[] = [];

  private readonly lastSpawnAtMsByKey = new Map<string, number>();

  private glowTexture: THREE.CanvasTexture | null = null;

  private streakTexture: THREE.CanvasTexture | null = null;

  private ringTexture: THREE.CanvasTexture | null = null;

  private readonly planeGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);

  /** A map square was drawn with `glyph`; light it up if it is an effect. */
  noteGlyph(x: number, y: number, glyph: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(glyph)) return;
    const entry = getGlyphCatalogEntry(Math.trunc(glyph));
    if (!entry || (entry.kind !== "zap" && entry.kind !== "explode")) return;
    if (this.dependencies.terminalRendering.isTerminalDisplayMode()) return;

    const key = `${x},${y}`;
    const nowMs = performance.now();
    const lastMs = this.lastSpawnAtMsByKey.get(key);
    if (lastMs !== undefined && nowMs - lastMs < RESPAWN_GUARD_MS) return;
    this.lastSpawnAtMsByKey.set(key, nowMs);
    if (this.lastSpawnAtMsByKey.size > 256) this.pruneSpawnGuard(nowMs);

    const color = effectColor(entry.color);
    if (entry.kind === "zap") {
      this.spawnBeamSquare(x, y, color, beamAxisForChar(entry.asciiChar));
    } else {
      // Explosion glyphs come in blocks of nine; the middle one is the centre.
      this.spawnExplosionSquare(x, y, color, entry.asciiChar === " ");
    }
  }

  /**
   * A force bolt (wand of striking, force bolt) crosses or lands on (x, y).
   * It has no glyph of its own; in flight it is a ripple of displaced air,
   * and where it lands it bursts as a shockwave.
   */
  forceBolt(x: number, y: number, outcome: unknown): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.dependencies.terminalRendering.isTerminalDisplayMode()) return;
    switch (outcome) {
      case "hit":
        this.spawnForceImpact(x, y);
        break;
      case "resisted":
        this.spawnForceDeflected(x, y);
        break;
      case "missed":
        this.spawnForceMissed(x, y);
        break;
      default:
        this.spawnForceFlight(x, y);
        break;
    }
  }

  update(deltaSeconds: number): void {
    if (this.pieces.length === 0) return;
    const deltaMs = deltaSeconds * 1000;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      piece.ageMs += deltaMs;
      const active = piece.ageMs - piece.delayMs;
      if (active < 0) {
        piece.object.visible = false;
        continue;
      }
      if (active >= piece.lifeMs) {
        this.removePiece(i);
        continue;
      }
      piece.object.visible = true;
      const t = active / piece.lifeMs;
      const fadeIn =
        piece.fadeInMs > 0 ? Math.min(1, active / piece.fadeInMs) : 1;
      // Hold bright, then fall off: reads as a flash that cools.
      const fadeOut = 1 - t * t * (3 - 2 * t);
      piece.material.opacity = piece.peakOpacity * fadeIn * fadeOut;
      const eased = 1 - (1 - t) * (1 - t);
      const scale = piece.fromScale + (piece.toScale - piece.fromScale) * eased;
      piece.object.scale.set(scale * piece.stretch, scale, 1);
      if (piece.velocity) {
        piece.object.position.addScaledVector(piece.velocity, deltaSeconds);
        const damping = Math.exp(-piece.drag * deltaSeconds);
        piece.velocity.x *= damping;
        piece.velocity.y *= damping;
        piece.velocity.z = piece.velocity.z * damping + piece.rise * deltaSeconds;
      }
    }
  }

  clear(): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) this.removePiece(i);
    this.lastSpawnAtMsByKey.clear();
  }

  dispose(): void {
    this.clear();
    this.glowTexture?.dispose();
    this.streakTexture?.dispose();
    this.ringTexture?.dispose();
    this.glowTexture = null;
    this.streakTexture = null;
    this.ringTexture = null;
    this.planeGeometry.dispose();
  }

  private spawnBeamSquare(x: number, y: number, color: THREE.Color, axis: BeamAxis): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    const hot = color.clone().lerp(new THREE.Color(0xffffff), 0.65);

    // Halo and white-hot core where the beam passed.
    this.addSprite(this.ensureGlowTexture(), color, cx, cy, BEAM_Z, {
      fromScale: 1.05, toScale: 1.35, peakOpacity: 0.85, fadeInMs: 25, lifeMs: 520,
    });
    this.addSprite(this.ensureGlowTexture(), hot, cx, cy, BEAM_Z, {
      fromScale: 0.55, toScale: 0.3, peakOpacity: 1, fadeInMs: 0, lifeMs: 300,
    });

    // The ray itself: a streak along the beam, crossed so it shows both from
    // above and at eye level. Each one overlaps its neighbours into a line.
    if (axis) {
      const angle = beamAngle(axis);
      const length = axis === "vertical" || axis === "horizontal" ? 1.25 : 1.75;
      const flat = this.addPlane(this.ensureStreakTexture(), hot, cx, cy, BEAM_Z, {
        fromScale: 0.42, toScale: 0.2, stretch: length / 0.42, peakOpacity: 0.95,
        fadeInMs: 0, lifeMs: 420,
      });
      flat.rotation.set(0, 0, angle);
      const upright = this.addPlane(this.ensureStreakTexture(), hot, cx, cy, BEAM_Z, {
        fromScale: 0.42, toScale: 0.2, stretch: length / 0.42, peakOpacity: 0.95,
        fadeInMs: 0, lifeMs: 420,
      });
      // Stand the plane up on its long edge, then turn it onto the beam.
      upright.rotation.set(Math.PI / 2, 0, angle, "ZXY");
    }

    // Light cast on the floor below.
    this.addPlane(this.ensureGlowTexture(), color, cx, cy, FLOOR_Z, {
      fromScale: 1.7, toScale: 2.0, peakOpacity: 0.55, fadeInMs: 30, lifeMs: 650,
    });

    // Sparks shed from the ray.
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.1;
      this.addSprite(this.ensureGlowTexture(), hot, cx, cy, BEAM_Z, {
        fromScale: 0.16, toScale: 0.04, peakOpacity: 1, fadeInMs: 0,
        lifeMs: 280 + Math.random() * 320,
        delayMs: Math.random() * 90,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.3) * 1.2),
        drag: 3.5,
      });
    }
  }

  private spawnExplosionSquare(x: number, y: number, color: THREE.Color, isCentre: boolean): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    const hot = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
    const z = 0.38;

    // A billowing ball of light on every square of the blast.
    this.addSprite(this.ensureGlowTexture(), color, cx, cy, z, {
      fromScale: 0.7, toScale: 1.9, peakOpacity: 0.95, fadeInMs: 40, lifeMs: 820,
    });
    this.addSprite(this.ensureGlowTexture(), hot, cx, cy, z, {
      fromScale: 0.5, toScale: 1.1, peakOpacity: 1, fadeInMs: 0, lifeMs: 420,
    });
    // The floor lit around it.
    this.addPlane(this.ensureGlowTexture(), color, cx, cy, FLOOR_Z, {
      fromScale: 2.0, toScale: 2.6, peakOpacity: 0.6, fadeInMs: 40, lifeMs: 1000,
    });

    // Embers flung out and drifting up.
    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.6 + Math.random() * 1.6;
      this.addSprite(this.ensureGlowTexture(), i % 2 === 0 ? hot : color, cx, cy, z, {
        fromScale: 0.2, toScale: 0.05, peakOpacity: 1, fadeInMs: 0,
        lifeMs: 550 + Math.random() * 550,
        delayMs: Math.random() * 120,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.4 + Math.random() * 1.4),
        drag: 2.6,
        rise: 0.6,
      });
    }

    if (isCentre) {
      // A blinding flash at the heart and a shockwave racing out over the floor.
      this.addSprite(this.ensureGlowTexture(), hot, cx, cy, z + 0.1, {
        fromScale: 1.4, toScale: 3.6, peakOpacity: 1, fadeInMs: 0, lifeMs: 380,
      });
      this.addPlane(this.ensureRingTexture(), hot, cx, cy, FLOOR_Z + 0.01, {
        fromScale: 0.6, toScale: 4.2, peakOpacity: 0.9, fadeInMs: 0, lifeMs: 620,
      });
    }
  }

  private spawnForceFlight(x: number, y: number): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    // A shimmering knot of force with a ring of air pushed out around it.
    this.addSprite(this.ensureGlowTexture(), FORCE_COLOR, cx, cy, BEAM_Z, {
      fromScale: 0.45, toScale: 0.8, peakOpacity: 0.7, fadeInMs: 20, lifeMs: 360,
    });
    this.addSprite(this.ensureRingTexture(), FORCE_HOT, cx, cy, BEAM_Z, {
      fromScale: 0.3, toScale: 1.15, peakOpacity: 0.85, fadeInMs: 0, lifeMs: 320,
    });
    this.addPlane(this.ensureRingTexture(), FORCE_COLOR, cx, cy, FLOOR_Z, {
      fromScale: 0.4, toScale: 1.4, peakOpacity: 0.45, fadeInMs: 0, lifeMs: 420,
    });
    // Dust kicked up from the floor as it passes.
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 0.6;
      this.addSprite(this.ensureGlowTexture(), FORCE_DUST, cx, cy, FLOOR_Z + 0.08, {
        fromScale: 0.14, toScale: 0.3, peakOpacity: 0.5, fadeInMs: 40,
        lifeMs: 380 + Math.random() * 220,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.5 + Math.random() * 0.5),
        drag: 4,
      });
    }
  }

  private spawnForceImpact(x: number, y: number): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    // The blow: a white flash, then rings racing out from the target.
    this.addSprite(this.ensureGlowTexture(), WHITE, cx, cy, BEAM_Z, {
      fromScale: 0.8, toScale: 1.9, peakOpacity: 1, fadeInMs: 0, lifeMs: 240,
    });
    this.addSprite(this.ensureRingTexture(), FORCE_HOT, cx, cy, BEAM_Z, {
      fromScale: 0.4, toScale: 2.4, peakOpacity: 1, fadeInMs: 0, lifeMs: 380,
    });
    this.addSprite(this.ensureRingTexture(), FORCE_COLOR, cx, cy, BEAM_Z, {
      fromScale: 0.3, toScale: 1.7, peakOpacity: 0.8, fadeInMs: 0, lifeMs: 460, delayMs: 70,
    });
    this.addPlane(this.ensureRingTexture(), FORCE_HOT, cx, cy, FLOOR_Z + 0.01, {
      fromScale: 0.5, toScale: 3.4, peakOpacity: 0.85, fadeInMs: 0, lifeMs: 560,
    });
    this.addPlane(this.ensureGlowTexture(), FORCE_COLOR, cx, cy, FLOOR_Z, {
      fromScale: 1.6, toScale: 2.2, peakOpacity: 0.5, fadeInMs: 0, lifeMs: 520,
    });
    // Debris flung outward, low and fast.
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.6 + Math.random() * 1.6;
      this.addSprite(this.ensureGlowTexture(), i % 2 === 0 ? WHITE : FORCE_DUST, cx, cy, BEAM_Z, {
        fromScale: 0.15, toScale: 0.05, peakOpacity: 1, fadeInMs: 0,
        lifeMs: 300 + Math.random() * 260,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.2) * 1.4),
        drag: 4.5,
        rise: -2.5,
      });
    }
  }

  private spawnForceDeflected(x: number, y: number): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    // "Boing!": the bolt splashes off a bubble of magic resistance.
    this.addSprite(this.ensureRingTexture(), SHIELD_COLOR, cx, cy, BEAM_Z, {
      fromScale: 1.25, toScale: 1.05, peakOpacity: 0.95, fadeInMs: 0, lifeMs: 520,
    });
    this.addSprite(this.ensureGlowTexture(), SHIELD_COLOR, cx, cy, BEAM_Z, {
      fromScale: 1.1, toScale: 1.3, peakOpacity: 0.45, fadeInMs: 0, lifeMs: 420,
    });
    this.addSprite(this.ensureRingTexture(), FORCE_HOT, cx, cy, BEAM_Z, {
      fromScale: 1.2, toScale: 2.0, peakOpacity: 0.7, fadeInMs: 0, lifeMs: 360, delayMs: 90,
    });
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 0.8;
      this.addSprite(this.ensureGlowTexture(), WHITE, cx + Math.cos(angle) * 0.5, cy + Math.sin(angle) * 0.5, BEAM_Z, {
        fromScale: 0.12, toScale: 0.03, peakOpacity: 1, fadeInMs: 0,
        lifeMs: 260 + Math.random() * 200,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (Math.random() - 0.5) * 1.2),
        drag: 4,
      });
    }
  }

  private spawnForceMissed(x: number, y: number): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    // The bolt goes wide: a puff of displaced air beside the target.
    this.addSprite(this.ensureRingTexture(), FORCE_COLOR, cx, cy, BEAM_Z, {
      fromScale: 0.5, toScale: 1.6, peakOpacity: 0.55, fadeInMs: 0, lifeMs: 380,
    });
    this.addPlane(this.ensureRingTexture(), FORCE_DUST, cx, cy, FLOOR_Z, {
      fromScale: 0.5, toScale: 1.8, peakOpacity: 0.4, fadeInMs: 0, lifeMs: 460,
    });
  }

  private addSprite(
    texture: THREE.Texture,
    color: THREE.Color,
    x: number,
    y: number,
    z: number,
    options: PieceOptions,
  ): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 975;
    this.addPiece(sprite, material, x, y, z, options);
    return sprite;
  }

  private addPlane(
    texture: THREE.Texture,
    color: THREE.Color,
    x: number,
    y: number,
    z: number,
    options: PieceOptions,
  ): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(this.planeGeometry, material);
    mesh.renderOrder = z <= FLOOR_Z + 0.02 ? 905 : 974;
    this.addPiece(mesh, material, x, y, z, options);
    return mesh;
  }

  private addPiece(
    object: THREE.Sprite | THREE.Mesh,
    material: THREE.SpriteMaterial | THREE.MeshBasicMaterial,
    x: number,
    y: number,
    z: number,
    options: PieceOptions,
  ): void {
    if (this.pieces.length >= MAX_PIECES) this.removePiece(0);
    object.position.set(x, y, z);
    const stretch = options.stretch ?? 1;
    object.scale.set(options.fromScale * stretch, options.fromScale, 1);
    object.visible = false;
    object.frustumCulled = false;
    this.dependencies.renderPipeline.scene.add(object);
    this.pieces.push({
      object,
      material,
      velocity: options.velocity ?? null,
      drag: options.drag ?? 0,
      rise: options.rise ?? 0,
      fromScale: options.fromScale,
      toScale: options.toScale,
      stretch,
      peakOpacity: options.peakOpacity,
      fadeInMs: options.fadeInMs,
      lifeMs: options.lifeMs,
      delayMs: options.delayMs ?? 0,
      ageMs: 0,
    });
  }

  private removePiece(index: number): void {
    const [piece] = this.pieces.splice(index, 1);
    this.dependencies.renderPipeline.scene.remove(piece.object);
    piece.material.dispose();
  }

  private pruneSpawnGuard(nowMs: number): void {
    for (const [key, atMs] of this.lastSpawnAtMsByKey) {
      if (nowMs - atMs >= RESPAWN_GUARD_MS) this.lastSpawnAtMsByKey.delete(key);
    }
  }

  private ensureGlowTexture(): THREE.CanvasTexture {
    if (this.glowTexture) return this.glowTexture;
    this.glowTexture = makeCanvasTexture(64, (context, size) => {
      const half = size / 2;
      const gradient = context.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.22, "rgba(255,255,255,0.85)");
      gradient.addColorStop(0.5, "rgba(255,255,255,0.32)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    return this.glowTexture;
  }

  private ensureStreakTexture(): THREE.CanvasTexture {
    if (this.streakTexture) return this.streakTexture;
    this.streakTexture = makeCanvasTexture(64, (context, size) => {
      // Bright along the middle row, soft across, tapering only at the very
      // ends so neighbouring squares join into one line.
      const across = context.createLinearGradient(0, 0, 0, size);
      across.addColorStop(0, "rgba(255,255,255,0)");
      across.addColorStop(0.36, "rgba(255,255,255,0.35)");
      across.addColorStop(0.5, "rgba(255,255,255,1)");
      across.addColorStop(0.64, "rgba(255,255,255,0.35)");
      across.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = across;
      context.fillRect(0, 0, size, size);
      context.globalCompositeOperation = "destination-in";
      const along = context.createLinearGradient(0, 0, size, 0);
      along.addColorStop(0, "rgba(255,255,255,0)");
      along.addColorStop(0.15, "rgba(255,255,255,1)");
      along.addColorStop(0.85, "rgba(255,255,255,1)");
      along.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = along;
      context.fillRect(0, 0, size, size);
    });
    return this.streakTexture;
  }

  private ensureRingTexture(): THREE.CanvasTexture {
    if (this.ringTexture) return this.ringTexture;
    this.ringTexture = makeCanvasTexture(128, (context, size) => {
      const half = size / 2;
      const gradient = context.createRadialGradient(half, half, half * 0.5, half, half, half);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.7, "rgba(255,255,255,0.9)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    return this.ringTexture;
  }
}

interface PieceOptions {
  readonly fromScale: number;
  readonly toScale: number;
  readonly stretch?: number;
  readonly peakOpacity: number;
  readonly fadeInMs: number;
  readonly lifeMs: number;
  readonly delayMs?: number;
  readonly velocity?: THREE.Vector3;
  readonly drag?: number;
  readonly rise?: number;
}

function makeCanvasTexture(
  size: number,
  paint: (context: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) paint(context, size);
  return new THREE.CanvasTexture(canvas);
}
