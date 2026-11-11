import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * A tag: a small stepped label for a state or a kind ("new", "404",
 * "solved"). It is `plate-chunk` + `label-pixel` with a named surface.
 * Not a control: nothing happens when you press it. For something you
 * can press, use a Chip.
 *
 * `tone`
 *   neutral  room-dark with the hairline (default)
 *   accent   the accent's dark tint with an accent ring
 *   danger   coral tint with a coral ring
 *   solid    phosphor fill, room-dark words: the loud one ("new")
 */
export type TagTone = "neutral" | "accent" | "danger" | "solid";

const TONE: Record<TagTone, string> = {
  neutral: "bg-cream text-ink",
  accent:
    "bg-(--accent-soft) text-ink [--ring-c:color-mix(in_srgb,var(--accent)_45%,transparent)]",
  danger:
    "bg-tomato-soft text-ink [--ring-c:color-mix(in_srgb,var(--color-tomato)_45%,transparent)]",
  solid: "bg-ink text-cream [--ring-c:transparent]",
};

export default function Tag({
  tone = "neutral",
  className = "",
  children,
  ...rest
}: {
  tone?: TagTone;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"span">, "className" | "children">) {
  return (
    <span
      className={`plate-chunk label-pixel inline-flex w-fit items-center gap-1.5 px-2 py-1 ${TONE[tone]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
