/**
 * Post-processing: bloom, tonemap, colour grade.
 *
 * Hand-rolled rather than three's EffectComposer + UnrealBloomPass. Two
 * reasons, both about the hardware floor (CLAUDE.md §5): UnrealBloomPass runs a
 * fixed five-mip chain we can't cheapen, and we need the mip count to be a
 * per-tier budget. This is ~1 full-screen triangle per pass and the whole
 * chain drops to a single composite on Low.
 *
 * ## Colour pipeline
 *
 * Everything renders LINEAR into a half-float target — including the sky,
 * which is why its palette is converted on the way into its uniforms. Bloom
 * works on those linear values (bloom on already-tonemapped colour is what
 * makes cheap engines look milky). The composite does the one and only
 * tonemap + sRGB encode. `renderer.toneMapping` must stay NoToneMapping or it
 * happens twice.
 */

import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type WebGLRenderer,
} from "three";
import { DETAIL as ART_DETAIL, GRADE as ART_GRADE } from "../art";
import type { QualitySettings } from "../quality";

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Isolate pixels above the threshold, with a soft knee so edges don't crawl. */
const brightFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float contrib = max(soft, lum - uThreshold) / max(lum, 1e-4);
    gl_FragColor = vec4(c * contrib, 1.0);
  }
`;

/** Dual-filter (Kawase) blur: 4 taps, and it looks smoother than a box. */
const blurFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uRadius;
  void main() {
    vec2 o = uTexel * uRadius;
    vec3 c = texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
    c += texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb;
    c += texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb;
    c += texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
  }
`;

const compositeFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloomStrength;
  uniform float uExposure;
  uniform float uVignette;
  uniform float uSaturation;
  uniform vec3 uLift;
  uniform float uGrain;
  uniform float uFrame;
  // The resaturation wave (R1): centre.xy in UV, z = front radius in
  // aspect-corrected UV units (<= 0.0 disables), w = front thickness.
  uniform vec4 uWave;
  // x = saturation inside the front, y = warm-band strength, z = aspect.
  uniform vec3 uWaveParams;
  uniform vec3 uWaveColor;

  // Narkowicz's ACES approximation. Cheap, and it rolls highlights off
  // gracefully instead of clipping them to flat white.
  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    vec3 col = texture2D(tScene, vUv).rgb;
    col += texture2D(tBloom, vUv).rgb * uBloomStrength;

    col *= uExposure;
    col = aces(col);

    // Grade, after tonemapping so it behaves like a colour grade rather than
    // a lighting change.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    // The resaturation wave: inside the expanding front the frame carries the
    // restored saturation; outside it keeps the (drained) base. The front
    // itself gets a warm additive band — colour visibly ARRIVING, not just a
    // boundary between two greys. A handful of ALU in a pass that always
    // runs, so Low tier pays nothing it wasn't already paying.
    float sat = uSaturation;
    float warm = 0.0;
    if (uWave.z > 0.0) {
      float d = length((vUv - uWave.xy) * vec2(uWaveParams.z, 1.0));
      float inside = 1.0 - smoothstep(uWave.z - uWave.w, uWave.z, d);
      sat = mix(sat, uWaveParams.x, inside);
      warm = (1.0 - smoothstep(0.0, uWave.w, abs(d - uWave.z))) * uWaveParams.y;
    }
    col = mix(vec3(lum), col, sat);
    col += uWaveColor * warm;
    col += uLift;

    float d = distance(vUv, vec2(0.5));
    col *= 1.0 - smoothstep(0.55, 0.95, d) * uVignette;

    // Film grain — a whisper of hash noise, re-seeded per frame so it lives
    // rather than sitting as a fixed pattern. Effectively free: one hash in
    // a pass that already exists.
    float g = fract(sin(dot(vUv + fract(uFrame * 0.6180339887), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    col += g * uGrain;

    // sRGB encode — the single output transfer for the whole pipeline.
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeTarget(w: number, h: number, depth = false): WebGLRenderTarget {
  // depth must be decided at construction: assigning `.depthBuffer` afterwards
  // does not reattach the buffer, it just silently disagrees with the GPU.
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: HalfFloatType, // linear HDR: bloom needs values above 1
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: depth,
    stencilBuffer: false,
  });
}

export interface GradeSettings {
  exposure: number;
  saturation: number;
  lift: [number, number, number];
  vignette: number;
  bloomStrength: number;
  bloomThreshold: number;
}

/**
 * The authored grade lives in render/art.ts — see the "no colour literal
 * outside art.ts" rule there. `saturation` in particular is a GAMEPLAY value,
 * not just a look: clearing a stage pushes it up and standing in active
 * Greyrot pulls it down (`docs/GAME_DESIGN.md` §1).
 */
export const DEFAULT_GRADE: GradeSettings = {
  exposure: ART_GRADE.exposure,
  saturation: ART_GRADE.saturation,
  lift: [...ART_GRADE.lift] as [number, number, number],
  vignette: ART_GRADE.vignette,
  bloomStrength: 0.55,
  bloomThreshold: ART_GRADE.bloomThreshold,
};

export class PostStack {
  private renderer: WebGLRenderer;
  private sceneTarget: WebGLRenderTarget;
  private mips: WebGLRenderTarget[] = [];
  private quad: Mesh;
  private quadScene = new Scene();
  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private brightMat: ShaderMaterial;
  private blurMat: ShaderMaterial;
  private compositeMat: ShaderMaterial;

  private width = 1;
  private height = 1;
  private mipCount = 0;
  private bloomEnabled = true;
  private grade: GradeSettings = { ...DEFAULT_GRADE };
  /** A 1x1 black target, bound when bloom is off so the shader stays valid. */
  private blackTarget: WebGLRenderTarget;
  /**
   * Draw calls and triangles for the SCENE pass. renderer.info reports only
   * the most recent render, which after compositing is a single full-screen
   * quad — useless for budgeting.
   */
  readonly sceneStats = { calls: 0, triangles: 0 };

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.sceneTarget = makeTarget(1, 1, true); // the scene pass needs depth
    this.blackTarget = makeTarget(1, 1);

    this.brightMat = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: brightFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: this.grade.bloomThreshold },
        uKnee: { value: 0.35 },
      },
    });
    this.blurMat = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: blurFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new Vector2() },
        uRadius: { value: 1 },
      },
    });
    this.compositeMat = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uBloomStrength: { value: this.grade.bloomStrength },
        uExposure: { value: this.grade.exposure },
        uVignette: { value: this.grade.vignette },
        uSaturation: { value: this.grade.saturation },
        uLift: { value: this.grade.lift },
        uGrain: { value: ART_DETAIL.grain },
        uFrame: { value: 0 },
        uWave: { value: new Vector4(0.5, 0.5, 0, 0.16) },
        uWaveParams: { value: new Vector3(1, 0, 1) },
        uWaveColor: { value: new Vector3(0, 0, 0) },
      },
    });

    // One triangle-ish quad reused for every pass.
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.brightMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setQuality(q: QualitySettings): void {
    this.bloomEnabled = q.bloom;
    this.mipCount = q.bloomMips;
    this.rebuildMips();
  }

  /**
   * Drive the resaturation wave (R1). `radius <= 0` disables — the resting
   * state, and the born state. Centre is in UV (0..1, y up); radius/width in
   * aspect-corrected UV units so the front is round on every viewport.
   * `sat` is the saturation inside the front; `warm` the band's additive
   * strength; `color` the band's colour as a LINEAR RGB triple (the caller
   * converts from the authored sRGB — same boundary rule as every material).
   */
  setWave(
    cx: number,
    cy: number,
    radius: number,
    width: number,
    sat: number,
    warm: number,
    color: [number, number, number],
  ): void {
    const u = this.compositeMat.uniforms;
    (u.uWave!.value as Vector4).set(cx, cy, radius, width);
    (u.uWaveParams!.value as Vector3).set(sat, warm, this.width / Math.max(1, this.height));
    (u.uWaveColor!.value as Vector3).set(color[0], color[1], color[2]);
  }

  setGrade(g: Partial<GradeSettings>): void {
    this.grade = { ...this.grade, ...g };
    this.brightMat.uniforms.uThreshold!.value = this.grade.bloomThreshold;
    const u = this.compositeMat.uniforms;
    u.uBloomStrength!.value = this.grade.bloomStrength;
    u.uExposure!.value = this.grade.exposure;
    u.uVignette!.value = this.grade.vignette;
    u.uSaturation!.value = this.grade.saturation;
    u.uLift!.value = this.grade.lift;
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.sceneTarget.setSize(this.width, this.height);
    this.rebuildMips();
  }

  private rebuildMips(): void {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    if (!this.bloomEnabled) return;
    let w = this.width;
    let h = this.height;
    for (let i = 0; i < this.mipCount; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(makeTarget(w, h));
    }
  }

  private blit(material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /** Render `scene` through the full chain and present to the canvas. */
  render(scene: Scene, camera: Camera): void {
    const r = this.renderer;
    // Presentation-only frame counter — it just re-seeds the grain.
    this.compositeMat.uniforms.uFrame!.value =
      (this.compositeMat.uniforms.uFrame!.value + 1) % 1024;

    r.setRenderTarget(this.sceneTarget);
    r.clear();
    r.render(scene, camera);
    this.sceneStats.calls = r.info.render.calls;
    this.sceneStats.triangles = r.info.render.triangles;

    if (this.bloomEnabled && this.mips.length > 0) {
      // Bright pass into the first (half-res) mip.
      this.brightMat.uniforms.tScene!.value = this.sceneTarget.texture;
      this.blit(this.brightMat, this.mips[0]!);

      // Progressive downsample. Each level widens the blur for free.
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1]!;
        const dst = this.mips[i]!;
        this.blurMat.uniforms.tSrc!.value = src.texture;
        (this.blurMat.uniforms.uTexel!.value as Vector2).set(
          1 / src.width,
          1 / src.height,
        );
        this.blurMat.uniforms.uRadius!.value = 1.2;
        this.blit(this.blurMat, dst);
      }

      // One widening pass back up, into the largest mip, so the glow spreads
      // rather than sitting as a hard halo.
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i]!;
        const dst = this.mips[i - 1]!;
        this.blurMat.uniforms.tSrc!.value = src.texture;
        (this.blurMat.uniforms.uTexel!.value as Vector2).set(
          1 / src.width,
          1 / src.height,
        );
        this.blurMat.uniforms.uRadius!.value = 2.0;
        this.blit(this.blurMat, dst);
      }
    }

    this.compositeMat.uniforms.tScene!.value = this.sceneTarget.texture;
    this.compositeMat.uniforms.tBloom!.value =
      this.bloomEnabled && this.mips[0] ? this.mips[0].texture : this.blackTarget.texture;
    this.compositeMat.uniforms.uBloomStrength!.value = this.bloomEnabled
      ? this.grade.bloomStrength
      : 0;
    this.blit(this.compositeMat, null);
  }

  dispose(): void {
    this.sceneTarget.dispose();
    this.blackTarget.dispose();
    for (const m of this.mips) m.dispose();
    this.quad.geometry.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
