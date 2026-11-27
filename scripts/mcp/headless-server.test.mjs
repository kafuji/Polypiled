// node --test scripts/mcp/headless-server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function connect(t) {
  const client = new Client({ name: 'headless-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp/headless-server.mjs'], stderr: 'pipe' }));
  t.after(() => client.close());
  return client;
}

const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  if (result.isError) return { error: text };
  return { value: JSON.parse(text.split('\n\nMap')[0]), text };
};

const valkyrie = { role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' };

test('plays seeded games over stdio, several at once, with snapshots in files', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name),
    ['new_game', 'list_games', 'observe', 'act', 'travel', 'inventory', 'snapshot', 'reveal', 'debug', 'end_game']);

  assert.match((await call(client, 'observe')).error, /No game is running/);

  const first = await call(client, 'new_game', { seed: 5, ...valkyrie });
  assert.equal(first.value.game, 'g1');
  assert.equal(first.value.prompt.kind, 'command');
  assert.match(first.value.status.title, /the Stripling/);
  assert.match(first.text, /\nMap \(row label = y/);

  const moved = await call(client, 'act', { keys: ['s'] });
  assert.equal(moved.value.turnsElapsed, 1);
  assert.match((await call(client, 'act', { select: [{ index: 0 }] })).error, /No menu is open/);
  assert.match((await call(client, 'act', { keys: ['s'], move: 'e' })).error, /exactly one/);
  assert.ok((await call(client, 'inventory')).value.items.some(item => /spear/.test(item.name)));
  assert.match((await call(client, 'reveal')).error, /debug mode/);

  const second = await call(client, 'new_game', { seed: 42, playmode: 'debug', ...valkyrie });
  assert.equal(second.value.game, 'g2');
  assert.deepEqual((await call(client, 'list_games')).value.games.map(game => [game.id, game.default]), [['g1', false], ['g2', true]]);
  const reveal = await call(client, 'reveal');
  assert.equal(reveal.value.terrain.length, 21);
  const wished = await call(client, 'debug', { op: 'wish', text: '2 blessed scrolls of genocide' });
  assert.ok(wished.value.messages.some(message => /2 .*scrolls/.test(message.text)));
  assert.equal((await call(client, 'observe', { game: 'g1', map: false })).value.turn, 2, 'g1 is untouched');

  const dir = mkdtempSync(join('node_modules', '.cache-headless-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = relative(process.cwd(), join(dir, 'g1.json')).replaceAll('\\', '/');
  const saved = await call(client, 'snapshot', { game: 'g1', file });
  assert.equal(saved.value.actions.length, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).fingerprint, saved.value.fingerprint);
  assert.match((await call(client, 'snapshot', { file: '../outside.json' })).error, /inside the working directory/);

  const copy = await call(client, 'new_game', { snapshot_file: file });
  assert.equal(copy.value.game, 'g3');
  assert.deepEqual(copy.value.hero, (await call(client, 'observe', { game: 'g1' })).value.hero);
  assert.equal(copy.value.turn, 2);

  assert.equal((await call(client, 'end_game', { game: 'g2' })).value.status, 'ended');
  assert.match((await call(client, 'observe', { game: 'g2' })).error, /No game "g2"/);
});
