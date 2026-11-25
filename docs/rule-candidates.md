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
- **A container that becomes something other than a container** leaves its
  contents nowhere to go, and they explode (see "The container explosion"
  below).

This one principle replaces vanilla's stack penalties: shuddering, fusing,
and gems turning to rocks. The busywork of splitting stacks becomes a real
choice about what to pile together.

Dropped: explosions from mixing objects that repel each other. They made the
rules too complicated.

#### Mixing piles

- **Luck decides, and size raises the stakes.** A big pile of weapons is
  more likely to give a good weapon. With a wand of polymorph found once in
  a game, polypiling a pile should be worth trying once. Sometimes the
  pile's total value rises explosively.
- **Similarity.** The more alike the pile as a whole, the more it is drawn
  towards dearer results. Pairs rank, most alike first:
  1. same kind
  2. same class and same material
  3. same class
  4. same material
  5. unrelated
- **Junk is rocks and worthless glass shards only.** No new object is
  added. These two can't change any further, so they mark a pile that has
  been polypiled to the end. Their only other use is as bomb filling.
- **Mass is roughly kept.** When a pile fuses, it can end in rocks and
  glass shards, the dead end of polymorph. That dead end takes over the job
  of vanilla's vanishing and fusing.
- **Golems.** The pile's mix of materials and its mass set which golems it
  can turn into, and how likely each is. The bigger the pile, the stronger
  (higher-level) the golem.

#### The container explosion

Vanilla quietly destroys a polymorphed container's contents (`poly_obj()`
in `zap.c`). Here they burst out instead.

- A container that becomes another container keeps its contents.
- Contents never mix with the objects outside.
- The contents' real mass sets the force. A bag of holding hides its
  contents' weight, so it makes a far bigger blast than it seems to.

The example below uses contents weighing 100.

**The blast: half the mass (50).** Blast damage is physical, so traits that
reduce physical damage reduce it.

- **Spread.** The blast spreads square by square in concentric rings. Each
  square passes on half the force it received, until nothing is left: 50 on
  the adjacent squares, then 25, 12, 6, 3 and 1. Reach grows only with the
  logarithm of the mass. A blast of 500 ends after about nine rings, so a
  packed bag of holding needs no cap.
- **Fragile objects.** A blast of 10 or more breaks exposed fragile objects
  (on the floor or carried, not inside a container), such as potions, glass
  and eggs. The threshold is still to tune.
- **Walls, doors and boulders.** Only the blast breaks these; fragments
  don't. Each breaks at or above its threshold:
  - door: 10
  - boulder: 20 (it breaks into rocks)
  - wall: 30

  Undiggable walls never break. With contents of 100, walls break only on
  the adjacent ring (50), while doors and boulders also break one ring out
  (25).
- **What it meets on the way.**
  - **An obstacle that holds** stops the blast behind it, which is the
    cover rule for the blast.
  - **An obstacle that breaks** uses up its threshold, and only the rest
    goes on, halving as usual. A wall hit by 50 breaks with 30, so the
    square behind gets 10 instead of 25.
  - **A monster in the way** takes the force of its square, and what it
    passes on is halved once more. A monster hit by 50 passes on only 12
    instead of 25, so a crowd shields what is behind it.

**The fragments: the other half (50).** The contents are ground to dust and
fly out in concentric rings.

| Fragment | Share of fragment mass | From 50 | Damage |
|---|---|---|---|
| Rock | 80% | 4 (one per 10 weight) | about 50 each |
| Glass shard | 20% | 10 (one per 1 weight) | about 10 each |

- **Range.** Each fragment flies in a straight line. Its damage drops by 1
  for every square it flies, and it falls to the floor when the damage
  reaches 0. That is its real range:
  - A rock reaches about 50 squares. With bad luck it can strike the hero
    on the far side of the map.
  - A glass shard reaches about 10 squares, so it works as buckshot close
    to the blast.

  The fragments also fan out as they go, so the farther away a target is,
  the less likely it is to be hit.
- **Hitting.** A fragment rolls to hit against AC like a thrown rock, so
  high AC sometimes keeps it off. A shield may block some.
- **Passing through.** On its first hit a fragment passes through. The next
  thing it hits takes half damage, and the fragment stops there. The damage
  at that point is the remaining damage after the drop with distance.
- **Walls and boulders.** Fragments don't break them. A fragment stops
  there and drops.
- **Landing.** A fragment that runs out of energy drops to the floor as a
  worthless rock or glass shard.
- **Weight.** Weight is roughly conserved: a rock weighs 10 and a worthless
  glass weighs 1.

**Fuse.** The container trembles before it bursts. The wand's blessed or
cursed state sets the delay:

| Wand | Delay |
|---|---|
| Cursed | 0 to 1 turns |
| Uncursed | 1 to 2 turns |
| Blessed | 2 to 3 turns |

The only warning is the trembling, with no confirmation. Cause and effect
are simple enough that one bad experience teaches it. That settles the
"Confirm the irreversible" question for bags as well.

**Responsibility.** Whoever set off the explosion bears the blame and karma
for everything it hits, whether hostile or not. That covers kills,
alignment, luck, and angering peacefuls, shopkeepers and priests included.
Shop walls the blast breaks are billed as for a pick-axe or a wand of
digging.

**Surviving it.** An adjacent hero takes the full blast and most of the
fragments, which is meant to be lethal even at XL30. Four things keep it
usable:

- the fuse
- distance: the blast halves every ring and the fragments fan out
- AC and shields against the fragments
- cover: walls, boulders, corners and monsters stop the blast

A small sack with little in it makes a small blast, so the player learns
the strength gradually.

**Uses.** A spare container finally has a use. In the endgame, a wand of
polymorph becomes the detonator for a bag packed like a charge of TNT. Each
bomb costs a container and a wand charge, which keeps it in check.

#### Other polymorph sources

- **Zapping oneself** works as in vanilla: the hero's body changes and the
  inventory is untouched.

#### Still open

- **Fragment numbers:** how fast the hit chance falls with distance
- **Pile formulas:**
  - the value-weighted choice for similar piles
  - the golem table by material and mass
- **Vanishing:** whether objects still sometimes vanish, or the rocks and
  glass dead end replaces vanishing entirely
- **Other sources:** whether the spell of polymorph, polymorph traps and
  dipping into a potion of polymorph follow the same model
- **Unknown items:** how much the hero can foresee about a pile of
  unidentified items
- **Crafting:** if a crafting system comes later, the dust could break down
  by material instead (iron, aluminium, gold and silver, gems and so on)

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
