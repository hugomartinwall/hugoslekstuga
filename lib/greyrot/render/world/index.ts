/**
 * The world: sky, terrain, water and scatter, assembled and tier-aware.
 *
 * Everything here is presentation, built FROM the simulation's world data
 * (heightfield + blocking obstacles in src/sim/world/). The dependency points
 * render→sim, never the reverse (CLAUDE.md §4, enforced by the architecture
 * guard) — so what the hero walks on and collides with is exactly what is
 * drawn, by construction.
 */

import {
  BufferAttribute,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
} from "three";
import { BIOMES } from "../../content";
import { biomeAt, biomeAtIndex, type SimWorld } from "../../sim/world";
import { BIOME_GROUND, LIGHT as ART_LIGHT, WORLD as ART_WORLD, hex } from "../art";
import { srgbToLinear, type RGB } from "../mesh/dsl";
import type { QualitySettings } from "../quality";
import {
  createDetailUniforms,
  patchGrass,
  patchHaze,
  patchScatter,
  patchTerrain,
  patchWater,
  type DetailUniforms,
} from "./detail";
import { buildLandmarks } from "./landmarks";
import { Scatter } from "./scatter";
import { Sky } from "./sky";
import { buildTerrainGeometry, type GroundBands } from "./terrain";

export interface WorldOptions {
  /** The simulation's world — heights and blockers are ITS truth (§4). */
  sim: SimWorld;
}

/** Half-extent of the shadow ortho box, metres. */
const SHADOW_BOX_HALF = 30;
/** How far the followed target may drift before the frustum re-anchors. */
const SHADOW_REANCHOR_DIST = 2;

export class World {
  readonly scene = new Scene();
  readonly sim: SimWorld;
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  private scatter: Scatter;
  private water: Mesh;
  private fog: Fog;
  private waterLevel: number;
  private terrainMaterial: MeshStandardMaterial;
  private scatterMaterial: MeshStandardMaterial;
  private grassMaterial: MeshStandardMaterial;
  private waterMaterial: MeshStandardMaterial;
  private detail: DetailUniforms;
  private windBase: number;
  private time = 0;

  // Shadow-frustum stabilisation state (see updateShadowAnchor).
  private shadowAnchor = new Vector3(Infinity, 0, Infinity); // forces first anchor
  private shadowTexel = (SHADOW_BOX_HALF * 2) / 2048;
  private lightRight = new Vector3(1, 0, 0);
  private lightUp = new Vector3(0, 0, 1);
  private tmp = new Vector3();

  constructor(opts: WorldOptions, quality: QualitySettings) {
    this.sim = opts.sim;
    this.waterLevel = opts.sim.waterLevel;

    // The material SPLIT (the medium art tier's prerequisite): terrain,
    // blockers and grass used to share one material, which made any
    // terrain-only shader work impossible. Same authored surface response;
    // each now carries its own `detail.ts` injection.
    this.detail = createDetailUniforms();
    this.windBase = this.detail.uWind.value;
    const std = (): MeshStandardMaterial =>
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.terrainMaterial = std();
    patchTerrain(this.terrainMaterial, this.detail);
    patchHaze(this.terrainMaterial, opts.sim.waterLevel);
    this.scatterMaterial = std();
    patchScatter(this.scatterMaterial, this.detail);
    this.grassMaterial = std();
    patchGrass(this.grassMaterial, this.detail);

    /* ---------------------------------------------------------------- sky */
    // Every value below comes from render/art.ts — see the "no colour literal
    // outside art.ts" rule there.
    this.sky = new Sky();
    this.sky.setSun(ART_LIGHT.sunDir[0], ART_LIGHT.sunDir[1], ART_LIGHT.sunDir[2]);
    this.scene.add(this.sky.mesh);

    /* -------------------------------------------------------------- light */
    const sunDir = this.sky.sunDirection;
    this.sun = new DirectionalLight(this.sky.sunLightColor(), ART_LIGHT.keyIntensity);
    this.sun.position.copy(sunDir).multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun, this.sun.target);
    this.rebuildLightBasis();
    // Cool sky fill from above, warm bounce from the ground. Two lights, and
    // the whole scene sits in a believable environment. Shadows are warm-LIT,
    // never black: if a shadow reads as a void, raise THIS, not the key.
    this.scene.add(
      new HemisphereLight(hex(ART_LIGHT.hemiSky), hex(ART_LIGHT.hemiGround), ART_LIGHT.hemiIntensity),
    );

    /* ------------------------------------------------------------ terrain */
    // The biome bands, pre-blended once per road sample (round 7): each
    // sample's zone blend comes from the spans `setupRoad` compiled, and the
    // terrain builder's road argmin then picks the face's bands by index.
    const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    const bandsAt: GroundBands[] = opts.sim.roadPath.map((_, i) => {
      const blend = biomeAtIndex(opts.sim, i);
      const a = BIOME_GROUND[blend.a];
      const b = BIOME_GROUND[blend.b];
      return {
        shore: lerpRgb(a.shore, b.shore, blend.t),
        ground: lerpRgb(a.ground, b.ground, blend.t),
        groundLit: lerpRgb(a.groundLit, b.groundLit, blend.t),
      };
    });
    // Mesh built FROM the sim's heightfield: what you walk on is what you see.
    const ground = new Mesh(
      // The road tint rides in: `roadPath` is filled by `setupRoad`, so this
      // must be constructed AFTER scenario setup (main.ts already does — the
      // order comment there is load-bearing). The sandbox has no road and
      // passes an empty list, which is a no-op (and no biome bands either —
      // the harness arena is the baseline meadow).
      buildTerrainGeometry(opts.sim.field, this.waterLevel, opts.sim.roadPath, bandsAt),
      this.terrainMaterial,
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    /* -------------------------------------------------------------- water */
    // Subdivided so a per-vertex SHORE factor can ride in: 0 at the
    // waterline, 1 in the deep, baked from the same heightfield the hero
    // wades in. The shader (detail.ts patchWater) turns it into colour,
    // alpha and a lapping foam edge — no depth texture needed. The colour
    // literal that used to sit here leaked sRGB into linear; the patch owns
    // every water colour now, converted properly.
    const size = opts.sim.field.opts.size;
    const waterGeo = new PlaneGeometry(size * 1.6, size * 1.6, 96, 96);
    {
      const posAttr = waterGeo.getAttribute("position");
      const shore = new Float32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) {
        // Local plane (x, y) → world (x, -y) after the -90° X rotation.
        const wx = posAttr.getX(i);
        const wz = -posAttr.getY(i);
        const ground = opts.sim.field.heightAt(wx, wz);
        shore[i] = Math.min(1, Math.max(0, (this.waterLevel - ground) / 2.5));
      }
      waterGeo.setAttribute("aShore", new BufferAttribute(shore, 1));
    }
    this.waterMaterial = new MeshStandardMaterial({
      color: new Color(
        srgbToLinear(ART_WORLD.water[0]),
        srgbToLinear(ART_WORLD.water[1]),
        srgbToLinear(ART_WORLD.water[2]),
      ),
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
    });
    patchWater(this.waterMaterial, this.detail);
    this.water = new Mesh(waterGeo, this.waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = this.waterLevel;
    this.scene.add(this.water);

    /* ------------------------------------------------------------ scatter */
    // Blockers come from the sim's obstacle list (always all drawn); grass is
    // decorative and tier-budgeted. See scatter.ts for why the split matters.
    this.scatter = new Scatter(
      opts.sim.field,
      opts.sim.obstacles,
      this.scatterMaterial,
      this.grassMaterial,
      quality.foliage,
      (opts.sim.seed ^ 0x51ed2701) >>> 0,
      this.waterLevel,
      // The ash country goes bare (§2.1b). With no road (the sandbox) every
      // point is the baseline zone and this always passes.
      (x, z) => {
        const blend = biomeAt(opts.sim, x, z);
        // The profile table decides bare ground (R3) — the inline `!== "ash"`
        // was one of the three compiler-invisible biome conditionals.
        return BIOMES[blend.t < 0.5 ? blend.a : blend.b].grass;
      },
    );
    for (const m of this.scatter.objects) this.scene.add(m);

    /* ---------------------------------------------------------- landmarks */
    // Authored render-only scenery (the drowned stump, the dead fire-ring
    // stains) — unreachable or flat, so presence cannot lie. Campaign only:
    // no road, no landmarks (the sandbox arena stays bare).
    for (const m of buildLandmarks(
      opts.sim.field,
      opts.sim.obstacles,
      this.waterLevel,
      opts.sim.roadPath.length > 0,
      this.scatterMaterial,
    ))
      this.scene.add(m);

    /* ---------------------------------------------------------------- fog */
    this.fog = new Fog(this.sky.horizonColor(), quality.fogNear, quality.viewDistance);
    this.scene.fog = this.fog;

    this.applyQuality(quality);
  }

  /**
   * The camera→hero sight line for the blocker fade (round 7's follow
   * camera). `strength` 0 disables it entirely — the authored-yaw frames stay
   * pixel-identical. Presentation only; called by both entries after the rig
   * update.
   */
  setSightLine(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    strength: number,
  ): void {
    this.detail.uSightA.value.set(ax, ay, az);
    this.detail.uSightB.value.set(bx, by, bz);
    this.detail.uSightFade.value = strength;
  }

  /** Move the sun; sky, key light and fog all recolour together. */
  setSunDirection(x: number, y: number, z: number): void {
    this.sky.setSun(x, y, z);
    this.sun.color.copy(this.sky.sunLightColor());
    this.fog.color.copy(this.sky.horizonColor());
    this.rebuildLightBasis();
    // Direction changed → the old anchor is in the wrong light space.
    this.shadowAnchor.set(Infinity, 0, Infinity);
  }

  applyQuality(q: QualitySettings): void {
    this.scatter.setGrassBudget(q.foliage);
    this.fog.near = q.fogNear;
    this.fog.far = q.viewDistance;

    const shadows = q.shadowMapSize > 0;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      // three lazily allocates the map at the CURRENT size; if the size
      // changes later the old allocation wins. Drop it so it reallocates.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as typeof this.sun.shadow.map;
      const cam = this.sun.shadow.camera;
      // Tight ortho box around the play area: a shadow camera sized to the
      // whole terrain wastes almost all of its resolution.
      cam.left = -SHADOW_BOX_HALF;
      cam.right = SHADOW_BOX_HALF;
      cam.top = SHADOW_BOX_HALF;
      cam.bottom = -SHADOW_BOX_HALF;
      cam.near = 1;
      cam.far = 160;
      cam.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.02;
      // Texel size changed with the map resolution → re-snap next frame.
      this.shadowTexel = (SHADOW_BOX_HALF * 2) / q.shadowMapSize;
      this.shadowAnchor.set(Infinity, 0, Infinity);
    }

    this.waterMaterial.roughness = q.water === "animated" ? 0.3 : 0.55;
    // The art-tier dials (§2.1a): one noise octave and still grass on Low —
    // vertex and fragment ALU are exactly what the floor is short of.
    this.detail.uFine.value = q.detailOctaves > 1 ? 1 : 0;
    this.detail.uWind.value = q.grassWind ? this.windBase : 0;
    this.detail.uWaterMove.value = q.water === "animated" ? 1 : 0;
  }

  /* -------------------------------------------------- shadow stabilisation */

  /**
   * Orthonormal light-space basis, rebuilt only when the sun moves. Texel
   * snapping happens on these axes: snapping in world XZ would be wrong for
   * any sun that isn't vertical.
   */
  private rebuildLightBasis(): void {
    const d = this.sky.sunDirection; // points from origin toward the sun
    const up = Math.abs(d.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    this.lightRight.crossVectors(up, d).normalize();
    this.lightUp.crossVectors(d, this.lightRight).normalize();
  }

  /**
   * Re-anchor the shadow frustum on the followed ground target.
   *
   * Two rules, both existing to stop shadows swimming ("flying around", as the
   * first playtest put it — the box used to be glued to the CAMERA, a point
   * metres up in the air that moved every frame):
   *
   *  1. Re-anchor only when the target drifts > SHADOW_REANCHOR_DIST from the
   *     current anchor. A static scene gets a perfectly static frustum.
   *  2. When re-anchoring, snap the anchor to whole shadow-texel increments in
   *     LIGHT space. Sub-texel frustum movement re-rasterises every shadow
   *     edge at a new alignment, which reads as crawling.
   */
  private updateShadowAnchor(tx: number, ty: number, tz: number): void {
    if (!this.sun.castShadow) return;
    const dx = tx - this.shadowAnchor.x;
    const dy = ty - this.shadowAnchor.y;
    const dz = tz - this.shadowAnchor.z;
    if (dx * dx + dy * dy + dz * dz < SHADOW_REANCHOR_DIST * SHADOW_REANCHOR_DIST) return;

    // Snap the target to the texel grid on the light-space axes.
    const p = this.tmp.set(tx, ty, tz);
    const a = p.dot(this.lightRight);
    const b = p.dot(this.lightUp);
    const snapA = Math.round(a / this.shadowTexel) * this.shadowTexel - a;
    const snapB = Math.round(b / this.shadowTexel) * this.shadowTexel - b;
    p.addScaledVector(this.lightRight, snapA).addScaledVector(this.lightUp, snapB);

    this.shadowAnchor.copy(p);
    const d = this.sky.sunDirection;
    this.sun.position.set(p.x + d.x * 60, p.y + d.y * 60, p.z + d.z * 60);
    this.sun.target.position.copy(p);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Advance presentation-only animation. Never touches simulation state.
   *
   * The camera position drives the sky dome (which must stay centred on the
   * viewer); the shadow frustum follows the GROUND TARGET — the hero — via
   * updateShadowAnchor. Gluing shadows to the camera was the original
   * "shadows flying around" bug: an anchor metres up in the air, moving with
   * damped smoothing, every single frame.
   */
  update(
    dt: number,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    far: number,
    targetX: number,
    targetY: number,
    targetZ: number,
  ): void {
    this.time += dt;
    // One presentation clock for wind and water — never the sim's.
    this.detail.uTime.value = this.time;
    // Gentle swell. Moving the whole plane is far cheaper than displacing
    // vertices and reads fine at this art scale.
    this.water.position.y = this.waterLevel + Math.sin(this.time * 0.6) * 0.045;
    // The dome must stay centred on the camera and inside the far plane.
    this.sky.follow(cameraX, cameraY, cameraZ, far * 0.92);
    this.updateShadowAnchor(targetX, targetY, targetZ);
  }

  get foliageCount(): number {
    return this.scatter.instanceCount;
  }

  dispose(): void {
    this.scatter.dispose();
    this.sky.dispose();
    this.terrainMaterial.dispose();
    this.scatterMaterial.dispose();
    this.grassMaterial.dispose();
    this.waterMaterial.dispose();
  }
}
