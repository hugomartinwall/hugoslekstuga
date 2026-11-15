import { ICON_SIZE, iconRuns, type PixelIconName } from "@/lib/pixel-icons";

/**
 * One of the site's 12×12 pixel icons, as crisp SVG rects in the
 * current text colour. Decorative by default (aria-hidden); pass
 * `label` when the icon is the only thing naming a control.
 *
 * `size` is the rendered edge in px. Multiples of 12 land every cell on
 * whole pixels.
 */
export default function PixelIcon({
  name,
  size = 24,
  label,
  className,
}: {
  name: PixelIconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {iconRuns(name).map((r) => (
        <rect key={`${r.y}-${r.x}`} x={r.x} y={r.y} width={r.w} height={1} />
      ))}
    </svg>
  );
}
