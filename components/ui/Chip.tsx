"use client";

import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";

/**
 * Chips — the site's one shape for "pick something".
 *
 * `Chip`       a single toggle or a small action. A <button>; pass
 *              `pressed` for a toggle (it sets aria-pressed and fills
 *              with the accent), leave it off for a plain action.
 *
 * `ChipGroup`  one choice out of a few. Real radio inputs under the
 *              chips, so arrow keys, focus and screen readers all work
 *              without any wiring: the group is one tab stop.
 *
 * Both wear `chip-chunk` (see "The kit" in app/globals.css) and take
 * their colour from --accent.
 */
export function Chip({
  pressed,
  className = "",
  children,
  type,
  ...rest
}: {
  pressed?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">) {
  return (
    <button
      type={type ?? "button"}
      aria-pressed={pressed}
      className={`chip-chunk ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export type ChipOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  /** Shown as a tooltip; also the option's accessible description. */
  title?: string;
  disabled?: boolean;
};

export function ChipGroup<T extends string | number>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  className = "",
  chipClassName = "",
  trailing,
}: {
  /** The group's accessible name, when no visible label names it. */
  label?: string;
  /**
   * The id of the visible label that names the group. Prefer this when
   * there is one on screen: with `label` as well, a screen reader would
   * say the name twice.
   */
  labelledBy?: string;
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
  chipClassName?: string;
  /** Extra content inside the row, after the chips (a custom field, a preview key). */
  trailing?: ReactNode;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={`flex flex-wrap items-center gap-2 ${className}`.trim()}
    >
      {options.map((o) => (
        <label
          key={String(o.value)}
          title={o.title}
          className={`chip-chunk ${chipClassName}`.trim()}
        >
          {/* The title is on the input as well as on the label: the
              label's shows the tooltip, the input's is what a screen
              reader reads as the option's description. */}
          <input
            type="radio"
            name={name}
            title={o.title}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
      {trailing}
    </div>
  );
}
