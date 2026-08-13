import { CREAM_HEX, INK_HEX } from "@/lib/colors";
import { drawHugoSprite, withAlpha } from "@/lib/hugo/sprite";
import type { Rect } from "./ui-layout";
import { pulse, reducedMotion } from "./motion";

/**
 * Every piece of chrome, painted on canvas — title, cards, shop, pause,
 * settings, help, credits. Each draw function records the tappable rects
 * it painted into `hits`, which the input layer hit-tests; keyboard nav
 * moves `sel` over the same list, so mouse, touch and arrows always agree.
 */

export type GameFonts = { display: string; pixel: string };

export type Hit = { id: string; rect: Rect };

export type ScreenCtx = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  fonts: GameFonts;
  now: number;
  hits: Hit[];
};

const LINE = "rgba(232,242,233,0.16)";
const PANEL = "#1e2136";
const MUTED = "#8e97a8";

export function px(s: ScreenCtx, size: number): string {
  return `${Math.round(size)}px ${s.fonts.pixel}`;
}
export function disp(s: ScreenCtx, size: number): string {
  return `${Math.round(size)}px ${s.fonts.display}`;
}

/** A stepped-corner panel — the notch language, drawn by hand. */
export function panel(s: ScreenCtx, x: number, y: number, w: number, h: number, step = 8): void {
  const { ctx } = s;
  ctx.fillStyle = PANEL;
  ctx.beginPath();
  ctx.moveTo(x + step, y);
  ctx.lineTo(x + w - step, y);
  ctx.lineTo(x + w - step, y + step);
  ctx.lineTo(x + w, y + step);
  ctx.lineTo(x + w, y + h - step);
  ctx.lineTo(x + w - step, y + h - step);
  ctx.lineTo(x + w - step, y + h);
  ctx.lineTo(x + step, y + h);
  ctx.lineTo(x + step, y + h - step);
  ctx.lineTo(x, y + h - step);
  ctx.lineTo(x, y + step);
  ctx.lineTo(x + step, y + step);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();
}

export function dim(s: ScreenCtx, alpha = 0.72): void {
  s.ctx.fillStyle = withAlpha(CREAM_HEX, alpha);
  s.ctx.fillRect(0, 0, s.w, s.h);
}

function text(s: ScreenCtx, str: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "center"): void {
  s.ctx.font = font;
  s.ctx.fillStyle = color;
  s.ctx.textAlign = align;
  s.ctx.textBaseline = "middle";
  s.ctx.fillText(str, x, y);
}

/** A keycap-style button row item. Returns its rect and records the hit. */
export function button(s: ScreenCtx, id: string, label: string, x: number, y: number, w: number, selected: boolean, accent: string): Rect {
  const h = 34;
  const r: Rect = { x: x - w / 2, y: y - h / 2, w, h };
  const { ctx } = s;
  ctx.fillStyle = selected ? accent : PANEL;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = selected ? accent : LINE;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  // Chunky drop shadow.
  ctx.fillStyle = "#05060c";
  ctx.fillRect(r.x, r.y + h, r.w, 3);
  text(s, label, x, y + 1, px(s, 13), selected ? CREAM_HEX : INK_HEX);
  s.hits.push({ id, rect: r });
  return r;
}

// -----------------------------------------------------------------------

export function drawTitle(s: ScreenCtx, sel: number, hasSave: boolean, accent: string, worldsCleared: number, heroName = "dot"): void {
  const { w, h } = s;
  const cx = w / 2;
  text(s, "hugos lekstuga presents", cx, h * 0.22, px(s, 12), MUTED);
  const bob = reducedMotion() ? 0 : pulse(s.now, 3200) * 3;
  text(s, "ADVENTURE", cx, h * 0.32 + bob, disp(s, Math.min(84, w / 6.2)), INK_HEX);
  text(s, "one sword. ten worlds.", cx, h * 0.32 + Math.min(84, w / 6.2) * 0.62 + bob, px(s, 13), MUTED);

  drawHugoSprite(s.ctx, {
    x: cx,
    y: h * 0.52,
    px: 4,
    accent,
    eye: { open: true, wide: false, dx: 0, dy: 0 },
    feet: reducedMotion() ? 0 : (((s.now / 260) | 0) % 2) as 0 | 1,
    bobY: 0,
  });

  // Narrow screens get the short form — the keycap is not a marquee.
  const n = Math.min(10, worldsCleared + 1);
  const continueLabel = w < 480 ? `${heroName} — adventure ${n}` : `continue — ${heroName}'s adventure ${n}`;
  const items: [string, string][] = hasSave
    ? [
        ["continue", continueLabel],
        ["map", "the map"],
        ["new", "new adventure"],
        ["help", "how to play"],
        ["exit", "back to the playhouse"],
      ]
    : [["new", "begin"], ["help", "how to play"], ["exit", "back to the playhouse"]];
  items.forEach(([id, label], i) => {
    button(s, id, label, cx, h * 0.66 + i * 46, Math.min(320, w - 60), sel === i, accent);
  });
}

export type Card = {
  kicker?: string;
  title: string;
  lines: string[];
  footer?: string;
};

export function drawCard(s: ScreenCtx, card: Card, accent: string, confirmable: boolean): void {
  dim(s, 0.8);
  const { w, h } = s;
  const cx = w / 2;
  const cy = h / 2;
  if (card.kicker) text(s, card.kicker, cx, cy - 72, px(s, 13), accent);
  text(s, card.title, cx, cy - 26, disp(s, Math.min(52, w / 9)), INK_HEX);
  card.lines.forEach((line, i) => {
    text(s, line, cx, cy + 26 + i * 22, px(s, 13), MUTED);
  });
  if (card.footer && confirmable) {
    const blink = reducedMotion() || (s.now / 600) % 2 < 1.4;
    if (blink) text(s, card.footer, cx, cy + 26 + card.lines.length * 22 + 34, px(s, 11), accent);
    s.hits.push({ id: "confirm", rect: { x: 0, y: 0, w, h } });
  }
}

// -----------------------------------------------------------------------

export type ShopView = {
  items: { id: string; name: string; desc: string; price: number; verb: boolean; affordable: boolean }[];
  sel: number;
  coins: number;
  line: string;
  discount: boolean;
  flash: string | null; // "bought" | "broke" quip
};

export function drawShop(s: ScreenCtx, shop: ShopView, accent: string): void {
  dim(s, 0.86);
  const { w, h } = s;
  const cx = w / 2;
  const pw = Math.min(430, w - 24);
  const ph = Math.min(360, h - 60);
  const pxX = cx - pw / 2;
  const pxY = (h - ph) / 2;
  panel(s, pxX, pxY, pw, ph);

  text(s, "VÄXEL", cx, pxY + 26, disp(s, 30), accent);
  text(s, shop.flash ?? shop.line, cx, pxY + 50, px(s, 10.5), MUTED);
  if (shop.discount) text(s, "-10%", pxX + pw - 34, pxY + 24, px(s, 11), accent);

  const listTop = pxY + 72;
  const rowH = Math.min(44, (ph - 140) / Math.max(1, shop.items.length));
  shop.items.forEach((item, i) => {
    const y = listTop + i * rowH;
    const selRow = shop.sel === i;
    const r: Rect = { x: pxX + 10, y: y - 2, w: pw - 20, h: rowH - 4 };
    if (selRow) {
      s.ctx.fillStyle = withAlpha(accent, 0.16);
      s.ctx.fillRect(r.x, r.y, r.w, r.h);
      s.ctx.strokeStyle = accent;
      s.ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    const nameCol = item.verb ? accent : INK_HEX;
    text(s, `${item.verb ? "★ " : ""}${item.name}`, r.x + 10, y + 12, px(s, 12), item.affordable ? nameCol : MUTED, "left");
    if (selRow) text(s, item.desc, r.x + 10, y + 27, px(s, 9.5), MUTED, "left");
    text(s, `${item.price}¢`, r.x + r.w - 10, y + 12, px(s, 12), item.affordable ? INK_HEX : MUTED, "right");
    s.hits.push({ id: `shop:${item.id}`, rect: r });
  });
  if (shop.items.length === 0) {
    text(s, "shelf's bare. you did that.", cx, listTop + 30, px(s, 12), MUTED);
  }

  text(s, `you have ${shop.coins}¢`, cx, pxY + ph - 52, px(s, 12), INK_HEX);
  button(s, "leave", "leave the stall", cx, pxY + ph - 24, 200, shop.sel === shop.items.length, accent);
}

// -----------------------------------------------------------------------

export function drawPause(s: ScreenCtx, sel: number, accent: string): void {
  dim(s);
  const cx = s.w / 2;
  text(s, "PAUSED", cx, s.h * 0.3, disp(s, 44), INK_HEX);
  const items: [string, string][] = [
    ["resume", "resume"],
    ["settings", "settings"],
    ["help", "how to play"],
    ["restart", "restart this adventure"],
    ["quit", "back to the playhouse"],
  ];
  items.forEach(([id, label], i) => {
    button(s, id, label, cx, s.h * 0.42 + i * 46, Math.min(320, s.w - 60), sel === i, accent);
  });
}

export type SettingsView = {
  music: number; // 0-3
  sfx: number;
  motion: string; // "auto" | "on" | "off"
  sel: number;
};

export function drawSettings(s: ScreenCtx, v: SettingsView, accent: string): void {
  dim(s);
  const cx = s.w / 2;
  text(s, "SETTINGS", cx, s.h * 0.28, disp(s, 40), INK_HEX);
  const rows: [string, string][] = [
    ["music", `music  ${"▮".repeat(v.music)}${"▯".repeat(3 - v.music)}`],
    ["sfx", `sfx    ${"▮".repeat(v.sfx)}${"▯".repeat(3 - v.sfx)}`],
    ["motion", `motion  ${v.motion === "auto" ? "follow system" : v.motion === "on" ? "reduced" : "full"}`],
    ["back", "back"],
  ];
  rows.forEach(([id, label], i) => {
    button(s, id, label, cx, s.h * 0.4 + i * 48, Math.min(340, s.w - 60), v.sel === i, accent);
  });
  text(s, "reduced motion never changes the game's timings.", cx, s.h * 0.4 + 4 * 48 + 10, px(s, 10), MUTED);
}

export const CONTROL_LINES = [
  "move — wasd or arrows",
  "sword — space or j (hold to charge, once learned)",
  "roll — shift or k",
  "daggers q · parry e · dash r · whirlwind f",
  "bomb g · flash v · overclock x · flask c",
  "pause — esc or p · mute — m",
  "on touch: stick on the left, buttons on the right",
] as const;

export function drawHelp(s: ScreenCtx, accent: string): void {
  dim(s);
  const cx = s.w / 2;
  text(s, "HOW TO PLAY", cx, s.h * 0.2, disp(s, 36), INK_HEX);
  text(s, "fight through ten worlds. buy what helps. mind the telegraphs.", cx, s.h * 0.2 + 34, px(s, 11), MUTED);
  CONTROL_LINES.forEach((line, i) => {
    text(s, line, cx, s.h * 0.34 + i * 26, px(s, 11.5), INK_HEX);
  });
  button(s, "back", "back", cx, s.h * 0.34 + CONTROL_LINES.length * 26 + 34, 180, true, accent);
}

// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// Character creation — pick a colour, name the hero.
// -----------------------------------------------------------------------

export type CreateView = {
  step: "color" | "name";
  colorIdx: number; // index into COLOR_ORDER
  colorHexes: string[]; // resolved swatch colours, same order
  name: string;
  touch: boolean; // show the tappable letter grid
  nameMax: number;
};

export function drawCreate(s: ScreenCtx, v: CreateView): void {
  const { w, h } = s;
  const cx = w / 2;
  const accent = v.colorHexes[v.colorIdx];

  text(s, "new adventure", cx, h * 0.1, px(s, 12), MUTED);
  text(s, v.step === "color" ? "WHO'S GOING?" : "AND THEIR NAME?", cx, h * 0.17, disp(s, Math.min(44, w / 10)), INK_HEX);

  // The hero, live, in the chosen colour.
  drawHugoSprite(s.ctx, {
    x: cx,
    y: h * 0.34,
    px: 5,
    accent,
    eye: { open: true, wide: v.step === "name", dx: 0, dy: 0 },
    feet: reducedMotion() ? 0 : ((((s.now / 300) | 0) % 2) as 0 | 1),
    bobY: 0,
  });

  if (v.step === "color") {
    // 8 swatches in a row (2×4 on narrow screens).
    const perRow = w < 480 ? 4 : 8;
    const size = 40;
    const gap = 14;
    const rows = Math.ceil(v.colorHexes.length / perRow);
    v.colorHexes.forEach((hex, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, v.colorHexes.length - row * perRow);
      const rowW = inRow * size + (inRow - 1) * gap;
      const x = cx - rowW / 2 + (i % perRow) * (size + gap);
      const y = h * 0.5 + row * (size + gap) - (rows > 1 ? (size + gap) / 2 : 0);
      s.ctx.fillStyle = hex;
      s.ctx.fillRect(x, y, size, size);
      if (i === v.colorIdx) {
        s.ctx.strokeStyle = INK_HEX;
        s.ctx.lineWidth = 2;
        s.ctx.strokeRect(x - 4, y - 4, size + 8, size + 8);
      }
      s.hits.push({ id: `swatch:${i}`, rect: { x: x - 6, y: y - 6, w: size + 12, h: size + 12 } });
    });
    button(s, "next", "next", cx, h * 0.5 + rows * (size + gap) + 34, 200, true, accent);
    text(s, "arrows to browse · enter to keep going", cx, h * 0.5 + rows * (size + gap) + 68, px(s, 10), MUTED);
  } else {
    // The name field.
    const fw = Math.min(300, w - 60);
    const fy = h * 0.47;
    s.ctx.fillStyle = PANEL;
    s.ctx.fillRect(cx - fw / 2, fy, fw, 40);
    s.ctx.strokeStyle = accent;
    s.ctx.strokeRect(cx - fw / 2 + 0.5, fy + 0.5, fw - 1, 39);
    const caret = !reducedMotion() && ((s.now / 500) | 0) % 2 === 0 && v.name.length < v.nameMax;
    text(s, v.name + (caret ? "_" : ""), cx, fy + 21, px(s, 16), INK_HEX);

    if (v.touch) {
      // A–Z grid + erase + done for thumbs.
      const letters = "abcdefghijklmnopqrstuvwxyz".split("");
      const cols = 7;
      const cell = Math.min(44, (w - 40) / cols);
      const gridW = cols * cell;
      const gx = cx - gridW / 2;
      const gy = fy + 58;
      letters.forEach((ch, i) => {
        const x = gx + (i % cols) * cell;
        const y = gy + Math.floor(i / cols) * cell;
        s.ctx.fillStyle = PANEL;
        s.ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        text(s, ch, x + cell / 2, y + cell / 2 + 1, px(s, 13), INK_HEX);
        s.hits.push({ id: `char:${ch}`, rect: { x, y, w: cell, h: cell } });
      });
      // Erase + done on the last row.
      const lastY = gy + 3 * cell;
      const eraseX = gx + 5 * cell;
      s.ctx.fillStyle = PANEL;
      s.ctx.fillRect(eraseX + 2, lastY + 2, cell * 2 - 4, cell - 4);
      text(s, "erase", eraseX + cell, lastY + cell / 2 + 1, px(s, 11), MUTED);
      s.hits.push({ id: "erase", rect: { x: eraseX, y: lastY, w: cell * 2, h: cell } });
      button(s, "done", "begin", cx, gy + 4 * cell + 30, 200, true, accent);
    } else {
      text(s, "type it. enter when it's them.", cx, fy + 62, px(s, 11), MUTED);
      button(s, "done", "begin", cx, fy + 104, 200, true, accent);
    }
  }
}

// -----------------------------------------------------------------------
// The world map — ten adventures on one winding road.
// -----------------------------------------------------------------------

export type MapNode = {
  world: number;
  name: string; // "?????" while locked
  accent: string;
  state: "locked" | "cleared" | "current";
};

export type MapView = {
  nodes: MapNode[];
  sel: number;
  heroAccent: string;
  heroName: string;
  introLine: string | null; // the selected world's card line, if reached
};

export function drawMap(s: ScreenCtx, v: MapView): void {
  const { w, h } = s;
  const cx = w / 2;
  text(s, `${v.heroName}'s adventure`, cx, h * 0.1, px(s, 12), MUTED);
  text(s, "THE ROAD SO FAR", cx, h * 0.17, disp(s, Math.min(40, w / 10)), INK_HEX);

  // Serpentine: two rows of five, the path snaking right then left.
  const perRow = 5;
  const usableW = Math.min(w - 80, 640);
  const stepX = usableW / (perRow - 1);
  const x0 = cx - usableW / 2;
  const rowY = [h * 0.36, h * 0.56];
  const pos = (i: number) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = row % 2 === 0 ? x0 + col * stepX : x0 + (perRow - 1 - col) * stepX;
    return { x, y: rowY[row] };
  };

  // The road: dotted segments between consecutive nodes.
  s.ctx.fillStyle = withAlpha(INK_HEX, 0.25);
  for (let i = 0; i < v.nodes.length - 1; i++) {
    const a = pos(i);
    const b = pos(i + 1);
    const steps = 8;
    for (let t = 1; t < steps; t++) {
      const x = a.x + ((b.x - a.x) * t) / steps;
      const y = a.y + ((b.y - a.y) * t) / steps;
      s.ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
  }

  v.nodes.forEach((node, i) => {
    const { x, y } = pos(i);
    const r = 17;
    const locked = node.state === "locked";
    s.ctx.fillStyle = locked ? PANEL : node.accent;
    s.ctx.beginPath();
    s.ctx.arc(x, y, r, 0, Math.PI * 2);
    s.ctx.fill();
    if (i === v.sel) {
      const ringR = r + 5 + (reducedMotion() ? 0 : pulse(s.now, 1200) * 1.5);
      s.ctx.strokeStyle = INK_HEX;
      s.ctx.lineWidth = 2;
      s.ctx.beginPath();
      s.ctx.arc(x, y, ringR, 0, Math.PI * 2);
      s.ctx.stroke();
    }
    text(s, locked ? "?" : String(node.world), x, y + 1, px(s, 13), locked ? MUTED : CREAM_HEX);
    if (node.state === "cleared") {
      s.ctx.fillStyle = INK_HEX;
      s.ctx.fillRect(x + r - 6, y - r - 2, 8, 8);
      text(s, "✓", x + r - 2, y - r + 2, px(s, 8), CREAM_HEX);
    }
    if (node.state === "current") {
      drawHugoSprite(s.ctx, {
        x,
        y: y - r - 20,
        px: 2,
        accent: v.heroAccent,
        eye: { open: true, wide: false, dx: 0, dy: 1 },
        feet: reducedMotion() ? 0 : ((((s.now / 320) | 0) % 2) as 0 | 1),
        bobY: 0,
      });
    }
    if (!locked) {
      s.hits.push({ id: `node:${i}`, rect: { x: x - 24, y: y - 24, w: 48, h: 48 } });
    }
  });

  // The selected node's plaque.
  const selNode = v.nodes[v.sel];
  const plaqueY = h * 0.72;
  text(s, `ADVENTURE ${selNode.state === "locked" ? "?" : selNode.world}`, cx, plaqueY, px(s, 11), selNode.state === "locked" ? MUTED : selNode.accent);
  text(s, selNode.name, cx, plaqueY + 24, disp(s, 26), selNode.state === "locked" ? MUTED : INK_HEX);
  if (v.introLine) text(s, v.introLine, cx, plaqueY + 48, px(s, 10.5), MUTED);

  const mainLabel = selNode.state === "current" ? "onward" : selNode.state === "cleared" ? "replay (nothing banked)" : "locked";
  if (selNode.state !== "locked") {
    button(s, "go", mainLabel, cx - 90, h * 0.9, 220, true, selNode.accent);
  }
  button(s, "back", "back", cx + (selNode.state !== "locked" ? 110 : 0), h * 0.9, selNode.state !== "locked" ? 120 : 200, false, v.heroAccent);
}

export type CreditsView = {
  receipt: { name: string; price: number }[];
  footer: readonly string[];
  extraLine: string | null;
  deaths: number;
  soldTo: string;
  t: number; // ms since credits started
};

export function drawCredits(s: ScreenCtx, v: CreditsView, accent: string): void {
  const { w, h } = s;
  s.ctx.fillStyle = CREAM_HEX;
  s.ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const scroll = reducedMotion() ? 0 : Math.max(0, v.t / 40 - 40);
  let y = h * 0.3 - scroll;
  const row = (str: string, color = INK_HEX, size = 11) => {
    if (y > -20 && y < h + 20) text(s, str, cx, y, px(s, size), color);
    y += 24;
  };
  text(s, "ADVENTURE", cx, Math.max(40, h * 0.12 - scroll * 0.3), disp(s, 40), accent);
  y = Math.max(90, h * 0.24 - scroll * 0.3) + 10;
  row("· receipt ·", MUTED, 10);
  row(`sold to: ${v.soldTo}`, MUTED, 10);
  y += 6;
  for (const item of v.receipt) {
    row(`${item.name}  ····  ${item.price}¢`);
  }
  if (v.receipt.length === 0) row("(no purchases. one sword. respect.)", MUTED);
  y += 10;
  for (const line of v.footer) row(line, MUTED);
  if (v.extraLine) row(v.extraLine, accent, 10.5);
  y += 10;
  row(`deaths: ${v.deaths}`, MUTED, 10);
  y += 20;
  drawHugoSprite(s.ctx, {
    x: cx,
    y: Math.min(h - 60, y),
    px: 3,
    accent,
    eye: { open: true, wide: true, dx: 0, dy: 0 },
    sparklePhase: reducedMotion() ? 0 : ((s.now / 300) | 0) % 2,
  });
  button(s, "done", "back to the arcade", cx, h - 34, 240, true, accent);
}
