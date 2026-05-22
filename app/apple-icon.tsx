import { ImageResponse } from "next/og";
import { renderHugoIcon } from "@/lib/hugo-icon";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon. iOS home-screen icon shown when a user adds
 * hugoslekstuga.com to their Home Screen via Safari. Rendered as
 * the canonical static Hugo lockup (tomato disc + cream eyes on
 * cream background) — see `lib/hugo-icon.tsx` for the proportions
 * shared with the favicon and the PWA manifest icon.
 */
export default function AppleIcon() {
  return new ImageResponse(renderHugoIcon(size.width), { ...size });
}
