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

## Not for now

- Warnings before instadeaths (after FIQHack, UnNetHack)
- Autoexplore
- Hints about whether it is safe to pray (after NetHack4, DynaHack)
- New roles, races or large dungeon additions. They are costly to keep in
  step with 5.0 and would bloat the tiles and portraits.
- A full monster AI rework (after EvilHack, GruntHack)

## Done

One line each, grouped by theme. Entries marked † are not yet written up in
`rule-changes.md`.

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
  family one level lower. †
- Lowered characteristics such as Str lost to poison come back on their own,
  faster with high Con. †
- Pending: poison can keep lowering Str with no floor.

### Equipment and combat

- Worn armor counts for half its weight; a shield counts in full.
- Missiles that hit break about half as often.
- An artifact may be the secondary weapon, but two self-willed artifacts of
  different alignments won't be wielded together. †

### Shops †

- No mimics among the stock.
- The shopkeeper protects customers from hostile monsters.
- Shops restock while the hero is away.
- Paid identification: the shopkeeper identifies the kinds of goods the shop
  deals in, for a fee.
- The shopkeeper takes back goods a pet carries to the door.
- Pick-axes and steeds are allowed in; only invisibility is refused.

### Dungeon and terrain †

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

### Interface-side core changes †

- A plain left click always moves or attacks, and travels when the target is
  farther away.
- Stepping onto visible objects says nothing; the floor panel shows them
  instead.
- The inventory screen supports dropping several items at once, readying
  the alternate weapon, and sorting with letters given out again.
- Portrait conversations, including the shopkeeper's speech.
