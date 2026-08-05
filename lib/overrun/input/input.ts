import type { Command } from "../sim/commands";
import type { GameState, Node } from "../sim/state";
import { NODE_R } from "../sim/constants";
import type { DragView } from "../render/renderer";
import { Renderer } from "../render/renderer";
import { hitUiButton } from "../render/fx";

/**
 * Translates pointer + keyboard events into sim commands.
 * Drag state lives HERE (render reads it via getDrag) and never enters the
 * sim — only pointerup emits a command. Pointer events unify mouse and touch.
 *
 * Two ways to send, both required for mobile viability:
 *  - drag from an owned node onto a target
 *  - tap-tap: tap own node (selects), tap target (sends)
 */

const TAP_SLOP = 4; // world units of movement below which a "drag" is a tap

export interface InputHandle {
  getDrag: () => DragView | null;
  /** Remove every listener this module registered (React unmount path). */
  detach: () => void;
}

function hitNode(state: GameState, x: number, y: number, radiusScale: number): Node | null {
  // Nearest-within-radius, not first-hit — hit radii can overlap.
  let best: Node | null = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= NODE_R[n.size] * radiusScale && d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export interface InputCallbacks {
  onMuteToggle: () => void;
  onPauseToggle: () => void;
  /** True while the pause menu (or an overlay) owns input — world input is off. */
  worldInputBlocked: () => boolean;
}

export function attachInput(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  getState: () => GameState,
  queue: Command[],
  callbacks: InputCallbacks,
): InputHandle {
  let drag: (DragView & { startX: number; startY: number }) | null = null;

  const toWorld = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    // Secondary button = deselect, nothing else (context menu is suppressed).
    if (e.button === 2) {
      drag = null;
      queue.push({ type: "deselect" });
      return;
    }
    const { x, y } = toWorld(e);

    // Top-right UI buttons win over everything — no drag, no commands.
    const ui = hitUiButton(x, y);
    if (ui === "mute") {
      callbacks.onMuteToggle();
      return;
    }
    if (ui === "pause") {
      callbacks.onPauseToggle();
      return;
    }
    // While a menu/overlay owns input, don't translate taps into world commands.
    if (callbacks.worldInputBlocked()) return;
    const scale = e.pointerType === "touch" ? 1.8 : 1.2;
    const state = getState();
    const hit = hitNode(state, x, y, scale);

    if (hit?.owner === "player") {
      drag = {
        active: true,
        fromNodeId: hit.id,
        wx: x,
        wy: y,
        hoverNodeId: null,
        startX: x,
        startY: y,
      };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Not starting a drag. Tap-tap send: a player node is selected → send there.
    const selected = state.nodes.find((n) => n.selected && n.owner === "player");
    if (selected && hit) {
      queue.push({ type: "sendUnits", from: selected.id, to: hit.id });
      queue.push({ type: "deselect" });
    } else if (hit) {
      queue.push({ type: "selectNode", nodeId: hit.id });
    } else {
      queue.push({ type: "deselect" });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const { x, y } = toWorld(e);
    drag.wx = x;
    drag.wy = y;
    const scale = e.pointerType === "touch" ? 2.2 : 1.6; // aim assist on release target
    const hover = hitNode(getState(), x, y, scale);
    drag.hoverNodeId = hover && hover.id !== drag.fromNodeId ? hover.id : null;
  };

  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (cancelled) return;
    const { x, y } = toWorld(e);
    const state = getState();
    const moved = Math.hypot(x - d.startX, y - d.startY);

    if (moved < TAP_SLOP) {
      // It was a tap on an own node.
      const self = state.nodes[d.fromNodeId];
      if (self?.selected) {
        // Second tap on an already-selected node = cancel its stream.
        queue.push({ type: "sendUnits", from: d.fromNodeId, to: d.fromNodeId });
        queue.push({ type: "deselect" });
      } else {
        queue.push({ type: "selectNode", nodeId: d.fromNodeId });
      }
      return;
    }

    const scale = e.pointerType === "touch" ? 2.2 : 1.6;
    const target = hitNode(state, x, y, scale);
    if (target && target.id !== d.fromNodeId) {
      queue.push({ type: "sendUnits", from: d.fromNodeId, to: target.id });
      queue.push({ type: "deselect" });
    }
  };

  const onPointerUp = (e: PointerEvent) => endDrag(e, false);
  const onPointerCancel = (e: PointerEvent) => endDrag(e, true);
  const onContextMenu = (e: Event) => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "p" || e.key === "P") callbacks.onPauseToggle();
    else if (e.key === "m" || e.key === "M") callbacks.onMuteToggle();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);

  // Prevent the page scrolling/zooming while playing on touch.
  canvas.style.touchAction = "none";

  return {
    getDrag: () => drag,
    detach: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
