"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A modal dialog: a flat dark scrim, a raised stepped panel, and the
 * behaviour a dialog owes its user — focus moves in and is kept in,
 * Escape and a click on the scrim close it, the page behind does not
 * scroll or hear the keys typed here, and focus returns to where it was.
 *
 * Portalled to <body>, so a transformed ancestor (the tool page's
 * entrance animation leaves one) cannot trap it in a column.
 *
 * `placement`
 *   center   the default
 *   top      hangs from the top of the screen (the search palette)
 *   bottom   a sheet on phones, centred from `sm` up
 *
 * Two dialogs can be open at once (search over the mascot's room). They
 * keep a stack: Escape and the focus trap belong to the top one only.
 */

/** Open dialogs, oldest first. The last one is on top. */
const stack: object[] = [];

/**
 * A key held down keeps sending key-downs. The first Escape closes the
 * dialog; the repeats that follow would land on the page behind it, and
 * two of the games quit on Escape. Until that key comes back up, its
 * repeats go nowhere.
 */
function swallowEscapeRepeats() {
  const down = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const done = (e: Event) => {
    if (e.type === "keyup" && (e as KeyboardEvent).key !== "Escape") return;
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", done, true);
    window.removeEventListener("blur", done);
  };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", done, true);
  // If the window loses focus the key-up may never arrive.
  window.addEventListener("blur", done);
}

export default function Dialog({
  open,
  onClose,
  label,
  children,
  placement = "center",
  className = "",
  surface = "bg-panel",
  style,
  passKeys = false,
  returnFocus = true,
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name. */
  label: string;
  children: ReactNode;
  placement?: "center" | "top" | "bottom";
  /** Classes for the panel (width, padding, max-height). */
  className?: string;
  /** The panel's fill, as a class. The raised panel colour by default. */
  surface?: string;
  /** Inline style for the panel: for custom properties such as --accent. */
  style?: CSSProperties;
  /**
   * Let plain key presses through to the page's own listeners. Off by
   * default: keys typed in a dialog must not drive what is behind it. A
   * dialog with nothing to type into may want the page's keys to live on.
   */
  passKeys?: boolean;
  /**
   * Hand the focus back to where it was when the dialog closes. On by
   * default. Turn it off (or pass a function that answers at closing
   * time) when closing means leaving: the search palette closes because
   * a row was chosen, and focus put back on the key that opened it would
   * take the second Enter of a double press.
   */
  returnFocus?: boolean | (() => boolean);
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  /** When this opening began, for the scrim's first-moment guard. */
  const openedAt = useRef(0);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // A layout effect: it has to be up to date before the closing cleanup
  // below reads it, and cleanups run before ordinary effects.
  const returnFocusRef = useRef(returnFocus);
  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus;
  }, [returnFocus]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    openedAt.current = performance.now();
    const me = {};
    stack.push(me);
    const onTop = () => stack[stack.length - 1] === me;
    const before = document.activeElement as HTMLElement | null;
    // The Tab stops inside the panel, in order. A group of radios is one
    // stop, not one per radio: Tab lands on the checked one and the arrow
    // keys move within the group. Counting every radio made the last
    // radio the "last stop", so Tab from a checked chip that was not the
    // last one slipped out of the dialog. (With nothing checked the
    // browser enters the group at its first radio going forward and its
    // last going back, so then they all stay in the list.)
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
            .filter((el) => el.offsetParent !== null || el === document.activeElement)
            .filter((el) => {
              if (!(el instanceof HTMLInputElement) || el.type !== "radio") return true;
              if (el.checked || !el.name) return true;
              return !Array.from(
                panel.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
              ).some((r) => r.name === el.name && r.checked);
            })
        : [];

    // Focus the element that asks for it, else the first control, else the panel.
    const wanted = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (wanted ?? focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      // With another dialog open over this one, the keys are its.
      if (!onTop()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // One press closes one dialog: the other listeners on this same
        // node (a dialog underneath) must not see it either.
        e.stopImmediatePropagation();
        closeRef.current();
        swallowEscapeRepeats();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    // Keys pressed while a dialog is open belong to the dialog. Page-level
    // shortcuts listen on `window`: without this a game's WASD or a tool's
    // Space also acts on every letter typed into the search field. This
    // runs after everything inside the dialog has seen the key. Chords
    // with Ctrl or Cmd still pass (the palette's own Ctrl-K toggle), and
    // so does every keyup, so a key held down before the dialog opened is
    // still released for whoever was tracking it.
    const keepKeysIn = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    };
    if (!passKeys) document.addEventListener("keydown", keepKeysIn);

    // Lock the page behind: a class on <html>, put there by the first
    // dialog to open and taken away by the last to close. It used to save
    // the inline `overflow` and write it back, which is also how the game
    // routes lock their page; when the page under an open palette changed,
    // each wrote back the other's stale value and an ordinary page was
    // left unable to scroll. A class has nothing stale to restore.
    //
    // Where scrollbars take up room, hiding one would widen the page and
    // shift a centred column: the class pads the body by the same amount
    // (--dialog-pad), so nothing behind the scrim moves.
    const html = document.documentElement;
    if (stack.length === 1) {
      const scrollbar = window.innerWidth - html.clientWidth;
      html.style.setProperty("--dialog-pad", `${Math.max(0, scrollbar)}px`);
      html.classList.add("dialog-open");
    }

    return () => {
      const at = stack.indexOf(me);
      if (at >= 0) stack.splice(at, 1);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", keepKeysIn);
      if (stack.length === 0) {
        html.classList.remove("dialog-open");
        html.style.removeProperty("--dialog-pad");
      }
      const back = returnFocusRef.current;
      const wanted = typeof back === "function" ? back() : back;
      // Without scrolling: the visitor may have scrolled on since they
      // last touched that element, and the page must not jump back to it.
      if (wanted && before && document.contains(before)) {
        before.focus({ preventScroll: true });
      }
    };
  }, [open, passKeys]);

  // The panel is centred, and a centre can fall on half a pixel (an odd
  // window width, an odd panel height). At 1x that smears every 1px ring
  // inside it. Measure where it landed and nudge it back onto the grid,
  // again whenever the window or the panel changes size.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const snap = () => {
      panel.style.translate = "";
      const r = panel.getBoundingClientRect();
      const fx = r.left - Math.floor(r.left);
      const fy = r.top - Math.floor(r.top);
      if (fx > 0.01 || fy > 0.01) panel.style.translate = `${-fx}px ${-fy}px`;
    };
    snap();
    const ro = new ResizeObserver(snap);
    ro.observe(panel);
    window.addEventListener("resize", snap);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", snap);
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const place =
    placement === "top"
      ? "items-start justify-center pt-16 sm:pt-24"
      : placement === "bottom"
        ? "items-end justify-center sm:items-center"
        : "items-center justify-center";

  return createPortal(
    <div
      className={`scrim-chunk z-[60] flex px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${place}`}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // A dialog opened by a tap would be closed by that same tap: its
        // follow-up mouse-down lands on the scrim that has just appeared.
        // So the scrim does not close anything in its first moment. (Done
        // here and not with pointer-events, which would let that moment's
        // clicks fall through to the page behind.)
        if (performance.now() - openedAt.current < 400) return;
        onClose();
      }}
    >
      {/* No outline on the panel when it takes focus itself, except in
          forced colours, where that outline is the only frame it has. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={style}
        className={`card-chunk not-forced-colors:outline-none ${surface} ${className}`.trim()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
