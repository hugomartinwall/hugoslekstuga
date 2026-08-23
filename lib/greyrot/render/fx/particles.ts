/**
 * Particle system: one draw call, animated entirely on the GPU.
 *
 * The CPU only writes spawn records into a ring buffer — position, velocity,
 * colour, lifetime. The vertex shader integrates motion from `age`, so a
 * thousand particles cost the same CPU as one. That matters because combat is
 * the particle-heavy mode and it has to hold 50 fps on a Chromebook
 * (CLAUDE.md §5).
 *
 * Additive blending into the linear HDR buffer means bright particles bloom
 * through the post stack for free.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { srgbToLinear, type RGB } from "../mesh/dsl";

const vertexShader = /* glsl */ `
  attribute vec3 aVelocity;
  attribute vec4 aSpawn;   // xyz = origin, w = spawn time
  attribute vec4 aParams;  // x = lifetime, y = size, z = drag, w = gravity
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelScale;

  varying vec3 vColor;
  varying float vFade;

  void main() {
    float age = uTime - aSpawn.w;
    float life = aParams.x;

    // Dead particles are collapsed to zero size rather than branched away —
    // uniform work per vertex keeps the GPU happy.
    float alive = step(0.0, age) * step(age, life);
    float t = clamp(age / max(life, 0.0001), 0.0, 1.0);

    // Exponential drag has a closed form, so there is no integration loop.
    float drag = aParams.z;
    float k = drag > 0.0001 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 pos = aSpawn.xyz + aVelocity * k;
    pos.y -= 0.5 * aParams.w * age * age;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    // Fade in fast, out slow. Reads as energy dissipating rather than
    // blinking off.
    float fadeIn = smoothstep(0.0, 0.08, t);
    float fadeOut = 1.0 - smoothstep(0.35, 1.0, t);
    vFade = fadeIn * fadeOut * alive;

    // Perspective-correct size, shrinking over life.
    float size = aParams.y * (1.0 - 0.45 * t) * alive;
    gl_PointSize = max(1.0, size * uPixelScale / max(-mv.z, 0.001));
    vColor = aColor;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vFade;

  void main() {
    // Round, soft-edged sprite from point coordinates — no texture needed.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float falloff = 1.0 - smoothstep(0.0, 0.25, r2);
    // Squared falloff gives a hot core, which is what blooms.
    gl_FragColor = vec4(vColor * falloff * falloff * vFade, 1.0);
  }
`;

export interface EmitOptions {
  count: number;
  origin: Vector3 | [number, number, number];
  /** Base outward speed. */
  speed: number;
  speedJitter?: number;
  /** Bias direction; omit for a uniform sphere. */
  direction?: [number, number, number];
  /** 0 = perfectly focused along `direction`, 1 = full sphere. */
  spread?: number;
  color: RGB;
  colorJitter?: number;
  lifetime: number;
  lifetimeJitter?: number;
  size: number;
  gravity?: number;
  drag?: number;
  /** Multiplier above 1 makes particles bloom. */
  intensity?: number;
}

export class Particles {
  readonly points: Points;
  private geometry: BufferGeometry;
  private material: ShaderMaterial;
  private capacity: number;
  private cursor = 0;
  private time = 0;

  private velocity: Float32Array;
  private spawn: Float32Array;
  private params: Float32Array;
  private color: Float32Array;
  /** Random stream is presentation-only, so Math.random is fine here. */
  private rand = Math.random;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.velocity = new Float32Array(capacity * 3);
    this.spawn = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 3);

    // Spawn time far in the past so nothing renders until first emit.
    for (let i = 0; i < capacity; i++) this.spawn[i * 4 + 3] = -1e6;

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute("aVelocity", new BufferAttribute(this.velocity, 3));
    this.geometry.setAttribute("aSpawn", new BufferAttribute(this.spawn, 4));
    this.geometry.setAttribute("aParams", new BufferAttribute(this.params, 4));
    this.geometry.setAttribute("aColor", new BufferAttribute(this.color, 3));
    // Instances move in the shader, so a bounding sphere from positions would
    // be wrong; skip culling entirely.
    this.geometry.boundingSphere = null;

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelScale: { value: 300 },
      },
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Resize the live budget without reallocating. */
  setBudget(n: number): void {
    this.geometry.setDrawRange(0, Math.max(0, Math.min(this.capacity, n)));
  }

  setPixelScale(heightPx: number): void {
    // Keeps apparent particle size consistent across render scales.
    this.material.uniforms.uPixelScale!.value = heightPx * 0.55;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
  }

  /** Write `count` particles into the ring buffer. Oldest are overwritten. */
  emit(o: EmitOptions): void {
    const {
      count,
      speed,
      speedJitter = 0.4,
      spread = 1,
      color,
      colorJitter = 0.08,
      lifetime,
      lifetimeJitter = 0.3,
      size,
      gravity = 0,
      drag = 2,
      intensity = 1,
    } = o;

    const ox = Array.isArray(o.origin) ? o.origin[0] : o.origin.x;
    const oy = Array.isArray(o.origin) ? o.origin[1] : o.origin.y;
    const oz = Array.isArray(o.origin) ? o.origin[2] : o.origin.z;
    const dir = o.direction ?? [0, 1, 0];

    // Convert once: the shader writes into a linear buffer.
    const r = srgbToLinear(color[0]) * intensity;
    const g = srgbToLinear(color[1]) * intensity;
    const b = srgbToLinear(color[2]) * intensity;

    const drawn = this.geometry.drawRange.count;
    const limit = drawn === Infinity ? this.capacity : Math.min(this.capacity, drawn);
    if (limit <= 0) return;

    for (let n = 0; n < count; n++) {
      const i = this.cursor % limit;
      this.cursor++;

      // Uniform point on a sphere, blended toward `direction` by `spread`.
      const u = this.rand() * 2 - 1;
      const th = this.rand() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      let vx = s * Math.cos(th);
      let vy = u;
      let vz = s * Math.sin(th);
      vx = dir[0] * (1 - spread) + vx * spread;
      vy = dir[1] * (1 - spread) + vy * spread;
      vz = dir[2] * (1 - spread) + vz * spread;

      const sp = speed * (1 + (this.rand() * 2 - 1) * speedJitter);
      this.velocity[i * 3] = vx * sp;
      this.velocity[i * 3 + 1] = vy * sp;
      this.velocity[i * 3 + 2] = vz * sp;

      this.spawn[i * 4] = ox;
      this.spawn[i * 4 + 1] = oy;
      this.spawn[i * 4 + 2] = oz;
      this.spawn[i * 4 + 3] = this.time;

      this.params[i * 4] = lifetime * (1 + (this.rand() * 2 - 1) * lifetimeJitter);
      this.params[i * 4 + 1] = size;
      this.params[i * 4 + 2] = drag;
      this.params[i * 4 + 3] = gravity;

      const cj = 1 + (this.rand() * 2 - 1) * colorJitter;
      this.color[i * 3] = r * cj;
      this.color[i * 3 + 1] = g * cj;
      this.color[i * 3 + 2] = b * cj;
    }

    // One upload per emit call, not per particle.
    (this.geometry.getAttribute("aVelocity") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aSpawn") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aParams") as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aColor") as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
