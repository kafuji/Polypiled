// Starts headless Polypiled games, each in its own worker thread.
//
//   const game = await startHeadlessGame({ seed: 3 });
//   const result = await game.act({ move: "e" });
//   game.close();
//
// The worker is src/headless/game-worker.ts, bundled with esbuild on first use
// (about a tenth of a second). The core is read from public/ (nethack-5.js and
// nethack-5.wasm), the same files the app serves.
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));

// Vite-only imports the runtime uses: "?raw" text files and "?url" assets.
const viteQueries = {
  name: "vite-queries",
  setup(build) {
    build.onResolve({ filter: /\?(?:raw|url)$/ }, args => {
      const [, path, kind] = /^(.*)\?(raw|url)$/.exec(args.path);
      return { path: resolve(args.resolveDir, path), namespace: `vite-${kind}` };
    });
    build.onLoad({ filter: /.*/, namespace: "vite-raw" }, args => ({ contents: readFileSync(args.path, "utf8"), loader: "text" }));
    build.onLoad({ filter: /.*/, namespace: "vite-url" }, args => ({ contents: `export default ${JSON.stringify(args.path)};`, loader: "js" }));
  },
};

let bundled = null;
/** Bundle the worker once per process; returns its path. */
export function bundleHeadlessWorker() {
  bundled ??= (async () => {
    const { build } = require("esbuild");
    const outDir = join(tmpdir(), "polypiled-headless", String(process.pid));
    mkdirSync(outDir, { recursive: true });
    const outfile = join(outDir, "game-worker.mjs");
    await build({
      entryPoints: [join(root, "src/headless/game-worker.ts")],
      bundle: true, platform: "node", format: "esm", outfile, logLevel: "error",
      plugins: [viteQueries],
      loader: { ".png": "empty", ".svg": "empty", ".css": "empty", ".scss": "empty", ".wasm": "empty" },
      define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, BASE_URL: "/", MODE: "headless" }) },
    });
    return outfile;
  })();
  return bundled;
}

/**
 * Start one game. Options: seed (0 to 4294967295), name, role/race/gender/align
 * (all four, or none for random), playmode (normal|explore|debug), options
 * (NetHack option tokens), snapshot (replay one instead), publicDir.
 * Resolves after the game first waits for input, with { game, observation }.
 */
export async function startHeadlessGame(options = {}) {
  const workerPath = await bundleHeadlessWorker();
  // Capture the worker's console: the runtime is chatty, and a stdio MCP
  // server must keep its stdout for the protocol.
  const worker = new Worker(workerPath, { stdout: true, stderr: true });
  worker.stdout.resume();
  worker.stderr.resume();
  const pending = new Map();
  let nextId = 0;
  let failure = null;
  const failAll = error => {
    failure = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.on("message", ({ id, result, error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (error !== undefined) entry.reject(new Error(error));
    else entry.resolve(result);
  });
  worker.on("error", error => failAll(error instanceof Error ? error : new Error(String(error))));
  worker.on("exit", code => failAll(new Error(`The game worker exited (${code})`)));
  const call = (method, params) => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolvePromise, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolvePromise, reject });
      worker.postMessage({ id, method, params });
    });
  };
  const game = {
    observe: (params = {}) => call("observe", params),
    act: (action, timeoutMs) => call("act", { action, timeoutMs }),
    inventory: () => call("inventory", {}),
    /** { format, version, setup, actions, turn, fingerprint }: pass as options.snapshot to start a copy. */
    snapshot: () => call("snapshot", {}),
    // Debug mode (playmode "debug") only:
    reveal: () => call("reveal", {}),
    wish: text => call("wish", { text }),
    createMonster: text => call("create_monster", { text }),
    teleport: (x, y) => call("teleport", { x, y }),
    levelTeleport: level => call("level_teleport", { level: String(level) }),
    mapLevel: () => call("map", {}),
    // Any mode:
    travel: (x, y) => call("travel", { x, y }),
    close: async () => { failure ??= new Error("The game was closed"); await worker.terminate(); },
  };
  try {
    const observation = await call("start", { publicDir: join(root, "public"), ...options });
    return { game, observation };
  } catch (error) {
    await worker.terminate();
    throw error;
  }
}
