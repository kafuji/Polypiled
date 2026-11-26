import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import LocalNetHackRuntime from "../runtime/LocalNetHackRuntime";
import { RuntimeAssets } from "../runtime/local/startup/runtime-assets";
import type { RuntimeEvent, RuntimeStartupOptions } from "../runtime/types";

/**
 * Runs the ordinary worker runtime (LocalNetHackRuntime) in plain Node.
 *
 * Only asset loading differs from the browser: the core is read from a
 * directory on disk instead of fetched. There is no IndexedDB, so saves live
 * in the module's in-memory file system for the life of the game.
 *
 * The runtime keeps its state on globalThis (nethackGlobal), so one process
 * or worker thread runs one game at a time.
 */

/**
 * The core seeds its random number generator from the clock (the WASM build
 * has no DEV_RANDOM, so sys_random_seed() uses time() * getpid(), and getpid()
 * is constant). A seed therefore picks a second on a fixed, ordinary day: not
 * a full or new moon, not Friday the 13th, in daytime, in UTC.
 */
export const HEADLESS_SEED_MAX = 35_999;
const HEADLESS_EPOCH_MS = Date.UTC(2026, 0, 10, 8, 0, 0);

export function headlessClockForSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > HEADLESS_SEED_MAX) {
    throw new Error(`seed must be an integer from 0 to ${HEADLESS_SEED_MAX}`);
  }
  return HEADLESS_EPOCH_MS + seed * 1000;
}

let patchedPublicDir: string | null = null;
let gameStartedInThisThread = false;

function patchRuntimeAssets(publicDir: string): void {
  if (patchedPublicDir === publicDir) return;
  const assets = RuntimeAssets.prototype as unknown as {
    resolveWasmAssetUrl(path: string): string;
    loadRuntimeFactory(version: string): Promise<unknown>;
    getRuntimeModuleAssetPath(): string;
  };
  assets.resolveWasmAssetUrl = (path: string) =>
    resolve(publicDir, String(path || "").replace(/^\/+/, "").split("?")[0]);
  assets.loadRuntimeFactory = async function (this: typeof assets) {
    const modulePath = resolve(publicDir, this.getRuntimeModuleAssetPath());
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as { default: unknown };
    return loaded.default;
  };
  patchedPublicDir = publicDir;
}

export interface NodeRuntimeOptions {
  /** Directory holding nethack-5.js and nethack-5.wasm (the app's public/). */
  publicDir: string;
  startupOptions: RuntimeStartupOptions;
  /** Fixed wall clock for the game (ms since the epoch); see headlessClockForSeed. */
  clockMs: number;
  /** Keep the runtime's console output (very verbose). */
  verbose?: boolean;
  onEvent(event: RuntimeEvent): void;
}

export interface NodeRuntime {
  readonly runtime: LocalNetHackRuntime;
  shutdown(): void;
}

/** Start one game. Call shutdown() before starting another in the same thread. */
export async function startNodeRuntime(options: NodeRuntimeOptions): Promise<NodeRuntime> {
  // A second core in the same thread trips Asyncify's reentrancy check: the
  // cores share the global callback the shim calls. One game per thread.
  if (gameStartedInThisThread) throw new Error("A headless game already ran in this thread; start each game in its own worker thread");
  gameStartedInThisThread = true;
  patchRuntimeAssets(options.publicDir);
  const restore: Array<() => void> = [];

  // Freeze the clock the core reads (Emscripten's clock uses Date.now()) and
  // the time zone its localtime() uses, so a seed means the same game anywhere.
  const realNow = Date.now;
  Date.now = () => options.clockMs;
  restore.push(() => { Date.now = realNow; });
  const realTz = process.env.TZ;
  process.env.TZ = "UTC";
  restore.push(() => { if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz; });

  if (!options.verbose) {
    const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
    const quiet = () => {};
    console.log = quiet; console.info = quiet; console.debug = quiet; console.warn = quiet;
    restore.push(() => Object.assign(console, saved));
  }

  let closed = false;
  const runtime = new LocalNetHackRuntime(event => { if (!closed) options.onEvent(event); }, {
    ...options.startupOptions,
    protocolVersion: 1,
    portraitDialog: false,
    loggingEnabled: false,
  });
  // The ordinary shutdown resolves the pending input so the browser worker can
  // unwind; the core then keeps running on cancelled input and, in one Node
  // thread, starves the event loop. Here the game is abandoned instead: the
  // core stays suspended in its input wait, which holds no handle, and is
  // garbage once nothing refers to it. Run a game in its own worker thread to
  // get its memory back.
  const shutdown = () => {
    if (closed) return;
    closed = true;
    while (restore.length) restore.pop()!();
  };
  try {
    await runtime.start();
  } catch (error) {
    shutdown();
    throw error;
  }
  return { runtime, shutdown };
}
