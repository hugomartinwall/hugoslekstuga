import {
  HEROES,
  HERO_ORDER,
  WEAPONS,
  ITEMS,
  FAMILIES,
  CAMPAIGN_WAVES,
  RANKS,
  rankStatLines,
  BAG_CAPACITY,
  BAG_SLOT_COST,
  MAX_EXTRA_SLOTS,
  MAP_COUNT,
  MAP_ORDER,
  OFFENSIVE_DRONES,
  SET_TIERS,
  HINTS,
  mapById,
  mapStatLines,
  type HeroId,
  type WeaponId,
  type ItemId,
  type FamilyId,
  type MapId,
  type EquipmentCategory,
  type DroneAttack,
} from "./content";
import {
  GUIDE_TABS,
  completesSetTier,
  deployHelp,
  renderGuideTab,
  type GuideTab,
} from "./guide";
import { EXPANSION_WEAPON_ICONS, EXPANSION_ITEM_ICONS } from "./gear-icons";

export type SurvivalScreen =
  | "home"
  | "characters"
  | "playing"
  | "shop"
  | "armory"
  | "pause"
  | "settings"
  | "results";

export interface UIOffer {
  id: string | number;
  kind: "weapon" | "item" | "heal";
  contentId: string;
  title: string;
  description: string;
  cost: number;
  sold: boolean;
  locked: boolean;
  rarity: "common" | "rare" | "epic" | "insane";
  canBuy?: boolean;
  level?: number;
}

export interface UIEquipment {
  id?: string | number;
  kind: string;
  level: number;
  title?: string;
  description?: string;
  sellValue?: number;
  category?: EquipmentCategory;
  slot?: number;
  equipped?: boolean;
  mergeable?: boolean;
  stowable?: boolean;
}

export interface UIBagEntry extends UIEquipment {
  category: EquipmentCategory;
}

export interface UIStat {
  label: string;
  description?: string;
  value: string | number;
  icon?: string;
}

export interface UISynergy {
  id: string;
  name: string;
  color: string;
  count: number;
  tier: number;
  next: number | null;
  description: string;
}

export interface UIMap {
  id: MapId;
  /** 1-based position in MAP_ORDER. */
  index: number;
  name: string;
  tagline: string;
  /** CSS colour from the map palette accent. */
  accent: string;
  rule: { title: string; description: string };
  lines: string[];
}

export interface UIUnlock {
  hero?: HeroId;
  map?: MapId;
}

export interface SurvivalViewModel {
  screen: SurvivalScreen;
  heroId?: string;
  currency?: number;
  wave?: number;
  totalWaves?: number;
  hp?: number;
  maxHp?: number;
  kills?: number;
  runTime?: number;
  fullClears?: number;
  fastestClear?: number;
  earned?: number;
  time?: number;
  dash?: number;
  bestWave?: number;
  offers?: UIOffer[];
  art?: Record<string, string>;
  inventory?: UIEquipment[];
  bag?: UIBagEntry[];
  weaponSlots?: number;
  bagCapacity?: number;
  stats?: UIStat[];
  muted?: boolean;
  music?: boolean;
  reducedMotion?: boolean;
  won?: boolean;
  locked?: boolean;
  rerollCost?: number;
  notice?: string;
  enemiesRemaining?: number;
  waveBudget?: number;
  hordeWarning?: number;
  canBuySlot?: boolean;
  extraSlots?: number;
  waveIntro?: string;
  bossHp?: number;
  bossMaxHp?: number;
  bossName?: string;
  hint?: boolean;
  /** The host site offers a way out of the game. */
  canExit?: boolean;
  unlockedHeroes?: HeroId[];
  clearedHeroes?: HeroId[];
  heroRecords?: Partial<Record<HeroId, number>>;
  newUnlock?: UIUnlock;
  selectedMap?: MapId;
  unlockedMaps?: MapId[];
  clearedMaps?: Partial<Record<HeroId, MapId[]>>;
  clearedBy?: Partial<Record<MapId, HeroId[]>>;
  mapRecords?: Partial<Record<HeroId, number[]>>;
  map?: UIMap;
  totalMaps?: number;
  endless?: boolean;
  synergies?: UISynergy[];
  weaveCharge?: number;
  weaveTime?: number;
  waveThreat?: { kind: string; name: string; description: string } | null;
}

type ActionHandler = (action: string, value?: string) => void;

const HERO_LIST = HERO_ORDER.map((id) => HEROES[id]);

interface CatalogEntry {
  id: WeaponId | ItemId;
  category: EquipmentCategory;
  name: string;
  description: string;
  families: FamilyId[];
}

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]!;
  });
}

const ICONS: Record<string, string> = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5 5-5-5 5-5"/>',
  bag: '<path d="M7 7V5a5 5 0 0 1 10 0v2M4 7h16v14H4Z"/><path d="M4 12h16M9 10v4m6-4v4"/>',
  merge: '<path d="M5 21v-6c0-4 7-3 7-7m7 13v-6c0-4-7-3-7-7V2m-5 5 5-5 5 5"/>',
  armory: '<path d="M3 4h18v16H3ZM8 4v16M13 8h4m-4 4h4m-4 4h4"/>',
  hand: '<path d="M6 12V7a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v3a2 2 0 0 1 3 1v7c0 4-3 6-7 6h-2c-3 0-4-3-6-5L3 13a2 2 0 0 1 3-1Z"/>',
  stow: '<path d="M3 13v8h18v-8M12 2v13m-5-5 5 5 5-5"/>',
  swap: '<path d="M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5"/>',
  play: '<path d="m9 5 10 7-10 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  coin: '<path class="gem-face" d="m7 3-4 6 9 12 9-12-4-6Z"/><path d="M3 9h18M7 3l2 6 3 12 3-12 2-6M9 9l3-6 3 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  infinity: '<path d="M12 12C7 1 0 8 4 15s8-3 8-3 5-11 9-4-3 14-9 4Z"/>',
  kinetic: '<path d="m4 16 4-8h10l3 4-3 4ZM3 12h8m4-4v8"/>',
  thermal:
    '<path d="M13 2c2 6-4 6-2 10 1-3 4-4 5-6 1 4 6 6 4 11-2 5-12 7-15 1-3-6 4-10 8-16Z"/>',
  storm: '<path d="m14 2-9 12h7l-2 8L21 9h-8Z"/>',
  frost:
    '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1"/>',
  toxic:
    '<path d="M12 2c-2 5-7 8-7 13a7 7 0 0 0 14 0c0-5-5-8-7-13Z"/><path d="m9 12 6 6m0-6-6 6"/>',
  drone:
    '<path d="m12 5 6 3v7l-6 4-6-4V8ZM6 11H2m16 0h4M8 5 5 2m11 3 3-3M8 18l-3 4m11-4 3 4"/><circle cx="12" cy="12" r="2"/>',
  weave: '<path d="M3 6c8 0 10 12 18 12M3 18C11 18 13 6 21 6M3 12h3m12 0h3"/>',
  heart: '<path d="M12 20 4.6 12.6C-.5 7.5 6.9 1 12 7c5.1-6 12.5.5 7.4 5.6Z"/>',
  dash: '<path d="m13 3-8 11h7l-1 7 9-12h-7Z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock:
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.8-1M12 14v3"/>',
  reroll:
    '<path d="M20 9a8 8 0 0 0-13-4L3 9m0-6v6h6M4 15a8 8 0 0 0 13 4l4-4m0 6v-6h-6"/>',
  sound:
    '<path d="M3 9h4l5-4v14l-5-4H3ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  music:
    '<path d="M9 17V5l11-2v12M9 8l11-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/>',
  motion: '<path d="M3 6h8M2 12h5M4 18h7m1-12 8 6-8 6Z"/>',
  settings:
    '<path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 2 3-1 3 4 3-2v-3l4-2-1-4-3-1-1-4Z"/><circle cx="12" cy="12" r="3"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  speed: '<path d="m13 3-8 11h7l-1 7 9-12h-7ZM2 6h5M1 19h5"/>',
  power:
    '<path d="m12 2 2.7 6.7L22 12l-7.3 3.3L12 22l-2.7-6.7L2 12l7.3-3.3Z"/>',
  haste: '<circle cx="12" cy="13" r="8"/><path d="M12 5V2m-3 0h6m-3 6v5l3 2"/>',
  vitality: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  plating:
    '<path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Z"/><path d="m8 8 4-2 4 2v6l-4 3-4-3Z"/>',
  stride:
    '<path d="m9 3 6 2-2 6 6 4 2 6H10l-1-6-6-3Z"/><path d="m9 15 4-4M11 6l4 1"/>',
  magnet:
    '<path d="M4 3h6v10a2 2 0 0 0 4 0V3h6v10a8 8 0 0 1-16 0Z"/><path d="M4 7h6m4 0h6"/>',
  mending:
    '<path d="m12 2 7 8a9 9 0 0 1 1 4 8 8 0 0 1-16 0 9 9 0 0 1 1-4Z"/><path d="M9 14h6m-3-3v6"/>',
  focus:
    '<circle cx="12" cy="12" r="6"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/><circle cx="12" cy="12" r="1"/>',
  heal: '<path d="M8 2h8v4l3 3v12H5V9l3-3Z"/><path d="M9 14h6m-3-3v6M8 6h8"/>',
  trophy:
    '<path d="M7 3h10v6a5 5 0 0 1-10 0Zm0 2H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4m-4 2v5m-5 2h10"/>',
};

const WEAPON_ICONS: Record<string, string> = {
  flame:
    '<path d="m12 36 12-8h25v12H29l-8 13H11l6-16M25 28V19h15v9M42 32h13M49 18c-1-7 7-9 5-16 9 10-2 12 3 19"/><path d="M23 44h7"/>',
  frostgun:
    '<path d="M11 25h36v17H31l-7 13H13l6-17M42 28h15v9H42M20 25V17h17v8"/><path d="M29 3v12m-5-9 10 6m-10 0 10-6"/>',
  needle:
    '<path d="M14 29h29v13H29l-9 12H10l8-16M43 32h15M43 37h13M24 29V13h11v16M24 18h11M24 23h11"/><path d="m29 6-4 6h8Z"/>',
  railgun:
    '<path d="m6 33 12-9h36v14H27l-7 15H9l7-16M19 24V17h32v7M36 29h25M36 34h25"/><path d="M23 20h6m4 0h6m4 0h6"/>',
  boomerang:
    '<path d="m9 12 20 7 27 26-11 10-26-26Z"/><path d="m19 19 8 5 23 23M7 42a18 18 0 0 0 14 14m-7-6 7 6-7 3"/>',
  beam: '<path d="M11 24h30v19H27l-7 12H10l7-17M23 24V15h13v9M41 28h11v11H41M51 33h10"/><path d="m28 26-5 8h6l-3 7 10-11h-7Z"/>',
  pistol:
    '<path d="m14 35 7-11h33v12H37l-8 19H17l6-19Z"/><path d="M30 25V19h17v5m-9 13v7h-7M49 28h9v5h-9M21 45h7"/><path class="icon-fill" d="M25 27h16v5H25Z"/>',
  shotgun:
    '<path d="m6 34 14-9h39v10H29l-9 15H9l9-17M27 25V18h28v7M38 35v8h-9"/><path d="M45 29h14M25 22h6M25 38l-5 8"/>',
  arc: '<path d="M22 50V31l10-11 10 11v19ZM18 50h28M27 21V12m10 9V12M23 13h8m2 0h8"/><path d="m31 28-5 11h7l-3 9 9-14h-8Z"/><path d="m18 20-5-5m33 5 5-5M14 30H8m42 0h6"/>',
  blade:
    '<path d="m16 48 7-9L47 9l6-3 3 7-26 29-9 9ZM14 38l17 14M12 48l8 8M8 53l4 4"/><path d="m26 36 23-24"/>',
  rocket:
    '<path d="m17 42 14-23 22-9 1 24-19 21Z"/><path d="m22 33-10-1-7 10 12 1m21 6 4 10 11-9-1-13M31 19l23 15M17 49l-6 8m14-4-5 8M11 43l-7 6"/><circle cx="43" cy="26" r="5"/>',
  orbit:
    '<circle cx="32" cy="32" r="10"/><ellipse cx="32" cy="32" rx="27" ry="12" transform="rotate(-30 32 32)"/><ellipse cx="32" cy="32" rx="27" ry="12" transform="rotate(60 32 32)"/><circle class="icon-fill" cx="12" cy="45" r="5"/><circle class="icon-fill" cx="45" cy="11" r="5"/>',
};

export function uiIcon(name: string, className = ""): string {
  const droneIcons: Record<string, string> = {
    orbit_drone: "orbit",
    gun_drone: "drone",
    shock_drone: "storm",
    repair_drone: "heal",
    magnet_drone: "magnet",
    torch_drone: "flame",
    frost_drone: "frostgun",
    mortar_drone: "rocket",
    aegis_drone: "shield",
    venom_drone: "needle",
  };
  name = EXPANSION_ITEM_ICONS[name] ? name : (droneIcons[name] ?? name);
  if (name.endsWith("_core")) name = name.slice(0, -5);
  const weaponGlyph = WEAPON_ICONS[name] ?? EXPANSION_WEAPON_ICONS[name],
    isWeapon = !!weaponGlyph;
  return `<svg class="rz-icon rz-icon-${escape(name)} ${className}" viewBox="0 0 ${isWeapon ? 64 : 24} ${isWeapon ? 64 : 24}" fill="none" stroke="currentColor" stroke-width="${isWeapon ? 2.4 : 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${weaponGlyph ?? EXPANSION_ITEM_ICONS[name] ?? ICONS[name] ?? ICONS.power}</svg>`;
}

function button(
  action: string,
  label: string,
  options: {
    className?: string;
    value?: string;
    disabled?: boolean;
    icon?: string;
  } = {},
): string {
  return `<button type="button" class="rz-button ${options.className ?? ""}" data-action="${action}"${options.value !== undefined ? ` data-value="${escape(options.value)}"` : ""}${options.disabled ? " disabled" : ""}>${options.icon ? uiIcon(options.icon) : ""}<span>${label}</span></button>`;
}

function iconButton(
  action: string,
  label: string,
  icon: string,
  value?: string,
  active = false,
): string {
  return `<button type="button" class="rz-icon-button${active ? " is-active" : ""}" data-action="${action}"${value !== undefined ? ` data-value="${escape(value)}"` : ""} aria-label="${escape(label)}" title="${escape(label)}"${action === "lock" ? ` aria-pressed="${active}"` : ""}>${uiIcon(icon)}</button>`;
}

export class SurvivalUI {
  readonly element: HTMLDivElement;
  private current: SurvivalViewModel = { screen: "home" };
  private hudNodes = new Map<string, HTMLElement>();
  private lastInventory = "";
  private lastAnnouncement = "";
  private resizeObserver: ResizeObserver;
  private selectedEquipment: string | null = null;
  private guideTab: GuideTab = "weapons";
  private registryFamily = "all";
  private registryRank = 1;
  private registrySelected: string | null = null;
  private fusedEquipment: string | null = null;

  constructor(
    container: HTMLElement,
    private readonly onAction: ActionHandler,
  ) {
    this.element = document.createElement("div");
    this.element.className = "rz-ui";
    container.append(this.element);
    this.element.addEventListener("click", (event) => {
      const target = (event.target as Element).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (!target || target.disabled) return;
      if (this.handleLocalAction(target.dataset.action!, target.dataset.value))
        return;
      this.onAction(target.dataset.action!, target.dataset.value);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize(container));
    this.resizeObserver.observe(container);
    this.resize(container);
  }

  private isGuideTab(value: string | undefined): value is GuideTab {
    return GUIDE_TABS.some((tab) => tab.id === value);
  }

  private handleLocalAction(action: string, value?: string): boolean {
    // A deep link into the guide picks the tab here and still lets the game
    // switch screens.
    if (action === "armory") {
      if (this.isGuideTab(value)) {
        this.guideTab = value;
        this.registrySelected = null;
      }
      return false;
    }
    switch (action) {
      case "inspectEquipment":
        this.selectedEquipment = value ?? null;
        break;
      case "catalogItem":
        this.registrySelected = value ?? null;
        break;
      case "guideTab":
        if (!this.isGuideTab(value)) return true;
        this.guideTab = value;
        this.registrySelected = null;
        break;
      case "catalogFamily":
        this.registryFamily = value ?? "all";
        this.registrySelected = null;
        break;
      case "catalogRank":
        this.registryRank = Number(value) || 1;
        break;
      default:
        return false;
    }
    if (["guideTab", "catalogFamily"].includes(action)) {
      for (const panel of this.element.querySelectorAll<HTMLElement>(
        "[data-scroll-key]",
      ))
        panel.scrollTop = 0;
    } else if (action === "catalogItem") {
      const detail = this.element.querySelector<HTMLElement>(
        '[data-scroll-key="catalog-detail"]',
      );
      if (detail) detail.scrollTop = 0;
    }
    this.render(this.current);
    return true;
  }

  private resize(container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    const width = container.clientWidth || rect.width || 1280;
    const height = container.clientHeight || rect.height || 720;
    const scale = Math.min(width / 1280, height / 720);
    this.element.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.element.classList.toggle("is-portrait", width < height);
  }

  render(viewModel: SurvivalViewModel): void {
    const priorScreen = this.current.screen;
    const scrollOffsets = new Map(
      [...this.element.querySelectorAll<HTMLElement>("[data-scroll-key]")].map(
        (panel) => [panel.dataset.scrollKey!, panel.scrollTop],
      ),
    );
    const focused = this.element.querySelector<HTMLElement>(":focus");
    const focusAction = focused?.dataset.action;
    const focusValue = focused?.dataset.value;
    const focusKey =
      focused?.closest<HTMLElement>("[data-focus-key]")?.dataset.focusKey;
    const oldSelected = [
      ...(this.current.inventory ?? []),
      ...(this.current.bag ?? []),
    ].find((item) => String(item.id) === this.selectedEquipment);
    const newSelected = [
      ...(viewModel.inventory ?? []),
      ...(viewModel.bag ?? []),
    ].find((item) => String(item.id) === this.selectedEquipment);
    this.fusedEquipment =
      oldSelected && newSelected && newSelected.level > oldSelected.level
        ? String(newSelected.id)
        : null;
    this.current = { ...viewModel };
    this.element.classList.toggle(
      "is-screen-enter",
      priorScreen !== viewModel.screen || this.element.childElementCount === 0,
    );
    this.element.dataset.screen = viewModel.screen;
    this.element.dataset.hero = viewModel.heroId ?? "ember";
    this.element.classList.toggle("reduce-motion", !!viewModel.reducedMotion);
    this.element.style.setProperty("--hero", this.hero.color);
    this.hudNodes.clear();
    this.lastInventory = "";
    this.lastAnnouncement = "";
    const screens: Record<SurvivalScreen, () => string> = {
      home: () => this.home(),
      characters: () => this.characters(),
      playing: () => this.hud(),
      shop: () => this.shop(),
      armory: () => this.armory(),
      pause: () => this.pause(),
      settings: () => this.settings(),
      results: () => this.results(),
    };
    this.element.innerHTML = `${screens[viewModel.screen]()}<div class="rz-notice" role="status" aria-live="polite">${escape(viewModel.notice)}</div><div class="rz-rotate">Rotate to landscape.</div>`;
    if (viewModel.screen === "playing") {
      for (const node of this.element.querySelectorAll<HTMLElement>(
        "[data-hud]",
      )) {
        this.hudNodes.set(node.dataset.hud!, node);
      }
      this.updateHUD(viewModel);
    }
    if (priorScreen === viewModel.screen) {
      for (const panel of this.element.querySelectorAll<HTMLElement>(
        "[data-scroll-key]",
      )) {
        panel.scrollTop = scrollOffsets.get(panel.dataset.scrollKey!) ?? 0;
      }
    }
    let restoredFocus = false;
    if (priorScreen === viewModel.screen && focusKey) {
      for (const node of this.element.querySelectorAll<HTMLElement>(
        "[data-focus-key]",
      )) {
        if (node.dataset.focusKey === focusKey) {
          node.focus({ preventScroll: true });
          restoredFocus = true;
          break;
        }
      }
    }
    if (priorScreen === viewModel.screen && focusAction && !restoredFocus) {
      for (const node of this.element.querySelectorAll<HTMLButtonElement>(
        "button[data-action]",
      )) {
        if (
          node.dataset.action === focusAction &&
          node.dataset.value === focusValue &&
          !node.disabled
        ) {
          node
            .closest<HTMLElement>(".rz-gear-cell")
            ?.focus({ preventScroll: true });
          node.focus({ preventScroll: true });
          restoredFocus = true;
          break;
        }
      }
    }
    if (
      priorScreen === "shop" &&
      viewModel.screen === "shop" &&
      focused &&
      !restoredFocus
    ) {
      const fallback = this.element.querySelector<HTMLElement>(
        focusAction === "sell"
          ? ".rz-gear-cell:not(.is-empty)"
          : 'button[data-action="buy"]:not(:disabled), button[data-action="nextWave"]',
      );
      fallback?.focus({ preventScroll: true });
    }
  }

  updateHUD(patch: Partial<SurvivalViewModel>): void {
    Object.assign(this.current, patch);
    if (this.current.screen !== "playing") return;
    const vm = this.current;
    const update = (key: string, value: string) => {
      const node = this.hudNodes.get(key);
      if (node && node.textContent !== value) node.textContent = value;
    };
    update("wave", `${String(vm.wave ?? 1).padStart(2, "0")}`);
    update(
      "timer",
      (vm.bossHp ?? 0) > 0 && (vm.time ?? 0) <= 0
        ? "BOSS"
        : this.formatTime(vm.time ?? 0),
    );
    update("currency", `${Math.floor(vm.currency ?? 0)}`);
    update("health", `${Math.max(0, Math.ceil(vm.hp ?? 100))}`);
    update("maxHealth", `/ ${Math.round(vm.maxHp ?? 100)}`);
    const hp = Math.max(0, Math.min(1, (vm.hp ?? 100) / (vm.maxHp || 100)));
    this.hudNodes
      .get("healthFill")
      ?.style.setProperty("transform", `scaleX(${hp})`);
    this.element.classList.toggle("is-hurt", hp < 0.35);
    this.element.classList.toggle("is-critical", hp < 0.2);
    const dash = Math.max(0, Math.min(1, vm.dash ?? 1));
    this.hudNodes
      .get("dashFill")
      ?.style.setProperty("transform", `scaleX(${dash})`);
    this.hudNodes.get("dash")?.classList.toggle("is-ready", dash >= 0.99);
    update("dashLabel", dash >= 0.99 ? "DASH" : "CHARGING");
    const weaveCharge = Math.max(0, Math.min(1, vm.weaveCharge ?? 0));
    const weaveActive = (vm.weaveTime ?? 0) > 0;
    this.hudNodes.get("weave")?.classList.toggle("is-active", weaveActive);
    this.hudNodes
      .get("weaveFill")
      ?.style.setProperty(
        "transform",
        `scaleX(${weaveActive ? Math.min(1, (vm.weaveTime ?? 0) / 3.5) : weaveCharge})`,
      );
    update("weaveLabel", weaveActive ? "BOOST ACTIVE" : "DODGE BOOST");
    update(
      "weaveValue",
      weaveActive
        ? `${vm.weaveTime!.toFixed(1)}s`
        : `${Math.round(weaveCharge * 100)}%`,
    );
    update("bossName", vm.bossName ?? "WARDEN");
    this.hudNodes
      .get("threat")
      ?.classList.toggle("is-visible", !!vm.waveThreat);
    update("threatName", vm.waveThreat?.name ?? "");
    update("threatDescription", vm.waveThreat?.description ?? "");
    const bossVisible = (vm.bossMaxHp ?? 0) > 0 && (vm.bossHp ?? 0) > 0;
    const remaining = Math.max(0, Math.round(vm.enemiesRemaining ?? 0)),
      budget = vm.waveBudget ?? 0,
      horde = (vm.hordeWarning ?? 0) > 0;
    update("enemiesLeft", String(remaining));
    update("counterLabel", horde ? "HORDE" : "LEFT");
    const counter = this.hudNodes.get("counterWrap");
    counter?.classList.toggle("is-visible", remaining > 0 || !bossVisible);
    counter?.classList.toggle(
      "is-low",
      remaining > 0 && remaining <= Math.max(6, Math.round(budget * 0.12)),
    );
    counter?.classList.toggle("is-horde", horde);
    this.hudNodes.get("boss")?.classList.toggle("is-visible", bossVisible);
    this.hudNodes
      .get("bossFill")
      ?.style.setProperty(
        "transform",
        `scaleX(${bossVisible ? (vm.bossHp ?? 0) / vm.bossMaxHp! : 0})`,
      );
    const inventoryKey = JSON.stringify(
      (vm.inventory ?? []).map(({ kind, level, slot }) => [kind, level, slot]),
    );
    if (inventoryKey !== this.lastInventory) {
      this.lastInventory = inventoryKey;
      const node = this.hudNodes.get("inventory");
      if (node) node.innerHTML = this.equipment(vm.inventory ?? [], true);
    }
    this.hudNodes.get("hint")?.classList.toggle("is-visible", !!vm.hint);
    if ((vm.waveIntro ?? "") !== this.lastAnnouncement) {
      this.lastAnnouncement = vm.waveIntro ?? "";
      update("announcement", this.lastAnnouncement);
      this.hudNodes
        .get("announcement")
        ?.classList.toggle("is-visible", !!this.lastAnnouncement);
    }
  }

  clearNotice(): void {
    this.setNotice("");
  }

  /** Updates the notice without rebuilding the screen (used by the HUD). */
  setNotice(message: string): void {
    this.current.notice = message;
    const notice = this.element.querySelector<HTMLElement>(".rz-notice");
    if (notice && notice.textContent !== message) notice.textContent = message;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.element.remove();
  }

  private get hero() {
    return (
      HERO_LIST.find(({ id }) => id === this.current.heroId) ?? HERO_LIST[0]
    );
  }

  private formatTime(time: number): string {
    const seconds = Math.max(0, Math.ceil(time));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private brand(small = false): string {
    return `<h1 class="rz-brand${small ? " rz-brand-small" : ""}" aria-label="Survival Maxx"><span aria-hidden="true">SURVIVAL</span><span aria-hidden="true">MAXX</span></h1>`;
  }

  private header(label: string, action = "back"): string {
    return `<header class="rz-screen-header">${button(action, "Back", { className: "rz-button-quiet", icon: "back" })}<span class="rz-eyebrow">${label}</span><span class="rz-header-mark" aria-label="Survival Maxx">M<span>/</span>X</span></header>`;
  }

  private homeRecord(): string {
    const vm = this.current;
    if (!vm.bestWave) return "";
    const unlocked = vm.unlockedHeroes?.length ?? 1;
    const totalMaps = vm.totalMaps ?? MAP_COUNT;
    const clears = Object.values(vm.clearedMaps ?? {}).reduce(
      (sum, maps) => sum + (maps?.length ?? 0),
      0,
    );
    return `<p class="rz-home-record">${uiIcon("trophy")}<span>BEST WAVE ${String(vm.bestWave).padStart(2, "0")}</span><i></i><span>${unlocked} / ${HERO_LIST.length} CHARACTERS</span><i></i><span>${clears} / ${HERO_LIST.length * totalMaps} MAPS</span></p>`;
  }

  private home(): string {
    return `<div class="rz-home-gradient"></div><div class="rz-home-content">${this.brand()}<p class="rz-home-line">Survive. Upgrade. Repeat.</p>${this.homeRecord()}<nav class="rz-home-actions" aria-label="Main menu">${button("play", "Play", { className: "rz-button-primary rz-button-large", icon: "arrow" })}${button("settings", "Settings", { className: "rz-button-home-secondary", icon: "settings" })}${this.current.canExit ? button("exit", "Back to playhouse", { className: "rz-button-home-secondary", icon: "back" }) : ""}</nav></div>`;
  }

  private mapAccent(id: MapId): string {
    if (this.current.map?.id === id) return this.current.map.accent;
    return `#${mapById(id).palette.accent.toString(16).padStart(6, "0")}`;
  }

  private mapPicker(
    unlockedMaps: MapId[],
    clearedMaps: MapId[],
    selected: MapId,
  ): string {
    const chips = MAP_ORDER.map((id) => {
      const definition = mapById(id);
      const cleared = clearedMaps.includes(id),
        open = unlockedMaps.includes(id),
        current = id === selected;
      const state = !open ? "locked" : cleared ? "cleared" : "open";
      return `<button type="button" class="rz-map-chip${cleared ? " is-cleared" : ""}${current ? " is-current" : ""}${!open ? " is-locked" : ""}" data-action="selectMap" data-value="${id}" data-focus-key="map:${id}" style="--map:${this.mapAccent(id)}" aria-pressed="${current}" aria-label="Map ${id}, ${escape(definition.name)}, ${state}"${open ? "" : " disabled"}><span>${String(id).padStart(2, "0")}</span>${cleared ? uiIcon("check") : !open ? uiIcon("lock") : ""}</button>`;
    }).join("");
    return `<div class="rz-map-picker" role="group" aria-label="Maps">${chips}</div>`;
  }

  private mapBrief(map: UIMap, locked = false): string {
    const total = this.current.totalMaps ?? MAP_COUNT;
    return `<div class="rz-map-brief${locked ? " is-locked" : ""}" style="--map:${map.accent}"><span class="rz-eyebrow">MAP ${String(map.index).padStart(2, "0")} / ${total}</span><strong>${escape(map.name)}</strong><p><b>${escape(map.rule.title)}</b>${escape(map.rule.description)}</p><div class="rz-map-lines">${map.lines.map((line) => `<span>${escape(line)}</span>`).join("")}</div></div>`;
  }

  private characters(): string {
    const vm = this.current;
    const hero = this.hero;
    const selectedIndex = HERO_ORDER.indexOf(hero.id);
    const unlocked = vm.unlockedHeroes ?? [HERO_ORDER[0]];
    const isUnlocked = unlocked.includes(hero.id);
    const previousHero = HEROES[HERO_ORDER[Math.max(0, selectedIndex - 1)]];
    const totalMaps = vm.totalMaps ?? MAP_COUNT;
    const selectedMap = vm.selectedMap ?? vm.map?.id ?? MAP_ORDER[0];
    const map =
      vm.map && vm.map.id === selectedMap
        ? vm.map
        : {
            id: selectedMap,
            index: MAP_ORDER.indexOf(selectedMap) + 1,
            name: mapById(selectedMap).name,
            tagline: mapById(selectedMap).tagline,
            accent: this.mapAccent(selectedMap),
            rule: mapById(selectedMap).rule,
            lines: mapStatLines(mapById(selectedMap)),
          };
    const unlockedMaps = vm.unlockedMaps ?? (isUnlocked ? [MAP_ORDER[0]] : []);
    const clearedMaps = vm.clearedMaps?.[hero.id] ?? [];
    const mapUnlocked = isUnlocked && unlockedMaps.includes(selectedMap);
    const pairCleared = clearedMaps.includes(selectedMap);
    const record = vm.mapRecords?.[hero.id]?.[selectedMap - 1] ?? 0;
    const roster = HERO_LIST.map((entry) => {
      const available = unlocked.includes(entry.id);
      const clears = vm.clearedMaps?.[entry.id]?.length ?? 0;
      const completed = clears >= totalMaps;
      const state = !available
        ? uiIcon("lock")
        : completed
          ? uiIcon("check")
          : clears > 0
            ? `<small>${clears}/${totalMaps}</small>`
            : `<i></i>`;
      const progress = Array.from(
        { length: totalMaps },
        (_, index) => `<i${index < clears ? ' class="is-done"' : ""}></i>`,
      ).join("");
      return `<button type="button" class="rz-roster-tile${entry.id === hero.id ? " is-selected" : ""}${!available ? " is-locked" : ""}${completed ? " is-cleared" : ""}" data-action="selectHero" data-value="${entry.id}" data-focus-key="hero:${entry.id}" style="--card-accent:${entry.color}" aria-pressed="${entry.id === hero.id}" aria-label="${escape(entry.name)}${!available ? ", locked" : completed ? ", all maps cleared" : `, ${clears} of ${totalMaps} maps cleared`}">${uiIcon(entry.weapon, "rz-roster-symbol")}<span class="rz-roster-name">${escape(entry.name)}</span><span class="rz-roster-state">${state}</span><span class="rz-roster-progress" aria-hidden="true">${progress}</span></button>`;
    }).join("");
    const help = deployHelp({
      heroName: hero.name,
      previousHeroName: previousHero.name,
      heroUnlocked: isUnlocked,
      mapIndex: map.index,
      mapUnlocked,
      cleared: pairCleared,
      bestWave: record,
      endless: pairCleared,
    });
    return `<div class="rz-selection-gradient"></div>${this.header("SELECT CHARACTER")}<div class="rz-selection-armory">${button("armory", "Game guide", { className: "rz-button-secondary", icon: "armory" })}</div><section class="rz-hero-details" aria-live="polite"><div class="rz-overline"><i></i>${escape(hero.role.toUpperCase())}</div><h1>${escape(hero.name)}<span>.</span></h1><p class="rz-hero-passive">${escape(hero.passiveDescription)}</p><div class="rz-hero-loadout">${uiIcon(hero.weapon)}<div><span class="rz-eyebrow">STARTING GEAR · ${hero.weaponSlots} ${hero.weaponSlots === 1 ? "HAND" : "HANDS"}</span><strong>${escape(WEAPONS[hero.weapon].name)}${hero.id === "wisp" ? `<br />+ ${escape(ITEMS.gun_drone.name)}` : ""}</strong></div><span class="rz-hero-health">${uiIcon("heart")}${hero.maxHp}</span></div><div class="rz-hero-ability">${uiIcon("dash")}<span>${escape(hero.abilityDescription)}</span></div><div class="rz-hero-traits"><div class="rz-hero-signature">${uiIcon("power")}<span><b>${escape(hero.signature)}</b>${escape(hero.signatureDescription)}</span></div><div class="rz-hero-downside">${uiIcon("info")}<span><b>${escape(hero.downside)}</b>${escape(hero.downsideDescription)}</span></div></div></section><div class="rz-roster-summary"><span class="rz-eyebrow">CHARACTERS <b>${unlocked.length} / ${HERO_LIST.length}</b></span>${record > 0 ? `<span class="rz-hero-record">${uiIcon("trophy")} BEST WAVE ${String(record).padStart(2, "0")}</span>` : ""}</div>${this.mapPicker(unlockedMaps, clearedMaps, selectedMap)}<div class="rz-roster" role="group" aria-label="Characters">${roster}</div><div class="rz-deploy">${this.mapBrief(map, !mapUnlocked)}${pairCleared ? button("deployEndless", "Endless", { className: "rz-button-secondary", icon: "infinity" }) : ""}${button("deploy", mapUnlocked ? "Start" : "Locked", { className: "rz-button-primary", icon: mapUnlocked ? "arrow" : "lock", disabled: !mapUnlocked })}<span class="rz-deploy-help${!mapUnlocked ? " is-unlock-condition" : ""}">${escape(help)}</span></div>`;
  }

  /** The wave-1 movement hint, built from the HINTS entry so copy lives in content. */
  private moveHint(): string {
    const hint = HINTS.find((entry) => entry.id === "move");
    const keys = hint?.keys ?? "WASD to move · SPACE to dash";
    const touch = hint?.touch ?? "Drag to move · Tap Dash to dodge";
    const segment = (text: string, keyboard: boolean) =>
      text
        .split("·")
        .map((part) =>
          part
            .trim()
            .split(/\s+/)
            .map((token) =>
              keyboard && /^[A-Z]{2,}$/.test(token)
                ? token === "WASD"
                  ? token
                      .split("")
                      .map((key) => `<kbd>${key}</kbd>`)
                      .join("")
                  : `<kbd>${escape(token)}</kbd>`
                : escape(token),
            )
            .join(" "),
        )
        .join("<i></i>");
    return `<div class="rz-hint" data-hud="hint" aria-live="polite"><span class="rz-hint-keys">${segment(keys, true)}</span><span class="rz-hint-touch">${segment(touch, false)}</span></div>`;
  }

  private hud(): string {
    const vm = this.current;
    const mapName = vm.map
      ? `<b class="rz-hud-map" style="--map:${escape(vm.map.accent)}">${escape(vm.map.name.toUpperCase())}</b> · `
      : "";
    return `<div class="rz-hurt-vignette"></div><div class="rz-hud-top"><div class="rz-vitals"><div class="rz-vitals-number">${uiIcon("heart")}<strong data-hud="health">100</strong><span data-hud="maxHealth">/ 100</span></div><div class="rz-health-track"><i data-hud="healthFill"></i></div></div><div class="rz-wave-clock"><span class="rz-eyebrow">${mapName}WAVE <strong data-hud="wave">01</strong><span class="rz-wave-total">${vm.endless ? " / ∞" : ` / ${vm.totalWaves ?? CAMPAIGN_WAVES}`}</span></span><span class="rz-timer" data-hud="timer">0:45</span></div><div class="rz-hud-wallet">${uiIcon("coin")}<strong data-hud="currency">0</strong>${iconButton("pause", "Pause", "pause")}</div></div><div class="rz-boss" data-hud="boss"><span class="rz-eyebrow" data-hud="bossName">${escape(vm.bossName ?? "WARDEN")}</span><div><i data-hud="bossFill"></i></div></div><div class="rz-threat" data-hud="threat"><span class="rz-eyebrow">NEW ENEMY</span><strong data-hud="threatName"></strong><p data-hud="threatDescription"></p></div><div class="rz-enemy-counter" data-hud="counterWrap" aria-live="off"><b data-hud="enemiesLeft">0</b><span data-hud="counterLabel">LEFT</span></div><div class="rz-wave-announcement" data-hud="announcement" aria-live="polite"></div>${this.moveHint()}<div class="rz-weave" data-hud="weave" tabindex="0" aria-label="Dodge boost. Dodge 3 shots closely for 25% more damage for 3.5 seconds.">${uiIcon("weave")}<div><span data-hud="weaveLabel">DODGE BOOST</span><div class="rz-weave-track"><i data-hud="weaveFill"></i></div></div><strong data-hud="weaveValue"></strong><div class="rz-weave-tooltip">Dodge 3 shots closely.<br />+25% damage for 3.5s</div></div><div class="rz-hud-bottom"><button type="button" class="rz-dash is-ready" data-hud="dash" data-action="dash" aria-label="Dash">${uiIcon("dash")}<div><span data-hud="dashLabel">DASH</span><div class="rz-dash-track"><i data-hud="dashFill"></i></div></div><kbd>SPACE</kbd></button><div class="rz-hud-equipment" data-hud="inventory"></div><div class="rz-move-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><b>MOVE</b></div></div>`;
  }

  private rank(level: number) {
    return RANKS[
      Math.max(0, Math.min(RANKS.length - 1, Math.floor(level) - 1))
    ];
  }

  private rankBadge(level: number, compact = false): string {
    const rank = this.rank(level);
    return `<span class="rz-rank-badge rz-rank-${rank.level}${compact ? " is-compact" : ""}" style="--rank:${rank.color}"><b>${["I", "II", "III", "IV", "V", "VI"][rank.level - 1]}</b>${compact ? "" : `<span>${rank.name}</span>`}</span>`;
  }

  private allGear(): UIEquipment[] {
    return [
      ...(this.current.inventory ?? []).map((item, index) => ({
        ...item,
        category: "weapon" as const,
        equipped: true,
        slot: item.slot ?? index,
      })),
      ...(this.current.bag ?? []).map((item) => ({ ...item, equipped: false })),
    ];
  }

  private get slots(): number {
    return this.current.weaponSlots ?? this.hero.weaponSlots;
  }

  private gearName(item: UIEquipment): string {
    return (
      item.title ??
      WEAPONS[item.kind as WeaponId]?.name ??
      ITEMS[item.kind as ItemId]?.name ??
      item.kind
    );
  }

  private gearFamilies(kind: string): FamilyId[] {
    return (
      WEAPONS[kind as WeaponId]?.families ??
      ITEMS[kind as ItemId]?.families ??
      []
    );
  }

  /** What a piece does, in words: the same sentence the shop's info note shows. */
  private gearBehavior(kind: string, level: number): string {
    if (kind in WEAPONS) return rankStatLines(kind as WeaponId, level)[2] ?? "";
    return ITEMS[kind as ItemId]?.description ?? "";
  }

  private gearStats(kind: string, level: number): string[] {
    const item = ITEMS[kind as ItemId];
    return rankStatLines(kind as WeaponId | ItemId, level).filter(
      (line) =>
        /^[+\-\d]/.test(line) &&
        !(item?.category === "drone" && line === item.description),
    );
  }

  private canMerge(item: UIEquipment): boolean {
    return (
      item.mergeable ??
      (item.level < 6 &&
        this.allGear().some(
          (other) =>
            other.id !== item.id &&
            other.kind === item.kind &&
            other.level === item.level &&
            other.category === item.category,
        ))
    );
  }

  private canRemove(item: UIEquipment): boolean {
    const otherHands = (this.current.inventory ?? []).filter(
      (entry) => entry.id !== item.id,
    );
    const armedDrones =
      this.hero.id === "wisp" &&
      (this.current.bag ?? []).some(
        (entry) =>
          entry.id !== item.id &&
          entry.category === "drone" &&
          OFFENSIVE_DRONES.includes(
            ITEMS[entry.kind as ItemId]?.drone?.attack as DroneAttack,
          ),
      );
    return (
      (!item.equipped &&
        !(this.hero.id === "wisp" && item.category === "drone")) ||
      otherHands.length > 0 ||
      !!armedDrones
    );
  }

  private isInsane(kind: string): boolean {
    return !!WEAPONS[kind as WeaponId]?.unique;
  }

  private equipment(items: UIEquipment[], compact = false): string {
    return Array.from({ length: this.slots }, (_, slot) => {
      const item = items.find((entry, index) => (entry.slot ?? index) === slot);
      if (!item)
        return `<div class="rz-hand-hud is-empty">${uiIcon("hand")}<span>${slot + 1}</span></div>`;
      const insane = this.isInsane(item.kind);
      return `<div class="rz-hand-hud rz-rank-${item.level}${insane ? " is-insane" : ""}" style="--rank:${this.rank(item.level).color}" title="${escape(this.gearName(item))}, ${insane ? "insane" : this.rank(item.level).name} — ${escape(this.gearBehavior(item.kind, item.level))}" aria-label="${escape(this.gearName(item))}, ${insane ? "insane" : this.rank(item.level).name}">${uiIcon(item.kind)}${insane ? `<span class="rz-insane-badge is-compact">!</span>` : this.rankBadge(item.level, true)}</div>`;
    }).join("");
  }

  private gearCell(
    item: UIEquipment | undefined,
    index: number,
    hand = false,
  ): string {
    if (!item)
      return `<div class="rz-gear-cell is-empty${hand ? " is-hand" : ""}" aria-label="Empty ${hand ? "hand" : "bag slot"} ${index + 1}">${uiIcon(hand ? "hand" : "bag")}<span>${index + 1}</span></div>`;
    const rank = this.rank(item.level);
    const art = this.current.art?.[item.kind];
    const mergeable = this.canMerge(item);
    const insane = this.isInsane(item.kind);
    return `<button type="button" class="rz-gear-cell rz-rank-${rank.level}${hand ? " is-hand" : ""}${insane ? " is-insane" : ""}${this.selectedEquipment === String(item.id) ? " is-selected" : ""}${mergeable ? " can-merge" : ""}${this.fusedEquipment === String(item.id) ? " is-fused" : ""}" style="--rank:${rank.color}" data-action="inspectEquipment" data-value="${escape(item.id)}" data-focus-key="gear:${escape(item.id)}" aria-pressed="${this.selectedEquipment === String(item.id)}" title="${escape(this.gearName(item))}, ${rank.name} — ${escape(this.gearBehavior(item.kind, item.level))}" aria-label="${escape(this.gearName(item))}, ${insane ? "insane" : rank.name}${mergeable ? ", merge available" : ""}">${art ? `<img src="${escape(art)}" alt="" draggable="false"/>` : uiIcon(item.kind)}${insane ? `<span class="rz-insane-badge is-compact">!</span>` : this.rankBadge(item.level, true)}${mergeable ? `<span class="rz-merge-dot" title="Merge available">${uiIcon("merge")}</span>` : ""}${!hand && item.category === "weapon" ? `<span class="rz-stored-mark" title="Stored weapon">${uiIcon("bag")}</span>` : ""}</button>`;
  }

  private rankGuide(): string {
    return `<details class="rz-rank-guide"><summary>${uiIcon("merge")} Ranks</summary><div class="rz-rank-guide-popover"><strong>Merge matching gear to rank up.</strong><p>Same gear. Same rank. Two become one.</p><div>${RANKS.map((rank) => this.rankBadge(rank.level)).join("")}</div><small>Merging can reduce set bonuses.</small></div></details>`;
  }

  private gearInspector(item: UIEquipment | undefined): string {
    if (!item)
      return `<section class="rz-gear-inspector is-empty">${uiIcon("bag")}<strong>Select gear</strong><span>Equip · Merge · Sell</span></section>`;
    const rank = this.rank(item.level),
      bagFull =
        (this.current.bag?.length ?? 0) >= (this.current.bagCapacity ?? 12);
    const mergeable = this.canMerge(item),
      stowable = item.stowable ?? (!bagFull && this.canRemove(item));
    const families = this.gearFamilies(item.kind);
    const pair = this.allGear().find(
      (entry) =>
        entry.id !== item.id &&
        entry.kind === item.kind &&
        entry.level === item.level &&
        entry.category === item.category,
    );
    const losesPiece =
      !!pair &&
      (item.category !== "weapon" || (!!item.equipped && !!pair.equipped));
    const mergeLoss = losesPiece
      ? families
          .map((id) => {
            const count =
              this.current.synergies?.find((set) => set.id === id)?.count ?? 0;
            return `${FAMILIES[id].name} ${count}→${Math.max(0, count - 1)}`;
          })
          .join(" · ")
      : "";
    const equipActions =
      item.category === "weapon" && !item.equipped
        ? `<div class="rz-equip-targets">${Array.from(
            { length: this.slots },
            (_, slot) => {
              const taken = (this.current.inventory ?? []).some(
                (entry, index) => (entry.slot ?? index) === slot,
              );
              return button(
                "equip",
                `${taken ? "Swap" : "Equip"} ${slot + 1}`,
                {
                  className: "rz-button-secondary",
                  value: `${item.id}:${slot}`,
                  icon: taken ? "swap" : "hand",
                },
              );
            },
          ).join("")}</div>`
        : "";
    return `<section class="rz-gear-inspector rz-rank-${rank.level}${this.fusedEquipment === String(item.id) ? " is-fused" : ""}" style="--rank:${rank.color}"><div class="rz-inspector-title"><h2>${escape(this.gearName(item))}</h2>${this.rankBadge(rank.level)}</div><div class="rz-inspector-status"><span>${item.equipped ? `HAND ${(item.slot ?? 0) + 1}` : item.category === "weapon" ? "IN BAG · INACTIVE" : "IN BAG · ACTIVE"}</span><div class="rz-family-tags">${families.map((id) => this.familyChip(id)).join("")}</div></div><p class="rz-inspector-behavior">${escape(this.gearBehavior(item.kind, item.level))}</p><div class="rz-inspector-metrics">${this.gearStats(
      item.kind,
      item.level,
    )
      
      .map((line) => this.metricChip(line))
      .join(
        "",
      )}</div><div class="rz-inspector-actions">${this.mergeControl(item, mergeable, mergeLoss)}${item.equipped ? button("stow", "Store", { className: "rz-button-secondary", icon: "stow", value: String(item.id), disabled: !stowable }) : ""}${button("sell", item.sellValue === undefined ? "Sell" : `Sell ${uiIcon("coin")} ${item.sellValue}`, { className: "rz-button-sell", value: String(item.id), disabled: item.sellValue === undefined })}</div>${equipActions || `<div class="rz-merge-context">${mergeable ? mergeLoss || `2 × ${rank.name} → 1 × ${this.rank(rank.level + 1).name}` : item.level >= 6 ? "Highest rank reached." : "Merge with the same gear and rank."}</div>`}</section>`;
  }

  private mergeControl(
    item: UIEquipment,
    mergeable: boolean,
    setChange: string,
  ): string {
    const current = this.rank(item.level),
      next = this.rank(item.level + 1);
    const action = button("merge", item.level >= 6 ? "Max rank" : "Merge", {
      className: "rz-merge-button",
      icon: "merge",
      value: String(item.id),
      disabled: !mergeable,
    });
    if (!mergeable) return `<div class="rz-merge-control">${action}</div>`;
    return `<div class="rz-merge-control">${action}<div class="rz-merge-preview" role="tooltip"><strong>Merge two into one</strong><div class="rz-merge-comparison"><div>${this.rankBadge(current.level)}<small>Before</small>${this.gearStats(
      item.kind,
      current.level,
    )
      .map((line) => `<span>${escape(line)}</span>`)
      .join(
        "",
      )}</div>${uiIcon("arrow")}<div>${this.rankBadge(next.level)}<small>After</small>${this.gearStats(
      item.kind,
      next.level,
    )
      .map((line) => `<span>${escape(line)}</span>`)
      .join(
        "",
      )}</div></div><p>${setChange ? escape(setChange) : "Frees one slot. Upgrades this gear."}</p></div></div>`;
  }

  private metricChip(text: string, iconOnly = false): string {
    const label = text.trim().replace(/\.$/, "");
    let icon = "power";
    let value = label;
    if (/damage(?:$|\s*\/)/i.test(label))
      value = label.replace(/\s+damage/i, "");
    else if (/fire rate|per attack/i.test(label)) {
      icon = "haste";
      value = label.replace(/\s+(fire rate|per attack)/i, "");
    } else if (/attack speed/i.test(label)) {
      icon = "haste";
      value = label.replace(/\s+attack speed/i, "");
    } else if (/armor/i.test(label)) {
      icon = "plating";
      value = label.replace(/\s+armor/i, "");
    } else if (/move(?:ment)? speed/i.test(label)) {
      icon = "speed";
      value = label.replace(/\s+move(?:ment)? speed/i, "");
    } else if (/pickup (reach|range)/i.test(label)) {
      icon = "magnet";
      value = label.replace(/\s+pickup (reach|range)/i, "");
    } else if (/salvage|emeralds/i.test(label)) {
      icon = "coin";
      value = label.replace(/\s+(salvage|emeralds)/i, "");
    } else if (/^Heal \d+ health every/i.test(label)) {
      icon = "mending";
      value = label.replace(
        /^Heal (\d+) health every (\d+) seconds/i,
        "$1/$2s",
      );
    } else if (/health\s*\/\s*\d+(?:\.\d+)?s/i.test(label)) {
      icon = "mending";
      value = label.replace(/\s+health\s*\/\s*/i, "/");
    } else if (/health/i.test(label)) {
      icon = "heart";
      value = label
        .replace(/^Restore\s+/i, "+")
        .replace(/\s+(max )?health/i, "")
        .replace(/\/ second/i, "/s");
    } else if (/^Heal /i.test(label)) {
      icon = "mending";
      value = label.replace(/^Heal /i, "+");
    } else if (/dash recharge/i.test(label)) {
      icon = "dash";
      value = label.match(/[\d.]+%/)?.[0] ?? label;
    } else if (/targets|chain/i.test(label)) {
      icon = "storm";
      value = label.replace(/\s+targets/i, " targets");
    } else if (/burn/i.test(label)) {
      icon = "thermal";
      value = label.replace(/\s+burn\s*\/\s*second/i, "/s");
    } else if (/poison/i.test(label)) {
      icon = "toxic";
      value = label.replace(/\s+poison\s*\/\s*second/i, "/s");
    } else if (/slow/i.test(label)) {
      icon = "frost";
      value = label.replace(/\s+slow/i, "");
    } else if (/Splash radius/i.test(label)) {
      icon = "rocket";
      value = label.replace(/Splash radius\s+/i, "");
    } else if (/spread/i.test(label)) {
      icon = "shotgun";
      value = "Spread";
    } else if (/close range/i.test(label)) {
      icon = "blade";
      value = "Melee";
    } else if (/360/i.test(label)) {
      icon = "orbit";
      value = "360°";
    } else if (/pierc/i.test(label)) {
      icon = "railgun";
      value = "Pierce";
    } else if (/return/i.test(label)) {
      icon = "boomerang";
      value = "Return";
    } else if (/set piece/i.test(label)) {
      icon =
        label
          .toLowerCase()
          .match(/kinetic|thermal|storm|frost|toxic|drone/)?.[0] ?? "power";
      value = "+1 set";
    } else if (/^I{1,3}$/.test(label)) {
      icon = "arrow";
      value = `LV ${label}`;
    }
    if (iconOnly) return uiIcon(icon);
    return `<span class="rz-metric-chip" title="${escape(label)}" aria-label="${escape(label)}">${uiIcon(icon)}<b>${escape(value)}</b></span>`;
  }

  private familyChip(id: FamilyId): string {
    const family = FAMILIES[id];
    return `<span class="rz-family-tag" style="--family:${family.color}">${uiIcon(id)}${escape(family.name)}</span>`;
  }

  private setCounts(): Partial<Record<FamilyId, number>> {
    const counts: Partial<Record<FamilyId, number>> = {};
    for (const set of this.current.synergies ?? [])
      counts[set.id as FamilyId] = set.count;
    return counts;
  }

  private synergyBar(): string {
    const known = this.current.synergies ?? [];
    const hero = this.hero;
    const maxPips = SET_TIERS[SET_TIERS.length - 1];
    return `<div class="rz-synergy-bar" aria-label="Equipment sets">${Object.values(
      FAMILIES,
    )
      .map((family) => {
        const status = known.find((entry) => entry.id === family.id);
        const count = status?.count ?? 0;
        const tier =
          status?.tier ?? SET_TIERS.filter((size) => count >= size).length;
        const next =
          status?.next ?? SET_TIERS.find((size) => count < size) ?? null;
        const free = hero.setPiece.includes(family.id);
        const pips = Array.from({ length: maxPips }, (_, index) => {
          const piece = index + 1;
          const marks = (SET_TIERS as readonly number[]).includes(piece)
            ? " is-tier"
            : "";
          return `<i class="${piece <= count ? "is-on" : ""}${marks}"></i>`;
        }).join("");
        const rows = SET_TIERS.map(
          (size) =>
            `<div class="${count >= size ? "is-active" : ""}${next === size ? " is-next" : ""}"><strong>${size}</strong><p>${escape(family.thresholds[size])}</p></div>`,
        ).join("");
        return `<div class="rz-synergy-chip${tier >= 1 ? " is-active" : ""} is-tier-${tier}" tabindex="0" data-focus-key="set:${family.id}" style="--family:${family.color}" aria-label="${escape(family.name)} set, ${count} of ${maxPips} pieces${tier >= 1 ? `, tier ${tier} active` : ""}">${uiIcon(family.id)}<span>${escape(family.name)}</span><strong>${count}<small>${next ? `/${next}` : uiIcon("check")}</small></strong><span class="rz-synergy-pips" aria-hidden="true">${pips}</span><div class="rz-synergy-tooltip"><b>${escape(family.name)}</b><small>Equipped weapons, items, drones and mods each count once.<br />Weapons in your bag do not count.${free ? `<br />${escape(hero.name)} counts as 1 free ${escape(family.name)} piece.` : ""}</small>${rows}<button type="button" class="rz-synergy-link" data-action="armory" data-value="sets">All sets in the guide ${uiIcon("arrow")}</button></div></div>`;
      })
      .join("")}</div>`;
  }

  private shopMapBadge(): string {
    const map = this.current.map;
    if (!map) return "";
    return `<span class="rz-shop-map" tabindex="0" role="note" data-focus-key="shop-map" style="--map:${escape(map.accent)}" aria-label="Map ${map.index}, ${escape(map.name)}. ${escape(map.rule.title)}: ${escape(map.rule.description)}"><i></i><span><b>${escape(map.name)}</b><small>${escape(map.rule.title)}</small></span><div class="rz-shop-map-tooltip"><span class="rz-eyebrow">MAP ${String(map.index).padStart(2, "0")} · ${escape(map.rule.title.toUpperCase())}</span><p>${escape(map.rule.description)}</p><div class="rz-map-lines">${map.lines.map((line) => `<span>${escape(line)}</span>`).join("")}</div></div></span>`;
  }

  private shop(): string {
    const vm = this.current,
      currency = vm.currency ?? 0,
      bag = vm.bag ?? [];
    const all = this.allGear();
    let selected = all.find(
      (item) => String(item.id) === this.selectedEquipment,
    );
    if (!selected) {
      selected = all.find((item) => this.canMerge(item)) ?? all[0];
      this.selectedEquipment = selected ? String(selected.id) : null;
    }
    const offers = vm.offers ?? [];
    const setCounts = this.setCounts();
    const cards = offers
      .map((offer, index) => {
        const level = offer.level ?? 1,
          rank = this.rank(level),
          art = vm.art?.[offer.contentId];
        const insane = offer.rarity === "insane";
        const type =
          offer.kind === "weapon"
            ? insane
              ? "INSANE WEAPON"
              : "WEAPON"
            : offer.kind === "heal"
              ? "REPAIR"
              : ITEMS[offer.contentId as ItemId]?.category === "drone"
                ? "DRONE"
                : ITEMS[offer.contentId as ItemId]?.category === "mod"
                  ? "MOD"
                  : "ITEM";
        const fullHealth =
          offer.kind === "heal" && (vm.hp ?? 0) >= (vm.maxHp ?? 100);
        const blocked =
          offer.canBuy !== undefined
            ? !offer.canBuy
            : offer.sold || offer.cost > currency || fullHealth;
        const statistics =
          offer.kind === "heal"
            ? [offer.description]
            : this.gearStats(offer.contentId, level).slice(0, 2);
        const families = this.gearFamilies(offer.contentId);
        const requiresBag =
          offer.kind !== "heal" &&
          !(
            offer.kind === "weapon" && (vm.inventory?.length ?? 0) < this.slots
          );
        const bagFull = requiresBag && bag.length >= (vm.bagCapacity ?? 12);
        const shortfall = Math.max(0, offer.cost - currency);
        const behavior =
          this.catalog().find((entry) => entry.id === offer.contentId)
            ?.description ?? offer.description;
        const label = offer.sold
          ? "Bought"
          : fullHealth
            ? "Full health"
            : bagFull
              ? "Bag full"
              : shortfall > 0
                ? `Need ${shortfall} more`
                : blocked
                  ? "Unavailable"
                  : offer.kind === "heal"
                    ? "Repair"
                    : "Buy";
        const purchaseLabel = offer.sold
          ? `${offer.title}, bought`
          : `${label}${shortfall > 0 && !fullHealth && !bagFull ? (shortfall === 1 ? " emerald" : " emeralds") : ""}: ${offer.title}, ${offer.cost} emeralds`;
        // A weapon that lands in the bag stays inactive (except for Prism's lattice).
        const willBeActive =
          offer.kind === "item" ||
          (offer.kind === "weapon" &&
            (this.hero.id === "prism" ||
              (vm.inventory?.length ?? 0) < this.slots));
        const reaches = offer.sold
          ? []
          : completesSetTier(families, setCounts, willBeActive);
        const tierFlag = reaches.length
          ? `<span class="rz-set-tier-flag" title="${escape(reaches.map((entry) => `${FAMILIES[entry.family].name} set reaches ${entry.size}`).join(" · "))}">${reaches.map((entry) => `<span style="--family:${FAMILIES[entry.family].color}">${uiIcon(entry.family)}<b>${entry.size}</b></span>`).join("")}</span>`
          : "";
        return `<article class="rz-stock-card rz-rank-${rank.level}${offer.sold ? " is-sold" : blocked ? " is-blocked" : " is-affordable"}${insane ? " is-insane" : ""}${reaches.length ? " is-set-tier" : ""}" style="--rank:${rank.color}"><div class="rz-stock-top">${offer.kind === "heal" ? `<span class="rz-stock-service">${uiIcon("mending")} SERVICE</span>` : insane ? `<span class="rz-insane-badge">Insane</span>` : this.rankBadge(level)}${!offer.sold ? iconButton("lock", offer.locked ? "Stop keeping this offer" : "Keep this offer after reroll", offer.locked ? "lock" : "unlock", String(index), offer.locked) : uiIcon("check")}</div><div class="rz-stock-art">${art ? `<img src="${escape(art)}" alt="" draggable="false"/>` : uiIcon(offer.contentId)}${tierFlag}</div><div class="rz-stock-name"><span>${type}</span><h2>${escape(offer.title)}</h2><span class="rz-stock-info" tabindex="0" role="note" data-focus-key="offer-info:${escape(offer.id)}" aria-label="${escape(behavior)}">${uiIcon("info")}<span class="rz-stock-detail"><strong>${escape(offer.title)}</strong><span>${escape(behavior)}</span>${statistics.map((line) => `<small>${escape(line)}</small>`).join("")}</span></span></div><div class="rz-stock-metrics">${statistics.map((line) => this.metricChip(line)).join("")}</div><div class="rz-family-tags">${families.map((id) => this.familyChip(id)).join("")}</div><button type="button" class="rz-stock-buy" data-action="buy" data-value="${index}" aria-label="${escape(purchaseLabel)}"${blocked ? " disabled" : ""}><span>${label}</span><strong>${offer.sold ? uiIcon("check") : `${uiIcon("coin")} ${offer.cost}`}</strong></button></article>`;
      })
      .join("");
    const handItems = vm.inventory ?? [];
    return `<div class="rz-shop-scrim"></div><header class="rz-workshop-header"><div class="rz-workshop-title"><div><h1>Shop<span>.</span></h1><span class="rz-eyebrow">WAVE ${String(vm.wave ?? 1).padStart(2, "0")} COMPLETE</span></div>${this.shopMapBadge()}</div><div class="rz-workshop-header-actions"><span class="rz-shop-health">${uiIcon("heart")}<strong>${Math.ceil(vm.hp ?? 100)}</strong><small>/ ${Math.ceil(vm.maxHp ?? 100)}</small></span><span class="rz-salvage">${uiIcon("coin")}<strong>${currency}</strong></span>${button("nextWave", "Next wave", { className: "rz-button-primary", icon: "arrow" })}${iconButton("pause", "Pause", "pause")}</div></header><aside class="rz-build-sidebar"><span class="rz-eyebrow">STATS</span><div class="rz-build-stats">${(vm.stats ?? []).map(({ label, description, value }) => `<div title="${escape(description ?? label)}" role="group" aria-label="${escape(`${label}: ${value}${description ? `. ${description}` : ""}`)}"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join("")}</div><div class="rz-build-sets"><span class="rz-eyebrow">SETS</span>${this.synergyBar()}</div>${button("armory", "Game guide", { className: "rz-button-secondary", icon: "armory", value: "weapons" })}</aside><div class="rz-stock-heading"><span class="rz-eyebrow">OFFERS</span>${button("reroll", `Reroll <span class="rz-inline-price">${uiIcon("coin")} ${vm.rerollCost ?? 5}</span>`, { className: "rz-button-reroll", icon: "reroll", disabled: (vm.rerollCost ?? 5) > currency || !offers.some((offer) => !offer.locked || offer.sold) })}</div><section class="rz-stock-grid" aria-label="Shop offers">${cards}</section><section class="rz-inventory-bench"><div class="rz-bench-header"><span class="rz-eyebrow">EQUIPMENT</span>${this.rankGuide()}</div><div class="rz-hands-panel"><div class="rz-panel-label"><span>HANDS</span><b>${handItems.length}/${this.slots}</b></div><div class="rz-hand-cells">${Array.from(
      { length: this.slots },
      (_, slot) =>
        this.gearCell(
          all.find((item) => item.equipped && item.slot === slot),
          slot,
          true,
        ),
    ).join(
      "",
    )}</div></div><div class="rz-bag-panel"><div class="rz-panel-label"><span>BAG <small>ITEMS & DRONES ACTIVE</small></span>${(vm.extraSlots ?? 0) < MAX_EXTRA_SLOTS ? `<button type="button" class="rz-bag-buy" data-action="buySlot" data-focus-key="buy-slot" ${vm.canBuySlot ? "" : "disabled"} aria-label="Buy an extra bag slot for ${BAG_SLOT_COST} emeralds" title="+1 bag slot · up to ${BAG_CAPACITY + MAX_EXTRA_SLOTS} total">+ SLOT ${uiIcon("coin")}${BAG_SLOT_COST}</button>` : `<span class="rz-bag-buy is-max" title="Maximum bag size">MAX SLOTS</span>`}<b>${bag.length}/${vm.bagCapacity ?? 12}</b></div><div class="rz-bag-cells">${Array.from({ length: vm.bagCapacity ?? 12 }, (_, index) => this.gearCell(bag[index], index)).join("")}</div></div></section>${this.gearInspector(selected)}`;
  }

  private catalog(): CatalogEntry[] {
    return [
      ...Object.values(WEAPONS).map((item) => ({
        id: item.id,
        category: "weapon" as const,
        name: item.name,
        description: item.description,
        families: item.families,
      })),
      ...Object.values(ITEMS).map((item) => ({
        id: item.id,
        category: item.category,
        name: item.name,
        description:
          item.category === "passive" || Object.keys(item.passiveStats).length
            ? "Active in your bag."
            : item.description,
        families: item.families,
      })),
    ];
  }

  private armory(): string {
    const vm = this.current;
    const tab =
      GUIDE_TABS.find((entry) => entry.id === this.guideTab) ?? GUIDE_TABS[0];
    const rank = this.rank(this.registryRank);
    const family = (
      this.registryFamily in FAMILIES ? this.registryFamily : "all"
    ) as FamilyId | "all";
    const tabs = GUIDE_TABS.map(
      (entry) =>
        `<button type="button" role="tab" data-action="guideTab" data-value="${entry.id}" class="${entry.id === tab.id ? "is-selected" : ""}" aria-selected="${entry.id === tab.id}" aria-pressed="${entry.id === tab.id}">${uiIcon(entry.icon)}<span>${escape(entry.label)}</span></button>`,
    ).join("");
    const filters = [
      { id: "all", name: "All", color: "#bdd4c5" },
      ...Object.values(FAMILIES),
    ]
      .map(
        (entry) =>
          `<button type="button" data-action="catalogFamily" data-value="${entry.id}" class="${family === entry.id ? "is-selected" : ""}" style="--family:${entry.color}" aria-pressed="${family === entry.id}">${entry.id === "all" ? "" : uiIcon(entry.id)}${escape(entry.name)}</button>`,
      )
      .join("");
    const ranks = RANKS.map(
      (entry) =>
        `<button type="button" class="rz-rank-${entry.level}${entry.level === rank.level ? " is-selected" : ""}" style="--rank:${entry.color}" data-action="catalogRank" data-value="${entry.level}" aria-label="${entry.name}" aria-pressed="${entry.level === rank.level}">${this.rankBadge(entry.level, true)}</button>`,
    ).join("");
    const content = renderGuideTab(
      tab.id,
      { family, rank: rank.level, selected: this.registrySelected },
      {
        icon: uiIcon,
        art: vm.art,
        escape,
        rankBadge: (level) => this.rankBadge(level),
        familyChip: (id) => this.familyChip(id),
        clearedBy: vm.clearedBy,
        heroRecords: vm.heroRecords,
      },
    );
    return `<div class="rz-shop-scrim"></div>${this.header("GAME GUIDE")}<div class="rz-guide-tabs" role="tablist" aria-label="Guide sections">${tabs}</div><div class="rz-armory-filters${tab.usesFamily ? "" : " is-hidden"}" role="group" aria-label="Set filter">${filters}</div><div class="rz-armory-ranks${tab.usesRank ? "" : " is-hidden"}"><span class="rz-eyebrow">${escape(rank.name.toUpperCase())}</span><div role="group" aria-label="Rank selector">${ranks}</div></div><div class="rz-guide-content" data-guide-tab="${tab.id}">${content}</div>`;
  }

  private pause(): string {
    return `<div class="rz-modal-backdrop"></div><section class="rz-modal rz-pause-modal" role="dialog" aria-modal="true" aria-labelledby="rz-pause-title"><h1 id="rz-pause-title">Paused<span>.</span></h1><div class="rz-modal-actions">${button("resume", "Resume", { className: "rz-button-primary", icon: "play" })}${button("settings", "Settings", { className: "rz-button-secondary", icon: "settings" })}${button("home", "End run", { className: "rz-button-quiet" })}${this.current.canExit ? button("exit", "Back to playhouse", { className: "rz-button-quiet" }) : ""}</div><span class="rz-modal-footnote"><kbd>P</kbd> TO RESUME</span></section>`;
  }

  private settings(): string {
    const vm = this.current;
    const setting = (
      action: string,
      title: string,
      icon: string,
      enabled: boolean,
    ) =>
      `<button type="button" class="rz-setting" data-action="${action}" role="switch" aria-checked="${enabled}" aria-label="${title}"><span>${uiIcon(icon)}<strong>${title}</strong></span><span class="rz-setting-state">${enabled ? "On" : "Off"}<i class="rz-toggle${enabled ? " is-on" : ""}"></i></span></button>`;
    return `<div class="rz-modal-backdrop"></div><section class="rz-modal rz-settings-modal" role="dialog" aria-modal="true" aria-labelledby="rz-settings-title"><div class="rz-modal-title"><h1 id="rz-settings-title">Settings<span>.</span></h1>${iconButton("back", "Close settings", "close")}</div><div class="rz-settings-list">${setting("toggleMute", "All sound", "sound", !vm.muted)}${setting("toggleMusic", "Music", "music", vm.music !== false)}${setting("toggleMotion", "Reduced motion", "motion", !!vm.reducedMotion)}</div><div class="rz-controls-reference"><div><span class="rz-eyebrow">MOVE</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><small>or arrow keys</small></span></div><div><span class="rz-eyebrow">DASH</span><kbd>SPACE</kbd></div><div><span class="rz-eyebrow">PAUSE</span><kbd>P</kbd></div></div>${button("back", "Done", { className: "rz-button-primary", icon: "check" })}</section>`;
  }

  private results(): string {
    const vm = this.current;
    const newHero = vm.newUnlock?.hero ? HEROES[vm.newUnlock.hero] : undefined;
    const newMap = vm.newUnlock?.map ? mapById(vm.newUnlock.map) : undefined;
    const hasUnlock = !!(newHero || newMap);
    const victory = !!vm.won && !vm.endless;
    const mapIndex = String(vm.map?.index ?? 1).padStart(2, "0");
    const mapName = vm.map?.name ?? "";
    const overline = victory
      ? `MAP ${mapIndex} CLEARED · ${vm.totalWaves ?? CAMPAIGN_WAVES} WAVES`
      : vm.endless
        ? `ENDLESS · ${mapName.toUpperCase()}`
        : `${this.hero.name.toUpperCase()} · MAP ${mapIndex}`;
    const badges = hasUnlock
      ? `<div class="rz-results-unlocks">${
          newHero
            ? `<div class="rz-unlock-badge is-hero" style="--unlock:${newHero.color}">${uiIcon(newHero.weapon)}<div><span class="rz-eyebrow">CHARACTER UNLOCKED</span><strong>${escape(newHero.name)}</strong></div>${uiIcon("unlock")}</div>`
            : ""
        }${
          newMap
            ? `<div class="rz-unlock-badge is-map" style="--unlock:${this.mapAccent(newMap.id)}"><i class="rz-unlock-swatch"></i><div><span class="rz-eyebrow">MAP ${String(newMap.id).padStart(2, "0")} UNLOCKED</span><strong>${escape(newMap.name)}</strong></div>${uiIcon("unlock")}</div>`
            : ""
        }</div>`
      : "";
    const actions = victory
      ? [
          newMap
            ? button("nextMap", "Next map", {
                className: "rz-button-primary",
                icon: "arrow",
              })
            : "",
          button("endless", "Play endless", {
            className: newMap ? "rz-button-secondary" : "rz-button-primary",
            icon: "infinity",
          }),
          button("retry", "Play again", {
            className: "rz-button-secondary",
            icon: "reroll",
          }),
          button("home", "Home", { className: "rz-button-secondary" }),
        ]
      : [
          button("retry", "Try again", {
            className: "rz-button-primary",
            icon: "reroll",
          }),
          button("home", "Home", { className: "rz-button-secondary" }),
        ];
    return `<div class="rz-results-backdrop"></div><section class="rz-results${hasUnlock ? " has-unlock" : ""}${victory ? " is-victory" : ""}"><span class="rz-overline"><i></i>${escape(overline)}</span><h1>${victory ? "Victory" : "Run ended"}<span>.</span></h1><div class="rz-results-rule"></div><div class="rz-result-stats"><div><span class="rz-eyebrow">WAVE</span><strong>${String(vm.wave ?? 1).padStart(2, "0")}<small>${vm.endless ? "/∞" : `/${vm.totalWaves ?? CAMPAIGN_WAVES}`}</small></strong></div><div><span class="rz-eyebrow">ENEMIES DEFEATED</span><strong>${vm.kills ?? 0}</strong></div><div><span class="rz-eyebrow">BEST WAVE</span><strong>${String(vm.bestWave ?? vm.wave ?? 1).padStart(2, "0")}</strong></div><div><span class="rz-eyebrow">RUN TIME</span><strong>${this.formatTime(vm.runTime ?? 0)}</strong></div><div><span class="rz-eyebrow">FULL CLEARS</span><strong>${vm.fullClears ?? 0}<small>/${vm.endless ? "∞" : (vm.totalWaves ?? CAMPAIGN_WAVES)}</small></strong></div><div><span class="rz-eyebrow">EMERALDS EARNED</span><strong>${vm.earned ?? 0}</strong></div></div>${this.resultLoadout()}${badges}<div class="rz-results-actions">${actions.join("")}</div></section>`;
  }

  private resultLoadout(): string {
    const vm = this.current;
    const items = [...(vm.inventory ?? []), ...(vm.bag ?? [])];
    if (!items.length) return "";
    const cells = items
      .map((item) => {
        const insane = this.isInsane(item.kind);
        const label = `${this.gearName(item)}, ${insane ? "insane" : this.rank(item.level).name}`;
        return `<div class="rz-hand-hud rz-rank-${item.level}${insane ? " is-insane" : ""}" style="--rank:${this.rank(item.level).color}" title="${escape(label)}" aria-label="${escape(label)}">${uiIcon(item.kind)}${insane ? `<span class="rz-insane-badge is-compact">!</span>` : this.rankBadge(item.level, true)}</div>`;
      })
      .join("");
    return `<div class="rz-result-loadout" aria-label="Final loadout"><span class="rz-eyebrow">FINAL LOADOUT</span><div>${cells}</div></div>`;
  }
}
