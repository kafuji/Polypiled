// Polypiled's rule changes (docs/rule-changes.md), checked against the real
// core. Each test sets up its scene in debug mode where it needs to and
// tells the change from vanilla's behaviour.
//   node --test scripts/headless/rules.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { startHeadlessGame } from './game-client.mjs';

const valkyrie = { role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' };

async function debugGame(t, options = {}) {
  const { game, observation } = await startHeadlessGame({ seed: 5, playmode: 'debug', ...valkyrie, ...options });
  t.after(() => game.close());
  return { game, observation };
}

const texts = result => result.messages.map(message => message.text);
const item = async (game, pattern) => (await game.inventory()).items.find(entry => pattern.test(entry.name));
const menuItem = (result, pattern) => result.prompt.items.find(entry => entry.isSelectable && pattern.test(entry.text));

/** Run a command that asks which item, and choose it. */
async function useItem(game, keys, pattern) {
  let result = await game.act({ keys });
  if (result.prompt.kind === 'yn' && /here/.test(result.prompt.text)) result = await game.act({ answer: 'n' }); // not the floor
  assert.equal(result.prompt.kind, 'menu', `${keys} should ask which item`);
  return game.act({ select: [{ index: menuItem(result, pattern).index }] });
}

async function wait(game, turns) {
  for (let left = turns; left > 0; left -= 20) await game.act({ keys: [...String(Math.min(20, left)), 's'] });
}

describe('rule changes', { concurrency: true }, () => {
  test('Hunger: Hungry starts at 400 nutrition (vanilla 150)', async t => {
    const { game } = await debugGame(t);
    let hungry = null;
    for (let i = 0; i < 60 && !hungry; i++) {
      const result = await game.act({ keys: ['2', '0', 's'] });
      if (result.statusChanges.hunger?.to === 'Hungry') hungry = result;
    }
    assert.ok(hungry, 'the hero gets hungry');
    const { nutrition } = (await game.reveal()).hero;
    assert.ok(nutrition <= 400 && nutrition > 380, `Hungry at ${nutrition}`);
  });

  test('Worn armor weight: armor on counts half its weight', async t => {
    const { game } = await debugGame(t);
    await game.wish('ring mail');
    const before = await game.inventory();
    const mail = before.items.find(entry => /ring mail/.test(entry.name));
    assert.equal(mail.weight, 250);
    let result = await game.act({ inventory: { op: 'wear', item: mail.letter } });
    for (let i = 0; i < 10 && result.prompt.kind !== 'command'; i++) result = await game.act({ dismiss: true });
    await wait(game, 5); // ring mail takes 5 turns to put on
    const after = await game.inventory();
    assert.equal(after.items.find(entry => entry.id === mail.id).weight, 125);
    assert.equal(after.weight, before.weight - 125);
  });

  test('Overeating: a food coma instead of choking to death', async t => {
    const { game } = await debugGame(t);
    await game.wish('3 food rations');
    const said = [];
    for (let meal = 0; meal < 2; meal++) {
      let result = await useItem(game, ['e'], /food ration/);
      for (let i = 0; i < 12 && result.prompt.kind !== 'command'; i++) {
        said.push(...texts(result));
        result = await game.act(result.prompt.kind === 'yn' ? { answer: 'y' } : { dismiss: true });
      }
      said.push(...texts(result));
    }
    assert.ok(said.includes('You pass out from overeating.'), said.join(' / '));
    assert.ok(said.includes('You come out of your food coma.'), said.join(' / '));
    assert.equal((await game.observe({ map: false })).gameOver, null, 'the hero lives');
    assert.ok((await game.reveal()).hero.nutrition > 1900, 'the meal went past full (2,000), less the turns of the coma');
  });

  test('Food spoilage: a fresh corpse is fine; an old one smells putrid before the first bite', async t => {
    const { game } = await debugGame(t);
    await game.wish('newt corpse');
    const fresh = await useItem(game, ['e'], /newt corpse/);
    assert.ok(texts(fresh).includes('This newt corpse tastes okay.'));

    await game.wish('newt corpse');
    await wait(game, 200);
    const old = await useItem(game, ['e'], /newt corpse/);
    assert.deepEqual(old.prompt, { kind: 'yn', text: 'The corpse smells putrid.  Eat it anyway?', choices: 'yn', default: 'n' });
    assert.equal((await game.act({ answer: 'n' })).prompt.kind, 'command');
    assert.ok(await item(game, /newt corpse/), 'declining leaves the corpse uneaten');
  });

  test('Food spoilage: other food keeps', async t => {
    const { game } = await debugGame(t);
    await game.wish('5 uncursed apples');
    await wait(game, 200);
    for (let apple = 0; apple < 5; apple++) {
      const result = await useItem(game, ['e'], /apple/);
      assert.equal(result.prompt.kind, 'command', 'no smell warning');
      assert.ok(!texts(result).some(text => /rotten|Blecch/.test(text)), texts(result).join(' / '));
    }
  });

  test('Power regeneration: a Wizard at XL1 regains Pw every 12 turns (vanilla 18)', async t => {
    const { game } = await debugGame(t, { role: 'wizard', race: 'human', gender: 'male', align: 'neutral' });
    let result = await game.act({ keys: ['Z'] });
    result = await game.act({ select: [{ index: menuItem(result, /force bolt/).index }] });
    if (result.prompt.kind === 'direction') result = await game.act({ move: 'up' });
    assert.ok(result.statusChanges.ene, 'casting costs Pw');
    const gains = [];
    for (let turn = 0; turn < 40; turn++) {
      const searched = await game.act({ keys: ['s'] });
      if (searched.statusChanges.ene) gains.push(Number(searched.statusChanges.time.to));
    }
    assert.ok(gains.length >= 3, `Pw came back at turns ${gains}`);
    for (let i = 1; i < gains.length; i++) assert.equal(gains[i] - gains[i - 1], 12);
  });

  test('Identification by obvious effect: engraving with a wand of striking names it', async t => {
    const { game } = await debugGame(t);
    await game.wish('wand of striking');
    const wand = await item(game, /wand/);
    assert.doesNotMatch(wand.name, /striking/, 'not known yet');
    let result = await useItem(game, ['E'], new RegExp(wand.name.replace(/^an? /, '')));
    const said = [];
    for (let i = 0; i < 6 && result.prompt.kind !== 'command'; i++) {
      said.push(...texts(result));
      result = await game.act(result.prompt.kind === 'yn' ? { answer: 'n' } : result.prompt.kind === 'text' ? { text: 'x' } : { dismiss: true });
    }
    said.push(...texts(result));
    assert.ok(said.includes('The wand unsuccessfully fights your attempt to write!'), said.join(' / '));
    assert.match((await game.inventory()).items.find(entry => entry.id === wand.id).name, /wand of striking/);
  });

  test('Bag of holding safety: putting a known bag of holding in one asks first', async t => {
    const { game } = await debugGame(t);
    await game.wish('bag of holding');
    await game.wish('bag of holding');
    await game.wish('blessed scroll of identify');
    const read = await useItem(game, ['r'], /scroll/);
    assert.ok(texts(read).some(text => /bag of holding/.test(text)), 'the bags are identified');
    const bags = (await game.inventory()).items.filter(entry => /bag of holding/.test(entry.name));
    assert.equal(bags.length, 2);
    const asked = await game.act({ inventory: { op: 'loot', container: bags[0].id, out: [], in: [bags[1].id] } });
    assert.equal(asked.prompt.kind, 'yn');
    assert.match(asked.prompt.text, /^Putting that inside will blow up the bag of holding\.  Do it anyway\?$/);
    await game.act({ answer: 'n' });
    assert.equal((await game.inventory()).items.filter(entry => /bag of holding/.test(entry.name)).length, 2, 'nothing blew up');
  });

  test('Polypiling: a pile fuses into a third as many objects of its class; rocks stay rocks', async t => {
    const { game } = await debugGame(t);
    await game.wish('wand of polymorph');
    await game.wish('9 daggers');
    const zapDown = async () => {
      let result = await useItem(game, ['z'], /wand/);
      if (result.prompt.kind === 'direction') result = await game.act({ move: 'down' });
      for (let i = 0; i < 6 && result.prompt.kind !== 'command'; i++) result = await game.act({ dismiss: true });
      return result;
    };
    const daggers = (await game.inventory()).items.filter(entry => /dagger/.test(entry.name)).sort((a, b) => b.quantity - a.quantity)[0];
    assert.equal(daggers.quantity, 10, 'the wished daggers join the starting one');
    await game.act({ inventory: { op: 'drop', items: [{ id: daggers.id }] } });
    const fused = await zapDown();
    assert.ok(texts(fused).includes('The pile shimmers and fuses!'));
    const here = (await game.reveal()).objects.filter(object => object.x === fused.hero.x && object.y === fused.hero.y);
    assert.equal(here.reduce((sum, object) => sum + object.quan, 0), 4, `10 daggers make 4 objects: ${here.map(object => object.name)}`);

    for (const object of (await game.inventory()).floor) await game.act({ inventory: { op: 'pickup', items: [{ id: object.id }] } });
    await game.wish('20 rocks');
    await game.act({ inventory: { op: 'drop', items: [{ id: (await item(game, /rocks/)).id }] } });
    await zapDown();
    assert.deepEqual((await game.inventory()).floor.map(object => object.name), ['20 rocks']);
  });

  test('Pet orders: chatting with a pet opens its orders', async t => {
    const { game, observation } = await debugGame(t);
    const pet = observation.monsters.find(monster => monster.pet);
    const step = { '-1,-1': 'nw', '0,-1': 'n', '1,-1': 'ne', '-1,0': 'w', '1,0': 'e', '-1,1': 'sw', '0,1': 's', '1,1': 'se' }[`${pet.x - observation.hero.x},${pet.y - observation.hero.y}`];
    assert.ok(step, 'the pet starts next to the hero');
    assert.equal((await game.act({ extended: 'chat' })).prompt.kind, 'direction');
    const orders = await game.act({ move: step });
    assert.equal(orders.prompt.kind, 'menu');
    assert.equal(orders.prompt.text, 'What do you tell the little dog?');
    assert.deepEqual(orders.prompt.items.map(entry => entry.text), ['Stay here.', 'Follow me.', 'Do as you please.', 'Fetch things for me.']);
  });

  test('Sokoban: nothing that stays put, and no mimics, in any seed', async t => {
    const staysPut = /\b(mold|blue jelly|spotted jelly|mimic|piercer|trapper|lurker above)\b/;
    await Promise.all([1, 2, 3, 4].map(async seed => {
      const { game } = await debugGame(t, { seed });
      for (const level of ['soko4', 'soko3', 'soko2', 'soko1']) {
        await game.levelTeleport(level);
        const { monsters } = await game.reveal();
        const bad = monsters.filter(monster => monster.mimic || staysPut.test(monster.name));
        assert.deepEqual(bad.map(monster => monster.name), [], `seed ${seed} ${level}`);
      }
    }));
  });

  test("The thieves' den: just above Medusa, with a wand of wishing and the held-back tools", async t => {
    const { game } = await debugGame(t);
    await game.levelTeleport('thieves');
    const den = await game.reveal();
    await game.levelTeleport('medusa');
    assert.equal((await game.reveal()).level.dlevel, den.level.dlevel + 1);
    const names = den.objects.map(object => object.name);
    for (const name of ['wishing', 'magic lamp', 'magic whistle', 'unicorn horn']) assert.ok(names.includes(name), `stocks ${name}`);
    assert.ok(den.monsters.some(monster => monster.name === 'shopkeeper' && monster.peaceful));
    assert.ok(den.monsters.filter(monster => /^watch/.test(monster.name)).length >= 4, 'the bribed guards');
  });

  test('Mid-dungeon set pieces: a midway level at depth 13-16 holds one of the three', async t => {
    await Promise.all([5, 6, 7].map(async seed => {
      const { game } = await debugGame(t, { seed });
      const moved = await game.levelTeleport('midway');
      const depth = Number(/Dlvl:(\d+)/.exec(moved.statusChanges.leveldesc.to)[1]);
      assert.ok(depth >= 13 && depth <= 16, `depth ${depth}`);
      const { monsters, objects } = await game.reveal();
      const count = pattern => monsters.filter(monster => pattern.test(monster.name)).length;
      const battlefield = count(/elf|Elvenking/) >= 5 && count(/orc|Uruk-hai/) >= 5;
      const giantsHall = count(/giant|titan|ettin|cyclops/i) >= 15;
      const mausoleum = count(/zombie|mummy|wraith|ghost|wight|vampire|lich/) >= 5 && objects.some(object => object.name === 'chest');
      assert.ok(battlefield || giantsHall || mausoleum, `seed ${seed}: ${monsters.map(monster => monster.name)}`);
    }));
  });
});
