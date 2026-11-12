import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rules that keep Knuff's simulation pure, read off the sources
 * instead of remembered.
 *
 * The simulation (sim/, content/ and, when they are built, bots/) is a
 * fixed 60 Hz step over plain data. That is what lets a bot stand in for
 * a hand, a stored night be picked up again and the aim line be the game
 * itself run on a copy; and it is lost the first time someone reaches for
 * the built-in random or a clock inside it. That is a one-line mistake
 * nobody would see in review.
 *
 * Everything is found from this file's own place, so the suite checks
 * whatever tree it is run in.
 */

const LIB = new URL("../../lib/knuff", import.meta.url).pathname;
const ROUTE = new URL("../../app/games/knuff", import.meta.url).pathname;
/** The folders that hold the pure part. `bots` is checked from the day it exists. */
const PURE = ["sim", "content", "bots"];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const read = (p: string): string => readFileSync(p, "utf8");
const rel = (p: string): string => p.slice(LIB.length + 1);
const inPure = (p: string): boolean => PURE.some((dir) => p.startsWith(join(LIB, dir) + sep));

const libFiles = filesUnder(LIB);
const pureFiles = libFiles.filter(inPure);
const shellFiles = libFiles.filter((f) => !inPure(f));
const routeFiles = filesUnder(ROUTE);

// ── Reading a source ──────────────────────────────────────────────────

type Source = {
  /** The source with its comments taken out. Strings are as written. */
  plain: string;
  /** The same with every string emptied, so prose in a string cannot trip a rule about code. */
  code: string;
  /** What each string literal holds. */
  strings: string[];
};

/** One pass over a source: comments out, strings collected. (None of these files holds a regular expression.) */
function scan(src: string): Source {
  let plain = "";
  let code = "";
  const strings: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      plain += " ";
      code += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let text = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") {
          text += src[j + 1] ?? "";
          j += 2;
        } else {
          text += src[j];
          j++;
        }
      }
      strings.push(text);
      plain += src.slice(i, j + 1);
      code += c + c;
      i = j + 1;
    } else {
      plain += c;
      code += c;
      i++;
    }
  }
  return { plain, code, strings };
}

/** Every module a source names: `from "x"`, `import "x"`, `import("x")`, `require("x")`. */
function specifiers(plain: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
  for (const m of plain.matchAll(re)) out.push(m[2]);
  return out;
}

/** The part of a source that runs when the module is loaded: everything outside a bracket of any kind. */
function topLevel(code: string): string {
  let depth = 0;
  let out = "";
  for (const c of code) {
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

const DOM =
  /\b(window|document|navigator|globalThis|self|localStorage|sessionStorage|indexedDB|matchMedia|requestAnimationFrame|cancelAnimationFrame|addEventListener|setTimeout|setInterval|HTMLElement|HTMLCanvasElement|CanvasRenderingContext2D|ResizeObserver|AudioContext)\b/;
const CLOCK_OR_CHANCE = /\bMath\s*\.\s*random\b|\bDate\b|\bperformance\b|\bcrypto\b/;
const NETWORK = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bimportScripts\b/;
const STORAGE = /\b(localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b/;

describe("the reader these checks lean on", () => {
  it("takes comments out and keeps what strings hold", () => {
    const s = scan(`const a = "one // not a comment"; // gone\n/* gone too: window */ const b = 'it\\'s'; const c = \`x\${a}\`;`);
    expect(s.strings).toEqual(["one // not a comment", "it's", "x${a}"]);
    expect(s.plain).not.toMatch(/gone/);
    expect(s.code).not.toMatch(/one|not a comment/);
    expect(s.code).toMatch(/const a = ""/);
  });

  it("finds every way a module is named", () => {
    const plain = scan(
      `import a from "./a";\nimport type { B } from '../b';\nexport { c } from "./c";\nimport "./side";\nconst d = await import("./d");\nconst e = require("./e");`,
    ).plain;
    expect(specifiers(plain)).toEqual(["./a", "../b", "./c", "./side", "./d", "./e"]);
  });

  it("tells what runs at load from what waits inside a function", () => {
    const top = topLevel(scan(`const a = 1;\nfunction f() { return window.innerWidth; }\nconst g = { h: document };\nwindow.x = 2;`).code);
    expect(top).toMatch(/window/);
    expect(top).not.toMatch(/innerWidth|document/);
  });
});

describe("the simulation is pure", () => {
  it("has files to check", () => {
    // Without this the whole block passes on an empty folder.
    expect(pureFiles.map(rel)).toEqual(expect.arrayContaining([join("sim", "step.ts"), join("sim", "state.ts"), join("content", "tune.ts")]));
    expect(pureFiles.length).toBeGreaterThanOrEqual(7);
  });

  it("uses only relative imports, and none of them leaves the pure folders", () => {
    const bad: string[] = [];
    for (const f of pureFiles) {
      for (const spec of specifiers(scan(read(f)).plain)) {
        if (!spec.startsWith("./") && !spec.startsWith("../")) {
          bad.push(`${rel(f)} imports "${spec}"`);
          continue;
        }
        const target = resolve(dirname(f), spec);
        if (!PURE.some((dir) => target.startsWith(join(LIB, dir) + sep))) bad.push(`${rel(f)} imports "${spec}"`);
      }
    }
    expect(bad, "sim/, content/ and bots/ import nothing from render/, audio/, input/, the app or a package").toEqual([]);
  });

  it("never touches the page, the window or a timer", () => {
    const bad = pureFiles.filter((f) => DOM.test(scan(read(f)).code));
    expect(bad.map(rel)).toEqual([]);
  });

  it("never asks for a random number or the time", () => {
    const bad = pureFiles.filter((f) => CLOCK_OR_CHANCE.test(scan(read(f)).code));
    expect(bad.map(rel), "random numbers come from sim/rng.ts; time is the tick count").toEqual([]);
  });

  it("the rules above can see what they are looking for", () => {
    // A rule that cannot fail proves nothing: each is shown the thing it forbids.
    expect(DOM.test(scan("const w = window.innerWidth;").code)).toBe(true);
    expect(DOM.test(scan("document.title = 'x';").code)).toBe(true);
    expect(DOM.test(scan("localStorage.getItem('k');").code)).toBe(true);
    expect(CLOCK_OR_CHANCE.test(scan("const r = Math.random();").code)).toBe(true);
    expect(CLOCK_OR_CHANCE.test(scan("const t = Date.now();").code)).toBe(true);
    expect(CLOCK_OR_CHANCE.test(scan("const t = performance.now();").code)).toBe(true);
    // And prose about a rule is not a breach of it.
    expect(DOM.test(scan("// never read window here\nconst a = 'document';").code)).toBe(false);
    expect(CLOCK_OR_CHANCE.test(scan("/* no Math.random */ const update = 1;").code)).toBe(false);
  });
});

describe("loading the engine does nothing", () => {
  it("has a shell to check", () => {
    expect(shellFiles.map(rel)).toEqual(expect.arrayContaining(["game.ts", "loop.ts", join("input", "pointer.ts"), join("render", "renderer.ts")]));
  });

  it("no file reaches for the page, a timer or storage outside a function", () => {
    // Importing game.ts under Node (a test, a script, the server's render
    // of the client page) must be free of side effects, and so must every
    // file it pulls in.
    const bad: string[] = [];
    for (const f of libFiles) {
      const top = topLevel(scan(read(f)).code);
      const hit = DOM.exec(top) ?? STORAGE.exec(top);
      if (hit) bad.push(`${rel(f)}: ${hit[0]} at the top level`);
    }
    expect(bad).toEqual([]);
  });

  it("game.ts can be imported under Node wherever the site's @/ alias resolves", async () => {
    let engine: { createKnuff?: unknown };
    try {
      engine = await import("../../lib/knuff/game");
    } catch (err) {
      // game.ts reaches the mascot's painter, which imports through "@/".
      // A tree whose vitest config does not resolve that alias cannot load
      // it, and the check above stands in. Any other failure is a failure.
      expect(String(err)).toMatch(/@\/lib\//);
      return;
    }
    expect(typeof engine.createKnuff).toBe("function");
    expect("__knuff" in globalThis).toBe(false);
  });
});

describe("nothing leaves the device", () => {
  const everything = [...libFiles, ...routeFiles];

  it("no file asks the network for anything", () => {
    const bad = everything.filter((f) => NETWORK.test(scan(read(f)).code));
    expect(bad).toEqual([]);
  });

  it("no file holds an address on the network", () => {
    const bad = everything.filter((f) => scan(read(f)).strings.some((s) => /\b(https?|wss?):\/\//i.test(s) || /^\/\//.test(s)));
    expect(bad).toEqual([]);
  });

  it("storage is touched through save.ts and nowhere else", () => {
    const bad = everything.filter((f) => !f.endsWith(join("knuff", "save.ts")) && STORAGE.test(scan(read(f)).code));
    expect(bad, "the five keys of the game live behind lib/knuff/save.ts").toEqual([]);
  });

  it("every key the game names is its own", () => {
    // Strings under the site's prefix are storage keys or events. A key
    // must be the game's; the two events the game may send are the site's.
    const EVENTS = ["hugoslekstuga:hugo-stage", "hugoslekstuga:hugo-happy"];
    const named = everything.flatMap((f) => scan(read(f)).strings.filter((s) => s.startsWith("hugoslekstuga:")));
    const foreign = named.filter((s) => !s.startsWith("hugoslekstuga:knuff:") && !EVENTS.includes(s));
    expect(foreign).toEqual([]);
  });
});

describe("he is drawn by the site's painter", () => {
  it("the renderer calls drawHugoSprite from lib/hugo/sprite", () => {
    const renderer = scan(read(join(LIB, "render", "renderer.ts")));
    expect(renderer.plain).toMatch(/import\s*\{[^}]*\bdrawHugoSprite\b[^}]*\}\s*from\s*"@\/lib\/hugo\/sprite"/);
    expect(renderer.code).toMatch(/\bdrawHugoSprite\s*\(/);
  });

  it("the game holds no sprite of its own for him", () => {
    // His bitmap is sixteen rows of sixteen cells in lib/hugo/sprite.ts and nowhere else.
    const rows = /^[.bhsw]{16}$/;
    const bad = libFiles.filter((f) => scan(read(f)).strings.some((s) => rows.test(s)));
    expect(bad.map(rel)).toEqual([]);
  });
});

describe("nothing the player reads names the mascot", () => {
  /**
   * His internal name is for code and comments. It must not appear, as a
   * whole word and in any case, in anything a player can read: every
   * string in content/, the HUD and game.ts, and the route's text and
   * labels. Storage keys, event names and the names of modules do not
   * count: nobody reads those.
   */
  const NAME = /\bhugo\b/i;
  const readable = (f: string): string[] => {
    const s = scan(read(f));
    const modules = new Set(specifiers(s.plain));
    return s.strings.filter((text) => !modules.has(text) && !text.startsWith("hugoslekstuga:"));
  };

  const spoken = [...filesUnder(join(LIB, "content")), join(LIB, "render", "hud.ts"), join(LIB, "game.ts")];

  it("has words to check", () => {
    const words = spoken.flatMap(readable);
    expect(words).toEqual(expect.arrayContaining(["PULL BACK. LET GO.", "turn the phone upright"]));
    expect(words.some((w) => w.startsWith("Knuff, an arcade game."))).toBe(true);
  });

  it("the rule can see the name, and does not mistake the site's name for it", () => {
    expect(NAME.test("Fling Hugo across the room")).toBe(true);
    expect(NAME.test("HUGO")).toBe(true);
    expect(NAME.test("hugo's night")).toBe(true);
    expect(NAME.test("Knuff — Hugos Lekstuga")).toBe(false);
    expect(NAME.test("hugoslekstuga")).toBe(false);
  });

  it("no string in content/, the HUD or game.ts", () => {
    const bad = spoken.flatMap((f) => readable(f).filter((text) => NAME.test(text)).map((text) => `${rel(f)}: "${text}"`));
    expect(bad).toEqual([]);
  });

  describe.skipIf(routeFiles.length === 0)("the route", () => {
    it("has the two files of the route", () => {
      const names = routeFiles.map((f) => f.slice(ROUTE.length + 1));
      expect(names).toEqual(expect.arrayContaining(["Client.tsx", "page.tsx"]));
    });

    it("no string, label or line of text in the route's files", () => {
      const bad: string[] = [];
      for (const f of routeFiles) {
        for (const text of readable(f)) if (NAME.test(text)) bad.push(`${f.slice(ROUTE.length + 1)}: "${text}"`);
        // What is written between tags is read too: check the code with its
        // strings out, less the names of things (identifiers have no spaces
        // round them; a word of text does).
        const s = scan(read(f));
        for (const line of s.code.split("\n")) {
          if (/(^|\s)hugo(\s|[.,!?]|$)/i.test(line)) bad.push(`${f.slice(ROUTE.length + 1)}: ${line.trim()}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it("the page is a client page that mounts through the factory and cleans up", () => {
      const client = scan(read(join(ROUTE, "Client.tsx")));
      expect(read(join(ROUTE, "Client.tsx")).trimStart().startsWith('"use client";')).toBe(true);
      expect(client.code).toMatch(/\bcreateKnuff\s*\(/);
      expect(client.code).toMatch(/\.destroy\s*\(\s*\)/);
      // The page lock is a class, put on and taken off: no inline overflow saved and restored.
      expect(client.code).toMatch(/classList\s*\.\s*add\s*\(/);
      expect(client.code).toMatch(/classList\s*\.\s*remove\s*\(/);
      expect(client.strings).toContain("game-open");
      expect(client.code).not.toMatch(/style\s*\.\s*overflow/);
    });
  });
});
