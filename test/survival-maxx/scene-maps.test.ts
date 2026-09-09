import { test } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SurvivalScene } from "../../lib/survival-maxx/scene";
import { MAPS, type MapDecoration } from "../../lib/survival-maxx/content";

// The arena bakes two canvas textures; a no-op 2D context lets that run without a DOM.
function installCanvasStub() {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      key in target ? target[key] : () => undefined,
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
}

// The public surface under test plus the two private helpers probed directly.
type Probe = Pick<
  SurvivalScene,
  | "makeArena"
  | "applyPalette"
  | "setMap"
  | "map"
  | "arena"
  | "actors"
  | "scene"
  | "hemiLight"
  | "rimLight"
  | "lampLight"
  | "ambient"
  | "menu"
  | "ringGeometry"
  | "thickRingGeometry"
  | "spawnMarkerMeshes"
> & {
  updateSpawnMarkers(run: unknown): void;
  decorateRing(
    group: THREE.Group,
    decoration: MapDecoration,
    palette: (typeof MAPS)[number]["palette"],
  ): void;
};

function arenaHarness() {
  installCanvasStub();
  // Exercise the arena, palette and marker code without WebGL.
  const scene = Object.create(SurvivalScene.prototype) as unknown as Probe;
  Object.assign(scene, {
    arena: new THREE.Group(),
    actors: new THREE.Group(),
    scene: Object.assign(new THREE.Scene(), {
      background: new THREE.Color(0),
      fog: new THREE.FogExp2(0, 0.01),
    }),
    hemiLight: new THREE.HemisphereLight(),
    rimLight: new THREE.DirectionalLight(),
    lampLight: new THREE.PointLight(),
    ambient: new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial(),
    ),
    map: MAPS[0],
    menu: false,
    ringGeometry: new THREE.RingGeometry(0.91, 1, 64),
    thickRingGeometry: new THREE.RingGeometry(0.84, 1, 64),
    spawnMarkerMeshes: new Map(),
  });
  scene.makeArena(MAPS[0]);
  scene.applyPalette(MAPS[0].palette);
  return scene;
}

const meshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) found.push(o);
  });
  return found;
};
const posts = (arena: THREE.Group) =>
  Math.max(
    ...arena.children.map(
      (child) => child.children.filter((c) => c instanceof THREE.Group).length,
    ),
  );

test("every map builds an arena with its decoration ring and the MAXX decal", () => {
  const scene = arenaHarness();
  for (const map of MAPS) {
    scene.setMap(map);
    assert.equal(scene.map, map);
    assert.ok(scene.arena.children.length >= 6, `${map.key} arena is empty`);
    const decals = meshes(scene.arena).filter(
      (m) =>
        m.material instanceof THREE.MeshBasicMaterial &&
        m.material.map &&
        m.material.transparent,
    );
    assert.equal(decals.length, 1, `${map.key} lost its floor decal`);
    assert.equal(
      posts(scene.arena),
      map.decoration === "spires" ? 12 : 16,
      `${map.key} (${map.decoration}) has the wrong number of ring props`,
    );
    for (const mesh of meshes(scene.arena))
      assert.ok(mesh.geometry.attributes.position.count > 0);
    // The floor, decal and world floor own their materials; everything else is baked or pooled.
    assert.equal(
      meshes(scene.arena).filter((m) => m.userData.owned).length,
      3,
      `${map.key} ownership tags changed`,
    );
  }
});

test("spires use a wider ring than the other decorations", () => {
  const scene = arenaHarness();
  const reach = (decoration: MapDecoration) => {
    const group = new THREE.Group();
    scene.decorateRing(group, decoration, MAPS[0].palette);
    return Math.max(
      ...group.children
        .filter((c) => c instanceof THREE.Group)
        .map((c) => Math.hypot(c.position.x, c.position.z)),
    );
  };
  assert.ok(Math.abs(reach("pylons") - 21.3) < 1e-9);
  assert.ok(Math.abs(reach("spires") - 22) < 1e-9);
  for (const decoration of ["barricades", "vents", "ruins"] as const)
    assert.ok(Math.abs(reach(decoration) - 21.3) < 1e-9, decoration);
});

test("setMap is a no-op for the same key and disposes the old arena for a new one", () => {
  const scene = arenaHarness();
  const before = [...scene.arena.children];
  scene.setMap({ ...MAPS[0] });
  assert.deepEqual(scene.arena.children, before);

  let disposedTextures = 0,
    disposedGeometries = 0;
  for (const mesh of meshes(scene.arena)) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (material.map) {
      const dispose = material.map.dispose.bind(material.map);
      material.map.dispose = () => (disposedTextures++, dispose());
    }
    const geometryDispose = mesh.geometry.dispose.bind(mesh.geometry);
    mesh.geometry.dispose = () => (disposedGeometries++, geometryDispose());
  }
  scene.setMap(MAPS[1]);
  assert.equal(scene.map, MAPS[1]);
  assert.equal(disposedTextures, 2, "floor texture and decal are released");
  assert.ok(disposedGeometries >= 6, "baked merges are released");
  assert.ok(before.every((child) => !scene.arena.children.includes(child)));
  assert.equal(
    (scene.scene.background as THREE.Color).getHex(),
    MAPS[1].palette.background,
  );
  assert.equal(
    (scene.scene.fog as THREE.FogExp2).density,
    MAPS[1].palette.fogDensity,
  );
});

test("applyPalette recolours sky, fog, lamps and dust; menus keep the Foundry look", () => {
  const scene = arenaHarness();
  scene.menu = true;
  scene.setMap(MAPS[2]);
  // Hidden behind a menu the sky stays as it was; setScreen repaints when the arena shows.
  assert.equal(
    (scene.scene.background as THREE.Color).getHex(),
    MAPS[0].palette.background,
  );
  const p = MAPS[2].palette;
  scene.applyPalette(p);
  assert.equal((scene.scene.background as THREE.Color).getHex(), p.background);
  const fog = scene.scene.fog as THREE.FogExp2;
  assert.equal(fog.color.getHex(), p.fog);
  assert.equal(fog.density, p.fogDensity);
  assert.equal(scene.hemiLight.color.getHex(), p.sky);
  assert.equal(scene.hemiLight.groundColor.getHex(), p.groundLight);
  assert.equal(scene.rimLight.color.getHex(), p.sky);
  assert.equal(scene.lampLight.color.getHex(), p.lamp);
  assert.equal(
    (scene.ambient.material as THREE.PointsMaterial).color.getHex(),
    p.dust,
  );
});

test("spawn markers tighten and brighten toward arrival, then leave with the queue", () => {
  const scene = arenaHarness();
  const marker = (
    id: number,
    extra: Partial<Record<string, unknown>> = {},
  ) => ({
    id,
    kind: "grunt",
    x: 2,
    y: -3,
    age: 0,
    delay: 2,
    budgeted: true,
    elite: false,
    horde: false,
    radius: 0.5,
    ...extra,
  });
  scene.updateSpawnMarkers({});
  assert.equal(scene.actors.children.length, 0);

  const run = {
    spawnQueue: [marker(1), marker(2, { elite: true, horde: true })],
  };
  scene.updateSpawnMarkers(run);
  assert.equal(scene.spawnMarkerMeshes.size, 2);
  assert.equal(scene.actors.children.length, 2);
  const plain = scene.spawnMarkerMeshes.get(1)!;
  const elite = scene.spawnMarkerMeshes.get(2)!;
  const ring = (g: THREE.Group) =>
    g.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  assert.equal(plain.position.x, 2);
  assert.equal(plain.position.z, -3);
  assert.ok(Math.abs(ring(plain).scale.x - 0.5 * 2.2) < 1e-9);
  assert.ok(Math.abs(ring(plain).material.opacity - 0.25) < 1e-9);
  assert.equal(ring(plain).geometry, scene.ringGeometry);
  assert.equal(ring(elite).geometry, scene.thickRingGeometry);
  assert.equal(plain.children.length, 1);
  assert.equal(elite.children.length, 2, "horde markers carry a second ring");
  assert.equal(
    (
      elite.children[1] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >
    ).material.color.getHex(),
    0xff6e4e,
  );

  run.spawnQueue[0].age = 2;
  scene.updateSpawnMarkers(run);
  assert.ok(Math.abs(ring(plain).scale.x - 0.5 * 1.3) < 1e-9);
  assert.ok(Math.abs(ring(plain).material.opacity - 0.85) < 1e-9);
  assert.equal(scene.spawnMarkerMeshes.get(1), plain, "markers are reused");

  scene.updateSpawnMarkers({ spawnQueue: [run.spawnQueue[1]] });
  assert.equal(scene.spawnMarkerMeshes.size, 1);
  assert.equal(scene.actors.children.length, 1);
  scene.updateSpawnMarkers({ spawnQueue: [] });
  assert.equal(scene.spawnMarkerMeshes.size, 0);
  assert.equal(scene.actors.children.length, 0);
});
