// node --test scripts/mcp/headless-server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  const json = text.split('\n\nMap')[0];
  return { value: JSON.parse(json), text };
};

test('plays a seeded game over stdio', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['new_game', 'observe', 'act', 'inventory', 'end_game']);

  assert.match((await call(client, 'observe')).error, /No game is running/);

  const started = await call(client, 'new_game', { seed: 5, role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' });
  assert.equal(started.value.prompt.kind, 'command');
  assert.match(started.value.status.title, /the Stripling/);
  assert.match(started.text, /\nMap \(row label = y/);
  const start = started.value.hero;

  const moved = await call(client, 'act', { keys: ['s'] });
  assert.equal(moved.value.settled, true);
  assert.equal(moved.value.turnsElapsed, 1);

  assert.match((await call(client, 'act', { select: [{ index: 0 }] })).error, /No menu is open/);
  assert.match((await call(client, 'act', { keys: ['s'], move: 'e' })).error, /exactly one/);

  const inventory = await call(client, 'inventory');
  assert.equal(inventory.value.available, true);
  assert.ok(inventory.value.items.some(item => /spear/.test(item.name)));

  // A replay with the same seed is the same game.
  const again = await call(client, 'new_game', { seed: 5, role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' });
  assert.deepEqual(again.value.hero, start);
  assert.equal((await call(client, 'end_game')).value.status, 'ended');
});
