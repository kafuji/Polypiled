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

#define NH3D_KNOWLEDGE_VERSION 1

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
    out[4] = out[5] = out[6] = out[7] = 0;
}

/*
 * What is under the hero, for the shell's floor panel: the terrain feature
 * as ':' would describe it, an engraving the hero has read (or felt), and
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
