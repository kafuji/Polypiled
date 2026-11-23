-- NetHack may be freely redistributed.  See license for details.
--
-- Polypiled: the thieves' den.
--
-- A trapped maze hides a guard hall and, behind it, a black market:
-- stolen goods of good quality at three times the going rate, plenty of
-- artifacts, and a second-hand wand of wishing with a single wish left.
-- The fence is armed to the teeth and the town watch they bribed is on
-- duty; robbing the place, or crossing either of them, turns them all.

des.level_init({ style="mazegrid", bg ="-" });

des.level_flags("mazelevel", "noflip");

local den = des.map({ halign = "center", valign = "center", map = [[
...................
.-----------------.
.|...............|.
.|...............|.
.+...............S.
.|------+--------|.
.|...............|.
.|...............|.
.|...............|.
.-----------------.
...................
]], contents = function(rm)
   des.levregion({ region={01,00,79,20}, region_islev=1, exclude={0,0,18,10}, type="stair-up" })
   des.levregion({ region={01,00,79,20}, region_islev=1, exclude={0,0,18,10}, type="stair-down" })
   des.teleport_region({ region={01,00,79,20}, region_islev=1, exclude={0,0,18,10} })

   des.mazewalk(00,05,"west")
   des.mazewalk(18,05,"east")

   -- the guard hall and the market behind it
   des.region(selection.area(02,02,16,04), "lit")
   des.region({ region={02,06,16,08}, lit=1, type="black market", filled=1 })

   des.door("closed",01,04)
   des.door("closed",08,05)

   des.engraving({ coord={09,03}, type="burn", text="No questions asked." })

   -- the bribed watch: captains carry attack wands, the rank and file
   -- something to slow a fleeing thief
   local captain_wands = { "wand of fire", "wand of cold", "wand of lightning",
                           "wand of striking" }
   local watch_wands = { "wand of striking", "wand of magic missile",
                         "wand of sleep", "wand of slow monster" }
   local posts = { {03,02}, {15,02}, {03,04}, {15,04}, {06,03}, {12,03} }
   for i = 1, #posts do
      local w = captain_wands[math.random(1, #captain_wands)]
      des.monster({ id = "watch captain", coord = posts[i], peaceful = 1,
                    m_lev_adj = 6, keep_default_invent = true,
                    inventory = function()
                       des.object(w)
                       des.object("potion of extra healing")
                    end })
   end
   local rank = { {05,02}, {11,02}, {05,04}, {11,04}, {07,04}, {09,04} }
   for i = 1, #rank do
      local w = watch_wands[math.random(1, #watch_wands)]
      des.monster({ id = "watchman", coord = rank[i], peaceful = 1,
                    m_lev_adj = 6, keep_default_invent = true,
                    inventory = function()
                       des.object(w)
                    end })
   end
   -- two more watch the outside of the doors
   des.monster({ id = "watch captain", x=00, y=04, peaceful = 1, m_lev_adj = 6 })
   des.monster({ id = "watch captain", x=18, y=04, peaceful = 1, m_lev_adj = 6 })
end
});

-- the maze is a thieves' maze: trapped throughout
local mazefloor = selection.match(".") - den
local traps = { "arrow", "dart", "falling rock", "bear", "land mine",
                "sleep gas", "rust", "fire", "pit", "spiked pit",
                "teleport", "anti magic", "squeaky board" }
for i = 1, 18 do
   des.trap(traps[math.random(1, #traps)], mazefloor:rndcoord(1))
end

-- the den's regular clientele
for i = 1, 4 do
   des.monster("leprechaun")
end
for i = 1, 3 do
   des.monster("n")
end
des.monster("rogue")
des.monster("rogue")
