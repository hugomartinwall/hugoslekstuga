/**
 * Browser quirks, in one place. None of this is gameplay — it exists so the
 * game behaves on a phone and in a backgrounded tab.
 *
 * **Ported note.** game2 registered the wheel, keydown and contextmenu
 * preventDefaults on `window`, because inside a CrazyGames iframe the game IS
 * the page and there is nothing else to break. On hugoslekstuga the same code
 * would make every other page unscrollable and kill right-click site-wide, so
 * all three are scoped to the canvas. The suspend/resume signals stay global:
 * they are about the tab, not the element.
 *
 * Every listener is registered through the caller's `listen`, so unmounting the
 * route takes them all with it.
 */

export interface QuirkHooks {
  /** Called when the tab/webview goes to background. Must pause AND mute. */
  suspend: () => void;
  /** Called when it comes back. */
  resume: () => void;
}

/** Registers a listener and remembers how to undo it. Supplied by `main.ts`. */
export type Listen = <K extends string>(
  target: EventTarget,
  type: K,
  fn: (e: Event) => void,
  opts?: AddEventListenerOptions,
) => void;

export function installBrowserQuirks(
  canvas: HTMLCanvasElement,
  hooks: QuirkHooks,
  listen: Listen,
): void {
  // Scrolling the wheel over the game must not scroll the page behind it.
  // passive:false is required for preventDefault to apply. Scoped to the
  // canvas: the wheel anywhere else on the site is none of our business.
  listen(canvas, "wheel", (e) => e.preventDefault(), { passive: false });

  // Spacebar and arrows scroll the page by default, and Space is the cast
  // button. Bound on the canvas, which holds focus during play (tabIndex is
  // set in Client.tsx) — so the same keys still scroll everywhere else.
  //
  // Escape is deliberately NOT swallowed. game2 left it alone because
  // CrazyGames owned it for fullscreen; here it is the quit key, and
  // `input/spell-input.ts` routes it to onExit.
  listen(
    canvas,
    "keydown",
    (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === " " || k === "ArrowUp" || k === "ArrowDown") e.preventDefault();
    },
    { passive: false },
  );

  // Right-click is middle-of-combat self-cast, not a menu — but only over the
  // canvas. Right-click on the rest of the site behaves normally.
  listen(canvas, "contextmenu", (e) => e.preventDefault());

  // visibilitychange is the reliable background signal; pausing here also
  // satisfies "mute in background" and stops us burning battery when hidden.
  listen(document, "visibilitychange", () => {
    if (document.hidden) hooks.suspend();
    else hooks.resume();
  });

  // Belt and braces for iOS Safari, where visibilitychange can be unreliable.
  listen(window, "blur", () => hooks.suspend());
  listen(window, "focus", () => hooks.resume());

  // Stop iOS double-tap-to-zoom and long-press callouts on the canvas.
  listen(canvas, "touchstart", (e) => e.preventDefault(), { passive: false });
  listen(canvas, "gesturestart", (e) => e.preventDefault());
}
