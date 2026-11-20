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
  60). Blessed, cursed and soon-to-rise corpses still count 2 stages younger,
  2 older and 5 older. (`ROT_PACE_MIN`, `ROT_PACE_SPREAD` in `hack.h`;
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
