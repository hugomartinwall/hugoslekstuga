import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * The cabinet panel — `card-chunk` with a named surface.
 *
 * `tone`
 *   well     the inset surface (default): things sit IN it
 *   raised   one step lighter: things sit ON it (dialogs, floating panels)
 *   page     the page colour itself, framed
 *   soft     the accent's dark tint (--accent-soft): results, selected states
 *   danger   coral tint: errors, warnings
 *
 * A panel that only holds things never lifts on hover. Use an <a>,
 * <button> or <label> as the element (`as`) for one you can press.
 */
export type PanelTone = "well" | "raised" | "page" | "soft" | "danger";

const TONE: Record<PanelTone, string> = {
  well: "bg-cream-deep",
  raised: "bg-panel",
  page: "bg-cream",
  soft: "bg-(--accent-soft)",
  danger: "bg-tomato-soft",
};

type PanelProps<T extends ElementType> = {
  as?: T;
  tone?: PanelTone;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "tone" | "className" | "children">;

export default function Panel<T extends ElementType = "div">({
  as,
  tone = "well",
  className = "",
  children,
  ...rest
}: PanelProps<T>) {
  const Tag: ElementType = as ?? "div";
  return (
    <Tag className={`card-chunk ${TONE[tone]} ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
