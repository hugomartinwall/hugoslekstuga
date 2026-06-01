import type { StyleSpecification } from "maplibre-gl";

/**
 * MapLibre style for the sjökort tool. Hybrid raster stack:
 *
 *   - OSM standard tiles as the base (land, water, place names) —
 *     free, worldwide, no API key.
 *   - OpenSeaMap "seamark" overlay on top — fairways, buoys, beacons,
 *     depth contours where contributors have added them. Transparent
 *     PNG tiles that sit over the OSM base.
 *
 * Both are community tile servers with polite usage limits. Casual
 * pan/zoom stays well under them; if we ever get throttled the move
 * is a self-hosted tile proxy (documented in the plan).
 *
 * The `attribution` strings are required by both projects' licences.
 * MapLibre's built-in AttributionControl reads them off these sources
 * and renders the credit in the map corner automatically.
 */
export const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
    seamark: {
      type: "raster",
      tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenSeaMap",
      maxzoom: 18,
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "osm" },
    { id: "seamark", type: "raster", source: "seamark" },
  ],
};

/** Stockholm — Gamla stan-ish. Wide enough at zoom 11 to see the city
 *  plus the inner archipelago fanning out east. */
export const INITIAL_CENTER: [number, number] = [18.0686, 59.3293];
export const INITIAL_ZOOM = 11;
