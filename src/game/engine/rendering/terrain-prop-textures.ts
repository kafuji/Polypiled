/**
 * Textures painted in code for the terrain models that need a look of their
 * own: the borrowed floor and wall art would make them blend into the room.
 * Every texture tiles seamlessly and is drawn the same way each time.
 */
export type GeneratedPropTexture = "marble" | "marbleTrim" | "water" | "waterFall";

const SIZE = 256;

export function paintPropTexture(kind: GeneratedPropTexture): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const image = context.createImageData(SIZE, SIZE);
  const paint = PAINTERS[kind];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = paint(x / SIZE, y / SIZE);
      const i = (y * SIZE + x) * 4;
      image.data[i] = clampByte(r);
      image.data[i + 1] = clampByte(g);
      image.data[i + 2] = clampByte(b);
      image.data[i + 3] = clampByte(a);
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

const LATTICE = 64;

/**
 * Value noise on a lattice that wraps, so textures repeat without seams.
 * Coordinates are in texture repeats (0..1 is one tile of the texture).
 */
class PeriodicNoise {
  private readonly values = new Float32Array(LATTICE * LATTICE);

  constructor(seed: number) {
    const random = mulberry32(seed);
    for (let i = 0; i < this.values.length; i++) {
      this.values[i] = random();
    }
  }

  sample(u: number, v: number, cells: number, cellsV: number = cells): number {
    const x = u * cells;
    const y = v * cellsV;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const at = (ix: number, iy: number) => {
      const wx = (((ix % cells) + cells) % cells) % LATTICE;
      const wy = (((iy % cellsV) + cellsV) % cellsV) % LATTICE;
      return this.values[wy * LATTICE + wx];
    };
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  }

  /** Several octaves of noise, finest last; `cells` is the coarsest lattice size. */
  fbm(u: number, v: number, cells: number, octaves: number, cellsV: number = cells): number {
    let total = 0;
    let weight = 0.5;
    let sum = 0;
    let size = cells;
    let sizeV = cellsV;
    for (let i = 0; i < octaves; i++) {
      total += this.sample(u, v, size, sizeV) * weight;
      sum += weight;
      weight *= 0.5;
      size *= 2;
      sizeV *= 2;
    }
    return total / sum;
  }
}

type Painter = (u: number, v: number) => [number, number, number, number];

const marbleNoise = new PeriodicNoise(11);
const veinNoise = new PeriodicNoise(23);
const waterNoise = new PeriodicNoise(37);
const fallNoise = new PeriodicNoise(51);

const PAINTERS: Record<GeneratedPropTexture, Painter> = {
  // Pale warm marble with soft grey-blue veins.
  marble: (u, v) => {
    const cloud = marbleNoise.fbm(u, v, 4, 4);
    const warp = veinNoise.fbm(u, v, 3, 4);
    const vein = Math.abs(Math.sin((u * 2 + v * 3 + warp * 2.2) * Math.PI * 2));
    const line = Math.pow(1 - vein, 9);
    const fine = Math.pow(1 - Math.abs(Math.sin((u * 5 - v * 2 + cloud * 3) * Math.PI * 2)), 22);
    const base = 0.9 + (cloud - 0.5) * 0.14;
    const dark = line * 0.38 + fine * 0.16;
    return [
      (240 * base) * (1 - dark) + 120 * dark,
      (233 * base) * (1 - dark) + 128 * dark,
      (220 * base) * (1 - dark) + 146 * dark,
      255,
    ];
  },
  // A deeper, cooler stone for the plinth and the carved rims.
  marbleTrim: (u, v) => {
    const cloud = marbleNoise.fbm(u + 0.37, v + 0.11, 4, 4);
    const warp = veinNoise.fbm(u + 0.5, v, 3, 4);
    const vein = Math.pow(1 - Math.abs(Math.sin((u * 3 - v * 2 + warp * 2.5) * Math.PI * 2)), 10);
    const base = 0.8 + (cloud - 0.5) * 0.18;
    return [
      150 * base + vein * 60,
      160 * base + vein * 62,
      172 * base + vein * 66,
      255,
    ];
  },
  // Clear blue water with a web of bright caustics.
  water: (u, v) => {
    const depth = waterNoise.fbm(u, v, 4, 3);
    const a = waterNoise.fbm(u + 0.3, v, 6, 2);
    const b = waterNoise.fbm(u, v + 0.6, 6, 2);
    const caustic = Math.pow(1 - Math.abs(a - b) * 2, 10);
    return [
      28 + depth * 30 + caustic * 150,
      96 + depth * 50 + caustic * 140,
      150 + depth * 50 + caustic * 90,
      255,
    ];
  },
  // Falling water: bright streaks running down, mostly see-through.
  waterFall: (u, v) => {
    const streak = fallNoise.fbm(u, v, 16, 3, 2);
    const foam = Math.pow(streak, 3);
    const alpha = 0.35 + streak * 0.45;
    return [150 + foam * 105, 200 + foam * 55, 235 + foam * 20, alpha * 255];
  },
};

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
