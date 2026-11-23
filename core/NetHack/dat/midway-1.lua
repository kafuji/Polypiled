-- NetHack may be freely redistributed.  See license for details.
--
-- Polypiled: mid-dungeon variant 1 of 3 -- the battlefield.
--
-- An elven host and an orcish horde are fighting over open ground.  The
-- "warzone" level flag makes elves and orcs attack each other on sight.
-- The side of the hero's own kind (orcs for an orcish hero, elves for
-- anyone else) treats the hero as an ally; the other side does not.

des.level_init({ style = "solidfill", fg = " " });
des.level_flags("mazelevel", "noflip", "warzone");

des.map([[
---------------------------------------------------------------------------
|.........................................................................|
|.................T..............|..................T.....................|
|.FFFFF.FFFFFF...................|...........................FFFFFF.FFFFF.|
|.F..........F........----.......|...........................F..........F.|
|.F..........F......................T........-----...........F..........F.|
|.F..........F...............................................F..........F.|
|.F..........F...............................................F..........F.|
|.F...........................|.........................................F.|
|.F.....................T.....|.............|...........................F.|
|.F..............T..........................|..........T................F.|
|.F..........F...............................................F..........F.|
|.F..........F........................T......................F..........F.|
|.F..........F............-----..............................F..........F.|
|.F..........F...................................----........F..........F.|
|.FFFFF.FFFFFF...........................|...................FFFFFF.FFFFF.|
|..................T........T............|...............T................|
|........................................|................................|
---------------------------------------------------------------------------
]]);

des.region(selection.area(00,00,74,18), "lit")
des.wallify()

des.stair("up", 03, 09)
des.stair("down", 71, 09)

local hero_is_orc = (nh.int_to_pmname(u.umonster) == "orc")
local elves_friendly = not hero_is_orc
local orcs_friendly = hero_is_orc

-- the elven host holds the west camp and has pushed to the middle
local elves = { "Woodland-elf", "Woodland-elf", "Woodland-elf", "Woodland-elf",
                "Green-elf", "Green-elf", "Green-elf", "Grey-elf", "Grey-elf",
                "elf-lord", "elf-lord" }
local orcs = { "hill orc", "hill orc", "hill orc", "hill orc", "Mordor orc",
               "Mordor orc", "Mordor orc", "Uruk-hai", "Uruk-hai", "Uruk-hai",
               "Uruk-hai", "orc shaman", "orc-captain", "orc-captain" }

local westcamp = selection.area(03,04,12,14):filter_mapchar('.')
local eastcamp = selection.area(62,04,71,14):filter_mapchar('.')
local front = selection.area(30,03,44,15):filter_mapchar('.')

for i = 1, #elves do
   local where = (i <= 5) and front or westcamp
   des.monster({ id = elves[i], coord = where:rndcoord(1),
                 peaceful = elves_friendly })
end
des.monster({ id = "Elvenking", coord = westcamp:rndcoord(1),
              peaceful = elves_friendly })
for i = 1, #orcs do
   local where = (i <= 7) and front or eastcamp
   des.monster({ id = orcs[i], coord = where:rndcoord(1),
                 peaceful = orcs_friendly })
end
des.monster({ id = "ogre lord", coord = eastcamp:rndcoord(1),
              peaceful = orcs_friendly })

-- the fallen of earlier clashes
for i = 1, 6 do
   des.object({ id = "corpse", montype = "Woodland-elf", coord = front:rndcoord(0) })
   des.object({ id = "corpse", montype = "hill orc", coord = front:rndcoord(0) })
end
for i = 1, 4 do
   des.object({ class = ")", coord = front:rndcoord(0) })
end

-- each side's war chest
des.object({ id = "chest", x = 03, y = 05, contents = function()
   des.object({ id = "elven mithril-coat" })
   des.object({ id = "elven cloak" })
   des.object({ id = "extra healing", class = "!", quantity = 2 })
   des.object({ class = "/" })
   des.object({ id = "gold piece", quantity = d(10, 40) })
end })
des.object({ id = "chest", x = 71, y = 05, contents = function()
   des.object({ id = "orcish chain mail" })
   des.object({ class = "=" })
   des.object({ class = "!" })
   des.object({ class = "!" })
   des.object({ id = "gold piece", quantity = d(10, 60) })
end })
