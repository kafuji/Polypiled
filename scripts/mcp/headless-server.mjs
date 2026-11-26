// MCP server that plays Polypiled without a browser. Each game runs the
// ordinary runtime and core in a worker thread of this process; see
// docs/mcp-headless.md.
//
//   node scripts/mcp/headless-server.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { bundleHeadlessWorker, startHeadlessGame } from '../headless/game-client.mjs';

const MAX_GAMES = 8;
const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'up', 'down', 'self'];
const games = new Map(); // id -> { game, setup }
let nextGame = 0;
let latest = null;

/** JSON for everything but the map, which reads better as lines. */
function format(value) {
  if (!value || typeof value !== 'object' || !value.map) return JSON.stringify(value);
  const { map, ...rest } = value;
  const lines = map.rows.length ? [map.ruler, ...map.rows].join('\n') : '(nothing seen yet)';
  return `${JSON.stringify(rest)}\n\nMap (row label = y, ruler = x mod 10, x starts at ${map.x0}):\n${lines}`;
}

function pick(id) {
  const key = id ?? latest;
  const entry = key ? games.get(key) : null;
  if (!entry) throw new Error(id ? `No game "${id}"; list_games shows the running ones.` : 'No game is running; call new_game first.');
  return { id: key, ...entry };
}

/** Snapshot files live under the working directory and end in .json. */
function snapshotPath(file) {
  const path = resolve(process.cwd(), file);
  if (!path.startsWith(process.cwd()) || !path.endsWith('.json')) throw new Error('file must be a .json path inside the working directory');
  return path;
}

const gameId = z.string().regex(/^g\d+$/).optional().describe('Which game (from new_game); default the latest started');
const position = z.strictObject({ x: z.number().int().min(1).max(79), y: z.number().int().min(0).max(20) });
const inventoryItem = z.strictObject({ id: z.number().int().min(1), count: z.number().int().min(1).optional() });
const inventoryOperation = z.strictObject({
  op: z.enum(['wear', 'takeoff', 'remove', 'puton', 'wield', 'quiver', 'alternate', 'swap', 'twoweapon', 'altunwield', 'sort', 'adjust', 'pickup', 'drop', 'loot']),
  item: z.string().length(1).optional().describe('Inventory letter ("-" for empty hands with wield/quiver)'),
  hand: z.enum(['left', 'right']).optional(),
  from: z.string().length(1).optional(), to: z.string().length(1).optional(),
  items: z.array(inventoryItem).max(128).optional().describe('pickup/drop: object ids from inventory() (floor or pack)'),
  container: z.number().int().min(1).optional(),
  out: z.array(inventoryItem).max(128).optional(), in: z.array(inventoryItem).max(128).optional(),
});

function createMcpServer() {
  const mcp = new McpServer({ name: 'polypiled-headless', version: '1.0.0' });
  const register = (name, description, inputSchema, readOnlyHint, run) => {
    mcp.registerTool(name, { description, inputSchema, annotations: { readOnlyHint } }, async args => {
      try {
        return { content: [{ type: 'text', text: format(await run(args)) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    });
  };

  register('new_game',
    'Start a game and return its id with the first observation. Several games can run at once (up to 8). ' +
    'The same seed and the same actions always give the same game. ' +
    'Give role, race, gender and align together to choose the character (e.g. "valkyrie", "dwarf", "female", "lawful"); otherwise it is random. ' +
    'playmode "debug" is wizard mode: it unlocks the debug and reveal tools. ' +
    'Give snapshot (an object from the snapshot tool) or snapshot_file instead to start a copy of a saved point. ' +
    'Headless games have number_pad off, no tutorial and autopickup off unless options turn it on.',
    z.strictObject({
      seed: z.number().int().min(0).max(4294967295).optional(),
      name: z.string().min(1).max(30).optional(),
      role: z.string().min(1).max(32).optional(),
      race: z.string().min(1).max(32).optional(),
      gender: z.string().min(1).max(32).optional(),
      align: z.string().min(1).max(32).optional(),
      playmode: z.enum(['normal', 'explore', 'debug']).optional(),
      options: z.array(z.string().max(80)).max(32).optional().describe('NetHack option tokens such as "autopickup", "!verbose" or "pickup_types:$"; unknown options are ignored'),
      snapshot: z.record(z.string(), z.unknown()).optional(),
      snapshot_file: z.string().max(512).optional(),
    }),
    false,
    async ({ snapshot_file: file, ...args }) => {
      if (games.size >= MAX_GAMES) throw new Error(`At most ${MAX_GAMES} games run at once; end_game one first.`);
      if (file) args.snapshot = JSON.parse(readFileSync(snapshotPath(file), 'utf8'));
      const { game, observation } = await startHeadlessGame(args);
      const id = `g${++nextGame}`;
      games.set(id, { game, setup: args.snapshot ? args.snapshot.setup : args });
      latest = id;
      return { game: id, ...observation };
    });

  register('list_games', 'The running games: id, setup, and whether each is the default.', z.strictObject({}), true,
    async () => ({ games: [...games.entries()].map(([id, entry]) => ({ id, default: id === latest, setup: entry.setup })) }));

  register('observe',
    'Observe a game: turn, the open prompt (what the game waits for), hero position, level, status line, unread messages, ' +
    'monsters the hero perceives (with names when seen), what is here, and the map as displayed. ' +
    'A monster letter on the map that is not in monsters is a statue or a remembered sighting.',
    z.strictObject({ game: gameId, map: z.boolean().optional().describe('Include the map (default true)') }),
    true,
    async ({ game, ...args }) => pick(game).game.observe(args));

  register('act',
    'Do one thing and wait until the game waits for input again. Give exactly one of: ' +
    'move (direction, optional count to repeat), keys (raw keys: one character, "Enter", "Escape", "^x" for Ctrl, "M-x" for Meta), ' +
    'extended (an extended command name such as "pray" or "loot"), answer (one key for a y/n, direction or position prompt), ' +
    'select (menu items by index from the prompt; several only when prompt.multi), text (for a text prompt), ' +
    'position (x, y to pick on a position prompt), inventory (a whole item action by letter or object id: wear, wield, pickup, drop, loot ...), ' +
    'or dismiss (close the prompt: Enter for info/more, Escape otherwise). ' +
    'Prompt kinds: command, key (one key outside a prompt), more, yn, direction, menu, text, info, position, game_over. ' +
    'Returns turns elapsed, new messages, the next prompt, hero position and status changes.',
    z.strictObject({
      game: gameId,
      move: z.enum(directions).optional(),
      count: z.number().int().min(1).max(999).optional(),
      keys: z.array(z.string().min(1).max(8)).min(1).max(64).optional(),
      extended: z.string().regex(/^[A-Za-z0-9_?-]{1,80}$/).optional(),
      answer: z.string().min(1).max(8).optional(),
      select: z.array(z.strictObject({ index: z.number().int().min(0), count: z.number().int().min(1).optional() })).max(256).optional(),
      text: z.string().max(255).optional(),
      position: position.optional(),
      inventory: inventoryOperation.optional(),
      dismiss: z.literal(true).optional(),
      timeoutMs: z.number().int().min(100).max(120000).optional(),
    }),
    false,
    async ({ game, timeoutMs, ...action }) => pick(game).game.act(action, timeoutMs));

  register('travel', 'Walk to x, y with the travel command (_). Returns like act; the walk can stop early when something happens.',
    z.strictObject({ game: gameId, x: z.number().int().min(1).max(79), y: z.number().int().min(0).max(20) }), false,
    async ({ game, x, y }) => pick(game).game.travel(x, y));

  register('inventory',
    'The hero\'s inventory as the game knows it (object id, letter, name, class, quantity, known blessed/cursed state, enchantment, charges, worn), weight, capacity, encumbrance, and what lies here with object ids. Always current.',
    z.strictObject({ game: gameId }), true,
    async ({ game }) => pick(game).game.inventory());

  register('snapshot',
    'Save the current point of a game: its setup and every action so far. new_game with this snapshot replays it into an identical copy (checked by a fingerprint), so you can branch, retry, or keep test fixtures. ' +
    'With file, also write it there (a .json path inside the working directory).',
    z.strictObject({ game: gameId, file: z.string().max(512).optional() }), false,
    async ({ game, file }) => {
      const snapshot = await pick(game).game.snapshot();
      if (file) {
        const path = snapshotPath(file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
      }
      return file ? { ...snapshot, file } : snapshot;
    });

  register('reveal',
    'Debug mode only: the level as it really is, beyond what the hero knows: terrain (S secret door, C secret corridor, + closed door, \' open door), every monster with hit points, ' +
    'every floor object with its true name, every trap, and the hero\'s luck, alignment, prayer timeout, god anger and nutrition. Takes no game time and does not change the game.',
    z.strictObject({ game: gameId }), true,
    async ({ game }) => pick(game).game.reveal());

  register('debug',
    'Debug mode only: set up a scene. op "wish" (text: e.g. "blessed +2 silver saber"), "create_monster" (text: e.g. "jackal"), ' +
    '"teleport" (x, y on this level), "level_teleport" (level: a number or a name such as "minetown"), "map" (map the level). Returns like act.',
    z.strictObject({
      game: gameId,
      op: z.enum(['wish', 'create_monster', 'teleport', 'level_teleport', 'map']),
      text: z.string().min(1).max(255).optional(),
      x: z.number().int().min(1).max(79).optional(), y: z.number().int().min(0).max(20).optional(),
      level: z.union([z.string().min(1).max(40), z.number().int()]).optional(),
    }),
    false,
    async ({ game, op, text, x, y, level }) => {
      const { game: g } = pick(game);
      switch (op) {
        case 'wish': if (!text) throw new Error('wish needs text'); return g.wish(text);
        case 'create_monster': if (!text) throw new Error('create_monster needs text'); return g.createMonster(text);
        case 'teleport': if (x === undefined || y === undefined) throw new Error('teleport needs x and y'); return g.teleport(x, y);
        case 'level_teleport': if (level === undefined) throw new Error('level_teleport needs level'); return g.levelTeleport(String(level));
        case 'map': return g.mapLevel();
      }
    });

  register('end_game', 'Stop a game and free it.', z.strictObject({ game: gameId }), false, async ({ game }) => {
    const { id, game: g } = pick(game);
    games.delete(id);
    if (latest === id) latest = [...games.keys()].pop() ?? null;
    await g.close();
    return { status: 'ended', game: id };
  });
  return mcp;
}

// Bundle before serving so the first new_game is quick and build errors show at once.
await bundleHeadlessWorker();
serveStdio(createMcpServer, { onerror: error => console.error(`MCP transport error: ${error.message}`) });
process.stdin.once('end', () => { for (const { game } of games.values()) void game.close(); });
