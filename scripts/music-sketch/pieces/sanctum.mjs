// Moloch's Sanctum sketch. The temple at the bottom of Gehennom, where the
// high priest keeps the Amulet on Moloch's altar. A liturgy to a god who never
// answers. Bb Phrygian, one more fifth down the chain after Gehennom's Eb, in a
// slow 6/4 (3+3):
//   - a low cantor intones the call, and the congregation (choir and organ)
//     sings the answer back;
//   - then the god's silence: everything stops but the organ pedal and the fire,
//     with one bell toll on E, the tritone;
//   - the rite is sung again, heavier, with organum and low brass;
//   - the offering: a heartbeat that quickens, a pizzicato 3+3 ostinato, the
//     call upside down in the trombones, and the answer in full choir, left
//     hanging on its flat second (Cb) over the Bb pedal.
//
//   1-2    threshold: organ pedal, gong, fire
//   3-6    rite: cantor call (3-4), congregation answer (5-6)
//   7      silence, bell
//   8-11   rite again, heavier
//   12     silence, bell
//   13-18  the offering
//   19-20  threshold again, to loop

import { descent, realize } from "../motifs.mjs";
import { tie } from "../helpers.mjs";

const BEATS_PER_BAR = 6;
const BARS = 20;
const TOTAL_BEATS = BARS * BEATS_PER_BAR;
const TONIC = 46; // Bb2
const SILENT_BARS = new Set([6, 11]);
const GONG = 52; // General MIDI Chinese cymbal, the nearest to a tam-tam
const KICK = 36;
const EMBER = 42;

/** Small deterministic PRNG so the sketch renders the same every time. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inBars = (bar, from, to) => bar >= from && bar < to;

/** A motif stretched into 6/4: each two-bar motif fills two bars here. */
const sung = (motif, startBar, tonic, options = {}) =>
  realize(motif, { tonic, startBar, beatsPerBar: BEATS_PER_BAR, augment: 1.5, ...options });

function buildTracks() {
  const organ = [];
  const cantor = [];
  const choir = [];
  const brass = [];
  const pizz = [];
  const bell = [];
  const timp = [];
  const drums = [];

  for (let bar = 0; bar < BARS; bar++) {
    const start = bar * BEATS_PER_BAR;

    // Organ pedal: Bb1 and F2 throughout; the offering adds the flat second.
    organ.push({ start, dur: BEATS_PER_BAR, pitch: TONIC - 12, vel: 64 });
    organ.push({ start, dur: BEATS_PER_BAR, pitch: TONIC - 5, vel: 56 });
    if (inBars(bar, 12, 18)) organ.push({ start, dur: BEATS_PER_BAR, pitch: TONIC + 1, vel: 50 });

    if (SILENT_BARS.has(bar)) {
      bell.push({ start, dur: BEATS_PER_BAR, pitch: TONIC + 18, vel: 78 }); // E4
      continue;
    }

    // Heartbeat: two beats a bar from the first answer, quickening in the offering.
    if (inBars(bar, 4, 18)) {
      const every = bar >= 15 ? 1.5 : 3;
      for (let beat = 0; beat < BEATS_PER_BAR; beat += every) {
        drums.push({ start: start + beat, dur: 0.25, pitch: KICK, vel: 92 });
        drums.push({ start: start + beat + 0.35, dur: 0.25, pitch: KICK, vel: 64 });
      }
    }

    // Pizzicato in the offering: the ostinato's first six notes, 3+3.
    if (inBars(bar, 12, 18)) {
      const cell = descent.ostinato[0].slice(0, 6);
      for (const half of [0, 3]) {
        pizz.push(...realize([cell], { tonic: TONIC - 12, startBar: 0, vel: 70, legato: 0.4 }).map((n) => ({ ...n, start: n.start + start + half })));
      }
    }
  }

  // Gong at each threshold and before the offering.
  for (const bar of [0, 12, 18]) drums.push({ start: bar * BEATS_PER_BAR, dur: 4, pitch: GONG, vel: bar === 12 ? 100 : 84 });
  timp.push({ start: 0, dur: 3, pitch: TONIC, vel: 80 }, { start: 18 * BEATS_PER_BAR, dur: 3, pitch: TONIC, vel: 80 });

  // Rite: the cantor's call, then the congregation's answer.
  cantor.push(...sung(descent.call, 2, TONIC, { vel: 74 }));
  choir.push(...sung(descent.answer, 4, TONIC, { vel: 70, octaves: [12] }));

  // Rite again: the call with the choir's organum a fifth below, the answer
  // doubled by the low brass, timpani on the downbeats.
  cantor.push(...sung(descent.call, 7, TONIC, { vel: 80 }));
  choir.push(...sung(descent.call, 7, TONIC - 7, { vel: 56 }));
  choir.push(...sung(descent.answer, 9, TONIC, { vel: 80, octaves: [12, -7] }));
  brass.push(...sung(descent.answer, 9, TONIC - 12, { vel: 72 }));
  for (const bar of [9, 10]) timp.push({ start: bar * BEATS_PER_BAR, dur: 2, pitch: TONIC, vel: 86 });

  // The offering: a held Bb-Cb-F chord, the call upside down in the trombones,
  // then the answer in full choir, ending on its flat second.
  for (let bar = 12; bar < 16; bar++) {
    for (const pitch of [TONIC, TONIC + 1, TONIC + 7]) choir.push({ start: bar * BEATS_PER_BAR, dur: BEATS_PER_BAR, pitch, vel: 52 });
  }
  brass.push(...sung(descent.call, 12, TONIC - 12, { vel: 76, invert: true, octaves: [12] }));
  brass.push(...sung(descent.call, 14, TONIC - 12, { vel: 84, invert: true, octaves: [12] }));
  choir.push(...sung(descent.answer, 16, TONIC, { vel: 90, octaves: [12, -12] }));
  for (let beat = 16 * BEATS_PER_BAR; beat < 18 * BEATS_PER_BAR; beat += 0.5) {
    timp.push({ start: beat, dur: 0.4, pitch: TONIC, vel: 60 + Math.round(((beat - 16 * BEATS_PER_BAR) / 12) * 34) });
  }

  // Fire: sparse crackle throughout, thicker in the offering.
  const fire = random(29);
  for (let beat = 0.25; beat < TOTAL_BEATS - 0.5; beat += 0.25) {
    const bar = Math.floor(beat / BEATS_PER_BAR);
    if (fire() < (inBars(bar, 12, 18) ? 0.3 : 0.15)) drums.push({ start: beat, dur: 0.1, pitch: EMBER, vel: 10 + Math.round(fire() * 18) });
  }

  return [
    { name: "Cantor", voice: "horn", channel: 0, program: 70, notes: cantor, previewGainDb: 2 },
    { name: "Choir", voice: "strings", channel: 1, program: 52, notes: tie(choir), previewGainDb: 4 },
    { name: "Organ", voice: "strings", channel: 2, program: 19, notes: tie(organ), previewGainDb: -2 },
    { name: "Trombones", voice: "horn", channel: 3, program: 57, notes: brass, previewGainDb: -4 },
    { name: "Pizzicato", voice: "harp", channel: 4, program: 45, notes: pizz },
    { name: "Bell", voice: "metal", channel: 5, program: 14, notes: bell, previewGainDb: 4 },
    { name: "Timpani", voice: "timpani", channel: 6, program: 47, notes: timp },
    { name: "Gong, Heartbeat and Fire", voice: "drums", channel: 9, program: 0, notes: drums },
  ];
}

export const piece = {
  id: "sanctum",
  name: "Polypiled Moloch's Sanctum (sketch)",
  bpm: 50,
  beatsPerBar: BEATS_PER_BAR,
  bars: BARS,
  sections: [
    { name: "Threshold", bars: [1, 2] },
    { name: "Rite", bars: [3, 6] },
    { name: "Silence", bars: [7, 7] },
    { name: "Rite again", bars: [8, 11] },
    { name: "Silence", bars: [12, 12] },
    { name: "Offering", bars: [13, 18] },
    { name: "Threshold", bars: [19, 20] },
  ],
  key: "Bb Phrygian, 6/4",
  tracks: buildTracks(),
  suno: {
    // Suno rejects artist names, so the style is described instead.
    style:
      "dark ritual liturgy, the temple of a cruel mute god, ominous, ceremonial, sacred dread, instrumental, " +
      "Bb phrygian, 6/4 time, 50 bpm, deep wordless male choir chant, call and response, low solo cantor, " +
      "pipe organ pedal, temple gong, bronze bell, slow heartbeat drum, low trombones, pizzicato, crackling fire, " +
      "sudden silences, restrained dynamics, dark fantasy video game soundtrack, no lyrics, loopable",
    notes: [
      "Upload the preview WAV and use Cover so Suno keeps the call and response and the two silences.",
      "Turn on Instrumental (the choir is wordless). Moloch's Sanctum, the last room of Gehennom: a liturgy to a god who never answers.",
      "Leitmotif: the cantor sings the title theme's call (Bb Bb Db Cb Bb | Ab Gb F Bb), the choir sings the answer back.",
      "Bars 7 and 12 are the god's silence: only the organ pedal, the fire and one bell toll.",
      "The offering (13-18) ends on Cb over Bb, unresolved; the piece loops back to the threshold.",
    ],
  },
};
