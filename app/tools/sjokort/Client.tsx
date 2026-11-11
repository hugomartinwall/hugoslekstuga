"use client";

import { useEffect, useId, useRef, useState } from "react";
import PixelIcon from "@/components/PixelIcon";
import { ChipGroup } from "@/components/ui/Chip";
import Dialog from "@/components/ui/Dialog";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import { accentVars } from "@/lib/colors";
import { findTool } from "@/lib/tools";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { MapShell, ON_CHART_ACCENT } from "./MapShell";
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

/**
 * The chart is full-bleed and has no ToolFrame around it, so the page
 * sets the kit's accent itself: from the registry, as ToolFrame does.
 */
const ACCENT = accentVars(findTool("sjokort")!.color);

/**
 * The settings sheet. 448px wide at most, and never taller than the
 * screen: on a short phone, or one held sideways, the body scrolls under
 * the title. (Dialog keeps the panel on whole pixels itself; the 20px
 * line heights inside keep its height whole too.)
 */
const SETTINGS_PANEL = "flex w-full max-w-md flex-col max-h-[calc(100dvh-2rem)]";

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
    // `contents`: the wrapper carries the accent and has no box of its own.
    <div className="contents" style={ACCENT}>
      {/* Full-bleed map; no explicit z so Hugo (z-40) + controls stay above. */}
      <div className="fixed inset-0 bg-cream">
        <MapShell
          gps={gps}
          tracking={watching && !gpsError}
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
      <Keycap
        href="/"
        size="icon"
        aria-label="Back to playhouse"
        className="fixed left-16 top-4 z-30"
      >
        <PixelIcon name="back" size={12} />
      </Keycap>

      {/* The dock — bottom-centre, above the corner controls. Everything
          that floats here is one column (the GPS error, the speed readout,
          then the planner), so no piece can land on another however tall
          it grows. The dock itself lets taps through to the chart; only
          the pieces in it take them. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.25rem)] z-20 px-3">
        <div className="page-col flex flex-col items-center gap-2 [--col:24rem] *:pointer-events-auto">
          {/* Transient GPS error. */}
          {watching && gpsError && (
            <Panel
              tone="danger"
              className="w-full px-4 py-3 text-center text-xs leading-5 font-semibold text-ink"
            >
              <p>{gpsError}</p>
            </Panel>
          )}

          {/* Speed-limit readout — a normal tap reports the nearest known zone. */}
          {!planning && speedInfo && (
            <Panel
              tone="raised"
              className="flex w-full items-center gap-3 py-2 pr-2 pl-4 text-sm"
            >
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
              <Keycap
                tone="quiet"
                size="icon"
                onClick={() => setSpeedInfo(null)}
                aria-label="Dismiss"
                className="ml-auto shrink-0"
              >
                <PixelIcon name="close" size={12} />
              </Keycap>
            </Panel>
          )}

          {/* Route planner: the page's primary key, or the panel it opens. */}
          {!planning ? (
            <Keycap
              tone="accent"
              size="lg"
              onClick={() => {
                setPlanning(true);
                setSpeedInfo(null);
              }}
              className={`w-44 ${ON_CHART_ACCENT}`}
            >
              Plan a route
            </Keycap>
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
    </div>
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
    <Panel tone="raised" className="w-full p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-2xl leading-none">Plan a route</h2>
        <Keycap
          tone="quiet"
          size="icon"
          onClick={onClose}
          aria-label="Close route planner"
          className="shrink-0"
        >
          <PixelIcon name="close" size={12} />
        </Keycap>
      </div>

      <div className="mt-2 text-sm text-ink-soft">
        {routing ? (
          "finding a route…"
        ) : errorText ? (
          <span className="text-ink">{errorText}</span>
        ) : route ? (
          // The answer, as a readout: big phosphor numerals.
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-display text-2xl leading-none text-ink">
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
        <p className="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-muted">
          a suggested course — it steers around land and follows charted
          channels where we have them, but it can&apos;t check depth. keep your
          chart and your eyes.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!route && !routing && (
          <Keycap size="sm" onClick={onUseMyPosition}>
            {hasGps ? "Use my position" : "Find me first"}
          </Keycap>
        )}
        {(start || route || routeError) && (
          <Keycap size="sm" onClick={onClear}>
            Clear
          </Keycap>
        )}
      </div>
    </Panel>
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
  const boatLabelId = useId();

  const gpsStatus = gpsError
    ? gpsError
    : !watching
      ? "Off — tap the locator on the map to find yourself."
      : gps
        ? `Active · accuracy ±${Math.round(gps.coords.accuracy)} m`
        : "Searching…";

  // This component is only mounted while the settings are open, so the
  // dialog is simply open. The kit's Dialog owns the scrim (dark and flat:
  // the tiles under it are light, they need dimming), Escape, a click
  // outside, the focus trap and the scroll lock. It is a sheet on phones
  // and centred from `sm` up. It renders in a portal on <body>, outside
  // the page's wrapper, so the accent is handed in again for the chips.
  return (
    <Dialog
      open
      onClose={onClose}
      label="Settings"
      placement="bottom"
      style={ACCENT}
      className={SETTINGS_PANEL}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
        <h2 className="font-display text-3xl leading-none">Settings</h2>
        <Keycap
          tone="quiet"
          size="icon"
          onClick={onClose}
          aria-label="Close settings"
          className="shrink-0"
        >
          <PixelIcon name="close" size={12} />
        </Keycap>
      </div>

      {/* The title stays put; on a screen too short for the sheet, this
          part scrolls under it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-2">
          <p id={boatLabelId} className="label-pixel">
            Your boat
          </p>
          <ChipGroup
            labelledBy={boatLabelId}
            options={BOAT_KINDS}
            value={profile.kind}
            onChange={onSetKind}
          />
          <p className="text-xs leading-5 text-ink-muted">
            Sets the marker and the cruising speed used for trip-time estimates.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="label-pixel">GPS</p>
          <p className="text-sm text-ink-soft">{gpsStatus}</p>
        </div>

        <Panel tone="danger" className="p-4 text-xs leading-5 text-ink">
          <strong className="font-bold">Grund are incomplete.</strong> The hazard
          marks come from OpenStreetMap — nowhere near every grund is in there
          (it can&apos;t legally include the official depth survey). This is not
          a depth chart. Never navigate by it; use the official sjökort.
        </Panel>

        <p className="text-xs leading-5 text-ink-muted">
          Tap the water (when you&apos;re not planning a route) to check the
          speed limit. Zones come from Länsstyrelsen&apos;s regulations and are
          partial so far — always follow posted signage.
        </p>

        <p className="border-t border-line pt-4 text-xs leading-5 text-ink-muted">
          Tiles from OpenStreetMap &amp; OpenSeaMap — the one tool here that
          loads from the open web. Those servers see an anonymous tile request,
          never you. Your location and routes stay on your device.
        </p>
      </div>
    </Dialog>
  );
}
