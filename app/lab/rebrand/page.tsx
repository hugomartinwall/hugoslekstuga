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
 * Compare index for the three full-rebrand candidates. Each links to a
 * self-contained prototype route: specimen strip, mini-homepage
 * vignette, a skinned Focus panel (identical mock content across all
 * three, so the A/B is honest), and a live mini-Hugo.
 */
const DIRECTIONS: Direction[] = [
  {
    slug: "lordagsmorgon",
    name: "Lördagsmorgon",
    subtitle: "Saturday-morning cel",
    concept:
      "The UI is a hand-animated cartoon: boiling ink outlines, 12fps squash-and-stretch, halftone shadows, motion smears and dust puffs.",
    hugo: "A drawn ink circle with stick limbs — he walks, sprints, stretches like taffy.",
    homepage:
      "Recess: the swarm survives as bouncing cel balls on a playground that draws itself in.",
    swatches: [
      "#F5402C",
      "#2B5DF5",
      "#FFC800",
      "#FF4F9A",
      "#2FB25B",
      "#7A3FF2",
      "#FF7A1A",
      "#29B6E8",
    ],
    swatchBg: "#DDF1FA",
    swatchText: "#17233B",
  },
  {
    slug: "nattoppet",
    name: "Nattöppet",
    subtitle: "Phosphor arcade",
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
  {
    slug: "sommarstuga",
    name: "Sommarstuga",
    subtitle: "Folk-pop cottage",
    concept:
      "Lekstuga taken literally: a little red cottage rendered as mid-century Swedish graphic design. No dark mode — painted rooms; every route floods its own wall colour.",
    hugo: "A tomte — the dot under a falu-red hat. Shy: peeks from trim, tidies while you're away.",
    homepage:
      "The cottage facade: tools are white-trim windows that light up warm on hover.",
    swatches: [
      "#B3402E",
      "#274E8D",
      "#33684B",
      "#D9A441",
      "#8FA3B0",
      "#C2455C",
      "#2E4B42",
      "#E8A13C",
    ],
    swatchBg: "#F7F3E8",
    swatchText: "#23201A",
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
