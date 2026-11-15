import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROOM_MEDIA,
  ROOM_MIN_HEIGHT_REM,
  ROOM_MIN_WIDTH_REM,
} from "../../lib/home-layout";

/**
 * The homepage is a room or a list, and two things decide which: the
 * script (matchMedia(ROOM_MEDIA) in HomeShell mounts the swarm) and the
 * stylesheet (the `room:` and `list:` variants show one wrapper and hide
 * the other). If the two ever asked different questions, a window between
 * the two answers would get the swarm under the list, or an empty room.
 *
 * The numbers live in lib/home-layout.ts. A stylesheet cannot import
 * them, so app/globals.css carries a copy of the query, and nothing else
 * stops the copy drifting from the constant. This does, in the manner of
 * the mascot's copies (test/site/mascot-copies.test.ts).
 */

const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

/** The media query a `@custom-variant <name> (@media <query>);` line holds. */
function variant(name: string): string {
  const m = css.match(
    new RegExp(`^@custom-variant ${name} \\(@media (.+)\\);$`, "m"),
  );
  if (!m) throw new Error(`no @custom-variant ${name} in app/globals.css`);
  return m[1];
}

describe("room or list: the stylesheet's copy of the question", () => {
  it("ROOM_MEDIA is built from the two constants, in rem and in px", () => {
    // The px pair is the rem pair at the usual 16px a rem: the floor for
    // a browser set to smaller text (the room is laid out in px).
    expect(ROOM_MEDIA).toBe(
      `(min-width: ${ROOM_MIN_WIDTH_REM}rem) and (min-height: ${ROOM_MIN_HEIGHT_REM}rem)` +
        ` and (min-width: ${ROOM_MIN_WIDTH_REM * 16}px) and (min-height: ${ROOM_MIN_HEIGHT_REM * 16}px)`,
    );
  });

  it("`room:` is ROOM_MEDIA, word for word", () => {
    expect(variant("room")).toBe(ROOM_MEDIA);
  });

  it("`list:` is its exact opposite", () => {
    // `not all and <query>` negates the whole query, in the syntax every
    // browser has. (Tailwind's own `not-room:` would write
    // `not (a) and (b)`, which is not a valid query.)
    expect(variant("list")).toBe(`not all and ${ROOM_MEDIA}`);
  });

  it("each variant is defined once", () => {
    expect(css.match(/^@custom-variant room /gm)).toHaveLength(1);
    expect(css.match(/^@custom-variant list /gm)).toHaveLength(1);
  });

  it("nothing on the homepage is shown or hidden by `md:`, or styled by `not-room:`", () => {
    // `md:` knows the width only, so a layout switched with it would show
    // in windows the script calls the other layout. (`md:` for anything
    // else, a font size in a wide list, is not this test's business.)
    const display =
      /(^|\s)(max-)?md:(hidden|block|flex|grid|contents|inline|inline-block|inline-flex)(\s|$)/;
    for (const file of [
      "components/HomeShell.tsx",
      "components/HomeList.tsx",
      "components/ConditionalFooter.tsx",
    ]) {
      // The code only: the prose in comments may name these classes.
      const src = readFileSync(join(__dirname, "..", "..", file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // Every string in it: a class list in JSX, or one handed on as a prop.
      const classes = [...src.matchAll(/["'`]([^"'`\n]*)["'`]/g)]
        .map((m) => m[1])
        .join(" ");
      expect(classes, file).not.toMatch(display);
      expect(classes, file).not.toMatch(/(^|\s)not-room:/);
    }
  });
});

describe("room or list: the question survives the production build", () => {
  // Next's minifier once folded ROOM_MEDIA, written as two template
  // literals joined with `+`, into "(min-height: 35 and (min-width: ...":
  // "rem)" was lost, matchMedia never matched, and every built page
  // showed an empty room. The dev server does not minify, so only a run
  // of the same minifier over the file can catch it.
  it("Next's SWC minifier keeps ROOM_MEDIA whole", async () => {
    const require = createRequire(import.meta.url);
    const swc = require("next/dist/build/swc/index.js") as {
      loadBindings?: () => Promise<unknown>;
      transform: (src: string, opts: object) => Promise<{ code: string }>;
    };
    await swc.loadBindings?.();
    const file = join(__dirname, "..", "..", "lib", "home-layout.ts");
    const { code } = await swc.transform(readFileSync(file, "utf8"), {
      filename: "home-layout.ts",
      jsc: {
        parser: { syntax: "typescript" },
        target: "es2022",
        minify: { compress: true, mangle: true },
      },
      minify: true,
      module: { type: "es6" },
    });
    expect(code).toContain(ROOM_MEDIA);
  });
});
