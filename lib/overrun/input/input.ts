import { buildSendCommand, type Command } from "../sim/commands";
import type { GameState, Node } from "../sim/state";
import { PLAYER } from "../sim/state";
import { NODE_R } from "../sim/constants";
import type { DragView } from "../render/renderer";
import { Renderer } from "../render/renderer";
import { BINDINGS, matches } from "./bindings";
import { cycleFocus, stepFocus, type NavCandidate } from "./keyboard-nav";
import type { ChromeScope } from "../render/ui-layout";

/**
 * Translates pointer + keyboard events into sim commands.
 * Drag state lives HERE (render reads it via getDrag) and never enters the
 * sim — only pointerup emits a command. Pointer events unify mouse and touch.
 *
 * Two ways to send, both required for mobile viability:
 *  - drag from an owned node onto a target
 *  - tap-tap: tap own node (selects), tap target (sends)
 */

/**
 * Movement below which a gesture is a tap, in CSS px. This was 4 WORLD units,
 * which was fine while one world unit was always 3-11 css px — under a
 * zoomable camera the same 4 wu is ~50 px zoomed-in (taps become drags) and
 * ~7 px zoomed-out on a big board (drags become taps). Fingers live in css px.
 */
const TAP_SLOP_CSS = 6;
/** Minimum time a press stays visible after release. */
const PRESS_MS = 90;
/** Double-tap window on empty space: home ↔ close-up toggle. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 28;
/** Send-drag edge pan: band width and per-frame step (world units). */
const EDGE_PAN_BAND = 40;
const EDGE_PAN_WU = 0.14;
/**
 * Hit forgiveness floor in CSS px: a ball's tap disc never shrinks below a
 * fingertip no matter how far the camera zooms out, and never grows past
 * half the node spacing so overlapping discs cannot mis-resolve.
 */
const MIN_HIT_CSS = 24;
const MAX_HIT_WU = 10; // MIN_SPACING / 2

/** What the pointer is over and what it is pressing, for chrome paint. */
export interface HotView {
  hot: string | null;
  pressed: { id: string; at: number; held: boolean } | null;
}

export interface InputHandle {
  getDrag: () => DragView | null;
  /** Call once per frame: drops any drag whose endpoints stopped being valid. */
  syncDrag: () => void;
  getHot: () => HotView;
  /** Remove every listener/timer this module registered (React unmount path). */
  detach: () => void;
}

/**
 * Nearest node within its (forgiveness-floored) tap disc. Exported for the
 * app layer's ability targeting, which resolves world taps of its own via
 * onWorldTap — one hit model for sends and abilities, or the two would
 * disagree about what a fingertip covers.
 */
export function hitNode(
  state: GameState,
  x: number,
  y: number,
  radiusScale: number,
  cssScale: number,
): Node | null {
  // Nearest-within-radius, not first-hit — hit radii can overlap.
  let best: Node | null = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    const r = Math.min(
      MAX_HIT_WU,
      Math.max(NODE_R[n.size] * radiusScale, MIN_HIT_CSS / Math.max(0.001, cssScale)),
    );
    if (d <= r && d < bestD) {
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
  /** App-level world-space buttons (upgrade chevron); return true if consumed. */
  onWorldTap?: (wx: number, wy: number) => boolean;
  /**
   * Is the onboarding banner on screen? Gates its skip chip's hit box, which
   * sits over the playfield — a hit box that outlived its banner would eat
   * sends from the bottom of the board forever.
   */
  coachVisible?: () => boolean;
  onCoachSkip?: () => void;
  /** A drag collected another source ball — feedback tick, no command. */
  onSourceAdded?: () => void;
  /** Current send ratio, in (0, 1]. Absent means "always send everything". */
  getSendFraction?: () => number;
  /** The ratio toggle was activated (bottom-left button, or the F key). */
  onRatioToggle?: () => void;
  /** The ◈ cores readout was tapped mid-play — open the shop. */
  onShopTap?: () => void;
  /** Ability button `i` activated (tap or digit key). Arms/fires in the app. */
  onAbilityTap?: (index: number) => void;
  /**
   * Escape while an ability is armed: return true if a disarm consumed the
   * key, so it does not fall through to deselect/pause.
   */
  onAbilityCancel?: () => boolean;
  /** Menu/overlay keyboard navigation. Return true if the key was consumed. */
  onMenuKey?: (e: KeyboardEvent) => boolean;
  /** Which screen is up, so hover resolves against the right panel. */
  chromeScope?: () => ChromeScope;
}

export function attachInput(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
  getState: () => GameState,
  queue: Command[],
  callbacks: InputCallbacks,
): InputHandle {
  let drag:
    | (DragView & {
        startX: number;
        startY: number;
        keyboard?: boolean;
        pointerId?: number;
        /** Last pointer position in CSS px — the edge-pan band reads it. */
        cssX?: number;
        cssY?: number;
      })
    | null = null;
  let hot: string | null = null;
  let pressed: HotView["pressed"] = null;
  let cursor = "";
  /**
   * Camera gesture state. One pointer on empty space is a PAN CANDIDATE —
   * a tap until it moves past the slop (the deselect that used to fire on
   * pointerdown is deferred to pointerup so a pan never deselects). A second
   * finger during a pan upgrades it to a pinch. A second finger during a
   * SEND-DRAG stays ignored (the resting-thumb rule) — pan never steals a
   * send in progress.
   */
  let panPointers: { id: number; x: number; y: number }[] = [];
  let panMoved = false;
  let lastEmptyTap = { at: -1e9, x: 0, y: 0 };
  let wheelSettle: ReturnType<typeof setTimeout> | null = null;
  const scope = (): ChromeScope => callbacks.chromeScope?.() ?? "playing";
  const setCursor = (want: string): void => {
    // Assigned only on change: an unguarded write per mousemove is a style
    // recalc, which is not free on the 4 GB hardware floor.
    if (want === cursor) return;
    cursor = want;
    canvas.style.cursor = want;
  };

  const toCss = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const toWorld = (e: PointerEvent) => {
    const c = toCss(e);
    return renderer.screenToWorld(c.x, c.y);
  };

  /**
   * The one place a send becomes a command. buildSendCommand omits the
   * fraction field at 100% (the replay guarantee's input half — see its doc).
   * Self-send cancels never go through here; a cancel is whole.
   */
  const sendCmd = (from: number, to: number): Command =>
    buildSendCommand(from, to, callbacks.getSendFraction?.() ?? 1);

  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    {
      const c = toCss(e);
      const id = renderer.hitAnyChrome(c.x, c.y, scope(), callbacks.coachVisible?.() ?? false);
      pressed = id ? { id, at: performance.now(), held: true } : null;
      if (e.pointerType === "touch") hot = null;
    }

    // Top-right UI buttons win over everything — no drag, no commands. These
    // are screen-space chrome, so they hit-test in CSS pixels.
    const css = toCss(e);
    const ui = renderer.hitUiButton(
      css.x,
      css.y,
      callbacks.coachVisible?.() ?? false,
      scope() === "playing",
    );
    if (ui) {
      // One event, one router. main.ts keeps its own pointerdown listener for
      // menu panels, registered AFTER this one — without this, a button that
      // CHANGES appState (the ◈ shop tap) is re-resolved by that router under
      // the new state, and the very tap that opened the shop reads as "outside
      // the panel" and closes it again.
      e.stopImmediatePropagation();
      if (ui === "mute") callbacks.onMuteToggle();
      else if (ui === "pause") callbacks.onPauseToggle();
      else if (ui === "coachSkip") callbacks.onCoachSkip?.();
      else if (ui === "ratio") callbacks.onRatioToggle?.();
      else if (ui === "ability0" || ui === "ability1" || ui === "ability2")
        callbacks.onAbilityTap?.(Number(ui.slice(-1)));
      else callbacks.onShopTap?.();
      return;
    }
    // While a menu/overlay owns input, don't translate taps into world commands.
    if (callbacks.worldInputBlocked()) return;
    // A live pointer drag owns the board. Before multi-collection a second
    // finger's touch merely replaced the drag (cosmetic); now it would discard
    // a collected source set, or worse — endDrag fires for whichever finger
    // lifts FIRST, so a resting thumb could aim the whole send. One pointer,
    // one gesture; the extra finger is ignored outright.
    if (drag && !drag.keyboard) return;
    // A second finger during a PAN upgrades it to a pinch — wherever it lands
    // (mid-pinch, a finger over a ball must not select it).
    if (panPointers.length === 1 && panPointers[0]!.id !== e.pointerId) {
      const c = toCss(e);
      panPointers.push({ id: e.pointerId, x: c.x, y: c.y });
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const { x, y } = toWorld(e);
    // App-level world buttons (upgrade chevron) win over node selection.
    if (callbacks.onWorldTap?.(x, y)) return;
    const scale = e.pointerType === "touch" ? 1.8 : 1.2;
    const state = getState();
    const hit = hitNode(state, x, y, scale, renderer.cssScale);

    if (hit?.owner === PLAYER) {
      const c = toCss(e);
      drag = {
        active: true,
        fromNodeId: hit.id,
        fromNodeIds: [hit.id],
        wx: x,
        wy: y,
        hoverNodeId: null,
        startX: x,
        startY: y,
        pointerId: e.pointerId,
        cssX: c.x,
        cssY: c.y,
      };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Not starting a drag. Tap-tap send: a player node is selected → send there.
    const selected = state.nodes.find((n) => n.selected && n.owner === PLAYER);
    if (selected && hit) {
      queue.push(sendCmd(selected.id, hit.id));
      queue.push({ type: "deselect" });
    } else if (hit) {
      queue.push({ type: "selectNode", nodeId: hit.id });
    } else {
      // Empty space: a PAN CANDIDATE. The deselect this used to queue moves
      // to pointerup-under-slop — a tap still deselects, a pan never does.
      const c = toCss(e);
      panPointers = [{ id: e.pointerId, x: c.x, y: c.y }];
      panMoved = false;
      canvas.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    // Hover is a mouse affordance. iOS fires a synthetic pointermove just
    // before pointerdown, and nothing clears it afterwards — so on touch this
    // would leave a control lit for the rest of the session with no pointer
    // anywhere on screen.
    if (e.pointerType !== "touch") {
      const c = toCss(e);
      hot = renderer.hitAnyChrome(c.x, c.y, scope(), callbacks.coachVisible?.() ?? false);
      setCursor(hot ? "pointer" : "");
    }
    // Camera gestures own their pointers entirely.
    const pi = panPointers.findIndex((p) => p.id === e.pointerId);
    if (pi !== -1) {
      const c = toCss(e);
      const p = panPointers[pi]!;
      if (panPointers.length === 2) {
        // Pinch: zoom about the midpoint, pan with the midpoint.
        const q = panPointers[1 - pi]!;
        const prevMid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const prevDist = Math.max(1, Math.hypot(p.x - q.x, p.y - q.y));
        p.x = c.x;
        p.y = c.y;
        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const dist = Math.max(1, Math.hypot(p.x - q.x, p.y - q.y));
        renderer.panViewBy(mid.x - prevMid.x, mid.y - prevMid.y);
        renderer.zoomViewAt(mid.x, mid.y, dist / prevDist);
        panMoved = true;
      } else {
        if (!panMoved && Math.hypot(c.x - p.x, c.y - p.y) < TAP_SLOP_CSS) return;
        renderer.panViewBy(c.x - p.x, c.y - p.y);
        p.x = c.x;
        p.y = c.y;
        panMoved = true;
      }
      return;
    }
    if (!drag) return;
    // Only the finger that started the drag may steer or grow it.
    if (!drag.keyboard && drag.pointerId !== e.pointerId) return;
    const { x, y } = toWorld(e);
    drag.wx = x;
    drag.wy = y;
    if (!drag.keyboard) {
      const c = toCss(e);
      drag.cssX = c.x;
      drag.cssY = c.y;
    }
    const state = getState();
    // Dragging THROUGH your own balls collects them as extra sources. The hit
    // radius is the tight start-drag one (below), deliberately smaller than
    // the aim-assist radius (2.2/1.6) used for the release target — so aiming
    // PAST one of your balls never recruits it by accident; the path has to
    // cross the ball itself. Collection is one-way: dragging back through a
    // collected ball does not remove it, because on touch a wobbling finger
    // would strobe it in and out — the escape hatch is releasing on empty
    // space, which discards the whole gesture.
    // (Never for a keyboard aim: confirm sends from ONE source, so a stray
    // mouse pass-over must not draw lines the send won't honour.)
    const startScale = e.pointerType === "touch" ? 1.8 : 1.2;
    const over = hitNode(state, x, y, startScale, renderer.cssScale);
    if (!drag.keyboard && over && over.owner === PLAYER && !drag.fromNodeIds.includes(over.id)) {
      drag.fromNodeIds.push(over.id);
      callbacks.onSourceAdded?.();
    }
    const scale = e.pointerType === "touch" ? 2.2 : 1.6; // aim assist on release target
    const hover = hitNode(state, x, y, scale, renderer.cssScale);
    drag.hoverNodeId = hover && hover.id !== drag.fromNodeId ? hover.id : null;
  };

  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    if (!drag) return;
    // A keyboard aim has no pointer behind it; a stray pointerup must not
    // resolve it into a send. And only the OWNING pointer may end a pointer
    // drag — a second finger lifting must neither send nor cancel.
    if (drag.keyboard) return;
    if (drag.pointerId !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (cancelled) return;
    const { x, y } = toWorld(e);
    const state = getState();
    // Tap-vs-drag in CSS px (a finger's slop does not scale with the camera);
    // compared in world units against the slop converted at the CURRENT scale.
    const moved = Math.hypot(x - d.startX, y - d.startY);
    const slopWu = TAP_SLOP_CSS / Math.max(0.001, renderer.cssScale);

    if (moved < slopWu) {
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
    const target = hitNode(state, x, y, scale, renderer.cssScale);
    if (!target) return; // released on empty space: the whole gesture discards
    // One send per collected source. Re-filter to still-player-owned — a
    // source can change hands mid-gesture, and the sim would drop the command
    // anyway, but a filtered list also keeps the release-on-a-source case
    // honest. Releasing ON a collected source is deliberate: the others
    // reinforce it (the source ≠ target check strips it from the senders).
    const sources = d.fromNodeIds.filter((id) => {
      const n = state.nodes[id];
      return n?.owner === PLAYER && id !== target.id;
    });
    if (sources.length === 0) return;
    for (const id of sources) queue.push(sendCmd(id, target.id));
    queue.push({ type: "deselect" });
  };

  /**
   * A camera pointer lifted or was taken by the system. A candidate that
   * never moved is a TAP on empty space: the deferred deselect fires here,
   * and a second such tap inside the double-tap window toggles home ↔
   * close-up. A pinch losing one finger continues as a single-finger pan
   * (the survivor's coords are already current, so there is no jump).
   */
  const endPanPointer = (e: PointerEvent, cancelled: boolean): boolean => {
    const pi = panPointers.findIndex((p) => p.id === e.pointerId);
    if (pi === -1) return false;
    panPointers.splice(pi, 1);
    if (panPointers.length > 0) return true; // pinch → pan, gesture continues
    if (panMoved) {
      renderer.viewGestureEnd(); // land the exact sprite bake bucket
    } else if (!cancelled) {
      const c = toCss(e);
      const now = performance.now();
      if (
        now - lastEmptyTap.at < DOUBLE_TAP_MS &&
        Math.hypot(c.x - lastEmptyTap.x, c.y - lastEmptyTap.y) < DOUBLE_TAP_DIST
      ) {
        renderer.toggleViewAt(c.x, c.y);
        lastEmptyTap.at = -1e9; // consume — a triple tap is not two doubles
      } else {
        lastEmptyTap = { at: now, x: c.x, y: c.y };
      }
      queue.push({ type: "deselect" }); // the tap semantics, preserved
    }
    return true;
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (pressed) pressed.held = false;
    if (endPanPointer(e, false)) return;
    endDrag(e, false);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    // iOS fires this when the system takes the gesture; a press that did not
    // clear here would stick — and a camera pointer that did not clear here
    // would leave the board glued to a finger that no longer exists.
    pressed = null;
    hot = null;
    setCursor("");
    if (endPanPointer(e, true)) return;
    endDrag(e, true);
  };
  const onPointerLeave = (): void => {
    hot = null;
    // Release the press too. The canvas only takes pointer capture for board
    // drags, so a chrome press dragged off the window never receives its
    // pointerup — and getHot only expires a press once held is false, so it
    // would render depressed for the rest of the session.
    if (pressed) pressed.held = false;
    setCursor("");
  };

  // Prevent the page scrolling/zooming while playing on touch.
  canvas.style.touchAction = "none";

  // Site seam: the game lives inside a page, so a right-click mid-drag must
  // not pop the browser menu out from under the gesture.
  const onContextMenu = (e: Event): void => e.preventDefault();

  // Wheel + trackpad-pinch zoom, anchored at the cursor. `passive: false` is
  // required — embedded in a page, an unprevented wheel scrolls the page out
  // from under the game. ctrlKey marks a trackpad pinch (browsers synthesize
  // it), which earns a higher sensitivity; deltaMode 1 is Firefox's line
  // mode. Bake settling is debounced off the last tick.
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (callbacks.worldInputBlocked()) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
    renderer.zoomViewAt(cx, cy, factor);
    if (wheelSettle) clearTimeout(wheelSettle);
    wheelSettle = setTimeout(() => renderer.viewGestureEnd(), 180);
  };

  /* ------------------------------------------------------------- keyboard */

  /** Player nodes as screen-space nav candidates, for the arrow keys. */
  const playerCandidates = (): NavCandidate[] => {
    const out: NavCandidate[] = [];
    for (const n of getState().nodes) {
      if (n.owner !== PLAYER) continue;
      const s = renderer.worldToScreen(n.x, n.y);
      out.push({ id: n.id, sx: s.x, sy: s.y });
    }
    return out;
  };

  /**
   * Aim targets: every node EXCEPT the one being sent from.
   *
   * Including the source lets the cursor land back on it, and since a
   * self-target is not a send, confirm would then silently do nothing.
   * Cancelling a stream is a separate key.
   */
  const targetCandidates = (fromId: number): NavCandidate[] => {
    const out: NavCandidate[] = [];
    for (const n of getState().nodes) {
      if (n.id === fromId) continue;
      const s = renderer.worldToScreen(n.x, n.y);
      out.push({ id: n.id, sx: s.x, sy: s.y });
    }
    return out;
  };

  const screenOf = (id: number | null): { sx: number; sy: number } | null => {
    if (id === null) return null;
    const n = getState().nodes[id];
    if (!n) return null;
    const s = renderer.worldToScreen(n.x, n.y);
    return { sx: s.x, sy: s.y };
  };

  const selectedId = (): number | null =>
    getState().nodes.find((n) => n.selected && n.owner === PLAYER)?.id ?? null;

  /**
   * Point the synthesized aim at a node.
   *
   * Assigning to the same `drag` local the pointer path uses means the aim
   * line, the arrowhead and the target ring all render with no renderer change
   * at all — `getDrag` already closes over this variable.
   */
  const aimAt = (fromId: number, toId: number): void => {
    const t = getState().nodes[toId];
    if (!t) return;
    drag = {
      active: true,
      fromNodeId: fromId,
      fromNodeIds: [fromId], // keyboard aim is single-source, always
      wx: t.x,
      wy: t.y,
      hoverNodeId: toId === fromId ? null : toId,
      startX: t.x,
      startY: t.y,
      keyboard: true,
    };
  };

  const cancelAim = (): void => {
    if (drag?.keyboard) drag = null;
  };

  /**
   * Drop ANY drag — keyboard aim or held pointer — when either endpoint stops
   * being valid: the source changed hands, or a level swap shrank the board so
   * an id points past its end. Called once per frame from the app layer.
   *
   * Pointer drags need this too, not just keyboard aims: a finger can stay
   * down while a second tap dismisses the victory overlay and swaps the board,
   * and drawDrag dereferences the hover target unguarded — which took the
   * whole rAF chain down with it (loop.ts re-arms AFTER render()). endDrag
   * no-ops on a null drag, so the later pointerup is harmless.
   */
  const syncDrag = (): void => {
    if (!drag) return;
    const nodes = getState().nodes;
    const from = nodes[drag.fromNodeId];
    const to = drag.hoverNodeId === null ? null : nodes[drag.hoverNodeId];
    if (!from || from.owner !== PLAYER || (drag.hoverNodeId !== null && !to)) {
      drag = null;
      return;
    }
    // Prune collected sources the player has lost, so the render never draws
    // a send line out of an enemy ball. The primary source survives — it was
    // just checked above — so the fromNodeIds[0] === fromNodeId invariant
    // holds through the filter.
    if (drag.fromNodeIds.length > 1)
      drag.fromNodeIds = drag.fromNodeIds.filter((id) => nodes[id]?.owner === PLAYER);

    // Edge pan while aiming: a send dragged to the screen edge on a zoomed
    // camera scrolls the view, or a cross-map send is simply impossible.
    // Render-clock (this runs once per frame), never the sim's.
    if (!drag.keyboard && drag.cssX !== undefined && drag.cssY !== undefined && !renderer.isViewHome()) {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      const step = EDGE_PAN_WU * renderer.cssScale;
      let dx = 0;
      let dy = 0;
      if (drag.cssX < EDGE_PAN_BAND) dx = step;
      else if (drag.cssX > w - EDGE_PAN_BAND) dx = -step;
      if (drag.cssY < EDGE_PAN_BAND) dy = step;
      else if (drag.cssY > h - EDGE_PAN_BAND) dy = -step;
      if (dx !== 0 || dy !== 0) {
        renderer.panViewBy(dx, dy);
        // The camera moved under a stationary pointer: the aim endpoint in
        // world space follows the pointer's SCREEN position, not its stale
        // world coords.
        const p = renderer.screenToWorld(drag.cssX, drag.cssY);
        drag.wx = p.x;
        drag.wy = p.y;
      }
    }
  };

  /** Follow the keyboard focus with the camera when it lands off-screen. */
  const followFocus = (nodeId: number | null): void => {
    if (nodeId === null) return;
    const n = getState().nodes[nodeId];
    if (n) renderer.focusWorld(n.x, n.y);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // Arrows may repeat (holding one walks the board), and so may the camera
    // cluster (holding W scrolls); everything else is a discrete action and
    // would strobe.
    const isArrow =
      matches(e, BINDINGS.up) ||
      matches(e, BINDINGS.down) ||
      matches(e, BINDINGS.left) ||
      matches(e, BINDINGS.right);
    const isCamera = matches(e, BINDINGS.zoomIn) || matches(e, BINDINGS.zoomOut);
    if (e.repeat && !isArrow && !isCamera) return;
    // Bindings live in input/bindings.ts, which also documents why Escape is
    // never the only path to anything (it exits fullscreen at the browser
    // level, which is why the portal restricts it).
    // While aiming, Escape means "cancel the aim" (handled by BINDINGS.cancel
    // below) — but P has no cancel meaning and must still pause.
    if (matches(e, BINDINGS.pause) && !(drag?.keyboard && e.code === "Escape")) {
      e.preventDefault();
      // Escape while an ability is armed means "stand down", exactly as it
      // cancels a keyboard aim above — but P keeps pausing regardless, since
      // P has no cancel meaning.
      if (e.code === "Escape" && callbacks.onAbilityCancel?.()) return;
      callbacks.onPauseToggle();
      return;
    }
    if (matches(e, BINDINGS.mute)) {
      e.preventDefault();
      callbacks.onMuteToggle();
      return;
    }

    // Menus own the keyboard while they are up.
    if (callbacks.worldInputBlocked()) {
      if (callbacks.onMenuKey?.(e)) e.preventDefault();
      return;
    }

    // Camera keys: zoom anchors at the viewport centre; panning rides the
    // focus keys (the camera follows an off-screen selection/aim), so the
    // keyboard needs no pan cluster of its own. Bake settles on the same
    // debounce the wheel uses.
    if (isCamera) {
      e.preventDefault();
      const cx = (canvas.clientWidth || window.innerWidth) / 2;
      const cy = (canvas.clientHeight || window.innerHeight) / 2;
      renderer.zoomViewAt(cx, cy, matches(e, BINDINGS.zoomIn) ? 1.15 : 1 / 1.15);
      if (wheelSettle) clearTimeout(wheelSettle);
      wheelSettle = setTimeout(() => renderer.viewGestureEnd(), 180);
      return;
    }
    if (matches(e, BINDINGS.resetView)) {
      e.preventDefault();
      renderer.refitView();
      return;
    }

    // Ability digits (1/2/3). Below the menu gate on purpose — a digit typed
    // over the shop must not fire a power under the panel.
    const abilityIdx = matches(e, BINDINGS.ability1)
      ? 0
      : matches(e, BINDINGS.ability2)
        ? 1
        : matches(e, BINDINGS.ability3)
          ? 2
          : -1;
    if (abilityIdx >= 0) {
      e.preventDefault();
      callbacks.onAbilityTap?.(abilityIdx);
      return;
    }

    const dir = matches(e, BINDINGS.up)
      ? "up"
      : matches(e, BINDINGS.down)
        ? "down"
        : matches(e, BINDINGS.left)
          ? "left"
          : matches(e, BINDINGS.right)
            ? "right"
            : null;

    if (dir) {
      e.preventDefault();
      if (drag?.keyboard) {
        // Aiming: move the target among every node on the board.
        const next = stepFocus(
          screenOf(drag.hoverNodeId ?? drag.fromNodeId),
          targetCandidates(drag.fromNodeId),
          dir,
        );
        if (next !== null) {
          aimAt(drag.fromNodeId, next);
          followFocus(next);
        }
      } else {
        const next = stepFocus(screenOf(selectedId()), playerCandidates(), dir);
        if (next !== null) {
          queue.push({ type: "selectNode", nodeId: next });
          followFocus(next);
        }
      }
      return;
    }

    if (matches(e, BINDINGS.cycleNext)) {
      e.preventDefault();
      const ids = playerCandidates().map((c) => c.id);
      const next = cycleFocus(selectedId(), ids, e.shiftKey ? -1 : 1);
      if (next !== null) {
        queue.push({ type: "selectNode", nodeId: next });
        followFocus(next);
      }
      return;
    }

    if (matches(e, BINDINGS.confirm)) {
      e.preventDefault();
      if (drag?.keyboard) {
        const target = drag.hoverNodeId;
        const from = drag.fromNodeId;
        drag = null;
        if (target !== null && target !== from) {
          queue.push(sendCmd(from, target));
          queue.push({ type: "deselect" });
        }
        return;
      }
      // Not aiming yet: enter aim mode from the selected node, or select one.
      const sel = selectedId();
      if (sel === null) {
        const first = stepFocus(null, playerCandidates(), "right");
        if (first !== null) queue.push({ type: "selectNode", nodeId: first });
        return;
      }
      const target = stepFocus(screenOf(sel), targetCandidates(sel), "right");
      if (target !== null) {
        aimAt(sel, target);
        followFocus(target);
      }
      return;
    }

    if (matches(e, BINDINGS.cancel)) {
      e.preventDefault();
      // An armed ability outranks everything: X/Escape disarms it first,
      // exactly as it cancels a keyboard aim before it deselects.
      if (callbacks.onAbilityCancel?.()) return;
      if (drag?.keyboard) cancelAim();
      else if (selectedId() !== null) queue.push({ type: "deselect" });
      else callbacks.onPauseToggle(); // Escape with nothing selected still pauses
      return;
    }

    if (matches(e, BINDINGS.upgrade)) {
      e.preventDefault();
      const sel = selectedId();
      if (sel !== null) queue.push({ type: "upgradeNode", nodeId: sel });
      return;
    }

    if (matches(e, BINDINGS.cancelStream)) {
      e.preventDefault();
      const sel = selectedId();
      // A self-send is how the sim already cancels an outgoing stream.
      // Deliberately NOT sendCmd: a cancel is whole, never partial.
      if (sel !== null) {
        queue.push({ type: "sendUnits", from: sel, to: sel });
        queue.push({ type: "deselect" });
      }
      return;
    }

    if (matches(e, BINDINGS.sendRatio)) {
      e.preventDefault();
      callbacks.onRatioToggle?.();
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  return {
    getDrag: () => drag,
    syncDrag,
    getHot: () => {
      // Every chrome control navigates away, so a press that only lasted until
      // the next frame would never be seen. Hold it for a floor of PRESS_MS
      // after release so a tap that dismisses a menu still shows a depress.
      if (pressed && !pressed.held && performance.now() - pressed.at > PRESS_MS) pressed = null;
      return { hot, pressed };
    },
    detach: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      if (wheelSettle) clearTimeout(wheelSettle);
      canvas.style.touchAction = "";
      canvas.style.cursor = "";
    },
  };
}
