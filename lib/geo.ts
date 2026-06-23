/**
 * Small geodesic helpers shared by the sjökort routing engine (the offline
 * bake script and the in-browser Web Worker) and the route panel UI.
 *
 * Everything here is isomorphic — pure math, no DOM, no Node — so the same
 * file runs at bake time, in the worker, and on the main thread.
 */

const EARTH_RADIUS_M = 6371008.8; // IUGG mean Earth radius
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle distance between two lng/lat points, in metres. */
export function haversineMeters(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const dLat = (bLat - aLat) * D2R;
  const dLon = (bLon - aLon) * D2R;
  const la1 = aLat * D2R;
  const la2 = bLat * D2R;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from A to B, in degrees clockwise from north (0–360). */
export function bearingDeg(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const la1 = aLat * D2R;
  const la2 = bLat * D2R;
  const dLon = (bLon - aLon) * D2R;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** One of the eight compass points nearest a bearing — for plain-language cues. */
export function compassPoint(bearing: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((bearing % 360) / 45) % 8];
}

export const METERS_PER_NM = 1852;

export function metersToNm(m: number): number {
  return m / METERS_PER_NM;
}

/** "0.4 nm" / "12 nm" — a nautical distance read at a glance. */
export function formatNm(meters: number): string {
  const nm = metersToNm(meters);
  if (nm < 1) return `${nm.toFixed(2)} nm`;
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  return `${Math.round(nm)} nm`;
}

/** "35 min" / "2 h 10 min" — a rough trip time from minutes. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "<1 min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
