import type { Metadata } from "next";
import { Chivo_Mono, Jersey_15, Silkscreen } from "next/font/google";
import Client from "./Client";

/**
 * NATTÖPPET — phosphor-arcade rebrand prototype (direction 02 of 03).
 * Server wrapper: loads the three direction fonts as CSS variables so
 * the client skin can reference them without touching house tokens.
 */

const display = Jersey_15({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-arc-display",
});

const pixel = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-arc-pixel",
});

const body = Chivo_Mono({
  subsets: ["latin"],
  variable: "--font-arc-body",
});

export const metadata: Metadata = { title: "Lab — Nattöppet" };

export default function NattoppetPage() {
  return (
    <div className={[display.variable, pixel.variable, body.variable].join(" ")}>
      <Client />
    </div>
  );
}
