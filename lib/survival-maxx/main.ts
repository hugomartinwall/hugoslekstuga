import { SurvivalRun, type GameEvent, type Input } from "./model";
import {
  HEROES,
  HERO_ORDER,
  WEAPONS,
  ITEMS,
  HINTS,
  MAP_COUNT,
  MAP_ORDER,
  CAMPAIGN_WAVES,
  BAG_CAPACITY,
  rankStatLines,
  mapById,
  mapStatLines,
  type HeroId,
  type WeaponId,
  type ItemId,
  type EquipmentCategory,
  type MapId,
} from "./content";
import {
  getUnlockedHeroes,
  getClearedHeroes,
  getUnlockedMaps,
  getClearedMaps,
  canPlay,
  recordProgress,
  recordClear,
} from "./progression";
import { SurvivalScene } from "./scene";
import { SurvivalUI, type SurvivalViewModel, type SurvivalScreen } from "./ui";
import { Platform } from "./platform";
import { AudioEngine } from "./audio";
import { PointerNavigation } from "./controls";

/**
 * Survival Maxx — an arena survivor, ported from a CrazyGames build.
 *
 * The original `main.ts` was a page-level script: it looked up ids in
 * `index.html`, bound listeners on `window` for the life of the tab and ran a
 * `requestAnimationFrame` loop it never cancelled. A Next route mounts and
 * unmounts (twice under StrictMode), so all of that now lives inside
 * `createSurvivalMaxx`, and `destroy()` undoes every piece of it.
 *
 * The game's own stylesheet (`style.css`, every selector `.rz-` prefixed) is
 * imported by the route's client component. The shell rules below replace the
 * old global `bootstrap.css` and only reach elements under `root`.
 */
export interface SurvivalMaxxOptions {
  /** Leave the game: the BACK TO PLAYHOUSE actions, or Escape on the home screen. */
  onExit: () => void;
}

export interface SurvivalMaxxHandle {
  /** Stop the loop, persist progress, drop the GL contexts, close audio, unbind every listener. */
  destroy(): void;
}

const SHELL_STYLE = /* css */ `
.sm-root {
  /* The route positions and sizes the root; the shell only paints it. */
  overflow: hidden;
  font-family: Arial, Helvetica, sans-serif;
  color: #f4eee2;
  background: #151c23;
  font-synthesis: none;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.sm-root,
.sm-root *,
.sm-root *::before,
.sm-root *::after {
  box-sizing: border-box;
}
.sm-app,
.sm-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.sm-app {
  inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
}
.sm-viewport canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.sm-loading {
  position: absolute;
  inset: 0;
  background: #151c23;
  display: grid;
  place-content: center;
  gap: 24px;
  text-align: center;
  color: #eee6d5;
  z-index: 5;
  font: 600 13px Arial, Helvetica, sans-serif;
  letter-spacing: 4px;
}
.sm-loading strong {
  font-size: 44px;
  font-weight: 900;
  letter-spacing: -2px;
}
.sm-loading i {
  height: 2px;
  width: 80px;
  margin: auto;
  background: #f39863;
  animation: sm-wake 1.4s ease-in-out infinite;
}
.sm-loading button {
  margin: auto;
  padding: 10px 18px;
  border: 1px solid #ead9bc;
  background: transparent;
  color: #eee6d5;
  font: 600 13px Arial, Helvetica, sans-serif;
  letter-spacing: 2px;
  cursor: pointer;
}
.sm-joystick {
  position: absolute;
  width: 104px;
  height: 104px;
  margin: -52px;
  border: 1px solid #ead9bc60;
  border-radius: 50%;
  background: #151c2360;
  pointer-events: none;
  z-index: 5;
}
.sm-joystick[hidden] {
  display: none;
}
.sm-joystick i {
  position: absolute;
  left: 35px;
  top: 35px;
  width: 32px;
  height: 32px;
  background: #eedcb999;
  border: 1px solid #fff5da;
  border-radius: 50%;
}
@keyframes sm-wake {
  50% {
    transform: scaleX(0.35);
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sm-loading i {
    animation: none;
  }
}
`;

type Listen = {
  <K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (event: WindowEventMap[K]) => void,
  ): void;
  <K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    fn: (event: DocumentEventMap[K]) => void,
  ): void;
  <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (event: HTMLElementEventMap[K]) => void,
  ): void;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export async function createSurvivalMaxx(
  root: HTMLElement,
  opts: SurvivalMaxxOptions,
): Promise<SurvivalMaxxHandle> {
  // ---- DOM the game expects, built under the route's container ----
  root.classList.add("sm-root");
  const style = document.createElement("style");
  style.textContent = SHELL_STYLE;
  const app = element("div", "sm-app");
  const viewport = element("div", "sm-viewport");
  viewport.setAttribute("aria-label", "Survival Maxx arena");
  const loading = element("div", "sm-loading");
  loading.innerHTML =
    "<strong>SURVIVAL MAXX</strong><i></i><span>LOADING</span>";
  const joystick = element("div", "sm-joystick");
  joystick.hidden = true;
  joystick.append(document.createElement("i"));
  app.append(viewport, loading);
  root.append(style, app, joystick);

  // ---- teardown bookkeeping ----
  const disposers: (() => void)[] = [];
  let destroyed = false;
  let rafId = 0;
  const listen = ((
    target: EventTarget,
    type: string,
    fn: (event: never) => void,
  ) => {
    const handler = fn as EventListener;
    target.addEventListener(type, handler);
    disposers.push(() => target.removeEventListener(type, handler));
  }) as Listen;

  // ---- state that used to be module-level ----
  const platform = new Platform();
  const audio = new AudioEngine();
  let graphics: SurvivalScene | null = null;
  let ui: SurvivalUI | null = null;
  let run: SurvivalRun | null = null;
  let hero: HeroId = "ember";
  let map: MapId = 1;
  let screen: SurvivalScreen = "home";
  let settingsBack: SurvivalScreen = "home";
  let armoryBack: SurvivalScreen = "characters";
  let pausedFrom: SurvivalScreen = "playing";
  const keys = new Set<string>();
  let dashRequested = false;
  const mouseNavigation = new PointerNavigation();
  const projectPointer = (x: number, y: number) =>
    graphics ? graphics.worldPoint(x, y) : null;
  let stick: {
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null = null;
  let previousTime = 0,
    lastHUD = 0,
    shopAt = 0,
    resultAt = 0;
  let notification = "",
    noticeUntil = 0;
  let phase = "ready";
  let recordSaved = false;
  let endlessRun = false;
  let newUnlock: { hero?: HeroId; map?: MapId } | undefined;
  let hordeSeen = false;
  let backgrounded = false;
  platform.onMute = (value) => {
    audio.platformMuted = value;
    audio.sync();
  };
  const cssHex = (value: number) =>
    `#${Math.max(0, Math.min(0xffffff, Math.floor(value)))
      .toString(16)
      .padStart(6, "0")}`;
  function mapView(id: MapId) {
    const definition = mapById(id);
    return {
      id: definition.id,
      index: MAP_ORDER.indexOf(definition.id) + 1,
      name: definition.name,
      tagline: definition.tagline,
      accent: cssHex(definition.palette.accent),
      rule: {
        title: definition.rule.title,
        description: definition.rule.description,
      },
      lines: mapStatLines(definition),
    };
  }
  const seenHint = (id: string) => platform.save.hints.includes(id);
  /**
   * Shows a one-time hint from HINTS. Silent hints are only marked seen (the
   * in-arena movement hint renders itself). A hint that would talk over an
   * active notice waits for the next trigger instead of being lost.
   */
  function hintOnce(id: string, silent = false): boolean {
    if (seenHint(id)) return false;
    const hint = HINTS.find((entry) => entry.id === id);
    if (!hint) return false;
    if (!silent && notification && performance.now() < noticeUntil)
      return false;
    platform.save.hints.push(id);
    platform.persist();
    if (!silent) notify(hint.text, hint.duration ?? 5000);
    return true;
  }
  function shopHints() {
    if (!run || run.phase !== "shop") return;
    const offers = run.offers;
    if (offers.some((offer) => offer.rarity === "insane")) hintOnce("insane");
    if (
      offers.some(
        (offer) =>
          offer.kind === "item" &&
          ITEMS[offer.contentId as ItemId]?.category === "mod",
      )
    )
      hintOnce("mods");
    if (run.synergies.some((set) => set.tier >= 1)) hintOnce("sets");
    if (run.canBuySlot()) hintOnce("slot");
  }

  function model(): SurvivalViewModel {
    const stats = run?.stats;
    const activeMap = run?.mapId ?? map;
    const clearedMaps: Partial<Record<HeroId, MapId[]>> = {};
    const clearedBy: Partial<Record<MapId, HeroId[]>> = {};
    for (const id of HERO_ORDER) {
      const maps = getClearedMaps(platform.save, id);
      clearedMaps[id] = maps;
      for (const cleared of maps) (clearedBy[cleared] ??= []).push(id);
    }
    const equipment = (
      entry: { id: number; kind: string; level: number; slot?: number },
      category: EquipmentCategory,
      equipped = false,
    ) => ({
      ...entry,
      category,
      equipped,
      title:
        category === "weapon"
          ? WEAPONS[entry.kind as WeaponId].name
          : ITEMS[entry.kind as ItemId].name,
      description: rankStatLines(
        entry.kind as WeaponId | ItemId,
        entry.level,
      ).join(" · "),
      mergeable: run?.canMergeEquipment(entry.id) ?? false,
      sellValue: run?.canSellEquipment(entry.id)
        ? run.equipmentSellValue(entry.id)
        : undefined,
      stowable: run?.canUnequipWeapon(entry.id) ?? false,
    });
    return {
      screen,
      art: graphics?.art,
      canExit: true,
      heroId: hero,
      wave: run?.wave ?? 0,
      totalWaves: CAMPAIGN_WAVES,
      unlockedHeroes: getUnlockedHeroes(platform.save),
      clearedHeroes: getClearedHeroes(platform.save),
      heroRecords: platform.save.heroRecords,
      selectedMap: map,
      unlockedMaps: getUnlockedMaps(platform.save, hero),
      clearedMaps,
      clearedBy,
      mapRecords: platform.save.mapRecords,
      map: mapView(activeMap),
      totalMaps: MAP_COUNT,
      newUnlock,
      endless: run?.endless ?? false,
      synergies: run?.synergies ?? [],
      weaveCharge: run?.weaveCharge ?? 0,
      weaveTime: run?.weaveTime ?? 0,
      bossName: run?.bossName,
      waveThreat:
        run?.phase === "combat" && run.time < 5 ? run.waveThreat : null,
      currency: run?.salvage ?? 0,
      hp: run?.player.hp ?? HEROES[hero].maxHp,
      maxHp: run?.player.maxHp ?? HEROES[hero].maxHp,
      kills: run?.kills ?? 0,
      runTime: run?.totalTime ?? 0,
      fullClears: run?.fullClears ?? 0,
      fastestClear: run?.fastestClear ?? Infinity,
      earned: Math.floor(run?.earnedSalvage ?? 0),
      time: run?.timeRemaining ?? 0,
      dash: run ? 1 - run.player.dashCooldown / run.stats.dashCooldown : 1,
      bestWave: platform.save.bestWave,
      offers:
        run?.offers.map((offer, i) => ({
          ...offer,
          canBuy: run!.canBuy(i),
        })) ?? [],
      inventory: run?.weapons.map((w) => equipment(w, "weapon", true)) ?? [],
      bag: run?.bag.map((entry) => equipment(entry, entry.category)) ?? [],
      weaponSlots: HEROES[hero].weaponSlots,
      bagCapacity:
        run?.bagCapacity ?? BAG_CAPACITY + (hero === "flux" ? 2 : 0),
      stats: stats
        ? [
            {
              label: "Damage",
              description: "Bonus damage from your character and gear.",
              value: `+${Math.round((stats.damage - 1) * 100)}%`,
              icon: "power",
            },
            {
              label: "Attack rate",
              description: "How much faster your weapons attack.",
              value: `+${Math.round((stats.attackSpeed - 1) * 100)}%`,
              icon: "haste",
            },
            {
              label: "Armor",
              description: "Reduces damage from enemy hits.",
              value: Math.round(stats.armor * 10) / 10,
              icon: "shield",
            },
            {
              label: "Move speed",
              description: "Movement bonus from your gear.",
              value: `+${Math.round((stats.speed / HEROES[hero].speed - 1) * 100)}%`,
              icon: "speed",
            },
            {
              label: "Crit chance",
              description: "Chance for a hit to deal 60% extra damage.",
              value: `${Math.round(stats.critChance * 100)}%`,
              icon: "focus",
            },
            {
              label: "Dash wait",
              description: "Time until you can dash again. Lower is better.",
              value: `${stats.dashCooldown.toFixed(1)}s`,
              icon: "dash",
            },
            {
              label: "Healing",
              description:
                "Health restored per second, applied every 3 seconds.",
              value: `${stats.healing.toFixed(1)}/s`,
              icon: "mending",
            },
            {
              label: "Pickup range",
              description: "How far away you collect emeralds.",
              value: `×${(stats.magnet / 3.8).toFixed(1)}`,
              icon: "magnet",
            },
          ]
        : [],
      muted: audio.muted,
      music: audio.musicEnabled,
      reducedMotion: platform.save.reducedMotion,
      won: run?.phase === "won",
      locked: run?.offers.some((o) => o.locked) ?? false,
      rerollCost: run?.rerollCost ?? 0,
      notice: notification || platform.warning,
      enemiesRemaining: run?.remainingEnemies ?? 0,
      waveBudget: run?.waveBudget ?? 0,
      hordeWarning: run?.hordeWarning ?? 0,
      canBuySlot: run?.canBuySlot() ?? false,
      extraSlots: run?.extraSlots ?? 0,
      waveIntro:
        run?.phase === "combat" && run.wave === 1 && run.time < 0.9
          ? run.map.name.toUpperCase()
          : run?.phase === "combat" && run.time < (run.wave === 1 ? 2.1 : 1.5)
            ? `WAVE ${String(run?.wave ?? 1).padStart(2, "0")}`
            : run?.phase === "combat" && run.isBossWave && run.time < 4.2
              ? run.bossName
              : shopAt
                ? "WAVE CLEARED"
                : "",
      bossHp: run?.boss?.hp,
      bossMaxHp: run?.boss?.maxHp,
      hint:
        !seenHint("move") &&
        run?.phase === "combat" &&
        run.wave === 1 &&
        run.time > 1.2 &&
        run.time < 9,
    };
  }

  function show(next: SurvivalScreen) {
    if (!ui || !graphics) return;
    screen = next;
    keys.clear();
    dashRequested = false;
    mouseNavigation.clear();
    stick = null;
    joystick.hidden = true;
    ui.render(model());
    graphics.setScreen(
      next === "armory"
        ? armoryBack
        : next === "settings" && settingsBack === "pause"
          ? "pause"
          : next,
      hero,
    );
    graphics.reducedMotion = platform.save.reducedMotion;
    audio.paused = backgrounded || next === "pause" || next === "settings";
    audio.setCombat(next === "playing" && run?.phase === "combat");
    audio.sync();
    platform.gameplay(next === "playing" && run?.phase === "combat");
  }

  function notify(message: string, duration = 1700) {
    notification = message;
    noticeUntil = performance.now() + duration;
    // The HUD keeps its live nodes; every other screen re-renders in full.
    if (screen === "playing") ui?.setNotice(message);
    else ui?.render(model());
  }

  function saveResult() {
    if (recordSaved || !run) return;
    recordSaved = true;
    recordProgress(platform.save, run.hero, run.mapId, run.wave);
    if (run.phase === "won" && !run.endless) {
      const unlocked = recordClear(platform.save, run.hero, run.mapId);
      newUnlock =
        unlocked.hero || unlocked.map
          ? {
              ...(unlocked.hero ? { hero: unlocked.hero } : {}),
              ...(unlocked.map ? { map: unlocked.map } : {}),
            }
          : undefined;
    }
    platform.persist();
    if (run.phase === "won") platform.celebrate();
  }

  function startRun(endless = endlessRun) {
    if (!graphics) return;
    if (!canPlay(platform.save, hero, map, endless)) return;
    endlessRun = endless;
    newUnlock = undefined;
    hordeSeen = false;
    run = new SurvivalRun(hero, Math.floor(Math.random() * 0xffffffff), map);
    // Endless from the roster has no finish line from wave one.
    run.endless = endless;
    recordSaved = false;
    phase = "ready";
    shopAt = resultAt = 0;
    graphics.setMap(run.map);
    graphics.reset();
    platform.save.totalRuns++;
    platform.persist();
    startWave();
  }

  function startWave() {
    if (!run || !run.startWave()) return;
    phase = "combat";
    shopAt = resultAt = 0;
    notification = "";
    show("playing");
    platform.context(run.wave, run.mapId);
    recordProgress(platform.save, run.hero, run.mapId, run.wave);
    platform.persist();
  }

  function leave() {
    if (run) saveResult();
    platform.persist();
    opts.onExit();
  }

  function action(name: string, value?: string) {
    if (!ui || !graphics) return;
    audio.unlock();
    if (!["dash", "toggleMute"].includes(name)) audio.play("select");
    switch (name) {
      case "play":
        if (platform.save.totalRuns === 0 && platform.save.bestWave === 0)
          startRun();
        else show("characters");
        break;
      case "selectHero":
        if (value && value in HEROES) {
          hero = value as HeroId;
          // Keep the map choice when the new hero can play it; otherwise fall
          // back to that hero's furthest map.
          const maps = getUnlockedMaps(platform.save, hero);
          if (!maps.includes(map)) map = maps.at(-1) ?? 1;
          show("characters");
        }
        break;
      case "selectMap": {
        const chosen = Number(value) as MapId;
        if (getUnlockedMaps(platform.save, hero).includes(chosen)) {
          map = chosen;
          show("characters");
        }
        break;
      }
      case "deploy":
        startRun(false);
        break;
      case "nextMap":
        if (newUnlock?.map && canPlay(platform.save, hero, newUnlock.map)) {
          map = newUnlock.map;
          startRun(false);
        }
        break;
      case "settings":
        settingsBack = screen;
        show("settings");
        break;
      case "armory":
        if (screen !== "armory") armoryBack = screen;
        show("armory");
        break;
      case "back":
        show(
          screen === "armory"
            ? armoryBack
            : screen === "settings"
              ? settingsBack
              : "home",
        );
        break;
      case "pause":
        if (screen === "playing" || screen === "shop") {
          pausedFrom = screen;
          show("pause");
        }
        break;
      case "resume":
        show(pausedFrom);
        break;
      case "toggleMute":
        audio.muted = !audio.muted;
        platform.save.muted = audio.muted;
        platform.persist();
        audio.sync();
        ui.render(model());
        break;
      case "toggleMusic":
        audio.musicEnabled = !audio.musicEnabled;
        platform.save.music = audio.musicEnabled;
        platform.persist();
        audio.sync();
        ui.render(model());
        break;
      case "toggleMotion":
        platform.save.reducedMotion = !platform.save.reducedMotion;
        graphics.reducedMotion = platform.save.reducedMotion;
        platform.persist();
        ui.render(model());
        break;
      case "endless":
        if (run?.continueEndless()) {
          newUnlock = undefined;
          recordSaved = false;
          shopAt = resultAt = 0;
          phase = run.phase;
          show("shop");
        }
        break;
      case "nextWave":
        startWave();
        break;
      case "buySlot":
        if (run?.buySlot()) {
          audio.play("buy");
          platform.persist();
          ui.render(model());
        }
        break;
      case "retry":
        startRun();
        break;
      case "deployEndless":
        startRun(true);
        break;
      case "home":
        if (run) saveResult();
        run = null;
        platform.clearContext();
        graphics.reset();
        shopAt = resultAt = 0;
        show("home");
        break;
      case "exit":
        leave();
        break;
      case "dash":
        if (screen === "playing") dashRequested = true;
        break;
      case "buy":
        if (run) {
          const index = Number(value);
          const offer = run.offers[index];
          if (run.buy(index)) {
            audio.play("buy");
            notify(
              offer.kind === "heal" ? "Health restored" : `Bought ${offer.title}`,
            );
            shopHints();
          } else notify("Can't buy this.");
        }
        break;
      case "reroll":
        if (run?.reroll()) {
          audio.play("reroll");
          notification = "";
          ui.render(model());
          shopHints();
        }
        break;
      case "lock":
        run?.lockShop(value === undefined ? undefined : Number(value));
        ui.render(model());
        break;
      case "merge":
        if (run?.mergeEquipment(Number(value))) {
          audio.play("merge");
          notify("Merged");
        } else notify("Match the same gear and rank.");
        break;
      case "stow":
        if (run?.unequipWeapon(Number(value))) ui.render(model());
        else
          notify(
            run && run.bag.length >= BAG_CAPACITY
              ? "Bag full"
              : "Keep one weapon equipped",
          );
        break;
      case "equip": {
        const [id, slot] = (value ?? "").split(":").map(Number);
        if (run?.equipWeapon(id, slot)) ui.render(model());
        else notify("This weapon can't go in that slot.");
        break;
      }
      case "sell":
        if (run?.sellEquipment(Number(value))) {
          audio.play("buy");
          ui.render(model());
          shopHints();
        } else notify("Keep one weapon equipped");
        break;
    }
  }

  function input(): Input {
    let x =
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    let y =
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) -
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
    if (x || y) mouseNavigation.target = null;
    else if (stick) {
      x = stick.x;
      y = stick.y;
    } else if (run) {
      const direction = mouseNavigation.input(run.player, projectPointer);
      x = direction.x;
      y = direction.y;
    }
    const dash = dashRequested;
    dashRequested = false;
    return { x, y, dash };
  }

  // ---- input: keyboard on the window (the route is full-bleed), pointer on the arena ----
  listen(window, "keydown", (event) => {
    if (!ui) return;
    if (
      event.code === "KeyP" &&
      (screen === "playing" || screen === "shop" || screen === "pause")
    ) {
      event.preventDefault();
      if (!event.repeat) action(screen === "pause" ? "resume" : "pause");
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      if (event.repeat) return;
      if (screen === "playing" || screen === "shop") action("pause");
      else if (screen === "pause") action("resume");
      else if (screen === "settings" || screen === "armory") action("back");
      else if (screen === "characters") show("home");
      else if (screen === "home") leave();
      return;
    }
    if (screen !== "playing") return;
    if (
      [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
      ].includes(event.code)
    )
      event.preventDefault();
    keys.add(event.code);
    if (event.code === "Space" && !event.repeat) dashRequested = true;
    audio.unlock();
  });
  listen(window, "keyup", (event) => keys.delete(event.code));

  const placeJoystick = (clientX: number, clientY: number) => {
    const rect = root.getBoundingClientRect();
    joystick.style.left = `${clientX - rect.left}px`;
    joystick.style.top = `${clientY - rect.top}px`;
  };
  listen(viewport, "pointerdown", (event) => {
    if (screen !== "playing") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    audio.unlock();
    if (event.pointerType === "touch" && stick) return;
    viewport.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      stick = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: 0,
        y: 0,
      };
      joystick.hidden = false;
      joystick.firstElementChild?.setAttribute(
        "style",
        "transform:translate(0,0)",
      );
      placeJoystick(event.clientX, event.clientY);
    } else {
      mouseNavigation.begin(event.clientX, event.clientY, projectPointer);
    }
  });
  listen(viewport, "pointermove", (event) => {
    if (stick?.id === event.pointerId) {
      const x = (event.clientX - stick.startX) / 60,
        y = (event.clientY - stick.startY) / 60,
        l = Math.max(1, Math.hypot(x, y));
      stick.x = x / l;
      stick.y = y / l;
      joystick.firstElementChild?.setAttribute(
        "style",
        `transform:translate(${stick.x * 28}px,${stick.y * 28}px)`,
      );
    } else mouseNavigation.move(event.clientX, event.clientY);
  });
  const releasePointer = (cancel = false) => {
    mouseNavigation.end(cancel);
    stick = null;
    joystick.hidden = true;
  };
  const pointerEnded = (event: PointerEvent) => {
    if (stick && stick.id !== event.pointerId) return;
    releasePointer(event.type === "pointercancel");
  };
  listen(viewport, "pointerup", pointerEnded);
  listen(viewport, "pointercancel", pointerEnded);
  listen(viewport, "contextmenu", (event) => event.preventDefault());
  listen(viewport, "lostpointercapture", (event) => {
    if (stick && stick.id !== event.pointerId) return;
    if (mouseNavigation.held || stick) releasePointer(true);
  });

  function suspend() {
    backgrounded = true;
    keys.clear();
    dashRequested = false;
    releasePointer();
    if (screen === "playing" || screen === "shop") {
      pausedFrom = screen;
      show("pause");
    }
    audio.paused = true;
    audio.sync();
  }
  function restoreAudio() {
    if (document.hidden) return;
    backgrounded = false;
    audio.paused = screen === "pause" || screen === "settings";
    audio.sync();
  }
  listen(window, "blur", suspend);
  listen(window, "focus", restoreAudio);
  listen(document, "visibilitychange", () => {
    if (document.hidden) suspend();
    else restoreAudio();
  });
  listen(window, "pagehide", () => {
    platform.gameplay(false);
    platform.persist();
  });

  function sounds(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === "fire" && !e.enemy) audio.play(e.weapon ?? "gun", 0.65);
      if (e.type === "hit") audio.play("impact", 0.32);
      if (e.type === "kill") audio.play("death", 0.5);
      if (e.type === "hurt") audio.play("damage");
      if (e.type === "dash") audio.play("dash");
      if (e.type === "pickup") audio.play("pickup", 0.5);
      if (e.type === "explosion") audio.play("rocket", 0.8);
      if (e.type === "waveStart") audio.play("start");
      if (e.type === "waveEnd" || e.type === "won") audio.play("win");
      if (e.type === "lost") audio.play("defeat");
      if (e.type === "weave") audio.play("weave");
      if (e.type === "boss") audio.play("boss-warning");
      if (e.type === "horde" && !hordeSeen) {
        hordeSeen = true;
        if (screen === "playing") hintOnce("horde");
      }
      if (e.type === "telegraph" && e.kind === "boss")
        audio.play("boss-charge", 0.7);
      if (e.type === "fire" && e.enemy && e.kind === "boss")
        audio.play("boss-burst", 0.7);
    }
  }

  function frame(now: number) {
    if (destroyed || !ui || !graphics) return;
    const elapsed = Math.max(0, (now - previousTime) / 1000 || 1 / 60);
    const dt = Math.min(0.05, elapsed);
    previousTime = now;
    if (screen === "playing" && run) {
      run.step(dt, input());
      if (run.phase !== phase) {
        phase = run.phase;
        if (phase === "shop") {
          shopAt = now + 950;
          platform.gameplay(false);
        } else if (phase === "won" || phase === "lost") {
          saveResult();
          resultAt = now + 1000;
          platform.gameplay(false);
        }
      }
      if (shopAt && now >= shopAt) {
        shopAt = 0;
        show("shop");
        // The first shop retires the movement hint and introduces the shop.
        hintOnce("move", true);
        hintOnce("shop");
        shopHints();
      }
      if (resultAt && now >= resultAt) {
        resultAt = 0;
        show("results");
        if (run.phase === "won" && !run.endless) hintOnce("maps");
      }
      if (
        screen === "playing" &&
        run.phase === "combat" &&
        run.wave === 1 &&
        run.time >= 10
      )
        hintOnce("counter");
      // Bars and counters follow the simulation every frame; the full view
      // model below refreshes the rest of the HUD on a slower cadence.
      if (screen === "playing")
        ui.updateHUD({
          hp: run.player.hp,
          maxHp: run.player.maxHp,
          dash: 1 - run.player.dashCooldown / run.stats.dashCooldown,
          time: run.timeRemaining,
          currency: run.salvage,
          bossHp: run.boss?.hp,
          bossMaxHp: run.boss?.maxHp,
          weaveCharge: run.weaveCharge,
          weaveTime: run.weaveTime,
          enemiesRemaining: run.remainingEnemies,
          waveBudget: run.waveBudget,
          hordeWarning: run.hordeWarning,
        });
    }
    if (run) {
      const events = run.drainEvents();
      graphics.handleEvents(events);
      sounds(events);
    }
    // Keep resize/rendering active while the combat pose and effects are frozen.
    const visualDt =
      backgrounded || (!graphics.menu && screen !== "playing") ? 0 : dt;
    graphics.update(visualDt, run);
    if (now - lastHUD > 80) {
      lastHUD = now;
      if (notification && now > noticeUntil) {
        notification = "";
        if (screen !== "playing") ui.clearNotice();
      }
      if (screen === "playing") ui.updateHUD(model());
    }
    if (!destroyed) rafId = requestAnimationFrame(frame);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(rafId);
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    if (run) saveResult();
    platform.gameplay(false);
    platform.persist();
    ui?.destroy();
    ui = null;
    graphics?.dispose();
    graphics = null;
    audio.dispose();
    platform.dispose();
    root.replaceChildren();
    root.classList.remove("sm-root");
  }

  try {
    await platform.init();
    if (destroyed) return { destroy };
    audio.muted = platform.save.muted;
    audio.musicEnabled = platform.save.music;
    graphics = new SurvivalScene(viewport);
    ui = new SurvivalUI(app, action);
    loading.remove();
    show("home");
    rafId = requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    if (!destroyed) {
      loading.innerHTML = "<strong>Unable to start</strong>";
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "BACK TO PLAYHOUSE";
      back.addEventListener("click", () => opts.onExit());
      loading.append(back);
    }
  }
  return { destroy };
}
