"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
// After the library's sheet: the zoom keys and the chart's focus line.
import "./chart.css";
import type {
  Map as MlMap,
  Marker as MlMarker,
  GeoJSONSource,
} from "maplibre-gl";
import PixelIcon from "@/components/PixelIcon";
import Keycap, { keycapClass } from "@/components/ui/Keycap";
import { STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "@/lib/sjokort/style";
import { boatIconSvg, type BoatKind } from "@/lib/sjokort/boat-icon";
import { SPEED_ZONES } from "@/lib/sjokort/speed-zones";

type MaplibreNs = typeof import("maplibre-gl");
type LngLat = [number, number];

/**
 * The keys that float on the chart (settings, zoom, locate) are raised
 * dark keycaps: they have to read on pale tiles and, when the tiles do
 * not load, on the room-dark page behind them.
 *
 * MapLibre builds the two zoom buttons itself, so they get the same
 * classes by hand once the control is added (chart.css does the rest).
 */
const ZOOM_KEY = keycapClass({ tone: "neutral", size: "icon" })
  .split(/\s+/)
  .filter(Boolean);

/**
 * An accent key on the chart (Plan a route, the locate key while it is
 * on) wears a room-dark frame: ice teal alone washes out on pale water
 * tiles. The frame is the kit's own ring, a little wider and recoloured;
 * `not-focus-visible` leaves the cyan focus ring in charge.
 */
export const ON_CHART_ACCENT =
  "not-focus-visible:[--ring-w:2px] not-focus-visible:[--ring-c:var(--color-cream)]";

/**
 * Map-anchored palette. Everything below draws ON the third-party
 * OSM/OpenSeaMap raster tiles, which are light — so these keep
 * dark-ink-on-light-chart semantics regardless of the site skin.
 * Do NOT swap them for the live brand tokens: the arcade ice teal
 * (#8af0ff) washes out against pale water tiles.
 */
const MAP_INK = "#1a1812"; // dark outline / route casing on light tiles
const MAP_PAPER = "#fbf6ee"; // light fill (pin core)
const MAP_TEAL = "#14b8a6"; // deep teal — route line + start pin
const MAP_CORAL = "#ef7d57"; // destination pin

/** Teardrop pin marker (start/end of a planned route). */
function pinSvg(fill: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 1C6.4 1 1 6.4 1 13c0 8.2 12 20 12 20s12-11.8 12-20C25 6.4 19.6 1 13 1z" fill="${fill}" stroke="${MAP_INK}" stroke-width="2"/><circle cx="13" cy="13" r="4.5" fill="${MAP_PAPER}"/></svg>`;
}

function updatePin(
  ml: MaplibreNs,
  map: MlMap,
  existing: MlMarker | null,
  coord: LngLat | null,
  fill: string,
): MlMarker | null {
  if (!coord) {
    existing?.remove();
    return null;
  }
  if (existing) return existing.setLngLat(coord);
  const el = document.createElement("div");
  el.innerHTML = pinSvg(fill);
  return new ml.Marker({ element: el, anchor: "bottom" }).setLngLat(coord).addTo(map);
}

/**
 * The imperative MapLibre layer. Kept separate from Client.tsx so the React
 * surface stays declarative and all the map lifecycle lives in one place.
 *
 * maplibre-gl is **dynamically imported** inside the effect — it touches WebGL
 * and `window` at module load, so it must never run on the server. The static
 * CSS import at the top is build-time only (SSR-safe). Same pattern the QR tool
 * uses for `qrcode`.
 *
 * The map is created once; the boat marker tracks GPS, and the route line +
 * start/end pins update as the props change.
 */
export function MapShell({
  gps,
  tracking,
  boatKind,
  route,
  start,
  end,
  onLocate,
  onOpenSettings,
  onMapClick,
}: {
  gps: GeolocationPosition | null;
  /** The position watch is running and has not failed: the locate key is lit. */
  tracking: boolean;
  boatKind: BoatKind;
  /** Planned route polyline [lng, lat][], or null. */
  route: LngLat[] | null;
  start: LngLat | null;
  end: LngLat | null;
  /** Called when the locate button is tapped — Client starts the GPS watch. */
  onLocate: () => void;
  onOpenSettings: () => void;
  /** A tap on the map (used to drop start / destination pins). */
  onMapClick: (lngLat: LngLat) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const startPinRef = useRef<MlMarker | null>(null);
  const endPinRef = useRef<MlMarker | null>(null);
  const mlRef = useRef<MaplibreNs | null>(null);
  const hasCentredRef = useRef(false);
  const onMapClickRef = useRef(onMapClick);
  const [ready, setReady] = useState(false);

  // Keep the click handler current without re-running the init effect.
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // Init map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: MlMap | null = null;

    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      mlRef.current = ml;
      map = new ml.Map({
        container,
        style: STYLE,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        attributionControl: { compact: true },
        // The archipelago is the subject; keep the camera in the region.
        maxBounds: [
          [16.5, 58.6],
          [20.2, 60.2],
        ],
      });
      // Top-right, under the settings key: at the bottom of a phone
      // screen the route panel used to sit on the zoom-in button.
      map.addControl(
        new ml.NavigationControl({ showCompass: false }),
        "top-right",
      );
      for (const key of container.querySelectorAll(
        ".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out",
      )) {
        key.classList.add(...ZOOM_KEY);
      }
      map.on("click", (e) => {
        onMapClickRef.current([e.lngLat.lng, e.lngLat.lat]);
      });
      map.on("load", (e) => {
        const m = e.target;
        // Route line: dark casing under a deep-teal stroke, so it reads on
        // both light water and dark land/seamarks (map-anchored colours).
        m.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": MAP_INK, "line-width": 6.5, "line-opacity": 0.85 },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": MAP_TEAL, "line-width": 3.5 },
        });
        // Speed-limit zones (partial; reference points from Länsstyrelsen
        // regs). Translucent discs coloured by limit; tap reports the limit.
        // Step colours are traffic-light semantics on light tiles — map-anchored.
        m.addSource("speed", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: SPEED_ZONES.map((z) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [z.lng, z.lat] },
              properties: { knots: z.knots },
            })),
          },
        });
        m.addLayer({
          id: "speed",
          type: "circle",
          source: "speed",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 13, 11],
            "circle-color": [
              "step",
              ["get", "knots"],
              "#b91c1c",
              5,
              "#ea580c",
              7,
              "#ca8a04",
              9,
              "#65a30d",
            ],
            "circle-opacity": 0.3,
            "circle-stroke-color": MAP_INK,
            "circle-stroke-width": 1,
          },
        });
        // Grund (known hazards) — best-effort from OpenStreetMap, far from
        // complete. Drawn on top so they're never hidden by the route.
        m.addSource("grund", { type: "geojson", data: "/sjokort/grund.v1.geojson" });
        m.addLayer({
          id: "grund",
          type: "circle",
          source: "grund",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 14, 5],
            "circle-color": "#e4572e", // danger orange on light tiles — map-anchored
            "circle-stroke-color": MAP_INK,
            "circle-stroke-width": 1.5,
            "circle-opacity": 0.9,
          },
        });
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      startPinRef.current?.remove();
      endPinRef.current?.remove();
      markerRef.current = null;
      markerElRef.current = null;
      startPinRef.current = null;
      endPinRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Boat marker tracks GPS; first fix flies the camera to the user (once).
  useEffect(() => {
    const ml = mlRef.current;
    const map = mapRef.current;
    if (!ready || !ml || !map) return;

    if (!gps) {
      markerRef.current?.remove();
      markerRef.current = null;
      markerElRef.current = null;
      return;
    }

    const { longitude, latitude, heading } = gps.coords;
    const rot =
      typeof heading === "number" && Number.isFinite(heading) ? heading : 0;

    if (!markerRef.current) {
      const el = document.createElement("div");
      el.innerHTML = boatIconSvg(boatKind);
      el.style.willChange = "transform";
      markerElRef.current = el;
      markerRef.current = new ml.Marker({ element: el, rotationAlignment: "map" })
        .setLngLat([longitude, latitude])
        .setRotation(rot)
        .addTo(map);
    } else {
      markerRef.current.setLngLat([longitude, latitude]).setRotation(rot);
    }

    if (!hasCentredRef.current) {
      hasCentredRef.current = true;
      map.flyTo({ center: [longitude, latitude], zoom: 14, duration: 900 });
    }
  }, [ready, gps, boatKind]);

  // Swap the boat icon when the profile changes (marker stays put).
  useEffect(() => {
    if (markerElRef.current) markerElRef.current.innerHTML = boatIconSvg(boatKind);
  }, [boatKind]);

  // Draw / clear the route line.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      route && route.length > 1
        ? { type: "Feature", geometry: { type: "LineString", coordinates: route }, properties: {} }
        : { type: "FeatureCollection", features: [] },
    );
  }, [ready, route]);

  // Start / destination pins.
  useEffect(() => {
    const ml = mlRef.current;
    const map = mapRef.current;
    if (!ready || !ml || !map) return;
    startPinRef.current = updatePin(ml, map, startPinRef.current, start, MAP_TEAL);
    endPinRef.current = updatePin(ml, map, endPinRef.current, end, MAP_CORAL);
  }, [ready, start, end]);

  const handleLocate = () => {
    onLocate();
    const map = mapRef.current;
    if (map && gps) {
      map.flyTo({
        center: [gps.coords.longitude, gps.coords.latitude],
        zoom: 14,
        duration: 900,
      });
    }
  };

  return (
    <>
      <div ref={containerRef} className="sjokort-chart h-full w-full" />

      {/* Settings — top-right (top-left is Hugo + the back key). The zoom
          keys hang under it; chart.css places them. */}
      <Keycap
        size="icon"
        onClick={onOpenSettings}
        aria-label="Settings"
        className="absolute right-3 top-4 z-10"
      >
        <PixelIcon name="settings" size={12} />
      </Keycap>

      {/* Locate / centre-on-me — bottom-left, lifted above the iOS safe
          area. While the watch runs the key is lit in the accent. It is
          not announced as pressed: pressing it again does not switch the
          watch off, so it is not a toggle, and its name already changes
          once there is a position to centre on. */}
      <Keycap
        tone={tracking ? "accent" : "neutral"}
        size="icon"
        onClick={handleLocate}
        aria-label={gps ? "Centre on my position" : "Find my position"}
        className={`absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-10 ${
          tracking ? ON_CHART_ACCENT : ""
        }`}
      >
        <PixelIcon name="locate" size={12} />
      </Keycap>
    </>
  );
}
