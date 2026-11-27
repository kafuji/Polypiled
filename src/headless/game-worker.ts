import { parentPort } from "node:worker_threads";
import { HeadlessGame, type HeadlessGameOptions } from "./headless-game";
import type { AgentAction } from "./agent-session";

/**
 * Worker-thread entry: one game per worker. Bundled by
 * scripts/headless/game-client.mjs, which also speaks this protocol:
 *   -> { id, method, params }  (start, observe, act, inventory, snapshot,
 *      reveal, wish, create_monster, teleport, level_teleport, map, travel)
 *   <- { id, result } | { id, error }
 */

type Request = { id: number; method: string; params?: Record<string, unknown> };

let game: HeadlessGame | null = null;

async function run(request: Request): Promise<unknown> {
  const params = request.params ?? {};
  if (request.method === "start") {
    if (game) throw new Error("This worker already runs a game");
    game = await HeadlessGame.start(params as unknown as HeadlessGameOptions);
    return game.observe();
  }
  if (!game) throw new Error("No game has been started");
  switch (request.method) {
    case "observe": return game.observe({ map: params.map !== false });
    case "act": return game.act(params.action as AgentAction, typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
    case "inventory": return game.inventory();
    case "snapshot": return game.snapshot();
    case "reveal": return game.reveal();
    case "wish": return game.wish(String(params.text ?? ""));
    case "create_monster": return game.createMonster(String(params.text ?? ""));
    case "teleport": return game.teleport(Number(params.x), Number(params.y));
    case "level_teleport": return game.levelTeleport(String(params.level ?? ""));
    case "map": return game.mapLevel();
    case "travel": return game.travel(Number(params.x), Number(params.y));
    default: throw new Error(`Unknown method ${request.method}`);
  }
}

// Requests are handled one at a time, in order.
let queue: Promise<void> = Promise.resolve();
parentPort!.on("message", (request: Request) => {
  queue = queue.then(async () => {
    try {
      parentPort!.postMessage({ id: request.id, result: await run(request) });
    } catch (error) {
      parentPort!.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
