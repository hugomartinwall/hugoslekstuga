/**
 * The flanker's eyes-off tell (R2) — the screen-edge half of the readability
 * contract that let the wu12 wind-up stand on a foe that attacks from the
 * facing blind-arc.
 *
 * The sim guarantees the lead time: a flanker carries a hashed `flank`
 * counter and cannot commit its wind-up until it has stalked the blind arc
 * for its kind's `flankTicks` (0.8 s at the shipped 24). This module makes
 * that lead PERCEIVABLE without eyes-on: a faint glow builds on the screen
 * edge nearest the stalker while it circles, and snaps unmistakable for the
 * wind-up's 400 ms. The contract's tuning dials, agreed with mech and fun:
 * if eyes-off play still eats unwarned bites, the first dial is the late-
 * phase loudness here; if the flanker stops landing on casters, the dial is
 * the stalk-phase faintness — never the wind-up, and never below wu12.
 *
 * Why a SCREEN edge and not a world cue: the premise is that the player is
 * not looking there. A world-space cue behind the hero is exactly as
 * invisible as the foe it warns about; the screen edge is the one place
 * peripheral vision is guaranteed to cover. The glow speaks §6's element
 * vocabulary — the stalker's own attack colour, the same one its body
 * telegraph and bolt use.
 *
 * Legality (comp's R1 ruling, applied): this renders existing sim state —
 * `flank`, `windup`, foe positions — through the live camera. It reads the
 * foe list the way every renderer does; nothing here can see the cursor,
 * steer a cast, or touch `forwardAimPoint`.
 *
 * Presentation-only, DOM-based: a pointer-events-none overlay of four edge
 * gradients, opacity-driven per frame. Inserted directly after the canvas
 * so every HUD element added later paints above it — the glow must never
 * sit on top of the CAST disc or a toast.
 */

import type { Camera } from "three";
import { Vector3 } from "three";
import { foeKind } from "../../content";
import type { RtState } from "../../sim/rt/state";
import { attackColour } from "../rt-view";

type Edge = "left" | "right" | "top" | "bottom";
const EDGES: Edge[] = ["left", "right", "top", "bottom"];

/** Stalk-phase ceiling. FAINT is the contract: readable by peripheral
 * attention, not a command to act — a warned player who reacts escapes, a
 * warned player who finishes their cast anyway eats the bite. */
const STALK_MAX = 0.45;

export class ThreatEdge {
  private root: HTMLDivElement;
  private els: Record<Edge, HTMLDivElement>;
  private level: Record<Edge, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  private colour: Record<Edge, string> = { left: "", right: "", top: "", bottom: "" };
  /** Whether a WIND-UP (not a stalk) is driving the edge this frame. */
  private hot: Record<Edge, boolean> = { left: false, right: false, top: false, bottom: false };
  private rim: Record<Edge, string> = { left: "", right: "", top: "", bottom: "" };
  private v = new Vector3();

  constructor(private heightAt: (x: number, z: number) => number) {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;inset:0;pointer-events:none;overflow:hidden;";
    this.els = {} as Record<Edge, HTMLDivElement>;
    for (const edge of EDGES) {
      const el = document.createElement("div");
      const size = "17%";
      const pos =
        edge === "left"
          ? `left:0;top:0;bottom:0;width:${size};`
          : edge === "right"
            ? `right:0;top:0;bottom:0;width:${size};`
            : edge === "top"
              ? `top:0;left:0;right:0;height:${size};`
              : `bottom:0;left:0;right:0;height:${size};`;
      el.style.cssText = `position:absolute;${pos}opacity:0;`;
      this.root.appendChild(el);
      this.els[edge] = el;
    }
    // After the canvas, before everything the UI appends later (see header).
    const canvas = document.querySelector("canvas");
    if (canvas?.parentElement) canvas.insertAdjacentElement("afterend", this.root);
    else document.body.appendChild(this.root);
  }

  /** Per-frame: read the stalkers, project, drive the four edges. */
  update(s: RtState, camera: Camera, dt: number): void {
    const target: Record<Edge, number> = { left: 0, right: 0, top: 0, bottom: 0 };
    for (const e of EDGES) this.hot[e] = false;
    for (const f of s.foes) {
      if (!f.alive) continue; // the foes array keeps corpses for a while
      const kind = foeKind(f.kindId);
      if (kind.ai !== "flanker") continue;
      if (f.flank <= 0 && f.windup <= 0) continue;

      // Chest height on the sampled ground — the same convention the
      // puppets and particles use; foes carry no y of their own.
      //
      // NO on-screen gate, deliberately: the first cut suppressed the glow
      // whenever the foe projected inside the frame, reasoning eyes-on made
      // it redundant — and a probe showed a mid-stalk rotfang is USUALLY
      // inside the frame, because the blind arc is about the HERO'S facing
      // while the 3/4 camera shows every side. "Eyes-off" means the
      // player's attention is on the fight ahead, not that the stalker is
      // off-frame; the sim's flank counter (which only builds in the blind
      // arc) is the whole warrant the cue needs.
      this.v.set(f.x, this.heightAt(f.x, f.z) + 0.8, f.z).project(camera);
      const inFront = this.v.z < 1;

      const strength =
        f.windup > 0
          ? 1
          : STALK_MAX * Math.min(1, f.flank / Math.max(1, kind.flankTicks ?? 24));
      // Dominant edge by screen direction; a foe behind the camera (rare
      // under this rig) projects mirrored, so fall back to "bottom" — the
      // frame edge the blind arc maps to from the 3/4 diorama.
      let edge: Edge;
      if (!inFront) edge = "bottom";
      else if (Math.abs(this.v.x) > Math.abs(this.v.y)) edge = this.v.x > 0 ? "right" : "left";
      else edge = this.v.y > 0 ? "top" : "bottom";
      if (strength > target[edge]) {
        target[edge] = strength;
        const winding = f.windup > 0;
        this.hot[edge] = winding;
        // Brightened toward white, the same correction the body telegraph
        // earned in §6: the raw element colour for spore is a LOW-luminance
        // violet, and at the edge of a sunlit frame it read as a faint grey
        // dimming instead of a glow (capture-judged). The hue still says
        // which element is stalking; the luminance is what peripheral
        // vision actually detects.
        const [r, g, b] = attackColour(kind.attackElement, false);
        const rgb = `${Math.round((r + (1 - r) * 0.6) * 255)},${Math.round(
          (g + (1 - g) * 0.6) * 255,
        )},${Math.round((b + (1 - b) * 0.6) * 255)}`;
        const dir =
          edge === "left" ? "to right" : edge === "right" ? "to left" : edge === "top" ? "to bottom" : "to top";
        // The wind-up is a different LOOK, not a louder stalk: a deeper
        // gradient plus a hard bright line on the frame edge itself (the
        // rim, below). More-of-the-same-haze read as weather; the alarm
        // needs a shape (capture-judged).
        this.colour[edge] = `linear-gradient(${dir}, rgba(${rgb},${winding ? 0.7 : 0.5}), rgba(${rgb},0))`;
        this.rim[edge] = `rgba(${rgb},0.95)`;
      }
    }

    for (const edge of EDGES) {
      const cur = this.level[edge];
      const t = target[edge];
      // Instant attack, breathed release. The rise needs no smoothing of
      // its own: the stalk target already climbs with the sim's flank
      // counter (one small step per tick), and the wind-up snap SHOULD
      // land within a frame. Wall-clock rise smoothing also starved the
      // cue under a step()-driven harness, where dt is whatever the
      // synchronous loop takes — the sim tick is the honest clock here.
      const next = t > cur ? t : cur + (t - cur) * Math.min(1, dt * 4.5);
      this.level[edge] = next;
      const el = this.els[edge];
      if (next < 0.01) {
        if (el.style.opacity !== "0") el.style.opacity = "0";
        el.style.borderWidth = "0";
        continue;
      }
      if (this.colour[edge]) el.style.background = this.colour[edge];
      // The rim: a 4px solid line on the frame side of the band while a
      // wind-up drives it — the shape that says NOW rather than "nearby".
      const side =
        edge === "left" ? "Left" : edge === "right" ? "Right" : edge === "top" ? "Top" : "Bottom";
      if (this.hot[edge]) {
        el.style.borderStyle = "solid";
        el.style.borderWidth = "0";
        el.style[`border${side}Width` as "borderLeftWidth"] = "4px";
        el.style[`border${side}Color` as "borderLeftColor"] = this.rim[edge];
      } else {
        el.style.borderWidth = "0";
      }
      el.style.opacity = next.toFixed(3);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
