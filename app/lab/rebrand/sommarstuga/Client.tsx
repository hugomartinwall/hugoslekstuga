"use client";

/**
 * SOMMARSTUGA — rebrand direction prototype.
 *
 * Lekstuga taken literally: a little red Swedish playhouse, rendered as
 * bold mid-century Swedish graphic design (Eksell / Frank / Lindberg),
 * not tourist twee. Painted rooms, trim-white structure, snickarglädje
 * edging, and a shy tomte for a caretaker.
 *
 * Everything is namespaced under .skin-stg — no house tokens leak in.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";

/* ---------------------------------------------------------------- data */

const WALLS = [
  { name: "Falu", hex: "#B3402E", deep: "#8A2F20" },
  { name: "Kurbits", hex: "#274E8D", deep: "#1B3A6C" },
  { name: "Cabinet", hex: "#33684B", deep: "#254D37" },
  { name: "Ochre", hex: "#D9A441", deep: "#B08128" },
  { name: "Gustavian", hex: "#8FA3B0", deep: "#6E8290" },
  { name: "Lingon", hex: "#C2455C", deep: "#9A3448" },
  { name: "Pine", hex: "#2E4B42", deep: "#20362F" },
  { name: "Marigold", hex: "#E8A13C", deep: "#C07E22" },
];

// The six survivor tools as rooms behind the facade windows.
const ROOMS = [
  { name: "Advice", glyph: "✶", color: "#C2455C", deep: "#9A3448" },
  { name: "Focus", glyph: "◴", color: "#274E8D", deep: "#1B3A6C" },
  { name: "Roll", glyph: "◐", color: "#D9A441", deep: "#B08128" },
  { name: "Breathe", glyph: "⊚", color: "#2E4B42", deep: "#20362F" },
  { name: "Sudoku", glyph: "#", color: "#33684B", deep: "#254D37" },
  { name: "Sjökort", glyph: "◎", color: "#8FA3B0", deep: "#6E8290" },
];

/* ----------------------------------------------------------------- css */

const css = `
.skin-stg {
  --stg-falu: #B3402E;
  --stg-falu-deep: #8A2F20;
  --stg-kurbits: #274E8D;
  --stg-kurbits-deep: #1B3A6C;
  --stg-cabinet: #33684B;
  --stg-cabinet-deep: #254D37;
  --stg-ochre: #D9A441;
  --stg-ochre-deep: #B08128;
  --stg-gustavian: #8FA3B0;
  --stg-gustavian-deep: #6E8290;
  --stg-lingon: #C2455C;
  --stg-lingon-deep: #9A3448;
  --stg-pine: #2E4B42;
  --stg-pine-deep: #20362F;
  --stg-marigold: #E8A13C;
  --stg-marigold-deep: #C07E22;
  --stg-trim: #F7F3E8;
  --stg-birch: #EFE6D2;
  --stg-birch-deep: #DCCBA9;
  --stg-ink: #23201A;
  --stg-dusk: #241D15;
  --stg-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --stg-ease-pop: cubic-bezier(0.34, 1.3, 0.42, 1);
  --stg-snickar: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='16'%3E%3Cpath fill='%23F7F3E8' fill-rule='evenodd' d='M0 0h26v5H0z M3 5h20v3a10 7 0 0 1-20 0z M13 11.7a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z'/%3E%3C/svg%3E");
  --stg-grain-img: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.3' numOctaves='3' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.6 0.6 0.6 0 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23p)'/%3E%3C/svg%3E");
  background: var(--stg-falu);
  color: var(--stg-trim);
  font-family: var(--font-stg-body), ui-sans-serif, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: clip;
}

/* ------------------------------------------------- rooms + entrance.
   Load order is carpentry order: trim draws in first (structure),
   then the paint coat fades over the birch undercoat, then the
   furniture settles with a tiny overshoot. */
.skin-stg .stg-room {
  position: relative;
  overflow: hidden;
  background: var(--stg-birch);
  padding: clamp(56px, 9vw, 104px) clamp(20px, 5vw, 56px);
}
.skin-stg .stg-room::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--wall);
  opacity: 0;
  transition: opacity 800ms var(--stg-ease) 260ms;
}
.skin-stg .stg-room.is-in::before { opacity: 1; }
.skin-stg .stg-grain {
  position: absolute;
  inset: 0;
  z-index: 1;
  opacity: 0.04;
  pointer-events: none;
  background-image: var(--stg-grain-img);
}
.skin-stg .stg-room-trim {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 16px;
  z-index: 3;
  background-image: var(--stg-snickar);
  background-repeat: repeat-x;
  background-size: 26px 16px;
  transform: scaleX(0);
  transform-origin: 0 50%;
  transition: transform 700ms var(--stg-ease);
}
.skin-stg .stg-room.is-in .stg-room-trim { transform: scaleX(1); }
.skin-stg .stg-furniture {
  position: relative;
  z-index: 2;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 600ms var(--stg-ease) 540ms, transform 750ms var(--stg-ease-pop) 540ms;
}
.skin-stg .stg-room.is-in .stg-furniture { opacity: 1; transform: none; }
.skin-stg .stg-roomlabel {
  margin: 0 0 28px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--stg-trim);
  opacity: 0.7;
  text-align: center;
}

/* ------------------------------------------------------ shared bits */
.skin-stg .stg-edge {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 16px;
  background-image: var(--stg-snickar);
  background-repeat: repeat-x;
  background-size: 26px 16px;
  pointer-events: none;
}
.skin-stg .stg-panel {
  --under: var(--stg-birch-deep);
  position: relative;
  background: var(--stg-birch);
  border: 4px solid var(--stg-trim);
  border-radius: 6px;
  box-shadow: 10px 10px 0 var(--wall-deep);
  color: var(--stg-ink);
}
.skin-stg .stg-mitre::before {
  content: "";
  position: absolute;
  inset: -4px;
  z-index: 4;
  pointer-events: none;
  background-image:
    linear-gradient(45deg, transparent 45%, rgba(35, 32, 26, 0.28) 48%, rgba(35, 32, 26, 0.28) 52%, transparent 55%),
    linear-gradient(135deg, transparent 45%, rgba(35, 32, 26, 0.28) 48%, rgba(35, 32, 26, 0.28) 52%, transparent 55%),
    linear-gradient(135deg, transparent 45%, rgba(35, 32, 26, 0.28) 48%, rgba(35, 32, 26, 0.28) 52%, transparent 55%),
    linear-gradient(45deg, transparent 45%, rgba(35, 32, 26, 0.28) 48%, rgba(35, 32, 26, 0.28) 52%, transparent 55%);
  background-position: 0 0, 100% 0, 0 100%, 100% 100%;
  background-size: 10px 10px;
  background-repeat: no-repeat;
}

/* wooden-tag buttons */
.skin-stg .stg-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  font-family: var(--font-stg-body), ui-sans-serif, system-ui, sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--stg-ink);
  background: var(--stg-trim);
  border: 2px solid var(--stg-ink);
  border-radius: 8px;
  box-shadow: 4px 4px 0 var(--under);
  cursor: pointer;
  transition: transform 180ms var(--stg-ease), box-shadow 180ms var(--stg-ease);
}
.skin-stg .stg-btn::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 2px solid var(--stg-ink);
  opacity: 0.5;
}
.skin-stg button.stg-btn:hover,
.skin-stg .stg-btn.is-hover {
  transform: translate(-1px, -1px) rotate(-0.5deg);
  box-shadow: 5px 5px 0 var(--under), 0 0 26px rgba(232, 161, 60, 0.4);
}
.skin-stg button.stg-btn:active,
.skin-stg .stg-btn.is-pressed {
  transform: translate(4px, 4px);
  box-shadow: 0 0 0 var(--under);
}
.skin-stg .stg-btn:focus-visible,
.skin-stg .stg-noise:focus-visible,
.skin-stg .stg-back:focus-visible {
  outline: 3px solid var(--stg-marigold);
  outline-offset: 3px;
}

/* recessed painted inputs; focus = marigold lamplight */
.skin-stg .stg-label {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--stg-ink);
}
.skin-stg .stg-input {
  width: 100%;
  font-family: var(--font-stg-body), ui-sans-serif, system-ui, sans-serif;
  font-size: 15px;
  color: var(--stg-ink);
  background: var(--stg-birch-deep);
  border: 3px solid var(--stg-trim);
  border-radius: 6px;
  padding: 10px 14px;
  box-shadow: inset 3px 3px 0 rgba(35, 32, 26, 0.1);
  transition: box-shadow 220ms var(--stg-ease);
}
.skin-stg .stg-input::placeholder { color: rgba(35, 32, 26, 0.4); }
.skin-stg .stg-input:focus {
  outline: none;
  box-shadow: inset 3px 3px 0 rgba(35, 32, 26, 0.1), 0 0 0 3px var(--stg-marigold), 0 0 28px 4px rgba(232, 161, 60, 0.45);
}

/* --------------------------------------------------------- 1 · hero */
.skin-stg .stg-hero { min-height: 58vh; display: flex; }
.skin-stg .stg-hero .stg-furniture {
  width: 100%;
  display: grid;
  place-items: center;
  min-height: 44vh;
}
.skin-stg .stg-hero-inner { text-align: center; }
.skin-stg .stg-h1 {
  margin: 0;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 900;
  font-variation-settings: "SOFT" 100, "WONK" 1;
  font-size: clamp(3rem, 11vw, 6.75rem);
  line-height: 0.95;
  letter-spacing: -0.015em;
  color: var(--stg-trim);
  text-shadow: 0.04em 0.05em 0 var(--wall-deep);
}
.skin-stg .stg-swash {
  display: block;
  width: clamp(210px, 38vw, 340px);
  height: auto;
  margin: 14px auto 0;
}
.skin-stg .stg-swash-stroke { stroke-dasharray: 1; stroke-dashoffset: 1; }
.skin-stg .stg-room.is-in .stg-swash-stroke {
  animation: stg-draw 1100ms var(--stg-ease) 600ms forwards;
}
.skin-stg .stg-swash-leaf,
.skin-stg .stg-swash-dot { opacity: 0; }
.skin-stg .stg-room.is-in .stg-swash-leaf,
.skin-stg .stg-room.is-in .stg-swash-dot {
  animation: stg-fadein 500ms var(--stg-ease) 1450ms forwards;
}
.skin-stg .stg-lede {
  margin: 24px auto 0;
  max-width: 46ch;
  font-size: clamp(1rem, 2vw, 1.125rem);
  opacity: 0.92;
}
.skin-stg .stg-corner {
  position: absolute;
  top: 12px;
  left: 12px;
  width: clamp(64px, 12vw, 136px);
  height: auto;
  pointer-events: none;
}
.skin-stg .stg-corner.is-flip {
  left: auto;
  right: 12px;
  transform: scaleX(-1);
}

/* ---------------------------------------------------- 2 · specimens */
.skin-stg .stg-specimen {
  max-width: 880px;
  margin: 0 auto;
  padding: clamp(40px, 6vw, 56px) clamp(24px, 5vw, 48px) clamp(28px, 5vw, 44px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.skin-stg .stg-spec-h {
  margin: 22px 0 4px;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 900;
  font-variation-settings: "SOFT" 100, "WONK" 1;
  font-size: 1.45rem;
  color: var(--stg-ink);
}
.skin-stg .stg-spec-h:first-of-type { margin-top: 0; }
.skin-stg .stg-chips {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 16px;
}
.skin-stg .stg-chip { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.skin-stg .stg-chip-swatch {
  display: block;
  height: 62px;
  border: 3px solid var(--stg-trim);
  border-radius: 4px;
}
.skin-stg .stg-chip-name { font-weight: 700; line-height: 1.1; }
.skin-stg .stg-chip-hex {
  font-size: 12px;
  letter-spacing: 0.04em;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.skin-stg .stg-type-display {
  margin: 0;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 900;
  font-variation-settings: "SOFT" 100, "WONK" 1;
  font-size: clamp(2rem, 5vw, 2.9rem);
  line-height: 1.05;
  color: var(--stg-ink);
}
.skin-stg .stg-type-caption { margin: 0; font-size: 13px; opacity: 0.6; }
.skin-stg .stg-type-body { margin: 6px 0 0; max-width: 58ch; line-height: 1.55; }
.skin-stg .stg-btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  align-items: flex-start;
  margin-top: 6px;
}
.skin-stg .stg-btnwrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.skin-stg .stg-btnwrap i {
  font-style: normal;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.55;
}
.skin-stg .stg-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 320px;
  margin-top: 10px;
}
.skin-stg .stg-card {
  position: relative;
  max-width: 460px;
  margin-top: 8px;
  background: var(--stg-gustavian);
  border: 4px solid var(--stg-trim);
  border-radius: 6px;
  box-shadow: 6px 6px 0 var(--stg-gustavian-deep);
  padding: 34px 22px 20px;
  color: var(--stg-trim);
  transition: transform 220ms var(--stg-ease), box-shadow 220ms var(--stg-ease);
}
.skin-stg .stg-card:hover {
  transform: rotate(0.5deg) translateY(-2px);
  box-shadow: 7px 8px 0 var(--stg-gustavian-deep), 0 0 34px rgba(232, 161, 60, 0.35);
}
.skin-stg .stg-card h3 {
  margin: 0 0 8px;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 800;
  font-variation-settings: "SOFT" 100, "WONK" 1;
  font-size: 1.3rem;
}
.skin-stg .stg-card p { margin: 0; font-size: 0.95rem; line-height: 1.5; opacity: 0.94; }

/* ------------------------------------------------------ 3 · facade */
.skin-stg .stg-facade { position: relative; min-height: 60vh; max-width: 900px; margin: 0 auto; }
.skin-stg .stg-gable { position: relative; width: min(440px, 82%); margin: 0 auto; }
.skin-stg .stg-gable > svg { position: relative; z-index: 1; display: block; width: 100%; height: auto; }
.skin-stg .stg-chimney {
  position: absolute;
  z-index: 0;
  left: 65%;
  top: -8%;
  width: 7%;
  height: 44%;
  background: var(--stg-falu-deep);
  border: 3px solid var(--stg-trim);
  border-bottom: none;
  border-radius: 2px 2px 0 0;
}
.skin-stg .stg-smoke {
  position: absolute;
  left: 50%;
  top: -8px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: rgba(247, 243, 232, 0.5);
  transform: translate(-50%, 0) scale(0.5);
  opacity: 0;
  animation: stg-smoke 9s ease-out infinite;
}
.skin-stg .stg-smoke.s2 { width: 12px; height: 12px; animation-delay: 3s; }
.skin-stg .stg-smoke.s3 { width: 18px; height: 18px; animation-delay: 6s; }
.skin-stg .stg-windows {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(18px, 4vw, 44px);
  max-width: 720px;
  margin: 48px auto 0;
  padding: 0 8px;
}
.skin-stg .stg-window {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: center;
  color: var(--stg-trim);
  font-family: inherit;
}
.skin-stg .stg-window:nth-child(1) { transform: translateY(12px); }
.skin-stg .stg-window:nth-child(2) { transform: translateY(-8px); }
.skin-stg .stg-window:nth-child(3) { transform: translateY(16px); }
.skin-stg .stg-window:nth-child(4) { transform: translateY(-4px); }
.skin-stg .stg-window:nth-child(5) { transform: translateY(10px); }
.skin-stg .stg-window:nth-child(6) { transform: translateY(-12px); }
.skin-stg .stg-window-frame {
  position: relative;
  display: block;
  aspect-ratio: 4 / 5;
  border: 5px solid var(--stg-trim);
  border-radius: 3px;
  background: var(--stg-dusk);
  box-shadow: 5px 5px 0 var(--wall-deep);
  overflow: hidden;
  transition: transform 240ms var(--stg-ease), box-shadow 240ms var(--stg-ease);
}
.skin-stg .stg-window-frame::before,
.skin-stg .stg-window-frame::after {
  content: "";
  position: absolute;
  z-index: 2;
  background: var(--stg-trim);
}
.skin-stg .stg-window-frame::before { top: 0; bottom: 0; left: 50%; width: 4px; margin-left: -2px; }
.skin-stg .stg-window-frame::after { left: 0; right: 0; top: 42%; height: 4px; }
.skin-stg .stg-window-light {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  background: radial-gradient(130% 100% at 50% 70%, #FFE9B4 0%, #F0BC5E 45%, rgba(36, 29, 21, 0) 80%);
  transition: opacity 320ms var(--stg-ease);
}
.skin-stg .stg-window-glyph {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  font-size: clamp(26px, 5vw, 42px);
  line-height: 1;
  color: var(--room-deep);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 320ms var(--stg-ease), transform 420ms var(--stg-ease-pop);
}
.skin-stg .stg-window:hover .stg-window-frame,
.skin-stg .stg-window:focus-visible .stg-window-frame {
  transform: rotate(0.5deg);
  box-shadow: 5px 5px 0 var(--wall-deep), 0 0 44px 8px rgba(255, 214, 130, 0.45);
}
.skin-stg .stg-window:hover .stg-window-light,
.skin-stg .stg-window:focus-visible .stg-window-light { opacity: 1; }
.skin-stg .stg-window:hover .stg-window-glyph,
.skin-stg .stg-window:focus-visible .stg-window-glyph { opacity: 1; transform: none; }
.skin-stg .stg-window:focus-visible {
  outline: 3px solid var(--stg-marigold);
  outline-offset: 4px;
  border-radius: 4px;
}
.skin-stg .stg-window-name {
  display: block;
  margin-top: 12px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.03em;
}
.skin-stg .stg-facade-hint { margin: 44px auto 0; text-align: center; font-size: 13px; opacity: 0.7; }
.skin-stg .stg-flood {
  position: absolute;
  z-index: 6;
  width: 250vmax;
  height: 250vmax;
  border-radius: 50%;
  pointer-events: none;
  animation: stg-flood 1700ms var(--stg-ease) forwards;
}
.skin-stg .stg-flood.is-reduced {
  inset: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  transform: none;
  animation: stg-floodfade 1100ms ease forwards;
}

/* ------------------------------------------- 4 · focus (blue room) */
.skin-stg .stg-focus-panel {
  max-width: 480px;
  margin: 0 auto;
  padding: 44px clamp(22px, 5vw, 40px) 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  text-align: center;
}
.skin-stg .stg-back {
  align-self: flex-start;
  font-size: 14px;
  font-weight: 600;
  color: var(--stg-ink);
  text-decoration: none;
  opacity: 0.65;
  border-bottom: 2px solid transparent;
  transition: opacity 180ms var(--stg-ease), border-color 180ms var(--stg-ease);
}
.skin-stg .stg-back:hover { opacity: 1; border-color: var(--stg-marigold); }
.skin-stg .stg-focus-title {
  margin: 0;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 900;
  font-variation-settings: "SOFT" 100, "WONK" 1;
  font-size: 2.6rem;
  color: var(--stg-ink);
}
.skin-stg .stg-focus-tagline { margin: -10px 0 0; font-size: 0.95rem; opacity: 0.7; }
.skin-stg .stg-sign { width: min(300px, 100%); transform: rotate(-1.2deg); }
.skin-stg .stg-sign-strings { display: block; width: 200px; max-width: 80%; margin: 0 auto -4px; }
.skin-stg .stg-sign-board {
  background: var(--stg-trim);
  border: 2px solid var(--stg-ink);
  border-radius: 8px;
  box-shadow: 5px 6px 0 var(--stg-birch-deep);
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.skin-stg .stg-hooks { display: flex; flex-wrap: wrap; gap: 26px; justify-content: center; }
.skin-stg .stg-hook { display: flex; flex-direction: column; align-items: center; }
.skin-stg .stg-hook-nail {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #7a7466, var(--stg-ink));
}
.skin-stg .stg-hook-string { width: 2px; height: 11px; background: var(--stg-ink); opacity: 0.65; }
.skin-stg .stg-tag {
  padding: 7px 15px;
  font-size: 14px;
  font-weight: 700;
  color: var(--stg-ink);
  background: var(--stg-trim);
  border: 2px solid var(--stg-ink);
  border-radius: 6px;
  box-shadow: 3px 3px 0 var(--stg-birch-deep);
}
.skin-stg .stg-hook:nth-child(1) .stg-tag { transform: rotate(-2.2deg); }
.skin-stg .stg-hook:nth-child(2) .stg-tag { transform: rotate(1.4deg); }
.skin-stg .stg-hook:nth-child(3) .stg-tag { transform: rotate(-1deg); }
.skin-stg .stg-tag.is-selected {
  background: var(--stg-marigold);
  box-shadow: 3px 3px 0 var(--stg-marigold-deep);
}
.skin-stg .stg-timer {
  margin: 6px 0 0;
  font-family: var(--font-stg-display), Georgia, serif;
  font-weight: 900;
  font-variation-settings: "SOFT" 100;
  font-size: clamp(3.6rem, 10vw, 5.4rem);
  line-height: 1;
  color: var(--stg-kurbits);
  text-shadow: 4px 5px 0 var(--stg-birch-deep);
}
.skin-stg .stg-btn-primary { font-size: 17px; padding: 13px 44px; }
.skin-stg .stg-noise {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 18px 8px 12px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--stg-ink);
  background: var(--stg-birch-deep);
  border: 2px solid rgba(35, 32, 26, 0.5);
  border-radius: 10px;
  box-shadow: 3px 3px 0 rgba(35, 32, 26, 0.14);
  cursor: pointer;
  transition: box-shadow 260ms var(--stg-ease);
}
.skin-stg .stg-noise.is-on {
  box-shadow: 3px 3px 0 rgba(35, 32, 26, 0.14), 0 0 30px rgba(232, 161, 60, 0.5);
}
.skin-stg .stg-stove-door { fill: #2a2620; transition: fill 240ms var(--stg-ease); }
.skin-stg .stg-noise.is-on .stg-stove-door { fill: var(--stg-marigold); }
.skin-stg .stg-noise.is-on .stg-stove { animation: stg-ember 2.4s ease-in-out infinite; }
.skin-stg .stg-focus-footer { margin: 4px 0 0; font-size: 13px; opacity: 0.6; }

/* ------------------------------------------------------- 5 · tomte */
.skin-stg .stg-stage {
  max-width: 560px;
  min-height: 250px;
  margin: 0 auto;
  overflow: hidden;
}
.skin-stg .stg-stage::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 10px;
  background: var(--stg-birch-deep);
}
.skin-stg .stg-tomte {
  position: absolute;
  right: 0;
  bottom: 8px;
  width: 104px;
  transform: translateX(110%);
  transition: transform 1100ms var(--stg-ease);
  will-change: transform;
}
.skin-stg .stg-tomte svg { display: block; width: 100%; height: auto; }
.skin-stg .stg-tomte.is-hidden {
  transform: translateX(110%);
  transition-duration: 230ms;
  transition-timing-function: cubic-bezier(0.55, 0, 0.8, 0.3);
}
.skin-stg .stg-tomte.is-peek { transform: translateX(48%); }
.skin-stg .stg-tomte.is-out { transform: translateX(-4%); transition-duration: 1500ms; }
.skin-stg .stg-eye { transform-box: fill-box; transform-origin: center; transition: transform 90ms ease; }
.skin-stg .stg-tomte.is-blink .stg-eye { transform: scaleY(0.12); }
.skin-stg .stg-gaze { transition: transform 160ms ease-out; }
.skin-stg .stg-tomte.is-look .stg-gaze { animation: stg-look 2.6s ease-in-out both; }
.skin-stg .stg-hat {
  transform-box: fill-box;
  transform-origin: 50% 92%;
  transition: transform 400ms var(--stg-ease);
}
.skin-stg .stg-tomte.is-peek .stg-hat { transform: rotate(3deg); }
.skin-stg .stg-tomte.is-tip .stg-hat { animation: stg-hattip 1s var(--stg-ease-pop); }
.skin-stg .stg-tomte-caption {
  margin: 18px auto 0;
  text-align: center;
  font-size: 13px;
  opacity: 0.7;
}

/* -------------------------------------------------------- keyframes */
@keyframes stg-draw { to { stroke-dashoffset: 0; } }
@keyframes stg-fadein { to { opacity: 1; } }
@keyframes stg-smoke {
  0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
  12% { opacity: 0.45; }
  100% { transform: translate(30%, -110px) scale(1.9); opacity: 0; }
}
@keyframes stg-flood {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
  46% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  62% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}
@keyframes stg-floodfade {
  0% { opacity: 0; }
  35% { opacity: 1; }
  65% { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes stg-ember {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(232, 161, 60, 0.55)); }
  50% { filter: drop-shadow(0 0 11px rgba(232, 161, 60, 0.9)); }
}
@keyframes stg-look {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-6px, 1px); }
  60% { transform: translate(6px, 1px); }
  100% { transform: translate(0, 0); }
}
@keyframes stg-hattip {
  0% { transform: rotate(0); }
  30% { transform: rotate(-16deg) translateY(-3px); }
  60% { transform: rotate(-9deg); }
  100% { transform: rotate(0); }
}

/* ------------------------------------------------- reduced motion */
@media (prefers-reduced-motion: reduce) {
  .skin-stg *,
  .skin-stg *::before,
  .skin-stg *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .skin-stg .stg-smoke { animation: none !important; opacity: 0.26; }
  .skin-stg .stg-smoke.s1 { transform: translate(-50%, -16px) scale(1); }
  .skin-stg .stg-smoke.s2 { transform: translate(-42%, -44px) scale(1.35); opacity: 0.16; }
  .skin-stg .stg-smoke.s3 { transform: translate(-34%, -74px) scale(1.7); opacity: 0.1; }
  .skin-stg button.stg-btn:hover,
  .skin-stg .stg-card:hover,
  .skin-stg .stg-window:hover .stg-window-frame,
  .skin-stg .stg-window:focus-visible .stg-window-frame { transform: none !important; }
  .skin-stg .stg-tomte { transition: none !important; }
  .skin-stg .stg-noise.is-on .stg-stove { animation: none !important; }
}

/* ------------------------------------------------------ small rooms */
@media (max-width: 560px) {
  .skin-stg .stg-windows { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  .skin-stg .stg-window:nth-child(odd) { transform: translateY(6px); }
  .skin-stg .stg-window:nth-child(even) { transform: translateY(-6px); }
  .skin-stg .stg-facade { min-height: 0; }
  .skin-stg .stg-chips { grid-template-columns: repeat(auto-fit, minmax(94px, 1fr)); }
  .skin-stg .stg-btn-row { gap: 16px; }
  .skin-stg .stg-hooks { gap: 16px; }
}
`;

/* --------------------------------------------------------------- hooks */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

function useInView<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

/* ----------------------------------------------------------- fittings */

function Room({
  wall,
  deep,
  label,
  className,
  children,
}: {
  wall: string;
  deep: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      className={`stg-room${inView ? " is-in" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--wall": wall, "--wall-deep": deep } as CSSProperties}
    >
      <div className="stg-grain" aria-hidden="true" />
      <div className="stg-room-trim" aria-hidden="true" />
      <div className="stg-furniture">
        {label ? <p className="stg-roomlabel">{label}</p> : null}
        {children}
      </div>
    </section>
  );
}

/** Kurbits-style swash for under the H1. Draws itself in. */
function Swash() {
  return (
    <svg className="stg-swash" viewBox="0 0 340 44" aria-hidden="true">
      <path
        className="stg-swash-stroke"
        pathLength={1}
        d="M10 26 C 70 8 130 10 170 24 C 214 39 276 34 330 14"
        fill="none"
        stroke="#F7F3E8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path className="stg-swash-leaf" d="M168 23 c -8 -13 -4 -23 9 -26 c 2 11 -2 20 -9 26 z" fill="#F7F3E8" />
      <circle className="stg-swash-dot" cx="22" cy="21" r="3" fill="#F7F3E8" />
      <circle className="stg-swash-dot" cx="318" cy="18" r="3" fill="#F7F3E8" />
    </svg>
  );
}

/** Corner vine — hero only. Ornament is rationed hard. */
function KurbitsCorner({ flip }: { flip?: boolean }) {
  return (
    <svg className={`stg-corner${flip ? " is-flip" : ""}`} viewBox="0 0 150 150" aria-hidden="true">
      <g fill="none" stroke="#F7F3E8" strokeWidth="3" strokeLinecap="round" opacity="0.8">
        <path d="M8 6 C 16 62 44 98 104 114" />
        <path d="M8 6 C 40 26 84 26 126 12" />
      </g>
      <g fill="#F7F3E8" opacity="0.8">
        <path d="M104 114 c 14 -2 24 6 26 18 c -14 2 -24 -6 -26 -18 z" />
        <path d="M52 64 c -2 -14 6 -24 18 -26 c 2 14 -6 24 -18 26 z" />
        <circle cx="126" cy="12" r="4" />
        <circle cx="118" cy="126" r="3" />
      </g>
    </svg>
  );
}

/** Gable + roofline for the facade, scallops and all. */
function Gable() {
  const scallops = Array.from({ length: 18 }, (_, i) => 24 + i * 23);
  return (
    <div className="stg-gable">
      <div className="stg-chimney" aria-hidden="true">
        <span className="stg-smoke s1" />
        <span className="stg-smoke s2" />
        <span className="stg-smoke s3" />
      </div>
      <svg viewBox="0 0 460 152" aria-hidden="true">
        <path d="M230 8 L448 134 H12 Z" fill="#8A2F20" stroke="#F7F3E8" strokeWidth="7" strokeLinejoin="round" />
        {scallops.map((x) => (
          <circle key={x} cx={x} cy={134} r={7} fill="#F7F3E8" />
        ))}
        <circle cx="230" cy="92" r="17" fill="#241D15" stroke="#F7F3E8" strokeWidth="5" />
        <path d="M230 75 v34 M213 92 h34" stroke="#F7F3E8" strokeWidth="2.5" />
      </svg>
    </div>
  );
}

/** The kakelugn (tile stove) that stands in for the brown-noise toggle. */
function Kakelugn() {
  return (
    <svg className="stg-stove" viewBox="0 0 44 88" width="29" height="58" aria-hidden="true">
      <rect x="15" y="4" width="14" height="9" fill="#F7F3E8" stroke="#23201A" strokeWidth="2" />
      <path d="M8 84 V30 a14 14 0 0 1 28 0 v54 z" fill="#F7F3E8" stroke="#23201A" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M8 44h28M8 58h28M22 30v41" stroke="#274E8D" strokeWidth="1" opacity="0.4" />
      <rect className="stg-stove-door" x="15" y="62" width="14" height="15" rx="3" />
    </svg>
  );
}

/* ---------------------------------------------------------- sections */

function Hero() {
  return (
    <Room wall="#B3402E" deep="#8A2F20" className="stg-hero">
      <KurbitsCorner />
      <KurbitsCorner flip />
      <div className="stg-hero-inner">
        <h1 className="stg-h1">Sommarstuga</h1>
        <Swash />
        <p className="stg-lede">Lekstuga, taken literally: one red cottage, every tool a painted room.</p>
      </div>
    </Room>
  );
}

function Specimens() {
  return (
    <Room wall="#33684B" deep="#254D37" label="01 · Paint, letters, hardware">
      <div className="stg-panel stg-mitre stg-specimen">
        <div className="stg-edge" aria-hidden="true" />

        <h2 className="stg-spec-h">The paint</h2>
        <div className="stg-chips">
          {WALLS.map((w) => (
            <div key={w.name} className="stg-chip">
              <span
                className="stg-chip-swatch"
                style={{ background: w.hex, boxShadow: `4px 4px 0 ${w.deep}` }}
              />
              <span className="stg-chip-name">{w.name}</span>
              <span className="stg-chip-hex">{w.hex}</span>
            </div>
          ))}
        </div>

        <h2 className="stg-spec-h">The letters</h2>
        <p className="stg-type-display" lang="sv">
          Måla om huset.
        </p>
        <p className="stg-type-caption">Fraunces — soft turned up, wonk on. The sign-painter’s serif.</p>
        <p className="stg-type-body">
          Familjen Grotesk carries the small print — drawn in Sweden, steady on its feet, so the
          headlines can wobble.
        </p>

        <h2 className="stg-spec-h">The hardware</h2>
        <div className="stg-btn-row">
          <span className="stg-btnwrap">
            <span className="stg-btn is-demo">Open</span>
            <i>default</i>
          </span>
          <span className="stg-btnwrap">
            <span className="stg-btn is-hover">Open</span>
            <i>hover</i>
          </span>
          <span className="stg-btnwrap">
            <span className="stg-btn is-pressed">Open</span>
            <i>pressed</i>
          </span>
          <span className="stg-btnwrap">
            <button type="button" className="stg-btn">
              Knock
            </button>
            <i>live</i>
          </span>
        </div>
        <div className="stg-field">
          <label className="stg-label" htmlFor="stg-door">
            Name on the door
          </label>
          <input id="stg-door" className="stg-input" placeholder="hugo" />
        </div>

        <h2 className="stg-spec-h">A window</h2>
        <div className="stg-card stg-mitre">
          <div className="stg-edge" aria-hidden="true" />
          <h3>Window card</h3>
          <p>Every surface is a window into a room. Trim goes up first, then the paint, then the furniture.</p>
        </div>
      </div>
    </Room>
  );
}

function Facade({ reduced }: { reduced: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const floodCount = useRef(0);
  const [flood, setFlood] = useState<{ x: number; y: number; color: string; key: number } | null>(null);

  const onWindowClick = (e: ReactMouseEvent<HTMLButtonElement>, color: string) => {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    floodCount.current += 1;
    setFlood({ x: e.clientX - r.left, y: e.clientY - r.top, color, key: floodCount.current });
  };

  return (
    <Room wall="#B3402E" deep="#8A2F20" label="02 · The facade" className="stg-facade-room">
      <div ref={hostRef} className="stg-facade">
        <Gable />
        <div className="stg-windows">
          {ROOMS.map((room) => (
            <button
              key={room.name}
              type="button"
              className="stg-window"
              style={{ "--room": room.color, "--room-deep": room.deep } as CSSProperties}
              onClick={(e) => onWindowClick(e, room.color)}
            >
              <span className="stg-window-frame">
                <span className="stg-window-light" aria-hidden="true" />
                <span className="stg-window-glyph" aria-hidden="true">
                  {room.glyph}
                </span>
              </span>
              <span className="stg-window-name">{room.name}</span>
            </button>
          ))}
        </div>
        <p className="stg-facade-hint">Hover a window to light it. Click one to step inside.</p>
        {flood ? (
          <span
            key={flood.key}
            className={`stg-flood${reduced ? " is-reduced" : ""}`}
            style={
              reduced
                ? { background: flood.color }
                : { left: flood.x, top: flood.y, background: flood.color }
            }
            onAnimationEnd={() => setFlood(null)}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </Room>
  );
}

function FocusRoom() {
  const [noiseOn, setNoiseOn] = useState(false);
  return (
    <Room wall="#274E8D" deep="#1B3A6C" label="03 · A room — Focus">
      <div className="stg-panel stg-mitre stg-focus-panel">
        <div className="stg-edge" aria-hidden="true" />
        <Link className="stg-back" href="/lab">
          ← playhouse
        </Link>
        <h2 className="stg-focus-title">Focus</h2>
        <p className="stg-focus-tagline">Set an intention. Start the timer.</p>

        <div className="stg-sign">
          <svg className="stg-sign-strings" viewBox="0 0 200 26" aria-hidden="true">
            <path d="M100 4 L22 26 M100 4 L178 26" stroke="#23201A" strokeWidth="2" fill="none" opacity="0.7" />
            <circle cx="100" cy="4" r="3.5" fill="#23201A" />
          </svg>
          <div className="stg-sign-board">
            <label className="stg-label" htmlFor="stg-intention">
              Intention
            </label>
            <input id="stg-intention" className="stg-input" defaultValue="write the newsletter" />
          </div>
        </div>

        <div className="stg-hooks">
          <div className="stg-hook">
            <span className="stg-hook-nail" />
            <span className="stg-hook-string" />
            <span className="stg-tag">15 min</span>
          </div>
          <div className="stg-hook">
            <span className="stg-hook-nail" />
            <span className="stg-hook-string" />
            <span className="stg-tag is-selected">25 min</span>
          </div>
          <div className="stg-hook">
            <span className="stg-hook-nail" />
            <span className="stg-hook-string" />
            <span className="stg-tag">45 min</span>
          </div>
        </div>

        <p className="stg-timer">12:34</p>
        <button type="button" className="stg-btn stg-btn-primary">
          Start
        </button>
        <button
          type="button"
          className={`stg-noise${noiseOn ? " is-on" : ""}`}
          aria-pressed={noiseOn}
          onClick={() => setNoiseOn((v) => !v)}
        >
          <Kakelugn />
          <span>Brown noise — {noiseOn ? "on" : "off"}</span>
        </button>
        <p className="stg-focus-footer">Today: 3 sessions · 75 min</p>
      </div>
    </Room>
  );
}

/** The tomte. Hugo in a falu-red hat; the hat does the talking. */
function TomteRoom({ reduced }: { reduced: boolean }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const tomteRef = useRef<HTMLDivElement | null>(null);
  const gazeRef = useRef<SVGGElement | null>(null);
  const [mode, setMode] = useState<"hidden" | "peek" | "out">("hidden");
  const [blink, setBlink] = useState(false);
  const [tip, setTip] = useState(false);
  const [looking, setLooking] = useState(false);

  const modeRef = useRef(mode);
  const reducedRef = useRef(reduced);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const calmSince = useRef<number | null>(null);
  const scaredUntil = useRef(0);
  const idleTimer = useRef(0);
  const lookTimer = useRef(0);
  const shyTimer = useRef(0);
  const tipTimer = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Blinks every 3–8s. Reduced motion: eyes stay open.
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    let t1 = 0;
    let t2 = 0;
    const loop = () => {
      t1 = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = window.setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          loop();
        }, 150);
      }, 3000 + Math.random() * 5000);
    };
    loop();
    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reduced]);

  // The shyness engine: calm cursor → peek; rushing cursor → duck;
  // 10s idle → slide out for one slow look around.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const arm = () => {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        setMode("out");
        if (!reducedRef.current) {
          setLooking(true);
          window.clearTimeout(lookTimer.current);
          lookTimer.current = window.setTimeout(() => {
            setLooking(false);
            setMode("peek");
          }, 2800);
        }
      }, 10000);
    };

    const onMove = (e: PointerEvent) => {
      arm();
      const now = performance.now();
      const tomte = tomteRef.current;

      // Eyes track the pointer (skipped under reduced motion).
      if (tomte && gazeRef.current && !reducedRef.current) {
        const r = tomte.getBoundingClientRect();
        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.66;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const d = Math.hypot(dx, dy) || 1;
        const m = Math.min(3.4, d / 36);
        gazeRef.current.style.transform = `translate(${((dx / d) * m).toFixed(2)}px, ${((dy / d) * m).toFixed(2)}px)`;
      }

      const prev = last.current;
      last.current = { x: e.clientX, y: e.clientY, t: now };
      if (!prev) return;
      const dt = now - prev.t;
      if (dt <= 0 || dt > 250) {
        calmSince.current = null;
        return;
      }
      const vx = (e.clientX - prev.x) / dt;
      const vy = (e.clientY - prev.y) / dt;
      const speed = Math.hypot(vx, vy);

      // Rushing toward him? Duck.
      if (tomte && modeRef.current !== "hidden") {
        const r = tomte.getBoundingClientRect();
        const hx = r.left + r.width / 2 - e.clientX;
        const hy = r.top + r.height / 2 - e.clientY;
        const hd = Math.hypot(hx, hy) || 1;
        const toward = (vx * hx + vy * hy) / (hd * (speed || 1));
        if (speed > 1.05 && toward > 0.55 && hd < 560) {
          calmSince.current = null;
          scaredUntil.current = now + 1500;
          window.clearTimeout(lookTimer.current);
          setLooking(false);
          setMode("hidden");
          return;
        }
      }

      // Sustained calm brings him back out.
      if (speed < 0.35) {
        if (calmSince.current === null) {
          calmSince.current = now;
        } else if (
          now - calmSince.current > 650 &&
          now > scaredUntil.current &&
          modeRef.current === "hidden"
        ) {
          setMode("peek");
        }
      } else {
        calmSince.current = null;
      }
    };

    // Knock where he hides: a shy beat, then out with a polite hat tip.
    const onClick = (e: MouseEvent) => {
      if (modeRef.current !== "hidden") return;
      const r = stage.getBoundingClientRect();
      if (e.clientX < r.left + r.width * 0.55) return;
      window.clearTimeout(shyTimer.current);
      shyTimer.current = window.setTimeout(() => {
        setMode("peek");
        setTip(true);
        window.clearTimeout(tipTimer.current);
        tipTimer.current = window.setTimeout(() => setTip(false), 1100);
      }, 700);
    };

    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("click", onClick);
    arm();
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("click", onClick);
      window.clearTimeout(idleTimer.current);
      window.clearTimeout(lookTimer.current);
      window.clearTimeout(shyTimer.current);
      window.clearTimeout(tipTimer.current);
    };
  }, []);

  return (
    <Room wall="#2E4B42" deep="#20362F" label="04 · The caretaker">
      <div ref={stageRef} className="stg-panel stg-mitre stg-stage">
        <div className="stg-edge" aria-hidden="true" />
        <div
          ref={tomteRef}
          className={`stg-tomte is-${mode}${blink ? " is-blink" : ""}${tip ? " is-tip" : ""}${looking ? " is-look" : ""}`}
          aria-hidden="true"
          data-name="hugo"
        >
          <svg viewBox="0 0 120 150">
            <circle cx="60" cy="104" r="40" fill="#D9A441" />
            <g className="stg-gaze" ref={gazeRef}>
              <circle className="stg-eye" cx="46" cy="100" r="4.6" fill="#23201A" />
              <circle className="stg-eye" cx="74" cy="100" r="4.6" fill="#23201A" />
            </g>
            <g className="stg-hat">
              <path
                d="M16 80 C 20 46 38 16 63 8 C 88 20 97 48 104 78 C 76 66 42 68 16 80 Z"
                fill="#B3402E"
                stroke="#8A2F20"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="63" cy="9" r="6" fill="#B3402E" stroke="#8A2F20" strokeWidth="2" />
            </g>
          </svg>
        </div>
      </div>
      <p className="stg-tomte-caption">he&rsquo;s shy. move slowly.</p>
    </Room>
  );
}

/* ------------------------------------------------------------- page */

export default function Client() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="skin-stg">
      <style>{css}</style>
      <Hero />
      <Specimens />
      <Facade reduced={reduced} />
      <FocusRoom />
      <TomteRoom reduced={reduced} />
    </div>
  );
}
