import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * The keycap — every button on the site. A thin wrapper over
 * `btn-chunk` (see "The kit" in app/globals.css) that fixes the three
 * things call sites kept getting slightly different: the fill, the size
 * and the label face.
 *
 * `tone`
 *   accent   the page's accent (--accent, set by ToolFrame). The one
 *            primary action on a screen.
 *   neutral  a raised dark key. Everything secondary.
 *   quiet    page-coloured: for a key that should almost not be there.
 *   danger   coral. Stop, remove, give up.
 *
 * `size`     sm 36px (44px under a finger) · md 44px · lg 52px ·
 *            icon 44×44 square (give it an aria-label)
 *
 * Renders a <button>, or a next/link <a> when `href` is given.
 */
export type KeycapTone = "accent" | "neutral" | "quiet" | "danger";
export type KeycapSize = "sm" | "md" | "lg" | "icon";

const TONE: Record<KeycapTone, string> = {
  accent: "bg-(--accent) text-cream",
  neutral: "bg-panel text-ink",
  quiet: "bg-cream text-ink",
  danger: "bg-tomato text-cream",
};

const SIZE: Record<KeycapSize, string> = {
  sm: "min-h-9 px-3 text-sm pointer-coarse:min-h-11",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-13 px-6 text-base",
  icon: "h-11 w-11",
};

type Own = {
  tone?: KeycapTone;
  size?: KeycapSize;
  /** Stretch to the container's width. */
  block?: boolean;
  className?: string;
  children: ReactNode;
};

type AsButton = Own &
  Omit<ComponentPropsWithoutRef<"button">, keyof Own | "href"> & {
    href?: undefined;
  };
type AsLink = Own &
  Omit<ComponentPropsWithoutRef<typeof Link>, keyof Own> & { href: string };

export function keycapClass({
  tone = "neutral",
  size = "md",
  block = false,
  className = "",
}: Pick<Own, "tone" | "size" | "block" | "className">): string {
  return `btn-chunk inline-flex items-center justify-center gap-2 font-bold leading-none ${
    TONE[tone]
  } ${SIZE[size]} ${block ? "w-full" : ""} ${className}`.trim();
}

export default function Keycap(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { tone, size, block, className, children, ...rest } = props;
    return (
      <Link className={keycapClass({ tone, size, block, className })} {...rest}>
        {children}
      </Link>
    );
  }
  const { tone, size, block, className, children, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      className={keycapClass({ tone, size, block, className })}
      {...rest}
    >
      {children}
    </button>
  );
}
