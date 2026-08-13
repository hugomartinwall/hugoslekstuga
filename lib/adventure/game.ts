import { COLOR_ORDER, readAccent } from "@/lib/hugo/sprite";
import { COLOR_HEX } from "@/lib/colors";
import type { ToolColor } from "@/lib/tools";
import { createAudio, type AudioFacade } from "./audio/audio";
import { diffTick, type TickEvents } from "./audio/events";
import { DEV_HANDLES } from "./dev";
import { createLoop } from "./loop";
import { loadRaw, persistSave } from "./save";
import {
  applyDeath,
  applyWorldClear,
  buyUpgrade,
  HERO_NAME_MAX,
  migrateSave,
  newSave,
  priceOf,
  sanitizeHeroName,
  shopDiscount,
  shopInventory,
  type AdventureSave,
} from "./app/run";
import { heroStats, upgradeById } from "./content/upgrades";
import { worldDef, FINAL_WORLD, WORLDS } from "./content/worlds";
import {
  COIN_RECEIPT_LINE,
  CREDITS_FOOTER,
  DEATH_LINES,
  ENDING_CARD,
  MERCHANT,
  OPENING_CARD,
  WORLD_SCRIPT,
} from "./content/script";
import { initBoss } from "./sim/boss";
import {
  checkpointOf,
  enterRoom,
  enterWorld,
  type GameState,
} from "./sim/state";
import { tick } from "./sim/tick";
import { attachInput } from "./input/input";
import { Renderer, type GameFonts, type RenderFrame, type SceneId } from "./render/renderer";
import { motionPref, nextMotionPref, reducedMotion, setMotionPref } from "./render/motion";
import type { Card, CreditsView, MapView, SettingsView, ShopView } from "./render/screens";
import { inRect } from "./render/ui-layout";

export type AdventureOptions = {
  onExit: () => void;
  fonts: GameFonts;
};

export type AdventureHandle = {
  destroy(): void;
};

type Overlay = "pause" | "settings" | "help" | null;

/**
 * The app layer: scenes, transitions, saving, wiring. StrictMode runs
 * mount → cleanup → mount, so everything registered here goes through
 * `disposers` and the second boot must find a clean slate.
 */
export function createAdventure(canvas: HTMLCanvasElement, opts: AdventureOptions): AdventureHandle {
  const disposers: Array<() => void> = [];
  const listen = <E extends Event>(
    target: Window | Document | HTMLCanvasElement,
    type: string,
    fn: (e: E) => void,
    options?: AddEventListenerOptions,
  ) => {
    const l = fn as EventListener;
    target.addEventListener(type, l, options);
    disposers.push(() => target.removeEventListener(type, l, options));
  };
  const timers = new Set<number>();
  const after = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  disposers.push(() => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  });

  // ---- persistent + runtime state ------------------------------------
  let save: AdventureSave = migrateSave(loadRaw(), (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  persistSave(save);

  let scene: SceneId = "title";
  let overlay: Overlay = null;
  let menuSel = 0;
  let state: GameState | null = null;
  let prevState: GameState | null = null;
  let card: Card | null = null;
  let shopView: ShopView | null = null;
  let shopFlashUntil = 0;
  let creditsStart = 0;
  let happyFired = false;
  let wipe = 0;
  let wipePhase: "in" | "out" | null = null;
  let pendingAfterWipe: (() => void) | null = null;
  let slowmoUntil = 0;
  let createDraft: { step: "color" | "name"; colorIdx: number; name: string } | null = null;
  let mapSel = 0;
  /** Non-null while practice-replaying a cleared world — nothing banks. */
  let replayFrom: number | null = null;
  const coarsePointer =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

  const renderer = new Renderer(canvas, opts.fonts);
  const audio: AudioFacade = createAudio();

  const worldAccent = (): ToolColor => {
    if (!state) return "pink";
    const def = worldDef(state.world);
    const recipe = def.rooms[state.roomIdx];
    return recipe?.accent ?? def.accent;
  };

  // ---- scene helpers -------------------------------------------------
  const setCard = (c: Card) => {
    card = c;
  };

  const startWorld = (world: number, skipIntro: boolean) => {
    state = enterWorld(save.checkpoint, world, save.seed, save.deathsThisWorld);
    // Flasks refill at world entry.
    const stats = heroStats(state.player.gear);
    state.player.flasks = stats.flaskMax;
    prevState = null;
    persistSave(save);
    audio.setMood(world);
    if (skipIntro) {
      scene = "play";
      card = null;
    } else {
      scene = "worldIntro";
      const def = worldDef(world);
      setCard({
        kicker: `ADVENTURE ${world}`,
        title: def.name,
        lines: [WORLD_SCRIPT[world].intro],
        footer: "press any key",
      });
    }
  };

  const heroAccent = (): string =>
    save.heroColor ? COLOR_HEX[save.heroColor] : readAccent();

  /** Practice-run a cleared world: same checkpoint, nothing banks. */
  const startReplay = (world: number) => {
    replayFrom = world;
    state = enterWorld(save.checkpoint, world, save.seed, 0);
    state.player.flasks = heroStats(state.player.gear).flaskMax;
    prevState = null;
    audio.setMood(world);
    scene = "worldIntro";
    setCard({
      kicker: `ADVENTURE ${world} · again`,
      title: worldDef(world).name,
      lines: [WORLD_SCRIPT[world].intro, "practice run — nothing banked."],
      footer: "press any key",
    });
  };

  const openMap = () => {
    scene = "map";
    mapSel = Math.min(WORLDS.length - 1, Math.max(0, (save.won ? FINAL_WORLD : save.world) - 1));
    replayFrom = null;
  };

  const mapView = (): MapView => {
    const nodes = WORLDS.map((w) => {
      const cleared = w.id <= save.worldsCleared;
      const current = !save.won && w.id === save.world;
      const reached = cleared || current;
      return {
        world: w.id,
        name: reached ? w.name : "?????",
        accent: COLOR_HEX[w.accent],
        state: (current ? "current" : cleared ? "cleared" : "locked") as "locked" | "cleared" | "current",
      };
    });
    const sel = Math.min(mapSel, nodes.length - 1);
    const reached = nodes[sel].state !== "locked";
    return {
      nodes,
      sel,
      heroAccent: heroAccent(),
      heroName: save.heroName,
      introLine: reached ? WORLD_SCRIPT[sel + 1].intro : null,
    };
  };

  const finalizeCreate = () => {
    if (!createDraft) return;
    const fresh = newSave((Date.now() ^ 0x9e3779b9) >>> 0);
    fresh.heroName = sanitizeHeroName(createDraft.name);
    fresh.heroColor = COLOR_ORDER[createDraft.colorIdx] ?? null;
    save = fresh;
    persistSave(save);
    happyFired = false;
    createDraft = null;
    scene = "opening";
    setCard({
      kicker: "hugos lekstuga",
      title: "ADVENTURE",
      lines: [OPENING_CARD[0], `${save.heroName} has a sword now. (it was in lost & found.)`],
      footer: "press any key",
    });
  };

  const beginWipe = (then: () => void) => {
    if (reducedMotion()) {
      then();
      return;
    }
    wipePhase = "in";
    pendingAfterWipe = then;
  };

  const advanceRoom = () => {
    if (!state) return;
    const def = worldDef(state.world);
    const nextIdx = state.roomIdx + 1;
    if (nextIdx >= def.rooms.length) return;
    beginWipe(() => {
      if (!state) return;
      enterRoom(state, nextIdx);
      prevState = null;
      if (def.rooms[nextIdx].kind === "boss") {
        initBoss(state);
        scene = "bossIntro";
        setCard({
          kicker: "the boss",
          title: def.bossName,
          lines: [WORLD_SCRIPT[state.world].bossLine],
          footer: "press any key",
        });
        audio.setMood("boss");
      }
    });
  };

  const openShop = () => {
    if (!state) return;
    scene = "shop";
    menuSel = 0;
    const stats = heroStats(state.player.gear);
    state.player.flasks = stats.flaskMax; // the soda fountain works here
    rebuildShopView();
    audio.sfx("ui");
  };

  const rebuildShopView = () => {
    if (!state) return;
    const inv = shopInventory(state.world, state.player.gear);
    const discount = shopDiscount(save) < 1;
    shopView = {
      items: inv.map((id) => {
        const u = upgradeById(id)!;
        const price = priceOf(id, save, state!.player.gear);
        return {
          id,
          name: u.name,
          desc: u.desc,
          price,
          verb: u.kind === "verb",
          affordable: state!.player.coins >= price,
        };
      }),
      sel: Math.min(menuSel, inv.length),
      coins: state.player.coins,
      line: discount
        ? MERCHANT.pity
        : state.world === 1
          ? `${save.heroName}. good name. i want your coins.`
          : WORLD_SCRIPT[state.world].shopLine,
      discount,
      flash: performance.now() < shopFlashUntil ? shopView?.flash ?? null : null,
    };
  };

  const tryBuy = (id: string) => {
    if (!state) return;
    const bag = { coins: state.player.coins, gear: [...state.player.gear] };
    const res = buyUpgrade(bag, id, save);
    if (res.ok) {
      const oldMax = state.player.maxHp;
      state.player.coins = bag.coins;
      state.player.gear = bag.gear;
      const stats = heroStats(bag.gear);
      state.player.maxHp = stats.maxHp;
      if (stats.maxHp > oldMax) state.player.hp += stats.maxHp - oldMax;
      state.player.flasks = stats.flaskMax;
      state.player.dodgeCharges = stats.rollCharges;
      persistSave(save);
      shopFlashUntil = performance.now() + 1400;
      rebuildShopView();
      if (shopView) shopView.flash = MERCHANT.bought;
      audio.sfx("buy");
    } else if (res.reason === "coins") {
      shopFlashUntil = performance.now() + 1400;
      rebuildShopView();
      if (shopView) shopView.flash = MERCHANT.broke;
      audio.sfx("deny");
    }
  };

  const onWorldClear = () => {
    if (!state) return;
    scene = "clear";
    const w = state.world;
    const secs = Math.round(state.tick / 60);
    setCard({
      kicker: `ADVENTURE ${w}`,
      title: "CLEAR",
      lines: [WORLD_SCRIPT[w].clearLine, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`],
      footer: "press any key",
    });
    audio.sfx("clear");
  };

  const confirmClear = () => {
    if (!state) return;
    if (replayFrom !== null) {
      // Practice run: applaud, bank nothing, back to the map.
      replayFrom = null;
      openMap();
      return;
    }
    const cp = checkpointOf(state);
    applyWorldClear(save, cp, state.tick);
    persistSave(save);
    if (save.won && state.world >= FINAL_WORLD) {
      scene = "ending";
      setCard({
        kicker: "ADVENTURE 10",
        title: "THE ARCADE",
        lines: [...ENDING_CARD],
        footer: "press any key",
      });
      audio.setMood("title");
    } else {
      // The road grows: show the map with the new node lit, then onward.
      openMap();
    }
  };

  const startCredits = () => {
    scene = "credits";
    creditsStart = performance.now();
    if (!happyFired) {
      happyFired = true;
      // The site's one shared celebration — kept rare, and this earns it.
      window.dispatchEvent(new CustomEvent("hugoslekstuga:hugo-happy"));
    }
  };

  const onDeath = () => {
    if (!state) return;
    if (replayFrom !== null) {
      // Practice deaths don't count. Back to the map, no lecture.
      replayFrom = null;
      audio.sfx("death");
      openMap();
      return;
    }
    applyDeath(save);
    persistSave(save);
    scene = "death";
    setCard({
      title: "AGAIN.",
      lines: [DEATH_LINES[save.deaths % DEATH_LINES.length]],
      footer: "press any key",
    });
    audio.sfx("death");
  };

  // ---- menus ---------------------------------------------------------
  const titleItems = () =>
    save.worldsCleared > 0 || save.checkpoint.gear.length > 0
      ? ["continue", "map", "new", "help", "exit"]
      : ["new", "help", "exit"];
  const pauseItems = ["resume", "settings", "help", "restart", "quit"];
  const settingsItems = ["music", "sfx", "motion", "back"];

  const activate = (id: string) => {
    switch (id) {
      case "continue":
        replayFrom = null;
        startWorld(save.world, false);
        break;
      case "map":
        openMap();
        break;
      case "new":
        // The old save survives until the new hero is actually born.
        createDraft = { step: "color", colorIdx: 0, name: "" };
        scene = "create";
        menuSel = 0;
        break;
      case "next":
        if (createDraft) createDraft.step = "name";
        break;
      case "erase":
        if (createDraft) createDraft.name = createDraft.name.slice(0, -1);
        break;
      case "done":
        if (createDraft) finalizeCreate();
        else if (scene === "credits") {
          scene = "title";
          menuSel = 0;
        }
        break;
      case "go": {
        const view = mapView();
        const node = view.nodes[view.sel];
        if (node.state === "current") {
          replayFrom = null;
          startWorld(node.world, false);
        } else if (node.state === "cleared") {
          startReplay(node.world);
        }
        break;
      }
      case "help":
        overlay = "help";
        break;
      case "exit":
      case "quit":
        opts.onExit();
        break;
      case "resume":
        overlay = null;
        break;
      case "settings":
        overlay = "settings";
        menuSel = 0;
        break;
      case "restart":
        overlay = null;
        if (state) startWorld(state.world, true);
        break;
      case "back":
        if (overlay === null && (scene === "map" || scene === "create")) {
          if (scene === "create" && createDraft?.step === "name") {
            createDraft.step = "color";
          } else {
            createDraft = null;
            scene = "title";
          }
          menuSel = 0;
          break;
        }
        overlay = overlay === "settings" ? "pause" : null;
        if (scene === "title") overlay = null;
        menuSel = 0;
        break;
      case "music":
        audio.stepMusic();
        break;
      case "sfx":
        audio.stepSfx();
        break;
      case "motion":
        setMotionPref(nextMotionPref(motionPref()));
        break;
      case "leave":
        scene = "play";
        shopView = null;
        break;
      case "confirm":
        confirmCard();
        break;
      default:
        if (id.startsWith("shop:")) tryBuy(id.slice(5));
        else if (id.startsWith("swatch:") && createDraft) {
          createDraft.colorIdx = Math.max(0, Math.min(COLOR_ORDER.length - 1, Number(id.slice(7))));
        } else if (id.startsWith("char:") && createDraft) {
          if (createDraft.name.length < HERO_NAME_MAX) createDraft.name += id.slice(5);
        } else if (id.startsWith("node:")) {
          const idx = Number(id.slice(5));
          if (mapSel === idx) activate("go");
          else mapSel = idx;
        }
    }
    audio.sfx("ui");
  };

  const confirmCard = () => {
    switch (scene) {
      case "opening":
        startWorld(1, false);
        break;
      case "worldIntro":
        scene = "play";
        card = null;
        break;
      case "bossIntro":
        scene = "play";
        card = null;
        break;
      case "clear":
        confirmClear();
        break;
      case "death":
        if (state) startWorld(state.world, true);
        break;
      case "ending":
        startCredits();
        break;
      default:
        break;
    }
  };

  const menuLen = (): number => {
    if (overlay === "pause") return pauseItems.length;
    if (overlay === "settings") return settingsItems.length;
    if (overlay === "help") return 1;
    if (scene === "title") return titleItems().length;
    if (scene === "shop" && shopView) return shopView.items.length + 1;
    return 1;
  };

  const onMenuKey = (key: "up" | "down" | "left" | "right" | "confirm" | "back") => {
    // Creation and the map steer their own cursors.
    if (scene === "create" && createDraft && overlay === null) {
      if (createDraft.step === "color") {
        if (key === "left" || key === "up") createDraft.colorIdx = (createDraft.colorIdx + COLOR_ORDER.length - 1) % COLOR_ORDER.length;
        else if (key === "right" || key === "down") createDraft.colorIdx = (createDraft.colorIdx + 1) % COLOR_ORDER.length;
        else if (key === "confirm") activate("next");
        else if (key === "back") activate("back");
      } else if (key === "confirm") activate("done");
      else if (key === "back") activate("back");
      return;
    }
    if (scene === "map" && overlay === null) {
      const unlocked = mapView().nodes.map((n, i) => (n.state !== "locked" ? i : -1)).filter((i) => i >= 0);
      const at = unlocked.indexOf(Math.min(mapSel, unlocked.length ? unlocked[unlocked.length - 1] : 0));
      if (key === "left" || key === "up") mapSel = unlocked[Math.max(0, at - 1)] ?? mapSel;
      else if (key === "right" || key === "down") mapSel = unlocked[Math.min(unlocked.length - 1, at + 1)] ?? mapSel;
      else if (key === "confirm") activate("go");
      else if (key === "back") activate("back");
      return;
    }
    const len = menuLen();
    if (key === "up") menuSel = (menuSel - 1 + len) % len;
    else if (key === "down") menuSel = (menuSel + 1) % len;
    else if (key === "confirm") {
      if (overlay === "pause") activate(pauseItems[menuSel]);
      else if (overlay === "settings") activate(settingsItems[menuSel]);
      else if (overlay === "help") activate("back");
      else if (scene === "title") activate(titleItems()[menuSel]);
      else if (scene === "shop" && shopView) {
        if (menuSel < shopView.items.length) activate(`shop:${shopView.items[menuSel].id}`);
        else activate("leave");
      } else if (scene === "credits") activate("done");
      else confirmCard();
    } else if (key === "back") {
      if (overlay === "settings" || overlay === "help") activate("back");
      else if (overlay === "pause") overlay = null;
      else if (scene === "shop") activate("leave");
      else if (scene === "title") opts.onExit();
      else confirmCard();
    }
    if (scene === "shop") rebuildShopView();
  };

  const onTap = (x: number, y: number) => {
    audio.unlock();
    // Touch pause chip.
    const tl = renderer.touchLayout;
    if (scene === "play" && !overlay && tl && inRect(tl.pause, x, y)) {
      overlay = "pause";
      menuSel = 0;
      return;
    }
    for (const hit of renderer.hits) {
      if (inRect(hit.rect, x, y)) {
        if (hit.id.startsWith("shop:") && shopView) {
          const idx = shopView.items.findIndex((it) => `shop:${it.id}` === hit.id);
          if (idx >= 0 && menuSel !== idx) {
            // First tap selects (shows the description), second buys.
            menuSel = idx;
            rebuildShopView();
            return;
          }
        }
        activate(hit.id);
        return;
      }
    }
  };

  const input = attachInput(canvas, {
    onTap,
    onMenuKey,
    onPause: () => {
      overlay = "pause";
      menuSel = 0;
      audio.sfx("ui");
    },
    onMute: () => audio.toggleMute(),
    isPlaying: () => scene === "play" && overlay === null,
    wantsText: () => scene === "create" && createDraft?.step === "name" && overlay === null,
    onChar: (ch) => {
      if (createDraft && createDraft.name.length < HERO_NAME_MAX) createDraft.name += ch;
    },
    onTextControl: (k) => {
      if (!createDraft) return;
      if (k === "backspace") createDraft.name = createDraft.name.slice(0, -1);
      else activate("done");
    },
    touchLayout: () => renderer.touchLayout,
  });
  disposers.push(input.detach);

  // Audio unlock has to live on capture-phase listeners: chrome buttons
  // stop propagation, and iOS re-suspends the context on tab switches.
  listen(window, "pointerdown", () => audio.unlock(), { capture: true });
  listen(window, "keydown", () => audio.unlock(), { capture: true });
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") audio.unlock();
    else if (scene === "play" && !overlay) {
      overlay = "pause";
    }
  });

  // ---- the loop ------------------------------------------------------
  const events: TickEvents = {
    swing: false, playerHurt: false, kills: 0, coins: 0, bossHit: false,
    parry: false, purchase: false, doorOpen: false, bossPhase: false, explosion: false,
  };

  // One sim step, side effects included. Named so the dev handle's step()
  // drives the exact same path as the loop — the automation seam must
  // never diverge from the real game (rAF doesn't fire in hidden tabs).
  const simTick = () => {
    if (scene !== "play" || overlay !== null || !state || wipePhase === "in") return;
    prevState = structuredClone(state);
    const intent = input.intent();

    // Shop doorway: near VÄXEL, the swing hand becomes the browse hand.
    if (state.room.kind === "shop" && state.room.merchant) {
      const d = Math.hypot(state.player.x - state.room.merchant.x, state.player.y - state.room.merchant.y);
      if (d < 30 && intent.interact) {
        openShop();
        return;
      }
    }

    tick(state, intent);
    diffTick(prevState, state, events);
    audio.playEvents(events);
    if (events.playerHurt) renderer.kick(4);
    if (events.explosion) renderer.kick(3);

    if (state.playerDied) {
      onDeath();
      return;
    }
    if (state.pendingDoor) {
      state.pendingDoor = false;
      advanceRoom();
      return;
    }
    if (state.bossDownAt > 0 && state.boss?.dead) {
      if (state.tick === state.bossDownAt + 1) {
        slowmoUntil = performance.now() + 700;
        loop.setTimeScale(0.35);
        renderer.kick(6);
        audio.sfx("bossdown");
      }
      if (state.tick > state.bossDownAt + 110) {
        onWorldClear();
      }
    }
  };

  const loop = createLoop({
    simTick,
    render(alpha) {
      const now = performance.now();
      if (slowmoUntil && now > slowmoUntil) {
        loop.setTimeScale(1);
        slowmoUntil = 0;
      }
      // Advance the door wipe on wall clock.
      if (wipePhase === "in") {
        wipe = Math.min(1, wipe + 0.09);
        if (wipe >= 1 && pendingAfterWipe) {
          pendingAfterWipe();
          pendingAfterWipe = null;
          wipePhase = "out";
        }
      } else if (wipePhase === "out") {
        wipe = Math.max(0, wipe - 0.09);
        if (wipe <= 0) wipePhase = null;
      }

      const frame: RenderFrame = {
        scene,
        overlay,
        prev: prevState,
        curr: state,
        alpha,
        menuSel,
        accent: worldAccent(),
        hugoAccent: heroAccent(),
        heroName: save.heroName,
        card,
        shop: shopView ? { ...shopView, sel: menuSel } : null,
        settings: settingsView(),
        credits: scene === "credits" ? creditsView(now) : null,
        create:
          scene === "create" && createDraft
            ? {
                step: createDraft.step,
                colorIdx: createDraft.colorIdx,
                colorHexes: COLOR_ORDER.map((c) => COLOR_HEX[c]),
                name: createDraft.name,
                touch: coarsePointer || input.touch.seenTouch,
                nameMax: HERO_NAME_MAX,
              }
            : null,
        map: scene === "map" ? mapView() : null,
        hasSave: save.worldsCleared > 0 || save.checkpoint.gear.length > 0 || save.world > 1,
        worldsCleared: save.worldsCleared,
        wipe,
        touch: {
          active: input.touch.seenTouch,
          stick:
            input.touch.stickPointer !== null
              ? { ox: input.touch.stickOrigin.x, oy: input.touch.stickOrigin.y, dx: input.touch.stickVec.x, dy: input.touch.stickVec.y }
              : null,
        },
        now,
      };
      renderer.render(frame);
    },
  });

  const settingsView = (): SettingsView => ({
    music: audio.musicLevel(),
    sfx: audio.sfxLevel(),
    motion: motionPref() === "auto" ? "auto" : motionPref() === "on" ? "on" : "off",
    sel: menuSel,
  });

  const creditsView = (now: number): CreditsView => ({
    receipt: save.purchases.map((id) => {
      const u = upgradeById(id)!;
      return { name: u.name, price: u.price };
    }),
    footer: CREDITS_FOOTER,
    extraLine: save.purchases.includes("coin") ? COIN_RECEIPT_LINE : null,
    deaths: save.deaths,
    soldTo: save.heroName,
    t: now - creditsStart,
  });

  loop.start();

  // ---- dev handle ----------------------------------------------------
  if (DEV_HANDLES) {
    const w = window as unknown as Record<string, unknown>;
    w.__adventure = {
      get state() {
        return state;
      },
      get save() {
        return save;
      },
      get debug() {
        return { scene, overlay, wipePhase, wipe, hasCard: card !== null };
      },
      warpToWorld(n: number) {
        save.world = Math.max(1, Math.min(FINAL_WORLD, n));
        startWorld(save.world, true);
      },
      warpToRoom(n: number) {
        if (!state) return;
        enterRoom(state, n);
        if (worldDef(state.world).rooms[n]?.kind === "boss") initBoss(state);
        prevState = null;
      },
      give(coins: number) {
        if (state) state.player.coins += coins;
      },
      grant(id: string) {
        if (!state || state.player.gear.includes(id)) return;
        const oldMax = state.player.maxHp;
        state.player.gear.push(id);
        const stats = heroStats(state.player.gear);
        state.player.maxHp = stats.maxHp;
        if (stats.maxHp > oldMax) state.player.hp += stats.maxHp - oldMax;
        state.player.flasks = stats.flaskMax;
        state.player.dodgeCharges = stats.rollCharges;
      },
      step(n: number) {
        for (let i = 0; i < n; i++) simTick();
      },
      skip() {
        confirmCard();
      },
    };
    disposers.push(() => {
      delete w.__adventure;
    });
  }

  void after;
  return {
    destroy() {
      loop.stop();
      renderer.destroy();
      audio.dispose();
      for (const dispose of disposers) dispose();
    },
  };
}
