import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Lab — Rebrand directions",
};

type Direction = {
  slug: string;
  name: string;
  subtitle: string;
  concept: string;
  hugo: string;
  homepage: string;
  swatches: string[];
  swatchBg: string;
  swatchText: string;
};

/**
 * Rebrand A/B — decided. Nattöppet won (2026-07-02) and is rolling out
 * across the shipped site; the losing prototypes (Lördagsmorgon,
 * Sommarstuga) were deleted per the lab lifecycle rule — they live on
 * in git history at commit 37d4360. The winner's route stays as the
 * reference implementation until the rollout lands, then this whole
 * /lab/rebrand tree goes too.
 */
const DIRECTIONS: Direction[] = [
  {
    slug: "nattoppet",
    name: "Nattöppet",
    subtitle: "Phosphor arcade — THE WINNER",
    concept:
      "The lekstuga after dark: a tiny arcade open all night. Dark-only, warm phosphor glow, dithered gradients, quantized sprite motion, CRT power-on.",
    hugo: "A 16×16 pixel sprite — the player character. Arrow keys walk him around.",
    homepage:
      "Attract mode: glowing orbs drifting with phosphor decay trails, PRESS ANY TOOL.",
    swatches: [
      "#3DF08A",
      "#FF4FD8",
      "#35E0FF",
      "#FFB13D",
      "#D8FF3D",
      "#FF6E5E",
      "#A78BFF",
      "#8AF0FF",
    ],
    swatchBg: "#0B0C14",
    swatchText: "#E8F2E9",
  },
];

export default function RebrandIndex() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          Rebrand directions
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Three full-skin candidates, each genuinely distinct from the
          current cream-and-chunk identity. Every prototype shows the same
          Focus panel with identical content so the comparison is honest.
          Pick one; the whole site rebuilds around it.
        </p>
      </header>

      <ul className="mt-10 grid grid-cols-1 gap-4">
        {DIRECTIONS.map((d) => (
          <li key={d.slug}>
            <Link
              href={`/lab/rebrand/${d.slug}`}
              className="card-chunk block overflow-hidden rounded-[var(--radius-card)] bg-cream transition-colors hover:bg-cream-deep"
            >
              <div
                className="flex items-center gap-2 border-b-2 border-ink px-5 py-3"
                style={{ background: d.swatchBg }}
              >
                {d.swatches.map((hex) => (
                  <span
                    key={hex}
                    aria-hidden
                    className="h-5 w-5 shrink-0 rounded-full border-2"
                    style={{ background: hex, borderColor: d.swatchText }}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-2 p-5">
                <p className="font-display text-2xl font-extrabold leading-tight tracking-tight">
                  {d.name}
                  <span className="ml-2 text-base font-bold text-ink-muted">
                    {d.subtitle}
                  </span>
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">
                  {d.concept}
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">
                  <strong className="font-semibold text-ink">Hugo:</strong>{" "}
                  {d.hugo}
                </p>
                <p className="text-sm leading-relaxed text-ink-soft">
                  <strong className="font-semibold text-ink">Homepage:</strong>{" "}
                  {d.homepage}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
