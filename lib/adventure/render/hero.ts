import { drawHugoSprite, withAlpha, type EyeState } from "@/lib/hugo/sprite";
import { INK_HEX } from "@/lib/colors";
import type { GameState } from "../sim/state";
import { SWING_ACTIVE } from "../sim/tick";
import { reducedMotion } from "./motion";

/**
 * The hero compositor. Hugo himself is ALWAYS drawn through the canonical
 * `drawHugoSprite` — one sprite module, one character. The sword and its
 * arc trail are cell-grid painters layered around him in the same
 * quantized style: whole-pixel offsets, never rotation of the sprite.
 */

export function drawHero(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  accent: string,
  moving: boolean,
): void {
  const p = state.player;
  const a = p.attack;
  const invuln = state.tick < p.iframesUntil;
  const rolling = p.dodgeT > 0;

  // I-frame feedback: classic blink — but a steady outline when motion is
  // reduced (no strobing), so the state is never invisible.
  if (invuln && !rolling) {
    if (!reducedMotion() && (state.tick >> 1) % 2 === 0) {
      drawOutline(ctx, x, y, accent);
      return;
    }
    if (reducedMotion()) drawOutline(ctx, x, y, accent);
  }

  const facingLeft = Math.cos(p.faceAng) < -0.2;
  const eye: EyeState = {
    open: true,
    wide: a.phase === "chargeSwing" || rolling,
    dx: Math.abs(Math.cos(p.faceAng)) > 0.4 ? (Math.cos(p.faceAng) > 0 ? 1 : -1) : 0,
    dy: Math.sin(p.faceAng) > 0.5 ? 1 : Math.sin(p.faceAng) < -0.5 ? -1 : 0,
  };

  // Dodge squash; charge crouch.
  let scaleX = facingLeft ? -1 : 1;
  let scaleY = 1;
  if (rolling) {
    scaleY = 0.78;
    scaleX *= 1.14;
  } else if (a.phase === "charging") {
    scaleY = 0.92;
  }

  // Hit flash: repaint him in phosphor white via the canonical palette fn.
  const flashing = invuln && state.tick < p.iframesUntil - 36;
  const bodyAccent = flashing ? INK_HEX : accent;

  // Sword behind the body on up-swings.
  const swingUp = Math.sin(a.ang) < -0.3;
  if (swordVisible(state) && swingUp) drawSword(ctx, state, x, y, accent);

  drawHugoSprite(ctx, {
    x,
    y,
    px: 1,
    accent: bodyAccent,
    eye,
    feet: moving && !rolling ? (((state.tick >> 3) & 1) as 0 | 1) : null,
    scaleX,
    scaleY,
    bobY: 0,
  });

  if (swordVisible(state) && !swingUp) drawSword(ctx, state, x, y, accent);

  // Parry shimmer.
  if (p.parryT > 0) {
    ctx.strokeStyle = withAlpha(INK_HEX, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 10, y - 10, 20, 20);
  }
}

function swordVisible(state: GameState): boolean {
  const phase = state.player.attack.phase;
  return phase !== "stagger" && state.player.dodgeT <= 0;
}

/**
 * The sword: three steel cells along the swing angle plus a hilt cell,
 * with an arc trail during the active frames. Positions are quantized to
 * whole pixels so it reads as sprite art, not vector art.
 */
function drawSword(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  x: number,
  y: number,
  accent: string,
): void {
  const p = state.player;
  const a = p.attack;
  const q = (n: number) => Math.round(n);

  // Where in the swing are we? Sweep the blade across the arc.
  let ang = p.faceAng;
  let reach = 1;
  if (a.phase === "windup") {
    ang = a.ang - 1.1;
    reach = 0.85;
  } else if (a.phase === "swing") {
    const t = Math.min(1, a.t / SWING_ACTIVE);
    ang = a.ang - 1.1 + t * 2.2;
    reach = 1;
  } else if (a.phase === "chargeSwing") {
    const t = Math.min(1, a.t / 8);
    ang = a.ang - 1.5 + t * 3.0;
    reach = 1.25;
  } else if (a.phase === "charging") {
    ang = a.ang - 1.2;
    reach = 0.8 + Math.min(0.3, p.chargeT / 100);
  } else if (a.phase === "whirl") {
    ang = (a.t / 36) * Math.PI * 4;
    reach = 1.1;
  } else if (a.phase === "recover") {
    ang = a.ang + 1.1;
    reach = 0.85;
  } else {
    // Idle: the blade rests at the hip on the facing side.
    ang = p.faceAng + 0.9;
    reach = 0.62;
  }

  const active = a.phase === "swing" || a.phase === "chargeSwing" || a.phase === "whirl";

  // Charge-ready glint.
  const charged = a.phase === "charging" && p.chargeT >= 30;

  // Arc trail first (under the blade).
  if (active && !reducedMotion()) {
    ctx.fillStyle = withAlpha(accent, 0.3);
    for (let i = 1; i <= 3; i++) {
      const ta = ang - i * 0.35;
      for (const d of [8, 12]) {
        ctx.fillRect(q(x + Math.cos(ta) * d * reach) - 1, q(y + Math.sin(ta) * d * reach) - 1, 2, 2);
      }
    }
  }

  // Hilt + blade cells.
  ctx.fillStyle = charged ? accent : withAlpha(accent, 0.9);
  const hx = q(x + Math.cos(ang) * 6);
  const hy = q(y + Math.sin(ang) * 6);
  ctx.fillRect(hx - 1, hy - 1, 2, 2);
  ctx.fillStyle = charged && (state.tick >> 2) % 2 === 0 ? accent : INK_HEX;
  for (const d of [9, 12, 15]) {
    const bx = q(x + Math.cos(ang) * d * reach);
    const by = q(y + Math.sin(ang) * d * reach);
    ctx.fillRect(bx - 1, by - 1, 2, 2);
  }
}

function drawOutline(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string): void {
  ctx.strokeStyle = withAlpha(accent, 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 8, y - 8, 16, 16);
}
