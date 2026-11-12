"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSearch } from "@/components/Search";
import { ChipGroup } from "@/components/ui/Chip";
import Dialog from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/Field";
import Keycap from "@/components/ui/Keycap";
import Tag from "@/components/ui/Tag";
import { CREAM_HEX, accentVars } from "@/lib/colors";
import { END, KEYS, PANEL_LABEL, ROOT_LABEL } from "@/lib/knuff/content/copy";
import { DEFAULT_TUNE } from "@/lib/knuff/content/tune";
import { resolveKnuffFonts } from "@/lib/knuff/fonts";
import { FIRST_VIEW, createKnuff, type KnuffHandle, type KnuffKnobs, type KnuffView } from "@/lib/knuff/game";
import type { Tune } from "@/lib/knuff/sim/types";

/**
 * Knuff: full-screen from first paint. The whole game is imperative
 * canvas code in lib/knuff/; this component owns the mount, the unmount
 * and the panels, which are page elements built from the site's kit and
 * rendered beside the root, not inside it.
 *
 * The root is the game's one touch surface: it fills the page, the canvas
 * fills it, and the room, the top bar and the thumb deck are all drawn in
 * that canvas. So the protections the other games put on their canvas are
 * on the root here (no browser panning, no text selection, no callout): a
 * pull that began beside a canvas would be taken by the browser as a
 * scroll and cancelled. The game's keys are heard on the root too, which
 * is why it can take the focus.
 *
 * UNTIL THE GAME SHIPS this file also carries what the owner tunes the
 * game with (the spec's steps 1 to 5): three knobs as keys on the start
 * screen and in both panels, a MORE dialog for every other number, the
 * `?tune=` reader, and `playable`, which never refuses a laptop window
 * for its size. Everything marked "the playable's" below is deleted when
 * the knobs are settled.
 */

const GAME_ACCENT = accentVars("pink");

/** The playable's. `?tune=<json>`: knobs laid over the default table, by name. */
function tuneFromAddress(): Partial<Tune> | undefined {
  try {
    const raw = new URLSearchParams(window.location.search).get("tune");
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<Tune>) : undefined;
  } catch {
    return undefined;
  }
}

/** The playable's. One knob as a row: its name, and its settings as chips. */
function Knob<T extends number>({
  name,
  settings,
  value,
  onSet,
}: {
  name: string;
  settings: readonly T[];
  value: number;
  onSet: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <span id={id} className="label-pixel whitespace-nowrap">
        {name}
      </span>
      <ChipGroup
        labelledBy={id}
        className="flex-nowrap gap-1.5"
        chipClassName="min-w-9 px-2.5"
        options={settings.map((v) => ({ value: v, label: String(v) }))}
        value={settings.find((v) => v === value) ?? null}
        onChange={onSet}
      />
    </div>
  );
}

/** The playable's. The three knobs the owner sets by playing. */
function Knobs({ knobs, onSet }: { knobs: KnuffKnobs; onSet: (patch: Partial<Tune>) => void }) {
  return (
    <>
      <Knob name="PACE" settings={[1, 2, 3]} value={knobs.pace} onSet={(pace) => onSet({ pace })} />
      <Knob name="LINE" settings={[1, 2]} value={knobs.aimCushions} onSet={(aimCushions) => onSet({ aimCushions })} />
      <Knob
        name="HOT AFTER A POP"
        settings={[0, 15]}
        value={knobs.popHotTicks}
        onSet={(popHotTicks) => onSet({ popHotTicks })}
      />
    </>
  );
}

/**
 * AGAIN needs a fresh press at least 600 ms after the panel appears: the
 * thumb that was pulling when the night ended is already on its way down.
 * It is never disabled, because a disabled key cannot take the focus: for
 * those 600 ms it says so with aria-disabled and ignores presses. A press
 * counts only if it began on the key after that, and a held Enter or
 * Space does nothing.
 */
function AgainKey({ onAgain }: { onAgain: () => void }) {
  const [live, setLive] = useState(false);
  const fresh = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLive(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <Keycap
      tone="accent"
      size="lg"
      block
      data-autofocus
      aria-disabled={live ? undefined : true}
      onPointerDown={() => {
        fresh.current = live;
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        fresh.current = live;
      }}
      onClick={() => {
        if (!live || !fresh.current) return;
        fresh.current = false;
        onAgain();
      }}
    >
      {KEYS.again}
    </Keycap>
  );
}

/**
 * `standalone` is the one-file build of this page: there is no playhouse
 * to go back to, so the panels leave that key out.
 */
export default function Client({ standalone = false }: { standalone?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<KnuffHandle | null>(null);
  const [view, setView] = useState<KnuffView>(FIRST_VIEW);
  const searchOpen = useSearch().open;
  // The playable's: the MORE dialog, what is typed in it, and what was wrong with it.
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [fault, setFault] = useState("");
  const pipsId = useId();

  // One effect, and everything it does is undone by its clean-up, so
  // StrictMode's mount, clean-up and second mount end with one game, one
  // frame loop and one set of listeners.
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const game = createKnuff(root, canvas, {
      fonts: resolveKnuffFonts(),
      onChange: setView,
      tune: tuneFromAddress(),
      playable: true,
    });
    gameRef.current = game;
    // The page lock is a class (see html.game-open in globals.css), not
    // inline styles: nothing is saved here and nothing is restored.
    document.documentElement.classList.add("game-open");
    root.focus({ preventScroll: true });
    // He is on stage here: the corner mascot yields the screen.
    window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-stage", { detail: { present: true } }));
    return () => {
      window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-stage", { detail: { present: false } }));
      document.documentElement.classList.remove("game-open");
      gameRef.current = null;
      game.destroy();
    };
  }, []);

  // The search palette opening over the game pauses the night. While it
  // is open the pause panel is not shown, so it never lands on top of the
  // palette the visitor asked for, and Escape cannot resume behind it.
  useEffect(() => {
    if (searchOpen) gameRef.current?.pause();
  }, [searchOpen]);

  // The keys are heard on the root: when a panel has gone, the focus goes
  // back there, not to wherever it was before the panel.
  const screen = view.screen;
  useEffect(() => {
    if (screen === "play" || screen === "start") rootRef.current?.focus({ preventScroll: true });
  }, [screen]);

  const toRoot = () => rootRef.current?.focus({ preventScroll: true });
  const resume = () => {
    if (!searchOpen) gameRef.current?.resume();
  };
  const leave = () => gameRef.current?.abandon();
  const setTune = (patch: Partial<Tune>) => gameRef.current?.setTune(patch);

  const closeMore = () => {
    setMore(false);
    setFault("");
    // Opened from the start screen, there is no panel under it to go back to.
    if (screen !== "paused" && screen !== "over") toRoot();
  };
  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft.trim() === "" ? "{}" : draft);
    } catch {
      setFault("that is not JSON");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setFault('it has to be an object, like {"paceTokens":3}');
      return;
    }
    const known = DEFAULT_TUNE as unknown as Record<string, unknown>;
    const wrong = Object.entries(parsed).filter(
      ([key, value]) => !Object.prototype.hasOwnProperty.call(known, key) || typeof value !== typeof known[key],
    );
    if (wrong.length > 0) {
      setFault(`no such knob, or the wrong kind of value: ${wrong.map(([key]) => key).join(", ")}`);
      return;
    }
    setTune(parsed as Partial<Tune>);
    setFault("");
    setDraft("");
    setMore(false);
    if (screen !== "over") toRoot();
  };

  const over = view.over;

  return (
    <>
      <div
        ref={rootRef}
        tabIndex={0}
        role="application"
        aria-label={ROOT_LABEL}
        data-screen={view.screen}
        className="fixed inset-0 z-50 outline-none"
        style={{
          backgroundColor: CREAM_HEX,
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {/* The playable's: the knob keys across the top of the page, over
          the top bar, until the first launch. Nothing in the bar is needed
          before it. They are beside the root, so a press on one is never a
          pull; afterwards the focus goes back to the root. */}
      {screen === "start" && (
        <div
          data-knobs="start"
          style={GAME_ACCENT}
          className="fixed inset-x-0 top-0 z-[55] flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 bg-cream px-2 pt-[max(0.375rem,var(--sat))] pb-1.5"
        >
          <Knobs
            knobs={view.knobs}
            onSet={(patch) => {
              setTune(patch);
              toRoot();
            }}
          />
          <Keycap size="sm" onClick={() => setMore(true)}>
            MORE
          </Keycap>
        </div>
      )}

      <Dialog
        open={screen === "paused" && !searchOpen}
        onClose={resume}
        label={PANEL_LABEL.pause}
        returnFocus={false}
        style={GAME_ACCENT}
        className="flex w-full max-w-sm flex-col gap-4 p-5"
      >
        <Keycap tone="accent" size="lg" block data-autofocus onClick={resume}>
          {KEYS.resume}
        </Keycap>
        {/* The playable's. PACE and HOT AFTER A POP change the rules: the
            night in progress is dropped and the start screen comes back. */}
        <div data-knobs="pause" className="flex flex-col gap-2">
          <Knobs knobs={view.knobs} onSet={setTune} />
          <Keycap size="sm" className="self-start" onClick={() => setMore(true)}>
            MORE
          </Keycap>
        </div>
        {!standalone && (
          <Keycap href="/" tone="neutral" block onClick={leave}>
            {KEYS.back}
          </Keycap>
        )}
      </Dialog>

      <Dialog
        open={screen === "over" && over !== null}
        // Escape and the scrim do nothing here.
        onClose={() => {}}
        label={PANEL_LABEL.end}
        placement="bottom"
        returnFocus={false}
        style={GAME_ACCENT}
        className="flex w-full max-w-sm flex-col gap-3 p-5"
      >
        {over && (
          <>
            {!standalone && (
              <Keycap href="/" tone="quiet" size="sm" className="self-start" onClick={leave}>
                {KEYS.back}
              </Keycap>
            )}
            <div className="flex items-end justify-between gap-3">
              <p data-end="score" className="font-display text-7xl leading-none text-ink">
                {over.score}
              </p>
              {over.newBest && (
                <Tag tone="solid" className="mb-2">
                  {END.newBest}
                </Tag>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {(
                [
                  [END.best, String(over.best), "best"],
                  [END.night, over.night, "night"],
                  [END.bestShot, String(over.bestShot), "bestShot"],
                ] as const
              ).map(([label, value, key]) => (
                <div key={key}>
                  <dt className="label-pixel">{label}</dt>
                  <dd data-end={key} className="font-display text-2xl leading-tight text-ink">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {over.line !== "" && (
              <p data-end="line" className="text-[15px] text-ink-soft">
                {over.line}
              </p>
            )}
            {/* The playable's. A value set here is used by the night AGAIN starts. */}
            <div data-knobs="end" className="flex flex-col gap-2">
              <Knobs knobs={view.knobs} onSet={setTune} />
            </div>
            <AgainKey onAgain={() => gameRef.current?.restart()} />
          </>
        )}
      </Dialog>

      {/* The playable's: every other number. The one-file build runs in a
          frame whose address the owner cannot edit, so what `?tune=` takes
          can be typed here. Applying makes the night again, as PACE does. */}
      <Dialog
        open={more}
        onClose={closeMore}
        label="More knobs"
        returnFocus={() => screen === "paused" || screen === "over"}
        style={GAME_ACCENT}
        className="flex max-h-[90dvh] w-full max-w-sm flex-col gap-3 overflow-y-auto p-5"
      >
        <div className="flex items-center gap-2">
          <span id={pipsId} className="label-pixel whitespace-nowrap">
            PIPS BACK
          </span>
          <ChipGroup
            labelledBy={pipsId}
            className="gap-1.5"
            options={[
              { value: 96, label: "96" },
              { value: 120, label: "120" },
            ]}
            value={view.knobs.pipRefillTicks === 96 || view.knobs.pipRefillTicks === 120 ? view.knobs.pipRefillTicks : null}
            onChange={(pipRefillTicks) => setTune({ pipRefillTicks })}
          />
        </div>
        <TextArea
          label="Any knob, as JSON"
          rows={3}
          value={draft}
          placeholder='{"paceTokens":3}'
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setDraft(e.target.value)}
        />
        {fault !== "" && (
          <p role="alert" className="text-sm text-tomato">
            {fault}
          </p>
        )}
        <div className="flex gap-2">
          <Keycap tone="accent" onClick={apply}>
            APPLY
          </Keycap>
          <Keycap onClick={closeMore}>CLOSE</Keycap>
        </div>
        <div>
          <p className="label-pixel">IN FORCE</p>
          <p data-knobs="in-force" className="text-xs break-all text-ink-soft">
            pace {view.knobs.pace} · popHotTicks {view.knobs.popHotTicks} · aimCushions {view.knobs.aimCushions} ·
            pipRefillTicks {view.knobs.pipRefillTicks}
          </p>
          <p className="label-pixel mt-2">NOT AT ITS STARTING VALUE</p>
          <p data-knobs="named" className="text-xs break-all text-ink-soft">
            {view.named}
          </p>
        </div>
      </Dialog>
    </>
  );
}
