/**
 * What a tick sounds like: its SimEvents, and the State after it, turned
 * into cues for audio.ts. Every cue of §10's table is here, each with what
 * is seen beside it in render/:
 *
 *   launch          a rising blip pitched by power
 *   pop             one note; the pops of a launch climb a pentatonic scale
 *   cushion         a thud pitched by speed
 *   a plate fires   a bright tick, one timbre per charm
 *   landing         a soft thump
 *   a pip back      a small tick
 *   refused         a low "nope"
 *   a row announced a short rising figure
 *   a row lands     a soft patter
 *   a lost heart    a low buzz
 *   battery         a tick with each flash
 *   blast           a crack
 *   charm taken     a two-note chime (and the love heart taken)
 *   the hour        a clock chime
 *   the polisher    its two-bar loop (the app layer turns it on and off)
 *   morning         a bright figure
 *
 * and a few the table leaves silent, each quiet: a token the thump turned
 * (a small tick, quieter than the thump: For step 6, item 4), a hit on gum,
 * the bag or the plug, a knock, the pad's throw, the machine powering down,
 * and the lights coming on when 06:00 runs out.
 *
 * Pure: a test can feed it a night and read what it would play.
 */
import type { SimEvent, State, Tune } from "../sim/types";
import type { Cue } from "./audio";

export type Ears = {
  /** The cues of one tick, in order. `out` is emptied first and returned. */
  hear(events: readonly SimEvent[], s: State, tune: Tune, out: Cue[]): Cue[];
  /** A new night: forget what was heard. */
  reset(): void;
};

/** A battery flashes every 20 ticks at first and every 6 in its last 120 (§5.4): the tick each flash comes on. */
export function flashStarts(left: number): boolean {
  const period = left <= 120 ? 6 : 20;
  return Math.floor(left / period) % 2 === 1 && Math.floor((left + 1) / period) % 2 === 0;
}

export function createEars(): Ears {
  return {
    hear(events, s, tune, out) {
      out.length = 0;
      let arrived = 0;
      let announced = false;
      let flicked = false;
      for (const e of events) {
        switch (e.type) {
          case "launch":
            out.push({ k: "launch", power: e.power });
            break;
          case "refused":
            out.push({ k: "nope" });
            break;
          case "cushion":
            out.push({ k: "cushion", speed: e.speed / Math.max(1, tune.maxSpeed) });
            if (e.charm !== "") out.push({ k: "plate", charm: e.charm });
            break;
          case "pop":
            // A blast's pops are flat and outside his chain: the crack is their sound.
            if (e.source !== "blast") out.push({ k: "pop", n: e.n });
            break;
          case "land":
            out.push({ k: "land" });
            break;
          case "tokenTurned":
            if (!flicked) out.push({ k: "flick" });
            flicked = true;
            break;
          case "pip":
            // A plate's pip is heard in the plate's own tick.
            if (e.why !== "plate") out.push({ k: "pip" });
            break;
          case "row":
            if (e.n > 0 && !announced) out.push({ k: "announce" });
            announced = announced || e.n > 0;
            break;
          case "arrive":
            arrived++;
            break;
          case "hurt":
            out.push({ k: "hurt" });
            break;
          case "burst":
            out.push({ k: "blast" });
            break;
          case "knock":
            out.push({ k: "knock" });
            break;
          case "hit":
            out.push({ k: "hit", kind: e.kind });
            break;
          case "offerTaken":
          case "heartTaken":
            out.push({ k: "chime" });
            break;
          case "hour":
            out.push({ k: "hour" });
            break;
          case "bossThrow":
            if (!e.hurt) out.push({ k: "throw" });
            break;
          case "bossDown":
            out.push({ k: "down" });
            break;
          case "over":
            if (e.how === "morning") out.push({ k: "morning" });
            else if (e.how === "dawn") out.push({ k: "lights" });
            break;
          default:
            break;
        }
      }
      if (arrived > 0) out.push({ k: "patter", n: arrived });
      // The batteries: a tick as a flash comes on, one a tick however many flash together.
      if (s.phase === "night" || s.phase === "boss") {
        for (const d of s.things) {
          if (d.kind !== "battery" || d.hp <= 0 || s.tick < d.landTick || d.fuseTick < 0) continue;
          const left = d.fuseTick - s.tick;
          if (left > 0 && flashStarts(left)) {
            out.push({ k: "battery", late: left <= 120 });
            break;
          }
        }
      }
      return out;
    },
    reset() {
      // Nothing is carried from one night to the next.
    },
  };
}
