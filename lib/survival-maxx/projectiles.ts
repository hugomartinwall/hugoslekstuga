import * as THREE from "three";
import { interpolatedPosition } from "./motion";
import {
  PROJECTILE_ART,
  SHAPE_BUDGET,
  SHAPE_CLASSES,
  SHAPE_GEOMETRY,
  COMPLEX_BUDGET,
  COMPLEX_KINDS,
  GLOW_BUDGET,
  TRAIL_BUDGET,
  TRAIL_SAMPLES,
  TRAIL_SEGMENTS,
  MUZZLE_LERP,
  artKeyFor,
  resolveArt,
  isComplex,
  glowTexture,
  makeComplexProjectile,
  type ArtKey,
  type ShapeClass,
  type ComplexKind,
  type ComplexBody,
  type ProjectileArt,
} from "./projectile-art";

/** The slice of a simulation bullet the renderer reads. */
export interface RenderBullet {
  id: number;
  x: number;
  y: number;
  prevX?: number;
  prevY?: number;
  angle: number;
  radius: number;
  age: number;
  life: number;
  level: number;
  enemy: boolean;
  weapon: string;
  child?: boolean;
  fused?: boolean;
  returning?: boolean;
  timer?: number;
  ownerId?: number;
  source?: string;
  behavior?: {
    stationary?: boolean;
    grow?: number;
    orbit?: unknown;
    pull?: unknown;
  };
}
export interface ProjectileContext {
  alpha: number;
  time: number;
  dt: number;
  cameraQuaternion: THREE.Quaternion;
  reducedMotion: boolean;
  /** World position of the owner's barrel; false when the owner has none. */
  muzzleWorld(ownerId: number, out: THREE.Vector3): boolean;
  isDrone(ownerId: number): boolean;
  puff(x: number, y: number, z: number, color: number, size: number, life: number): void;
}
export interface ProjectileStats {
  states: number;
  instances: Record<ShapeClass, number>;
  glows: number;
  trails: number;
  complex: Record<ComplexKind, number>;
  fallbacks: number;
}

interface ProjectileState {
  id: number;
  key: ArtKey;
  seen: number;
  born: number;
  phase: number;
  origin: THREE.Vector3;
  hasOrigin: boolean;
  samples: Float32Array;
  sampleCount: number;
  sampleHead: number;
  puffTimer: number;
  complex?: ComplexBody;
}

const scratch = new THREE.Object3D();
const color = new THREE.Color();
const white = new THREE.Color(0xffffff);
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const dir = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, 1);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Draws every simulation bullet: one instanced mesh per shape class, one
 * additive glow-quad mesh, one additive trail mesh, and pools of complex
 * groups (mines, turrets, ring waves, orbs, singularities).
 */
export class ProjectileRenderer {
  group = new THREE.Group();
  shapes = {} as Record<ShapeClass, THREE.InstancedMesh>;
  counts = {} as Record<ShapeClass, number>;
  glows: THREE.InstancedMesh;
  glowCount = 0;
  trails: THREE.InstancedMesh;
  trailCount = 0;
  trailBullets = 0;
  states = new Map<number, ProjectileState>();
  statePool: ProjectileState[] = [];
  complexPools = new Map<string, ComplexBody[]>();
  complexCounts = {} as Record<ComplexKind, number>;
  fallbacks = 0;
  frame = 0;
  private bodyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  constructor(parent: THREE.Object3D) {
    this.group.name = "projectiles";
    parent.add(this.group);
    for (const shape of SHAPE_CLASSES) {
      const mesh = new THREE.InstancedMesh(SHAPE_GEOMETRY[shape](), this.bodyMaterial, SHAPE_BUDGET[shape]);
      this.prepare(mesh);
      mesh.name = `projectile-${shape}`;
      this.shapes[shape] = mesh;
      this.counts[shape] = 0;
      this.group.add(mesh);
    }
    this.glows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      GLOW_BUDGET,
    );
    this.prepare(this.glows);
    this.glows.name = "projectile-glows";
    this.glows.renderOrder = 6;
    this.trails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      TRAIL_BUDGET * TRAIL_SEGMENTS,
    );
    this.prepare(this.trails);
    this.trails.name = "projectile-trails";
    this.trails.renderOrder = 5;
    this.group.add(this.trails, this.glows);
    for (const kind of COMPLEX_KINDS) this.complexCounts[kind] = 0;
  }
  private prepare(mesh: THREE.InstancedMesh) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Touch a colour so the instanceColor attribute exists from the first frame.
    mesh.setColorAt(0, white);
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }
  private acquireState(bullet: RenderBullet, key: ArtKey, ctx: ProjectileContext) {
    const state =
      this.statePool.pop() ??
      ({
        id: 0,
        key,
        seen: 0,
        born: 0,
        phase: 0,
        origin: new THREE.Vector3(),
        hasOrigin: false,
        samples: new Float32Array(TRAIL_SAMPLES * 3),
        sampleCount: 0,
        sampleHead: 0,
        puffTimer: 0,
        complex: undefined,
      } satisfies ProjectileState);
    state.id = bullet.id;
    state.key = key;
    state.born = ctx.time;
    state.phase = Math.random() * Math.PI * 2;
    state.sampleCount = 0;
    state.sampleHead = 0;
    state.puffTimer = 0;
    state.complex = undefined;
    state.hasOrigin =
      !bullet.enemy &&
      !bullet.child &&
      !bullet.behavior?.stationary &&
      !bullet.behavior?.orbit &&
      bullet.ownerId !== undefined &&
      bullet.age < MUZZLE_LERP &&
      ctx.muzzleWorld(bullet.ownerId, state.origin);
    this.states.set(bullet.id, state);
    return state;
  }
  private releaseState(state: ProjectileState) {
    if (state.complex) this.releaseComplex(state.complex);
    state.complex = undefined;
    this.states.delete(state.id);
    this.statePool.push(state);
  }
  private acquireComplex(kind: ComplexKind, art: ProjectileArt, level: number) {
    if (this.complexCounts[kind] >= COMPLEX_BUDGET[kind]) return undefined;
    const key = kind === "turret" ? `turret:${level}` : kind;
    const body = this.complexPools.get(key)?.pop() ?? makeComplexProjectile(kind, art, level);
    this.complexCounts[kind]++;
    this.group.add(body.group);
    return body;
  }
  private releaseComplex(body: ComplexBody) {
    body.group.removeFromParent();
    this.complexCounts[body.kind]--;
    const key = body.kind === "turret" ? `turret:${body.level}` : body.kind;
    if (!this.complexPools.has(key)) this.complexPools.set(key, []);
    this.complexPools.get(key)!.push(body);
  }
  /** World position of a deployed turret's barrel, for its own fire flashes. */
  muzzle(id: number, out: THREE.Vector3) {
    const body = this.states.get(id)?.complex;
    if (!body?.muzzle) return false;
    body.muzzle(out);
    return true;
  }
  update(bullets: readonly RenderBullet[], ctx: ProjectileContext) {
    const frame = ++this.frame;
    const reduced = ctx.reducedMotion;
    for (const shape of SHAPE_CLASSES) this.counts[shape] = 0;
    this.glowCount = 0;
    this.trailCount = 0;
    this.trailBullets = 0;
    this.fallbacks = 0;
    for (const b of bullets) {
      const key = artKeyFor(b, ctx.isDrone);
      let state = this.states.get(b.id);
      if (!state) state = this.acquireState(b, key, ctx);
      else if (state.key !== key) state.key = key;
      state.seen = frame;
      const art = resolveArt(key, b);
      const visual = interpolatedPosition(b, ctx.alpha);
      let x = visual.x,
        z = visual.y,
        y = art.height;
      if (art.bob && !reduced) y += Math.sin(ctx.time * 3.2 + state.phase) * art.bob;
      if (state.hasOrigin) {
        if (b.age < MUZZLE_LERP) {
          const t = smooth(Math.max(0, Math.min(1, b.age / MUZZLE_LERP)));
          x = state.origin.x + (x - state.origin.x) * t;
          y = state.origin.y + (y - state.origin.y) * t;
          z = state.origin.z + (z - state.origin.z) * t;
        } else state.hasOrigin = false;
      }
      const yaw = Math.PI / 2 - b.angle;
      let drewBody = false;
      if (isComplex(art.shape)) {
        if (!state.complex || state.complex.kind !== art.shape) {
          if (state.complex) this.releaseComplex(state.complex);
          state.complex = this.acquireComplex(art.shape, art, b.level);
        }
        const body = state.complex;
        if (body) {
          body.group.position.set(x, y, z);
          if (body.kind !== "turret") body.group.rotation.y = yaw;
          body.animate(
            {
              radius: b.radius,
              age: b.age,
              life: b.life,
              angle: b.angle,
              timer: b.timer,
              fused: b.fused,
              stationary: b.behavior?.stationary,
              grow: b.behavior?.grow,
            },
            art,
            ctx.time,
            ctx.dt,
            reduced,
          );
          drewBody = true;
        } else this.fallbacks++;
      } else if (state.complex) {
        this.releaseComplex(state.complex);
        state.complex = undefined;
      }
      if (!drewBody) {
        let shape: ShapeClass | undefined = isComplex(art.shape) ? "ball" : art.shape;
        if (this.counts[shape] >= SHAPE_BUDGET[shape]) {
          if (shape !== "ball" && this.counts.ball < SHAPE_BUDGET.ball) {
            shape = "ball";
            this.fallbacks++;
          } else shape = undefined;
        }
        if (shape) {
          const index = this.counts[shape]++;
          const spin = art.spin && !reduced ? art.spin * (ctx.time - state.born) + state.phase : 0;
          scratch.position.set(x, y, z);
          if (art.spinAxis === "y") scratch.rotation.set(0, yaw + spin, 0);
          else scratch.rotation.set(0, yaw, spin);
          const pulse = art.pulse && !reduced ? 1 + Math.sin(ctx.time * art.pulse * Math.PI * 2 + state.phase) * 0.14 : 1;
          const r = Math.max(0.02, b.radius) * pulse;
          scratch.scale.set(art.size[0] * r, art.size[1] * r, art.size[2] * r);
          scratch.updateMatrix();
          const mesh = this.shapes[shape];
          mesh.setMatrixAt(index, scratch.matrix);
          mesh.setColorAt(index, color.setHex(art.core));
        }
      }
      if (art.glow && !reduced && this.glowCount < GLOW_BUDGET) {
        const index = this.glowCount++;
        const pulse = art.glow.pulse ? 0.85 + Math.sin(ctx.time * art.glow.pulse * Math.PI * 2 + state.phase) * 0.15 : 1;
        const size = art.glow.size * Math.max(0.05, b.radius) * pulse;
        scratch.position.set(x, y, z);
        scratch.quaternion.copy(ctx.cameraQuaternion);
        scratch.scale.set(size, size, 1);
        scratch.updateMatrix();
        this.glows.setMatrixAt(index, scratch.matrix);
        this.glows.setColorAt(index, color.setHex(art.glow.color ?? art.rim).multiplyScalar(0.55));
      }
      if (art.trail && !reduced && this.trailBullets < TRAIL_BUDGET) {
        this.trailBullets++;
        this.sampleTrail(state, x, y, z, art.trail.step);
        this.writeTrail(state, art, Math.max(0.02, b.radius));
      } else state.sampleCount = 0;
      if (art.puff && !reduced) {
        state.puffTimer -= ctx.dt;
        if (state.puffTimer <= 0) {
          state.puffTimer += art.puff.every;
          ctx.puff(x, y, z, art.puff.color, art.puff.size, art.puff.life);
        }
      }
    }
    for (const state of this.states.values()) if (state.seen !== frame) this.releaseState(state);
    for (const shape of SHAPE_CLASSES) {
      const mesh = this.shapes[shape];
      mesh.count = this.counts[shape];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.glows.count = this.glowCount;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.trails.count = this.trailCount;
    this.trails.instanceMatrix.needsUpdate = true;
    if (this.trails.instanceColor) this.trails.instanceColor.needsUpdate = true;
  }
  private sampleTrail(state: ProjectileState, x: number, y: number, z: number, step: number) {
    const s = state.samples;
    if (state.sampleCount > 0) {
      const head = state.sampleHead * 3;
      const dx = x - s[head],
        dy = y - s[head + 1],
        dz = z - s[head + 2];
      if (dx * dx + dy * dy + dz * dz < step * step) return;
      state.sampleHead = (state.sampleHead + 1) % TRAIL_SAMPLES;
    }
    const at = state.sampleHead * 3;
    s[at] = x;
    s[at + 1] = y;
    s[at + 2] = z;
    state.sampleCount = Math.min(TRAIL_SAMPLES, state.sampleCount + 1);
  }
  private writeTrail(state: ProjectileState, art: ProjectileArt, radius: number) {
    const trail = art.trail!;
    const s = state.samples;
    const segments = state.sampleCount - 1;
    const width = trail.width * radius;
    for (let i = 0; i < segments && this.trailCount < TRAIL_BUDGET * TRAIL_SEGMENTS; i++) {
      // i = 0 is the newest segment, behind the head.
      const a = ((state.sampleHead - i + TRAIL_SAMPLES) % TRAIL_SAMPLES) * 3;
      const c = ((state.sampleHead - i - 1 + TRAIL_SAMPLES) % TRAIL_SAMPLES) * 3;
      from.set(s[a], s[a + 1], s[a + 2]);
      to.set(s[c], s[c + 1], s[c + 2]);
      dir.subVectors(from, to);
      const length = dir.length();
      if (length < 1e-4) continue;
      dir.divideScalar(length);
      const index = this.trailCount++;
      scratch.position.addVectors(from, to).multiplyScalar(0.5);
      scratch.quaternion.setFromUnitVectors(forward, dir);
      const fade = 1 - i / TRAIL_SEGMENTS;
      scratch.scale.set(width * fade, width * fade, length);
      scratch.updateMatrix();
      this.trails.setMatrixAt(index, scratch.matrix);
      this.trails.setColorAt(index, color.setHex(trail.color ?? art.rim).multiplyScalar(0.7 * fade));
    }
  }
  stats(): ProjectileStats {
    return {
      states: this.states.size,
      instances: { ...this.counts },
      glows: this.glowCount,
      trails: this.trailCount,
      complex: { ...this.complexCounts },
      fallbacks: this.fallbacks,
    };
  }
  reset() {
    for (const state of [...this.states.values()]) this.releaseState(state);
    for (const shape of SHAPE_CLASSES) {
      this.counts[shape] = 0;
      this.shapes[shape].count = 0;
    }
    this.glowCount = this.glows.count = 0;
    this.trailCount = this.trails.count = 0;
    this.trailBullets = 0;
  }
  dispose() {
    this.reset();
    for (const pool of this.complexPools.values()) for (const body of pool) body.dispose();
    this.complexPools.clear();
    for (const shape of SHAPE_CLASSES) {
      this.shapes[shape].geometry.dispose();
      this.shapes[shape].dispose();
    }
    this.bodyMaterial.dispose();
    this.glows.geometry.dispose();
    (this.glows.material as THREE.Material).dispose();
    this.glows.dispose();
    this.trails.geometry.dispose();
    (this.trails.material as THREE.Material).dispose();
    this.trails.dispose();
    this.group.removeFromParent();
  }
}
/** Registry keys every renderer state may resolve to (exposed for tests). */
export const ART_KEYS = Object.keys(PROJECTILE_ART) as ArtKey[];
