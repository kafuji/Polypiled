# Rule candidates

Changes we intend to make but have not started. Once one is implemented, its
entry moves to `rule-changes.md`. Ideas taken from other variants say so;
those attributions are from memory and may be loose.

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
