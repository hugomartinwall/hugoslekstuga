"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { MapShell } from "./MapShell";
import { createRouter, type Router } from "@/lib/sjokort/route";
import { nearestZone } from "@/lib/sjokort/zones";
import {
  bearingDeg,
  compassPoint,
  formatNm,
  formatDuration,
  haversineMeters,
  METERS_PER_NM,
} from "@/lib/geo";
import type { BoatKind } from "@/lib/sjokort/boat-icon";

type LngLat = [number, number];

type BoatProfile = {
  kind: BoatKind;
  /** cm — reserved for a future draft filter (no free depth data yet). */
  draft?: number;
  /** cm — reserved for a future bridge-clearance filter. */
  height?: number;
};

const PROFILE_KEY = "hugoslekstuga:sjokort:profile";
const DEFAULT_PROFILE: BoatProfile = { kind: "motor" };

const BOAT_KINDS: { value: BoatKind; label: string }[] = [
  { value: "motor", label: "Motor" },
  { value: "sail", label: "Sail" },
  { value: "kayak", label: "Kayak" },
  { value: "custom", label: "Other" },
];

/** Rough cruising speeds (knots) for the ETA estimate. */
const CRUISING_KNOTS: Record<BoatKind, number> = {
  motor: 20,
  sail: 6,
  kayak: 3.5,
  custom: 12,
};

interface RouteState {
  coords: LngLat[];
  distanceM: number;
  corridorLegs: number;
}

export default function SjokortClient() {
  const [profile, setProfile] = useLocalStorageState<BoatProfile>(
    PROFILE_KEY,
    DEFAULT_PROFILE,
  );
  const [gps, setGps] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Routing.
  const [planning, setPlanning] = useState(false);
  const [start, setStart] = useState<LngLat | null>(null);
  const [end, setEnd] = useState<LngLat | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const routerRef = useRef<Router | null>(null);
  const reqRef = useRef(0);

  // Speed-limit lookup (a normal map tap, when not planning a route).
  const [speedInfo, setSpeedInfo] = useState<{
    knots: number | null;
    name?: string;
    note?: string;
  } | null>(null);

  // GPS gated on a user gesture (the locate button) — more reliable across
  // browsers and less aggressive than an on-load prompt.
  useEffect(() => {
    if (!watching) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGpsError("Geolocation isn't available in this browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps(pos);
        setGpsError(null);
      },
      (err) => setGpsError(err.message || "Couldn't get your location."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  // Spin up the routing worker once (client-only).
  useEffect(() => {
    const router = createRouter();
    routerRef.current = router;
    return () => {
      router.dispose();
      routerRef.current = null;
    };
  }, []);

  // Compute a route whenever both ends are set.
  useEffect(() => {
    if (!start || !end || !routerRef.current) return;
    const req = ++reqRef.current;
    setRouting(true);
    setRouteError(null);
    setRoute(null);
    routerRef.current.route(start, end).then((reply) => {
      if (req !== reqRef.current) return; // a newer request superseded this one
      setRouting(false);
      if (reply.ok && reply.coords) {
        setRoute({
          coords: reply.coords,
          distanceM: reply.distanceM ?? 0,
          corridorLegs: reply.corridorLegs ?? 0,
        });
      } else {
        setRouteError(reply.error ?? "unknown");
      }
    });
  }, [start, end]);

  const setKind = (kind: BoatKind) => setProfile((prev) => ({ ...prev, kind }));

  const handleMapClick = (lngLat: LngLat) => {
    if (!planning) {
      const hit = nearestZone(lngLat[0], lngLat[1]);
      setSpeedInfo(
        hit ? { knots: hit.zone.knots, name: hit.zone.name, note: hit.zone.note } : { knots: null },
      );
      return;
    }
    if (!start || (start && end)) {
      // Fresh start (or restart after a completed pair).
      setStart(lngLat);
      setEnd(null);
      setRoute(null);
      setRouteError(null);
    } else {
      setEnd(lngLat);
    }
  };

  const useMyPosition = () => {
    if (!gps) {
      setWatching(true);
      return;
    }
    const here: LngLat = [gps.coords.longitude, gps.coords.latitude];
    setStart(here);
    setEnd(null);
    setRoute(null);
    setRouteError(null);
  };

  const clearRoute = () => {
    setStart(null);
    setEnd(null);
    setRoute(null);
    setRouteError(null);
    reqRef.current++;
  };

  const closePlanning = () => {
    setPlanning(false);
    clearRoute();
  };

  return (
    <>
      {/* Full-bleed map; no explicit z so Hugo (z-40) + controls stay above. */}
      <div className="fixed inset-0 bg-cream">
        <MapShell
          gps={gps}
          boatKind={profile.kind}
          route={route?.coords ?? null}
          start={start}
          end={end}
          onLocate={() => setWatching(true)}
          onOpenSettings={() => setDrawerOpen(true)}
          onMapClick={handleMapClick}
        />
      </div>

      {/* Back to playhouse — top-left, offset right of Hugo. */}
      <Link
        href="/"
        aria-label="Back to playhouse"
        className="btn-chunk fixed left-16 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-cream text-lg font-bold text-ink"
      >
        <span aria-hidden>←</span>
      </Link>

      {/* Transient GPS error pill. */}
      {watching && gpsError && (
        <div className="fixed inset-x-0 bottom-44 z-30 flex justify-center px-20">
          <p className="rounded-full border-2 border-ink bg-tomato-soft px-3 py-1 text-center text-xs font-semibold text-ink">
            {gpsError}
          </p>
        </div>
      )}

      {/* Speed-limit readout — a normal tap reports the nearest known zone. */}
      {!planning && speedInfo && (
        <div className="fixed inset-x-0 bottom-[max(8.75rem,calc(env(safe-area-inset-bottom)+8.5rem))] z-20 flex justify-center px-3">
          <div className="card-chunk flex w-full max-w-sm items-center gap-3 rounded-[var(--radius-card)] bg-cream px-4 py-2.5 text-sm">
            {speedInfo.knots != null ? (
              <span className="font-semibold text-ink">
                <strong className="font-extrabold">{speedInfo.knots} knop</strong> ·{" "}
                {speedInfo.name}
                {speedInfo.note ? ` · ${speedInfo.note}` : ""}
              </span>
            ) : (
              <span className="text-ink-soft">
                No speed zone in our data here — coverage is partial, so check
                signage. Mind your wake.
              </span>
            )}
            <button
              type="button"
              onClick={() => setSpeedInfo(null)}
              aria-label="Dismiss"
              className="ml-auto rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-xs font-bold hover:bg-cream-deep"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Route planner — bottom-centre, above the corner controls. */}
      <div className="fixed inset-x-0 bottom-[max(5rem,calc(env(safe-area-inset-bottom)+4.75rem))] z-20 flex justify-center px-3">
        {!planning ? (
          <button
            type="button"
            onClick={() => {
              setPlanning(true);
              setSpeedInfo(null);
            }}
            className="btn-chunk rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-cream"
          >
            Plan a route
          </button>
        ) : (
          <RoutePanel
            start={start}
            end={end}
            routing={routing}
            route={route}
            routeError={routeError}
            knots={CRUISING_KNOTS[profile.kind]}
            hasGps={!!gps}
            onUseMyPosition={useMyPosition}
            onClear={clearRoute}
            onClose={closePlanning}
          />
        )}
      </div>

      {drawerOpen && (
        <SettingsDrawer
          profile={profile}
          onSetKind={setKind}
          watching={watching}
          gps={gps}
          gpsError={gpsError}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}

function RoutePanel({
  start,
  end,
  routing,
  route,
  routeError,
  knots,
  hasGps,
  onUseMyPosition,
  onClear,
  onClose,
}: {
  start: LngLat | null;
  end: LngLat | null;
  routing: boolean;
  route: RouteState | null;
  routeError: string | null;
  knots: number;
  hasGps: boolean;
  onUseMyPosition: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  let heading: string | null = null;
  if (route && route.coords.length >= 2) {
    // Bearing toward the first point ~300 m ahead, so a tiny first grid step
    // doesn't give a misleading heading.
    const a = route.coords[0];
    let b = route.coords[route.coords.length - 1];
    for (let i = 1; i < route.coords.length; i++) {
      b = route.coords[i];
      if (haversineMeters(a[0], a[1], b[0], b[1]) > 300) break;
    }
    const deg = bearingDeg(a[0], a[1], b[0], b[1]);
    heading = `${compassPoint(deg)} ${Math.round(deg)}°`;
  }
  const etaMin = route ? route.distanceM / ((knots * METERS_PER_NM) / 60) : 0;

  const errorText = (() => {
    switch (routeError) {
      case "start-dry":
        return "that start looks like it's on land — tap on water.";
      case "end-dry":
        return "that destination looks like it's on land — tap on water.";
      case "no-route":
        return "no water route between those points. they may sit in separate basins — a lake cut off from the sea, say.";
      case null:
        return null;
      default:
        return "couldn't work that route out. try again.";
    }
  })();

  return (
    <div className="card-chunk w-full max-w-sm rounded-[var(--radius-card)] bg-cream p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold tracking-tight">
          Plan a route
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close route planner"
          className="rounded-full border-2 border-ink bg-cream px-2 py-0.5 text-xs font-bold hover:bg-cream-deep"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 text-sm text-ink-soft">
        {routing ? (
          "finding a route…"
        ) : errorText ? (
          <span className="text-ink">{errorText}</span>
        ) : route ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-semibold text-ink">
            <span>{formatNm(route.distanceM)}</span>
            <span>~{formatDuration(etaMin)}</span>
            {heading && <span>heading {heading}</span>}
          </div>
        ) : !start ? (
          "tap the map to drop a start."
        ) : !end ? (
          "now tap your destination."
        ) : null}
      </div>

      {route && (
        <p className="mt-2 border-t-2 border-dashed border-ink/15 pt-2 text-xs leading-relaxed text-ink-muted">
          a suggested course — it steers around land and follows charted
          channels where we have them, but it can&apos;t check depth. keep your
          chart and your eyes.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!route && !routing && (
          <button
            type="button"
            onClick={onUseMyPosition}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-xs font-bold hover:bg-teal-soft"
          >
            {hasGps ? "Use my position" : "Find me first"}
          </button>
        )}
        {(start || route || routeError) && (
          <button
            type="button"
            onClick={onClear}
            className="rounded-full border-2 border-ink bg-cream px-3 py-1.5 text-xs font-bold hover:bg-cream-deep"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsDrawer({
  profile,
  onSetKind,
  watching,
  gps,
  gpsError,
  onClose,
}: {
  profile: BoatProfile;
  onSetKind: (kind: BoatKind) => void;
  watching: boolean;
  gps: GeolocationPosition | null;
  gpsError: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gpsStatus = gpsError
    ? gpsError
    : !watching
      ? "Off — tap the locator on the map to find yourself."
      : gps
        ? `Active · accuracy ±${Math.round(gps.coords.accuracy)} m`
        : "Searching…";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Dark scrim (not the site's bg-ink haze): ink is light now, and the
          map under it is light tiles — it needs dimming, not brightening. */}
      <div className="absolute inset-0 bg-cream/60" onClick={onClose} aria-hidden />
      <div className="card-chunk relative z-10 flex w-full max-w-md flex-col gap-5 rounded-t-[var(--radius-card)] bg-cream p-6 sm:rounded-[var(--radius-card)]">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-full border-2 border-ink bg-cream px-2 py-1 text-xs font-bold hover:bg-cream-deep"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Your boat
          </p>
          <div className="flex flex-wrap gap-2">
            {BOAT_KINDS.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => onSetKind(b.value)}
                className={`rounded-full border-2 border-ink px-4 py-2 text-sm font-bold transition-colors ${
                  profile.kind === b.value
                    ? "bg-teal text-cream"
                    : "bg-cream hover:bg-teal-soft"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Sets the marker and the cruising speed used for trip-time estimates.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            GPS
          </p>
          <p className="text-sm text-ink-soft">{gpsStatus}</p>
        </div>

        <div className="rounded-[var(--radius-card)] border-2 border-ink bg-tomato-soft p-3 text-xs leading-relaxed text-ink">
          <strong className="font-bold">Grund are incomplete.</strong> The hazard
          marks come from OpenStreetMap — nowhere near every grund is in there
          (it can&apos;t legally include the official depth survey). This is not
          a depth chart. Never navigate by it; use the official sjökort.
        </div>

        <p className="text-xs leading-relaxed text-ink-muted">
          Tap the water (when you&apos;re not planning a route) to check the
          speed limit. Zones come from Länsstyrelsen&apos;s regulations and are
          partial so far — always follow posted signage.
        </p>

        <p className="border-t-2 border-dashed border-ink/15 pt-4 text-xs leading-relaxed text-ink-muted">
          Tiles from OpenStreetMap &amp; OpenSeaMap — the one tool here that
          loads from the open web. Those servers see an anonymous tile request,
          never you. Your location and routes stay on your device.
        </p>
      </div>
    </div>
  );
}
