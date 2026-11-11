/**
 * For the moment after something under the finger has gone away.
 *
 * A key that closes a panel leaves whatever lay underneath in its place,
 * and the second tap of a double tap lands there: close Sjökort's
 * settings with a quick double tap and the second tap pressed a zoom
 * key, reopened the sheet, or dropped a pin and threw the route away.
 *
 * The kit's `press-guard` class is for the opposite case, a thing that
 * APPEARS under the finger: it ignores the pointer for a moment, so the
 * tap falls through it. That is no use here, because what is now under
 * the finger is the very thing to protect. This lays an invisible sheet
 * over the whole screen for a moment instead: it takes the press and
 * does nothing with it.
 *
 * Call it from the handler that makes the thing go away. Dialog does so
 * by itself whenever it is closed by a press.
 */
export function swallowPresses(ms = 400): void {
  if (typeof document === "undefined") return;
  const sheet = document.createElement("div");
  sheet.setAttribute("aria-hidden", "true");
  // Above everything, the map library's own controls included.
  sheet.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;touch-action:none;";
  document.body.appendChild(sheet);
  window.setTimeout(() => sheet.remove(), ms);
}
