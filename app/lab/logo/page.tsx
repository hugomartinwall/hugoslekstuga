import Client from "./Client";

export const metadata = {
  title: "Logo directions",
  description: "Two side-by-side prototypes for the worked-through logo.",
};

/**
 * Side-by-side prototypes for the logo polish pass.
 *
 *   Direction 1 — "dot-as-character": form stays a coloured period, but
 *   the dot gains *behaviour*. Eyes appear when the cursor passes near
 *   it; it pulses idle; it travels to the nav when you click a tool
 *   on the swarm.
 *
 *   Direction 2 — "evolved mark": the dot becomes a more developed
 *   graphic mark (a coloured disc with a single cream window), keeping
 *   the colour-cycling but trading behaviour for *shape*.
 *
 * The page is a comparison surface only — neither direction touches
 * production. Hugo picks before phase B-2.
 */
export default function LogoLabPage() {
  return <Client />;
}
