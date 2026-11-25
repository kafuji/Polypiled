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

## Weapon skill families

Skill with one weapon carries over to the rest of its family. A weapon is
used at one level below the best skill in its family when that is higher
than its own skill, though never above the weapon's own role limit. For a
weapon the role cannot train, that limit is Basic. #enhance lists a
restricted weapon whose family raises it to Basic, and shows the family
level next to the weapon's own. Practice still goes only to the weapon
actually used. Multishot, polearm reach and jousting still use the weapon's
own skill.

| Family | Skills |
|---|---|
| Short blades | dagger, knife |
| Swords | short sword, broadsword, long sword, two-handed sword, saber |
| Axes | axe, pick-axe |
| Blunt | club, mace, morning star, flail, hammer, quarterstaff |
| Pole weapons | polearms, spear, trident, lance |
| Bows | bow, crossbow |
| Thrown | dart, shuriken, boomerang |

Sling, whip and unicorn horn have no family. (`skill_family`,
`family_weapon_skill()` and `effective_weapon_skill()` in `weapon.c`)

## Lowered characteristics recover

A characteristic below its peak, lowered by poison, a mind flayer or the
like, comes back on its own one point at a time.

- **How fast.** Each turn a point returns with odds of 1 in (600 - 20 x Con),
  at best 1 in 50. That is about one point every 400 turns at Con 10 and
  every 240 at Con 18. Poison resistance halves the wait.
- **What heals.** Only the gap between the current value and the peak
  heals. A peak that was itself lowered stays down.
- **Sustain ability.** It does not stop the recovery, just as it does not
  stop restore ability.

(`recover_lowered_attrib()` in `attrib.c`)

## Artifacts as the secondary weapon

An artifact may be held in the off hand for two-weapon combat; vanilla
refused it as the secondary weapon. The exception is two intelligent
artifacts of different alignments, such as Excalibur and Stormbringer: they
"refuse to fight side by side", and two-weapon combat does not start, or
ends at the next attack. (`artifacts_feud()` in `artifact.c`,
`can_twoweapon()` in `wield.c`)

## Shops

- **No mimics.** Shops never generate mimics among their stock, and a random
  monster that would be placed inside a shop is rerolled if it is a mimic.
- **The shopkeeper protects customers.** A peaceful shopkeeper fights
  hostile monsters that trouble the hero inside the shop ("Nobody bothers my
  customers!"). While the hero owes money, it strikes only at what comes
  within reach and stays at the door. (`shk_defend_customer()` in `shk.c`)
- **Shops restock.** Coming back to a level after 1,000 or more turns
  refills some empty shelves with the shop's kind of goods: 15% per spot per
  1,000 turns, up to 50%. Shops with an angry or absent shopkeeper, and the
  black market, do not restock. (`restock_shops()` in `shknam.c`)
- **Paid identification.** Chatting with a shopkeeper in the shop offers to
  identify goods of the kinds the shop deals in. The fee is the item's list
  price, at least 50; general stores charge 1.5 times that and the black
  market twice. Only the item's kind is learned: not its blessed/cursed
  status, enchantment or charges. (`shk_appraise()` in `shk.c`)
- **Pets don't shoplift.** A pet that picks up unpaid goods inside the shop
  is stopped at the door, and the shopkeeper takes them back and puts them
  back on the shelves ("That stays in the shop!"). The goods are marked when
  picked up (`LOST_SHOPGOODS`), so goods a pet brought in from outside are
  not affected. (`shk_reclaim_from_pet()` in `shk.c`)
- **Pick-axes and steeds are welcome.** Only an invisible hero is turned
  away at the door. Digging out of a shop is already handled: the
  shopkeeper grabs the hero's pack or bills for the wall, and a wand of
  digging was never refused. (`u_entered_shop()` in `shk.c`)

## Mid-dungeon set pieces

Every game has a "midway" level at depth 13 to 16, with one of three set
pieces (`dungeon.lua`, `midway-*.lua`):

- **The battlefield.** An elven host and an orcish horde fight over open
  ground between two palisaded camps, and each camp has a war chest. The
  side of the hero's own kind is peaceful: the orcs for an orcish hero, the
  elves for everyone else. The level flag `warzone` makes elves and orcs
  attack each other on sight and march on the nearest enemy soldier within
  20 squares.
- **The giants' dining hall.** Twenty-one giants lie around a lava hearth
  amid the leftovers of a feast; three of them are awake and the rest
  asleep. There is a locked strongroom with gems.
- **The adventurers' mausoleum.** Rows of graves with epitaphs and buried
  relics, with undead about, and a haunted, locked tomb with a chest at its
  centre.

## The thieves' den

Every game has the thieves' den on the level just above Medusa. A trapped
maze surrounds a guard hall and a black market (`FENCESHOP`).

- **Prices.** It buys anything at the usual rate and sells at twice the
  usual price.
- **What it stocks.** The stock leans towards what this game has held back.
  - Kinds the hero has never seen weigh x4. Kinds seen but never carried
    weigh x2. Only magical or valuable kinds (list price 100 or more) get
    this boost.
  - Harmful kinds weigh a sixth of normal, and cheap mundane goods much
    less.
  - It never stocks dragon armor or the shield of reflection.
  - A magic lamp, a magic whistle and a unicorn horn are always stocked
    while the hero has never seen or carried that kind.
  - One second-hand wand of wishing is always on sale. It has been
    recharged once and has one charge left.
  - Some squares hold an artifact that is still unclaimed.
- **Condition of goods.** Goods are never cursed, often blessed, and never
  negatively enchanted or eroded. Weapons are mostly enchanted, by +1 to +3
  and sometimes up to +5.
- **The fence.** It goes by an alias. It is level 25 with 220 or more HP,
  and carries wands of death, sleep and lightning, healing potions and good
  armor.
- **The guards.** The guards it has bribed, captains and watchmen with
  attack wands, answer the alarm instead of the Keystone Kops. Crossing a
  guard angers the fence as well.

## Fountains

Each fountain holds one kind of water, chosen when it is made, and has one
wonder to give in its life (`fountain.c`).

- **Water.** The water is cool (40%), tepid (35%), foul (15%) or poisoned
  (10%). Drinking always gives that water's effect:
  - cool water feeds a little and heals 2d4 HP
  - tepid water feeds a little
  - foul water makes the hero vomit
  - poisoned water saps strength or hurts

  Dipping a non-cursed unicorn horn into a poisoned fountain purifies it.
- **The wonder.** Each drink or dip has a 1 in 3 chance of giving the
  fountain's one wonder. The wonder is one of:
  - self-knowledge, see invisible or monster detection
  - a gem or coins
  - a water demon, a water nymph or snakes
  - cursing, a gush, or scaring monsters

  A magic fountain's wonder is the ability boost, given with non-negative
  luck.
- **Lifting curses.** Dipping lifts a curse 4 times in 30.
- **Drying up.** A drink or dip dries the fountain 1 time in 6. A fountain
  lasts about six uses, and three in four give their wonder first. Fire and
  gremlins still dry it 1 time in 3.

## Sinks

- **The tap.** Drinking from a sink always gives a sip of tap water that
  feeds a little. About one sink in four has a tap that only runs scalding
  hot and burns for 1d6 without fire resistance.
- **Up the drain.** One drink in four also brings something up the drain:
  - a sewer rat, a potion, a ring or a water elemental
  - awful water (+1 experience)
  - sewage (vomiting) or toxic waste (polymorph)
  - a stench

  A drink breaks the pipes 1 time in 20, as before.
- **Lost rings come back.** A ring dropped down the drain is not destroyed.
  It lies under the sink, and the next time the drain backs up, the ring
  that went down first comes back. The drain backs up from kicking, from a
  potion of levitation, or from the ring result when drinking.
- **Kicking.** Kicking a sink does something 1 time in 2 (vanilla: 1 in 5).
- **New fountains.** A fountain made by breaking a sink, or by pouring
  polymorph down it, is a fresh one with its own water and an unspent
  wonder.

## Interface-side core changes

Some core changes serve Polypiled's own interface.

- **Left click.** A plain left click always moves the hero, or attacks a
  hostile monster in the way, and travels when the target is farther away.
  It never picks a context action such as "Throw something" or "Ride".
  (`cmd.c`)
- **Stepping onto objects.** Stepping onto objects the hero can see prints
  nothing; the floor panel lists the terrain, traps, engravings and objects
  there. `:` and feeling around while blind are unchanged. (`invent.c`)
- **Inventory screen.** It can drop several objects in one action, ready an
  object as the alternate weapon, and sort, giving the letters out again in
  the new order. (`win/shim/nh3d_knowledge.c`)

## Overeating

Choking to death on food is gone. Eating past full (2,000 nutrition) puts
the hero into a food coma, helpless for 10 to 20 turns with no early waking.
The meal stops there, and what is left stays partly eaten. Breathless
heroes, and heroes with the Hunger property, still vomit instead, as
before. Swallowing an amulet of strangulation still chokes. (`choke()` in
`eat.c`)

## No mysterious force

Climbing out of Gehennom with the Amulet no longer sends the hero back down
at random. (`goto_level()` in `do.c`)

## Power regeneration

Pw comes back about half again as fast at low level, and about the same at
the top. A point returns every (38 - XL) x 4 / 12 + 3 turns, or
(38 - XL) x 3 / 12 + 3 for Wizards:

| XL | Polypiled | Vanilla | Wizard, Polypiled | Wizard, vanilla |
|---|---|---|---|---|
| 1 | 15 | 24 | 12 | 18 |
| 14 | 11 | 16 | 9 | 12 |
| 30 | 5 | 5 | 5 | 4 |

The amount restored each time is unchanged. (`regen_pw()` in `allmain.c`)

## Spell memory

Spells are no longer forgotten with time, so there is no rereading a book
every 20,000 turns. Amnesia still wipes them. (`age_spells()` in `spell.c`)

## Item destruction

Fire, cold and lightning destroy about half as much of what the hero or a
monster carries:

- one stack at risk per 10 HP of the attack's damage (vanilla: 5)
- 1 in 6 of each stack lost (vanilla: 1 in 3)

(`destroy_items()` and `maybe_destroy_item()` in `zap.c`)

## Bag of holding safety

Putting something into a bag of holding asks first when the hero can tell
that it would blow the bag up. Both the bag and the item must be
identified. The item can be:

- a bag of holding
- a wand of cancellation or bag of tricks that may have charges
- a container the hero has looked into that holds one of these

Unknown items still blow the bag up without asking. (`mbag_danger_known()`
in `pickup.c`)

## Monsters at a glance

The game shows what anyone can tell by looking at a monster:

- **Farlook.** Farlook says how hurt a monster the hero actually sees looks:
  - uninjured
  - wounded: at least half its HP
  - badly wounded: at least 15%
  - nearly dead

  (`mon_looks_hurt()` in `pager.c`)
- **Hover label.** When the pointer rests on such a monster on the map, the
  shell shows its name and the same health word. The core sends the list
  of monsters the hero sees as the notification `shim_monster_glance`
  (`nh3d_knowledge.c`). The label is in `src/plus/monster-glance/`.

Some monsters are not described: those sensed by telepathy, warning or
detection, disguised mimics, hiders, and anything seen while hallucinating.
A stethoscope still gives exact figures.

## Identification by obvious effect

- **Engraving.** Engraving with a wand identifies it when no other wand has
  the same effect (`engrave.c`):
  - striking ("fights your attempt to write")
  - slow monster and speed monster
  - magic missile and cold
  - polymorph, when it rewrites an existing engraving
- **See invisible.** A potion of see invisible is identified when it shows
  the hero an invisible monster in view. (`peffect_see_invisible()` in
  `potion.c`)

## Priests read blessings

Chat with a peaceful temple priest while carrying items whose blessed or
cursed state is unknown, and the priest offers to read them all. The fee
is 20 zorkmids per such item (a stack counts once), at least 50. Accepting
tells the blessed/cursed state of everything carried, but not of container
contents. Declining goes on to the usual donation.
(`priest_reads_blessings()` in `priest.c`)

## Gehennom

- **Fewer mazes.** Half the filler levels are one of the two open cavern
  styles; the other half are one of the five maze styles. Vanilla picked
  among all seven equally. (`hellfill.lua`)
- **Mapped on arrival.** The first time the hero arrives at a filler level,
  they take in its layout at a glance, as magic mapping would. Traps,
  objects and monsters stay unknown. (`goto_level()` in `do.c`)

## Polypiling

A polymorph zap (wand or spell) changes the objects on a square together.
Coins, boulders, statues, containers and objects that resist polymorph get
the usual handling. (`polypile_mix()` in `zap.c`)

### Mixing piles

- **One object alone** changes at random, as in vanilla.
- **Two or more objects**, counting a stack's quantity, mix:
  - **Golems.** First the pile may rise as a golem of its main material.
    The chance is mass / 40 percent, at most 50%.
    - The golem is the heaviest one of that material the mass can make, so
      a bigger pile makes a stronger golem.
    - The golem takes its weight out of the pile; the rest is left
      unchanged.
  - **Taking shape.** Otherwise the class with the most objects takes shape,
    if it makes up at least half the pile. Every three objects of it become
    one, rounded up. Each new object is the dearest of several draws from
    the class:
    - 1 draw, plus one more for every doubling of the class's count
    - two more if it is all the same kind, or one more if it is all the
      same material
    - at most 9 draws

    A big pile of one kind can turn out far more valuable than it went in.
  - **Junk.** Objects of the other classes fall to junk, or the whole pile
    does when no class is half of it. So does the mass the class loses in
    fusing. Junk is rocks (80% of its mass, one rock per 10 weight) and
    worthless glass (the rest, one per weight).
- **Dead ends.** Rocks and worthless glass no longer polymorph. They mark a
  pile that has been polypiled to the end.

### Containers

A container with something in it is polymorphed on its own:

- **It becomes another container.** It keeps its contents.
- **It becomes anything else.** It trembles for a while, then bursts. The
  delay depends on the blessed/cursed state of the wand or of the potion
  dipped into; a spell counts as uncursed:

  | Source | Hero's turns before it bursts |
  |---|---|
  | Cursed | 0 to 1 |
  | Uncursed | 1 to 2 |
  | Blessed | 2 to 3 |

  Taking the contents out in time disarms it. A pet may also pick it up
  and bring it over.

When it bursts, the contents are ground to dust and the container becomes
something else of its class. The contents' real mass counts, so a packed
bag of holding makes a far bigger blast than its weight suggests. Half the
mass becomes the blast and half becomes fragments.

#### The blast

- **Spread.** The force starts on the square of the burst and the adjacent
  squares, then halves at each ring outward until nothing is left. With
  contents of 100 it is 50, 25, 12, 6, 3 and 1.
- **Damage.** Each creature it reaches takes the force as physical damage,
  so half physical damage halves it.
- **Fragile things.** A force of 10 or more breaks exposed fragile things:
  ones on the floor or carried, but not worn and not in containers. That
  covers potions, eggs, mirrors and crystal balls, but not glass wands or
  gems.
- **Obstacles.** Closed doors break at 10, boulders at 20 (into rocks), and
  diggable walls and rock at 30. Breaking one uses up that much force, and
  the rest goes on, halving as usual. An obstacle that holds stops the
  blast behind it; undiggable walls and trees always hold.
- **Crowds.** A creature passes on only half of what it would have, so a
  crowd shields what is behind it.

#### The fragments

- **Number.** 80% of the fragment mass flies out as rocks, one per 10
  weight; the rest flies out as glass shards, one per weight. Each goes in
  a random direction.
- **Damage.** A rock starts at 50 damage and a shard at 10. Each loses 1
  for every square it flies and drops when it reaches 0. A rock can cross
  most of the map; shards act as buckshot near the blast.
- **Hitting.** A fragment rolls to hit against AC like a thrown rock: it
  hits if 1d25 is under 15 + AC. A worn shield blocks one in four fragments
  that reach the hero.
- **Passing through.** A fragment passes through the first creature it
  hits. It stops in the second, which takes half damage.
- **Obstacles.** Walls, closed doors and boulders stop fragments without
  breaking.
- **Landing.** Fragments drop as worthless rocks and glass where they stop.

#### Responsibility

The hero answers for everything a burst does:

- kills, and the alignment and luck that follow from them
- angering peacefuls, shopkeepers and priests included
- shop walls and doors, billed as for digging
- shop goods destroyed inside a container on the shop floor

The burst is handled by `container_burst()`, a new object timer
(`CONTAINER_BURST`).

## Pet orders

Chat with a pet the hero can see, and after its usual noise a menu of
orders opens (`pet_orders()` in `dog.c`). The orders are kept in spare bits
of `struct edog`, so the save layout is unchanged.

- **Stay here.** The pet holds its square and still fights whatever comes
  next to it. It is left behind when the hero changes level.
- **Follow me.** The pet keeps close. When the hero changes level, it comes
  along from anywhere on the level, not only from beside the hero, if it
  finds the way:
  - dogs always
  - cats half the time
  - horses and other u-class monsters 40% of the time
  - other pets 75% of the time

  Trapped or eating pets still stay behind.
- **Do as you please.** The pet goes back to its usual behavior.
- **Fetch things for me / Stop fetching things.** While fetching, the pet
  picks things up and brings them to the hero as a well-trained pet does. It
  counts as having an apport of at least 12.
- **Take this.** This is offered only for pets that have hands and are
  neither animals nor mindless. The hero hands over an item. The pet puts
  it on if it can wear it; otherwise it keeps it and may wield it on its
  own turn. Worn items must be taken off first.
