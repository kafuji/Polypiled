# Rule candidates

An overview of Polypiled's rule changes for planning: what is accepted, what
is put off, and what is already done. Details of the changes that are done
live in `rule-changes.md` and in the `Polypiled:` comments in the C source.
When a candidate is implemented, move it to "Done" here and describe it in
`rule-changes.md`. Ideas taken from other variants say so; those attributions
are from memory and may be loose.

## Accepted

Most of what was accepted is now done (see "Done"). These parts are still
open.

### Pets

- **Training and skill.** A beast-handling skill for the hero and a training
  level for the pet.
- **Pet armor.** For example barding for steeds (some variants have it,
  EvilHack among them).
- **Arriving later.** A pet told to follow comes along at once. Having it
  turn up a few turns after the hero is still open.

### Polypiling

- **Unknown piles.** How much the hero can foresee about a pile of
  unidentified items.
- **Vanishing.** A single object zapped alone still shudders and may vanish
  as in vanilla; whether to keep that is open.
- **Crafting.** If a crafting system comes, burst contents could break down
  by material (iron, aluminium, gold and silver, gems) instead of rocks and
  glass.

### Food coma

- **Length.** Whether the coma should scale with how far past full the meal
  went; it is a flat 10 to 20 turns now.

### Gehennom

- **Fewer levels.** Fewer filler levels, or more varied ones such as themed
  caverns and small set pieces; only the maze share and mapping on arrival
  are done.

## Not for now

- Warnings before instadeaths (after FIQHack, UnNetHack)
- Autoexplore
- Hints about whether it is safe to pray (after NetHack4, DynaHack)
- New roles, races or large dungeon additions. They are costly to keep in
  step with 5.0 and would bloat the tiles and portraits.
- A full monster AI rework (after EvilHack, GruntHack)

## Done

One line each, grouped by theme; `rule-changes.md` has the details.

### Food and hunger

- Corpses rot at a fixed pace for each corpse; a fresh kill is never rotten;
  other food keeps.
- The smell warns of spoiled food before the first bite. Cursed food fools
  the smell.
- Hungry from 400 nutrition and Weak from 100, so the warning comes earlier.
- Plant-eating pets eat any fruit or greens and vegetarian rations; pets eat
  food underfoot once they are hungry.

### Character growth

- Experience levels follow one smooth curve; XL14 comes at 27,300.
- Weapon skill families: skill in one weapon carries over to the rest of its
  family one level lower.
- Lowered characteristics such as Str lost to poison come back on their own,
  faster with high Con.
- Pending: poison can keep lowering Str with no floor.

### Equipment and combat

- Worn armor counts for half its weight; a shield counts in full.
- Missiles that hit break about half as often.
- An artifact may be the secondary weapon, but two self-willed artifacts of
  different alignments won't be wielded together.

### Shops

- No mimics among the stock.
- The shopkeeper protects customers from hostile monsters.
- Shops restock while the hero is away.
- Paid identification: the shopkeeper identifies the kinds of goods the shop
  deals in, for a fee.
- The shopkeeper takes back goods a pet carries to the door.
- Pick-axes and steeds are allowed in; only invisibility is refused.

### Dungeon and terrain

- One of three mid-dungeon set pieces is always present: the battlefield
  (elves and orcs fight on sight), the giants' dining hall or the
  adventurers' mausoleum.
- The thieves' den, a black market, sits just above Medusa. Prices are
  double, and the guards are bribed.
- Each fountain holds one kind of water and gives one wonder in its life.
  Its water sometimes lifts a curse, and a unicorn horn purifies a poisoned
  fountain.
- About one sink in four has a scalding hot tap. A ring that went down the
  drain lies under the sink and comes back first.
- Sokoban has no monsters that stay put and no mimics posing as boulders.

### Interface-side core changes

- A plain left click always moves or attacks, and travels when the target is
  farther away.
- A click onto known water next to the hero asks "Really step into the
  water?" instead of refusing, since a click cannot carry the 'm' prefix.
  Identified water walking needs no question, as before.
- Stepping onto visible objects says nothing; the floor panel shows them
  instead.
- The inventory screen supports dropping several items at once, readying
  the alternate weapon, and sorting with letters given out again.
- Portrait conversations, including the shopkeeper's speech.
- The core reports each melee blow of the hero with the hand that struck and
  whether it hit (`nh3d_hero_blow`), and a fall into water by the hero or a
  seen monster (`nh3d_fell_into_water`), for the weapon swing and splash
  animations.

### Added from the candidate list

- No mysterious force on the way up with the Amulet.
- Overeating means a food coma of 10 to 20 turns instead of choking to death.
- Pw comes back about half again as fast early on.
- Spells are not forgotten with time.
- Fire, cold and lightning destroy about half as many items.
- A known bag of holding asks before something the hero knows would blow it
  up goes in.
- Farlook and a hover label tell how hurt a seen monster looks.
- Wands with a one-of-a-kind engrave effect, and a potion of see invisible
  that reveals something, are identified.
- Temple priests read the blessed/cursed state of the pack for a fee.
- Gehennom: half the filler levels are caverns, and the hero takes in each
  filler level's layout on arrival.
- Polypiling reworked: piles mix and take shape, junk ends in rocks and
  glass, big piles may rise as golems, and a polymorphed container trembles
  and bursts.
- Pets take orders through #chat: stay, follow (across stairs from anywhere
  on the level), do as they please, fetch, and, for those with hands, take
  something to wear or wield.
