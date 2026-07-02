import type { Metadata } from "next";
import { Familjen_Grotesk, Fraunces } from "next/font/google";
import Client from "./Client";

// Fraunces: the sign-painter's serif. SOFT + WONK cranked at black weights
// is the whole point of this direction — hand-painted-sign energy.
const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-stg-display",
});

// Familjen Grotesk — a Swedish foundry's grotesk for the small print.
const body = Familjen_Grotesk({
  subsets: ["latin"],
  variable: "--font-stg-body",
});

export const metadata: Metadata = {
  title: "Lab — Sommarstuga",
};

export default function SommarstugaLabPage() {
  return (
    <div className={`${display.variable} ${body.variable}`}>
      <Client />
    </div>
  );
}
