import Link from "next/link";
import PixelIcon from "@/components/PixelIcon";
import IconTile from "@/components/ui/IconTile";
import Panel from "@/components/ui/Panel";

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
    slug: "kit",
    title: "The v2 kit",
    blurb: "Keycaps, chips, fields, sliders, panels and icons on one bench.",
  },
];

export default function LabIndex() {
  return (
    <div className="page-col px-5 py-14 sm:px-8 sm:py-20">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl leading-[0.95] sm:text-6xl">
          Lab
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          A scratch surface for prototyping design directions before any of
          it touches the shipped site. Nothing here is indexed; in
          production these routes return 404.
        </p>
      </header>

      {EXPERIMENTS.length === 0 && (
        <p className="mt-10 text-sm text-ink-muted">
          The bench is clear — nothing being prototyped right now.
        </p>
      )}

      <ul className="mt-10 grid grid-cols-1 gap-3">
        {EXPERIMENTS.map((e) => (
          <li key={e.slug}>
            <Panel
              as={Link}
              href={`/lab/${e.slug}`}
              className="flex items-center gap-4 p-5"
            >
              {/* The spark is the kit's stand-in icon, on the lab's acid. */}
              <IconTile name="advice" size="lg" className="bg-yellow" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl leading-none">{e.title}</p>
                <p className="mt-1 text-sm leading-snug text-ink-soft">
                  {e.blurb}
                </p>
              </div>
              <PixelIcon
                name="forward"
                size={12}
                className="shrink-0 text-ink-muted"
              />
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
