import * as THREE from "three";
import { TILE_SIZE } from "../../constants";
import type { RenderPipeline } from "../rendering/render-pipeline";

export interface WaterSplashDependencies {
  readonly renderPipeline: Pick<RenderPipeline, "scene">;
}

interface Droplet {
  readonly sprite: THREE.Sprite;
  readonly velocity: THREE.Vector3;
  ageMs: number;
  readonly lifeMs: number;
  readonly delayMs: number;
}

interface Ripple {
  readonly mesh: THREE.Mesh;
  ageMs: number;
  readonly lifeMs: number;
  readonly delayMs: number;
  readonly maxScale: number;
}

const FLOOR_Z = 0.03;
const GRAVITY = 9.5;
const MAX_DROPLETS = 160;

/**
 * Splashes on water: a burst of droplets and spreading rings where something
 * falls in, and a few drips where the hero climbs out.
 */
export class WaterSplash {
  constructor(private readonly dependencies: WaterSplashDependencies) {}

  private dropletTexture: THREE.CanvasTexture | null = null;

  private rippleTexture: THREE.CanvasTexture | null = null;

  private readonly droplets: Droplet[] = [];

  private readonly ripples: Ripple[] = [];

  /** Something fell into the water at map square (x, y). */
  splash(x: number, y: number, strength: number = 1): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    const count = Math.round(22 * strength);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.6 + Math.random() * 1.1) * strength;
      this.addDroplet(
        cx + Math.cos(angle) * 0.12,
        cy + Math.sin(angle) * 0.12,
        FLOOR_Z + 0.05,
        new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 1.6 + Math.random() * 2.2 * strength),
        520 + Math.random() * 380,
        Math.random() * 60,
        0.07 + Math.random() * 0.06,
      );
    }
    this.addRipple(cx, cy, 0, 900, 1.25 * strength);
    this.addRipple(cx, cy, 220, 1000, 0.95 * strength);
  }

  /** The hero climbs out at (x, y): water runs off for a moment. */
  drip(x: number, y: number): void {
    const cx = x * TILE_SIZE;
    const cy = -y * TILE_SIZE;
    for (let i = 0; i < 9; i++) {
      this.addDroplet(
        cx + (Math.random() - 0.5) * 0.4,
        cy + (Math.random() - 0.5) * 0.15,
        FLOOR_Z + 0.25 + Math.random() * 0.45,
        new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, 0),
        420 + Math.random() * 260,
        i * 70 + Math.random() * 80,
        0.05 + Math.random() * 0.03,
      );
    }
    this.addRipple(cx, cy, 120, 700, 0.6);
  }

  update(deltaSeconds: number): void {
    const deltaMs = deltaSeconds * 1000;
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const droplet = this.droplets[i];
      droplet.ageMs += deltaMs;
      const active = droplet.ageMs - droplet.delayMs;
      if (active < 0) {
        droplet.sprite.visible = false;
        continue;
      }
      droplet.sprite.visible = true;
      droplet.velocity.z -= GRAVITY * deltaSeconds;
      droplet.sprite.position.addScaledVector(droplet.velocity, deltaSeconds);
      const material = droplet.sprite.material as THREE.SpriteMaterial;
      material.opacity = 0.85 * (1 - active / droplet.lifeMs);
      if (active >= droplet.lifeMs || droplet.sprite.position.z < FLOOR_Z - 0.02) {
        this.removeDroplet(i);
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i];
      ripple.ageMs += deltaMs;
      const active = ripple.ageMs - ripple.delayMs;
      if (active < 0) {
        ripple.mesh.visible = false;
        continue;
      }
      ripple.mesh.visible = true;
      const t = Math.min(1, active / ripple.lifeMs);
      const scale = 0.15 + (1 - (1 - t) ** 2) * ripple.maxScale;
      ripple.mesh.scale.set(scale, scale, 1);
      (ripple.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
      if (t >= 1) this.removeRipple(i);
    }
  }

  clear(): void {
    for (let i = this.droplets.length - 1; i >= 0; i--) this.removeDroplet(i);
    for (let i = this.ripples.length - 1; i >= 0; i--) this.removeRipple(i);
  }

  dispose(): void {
    this.clear();
    this.dropletTexture?.dispose();
    this.rippleTexture?.dispose();
    this.dropletTexture = null;
    this.rippleTexture = null;
  }

  private addDroplet(
    x: number,
    y: number,
    z: number,
    velocity: THREE.Vector3,
    lifeMs: number,
    delayMs: number,
    size: number,
  ): void {
    if (this.droplets.length >= MAX_DROPLETS) this.removeDroplet(0);
    const material = new THREE.SpriteMaterial({
      map: this.ensureDropletTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    sprite.renderOrder = 960;
    sprite.visible = false;
    this.dependencies.renderPipeline.scene.add(sprite);
    this.droplets.push({ sprite, velocity, ageMs: 0, lifeMs, delayMs });
  }

  private addRipple(x: number, y: number, delayMs: number, lifeMs: number, maxScale: number): void {
    const material = new THREE.MeshBasicMaterial({
      map: this.ensureRippleTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE), material);
    mesh.position.set(x, y, FLOOR_Z);
    mesh.renderOrder = 906;
    mesh.visible = false;
    this.dependencies.renderPipeline.scene.add(mesh);
    this.ripples.push({ mesh, ageMs: 0, lifeMs, delayMs, maxScale });
  }

  private removeDroplet(index: number): void {
    const [droplet] = this.droplets.splice(index, 1);
    this.dependencies.renderPipeline.scene.remove(droplet.sprite);
    droplet.sprite.material.dispose();
  }

  private removeRipple(index: number): void {
    const [ripple] = this.ripples.splice(index, 1);
    this.dependencies.renderPipeline.scene.remove(ripple.mesh);
    ripple.mesh.geometry.dispose();
    (ripple.mesh.material as THREE.Material).dispose();
  }

  private ensureDropletTexture(): THREE.CanvasTexture {
    if (this.dropletTexture) return this.dropletTexture;
    const size = 16;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(size * 0.42, size * 0.4, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(235, 248, 255, 1)");
      gradient.addColorStop(0.45, "rgba(150, 205, 255, 0.9)");
      gradient.addColorStop(1, "rgba(90, 160, 240, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    this.dropletTexture = new THREE.CanvasTexture(canvas);
    return this.dropletTexture;
  }

  private ensureRippleTexture(): THREE.CanvasTexture {
    if (this.rippleTexture) return this.rippleTexture;
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.48);
      gradient.addColorStop(0, "rgba(200, 235, 255, 0)");
      gradient.addColorStop(0.7, "rgba(220, 242, 255, 0.85)");
      gradient.addColorStop(1, "rgba(200, 235, 255, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    }
    this.rippleTexture = new THREE.CanvasTexture(canvas);
    return this.rippleTexture;
  }
}
