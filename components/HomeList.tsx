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
import Tag from "@/components/ui/Tag";

/**
 * The homepage on a phone, and in any window too small for the room.
 *
 * A phone cannot hold fifteen labelled things and a title in one
 * floating swarm, and neither can a phone held sideways or a short
 * desktop window. Under 48rem of width or 35rem of height (the `list:`
 * variant, ROOM_MEDIA in lib/home-layout.ts) the homepage is a short
 * scrolling page built from the same parts: the pixel title as a
 * banner, the games as cabinet cards with their screens playing, and
 * the tools as a three-by-three pad of keycaps in their own colours.
 *
 * Everything here is a real link in the server-rendered HTML — it
 * works before (and without) JavaScript, and it is what a crawler
 * reads. No swarm physics and no parkour run on this layout.
 *
 * It is in the page while the room shows too (display:none), so nothing
 * in it may keep working unseen: the banner and the cabinet screens
 * stop by themselves, and the pad's jolt checks that there is a pad.
 */
export default function HomeList({
  powerOn,
  jolt,
  notice,
  children,
}: {
  powerOn: boolean;
  /** Bumped by the forbidden button: the pad takes the hit. */
  jolt: number;
  /** A line for the visitor that comes and goes (the retired-tool quip).
   *  It takes the hint's place under the title while it is there. */
  notice?: ReactNode;
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
    // The button was pressed in the room: this pad is not on screen.
    if (pad.offsetWidth === 0) return;
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
    // The list ignores the pointer for its first moment. A key on another
    // page that leads here ("Back home" on the 404) sits where the game
    // cards open, and the second tap of a double tap used to open a game.
    <div className="press-guard mx-auto w-full max-w-xl px-4 pb-2">
      {/* The title, as a banner. The corner mascot sits over its top-left
          margin, so the banner starts a little way down. */}
      <div className="relative mt-12 h-44">
        <PixelWordmark powerOn={powerOn} banner />
      </div>
      <div className="relative mt-1">
        <p
          aria-hidden
          className="press-blink label-pixel text-center tracking-[0.3em]"
        >
          press any tool
        </p>
        {/* The notice lies over the hint and takes no room of its own:
            nothing below moves when it comes, or when it goes seven
            seconds later (a card that slid under a thumb would open the
            wrong game). It used to stand in front of the keys row at the
            bottom of the page, a screen or two below where anyone was
            looking, and pushed that row down and up again.
            There is room for it here, in the band between the title's
            letters and the Games heading: about 92px on a phone, and the
            notice is three lines at its longest (76px, at 320 to 390px
            wide). The hint's line is not in the middle of that band, so
            the notice is centred 6px above it and keeps 8px on either
            side at its tallest. */}
        {notice ? (
          <div className="pointer-events-none absolute inset-x-0 top-[calc(50%-6px)] z-10 flex h-0 items-center justify-center">
            <div className="fade-rise">{notice}</div>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="home-games" className="mt-8">
        <h2 id="home-games" className="label-pixel">
          Games
        </h2>
        {/* One height for all four (auto-rows-fr): on the narrowest phones
            the "new" tag drops under its game's name and made that one
            card taller than the rest. */}
        <ul className="mt-2.5 grid auto-rows-fr gap-3">
          {games.map((t) => (
            <li key={t.slug}>
              {/* No prefetch, here or on the pad below: the whole list is
                  in view on a phone, so every route (with the games' and
                  the chart's stylesheets) would load in the background. */}
              <Link
                href={pathFor(t.slug)}
                prefetch={false}
                className="card-chunk flex h-full items-center gap-4 bg-cream-deep p-3"
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
                      <Tag tone="solid" className="px-1.5 py-0.5">
                        new
                      </Tag>
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
        {/* Nine keys of one size, icons on one line. A name that needs two
            lines ("Spin the Wheel" on most phones) used to make its own
            key taller and, with the contents centred, lift its icon above
            its neighbours'. Now every row takes the tallest key's height
            (auto-rows-fr), and a key is laid out from the top down: the
            icon a fixed 16px in, the name under it, the spare room below. */}
        <ul ref={padRef} className="mt-2.5 grid auto-rows-fr grid-cols-3 gap-2.5">
          {kit.map((t) => (
            <li key={t.slug}>
              <Link
                href={pathFor(t.slug)}
                prefetch={false}
                className="btn-chunk flex h-full min-h-24 flex-col items-center gap-2 px-1.5 pt-4 pb-3 text-center text-cream"
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
