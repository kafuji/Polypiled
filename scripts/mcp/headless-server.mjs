// MCP server that plays Polypiled without a browser. Each game runs the
// ordinary runtime and core in a worker thread of this process; see
// docs/mcp-headless.md.
//
//   node scripts/mcp/headless-server.mjs
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { bundleHeadlessWorker, startHeadlessGame } from '../headless/game-client.mjs';

const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'up', 'down', 'self'];
let current = null;

/** JSON for everything but the map, which reads better as lines. */
function format(value) {
  if (!value || typeof value !== 'object' || !value.map) return JSON.stringify(value);
  const { map, ...rest } = value;
  const lines = map.rows.length ? [map.ruler, ...map.rows].join('\n') : '(nothing seen yet)';
  return `${JSON.stringify(rest)}\n\nMap (row label = y, ruler = x mod 10, x starts at ${map.x0}):\n${lines}`;
}

function requireGame() {
  if (!current) throw new Error('No game is running; call new_game first.');
  return current;
}

function createMcpServer() {
  const mcp = new McpServer({ name: 'polypiled-headless', version: '0.1.0' });
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
    'Start a new game, ending any current one. The same seed and the same actions always give the same game. ' +
    'Give role, race, gender and align together to choose the character (e.g. "valkyrie", "dwarf", "female", "lawful"); otherwise it is random. ' +
    'playmode "debug" is wizard mode (^W wish, ^F map, ^T teleport, ^V level teleport) for setting up test scenes. ' +
    'Headless games always have number_pad off, no tutorial and autopickup off unless options turn it on. Returns the first observation.',
    z.strictObject({
      seed: z.number().int().min(0).max(35999).optional(),
      name: z.string().min(1).max(30).optional(),
      role: z.string().min(1).max(32).optional(),
      race: z.string().min(1).max(32).optional(),
      gender: z.string().min(1).max(32).optional(),
      align: z.string().min(1).max(32).optional(),
      playmode: z.enum(['normal', 'explore', 'debug']).optional(),
      options: z.array(z.string().max(80)).max(32).optional().describe('NetHack option tokens such as "autopickup", "!verbose" or "pickup_types:$"; unknown options are ignored'),
    }),
    false,
    async args => {
      const previous = current;
      current = null;
      if (previous) await previous.close();
      const { game, observation } = await startHeadlessGame(args);
      current = game;
      return observation;
    });

  register('observe',
    'Observe the game: turn, the open prompt (what the game waits for), hero position, level, status line, unread messages, ' +
    'monsters the hero perceives (with names when seen), what is here, and the map as displayed. ' +
    'A monster letter on the map that is not in monsters is a statue or a remembered sighting.',
    z.strictObject({ map: z.boolean().optional().describe('Include the map (default true)') }),
    true,
    async args => requireGame().observe(args));

  register('act',
    'Do one thing and wait until the game waits for input again. Give exactly one of: ' +
    'move (direction, optional count to repeat), keys (raw keys: one character, "Enter", "Escape", "^x" for Ctrl, "M-x" for Meta), ' +
    'extended (an extended command name such as "pray" or "loot"), answer (one key for a y/n, direction or position prompt), ' +
    'select (menu items by index from the prompt; several only when prompt.multi), text (for a text prompt), or dismiss (close the prompt: Enter for info/more, Escape otherwise). ' +
    'Returns turns elapsed, new messages, the next prompt, hero position and status changes.',
    z.strictObject({
      move: z.enum(directions).optional(),
      count: z.number().int().min(1).max(999).optional(),
      keys: z.array(z.string().min(1).max(8)).min(1).max(64).optional(),
      extended: z.string().regex(/^[A-Za-z0-9_?-]{1,80}$/).optional(),
      answer: z.string().min(1).max(8).optional(),
      select: z.array(z.strictObject({ index: z.number().int().min(0), count: z.number().int().min(1).optional() })).max(256).optional(),
      text: z.string().max(255).optional(),
      dismiss: z.literal(true).optional(),
      timeoutMs: z.number().int().min(100).max(120000).optional(),
    }),
    false,
    async ({ timeoutMs, ...action }) => requireGame().act(action, timeoutMs));

  register('inventory',
    'The hero\'s inventory as the game knows it (object id, letter, name, class, quantity, known blessed/cursed state, enchantment, charges, worn), weight, capacity, encumbrance, and what lies here. Always current.',
    z.strictObject({}),
    true,
    async () => requireGame().inventory());

  register('end_game', 'Stop the current game and free it.', z.strictObject({}), false, async () => {
    const game = requireGame();
    current = null;
    await game.close();
    return { status: 'ended' };
  });
  return mcp;
}

// Bundle before serving so the first new_game is quick and build errors show at once.
await bundleHeadlessWorker();
serveStdio(createMcpServer, { onerror: error => console.error(`MCP transport error: ${error.message}`) });
process.stdin.once('end', () => { void current?.close(); });
