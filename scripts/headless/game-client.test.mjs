// Scenario tests against the real core, each game in its own worker thread.
//   node --test scripts/headless/game-client.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHeadlessGame } from './game-client.mjs';

const valkyrie = { role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' };

async function start(t, options) {
  const started = await startHeadlessGame(options);
  t.after(() => started.game.close());
  return started;
}

async function play(game, actions) {
  const results = [];
  for (const action of actions) results.push(await game.act(action));
  return results;
}

test('a seed and the same actions replay the same game; another seed differs', async t => {
  const actions = [{ move: 'e' }, { move: 'n', count: 4 }, { keys: ['s'] }, { move: 'w', count: 3 }];
  const [a, b, c] = await Promise.all([start(t, { seed: 3 }), start(t, { seed: 3 }), start(t, { seed: 4 })]);
  const end = [];
  for (const { game } of [a, b, c]) {
    await play(game, actions);
    const { map, status, hero, turn } = await game.observe();
    end.push(JSON.stringify({ map, status, hero, turn }));
  }
  assert.equal(end[0], end[1]);
  assert.notEqual(end[0], end[2]);
});

test('the first observation is a command prompt with status, map and pet', async t => {
  const { observation } = await start(t, { seed: 5, ...valkyrie });
  assert.equal(observation.prompt.kind, 'command');
  assert.equal(observation.turn, 1);
  assert.match(observation.status.title, /Agent the Stripling/);
  assert.equal(observation.status.gold, '0');
  assert.ok(observation.map.rows.some(row => row.includes('@')));
  assert.ok(observation.monsters.some(monster => monster.pet && monster.name === 'little dog'));
  assert.match(observation.messages[0].text, /welcome to NetHack/);
});

test('turns, messages and status changes come back with each action', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  const searched = await game.act({ keys: ['s'] });
  assert.equal(searched.settled, true);
  assert.equal(searched.turnsElapsed, 1);
  assert.deepEqual(searched.statusChanges.time, { from: '1', to: '2' });
  const free = await game.act({ keys: ['i'] });
  assert.equal(free.turnsElapsed, 0, 'looking at the inventory takes no time');
  await assert.rejects(game.act({ select: [{ index: 0 }] }), /No menu is open/);
  await assert.rejects(game.act({ keys: ['s'], move: 'e' }), /exactly one/);
});

test('debug mode: wish by text, drop through a menu, pick up a counted part of a stack', async t => {
  const { game, observation } = await start(t, { seed: 5, playmode: 'debug', ...valkyrie });
  assert.match(observation.messages[0].text, /welcome to NetHack/);
  assert.equal((await game.act({ keys: ['^w'] })).prompt.kind, 'text');
  const wished = await game.act({ text: '3 rocks' });
  assert.ok(wished.messages.some(message => /3 rocks/.test(message.text)));

  const drop = await game.act({ keys: ['d'] });
  assert.equal(drop.prompt.kind, 'menu');
  assert.equal(drop.prompt.multi, false);
  const rocks = drop.prompt.items.find(item => /rocks/.test(item.text));
  assert.ok((await game.act({ select: [{ index: rocks.index }] })).messages.some(message => message.text === 'You drop 3 rocks.'));

  const dropDagger = await game.act({ keys: ['d'] });
  await game.act({ select: [{ index: dropDagger.prompt.items.find(item => /dagger/.test(item.text)).index }] });

  const pickup = await game.act({ keys: [','] });
  assert.equal(pickup.prompt.kind, 'menu');
  assert.equal(pickup.prompt.multi, true);
  const stack = pickup.prompt.items.find(item => item.isSelectable && /rocks/.test(item.text));
  const picked = await game.act({ select: [{ index: stack.index, count: 2 }] });
  assert.ok(picked.messages.some(message => /2 rocks/.test(message.text)));
  assert.equal(picked.turnsElapsed, 1);

  const types = await game.act({ keys: ['D'] });
  assert.equal(types.prompt.kind, 'menu');
  assert.equal(types.prompt.multi, true);
  const toggled = await game.act({ keys: [','] });
  assert.equal(toggled.prompt.kind, 'menu', 'a key that only toggles entries leaves the menu open');
  assert.equal((await game.act({ dismiss: true })).prompt.kind, 'command');

  const inventory = await game.inventory();
  assert.ok(inventory.items.some(item => item.name === '2 rocks'));
  assert.deepEqual(inventory.floor.map(item => item.name).sort(), ['a +0 dagger', 'a rock']);
});

test('a y/n question shows its choices and default', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  const asked = await game.act({ extended: 'pray' });
  assert.deepEqual(asked.prompt, { kind: 'yn', text: 'Are you sure you want to pray?', choices: 'yn', default: 'n' });
  assert.equal((await game.act({ answer: 'n' })).prompt.kind, 'command');
});
