"use client";

import { useEffect, useRef, type ReactNode } from "react";
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
 */
export default function Dialog({
  open,
  onClose,
  label,
  children,
  placement = "center",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name. */
  label: string;
  children: ReactNode;
  placement?: "center" | "top" | "bottom";
  /** Classes for the panel (width, padding, max-height). */
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];

    // Focus the element that asks for it, else the first control, else the panel.
    const wanted = panel?.querySelector<HTMLElement>("[data-autofocus]");
    (wanted ?? focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
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
    document.addEventListener("keydown", keepKeysIn);

    // Lock the page behind. Where scrollbars take up room, hiding one
    // would widen the page and shift a centred column: pad by the same
    // amount so nothing behind the scrim moves.
    const html = document.documentElement;
    const body = document.body;
    const prevOverflow = html.style.overflow;
    const prevPad = body.style.paddingRight;
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", keepKeysIn);
      html.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
      if (before && document.contains(before)) before.focus();
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`card-chunk bg-panel outline-none ${className}`.trim()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
