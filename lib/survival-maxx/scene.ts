import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { interpolatedPosition } from "./motion";
import { poseHeldWeapon, weaponRecovery, weaponScale } from "./weapon-pose";
import { ProjectileRenderer, type ProjectileContext } from "./projectiles";
import { MUZZLE_FLASH, flashClassFor, glowTexture } from "./projectile-art";
import {
  box,
  cylinder,
  orb,
  torus,
  bake,
  material,
  glowMaterial,
  makeHero,
  makeEnemy,
  makeEquipment,
  equipmentPortraits,
  animateRig,
  COLORS,
  type Rig,
} from "./meshes";
import type { SurvivalRun, GameEvent, EventKind, Bullet, Enemy } from "./model";
import {
  HEROES,
  WEAPONS,
  ITEMS,
  CAMPAIGN_WAVES,
  MAPS,
  ENEMY_STATS,
  type HeroId,
  type EnemyKind,
  type WeaponId,
  type FamilyId,
  type MapDefinition,
  type MapPalette,
  type MapDecoration,
} from "./content";

/** The simulation's pending-spawn marker, typed locally so this file compiles before model.ts exposes it. */
interface SpawnMarker {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  age: number;
  delay: number;
  budgeted: boolean;
  elite: boolean;
  horde: boolean;
  radius: number;
}
type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  /** Velocity damping per second. */
  drag: number;
  /** Tumble rate multiplier. */
  spin: number;
  /** Spiral around a centre instead of flying ballistically. */
  orbit?: { cx: number; cz: number; angle: number; radius: number; rate: number; shrink: number };
};
type ParticleOptions = {
  /** Emission direction in the sim's XZ angle; scattered everywhere when unset. */
  direction?: number;
  /** Half-angle of the emission cone, radians. */
  spread?: number;
  /** Start out along the cone and fly back into the origin. */
  inward?: boolean;
  drag?: number;
  gravity?: number;
  /** Mean lifetime, seconds. */
  life?: number;
  /** Extra upward velocity. */
  lift?: number;
  spin?: number;
  /** Spawn on a circle of this radius around the origin. */
  radius?: number;
};
/** Everything a fused or deployed bullet keeps around itself between frames. */
type BulletFx = {
  kind: "well" | "hum" | "base";
  group: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  timer: number;
  eclipse: boolean;
  /** Fused well floor growth, 0..1. */
  grow: number;
};
/** A shell lobbed on a parabola from a muzzle to a strike point. */
type Lob = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toZ: number;
  age: number;
  duration: number;
  smoke: number;
  weapon: WeaponId | "enemy";
  color: number;
};
/** Status ring, elite ring and the slow emitter timers for one enemy. */
type StatusFx = {
  group: THREE.Group;
  status: THREE.Mesh;
  elite: THREE.Mesh;
  materials: THREE.MeshBasicMaterial[];
  emit: number;
};
/** Per-batch state shared by the event handlers. */
type EventBatch = { arcOrigins: Set<number> };
/** A pull well the enemy loop leans rigs toward this frame. */
type Well = { x: number; y: number; radius: number; eclipse: boolean };
const WHITE = 0xffffff;
const MAGENTA = 0xff3df0;
const CYAN = 0x8ef2ff;
const ICE = 0x9eeaff;
const EMBER = 0xff9b48;
const SPORE = 0xabe477;
const SMOKE = 0x8f8780;
const DUST = 0x9f8b73;
const STATUS_COLOR = { frozen: 0x9eeaff, burn: 0xff8a3a, poison: 0x8be07a, slow: 0x87dbfa };
const heroTint = (hero: HeroId) => COLORS[hero] ?? 0xffd18e;
/** The family a weapon's hit feedback follows: its first family, kinetic for enemy shots. */
const familyOf = (weapon: GameEvent["weapon"]): FamilyId =>
  weapon && weapon !== "enemy" && weapon in WEAPONS
    ? (WEAPONS[weapon].families[0] ?? "kinetic")
    : "kinetic";
const weaponColor = (weapon: GameEvent["weapon"]) =>
  weapon && weapon !== "enemy" && weapon in WEAPONS
    ? Number(WEAPONS[weapon].color.replace("#", "0x"))
    : 0xffd18e;
const scratchFrom = new THREE.Vector3();
const scratchTo = new THREE.Vector3();
const scratchMid = new THREE.Vector3();
type Flash = {
  object: THREE.Sprite | THREE.Mesh;
  material: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
  cone: boolean;
  life: number;
  max: number;
  size: number;
};
/** One colour object per particle tint; particles never mutate theirs. */
const particleColors = new Map<number, THREE.Color>();
const particleColor = (hex: number) => {
  let c = particleColors.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    particleColors.set(hex, c);
  }
  return c;
};
const muzzleScratch = new THREE.Vector3();
type Ring = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  radius: number;
  start: number;
  /** Scale from `start` to `radius` over the life; false keeps the placed scale. */
  animate: boolean;
  opacity: number;
};
type FloatLabel = {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  z: number;
};
const lerp = THREE.MathUtils.lerp;
const scratch = new THREE.Object3D();
const color = new THREE.Color();
const tintA = new THREE.Color();
const tintB = new THREE.Color();
/** 0xRRGGBB as a CSS colour, for canvas fills. */
const cssHex = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;
/** Scale a colour's brightness; clamps to the sRGB range. */
const shade = (hex: number, factor: number) =>
  tintA.setHex(hex).multiplyScalar(factor).getHex();
/** Blend two colours, t = 0 keeps the first. */
const mixHex = (a: number, b: number, t: number) =>
  tintA.setHex(a).lerp(tintB.setHex(b), t).getHex();
/** Outer decoration ring: 16 posts at r = 21.3, spires on a wider ring of 12. */
const ringSlots = (decoration: MapDecoration) =>
  decoration === "spires"
    ? { count: 12, radius: 22 }
    : { count: 16, radius: 21.3 };
let portraitCache: Record<string, string> | undefined;
export class SurvivalScene {
  private viewportWidth = 1;
  private viewportHeight = 1;
  private resizeObserver: ResizeObserver;
  renderer: THREE.WebGLRenderer;
  keyLight: THREE.DirectionalLight;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-23, 23, 13, -13, 0.1, 130);
  arena = new THREE.Group();
  stage = new THREE.Group();
  actors = new THREE.Group();
  fx = new THREE.Group();
  player: Rig;
  preview: Rig;
  heroId: HeroId = "ember";
  heroRigs = new Map<HeroId, { player: Rig; preview: Rig }>();
  enemies = new Map<number, Rig>();
  enemyPools = new Map<string, Rig[]>();
  drones = new Map<number, THREE.Group>();
  heldWeapons = new Map<number, THREE.Group>();
  weaponMotion = new Map<number, number>();
  hazardMeshes = new Map<number, THREE.Group>();
  spawnMarkerMeshes = new Map<number, THREE.Group>();
  /** The map whose arena is built; the menu diorama always uses MAPS[0]'s palette. */
  map: MapDefinition = MAPS[0];
  hemiLight: THREE.HemisphereLight;
  rimLight: THREE.DirectionalLight;
  lampLight: THREE.PointLight;
  enemyAuras = new Map<number, THREE.Mesh>();
  equipmentPool = new Map<string, THREE.Group[]>();
  /** Equipment portraits are rendered once per page and shared by every scene. */
  art: Record<string, string>;
  projectiles = new ProjectileRenderer(this.actors);
  projectileContext: ProjectileContext = {
    alpha: 1,
    time: 0,
    dt: 0,
    cameraQuaternion: new THREE.Quaternion(),
    reducedMotion: false,
    muzzleWorld: (ownerId, out) => this.muzzleWorld(ownerId, out),
    isDrone: (ownerId) => this.drones.has(ownerId),
    puff: (x, y, z, col, size, life) =>
      this.spawnParticles(x, y, z, 1, col, 0.6, size, {
        drag: 2.5,
        gravity: 0,
        life,
        lift: 0.5,
        spin: 0.4,
      }),
  };
  /** Pooled additive muzzle discs and cones; at most 24 alive. */
  flashes: Flash[] = [];
  flashPool: Flash[] = [];
  flashConeGeometry = new THREE.ConeGeometry(0.5, 1, 8, 1, true)
    .translate(0, -0.5, 0)
    .rotateX(-Math.PI / 2);
  pickupMeshes = new Map<number, THREE.Mesh>();
  telegraphs = new Map<number, THREE.Mesh>();
  telegraphMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7658,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  auraMaterial = new THREE.MeshBasicMaterial({
    color: 0x84cde9,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  medicAuraMaterial = new THREE.MeshBasicMaterial({
    color: 0xb4e397,
    transparent: true,
    opacity: 0.33,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  aimGeometry = new THREE.PlaneGeometry(0.045, 23).translate(0, 11.5, 0);
  chargeGeometry = new THREE.ShapeGeometry(
    new THREE.Shape([
      new THREE.Vector2(-0.1, 0),
      new THREE.Vector2(0.1, 0),
      new THREE.Vector2(0.1, 2.7),
      new THREE.Vector2(0.45, 2.7),
      new THREE.Vector2(0, 3.3),
      new THREE.Vector2(-0.45, 2.7),
      new THREE.Vector2(-0.1, 2.7),
    ]),
  );
  particles: Particle[] = [];
  particleMesh: THREE.InstancedMesh;
  rings: Ring[] = [];
  labels: FloatLabel[] = [];
  labelTextures = new Map<string, THREE.CanvasTexture>();
  time = 0;
  shake = 0;
  damageFlash = 0;
  healthBack = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x101b21,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    }),
    160,
  );
  healthFill = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    160,
  );
  shieldFill = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x88d5fa,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
    160,
  );
  viewSize = 8;
  menu = true;
  screen = "home";
  reducedMotion = false;
  lastFoot = 0;
  lastDash = 0;
  ambient: THREE.Points;
  previewFloor: THREE.Group;
  previewHalo?: THREE.Mesh;
  selectionRing: THREE.Mesh;
  cameraTarget = new THREE.Vector3(0, 1.1, 0);
  camPosition = new THREE.Vector3(0, 5.5, 11);
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  point = new THREE.Vector3();
  pickupGeometry = new THREE.OctahedronGeometry(0.2);
  hazardDisc = new THREE.CircleGeometry(1, 48);
  ringGeometry = new THREE.RingGeometry(0.91, 1, 64);
  /** Heavier ring for elite spawn marks. */
  thickRingGeometry = new THREE.RingGeometry(0.84, 1, 64);
  /** Filled ground disc for flashes and the well's dark floor. */
  discGeometry = new THREE.CircleGeometry(1, 40);
  /** Unit bolt segment: radius 1, spanning z = 0..1 so lookAt + scale.z = length. */
  segmentGeometry = new THREE.CylinderGeometry(1, 1, 1, 5, 1)
    .rotateX(Math.PI / 2)
    .translate(0, 0, 0.5);
  /** Blade sweep: a partial ring, placed by rotation and scale. */
  sweepGeometry = new THREE.RingGeometry(0.56, 0.84, 36, 1, -0.92, 1.84);
  bubbleGeometry = new THREE.SphereGeometry(1, 20, 14);
  shardGeometry = new THREE.OctahedronGeometry(0.16);
  shellGeometry = new THREE.SphereGeometry(0.17, 8, 6);
  /** Geometries the ring list may reference; anything else it holds gets disposed with the ring. */
  sharedGeometries = new Set<THREE.BufferGeometry>([
    this.ringGeometry,
    this.thickRingGeometry,
    this.hazardDisc,
    this.discGeometry,
    this.segmentGeometry,
    this.sweepGeometry,
  ]);
  /** Pooled ring/bolt/disc materials, keyed by blending; nothing is allocated per event once warm. */
  materialPool: { normal: THREE.MeshBasicMaterial[]; additive: THREE.MeshBasicMaterial[] } = {
    normal: [],
    additive: [],
  };
  /** Rings, bolts and discs share one capped list. */
  static readonly RING_CAP = 160;
  static readonly PARTICLE_CAP = 850;
  bulletFx = new Map<number, BulletFx>();
  statusRings = new Map<number, StatusFx>();
  shieldBubbles = new Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>();
  lobs: Lob[] = [];
  lobPool: Lob[] = [];
  playerBubble: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  barrierShards: THREE.Mesh[] = [];
  abilityRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  bloodRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Wells the enemy loop leans rigs toward; rebuilt every frame. */
  wells: Well[] = [];
  /** Seconds left on the camera view punch (Eclipse collapse). */
  punch = 0;
  viewPunch = 0;
  lastEmber = 0;
  glows: THREE.Sprite[] = [];
  constructor(private container: HTMLElement) {
    this.art = portraitCache ??= equipmentPortraits();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.setSize(
      Math.max(1, container.clientWidth),
      Math.max(1, container.clientHeight),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const environment = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.environmentRotation.y = 0.45;
    environment.dispose();
    pmrem.dispose();
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x161c23);
    this.scene.fog = new THREE.FogExp2(0x161c23, 0.014);
    this.hemiLight = new THREE.HemisphereLight(0xcbdcea, 0x30353b, 1.75);
    this.scene.add(this.hemiLight);
    const key = (this.keyLight = new THREE.DirectionalLight(0xfff1db, 3.3));
    key.position.set(-12, 24, 15);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -24;
    key.shadow.camera.right = 24;
    key.shadow.camera.top = 24;
    key.shadow.camera.bottom = -24;
    key.shadow.camera.far = 70;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 2;
    key.shadow.bias = -0.0002;
    this.scene.add(key, key.target);
    const rim = (this.rimLight = new THREE.DirectionalLight(0x8dc9e9, 1.2));
    rim.position.set(8, 7, -16);
    this.scene.add(rim);
    const lamp = (this.lampLight = new THREE.PointLight(0xff7b40, 15, 18, 2));
    lamp.position.set(0, 6, -8);
    this.scene.add(lamp);
    this.scene.add(this.arena, this.stage, this.actors, this.fx);
    this.healthBack.count = this.healthFill.count = 0;
    this.healthBack.frustumCulled = this.healthFill.frustumCulled = false;
    this.healthBack.renderOrder = 20;
    this.healthFill.renderOrder = 21;
    this.healthBack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.healthFill.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shieldFill.count = 0;
    this.shieldFill.frustumCulled = false;
    this.shieldFill.renderOrder = 22;
    this.shieldFill.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.actors.add(this.healthBack, this.healthFill, this.shieldFill);
    this.makeArena(this.map);
    this.previewFloor = this.makeStage();
    this.player = makeHero("ember");
    this.actors.add(this.player.root);
    this.preview = makeHero("ember");
    this.preparePreview(this.preview, "ember");
    this.heroRigs.set("ember", { player: this.player, preview: this.preview });
    this.stage.add(this.preview.root);
    this.preview.root.position.set(3, 0, 0);
    this.preview.root.scale.setScalar(this.previewScale(this.preview));
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb467,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.selectionRing = new THREE.Mesh(this.ringGeometry, ringMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.scale.setScalar(0.8);
    this.selectionRing.position.y = 0.035;
    this.actors.add(this.selectionRing);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.12, 0),
      particleMat,
      900,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.fx.add(this.particleMesh);
    this.playerBubble = this.makePlayerBubble();
    this.abilityRing = this.makeAuraRing(this.thickRingGeometry, CYAN, 0.55);
    this.bloodRing = this.makeAuraRing(this.thickRingGeometry, 0x9b1030, 0.6);
    const positions = new Float32Array(240 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (Math.random() - 0.5) * 70;
      positions[i + 1] = Math.random() * 7 + 0.5;
      positions[i + 2] = (Math.random() - 0.5) * 70;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.ambient = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xe5bb89,
        size: 0.045,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    this.scene.add(this.ambient);
    this.applyPalette(this.map.palette);
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }
  resize() {
    this.viewportWidth = Math.max(1, this.container.clientWidth);
    this.viewportHeight = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.viewportWidth, this.viewportHeight);
    this.updateProjection();
  }
  updateProjection() {
    const aspect = this.viewportWidth / this.viewportHeight;
    // The view punch (Eclipse collapse) briefly tightens the frame.
    const size = this.viewSize - (this.viewPunch || 0);
    this.camera.left = (-size * aspect) / 2;
    this.camera.right = (size * aspect) / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
  }
  setScreen(screen: string, hero: HeroId) {
    this.screen = screen;
    this.menu =
      screen === "home" || screen === "characters" || screen === "settings";
    if (hero !== this.heroId) {
      this.heroId = hero;
      this.player.root.removeFromParent();
      this.preview.root.removeFromParent();
      if (!this.heroRigs.has(hero))
        this.heroRigs.set(hero, {
          player: makeHero(hero),
          preview: makeHero(hero),
        });
      const rigs = this.heroRigs.get(hero)!;
      this.player = rigs.player;
      this.preview = rigs.preview;
      this.preparePreview(this.preview, hero);
      this.actors.add(this.player.root);
      this.stage.add(this.preview.root);
      this.preview.root.position.set(3, 0, 0);
      this.preview.root.scale.setScalar(this.previewScale(this.preview));
    }
    if (this.previewHalo)
      (this.previewHalo.material as THREE.MeshBasicMaterial).color.setHex(
        COLORS[hero],
      );
    this.configureLighting();
    // The menu diorama keeps the Foundry look whichever map is queued up.
    this.applyPalette(this.menu ? MAPS[0].palette : this.map.palette);
    this.arena.visible = !this.menu;
    this.actors.visible = !this.menu;
    this.stage.visible = this.menu;
    this.fx.visible = !this.menu;
  }
  /** Recolour the sky, fog, lamps and dust; the arena meshes come from makeArena. */
  applyPalette(p: MapPalette) {
    if (this.scene.background instanceof THREE.Color)
      this.scene.background.setHex(p.background);
    else this.scene.background = new THREE.Color(p.background);
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.setHex(p.fog);
      fog.density = p.fogDensity;
    } else this.scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    this.hemiLight.color.setHex(p.sky);
    this.hemiLight.groundColor.setHex(p.groundLight);
    // The backlight borrows the sky tone, dimmed so it lands at the old 0x8dc9e9 rim's brightness.
    this.rimLight.color.setHex(p.sky);
    this.rimLight.intensity = 1.0;
    this.lampLight.color.setHex(p.lamp);
    (this.ambient.material as THREE.PointsMaterial).color.setHex(p.dust);
  }
  /** Swap the arena for another map's. Cheap when the map is unchanged. */
  setMap(map: MapDefinition) {
    if (map.key === this.map.key) return;
    this.disposeArena();
    this.map = map;
    this.makeArena(map);
    if (!this.menu) this.applyPalette(map.palette);
  }
  private disposeArena() {
    this.arena.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.Material & {
        map?: THREE.Texture | null;
        vertexColors?: boolean;
      };
      if (object.userData.owned) {
        object.geometry.dispose();
        material.map?.dispose();
        material.dispose();
      } else if (material.vertexColors) {
        // A baked merge owns its geometry; the shared vertex-colour material stays.
        object.geometry.dispose();
      }
      // Anything else (glow lamps) uses the cached geometry/material pools.
    });
    this.arena.clear();
  }
  private configureLighting() {
    const key = this.keyLight;
    const extent = this.menu ? 5.8 : 24;
    key.shadow.camera.left = key.shadow.camera.bottom = -extent;
    key.shadow.camera.right = key.shadow.camera.top = extent;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = this.menu ? 30 : 70;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.normalBias = this.menu ? 0.009 : 0.025;
    key.shadow.bias = this.menu ? -0.00006 : -0.0002;
    key.shadow.radius = this.menu ? 2.5 : 1.4;
    key.intensity = this.menu ? 3.0 : 3.3;
    key.position.set(
      this.menu ? -3 : -12,
      this.menu ? 10 : 24,
      this.menu ? 8 : 15,
    );
    key.target.position.set(this.menu ? 3 : 0, this.menu ? 1.5 : 0, 0);
    key.target.updateMatrixWorld();
    this.scene.environmentIntensity = this.menu ? 0.72 : 0.45;
  }
  worldPoint(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((clientY - rect.top) / rect.height) * 2,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, this.point)
      ? { x: this.point.x, y: this.point.z }
      : null;
  }
  private groundTexture(palette: MapPalette) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const c = canvas.getContext("2d")!;
    // The darker tile, grid line and bolt heads take the slab tone at a low alpha.
    const slab = cssHex(palette.slab);
    c.fillStyle = palette.ground;
    c.fillRect(0, 0, 1024, 1024);
    let seed = 24;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 12000; i++) {
      const x = random() * 1024,
        y = random() * 1024;
      c.fillStyle = i % 3 ? `${palette.groundLine}09` : `${slab}15`;
      c.fillRect(x, y, random() * 3 + 0.6, random() * 2 + 0.4);
    }
    for (let y = 0; y < 1024; y += 128) {
      for (let x = 0; x < 1024; x += 128) {
        c.fillStyle =
          ((x + y) / 128) % 2 ? `${palette.groundTile}25` : `${slab}20`;
        c.fillRect(x + 3, y + 3, 122, 122);
        c.strokeStyle = `${palette.groundLine}1b`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + 5, y + 124);
        c.lineTo(x + 5, y + 5);
        c.lineTo(x + 124, y + 5);
        c.stroke();
        for (const bx of [x + 10, x + 118]) {
          c.fillStyle = `${slab}70`;
          c.fillRect(bx - 1, y + 10, 2, 2);
          c.fillRect(bx - 1, y + 117, 2, 2);
        }
      }
    }
    c.strokeStyle = `${slab}70`;
    c.lineWidth = 3;
    for (let x = 0; x <= 1024; x += 128) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 1024);
      c.stroke();
      c.beginPath();
      c.moveTo(0, x);
      c.lineTo(1024, x);
      c.stroke();
    }
    c.strokeStyle = `${palette.groundLine}10`;
    c.lineWidth = 1;
    for (let i = 0; i < 50; i++) {
      const x = random() * 1024,
        y = random() * 1024;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + random() * 30, y + random() * 7);
      c.stroke();
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  /** Build the arena for a map. Meshes tagged `owned` are disposed by setMap; the rest share cached pools. */
  makeArena(map: MapDefinition) {
    const palette = map.palette;
    const { slab, edge, trim, accent } = palette;
    const stripe = shade(accent, 0.84);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(36, 0.65, 36),
      new THREE.MeshStandardMaterial({
        map: this.groundTexture(palette),
        roughness: 0.94,
        metalness: 0.08,
      }),
    );
    floor.position.y = -0.35;
    floor.receiveShadow = true;
    floor.userData.owned = true;
    this.arena.add(floor);
    const lower = new THREE.Group();
    box(lower, [40, 0.6, 40], [0, -1.05, 0], slab, 0.05);
    box(lower, [38, 0.08, 38], [0, -0.72, 0], edge, 0.02);
    bake(lower);
    this.arena.add(lower);
    const trimGroup = new THREE.Group();
    for (const sign of [-1, 1]) {
      box(trimGroup, [35, 0.04, 0.07], [0, 0.018, sign * 16.8], trim, 0.02);
      box(trimGroup, [0.07, 0.04, 35], [sign * 16.8, 0.018, 0], trim, 0.02);
      for (let n = -16; n <= 16; n += 4) {
        box(trimGroup, [1, 0.07, 0.09], [n, 0.018, sign * 17.65], accent);
        box(trimGroup, [0.09, 0.07, 1], [sign * 17.65, 0.018, n], accent);
        box(trimGroup, [1.65, 0.08, 0.8], [n, -0.03, sign * 18.2], 0x4c5558);
        box(trimGroup, [0.8, 0.08, 1.65], [sign * 18.2, -0.03, n], 0x4c5558);
      }
    }
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      g.rotation.y = (i * Math.PI) / 2;
      for (let j = 0; j < 5; j++) {
        const s = box(
          g,
          [1.5, 0.015, 0.18],
          [-3 + j * 1.5, 0.011, 15.7],
          stripe,
          0.001,
        );
        s.rotation.y = 0.5;
      }
      trimGroup.add(g);
    }
    bake(trimGroup);
    this.arena.add(trimGroup);
    const center = new THREE.Group();
    cylinder(center, 4.6, 0.04, [0, 0.016, 0], 0x354045, 64);
    torus(center, 4.38, 0.032, [0, 0.05, 0], 0x606968).rotation.x = Math.PI / 2;
    torus(center, 4.13, 0.028, [0, 0.06, 0], shade(trim, 0.84)).rotation.x =
      Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const panel = box(
        center,
        [0.1, 0.04, 0.9],
        [Math.cos(a) * 4.1, 0.07, Math.sin(a) * 4.1],
        shade(trim, 0.94),
      );
      panel.rotation.y = -a + Math.PI / 2;
    }
    bake(center);
    this.arena.add(center);
    const markCanvas = document.createElement("canvas");
    markCanvas.width = 512;
    markCanvas.height = 256;
    const cc = markCanvas.getContext("2d")!;
    cc.font = "900 132px Arial";
    cc.textAlign = "center";
    cc.fillStyle = cssHex(accent);
    cc.globalAlpha = 0.19;
    cc.fillText("MAXX", 256, 170);
    const texture = new THREE.CanvasTexture(markCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 3.5),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.055, 0);
    mark.userData.owned = true;
    this.arena.add(mark);
    const scenery = new THREE.Group();
    this.decorateRing(scenery, map.decoration, palette);
    bake(scenery);
    this.arena.add(scenery);
    const worldFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshStandardMaterial({
        color: mixHex(
          palette.background,
          Number(palette.ground.replace("#", "0x")),
          0.22,
        ),
        roughness: 1,
      }),
    );
    worldFloor.rotation.x = -Math.PI / 2;
    worldFloor.position.y = -1.6;
    worldFloor.receiveShadow = true;
    worldFloor.userData.owned = true;
    this.arena.add(worldFloor);
  }
  /** The ring of props outside the playfield; each map picks one silhouette family. */
  private decorateRing(
    scenery: THREE.Group,
    decoration: MapDecoration,
    palette: MapPalette,
  ) {
    const { trim, accent, edge, lamp } = palette;
    const glow = mixHex(lamp, 0xffffff, 0.22);
    const post = shade(accent, 0.975);
    const { count, radius } = ringSlots(decoration);
    for (let i = 0; i < count; i++) {
      const a = (i * Math.PI * 2) / count;
      const p = new THREE.Group();
      p.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      p.rotation.y = -a;
      if (decoration === "pylons") {
        box(p, [1.55, 2.3, 1.65], [0, 0.65, 0], 0x313b41, 0.1);
        box(p, [1.65, 0.26, 1.75], [0, 1.85, 0], 0x718082, 0.07);
        box(p, [0.75, 0.14, 1.75], [0, 2.05, 0], post);
        for (let j = 0; j < 3; j++)
          box(p, [0.1, 0.09, 1.76], [-0.5 + j * 0.5, 1.95, 0], 0x2b343b);
        cylinder(p, 0.45, 1.5, [0, 2.3, 0], 0x3a474e, 8);
        if (i % 2) {
          const gl = box(p, [0.55, 0.35, 0.1], [0, 1.4, 0.86], edge);
          gl.material = glowMaterial(glow);
        }
      } else if (decoration === "barricades") {
        box(p, [2.6, 0.55, 0.7], [0, 0.27, 0], 0x4c5558, 0.08);
        box(p, [2.7, 0.1, 0.8], [0, 0.6, 0], trim, 0.03);
        box(p, [1.1, 0.12, 0.72], [0, 0.66, 0], post, 0.02);
        for (const side of [-1, 1])
          box(p, [0.18, 0.75, 0.18], [side * 1.2, 0.37, 0.2], 0x2b343b, 0.03);
        if (i % 3 === 0) {
          const crate = box(
            p,
            [0.7, 0.7, 0.7],
            [0.55, 1.02, -0.15],
            0x5f564d,
            0.06,
          );
          crate.rotation.y = 0.35;
        }
      } else if (decoration === "vents") {
        box(p, [1.7, 0.45, 1.7], [0, 0.22, 0], 0x313b41, 0.08);
        for (let j = 0; j < 5; j++)
          box(p, [0.12, 0.08, 1.5], [-0.6 + j * 0.3, 0.48, 0], 0x2b343b);
        box(p, [1.8, 0.06, 0.16], [0, 0.48, -0.8], trim, 0.02);
        cylinder(p, 0.22, 1.1, [0.55, 0.9, 0.6], 0x445055, 8);
        const gl = box(p, [0.5, 0.18, 0.1], [0, 0.32, 0.86], edge);
        gl.material = glowMaterial(glow);
      } else if (decoration === "spires") {
        box(p, [1.1, 0.5, 1.1], [0, 0.25, 0], 0x313b41, 0.08);
        cylinder(p, 0.32, 5.6, [0, 3.2, 0], 0x3a474e, 8, 0.18);
        box(p, [0.7, 0.14, 0.7], [0, 2.4, 0], trim, 0.02);
        box(p, [0.5, 0.1, 0.5], [0, 4.4, 0], post, 0.02);
        orb(p, 0.2, [0, 6.15, 0], glow, true);
      } else {
        // ruins: pylon stumps, a fallen cap on alternate slots and scattered rubble.
        const height = 0.8 + (i % 3) * 0.45;
        const stump = box(
          p,
          [1.55, height, 1.65],
          [0, height / 2 - 0.1, 0],
          0x313b41,
          0.1,
        );
        stump.rotation.z = i % 2 ? 0.06 : -0.09;
        if (i % 2) {
          const cap = box(
            p,
            [1.65, 0.26, 1.75],
            [1.4, 0.15, 0.6],
            0x718082,
            0.07,
          );
          cap.rotation.set(0.15, 0.4, 0.5);
        } else box(p, [0.75, 0.14, 1.4], [0, height - 0.05, 0], post);
        for (let k = 0; k < 4; k++) {
          const rubble = box(
            p,
            [0.35 + k * 0.12, 0.25, 0.3],
            [-1 + k * 0.7, 0.12, 1.1 + (k % 2) * 0.3],
            k % 2 ? 0x44484a : 0x2b343b,
            0.04,
          );
          rubble.rotation.y = k * 0.9 + i;
        }
        if (i % 4 === 0) {
          const ember = box(p, [0.3, 0.12, 0.3], [-0.3, 0.06, -0.9], edge);
          ember.material = glowMaterial(glow);
        }
      }
      bake(p);
      scenery.add(p);
    }
    for (const side of [-1, 1]) {
      if (decoration === "pylons" || decoration === "vents")
        for (let i = 0; i < 7; i++) {
          const pipe = cylinder(
            scenery,
            0.3,
            5,
            [side * 20.4, 0.2, -16 + i * 5.1],
            0x445055,
            10,
          );
          pipe.rotation.x = Math.PI / 2;
        }
      const crates = decoration === "barricades" ? 14 : 10;
      for (let i = 0; i < crates; i++) {
        const size = 0.8 + (i % 3) * 0.43;
        const c = box(
          scenery,
          [size, 0.7 + (i % 4) * 0.3, size],
          [side * (24 + (i % 3)), -0.1, -22 + (i * 50) / crates],
          i % 2 ? 0x44484a : 0x5f564d,
        );
        c.rotation.y = i * 0.75;
      }
    }
  }
  makeStage() {
    const group = new THREE.Group();
    group.position.set(3, 0, 0);
    cylinder(group, 2.34, 0.25, [0, -0.2, 0], 0x121d27, 96);
    cylinder(group, 2.24, 0.1, [0, -0.04, 0], 0x39474e, 96);
    cylinder(group, 2.06, 0.014, [0, 0.02, 0], 0x26363d, 96);
    const rim = torus(group, 2.26, 0.014, [0, -0.035, 0], COLORS.ember, true);
    rim.material = new THREE.MeshBasicMaterial({
      color: COLORS.ember,
      toneMapped: false,
    });
    rim.rotation.x = Math.PI / 2;
    this.previewHalo = rim;
    // Recessed radial seams, rather than loose surface plates.
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const seam = box(
        group,
        [0.022, 0.009, 0.17],
        [Math.cos(angle) * 2.14, 0.018, Math.sin(angle) * 2.14],
        0x111f29,
        0.002,
      );
      seam.rotation.y = -angle + Math.PI / 2;
    }
    bake(group);
    this.stage.add(group);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({
        color: 0x101c28,
        roughness: 0.66,
        metalness: 0.18,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.34;
    floor.receiveShadow = true;
    this.stage.add(floor);
    const decor = new THREE.Group();
    box(decor, [30, 10, 0.25], [0, 4.3, -5.1], 0x14232e, 0.03);
    for (let i = 0; i < 7; i++) {
      const x = -10 + i * 4;
      box(decor, [0.035, 8, 0.018], [x, 3.5, -4.96], 0x273945, 0.002);
      box(decor, [3.65, 0.025, 0.018], [x + 1.86, 1.5, -4.96], 0x263946, 0.002);
    }
    // One structural light band gives the silhouettes a quiet studio backdrop.
    box(decor, [30, 0.06, 0.025], [0, 0.04, -4.94], 0x3d555f, 0.008);
    bake(decor);
    this.stage.add(decor);
    return group;
  }
  private spawnParticles(
    x: number,
    y: number,
    z: number,
    count: number,
    col: number,
    force = 3,
    size = 0.65,
    options?: ParticleOptions,
  ) {
    const spread = options?.spread ?? Math.PI;
    const gravity = options?.gravity ?? 7;
    const particleTint = particleColor(col);
    const cap = SurvivalScene.PARTICLE_CAP;
    for (let i = 0; i < count && this.particles.length < cap; i++) {
      const a =
        options?.direction !== undefined
          ? options.direction + (Math.random() - 0.5) * 2 * spread
          : Math.random() * Math.PI * 2;
      const speed = force * (0.25 + Math.random() * 0.75);
      const life =
        options?.life !== undefined
          ? options.life * (0.6 + Math.random() * 0.8)
          : 0.25 + Math.random() * 0.5;
      let px = x,
        pz = z,
        vx = Math.cos(a) * speed,
        vz = Math.sin(a) * speed;
      if (options?.radius) {
        const ring = Math.random() * Math.PI * 2;
        px += Math.cos(ring) * options.radius;
        pz += Math.sin(ring) * options.radius;
      }
      if (options?.inward) {
        const reach = force * (0.3 + Math.random() * 0.25);
        px += Math.cos(a) * reach;
        pz += Math.sin(a) * reach;
        vx = -vx;
        vz = -vz;
      }
      this.particles.push({
        x: px,
        y,
        z: pz,
        vx,
        vy:
          Math.random() * force * (gravity === 0 ? 0.2 : 0.8) +
          (options?.lift ?? 0),
        vz,
        life,
        max: life,
        size: size * (0.4 + Math.random() * 0.6),
        color: particleTint,
        gravity,
        drag: options?.drag ?? 0,
        spin: options?.spin ?? 1,
      });
    }
  }
  /** One additive disc (sprite) or cone at a muzzle, from a pool capped at 24. */
  private flash(
    cone: boolean,
    at: THREE.Vector3,
    angle: number,
    col: number,
    size: number,
    life: number,
  ) {
    if (this.flashes.length >= 24) return;
    let entry = this.flashPool.find((f) => f.cone === cone);
    if (entry) this.flashPool.splice(this.flashPool.indexOf(entry), 1);
    else if (cone) {
      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      material.userData.owned = true;
      entry = {
        object: new THREE.Mesh(this.flashConeGeometry, material),
        material,
        cone: true,
        life,
        max: life,
        size,
      };
    } else {
      const material = new THREE.SpriteMaterial({
        map: glowTexture(),
        color: col,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      material.userData.owned = true;
      entry = {
        object: new THREE.Sprite(material),
        material,
        cone: false,
        life,
        max: life,
        size,
      };
    }
    entry.life = entry.max = life;
    entry.size = size;
    entry.material.color.setHex(col);
    entry.material.opacity = 1;
    entry.object.position.copy(at);
    if (cone) entry.object.rotation.set(0, Math.PI / 2 - angle, 0);
    entry.object.scale.setScalar(size);
    this.fx.add(entry.object);
    this.flashes.push(entry);
  }
  /** The muzzle flash for a fire event, from the per-family table. */
  private flashFor(e: GameEvent, muzzle: THREE.Vector3, col: number) {
    const boss =
      !!e.enemy && e.id !== undefined && this.enemies.get(e.id)?.kind === "boss";
    const drone = !e.enemy && e.id !== undefined && this.drones.has(e.id);
    const spec = MUZZLE_FLASH[flashClassFor(e.weapon, !!e.enemy, boss, drone)];
    const rank = 1 + Math.min(5, Math.max(0, (e.level ?? 1) - 1)) * 0.12;
    const angle = e.angle ?? 0;
    const reduced = this.reducedMotion;
    this.spawnParticles(
      muzzle.x,
      muzzle.y,
      muzzle.z,
      Math.round(spec.particles * rank * (reduced ? 0.5 : 1)),
      col,
      spec.force * rank,
      spec.size,
      {
        direction: spec.inward || spec.upward ? undefined : angle,
        spread: spec.spread,
        inward: spec.inward,
        lift: spec.upward ? spec.force : 0,
        gravity: spec.upward ? 2 : undefined,
        drag: spec.inward ? 2 : undefined,
        life: spec.life,
      },
    );
    if (spec.disc) this.flash(false, muzzle, angle, col, spec.disc * rank, 0.09);
    if (spec.cone && !reduced)
      this.flash(true, muzzle, angle, col, spec.cone * rank, 0.08);
    if (spec.ring) this.ring(muzzle.x, muzzle.z, col, spec.ring * rank, 0.25, 0.3);
    if (spec.smoke && !reduced)
      this.spawnParticles(muzzle.x, muzzle.y, muzzle.z, spec.smoke, 0x8f8780, 1.4, 0.7, {
        direction: angle,
        spread: 0.5,
        drag: 3,
        gravity: 0,
        life: 0.55,
        lift: 0.7,
        spin: 0.4,
      });
    if (spec.shake && !reduced) this.shake = Math.max(this.shake, spec.shake);
  }
  /**
   * Particles that spiral in toward (x, z): `rate` radians per second around the
   * centre, `shrink` units per second inward. Used by the wells and Flux's vacuum.
   */
  private spawnVortex(
    x: number,
    z: number,
    col: number,
    radius: number,
    count: number,
    rate: number,
    shrink: number,
    life: number,
    size: number,
    y = 0.4,
  ) {
    const particleTint = particleColor(col);
    const cap = SurvivalScene.PARTICLE_CAP;
    for (let i = 0; i < count && this.particles.length < cap; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.7 + Math.random() * 0.3);
      const max = life * (0.6 + Math.random() * 0.8);
      this.particles.push({
        x: x + Math.cos(angle) * r,
        y: y + Math.random() * 0.5,
        z: z + Math.sin(angle) * r,
        vx: 0,
        vy: 0.2 + Math.random() * 0.4,
        vz: 0,
        life: max,
        max,
        size: size * (0.4 + Math.random() * 0.6),
        color: particleTint,
        gravity: 0,
        drag: 0,
        spin: 1.5,
        orbit: { cx: x, cz: z, angle, radius: r, rate, shrink },
      });
    }
  }
  /** Particles a continuous emitter may still add without starving event bursts of the cap. */
  budget(reserve = 250) {
    return Math.max(0, SurvivalScene.PARTICLE_CAP - reserve - this.particles.length);
  }
  private acquireMaterial(additive: boolean, col: number, opacity: number) {
    const pool = additive ? this.materialPool.additive : this.materialPool.normal;
    let m = pool.pop();
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: !additive,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      m.userData.additive = additive;
    }
    m.color.setHex(col);
    m.opacity = opacity;
    return m;
  }
  private releaseMaterial(m: THREE.MeshBasicMaterial) {
    (m.userData.additive ? this.materialPool.additive : this.materialPool.normal).push(m);
  }
  /** Adds a ring-list entry; over the cap the oldest entry retires first. */
  private pushRing(
    mesh: THREE.Mesh,
    material: THREE.MeshBasicMaterial,
    life: number,
    radius: number,
    start: number,
    animate: boolean,
  ) {
    if (this.rings.length >= SurvivalScene.RING_CAP) this.retireRing(this.rings.shift()!);
    this.fx.add(mesh);
    this.rings.push({
      mesh,
      material,
      life,
      max: life,
      radius,
      start,
      animate,
      opacity: material.opacity,
    });
  }
  private retireRing(r: Ring) {
    r.mesh.removeFromParent();
    if (!this.sharedGeometries.has(r.mesh.geometry)) r.mesh.geometry.dispose();
    this.releaseMaterial(r.material);
  }
  private ring(
    x: number,
    y: number,
    col: number,
    radius: number,
    duration = 0.4,
    start = 0.1,
    opacity = 0.85,
    additive = false,
  ) {
    const material = this.acquireMaterial(additive, col, opacity);
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, y);
    mesh.scale.setScalar(start);
    this.pushRing(mesh, material, duration, radius, start, true);
  }
  /** A filled additive ground disc that fades: impact flashes and well floors. */
  private groundFlash(x: number, y: number, col: number, radius: number, duration = 0.2) {
    const material = this.acquireMaterial(true, col, 0.7);
    const mesh = new THREE.Mesh(this.discGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.07, y);
    mesh.scale.setScalar(radius);
    this.pushRing(mesh, material, this.reducedMotion ? duration * 0.6 : duration, radius, radius, false);
  }
  /** A vertical additive disc facing along `angle`: muzzle puffs, bounce splats, chimes. */
  private disc(x: number, h: number, z: number, col: number, radius: number, duration: number, angle: number) {
    const material = this.acquireMaterial(true, col, 0.8);
    const mesh = new THREE.Mesh(this.discGeometry, material);
    mesh.position.set(x, h, z);
    mesh.rotation.set(0, Math.PI / 2 - angle, 0);
    mesh.scale.setScalar(radius);
    this.pushRing(mesh, material, duration, radius, radius, false);
  }
  /**
   * A bolt from one point to another built from the shared unit cylinder: one
   * straight segment, or three jittered segments for lightning. Never allocates geometry.
   */
  private bolt(from: THREE.Vector3, to: THREE.Vector3, col: number, radius: number, life: number, jitter: number) {
    const segments = jitter > 0 ? 3 : 1;
    const dx = to.x - from.x,
      dz = to.z - from.z;
    const length = Math.hypot(dx, to.y - from.y, dz);
    if (length < 1e-4) return;
    const px = -dz / (Math.hypot(dx, dz) || 1),
      pz = dx / (Math.hypot(dx, dz) || 1);
    let ax = from.x,
      ay = from.y,
      az = from.z;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      let bx = lerp(from.x, to.x, t),
        by = lerp(from.y, to.y, t),
        bz = lerp(from.z, to.z, t);
      if (i < segments) {
        const off = (Math.random() - 0.5) * 2 * jitter;
        bx += px * off;
        bz += pz * off;
        by += (Math.random() - 0.5) * jitter;
      }
      const material = this.acquireMaterial(true, col, 0.95);
      const mesh = new THREE.Mesh(this.segmentGeometry, material);
      mesh.position.set(ax, ay, az);
      scratchTo.set(bx, by, bz);
      mesh.lookAt(scratchTo);
      mesh.scale.set(radius, radius, Math.hypot(bx - ax, by - ay, bz - az));
      this.pushRing(mesh, material, life, 1, 1, false);
      ax = bx;
      ay = by;
      az = bz;
    }
  }
  private makePlayerBubble() {
    const mesh = new THREE.Mesh(
      this.bubbleGeometry,
      new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.scale.setScalar(1.05);
    mesh.visible = false;
    this.fx.add(mesh);
    return mesh;
  }
  private makeAuraRing(geometry: THREE.BufferGeometry, col: number, opacity: number) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.06;
    mesh.visible = false;
    this.fx.add(mesh);
    return mesh;
  }
  private addShake(amount: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }
  private label(amount: number, x: number, y: number, critical = false) {
    if (this.labels.length > 32) return;
    const key = String(Math.round(amount)) + (critical ? "!" : "");
    let texture = this.labelTextures.get(key);
    if (!texture) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const c = canvas.getContext("2d")!;
      c.font = `900 ${critical ? 42 : 36}px Arial`;
      c.textAlign = "center";
      c.strokeStyle = "#182127";
      c.lineWidth = 5;
      c.strokeText(key, 64, 45);
      c.fillStyle = critical ? "#ffd398" : "#f4f2dc";
      c.fillText(key, 64, 45);
      texture = new THREE.CanvasTexture(canvas);
      this.labelTextures.set(key, texture);
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sprite.position.set(x + (Math.random() - 0.5) * 0.5, 2.6, y);
    sprite.scale.set(1.25, 0.625, 1);
    this.fx.add(sprite);
    this.labels.push({ sprite, life: 0.55, max: 0.55, z: y });
  }
  /** Every simulation event kind routes here; kinds without a visual are explicit no-ops. */
  private static readonly HANDLERS: Record<
    EventKind,
    (scene: SurvivalScene, e: GameEvent, col: number, batch: EventBatch) => void
  > = {
    spawn: (s, e) => s.onSpawn(e),
    fire: (s, e, col) => s.onFire(e, col),
    hit: (s, e, col) => s.onHit(e, col),
    kill: (s, e) => s.onKill(e),
    hurt: (s, e) => s.onHurt(e),
    dash: (s, e) => s.onDash(e),
    pickup: (s, e) => s.onPickup(e),
    explosion: (s, e, col) => s.onExplosion(e, col),
    arc: (s, e, col, batch) => s.onArc(e, col, batch),
    slash: (s, e, col) => s.onSlash(e, col),
    waveStart: (s, e) => s.onWaveStart(e),
    waveEnd: (s, e) => s.onWaveEnd(e),
    buy: () => undefined,
    upgrade: () => undefined,
    boss: (s, e) => s.onBoss(e),
    lost: (s, e) => s.onLost(e),
    won: (s, e) => s.onWon(e),
    telegraph: () => undefined,
    weave: (s, e) => s.onWeave(e),
    status: (s, e) => s.onStatus(e),
    heal: (s, e) => s.onHeal(e),
    shieldBreak: (s, e) => s.onShieldBreak(e),
    spawnMark: (s, e) => s.onSpawnMark(e),
    horde: (s, e) => s.onHorde(e),
    pull: (s, e, col) => s.onPull(e, col),
    bounce: (s, e, col) => s.onBounce(e, col),
    burst: (s, e, col) => s.onBurst(e, col),
    crush: (s, e) => s.onCrush(e),
    strike: (s, e, col) => s.onStrike(e, col),
    barrier: (s, e) => s.onBarrier(e),
  };
  handleEvents(events: GameEvent[]) {
    const batch: EventBatch = { arcOrigins: new Set() };
    for (const e of events) {
      const col = e.enemy ? 0xff7355 : weaponColor(e.weapon);
      SurvivalScene.HANDLERS[e.type]?.(this, e, col, batch);
    }
  }
  /** Particle counts halve under reduced motion. */
  private count(n: number) {
    return this.reducedMotion ? Math.ceil(n / 2) : n;
  }
  private onSpawn(e: GameEvent) {
    this.ring(e.x, e.y, 0xe99460, (e.radius ?? 0.6) * 1.5, 0.5, 0.9);
    this.spawnParticles(e.x, 0.15, e.y, this.count(5), DUST, 1, 0.6);
  }
  private onSpawnMark(e: GameEvent) {
    this.spawnParticles(e.x, 0.1, e.y, this.count(3), 0xe99460, 0.8, 0.45);
  }
  private onHorde(e: GameEvent) {
    // A horde ring closing on the player: one red pulse from the player outward.
    this.ring(e.x, e.y, 0xff6e4e, (e.radius ?? 6) * 1.05, 0.6, 0.3);
    this.spawnParticles(e.x, 0.6, e.y, this.count(18), 0xff8a6a, 3, 0.6);
    this.addShake(0.08);
  }
  private onFire(e: GameEvent, col: number) {
    if (e.enemy && e.id !== undefined) {
      const rig = this.enemies.get(e.id);
      if (rig) rig.recoil = 1;
    }
    // A deployed turret's shots carry `source`; the hand that placed it stays still.
    if (!e.enemy && e.id !== undefined && e.source === undefined && this.heldWeapons.has(e.id))
      this.weaponMotion.set(e.id, 1);
    const muzzle = this.eventMuzzle(e, muzzleScratch);
    this.flashFor(e, muzzle, col);
    if (e.enemy) return;
    const angle = e.angle ?? 0;
    switch (e.weapon) {
      case "eclipse":
        // Charge: an imploding magenta ring and a white vortex at the muzzle.
        this.ring(muzzle.x, muzzle.z, MAGENTA, 0.3, 0.35, 3.2, 0.9, true);
        this.spawnVortex(muzzle.x, muzzle.z, WHITE, 1.6, this.count(12), 9, 3.5, 0.4, 0.4, muzzle.y - 0.3);
        break;
      case "boomerang":
        // Whoosh: a disc at the hand and a few sparks swept sideways.
        this.disc(muzzle.x, muzzle.y, muzzle.z, col, 0.55, 0.12, angle);
        this.spawnParticles(muzzle.x, muzzle.y, muzzle.z, this.count(4), col, 2, 0.35, {
          direction: angle + Math.PI / 2,
          spread: 0.4,
          gravity: 0,
          drag: 3,
          life: 0.2,
        });
        break;
      case "sentry":
        if (e.source === undefined) {
          this.ring(e.x, e.y, heroTint(this.heroId), 1.6, 0.4, 0.2);
          this.spawnParticles(e.x, 0.3, e.y, this.count(8), col, 2.5, 0.45);
        }
        break;
      case "spore_mine":
        this.spawnParticles(e.x, 0.4, e.y, this.count(6), SPORE, 1.2, 0.6, {
          drag: 2,
          gravity: 0,
          life: 0.5,
          lift: 0.4,
        });
        break;
      case "halo":
        this.ring(e.x, e.y, heroTint(this.heroId), 1.8, 0.4, 0.4, 0.8);
        break;
      case "thumper":
        this.ring(e.x, e.y, col, 6.5, 0.45, 0.6);
        this.spawnParticles(e.x, 0.15, e.y, this.count(14), DUST, 1.6, 0.6, {
          radius: 1.2,
          gravity: 4,
          life: 0.4,
        });
        this.addShake(0.12);
        break;
      case "shotgun":
        this.addShake(0.04);
        break;
      case "railgun":
        this.addShake(0.08);
        break;
      case "gravity":
        this.spawnVortex(muzzle.x, muzzle.z, col, 0.9, this.count(6), 8, 2, 0.3, 0.3, muzzle.y - 0.2);
        break;
    }
  }
  private onHit(e: GameEvent, col: number) {
    if (e.status) {
      // DoT ticks: one rising tinted particle; a label only once the number reads.
      const tint = e.status === "burn" ? EMBER : e.status === "poison" ? SPORE : ICE;
      this.spawnParticles(e.x, 1.3, e.y, 1, tint, 0.6, 0.45, {
        gravity: 0,
        lift: 1.2,
        life: 0.45,
        drag: 1,
      });
      if (e.amount && e.amount >= 3) this.label(e.amount, e.x, e.y);
      return;
    }
    const critical = !!e.critical;
    if (e.weapon === "eclipse") {
      this.spawnParticles(e.x, 1, e.y, this.count(3), WHITE, 2.5, 0.4, { gravity: 0, drag: 3, life: 0.2 });
      this.spawnParticles(e.x, 1, e.y, this.count(3), MAGENTA, 2.5, 0.45);
    } else
      switch (familyOf(e.weapon)) {
        case "thermal":
          this.spawnParticles(e.x, 0.9, e.y, this.count(4), EMBER, 2, 0.5, {
            gravity: 1,
            lift: 1.5,
            life: 0.4,
          });
          this.ring(e.x, e.y, 0xff7a3a, 0.9, 0.18, 0.3, 0.6);
          break;
        case "storm":
          this.spawnParticles(e.x, 1.1, e.y, this.count(3), CYAN, 3, 0.4, { gravity: 0, drag: 3, life: 0.2 });
          scratchFrom.set(e.x, 1.7, e.y);
          scratchTo.set(e.x + (Math.random() - 0.5) * 1.2, 0.8, e.y + (Math.random() - 0.5) * 1.2);
          this.bolt(scratchFrom, scratchTo, CYAN, 0.03, 0.1, 0.15);
          break;
        case "frost":
          this.spawnParticles(e.x, 1, e.y, this.count(4), ICE, 2, 0.4);
          this.spawnParticles(e.x, 0.6, e.y, this.count(2), 0xd8f6ff, 0.8, 0.7, {
            gravity: 0,
            drag: 2,
            life: 0.5,
            lift: 0.4,
          });
          break;
        case "toxic":
          this.spawnParticles(e.x, 0.8, e.y, this.count(3), SPORE, 0.9, 0.45, {
            gravity: 0,
            lift: 1.4,
            life: 0.5,
            drag: 1,
          });
          break;
        default:
          this.spawnParticles(e.x, 1, e.y, this.count(4), col, 2.5, 0.5);
      }
    if (critical) {
      this.ring(e.x, e.y, WHITE, 1.1, 0.22, 0.4, 0.9);
      this.spawnParticles(e.x, 1.1, e.y, this.count(6), WHITE, 3.5, 0.45);
    }
    if (e.amount) this.label(e.amount, e.x, e.y, critical);
  }
  private onKill(e: GameEvent) {
    const boss = e.kind === "boss";
    this.spawnParticles(e.x, 0.85, e.y, this.count(boss ? 70 : 15), 0xa28d76, boss ? 9 : 4, 0.9);
    this.spawnParticles(e.x, 0.7, e.y, this.count(5), 0xffb575, 3, 0.45);
    if (e.kind === "brute" || boss) this.addShake(0.15);
  }
  private onHurt(e: GameEvent) {
    this.addShake(0.3);
    this.damageFlash = 0.52;
    this.ring(e.x, e.y, 0xff6d52, 1.5, 0.24);
    this.spawnParticles(e.x, 1, e.y, this.count(16), 0xff9377, 4, 0.7);
  }
  private onDash(e: GameEvent) {
    const tint = heroTint(this.heroId);
    const angle = e.angle ?? 0;
    switch (this.heroId) {
      case "ember":
        // Crossfire: a fan of sparks and a muzzle disc along the volley.
        this.ring(e.x, e.y, tint, e.radius ?? 1, 0.3);
        this.disc(e.x + Math.cos(angle) * 0.7, 1.3, e.y + Math.sin(angle) * 0.7, tint, 0.6, 0.12, angle);
        this.spawnParticles(e.x, 1.2, e.y, this.count(14), tint, 4, 0.5, { direction: angle, spread: 0.5, gravity: 2 });
        break;
      case "volt": {
        this.ring(e.x, e.y, tint, e.radius ?? 5, 0.35);
        this.spawnParticles(e.x, 0.8, e.y, this.count(16), CYAN, 4, 0.5, { gravity: 0, drag: 2, life: 0.3 });
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + Math.random() * 0.3;
          scratchFrom.set(e.x, 1.2, e.y);
          scratchTo.set(e.x + Math.cos(a) * 1.8, 0.5, e.y + Math.sin(a) * 1.8);
          this.bolt(scratchFrom, scratchTo, CYAN, 0.035, 0.12, 0.2);
        }
        break;
      }
      case "bastion":
        this.ring(e.x, e.y, 0xc9a27a, 1.6, 0.35, 0.5, 0.6);
        this.spawnParticles(e.x, 0.15, e.y, this.count(12), DUST, 2.5, 0.65, { gravity: 3, life: 0.45 });
        break;
      case "thorn":
        this.ring(e.x, e.y, SPORE, 2.5, 0.35, 0.3);
        for (let i = 0; i < 12; i++)
          this.spawnParticles(e.x, 0.9, e.y, 1, SPORE, 5, 0.45, { direction: (i * Math.PI) / 6, spread: 0.05, gravity: 2 });
        break;
      case "prism":
        for (const [i, c] of [0xff8080, 0x80ff9a, 0x80b8ff].entries())
          this.ring(e.x, e.y, c, 1.6 + i * 0.6, 0.35 + i * 0.05, 0.2, 0.8);
        this.spawnParticles(e.x, 0.8, e.y, this.count(12), tint, 3, 0.5);
        break;
      default:
        // Cinder, Frost, Reaper and Flux draw their signature in onExplosion; Wisp's Swarm ring is per-frame.
        this.ring(e.x, e.y, tint, e.radius ?? 2, 0.35);
        this.spawnParticles(e.x, 0.6, e.y, this.count(this.heroId === "wisp" ? 12 : 26), tint, 4, 0.75);
    }
  }
  private onPickup(e: GameEvent) {
    if (e.id !== undefined && this.drones.has(e.id)) {
      // A repair drone's pulse heals the player.
      const p = this.player.root.position;
      this.ring(p.x, p.z, 0xbdf5c8, 1.6, 0.35, 0.6, 0.7);
      this.spawnParticles(p.x, 0.5, p.z, this.count(6), 0xbdf5c8, 1, 0.45, { gravity: 0, lift: 1.4, life: 0.5 });
      return;
    }
    this.spawnParticles(e.x, 0.4, e.y, this.count(4), 0x24f4a2, 1.3, 0.5);
  }
  private onExplosion(e: GameEvent, col: number) {
    const radius = e.radius ?? 3;
    if (e.enemy) {
      this.ring(e.x, e.y, 0xff6e4e, radius, 0.38);
      this.spawnParticles(e.x, 0.4, e.y, this.count(24), 0xff8a6a, 6, 1);
      this.addShake(0.1);
      return;
    }
    // Bullet detonations carry the bullet's id; hero abilities and hazards do not.
    const ability = e.id === undefined;
    switch (e.weapon) {
      case "gravity":
        this.ring(e.x, e.y, col, 0.3, 0.25, radius * 1.2, 0.9, true);
        this.ring(e.x, e.y, col, 2.4, 0.4);
        this.spawnParticles(e.x, 0.4, e.y, this.count(28), col, 7, 0.9);
        this.addShake(0.18);
        return;
      case "eclipse":
        this.groundFlash(e.x, e.y, WHITE, 6, 0.3);
        this.ring(e.x, e.y, MAGENTA, 9, 0.55, 0.5, 0.9);
        this.ring(e.x, e.y, WHITE, 5, 0.4, 0.3, 0.9, true);
        this.spawnParticles(e.x, 0.5, e.y, this.count(30), MAGENTA, 9, 1);
        this.spawnParticles(e.x, 0.5, e.y, this.count(30), WHITE, 8, 0.7, { gravity: 2, drag: 1 });
        if (!this.reducedMotion) {
          this.spawnParticles(e.x, 0.4, e.y, 12, SMOKE, 2, 1.2, { drag: 2, gravity: 0, life: 0.9, lift: 1, spin: 0.4 });
          this.punch = 0.4;
        }
        this.addShake(0.5);
        return;
      case "spore_mine":
        this.ring(e.x, e.y, SPORE, radius, 0.4);
        this.spawnParticles(e.x, 0.4, e.y, this.count(18), SPORE, 2.2, 0.55, { drag: 2, gravity: 0, life: 0.8, lift: 0.6 });
        return;
      case "rocket":
      case "mortar":
        this.ring(e.x, e.y, 0x6b5a4a, radius, 0.45, 0.3, 0.7);
        this.groundFlash(e.x, e.y, 0xffa040, radius * 0.8, 0.22);
        this.spawnParticles(e.x, 0.4, e.y, this.count(20), col, 7, 1);
        if (!this.reducedMotion)
          this.spawnParticles(e.x, 0.4, e.y, 8, SMOKE, 2, 1.1, { drag: 2, gravity: 0, life: 0.8, lift: 1.2, spin: 0.4 });
        this.addShake(e.weapon === "mortar" ? 0.16 : 0.14);
        return;
      case "flare":
        if (ability) {
          this.ring(e.x, e.y, EMBER, radius, 0.3, 0.4, 0.6);
          this.spawnParticles(e.x, 0.3, e.y, this.count(6), EMBER, 1, 0.5, { gravity: 0, lift: 1.5, life: 0.5 });
          return;
        }
        break;
      case "arc":
        if (ability) {
          // Volt's nova: every fifth kill.
          this.ring(e.x, e.y, CYAN, radius, 0.35, 0.3, 0.9);
          this.spawnParticles(e.x, 0.8, e.y, this.count(20), CYAN, 5, 0.5, { gravity: 0, drag: 2, life: 0.3 });
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3 + Math.random() * 0.4;
            scratchFrom.set(e.x, 1.3, e.y);
            scratchTo.set(e.x + Math.cos(a) * radius * 0.7, 0.4, e.y + Math.sin(a) * radius * 0.7);
            this.bolt(scratchFrom, scratchTo, CYAN, 0.04, 0.14, 0.25);
          }
          this.addShake(0.12);
          return;
        }
        break;
      case "flame":
        if (ability) {
          // Cinder's Flashover, or a burn detonation.
          this.ring(e.x, e.y, EMBER, radius, 0.35, 0.3, 0.8);
          this.groundFlash(e.x, e.y, 0xff7a3a, radius * 0.6, 0.2);
          this.spawnParticles(e.x, 0.5, e.y, this.count(radius > 3 ? 20 : 10), EMBER, 4, 0.8, { gravity: 0, lift: 2, drag: 1, life: 0.5 });
          this.spawnParticles(e.x, 0.5, e.y, this.count(6), 0xffdb88, 3, 0.5, { gravity: 0, lift: 1.5, drag: 1, life: 0.4 });
          return;
        }
        break;
      case "frostgun":
        if (ability) {
          // Frost's Cold snap.
          this.ring(e.x, e.y, ICE, radius, 0.4, 0.3, 0.9);
          this.spawnParticles(e.x, 0.6, e.y, this.count(20), ICE, 5, 0.5);
          this.spawnParticles(e.x, 0.3, e.y, this.count(8), 0xd8f6ff, 1.2, 0.9, { gravity: 0, drag: 1.5, life: 0.7, lift: 0.4 });
          return;
        }
        break;
      case "blade":
        if (ability) {
          // Reaper's Harvest.
          this.ring(e.x, e.y, 0x2a0810, radius, 0.4, 0.3, 0.8);
          this.ring(e.x, e.y, 0x9b1030, radius * 0.7, 0.3, 0.2, 0.8);
          this.spawnParticles(e.x, 0.7, e.y, this.count(14), 0x9b1030, 4, 0.6);
          return;
        }
        break;
      case "boomerang":
        if (ability) {
          // Flux's Vacuum: everything streaks inward.
          this.ring(e.x, e.y, heroTint(this.heroId), 0.5, 0.4, radius, 0.9, true);
          this.spawnParticles(e.x, 0.6, e.y, this.count(24), heroTint(this.heroId), 8, 0.45, {
            inward: true,
            gravity: 0,
            drag: 0.5,
            life: 0.35,
          });
          return;
        }
        break;
      case "shatter":
        this.groundFlash(e.x, e.y, WHITE, radius * 0.7, 0.15);
        this.spawnParticles(e.x, 0.6, e.y, this.count(12), ICE, 5, 0.45);
        return;
    }
    this.ring(e.x, e.y, col, radius, 0.38);
    this.spawnParticles(e.x, 0.4, e.y, this.count(32), col, 7, 1.1);
    this.addShake(0.14);
  }
  private onArc(e: GameEvent, col: number, batch: EventBatch) {
    if (e.targetX === undefined || e.targetY === undefined) return;
    const first = !e.enemy && e.id !== undefined && !batch.arcOrigins.has(e.id);
    if (first) {
      batch.arcOrigins.add(e.id!);
      if (this.heldWeapons.has(e.id!)) this.weaponMotion.set(e.id!, 1);
    }
    const origin = first ? this.eventMuzzle(e, scratchFrom) : scratchFrom.set(e.x, 1.2, e.y);
    const target = scratchTo.set(e.targetX, 1.05, e.targetY);
    switch (e.weapon) {
      case "skyfall":
        // A bolt from the sky onto the target: white ground flash and a storm ring.
        scratchMid.set(e.targetX, 7.5, e.targetY);
        target.y = 0.3;
        this.bolt(scratchMid, target, WHITE, 0.09, 0.18, 0);
        this.groundFlash(e.targetX, e.targetY, WHITE, 1.4, 0.18);
        this.ring(e.targetX, e.targetY, col, 2.2, 0.35, 0.3, 0.8);
        this.spawnParticles(e.targetX, 0.5, e.targetY, this.count(6), CYAN, 3, 0.4, { gravity: 0, drag: 3, life: 0.25 });
        return;
      case "eclipse":
        origin.y = 0.9;
        this.bolt(origin, target, MAGENTA, 0.07, 0.18, 0);
        this.spawnParticles(e.targetX, 1, e.targetY, this.count(4), CYAN, 3, 0.4, { gravity: 0, drag: 3, life: 0.2 });
        return;
      case "beam":
      case "railgun":
        this.bolt(origin, target, col, e.weapon === "beam" ? 0.11 : 0.07, 0.16, 0);
        this.spawnParticles(e.targetX, 1, e.targetY, this.count(3), col, 3, 0.4, { gravity: 1, life: 0.25 });
        if (first) {
          this.disc(origin.x, origin.y, origin.z, col, 0.45, 0.1, e.angle ?? Math.atan2(target.z - origin.z, target.x - origin.x));
          if (e.weapon === "railgun") this.addShake(0.08);
        }
        return;
      case "flame":
        // Cinder's burn spread: an orange bolt to the neighbour.
        this.bolt(origin, target, EMBER, 0.05, 0.2, 0.25);
        this.spawnParticles(e.targetX, 0.9, e.targetY, this.count(3), EMBER, 1, 0.45, { gravity: 0, lift: 1.5, life: 0.4 });
        return;
    }
    this.bolt(origin, target, col, 0.065, 0.16, 0.45);
    this.spawnParticles(e.targetX, 1, e.targetY, this.count(2), col, 3, 0.4, { gravity: 0, drag: 3, life: 0.2 });
  }
  private onSlash(e: GameEvent, col: number) {
    if (e.id !== undefined && this.heldWeapons.has(e.id)) this.weaponMotion.set(e.id, 1);
    const angle = e.angle ?? 0;
    const radius = e.radius ?? 3.4;
    const drone = e.id !== undefined ? this.drones.get(e.id) : undefined;
    const height = drone ? drone.position.y : 0.9;
    switch (e.weapon) {
      case "flame": {
        // A directional cone of rising fire in two tints plus a pale shimmer.
        const cone = { direction: angle, spread: 0.3, gravity: 0, lift: 0.9, drag: 1.2, life: 0.45 };
        this.spawnParticles(e.x, height, e.y, this.count(5), 0xff9b48, radius * 1.3, 1.0, cone);
        this.spawnParticles(e.x, height, e.y, this.count(5), 0xffdb88, radius * 1.3, 0.9, cone);
        this.spawnParticles(e.x, height + 0.2, e.y, this.count(3), 0xffe9c0, radius * 1.6, 0.5, { ...cone, life: 0.3 });
        return;
      }
      case "blade": {
        const material = this.acquireMaterial(false, col, 0.7);
        material.toneMapped = false;
        const sweep = new THREE.Mesh(this.sweepGeometry, material);
        sweep.rotation.set(-Math.PI / 2, 0, -angle);
        sweep.position.set(e.x, drone ? height : 1.25, e.y);
        sweep.scale.setScalar(radius);
        this.pushRing(sweep, material, 0.17, radius, radius, false);
        return;
      }
      case "frostgun":
        // A frost drone's pulse: a cyan ring and drifting mist.
        this.ring(e.x, e.y, ICE, radius, 0.35, 0.3, 0.8);
        this.spawnParticles(e.x, height, e.y, this.count(6), 0xd8f6ff, 1.2, 0.7, { gravity: 0, drag: 1.5, life: 0.5, lift: 0.4 });
        return;
    }
    this.ring(e.x, e.y, col, radius, 0.2, 0.7);
  }
  private onStatus(e: GameEvent) {
    const tint = e.status === "burn" ? 0xffaa53 : e.status === "poison" ? SPORE : ICE;
    this.spawnParticles(e.x, 1.4, e.y, this.count(3), tint, 1, 0.65);
    if (e.status === "poison" && e.radius) {
      // Contagion: the plague jumps to neighbours in this radius.
      this.ring(e.x, e.y, SPORE, e.radius, 0.35, 0.4, 0.7);
      this.spawnParticles(e.x, 0.6, e.y, this.count(10), SPORE, 1.2, 0.4, { gravity: 0, lift: 1.2, drag: 1, life: 0.6, radius: 0.5 });
    }
  }
  private onHeal(e: GameEvent) {
    if (e.id === 0) {
      // Second chance.
      this.groundFlash(e.x, e.y, 0xbdf5c8, 2.4, 0.35);
      this.ring(e.x, e.y, 0xbdf5c8, 3, 0.5, 0.4, 0.9);
      this.spawnParticles(e.x, 0.5, e.y, this.count(20), 0xbdf5c8, 2, 0.55, { gravity: 0, lift: 2, drag: 1, life: 0.7 });
      return;
    }
    this.ring(e.x, e.y, 0xb4e397, 1.4, 0.4, 0.5, 0.7);
    this.spawnParticles(e.x, 0.6, e.y, this.count(5), 0xb4e397, 0.8, 0.45, { gravity: 0, lift: 1.4, life: 0.5 });
  }
  private onShieldBreak(e: GameEvent) {
    if (e.id === 0) {
      // The player's bubble pops.
      this.ring(e.x, e.y, CYAN, 1.8, 0.3, 0.9, 0.9, true);
      this.spawnParticles(e.x, 1, e.y, this.count(12), CYAN, 4, 0.45, { gravity: 3 });
      this.addShake(0.08);
      return;
    }
    this.ring(e.x, e.y, CYAN, 1.3, 0.3, 0.4, 0.8);
    this.spawnParticles(e.x, 1, e.y, this.count(8), CYAN, 3, 0.4, { gravity: 2 });
  }
  private onBarrier(e: GameEvent) {
    this.ring(e.x, e.y, CYAN, 1.5, 0.3, 0.9, 0.8, true);
    this.spawnParticles(e.x, 1.1, e.y, this.count(6), CYAN, 0.8, 0.35, { gravity: 0, drag: 2, life: 0.4, radius: 1.1, lift: 0.6 });
  }
  private onPull(e: GameEvent, col: number) {
    const eclipse = e.weapon === "eclipse";
    this.ring(e.x, e.y, eclipse ? MAGENTA : col, 0.5, eclipse ? 0.45 : 0.4, eclipse ? 7 : (e.radius ?? 4), 0.9, true);
    this.spawnVortex(e.x, e.y, eclipse ? WHITE : col, e.radius ?? 4, this.count(10), 5, (e.radius ?? 4) * 1.4, 0.7, 0.45);
  }
  private onCrush(e: GameEvent) {
    this.ring(e.x, e.y, WHITE, e.radius ?? 2.2, 0.25, 0.5, 0.9, true);
    this.groundFlash(e.x, e.y, MAGENTA, (e.radius ?? 2.2) * 0.7, 0.15);
    this.addShake(0.05);
  }
  private onBurst(e: GameEvent, col: number) {
    if (e.weapon === "hive") {
      this.ring(e.x, e.y, 0xffd66b, 1.2, 0.3, 0.3, 0.8);
      this.spawnParticles(e.x, 0.9, e.y, this.count(10), col, 3, 0.4, { gravity: 1, drag: 1, life: 0.35 });
      // Two stacked ringlets climbing off the pod.
      for (const h of [0.6, 1.0]) {
        const material = this.acquireMaterial(true, 0xffd66b, 0.8);
        const ringlet = new THREE.Mesh(this.ringGeometry, material);
        ringlet.rotation.x = -Math.PI / 2;
        ringlet.position.set(e.x, h, e.y);
        ringlet.scale.setScalar(0.2);
        this.pushRing(ringlet, material, 0.3, 1, 0.2, true);
      }
      return;
    }
    if (e.weapon === "shatter") {
      this.groundFlash(e.x, e.y, WHITE, 1.2, 0.15);
      this.spawnParticles(e.x, 0.9, e.y, this.count(14), ICE, 5, 0.45, { gravity: 4 });
      return;
    }
    this.ring(e.x, e.y, col, 1, 0.25, 0.3, 0.7);
    this.spawnParticles(e.x, 0.8, e.y, this.count(Math.min(12, (e.amount ?? 4) * 2)), col, 3, 0.4);
  }
  private onBounce(e: GameEvent, col: number) {
    const angle = e.angle ?? 0;
    this.spawnParticles(e.x, 0.5, e.y, this.count(5), col, 3, 0.35, { direction: angle, spread: 0.35, gravity: 4, life: 0.25 });
    this.disc(e.x, 0.5, e.y, col, 0.35, 0.12, angle);
  }
  private onStrike(e: GameEvent, col: number) {
    if (e.targetX === undefined || e.targetY === undefined) return;
    const from = this.eventMuzzle(e, scratchFrom);
    const toxic = e.weapon === "needle";
    const tint = toxic ? SPORE : col;
    let lob = this.lobPool.pop();
    if (!lob) {
      const material = new THREE.MeshBasicMaterial({
        color: tint,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      lob = {
        mesh: new THREE.Mesh(this.shellGeometry, material),
        material,
        fromX: 0,
        fromY: 0,
        fromZ: 0,
        toX: 0,
        toZ: 0,
        age: 0,
        duration: 0.7,
        smoke: 0,
        weapon: "mortar",
        color: tint,
      };
    }
    lob.material.color.setHex(tint);
    lob.material.opacity = 1;
    lob.fromX = from.x;
    lob.fromY = from.y;
    lob.fromZ = from.z;
    lob.toX = e.targetX;
    lob.toZ = e.targetY;
    lob.age = 0;
    lob.duration = Math.max(0.3, e.amount ?? 0.7);
    lob.smoke = 0;
    lob.weapon = e.weapon ?? "mortar";
    lob.color = tint;
    lob.mesh.scale.setScalar(toxic ? 0.8 : 1 + Math.min(4, (e.level ?? 1) - 1) * 0.1);
    lob.mesh.position.copy(from);
    this.fx.add(lob.mesh);
    this.lobs.push(lob);
    if (!toxic) this.spawnParticles(from.x, from.y, from.z, this.count(4), SMOKE, 1.2, 0.6, { drag: 3, gravity: 0, life: 0.5, lift: 0.8, spin: 0.4 });
  }
  private onWaveStart(e: GameEvent) {
    this.ring(e.x, e.y, heroTint(this.heroId), 6, 0.6, 0.5, 0.8);
    this.spawnParticles(e.x, 0.5, e.y, this.count(12), heroTint(this.heroId), 2, 0.5, { gravity: 0, lift: 1.5, life: 0.6 });
  }
  private onBoss(e: GameEvent) {
    this.ring(e.x, e.y, 0xff3b2e, 12, 1.0, 0.5, 0.8);
    this.groundFlash(e.x, e.y, 0xff3b2e, 4, 0.6);
    this.addShake(0.2);
  }
  private onLost(e: GameEvent) {
    this.ring(e.x, e.y, 0x2a0810, 4, 0.9, 0.3, 0.9);
    this.spawnParticles(e.x, 0.6, e.y, this.count(24), 0x8a7f74, 1.5, 0.7, { gravity: 0, drag: 1, life: 1.2, lift: 0.8 });
  }
  private onWon(e: GameEvent) {
    this.groundFlash(e.x, e.y, 0xffd58a, 3, 0.6);
    this.ring(e.x, e.y, 0xffd58a, 14, 1.2, 0.5, 0.9);
    this.spawnParticles(e.x, 1, e.y, this.count(40), 0xffd58a, 6, 0.7);
  }
  private onWeave(e: GameEvent) {
    this.ring(e.x, e.y, 0x87f1e1, 2.6, 0.35);
    this.spawnParticles(e.x, 0.5, e.y, this.count(16), 0x79e5ee, 3, 0.55);
  }
  private onWaveEnd(e: GameEvent) {
    this.ring(e.x, e.y, 0xace5c2, 18, 1.1);
    this.spawnParticles(e.x, 2, e.y, this.count(35), 0xffd58a, 6, 0.8);
  }
  private makeBulletFx(kind: BulletFx["kind"], eclipse: boolean): BulletFx {
    const group = new THREE.Group();
    const materials: THREE.MeshBasicMaterial[] = [];
    const part = (geometry: THREE.BufferGeometry, col: number, opacity: number, additive = false) => {
      const material = this.acquireMaterial(additive, col, opacity);
      materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);
      return mesh;
    };
    if (kind === "well") {
      part(this.discGeometry, eclipse ? 0x120616 : 0x0a0714, 0).position.y = 0.005;
      part(this.ringGeometry, eclipse ? MAGENTA : 0xd1b5ff, 0.6, true).position.y = 0.02;
      part(this.thickRingGeometry, eclipse ? WHITE : 0xd1b5ff, 0.5, true).position.y = 0.03;
    } else if (kind === "hum") part(this.thickRingGeometry, CYAN, 0.55, true).rotation.x = -Math.PI / 2 + 0.6;
    else if (kind === "base") part(this.ringGeometry, heroTint(this.heroId), 0.5, true);
    this.fx.add(group);
    return { kind, group, materials, timer: 0, eclipse, grow: 0 };
  }
  private disposeBulletFx(fx: BulletFx) {
    fx.group.removeFromParent();
    for (const m of fx.materials) this.releaseMaterial(m);
    fx.group.clear();
  }
  /** Continuous effects around deployed and fused bullets: wells, hum rings, sheds and turret bases. */
  private updateBulletFx(run: SurvivalRun, dt: number, t: number, alpha: number) {
    this.wells.length = 0;
    const reduced = this.reducedMotion;
    const keep = new Set<number>();
    for (const b of run.bullets as Bullet[]) {
      if (b.enemy || b.child) continue;
      const spec = b.behavior;
      const kind: BulletFx["kind"] | "shed" | null = spec?.pull
        ? "well"
        : b.weapon === "tesla_orb"
          ? "hum"
          : b.weapon === "sentry" && spec?.stationary
            ? "base"
            : b.weapon === "halo"
              ? "shed"
              : null;
      if (!kind) continue;
      const eclipse = b.weapon === "eclipse";
      let fx = this.bulletFx.get(b.id);
      if (!fx) {
        fx = this.makeBulletFx(kind === "shed" ? "hum" : kind, eclipse);
        if (kind === "shed") fx.group.visible = false;
        this.bulletFx.set(b.id, fx);
      }
      keep.add(b.id);
      const at = interpolatedPosition(b, alpha);
      fx.timer -= dt;
      fx.group.position.set(at.x, 0.06, at.y);
      if (kind === "well" && spec?.pull) {
        const col = eclipse ? (fx.timer < -0.02 ? MAGENTA : WHITE) : 0xd1b5ff;
        const [disc, rim, inner] = fx.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
        if (b.fused) {
          const radius = spec.pull.radius;
          fx.grow = Math.min(1, fx.grow + dt * 3);
          disc.visible = rim.visible = inner.visible = true;
          disc.scale.setScalar(Math.max(0.01, lerp(0.3, eclipse ? 3.9 : radius * 0.55, fx.grow)));
          disc.material.opacity = 0.55 * fx.grow;
          const pulse = reduced ? 0 : Math.sin(t * 7);
          rim.scale.setScalar(radius * (1 + pulse * 0.025));
          rim.material.opacity = 0.4 + fx.grow * 0.3;
          inner.scale.setScalar(radius * (0.45 - pulse * 0.06));
          inner.rotation.z = t * (eclipse ? 2.5 : 1.2);
          if (fx.timer <= 0 && this.budget() > 0) {
            fx.timer += reduced ? 0.1 : eclipse ? 0.025 : 0.05;
            this.spawnVortex(at.x, at.y, col, radius * 0.9, 1, 6, radius * 1.6, 0.6, 0.35);
          }
          this.wells.push({ x: at.x, y: at.y, radius, eclipse });
        } else {
          disc.visible = rim.visible = inner.visible = false;
          if (fx.timer <= 0 && this.budget() > 0) {
            fx.timer += reduced ? 0.16 : 0.08;
            this.spawnVortex(at.x, at.y, col, 0.9, 1, 10, 1.5, 0.35, 0.3, 0.7);
          }
        }
      } else if (kind === "hum") {
        const ring = fx.group.children[0] as THREE.Mesh;
        fx.group.position.y = 0.9;
        ring.scale.setScalar(0.55 + (reduced ? 0 : Math.sin(t * 9) * 0.06));
        ring.rotation.z = reduced ? 0 : t * 4;
        if (fx.timer <= 0 && this.budget() > 0) {
          fx.timer += reduced ? 0.18 : 0.09;
          this.spawnParticles(at.x, 0.9, at.y, 1, CYAN, 2, 0.3, { gravity: 0, drag: 4, life: 0.2 });
        }
      } else if (kind === "shed") {
        if (fx.timer <= 0 && this.budget() > 0) {
          fx.timer += reduced ? 0.12 : 0.06;
          this.spawnParticles(at.x, 0.8, at.y, 1, ICE, 0.5, 0.3, { gravity: 1, drag: 1, life: 0.4 });
        }
      } else {
        const ring = fx.group.children[0] as THREE.Mesh;
        ring.scale.setScalar(0.75 + (reduced ? 0 : Math.sin(t * 4) * 0.03));
        ring.rotation.z = reduced ? 0 : t * 1.5;
      }
    }
    for (const [id, fx] of this.bulletFx)
      if (!keep.has(id)) {
        this.disposeBulletFx(fx);
        this.bulletFx.delete(id);
      }
  }
  /** Shells in flight from a strike to their target. */
  private updateLobs(dt: number) {
    const reduced = this.reducedMotion;
    this.lobs = this.lobs.filter((lob) => {
      lob.age += dt;
      const u = Math.min(1, lob.age / lob.duration);
      const distance = Math.hypot(lob.toX - lob.fromX, lob.toZ - lob.fromZ);
      const height = 1.2 + distance * 0.16;
      lob.mesh.position.set(
        lerp(lob.fromX, lob.toX, u),
        lerp(lob.fromY, 0.25, u) + height * 4 * u * (1 - u),
        lerp(lob.fromZ, lob.toZ, u),
      );
      const toxic = lob.weapon === "needle";
      if (!reduced) {
        lob.smoke -= dt;
        if (lob.smoke <= 0 && this.budget() > 0) {
          lob.smoke += 0.045;
          const p = lob.mesh.position;
          this.spawnParticles(p.x, p.y, p.z, 1, toxic ? SPORE : SMOKE, 0.5, toxic ? 0.3 : 0.55, {
            drag: 3,
            gravity: toxic ? 4 : 0,
            life: 0.45,
            lift: toxic ? 0 : 0.5,
            spin: 0.4,
          });
        }
      }
      if (u < 1) return true;
      if (toxic) this.spawnParticles(lob.toX, 0.3, lob.toZ, this.count(8), SPORE, 2, 0.35, { gravity: 5, life: 0.4 });
      lob.mesh.removeFromParent();
      this.lobPool.push(lob);
      return false;
    });
  }
  private makeStatusFx(): StatusFx {
    const group = new THREE.Group();
    const materials: THREE.MeshBasicMaterial[] = [];
    const status = new THREE.Mesh(this.ringGeometry, this.acquireMaterial(false, ICE, 0.6));
    const elite = new THREE.Mesh(this.thickRingGeometry, this.acquireMaterial(false, 0xffd166, 0.7));
    materials.push(status.material, elite.material);
    status.rotation.x = elite.rotation.x = -Math.PI / 2;
    elite.position.y = -0.005;
    group.add(status, elite);
    return { group, status, elite, materials, emit: 0 };
  }
  private disposeStatusFx(fx: StatusFx) {
    fx.group.removeFromParent();
    for (const m of fx.materials) this.releaseMaterial(m);
  }
  /** Status ring, elite ring, shield bubble and slow emitters for one enemy; returns the rig tint. */
  private updateEnemyStatus(
    e: Enemy,
    r: Rig,
    x: number,
    z: number,
    dt: number,
    t: number,
  ): { hurt: boolean; color: number; intensity: number } {
    const reduced = this.reducedMotion;
    const frozen = (e.freezeTime ?? 0) > 0,
      burn = e.burnTime > 0,
      poison = e.poisonTime > 0,
      slow = e.slowTime > 0;
    const statusColor = frozen
      ? STATUS_COLOR.frozen
      : burn
        ? STATUS_COLOR.burn
        : poison
          ? STATUS_COLOR.poison
          : slow
            ? STATUS_COLOR.slow
            : 0;
    const needs = statusColor !== 0 || !!e.elite;
    let fx = this.statusRings.get(e.id);
    if (needs && !fx) {
      fx = this.makeStatusFx();
      this.statusRings.set(e.id, fx);
      this.actors.add(fx.group);
    }
    if (fx) {
      if (!needs) {
        this.disposeStatusFx(fx);
        this.statusRings.delete(e.id);
      } else {
        fx.group.position.set(x, 0.065, z);
        const wobble = reduced ? 0 : Math.sin(t * 7 + e.id);
        fx.status.visible = statusColor !== 0;
        if (fx.status.visible) {
          (fx.status.material as THREE.MeshBasicMaterial).color.setHex(statusColor);
          (fx.status.material as THREE.MeshBasicMaterial).opacity = 0.5 + wobble * 0.15;
          fx.status.scale.setScalar(e.radius * (2.4 + wobble * 0.25));
        }
        fx.elite.visible = !!e.elite;
        if (fx.elite.visible) {
          fx.elite.scale.setScalar(e.radius * 3);
          fx.elite.rotation.z = reduced ? 0 : t * 0.8;
        }
        if (!reduced && (burn || poison)) {
          fx.emit -= dt;
          if (fx.emit <= 0 && this.budget() > 0) {
            fx.emit += burn ? 0.12 : 0.18;
            const height = (r.root.userData.visualHeight ?? 2) * (0.3 + Math.random() * 0.5);
            this.spawnParticles(x, height, z, 1, burn ? EMBER : STATUS_COLOR.poison, 0.6, burn ? 0.4 : 0.35, {
              gravity: 0,
              lift: burn ? 1.6 : 1,
              life: burn ? 0.5 : 0.6,
              drag: 1,
            });
          }
        }
      }
    }
    if (e.maxShield > 0) {
      let bubble = this.shieldBubbles.get(e.id);
      if (!bubble) {
        // Additive and faint: a glow around the body rather than a white dome over the crowd.
        bubble = new THREE.Mesh(
          this.bubbleGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x5fb8e6,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        this.actors.add(bubble);
        this.shieldBubbles.set(e.id, bubble);
      }
      const height = r.root.userData.visualHeight ?? 2;
      bubble.visible = e.shield > 0;
      bubble.position.set(x, height * 0.5, z);
      const pulse = reduced ? 0 : Math.sin(t * 5 + e.id) * 0.03;
      bubble.scale.set(e.radius * 1.9 * (1 + pulse), height * 0.58, e.radius * 1.9 * (1 + pulse));
      bubble.material.opacity = 0.04 + 0.07 * Math.min(1, e.shield / e.maxShield);
    }
    if (e.hitTime > 0) return { hurt: true, color: 0xffd0a8, intensity: 0.22 };
    if (frozen) return { hurt: true, color: STATUS_COLOR.frozen, intensity: 0.55 };
    if (burn) return { hurt: true, color: STATUS_COLOR.burn, intensity: 0.3 };
    if (poison) return { hurt: true, color: STATUS_COLOR.poison, intensity: 0.28 };
    return { hurt: false, color: 0xffd0a8, intensity: 0.22 };
  }
  /** Lean a rig toward every well it stands in, pulling a little dust with it. */
  private strain(r: Rig, e: { x: number; y: number; angle: number }, x: number, z: number, dt: number) {
    if (this.reducedMotion) return;
    for (const w of this.wells) {
      const d = Math.hypot(w.x - x, w.y - z);
      if (d >= w.radius || d < 0.2) continue;
      const lean = (w.eclipse ? 0.4 : 0.28) * (1 - d / w.radius);
      const toward = Math.atan2(w.y - z, w.x - x);
      const rel = toward - e.angle;
      r.body.rotation.x += lean * Math.cos(rel);
      r.body.rotation.z += lean * Math.sin(rel);
      if (Math.random() < dt * 6 && this.budget() > 0)
        this.spawnParticles(x, 0.15, z, 1, DUST, 3, 0.4, { direction: toward, spread: 0.2, gravity: 0, life: 0.35 });
    }
  }
  /** The player's bubble, barrier shards, ability and blood rings, and Bastion's dust trail. */
  private updatePlayerFx(run: SurvivalRun, dt: number, t: number, x: number, z: number) {
    const p = run.player;
    const reduced = this.reducedMotion;
    const bubble = this.playerBubble;
    const scale = this.player.root.scale.x;
    bubble.visible = p.barrier > 0;
    if (bubble.visible) {
      bubble.position.set(x, 1.15 * scale, z);
      bubble.scale.setScalar(1.05 * scale * (1 + (reduced ? 0 : Math.sin(t * 5) * 0.03)));
      bubble.material.opacity = 0.16 + (reduced ? 0 : Math.sin(t * 5) * 0.04);
    }
    const want = bubble.visible ? Math.min(6, Math.round(p.barrier)) : 0;
    while (this.barrierShards.length < want) {
      const shard = new THREE.Mesh(this.shardGeometry, glowMaterial(CYAN));
      this.fx.add(shard);
      this.barrierShards.push(shard);
    }
    this.barrierShards.forEach((shard, i) => {
      shard.visible = i < want;
      if (!shard.visible) return;
      const a = t * 2.2 + (i * Math.PI * 2) / want;
      shard.position.set(x + Math.cos(a) * 1.35 * scale, (1.1 + Math.sin(t * 3 + i) * 0.15) * scale, z + Math.sin(a) * 1.35 * scale);
      shard.rotation.y = t * 3;
    });
    const ability = this.abilityRing;
    ability.visible = this.heroId === "wisp" && p.abilityTime > 0;
    if (ability.visible) {
      ability.position.set(x, 0.06, z);
      ability.scale.setScalar(2.4 + (reduced ? 0 : Math.sin(t * 8) * 0.1));
      ability.rotation.z = reduced ? 0 : t * 2;
      ability.material.opacity = 0.35 + (reduced ? 0 : Math.sin(t * 8) * 0.15);
    }
    const stacks = run.bloodlustStacks;
    const blood = this.bloodRing;
    blood.visible = this.heroId === "reaper" && stacks > 0;
    if (blood.visible) {
      blood.position.set(x, 0.06, z);
      blood.scale.setScalar(1.2 + stacks * 0.12);
      blood.material.opacity = 0.15 + stacks * 0.055;
      blood.material.color.setHex(mixHex(0x6a0a1e, 0xff2a4a, stacks / 10));
    }
    if (p.dashTime > 0 && this.heroId === "bastion" && !reduced && t - this.lastEmber > 0.06) {
      this.lastEmber = t;
      this.ring(x, z, 0xc9a27a, 1.6, 0.3, 0.5, 0.5);
      this.spawnParticles(x, 0.15, z, 4, DUST, 2, 0.6, { gravity: 3, life: 0.4 });
    }
    this.punch = Math.max(0, this.punch - dt);
    this.viewPunch = reduced || this.punch <= 0 ? 0 : Math.sin((this.punch / 0.4) * Math.PI) * 1.4;
  }
  update(dt: number, run: SurvivalRun | null) {
    this.time += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    const t = this.time;
    const alpha = run?.renderAlpha ?? 1;
    const at = (entity: {
      x: number;
      y: number;
      prevX?: number;
      prevY?: number;
    }) => interpolatedPosition(entity, alpha);
    this.viewSize = this.reducedMotion
      ? this.menu
        ? 8
        : 24
      : lerp(this.viewSize, this.menu ? 8 : 24, Math.min(1, dt * 5));
    this.updateProjection();
    if (this.menu) {
      this.camPosition.lerp(new THREE.Vector3(0, 5.2, 11), Math.min(1, dt * 4));
      this.cameraTarget.lerp(new THREE.Vector3(0, 1.9, 0), Math.min(1, dt * 4));
      animateRig(
        this.preview,
        this.reducedMotion ? 0 : t,
        0,
        Math.PI / 2 +
          0.43 +
          (this.reducedMotion ? 0 : Math.sin(t * 0.25) * 0.1),
        dt,
      );
      this.preview.root.position.y = 0.027 - 0.015 * this.preview.root.scale.y;
      this.previewFloor.rotation.y = 0;
    } else if (run) {
      const p = run.player;
      const visualPlayer = at(p);
      const target = new THREE.Vector3(p.x * 0.58, 0, p.y * 0.58);
      this.cameraTarget.lerp(target, Math.min(1, dt * 4));
      this.camPosition.lerp(
        new THREE.Vector3(target.x, 31, target.z + 23),
        Math.min(1, dt * 4),
      );
      this.player.root.scale.setScalar(
        1.26 *
          Math.min(
            1,
            3.45 / ((this.player.root.userData.visualHeight ?? 3) + 0.18),
          ),
      );
      this.player.root.position.set(
        visualPlayer.x,
        p.dashTime > 0 ? 0.12 : 0,
        visualPlayer.y,
      );
      animateRig(
        this.player,
        t,
        Math.hypot(p.vx, p.vy),
        p.angle,
        dt,
        p.dashTime > 0,
        this.damageFlash > 0,
        0xff2520,
        1.2,
      );
      this.selectionRing.position.set(visualPlayer.x, 0.04, visualPlayer.y);
      this.selectionRing.scale.setScalar(0.79 + Math.sin(t * 4) * 0.025);
      (this.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(
        this.damageFlash > 0 ? 0xff3830 : COLORS[this.heroId],
      );
      if (
        Math.hypot(p.vx, p.vy) > 1 &&
        t - this.lastFoot > 0.13 &&
        run.phase === "combat"
      ) {
        this.lastFoot = t;
        this.spawnParticles(p.x, 0.1, p.y, 2, 0x92887a, 1, 0.45);
      }
      if (p.dashTime > 0 && t - this.lastDash > 0.018) {
        this.lastDash = t;
        this.spawnParticles(p.x, 0.8, p.y, this.count(5), COLORS[this.heroId], 1, 0.75);
      }
      this.updatePlayerFx(run, dt, t, visualPlayer.x, visualPlayer.y);
      // Wells first, so the enemy loop can lean rigs toward them this frame.
      this.updateBulletFx(run, dt, t, alpha);
      const alive = new Set(run.enemies.map((e) => e.id));
      for (const [id, r] of this.enemies)
        if (!alive.has(id)) {
          r.root.removeFromParent();
          const key = r.root.userData.poolKey ?? r.kind;
          if (!this.enemyPools.has(key)) this.enemyPools.set(key, []);
          this.enemyPools.get(key)!.push(r);
          this.enemies.delete(id);
        }
      for (const [id, fx] of this.statusRings)
        if (!alive.has(id)) {
          this.disposeStatusFx(fx);
          this.statusRings.delete(id);
        }
      for (const [id, bubble] of this.shieldBubbles)
        if (!alive.has(id)) {
          bubble.removeFromParent();
          bubble.material.dispose();
          this.shieldBubbles.delete(id);
        }
      let barIndex = 0,
        shieldIndex = 0;
      for (const e of run.enemies) {
        let r = this.enemies.get(e.id);
        if (!r) {
          const key =
            e.kind === "boss" ? `boss-${((e.bossTier - 1) % 10) + 1}` : e.kind;
          r = this.enemyPools.get(key)?.pop() ?? makeEnemy(e.kind, e.bossTier);
          r.root.userData.poolKey = key;
          // Elites spawn with a larger radius than their kind; the rig grows to match.
          const stats = ENEMY_STATS[e.kind];
          const bulk =
            stats && stats.radius > 0 && e.radius > 0
              ? e.radius / stats.radius
              : 1;
          if (r.root.userData.baseScale === undefined)
            r.root.userData.baseScale = r.root.scale.x;
          const baseScale = r.root.userData.baseScale as number;
          if (!r.root.userData.baseHeight) {
            r.root.scale.setScalar(baseScale);
            r.root.userData.baseHeight = new THREE.Box3().setFromObject(
              r.root,
            ).max.y;
          }
          r.root.scale.setScalar(baseScale * bulk);
          r.root.userData.visualHeight =
            (r.root.userData.baseHeight as number) * bulk;
          this.enemies.set(e.id, r);
          this.actors.add(r.root);
        }
        const speed = Math.hypot(e.vx, e.vy);
        const visual = at(e);
        r.root.position.set(visual.x, 0, visual.y);
        const tint = this.updateEnemyStatus(e, r, visual.x, visual.y, dt, t);
        animateRig(
          r,
          t + e.id * 0.37,
          Math.min(speed, 8),
          e.angle,
          dt,
          e.state === "charge",
          tint.hurt,
          tint.color,
          tint.intensity,
        );
        if (this.wells.length) this.strain(r, e, visual.x, visual.y, dt);
        // Two instanced draws supply all enemy health bars, even in a large crowd.
        if (barIndex < 160 && e.hp > 0) {
          const width =
            e.kind === "boss" ? 3.1 : e.kind === "brute" ? 1.28 : 0.92;
          const height = (r.root.userData.visualHeight ?? 2.2) + 0.28;
          const ratio = Math.max(0, e.hp / e.maxHp);
          scratch.position.set(visual.x, height, visual.y);
          scratch.quaternion.copy(this.camera.quaternion);
          scratch.scale.set(width, 0.13, 1);
          scratch.updateMatrix();
          this.healthBack.setMatrixAt(barIndex, scratch.matrix);
          const offset = new THREE.Vector3(
            (ratio - 1) * width * 0.5,
            0,
            0,
          ).applyQuaternion(this.camera.quaternion);
          scratch.position.add(offset);
          scratch.scale.set(Math.max(0.001, width * ratio), 0.075, 1);
          scratch.updateMatrix();
          this.healthFill.setMatrixAt(barIndex, scratch.matrix);
          this.healthFill.setColorAt(
            barIndex,
            color.setHex(
              e.slowTime > 0
                ? 0x87dbfa
                : e.poisonTime > 0
                  ? 0xa6d871
                  : 0xef947e,
            ),
          );
          if (e.shield > 0 && e.maxShield > 0) {
            const shieldRatio = Math.min(1, e.shield / e.maxShield);
            scratch.position
              .set(visual.x, height, visual.y)
              .add(
                new THREE.Vector3(
                  (shieldRatio - 1) * width * 0.5,
                  0.14,
                  0,
                ).applyQuaternion(this.camera.quaternion),
              );
            scratch.scale.set(width * shieldRatio, 0.045, 1);
            scratch.updateMatrix();
            this.shieldFill.setMatrixAt(shieldIndex++, scratch.matrix);
          }
          barIndex++;
        }
        if (e.state === "windup") {
          r.body.position.y -= 0.13 * e.telegraph;
          let m = this.telegraphs.get(e.id);
          if (!m) {
            m = new THREE.Mesh(this.ringGeometry, this.telegraphMaterial);
            m.rotation.x = -Math.PI / 2;
            if (
              e.kind === "charger" ||
              (e.kind === "boss" &&
                [1, 9].includes(e.bossVariant) &&
                e.attackCount % 3 === 0)
            ) {
              const arrow = new THREE.Mesh(
                this.chargeGeometry,
                this.telegraphMaterial,
              );
              if (e.kind === "boss") arrow.scale.setScalar(0.48);
              m.add(arrow);
            }
            if (e.kind === "sniper")
              m.add(new THREE.Mesh(this.aimGeometry, this.telegraphMaterial));
            this.actors.add(m);
            this.telegraphs.set(e.id, m);
          }
          m.position.set(e.x, 0.1, e.y);
          if (m.children[0]) m.children[0].rotation.z = -e.angle - Math.PI / 2;
          m.scale.setScalar(
            e.kind === "boss" ? 5 : e.kind === "charger" ? 2 : 1.4,
          );
        } else {
          this.telegraphs.get(e.id)?.removeFromParent();
          this.telegraphs.delete(e.id);
        }
        if (e.kind === "shielder" || e.kind === "medic") {
          let aura = this.enemyAuras.get(e.id);
          if (!aura) {
            aura = new THREE.Mesh(
              this.ringGeometry,
              e.kind === "medic" ? this.medicAuraMaterial : this.auraMaterial,
            );
            aura.rotation.x = -Math.PI / 2;
            this.actors.add(aura);
            this.enemyAuras.set(e.id, aura);
          }
          aura.visible = e.kind === "medic" || e.shield > 0;
          aura.position.set(visual.x, 0.075, visual.y);
          aura.scale.setScalar(e.kind === "medic" ? 5 : 3.2);
        }
      }
      this.shieldFill.count = shieldIndex;
      this.shieldFill.instanceMatrix.needsUpdate = true;
      this.healthBack.count = this.healthFill.count = barIndex;
      this.healthBack.instanceMatrix.needsUpdate =
        this.healthFill.instanceMatrix.needsUpdate = true;
      if (this.healthFill.instanceColor)
        this.healthFill.instanceColor.needsUpdate = true;
      for (const [id, m] of this.telegraphs)
        if (!alive.has(id)) {
          m.removeFromParent();
          this.telegraphs.delete(id);
        }
      for (const [id, aura] of this.enemyAuras) {
        if (alive.has(id)) continue;
        aura.removeFromParent();
        this.enemyAuras.delete(id);
      }
      // Physical hands carry weapons. Only items classified as drones orbit.
      const equipped = new Set(run.weapons.map((weapon) => weapon.id));
      for (const [id, mesh] of this.heldWeapons) {
        if (!equipped.has(id)) {
          this.recycleEquipment(mesh);
          this.heldWeapons.delete(id);
          this.weaponMotion.delete(id);
        }
      }
      for (const weapon of run.weapons) {
        const key = `${weapon.kind}:${weapon.level}`;
        let mesh = this.heldWeapons.get(weapon.id);
        if (mesh && mesh.userData.poolKey !== key) {
          this.recycleEquipment(mesh);
          this.heldWeapons.delete(weapon.id);
          mesh = undefined;
        }
        const mount = this.player.weaponMounts[weapon.slot];
        if (!mount) continue;
        if (!mesh) {
          mesh = this.acquireEquipment(weapon.kind, weapon.level);
          this.heldWeapons.set(weapon.id, mesh);
        }
        if (mesh.parent !== mount) mount.add(mesh);
        mesh.userData.weaponId = weapon.id;
        mesh.scale.setScalar(weaponScale(weapon.kind));
        const duration = Math.min(
          weaponRecovery(weapon.kind),
          (WEAPONS[weapon.kind].cooldown / run.stats.attackSpeed) * 0.85,
        );
        const motion = Math.max(
          0,
          (this.weaponMotion.get(weapon.id) ?? 0) - dt / duration,
        );
        this.weaponMotion.set(weapon.id, motion);
        poseHeldWeapon(this.player, mesh, weapon.slot, weapon.kind, motion);
      }
      const activeDrones = run.drones;
      const droneIds = new Set(activeDrones.map((drone) => drone.id));
      for (const [id, mesh] of this.drones) {
        if (!droneIds.has(id)) {
          this.recycleEquipment(mesh);
          this.drones.delete(id);
        }
      }
      for (const [index, drone] of activeDrones.entries()) {
        const key = `${drone.kind}:${drone.level}`;
        let mesh = this.drones.get(drone.id);
        if (mesh && mesh.userData.poolKey !== key) {
          this.recycleEquipment(mesh);
          this.drones.delete(drone.id);
          mesh = undefined;
        }
        if (!mesh) {
          mesh = this.acquireEquipment(drone.kind, drone.level);
          this.actors.add(mesh);
          this.drones.set(drone.id, mesh);
        }
        // Spin-up: the drone swells and kicks its yaw while `pulse` decays after an attack.
        const pulse = this.reducedMotion ? 0 : drone.pulse;
        mesh.scale.setScalar((0.57 + (drone.level - 1) * 0.025) * (1 + pulse * 0.5));
        const position = at(drone);
        mesh.position.set(
          position.x,
          1.2 + Math.sin(t * 3 + index) * 0.1 + pulse * 0.3,
          position.y,
        );
        mesh.rotation.y = Math.PI / 2 - drone.aimAngle + pulse * 3;
        if (drone.kind === "orbit_drone") mesh.rotation.y = t * 3;
      }
      this.updateHazards(run, dt);
      this.updateSpawnMarkers(run);
      const ctx = this.projectileContext;
      ctx.alpha = alpha;
      ctx.time = t;
      ctx.dt = dt;
      ctx.reducedMotion = this.reducedMotion;
      ctx.cameraQuaternion.copy(this.camera.quaternion);
      this.projectiles.update(run.bullets, ctx);
      this.updateLobs(dt);
      const pickups = new Set(run.pickups.map((p) => p.id));
      for (const [id, m] of this.pickupMeshes)
        if (!pickups.has(id)) {
          m.removeFromParent();
          this.pickupMeshes.delete(id);
        }
      for (const pickup of run.pickups) {
        let mesh = this.pickupMeshes.get(pickup.id);
        if (!mesh) {
          mesh = new THREE.Mesh(
            this.pickupGeometry,
            glowMaterial(pickup.kind === "heal" ? 0xd2f6d8 : 0x24f4a2),
          );
          this.actors.add(mesh);
          this.pickupMeshes.set(pickup.id, mesh);
        }
        mesh.position.set(
          at(pickup).x,
          0.3 + Math.sin(t * 5 + pickup.id) * 0.07,
          at(pickup).y,
        );
        mesh.rotation.y = t * 2;
        mesh.rotation.z = Math.PI / 4;
        mesh.scale.setScalar(
          pickup.kind === "heal" ? 1.8 : 1 + Math.min(1, pickup.value * 0.12),
        );
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const j = this.reducedMotion || dt === 0 ? 0 : this.shake;
    this.camera.position
      .copy(this.camPosition)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * j,
          0,
          (Math.random() - 0.5) * j,
        ),
      );
    this.camera.lookAt(this.cameraTarget);
    this.ambient.rotation.y = this.reducedMotion ? 0 : t * 0.007;
    this.tickEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }
  /** Advances particles, rings, labels and flashes by dt; separate from update so tests can drive it without a renderer. */
  tickEffects(dt: number) {
    this.particles = this.particles.filter((p) => p.life > 0);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.orbit) {
        // Spiral inward: the angle advances and the radius shrinks; only y is ballistic.
        const o = p.orbit;
        o.angle += o.rate * dt;
        o.radius = Math.max(0, o.radius - o.shrink * dt);
        p.x = o.cx + Math.cos(o.angle) * o.radius;
        p.z = o.cz + Math.sin(o.angle) * o.radius;
        p.y += p.vy * dt;
        if (o.radius <= 0.05) p.life = Math.min(p.life, 0.08);
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      if (p.y < 0.07) {
        p.y = 0.07;
        p.vy = Math.abs(p.vy) * 0.25;
        p.vx *= 0.92;
        p.vz *= 0.92;
      }
      scratch.position.set(p.x, p.y, p.z);
      scratch.rotation.set(p.life * 4 * p.spin, p.life * 5 * p.spin, p.life * 3 * p.spin);
      scratch.scale.setScalar(p.size * Math.min(1, p.life * 4));
      scratch.updateMatrix();
      this.particleMesh.setMatrixAt(i, scratch.matrix);
      this.particleMesh.setColorAt(i, p.color);
    }
    this.particleMesh.count = this.particles.length;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor)
      this.particleMesh.instanceColor.needsUpdate = true;
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        this.retireRing(r);
        return false;
      }
      const progress = 1 - r.life / r.max;
      if (r.animate) r.mesh.scale.setScalar(lerp(r.start, r.radius, progress));
      r.material.opacity = (1 - progress) * r.opacity;
      return true;
    });
    this.labels = this.labels.filter((l) => {
      l.life -= dt;
      if (l.life <= 0) {
        l.sprite.removeFromParent();
        l.sprite.material.dispose();
        return false;
      }
      l.sprite.position.y += dt * 1.45;
      l.sprite.material.opacity = Math.min(1, l.life * 4);
      return true;
    });
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) {
        f.object.removeFromParent();
        this.flashPool.push(f);
        return false;
      }
      const progress = 1 - f.life / f.max;
      f.material.opacity = 1 - progress;
      const grow = f.size * (0.55 + progress * 0.45);
      if (f.cone) f.object.scale.set(grow * 0.5, grow * 0.5, grow);
      else f.object.scale.set(grow, grow, 1);
      return true;
    });
  }
  /** The object carrying a player-side owner's muzzle: a held weapon or a drone. */
  private muzzleOf(ownerId: number) {
    return this.heldWeapons.get(ownerId) ?? this.drones.get(ownerId);
  }
  /** World position of an owner's barrel: held weapon, drone, or a deployed turret. */
  muzzleWorld(ownerId: number, out: THREE.Vector3) {
    const mesh = this.muzzleOf(ownerId);
    const muzzle = mesh?.userData.muzzle as THREE.Vector3 | undefined;
    if (mesh && muzzle) {
      mesh.updateWorldMatrix(true, false);
      mesh.localToWorld(out.copy(muzzle));
      return true;
    }
    return this.projectiles.muzzle(ownerId, out);
  }
  /** Where a fire event's flash belongs: the firing turret, the enemy's barrel, or the hand. */
  private eventMuzzle(event: GameEvent, out = new THREE.Vector3()) {
    if (event.source !== undefined && this.projectiles.muzzle(event.source, out))
      return out;
    if (event.enemy) {
      const enemyMuzzle =
        event.id !== undefined
          ? (this.enemies.get(event.id)?.root.userData.muzzleObject as
              THREE.Object3D | undefined)
          : undefined;
      if (enemyMuzzle) return enemyMuzzle.getWorldPosition(out);
    } else if (event.id !== undefined && this.muzzleWorld(event.id, out))
      return out;
    return out.set(event.x, 1.45, event.y);
  }
  private previewScale(rig: Rig) {
    return (
      1.62 * Math.min(1, 3.1 / ((rig.root.userData.visualHeight ?? 3) + 0.2))
    );
  }
  private preparePreview(rig: Rig, hero: HeroId) {
    if (rig.root.userData.equipmentReady) return;
    const starter = makeEquipment(HEROES[hero].weapon, 1);
    starter.scale.setScalar(weaponScale(HEROES[hero].weapon));
    rig.weaponMounts[0]?.add(starter);
    poseHeldWeapon(rig, starter, 0, HEROES[hero].weapon);
    rig.root.userData.equipmentReady = true;
    if (hero === "wisp") {
      const drone = makeEquipment("gun_drone", 1);
      drone.position.set(-1.08, 1.9, 0.12);
      drone.scale.setScalar(0.65);
      rig.root.add(drone);
    }
  }
  private acquireEquipment(kind: string, level: number) {
    const key = `${kind}:${level}`;
    const mesh =
      this.equipmentPool.get(key)?.pop() ?? makeEquipment(kind, level);
    mesh.userData.poolKey = key;
    mesh.userData.kind = kind;
    return mesh;
  }
  private updateHazards(run: SurvivalRun, dt = 0) {
    const visible = new Set(run.hazards.map((hazard) => hazard.id));
    for (const [id, group] of this.hazardMeshes) {
      if (visible.has(id)) continue;
      group.removeFromParent();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh)
          (object.material as THREE.Material).dispose();
      });
      this.hazardMeshes.delete(id);
    }
    for (const hazard of run.hazards) {
      let group = this.hazardMeshes.get(hazard.id);
      if (!group) {
        group = new THREE.Group();
        // Flare's scorch trail reads as fire; other player blasts amber; enemy blasts red.
        const tint =
          hazard.kind === "toxic"
            ? 0xafdb66
            : hazard.weapon === "flare"
              ? EMBER
              : hazard.owner === "player"
                ? 0xffa860
                : 0xff6e4e;
        const fill = new THREE.Mesh(
          this.hazardDisc,
          new THREE.MeshBasicMaterial({
            color: tint,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const edge = new THREE.Mesh(
          this.ringGeometry,
          new THREE.MeshBasicMaterial({
            color: tint,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        fill.rotation.x = edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.01;
        group.add(fill, edge);
        this.actors.add(group);
        this.hazardMeshes.set(hazard.id, group);
      }
      group.position.set(hazard.x, 0.09, hazard.y);
      group.scale.setScalar(hazard.radius);
      const progress = Math.min(1, hazard.age / Math.max(0.01, hazard.delay));
      const fill = group.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      const edge = group.children[1] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      fill.scale.setScalar(hazard.triggered ? 1 : Math.max(0.02, progress));
      fill.material.opacity = hazard.triggered ? 0.22 : 0.08 + progress * 0.13;
      edge.material.opacity = hazard.triggered ? 0.7 : 0.45 + progress * 0.4;
      // Embers rise off a burning scorch; budget-gated and off under reduced motion.
      if (
        hazard.weapon === "flare" &&
        hazard.triggered &&
        !this.reducedMotion &&
        Math.random() < dt * 8 &&
        this.budget() > 0
      )
        this.spawnParticles(hazard.x, 0.2, hazard.y, 1, EMBER, 0.4, 0.4, {
          radius: hazard.radius * 0.8,
          gravity: 0,
          lift: 1.4,
          life: 0.6,
          drag: 1,
        });
    }
  }
  /** Rings over queued spawns that tighten and brighten as the enemy's arrival nears. */
  private updateSpawnMarkers(run: SurvivalRun) {
    const queue = (run as { spawnQueue?: SpawnMarker[] }).spawnQueue ?? [];
    const visible = new Set(queue.map((marker) => marker.id));
    for (const [id, group] of this.spawnMarkerMeshes) {
      if (visible.has(id)) continue;
      this.disposeMarker(group);
      this.spawnMarkerMeshes.delete(id);
    }
    for (const marker of queue) {
      let group = this.spawnMarkerMeshes.get(marker.id);
      if (!group) {
        group = new THREE.Group();
        const ring = new THREE.Mesh(
          marker.elite ? this.thickRingGeometry : this.ringGeometry,
          new THREE.MeshBasicMaterial({
            color: 0xe99460,
            transparent: true,
            opacity: 0.25,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);
        if (marker.horde) {
          const halo = new THREE.Mesh(
            this.ringGeometry,
            new THREE.MeshBasicMaterial({
              color: 0xff6e4e,
              transparent: true,
              opacity: 0.15,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          halo.rotation.x = -Math.PI / 2;
          halo.position.y = -0.005;
          group.add(halo);
        }
        this.actors.add(group);
        this.spawnMarkerMeshes.set(marker.id, group);
      }
      group.position.set(marker.x, 0.085, marker.y);
      const progress = Math.min(
        1,
        Math.max(0, marker.age / Math.max(0.01, marker.delay)),
      );
      const scale = lerp(marker.radius * 2.2, marker.radius * 1.3, progress);
      const ring = group.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      ring.scale.setScalar(scale);
      ring.material.opacity = lerp(0.25, 0.85, progress);
      const halo = group.children[1] as
        THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
      if (halo) {
        halo.scale.setScalar(scale * 1.45);
        halo.material.opacity = 0.15 + progress * 0.45;
      }
    }
  }
  private disposeMarker(group: THREE.Group) {
    group.removeFromParent();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh)
        (object.material as THREE.Material).dispose();
    });
  }
  private recycleEquipment(drone: THREE.Group) {
    drone.removeFromParent();
    const key = drone.userData.poolKey as string;
    if (!this.equipmentPool.has(key)) this.equipmentPool.set(key, []);
    this.equipmentPool.get(key)!.push(drone);
  }
  dispose() {
    this.resizeObserver.disconnect();
    this.reset();
    this.projectiles.dispose();
    for (const f of this.flashPool) f.material.dispose();
    this.flashPool = [];
    this.flashConeGeometry.dispose();
    for (const m of [...this.materialPool.normal, ...this.materialPool.additive]) m.dispose();
    this.materialPool.normal = [];
    this.materialPool.additive = [];
    for (const lob of this.lobPool) lob.material.dispose();
    this.lobPool = [];
    this.playerBubble.material.dispose();
    this.abilityRing.material.dispose();
    this.bloodRing.material.dispose();
    for (const shard of this.barrierShards) shard.removeFromParent();
    this.barrierShards = [];
    // Shard and bubble materials come from the geometry.ts glow cache and stay.
    for (const geometry of [
      this.discGeometry,
      this.segmentGeometry,
      this.sweepGeometry,
      this.bubbleGeometry,
      this.shardGeometry,
      this.shellGeometry,
    ])
      geometry.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
  reset() {
    for (const r of this.enemies.values()) {
      r.root.removeFromParent();
      const key = r.root.userData.poolKey ?? r.kind;
      if (!this.enemyPools.has(key)) this.enemyPools.set(key, []);
      this.enemyPools.get(key)!.push(r);
    }
    this.enemies.clear();
    this.healthBack.count = this.healthFill.count = this.shieldFill.count = 0;
    this.damageFlash = 0;
    for (const m of [...this.pickupMeshes.values(), ...this.telegraphs.values()])
      m.removeFromParent();
    this.projectiles.reset();
    this.pickupMeshes.clear();
    this.telegraphs.clear();
    this.particles = [];
    this.particleMesh.count = 0;
    this.shake = 0;
    for (const f of this.flashes) {
      f.object.removeFromParent();
      this.flashPool.push(f);
    }
    this.flashes = [];
    for (const ring of this.rings) this.retireRing(ring);
    this.rings = [];
    for (const fx of this.bulletFx.values()) this.disposeBulletFx(fx);
    this.bulletFx.clear();
    for (const fx of this.statusRings.values()) this.disposeStatusFx(fx);
    this.statusRings.clear();
    for (const bubble of this.shieldBubbles.values()) {
      bubble.removeFromParent();
      bubble.material.dispose();
    }
    this.shieldBubbles.clear();
    for (const lob of this.lobs) {
      lob.mesh.removeFromParent();
      this.lobPool.push(lob);
    }
    this.lobs = [];
    this.wells.length = 0;
    this.playerBubble.visible = false;
    for (const shard of this.barrierShards) shard.visible = false;
    this.abilityRing.visible = false;
    this.bloodRing.visible = false;
    this.punch = this.viewPunch = 0;
    for (const label of this.labels) {
      label.sprite.removeFromParent();
      label.sprite.material.dispose();
    }
    this.labels = [];
    for (const drone of this.drones.values()) this.recycleEquipment(drone);
    this.drones.clear();
    for (const weapon of this.heldWeapons.values())
      this.recycleEquipment(weapon);
    this.heldWeapons.clear();
    this.weaponMotion.clear();
    for (const group of this.hazardMeshes.values()) {
      group.removeFromParent();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh)
          (object.material as THREE.Material).dispose();
      });
    }
    this.hazardMeshes.clear();
    for (const group of this.spawnMarkerMeshes.values())
      this.disposeMarker(group);
    this.spawnMarkerMeshes.clear();
    for (const aura of this.enemyAuras.values()) aura.removeFromParent();
    this.enemyAuras.clear();
  }
}
