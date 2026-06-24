/**
 * Speed-zone lookup for a tapped point. The regulation gives zones as prose +
 * a reference point, so we approximate: report the nearest known zone within a
 * radius of its reference point. Returns null when no known zone is close —
 * which means "no zone in our (partial) data here", NOT "no speed limit."
 */

import { haversineMeters } from "../geo";
import { SPEED_ZONES, type SpeedZone } from "./speed-zones";

export function nearestZone(
  lng: number,
  lat: number,
  maxMeters = 1200,
): { zone: SpeedZone; distanceM: number } | null {
  let best: SpeedZone | null = null;
  let bestD = maxMeters;
  for (const z of SPEED_ZONES) {
    const d = haversineMeters(lng, lat, z.lng, z.lat);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best ? { zone: best, distanceM: bestD } : null;
}
