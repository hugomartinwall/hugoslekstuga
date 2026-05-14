"use client";

/**
 * Hugo's inner life — a single source of truth for the brand dot's
 * mood, energy, attention, and persisted memory. Module-scope
 * singleton with subscribe-listen-emit. Components bind via
 * `useHugoState(selector)`, a `useSyncExternalStore` wrapper.
 *
 * The "tick" loop runs while anyone is subscribed:
 *   - energy drains during activity, restores while idle/asleep
 *   - mood transitions on timeouts (excited → calm after 30s, etc.)
 *   - attention decays after a short window
 *   - bpm derives from mood + energy and exposes via CSS variables
 *
 * The brand rule is that nothing leaves the device — all persistence
 * is localStorage under `hugoslekstuga:hugo:state:v1`. Server-render
 * uses defaults; client hydrates from storage in a one-shot effect.
 */

import { useSyncExternalStore } from "react";

export type HugoMood = "sleepy" | "calm" | "curious" | "excited" | "grumpy";

export type HugoMemory = {
  /** Epoch ms — Hugo's "birthday" (first time the user visited). */
  firstSeen: number;
  /** Epoch ms — last visit timestamp. */
  lastSeen: number;
  /** Total number of distinct page loads. */
  visitCount: number;
  /** Consecutive days the user has visited. */
  streakDays: number;
  /** YYYY-MM-DD of the most recent visit, used for streak math. */
  lastDateKey: string;
  /** Slug of the tool with the highest open count. */
  favoriteToolSlug: string | null;
  /** Per-tool open counter. */
  toolCounts: Record<string, number>;
  /** Number of times Hugo has been "asleep" (visibility hide ≥ 3s). */
  naps: number;
  /** Number of times the spam-click tantrum has fired. */
  tantrums: number;
  /** Number of times the konami flip has fired. */
  flips: number;
};

export type HugoAttention = {
  kind: "cursor" | "selection" | "mutation" | "hover" | "idle";
  /** Viewport coords of the thing Hugo is looking at. */
  x: number;
  y: number;
  /** Epoch ms when the attention was set. Used for decay. */
  since: number;
};

export type HugoState = {
  /** 0–100. Drains during activity; restores while idle or asleep. */
  energy: number;
  /** Discrete mood, transitions driven by events + timeouts. */
  mood: HugoMood;
  /** Epoch ms when the current mood was entered (for timeout-driven transitions). */
  moodSince: number;
  /** Heart rate in beats per minute. Derived from mood + energy. */
  bpm: number;
  /** Current attention target, if any. Decays after ~1.2s. */
  attention: HugoAttention | null;
  /** Epoch ms of the last meaningful user interaction. */
  lastInteraction: number;
  /** Persisted memory across visits. */
  memory: HugoMemory;
  /** Tiny personality drift — colour bias accumulates over many visits. */
  personality: { colorBias: number };
  /** True for the first page load on a new calendar day. */
  isFirstVisitToday: boolean;
  /** Transient stochastic idle action, cleared after it plays. */
  idleAction: "look-around" | "head-tilt" | "deep-blink" | "deep-breath" | null;
  /** Set true after `hydrateFromStorage` finishes; lets effects fire once. */
  hydrated: boolean;
};

const STORAGE_KEY = "hugoslekstuga:hugo:state:v1";
const TICK_INTERVAL_MS = 250;

/** Mood → baseline BPM. Real heart rates roughly bracketed: sleeping
 *  ~35 bpm (resting low), grumpy/curious bumped, excited spikes. */
const BASE_BPM: Record<HugoMood, number> = {
  sleepy: 38,
  calm: 60,
  curious: 80,
  excited: 115,
  grumpy: 95,
};

function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function moodFromHour(h: number): HugoMood {
  if (h >= 22 || h < 5) return "sleepy"; // late night
  if (h >= 5 && h < 10) return "curious"; // morning
  if (h >= 18 && h < 22) return "calm"; // evening mellow
  return "calm"; // midday baseline
}

export function computeBpm(mood: HugoMood, energy: number): number {
  // Energy ±50 swings bpm ±15 within the mood band.
  return BASE_BPM[mood] + (energy - 50) * 0.3;
}

function defaultMemory(now: number): HugoMemory {
  return {
    firstSeen: now,
    lastSeen: now,
    visitCount: 0,
    streakDays: 1,
    lastDateKey: dateKeyOf(new Date(now)),
    favoriteToolSlug: null,
    toolCounts: {},
    naps: 0,
    tantrums: 0,
    flips: 0,
  };
}

function defaultState(now: number): HugoState {
  const mood = moodFromHour(new Date(now).getHours());
  return {
    energy: 80,
    mood,
    moodSince: now,
    bpm: computeBpm(mood, 80),
    attention: null,
    lastInteraction: now,
    memory: defaultMemory(now),
    personality: { colorBias: 0 },
    isFirstVisitToday: false,
    idleAction: null,
    hydrated: false,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let state: HugoState = defaultState(Date.now());
const listeners = new Set<() => void>();
let tickHandle: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
let persistHandle: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<HugoState>) {
  state = { ...state, ...patch };
  emit();
  schedulePersist();
}

function schedulePersist() {
  if (typeof window === "undefined") return;
  if (persistHandle) clearTimeout(persistHandle);
  persistHandle = setTimeout(() => {
    try {
      // Don't persist transient state — `hydrated`, `idleAction`,
      // `attention`, `moodSince` and `lastInteraction` are recomputed
      // on load. Persist only what's meaningful across sessions.
      const toPersist = {
        memory: state.memory,
        personality: state.personality,
        // Energy on close so morning Hugo isn't always at 80.
        energy: state.energy,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // localStorage disabled, quota exceeded, etc — fail silent
    }
    persistHandle = null;
  }, 600);
}

/** One-shot load from localStorage. Called from the first BrandDot
 *  mount via `useEffect` so SSR/CSR markup matches. */
export function hydrateFromStorage() {
  if (state.hydrated) return;
  if (typeof window === "undefined") return;
  const now = Date.now();
  let next = defaultState(now);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<{
        memory: Partial<HugoMemory>;
        personality: Partial<{ colorBias: number }>;
        energy: number;
      }>;
      const base = defaultMemory(now);
      const memory: HugoMemory = { ...base, ...(parsed.memory ?? {}) };
      // Streak math: same day = keep streak; yesterday = +1; older = reset.
      const today = dateKeyOf(new Date(now));
      const last = memory.lastDateKey;
      let streak = memory.streakDays;
      let isFirstVisitToday = false;
      if (today !== last) {
        const lastD = new Date(`${last}T00:00:00`);
        const todayD = new Date(`${today}T00:00:00`);
        const dayGap = Math.round(
          (todayD.getTime() - lastD.getTime()) / 86_400_000,
        );
        streak = dayGap === 1 ? streak + 1 : 1;
        memory.lastDateKey = today;
        isFirstVisitToday = true;
      }
      memory.streakDays = streak;
      memory.visitCount = (memory.visitCount ?? 0) + 1;
      memory.lastSeen = now;

      const energy =
        typeof parsed.energy === "number" && Number.isFinite(parsed.energy)
          ? Math.max(0, Math.min(100, parsed.energy))
          : 80;
      const mood = moodFromHour(new Date(now).getHours());

      next = {
        ...next,
        energy,
        mood,
        moodSince: now,
        bpm: computeBpm(mood, energy),
        memory,
        personality: {
          ...next.personality,
          ...(parsed.personality ?? {}),
        },
        isFirstVisitToday,
      };
    } else {
      // First-ever visit — record it.
      next.memory.visitCount = 1;
      next.isFirstVisitToday = true;
    }
  } catch {
    // ignore
  }
  next.hydrated = true;
  state = next;
  emit();
  schedulePersist();
}

function startTickLoop() {
  if (tickHandle !== null) return;
  if (typeof window === "undefined") return;
  lastTick = performance.now();
  tickHandle = setInterval(tick, TICK_INTERVAL_MS);
}

function stopTickLoop() {
  if (tickHandle === null) return;
  clearInterval(tickHandle);
  tickHandle = null;
}

function tick() {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  const wallNow = Date.now();

  let energy = state.energy;
  const sinceInteraction = wallNow - state.lastInteraction;

  if (
    typeof document !== "undefined" &&
    document.hidden &&
    sinceInteraction > 3000
  ) {
    // Tab hidden long enough for the sleep state — restore quickly.
    energy = Math.min(100, energy + 4 * dt);
  } else if (sinceInteraction > 30_000) {
    energy = Math.min(100, energy + 0.6 * dt);
  } else {
    energy = Math.max(0, energy - 0.35 * dt);
  }

  let mood = state.mood;
  let moodSince = state.moodSince;
  const moodAge = wallNow - moodSince;

  // Mood timeouts. Excited → calm after 30s. Grumpy → calm after 10s.
  // Curious → calm after 15s. Calm → sleepy after 5 min of no input.
  if (mood === "excited" && moodAge > 30_000) {
    mood = "calm";
    moodSince = wallNow;
  } else if (mood === "grumpy" && moodAge > 10_000) {
    mood = "calm";
    moodSince = wallNow;
  } else if (mood === "curious" && moodAge > 15_000) {
    mood = "calm";
    moodSince = wallNow;
  } else if (mood === "calm" && sinceInteraction > 300_000) {
    mood = "sleepy";
    moodSince = wallNow;
  } else if (mood === "sleepy" && sinceInteraction < 5000) {
    // Recent input → wake from sleepy.
    mood = "calm";
    moodSince = wallNow;
  }

  // Attention decay.
  let attention = state.attention;
  if (attention && wallNow - attention.since > 1200) {
    attention = null;
  }

  const bpm = computeBpm(mood, energy);

  // Only emit if something meaningful changed.
  if (
    energy !== state.energy ||
    mood !== state.mood ||
    moodSince !== state.moodSince ||
    attention !== state.attention ||
    bpm !== state.bpm
  ) {
    set({ energy, mood, moodSince, bpm, attention });
  }
}

// ---------------------------------------------------------------------------
// Public event API
// ---------------------------------------------------------------------------

export function hugoInteraction(now = Date.now()) {
  set({ lastInteraction: now });
}

export function hugoMoodEvent(
  event:
    | "navigated"
    | "hover-tool"
    | "happy"
    | "tantrum"
    | "flip"
    | "wake"
    | "calm-down",
) {
  const now = Date.now();
  let mood = state.mood;
  let moodSince = state.moodSince;
  let memory = state.memory;

  switch (event) {
    case "navigated":
      if (mood !== "grumpy") {
        mood = "excited";
        moodSince = now;
      }
      break;
    case "hover-tool":
      if (mood !== "excited" && mood !== "grumpy") {
        mood = "curious";
        moodSince = now;
      }
      break;
    case "happy":
      mood = "excited";
      moodSince = now;
      break;
    case "tantrum":
      mood = "grumpy";
      moodSince = now;
      memory = { ...memory, tantrums: memory.tantrums + 1 };
      break;
    case "flip":
      mood = "excited";
      moodSince = now;
      memory = { ...memory, flips: memory.flips + 1 };
      break;
    case "wake":
      if (mood === "sleepy") {
        mood = "calm";
        moodSince = now;
      }
      break;
    case "calm-down":
      mood = "calm";
      moodSince = now;
      break;
  }

  set({ mood, moodSince, memory, lastInteraction: now });
}

export function hugoSawTool(slug: string) {
  const memory = state.memory;
  const counts = {
    ...memory.toolCounts,
    [slug]: (memory.toolCounts[slug] ?? 0) + 1,
  };
  // Recompute favourite — O(n) over distinct tools, tiny in practice.
  let fav: string | null = memory.favoriteToolSlug;
  let favCount = fav ? (counts[fav] ?? 0) : 0;
  for (const [s, c] of Object.entries(counts)) {
    if (c > favCount) {
      fav = s;
      favCount = c;
    }
  }
  set({
    memory: { ...memory, toolCounts: counts, favoriteToolSlug: fav },
    lastInteraction: Date.now(),
  });
}

export function hugoAttention(target: HugoAttention | null) {
  set({ attention: target });
}

export function hugoIdleAction(action: HugoState["idleAction"]) {
  set({ idleAction: action });
}

export function hugoNap() {
  set({
    memory: { ...state.memory, naps: state.memory.naps + 1 },
  });
}

export function clearFirstVisitFlag() {
  if (state.isFirstVisitToday) set({ isFirstVisitToday: false });
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page-attention via MutationObserver
// ---------------------------------------------------------------------------

let mutationObserver: MutationObserver | null = null;
let mutationQueue: MutationRecord[] = [];
let mutationTimer: ReturnType<typeof setTimeout> | null = null;

function startMutationObserver() {
  if (mutationObserver) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  mutationObserver = new MutationObserver((muts) => {
    mutationQueue.push(...muts);
    if (mutationTimer === null) {
      // Throttle to ~5 Hz so a chatty React tree doesn't pin the CPU.
      mutationTimer = setTimeout(drainMutations, 200);
    }
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (mutationTimer !== null) {
    clearTimeout(mutationTimer);
    mutationTimer = null;
  }
  mutationQueue = [];
}

function drainMutations() {
  mutationTimer = null;
  const muts = mutationQueue;
  mutationQueue = [];
  // Find the largest meaningful newly-added element on screen.
  // Skip Hugo's own DOM, skip tiny non-visual nodes, skip off-screen.
  let best: { el: Element; area: number } | null = null;
  for (const m of muts) {
    if (m.type !== "childList") continue;
    for (let i = 0; i < m.addedNodes.length; i++) {
      const node = m.addedNodes[i];
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      // Skip Hugo's own DOM (the heartbeat ring, eyes, sleep z, etc.).
      if (el.closest?.("[data-name='hugo'],[data-brand-dot]")) continue;
      // Skip the TravelingDot canvas — it mutates every frame.
      if (el.tagName === "CANVAS") continue;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width < 20 || rect.height < 20) continue;
      if (
        rect.right < 0 ||
        rect.bottom < 0 ||
        rect.left > window.innerWidth ||
        rect.top > window.innerHeight
      ) {
        continue;
      }
      const area = rect.width * rect.height;
      if (!best || area > best.area) best = { el, area };
    }
  }
  if (!best) return;
  const rect = best.el.getBoundingClientRect();
  hugoAttention({
    kind: "mutation",
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    since: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Stochastic idle micro-behaviours
// ---------------------------------------------------------------------------

let idleActionTimer: ReturnType<typeof setTimeout> | null = null;

function startIdleScheduler() {
  if (idleActionTimer !== null) return;
  if (typeof window === "undefined") return;
  scheduleNextIdleAction();
}

function stopIdleScheduler() {
  if (idleActionTimer === null) return;
  clearTimeout(idleActionTimer);
  idleActionTimer = null;
}

function scheduleNextIdleAction() {
  // Every 25–45 s an idle action fires (look-around / head-tilt /
  // deep-blink / deep-breath), unless Hugo is excited or the user
  // just interacted. The next slot is scheduled regardless so the
  // cadence stays steady.
  const delay = 25_000 + Math.random() * 20_000;
  idleActionTimer = setTimeout(() => {
    fireIdleAction();
    scheduleNextIdleAction();
  }, delay);
}

function fireIdleAction() {
  if (state.mood === "excited") return;
  if (Date.now() - state.lastInteraction < 8000) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const actions = [
    "look-around",
    "head-tilt",
    "deep-blink",
    "deep-breath",
  ] as const;
  const action = actions[Math.floor(Math.random() * actions.length)];
  set({ idleAction: action });
  // Auto-clear after the longest-running visual (look-around at 700 ms).
  setTimeout(() => {
    if (state.idleAction === action) set({ idleAction: null });
  }, 900);
}

// ---------------------------------------------------------------------------
// Tool-hover bridge (drives `curious` mood)
// ---------------------------------------------------------------------------

let toolHoverListenerAttached = false;
let lastHoverMoodAt = 0;

function attachToolHoverListener() {
  if (toolHoverListenerAttached) return;
  if (typeof window === "undefined") return;
  toolHoverListenerAttached = true;
  window.addEventListener("hugoslekstuga:tool-hover", (e: Event) => {
    const detail = (e as CustomEvent<{ x: number; y: number } | null>).detail;
    if (!detail) return;
    const now = Date.now();
    if (now - lastHoverMoodAt < 3000) return;
    lastHoverMoodAt = now;
    hugoMoodEvent("hover-tool");
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startTickLoop();
  startMutationObserver();
  startIdleScheduler();
  attachToolHoverListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTickLoop();
      stopMutationObserver();
      stopIdleScheduler();
    }
  };
}

function getSnapshot(): HugoState {
  return state;
}

function getServerSnapshot(): HugoState {
  // Stable default so SSR markup matches the first client render.
  return state;
}

/**
 * Hook into Hugo's state with a selector. Returns the selected slice
 * and re-renders only when that slice changes (referential equality).
 * Pick primitives for cheap subscriptions; pick objects with `useMemo`
 * upstream if you must.
 */
export function useHugoState<T>(selector: (s: HugoState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getSnapshot()),
    () => selector(getServerSnapshot()),
  );
}

/** Synchronously read state outside React. */
export function getHugoState(): HugoState {
  return state;
}
