import { ImageResponse } from "next/og";
import { renderHugoIcon } from "@/lib/hugo-icon";

export const runtime = "nodejs";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * 512×512 raster icon for the PWA manifest (Android add-to-home,
 * desktop install splash). The PWA spec prefers raster at this size;
 * the SVG at `app/icon.svg` covers everything else.
 *
 * File is named `icon0.tsx` — not `icon-large.tsx` — because Next's
 * metadata route matcher only recognises `icon` followed by an
 * optional single digit (see
 * `next/dist/lib/metadata/is-metadata-route.js`, `variantsMatcher =
 * '\\d?'`). Naming it `icon-large` would silently skip routing.
 */
export default function IconLarge() {
  return new ImageResponse(renderHugoIcon(size.width), { ...size });
}
