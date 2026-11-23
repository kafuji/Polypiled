-- NetHack may be freely redistributed.  See license for details.
--
-- Polypiled: mid-dungeon variant 3 of 3 -- the adventurers' mausoleum.
--
-- Rows of graves of those who came before, each buried with something
-- worth having.  Grave robbing is frowned upon and may wake the dead;
-- the tomb at the centre is haunted.

des.level_init({ style = "solidfill", fg = " " });
des.level_flags("mazelevel", "noflip", "graveyard");

des.map([[
---------------------------------------------------------------------------
|.........................................................................|
|.........................................................................|
|..T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T..|
|.........................................................................|
|.........................................................................|
|..............................|-----------|..............................|
|..............................|...........|..............................|
|..............................|...--+--...|..............................|
|..............................|...|...|...|..............................|
|..............................|...-----...|..............................|
|..............................|...........|..............................|
|..............................|-----+-----|..............................|
|.........................................................................|
|.........................................................................|
|..T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T...T..|
|.........................................................................|
|.........................................................................|
---------------------------------------------------------------------------
]]);

des.region(selection.area(00,00,74,18), "unlit")
des.wallify()

des.stair("up", 02, 09)
des.stair("down", 72, 09)

des.door("locked", 37, 12)
des.door("locked", 37, 08)

local epitaphs = {
   "Bilwick.  Picked up the cockatrice corpse barehanded.",
   "Here lies Orla.  She prayed too soon.",
   "Grumbold the Brave.  Kicked the sink once too often.",
   "Tessaly.  Read an unknown scroll while confused.",
   "Fennick.  One more quaff from the fountain.",
   "Marrow the Bold.  The Elbereth was written in the dust.",
   "Ysolde.  'It is only a newt.'",
   "Dunstan.  Tried to make friends with the soldier ants.",
   "Cobb the Unlucky.  Broke a mirror, then another.",
   "Pell.  Wished for more wishes.",
   "Here lies Hesk, who angered the shopkeeper.",
   "Wenna.  Thought the lava was a pool of water.",
   "Brannoc.  Never learned to identify his potions.",
   "Tamsin.  Engraved Elbereth, then attacked from it.",
   "Old Gorrim.  Walked into the shop with a pick-axe.",
   "Ilse.  Wrested the last charge from a wand of create monster.",
}
shuffle(epitaphs)

-- every grave holds something its owner valued
local relics = { "/", "=", '"', "[", "[", ")", "?", "!" }
local graves = {}
for x = 04, 70, 6 do
   if x < 28 or x > 46 then
      table.insert(graves, { x, 05 })
      table.insert(graves, { x, 13 })
   else
      table.insert(graves, { x, 02 })
      table.insert(graves, { x, 16 })
   end
end
for i = 1, #graves do
   local g = graves[i]
   des.grave(g[1], g[2], epitaphs[((i - 1) % #epitaphs) + 1])
   des.object({ class = relics[math.random(1, #relics)], x = g[1], y = g[2],
                buried = true })
   if percent(30) then
      des.object({ class = relics[math.random(1, #relics)], x = g[1], y = g[2],
                   buried = true })
   end
end

-- the haunted tomb
des.object({ id = "chest", x = 37, y = 09, contents = function()
   des.object({ class = "/" })
   des.object({ class = "=" })
   des.object({ class = '"' })
   des.object({ id = "gold piece", quantity = d(20, 20) })
end })
des.monster({ id = "ghost", x = 36, y = 09, asleep = 1 })
des.monster({ id = "ghost", x = 38, y = 09, asleep = 1 })

-- the restless
des.monster("wraith")
des.monster("wraith")
des.monster("barrow wight")
des.monster("human mummy")
des.monster("elf mummy")
for i = 1, 4 do
   des.monster("Z")
end
