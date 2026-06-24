/**
 * Boating speed-limit zones (fartbegränsning) for the sjökort tool.
 *
 * Source: Länsstyrelsen i Stockholms läns sjötrafikföreskrifter (01FS 2001:138,
 * omtryck 01FS 2018:48) — public regulations. The bulk are parsed automatically
 * (see scripts/parse-speed-zones.ts → speed-zones.generated.ts): one marker per
 * zone at its first regulation reference point. Central Stockholm (regulation
 * zone 233) is a complex multi-area zone with no single point, so its key
 * sub-areas are placed by hand below.
 *
 * IMPORTANT: each marker is a POINT approximation of a prose-described area, not
 * the exact legal boundary. A tap reports the nearest zone within a radius;
 * absence of a zone does NOT mean "no limit." Always follow posted signage.
 */

import { GENERATED_ZONES } from "./speed-zones.generated";

export interface SpeedZone {
  /** Reference point (decimal degrees). */
  lng: number;
  lat: number;
  /** Posted limit in knots (for recreational craft where these differ). */
  knots: number;
  /** Area name from the regulation. */
  name: string;
  /** Conditions worth surfacing (seasonal, vessel-size, recreational vs ship). */
  note?: string;
}

/**
 * Central Stockholm — regulation zone 233. Limits shown are for recreational
 * craft (≤ 400 brutto): generally 7 knop in central Saltsjön/Mälaren, 5 knop
 * through the bridges and named canals. (Ships have separate limits, e.g. 10
 * knop in Strömmen — see the regulation.)
 */
const CENTRAL_ZONES: SpeedZone[] = [
  { lng: 18.018, lat: 59.337, knots: 5, name: "Karlbergskanalen" },
  { lng: 18.012, lat: 59.334, knots: 5, name: "Karlbergssjön" },
  { lng: 18.032, lat: 59.33, knots: 5, name: "Klara sjö & Barnhusviken" },
  { lng: 18.055, lat: 59.323, knots: 7, name: "Riddarfjärden", note: "5 knop vid broar" },
  { lng: 18.078, lat: 59.324, knots: 7, name: "Strömmen / inre Saltsjön", note: "skepp 10 knop" },
  { lng: 18.095, lat: 59.326, knots: 7, name: "Saltsjön (Stockholms hamn)" },
  { lng: 18.072, lat: 59.331, knots: 7, name: "Nybroviken" },
  { lng: 18.105, lat: 59.302, knots: 7, name: "Hammarbyleden", note: "styrfart genom slussen" },
  { lng: 18.03, lat: 59.317, knots: 5, name: "Pålsundet & Långholmskanalen" },
  { lng: 18.118, lat: 59.337, knots: 5, name: "Djurgårdsbrunnskanalen" },
];

export const SPEED_ZONES: SpeedZone[] = [...GENERATED_ZONES, ...CENTRAL_ZONES];

export const SPEED_ZONES_SOURCE =
  "Länsstyrelsen Stockholm 01FS 2001:138 (omtryck 2018:48)";
