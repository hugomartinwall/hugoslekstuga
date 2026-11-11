/**
 * Whose key is it? A page-level shortcut (Space to spin, Space for
 * another line) listens on the window, so it hears every Space, including
 * the ones meant for whatever has focus. These two answer "does the
 * focused element want this key for itself?", so the shortcut can stand
 * down and let the element have it.
 */

/** A place where keys are text: fields, selects, anything editable. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * A control that Space presses: a button, a link, a summary, anything
 * with a button role. With one of these focused, Space must press IT.
 * (A link ignores Space, but stealing the key from a focused link to do
 * something else is no better.)
 */
export function isPressable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A" && target.hasAttribute("href")) return true;
  const role = target.getAttribute("role");
  return role === "button" || role === "switch" || role === "checkbox" || role === "radio" || role === "tab";
}
