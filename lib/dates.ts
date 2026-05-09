/**
 * `YYYY-MM-DD` for the given date in the user's local timezone — not UTC.
 * Used as a stable storage key for "today" in tools that track daily streaks
 * (Three Good Things, Stretch, Time Until). Calling `Date#toISOString()`
 * would shift to UTC and silently roll the date over for users west of GMT.
 */
export function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
