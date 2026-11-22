// Builds a save for trying the inventory screen: a wizard-mode Valkyrie
// wearing an ascension kit, with spare armor and weapons for equipment sets,
// cursed/blessed/eroded/erodeproof items, unidentified things, a bag of
// holding with a sack of things inside it, and a box and loose items on the
// floor. Writes a .nh3dsave archive the game imports from Options > Saves.
//
// Usage: node scripts/game/make-inventory-test-save.mjs [core dir] [out file]
//   core dir defaults to public (nethack-5.js/.wasm), out file to
//   .test-save-tmp/inventory-kit.nh3dsave
//
// The save belongs to the core it was made with; make it again after a core
// update. The character is called "InvKit" (import refuses an existing save
// of that name).
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const coreDir = resolve(process.argv[2] ?? "public");
const outFile = resolve(process.argv[3] ?? ".test-save-tmp/inventory-kit.nh3dsave");
const stem = existsSync(resolve(coreDir, "nethack.js")) ? "nethack" : "nethack-5";
const NAME = "InvKit";
const OPTIONS =
  `name:${NAME},role:Valkyrie,race:human,gender:female,align:neutral,` +
  "!autopickup,pettype:none,!legacy,!tutorial,!splash_screen,number_pad:1,windowtype:shim,playmode:debug";

/*
 * The script, run at command prompts. "wish" asks ^W; the others go to the
 * inventory screen's #nh3dinventory (M-^I). "wish:<text>=<alias>" names the
 * new item (wished items show by appearance, so names don't find them). In an
 * operation, {=alias} or {text} is an item's inventory letter, [=alias] or
 * [text] its object id (carried or here on the floor).
 */
const steps = [
  // take off the starting kit
  "takeoff:{small shield}",
  // the ascension kit, put on
  "wish:blessed fixed +2 gray dragon scale mail=gdsm",
  "wish:blessed fixed +2 cloak of magic resistance=cmr",
  "wish:blessed fixed +2 speed boots=speed",
  "wish:blessed fixed +2 gauntlets of power=gop",
  "wish:blessed fixed +2 helm of brilliance=hob",
  "wish:blessed amulet of life saving=ls",
  "wish:blessed ring of free action=fa",
  "wish:blessed ring of conflict=conflict",
  "wish:blessed fixed +3 Mjollnir=mj",
  "wear:{=gdsm}",
  "wear:{=cmr}",
  "wear:{=speed}",
  "wear:{=gop}",
  "wear:{=hob}",
  "puton:{=ls}",
  "puton:{=fa}:l",
  "wield:{=mj}",
  // spares for equipment sets: spellcasting and ranged
  "wish:blessed +2 quarterstaff=staff",
  "wish:blessed robe=robe",
  "wish:blessed +1 elven leather helm=elfhelm",
  "wish:blessed +2 elven dagger=dagger",
  "wish:blessed +2 elven bow=bow",
  "wish:40 blessed +2 elven arrows=arrows",
  "quiver:{=arrows}",
  // condition effects: cursed, eroded, erodeproof, poisoned, greased, lit
  "wish:cursed -2 dunce cap=dunce",
  "wish:thoroughly rusty +0 long sword",
  "wish:very corroded +1 dwarvish mattock=mattock",
  "wish:burnt +0 leather cloak",
  "wish:rotted +0 low boots",
  "wish:rustproof +3 katana",
  "wish:20 poisoned +0 darts",
  "wish:greased +0 elven mithril-coat",
  "wish:blessed brass lantern=lantern",
  "apply:{=lantern}",
  // unidentified and charged things
  "wish:blessed wand of death",
  "wish:wand of digging",
  "wish:blessed magic marker",
  "wish:blessed unicorn horn",
  "wish:blessed stethoscope",
  "wish:blessed luckstone",
  "wish:2 blessed scrolls of genocide=genocide",
  "wish:3 blessed scrolls of enchant armor",
  "wish:2 blessed potions of full healing=fullheal",
  "wish:7 holy water=water",
  "wish:blessed ring of levitation",
  "wish:towel",
  "wish:blindfold",
  "wish:lenses=lenses",
  "wish:2 food rations",
  "wish:1000 gold pieces",
  // a bag of holding with a sack inside, both with things in them
  "wish:blessed bag of holding=boh",
  "wish:oilskin sack=sack",
  "wish:blessed spellbook of identify=book",
  "loot:[=sack]::[=genocide],[=book],[=lenses]",
  "loot:[=boh]::[=fullheal],[=water],[=sack],[food ration]",
  // a bag never opened: its contents are unknown
  "wish:bag",
  // here on the floor: a box with things inside, and loose things
  "wish:large box=box",
  "wish:2 uncursed potions of see invisible=seeinv",
  "wish:uncursed +0 crossbow=crossbow",
  "drop:[=box],[=crossbow],[=mattock]",
  "loot:[=box]::[=seeinv]",
  "wish:12 rocks=rocks",
  "drop:[=rocks]",
  // a chest here (wished chests may be locked or trapped: try to open it)
  "wish:locked chest=chest",
  "drop:[=chest]",
  "adjust:{=mj}:a",
];

const { default: createModule } = await import(pathToFileURL(resolve(coreDir, `${stem}.js`)).href);
const mod = await createModule({
  noInitialRun: true,
  wasmBinary: readFileSync(resolve(coreDir, `${stem}.wasm`)),
  print: () => {},
  printErr: () => {},
  preRun: [
    (m) => {
      m.ENV.NETHACKOPTIONS = OPTIONS;
      m.ENV.HACKDIR = "/";
      m.ENV.NETHACKDIR = "/";
      try {
        m.FS.mkdir("/save");
      } catch {
        // already there
      }
    },
  ],
});
mod.FS.writeFile("/sysconf", "WIZARDS=*\nEXPLORERS=*\nCHECK_PLNAME=0\n");

let latest = null;
let lastPlaying = null;
let pendingAlias = null;
let idsBeforeWish = new Set();
const aliases = new Map();
let stepIndex = 0;
let pendingWish = null;
let saving = false;
let done = false;
const messages = [];
const problems = [];

function state() {
  return latest ? JSON.parse(latest) : { objects: [], floor: [] };
}
function find(list, text) {
  return list.find((object) => object.name.toLowerCase().includes(text.toLowerCase())) ?? null;
}
function byAlias(alias) {
  const id = aliases.get(alias);
  const inv = state();
  return [...inv.objects, ...inv.floor].find((object) => object.id === id) ?? null;
}
function resolveStep(step) {
  const inv = state();
  const look = (text, where) => {
    const object = text.startsWith("=") ? byAlias(text.slice(1)) : find(where, text);
    if (!object) problems.push(`no "${text}" for ${step}`);
    return object;
  };
  return step
    .replace(/\{([^}]+)\}/g, (_, text) => look(text, inv.objects)?.letter ?? "?")
    .replace(/\[([^\]]+)\]/g, (_, text) => String(look(text, [...inv.objects, ...inv.floor])?.id ?? 0));
}
/** The item a wish just gave: the one id that was not there before. */
function noteWishResult() {
  if (!pendingAlias) return;
  const fresh = state().objects.find((object) => !idsBeforeWish.has(object.id));
  if (fresh) aliases.set(pendingAlias, fresh.id);
  else problems.push(`the wish for "${pendingAlias}" gave nothing`);
  pendingAlias = null;
}

function finish(reason) {
  if (done) return;
  done = true;
  let files = [];
  try {
    files = mod.FS.readdir("/save").filter((file) => file !== "." && file !== "..");
  } catch {
    files = [];
  }
  const inv = lastPlaying ? JSON.parse(lastPlaying) : state();
  console.log(`end: ${reason}`);
  console.log(`steps run: ${stepIndex}/${steps.length}`);
  if (problems.length) console.log(`problems:\n  ${problems.join("\n  ")}`);
  if (process.env.DEBUG_MESSAGES) console.log(messages.join("\n"));
  console.log(`weight ${inv.weight}/${inv.capacity}, encumbrance ${inv.encumbrance}`);
  for (const object of inv.objects) {
    console.log(`  ${object.letter}${object.worn ? " [worn]" : ""} ${object.name}${object.base ? ` <${object.base}>` : ""}`);
  }
  for (const object of inv.floor) console.log(`  (here) ${object.name}`);
  if (files.length === 0) {
    console.log("no save file was written");
    console.log(messages.slice(-30).join("\n"));
    process.exit(1);
  }
  const archive = {
    format: "nh3d-save",
    version: 1,
    runtimeVersion: "5.0",
    compatTag: "wasm-5-forked",
    dbName: "/save-wasm-5-forked",
    name: files[0].replace(/^\d+/, ""),
    category: "manual",
    displayName: NAME,
    playMode: "debug",
    // the app resumes with these: the shell expects the number pad, as in its own new games
    initOptions: ["number_pad:1"],
    files: files.map((file) => ({
      key: `/save/${file}`,
      timestamp: new Date().toISOString(),
      contents: Buffer.from(mod.FS.readFile(`/save/${file}`)).toString("base64"),
    })),
  };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(archive));
  console.log(`wrote ${outFile} (${files.join(", ")})`);
  process.exit(0);
}

globalThis.nethackGlobal = globalThis.nethackGlobal ?? {};
globalThis.nethackCallback = async (name, ...args) => {
  switch (name) {
    case "shim_inventory":
      latest = args[0];
      return 0;
    case "shim_putstr":
      if (typeof args[2] === "string") messages.push(args[2]);
      return 0;
    case "shim_raw_print":
    case "shim_raw_print_bold":
      if (typeof args[0] === "string") messages.push(args[0]);
      return 0;
    case "shim_create_nhwindow":
      return 1;
    case "shim_yn_function": {
      const question = String(args[0] ?? "");
      messages.push(`? ${question}`);
      if (applyLetter && /apply/i.test(question)) {
        const letter = applyLetter;
        applyLetter = null;
        return letter.charCodeAt(0);
      }
      if (/Really save|Continue|Overwrite/i.test(question)) return "y".charCodeAt(0);
      return typeof args[2] === "number" && args[2] > 0 ? args[2] : "n".charCodeAt(0);
    }
    case "shim_getlin": {
      const text = pendingWish ?? "\u001b";
      pendingWish = null;
      mod.stringToUTF8(text, args[1], 256);
      return 0;
    }
    case "shim_nhgetch":
      return 27;
    case "shim_nh_poskey": {
      await new Promise((resolveKey) => setImmediate(resolveKey));
      noteWishResult();
      if (stepIndex < steps.length) {
        const step = steps[stepIndex++];
        if (step.startsWith("wish:")) {
          const [text, alias] = step.slice(5).split("=");
          pendingWish = text;
          pendingAlias = alias ?? null;
          idsBeforeWish = new Set(state().objects.map((object) => object.id));
          messages.push(`> wish ${pendingWish}`);
          return 23; // ^W
        }
        if (step.startsWith("apply:")) {
          // apply needs the item answered: use the context selection the
          // shell would, through the command queue key
          const letter = resolveStep(step.slice(6));
          messages.push(`> apply ${letter}`);
          applyLetter = letter;
          return "a".charCodeAt(0);
        }
        const request = resolveStep(step);
        messages.push(`> ${request}`);
        globalThis.nethackGlobal.nh3dInventoryRequest = request;
        return 0x89;
      }
      if (!saving) {
        saving = true;
        lastPlaying = latest;
        return "S".charCodeAt(0);
      }
      return 27;
    }
    case "shim_get_ext_cmd":
      return -1;
    case "shim_getmsghistory":
    case "shim_get_color_string":
      return "";
    case "shim_player_selection_cb":
      return true;
    case "shim_select_menu":
      return 0;
    case "shim_exit_nhwindows":
      finish("the game saved and exited");
      return 0;
    default:
      return 0;
  }
};
let applyLetter = null;

mod.cwrap("shim_graphics_set_callback", null, ["string"])("nethackCallback");
setTimeout(() => finish("timed out"), 120000);
const program = mod._malloc(16);
mod.stringToUTF8("nethack", program, 16);
const argv = mod._malloc(8);
mod.setValue(argv, program, "i32");
mod.setValue(argv + 4, 0, "i32");
mod._main(1, argv);
