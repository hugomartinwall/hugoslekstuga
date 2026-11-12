"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import PixelIcon from "@/components/PixelIcon";
import { ChipGroup } from "@/components/ui/Chip";
import Dialog from "@/components/ui/Dialog";
import Keycap from "@/components/ui/Keycap";
import Panel from "@/components/ui/Panel";
import ScrollRegion from "@/components/ui/ScrollRegion";
import { accentVars } from "@/lib/colors";
import { swallowPresses } from "@/lib/pointer";
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

/**
 * The dock: bottom-centre, above the corner controls. Everything that
 * floats here is one column (the GPS error, the speed readout, then the
 * planner), so no piece can land on another however tall it grows. The
 * dock lets presses through to the chart; only the pieces in it take
 * them.
 *
 * `--dock-bottom` is where the column's box ends. The pieces end 6px
 * above that, on the column's padding: 0.5rem over the locate key.
 */
const DOCK =
  "pointer-events-none fixed inset-x-0 bottom-(--dock-bottom) z-20 px-3 [--dock-bottom:calc(max(0.75rem,env(safe-area-inset-bottom))+3.25rem-6px)]";

/**
 * The column is as tall as its pieces until it would reach the keys at
 * the top of the screen; from there it scrolls inside itself. Which keys
 * those are depends on how wide the screen is beside the 24rem column.
 * `--dock-top` is how far from the top of the screen the column stops:
 *
 *   under 32rem   it runs under the zoom keys (with 0.5rem of air they
 *                 take 4rem at each end of a centred column): it stops
 *                 0.5rem below them, 10.5rem from the top
 *   32 to 40rem   it clears those and still reaches under the back key
 *                 and the mascot (8rem at the left end, air included):
 *                 4.5rem
 *   from 40rem    nothing stands above it: 0.5rem
 *
 * The steps are where the column clears a key and its air. A rem
 * earlier it clears the key alone: a panel then stood against the zoom
 * keys, and in forced colours it covered their focus mark.
 *
 * A screen can be narrow and short at once (a desktop at 400% zoom is
 * 320 by 256), and then there is nothing left under the zoom keys: the
 * stop lies below the dock's own foot. So under 25rem tall, where not
 * even a readout over the key fits there, the panels stand beside the
 * zoom keys and the column stops under the back key, as in the middle
 * range. `--beside` is what the keys take from the right end of the
 * column, 0.5rem of air included: it is down to nothing at 32rem,
 * where the middle range takes over, and it is 0 everywhere else. The
 * key is not a panel: it is narrower than the column and keeps to the
 * middle of the screen.
 *
 * Whatever the screen, the column is never shorter than 4rem, which
 * holds the key alone with its padding: the page's first key is always
 * whole.
 *
 * A reversed column with one child rests at its bottom: the planner
 * stays put and what does not fit leaves at the top, where a finger, the
 * wheel or the arrow keys bring it back. (The child keeps the pieces in
 * reading order.) It never scrolls sideways. There are 6px of padding
 * because a box that scrolls cuts whatever leaves it: a keycap lifts 2px
 * under the pointer and sinks 2px when pressed, and in forced colours
 * its focus mark is an outline that ends 5px outside it. The padding is
 * in px because the 6px that `--dock-bottom` takes back are: in rem the
 * two cancelled at one text size only, and at 18 or 20px the dock stood
 * above its place, on a fraction of a pixel. `scroll-py` keeps the same
 * room round a key that Tab brings into view. There is no scrollbar
 * because the column ignores the pointer, so that the chart beside the
 * pieces stays live: a bar here could not be dragged.
 */
const DOCK_COLUMN = [
  "page-col flex flex-col-reverse py-[6px] [--col:24rem]",
  "max-h-[max(4rem,calc(100dvh-var(--dock-bottom)-var(--dock-top)))]",
  "[--dock-top:10.5rem] min-[32rem]:[--dock-top:4.5rem] min-[40rem]:[--dock-top:0.5rem]",
  "[--beside:0px] max-[32rem]:[@media(height<25rem)]:[--dock-top:4.5rem]",
  "max-[32rem]:[@media(height<25rem)]:[--beside:max(0px,3.25rem-max(0px,(100vw-25.5rem)/2))]",
  "overflow-x-hidden overflow-y-auto overscroll-contain scroll-py-[6px] [scrollbar-width:none]",
].join(" ");

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

  // The dock's column rests at its foot, and goes back there whenever the
  // planner opens or closes, or a readout comes, goes or is replaced. On
  // a small screen the planner's close key and a readout's Dismiss stand
  // at the top of a stack taller than the column, so the column has been
  // scrolled by the time either is pressed, and it stayed scrolled: what
  // was left on screen was the GPS error, with "Plan a route" cut off
  // below it or gone. A change of the GPS error or of the route does not
  // bring the column back: those come by themselves, perhaps to a visitor
  // reading what they scrolled to. (A layout effect, so that the frame
  // with the cut key is never drawn.)
  const columnRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (columnRef.current) columnRef.current.scrollTop = 0;
  }, [planning, speedInfo]);

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

  // Dismiss and the planner's close key leave the bare chart under the
  // finger, where the second tap of a double tap asked for a new readout
  // (the one just dismissed came straight back) and zoomed the chart.
  // The screen takes no press for a moment after either.
  const dismissSpeedInfo = () => {
    setSpeedInfo(null);
    swallowPresses();
  };

  const closePlanning = () => {
    setPlanning(false);
    clearRoute();
    swallowPresses();
  };

  return (
    // `contents`: the wrapper carries the accent and has no box of its own.
    <div className="contents" style={ACCENT}>
      {/* Back to playhouse — top-left, right of Hugo. A finger can press
          him 44px wide, and he swells when he breathes and when he is
          tapped: 4.75rem keeps this key clear of all of that. It comes
          first in the source so that Tab reaches it straight after him
          (it is fixed, so where it is written moves nothing on screen). */}
      <Keycap
        href="/"
        size="icon"
        aria-label="Back to playhouse"
        className="fixed left-[4.75rem] top-4 z-30"
      >
        <PixelIcon name="back" size={12} />
      </Keycap>

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

      <div className={DOCK}>
        <div ref={columnRef} className={DOCK_COLUMN}>
          {/* The right padding is the room the zoom keys take on a screen
              both narrow and short (`--beside`, 0 anywhere else): the
              panels fill what is left of it. */}
          <div className="flex shrink-0 flex-col items-center gap-2 pr-(--beside) *:pointer-events-auto">
            {/* Transient GPS error. The words are the browser's, and they
                can hold an address with nowhere to break: it wraps
                anywhere, or it would be cut by the panel and make the
                column wider than the dock. */}
            {watching && gpsError && (
              <Panel
                tone="danger"
                className="w-full px-4 py-3 text-center text-xs leading-5 font-semibold wrap-anywhere text-ink"
              >
                <p>{gpsError}</p>
              </Panel>
            )}

            {/* Speed-limit readout — a normal tap reports the nearest known zone.
                A zone's name can be one long word (Djurgårdsbrunnskanalen).
                Where the panel is too narrow for it, it breaks anywhere:
                unbroken, it pushed the Dismiss key out of the panel, and
                the panel's stepped edge cut the key. */}
            {!planning && speedInfo && (
              <Panel
                tone="raised"
                className="flex w-full items-center gap-3 py-2 pr-2 pl-4 text-sm wrap-anywhere"
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
                  onClick={dismissSpeedInfo}
                  aria-label="Dismiss"
                  className="ml-auto shrink-0"
                >
                  <PixelIcon name="close" size={12} />
                </Keycap>
              </Panel>
            )}

            {/* Route planner: the page's primary key, or the panel it opens.
                The key gives the column's right padding back as a negative
                margin, so it is centred on the screen and not on what the
                zoom keys leave. */}
            {!planning ? (
              <Keycap
                tone="accent"
                size="lg"
                onClick={() => {
                  setPlanning(true);
                  setSpeedInfo(null);
                }}
                className={`-mr-(--beside) w-44 ${ON_CHART_ACCENT}`}
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
        {/* This key lands under the left of "Plan a route" when the panel
            takes that key's place, where the second tap of a double tap
            would press it. The guard is on the key and not on the panel:
            it works by ignoring the pointer, and a tap the panel ignored
            would fall through to the chart and drop a pin.

            It is also one key with two jobs: when the position comes,
            "Find me first" turns into "Use my position" where it stands,
            and a position can come within a moment of the first tap. The
            second tap of a double tap then dropped the start pin. The
            guard runs again under its second name when the job changes. */}
        {!route && !routing && (
          <Keycap
            size="sm"
            onClick={onUseMyPosition}
            className={hasGps ? "press-guard-alt" : "press-guard"}
          >
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
  const titleId = useId();
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
        <h2 id={titleId} className="font-display text-3xl leading-none">
          Settings
        </h2>
        {/* On a short phone the sheet fills the screen and this key lands
            on the Settings key that opened it: the second tap of a double
            tap closed the sheet again. Dialog's own first-moment guard
            covers its scrim, not what is in the panel. */}
        <Keycap
          tone="quiet"
          size="icon"
          onClick={onClose}
          aria-label="Close settings"
          className="shrink-0 press-guard"
        >
          <PixelIcon name="close" size={12} />
        </Keycap>
      </div>

      {/* The title stays put; on a screen too short for the sheet, this
          part scrolls under it, and then the keyboard can stop on it and
          scroll it too. */}
      <ScrollRegion
        labelledBy={titleId}
        className="flex flex-col gap-5 px-5 pb-5 sm:px-6 sm:pb-6"
      >
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
          {/* The space is written out: the build drops a text node's
              leading space when the node spans lines and holds an entity,
              and this sentence ran into the bold one. */}
          <strong className="font-bold">Grund are incomplete.</strong>{" "}
          The hazard marks come from OpenStreetMap — nowhere near every grund
          is in there (it can&apos;t legally include the official depth
          survey). This is not a depth chart. Never navigate by it; use the
          official sjökort.
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
      </ScrollRegion>
    </Dialog>
  );
}
