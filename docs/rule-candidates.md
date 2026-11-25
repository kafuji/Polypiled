# Rule candidates

An overview of Polypiled's rule changes for planning: what is accepted, what
is put off, and what is already done. Details of the changes that are done
live in `rule-changes.md` and in the `Polypiled:` comments in the C source.
When a candidate is implemented, move it to "Done" here and describe it in
`rule-changes.md`. Ideas taken from other variants say so; those attributions
are from memory and may be loose.

## Accepted

### Identify by obvious effect (after xNetHack)

When using an item shows unmistakably what it is, the item gets its real
name. Examples: a wand whose engrave message has only one possible meaning,
a potion of see invisible that shows the hero something invisible, a ring
whose effect is plain to see. The aim is to stop the hero from knowing what
an item does while the game still won't name it.

### Less item destruction (after EvilHack, FIQHack)

Fire, cold and lightning destroy fewer potions, scrolls and rings, and fewer
of each stack. This follows on from the missile change.

### Spells are not forgotten (after FIQHack)

Either spell memory never runs out, or it lasts much longer. Rereading a
spellbook every 20,000 turns is only busywork.

### Confirm the irreversible

Ask before an action that would lose a lot by accident when the hero already
knows enough to see it coming. Examples: putting a known wand of
cancellation, or a known bag of holding, into a bag of holding. The rules
themselves stay the same.

### Priests read blessed/cursed status for a donation

This idea comes from the shopkeepers' paid identification. A temple priest
tells the blessed/cursed status of items in return for a donation, as an
alternative to dropping things on an altar.

### Overeating knocks the hero out instead of killing

Choking to death on food is gone. Eating past satiation now puts the hero
into a stupor for a while ("food coma"), which is helpless and dangerous
around monsters. Vomiting may come with it.

Not settled yet:

- How long the stupor lasts. One option is to scale it with how far past
  the limit the meal went.
- Whether the meal that caused it still finishes.
- Interactions with prayer while Satiated, and with the Monk's penalty.

### See how a monster is doing at a glance

Farlook, or hovering the mouse over a monster on the map, shows its name and
a rough health level: unhurt, wounded, badly wounded or near death. This is
information the hero could get just by looking.

- It shows only for a monster that is actually seen. It does not show for
  telepathy, warning or detection, for a disguised mimic, or for an unseen
  invisible monster.
- A stethoscope still gives exact figures.
- Core side: health tier from `mhp` / `mhpmax`, exported to the shell.
- Shell side: an overlay on hover or farlook.

### Commanding pets

This replaces the "pets follow more readily" idea.

- Through the conversation system (#chat with a pet), give orders such as
  "stay", "follow me" and "fetch items".
- A pet that is following comes along across stairs even when it is not
  adjacent; it turns up a few turns later.
- How well a pet does this depends on the species. Dogs are good at it;
  horses and cats wander off and get lost more easily.
- Humanoid or intelligent pets can be handed items directly and told to
  wear or wield them.
- To decide separately:
  - a beast-handling skill for the hero, and a training level for the pet
  - pet armor, for example barding for steeds (some variants have it,
    EvilHack among them)

### No "mysterious force"

Climbing out of Gehennom with the Amulet no longer sends the hero back down
at random. 5.0 already makes it rarer each time it strikes (`do.c`,
`svc.context.mysteryforce`). It only lengthens the ascension run without
adding a decision. The tension on the way up comes from the Wizard's
harassment instead; whether to strengthen that is a separate question.

### Fewer dull Gehennom mazes

5.0 already mixes caverns into the filler levels (`hellfill`). Options:

- fewer filler levels; Gehennom is 20 to 24 levels deep (`dungeon.lua`)
- more varied filler, such as themed caverns, small set pieces, and mazes
  with rooms
- mazes the hero can learn quickly, for example by mapping each one as it
  is crossed

The layout only applies to new games, but it does change how saves read the
dungeon, so check save compatibility.

### Faster early Pw regeneration

At XL1 one point comes back every 24 turns (Wizard 18); at XL30, every 5
(Wizard 4). The gain per regeneration is 1 to (Wis + Int) / 15 + 1
(`regen_pw()` in `allmain.c`). The aim is to raise the floor in the early
game so a low-level caster can actually cast, while keeping the late game
about the same. One option is a bonus for Int/Wis that also applies at low
XL.

### Rethinking polypiling

The variant's namesake. Vanilla's per-stack limits:

- **Shuddering.** A stack of more than 4 shudders twice as often
  (`obj_shudders()`).
- **Fusing.** A merged stack fuses into a single object, more often the
  bigger it is (`poly_obj()`).
- **Gems.** A large stack of mineral gems may become rocks.

#### Model

The wand turns what it hits into something else. A monster becomes another
monster and an object becomes another object.

- **One object on its own** changes at random, as in vanilla.
- **Objects sharing a square** touch, get confused with each other, and
  tend to change together. How alike they are decides the result:
  - **Unrelated objects** can't take shape together and turn into junk.
  - **Similar objects** concentrate their energy and tend to take shape as
    something more valuable.
- **A container that stops being a container** leaves its contents nowhere
  to go. They burst out as countless fragments. Even a tiny loss of mass
  releases huge energy, enough to blow out the walls around.

This replaces vanilla's stack penalties (shuddering, fusing, gems turning to
rocks) with one principle. The busywork of splitting stacks becomes a real
choice: what to pile together. Spare bags gain a use, and a wand of
polymorph becomes a detonator for a bag packed beforehand, a strategy for
the final battle.

#### Rough mapping to rules

- **Similarity.** Rank pairs of objects, most alike first:
  1. same kind
  2. same class and same material
  3. same class
  4. same material
  5. unrelated

  The more alike the pile as a whole, the more it is drawn towards dearer
  results.
- **Taking shape.** A similar pile becomes fewer objects of higher value,
  weighting the choice by list price, for example. Decide whether the total
  value of the pile is kept or raised. Golems fit the model: a large mass of
  one material takes shape as a body.
- **Junk.** An unrelated pile becomes rocks, worthless glass or scrap.
  Decide whether to add a new object for scrap; it would need a tile and
  art.
- **The container explosion.**
  - Vanilla quietly destroys a polymorphed container's contents
    (`poly_obj()` in `zap.c`). This replaces that silent loss with a
    consequence the player can see.
  - A container that becomes another container keeps its contents.
  - Contents don't count as touching the objects outside, so they don't mix
    into the pile.
  - **Force.** It scales with the real mass of the contents. A bag of holding
    hides how heavy its contents are, so it makes a much bigger blast than
    it seems to.
  - **Fragments.** The contents are ground to dust and scattered as worthless
    rocks and shards of glass.
    - One fragment flies out for every 10 weight of contents, spreading in
      concentric rings. A rock weighs 10, so the mass roughly carries over.
    - Each fragment damages the creatures and breaks the walls along its
      path, then drops to the floor where it runs out of energy.
    - Undiggable walls and special levels hold.
    - Wall damage in a shop is billed as usual, and the shopkeeper reacts to
      it.
    - To set against the rest of the game: the damage per fragment, the
      range, and how much energy a wall costs a fragment. Test cases: a full
      bag of holding, many hits on one target, and the hero caught in the
      blast.
    - Vanilla's `scatter()` (used for exploding boxes and land mines) already
      hits creatures and breaks objects, so it could be the base. It does
      not break walls.
    - If a crafting system comes later, the dust could break down by material
      instead: iron, aluminium, gold and silver, gems and so on.
  - **Surviving the blast.** The rules themselves have to give the hero a
    way to stay safe, or the explosion only kills the player:
    - **Fuse.** The container "trembles" for one to three turns before it
      bursts. That leaves time to drop a bag that was polymorphed in the
      hero's own pack and get away. It also allows a grenade: zap the bag
      in hand, then throw it.
    - **Range.** Fragments fly a shorter distance than a wand's ray (7 to 13
      squares), so zapping from a distance is safe in itself. Damage falls
      as the fragments lose energy, so the danger is near the centre.
    - **Cover.** Fragments fly in straight lines and stop at what they hit.
      The hero is safe behind a wall, a boulder or a corner, at the bottom
      of a pit, or underwater. A monster in the way takes the hit. Breaking
      a wall costs a fragment much of its energy, so a blast in a closed
      room is mostly contained.
  - To decide: protection against polymorphing one's own bag by accident,
    for example a confirmation, as under "Confirm the irreversible".
- **Vanishing.** Decide whether objects still sometimes vanish. Options:
  drop vanishing altogether, or turn it into a weak form of the same energy
  release.

#### To decide

- **Other sources of polymorph.** The same model could apply to the
  polymorph spell, polymorph traps and dipping in a potion of polymorph.
  Zapping oneself, which polymorphs the inventory, is also open.
- **Unknown items.** Decide how much the hero can predict without knowing
  what the objects are.
- **Monsters.** Monsters on the same square as objects stay separate from
  them, as in vanilla.

#### Rejected

- **Objects that repel each other.** An explosion from mixing objects that
  repel, such as blessed with cursed or artifacts of opposite alignments.
  Too complex. The container is the only source of explosions.
- **Other ways to survive the blast:** fragments rolling to hit against AC,
  a blast's size teaching the player, and warning messages.

Write the spec before implementing; this is large enough to deserve its own
round of design.

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
- Stepping onto visible objects says nothing; the floor panel shows them
  instead.
- The inventory screen supports dropping several items at once, readying
  the alternate weapon, and sorting with letters given out again.
- Portrait conversations, including the shopkeeper's speech.
