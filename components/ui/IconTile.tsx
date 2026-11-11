import PixelIcon from "@/components/PixelIcon";
import type { PixelIconName } from "@/lib/pixel-icons";

/**
 * A pixel icon on a stepped tile in the accent colour: the mark a tool
 * or a game wears next to its name (the tool page's title row, a search
 * result, a suggestion card).
 *
 * The tile is `--accent`, so set that on the tile or an ancestor
 * (`style={accentVars(tool.color)}`); inside a tool page it is already
 * the tool's colour. Two sizes only, so the tiles around the site do
 * not drift apart:
 *   md   36px tile, 24px icon (default)
 *   lg   48px tile, 36px icon
 */
export default function IconTile({
  name,
  size = "md",
  className = "",
}: {
  name: PixelIconName;
  size?: "md" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <span
      aria-hidden
      className={`notch-sm flex shrink-0 items-center justify-center bg-(--accent) text-cream ${
        lg ? "h-12 w-12" : "h-9 w-9"
      } ${className}`.trim()}
    >
      <PixelIcon name={name} size={lg ? 36 : 24} />
    </span>
  );
}
