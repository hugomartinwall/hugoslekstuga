"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { tools } from "@/lib/tools";
import { isGameSlug, pathFor } from "@/lib/clusters";
import { COLOR_HEX } from "@/lib/colors";
import { iconForSlug } from "@/lib/pixel-icons";
import PixelIcon from "@/components/PixelIcon";
import PixelWordmark from "@/components/PixelWordmark";
import CabinetCanvas from "@/components/CabinetCanvas";

/**
 * The homepage on a phone.
 *
 * A phone cannot hold fifteen labelled things and a title in one
 * floating swarm, so below 768px the homepage is a short scrolling
 * page built from the same parts: the pixel title as a banner, the
 * games as cabinet cards with their screens playing, and the tools as
 * a three-by-three pad of keycaps in their own colours.
 *
 * Everything here is a real link in the server-rendered HTML — it
 * works before (and without) JavaScript, and it is what a crawler
 * reads. No swarm physics and no parkour run on this layout.
 */
export default function HomeList({
  powerOn,
  jolt,
  children,
}: {
  powerOn: boolean;
  /** Bumped by the forbidden button: the pad takes the hit. */
  jolt: number;
  /** The keys row (search, about, the forbidden button). */
  children?: ReactNode;
}) {
  const games = tools.filter((t) => isGameSlug(t.slug));
  const kit = tools.filter((t) => !isGameSlug(t.slug));
  const padRef = useRef<HTMLUListElement>(null);
  const seenJolt = useRef(jolt);

  // DO NOT PRESS, phone edition: there is no swarm to blow apart, so
  // every key on the pad jumps off its spot and snaps back.
  useEffect(() => {
    if (jolt === seenJolt.current) return;
    seenJolt.current = jolt;
    const pad = padRef.current;
    if (!pad) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of Array.from(pad.children) as HTMLElement[]) {
      const dx = (Math.random() - 0.5) * 36;
      const dy = -8 - Math.random() * 30;
      const rot = (Math.random() - 0.5) * 16;
      el.animate(
        [
          { transform: "translate(0, 0) rotate(0)" },
          { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, offset: 0.35 },
          { transform: "translate(0, 0) rotate(0)" },
        ],
        { duration: 440 + Math.random() * 160, easing: "steps(7, end)" },
      );
    }
  }, [jolt]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-2">
      {/* The title, as a banner. The corner mascot sits over its top-left
          margin, so the banner starts a little way down. */}
      <div className="relative mt-12 h-44">
        <PixelWordmark powerOn={powerOn} banner />
      </div>
      <p
        aria-hidden
        className="press-blink label-pixel mt-1 text-center tracking-[0.3em]"
      >
        press any tool
      </p>

      <section aria-labelledby="home-games" className="mt-8">
        <h2 id="home-games" className="label-pixel">
          Games
        </h2>
        <ul className="mt-2.5 grid gap-3">
          {games.map((t) => (
            <li key={t.slug}>
              <Link
                href={pathFor(t.slug)}
                className="card-chunk flex items-center gap-4 bg-cream-deep p-3"
              >
                <CabinetCanvas
                  slug={t.slug}
                  accent={COLOR_HEX[t.color]}
                  unit={2}
                  className="shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-3xl leading-none text-ink">
                      {t.title}
                    </span>
                    {t.isNew ? (
                      <span className="bg-ink px-1.5 font-pixel text-[9px] leading-[14px] tracking-[0.08em] text-cream uppercase">
                        new
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm leading-snug text-ink-soft">
                    {t.tagline}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="home-tools" className="mt-9">
        <h2 id="home-tools" className="label-pixel">
          Tools
        </h2>
        <ul ref={padRef} className="mt-2.5 grid grid-cols-3 gap-2.5">
          {kit.map((t) => (
            <li key={t.slug}>
              <Link
                href={pathFor(t.slug)}
                className="btn-chunk flex h-full min-h-24 flex-col items-center justify-center gap-2 px-1.5 pt-3 pb-4 text-center text-cream"
                style={{ backgroundColor: COLOR_HEX[t.color] }}
              >
                <PixelIcon name={iconForSlug(t.slug, false)} size={36} />
                <span className="text-xs leading-tight font-bold">
                  {t.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {children}
    </div>
  );
}
