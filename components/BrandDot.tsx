"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HugoRoom } from "@/components/HugoRoom";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import {
  clearFirstVisitFlag,
  getHugoState,
  hugoInteraction,
  hugoMoodEvent,
  hugoNap,
  hugoSawTool,
  hydrateFromStorage,
  useHugoState,
} from "@/lib/hugo-state";
import { COLOR_HEX } from "@/lib/colors";
import {
  COLOR_ORDER,
  drawHugoSprite,
  spriteCanvasSize,
} from "@/lib/hugo/sprite";

const DOT_COLORS = [
  "var(--color-tomato)",
  "var(--color-blue)",
  "var(--color-yellow)",
  "var(--color-pink)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-orange)",
  "var(--color-teal)",
];

const DOT_KEY = "hugoslekstuga:dot-color";
/**
 * Proximity threshold scales with the rendered dot size — bigger dot,
 * more breathing room around it that triggers the eyes; smaller dot,
 * tighter trigger area so the eyes don't pop on every cursor move.
 * 4× the dot diameter feels right across mobile (14px → 56px reach)
 * and desktop (17px → 68px reach). Floored at 40 so a vanishingly
 * small dot still has some catchment.
 */
const PROXIMITY_RATIO = 4;
const PROXIMITY_FLOOR_PX = 40;
const EYES_HIDE_DELAY_MS = 600;

/**
 * Easter egg — spam Hugo with clicks and he plays dead. Five or more
 * clicks within 1.5 seconds triggers it; his eyes squeeze shut into
 * thin lines for 1.8 seconds. Dry, no fanfare, just a small visible
 * "leave me alone".
 */
const SPAM_CLICK_THRESHOLD = 5;
const SPAM_CLICK_WINDOW_MS = 1500;
const PLAY_DEAD_DURATION_MS = 1800;

/**
 * Easter egg — drag Hugo around. Pointer-down on the dot starts a drag;
 * movement past DRAG_TRIGGER_PX commits it. He follows the cursor 1:1
 * while held, then springs back to home with a bouncy ease on release
 * and bursts a coloured-sparkle "happy puff" above his head. Hugo gets
 * a beat of joy for being played with.
 */
const DRAG_TRIGGER_PX = 4;
const SPRING_BACK_MS = 420;
const HAPPY_DURATION_MS = 1300;
const HAPPY_SPARK_COLORS = [
  "var(--color-tomato)",
  "var(--color-yellow)",
  "var(--color-pink)",
  "var(--color-green)",
  "var(--color-blue)",
];

/**
 * Visibility-based sleep. Tab hidden ≥ 200 ms → Hugo dozes (eyes
 * close to thin lines). Hidden ≥ 3 s → he's asleep, with a small "z"
 * drifting up from above his head every ~3.6 s. On tab-back, eyes pop
 * to a brief scale-up yawn before settling. None of it persists; sleep
 * is in-memory only. The wink: people who tab-hop to hunt for
 * something come back to a sleeping Hugo and feel slightly bad.
 */
const DOZE_DELAY_MS = 200;
const SLEEP_DELAY_MS = 3000;
const YAWN_DURATION_MS = 700;
const Z_CYCLE_MS = 3600;

/**
 * Konami code easter egg. Type ↑ ↑ ↓ ↓ ← → ← → B A anywhere on the
 * site and Hugo does one 360° tumble with the happy-spark puff at the
 * midpoint. Works regardless of focused element — the sequence is
 * unlikely to be typed by accident inside an input.
 */
/**
 * Long-press. Hold the dot for LONG_PRESS_MS without dragging and —
 * on the homepage — Hugo's parkour begins: gravity arrives, the swarm
 * becomes platforms (see components/hugo/HugoParkour.tsx). The old
 * cursor-leash retired in favour of the game.
 */
const LONG_PRESS_MS = 550;

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
const FLIP_DURATION_MS = 700;

/**
 * The brand dot. Internally we call him **Hugo** — a small coloured
 * disc that lives in the wordmark, in the nav corner of every tool
 * page, and (when a tool is clicked) travels up from the swarm into
 * the nav. The character of the brand carried by behaviour, not shape.
 *
 *   - Form: a circle sized at 0.7em so it scales with the wordmark's
 *     font-size. Sits next to the last letter like a period that
 *     learned to draw itself.
 *   - Behaviour: two tiny cream eyes appear when the cursor passes
 *     close (interactive variant only). On touch, tapping the dot
 *     toggles the eyes *and* cycles colour together — same atom, two
 *     affordances. Idle breathing stays.
 *   - State: the chosen colour persists in `hugoslekstuga:dot-color`
 *     so the nav, footer, tool-page corner dot, and back-link dot
 *     all stay in sync.
 *   - `data-brand-dot` is set so the TravelingDot in the root layout
 *     can find the nav dot to fly the swarm hand-off into.
 *   - `data-name="hugo"` is set for the same Easter-egg reason a code
 *     character would have a name: the dot is Hugo. Never surfaced in
 *     user copy, only in DevTools for anyone curious enough to look.
 */
export default function BrandDot({
  interactive = false,
}: {
  interactive?: boolean;
}) {
  const [dotIdx, setDotIdx] = useLocalStorageState<number>(DOT_KEY, 0);
  const [bouncing, setBouncing] = useState(false);
  const [eyesVisible, setEyesVisible] = useState(false);
  // True while Hugo is on a fetch-and-return trip (initiated by clicking
  // a tool on the homepage swarm). The canvas-rendered traveling dot in
  // the root layout draws Hugo during this window; we hide the real
  // nav dot so there aren't two dots stacked on top of each other.
  const [traveling, setTraveling] = useState(false);
  // True while a page-level HugoStage owns the character (e.g. the
  // Advice page renders him large, center-stage). Same one-Hugo-at-a-
  // time rule as travel: the corner/footer dots yield the screen.
  const [stagePresent, setStagePresent] = useState(false);
  // True for the ~100ms an idle blink lasts. Only fires while eyes are
  // already visible; adds a beat of life so a held-open gaze doesn't
  // feel like a statue.
  const [blinking, setBlinking] = useState(false);
  // Gaze offset for the eyes (relative pixels). Drives the eye wrapper's
  // transform so both eyes shift together. Set by the tool-hover handler
  // when a swarm tool is hovered/dragged — Hugo *looks at* the tool.
  const [eyeGazeX, setEyeGazeX] = useState(0);
  const [eyeGazeY, setEyeGazeY] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  // Two independent "wants eyes open" sources combined with OR:
  // proximity (cursor near the wordmark) and tool-hover (user is engaging
  // with a swarm tool). Each is tracked in a ref; whenever either flips,
  // syncEyes() recomputes the visible state.
  const proxOpenRef = useRef(false);
  const hoverOpenRef = useRef(false);
  const hoverHideTimerRef = useRef<number | null>(null);
  // Third "wants eyes open" source — when the user selects text on
  // the page, Hugo opens his eyes and aims his gaze at the selection.
  // Lower priority than hover (hover wins if both are active).
  const selectionOpenRef = useRef(false);
  // Fourth "wants eyes open" source — page attention from the
  // MutationObserver. Lowest priority of the gaze drivers.
  const attentionOpenRef = useRef(false);
  // Easter egg state — Hugo plays dead when click-spammed. While
  // playing dead, his eyes squint to thin lines and stay visible
  // regardless of proximity/hover state. `huffSeq` is incremented
  // each trigger and used as a React key on the huff puff so the CSS
  // animation re-runs on repeat triggers.
  const [playingDead, setPlayingDead] = useState(false);
  const [huffSeq, setHuffSeq] = useState(0);
  const clickTimesRef = useRef<number[]>([]);
  const playDeadTimerRef = useRef<number | null>(null);
  // Drag-and-spring state. `dragOffset` is the transform applied to the
  // dot while held; `dragging` disables the transform transition so the
  // dot tracks the cursor instantly; `springingBack` enables a bouncy
  // transition that animates the offset back to zero on release;
  // `happy` triggers the coloured sparkle puff and forces the eyes
  // open + content. `sparkSeq` keys the puff so a repeat drag
  // re-mounts and re-plays the animation.
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [springingBack, setSpringingBack] = useState(false);
  const [happy, setHappy] = useState(false);
  const [sparkSeq, setSparkSeq] = useState(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const springTimerRef = useRef<number | null>(null);
  const happyTimerRef = useRef<number | null>(null);
  // Sleep state machine — `awake` (default) → `dozing` (tab hidden a
  // moment) → `asleep` (tab hidden a while, Z drifting) → `yawning`
  // (tab just returned, eyes pop) → `awake`. Lives in-memory only.
  // `zSeq` increments each Z cycle so the CSS animation re-runs.
  type Mood = "awake" | "dozing" | "asleep" | "yawning";
  const [mood, setMood] = useState<Mood>("awake");
  const [zSeq, setZSeq] = useState(0);
  const dozeTimerRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const yawnTimerRef = useRef<number | null>(null);
  // Konami-code somersault. While `flipping` is true, the dot
  // animates one rotation; the existing happy puff fires alongside at
  // the midpoint.
  const [flipping, setFlipping] = useState(false);
  const flipTimerRef = useRef<number | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  // The sprite canvas — Hugo's pixel body in the corner/footer.
  // Behaviour state stays exactly where it was; this is pure output.
  const spriteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  // Subscribe to Hugo's inner state — only primitives so re-renders
  // are cheap. BPM drives the heartbeat + breath rate; mood drives
  // the shadow halo + (later) the visible idle behaviours.
  const bpm = useHugoState((s) => s.bpm);
  const moodGlobal = useHugoState((s) => s.mood);
  const attention = useHugoState((s) => s.attention);
  const idleAction = useHugoState((s) => s.idleAction);
  const isFirstVisitToday = useHugoState((s) => s.isFirstVisitToday);
  const streakDays = useHugoState((s) => s.memory.streakDays);
  const pathname = usePathname();
  const prevPathRef = useRef<string | null>(null);

  // Streak recognition. When today is a new calendar day and the
  // user's consecutive-day streak is ≥ 3, fire a small reaction
  // ~700 ms after the page settles. 3–6: one sparkle. 7–29: sparkle +
  // bounce. 30+: sparkle + full somersault. The streak-clearing flag
  // prevents this firing twice on a quick tab-out / tab-in.
  useEffect(() => {
    if (!interactive) return;
    if (!isFirstVisitToday) return;
    if (streakDays < 3) return;
    const tid = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
      if (streakDays >= 7) {
        // One-shot bounce — same animation curve as the click bounce.
        setBouncing(true);
        window.setTimeout(() => setBouncing(false), 280);
      }
      if (streakDays >= 30) {
        setFlipping(true);
        if (flipTimerRef.current)
          window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = window.setTimeout(() => {
          setFlipping(false);
          flipTimerRef.current = null;
        }, FLIP_DURATION_MS);
      }
      clearFirstVisitFlag();
    }, 700);
    return () => window.clearTimeout(tid);
  }, [interactive, isFirstVisitToday, streakDays]);

  // Hydrate persisted memory from localStorage on first mount. This
  // is a side-effect so server-render markup matches the first client
  // paint; the persisted state lands in a second render.
  useEffect(() => {
    if (!interactive) return;
    hydrateFromStorage();
  }, [interactive]);

  // Mark a meaningful user interaction whenever the cursor moves or a
  // key is pressed. Used by the energy/mood loop to decide whether
  // Hugo should be draining or restoring energy.
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    let last = 0;
    const onInteract = () => {
      const now = Date.now();
      if (now - last < 1000) return; // throttle to 1 Hz
      last = now;
      hugoInteraction(now);
    };
    window.addEventListener("pointermove", onInteract, { passive: true });
    window.addEventListener("keydown", onInteract);
    window.addEventListener("touchstart", onInteract, { passive: true });
    window.addEventListener("scroll", onInteract, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onInteract);
      window.removeEventListener("keydown", onInteract);
      window.removeEventListener("touchstart", onInteract);
      window.removeEventListener("scroll", onInteract);
    };
  }, [interactive]);

  const safeIdx =
    Number.isFinite(dotIdx) && dotIdx >= 0 && dotIdx < DOT_COLORS.length
      ? dotIdx
      : 0;

  // Idle-blink scheduler — runs only while eyes are visible. Every
  // 4-7s, briefly close the eyes for ~100ms then open them again.
  // Close transition is fast (60ms ease) so it reads as a snap; the
  // open transition stays at the same 220ms ease the proximity reveal
  // uses. Asymmetric on purpose — real blinks close quickly, open
  // more slowly.
  useEffect(() => {
    if (!interactive) return;
    if (!eyesVisible) {
      // One-time reset when proximity ends mid-blink so the next
      // proximity reveal doesn't start with `blinking` stuck at true.
      // Not a cascading-render risk (only fires on the boolean edge),
      // but the React 19 compiler can't tell — suppress just here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlinking(false);
      return;
    }
    if (typeof window === "undefined") return;
    let cancelled = false;
    let scheduleTid: number | null = null;
    let openTid: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      // Blink cadence scales with Hugo's energy: high energy → quick
      // blinks (3–5s); medium → baseline (5–8s); low → laggy lid
      // travel (9–15s). Read at schedule time so a state change
      // applies on the next cycle without resetting the timer.
      const e = getHugoState().energy;
      const minDelay = e > 80 ? 3000 : e > 50 ? 5000 : 9000;
      const maxDelay = e > 80 ? 5000 : e > 50 ? 8000 : 15000;
      const delay = minDelay + Math.random() * (maxDelay - minDelay);
      scheduleTid = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        openTid = window.setTimeout(() => {
          if (cancelled) return;
          setBlinking(false);
          scheduleNext();
        }, 100);
      }, delay);
    };
    scheduleNext();

    return () => {
      cancelled = true;
      if (scheduleTid) window.clearTimeout(scheduleTid);
      if (openTid) window.clearTimeout(openTid);
    };
  }, [interactive, eyesVisible]);

  // Subscribe to Hugo's travel state. Applies to both interactive (nav)
  // and non-interactive (footer) variants — the footer dot also hides
  // because Hugo can fly across the bottom of the viewport during a
  // tool click on long pages and the eye sees both dots otherwise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTraveling = (e: Event) => {
      const detail = (e as CustomEvent<{ traveling: boolean }>).detail;
      if (!detail) return;
      setTraveling(detail.traveling);
    };
    window.addEventListener("hugoslekstuga:hugo-traveling", onTraveling);
    const onStage = (e: Event) => {
      const detail = (e as CustomEvent<{ present: boolean }>).detail;
      if (!detail) return;
      setStagePresent(detail.present);
    };
    window.addEventListener("hugoslekstuga:hugo-stage", onStage);
    return () => {
      window.removeEventListener(
        "hugoslekstuga:hugo-traveling",
        onTraveling,
      );
      window.removeEventListener("hugoslekstuga:hugo-stage", onStage);
    };
  }, []);

  // Clear the easter-egg timers on unmount so a navigation away
  // during the play-dead or drag-and-spring window doesn't leak.
  useEffect(() => {
    return () => {
      if (playDeadTimerRef.current) {
        window.clearTimeout(playDeadTimerRef.current);
      }
      if (springTimerRef.current) {
        window.clearTimeout(springTimerRef.current);
      }
      if (happyTimerRef.current) {
        window.clearTimeout(happyTimerRef.current);
      }
      if (dozeTimerRef.current) {
        window.clearTimeout(dozeTimerRef.current);
      }
      if (sleepTimerRef.current) {
        window.clearTimeout(sleepTimerRef.current);
      }
      if (yawnTimerRef.current) {
        window.clearTimeout(yawnTimerRef.current);
      }
      if (flipTimerRef.current) {
        window.clearTimeout(flipTimerRef.current);
      }
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Visibility-driven sleep state machine. Only attached on the
  // interactive variant — the footer dot stays awake (no eyes anyway).
  // Tab-hidden starts a doze countdown; tab-visible interrupts and
  // either yawns him awake (if he had drifted off) or no-ops. The
  // play-dead / drag / happy easter eggs run independent of sleep —
  // they win locally while they're active, and a tab-hide during one
  // of them still arms the doze countdown but the visual is just
  // overridden by the easter egg until it finishes.
  useEffect(() => {
    if (!interactive) return;
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.hidden) {
        // Tab leaving — cancel any pending yawn, start the doze
        // countdown. Don't preemptively set "dozing" before the small
        // grace period so a quick Cmd-Tab back-and-forth doesn't
        // briefly read as "Hugo closed his eyes."
        if (yawnTimerRef.current) {
          window.clearTimeout(yawnTimerRef.current);
          yawnTimerRef.current = null;
        }
        if (dozeTimerRef.current) {
          window.clearTimeout(dozeTimerRef.current);
        }
        dozeTimerRef.current = window.setTimeout(() => {
          setMood("dozing");
          dozeTimerRef.current = null;
          sleepTimerRef.current = window.setTimeout(() => {
            setMood("asleep");
            hugoNap();
            sleepTimerRef.current = null;
          }, SLEEP_DELAY_MS - DOZE_DELAY_MS);
        }, DOZE_DELAY_MS);
      } else {
        // Tab returning — clear pending. If he had actually drifted
        // off, run the yawn. If he was just dozing or hadn't started
        // yet, skip the yawn (no need to dramatise a non-event).
        if (dozeTimerRef.current) {
          window.clearTimeout(dozeTimerRef.current);
          dozeTimerRef.current = null;
        }
        if (sleepTimerRef.current) {
          window.clearTimeout(sleepTimerRef.current);
          sleepTimerRef.current = null;
        }
        setMood((current) => {
          if (current === "asleep" || current === "dozing") {
            if (yawnTimerRef.current) {
              window.clearTimeout(yawnTimerRef.current);
            }
            yawnTimerRef.current = window.setTimeout(() => {
              setMood("awake");
              hugoMoodEvent("wake");
              yawnTimerRef.current = null;
            }, YAWN_DURATION_MS);
            return "yawning";
          }
          return "awake";
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [interactive]);

  // Cycle the Z key while asleep so the CSS animation re-fires every
  // ~3.6 s. One Z at a time — a slow, gentle ambient signal.
  useEffect(() => {
    if (mood !== "asleep") return;
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => setZSeq((s) => s + 1), Z_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [mood]);

  // Any code on the site can dispatch `hugoslekstuga:hugo-happy` to
  // trigger Hugo's joy reaction — eyes wide, coloured sparkles burst
  // above his head. Currently fires when a Sudoku puzzle is solved.
  // The local drag-release flow has its own path; this is purely the
  // global-event surface so other tools don't need to know how the
  // celebration is rendered.
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    const onHappy = () => {
      setHappy(true);
      setSparkSeq((s) => s + 1);
      hugoMoodEvent("happy");
      if (happyTimerRef.current) window.clearTimeout(happyTimerRef.current);
      happyTimerRef.current = window.setTimeout(() => {
        setHappy(false);
        happyTimerRef.current = null;
      }, HAPPY_DURATION_MS);
    };
    window.addEventListener("hugoslekstuga:hugo-happy", onHappy);
    return () =>
      window.removeEventListener("hugoslekstuga:hugo-happy", onHappy);
  }, [interactive]);

  // Recompute eyes-visible from the OR of the three "wants open"
  // sources. Wrapped so each effect handler can call it without
  // duplicating the boolean expression.
  const syncEyes = () => {
    setEyesVisible(
      proxOpenRef.current ||
        hoverOpenRef.current ||
        selectionOpenRef.current ||
        attentionOpenRef.current,
    );
  };

  // Proximity detection — interactive variant only. Mouse-only; touch
  // users get the eye reveal via the tap handler so they aren't excluded.
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    const onMove = (e: MouseEvent) => {
      const node = btnRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      const proximityPx = Math.max(
        PROXIMITY_FLOOR_PX,
        Math.max(r.width, r.height) * PROXIMITY_RATIO,
      );
      if (d < proximityPx) {
        proxOpenRef.current = true;
        syncEyes();
        if (hideTimerRef.current) {
          window.clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      } else {
        if (hideTimerRef.current) return;
        hideTimerRef.current = window.setTimeout(() => {
          proxOpenRef.current = false;
          syncEyes();
          hideTimerRef.current = null;
        }, EYES_HIDE_DELAY_MS);
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [interactive]);

  // Tool-hover handler — ToolMap dispatches `hugoslekstuga:tool-hover`
  // each rAF frame while the user is hovering or dragging a swarm dot
  // (detail = { x, y } in viewport coords), and once with detail = null
  // when they let go. Hugo opens his eyes *and* offsets them toward the
  // tool's screen position so he visibly looks at what the user is
  // engaging with. The actual nav dot stays in place — only the gaze
  // shifts. Reset to neutral with a small delay so brief gaps between
  // hovering adjacent tools don't flicker the eyes shut.
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    const onHover = (e: Event) => {
      const detail = (
        e as CustomEvent<{ x: number; y: number } | null>
      ).detail;
      const node = btnRef.current;
      if (!node) return;
      if (!detail) {
        if (hoverHideTimerRef.current) return;
        hoverHideTimerRef.current = window.setTimeout(() => {
          hoverOpenRef.current = false;
          setEyeGazeX(0);
          setEyeGazeY(0);
          syncEyes();
          hoverHideTimerRef.current = null;
        }, 220);
        return;
      }
      if (hoverHideTimerRef.current) {
        window.clearTimeout(hoverHideTimerRef.current);
        hoverHideTimerRef.current = null;
      }
      const r = node.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = detail.x - cx;
      const dy = detail.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Gaze offset: 22% of dot diameter in the tool's direction.
      // Stays well inside the dot's bounds so the eyes never escape.
      const offset = Math.min(r.width, r.height) * 0.22;
      setEyeGazeX((dx / dist) * offset);
      setEyeGazeY((dy / dist) * offset);
      hoverOpenRef.current = true;
      syncEyes();
    };
    window.addEventListener("hugoslekstuga:tool-hover", onHover);
    return () => {
      window.removeEventListener("hugoslekstuga:tool-hover", onHover);
      if (hoverHideTimerRef.current)
        window.clearTimeout(hoverHideTimerRef.current);
    };
  }, [interactive]);

  // Page-attention → gaze. When the central state's `attention`
  // target updates (driven by MutationObserver on the page), shift
  // Hugo's eyes toward it. Hover and selection win — if either is
  // claiming the gaze, attention waits its turn.
  useEffect(() => {
    if (!interactive) return;
    if (!attention) return;
    if (hoverOpenRef.current || selectionOpenRef.current) return;
    const node = btnRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = attention.x - cx;
    const dy = attention.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const offset = Math.min(r.width, r.height) * 0.22;
    setEyeGazeX((dx / dist) * offset);
    setEyeGazeY((dy / dist) * offset);
    // Open eyes briefly so the glance reads. Uses its own ref so the
    // mousemove handler can't flip it off mid-glance the way a shared
    // proxOpenRef would.
    attentionOpenRef.current = true;
    syncEyes();
  }, [attention, interactive]);

  // When attention clears and nothing else is claiming the gaze,
  // ease the eyes back to neutral. Keeps the gaze priority chain
  // honest without putting the cleanup logic in three places.
  useEffect(() => {
    if (!interactive) return;
    if (attention) return;
    attentionOpenRef.current = false;
    if (hoverOpenRef.current || selectionOpenRef.current) return;
    setEyeGazeX(0);
    setEyeGazeY(0);
    syncEyes();
  }, [attention, interactive]);

  // Stochastic idle-action visual driver. The store fires an action
  // every 25–45 s; here we translate it into a visible micro-effect:
  //   - look-around → random-direction gaze for ~700 ms
  //   - deep-blink  → forced blink for ~350 ms
  // head-tilt and deep-breath are rendered as inline transforms on
  // the button itself (further down).
  useEffect(() => {
    if (!interactive) return;
    if (!idleAction) return;
    if (idleAction === "deep-blink") {
      // One-shot transient — the compiler warns about setState in
      // an effect but this is the right pattern for a discrete
      // visual that needs to clear after its duration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBlinking(true);
      const tid = window.setTimeout(() => setBlinking(false), 350);
      return () => window.clearTimeout(tid);
    }
    if (idleAction === "look-around") {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const angle = Math.random() * Math.PI * 2;
      const offset = Math.min(r.width, r.height) * 0.22;
      setEyeGazeX(Math.cos(angle) * offset);
      setEyeGazeY(Math.sin(angle) * offset);
      attentionOpenRef.current = true;
      syncEyes();
      const tid = window.setTimeout(() => {
        setEyeGazeX(0);
        setEyeGazeY(0);
        attentionOpenRef.current = false;
        syncEyes();
      }, 700);
      return () => window.clearTimeout(tid);
    }
  }, [idleAction, interactive]);

  // Route-change → mood + memory. Excited mood spike on every
  // navigation; if the new path is a tool/game, also bump that
  // tool's open count in persistent memory so we can compute a
  // favourite later.
  useEffect(() => {
    if (!interactive) return;
    if (prevPathRef.current === null) {
      prevPathRef.current = pathname;
      return;
    }
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;
    hugoMoodEvent("navigated");
    const m =
      pathname.match(/\/tools\/([^/]+)/) ||
      pathname.match(/\/games\/([^/]+)/);
    if (m) hugoSawTool(m[1]);
  }, [pathname, interactive]);

  // Konami code listener. Maintains a 10-deep circular buffer of
  // recent keys; any non-matching key resets the buffer naturally
  // because it never aligns with KONAMI[0]. On match, fire the flip
  // and the existing happy event (so the sparkle puff plays in sync).
  useEffect(() => {
    if (!interactive) return;
    if (typeof window === "undefined") return;
    const buffer: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      buffer.push(k);
      if (buffer.length > KONAMI.length) buffer.shift();
      if (buffer.length < KONAMI.length) return;
      for (let i = 0; i < KONAMI.length; i++) {
        if (buffer[i] !== KONAMI[i]) return;
      }
      buffer.length = 0;
      // Trigger the flip
      hugoMoodEvent("flip");
      setFlipping(true);
      if (flipTimerRef.current) window.clearTimeout(flipTimerRef.current);
      flipTimerRef.current = window.setTimeout(() => {
        setFlipping(false);
        flipTimerRef.current = null;
      }, FLIP_DURATION_MS);
      // Fire the happy puff at the midpoint via the existing event
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
      }, FLIP_DURATION_MS / 2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive]);

  // Selection-glance handler. Whenever the user has a non-collapsed
  // text selection on the page, Hugo opens his eyes and aims them at
  // the selection's bounding rect — like he's reading over your
  // shoulder. Decays after 800 ms of no further selection change.
  // Hover wins (tool-hover sets its own gaze); skipped when the
  // selection overlaps Hugo himself (don't look at yourself) or when
  // it spans more than half the viewport in either axis (Cmd+A has
  // no sensible target).
  useEffect(() => {
    if (!interactive) return;
    if (typeof document === "undefined") return;
    let decayTid: number | null = null;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (decayTid) window.clearTimeout(decayTid);
        decayTid = window.setTimeout(() => {
          selectionOpenRef.current = false;
          // Reset gaze only if hover hasn't claimed it.
          if (!hoverOpenRef.current) {
            setEyeGazeX(0);
            setEyeGazeY(0);
          }
          syncEyes();
          decayTid = null;
        }, 800);
        return;
      }
      // Hover-driven gaze wins — let it stay in control.
      if (hoverOpenRef.current) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (
        rect.width > window.innerWidth / 2 ||
        rect.height > window.innerHeight / 2
      ) {
        return;
      }
      const node = btnRef.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      // Don't aim at a selection that overlaps Hugo (e.g. someone
      // selects across the wordmark). Eyes shouldn't track themselves.
      const overlapsSelf = !(
        rect.right < r.left ||
        rect.left > r.right ||
        rect.bottom < r.top ||
        rect.top > r.bottom
      );
      if (overlapsSelf) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = rect.left + rect.width / 2 - cx;
      const dy = rect.top + rect.height / 2 - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Same 22% gaze offset the hover handler uses, so both gaze
      // sources read at the same visual amplitude.
      const offset = Math.min(r.width, r.height) * 0.22;
      setEyeGazeX((dx / dist) * offset);
      setEyeGazeY((dy / dist) * offset);
      selectionOpenRef.current = true;
      if (decayTid) {
        window.clearTimeout(decayTid);
        decayTid = null;
      }
      syncEyes();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (decayTid) window.clearTimeout(decayTid);
    };
  }, [interactive]);

  // The non-interactive variant (footer dot) renders a plain coloured
  // disc with no eyes, no heartbeat, no leash. Hooks above all still
  // run so React's hook-order contract is preserved across both
  // variants. Returned as the JSX below — the inner-life behaviours
  // hang off the interactive variant only.
  const nonInteractiveMarkup = !interactive ? (
    <span
      aria-hidden
      data-brand-dot
      data-name="hugo"
      style={{
        position: "relative",
        display: "inline-block",
        width: "0.7em",
        height: "0.7em",
        verticalAlign: "baseline",
        opacity: traveling || stagePresent ? 0 : 1,
        transition: "opacity 60ms linear",
      }}
    >
      {/* Static sprite stamp — lids down, sleeping in the footer. */}
      <canvas
        ref={spriteCanvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
        }}
      />
    </span>
  ) : null;

  const cycle = () => {
    setDotIdx((i) => (i + 1) % DOT_COLORS.length);
    // Tap-toggle eyes for touch users. On desktop the next mousemove
    // re-syncs from the proximity refs anyway, so this is effectively
    // touch-only.
    proxOpenRef.current = !proxOpenRef.current;
    syncEyes();
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), 280);

    // Easter egg — track rapid clicks and trigger "play dead" if Hugo
    // is being pestered. Skip the spam check while already playing dead
    // so additional clicks in that window don't extend or re-trigger.
    if (playingDead) return;
    const now = Date.now();
    const history = clickTimesRef.current;
    history.push(now);
    while (history.length > 0 && history[0] < now - SPAM_CLICK_WINDOW_MS) {
      history.shift();
    }
    if (history.length >= SPAM_CLICK_THRESHOLD) {
      clickTimesRef.current = [];
      setPlayingDead(true);
      setHuffSeq((s) => s + 1);
      hugoMoodEvent("tantrum");
      if (playDeadTimerRef.current) {
        window.clearTimeout(playDeadTimerRef.current);
      }
      playDeadTimerRef.current = window.setTimeout(() => {
        setPlayingDead(false);
        playDeadTimerRef.current = null;
      }, PLAY_DEAD_DURATION_MS);
      // Hugo's anger ripples out — the whole page shakes for ~500ms
      // with a quick warm-tint flush on the background. Direct DOM
      // class toggle so it works regardless of which React tree the
      // BrandDot was rendered into.
      if (typeof document !== "undefined") {
        const cls = "hugo-tantrum";
        // Remove first to reset the animation if a previous tantrum
        // hadn't fully finished, then re-add on the next frame so the
        // CSS animation restarts cleanly.
        document.body.classList.remove(cls);
        // Force a reflow so the class re-add re-triggers the animation
        // (browsers debounce identical class adds within a frame).
        void document.body.offsetWidth;
        document.body.classList.add(cls);
        window.setTimeout(() => {
          document.body.classList.remove(cls);
        }, 520);
      }
    }
  };

  // ----- Long-press: Hugo's parkour ----------------------------------------
  // Homepage-only, keyboard-driven (hover-capable devices). The game
  // itself lives in components/hugo/HugoParkour.tsx; it hides this dot
  // through the hugo-stage event while it owns the character.
  const startParkour = () => {
    if (window.location.pathname !== "/") return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    hugoInteraction();
    window.dispatchEvent(new CustomEvent("hugoslekstuga:parkour-start"));
  };


  // Pointer handlers — replace the simple onClick with a pointer
  // capture flow so we can disambiguate a click from a drag. A short
  // press releases as a click (cycle colour); a longer drag with
  // movement releases as a drop (spring back + happy puff). Pointer
  // capture means we keep receiving move/up events even if the
  // cursor wanders off Hugo.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (playingDead || traveling || stagePresent) return;
    if (dragRef.current) return; // already tracking a drag
    const node = btnRef.current;
    if (!node) return;
    try {
      node.setPointerCapture(e.pointerId);
    } catch {
      // Some legacy browsers throw on setPointerCapture; safe to fall
      // through — pointermove/up will still fire on the button itself
      // for the immediate area.
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    // Start the long-press → parkour countdown. Cancelled by movement
    // (becomes drag-and-spring) or release (becomes cycle-colour).
    if (longPressTimerRef.current)
      window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const ds = dragRef.current;
      if (!ds || ds.moved) return;
      // Drop the drag intent so the eventual pointer-up is a no-op —
      // the game owns Hugo from here.
      dragRef.current = null;
      startParkour();
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragRef.current;
    if (!ds || e.pointerId !== ds.pointerId) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.hypot(dx, dy) > DRAG_TRIGGER_PX) {
      ds.moved = true;
      setDragging(true);
      // Movement → not a long-press. Cancel the parkour countdown.
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
    if (ds.moved) {
      setDragOffsetX(dx);
      setDragOffsetY(dy);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Release cancels any pending long-press → parkour.
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const ds = dragRef.current;
    if (!ds || e.pointerId !== ds.pointerId) return;
    const node = btnRef.current;
    if (node) {
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {}
    }
    if (ds.moved) {
      // Drag-and-drop completed. Spring Hugo home, then celebrate.
      setDragOffsetX(0);
      setDragOffsetY(0);
      setSpringingBack(true);
      setDragging(false);
      if (springTimerRef.current) window.clearTimeout(springTimerRef.current);
      springTimerRef.current = window.setTimeout(() => {
        setSpringingBack(false);
        setHappy(true);
        setSparkSeq((s) => s + 1);
        if (happyTimerRef.current) window.clearTimeout(happyTimerRef.current);
        happyTimerRef.current = window.setTimeout(() => {
          setHappy(false);
          happyTimerRef.current = null;
        }, HAPPY_DURATION_MS);
        springTimerRef.current = null;
      }, SPRING_BACK_MS);
    } else if (e.shiftKey) {
      // Shift-click opens Hugo's room — a peek into his inner state.
      // Skip the colour cycle so we don't change colour on the way in.
      setRoomOpen(true);
    } else {
      // Short tap — defer to the existing click behaviour.
      cycle();
    }
    dragRef.current = null;
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragRef.current;
    if (!ds || e.pointerId !== ds.pointerId) return;
    // Cancel mid-drag — spring home without the happy reward.
    setDragOffsetX(0);
    setDragOffsetY(0);
    setSpringingBack(true);
    setDragging(false);
    if (springTimerRef.current) window.clearTimeout(springTimerRef.current);
    springTimerRef.current = window.setTimeout(() => {
      setSpringingBack(false);
      springTimerRef.current = null;
    }, SPRING_BACK_MS);
    dragRef.current = null;
  };

  // Compose the active transform from drag offset + bounce scale.
  // Order matters: translate first, scale after, so the bounce
  // happens around the dragged position rather than the origin.
  const hasDragOffset = dragOffsetX !== 0 || dragOffsetY !== 0;
  const transformParts: string[] = [];
  if (hasDragOffset) {
    transformParts.push(`translate(${dragOffsetX}px, ${dragOffsetY}px)`);
  }
  if (bouncing) transformParts.push("scale(1.4)");
  // Stochastic idle micro-behaviour visuals. Head-tilt nudges ~4°;
  // deep-breath scales up briefly to 1.2 (more than the regular
  // 1.14 breath peak) so the difference reads as "noticeable inhale."
  if (idleAction === "head-tilt") transformParts.push("rotate(4deg)");
  if (idleAction === "deep-breath") transformParts.push("scale(1.22)");
  const transform = transformParts.length > 0 ? transformParts.join(" ") : undefined;

  // Derive breath period from the live BPM. Clamp BPM so a wild
  // state value never produces a 0-second animation. Breath is one
  // cycle per ~4 beats — a rough echo of the real respiratory : heart
  // ratio. (BPM itself is still surfaced as a number inside Hugo's
  // room; the visible heartbeat ring was removed for being too loud
  // for an easter egg.)
  const safeBpm = Math.max(20, Math.min(180, bpm));
  const breathPeriodSec = (60 / safeBpm) * 4;

  // Mood-tinted halo. Subtle by default; a warmer pink when excited,
  // a coral edge when grumpy, near-dark when sleepy. Phosphor glows
  // now — applied as a drop-shadow filter on the sprite canvas so the
  // halo follows Hugo's pixel silhouette, not a rounded box.
  const moodGlow: Record<string, string> = {
    sleepy: "drop-shadow(0 0 3px rgba(232, 242, 233, 0.05))",
    calm: "drop-shadow(0 0 6px rgba(232, 242, 233, 0.10))",
    curious: "drop-shadow(0 0 8px rgba(138, 240, 255, 0.24))",
    excited: "drop-shadow(0 0 10px rgba(255, 79, 216, 0.34))",
    grumpy: "drop-shadow(0 0 9px rgba(255, 110, 94, 0.34))",
  };
  const dotGlow = moodGlow[moodGlobal] ?? moodGlow.calm;

  // ----- Sprite output ------------------------------------------------------
  // Everything below maps the existing behaviour state onto the shared
  // 16×16 sprite. Resting Hugo keeps his lids down; proximity (or a
  // happy moment, or being dragged) opens the eyes — the same reveal
  // the DOM eyes performed, now in pixels.
  const accentHex = COLOR_HEX[COLOR_ORDER[safeIdx]];
  const spriteEyeOpen =
    happy || dragging || mood === "yawning"
      ? true
      : playingDead || mood === "dozing" || mood === "asleep"
        ? false
        : eyesVisible && !blinking;
  const spriteEyeWide = happy || mood === "yawning";
  const gazeSuppressed =
    playingDead ||
    happy ||
    dragging ||
    mood === "dozing" ||
    mood === "asleep";
  const spriteDx = (
    gazeSuppressed || Math.abs(eyeGazeX) < 1.2 ? 0 : eyeGazeX < 0 ? -1 : 1
  ) as -1 | 0 | 1;
  const spriteDy = (
    gazeSuppressed || Math.abs(eyeGazeY) < 1.2 ? 0 : eyeGazeY < 0 ? -1 : 1
  ) as -1 | 0 | 1;

  // Redraw the corner/footer sprite whenever a visual input changes.
  // A 36px canvas redraw is cheaper than the DOM style writes it
  // replaces; gaze changes arrive at rAF rate during swarm hover and
  // this keeps up without a dedicated loop.
  useEffect(() => {
    const canvas = spriteCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cssSize = canvas.getBoundingClientRect().width || 36;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const target = spriteCanvasSize(cssSize, dpr);
    if (canvas.width !== target) {
      canvas.width = target;
      canvas.height = target;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    drawHugoSprite(ctx, {
      x: canvas.width / 2,
      y: canvas.height / 2,
      px: canvas.width / 16,
      accent: accentHex,
      eye: {
        open: interactive ? spriteEyeOpen : false,
        wide: spriteEyeWide,
        dx: spriteDx,
        dy: spriteDy,
      },
    });
  }, [accentHex, interactive, spriteEyeOpen, spriteEyeWide, spriteDx, spriteDy]);

  // Transition selection — instant during drag, spring back on release,
  // bouncy on click, gentle ease otherwise.
  const transformTransition = dragging
    ? "transform 0ms linear"
    : springingBack
    ? `transform ${SPRING_BACK_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`
    : bouncing
    ? "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)"
    : "transform 180ms ease";

  if (nonInteractiveMarkup) return nonInteractiveMarkup;

  return (
    <>
    <button
      type="button"
      ref={btnRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label="Change accent colour"
      data-brand-dot
      data-name="hugo"
      style={{
        position: "relative",
        display: "inline-block",
        width: "0.7em",
        height: "0.7em",
        border: "none",
        padding: 0,
        margin: 0,
        background: "transparent",
        cursor: dragging ? "grabbing" : "pointer",
        verticalAlign: "baseline",
        // A hair of breathing room so the dot doesn't kiss the 'a' of
        // the wordmark. Em-based so it scales with font size.
        marginLeft: "0.16em",
        opacity: traveling || stagePresent ? 0 : 1,
        transform,
        transition: `${transformTransition}, opacity 60ms linear`,
        // Idle breathing pauses during any active animation (drag,
        // spring, bounce, or happy reaction) so the dot's motion comes
        // from one coherent place at a time. Konami flip wins over
        // breathing — it's a one-shot 360° tumble on the `rotate`
        // longhand so it composes with the inline `transform`. Breath
        // period is tied to live BPM via --hugo-breath-period.
        animation: flipping
          ? `hugo-flip ${FLIP_DURATION_MS}ms cubic-bezier(0.5, 0, 0.5, 1)`
          : bouncing || dragging || springingBack || happy
            ? "none"
            : `brand-dot-breathe var(--hugo-breath-period, 3.4s) ease-in-out infinite`,
        // Expose BPM-derived breath period to the breathing animation
        // so it speeds/slows with Hugo's mood. The CSS variable keeps
        // the animation declarative and pauses cleanly under
        // prefers-reduced-motion.
        ["--hugo-breath-period" as string]: `${breathPeriodSec}s`,
        // Pointer-down should commit to a drag intent rather than
        // letting the browser interpret it as a text selection or
        // touch scroll.
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Hugo's pixel body. The mood halo rides the sprite's alpha via
          drop-shadow, so it hugs the silhouette instead of a box. */}
      <canvas
        ref={spriteCanvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          filter: dotGlow,
          pointerEvents: "none",
        }}
      />
      {/* The "annoyed huff" puff — three overlapping ink circles
          rising out of Hugo's head when he plays dead. Only mounted
          while `playingDead` is true; the CSS animation runs once and
          ends invisible (opacity 0). Keyed on playingDead so each new
          easter-egg trigger re-mounts and re-plays the animation. */}
      {playingDead && (
        <span
          key={`huff-${huffSeq}`}
          aria-hidden
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            marginLeft: "-0.45em",
            width: "0.9em",
            height: "0.55em",
            pointerEvents: "none",
            animation: "hugo-huff 1500ms ease-out forwards",
          }}
        >
          {/* Three overlapping puffs forming a cartoon exhale silhouette */}
          <span
            style={{
              position: "absolute",
              left: "0.05em",
              bottom: 0,
              width: "0.28em",
              height: "0.28em",
              borderRadius: "9999px",
              background: "var(--color-ink)",
            }}
          />
          <span
            style={{
              position: "absolute",
              left: "0.28em",
              bottom: "0.12em",
              width: "0.36em",
              height: "0.36em",
              borderRadius: "9999px",
              background: "var(--color-ink)",
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "0.05em",
              bottom: 0,
              width: "0.28em",
              height: "0.28em",
              borderRadius: "9999px",
              background: "var(--color-ink)",
            }}
          />
        </span>
      )}
      {/* Hugo's ⌘K whisper — a tiny pill drifts up over his head the
          way the sleep "z" does, but with the keyboard shortcut for
          the search palette inside. Fires from the central idle
          scheduler when the user is on a non-homepage route. Uses
          the same hugo-z-drift keyframe so the motion vocabulary
          stays unified. */}
      {idleAction === "cmd-k-hint" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            marginLeft: "-1.2em",
            fontSize: "0.32em",
            lineHeight: 1,
            fontWeight: 800,
            fontFamily: "var(--font-display)",
            color: "var(--color-cream)",
            background: "var(--color-ink)",
            border: "2px solid var(--color-ink)",
            borderRadius: "9999px",
            padding: "0.3em 0.7em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            animation: "hugo-z-drift 1800ms ease-out forwards",
            opacity: 0,
            letterSpacing: "0.04em",
          }}
        >
          {typeof navigator !== "undefined" &&
          /mac/i.test(navigator.platform)
            ? "⌘K"
            : "Ctrl K"}
        </span>
      )}
      {/* The sleep "z" — a single small glyph that fades in above
          Hugo's right ear, drifts up, and fades out. Re-mounted on
          each zSeq tick so the CSS animation re-runs. One Z at a time;
          never a cloud. Gated off entirely under reduced motion via
          globals.css. */}
      {mood === "asleep" && (
        <span
          key={`z-${zSeq}`}
          aria-hidden
          style={{
            position: "absolute",
            bottom: "70%",
            left: "70%",
            fontSize: "0.55em",
            lineHeight: 1,
            pointerEvents: "none",
            color: "var(--color-ink-soft)",
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            animation: "hugo-z-drift 2400ms ease-out forwards",
            opacity: 0,
          }}
        >
          z
        </span>
      )}
      {/* The "happy puff" — coloured sparkles that fan out above
          Hugo's head when a drag completes. Five small accent-coloured
          dots fly outward along an upward arc, scale up at the apex,
          then fade as they continue. Keyed on sparkSeq so each
          completed drag re-mounts and re-plays the animation. */}
      {happy && (
        <span
          key={`spark-${sparkSeq}`}
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "0",
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        >
          {HAPPY_SPARK_COLORS.map((sparkColor, i) => {
            // Five sparkles spread across the upper hemisphere
            // (angles 200° → 340°, measured CCW from +x).
            const angle = ((200 + i * 35) * Math.PI) / 180;
            // Travel distance scales with the dot's font-size so big
            // and small renders both work. Magic numbers picked to
            // feel like a small joyful burst, not a celebration cannon.
            const dx = Math.cos(angle) * 1.4;
            const dy = Math.sin(angle) * 1.4;
            return (
              <span
                key={i}
                style={
                  {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: "0.2em",
                    height: "0.2em",
                    marginLeft: "-0.1em",
                    marginTop: "-0.1em",
                    borderRadius: "9999px",
                    background: sparkColor,
                    animation: "hugo-happy-spark 1200ms ease-out forwards",
                    "--dx": `${dx}em`,
                    "--dy": `${dy}em`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </span>
      )}
      {/* The DOM eye spans are gone — gaze, blinks, squints and the
          yawn all render inside the sprite canvas above, fed by the
          same state that used to drive these styles. */}
    </button>
    {/* Hugo's room — shift+click the dot opens it. Rendered via a
        portal so it sits at the body level above the rest of the
        UI. Closes on Esc or click-outside (handled inside). */}
    {roomOpen && <HugoRoom onClose={() => setRoomOpen(false)} />}
    </>
  );
}
