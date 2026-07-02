import type { Metadata } from "next";
import { Nunito, Shantell_Sans } from "next/font/google";
import Client from "./Client";

/**
 * Lördagsmorgon — "Saturday-morning cel" rebrand direction.
 *
 * The whole prototype is skinned inside `.skin-sat` (see Client.tsx);
 * this wrapper only supplies the two typefaces as CSS variables so the
 * skin never touches the house fonts:
 *
 *   Shantell Sans (variable, with the BNCE bounce axis) → --font-sat-display
 *   Nunito                                              → --font-sat-body
 */
const display = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-sat-display",
  axes: ["BNCE"],
});

const body = Nunito({
  subsets: ["latin"],
  variable: "--font-sat-body",
});

export const metadata: Metadata = {
  title: "Lab — Lördagsmorgon",
};

export default function LordagsmorgonPage() {
  return (
    <div className={`${display.variable} ${body.variable}`}>
      <Client />
    </div>
  );
}
