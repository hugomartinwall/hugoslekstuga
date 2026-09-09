import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { interpolatedPosition } from "./motion";
import { poseHeldWeapon, weaponRecovery, weaponScale } from "./weapon-pose";
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
import type { SurvivalRun, GameEvent } from "./model";
import {
  HEROES,
  WEAPONS,
  ITEMS,
  CAMPAIGN_WAVES,
  MAPS,
  ENEMY_STATS,
  type HeroId,
  type EnemyKind,
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
};
type Ring = {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
  start: number;
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
  bulletMeshes = new Map<number, THREE.Mesh>();
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
  bulletGeometry = new THREE.SphereGeometry(0.11, 6, 4);
  pickupGeometry = new THREE.OctahedronGeometry(0.2);
  hazardDisc = new THREE.CircleGeometry(1, 48);
  ringGeometry = new THREE.RingGeometry(0.91, 1, 64);
  /** Heavier ring for elite spawn marks. */
  thickRingGeometry = new THREE.RingGeometry(0.84, 1, 64);
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
    this.camera.left = (-this.viewSize * aspect) / 2;
    this.camera.right = (this.viewSize * aspect) / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
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
  ) {
    for (let i = 0; i < count && this.particles.length < 850; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = force * (0.25 + Math.random() * 0.75);
      const life = 0.25 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * speed,
        vy: Math.random() * force * 0.8,
        vz: Math.sin(a) * speed,
        life,
        max: life,
        size: size * (0.4 + Math.random() * 0.6),
        color: new THREE.Color(col),
        gravity: 7,
      });
    }
  }
  private ring(
    x: number,
    y: number,
    col: number,
    radius: number,
    duration = 0.4,
    start = 0.1,
  ) {
    const mesh = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, y);
    this.fx.add(mesh);
    this.rings.push({ mesh, life: duration, max: duration, radius, start });
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
  handleEvents(events: GameEvent[]) {
    const arcOrigins = new Set<number>();
    for (const e of events) {
      const col = e.enemy
        ? 0xff7355
        : e.weapon && e.weapon in WEAPONS
          ? Number(
              WEAPONS[e.weapon as keyof typeof WEAPONS].color.replace(
                "#",
                "0x",
              ),
            )
          : 0xffd18e;
      if (e.type === "spawn") {
        this.ring(e.x, e.y, 0xe99460, (e.radius ?? 0.6) * 1.5, 0.5, 0.9);
        this.spawnParticles(e.x, 0.15, e.y, 5, 0x9f8b73, 1, 0.6);
      }
      // Newer simulation events; compared as strings so this compiles before EventKind lists them.
      const kind = e.type as string;
      if (kind === "spawnMark")
        this.spawnParticles(e.x, 0.1, e.y, 3, 0xe99460, 0.8, 0.45);
      if (kind === "horde") {
        // A horde ring closing on the player: one red pulse from the player outward.
        this.ring(e.x, e.y, 0xff6e4e, (e.radius ?? 6) * 1.05, 0.6, 0.3);
        this.spawnParticles(e.x, 0.6, e.y, 18, 0xff8a6a, 3, 0.6);
        this.shake = Math.max(this.shake, 0.08);
      }
      if (e.type === "fire") {
        if (e.enemy && e.id !== undefined) {
          const rig = this.enemies.get(e.id);
          if (rig) rig.recoil = 1;
        }
        if (!e.enemy && e.id !== undefined) this.weaponMotion.set(e.id, 1);
        const muzzle = this.eventMuzzle(e);
        this.spawnParticles(
          muzzle.x,
          muzzle.y,
          muzzle.z,
          e.weapon === "shotgun" ? 9 : 3,
          col,
          2,
          0.5,
        );
      }
      if (e.type === "hit") {
        this.spawnParticles(e.x, 1, e.y, 4, col, 2.5, 0.5);
        if (e.amount) this.label(e.amount, e.x, e.y, e.amount > 45);
      }
      if (e.type === "kill") {
        this.spawnParticles(
          e.x,
          0.85,
          e.y,
          e.kind === "boss" ? 70 : 15,
          0xa28d76,
          e.kind === "boss" ? 9 : 4,
          0.9,
        );
        this.spawnParticles(e.x, 0.7, e.y, 5, 0xffb575, 3, 0.45);
        if (e.kind === "brute" || e.kind === "boss")
          this.shake = Math.max(this.shake, 0.15);
      }
      if (e.type === "hurt") {
        this.shake = 0.3;
        this.damageFlash = 0.52;
        this.ring(e.x, e.y, 0xff6d52, 1.5, 0.24);
        this.spawnParticles(e.x, 1, e.y, 16, 0xff9377, 4, 0.7);
      }
      if (e.type === "dash") {
        this.ring(e.x, e.y, COLORS[this.heroId], e.radius ?? 2, 0.35);
        this.spawnParticles(e.x, 0.6, e.y, 26, COLORS[this.heroId], 4, 0.75);
      }
      if (e.type === "explosion") {
        this.ring(e.x, e.y, col, e.radius ?? 3, 0.38);
        this.spawnParticles(e.x, 0.4, e.y, 32, col, 7, 1.1);
        this.shake = Math.max(this.shake, 0.14);
      }
      if (e.type === "arc" && e.targetX !== undefined) {
        const first = !e.enemy && e.id !== undefined && !arcOrigins.has(e.id);
        if (first) {
          arcOrigins.add(e.id!);
          this.weaponMotion.set(e.id!, 1);
        }
        const origin = first
          ? this.eventMuzzle(e)
          : new THREE.Vector3(e.x, 1.2, e.y);
        const points = [];
        for (let i = 0; i < 7; i++) {
          const t = i / 6;
          points.push(
            new THREE.Vector3(
              lerp(origin.x, e.targetX, t) +
                (i && i < 6 && e.weapon !== "beam" && e.weapon !== "railgun"
                  ? (Math.random() - 0.5) * 0.45
                  : 0),
              lerp(origin.y, 1.2, t) + (i % 2) * 0.12,
              lerp(origin.z, e.targetY!, t),
            ),
          );
        }
        const curve = new THREE.CatmullRomCurve3(points);
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(
            curve,
            12,
            e.weapon === "beam" ? 0.11 : e.weapon === "railgun" ? 0.07 : 0.065,
            4,
            false,
          ),
          new THREE.MeshBasicMaterial({
            color: col,
            transparent: true,
            toneMapped: false,
            depthWrite: false,
          }),
        );
        this.fx.add(mesh);
        this.rings.push({ mesh, life: 0.16, max: 0.16, radius: 1, start: 1 });
      }
      if (e.type === "slash") {
        if (e.id !== undefined) this.weaponMotion.set(e.id, 1);
        if (e.weapon === "flame") {
          for (let i = 0; i < 7; i++) {
            const a = (e.angle ?? 0) + (Math.random() - 0.5) * 0.65;
            const d = 0.6 + Math.random() * (e.radius ?? 4);
            this.spawnParticles(
              e.x + Math.cos(a) * d,
              0.5 + Math.random() * 0.7,
              e.y + Math.sin(a) * d,
              2,
              i % 2 ? 0xff9b48 : 0xffdb88,
              1.2,
              1.15,
            );
          }
        } else if (e.weapon === "blade") {
          const radius = e.radius ?? 3.4;
          const arc = new THREE.Mesh(
            new THREE.RingGeometry(
              radius * 0.56,
              radius * 0.84,
              36,
              1,
              -(e.angle ?? 0) - 0.92,
              1.84,
            ),
            new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.7,
              depthWrite: false,
              side: THREE.DoubleSide,
              toneMapped: false,
            }),
          );
          arc.rotation.x = -Math.PI / 2;
          arc.position.set(e.x, 1.25, e.y);
          this.fx.add(arc);
          this.rings.push({
            mesh: arc,
            life: 0.17,
            max: 0.17,
            start: 1,
            radius: 1,
          });
        } else this.ring(e.x, e.y, col, e.radius ?? 3.4, 0.2, 0.7);
      }
      if (e.type === "status")
        this.spawnParticles(
          e.x,
          1.4,
          e.y,
          3,
          e.status === "burn"
            ? 0xffaa53
            : e.status === "poison"
              ? 0xabe477
              : 0x9eeaff,
          1,
          0.65,
        );
      if (e.type === "pickup") {
        this.spawnParticles(e.x, 0.4, e.y, 4, 0x24f4a2, 1.3, 0.5);
      }
      if (e.type === "weave") {
        this.ring(e.x, e.y, 0x87f1e1, 2.6, 0.35);
        this.spawnParticles(e.x, 0.5, e.y, 16, 0x79e5ee, 3, 0.55);
      }
      if (e.type === "waveEnd") {
        this.ring(e.x, e.y, 0xace5c2, 18, 1.1);
        this.spawnParticles(e.x, 2, e.y, 35, 0xffd58a, 6, 0.8);
      }
    }
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
        this.spawnParticles(p.x, 0.8, p.y, 5, COLORS[this.heroId], 1, 0.75);
      }
      const alive = new Set(run.enemies.map((e) => e.id));
      for (const [id, r] of this.enemies)
        if (!alive.has(id)) {
          r.root.removeFromParent();
          const key = r.root.userData.poolKey ?? r.kind;
          if (!this.enemyPools.has(key)) this.enemyPools.set(key, []);
          this.enemyPools.get(key)!.push(r);
          this.enemies.delete(id);
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
        animateRig(
          r,
          t + e.id * 0.37,
          Math.min(speed, 8),
          e.angle,
          dt,
          e.state === "charge",
          e.hitTime > 0,
        );
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
        mesh.scale.setScalar(0.57 + (drone.level - 1) * 0.025);
        const position = at(drone);
        mesh.position.set(
          position.x,
          1.2 + Math.sin(t * 3 + index) * 0.1,
          position.y,
        );
        mesh.rotation.y = Math.PI / 2 - drone.aimAngle;
        if (drone.kind === "orbit_drone") mesh.rotation.y = t * 3;
      }
      this.updateHazards(run);
      this.updateSpawnMarkers(run);
      const bullets = new Set(run.bullets.map((b) => b.id));
      for (const [id, m] of this.bulletMeshes)
        if (!bullets.has(id)) {
          m.removeFromParent();
          this.bulletMeshes.delete(id);
        }
      for (const b of run.bullets) {
        let mesh = this.bulletMeshes.get(b.id);
        if (!mesh) {
          mesh = new THREE.Mesh(
            this.bulletGeometry,
            glowMaterial(
              b.enemy
                ? 0xff7355
                : Number(
                    WEAPONS[b.weapon as keyof typeof WEAPONS]?.color.replace(
                      "#",
                      "0x",
                    ) ?? 0xffe0a3,
                  ),
            ),
          );
          this.actors.add(mesh);
          this.bulletMeshes.set(b.id, mesh);
        }
        const visualBullet = at(b);
        mesh.position.set(visualBullet.x, b.enemy ? 0.9 : 1.1, visualBullet.y);
        mesh.scale.set(
          b.enemy ? 2 : 1,
          b.enemy ? 2 : 1,
          b.weapon === "rocket" ? 4 : 2.6,
        );
        mesh.rotation.y = Math.PI / 2 - b.angle;
      }
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
    this.particles = this.particles.filter((p) => p.life > 0);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= p.gravity * dt;
      if (p.y < 0.07) {
        p.y = 0.07;
        p.vy = Math.abs(p.vy) * 0.25;
        p.vx *= 0.92;
        p.vz *= 0.92;
      }
      scratch.position.set(p.x, p.y, p.z);
      scratch.rotation.set(p.life * 4, p.life * 5, p.life * 3);
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
        r.mesh.removeFromParent();
        if (r.mesh.geometry !== this.ringGeometry) r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      const progress = 1 - r.life / r.max;
      if (r.mesh.geometry === this.ringGeometry)
        r.mesh.scale.setScalar(lerp(r.start, r.radius, progress));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity =
        (1 - progress) * 0.8;
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
    this.renderer.render(this.scene, this.camera);
  }
  private eventMuzzle(event: GameEvent) {
    const enemyMuzzle =
      event.enemy && event.id !== undefined
        ? (this.enemies.get(event.id)?.root.userData.muzzleObject as
            THREE.Object3D | undefined)
        : undefined;
    if (enemyMuzzle) return enemyMuzzle.getWorldPosition(new THREE.Vector3());
    const mesh =
      !event.enemy && event.id !== undefined
        ? (this.heldWeapons.get(event.id) ?? this.drones.get(event.id))
        : undefined;
    const muzzle = mesh?.userData.muzzle as THREE.Vector3 | undefined;
    if (mesh && muzzle) {
      mesh.updateWorldMatrix(true, false);
      return mesh.localToWorld(muzzle.clone());
    }
    return new THREE.Vector3(event.x, 1.45, event.y);
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
  private updateHazards(run: SurvivalRun) {
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
        const tint = hazard.kind === "toxic" ? 0xafdb66 : 0xff6e4e;
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
    for (const m of [
      ...this.bulletMeshes.values(),
      ...this.pickupMeshes.values(),
      ...this.telegraphs.values(),
    ])
      m.removeFromParent();
    this.bulletMeshes.clear();
    this.pickupMeshes.clear();
    this.telegraphs.clear();
    this.particles = [];
    this.particleMesh.count = 0;
    this.shake = 0;
    for (const ring of this.rings) {
      ring.mesh.removeFromParent();
      if (ring.mesh.geometry !== this.ringGeometry)
        ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings = [];
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
