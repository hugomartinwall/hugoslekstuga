"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSearch } from "@/components/Search";
import Dialog from "@/components/ui/Dialog";
import Keycap from "@/components/ui/Keycap";
import ScrollRegion from "@/components/ui/ScrollRegion";
import Tag from "@/components/ui/Tag";
import { CREAM_HEX, accentVars } from "@/lib/colors";
import { CHARMS_TAKEN, END, KEYS, PANEL_LABEL, ROOT_LABEL } from "@/lib/knuff/content/copy";
import { resolveKnuffFonts } from "@/lib/knuff/fonts";
import { FIRST_VIEW, createKnuff, type KnuffHandle, type KnuffView } from "@/lib/knuff/game";

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
 */

const GAME_ACCENT = accentVars("pink");

/**
 * Each panel's frame. On a page too short for a panel, what is inside
 * scrolls under the frame (components/ui/ScrollRegion): the stepped frame
 * is drawn on the panel, and a panel that scrolled itself took it along.
 * The panel is no taller than the page less the scrim's padding and a
 * margin above, so its top never leaves the page.
 */
const PANEL = "flex max-h-[calc(100dvh-3rem)] w-full max-w-sm flex-col";

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
  const charmsId = useId();

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

  const resume = () => {
    if (!searchOpen) gameRef.current?.resume();
  };
  const leave = () => gameRef.current?.abandon();

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

      <Dialog
        open={screen === "paused" && !searchOpen}
        onClose={resume}
        label={PANEL_LABEL.pause}
        returnFocus={false}
        style={GAME_ACCENT}
        className={PANEL}
      >
        <ScrollRegion>
          <div className="flex flex-col gap-4 p-5">
            <Keycap tone="accent" size="lg" block data-autofocus onClick={resume}>
              {KEYS.resume}
            </Keycap>
            {/* The body charms taken this night, by name: they are not on the play screen. */}
            {view.charms.length > 0 && (
              <div data-charms="pause" className="flex flex-col gap-2">
                <span id={charmsId} className="label-pixel">
                  {CHARMS_TAKEN}
                </span>
                <ul aria-labelledby={charmsId} className="flex flex-wrap gap-1.5">
                  {view.charms.map((name) => (
                    <li key={name}>
                      <Tag>{name}</Tag>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!standalone && (
              <Keycap href="/" tone="neutral" block onClick={leave}>
                {KEYS.back}
              </Keycap>
            )}
          </div>
        </ScrollRegion>
      </Dialog>

      <Dialog
        open={screen === "over" && over !== null}
        // Escape and the scrim do nothing here.
        onClose={() => {}}
        label={PANEL_LABEL.end}
        placement="bottom"
        returnFocus={false}
        style={GAME_ACCENT}
        className={PANEL}
      >
        {over && (
          <>
            {/* AGAIN stays put under what scrolls. It takes the focus as the
                panel opens, and inside the scrolling part that focus scrolled
                the score out of view on a short page: here the panel opens on
                its top, the score, and AGAIN is in view under it. */}
            <ScrollRegion>
              <div className="flex flex-col gap-3 px-5 pt-5">
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
              </div>
            </ScrollRegion>
            <div className="shrink-0 px-5 pt-3 pb-5">
              <AgainKey onAgain={() => gameRef.current?.restart()} />
            </div>
          </>
        )}
      </Dialog>

    </>
  );
}
