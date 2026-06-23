"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Map as MlMap,
  Marker as MlMarker,
  GeoJSONSource,
} from "maplibre-gl";
import { STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "@/lib/sjokort/style";
import { boatIconSvg, type BoatKind } from "@/lib/sjokort/boat-icon";

type MaplibreNs = typeof import("maplibre-gl");
type LngLat = [number, number];

/** Teardrop pin marker (start/end of a planned route). */
function pinSvg(fill: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"><path d="M13 1C6.4 1 1 6.4 1 13c0 8.2 12 20 12 20s12-11.8 12-20C25 6.4 19.6 1 13 1z" fill="${fill}" stroke="#1a1812" stroke-width="2"/><circle cx="13" cy="13" r="4.5" fill="#fbf6ee"/></svg>`;
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
  boatKind,
  route,
  start,
  end,
  onLocate,
  onOpenSettings,
  onMapClick,
}: {
  gps: GeolocationPosition | null;
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
      map.addControl(
        new ml.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      map.on("click", (e) => {
        onMapClickRef.current([e.lngLat.lng, e.lngLat.lat]);
      });
      map.on("load", (e) => {
        const m = e.target;
        // Route line: ink casing under a teal stroke, so it reads on both
        // light water and dark land/seamarks.
        m.addSource("route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#1a1812", "line-width": 6.5, "line-opacity": 0.85 },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#14b8a6", "line-width": 3.5 },
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
    startPinRef.current = updatePin(ml, map, startPinRef.current, start, "#14b8a6");
    endPinRef.current = updatePin(ml, map, endPinRef.current, end, "#ef7d57");
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
      <div ref={containerRef} className="h-full w-full" />

      {/* Settings cog — top-right (top-left is Hugo + the back button). */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        className="btn-chunk absolute right-3 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-cream text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {/* Locate / centre-on-me — bottom-left, lifted above the iOS safe area. */}
      <button
        type="button"
        onClick={handleLocate}
        aria-label={gps ? "Centre on my position" : "Find my position"}
        className="btn-chunk absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-teal text-cream"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="7" />
          <line x1="12" y1="1" x2="12" y2="4" />
          <line x1="12" y1="20" x2="12" y2="23" />
          <line x1="1" y1="12" x2="4" y2="12" />
          <line x1="20" y1="12" x2="23" y2="12" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </>
  );
}
