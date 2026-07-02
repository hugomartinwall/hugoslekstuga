import Link from "next/link";

type Experiment = {
  slug: string;
  title: string;
  blurb: string;
};

/**
 * The lab index. New prototypes get listed here so the directory is
 * scannable. Each entry is just a card-chunk link to /lab/<slug>.
 */
const EXPERIMENTS: Experiment[] = [
  {
    slug: "rebrand",
    title: "Rebrand directions",
    blurb:
      "Three full-skin candidates: Lördagsmorgon (cartoon cel), Nattöppet (phosphor arcade), Sommarstuga (folk cottage). Pick one; the site rebuilds around it.",
  },
  {
    slug: "logo",
    title: "Logo directions",
    blurb:
      "Two side-by-side: dot-as-character (the recommended bet) vs evolved mark (the foil).",
  },
];

export default function LabIndex() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl">
          Lab
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          A scratch surface for prototyping design directions before any of
          it touches the shipped site. Nothing here is indexed; in
          production these routes return 404.
        </p>
      </header>

      <ul className="mt-10 grid grid-cols-1 gap-3">
        {EXPERIMENTS.map((e) => (
          <li key={e.slug}>
            <Link
              href={`/lab/${e.slug}`}
              className="card-chunk flex items-start gap-4 rounded-[var(--radius-card)] bg-cream p-5 transition-colors hover:bg-cream-deep"
            >
              <span
                aria-hidden
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-yellow font-display text-xl font-extrabold text-ink"
              >
                ✱
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl font-extrabold leading-tight tracking-tight">
                  {e.title}
                </p>
                <p className="text-sm text-ink-soft">{e.blurb}</p>
              </div>
              <span className="text-xs font-semibold text-ink-muted">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
