// Picture df9f3ea0: the fingerprint of what lib/og.tsx draws for this page. The image's address is a hash of this file alone, so a new picture needs its new fingerprint here (test/site says which) to get a new address.
import { renderToolOG, OG_SIZE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Survival Maxx — Hugos Lekstuga";

export default function Image() {
  return renderToolOG("survival-maxx");
}
