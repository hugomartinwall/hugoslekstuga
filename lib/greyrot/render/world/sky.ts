/**
 * Art-directed sky gradient with a sun disc and horizon glow.
 *
 * Zero bytes of texture for something that fills half the screen and sets the
 * mood of every scene — the best value-per-kilobyte in the renderer, and the
 * whole argument for a procedural pipeline (CLAUDE.md §2).
 *
 * ## Why this is not a scattering model
 *
 * The first version integrated Rayleigh + Mie properly. It looked wrong: the
 * optical depth term reaches ~5.9 at the horizon, and once that goes through a
 * tonemap the entire sky saturates to white. Worse, adding the Mie term evenly
 * across the dome collapsed the R:G:B ratio from 1:2.4:4.1 to 1:1.5:2.1 —
 * physically defensible, visually a grey wash.
 *
 * Getting a stylised low-poly fantasy game to look good is a colour-choice
 * problem, not a physics problem. A three-stop gradient with a sun-warmed
 * horizon is cheaper, is directly tunable, and is the look we actually want.
 * Colours are authored in sRGB — the way a human picks them — and converted to
 * linear on the way into the uniforms, because the sky renders into the same
 * linear HDR buffer as everything else and the post stack owns the single
 * tonemap and sRGB encode (see fx/post.ts).
 */

import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { WORLD as ART_WORLD } from "../art";
import { srgbToLinear } from "../mesh/dsl";

const vertexShader = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;

  varying vec3 vWorldDir;

  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunHeight;

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;
    float sunDot = dot(dir, normalize(uSunDir));

    // Most of the visual interest lives just above the horizon, so bias the
    // gradient there rather than spreading it evenly up the dome.
    float t = pow(clamp(y, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uZenith, t);

    // Warm the sky toward the sun, strongest near the horizon. This is the
    // one cue that sells "there is a sun over there" without a lens flare.
    float glow = pow(max(sunDot, 0.0), 5.0) * (1.0 - t * 0.75);
    col = mix(col, uSunColor, glow * 0.6);

    // Soft strata just above the horizon — a painted sky has brushwork in
    // it. Static and gentle: two superposed sines read as haze layers, and
    // the (1 - t)² falloff keeps the zenith perfectly clean.
    float band = sin(y * 34.0) * 0.6 + sin(y * 11.0 + 1.7) * 0.4;
    col *= 1.0 + band * 0.035 * (1.0 - t) * (1.0 - t);

    // The disc, and a tight halo. Deliberately pushed well above 1.0: this is
    // a linear HDR buffer, and the sun is the one thing in the scene that
    // should genuinely blow out and bloom.
    float disc = smoothstep(0.9992, 0.9997, sunDot);
    float halo = pow(max(sunDot, 0.0), 350.0);
    float visible = smoothstep(-0.08, 0.06, uSunHeight);
    col += uSunColor * (disc * 12.0 + halo * 1.5) * visible;

    // Below the horizon, fade to ground haze — the traversal camera does dip
    // below level, and the underside of a dome is not a view.
    col = mix(col, uGround, smoothstep(0.0, -0.1, y));

    // Linear out. No clamp — the post stack tonemaps.
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

/** Keyframed palettes by sun elevation. Interpolated, so dawn/dusk come free. */
interface SkyPalette {
  zenith: [number, number, number];
  horizon: [number, number, number];
  sun: [number, number, number];
  ground: [number, number, number];
}

const NIGHT: SkyPalette = {
  zenith: [0.04, 0.06, 0.14],
  horizon: [0.12, 0.14, 0.24],
  sun: [0.35, 0.38, 0.55],
  ground: [0.06, 0.07, 0.1],
};
const GOLDEN: SkyPalette = {
  zenith: [0.20, 0.34, 0.62],
  horizon: [0.95, 0.62, 0.38],
  sun: [1.0, 0.72, 0.38],
  ground: [0.3, 0.26, 0.22],
};
/**
 * The game's daylight, and it is deliberately NOT a neutral midday: the
 * authored look is a warm hand-made forest floor at golden hour
 * (`docs/ART_DIRECTION.md` §2.1). A cool blue-white sky was what made the
 * first pass read as a tech demo rather than as somewhere you would sit down.
 */
const DAY: SkyPalette = {
  zenith: [...ART_WORLD.skyZenith] as [number, number, number],
  horizon: [...ART_WORLD.skyHorizon] as [number, number, number],
  sun: [...ART_WORLD.sunDisc] as [number, number, number],
  ground: [...ART_WORLD.skyGround] as [number, number, number],
};

const mix3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function paletteFor(sunHeight: number): SkyPalette {
  if (sunHeight < 0.02) {
    const t = Math.min(1, Math.max(0, (sunHeight + 0.2) / 0.22));
    return {
      zenith: mix3(NIGHT.zenith, GOLDEN.zenith, t),
      horizon: mix3(NIGHT.horizon, GOLDEN.horizon, t),
      sun: mix3(NIGHT.sun, GOLDEN.sun, t),
      ground: mix3(NIGHT.ground, GOLDEN.ground, t),
    };
  }
  const t = Math.min(1, Math.max(0, (sunHeight - 0.02) / 0.3));
  return {
    zenith: mix3(GOLDEN.zenith, DAY.zenith, t),
    horizon: mix3(GOLDEN.horizon, DAY.horizon, t),
    sun: mix3(GOLDEN.sun, DAY.sun, t),
    ground: mix3(GOLDEN.ground, DAY.ground, t),
  };
}

export class Sky {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private sun = new Vector3(0.45, 0.32, 0.25).normalize();
  private palette: SkyPalette = DAY;

  constructor(radius = 1) {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false, // the sky IS the fog colour; fogging it would double up
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uGround: { value: new Color() },
        uSunColor: { value: new Color() },
        uSunDir: { value: this.sun.clone() },
        uSunHeight: { value: this.sun.y },
      },
    });

    // The shader is smooth; the geometry only has to be a dome. 16x10 is 320
    // triangles for the entire sky.
    this.mesh = new Mesh(new SphereGeometry(radius, 16, 10), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.refresh();
  }

  /** Sun direction. Drives sky colour, the key light, and time of day. */
  setSun(x: number, y: number, z: number): void {
    this.sun.set(x, y, z).normalize();
    this.refresh();
  }

  private refresh(): void {
    this.palette = paletteFor(this.sun.y);
    const u = this.material.uniforms;
    const lin = (c: [number, number, number]): [number, number, number] => [
      srgbToLinear(c[0]),
      srgbToLinear(c[1]),
      srgbToLinear(c[2]),
    ];
    (u.uZenith!.value as Color).setRGB(...lin(this.palette.zenith));
    (u.uHorizon!.value as Color).setRGB(...lin(this.palette.horizon));
    (u.uGround!.value as Color).setRGB(...lin(this.palette.ground));
    (u.uSunColor!.value as Color).setRGB(...lin(this.palette.sun));
    (u.uSunDir!.value as Vector3).copy(this.sun);
    u.uSunHeight!.value = this.sun.y;
  }

  get sunDirection(): Vector3 {
    return this.sun.clone();
  }

  /**
   * Fog colour. Matching fog to the horizon is what makes distant terrain
   * dissolve instead of ending at a visible edge — and on the Low tier, where
   * the draw distance is short, the fog is doing a lot of work (CLAUDE.md §5).
   */
  horizonColor(): Color {
    // Linear: three's Fog and lights operate in the linear working space, so
    // returning the authored sRGB values here would make the fog visibly
    // lighter than the sky it is supposed to disappear into.
    const c = this.palette.horizon;
    return new Color().setRGB(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
  }

  /** Warm key-light colour that agrees with the current sky. Linear. */
  sunLightColor(): Color {
    const c = this.palette.sun;
    return new Color().setRGB(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
  }

  /** Keep the dome centred on the camera so it never clips the far plane. */
  follow(x: number, y: number, z: number, radius: number): void {
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(radius);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
