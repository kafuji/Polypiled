/* Polypiled: player knowledge frames for the WebAssembly shell.          */
/* NetHack may be freely redistributed.  See license for details.         */

/*
 * After each map display the shell receives one "knowledge frame": what
 * the hero can know about the map, the monsters they sense, visible light
 * sources, their own state and the level.  Everything here is read-only
 * game state, and only what the window port could legitimately show or
 * what its display is based on.  In particular:
 *
 *   - objects are identified by tile (appearance), never by glyph number,
 *     because object glyphs encode otyp and would reveal unidentified items;
 *   - terrain is the last seen type, with secret doors and corridors shown
 *     as what they look like;
 *   - lighting is reported only for locations in sight, plus the hero's
 *     own memory of whether a location was lit.
 *
 * The frame is a flat array of 32-bit integers, copied into a JavaScript
 * Int32Array and queued as the "shim_knowledge_frame" notification, which
 * local_callback() delivers before the display callback itself.  Layout
 * (all offsets in 32-bit words) is documented in
 * docs/player-knowledge-interface.md and decoded by
 * src/runtime/local/world/knowledge-frames.ts.
 */

#include "hack.h"
#include <string.h>

#if defined(SHIM_GRAPHICS) && defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>

#define NH3D_KNOWLEDGE_VERSION 2

#define NH3D_HEADER_WORDS 8
#define NH3D_HERO_WORDS 8
#define NH3D_LEVEL_WORDS 8
#define NH3D_CELL_WORDS 4
#define NH3D_MONSTER_WORDS 4
#define NH3D_LIGHT_WORDS 4
#define NH3D_MAX_LIGHTS 256

#define NH3D_FIXED_WORDS (NH3D_HEADER_WORDS + NH3D_HERO_WORDS + NH3D_LEVEL_WORDS)
#define NH3D_MAX_WORDS                                                      \
    (NH3D_FIXED_WORDS + NH3D_CELL_WORDS * COLNO * ROWNO                     \
     + NH3D_MONSTER_WORDS * COLNO * ROWNO + NH3D_LIGHT_WORDS * NH3D_MAX_LIGHTS)

/* header flags */
#define NH3D_FRAME_COMPLETE 0x1

/* cell vision bits */
#define NH3D_VIS_COULDSEE 0x01
#define NH3D_VIS_CANSEE 0x02
#define NH3D_VIS_TEMPLIT 0x04 /* lit by a light source, in sight */
#define NH3D_VIS_LIT 0x08     /* lit location, in sight */
#define NH3D_VIS_WASLIT 0x10  /* remembered as lit */

/* what a glyph shows */
enum nh3d_glyph_kind {
    NH3D_KIND_UNEXPLORED = 0,
    NH3D_KIND_NOTHING = 1,
    NH3D_KIND_TERRAIN = 2,
    NH3D_KIND_OBJECT = 3,
    NH3D_KIND_MONSTER = 4,
    NH3D_KIND_INVISIBLE = 5,
    NH3D_KIND_WARNING = 6,
    NH3D_KIND_TRAP = 7,
    NH3D_KIND_EFFECT = 8,
    NH3D_KIND_STATUE = 9,
    NH3D_KIND_BODY = 10
};

/* how a monster is sensed */
enum nh3d_sense {
    NH3D_SENSE_SIGHT = 1,
    NH3D_SENSE_SENSED = 2,   /* telepathy, extrinsic warning of a type... */
    NH3D_SENSE_DETECTED = 3, /* shown by detection */
    NH3D_SENSE_WARNING = 4,  /* a warning number */
    NH3D_SENSE_REMEMBERED_INVISIBLE = 5
};

/* monster flags */
#define NH3D_MON_PET 0x01
#define NH3D_MON_PEACEFUL 0x02
#define NH3D_MON_STEED 0x04
#define NH3D_MON_HERO 0x08

/* light kinds, by appearance */
enum nh3d_light_kind {
    NH3D_LIGHT_OTHER = 0,
    NH3D_LIGHT_CANDLE = 1,
    NH3D_LIGHT_LAMP = 2,
    NH3D_LIGHT_LANTERN = 3,
    NH3D_LIGHT_MAGIC_LAMP = 4,
    NH3D_LIGHT_SUNSWORD = 5,
    NH3D_LIGHT_POTION = 6,
    NH3D_LIGHT_MONSTER = 7
};

#define NH3D_LIGHT_CARRIED_BY_HERO 0x1
#define NH3D_LIGHT_IS_HERO 0x2

/* hero flags */
#define NH3D_HERO_BLIND 0x0001
#define NH3D_HERO_HALLUCINATING 0x0002
#define NH3D_HERO_UNDERWATER 0x0004
#define NH3D_HERO_SWALLOWED 0x0008
#define NH3D_HERO_BURIED 0x0010
#define NH3D_HERO_LEVITATING 0x0020
#define NH3D_HERO_FLYING 0x0040
#define NH3D_HERO_RIDING 0x0080
#define NH3D_HERO_UNSEEN_SELF 0x0100
#define NH3D_HERO_POLYMORPHED 0x0200

/* level flags */
#define NH3D_LEVEL_MINES 0x01
#define NH3D_LEVEL_SOKOBAN 0x02
#define NH3D_LEVEL_GEHENNOM 0x04
#define NH3D_LEVEL_QUEST 0x08
#define NH3D_LEVEL_ENDGAME 0x10
#define NH3D_LEVEL_IN_SHOP 0x20
#define NH3D_LEVEL_IN_TEMPLE 0x40

/* special levels the hero is on (version 2); only levels the hero can tell
   apart on arrival, and the Wizard's Tower only from inside it */
enum nh3d_special_level {
    NH3D_SPECIAL_NONE = 0,
    NH3D_SPECIAL_MEDUSA = 1,
    NH3D_SPECIAL_CASTLE = 2,
    NH3D_SPECIAL_VALLEY = 3,
    NH3D_SPECIAL_SANCTUM = 4,
    NH3D_SPECIAL_LUDIOS = 5,
    NH3D_SPECIAL_VLAD_TOWER = 6,
    NH3D_SPECIAL_WIZARD_TOWER = 7,
    NH3D_SPECIAL_QUEST_HOME = 8,
    NH3D_SPECIAL_EARTH = 9,
    NH3D_SPECIAL_AIR = 10,
    NH3D_SPECIAL_FIRE = 11,
    NH3D_SPECIAL_WATER = 12,
    NH3D_SPECIAL_ASTRAL = 13
};

/* hostiles are counted up to this many, and distances capped at this */
#define NH3D_HOSTILE_COUNT_MAX 255
#define NH3D_HOSTILE_DISTANCE_MAX 255

/* light.c keeps this private; it marks a source that lights its area */
#ifndef LSF_SHOW
#define LSF_SHOW 0x1
#endif

#ifdef TILES_IN_GLYPHMAP
extern glyph_map glyphmap[MAX_GLYPH];
#endif

void nh3d_knowledge_publish(void);
int nh3d_public_glyph(int);
int nh3d_public_tile(int);
int nh3d_appearance_tile(int);
void nh3d_public_glyphinfo(const glyph_info *, glyph_info *);

/*
 * Object identity.
 *
 * An object glyph names the object's real type, and its tile is the tile of
 * that type's appearance; types sharing a description ("gray stone",
 * "lamp", glass and gems of one colour) even have tiles of their own.  So
 * while the hero does not know a type, the shell is given the generic glyph
 * of its class and the tile of what it looks like, the same tile for every
 * type that looks alike.  Before a game starts the descriptions are not
 * shuffled yet and nothing is hidden (the glyph catalog is generated then).
 */

static int
nh3d_raw_tile(int glyph)
{
#ifdef TILES_IN_GLYPHMAP
    if (glyph >= 0 && glyph < MAX_GLYPH)
        return glyphmap[glyph].tileidx;
#else
    nhUse(glyph);
#endif
    return -1;
}

/* the type an ordinary object glyph shows, or -1 */
static int
nh3d_glyph_otyp(int glyph, boolean *piletop)
{
    if (glyph >= GLYPH_OBJ_OFF && glyph < GLYPH_OBJ_OFF + NUM_OBJECTS) {
        *piletop = FALSE;
        return glyph - GLYPH_OBJ_OFF;
    }
    if (glyph >= GLYPH_OBJ_PILETOP_OFF
        && glyph < GLYPH_OBJ_PILETOP_OFF + NUM_OBJECTS) {
        *piletop = TRUE;
        return glyph - GLYPH_OBJ_PILETOP_OFF;
    }
    return -1;
}

/* the glyph shows a type the hero does not know */
static boolean
nh3d_glyph_hides_type(int glyph, int *otyp, boolean *piletop)
{
    int typ = nh3d_glyph_otyp(glyph, piletop);

    if (typ < 0 || u.uz.dlevel <= 0)
        return FALSE;
    if (objects[typ].oc_name_known || !OBJ_DESCR(objects[typ]))
        return FALSE;
    *otyp = typ;
    return TRUE;
}

int
nh3d_public_glyph(int glyph)
{
    int otyp;
    boolean piletop;

    if (!nh3d_glyph_hides_type(glyph, &otyp, &piletop))
        return glyph;
    return (int) objects[otyp].oc_class
           + (piletop ? GLYPH_OBJ_PILETOP_OFF : GLYPH_OBJ_OFF);
}

/* the tile of what the glyph looks like, the same for look-alike types */
int
nh3d_appearance_tile(int glyph)
{
    int otyp, owner, shown, oclass, k;
    boolean piletop;
    const char *descr;

    if (!nh3d_glyph_hides_type(glyph, &otyp, &piletop))
        return nh3d_raw_tile(glyph);
    /* the first type whose own description reads the same */
    descr = obj_descr[objects[otyp].oc_descr_idx].oc_descr;
    oclass = objects[otyp].oc_class;
    owner = objects[otyp].oc_descr_idx;
    for (k = svb.bases[oclass]; k < NUM_OBJECTS && objects[k].oc_class == oclass;
         k++)
        if (obj_descr[k].oc_descr && !strcmp(obj_descr[k].oc_descr, descr)) {
            owner = k;
            break;
        }
    /* that description's own tile now belongs to whichever type has it */
    shown = otyp;
    for (k = 0; k < NUM_OBJECTS; k++)
        if (objects[k].oc_descr_idx == owner) {
            shown = k;
            break;
        }
    return nh3d_raw_tile(shown
                         + (piletop ? GLYPH_OBJ_PILETOP_OFF : GLYPH_OBJ_OFF));
}

/* the tile for a glyph the shell asks about: never one that tells a type */
int
nh3d_public_tile(int glyph)
{
    return nh3d_raw_tile(nh3d_public_glyph(glyph));
}

/* what the shell is shown in place of a glyph the game displays */
void
nh3d_public_glyphinfo(const glyph_info *in, glyph_info *out)
{
    *out = *in;
    if (nh3d_public_glyph(in->glyph) != in->glyph) {
        out->gm.tileidx = (short) nh3d_appearance_tile(in->glyph);
        out->glyph = nh3d_public_glyph(in->glyph);
    }
}

static int nh3d_frame[NH3D_MAX_WORDS];
static int nh3d_prev_cells[ROWNO][COLNO][NH3D_CELL_WORDS];
static int nh3d_prev_fixed[NH3D_HERO_WORDS + NH3D_LEVEL_WORDS];
static int nh3d_prev_tail[NH3D_MONSTER_WORDS * COLNO * ROWNO
                          + NH3D_LIGHT_WORDS * NH3D_MAX_LIGHTS];
static int nh3d_prev_monsters = -1, nh3d_prev_lights = -1;
static boolean nh3d_have_prev = FALSE;
static d_level nh3d_prev_level;
static int nh3d_frame_seq = 0;

/* attacks by and on the hero, wrapping; the shell watches for increases */
static int nh3d_hero_attacks = 0, nh3d_foe_attacks = 0;

void
nh3d_note_engagement(boolean by_hero)
{
    if (by_hero)
        nh3d_hero_attacks = (nh3d_hero_attacks + 1) & 0xffff;
    else
        nh3d_foe_attacks = (nh3d_foe_attacks + 1) & 0xffff;
}

static int
nh3d_tile(int glyph)
{
    int tile;

    if (glyph < 0 || glyph >= MAX_GLYPH)
        return 0xffff;
    tile = nh3d_appearance_tile(glyph);
    return (tile < 0) ? 0xffff : (tile & 0xffff);
}

static int
nh3d_glyph_kind(int glyph)
{
    if (glyph_is_unexplored(glyph))
        return NH3D_KIND_UNEXPLORED;
    if (glyph_is_nothing(glyph))
        return NH3D_KIND_NOTHING;
    if (glyph_is_invisible(glyph))
        return NH3D_KIND_INVISIBLE;
    if (glyph_is_warning(glyph))
        return NH3D_KIND_WARNING;
    if (glyph_is_monster(glyph))
        return NH3D_KIND_MONSTER;
    if (glyph_is_statue(glyph))
        return NH3D_KIND_STATUE;
    if (glyph_is_body(glyph))
        return NH3D_KIND_BODY;
    if (glyph_is_object(glyph))
        return NH3D_KIND_OBJECT;
    if (glyph_is_trap(glyph))
        return NH3D_KIND_TRAP;
    if (glyph_is_cmap_zap(glyph) || glyph_is_explosion(glyph)
        || glyph_is_swallow(glyph))
        return NH3D_KIND_EFFECT;
    if (glyph_is_cmap(glyph))
        return NH3D_KIND_TERRAIN;
    return NH3D_KIND_EFFECT;
}

/* last seen terrain type, with secret features shown as they look */
static int
nh3d_seen_terrain(coordxy x, coordxy y)
{
    int typ = svl.lastseentyp[x][y];

    if (typ == SDOOR)
        typ = levl[x][y].arboreal_sdoor ? TREE
              : levl[x][y].horizontal  ? HWALL
                                       : VWALL;
    else if (typ == SCORR)
        typ = STONE;
    if (typ < 0 || typ >= MAX_TYPE)
        typ = STONE;
    return typ;
}

static void
nh3d_fill_cell(coordxy x, coordxy y, int *out)
{
    struct rm *lev = &levl[x][y];
    const glyph_info *shown = &gg.gbuf[y][x].glyphinfo;
    int vision = 0, trap = 0;
    struct trap *ttmp;

    if (couldsee(x, y))
        vision |= NH3D_VIS_COULDSEE;
    if (cansee(x, y)) {
        vision |= NH3D_VIS_CANSEE;
        if (templit(x, y))
            vision |= NH3D_VIS_TEMPLIT;
        if (lev->lit)
            vision |= NH3D_VIS_LIT;
    }
    if (lev->waslit)
        vision |= NH3D_VIS_WASLIT;

    if ((ttmp = t_at(x, y)) != 0 && ttmp->tseen)
        trap = ttmp->ttyp & 0xff;

    out[0] = (x & 0xff) | ((y & 0xff) << 8) | ((vision & 0xff) << 16)
             | ((lev->seenv & 0xff) << 24);
    out[1] = (nh3d_seen_terrain(x, y) & 0xff) | (trap << 8)
             | ((nh3d_glyph_kind(shown->glyph) & 0xff) << 16)
             | ((nh3d_glyph_kind(lev->glyph) & 0xff) << 24);
    out[2] = (nh3d_tile(shown->glyph) & 0xffff)
             | ((nh3d_tile(lev->glyph) & 0xffff) << 16);
    out[3] = (shown->gm.glyphflags & 0xffff)
             | ((shown->gm.sym.color & 0xff) << 16);
}

/* the monster record for the glyph shown at x,y, if it shows one */
static boolean
nh3d_fill_monster(coordxy x, coordxy y, int *out)
{
    const glyph_info *shown = &gg.gbuf[y][x].glyphinfo;
    int glyph = shown->glyph, sense, bits = 0, id = -1, extra = 0;
    struct monst *mtmp;

    if (glyph_is_warning(glyph)) {
        sense = NH3D_SENSE_WARNING;
        extra = glyph_to_warning(glyph);
    } else if (glyph_is_invisible(glyph)) {
        sense = NH3D_SENSE_REMEMBERED_INVISIBLE;
    } else if (glyph_is_monster(glyph)) {
        if (u_at(x, y)) {
            bits |= NH3D_MON_HERO;
            id = 0;
            mtmp = (u.usteed && glyph_is_ridden_monster(glyph)) ? u.usteed
                                                                : 0;
            if (mtmp) {
                bits |= NH3D_MON_STEED;
                id = (int) mtmp->m_id;
            }
            sense = NH3D_SENSE_SIGHT;
        } else {
            mtmp = m_at(x, y);
            if (glyph_is_detected_monster(glyph))
                sense = NH3D_SENSE_DETECTED;
            else if (mtmp && canseemon(mtmp))
                sense = NH3D_SENSE_SIGHT;
            else
                sense = NH3D_SENSE_SENSED;
            if (mtmp) {
                id = (int) mtmp->m_id;
                if (canspotmon(mtmp) && mtmp->mpeaceful && !mtmp->mtame)
                    bits |= NH3D_MON_PEACEFUL;
            }
        }
        if (glyph_is_pet(glyph))
            bits |= NH3D_MON_PET;
    } else {
        return FALSE;
    }

    out[0] = (x & 0xff) | ((y & 0xff) << 8) | ((sense & 0xff) << 16)
             | ((bits & 0xff) << 24);
    out[1] = id;
    out[2] = (nh3d_tile(glyph) & 0xffff) | ((extra & 0xffff) << 16);
    /* monster glyphs show only what the hero sees, so they are safe */
    out[3] = glyph_is_monster(glyph) ? glyph : -1;
    return TRUE;
}

static int
nh3d_object_light_kind(struct obj *obj)
{
    if (is_art(obj, ART_SUNSWORD))
        return NH3D_LIGHT_SUNSWORD;
    switch (obj->otyp) {
    case WAX_CANDLE:
    case TALLOW_CANDLE:
    case CANDELABRUM_OF_INVOCATION:
        return NH3D_LIGHT_CANDLE;
    case BRASS_LANTERN:
        return NH3D_LIGHT_LANTERN;
    case MAGIC_LAMP:
        /* looks like any other lamp until the hero knows better */
        return objects[MAGIC_LAMP].oc_name_known ? NH3D_LIGHT_MAGIC_LAMP
                                                 : NH3D_LIGHT_LAMP;
    case OIL_LAMP:
        return NH3D_LIGHT_LAMP;
    case POT_OIL:
        return NH3D_LIGHT_POTION;
    default:
        return NH3D_LIGHT_OTHER;
    }
}

/* the record for a light source the hero can see or carries */
static boolean
nh3d_fill_light(light_source *ls, int *out)
{
    int kind, bits = 0, tile = 0xffff, glyph = -1;

    if (!(ls->flags & LSF_SHOW) || !isok(ls->x, ls->y))
        return FALSE;
    if (ls->type == LS_OBJECT) {
        struct obj *obj = ls->id.a_obj;

        if (!obj)
            return FALSE; /* camera flash */
        if (obj->where == OBJ_INVENT) {
            bits |= NH3D_LIGHT_CARRIED_BY_HERO;
        } else if (!cansee(ls->x, ls->y)) {
            return FALSE;
        } else if (obj->where == OBJ_MINVENT) {
            if (!obj->ocarry || !canspotmon(obj->ocarry))
                return FALSE;
        } else if (obj->where != OBJ_FLOOR) {
            return FALSE;
        }
        kind = nh3d_object_light_kind(obj);
        tile = nh3d_tile(obj_to_glyph(obj, rn2_on_display_rng));
    } else if (ls->type == LS_MONSTER) {
        struct monst *mon = ls->id.a_monst;

        if (!mon)
            return FALSE;
        if (mon == &gy.youmonst) {
            bits |= NH3D_LIGHT_IS_HERO | NH3D_LIGHT_CARRIED_BY_HERO;
        } else if (!cansee(ls->x, ls->y) || !canspotmon(mon)) {
            return FALSE;
        }
        kind = NH3D_LIGHT_MONSTER;
        glyph = gg.gbuf[ls->y][ls->x].glyphinfo.glyph;
        if (!glyph_is_monster(glyph))
            glyph = -1;
        tile = nh3d_tile(gg.gbuf[ls->y][ls->x].glyphinfo.glyph);
    } else {
        return FALSE;
    }

    out[0] = (ls->x & 0xff) | ((ls->y & 0xff) << 8)
             | ((ls->range & 0xff) << 16) | ((ls->type & 0xff) << 24);
    out[1] = (kind & 0xff) | ((bits & 0xff) << 8);
    out[2] = tile;
    out[3] = glyph;
    return TRUE;
}

static void
nh3d_fill_hero(int *out)
{
    int bits = 0, glyph = gg.gbuf[u.uy][u.ux].glyphinfo.glyph;

    if (Blind)
        bits |= NH3D_HERO_BLIND;
    if (Hallucination)
        bits |= NH3D_HERO_HALLUCINATING;
    if (Underwater)
        bits |= NH3D_HERO_UNDERWATER;
    if (u.uswallow)
        bits |= NH3D_HERO_SWALLOWED;
    if (u.uburied)
        bits |= NH3D_HERO_BURIED;
    if (Levitation)
        bits |= NH3D_HERO_LEVITATING;
    if (Flying)
        bits |= NH3D_HERO_FLYING;
    if (u.usteed)
        bits |= NH3D_HERO_RIDING;
    if (!canspotself())
        bits |= NH3D_HERO_UNSEEN_SELF;
    if (Upolyd)
        bits |= NH3D_HERO_POLYMORPHED;

    out[0] = u.ux;
    out[1] = u.uy;
    out[2] = (u.dx & 0xff) | ((u.dy & 0xff) << 8);
    out[3] = bits;
    out[4] = nh3d_tile(glyph);
    out[5] = glyph_is_monster(glyph) ? glyph : -1;
    out[6] = u.usteed ? (int) u.usteed->m_id : -1;
    out[7] = (u.uswallow && u.ustuck) ? (int) u.ustuck->m_id : -1;
}

static int
nh3d_special_level(void)
{
    if (Is_medusa_level(&u.uz))
        return NH3D_SPECIAL_MEDUSA;
    if (Is_stronghold(&u.uz))
        return NH3D_SPECIAL_CASTLE;
    if (Is_valley(&u.uz))
        return NH3D_SPECIAL_VALLEY;
    if (Is_sanctum(&u.uz))
        return NH3D_SPECIAL_SANCTUM;
    if (Is_knox(&u.uz))
        return NH3D_SPECIAL_LUDIOS;
    if (In_V_tower(&u.uz))
        return NH3D_SPECIAL_VLAD_TOWER;
    if (In_W_tower(u.ux, u.uy, &u.uz))
        return NH3D_SPECIAL_WIZARD_TOWER;
    if (Is_qstart(&u.uz))
        return NH3D_SPECIAL_QUEST_HOME;
    if (Is_earthlevel(&u.uz))
        return NH3D_SPECIAL_EARTH;
    if (Is_airlevel(&u.uz))
        return NH3D_SPECIAL_AIR;
    if (Is_firelevel(&u.uz))
        return NH3D_SPECIAL_FIRE;
    if (Is_waterlevel(&u.uz))
        return NH3D_SPECIAL_WATER;
    if (Is_astralevel(&u.uz))
        return NH3D_SPECIAL_ASTRAL;
    return NH3D_SPECIAL_NONE;
}

/*
 * Hostile monsters the hero can spot and that the map shows as a monster
 * (a mimic posing as furniture is not counted): how many, the highest
 * difficulty of what they look like (0 while hallucinating, when the hero
 * cannot tell), and the distance to the nearest.
 */
static int
nh3d_hostiles_in_view(void)
{
    struct monst *mtmp;
    int count = 0, difficulty = 0, nearest = NH3D_HOSTILE_DISTANCE_MAX;

    for (mtmp = fmon; mtmp; mtmp = mtmp->nmon) {
        int glyph, dist;

        if (DEADMONSTER(mtmp) || mtmp->mtame || mtmp->mpeaceful
            || mtmp == u.usteed || !canspotmon(mtmp))
            continue;
        glyph = gg.gbuf[mtmp->my][mtmp->mx].glyphinfo.glyph;
        if (!glyph_is_monster(glyph))
            continue;
        if (count < NH3D_HOSTILE_COUNT_MAX)
            count++;
        if (!Hallucination
            && (int) mons[glyph_to_mon(glyph)].difficulty > difficulty)
            difficulty = (int) mons[glyph_to_mon(glyph)].difficulty;
        dist = distmin(u.ux, u.uy, mtmp->mx, mtmp->my);
        if (dist < nearest)
            nearest = dist;
    }
    return (count & 0xff) | ((difficulty & 0xff) << 8)
           | ((nearest & 0xff) << 16);
}

static void
nh3d_fill_level(int *out)
{
    int bits = 0;

    if (In_mines(&u.uz))
        bits |= NH3D_LEVEL_MINES;
    if (In_sokoban(&u.uz))
        bits |= NH3D_LEVEL_SOKOBAN;
    if (In_hell(&u.uz))
        bits |= NH3D_LEVEL_GEHENNOM;
    if (In_quest(&u.uz))
        bits |= NH3D_LEVEL_QUEST;
    if (In_endgame(&u.uz))
        bits |= NH3D_LEVEL_ENDGAME;
    if (*u.ushops)
        bits |= NH3D_LEVEL_IN_SHOP;
    if (temple_occupied(u.urooms))
        bits |= NH3D_LEVEL_IN_TEMPLE;

    out[0] = u.uz.dnum;
    out[1] = u.uz.dlevel;
    out[2] = observable_depth(&u.uz); /* as the status line shows it */
    out[3] = bits;
    out[4] = nh3d_special_level();
    out[5] = nh3d_hero_attacks | (nh3d_foe_attacks << 16);
    out[6] = nh3d_hostiles_in_view();
    out[7] = 0;
}

/*
 * What is under the hero, for the shell's floor panel: the terrain feature
 * as ':' would describe it, a trap the hero has seen, an engraving the hero
 * has read (or felt), and
 * the objects lying here with the names look_here() would print (shop
 * prices included).  Objects are listed only when the hero can see them:
 * not while blind, engulfed, or when they are under lava or water.  Sent as
 * a JSON string (notification "shim_floor_here") whenever it changes.
 */

#define NH3D_FLOOR_BUFSZ 16384
#define NH3D_FLOOR_MAX_OBJECTS 40

static char nh3d_floor_json[NH3D_FLOOR_BUFSZ];
static char nh3d_floor_prev[NH3D_FLOOR_BUFSZ];

struct nh3d_json {
    char *buf;
    size_t len, cap;
    boolean overflow;
};

static void
nh3d_json_raw(struct nh3d_json *js, const char *text)
{
    size_t n = strlen(text);

    if (js->overflow || js->len + n + 1 >= js->cap) {
        js->overflow = TRUE;
        return;
    }
    memcpy(js->buf + js->len, text, n + 1);
    js->len += n;
}

static void
nh3d_json_string(struct nh3d_json *js, const char *text)
{
    char esc[8];
    const unsigned char *p;

    nh3d_json_raw(js, "\"");
    for (p = (const unsigned char *) text; p && *p; p++) {
        if (*p == '"' || *p == '\\') {
            esc[0] = '\\', esc[1] = (char) *p, esc[2] = '\0';
        } else if (*p < 0x20) {
            Snprintf(esc, sizeof esc, "\\u%04x", (unsigned) *p);
        } else {
            esc[0] = (char) *p, esc[1] = '\0';
        }
        nh3d_json_raw(js, esc);
    }
    nh3d_json_raw(js, "\"");
}

static void
nh3d_json_int(struct nh3d_json *js, long value)
{
    char num[32];

    Snprintf(num, sizeof num, "%ld", value);
    nh3d_json_raw(js, num);
}

/* the terrain under the hero, as ':' describes it (or the plain floor) */
static const char *
nh3d_floor_feature(char *buf)
{
    const char *feature = dfeature_at(u.ux, u.uy, buf);
    int glyph;

    if (feature && !strcmp(feature, "pool of water") && Underwater)
        feature = 0;
    if (feature)
        return feature;
    if (Underwater)
        return "water";
    glyph = back_to_glyph(u.ux, u.uy);
    return glyph_is_cmap(glyph) ? defsyms[glyph_to_cmap(glyph)].explanation
                                : "";
}

static void
nh3d_build_floor_here(struct nh3d_json *js)
{
    char featbuf[BUFSZ];
    struct engr *ep = engr_at(u.ux, u.uy);
    struct trap *trap;
    struct obj *otmp;
    boolean hidden;
    long count = 0;
    int listed = 0;

    nh3d_json_raw(js, "{\"v\":1,\"x\":");
    nh3d_json_int(js, u.ux);
    nh3d_json_raw(js, ",\"y\":");
    nh3d_json_int(js, u.uy);
    nh3d_json_raw(js, ",\"feature\":");
    nh3d_json_string(js, u.uswallow ? "" : nh3d_floor_feature(featbuf));

    nh3d_json_raw(js, ",\"trap\":");
    if (!u.uswallow && (trap = t_at(u.ux, u.uy)) != 0 && trap->tseen)
        nh3d_json_string(js, trapname(trap->ttyp, FALSE));
    else
        nh3d_json_raw(js, "null");

    nh3d_json_raw(js, ",\"engraving\":");
    if (!u.uswallow && ep && ep->eread && ep->engr_txt[remembered_text]
        && *ep->engr_txt[remembered_text]) {
        nh3d_json_raw(js, "{\"type\":");
        nh3d_json_int(js, ep->engr_type);
        nh3d_json_raw(js, ",\"text\":");
        nh3d_json_string(js, ep->engr_txt[remembered_text]);
        nh3d_json_raw(js, "}");
    } else {
        nh3d_json_raw(js, "null");
    }

    /* objects are hidden from a blind or engulfed hero, and under lava or
       water unless the hero is down there too */
    hidden = Blind || u.uswallow || is_lava(u.ux, u.uy)
             || (is_pool(u.ux, u.uy) && !Underwater);
    nh3d_json_raw(js, ",\"hidden\":");
    nh3d_json_raw(js, hidden ? "true" : "false");
    nh3d_json_raw(js, ",\"objects\":[");
    if (!hidden) {
        for (otmp = svl.level.objects[u.ux][u.uy]; otmp;
             otmp = otmp->nexthere) {
            int glyph;

            count++;
            if (listed >= NH3D_FLOOR_MAX_OBJECTS)
                continue;
            glyph = obj_to_glyph(otmp, rn2_on_display_rng);
            if (listed++)
                nh3d_json_raw(js, ",");
            nh3d_json_raw(js, "{\"name\":");
            nh3d_json_string(js, doname_with_price(otmp));
            nh3d_json_raw(js, ",\"glyph\":");
            nh3d_json_int(js, nh3d_public_glyph(glyph));
            nh3d_json_raw(js, ",\"tile\":");
            nh3d_json_int(js, nh3d_appearance_tile(glyph));
            nh3d_json_raw(js, ",\"quan\":");
            nh3d_json_int(js, otmp->quan);
            nh3d_json_raw(js, "}");
        }
    }
    nh3d_json_raw(js, "],\"count\":");
    nh3d_json_int(js, count);
    nh3d_json_raw(js, "}");
}

static void
nh3d_publish_floor_here(boolean force)
{
    struct nh3d_json js;

    js.buf = nh3d_floor_json;
    js.len = 0;
    js.cap = sizeof nh3d_floor_json;
    js.overflow = FALSE;
    nh3d_floor_json[0] = '\0';
    nh3d_build_floor_here(&js);
    if (js.overflow)
        return;
    if (!force && !strcmp(nh3d_floor_json, nh3d_floor_prev))
        return;
    Strcpy(nh3d_floor_prev, nh3d_floor_json);
    EM_ASM({
        globalThis.nethackGlobal = globalThis.nethackGlobal || {};
        if (!Array.isArray(globalThis.nethackGlobal.pendingShimNotifications)) {
            globalThis.nethackGlobal.pendingShimNotifications = [];
        }
        globalThis.nethackGlobal.pendingShimNotifications.push([
            "shim_floor_here",
            UTF8ToString($0),
        ]);
    }, nh3d_floor_json);
}

/*
 * Polypiled: the monsters the hero actually sees, with their names and how
 * hurt they look, for the shell's hover label.  Sent as a JSON string
 * (notification "shim_monster_glance") whenever it changes.  Only what one
 * can tell by looking: no monster sensed by telepathy, warning or
 * detection, no disguised mimic or hider, and nothing while hallucinating.
 */
#define NH3D_GLANCE_BUFSZ 16384

static char nh3d_glance_json[NH3D_GLANCE_BUFSZ];
static char nh3d_glance_prev[NH3D_GLANCE_BUFSZ];

static const char *
nh3d_health_word(struct monst *mon)
{
    int mhp_max = max(mon->mhpmax, 1), pct = (mon->mhp * 100) / mhp_max;

    return (mon->mhp >= mhp_max) ? "uninjured"
           : (pct >= 50) ? "wounded"
             : (pct >= 15) ? "badly wounded"
               : "nearly dead";
}

static void
nh3d_build_monster_glance(struct nh3d_json *js)
{
    struct monst *mtmp;
    boolean first = TRUE;

    nh3d_json_raw(js, "{\"v\":1,\"monsters\":[");
    if (!Hallucination) {
        for (mtmp = fmon; mtmp; mtmp = mtmp->nmon) {
            if (DEADMONSTER(mtmp) || !canseemon(mtmp) || mtmp->mundetected
                || M_AP_TYPE(mtmp) != M_AP_NOTHING)
                continue;
            if (!first)
                nh3d_json_raw(js, ",");
            first = FALSE;
            nh3d_json_raw(js, "{\"x\":");
            nh3d_json_int(js, mtmp->mx);
            nh3d_json_raw(js, ",\"y\":");
            nh3d_json_int(js, mtmp->my);
            nh3d_json_raw(js, ",\"name\":");
            nh3d_json_string(js, l_monnam(mtmp));
            nh3d_json_raw(js, ",\"health\":");
            nh3d_json_string(js, nh3d_health_word(mtmp));
            nh3d_json_raw(js, mtmp->mtame ? ",\"tame\":true"
                              : mtmp->mpeaceful ? ",\"peaceful\":true" : "");
            nh3d_json_raw(js, "}");
        }
    }
    nh3d_json_raw(js, "]}");
}

static void
nh3d_publish_monster_glance(boolean force)
{
    struct nh3d_json js;

    js.buf = nh3d_glance_json;
    js.len = 0;
    js.cap = sizeof nh3d_glance_json;
    js.overflow = FALSE;
    nh3d_glance_json[0] = '\0';
    nh3d_build_monster_glance(&js);
    if (js.overflow)
        return;
    if (!force && !strcmp(nh3d_glance_json, nh3d_glance_prev))
        return;
    Strcpy(nh3d_glance_prev, nh3d_glance_json);
    EM_ASM({
        globalThis.nethackGlobal = globalThis.nethackGlobal || {};
        if (!Array.isArray(globalThis.nethackGlobal.pendingShimNotifications)) {
            globalThis.nethackGlobal.pendingShimNotifications = [];
        }
        globalThis.nethackGlobal.pendingShimNotifications.push([
            "shim_monster_glance",
            UTF8ToString($0),
        ]);
    }, nh3d_glance_json);
}

/*
 * Polypiled: what the hero knows about each map square, for the same hover
 * label: the ground, a dungeon feature standing on it (stairs, altar,
 * fountain...), a trap the hero has found, and the top object the hero
 * remembers there.  Sent as a JSON string (notification
 * "shim_square_glance") whenever it changes:
 *   {"v":1,"squares":[[x,y,ground,feature,trap,object],...],"names":[...]}
 * ground, feature and trap index "names" (-1 for none); object is the
 * object's name or null.  Only what the hero has seen or mapped is told;
 * looking here never teaches the hero anything (no dknown, no discovery).
 */
#define NH3D_SQUARE_BUFSZ 131072
#define NH3D_SQUARE_MAXNAMES 96

static char nh3d_square_json[NH3D_SQUARE_BUFSZ];
static char nh3d_square_prev[NH3D_SQUARE_BUFSZ];
static const char *nh3d_square_names[NH3D_SQUARE_MAXNAMES];
static int nh3d_square_nnames;

static int
nh3d_square_name(const char *name)
{
    int i;

    if (!name || !*name)
        return -1;
    for (i = 0; i < nh3d_square_nnames; i++)
        if (!strcmp(nh3d_square_names[i], name))
            return i;
    if (nh3d_square_nnames >= NH3D_SQUARE_MAXNAMES)
        return -1;
    nh3d_square_names[nh3d_square_nnames] = name;
    return nh3d_square_nnames++;
}

/* The ground and feature named by a map symbol (both may be null). */
static void
nh3d_square_terrain(int cmap, const char **ground, const char **feature)
{
    *ground = *feature = (const char *) 0;
    switch (cmap) {
    case S_vwall: case S_hwall: case S_tlcorn: case S_trcorn:
    case S_blcorn: case S_brcorn: case S_crwall: case S_tuwall:
    case S_tdwall: case S_tlwall: case S_trwall:
        *ground = "wall";
        break;
    case S_ndoor:
        *ground = "doorway";
        break;
    case S_vodoor: case S_hodoor:
        *ground = "open door";
        break;
    case S_vcdoor: case S_hcdoor:
        *ground = "closed door";
        break;
    case S_bars:
        *ground = "iron bars";
        break;
    case S_tree:
        *ground = "tree";
        break;
    case S_room: case S_darkroom: case S_engroom:
        *ground = "floor of a room";
        break;
    case S_corr: case S_litcorr: case S_engrcorr:
        *ground = "corridor";
        break;
    case S_upstair: case S_brupstair:
        *ground = "floor of a room", *feature = "staircase up";
        break;
    case S_dnstair: case S_brdnstair:
        *ground = "floor of a room", *feature = "staircase down";
        break;
    case S_upladder: case S_brupladder:
        *ground = "floor of a room", *feature = "ladder up";
        break;
    case S_dnladder: case S_brdnladder:
        *ground = "floor of a room", *feature = "ladder down";
        break;
    case S_altar:
        *ground = "floor of a room", *feature = "altar";
        break;
    case S_grave:
        *ground = "floor of a room", *feature = "grave";
        break;
    case S_throne:
        *ground = "floor of a room", *feature = "throne";
        break;
    case S_sink:
        *ground = "floor of a room", *feature = "sink";
        break;
    case S_fountain:
        *ground = "floor of a room", *feature = "fountain";
        break;
    case S_pool:
        *ground = "water";
        break;
    case S_water:
        *ground = "water";
        break;
    case S_ice:
        *ground = "ice";
        break;
    case S_lava: case S_lavawall:
        *ground = "lava";
        break;
    case S_vodbridge: case S_hodbridge:
        *ground = "lowered drawbridge";
        break;
    case S_vcdbridge: case S_hcdbridge:
        *ground = "raised drawbridge";
        break;
    case S_air:
        *ground = "air";
        break;
    case S_cloud:
        *ground = "cloud";
        break;
    default:
        break;
    }
}

/* The name of the object the hero remembers on top at x,y, as farlook
   would give it, but without the hero learning anything by it. */
static void
nh3d_square_object(char *buf, coordxy x, coordxy y, int glyph)
{
    struct obj *otmp = 0;
    boolean fakeobj;
    int save_terrainmode = iflags.terrainmode;

    buf[0] = '\0';
    iflags.terrainmode = 1; /* object_from_map(): don't observe_object() */
    fakeobj = object_from_map(glyph, x, y, &otmp);
    iflags.terrainmode = save_terrainmode;
    if (!otmp)
        return;
    if (otmp->otyp != STRANGE_OBJECT) {
        ++gd.distantname; /* no dknown, no artifact discovery */
        Strcpy(buf, otmp->dknown ? doname_with_price(otmp)
                                 : doname_vague_quan(otmp));
        --gd.distantname;
    } else {
        Strcpy(buf, obj_descr[STRANGE_OBJECT].oc_name);
    }
    if (fakeobj) {
        otmp->where = OBJ_FREE; /* object_from_map set it to OBJ_FLOOR */
        dealloc_obj(otmp);
    }
}

static const char *
nh3d_altar_name(int amsk)
{
    if (amsk & AM_SANCTUM)
        return "high altar";
    switch (Amask2align(amsk & AM_MASK)) {
    case A_LAWFUL:
        return "lawful altar";
    case A_NEUTRAL:
        return "neutral altar";
    case A_CHAOTIC:
        return "chaotic altar";
    default:
        return "unaligned altar";
    }
}

static void
nh3d_build_square_glance(struct nh3d_json *js)
{
    coordxy x, y;
    boolean first = TRUE;
    char objbuf[BUFSZ];
    int i;

    nh3d_square_nnames = 0;
    nh3d_json_raw(js, "{\"v\":1,\"squares\":[");
    for (y = 0; y < ROWNO; y++)
        for (x = 1; x < COLNO; x++) {
            struct rm *lev = &levl[x][y];
            int glyph = lev->glyph, cmap = -1, g, f, t;
            const char *ground, *feature, *trap = (const char *) 0;
            struct trap *ttmp;
            boolean object = FALSE;

            if (glyph_is_cmap(glyph) && !glyph_is_trap(glyph)
                && glyph_to_cmap(glyph) != S_stone)
                cmap = glyph_to_cmap(glyph);
            else if (lev->seenv)
                cmap = glyph_to_cmap(back_to_glyph(x, y));
            nh3d_square_terrain(cmap, &ground, &feature);
            if (cmap == S_altar) /* farlook tells the alignment too */
                feature = nh3d_altar_name(altarmask_at(x, y));
            if (!Hallucination) {
                if (glyph_is_trap(glyph))
                    trap = trapname(glyph_to_trap(glyph), FALSE);
                else if ((ttmp = t_at(x, y)) != 0 && ttmp->tseen)
                    trap = trapname(ttmp->ttyp, FALSE);
                object = glyph_is_object(glyph);
            }
            if (!ground && !feature && !trap && !object)
                continue;
            g = nh3d_square_name(ground);
            f = nh3d_square_name(feature);
            t = nh3d_square_name(trap);
            if (!first)
                nh3d_json_raw(js, ",");
            first = FALSE;
            nh3d_json_raw(js, "[");
            nh3d_json_int(js, x);
            nh3d_json_raw(js, ",");
            nh3d_json_int(js, y);
            nh3d_json_raw(js, ",");
            nh3d_json_int(js, g);
            nh3d_json_raw(js, ",");
            nh3d_json_int(js, f);
            nh3d_json_raw(js, ",");
            nh3d_json_int(js, t);
            nh3d_json_raw(js, ",");
            if (object) {
                nh3d_square_object(objbuf, x, y, glyph);
                if (objbuf[0])
                    nh3d_json_string(js, objbuf);
                else
                    nh3d_json_raw(js, "null");
            } else {
                nh3d_json_raw(js, "null");
            }
            nh3d_json_raw(js, "]");
        }
    nh3d_json_raw(js, "],\"names\":[");
    for (i = 0; i < nh3d_square_nnames; i++) {
        if (i)
            nh3d_json_raw(js, ",");
        nh3d_json_string(js, nh3d_square_names[i]);
    }
    nh3d_json_raw(js, "]}");
}

static void
nh3d_publish_square_glance(boolean force)
{
    struct nh3d_json js;

    js.buf = nh3d_square_json;
    js.len = 0;
    js.cap = sizeof nh3d_square_json;
    js.overflow = FALSE;
    nh3d_square_json[0] = '\0';
    nh3d_build_square_glance(&js);
    if (js.overflow)
        return;
    if (!force && !strcmp(nh3d_square_json, nh3d_square_prev))
        return;
    Strcpy(nh3d_square_prev, nh3d_square_json);
    EM_ASM({
        globalThis.nethackGlobal = globalThis.nethackGlobal || {};
        if (!Array.isArray(globalThis.nethackGlobal.pendingShimNotifications)) {
            globalThis.nethackGlobal.pendingShimNotifications = [];
        }
        globalThis.nethackGlobal.pendingShimNotifications.push([
            "shim_square_glance",
            UTF8ToString($0),
        ]);
    }, nh3d_square_json);
}

/*
 * The hero's inventory, for the shell's inventory screen: every carried
 * object with what doname() would tell about it, split into fields, and the
 * contents of containers whose contents the hero knows.  Sent as a JSON
 * string (notification "shim_inventory") whenever it changes.
 *
 * Knowledge follows doname(): BUC only when bknown, enchantment and charges
 * only where doname() prints them, erosion words only for the classes that
 * get them.  Objects are named by appearance (public glyph and tile).  A bag
 * of tricks the hero has not identified is reported as a container, like
 * the sacks it looks like.
 *
 * Weight is given for what the hero carries: each top-level object (what
 * it adds to the load now, contents included; worn armor counts for half)
 * and the total, with the carrying capacity.  The hero learns these by picking things up
 * (docs/inventory-screen-design.md, section 4).  Objects inside containers carry no weight of their own here.
 */

#define NH3D_INVENTORY_BUFSZ 262144
#define NH3D_INVENTORY_MAX_DEPTH 4
#define NH3D_INVENTORY_MAX_CONTENTS 200

static char nh3d_inventory_json[NH3D_INVENTORY_BUFSZ];
static unsigned long nh3d_inventory_prev_hash;
static size_t nh3d_inventory_prev_len;
static boolean nh3d_inventory_have_prev;

static boolean
nh3d_looks_like_container(struct obj *obj)
{
    return (boolean) (Is_container(obj)
                      || (obj->otyp == BAG_OF_TRICKS
                          && !objects[BAG_OF_TRICKS].oc_name_known));
}

static void
nh3d_json_erosion(struct nh3d_json *js, const char *key, int level,
                  const char *kind)
{
    nh3d_json_raw(js, ",\"");
    nh3d_json_raw(js, key);
    nh3d_json_raw(js, "\":{\"level\":");
    nh3d_json_int(js, level);
    nh3d_json_raw(js, ",\"kind\":");
    nh3d_json_string(js, kind);
    nh3d_json_raw(js, "}");
}

/* the short label under an item's icon: the kind of thing as the hero
   knows it (simpleonames(): "long sword", "pink potion"), except that a
   thing with a proper name the hero can see goes by it -- an artifact by
   its name ("Excalibur", "Orb of Detection") and known holy or unholy
   water as such */
static const char *
nh3d_label_name(struct obj *obj)
{
    static char buf[BUFSZ];

    if (obj->oartifact && has_oname(obj) && obj->dknown) {
        const char *name = ONAME(obj);

        return !strncmp(name, "The ", 4) ? name + 4 : name;
    }
    if (obj->otyp == POT_WATER && obj->dknown && obj->bknown
        && (obj->blessed || obj->cursed)
        && objects[POT_WATER].oc_name_known) {
        Snprintf(buf, sizeof buf, "%s of %s water",
                 obj->quan != 1L ? "potions" : "potion",
                 obj->blessed ? "holy" : "unholy");
        return buf;
    }
    return simpleonames(obj);
}

/* what a shop asks for the object, as doname() and the floor listing
   quote it: "unpaid" (carried, not bought), "contents" (unpaid things
   inside), "forSale" (shop goods lying here) */
static void
nh3d_json_inventory_price(struct nh3d_json *js, struct obj *obj)
{
    long price = 0L;
    const char *kind = NULL;

    if (iflags.suppress_price || program_state.restoring)
        return;
    if (is_unpaid(obj)) {
        price = unpaid_cost(obj, COST_CONTENTS);
        kind = obj->unpaid ? "unpaid" : "contents";
    } else {
        /* zero outside shops and for what the hero owns */
        int nochrg = 0;

        price = get_cost_of_shop_item(obj, &nochrg);
        kind = nochrg > 0 ? "contents" : "forSale";
    }
    if (kind && price > 0L) {
        nh3d_json_raw(js, ",\"price\":");
        nh3d_json_int(js, price);
        nh3d_json_raw(js, ",\"priceKind\":");
        nh3d_json_string(js, kind);
    }
}

static void nh3d_json_inventory_list(struct nh3d_json *, struct obj *, int);

static void
nh3d_json_inventory_object(struct nh3d_json *js, struct obj *obj, int depth,
                           boolean carried)
{
    int glyph = obj_to_glyph(obj, rn2_on_display_rng);
    int oclass = is_weptool(obj) ? WEAPON_CLASS : obj->oclass;
    boolean known = obj->known;
    char let[2];

    nh3d_json_raw(js, "{\"id\":");
    nh3d_json_int(js, (long) obj->o_id);
    if (depth == 0 && carried) {
        let[0] = obj->invlet, let[1] = '\0';
        nh3d_json_raw(js, ",\"letter\":");
        nh3d_json_string(js, let);
    }
    nh3d_json_raw(js, ",\"name\":");
    nh3d_json_string(js, doname(obj));
    /* the label under the icon: the kind of thing, or its proper name */
    nh3d_json_raw(js, ",\"base\":");
    nh3d_json_string(js, nh3d_label_name(obj));
    nh3d_json_inventory_price(js, obj);
    nh3d_json_raw(js, ",\"class\":");
    nh3d_json_int(js, obj->oclass);
    nh3d_json_raw(js, ",\"glyph\":");
    nh3d_json_int(js, nh3d_public_glyph(glyph));
    nh3d_json_raw(js, ",\"tile\":");
    nh3d_json_int(js, nh3d_appearance_tile(glyph));
    nh3d_json_raw(js, ",\"quan\":");
    nh3d_json_int(js, obj->quan);
    /* look-alike armor always shares its category, so it is public */
    if (obj->oclass == ARMOR_CLASS) {
        nh3d_json_raw(js, ",\"armor\":");
        nh3d_json_int(js, objects[obj->otyp].oc_armcat);
        /* turns to put on or take off; look-alikes share it too */
        nh3d_json_raw(js, ",\"delay\":");
        nh3d_json_int(js, objects[obj->otyp].oc_delay);
    } else if (obj->otyp == BLINDFOLD || obj->otyp == TOWEL
               || obj->otyp == LENSES) {
        nh3d_json_raw(js, ",\"eyewear\":true");
    }

    if (depth == 0 && carried) {
        /* what it adds to the load now (worn armor counts for half);
           its weight unworn is left for the hero to find out */
        long wt = (long) carried_obj_weight(obj);

        nh3d_json_raw(js, ",\"weight\":");
        nh3d_json_int(js, wt);
        if (obj->owornmask) {
            nh3d_json_raw(js, ",\"worn\":");
            nh3d_json_int(js, obj->owornmask);
            if (obj == uskin) {
                nh3d_json_raw(js, ",\"skin\":true");
            } else if ((obj->owornmask & W_ARMOR) != 0L) {
                if (doffing(obj))
                    nh3d_json_raw(js, ",\"doffing\":true");
                else if (donning(obj))
                    nh3d_json_raw(js, ",\"donning\":true");
            }
        }
    }

    if (obj->bknown && obj->oclass != COIN_CLASS) {
        nh3d_json_raw(js, ",\"buc\":");
        nh3d_json_string(js, obj->blessed ? "blessed"
                             : obj->cursed ? "cursed" : "uncursed");
    }

    /* the same cases as doname_base() */
    switch (oclass) {
    case WEAPON_CLASS:
    case ARMOR_CLASS:
    case BALL_CLASS:
    case CHAIN_CLASS:
        if (is_damageable(obj) && obj->otyp != CRYSKNIFE) {
            if (obj->oeroded)
                nh3d_json_erosion(js, "eroded", obj->oeroded,
                                  is_rustprone(obj) ? "rust"
                                  : is_crackable(obj) ? "crack" : "burn");
            if (obj->oeroded2)
                nh3d_json_erosion(js, "eroded2", obj->oeroded2,
                                  is_corrodeable(obj) ? "corrode" : "rot");
        }
        if (obj->rknown && obj->oerodeproof
            && (is_damageable(obj) || obj->otyp == CRYSKNIFE))
            nh3d_json_raw(js, ",\"erodeproof\":true");
        if (oclass != BALL_CLASS && oclass != CHAIN_CLASS) {
            if (is_poisonable(obj) && obj->opoisoned)
                nh3d_json_raw(js, ",\"poisoned\":true");
            if (known) {
                nh3d_json_raw(js, ",\"enchantment\":");
                nh3d_json_int(js, obj->spe);
            }
        }
        break;
    case RING_CLASS:
        if (known && objects[obj->otyp].oc_charged) {
            nh3d_json_raw(js, ",\"enchantment\":");
            nh3d_json_int(js, obj->spe);
        }
        break;
    case TOOL_CLASS:
        if ((obj->owornmask & (W_TOOL | W_SADDLE)) || obj->otyp == LEASH
            || obj->otyp == CANDELABRUM_OF_INVOCATION
            || obj->otyp == OIL_LAMP || obj->otyp == MAGIC_LAMP
            || obj->otyp == BRASS_LANTERN || Is_candle(obj)
            || !objects[obj->otyp].oc_charged)
            break;
        FALLTHROUGH;
        /*FALLTHRU*/
    case WAND_CLASS:
        if (known) {
            nh3d_json_raw(js, ",\"charges\":");
            nh3d_json_int(js, obj->spe);
            nh3d_json_raw(js, ",\"recharged\":");
            nh3d_json_int(js, obj->recharged);
        }
        break;
    default:
        break;
    }

    if (obj->greased)
        nh3d_json_raw(js, ",\"greased\":true");
    if (obj->lamplit && (!artifact_light(obj) || !Blind))
        nh3d_json_raw(js, ",\"lit\":true");
    if (is_unpaid(obj))
        nh3d_json_raw(js, ",\"unpaid\":true");
    if (has_oname(obj))
        nh3d_json_raw(js, ",\"named\":true");

    if (nh3d_looks_like_container(obj)) {
        nh3d_json_raw(js, ",\"container\":{");
        if (obj->lknown && Is_box(obj))
            nh3d_json_raw(js, obj->olocked ? "\"locked\":true,"
                                           : "\"locked\":false,");
        if (obj->cknown && Is_container(obj)) {
            nh3d_json_raw(js, "\"contents\":");
            if (depth + 1 < NH3D_INVENTORY_MAX_DEPTH)
                nh3d_json_inventory_list(js, obj->cobj, depth + 1);
            else
                nh3d_json_raw(js, "null,\"deep\":true");
        } else {
            nh3d_json_raw(js, "\"contents\":null");
        }
        nh3d_json_raw(js, "}");
    }
    nh3d_json_raw(js, "}");
}

/* a JSON array of the objects in a chain (nobj); inside a container, the
   list stops at NH3D_INVENTORY_MAX_CONTENTS and ",\"more\":n" follows */
static void
nh3d_json_inventory_list(struct nh3d_json *js, struct obj *chain, int depth)
{
    struct obj *otmp;
    int listed = 0;
    long more = 0;

    nh3d_json_raw(js, "[");
    for (otmp = chain; otmp; otmp = otmp->nobj) {
        if (depth > 0 && listed >= NH3D_INVENTORY_MAX_CONTENTS) {
            more++;
            continue;
        }
        if (listed++)
            nh3d_json_raw(js, ",");
        nh3d_json_inventory_object(js, otmp, depth, TRUE);
    }
    nh3d_json_raw(js, "]");
    if (more) {
        nh3d_json_raw(js, ",\"more\":");
        nh3d_json_int(js, more);
    }
}

/* what lies here, as the floor panel shows it, with ids and known
   contents so the screen can pick things up and open floor containers */
#define NH3D_INVENTORY_MAX_FLOOR 40

static void
nh3d_json_inventory_floor(struct nh3d_json *js)
{
    struct obj *otmp;
    boolean hidden = Blind || u.uswallow || is_lava(u.ux, u.uy)
                     || (is_pool(u.ux, u.uy) && !Underwater);
    int listed = 0;
    long count = 0;

    nh3d_json_raw(js, ",\"floorHidden\":");
    nh3d_json_raw(js, hidden ? "true" : "false");
    nh3d_json_raw(js, ",\"floor\":[");
    if (!hidden) {
        for (otmp = svl.level.objects[u.ux][u.uy]; otmp;
             otmp = otmp->nexthere) {
            count++;
            if (listed >= NH3D_INVENTORY_MAX_FLOOR)
                continue;
            if (listed++)
                nh3d_json_raw(js, ",");
            nh3d_json_inventory_object(js, otmp, 0, FALSE);
        }
    }
    nh3d_json_raw(js, "],\"floorCount\":");
    nh3d_json_int(js, count);
}

static void
nh3d_build_inventory(struct nh3d_json *js)
{
    int encumbrance = near_capacity(); /* also sets gw.wc */
    int capacity = gw.wc;
    int weight = inv_weight() + gw.wc;

    nh3d_json_raw(js, "{\"v\":1,\"weight\":");
    nh3d_json_int(js, weight);
    nh3d_json_raw(js, ",\"capacity\":");
    nh3d_json_int(js, capacity);
    nh3d_json_raw(js, ",\"encumbrance\":");
    nh3d_json_int(js, encumbrance);
    /* the order the inventory lists its classes in (inv_order option) */
    nh3d_json_raw(js, ",\"order\":[");
    {
        const char *c;

        for (c = flags.inv_order; *c; c++) {
            if (c != flags.inv_order)
                nh3d_json_raw(js, ",");
            nh3d_json_int(js, (long) *c);
        }
    }
    nh3d_json_raw(js, "]");
    nh3d_json_raw(js, ",\"twoweapon\":");
    nh3d_json_raw(js, u.twoweap ? "true" : "false");
    nh3d_json_raw(js, ",\"punished\":");
    nh3d_json_raw(js, Punished ? "true" : "false");
    nh3d_json_raw(js, ",\"game\":");
    nh3d_json_int(js, (long) ubirthday);
    nh3d_json_raw(js, ",\"objects\":");
    nh3d_json_inventory_list(js, gi.invent, 0);
    nh3d_json_inventory_floor(js);
    nh3d_json_raw(js, "}");
}

static unsigned long
nh3d_hash(const char *text, size_t len)
{
    unsigned long h = 2166136261UL;
    size_t i;

    for (i = 0; i < len; i++) {
        h ^= (unsigned char) text[i];
        h = (h * 16777619UL) & 0xffffffffUL;
    }
    return h;
}

static void
nh3d_publish_inventory(boolean force)
{
    struct nh3d_json js;
    unsigned long hash;

    js.buf = nh3d_inventory_json;
    js.len = 0;
    js.cap = sizeof nh3d_inventory_json;
    js.overflow = FALSE;
    nh3d_inventory_json[0] = '\0';
    nh3d_build_inventory(&js);
    if (js.overflow)
        return;
    hash = nh3d_hash(nh3d_inventory_json, js.len);
    if (!force && nh3d_inventory_have_prev && hash == nh3d_inventory_prev_hash
        && js.len == nh3d_inventory_prev_len)
        return;
    nh3d_inventory_prev_hash = hash;
    nh3d_inventory_prev_len = js.len;
    nh3d_inventory_have_prev = TRUE;
    EM_ASM({
        globalThis.nethackGlobal = globalThis.nethackGlobal || {};
        if (!Array.isArray(globalThis.nethackGlobal.pendingShimNotifications)) {
            globalThis.nethackGlobal.pendingShimNotifications = [];
        }
        globalThis.nethackGlobal.pendingShimNotifications.push([
            "shim_inventory",
            UTF8ToString($0),
        ]);
    }, nh3d_inventory_json);
}

/*
 * #nh3dinventory: an internal command for the shell's inventory screen,
 * bound to M-^I.  The shell sends that key only at an ordinary command
 * prompt, after putting a request in globalThis.nethackGlobal
 * .nh3dInventoryRequest: an operation and its arguments separated by ':'.
 *
 *   adjust:<from>:<to>    #adjust, move or swap <from> into slot <to>
 *   wear:<x>              W            puton:<x>[:r|l]   P (ring hand)
 *   takeoff:<x>           T            remove:<x>        R
 *   wield:<x|->           w            quiver:<x|->      Q
 *   swap                  x            twoweapon         X / #twoweapon
 *   checkpoint            write the checkpoint files now (trial saves)
 *
 * The command answers the real command's prompts through the command
 * queue (getobj() and yn_function() read it) and runs it, so whether the
 * action is possible, what it costs and what it says stay the game's.
 * Anything the real command did not ask for is dropped afterwards, so no
 * queued answer can ever run as a command of its own.
 */

#define NH3D_INVOP_MAX 2048
#define NH3D_INVOP_MAX_IDS 128

/* "12,40x3,7": o_ids with optional counts; -1 when malformed */
static int
nh3d_invop_ids(const char *text, unsigned *ids, long *counts)
{
    int n = 0;
    const char *p = text;

    if (!*p)
        return 0;
    while (*p) {
        unsigned long id = 0;
        long count = 0;
        boolean any = FALSE;

        if (n >= NH3D_INVOP_MAX_IDS)
            return -1;
        while (*p >= '0' && *p <= '9')
            id = id * 10 + (unsigned long) (*p++ - '0'), any = TRUE;
        if (!any)
            return -1;
        if (*p == 'x') {
            p++;
            any = FALSE;
            while (*p >= '0' && *p <= '9')
                count = count * 10 + (*p++ - '0'), any = TRUE;
            if (!any)
                return -1;
        }
        ids[n] = (unsigned) id;
        counts[n] = count;
        n++;
        if (*p == ',')
            p++;
        else if (*p)
            return -1;
    }
    return n;
}

static boolean
nh3d_invop_letter_ok(char c, boolean allow_hands)
{
    struct obj *otmp;

    if (allow_hands && c == HANDS_SYM)
        return TRUE;
    for (otmp = gi.invent; otmp; otmp = otmp->nobj)
        if (otmp->invlet == c)
            return TRUE;
    return FALSE;
}

static boolean
nh3d_invop_slot_ok(char c)
{
    return (boolean) ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                      || c == GOLD_SYM);
}

int
nh3d_inventory_command(void)
{
    static char req[NH3D_INVOP_MAX];
    char *args[4], *p;
    char keys[3];
    int nargs = 0, nkeys = 0, i, res;
    int (*fn)(void) = 0;

    req[0] = '\0';
    EM_ASM({
        const g = globalThis.nethackGlobal || {};
        const request = typeof g.nh3dInventoryRequest === "string"
            ? g.nh3dInventoryRequest : "";
        g.nh3dInventoryRequest = null;
        stringToUTF8(request, $0, $1);
    }, req, (int) sizeof req);

    for (p = req; nargs < 4;) {
        args[nargs++] = p;
        if ((p = strchr(p, ':')) == 0)
            break;
        *p++ = '\0';
    }
    /* checkpoint: write the game state and the current level into the
       lock files now, as a level change does, for the shell's
       trial-and-error save slots; takes no time and changes nothing */
    if (!strcmp(args[0], "checkpoint") && nargs == 1) {
        do_idlecheckpoint();
        return ECMD_OK;
    }
    /* pickup:<ids>  drop:<ids>  loot:<container>:<out ids>:<in ids> */
    if (!strcmp(args[0], "pickup") || !strcmp(args[0], "drop")) {
        static unsigned ids[NH3D_INVOP_MAX_IDS];
        static long counts[NH3D_INVOP_MAX_IDS];
        int n = nargs == 2 ? nh3d_invop_ids(args[1], ids, counts) : -1;

        if (n <= 0)
            return ECMD_OK;
        return args[0][0] == 'p' ? nh3d_pickup_objects(ids, counts, n)
                                 : nh3d_drop_objects(ids, counts, n);
    }
    if (!strcmp(args[0], "loot")) {
        static unsigned outs[NH3D_INVOP_MAX_IDS], ins[NH3D_INVOP_MAX_IDS];
        static long outcounts[NH3D_INVOP_MAX_IDS], incounts[NH3D_INVOP_MAX_IDS];
        static unsigned cid[NH3D_INVOP_MAX_IDS];
        int nout, nin;

        if (nargs != 4 || nh3d_invop_ids(args[1], cid, outcounts) != 1)
            return ECMD_OK;
        nout = nh3d_invop_ids(args[2], outs, outcounts);
        nin = nh3d_invop_ids(args[3], ins, incounts);
        if (nout < 0 || nin < 0)
            return ECMD_OK;
        return nh3d_container_transfer(cid[0], outs, outcounts, nout, ins,
                                       incounts, nin);
    }
    for (i = 1; i < nargs; i++)
        if (strlen(args[i]) != 1)
            return ECMD_OK;

    if (!strcmp(args[0], "adjust") && nargs == 3
        && nh3d_invop_letter_ok(args[1][0], FALSE)
        && nh3d_invop_slot_ok(args[2][0])) {
        fn = doorganize;
        keys[nkeys++] = args[1][0];
        keys[nkeys++] = args[2][0];
    } else if (!strcmp(args[0], "swap") && nargs == 1) {
        fn = doswapweapon;
    } else if (!strcmp(args[0], "twoweapon") && nargs == 1) {
        fn = dotwoweapon;
    } else if (!strcmp(args[0], "alternate") && nargs == 2) {
        struct obj *otmp;

        for (otmp = gi.invent; otmp; otmp = otmp->nobj)
            if (otmp->invlet == args[1][0])
                break;
        if (!otmp)
            return ECMD_OK;
        cmdq_clear(CQ_CANNED);
        return nh3d_ready_alternate(otmp);
    } else if (!strcmp(args[0], "sort") && nargs == 1) {
        cmdq_clear(CQ_CANNED);
        return nh3d_sort_inventory();
    } else if (!strcmp(args[0], "altunwield") && nargs == 1) {
        /* empty the alternate weapon: #altunwield, as picking '-' for it
           from the item actions does */
        fn = remarm_swapwep;
        keys[nkeys++] = '-';
    } else if (nargs >= 2) {
        boolean hands = FALSE;

        if (!strcmp(args[0], "wear") && nargs == 2) {
            fn = dowear;
        } else if (!strcmp(args[0], "puton") && nargs <= 3) {
            fn = doputon;
            if (nargs == 3 && args[2][0] != 'r' && args[2][0] != 'l')
                return ECMD_OK;
        } else if (!strcmp(args[0], "takeoff") && nargs == 2) {
            fn = dotakeoff;
        } else if (!strcmp(args[0], "remove") && nargs == 2) {
            fn = doremring;
        } else if (!strcmp(args[0], "wield") && nargs == 2) {
            fn = dowield, hands = TRUE;
        } else if (!strcmp(args[0], "quiver") && nargs == 2) {
            fn = dowieldquiver, hands = TRUE;
        }
        if (!fn || !nh3d_invop_letter_ok(args[1][0], hands))
            return ECMD_OK;
        keys[nkeys++] = args[1][0];
        if (fn == doputon && nargs == 3)
            keys[nkeys++] = args[2][0];
    }
    if (!fn)
        return ECMD_OK;

    cmdq_clear(CQ_CANNED);
    for (i = 0; i < nkeys; i++)
        cmdq_add_key(CQ_CANNED, keys[i]);
    res = (*fn)();
    cmdq_clear(CQ_CANNED);
    return res;
}

static boolean
nh3d_full_frame_requested(void)
{
    return (boolean) EM_ASM_INT({
        const g = globalThis.nethackGlobal;
        if (g && g.knowledgeFullRequested) {
            g.knowledgeFullRequested = false;
            return 1;
        }
        return 0;
    });
}

void
nh3d_knowledge_publish(void)
{
    int *hero = &nh3d_frame[NH3D_HEADER_WORDS];
    int *level = hero + NH3D_HERO_WORDS;
    int *cursor = &nh3d_frame[NH3D_FIXED_WORDS];
    int *tail;
    int cells = 0, monsters = 0, lights = 0, tail_words;
    boolean complete, changed;
    coordxy x, y;
    light_source *ls;

    if (!gv.viz_array || u.uz.dlevel <= 0 || suppress_map_output()
        || !isok(u.ux, u.uy))
        return;

    complete = !nh3d_have_prev || !on_level(&u.uz, &nh3d_prev_level)
               || nh3d_full_frame_requested();
    nh3d_publish_floor_here(complete);
    nh3d_publish_inventory(complete);
    nh3d_publish_monster_glance(complete); /* Polypiled */
    nh3d_publish_square_glance(complete);  /* Polypiled */

    nh3d_fill_hero(hero);
    nh3d_fill_level(level);
    changed = complete
              || memcmp(hero, nh3d_prev_fixed, sizeof nh3d_prev_fixed) != 0;

    /* changed cells (all of them in a complete frame) */
    for (y = 0; y < ROWNO; y++) {
        for (x = 1; x < COLNO; x++) {
            nh3d_fill_cell(x, y, cursor);
            if (complete
                || memcmp(cursor, nh3d_prev_cells[y][x],
                          sizeof nh3d_prev_cells[y][x]) != 0) {
                memcpy(nh3d_prev_cells[y][x], cursor,
                       sizeof nh3d_prev_cells[y][x]);
                cursor += NH3D_CELL_WORDS;
                cells++;
            }
        }
    }

    /* every monster the map shows, and every light the hero can see */
    tail = cursor;
    for (y = 0; y < ROWNO; y++)
        for (x = 1; x < COLNO; x++)
            if (nh3d_fill_monster(x, y, cursor)) {
                cursor += NH3D_MONSTER_WORDS;
                monsters++;
            }
    for (ls = gl.light_base; ls && lights < NH3D_MAX_LIGHTS; ls = ls->next)
        if (nh3d_fill_light(ls, cursor)) {
            cursor += NH3D_LIGHT_WORDS;
            lights++;
        }
    tail_words = (int) (cursor - tail);
    if (!changed)
        changed = cells > 0 || monsters != nh3d_prev_monsters
                  || lights != nh3d_prev_lights
                  || memcmp(tail, nh3d_prev_tail,
                            tail_words * sizeof (int)) != 0;
    if (!changed)
        return;

    memcpy(nh3d_prev_fixed, hero, sizeof nh3d_prev_fixed);
    memcpy(nh3d_prev_tail, tail, tail_words * sizeof (int));
    nh3d_prev_monsters = monsters;
    nh3d_prev_lights = lights;
    nh3d_prev_level = u.uz;
    nh3d_have_prev = TRUE;

    nh3d_frame[0] = NH3D_KNOWLEDGE_VERSION;
    nh3d_frame[1] = ++nh3d_frame_seq;
    nh3d_frame[2] = complete ? NH3D_FRAME_COMPLETE : 0;
    nh3d_frame[3] = cells;
    nh3d_frame[4] = monsters;
    nh3d_frame[5] = lights;
    nh3d_frame[6] = (int) svm.moves;
    nh3d_frame[7] = 0;

    EM_ASM({
        globalThis.nethackGlobal = globalThis.nethackGlobal || {};
        if (!Array.isArray(globalThis.nethackGlobal.pendingShimNotifications)) {
            globalThis.nethackGlobal.pendingShimNotifications = [];
        }
        globalThis.nethackGlobal.pendingShimNotifications.push([
            "shim_knowledge_frame",
            HEAP32.slice($0 >> 2, ($0 >> 2) + $1),
        ]);
    }, nh3d_frame, (int) (cursor - nh3d_frame));
}

#endif /* SHIM_GRAPHICS && __EMSCRIPTEN__ */
