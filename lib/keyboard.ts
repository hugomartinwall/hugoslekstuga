/**
 * Whose key is it? A page-level shortcut (Space to spin, Space for
 * another line) listens on the window, so it hears every Space, including
 * the ones meant for whatever has focus. This module answers "does the
 * focused element want this key for itself?", so the shortcut can stand
 * down and let the element have it.
 *
 * For a Space shortcut, call `claimSpace(e)` and act when it says yes.
 * For any other key, `isTextEntry(e.target)` is the one test needed.
 */

/**
 * Was the visitor's last move a pointer press (true) or a key (false)?
 *
 * A button keeps the focus after a mouse click, with no ring showing,
 * and Space would then press it again. Someone who clicks "Worth
 * keeping" and presses Space wants the page's shortcut (the next line),
 * not to un-keep the line. Someone who walked to the same button with
 * Tab wants Space to press it. The focused element is the same in both
 * cases; only how the focus got there differs, so that is what is kept.
 *
 * `:focus-visible` cannot answer this: the browser turns it on for the
 * focused element the moment any key goes down, the Space included.
 *
 * Two listeners that only set a flag. They are added once, when this
 * module first loads in a browser, and stay: the flag has to be right
 * before the first shortcut is pressed, whichever page that happens on.
 */
let pointerLast = false;

if (typeof window !== "undefined") {
  const opts = { capture: true, passive: true } as const;
  window.addEventListener(
    "pointerdown",
    () => {
      pointerLast = true;
    },
    opts,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      // Space is the key being asked about, so it settles nothing. A
      // modifier alone, or a chord with one (copying, switching windows),
      // is not a move towards a control either.
      if (e.code === "Space") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control" || e.key === "Alt") return;
      pointerLast = false;
    },
    opts,
  );
}

/** Input types where a key is not a character: Space presses or does nothing. */
const NOT_TEXT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** A place where keys are text: a text field, a text area, anything editable. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NOT_TEXT.has(target.type);
  return target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * A control that Space works on (a button, a summary, a select, a
 * checkbox or radio, a slider, anything with a pressing role).
 *
 * A link is not one: Space does nothing on a link, and the footer's
 * links stay focused across page changes, so standing down for them
 * left the shortcut dead on arrival.
 */
function isControl(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return NOT_TEXT.has(target.type);
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY" || tag === "SELECT") return true;
  const role = target.getAttribute("role");
  return (
    role === "button" ||
    role === "switch" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "tab" ||
    role === "slider"
  );
}

/**
 * True when Space belongs to the focused control: it is a control Space
 * works on, the visitor can perceive it, and the keyboard is what
 * brought them to it.
 *
 * Hidden from everyone (aria-hidden) does not count: a control nobody
 * can see cannot be what the key was meant for.
 */
export function isPressable(target: EventTarget | null): boolean {
  if (!isControl(target)) return false;
  if (target.closest('[aria-hidden="true"]')) return false;
  return !pointerLast;
}

/**
 * The whole recipe for a page's Space shortcut. Returns true when this
 * key press is the page's to use, and by then it has cancelled what the
 * key would have done by itself (scrolled the page, pressed a button).
 *
 *   const onKey = (e: KeyboardEvent) => {
 *     if (!claimSpace(e)) return;
 *     spin();
 *   };
 *
 * When it takes the key from a control that only has the focus because
 * it was clicked, the control also lets go of the focus. Cancelling the
 * key-down is not enough everywhere: Firefox presses a focused button
 * when Space is RELEASED, cancelled key-down or not, so the shortcut
 * would run and the clicked button would be pressed again as well. With
 * the focus gone the release has nothing to press. The browser still
 * remembers the spot, so the next Tab carries on from there.
 */
export function claimSpace(e: KeyboardEvent): boolean {
  if (e.code !== "Space") return false;
  if (isTextEntry(e.target) || isPressable(e.target)) return false;
  e.preventDefault();
  if (isControl(e.target)) e.target.blur();
  return true;
}
