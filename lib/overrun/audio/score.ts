/**
 * The composition, as data. No WebAudio, no side effects — this is the part
 * with musical decisions in it, so it is the part worth testing.
 *
 * Everything is expressed in semitones above a key reference of A2 (110 Hz),
 * which puts the five pitched voices in sensible registers: bass around
 * 87–165 Hz, chords and arp 175–392 Hz, the counter 220–330 Hz, melody
 * 349–880 Hz (the floor is the hook's F4 restatement, not A4).
 *
 * Form: 4/4 on a 16th-note grid. Sixteen bars — an eight-bar phrase and an
 * eight-bar answer — over Am–F–C–G, two bars per chord.
 *
 * ## What makes the melody catchy, and why the last two attempts weren't
 *
 * v3 had one rhythm and four different contours — nothing to recognise. v4
 * over-corrected: one two-bar cell stated four times, opening with the same
 * shape twice back-to-back, bars 10–11 a byte-identical repeat of bars 2–3,
 * and 12 of 16 bars drawn from two rhythms. Hugo's verdict: "a little boring,
 * duplicate melodies". Both fail the same way — recognition needs a RETURN,
 * and a return needs real distance from the statement. So v5 is a form, not a
 * cell schedule:
 *
 *  - `HOOK` (two bars) opens the loop, and is immediately answered by a
 *    DIFFERENT phrase over F — dialogue, not repetition.
 *  - Six bars go somewhere else (the answer, an opening-out line over C, a
 *    turnaround with real air) before the hook returns at bar 8 (0-indexed,
 *    like every bar number in this file) — and then confirms itself ONCE,
 *    sequenced a third down onto F by scale degree, the oldest
 *    intensification device there is.
 *  - The climax is its own rhythm and owns the loop's highest note; the
 *    cadence (v4's one unambiguous win) still resolves V–i.
 *  - Three hook statements, five sections that share no rhythm with anything:
 *    the hook's rhythm now covers 6 of 16 bars, not 12.
 *  - Still syncopated (56% of onsets off the quarter grid), still resting
 *    (66% coverage, four silences ≥ 6 steps) — `ARP` covers the gaps.
 */

export const STEPS_PER_BAR = 16;
export const BARS_PER_PHRASE = 8;
export const LOOP_BARS = 16;
export const LOOP_STEPS = STEPS_PER_BAR * LOOP_BARS;

/** Scale degrees of A natural minor, as pitch classes. */
export const SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

/**
 * Scale degree → semitones above the key reference. Degree 0 is A2, 7 is A3,
 * 14 is A4. Working in degrees rather than semitones means every transposition
 * lands in the key automatically — there is no way to write an accidental.
 */
export function degree(d: number): number {
  const octave = Math.floor(d / 7);
  const step = ((d % 7) + 7) % 7;
  return octave * 12 + SCALE[step]!;
}

export type Voice = "bass" | "chord" | "lead" | "arp" | "counter" | "hat" | "kick" | "snare";

export interface NoteEvent {
  voice: Voice;
  /** Semitones above the key reference. Ignored for hat and kick. */
  semi: number;
  /** Duration in 16th steps. */
  len: number;
  /** 0..1 relative loudness within the voice. Accents make a line breathe. */
  velocity: number;
}

interface Chord {
  /** Bass root, in the bass octave. */
  root: number;
  /** Triad voicing, in the chord octave. */
  voicing: readonly [number, number, number];
}

/**
 * Two bars each. Bass roots stay inside a fifth of each other so the line
 * walks rather than leaps.
 *
 * ## Seventh voicings, not plain triads
 *
 * Am–F–C–G is the most-used progression in pop, and played as four close
 * triads it announces that. The skeleton is worth keeping — the melody is
 * written against it — but the *colour* is where the warmth lives, so these
 * are shell voicings with the seventh in them rather than root-position
 * triads. Three notes each, because that is what the pad plays:
 *
 *   Am7    G3 C4 E4   m7, m3, 5th    — no root; the bass supplies it
 *   Fmaj7  F3 A3 E4   root, M3, M7   — the major 7th is the wistful interval
 *   Cmaj7  G3 B3 E4   5th, M7, M3    — no root either
 *   G      G3 B3 D4   plain triad    — one clean chord to resolve onto
 *
 * E4 is held across the first three, and G3 across three of four, so the pad
 * barely moves while the bass reharmonises underneath it. That stillness is
 * the point: the chords change colour without the voices jumping about.
 *
 * ## The register ceiling — 20, not 24
 *
 * A pad sitting in the tune's own register muddies it, which is why C was
 * already voiced off its root before this change. The ceiling is the melody's
 * LOWEST note, and that is not A4: the hook's restatement over F reaches down
 * to F4 (20). My first attempt at Am7 put G4 (22) on top and broke it — caught
 * by the test, which derives the bound from MELODY rather than trusting a
 * comment.
 */
export const PROGRESSION: readonly Chord[] = [
  { root: 0, voicing: [10, 15, 19] }, // Am7   — A2 / G3 C4 E4
  { root: -4, voicing: [8, 12, 19] }, // Fmaj7 — F2 / F3 A3 E4
  { root: 3, voicing: [10, 14, 19] }, // Cmaj7 — C3 / G3 B3 E4
  { root: -2, voicing: [10, 14, 17] }, // G    — G2 / G3 B3 D4
];

/**
 * The cadence chord: E7 (shell — G#3 B3 D4 over E2), replacing the final G
 * block of each loop. This is the harmonic half of the V–i cadence the melody
 * lands with its leading tone; natural minor has no dominant, and the absence
 * of any dominant anywhere is why the old loop circled without ever arriving.
 * G#3 is a raw semitone — `degree()` cannot express it, deliberately.
 */
export const CADENCE: Chord = { root: -5, voicing: [11, 14, 17] };

/** `[step, semitone, lengthSteps, velocity]`, absolute within the 16-bar loop. */
export type MelodyNote = readonly [number, number, number, number];

/** A cell, before it is placed: `[stepOffset, degreeOffset, len, velocity]`. */
type Cell = ReadonlyArray<readonly [number, number, number, number]>;

/**
 * **The hook, v5.** Two bars, eight notes, and one rhythmic signature: the
 * da-da-da-DUM push (16th pickups at 0/3/6 driving into beat 3) that lands
 * exactly ON the snare's backbeat — the kit and the tune agree about where
 * the weight is, which neither previous version did. Then the bar turns
 * inward: a one-16th grace pickup, the NINTH leaning on the barline (the one
 * non-chord tone, resolved immediately), a held root, and a lift back to the
 * fifth that leaves the cell asking a question — which is what makes both the
 * answer phrase and the hook's own return feel wanted.
 *
 * Stated three times per loop — bar 0 (Am), bar 8 (Am — the return, six bars
 * away), bar 10 (sequenced a third down onto F by scale degree, where the
 * same offsets pick up B-natural as a passing Fmaj7(#11) colour for free).
 * The one ADJACENT restatement, 8→10, changes pitch level; that sequence is
 * the difference from v4's flat same-shape-twice opening.
 */
const HOOK: Cell = [
  [0, 2, 2, 0.8], // the third…
  [3, 4, 3, 0.95], // …pushed to the fifth, off the beat…
  [6, 3, 2, 0.7], // …passing back down…
  [8, 2, 4, 1.0], // …lands WITH the snare, beat 3
  [14, 0, 1, 0.65], // grace pickup to the root, a breath before the bar
  [16, 1, 2, 0.75], // the ninth, leaning on the barline
  [18, 0, 5, 0.9], // resolves home, held off the beat
  [26, 4, 3, 0.8], // lifts to the fifth — the question mark
];

/** Place a cell at an absolute step, rooted on a scale degree. */
function place(cell: Cell, at: number, root: number): MelodyNote[] {
  return cell.map(([step, deg, len, vel]) => [at + step, degree(root + deg), len, vel] as const);
}

/**
 * Phrase A, bars 1–8: the hook states, and everything after it goes somewhere
 * else — that distance is what v4 lacked (it restated the hook immediately on
 * F, which is the "same thing twice in a row" Hugo heard as duplication).
 *
 *   bars 0–1  HOOK over Am
 *   bars 2–3  the ANSWER over F: its own longer-breathed rhythm, opening on
 *             D5 (the warm 13th) and sighing through the lydian B-natural
 *   bars 4–5  an opening-out line over C, climbing to a glanced F5
 *   bars 6–7  a three-note turnaround over G and then REAL AIR — twelve
 *             silent steps that make the hook's return land like a return
 */
const PHRASE_A: readonly MelodyNote[] = [
  ...place(HOOK, 0, 14), // Am — the statement
  // F — the answer
  [32, degree(17), 6, 0.85], // D5, the 13th over F, held
  [39, degree(16), 2, 0.7], // C5, syncopated
  [41, degree(15), 3, 0.75], // B4 — the lydian #11, leaning
  [44, degree(16), 4, 0.9], // C5
  [50, degree(14), 5, 0.8], // A4 — the third of F; the phrase exhales
  // C — the line opens out
  [64, degree(16), 3, 0.8],
  [67, degree(17), 3, 0.85], // syncopated climb
  [70, degree(18), 6, 0.95], // E5, pushed and held across the beat
  [78, degree(19), 2, 0.8], // F5, glanced — phrase A's high point
  [80, degree(18), 4, 0.9],
  [84, degree(16), 4, 0.8],
  // G — turnaround, then twelve steps of silence before the hook returns
  [96, degree(17), 2, 0.8],
  [98, degree(16), 2, 0.7], // syncopated
  [100, degree(15), 6, 0.85], // B4, the third of G, held
  [110, degree(14), 6, 0.9], // syncopated landing on the tonic
];

/**
 * The leading tone, as a raw semitone. G#4 does not exist in `degree()`'s
 * world — that is by design, the melody is diatonic by construction — but a
 * CADENCE is precisely the moment the rule is there to be broken. 23 semitones
 * above A2 = G#4, a half step under the tonic it resolves to.
 */
const LEADING_TONE = 23;

/**
 * Phrase B, bars 9–16: the return, the confirmation, the climax, the cadence.
 *
 *   bars 8–9   HOOK over Am again — the recognition, six bars after it left
 *   bars 10–11 HOOK sequenced onto F — same shape a third down, the one
 *              immediate restatement in the loop, and it is a SEQUENCE (a
 *              descent that intensifies), not the flat copy v4 opened with
 *   bars 12–13 the climax: a scale-run up to A5 (its own rhythm — v4's two
 *              free sections shared one), then a long fall
 *   bars 14–15 E7 — the cadence, from v4: same pitch path (E5 down to B4,
 *              catch on the leading tone, resolve onto the tonic as the loop
 *              turns over) over the same chord, with the rhythm reshaped to
 *              sit in this melody's language
 */
const PHRASE_B: readonly MelodyNote[] = [
  ...place(HOOK, 128, 14), // Am — the return
  ...place(HOOK, 160, 12), // F — sequenced a third down; B-natural = #11
  // C — the climax
  [192, degree(18), 2, 0.85], // E5
  [194, degree(19), 2, 0.85], // F5, syncopated climb
  [196, degree(20), 3, 0.9], // G5
  [199, degree(21), 5, 1.0], // A5 — the peak, pushed a 16th early
  [206, degree(20), 2, 0.8], // G5, off the beat
  [208, degree(18), 5, 0.9], // E5, the long fall begins
  [214, degree(16), 2, 0.8], // C5 — then air before the cadence
  // E7 — the cadence. Down the scale, catch on the leading tone, resolve.
  [224, degree(18), 3, 0.85], // E5 — the dominant's root, on the downbeat
  [228, degree(17), 2, 0.8], // D5, the seventh
  [230, degree(16), 3, 0.8], // C5, syncopated
  [234, degree(15), 2, 0.75], // B4
  [236, LEADING_TONE, 6, 0.9], // G#4 — the pull home, held against E7
  [244, degree(14), 9, 0.95], // A4, ringing toward the loop's turnover
];

export const MELODY: readonly MelodyNote[] = [...PHRASE_A, ...PHRASE_B];

/**
 * The counter-line (v6): a low voice answering the melody from the band
 * between the bass and the melody's F4 floor — semitones 12–19 (A3–E4).
 * The pad's voicings overlap that band (8–19), so the register is shared,
 * not empty: a counter tone may DOUBLE a sounding pad tone (thickening),
 * but must never sit a semitone from one — a sustained minor 2nd between
 * two dark voices in the same octave is a rub, not colour. The review that
 * caught two such rubs is why the adjacency contract in score.test.ts
 * checks every counter note against the sounding voicing.
 *
 * Three interlocking roles share the loop: the arp owns the melody's RESTS
 * (gated on melodySounding), the counter speaks under the melody's HELD
 * notes, and the tune keeps the top. Strictly diatonic — the one-accidental
 * license belongs to the MELODY's cadence and nothing else.
 *
 * Eleven notes a loop, by design a shadow rather than a second tune:
 *   bars 0–1 / 8–9  an answering rise (C4→D4) under the hook's held notes —
 *                   the same answer both times, so the dialogue is learnable
 *   bars 2–3        a 7–6 suspension over F: E4 held, exhaling onto D4
 *   bars 10–11      one low B3 under the sequenced hook — the lydian #11
 *                   colour the melody's own B4 leans on, an octave down
 *   bars 12–13      contrary motion: E4–D4–B3 stepping DOWN while the climax
 *                   runs up to A5 (B3, not C4 — the bar-13 echo-strike
 *                   restates the pad's B3 on that very step, and landing a
 *                   semitone above it was the first rub)
 *   bars 14–15      the cadence held from below: B3 — the dominant's fifth —
 *                   sustained across the whole cadence while the melody
 *                   catches the leading tone and resolves. The counter does
 *                   NOT resolve to A3: the pad's G#3 rings through bar 15,
 *                   and A3 against it was the second rub. Hanging on the
 *                   fifth leaves the arrival to the tune alone.
 */
export const COUNTER: readonly MelodyNote[] = [
  [10, degree(9), 3, 0.5], // C4 under the hook's held fifth
  [20, degree(10), 4, 0.55], // D4 under the held root — the rise that asks
  [32, degree(11), 6, 0.5], // E4 — the 7th over F, suspended
  [40, degree(10), 6, 0.55], // …resolving down onto the 13th
  [138, degree(9), 3, 0.5], // the hook returns; so does its answer
  [148, degree(10), 4, 0.55],
  [170, degree(8), 4, 0.5], // B3 under the F-sequence — #11, octave down
  [196, degree(11), 3, 0.55], // the climax: counter walks DOWN…
  [200, degree(10), 3, 0.6], // …against the run up to A5…
  [208, degree(8), 5, 0.55], // …and lands on the maj7, with the pad
  [236, degree(8), 16, 0.55], // B3 held through the cadence — the question
];

/** Counter indexed by step, same O(1) idiom as the melody. */
const COUNTER_BY_STEP = new Map<number, MelodyNote>();
for (const n of COUNTER) COUNTER_BY_STEP.set(n[0], n);

/** Melody indexed by step, so lookup is O(1) per step rather than a scan. */
const MELODY_BY_STEP = new Map<number, MelodyNote>();
for (const n of MELODY) MELODY_BY_STEP.set(n[0], n);

/** Every step on which a melody note is ringing, including held tails. */
const MELODY_SOUNDING = new Set<number>();
for (const [step, , len] of MELODY) {
  for (let i = 0; i < len; i++) MELODY_SOUNDING.add((step + i) % LOOP_STEPS);
}

/** Is the tune ringing here? Drives the arp, which plays in the gaps. */
export function melodySounding(step: number): boolean {
  return MELODY_SOUNDING.has(((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS);
}

/**
 * Bass figure, one bar. Three notes, long, with one octave lift late.
 *
 * This was six notes — root eighths with the octave on every off-beat — which
 * kept the low end moving but also meant the bar was never still. Over a
 * seventeen-minute session that constant pulse is most of what makes a loop
 * tiring, and it was fighting the pad's new sevenths for the same space.
 *
 * Longer notes, a real gap before the octave, and the octave arriving once
 * rather than three times. The line still walks; it just breathes between
 * steps.
 */
const BASS_FIGURE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 6, 1.0],
  [8, 0, 5, 0.85],
  [14, 12, 2, 0.6],
];

/**
 * Bar 2 of each chord block trades the octave lift for an APPROACH TONE — one
 * semitone below the next chord's root, leaning into it. This is what a bass
 * player actually does, and it is where most of the "human" in a rhythm
 * section lives: the line now KNOWS where it is going. Three of the four
 * approaches come out chromatic (E→F is diatonic; B→C diatonic; F#→G and
 * G#→A are not in the scale, and that is the point — the bass, like the
 * cadence, is allowed accidentals the melody is not).
 */
const BASS_FIGURE_LEADING: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 6, 1.0],
  [8, 0, 4, 0.8],
];

/**
 * Arp figure, one bar, as indices into the sounding chord's triad. Plucked
 * 16ths between the beats.
 *
 * It only sounds where the melody is *not* — see `MELODY_SOUNDING`. That is
 * the whole point of it: it fills the rests the melody now leaves, so the tune
 * can afford to stop without the mix emptying out, and it never doubles the
 * melody in unison (at pad+12 these share a register, and the F restatement of
 * the hook would otherwise flam against the arp's own F4).
 *
 * The pleasant side effect is that the texture inverts automatically: busy
 * melody, sparse arp; melody at rest, the arp runs. On a breather loop it
 * carries the whole bar.
 */
/*
 * Halved from running 16ths to running 8ths.
 *
 * At eight notes a bar this filled every gap the melody left, which defeated
 * the purpose of giving the melody rests in the first place: the mix never
 * actually opened up, it just changed who was playing. Four notes a bar leaves
 * real silence between them and lets the pad's sevenths ring.
 */
const ARP_FIGURE: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [5, 2],
  [9, 1],
  [13, 2],
];

/** Arp notes per bar, exported so the test cannot go stale if this changes. */
export const ARP_NOTES_PER_BAR = ARP_FIGURE.length;

/**
 * Per-note arp accents, parallel to ARP_FIGURE. An explicit table because the
 * previous "alternating" expression tested `at % 4 === 1` against at-values
 * that were ALL ≡ 1 (mod 4) — every note played 0.9 and the lilt was dead code.
 */
const ARP_ACCENTS = [0.9, 0.6, 0.75, 0.6] as const;

/** Off-beat eighths. */
const HAT_STEPS = [2, 6, 10, 14] as const;
/**
 * Half-time kit: kick on the one with a soft push before the snare, snare on
 * beat 3. The old pattern was kick-on-1-and-3 with off-beat hats and NO snare
 * at all — six identical events per bar with no backbeat, which is a metronome
 * wearing a hat. Half-time at 94–110 BPM is the lo-fi pocket this tempo lives
 * in, and one backbeat per bar gives the loop somewhere to lean.
 */
const KICK_STEPS = [0, 7] as const;
const SNARE_STEPS = [8] as const;

/** Which chord is sounding at a given step. */
export function chordAt(step: number): Chord {
  const bar =
    ((Math.floor(step / STEPS_PER_BAR) % LOOP_BARS) + LOOP_BARS) % LOOP_BARS;
  // Bars 14–15 — the LAST two-bar block of every loop — carry the cadence
  // rather than the second G. The first half's G (bars 6–7) stays plain, so
  // the loop's midpoint keeps moving and only its END pulls home.
  if (bar >= 14) return CADENCE;
  return PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length]!;
}

export interface ScoreOptions {
  /** Drop the melody — used for the periodic breather loop. */
  lead: boolean;
}

/**
 * Everything that starts on this step. `step` may be any integer; it wraps
 * over the loop.
 */
export function notesAt(step: number, opts: ScoreOptions = { lead: true }): NoteEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const inBar = s % STEPS_PER_BAR;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const chord = chordAt(s);
  const out: NoteEvent[] = [];

  // Bass: bar 1 of each block states the root (with the octave lift); bar 2
  // walks — its last note is an approach tone leaning into the NEXT chord.
  if (bar % 2 === 0) {
    for (const [at, offset, len, vel] of BASS_FIGURE) {
      if (at === inBar) out.push({ voice: "bass", semi: chord.root + offset, len, velocity: vel });
    }
  } else {
    for (const [at, offset, len, vel] of BASS_FIGURE_LEADING) {
      if (at === inBar) out.push({ voice: "bass", semi: chord.root + offset, len, velocity: vel });
    }
    if (inBar === 13) {
      const next = chordAt(s + STEPS_PER_BAR); // wraps to Am at the loop's end
      out.push({ voice: "bass", semi: next.root - 1, len: 3, velocity: 0.7 });
    }
  }

  // Chords: struck on the block downbeat as before, and RE-struck softly at
  // the block's second bar. One attack per two bars was zero harmonic rhythm —
  // eight strikes per 40-second loop; the echo-strike makes the pad breathe
  // with the bass instead of lying across it.
  if (inBar === 0) {
    const echo = bar % 2 === 1;
    for (const semi of chord.voicing) {
      out.push({
        voice: "chord",
        semi,
        len: STEPS_PER_BAR * (echo ? 1 : 2),
        velocity: echo ? 0.55 : 1,
      });
    }
  }

  if (opts.lead) {
    const note = MELODY_BY_STEP.get(s);
    if (note) out.push({ voice: "lead", semi: note[1], len: note[2], velocity: note[3] });
    // The counter speaks only when the melody does — a breather loop stays
    // thin, and a dialogue needs both voices present to be one.
    const c = COUNTER_BY_STEP.get(s);
    if (c) out.push({ voice: "counter", semi: c[1], len: c[2], velocity: c[3] });
  }

  // Only in the melody's gaps. On a breather loop there is no melody, so the
  // arp plays the full figure and carries the bar on its own.
  if (!opts.lead || !MELODY_SOUNDING.has(s)) {
    for (const [at, tone] of ARP_FIGURE) {
      if (at === inBar) {
        // An octave up from the pad, so it glints above the chord rather than
        // thickening it. Accents on an explicit table: the old expression
        // (`at % 4 === 1`) was true for every arp step, so the promised lilt
        // never actually varied — a live bug the audit caught.
        out.push({
          voice: "arp",
          semi: chord.voicing[tone]! + 12,
          len: 2,
          velocity: ARP_ACCENTS[ARP_FIGURE.findIndex(([a]) => a === at)]!,
        });
      }
    }
  }

  if (HAT_STEPS.includes(inBar as (typeof HAT_STEPS)[number])) {
    out.push({ voice: "hat", semi: 0, len: 1, velocity: inBar === 6 || inBar === 14 ? 1 : 0.6 });
  }
  if (KICK_STEPS.includes(inBar as (typeof KICK_STEPS)[number])) {
    out.push({ voice: "kick", semi: 0, len: 2, velocity: inBar === 0 ? 1 : 0.7 });
  }
  if (SNARE_STEPS.includes(inBar as (typeof SNARE_STEPS)[number])) {
    out.push({ voice: "snare", semi: 0, len: 2, velocity: 0.9 });
  }

  return out;
}

/* ------------------------------------------------------------------ voices */

/**
 * Voice parameters, shared by the WebAudio player and the offline WAV
 * renderer. They used to be duplicated literals in both files, which meant the
 * preview could drift from the game — and a preview that isn't the game is
 * worse than no preview, because it is trusted.
 */
export interface VoiceParams {
  /** Seconds. */
  attack: number;
  /** Seconds. */
  release: number;
  peak: number;
  /**
   * Lowpass corner as a multiple of the note's own fundamental. Relative
   * rather than absolute so high notes don't turn shrill: a fixed 2600 Hz
   * corner sounds dull at A4 and passes A5's harmonics straight into the
   * 2–5 kHz band the ear fatigues on fastest.
   */
  cutoffMul: number;
  /** Absolute ceiling on that corner, so nothing gets brittle up top. */
  cutoffMax: number;
  /** Hold most of the note, then release — as opposed to plucking and decaying. */
  sustain: boolean;
}

/*
 * Softer across the board than the previous pass, which was tuned to make the
 * melody cut. It cut; it also arrived like a mallet every time.
 *
 * The pad now swells rather than lands (attack 0.12 → 0.4) and rings twice as
 * long, so the sevenths above actually get heard as chords rather than as
 * stabs. The lead's attack roughly doubles and its release nearly doubles,
 * which is the difference between a pluck and a breath — at 0.025 s the onset
 * was a transient click on every note, sixteen bars a loop, forever.
 *
 * The arp gets the biggest release lift relative to its length: at four notes
 * a bar it is now decoration rather than a pulse, and it should bloom.
 */
export const VOICES: Readonly<
  Record<"bass" | "chord" | "lead" | "arp" | "counter", VoiceParams>
> = {
  bass: { attack: 0.012, release: 0.3, peak: 0.55, cutoffMul: 6, cutoffMax: 780, sustain: true },
  chord: { attack: 0.4, release: 1.1, peak: 0.24, cutoffMul: 5, cutoffMax: 1400, sustain: true },
  lead: { attack: 0.045, release: 0.5, peak: 0.3, cutoffMul: 3.0, cutoffMax: 3000, sustain: true },
  arp: { attack: 0.01, release: 0.42, peak: 0.15, cutoffMul: 4, cutoffMax: 2400, sustain: false },
  // Between the pad and the lead in character: swells (a counter that
  // attacks reads as a second lead, which is the one thing it must not be),
  // darker than the tune above it, rings shorter than the pad under it.
  counter: { attack: 0.15, release: 0.6, peak: 0.3, cutoffMul: 4, cutoffMax: 1100, sustain: true },
};

/**
 * How much the lead's filter opens at the start of a note, as a multiple of
 * the steady-state corner, and how fast it closes. A filter that moves is the
 * clearest difference between a synth note and a beep.
 */
export const LEAD_SWEEP = { open: 1.9, decayS: 0.34 } as const;

export type Layer = "bass" | "chord" | "arp" | "lead" | "counter" | "perc";

/**
 * Layer gains, shared with the offline renderer for the same reason the
 * envelopes are.
 *
 * The lead sits at the top because the melody is the thing that has to be
 * memorable. That needed a deliberate lift: replacing the buzzsaw lead with a
 * filtered triangle stack removed most of its harmonic energy, so measured
 * A-weighted at the old gain it landed ~4 dB *under* the bass and disappeared
 * into the bed. A cleaner waveform is quieter for free — easy to mistake for
 * having fixed the tone when you have really just hidden the tune.
 */
export const MIX: Readonly<Record<Layer, number>> = {
  bass: 0.5,
  // Lifted: the pad is carrying the harmonic colour now, so it has to be
  // audible as harmony rather than sitting under everything as a wash.
  chord: 0.3,
  arp: 0.26,
  // Lifted with it, and for the reason in the block above. Softening the lead
  // (less edge, lower cutoff, gentler filter sweep) and raising the pad each
  // pushed the melody further under: measured, this pass went from -6.9 dB to
  // -8.0 dB against the backing before this correction. Exactly the trap that
  // caught the last round — a cleaner tone is quieter for free, and it is easy
  // to mistake having buried the tune for having fixed it.
  lead: 0.98,
  // A shadow under the tune: audible as an answer, never competing with it.
  counter: 0.2,
  perc: 0.42,
};

/**
 * Layer gains at a given heat (0..1 — how contested the board is). Intensity
 * adds drive and lifts the pad; it never touches the melody, because a tune
 * that fades out when the game is calm is a tune nobody hears.
 */
export function mixAt(heat: number): Record<Layer, number> {
  const h = Math.max(0, Math.min(1, heat));
  return {
    bass: MIX.bass,
    chord: MIX.chord + 0.11 * smoothstep(0.3, 0.9, h),
    arp: MIX.arp,
    lead: MIX.lead,
    // Heat-invariant like the lead: the dialogue is composition, not drive.
    counter: MIX.counter,
    // Pushed later and steeper. A kit under a calm board is the single thing
    // most at odds with the texture this is going for; percussion should read
    // as the game getting dangerous, not as the default state.
    perc: MIX.perc * smoothstep(0.45, 0.9, h),
  };
}

/** Hermite smoothstep, for layer cross-fades. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Above this frequency the lead is attenuated, `TILT_DB_PER_OCTAVE` per octave.
 * Without it the top of the melody jumps out of the mix — equal amplitude does
 * not mean equal loudness, and the ear's sensitivity peaks right where A5's
 * harmonics land.
 */
export const TILT_FROM_HZ = 440;
export const TILT_DB_PER_OCTAVE = -3.5;

/** Linear gain multiplier for the pitch tilt above. */
export function tiltGain(freq: number): number {
  if (freq <= TILT_FROM_HZ) return 1;
  const octaves = Math.log2(freq / TILT_FROM_HZ);
  return Math.pow(10, (TILT_DB_PER_OCTAVE * octaves) / 20);
}

/** Delay time as a fraction of a bar: a dotted eighth, i.e. three 16ths. */
export const DELAY_STEPS = 3;

/* ------------------------------------------------------------ stereo stage */

/**
 * Constant-power pan positions, −1..1. This is DATA, not engine, for the same
 * reason the envelopes and swing are: two engines render this score, and a pan
 * living only in music.ts would make the preview a different record.
 *
 * The placement rule is mono-first: bass, kick, snare and lead are dead centre
 * because a phone speaker IS the platform's median output and the tune plus
 * its anchor must lose nothing when the image collapses. Width comes from the
 * decorations — hat and arp opposed either side, the pad's existing ±5-cent
 * detune pair split left/right (mono fold of that pair sums to exactly the
 * old beating pair — pure panning, never Haas delays, so the fold cannot
 * comb-filter).
 */
export const PAN = {
  bass: 0,
  kick: 0,
  snare: 0,
  lead: 0,
  hat: -0.25,
  arp: 0.3,
  /** Opposite the arp, under the lead — the dialogue sits across the image. */
  counter: -0.2,
  /** The pad's −5c body goes to −spread, the +5c body to +spread. */
  chordSpread: 0.4,
} as const;

/**
 * Equal-power gains [left, right] for a pan position — the exact law
 * StereoPannerNode implements for a mono input, exported so the offline
 * mixdown computes channel gains identical to the live panners.
 */
export function panGains(p: number): [number, number] {
  const t = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4;
  return [Math.cos(t), Math.sin(t)];
}

/**
 * Kick-keyed duck on the sustained bed (chord + arp dry paths): the glue that
 * makes the kick own the bar. Deterministic data rather than a compressor
 * sidechain so both engines apply the identical envelope — the live engine
 * schedules it on each EMITTED kick (Glacier's drumless kit never pumps) and
 * scales depth with the perc layer's current mix so an inaudible cold kick
 * doesn't duck the bed against silence. Reverb sends tap PRE-duck: the tails
 * breathing against the ducked dry signal is what makes the room audible.
 */
export const DUCK = {
  depth: 0.35,
  attackS: 0.02,
  holdS: 0.04,
  releaseS: 0.22,
} as const;

/**
 * Gentle glue on the music bus (upstream of `master`, so the mute ramp is
 * untouched). Deliberately mild — WebAudio's DynamicsCompressorNode curve
 * is UA-defined, and the offline mirror is a soft-knee approximation; at
 * ≤ ~2 dB of gain reduction the two are indistinguishable, at aggressive
 * settings they would not be. The destination compressor in audio.ts
 * (−18 dB, 4:1) remains the overload guard for music+SFX summed.
 */
export const BUS_COMP = {
  // −21, not −24: at −24 the unity-centre mix drove ~3.3 dB of reduction,
  // past the band where the offline soft-knee stays honest about the
  // UA-defined node. The printed max-GR line is the guard.
  thresholdDb: -21,
  kneeDb: 12,
  ratio: 2,
  attackS: 0.03,
  releaseS: 0.25,
} as const;

/* --------------------------------------------------------------- per-biome */

/**
 * The lead instrument. Two detuned bodies plus a quieter edge oscillator —
 * biome identity lives in the *blend*, not in swapping which raw waveform
 * beeps at you. A bare square through a static filter is a Game Boy; this is
 * the same note played by something built.
 */
export interface LeadVoice {
  /** Carries the fundamental. Doubled and detuned against itself. */
  body: OscillatorType;
  /** Mixed underneath for harmonic bite. */
  edge: OscillatorType;
  /** How much edge, 0..1. Seasoning, not the dish. */
  edgeMix: number;
  /** Unison detune, cents, applied ± to the two bodies. */
  detune: number;
  /** Multiplies the filter-envelope opening — how bright this biome is. */
  bright: number;
}

export interface MusicMood {
  /** Transposition in semitones from A minor. */
  transpose: number;
  /** Beats per minute. */
  bpm: number;
  lead: LeadVoice;
  /**
   * Arrangement identity — the honest way to make biomes differ. Key, tempo
   * and lead-blend alone left them as "same tune, a bit faster": now Glacier
   * plays with no kit at all and half again the reverb, Ember hits harder,
   * Void Grid's arp glints an octave higher.
   */
  drums: "full" | "soft" | "none";
  /** Extra octave on the arp (semitones — 0 or 12). */
  arpLift: number;
  /** Multiplies the reverb send. */
  reverbMul: number;
}

/**
 * One identity per biome, indexed like BIOMES. The tune is the same underneath
 * — recognisable across a session, composed once — but key, tempo and the lead
 * blend move so the biomes still feel distinct.
 */
export const MOODS: readonly MusicMood[] = [
  // Deep Field — calm, almost a flute. Soft kit, roomy.
  { transpose: 0, bpm: 94, lead: { body: "triangle", edge: "sine", edgeMix: 0.06, detune: 8, bright: 0.75 },
    drums: "soft", arpLift: 0, reverbMul: 1.2 },
  // Nebula — the opener. Warm, a little breath of saw for shine.
  { transpose: 3, bpm: 98, lead: { body: "triangle", edge: "sine", edgeMix: 0.12, detune: 11, bright: 0.85 },
    drums: "full", arpLift: 0, reverbMul: 1.0 },
  // Ember Wastes — driving, the most edge of the five.
  { transpose: -2, bpm: 106, lead: { body: "triangle", edge: "sawtooth", edgeMix: 0.2, detune: 12, bright: 1.0 },
    drums: "full", arpLift: 0, reverbMul: 0.8 },
  // Glacier — spacious: NO kit, ever, and half again the reverb. The one biome
  // that is pure texture, which is a bigger difference than any tempo change.
  { transpose: 5, bpm: 90, lead: { body: "triangle", edge: "sine", edgeMix: 0.08, detune: 16, bright: 0.7 },
    drums: "none", arpLift: 0, reverbMul: 1.5 },
  // Void Grid — urgent; square edge, arp glinting an octave up.
  { transpose: 7, bpm: 110, lead: { body: "triangle", edge: "square", edgeMix: 0.13, detune: 9, bright: 0.95 },
    drums: "full", arpLift: 12, reverbMul: 0.9 },
];

/** Key reference: A2. Every `semi` in this module is relative to it. */
export const KEY_HZ = 110;

export const hz = (semi: number, transpose = 0): number =>
  KEY_HZ * Math.pow(2, (semi + transpose) / 12);

/* ----------------------------------------------------- performance layer */

/**
 * Swing: odd 16ths land late by this fraction of a step (~15–19 ms at these
 * tempos). Subtle on purpose — at 0.12 it is a lean, not a shuffle. Exported
 * as a pure step→offset function because there are TWO schedulers (music.ts
 * live, render-preview offline) and swing applied in only one would make the
 * preview a different piece of music than the game.
 */
export const SWING = 0.12;
export function stepTimeOffset(step: number): number {
  return (((step % 2) + 2) % 2) === 1 ? SWING : 0;
}

/**
 * Deterministic "human" — a hash, not Math.random, so the same note in the
 * same loop pass always leans the same way and the offline preview renders
 * byte-identically. Returns −1..1. Key it on (absolute step, voice ordinal,
 * note index) so simultaneous notes de-correlate.
 */
export function hum(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 2147483648 - 1;
}

/**
 * Humanization depths, shared by both engines. Velocity wobbles ±7%; pitched
 * voices drift ±5 ms and drums only ±2 ms (a loose kit reads as sloppy long
 * before a loose pad does); the pad's three notes STRUM 14 ms apart instead of
 * firing on the same sample — no human plays a chord as one event.
 */
export const HUMANIZE = {
  velocity: 0.07,
  timingS: 0.005,
  drumTimingS: 0.002,
  strumS: 0.014,
} as const;

/**
 * Reverb, procedural: white noise under an exponential decay. It is the only
 * space the mix has — every voice used to be bone dry, which is a large part
 * of "cheap-sounding notes" (a note with no room around it reads as a beep,
 * whatever the waveform). Sends are per-voice: the pad lives furthest away,
 * the bass stays dry so the low end keeps its shape.
 */
export const REVERB = {
  seconds: 1.8,
  wet: 0.85,
  send: { chord: 0.3, arp: 0.35, lead: 0.22, counter: 0.25 } as Readonly<Record<string, number>>,
} as const;

/**
 * The four-loop arrangement cycle. `notesAt` stays pure — these are the
 * ARRANGEMENT decisions layered on top by both engines, exactly like the old
 * breather (which survives as cycle position 3):
 *   0 full · 1 the arp sits out phrase A · 2 the lead gains a quiet octave
 *   double · 3 breather (no melody; the arp carries the whole loop).
 */
export type LoopVariant = "full" | "thinArp" | "octaveLead" | "breather";
export function loopVariant(loop: number): LoopVariant {
  const v = ((loop % 4) + 4) % 4;
  return v === 1 ? "thinArp" : v === 2 ? "octaveLead" : v === 3 ? "breather" : "full";
}
