# Rule changes

Where Polypiled's rules differ from NetHack 5.0. Each change in the C source
is marked with a `Polypiled:` comment.

## Food spoilage

Spoilage no longer comes down to a die roll at the moment of eating, and the
hero notices it before the first bite.

- **Corpses rot at a fixed pace.** Each corpse decays one stage every 25 to 44
  turns, a pace fixed for that corpse (vanilla re-rolls 10 to 29 on every
  bite). A corpse is rotten from stage 4 and tainted from stage 6, so no
  corpse is rotten before 100 turns or tainted before 150 (vanilla: 40 and
  60). Blessed and soon-to-rise corpses still count 2 stages younger and 5
  older. (`ROT_PACE_MIN`, `ROT_PACE_SPREAD` in `hack.h`;
  `corpse_rot_stage()` in `eat.c`)
- **A fresh kill is never rotten.** Vanilla gave every corpse a 1 in 7 chance
  of a "rotten" first bite whatever its age.
- **Zombies, vampires and graves leave old corpses**, rotten from the start;
  they may be tainted. (`ROTTEN_CORPSE_AGE`)
- **Mummies leave dried meat.** Their corpses start 100 turns fresher than a
  kill instead of old. (`MUMMY_CURE_AGE`)
- **Other food keeps.** Only cursed food, or food already found rotten, is
  spoiled. Vanilla gave any non-corpse food older than 30 turns a 1 in 7
  chance of being rotten.
- **The smell gives it away.** Before eating spoiled food the hero is told
  that it smells rotten, putrid (tainted) or a bit off, and is asked whether
  to eat it anyway. Stale eggs are included; tins are not, since their
  contents are seen when opened. (`food_spoilage_declined()` in `eat.c`)
- **Cursed food deceives.** A cursed corpse rots twice as fast (12 to 22
  turns a stage; vanilla counts it 2 stages older), and cursed food gives no
  warning when it has spoiled: it "looks so delicious" instead, until the
  hero has once found it rotten. Blessed food detection still sees through
  it.

## Hunger

Hunger gives more warning before it turns dangerous. The hero is Hungry at
400 nutrition or less and Weak at 100 or less (vanilla: 150 and 50), so at
one nutrition a turn Hungry lasts about 300 turns and Weak about 100 before
fainting begins (vanilla: 100 and 50). Fainting and starvation, the nutrition
limits for satiation and choking, and the nutrition of food are unchanged.
(`HUNGRY_NUTRITION`, `WEAK_NUTRITION` in `hack.h`)

## Sokoban

Nothing that stays put is generated in Sokoban, since one could settle on the
only square a boulder can pass and leave the puzzle unsolvable: no monsters
of speed 0 (molds, jellies and the like), no mimics, and no hiders such as
piercers and trappers (`stays_put()` in `makemon.c`). The two giant mimics
posing as boulders that vanilla places at random on the top level are gone
too (`soko1-*.lua`).

## Experience levels

Levels come on one smooth curve. The experience needed grows by x2.00 from
XL2 to XL3 and the growth falls steadily to about x1.28 by XL30, where
vanilla doubles every level up to XL20 and then adds 10,000,000 a level. The
early levels are a little quicker than vanilla (XL10 at 3,210 instead of
5,120), and the gap widens from there:

| Level | Polypiled | Vanilla |
|---|---|---|
| XL10 | 3,210 | 5,120 |
| XL14 (quest entry) | 27,300 | 80,000 |
| XL20 | 412,000 | 5,120,000 |
| XL30 | 10,000,000 | 100,000,000 |

Experience from kills and other sources is unchanged, and so is the quest's
XL14 entry level. Since the strongest monsters a level can generate depend
on the hero's level as well as the depth, they also turn up a little sooner.
(`uexp_table` in `exper.c`, mirrored in
`src/ui/app/status/character-fields.tsx`)

## Worn armor weight

Armor the hero has on counts for half its weight (rounded up) in the load:
body armor, cloak, helmet, gloves, boots and shirt. A shield is held and
counts in full. Armor being put on counts in full until it is on; armor
being taken off counts as worn until it is off. The object's own weight is
unchanged, so throwing, kicking and containers behave as before, and the
inventory screen shows only the weight that counts now.
(`carried_obj_weight()` in `hack.c`)

## Pets' food

Plant eaters such as horses no longer starve for want of apples and carrots.

- **Any fruit or greens is a treat** to a plant eater, as apples and carrots
  were: oranges, pears, melons, bananas, kelp fronds and eucalyptus leaves.
  Throwing one at a wild horse tames it like an apple. (`dogfood()` in
  `dog.c`)
- **Vegetarian fare is eaten when hungry.** Food rations, cram, lembas,
  pancakes and other non-meat food now count as acceptable food for plant
  eaters, as they already did for meat eaters; vanilla had plant eaters
  touch them only when starving. A food ration keeps a horse about 3,200
  turns.
- **Food underfoot is eaten when hungry.** A pet standing on acceptable food
  eats it once hungry, as it already did when stepping onto it; vanilla
  waited until it was starving. A ridden steed only ever eats what is under
  it, so dropping food while riding now feeds it in time. (`dog_invent()` in
  `dogmove.c`)

## Missiles

Arrows and other missiles that hit break about half as often, so a quiver
lasts into the middle of the game. Of the missiles that hit, these break,
by enchantment less erosion:

| Enchantment | Polypiled | Vanilla |
|---|---|---|
| -2 or worse | 2 in 3 | 4 in 5 or more |
| -1 | 1 in 2 | 3 in 4 |
| +0 | 1 in 3 | 2 in 3 |
| +1 | 1 in 4 | 1 in 2 |
| +2 | 1 in 6 | 1 in 4 |
| +3 or better | 1 in 8 | 1 in 4 |

A blessed missile survives 1 in 4 of its breaks whatever the luck (vanilla:
depending on luck for the hero, 1 in 3 for monsters). Flint and hard gems
still survive half of theirs, and missiles that miss never break. Monsters'
missiles follow the same rule, so more of them are left to pick up.
(`should_mulch_missile()` in `dothrow.c`)
