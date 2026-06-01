"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "@/lib/sjokort/style";
import { boatIconSvg, type BoatKind } from "@/lib/sjokort/boat-icon";

type MaplibreNs = typeof import("maplibre-gl");

/**
 * The imperative MapLibre layer. Kept separate from Client.tsx so the
 * React surface stays declarative and all the map lifecycle lives in
 * one place.
 *
 * maplibre-gl is **dynamically imported** inside the effect — it
 * touches WebGL and `window` at module load, so it must never run on
 * the server. The static CSS import at the top is build-time only (no
 * JS executed), so it's SSR-safe. Same pattern the QR tool uses for
 * the `qrcode` library.
 *
 * The map is created once; the boat marker is created on the first GPS
 * fix and updated on every subsequent one. The first fix also flies
 * the camera to the user (once) — after that they're free to pan, and
 * tapping the locate button re-centres on demand.
 */
export function MapShell({
  gps,
  boatKind,
  onLocate,
  onOpenSettings,
}: {
  gps: GeolocationPosition | null;
  boatKind: BoatKind;
  /** Called when the locate button is tapped — Client starts the GPS
   *  watch (idempotent). */
  onLocate: () => void;
  onOpenSettings: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const mlRef = useRef<MaplibreNs | null>(null);
  const hasCentredRef = useRef(false);
  const [ready, setReady] = useState(false);

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
        // Bottom-right, stacking above the attribution pill — frees the
        // top corners for the back/settings buttons in the full-screen
        // layout.
        "bottom-right",
      );
      map.on("load", () => {
        if (!cancelled) setReady(true);
      });
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      markerElRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Create / update the boat marker as GPS fixes arrive. First fix
  // also flies the camera to the user (once).
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
      markerRef.current = new ml.Marker({
        element: el,
        rotationAlignment: "map",
      })
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

  // Swap the icon when the boat profile changes (marker stays put).
  useEffect(() => {
    if (markerElRef.current) {
      markerElRef.current.innerHTML = boatIconSvg(boatKind);
    }
  }, [boatKind]);

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

      {/* Settings cog — top-right (top-left is Hugo + the back button
          in the full-screen layout). */}
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

      {/* Locate / centre-on-me — bottom-left, lifted above the iOS
          safe area (home indicator / Safari toolbar). Attribution +
          zoom own bottom-right. */}
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
