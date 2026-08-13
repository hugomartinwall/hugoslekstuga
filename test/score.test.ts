import { describe, expect, it } from "vitest";
import {
  BARS_PER_PHRASE,
  BUS_COMP,
  CADENCE,
  chordAt,
  COUNTER,
  degree,
  DUCK,
  hz,
  KEY_HZ,
  LOOP_BARS,
  LOOP_STEPS,
  MELODY,
  MIX,
  mixAt,
  MOODS,
  notesAt,
  PAN,
  panGains,
  PROGRESSION,
  REVERB,
  SCALE,
  STEPS_PER_BAR,
  tiltGain,
  VOICES,
} from "../lib/overrun/audio/score";

const pitchClass = (semi: number) => ((semi % 12) + 12) % 12;
const byStep = [...MELODY].sort((a, b) => a[0] - b[0]);

describe("the melody is actually music", () => {
  it("stays in A natural minor — except the leading tone at the cadence", () => {
    /**
     * v4 deliberately loosened this from "no accidentals ever". Natural minor
     * cannot cadence — there is no dominant without a raised seventh — and a
     * loop that can never say "we've arrived" is a loop that only circles.
     * Exactly ONE accidental is licensed: G# (pitch class 11), and only in the
     * final cadence bar, resolving to the tonic. Anything else is still a bug.
     */
    const LEADING_PC = 11;
    const strays = MELODY.filter(([, semi]) => !SCALE.includes(pitchClass(semi) as never));
    for (const [step, semi] of strays) {
      expect(pitchClass(semi), `stray at step ${step}`).toBe(LEADING_PC);
      expect(step, "the leading tone belongs to the cadence bar").toBeGreaterThanOrEqual(
        LOOP_STEPS - 2 * 16,
      );
    }
    expect(strays.length, "one licensed accidental, not a chromatic habit").toBe(1);
    // And it resolves: the next melody note after G# is the tonic.
    const gSharp = strays[0]!;
    const after = MELODY.filter(([s]) => s > gSharp[0]).sort((a, b) => a[0] - b[0])[0]!;
    expect(after[1] % 12, "G# must resolve to A").toBe(0);
  });

  it("sits in a singing register, not a sub-bass rumble", () => {
    // The original drone put its roots at 43–65 Hz, which is why it read as
    // menace rather than melody. This line spans F4 (349 Hz) to A5 (880 Hz).
    for (const [, semi] of MELODY) {
      const f = hz(semi);
      expect(f, `${semi} semis = ${f.toFixed(0)} Hz`).toBeGreaterThanOrEqual(330); // E4
      expect(f, `${semi} semis = ${f.toFixed(0)} Hz`).toBeLessThanOrEqual(1200);
    }
    const span = Math.max(...MELODY.map((n) => n[1])) - Math.min(...MELODY.map((n) => n[1]));
    // Wide enough to have a shape, narrow enough to stay singable.
    expect(span).toBeGreaterThanOrEqual(10);
    expect(span).toBeLessThanOrEqual(24);
  });

  it("is an arch: it climbs, peaks in the second phrase, and lands on the tonic", () => {
    const phraseA = MELODY.filter(([step]) => step < LOOP_STEPS / 2);
    const phraseB = MELODY.filter(([step]) => step >= LOOP_STEPS / 2);
    const top = (ns: typeof MELODY) => Math.max(...ns.map(([, s]) => s));

    // The answer goes higher than the question — that is what makes it an answer.
    expect(top(phraseB)).toBeGreaterThan(top(phraseA));
    // Both phrases resolve home, so the loop turns over instead of just cutting.
    for (const phrase of [phraseA, phraseB]) {
      const last = phrase[phrase.length - 1]!;
      expect(pitchClass(last[1])).toBe(0); // A
    }
    // The final note is held, not clipped.
    expect(MELODY[MELODY.length - 1]![2]).toBeGreaterThanOrEqual(8);
  });

  it("never overlaps itself — one melodic line, not a chord", () => {
    for (let i = 1; i < byStep.length; i++) {
      const [prevStep, , prevLen] = byStep[i - 1]!;
      expect(byStep[i]![0], `note at ${byStep[i]![0]}`).toBeGreaterThanOrEqual(prevStep + prevLen);
    }
  });

  it("fits inside the loop", () => {
    for (const [step, , len] of MELODY) {
      expect(step + len).toBeLessThanOrEqual(LOOP_STEPS);
    }
    expect(LOOP_BARS).toBe(BARS_PER_PHRASE * 2);
  });

  it("gives every note a usable velocity", () => {
    for (const [step, , , vel] of MELODY) {
      expect(vel, `note at ${step}`).toBeGreaterThan(0.3);
      expect(vel, `note at ${step}`).toBeLessThanOrEqual(1);
    }
  });
});

/**
 * These four are the ones Hugo's feedback bought. The first attempt was in key,
 * in register and arch-shaped — every assertion above passed — and it still
 * came out as an unmemorable march, because none of those properties is what
 * makes a tune catchy. Each threshold below is set where it fails the melody
 * that prompted the complaint; the measured old value is quoted so nobody
 * later relaxes one to make a red test green.
 */
describe("the melody is catchy, not just correct", () => {
  it("repeats a hook — the same shape, in the same rhythm, three times", () => {
    // Catchiness is recognition. The old line had one rhythm and four different
    // pitch contours, so there was nothing to recognise; this asserts the
    // opposite arrangement. Contours are compared in *scale degrees* rather
    // than semitones, because a diatonic sequence is the same shape even when
    // a major third becomes a minor one.
    const semiToDegree = new Map<number, number>();
    for (let d = 0; d < 40; d++) semiToDegree.set(degree(d), d);

    const shape = (from: number, span: number): string | null => {
      const ns = byStep.filter(([s]) => s >= from && s < from + span);
      // A window with under two notes has no contour to recognise. Returning
      // a key for it made SILENCE count as the most-repeated cell: with the
      // hook deleted outright, three empty windows shared the key "" and this
      // test still passed. Degenerate windows are simply not cells.
      if (ns.length < 2) return null;
      const degs = ns.map(([, semi]) => semiToDegree.get(semi)!);
      const rhythm = ns.map(([s, , len]) => `${s - from}:${len}`);
      const contour = degs.slice(1).map((d, i) => d - degs[i]!);
      return `${rhythm.join(" ")} | ${contour.join(",")}`;
    };

    const cells = new Map<string, number>();
    const rhythms = new Map<string, number>();
    for (let at = 0; at < LOOP_STEPS; at += STEPS_PER_BAR * 2) {
      const k = shape(at, STEPS_PER_BAR * 2);
      if (k === null) continue;
      cells.set(k, (cells.get(k) ?? 0) + 1);
      const r = k.split(" | ")[0]!;
      rhythms.set(r, (rhythms.get(r) ?? 0) + 1);
    }
    /**
     * v5: the exact hook (shape AND rhythm, transposition-invariant under the
     * degree-contour key) appears three times — bars 0, 8, and 10 — and
     * NOTHING else in the loop shares a rhythm with anything. The rhythm
     * threshold therefore comes down from 4 to 3, deliberately: v4 satisfied
     * ≥4 by having four statements plus rhythm-clones covering 12 of 16 bars,
     * and that saturation is precisely what Hugo reported as "duplicate
     * melodies". Three statements is the floor for recognition (statement,
     * return, confirmation); more same-rhythm bars than that is now regression
     * toward the complaint, not extra catchiness.
     */
    const mostRepeated = Math.max(...cells.values());
    expect(mostRepeated, [...cells.keys()].join("\n")).toBeGreaterThanOrEqual(3);
    const mostRhythm = Math.max(...rhythms.values());
    expect(mostRhythm, "the hook's rhythm carries its three statements").toBeGreaterThanOrEqual(3);
    // And the saturation ceiling, so the complaint cannot quietly return: the
    // most-shared rhythm may cover at most 3 of the 8 two-bar windows.
    expect(mostRhythm, "one rhythm must not blanket the loop again").toBeLessThanOrEqual(3);
  });

  it("is syncopated rather than marching on the quarter notes", () => {
    const off = MELODY.filter(([step]) => step % 4 !== 0).length;
    const ratio = off / MELODY.length;
    // Old melody: 17% (8 of 47, and four of those were the same position in a
    // repeated cell). A line that only ever starts notes on the beat plods.
    expect(ratio, `${off}/${MELODY.length}`).toBeGreaterThanOrEqual(0.3);
  });

  it("leaves real silence for the arp to fill", () => {
    const sounding = MELODY.reduce((sum, [, , len]) => sum + len, 0);
    // Old melody: 84.4% coverage — a legato wall with no gaps, looping forever.
    // The assertion it passed was `< 0.85`, i.e. 0.6pp above the value it was
    // guarding, which is no assertion at all. Under gameplay for 17 minutes,
    // continuous is the same thing as nagging.
    expect(sounding / LOOP_STEPS).toBeLessThan(0.7);
    expect(sounding / LOOP_STEPS).toBeGreaterThan(0.45);

    // Coverage alone can hide as many small gaps; the tune also needs to stop
    // outright, more than once, for long enough to notice.
    let long = 0;
    for (let i = 1; i < byStep.length; i++) {
      const prev = byStep[i - 1]!;
      if (byStep[i]![0] - (prev[0] + prev[2]) >= 6) long++;
    }
    const last = byStep[byStep.length - 1]!;
    if (LOOP_STEPS - (last[0] + last[2]) >= 6) long++;
    expect(long, "silences of at least 6 steps").toBeGreaterThanOrEqual(3);
  });

  it("varies its note lengths instead of running in one value", () => {
    const lens = new Map<number, number>();
    for (const [, , len] of MELODY) lens.set(len, (lens.get(len) ?? 0) + 1);
    const dominant = Math.max(...lens.values()) / MELODY.length;
    // Old melody: 45% of notes were the same length (21 of 47 quarter notes).
    expect(dominant, [...lens].map(([l, n]) => `${l}×${n}`).join(" ")).toBeLessThan(0.4);
  });
});

describe("harmony", () => {
  it("gives every chord two bars, filling the loop exactly", () => {
    expect(PROGRESSION.length * 2).toBe(LOOP_BARS / 2);
    // ...so the progression runs twice: once under each phrase.
    expect(PROGRESSION.length * 2 * 2).toBe(LOOP_BARS);
  });

  it("walks the bass rather than leaping between chords", () => {
    for (let i = 0; i < PROGRESSION.length; i++) {
      const a = PROGRESSION[i]!.root;
      const b = PROGRESSION[(i + 1) % PROGRESSION.length]!.root;
      expect(Math.abs(a - b), `${a} → ${b}`).toBeLessThanOrEqual(7);
    }
  });

  it("voices every triad inside one octave", () => {
    for (const { voicing } of PROGRESSION) {
      expect(Math.max(...voicing) - Math.min(...voicing)).toBeLessThanOrEqual(12);
    }
  });

  it("keeps bass and chords out of the melody's register", () => {
    const melodyFloor = Math.min(...MELODY.map((n) => n[1]));
    for (const { root, voicing } of PROGRESSION) {
      expect(hz(root)).toBeLessThan(200);
      for (const v of voicing) expect(v).toBeLessThan(melodyFloor);
    }
  });

  it("changes chord every two bars, and the last block is the dominant", () => {
    const seen = new Set<number>();
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      seen.add(chordAt(bar * STEPS_PER_BAR).root);
    }
    // Five roots now: the four of the progression plus E7 in the final block —
    // the cadence the loop never used to have. The first-half G (bars 6–7)
    // must survive as plain G, so the midpoint keeps moving.
    expect(seen.size).toBe(PROGRESSION.length + 1);
    expect(chordAt(14 * STEPS_PER_BAR)).toEqual(CADENCE);
    expect(chordAt(15 * STEPS_PER_BAR)).toEqual(CADENCE);
    // Pin the dominant's CONTENT, not just its position: chordAt returns the
    // CADENCE object by reference, so the two lines above only say where it
    // sits. E below the tonic = -5 semitones from A2 — the V of the V–i.
    expect(CADENCE.root).toBe(-5);
    expect(chordAt(6 * STEPS_PER_BAR).root, "bars 6-7 stay plain G").toBe(-2);
    // The cadence voicing carries the raised seventh (G#3 = pitch class 11) —
    // the harmonic half of the V–i the melody's leading tone lands.
    expect(CADENCE.voicing.some((s) => ((s % 12) + 12) % 12 === 11)).toBe(true);
  });
});

describe("scale degrees", () => {
  it("maps octaves and wraps negatives without leaving the key", () => {
    expect(degree(0)).toBe(0); // A2
    expect(degree(7)).toBe(12); // A3
    expect(degree(14)).toBe(24); // A4
    expect(degree(21)).toBe(36); // A5
    for (let d = -14; d < 40; d++) {
      expect(SCALE.includes(pitchClass(degree(d)) as never), `degree ${d}`).toBe(true);
    }
  });

  it("is monotonic, so a positive transposition always goes up", () => {
    for (let d = -7; d < 30; d++) expect(degree(d + 1)).toBeGreaterThan(degree(d));
  });
});

describe("notesAt", () => {
  it("wraps cleanly over the loop and is stable", () => {
    for (const step of [0, 1, 37, 128, LOOP_STEPS - 1]) {
      const a = notesAt(step);
      expect(notesAt(step + LOOP_STEPS)).toEqual(a);
      expect(notesAt(step)).toEqual(a); // pure
    }
  });

  it("handles negative steps without producing garbage", () => {
    expect(notesAt(-1)).toEqual(notesAt(LOOP_STEPS - 1));
  });

  it("keeps a pulse going in every bar", () => {
    for (let bar = 0; bar < LOOP_BARS; bar++) {
      const base = bar * STEPS_PER_BAR;
      const voices = new Set<string>();
      for (let i = 0; i < STEPS_PER_BAR; i++) {
        for (const n of notesAt(base + i)) voices.add(n.voice);
      }
      for (const v of ["bass", "kick", "hat"]) {
        expect(voices.has(v), `bar ${bar} is missing ${v}`).toBe(true);
      }
    }
  });

  it("inverts the texture: the arp runs where the melody rests", () => {
    const arpPerBar = (bar: number, lead: boolean) => {
      let n = 0;
      for (let i = 0; i < STEPS_PER_BAR; i++) {
        n += notesAt(bar * STEPS_PER_BAR + i, { lead }).filter((x) => x.voice === "arp").length;
      }
      return n;
    };
    const withMelody = Array.from({ length: LOOP_BARS }, (_, b) => arpPerBar(b, true));

    /*
     * Most bars carry an arp note. This was >= 14 before the arp was halved
     * from 16ths to 8ths; 13 is now the intended arrangement, so the THRESHOLD
     * moved with the intent — the assertion did not.
     *
     * I first replaced this with "no bar is silent across all voices",
     * claiming it was the stronger property it stood for. It was not: HAT_STEPS
     * and KICK_STEPS are inBar-indexed constants that fire six notes in every
     * bar unconditionally, so that version passed with the arp, bass, pad AND
     * melody all deleted. It asserted the existence of the drum grid.
     *
     * 12 rather than 13 so one bar of arrangement drift is not a failure —
     * but far enough from zero that removing or gutting the arp goes red,
     * which is the only thing worth catching here.
     */
    const barsWithArp = withMelody.filter((n) => n > 0).length;
    expect(barsWithArp, withMelody.join(",")).toBeGreaterThanOrEqual(12);

    // Hook bars are the busiest melodically, so they must be the sparsest
    // arp bars. This is the property that keeps the two from fighting.
    // v5 has three hook statements (bars 0, 8, 10); the resting bars are the
    // answer's exhale (3), the pre-return air (7) and the post-climax fall (13).
    const hookBars = [0, 8, 10]; // first bar of each hook statement
    const restBars = [3, 7, 13];
    const worstHook = Math.max(...hookBars.map((b) => withMelody[b]!));
    const bestRest = Math.min(...restBars.map((b) => withMelody[b]!));
    expect(worstHook, withMelody.join(",")).toBeLessThan(bestRest);

    /*
     * With no melody at all the arp carries the loop, every bar.
     *
     * A literal, deliberately. I briefly "improved" this to
     * toBe(ARP_NOTES_PER_BAR) with a comment claiming it stopped a future
     * halving passing silently — it does the exact opposite. Since
     * ARP_NOTES_PER_BAR is ARP_FIGURE.length, that asserts a loop over
     * ARP_FIGURE emits ARP_FIGURE.length notes, which is true for any figure.
     * The literal is the only thing here with signal.
     */
    for (let b = 0; b < LOOP_BARS; b++) {
      expect(arpPerBar(b, false), `breather bar ${b}`).toBe(4);
    }
  });

  it("drops only the melody on a breather loop", () => {
    let withLead = 0;
    let withoutLead = 0;
    for (let s = 0; s < LOOP_STEPS; s++) {
      withLead += notesAt(s, { lead: true }).filter((n) => n.voice === "lead").length;
      const quiet = notesAt(s, { lead: false });
      withoutLead += quiet.filter((n) => n.voice === "lead").length;
      // The backing must keep playing, or the breather is just a silence.
      if (s % STEPS_PER_BAR === 0) {
        expect(quiet.some((n) => n.voice === "bass")).toBe(true);
      }
    }
    expect(withLead).toBe(MELODY.length);
    expect(withoutLead).toBe(0);
  });

  it("keeps the arp above the pad and below the melody", () => {
    const melodyFloor = Math.min(...MELODY.map((n) => n[1]));
    const padCeiling = Math.max(...PROGRESSION.flatMap((c) => [...c.voicing]));
    for (let s = 0; s < LOOP_STEPS; s++) {
      for (const n of notesAt(s)) {
        if (n.voice !== "arp") continue;
        expect(n.semi, `arp at ${s}`).toBeGreaterThan(padCeiling);
        expect(n.semi, `arp at ${s}`).toBeLessThan(melodyFloor + 12);
      }
    }
  });

  it("emits no zero- or negative-length notes", () => {
    for (let s = 0; s < LOOP_STEPS; s++) {
      for (const n of notesAt(s)) expect(n.len, `step ${s} ${n.voice}`).toBeGreaterThan(0);
    }
  });
});

describe("voice parameters", () => {
  it("keys every filter to the note rather than to a fixed corner", () => {
    // The fixed 2600 Hz lowpass was why high notes turned shrill: it sounded
    // dull at A4 and passed A5's harmonics into the band the ear fatigues on.
    for (const [name, p] of Object.entries(VOICES)) {
      expect(p.cutoffMul, name).toBeGreaterThan(1); // above the fundamental
      expect(p.cutoffMax, name).toBeGreaterThan(0);
      expect(p.attack, name).toBeGreaterThan(0);
      expect(p.release, name).toBeGreaterThan(0);
    }
  });

  it("tilts the lead down as it climbs, and never boosts", () => {
    expect(tiltGain(220)).toBe(1);
    expect(tiltGain(440)).toBe(1);
    // An octave above the hinge is a real, audible trim — not a rounding error.
    expect(tiltGain(880)).toBeLessThan(0.72);
    expect(tiltGain(880)).toBeGreaterThan(0.6);
    expect(tiltGain(1760)).toBeLessThan(tiltGain(880));
  });
});

describe("the mix", () => {
  it("puts the melody on top, where a hook has to be", () => {
    // Not a matter of taste: measured A-weighted, the rebuilt lead landed
    // ~4 dB *under* the bass at its old gain, because a filtered triangle
    // stack simply carries less energy than the buzzsaw it replaced. A tune
    // nobody can pick out of the bed is not a catchier tune.
    const m = mixAt(0.6);
    expect(m.lead).toBeGreaterThan(m.bass);
    expect(m.lead).toBeGreaterThan(m.chord);
    expect(m.lead).toBeGreaterThan(m.arp);
  });

  it("adds drive with heat but never touches the melody", () => {
    const cold = mixAt(0);
    const hot = mixAt(1);
    expect(hot.lead).toBe(cold.lead);
    expect(hot.bass).toBe(cold.bass);
    expect(hot.arp).toBe(cold.arp);
    // The counter is composition, not drive — heat-invariant like the lead.
    expect(hot.counter).toBe(cold.counter);
    expect(hot.perc).toBeGreaterThan(cold.perc);
    expect(hot.chord).toBeGreaterThan(cold.chord);
    // Percussion is what "intensity" means here; it must actually arrive.
    expect(cold.perc).toBe(0);
  });

  it("stays monotonic and in range across the whole heat sweep, including junk input", () => {
    let prevPerc = -1;
    for (let h = 0; h <= 1.0001; h += 0.05) {
      const m = mixAt(h);
      for (const [name, g] of Object.entries(m)) {
        expect(g, `${name} at heat ${h.toFixed(2)}`).toBeGreaterThanOrEqual(0);
        expect(g, `${name} at heat ${h.toFixed(2)}`).toBeLessThanOrEqual(1);
      }
      expect(m.perc).toBeGreaterThanOrEqual(prevPerc);
      prevPerc = m.perc;
    }
    expect(mixAt(-5)).toEqual(mixAt(0));
    expect(mixAt(99)).toEqual(mixAt(1));
    expect(mixAt(Number.NaN).lead).toBe(MIX.lead);
  });
});

describe("the counter-line", () => {
  // 20 (F4) today — the hook's F restatement is the melody's lowest reach.
  const melodyFloor = Math.min(...MELODY.map(([, semi]) => semi));

  it("lives in the register the other voices leave empty", () => {
    // Above the bass's reach, below the melody's floor — derived from the
    // MELODY data like the pad-ceiling test, not trusted to a comment.
    for (const [step, semi] of COUNTER) {
      expect(semi, `counter at step ${step}`).toBeGreaterThanOrEqual(12);
      expect(semi, `counter at step ${step}`).toBeLessThan(melodyFloor);
    }
  });

  it("is strictly diatonic — the accidental license belongs to the melody", () => {
    const pcs = new Set<number>(SCALE);
    for (const [step, semi] of COUNTER) {
      expect(pcs.has(((semi % 12) + 12) % 12), `counter at step ${step}`).toBe(true);
    }
  });

  it("stays a shadow: sparse, low coverage, never a second tune", () => {
    expect(COUNTER.length).toBeLessThanOrEqual(12);
    const sounding = new Set<number>();
    for (const [step, , len] of COUNTER) {
      for (let i = 0; i < len; i++) sounding.add((step + i) % LOOP_STEPS);
    }
    expect(sounding.size / LOOP_STEPS).toBeLessThanOrEqual(0.35);
  });

  it("never sits a semitone from a sounding pad tone — doubling is thickening, adjacency is a rub", () => {
    // The counter's band (12–19) is SHARED with the pad voicings (8–19), not
    // empty. Unison with a pad tone is fine; a sustained minor 2nd between
    // two dark voices in one octave is not. The review caught two: C4 against
    // the bar-13 echo-strike's B3, and A3 against the cadence pad's G#3.
    // Checked across every step the note rings, because pad tones sustain.
    for (const [step, semi, len] of COUNTER) {
      for (let i = 0; i < len; i++) {
        const chord = chordAt(step + i);
        for (const tone of chord.voicing) {
          expect(Math.abs(semi - tone), `counter ${semi} at step ${step + i} vs pad ${tone}`).not.toBe(1);
        }
      }
    }
  });

  it("falls silent with the melody on breather loops — a dialogue needs both voices", () => {
    for (let s = 0; s < LOOP_STEPS; s++) {
      for (const n of notesAt(s, { lead: false })) {
        expect(n.voice, `step ${s}`).not.toBe("counter");
      }
    }
    // And it genuinely speaks on lead loops — silence both ways is deletion.
    let heard = 0;
    for (let s = 0; s < LOOP_STEPS; s++) {
      for (const n of notesAt(s, { lead: true })) if (n.voice === "counter") heard++;
    }
    expect(heard).toBe(COUNTER.length);
  });
});

describe("the stereo stage", () => {
  it("keeps the tune and its anchor dead centre — the phone-speaker contract", () => {
    // A phone speaker is the platform's median output: everything that
    // matters must survive the fold to mono unchanged. Width is decoration.
    expect(PAN.bass).toBe(0);
    expect(PAN.kick).toBe(0);
    expect(PAN.snare).toBe(0);
    expect(PAN.lead).toBe(0);
  });

  it("keeps every width inside earbud comfort", () => {
    for (const [name, p] of Object.entries(PAN)) {
      expect(Math.abs(p), name).toBeLessThanOrEqual(0.5);
    }
  });

  it("panGains is the equal-power law, so mono fold loses nothing", () => {
    // Constant power: L² + R² = 1 everywhere, and the extremes are exact.
    for (let p = -1; p <= 1.0001; p += 0.125) {
      const [l, r] = panGains(p);
      expect(l * l + r * r).toBeCloseTo(1, 10);
    }
    expect(panGains(0)[0]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(panGains(0)[1]).toBeCloseTo(Math.SQRT1_2, 10);
    expect(panGains(-1)).toEqual([1, expect.closeTo(0, 10)]);
    expect(panGains(1)[0]).toBeCloseTo(0, 10);
    expect(panGains(1)[1]).toBeCloseTo(1, 10);
    // Junk clamps rather than exploding — same policy as mixAt.
    expect(panGains(-9)).toEqual(panGains(-1));
    expect(panGains(9)).toEqual(panGains(1));
  });

  it("the duck is a lean, not a pump, and always lets go", () => {
    expect(DUCK.depth).toBeGreaterThan(0);
    expect(DUCK.depth).toBeLessThanOrEqual(0.5);
    expect(DUCK.releaseS).toBeGreaterThan(DUCK.attackS);
    // Attack+hold must fit well inside the shortest kick spacing (7 steps at
    // 130 bpm ≈ 0.8 s) or consecutive kicks stack their ducks.
    expect(DUCK.attackS + DUCK.holdS).toBeLessThan(0.2);
  });

  it("every reverb-sending voice has a real send — a missing key is NaN into attach()", () => {
    // REVERB.send is typed as Record<string, number>, so tsc cannot catch a
    // deleted key — and music.ts would setValueAtTime(NaN), which THROWS
    // mid-graph-build and kills all audio. Found by the review's mutation
    // pass: deleting `counter` left all tests green.
    for (const name of ["chord", "arp", "lead", "counter"] as const) {
      const send = REVERB.send[name];
      expect(send, name).toBeGreaterThan(0);
      expect(send, name).toBeLessThanOrEqual(1);
    }
  });

  it("the bus compressor stays glue, not an effect", () => {
    // The offline mirror is a soft-knee approximation of a UA-defined curve;
    // only gentle settings keep the preview honest about the game.
    expect(BUS_COMP.ratio).toBeLessThanOrEqual(3);
    expect(BUS_COMP.thresholdDb).toBeLessThanOrEqual(-18);
    expect(BUS_COMP.kneeDb).toBeGreaterThanOrEqual(6);
    expect(BUS_COMP.attackS).toBeGreaterThanOrEqual(0.02); // transients pass
  });
});

describe("per-biome moods", () => {
  it("covers every biome and stays in a sane tempo band", () => {
    expect(MOODS).toHaveLength(5);
    for (const m of MOODS) {
      expect(m.bpm).toBeGreaterThanOrEqual(90);
      expect(m.bpm).toBeLessThanOrEqual(130);
    }
  });

  it("never makes a raw square or saw the body of the lead", () => {
    // This is the whole "it sounds cheap" fix, pinned. Biome identity is the
    // blend; a bare square carrying the fundamental is a Game Boy.
    for (const m of MOODS) {
      expect(["triangle", "sine"], `body ${m.lead.body}`).toContain(m.lead.body);
      expect(m.lead.edgeMix, "edge is seasoning, not the dish").toBeLessThanOrEqual(0.35);
      expect(m.lead.detune, "unison detune").toBeGreaterThan(0);
    }
  });

  it("transposes without wandering out of register", () => {
    const top = Math.max(...MELODY.map(([, s]) => s));
    const bottom = Math.min(...PROGRESSION.map((c) => c.root));
    for (const m of MOODS) {
      expect(hz(bottom, m.transpose)).toBeGreaterThan(60);
      expect(hz(top, m.transpose)).toBeLessThan(1600);
    }
  });

  it("preserves intervals under transposition", () => {
    expect(hz(12, 5) / hz(0, 5)).toBeCloseTo(2, 10);
    expect(hz(0)).toBeCloseTo(KEY_HZ, 10);
  });
});
