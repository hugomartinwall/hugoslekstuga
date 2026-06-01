"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap } from "maplibre-gl";
import { STYLE, INITIAL_CENTER, INITIAL_ZOOM } from "@/lib/sjokort/style";

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
 */
export function MapShell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: MlMap | null = null;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container,
        style: STYLE,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        attributionControl: { compact: true },
        // The archipelago is the subject; no need to let people fling
        // the camera to the other side of the planet.
        maxBounds: [
          [16.5, 58.6], // south-west
          [20.2, 60.2], // north-east
        ],
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
