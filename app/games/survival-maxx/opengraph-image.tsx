import { renderToolOG, OG_SIZE } from "@/lib/og";

export const runtime = "nodejs";
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Survival Maxx — Hugos Lekstuga";

export default function Image() {
  return renderToolOG("survival-maxx");
}
