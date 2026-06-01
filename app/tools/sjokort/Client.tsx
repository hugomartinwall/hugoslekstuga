"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { MapShell } from "./MapShell";
import type { BoatKind } from "@/lib/sjokort/boat-icon";

type BoatProfile = {
  kind: BoatKind;
  /** cm — reserved for the routing phase (filter shallow passages). */
  draft?: number;
  /** cm — reserved for the routing phase (filter low bridges). */
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

export default function SjokortClient() {
  const [profile, setProfile] = useLocalStorageState<BoatProfile>(
    PROFILE_KEY,
    DEFAULT_PROFILE,
  );
  const [gps, setGps] = useState<GeolocationPosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // GPS is gated on a user gesture (the locate button) rather than
  // auto-prompted on load — more reliable across browsers (Safari
  // ignores non-gesture geolocation requests) and less aggressive.
  // Once started, watchPosition keeps a live fix until unmount.
  useEffect(() => {
    if (!watching) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Rare no-API branch — a synchronous set is fine here; the effect
      // exists to bridge the Geolocation API in the first place.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGpsError("Geolocation isn't available in this browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps(pos);
        setGpsError(null);
      },
      (err) => {
        setGpsError(err.message || "Couldn't get your location.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  const setKind = (kind: BoatKind) =>
    setProfile((prev) => ({ ...prev, kind }));

  return (
    <>
      {/* Full-bleed map. No explicit z-index so it doesn't trap a
          stacking context — Hugo (BrandCorner, z-40) and the floating
          controls below stay above it. */}
      <div className="fixed inset-0 bg-cream">
        <MapShell
          gps={gps}
          boatKind={profile.kind}
          onLocate={() => setWatching(true)}
          onOpenSettings={() => setDrawerOpen(true)}
        />
      </div>

      {/* Back to playhouse — top-left, offset right of Hugo (who lives
          at ~left 18, ~31px wide). z-30: above the map, below Hugo. */}
      <Link
        href="/"
        aria-label="Back to playhouse"
        className="btn-chunk fixed left-16 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-cream text-lg font-bold text-ink"
      >
        <span aria-hidden>←</span>
      </Link>

      {/* Transient GPS error pill, bottom-centre, clear of the controls. */}
      {watching && gpsError && (
        <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-20">
          <p className="rounded-full border-2 border-ink bg-tomato-soft px-3 py-1 text-center text-xs font-semibold text-ink shadow-[2px_2px_0_#1a1812]">
            {gpsError}
          </p>
        </div>
      )}

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
  // Close on Escape.
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
      <div
        className="absolute inset-0 bg-ink/30"
        onClick={onClose}
        aria-hidden
      />
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
            Changes the marker on the map. Draft and height come into play
            once routing lands.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            GPS
          </p>
          <p className="text-sm text-ink-soft">{gpsStatus}</p>
        </div>

        <p className="border-t-2 border-dashed border-ink/15 pt-4 text-xs leading-relaxed text-ink-muted">
          Tiles from OpenStreetMap &amp; OpenSeaMap — the one tool here that
          loads from the open web. Those servers see an anonymous tile
          request, never you. Your location stays on your device.
        </p>
      </div>
    </div>
  );
}
