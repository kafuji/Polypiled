import * as THREE from "three";
import { getGlyphCatalogEntry } from "../../glyphs/registry";
import type { Camera } from "../camera/camera";
import type { WaterSplash } from "../effects/water-splash";
import type { MovementInput } from "../input/movement-input";
import type { EngineState } from "../runtime/engine-state";
import type { PlayerMovement } from "../world/player-movement";
import type { EntityBillboards } from "./entity-billboards";
import {
  HOVER_BOB_PERIOD_MS,
  WATER_FALL_HOLD_MS,
  WATER_FALL_SINK_MS,
  WATER_FALL_TOTAL_MS,
  resolveGroundingProfile,
  resolveHeroPose,
  type GroundingProfile,
} from "./grounding-profiles";
import type { Lighting } from "./lighting";
import type { RenderPipeline } from "./render-pipeline";
import {
  EMPTY_SPRITE_ALPHA_METRICS,
  measureSpriteAlpha,
  type SpriteAlphaMetrics,
} from "./sprite-alpha-metrics";
import type { TilesetAssets } from "./tileset-assets";

export interface EntityGroundingDependencies {
  readonly camera: Pick<Camera, "getActiveCamera">;
  readonly engineState: Pick<EngineState, "clientOptions">;
  readonly entityBillboards: Pick<
    EntityBillboards,
    | "monsterBillboards"
    | "entityBlobShadows"
    | "ensureEntityBlobShadowTexture"
    | "acquireMonsterBillboardTexture"
    | "releaseMonsterBillboardTexture"
  >;
  readonly lighting: Pick<Lighting, "patchMaterialForVignette">;
  readonly movementInput: Pick<MovementInput, "isFpsMode">;
  readonly playerMovement: Pick<PlayerMovement, "hasSeenPlayerPosition" | "playerPos">;
  readonly renderPipeline: Pick<RenderPipeline, "scene">;
  readonly tilesetAssets: Pick<TilesetAssets, "isHiResTilesActive">;
  readonly waterSplash: Pick<WaterSplash, "splash" | "drip">;
  /** Status condition bits (BL_MASK_*). */
  readonly readConditionMask: () => number;
  /** Name of the trap under the hero, from the floor report. */
  readonly readTrapHere: () => string | null;
}

interface AppliedPose {
  readonly baseCenterX: number;
  readonly baseCenterY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly tint: readonly [number, number, number] | null;
}

/** Legacy blob shadow look (entity-billboards ensureEntityBlobShadow). */
const LEGACY_SHADOW_OPACITY = 0.58;
const SHADOW_PLANE_SIZE = 0.8;
/** How high a rider sits on the steed, in rider heights. */
const RIDER_RISE = 0.36;
const STUMBLE_MS = 320;
const EASE_RATE = 7;

/**
 * Seats every entity sprite on the ground each frame: floating sprites bob
 * above a shadow on the floor, the hero rises while levitating and sinks into
 * pits, lava and water, a rider sits on its steed, and in high-resolution
 * tile mode each kind of thing casts the shadow its profile asks for.
 *
 * Poses move only the sprite's anchor (center), never its position, so
 * movement transitions and tile updates keep working on the true position.
 */
export class EntityGrounding {
  constructor(private readonly dependencies: EntityGroundingDependencies) {}

  private readonly applied = new Map<THREE.Sprite, AppliedPose>();

  private readonly groundedShadows = new Set<THREE.Mesh>();

  private readonly metricsCache = new WeakMap<THREE.Texture, SpriteAlphaMetrics>();

  private readonly silhouetteCache = new WeakMap<THREE.Texture, THREE.CanvasTexture>();

  private contactTexture: THREE.CanvasTexture | null = null;

  private heroLift = 0;

  private heroSink = 0;

  private heroWaterFallAtMs: number | null = null;

  private heroDripped = true;

  private stumble: { x: number; y: number; startMs: number } | null = null;

  private lastNowMs: number | null = null;

  private heldHeroTextureKey: string | null = null;

  private heroScale = new THREE.Vector2(1, 1);

  private rider: THREE.Sprite | null = null;

  private riding = false;

  private readonly cameraRight = new THREE.Vector3();

  private measureCanvas: HTMLCanvasElement | null = null;

  /** The sprite that shows the hero: the rider while mounted. */
  heroSprite(): THREE.Sprite | null {
    if (this.riding && this.rider?.visible) return this.rider;
    const { x, y } = this.dependencies.playerMovement.playerPos;
    return this.dependencies.entityBillboards.monsterBillboards.get(`${x},${y}`) ?? null;
  }

  /** The hero (monsterId null) or a seen monster fell into water at (x, y). */
  noteWaterFall(monsterId: number | null, x: number, y: number, nowMs: number = performance.now()): void {
    if (this.dependencies.engineState.clientOptions.tilesetMode === "terminal") return;
    if (monsterId === null) {
      this.heroWaterFallAtMs = nowMs;
      this.heroDripped = false;
      this.dependencies.waterSplash.splash(x, y, 1);
    } else {
      this.dependencies.waterSplash.splash(x, y, 0.8);
    }
  }

  /** A missed blow carries the hero a little towards (x, y) on screen. */
  noteHeroStumble(screenDirection: { x: number; y: number }, nowMs: number = performance.now()): void {
    this.stumble = { x: screenDirection.x, y: screenDirection.y, startMs: nowMs };
  }

  update(nowMs: number = performance.now()): void {
    const deltaSeconds =
      this.lastNowMs === null ? 1 / 60 : Math.min(0.25, Math.max(0, (nowMs - this.lastNowMs) / 1000));
    this.lastNowMs = nowMs;
    this.restorePoses();
    const options = this.dependencies.engineState.clientOptions;
    if (options.tilesetMode === "terminal" || this.dependencies.movementInput.isFpsMode()) {
      this.restoreAllShadows();
      this.hideRider();
      return;
    }
    const hiRes = this.dependencies.tilesetAssets.isHiResTilesActive();
    this.updateCameraAxes();
    const { x: px, y: py } = this.dependencies.playerMovement.playerPos;
    const heroKey = this.dependencies.playerMovement.hasSeenPlayerPosition ? `${px},${py}` : null;
    const heroPose = resolveHeroPose({
      conditionMask: this.dependencies.readConditionMask(),
      trapHere: this.dependencies.readTrapHere(),
      waterFallAtMs: this.heroWaterFallAtMs,
      nowMs,
    });
    const waterFallElapsed = this.heroWaterFallAtMs === null ? Infinity : nowMs - this.heroWaterFallAtMs;
    if (!this.heroDripped && waterFallElapsed >= WATER_FALL_SINK_MS + WATER_FALL_HOLD_MS) {
      this.heroDripped = true;
      this.dependencies.waterSplash.drip(px, py);
    }
    if (waterFallElapsed >= WATER_FALL_TOTAL_MS) this.heroWaterFallAtMs = null;
    const ease = Math.min(1, deltaSeconds * EASE_RATE);
    this.heroLift += (heroPose.lift - this.heroLift) * ease;
    this.heroSink = waterFallElapsed < WATER_FALL_TOTAL_MS
      ? heroPose.sink
      : this.heroSink + (heroPose.sink - this.heroSink) * ease;

    let heroSprite: THREE.Sprite | null = null;
    for (const [key, sprite] of this.dependencies.entityBillboards.monsterBillboards) {
      const isHero = key === heroKey;
      if (isHero) heroSprite = sprite;
      const profile = this.profileFor(sprite);
      let lift = 0;
      let bob = 0;
      let sink = 0;
      let sway = 0;
      let tint: AppliedPose["tint"] = null;
      let shadowVisible = true;
      if (isHero) {
        lift = this.heroLift;
        bob = heroPose.bob * (heroPose.lift > 0 ? this.heroLift / heroPose.lift : 0);
        sink = this.heroSink;
        sway = heroPose.sway;
        tint = heroPose.tint;
        shadowVisible = heroPose.shadowVisible;
      } else if (hiRes && profile.kind === "hover") {
        lift = profile.lift;
        bob = profile.bob;
      }
      const phase = (sprite.id * 0.618) % 1;
      const bobOffset = bob * Math.sin(((nowMs / HOVER_BOB_PERIOD_MS) + phase) * Math.PI * 2);
      const height = lift + bobOffset - sink;
      let shiftX = sway * Math.sin(nowMs * 0.004);
      let shiftY = height;
      if (isHero && this.stumble) {
        const t = (nowMs - this.stumble.startMs) / STUMBLE_MS;
        if (t >= 1) {
          this.stumble = null;
        } else if (t > 0) {
          const envelope = Math.sin(Math.PI * t);
          shiftX += this.stumble.x * 0.07 * envelope;
          shiftY += this.stumble.y * 0.04 * envelope;
        }
      }
      this.applyPose(sprite, shiftX, shiftY, tint);
      const shadow = this.dependencies.entityBillboards.entityBlobShadows.get(key);
      if (shadow) {
        this.placeShadow(shadow, sprite, hiRes ? profile : null, Math.max(0, lift + bobOffset), shadowVisible, isHero);
      }
    }
    this.syncRider(heroSprite);
  }

  dispose(): void {
    this.restorePoses();
    this.restoreAllShadows();
    if (this.rider) {
      this.dependencies.renderPipeline.scene.remove(this.rider);
      this.rider.material.dispose();
      this.rider = null;
    }
    if (this.heldHeroTextureKey) {
      this.dependencies.entityBillboards.releaseMonsterBillboardTexture(this.heldHeroTextureKey);
      this.heldHeroTextureKey = null;
    }
    this.contactTexture?.dispose();
    this.contactTexture = null;
  }

  private profileFor(sprite: THREE.Sprite): GroundingProfile {
    const glyph = typeof sprite.userData.sourceGlyph === "number" ? sprite.userData.sourceGlyph : null;
    if (sprite.userData.groundingGlyph !== glyph || !sprite.userData.groundingProfile) {
      sprite.userData.groundingGlyph = glyph;
      sprite.userData.groundingProfile = resolveGroundingProfile(glyph);
    }
    return sprite.userData.groundingProfile as GroundingProfile;
  }

  private restorePoses(): void {
    for (const [sprite, pose] of this.applied) {
      if (sprite.center.x === pose.centerX && sprite.center.y === pose.centerY) {
        sprite.center.set(pose.baseCenterX, pose.baseCenterY);
      }
      if (pose.tint) {
        const material = sprite.material;
        if (
          material instanceof THREE.SpriteMaterial &&
          material.color.r === pose.tint[0] &&
          material.color.g === pose.tint[1] &&
          material.color.b === pose.tint[2]
        ) {
          material.color.setRGB(1, 1, 1);
        }
      }
    }
    this.applied.clear();
  }

  private applyPose(
    sprite: THREE.Sprite,
    shiftX: number,
    shiftY: number,
    tint: AppliedPose["tint"],
  ): void {
    const hasShift = Math.abs(shiftX) > 1e-4 || Math.abs(shiftY) > 1e-4;
    let appliedTint: AppliedPose["tint"] = null;
    if (tint) {
      const material = sprite.material;
      // Leave the colour alone while a damage flash owns it.
      if (
        material instanceof THREE.SpriteMaterial &&
        material.color.r === 1 &&
        material.color.g === 1 &&
        material.color.b === 1
      ) {
        material.color.setRGB(tint[0], tint[1], tint[2]);
        appliedTint = [material.color.r, material.color.g, material.color.b];
      }
    }
    if (!hasShift && !appliedTint) return;
    const baseCenterX = sprite.center.x;
    const baseCenterY = sprite.center.y;
    // Lowering the anchor raises the picture; offsets are in sprite sizes.
    sprite.center.set(baseCenterX - shiftX, baseCenterY - shiftY);
    this.applied.set(sprite, {
      baseCenterX,
      baseCenterY,
      centerX: sprite.center.x,
      centerY: sprite.center.y,
      tint: appliedTint,
    });
  }

  private updateCameraAxes(): void {
    const camera = this.dependencies.camera.getActiveCamera();
    camera.updateMatrixWorld();
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this.cameraRight.z = 0;
    if (this.cameraRight.lengthSq() < 1e-8) this.cameraRight.set(1, 0, 0);
    this.cameraRight.normalize();
  }

  private placeShadow(
    shadow: THREE.Mesh,
    sprite: THREE.Sprite,
    profile: GroundingProfile | null,
    heightAbove: number,
    visible: boolean,
    isHero: boolean,
  ): void {
    const material = shadow.material as THREE.MeshBasicMaterial;
    const rx = this.cameraRight.x;
    const ry = this.cameraRight.y;
    // Away from the viewer along the floor.
    const fx = -ry;
    const fy = rx;
    const scaleX = Math.abs(sprite.scale.x);
    const scaleY = Math.abs(sprite.scale.y);
    const shrink = 1 / (1 + heightAbove * 3);

    if (!profile) {
      // Legacy blob: only the hero's shadow reacts, to floating or sinking.
      if (!isHero || (heightAbove <= 1e-4 && visible)) {
        if (this.groundedShadows.has(shadow)) this.restoreShadow(shadow, sprite);
        return;
      }
      this.groundedShadows.add(shadow);
      const contentWidth = typeof sprite.userData.contentWidth === "number" ? sprite.userData.contentWidth : 1;
      const legacy = (scaleX * contentWidth * 1.25) / SHADOW_PLANE_SIZE;
      shadow.visible = visible;
      material.opacity = LEGACY_SHADOW_OPACITY * shrink;
      shadow.scale.set(legacy * shrink, legacy * 0.82 * shrink, 1);
      shadow.position.x = sprite.position.x;
      shadow.position.y = sprite.position.y;
      return;
    }

    this.groundedShadows.add(shadow);
    if (profile.kind === "none" || !visible) {
      shadow.visible = false;
      return;
    }
    const texture = sprite.material instanceof THREE.SpriteMaterial ? sprite.material.map : null;
    const metrics = texture ? this.metricsFor(texture) : EMPTY_SPRITE_ALPHA_METRICS;
    shadow.visible = sprite.visible;
    shadow.rotation.z = Math.atan2(ry, rx);
    let centerX = sprite.position.x;
    let centerY = sprite.position.y;
    if (profile.kind === "silhouette" && texture) {
      const map = this.silhouetteFor(texture);
      if (material.map !== map) {
        material.map = map;
        material.needsUpdate = true;
      }
      const depth = scaleY * 0.38;
      const back = depth / 2 - (1 - metrics.bottomV) * depth;
      centerX += fx * back;
      centerY += fy * back;
      shadow.scale.set(scaleX / SHADOW_PLANE_SIZE, depth / SHADOW_PLANE_SIZE, 1);
      material.opacity = 0.5;
    } else {
      const contact = this.ensureContactTexture();
      const map = profile.kind === "hover" ? this.dependencies.entityBillboards.ensureEntityBlobShadowTexture() : contact;
      if (material.map !== map) {
        material.map = map;
        material.needsUpdate = true;
      }
      if (profile.kind === "hover") {
        const width = Math.max(0.2, metrics.maxU - metrics.minU) * scaleX * 0.8 * shrink;
        shadow.scale.set(width / SHADOW_PLANE_SIZE, (width * 0.6) / SHADOW_PLANE_SIZE, 1);
        material.opacity = 0.5 * shrink;
      } else {
        const contactU = (metrics.contactMinU + metrics.contactMaxU) / 2;
        const width = Math.max(0.22, (metrics.contactMaxU - metrics.contactMinU) * 1.2) * scaleX * shrink;
        const shift = (contactU - sprite.center.x) * scaleX;
        centerX += rx * shift;
        centerY += ry * shift;
        shadow.scale.set(width / SHADOW_PLANE_SIZE, (width * 0.42) / SHADOW_PLANE_SIZE, 1);
        material.opacity = 0.66 * shrink;
      }
    }
    shadow.position.x = centerX;
    shadow.position.y = centerY;
  }

  private restoreShadow(shadow: THREE.Mesh, sprite: THREE.Sprite | null): void {
    this.groundedShadows.delete(shadow);
    const material = shadow.material as THREE.MeshBasicMaterial;
    const blob = this.dependencies.entityBillboards.ensureEntityBlobShadowTexture();
    if (material.map !== blob) {
      material.map = blob;
      material.needsUpdate = true;
    }
    material.opacity = LEGACY_SHADOW_OPACITY;
    shadow.rotation.z = 0;
    shadow.visible = true;
    if (sprite) {
      const contentWidth = typeof sprite.userData.contentWidth === "number" ? sprite.userData.contentWidth : 1;
      const legacy = (Math.abs(sprite.scale.x) * contentWidth * 1.25) / SHADOW_PLANE_SIZE;
      shadow.scale.set(legacy, legacy * 0.82, 1);
      shadow.position.x = sprite.position.x;
      shadow.position.y = sprite.position.y;
    }
  }

  private restoreAllShadows(): void {
    if (this.groundedShadows.size === 0) return;
    const spriteByShadow = new Map<THREE.Mesh, THREE.Sprite>();
    for (const [key, shadow] of this.dependencies.entityBillboards.entityBlobShadows) {
      const sprite = this.dependencies.entityBillboards.monsterBillboards.get(key);
      if (sprite) spriteByShadow.set(shadow, sprite);
    }
    for (const shadow of Array.from(this.groundedShadows)) {
      this.restoreShadow(shadow, spriteByShadow.get(shadow) ?? null);
    }
  }

  private syncRider(heroSprite: THREE.Sprite | null): void {
    if (!heroSprite) {
      this.hideRider();
      return;
    }
    const glyph = typeof heroSprite.userData.sourceGlyph === "number" ? heroSprite.userData.sourceGlyph : null;
    const kind = glyph === null ? null : getGlyphCatalogEntry(glyph)?.kind ?? null;
    const textureKey = typeof heroSprite.userData.textureKey === "string" ? heroSprite.userData.textureKey : "";
    if (kind !== "ridden") {
      // Remember the hero's own picture to seat it on a steed later.
      if (textureKey && textureKey !== this.heldHeroTextureKey) {
        const material = heroSprite.material;
        if (material instanceof THREE.SpriteMaterial && material.map) {
          const map = material.map;
          this.dependencies.entityBillboards.acquireMonsterBillboardTexture(textureKey, () => map as THREE.CanvasTexture);
          if (this.heldHeroTextureKey) {
            this.dependencies.entityBillboards.releaseMonsterBillboardTexture(this.heldHeroTextureKey);
          }
          this.heldHeroTextureKey = textureKey;
        }
      }
      this.heroScale.set(Math.abs(heroSprite.scale.x), Math.abs(heroSprite.scale.y));
      this.hideRider();
      return;
    }
    const heroTexture = this.heldHeroTexture();
    if (!heroTexture) {
      this.hideRider();
      return;
    }
    let rider = this.rider;
    if (!rider) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false });
      this.dependencies.lighting.patchMaterialForVignette(material, { entity: true });
      rider = new THREE.Sprite(material);
      rider.name = "player-rider";
      this.dependencies.renderPipeline.scene.add(rider);
      this.rider = rider;
    }
    const material = rider.material;
    if (material.map !== heroTexture) {
      material.map = heroTexture;
      material.needsUpdate = true;
    }
    const steedMaterial = heroSprite.material;
    if (steedMaterial instanceof THREE.SpriteMaterial) {
      material.opacity = steedMaterial.opacity;
      material.depthTest = steedMaterial.depthTest;
      material.alphaTest = steedMaterial.alphaTest;
    }
    const riderScaleY = this.heroScale.y || Math.abs(heroSprite.scale.y);
    rider.scale.set(this.heroScale.x || Math.abs(heroSprite.scale.x), riderScaleY, 1);
    rider.position.copy(heroSprite.position);
    rider.center.set(
      heroSprite.center.x,
      heroSprite.center.y - (RIDER_RISE * Math.abs(heroSprite.scale.y)) / Math.max(1e-6, riderScaleY),
    );
    rider.renderOrder = heroSprite.renderOrder + 0.02;
    rider.visible = heroSprite.visible;
    this.riding = true;
  }

  private heldHeroTexture(): THREE.Texture | null {
    if (!this.heldHeroTextureKey) return null;
    let texture: THREE.Texture | null = null;
    // Peek without changing the count: acquire then release.
    try {
      texture = this.dependencies.entityBillboards.acquireMonsterBillboardTexture(this.heldHeroTextureKey, () => {
        throw new Error("hero texture gone");
      });
      this.dependencies.entityBillboards.releaseMonsterBillboardTexture(this.heldHeroTextureKey);
    } catch {
      this.heldHeroTextureKey = null;
      return null;
    }
    return texture;
  }

  private hideRider(): void {
    this.riding = false;
    if (this.rider) this.rider.visible = false;
  }

  private metricsFor(texture: THREE.Texture): SpriteAlphaMetrics {
    const cached = this.metricsCache.get(texture);
    if (cached) return cached;
    const image = texture.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
    let metrics = EMPTY_SPRITE_ALPHA_METRICS;
    const width = Number(image?.width) || 0;
    const height = Number(image?.height) || 0;
    if (image && width > 0 && height > 0) {
      const scale = Math.min(1, 96 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = (this.measureCanvas ??= document.createElement("canvas"));
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        try {
          context.clearRect(0, 0, w, h);
          context.drawImage(image, 0, 0, w, h);
          metrics = measureSpriteAlpha(context.getImageData(0, 0, w, h).data, w, h);
        } catch {
          metrics = EMPTY_SPRITE_ALPHA_METRICS;
        }
      }
    }
    this.metricsCache.set(texture, metrics);
    return metrics;
  }

  private silhouetteFor(texture: THREE.Texture): THREE.CanvasTexture {
    const cached = this.silhouetteCache.get(texture);
    if (cached) return cached;
    const image = texture.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
    const width = 128;
    const height = 64;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context && image && Number(image.width) > 0) {
      const pad = 4;
      try {
        context.filter = "blur(2px)";
        context.drawImage(image, pad, pad, width - pad * 2, height - pad * 2);
        context.filter = "none";
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "rgba(0, 0, 0, 0.85)";
        context.fillRect(0, 0, width, height);
      } catch {
        context.clearRect(0, 0, width, height);
      }
    }
    const silhouette = new THREE.CanvasTexture(canvas);
    silhouette.magFilter = THREE.LinearFilter;
    silhouette.minFilter = THREE.LinearFilter;
    silhouette.generateMipmaps = false;
    this.silhouetteCache.set(texture, silhouette);
    texture.addEventListener("dispose", () => {
      silhouette.dispose();
      this.silhouetteCache.delete(texture);
      this.metricsCache.delete(texture);
    });
    return silhouette;
  }

  private ensureContactTexture(): THREE.CanvasTexture {
    if (this.contactTexture) return this.contactTexture;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0.8)");
      gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.5)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    this.contactTexture = new THREE.CanvasTexture(canvas);
    this.contactTexture.magFilter = THREE.LinearFilter;
    this.contactTexture.minFilter = THREE.LinearFilter;
    this.contactTexture.generateMipmaps = false;
    return this.contactTexture;
  }
}
