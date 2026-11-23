-- NetHack may be freely redistributed.  See license for details.
--
-- Polypiled: mid-dungeon variant 2 of 3 -- the giants' dining hall.
--
-- A hall built to giant scale, the stairs at either end.  The giants are
-- asleep around a lava hearth after a feast; sneak through, or wake them
-- for their gems -- and their corpses, which make the eater stronger.

des.level_init({ style = "solidfill", fg = " " });
des.level_flags("mazelevel", "noflip");

des.map([[
                                                                           
            ---------------------------------------------------            
            |.......................................|.........|            
            |.......................................|.........|            
            |.....-.......-...................-.....|.........|            
            |.......................................-----+----|            
 -----------|.................................................|----------- 
 |.........||.................................................||.........| 
 |.........||......................LLLLL......................||.........| 
 |..........+......................LLLLL......................+..........| 
 |.........||......................LLLLL......................||.........| 
 |.........||.................................................||.........| 
 -----------|.................................................|----------- 
            |.................................................|            
            |.....-.......-...................-.........-.....|            
            |.................................................|            
            |.................................................|            
            ---------------------------------------------------            
                                                                           
]]);

des.region(selection.area(12,01,62,17), "lit")
des.region(selection.area(01,06,11,12), "lit")
des.region(selection.area(63,06,73,12), "lit")

des.stair("up", 03, 09)
des.stair("down", 71, 09)

des.door("closed", 12, 09)
des.door("closed", 62, 09)
des.door("locked", 57, 05)

-- the sleepers, around the hearth and along the tables
local around = selection.area(28,06,46,12):filter_mapchar('.')
des.monster({ id = "fire giant", coord = around:rndcoord(1), asleep = 1 })
des.monster({ id = "frost giant", coord = around:rndcoord(1), asleep = 1 })
des.monster({ id = "ettin", coord = around:rndcoord(1), asleep = 1 })
local hall = selection.area(14,02,50,16):filter_mapchar('.') - selection.area(28,06,46,12)
for i = 1, 3 do
   des.monster({ id = "hill giant", coord = hall:rndcoord(1), asleep = 1 })
end
des.monster({ id = "stone giant", coord = hall:rndcoord(1), asleep = 1 })
des.monster({ id = "stone giant", coord = hall:rndcoord(1), asleep = 1 })

-- leftovers of the feast
for i = 1, 8 do
   des.object({ id = "huge chunk of meat", coord = around:rndcoord(0) })
end
for i = 1, 6 do
   des.object({ id = "meatball", coord = hall:rndcoord(0) })
   des.object({ id = "apple", coord = hall:rndcoord(0) })
end
des.object({ id = "potion of booze", coord = around:rndcoord(0) })
des.object({ id = "potion of booze", coord = around:rndcoord(0) })

-- the larder and strongroom
des.object({ id = "chest", x = 60, y = 02, contents = function()
   for i = 1, 6 do des.object("*") end
   des.object({ id = "gold piece", quantity = d(20, 30) })
end })
des.object({ id = "large box", x = 54, y = 03, contents = function()
   des.object({ id = "huge chunk of meat" })
   des.object({ id = "potion of gain level" })
end })
des.object({ id = "boulder", x = 56, y = 04 })
