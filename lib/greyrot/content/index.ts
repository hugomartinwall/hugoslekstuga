/**
 * The content barrel. Import from here, not from the individual tables, so a
 * table can be split later without touching call sites.
 *
 * Content is pure data (`CLAUDE.md` §6). The architecture guard asserts this
 * directory imports no renderer, touches no DOM, and calls no `Math.random` —
 * the simulation depends on it, so §4's determinism guarantees extend here.
 */

export * from "./types";
export { FOES, FOE_IDS, foeKind } from "./foes";
export type { FoeAi, FoeKind } from "./foes";
export { INTERACTIONS, STATUSES, STATUS_IDS, interactionFor } from "./statuses";
export type { Interaction } from "./statuses";
export {
  CASTABLES,
  ELEMENT_PROFILE,
  FOUND_WEAVE_BIT,
  NOTABLE,
  PATCH_REACTION,
  PATCH_SLIP,
  PATCH_STATUS,
  PATCH_TICKS,
  PRECEDENCE,
  QUEUE_MAX,
  encodeFound,
  foundHas,
} from "./spells";
export type { Castable, CastForm, ElementProfile, NotableMix, PatchKind } from "./spells";
export { MIX_COUNT, MIX_KEYS, mixIndex, mixKey } from "./mixes";
export {
  CHAPTERS,
  DEFAULT_ARENA,
  STAGES,
  captiveHoldStage,
  chapterOfStage,
  foundBitsThroughStage,
  isChapterEnd,
  stageBiome,
} from "./stages";
export type {
  ChapterDef,
  StageCaptive,
  StageDef,
  StageFoe,
  StageHut,
  StageMarker,
  StageWater,
} from "./stages";
export { BIOMES } from "./biomes";
export type { BiomeProfile } from "./biomes";
