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

const state = async game => {
  const { map, status, hero, turn } = await game.observe();
  return JSON.stringify({ map, status, hero, turn });
};

test('a seed and the same actions replay the same game; another seed differs', async t => {
  const actions = [{ move: 'e' }, { move: 'n', count: 4 }, { keys: ['s'] }, { move: 'w', count: 3 }];
  const [a, b, c] = await Promise.all([start(t, { seed: 3 }), start(t, { seed: 3 }), start(t, { seed: 3_000_000_000 })]);
  const end = [];
  for (const { game } of [a, b, c]) {
    await play(game, actions);
    end.push(await state(game));
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

test('a key read inside a command is not a command prompt', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  const counting = await game.act({ keys: ['2'] });
  assert.equal(counting.prompt.kind, 'key', 'a count is being typed');
  const searched = await game.act({ keys: ['0', 's'] });
  assert.equal(searched.prompt.kind, 'command');
  assert.equal(searched.turnsElapsed, 20);
});

test('menus: pick one, pick several with a count, and keys that only toggle entries', async t => {
  const { game } = await start(t, { seed: 5, playmode: 'debug', ...valkyrie });
  assert.equal((await game.act({ keys: ['^w'] })).prompt.kind, 'text');
  assert.ok((await game.act({ text: '3 rocks' })).messages.some(message => /3 rocks/.test(message.text)));

  const drop = await game.act({ keys: ['d'] });
  assert.equal(drop.prompt.kind, 'menu');
  assert.equal(drop.prompt.multi, false);
  await game.act({ select: [{ index: drop.prompt.items.find(item => /rocks/.test(item.text)).index }] });
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
  assert.equal(types.prompt.multi, true);
  assert.equal((await game.act({ keys: [','] })).prompt.kind, 'menu', 'a key that only toggles entries leaves the menu open');
  assert.equal((await game.act({ dismiss: true })).prompt.kind, 'command');

  const inventory = await game.inventory();
  assert.ok(inventory.items.some(item => item.name === '2 rocks'));
  assert.deepEqual(inventory.floor.map(item => item.name).sort(), ['a +0 dagger', 'a rock']);
});

test('inventory operations act on letters and object ids', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  const dagger = (await game.inventory()).items.find(item => /dagger/.test(item.name));
  const dropped = await game.act({ inventory: { op: 'drop', items: [{ id: dagger.id }] } });
  assert.ok(dropped.messages.some(message => /You drop a \+0 dagger/.test(message.text)));
  assert.equal((await game.inventory()).floor[0].id, dagger.id);
  const picked = await game.act({ inventory: { op: 'pickup', items: [{ id: dagger.id }] } });
  assert.ok(picked.messages.some(message => /dagger/.test(message.text)));
  const wielded = await game.act({ inventory: { op: 'wield', item: dagger.letter } });
  assert.ok(wielded.messages.some(message => /dagger \(weapon in right hand\)/.test(message.text)));
});

test('a y/n question shows its choices and default', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  const asked = await game.act({ extended: 'pray' });
  assert.deepEqual(asked.prompt, { kind: 'yn', text: 'Are you sure you want to pray?', choices: 'yn', default: 'n' });
  assert.equal((await game.act({ answer: 'n' })).prompt.kind, 'command');
});

test('position prompts: farlook and travel pick a square', async t => {
  const { game, observation } = await start(t, { seed: 5, ...valkyrie });
  const { x, y } = observation.hero;
  const looking = await game.act({ keys: [';'] });
  assert.equal(looking.prompt.kind, 'position');
  const looked = await game.act({ position: { x, y } });
  assert.ok(looked.messages.some(message => /human valkyrie called Agent/.test(message.text)));
  assert.equal(looked.prompt.kind, 'command');

  await game.act({ move: 'w' });
  const walked = await game.travel(x, y);
  assert.deepEqual(walked.hero, { x, y, flags: [] });
  assert.ok(!walked.messages.some(message => /unexplored area/.test(message.text)), 'cursor descriptions are left out');
});

test('a snapshot replays into the same game, and a changed one is refused', async t => {
  const { game } = await start(t, { seed: 11, ...valkyrie });
  await play(game, [{ move: 'e', count: 2 }, { keys: ['s'] }, { extended: 'pray' }, { answer: 'n' }]);
  const snapshot = await game.snapshot();
  assert.equal(snapshot.actions.length, 4);
  const { game: copy } = await start(t, { snapshot });
  assert.equal(await state(copy), await state(game));
  await play(game, [{ move: 'w', count: 3 }]);
  await play(copy, [{ move: 'w', count: 3 }]);
  assert.equal(await state(copy), await state(game), 'the copy goes on the same way');
  await assert.rejects(startHeadlessGame({ snapshot: { ...snapshot, fingerprint: '00000000' } }), /did not reach the snapshot/);
});

test('debug mode: reveal, wish, create a monster, teleport, change level, map', async t => {
  const { game, observation } = await start(t, { seed: 42, playmode: 'debug', ...valkyrie });
  const reveal = await game.reveal();
  assert.equal(reveal.terrain.length, 21);
  assert.equal(reveal.terrain[0].length, 80);
  assert.equal(reveal.level.dlevel, 1);
  assert.ok(reveal.monsters.some(monster => monster.tame && monster.x !== observation.hero.x));
  assert.equal(typeof reveal.hero.luck, 'number');
  assert.equal(reveal.turn, observation.turn, 'revealing takes no time');

  assert.ok((await game.wish('blessed +3 silver saber')).messages.some(message => /silver saber/.test(message.text)));
  assert.ok((await game.createMonster('newt')).messages.some(message => /newt/i.test(message.text)));
  const before = (await game.reveal()).monsters.length;
  assert.ok(before >= reveal.monsters.length + 1);

  // A free floor square near the hero, from the true map.
  const occupied = new Set((await game.reveal()).monsters.map(monster => `${monster.x},${monster.y}`));
  const target = [[-3, 0], [3, 0], [0, 1], [0, -1], [-2, 1], [2, 1]]
    .map(([dx, dy]) => ({ x: observation.hero.x + dx, y: observation.hero.y + dy }))
    .find(({ x, y }) => reveal.terrain[y]?.[x] === '.' && !occupied.has(`${x},${y}`));
  assert.ok(target, 'a free floor square near the hero');
  const teleported = await game.teleport(target.x, target.y);
  assert.deepEqual({ x: teleported.hero.x, y: teleported.hero.y }, target);
  assert.ok(!teleported.messages.some(message => /^(floor of a room|unexplored area|wall|doorway)$/.test(message.text)), 'cursor descriptions are left out');

  assert.equal((await game.mapLevel()).prompt.kind, 'command');
  const moved = await game.levelTeleport(3);
  assert.equal(moved.statusChanges.leveldesc.to, 'Dlvl:3');
  assert.equal((await game.observe()).level.dlevel, 3);
});

test('reveal and the scene tools need debug mode', async t => {
  const { game } = await start(t, { seed: 5, ...valkyrie });
  await assert.rejects(game.reveal(), /debug mode/);
  await assert.rejects(game.wish('a wand of wishing'), /debug mode/);
});

test('the game ends with game_over and the tombstone after the last death question', async t => {
  const { game } = await start(t, { seed: 7, ...valkyrie });
  let result = await game.act({ extended: 'quit' });
  assert.equal(result.prompt.text, 'Really quit without saving?');
  result = await game.act({ answer: 'y' });
  for (let i = 0; i < 10 && result.prompt.kind === 'yn'; i++) result = await game.act({ answer: 'n' });
  assert.equal(result.settled, true);
  assert.equal(result.prompt.kind, 'game_over');
  assert.equal(result.gameOver.complete, true);
  assert.ok(result.gameOver.lines.some(line => /REST/.test(line)));
  await assert.rejects(game.act({ keys: ['s'] }), /The game has ended/);
});
