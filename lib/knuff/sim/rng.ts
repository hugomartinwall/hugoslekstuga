/**
 * Random numbers: mulberry32, as in the feel toy and in Adventure.
 *
 * The generator's state lives inside the State, one u32 per stream, so a
 * copied or stored State replays the same way. There are three streams,
 * each seeded from the night's seed and its stream number, so that a
 * change to one system does not reshuffle the others:
 *
 *   arrivals   where things appear
 *   offers     which charms, which plates
 *   behaviour  what an intruder decides
 *
 * Nothing under sim/ or content/ may call the built-in random; the
 * architecture suite reads the sources for it.
 */

export type Streams = { arrivals: number; offers: number; behaviour: number };
export type StreamName = keyof Streams;

const STREAM_NUMBER: Record<StreamName, number> = { arrivals: 1, offers: 2, behaviour: 3 };

/** Mix a seed and a stream number into a first state. */
export function rngSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function seedStreams(seed: number): Streams {
  return {
    arrivals: rngSeed(seed, STREAM_NUMBER.arrivals),
    offers: rngSeed(seed, STREAM_NUMBER.offers),
    behaviour: rngSeed(seed, STREAM_NUMBER.behaviour),
  };
}

/** Advance one stream in place and return a float in [0, 1). */
export function rand(streams: Streams, name: StreamName): number {
  const next = (streams[name] + 0x6d2b79f5) >>> 0;
  streams[name] = next;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
