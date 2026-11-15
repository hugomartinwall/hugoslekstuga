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
  neutral: "",
  accent: "tag-accent",
  danger: "tag-danger",
  solid: "tag-solid",
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
  // Spacing and surfaces are kit rules (.tag-chunk in globals.css), not
  // utilities, so any utility in `className` wins over them.
  return (
    <span
      className={`plate-chunk label-pixel tag-chunk ${TONE[tone]} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      {...rest}
    >
      {children}
    </span>
  );
}
