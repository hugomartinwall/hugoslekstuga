/**
 * The medium art tier's surface detail — world-space procedural grain
 * injected into the standard materials via `onBeforeCompile`.
 *
 * There are no UVs anywhere in this renderer (everything is generated
 * geometry), so all detail is a function of WORLD POSITION: a two-octave
 * value noise modulates albedo a few percent, pulls hue faintly toward moss
 * or earth, and darkens crevices by slope. The flat-shaded band look stays
 * the design (`ART_DIRECTION.md` §2.1a) — this is the hand-made grain on top
 * of it, and every knob lives in `art.ts` `DETAIL`, not here.
 *
 * One uniforms object is shared by every patched material, owned by `World`:
 * setting `uFine.value = 0` drops the second octave on Low, `uWind.value = 0`
 * stills the grass, and `uTime` drives both wind and water from the same
 * presentation clock.
 */

import { Color, Vector3, type IUniform, type MeshStandardMaterial } from "three";
import { DETAIL, WORLD } from "../art";
import { srgbToLinear } from "../mesh/dsl";

export interface DetailUniforms {
  uTime: IUniform<number>;
  /** 1 = both noise octaves, 0 = coarse only (Low tier). */
  uFine: IUniform<number>;
  /** Grass sway per metre of blade height; 0 stills it. */
  uWind: IUniform<number>;
  /** Water surface movement; 0 freezes it (Low tier's "flat" water). */
  uWaterMove: IUniform<number>;
  /** Camera end of the sight line (world). See `patchScatter`'s fade. */
  uSightA: IUniform<Vector3>;
  /** Hero-head end of the sight line (world). */
  uSightB: IUniform<Vector3>;
  /** 0 = no fade (the authored yaw — today's pixels), 1 = full strength. */
  uSightFade: IUniform<number>;
}

export function createDetailUniforms(): DetailUniforms {
  return {
    uTime: { value: 0 },
    uFine: { value: 1 },
    uWind: { value: DETAIL.windAmp / 0.55 },
    uWaterMove: { value: 1 },
    uSightA: { value: new Vector3() },
    uSightB: { value: new Vector3() },
    uSightFade: { value: 0 },
  };
}

/**
 * Shared GLSL: hash → value noise → two-octave fbm, plus the varyings the
 * fragment stages read. Cheap by construction — the fbm is 8 hashes per
 * fragment at two octaves, 4 at one.
 */
const NOISE_GLSL = /* glsl */ `
  varying vec3 vDetailPos;
  varying float vDetailNY;
  uniform float uDetailFine;
  uniform vec3 uSightA;
  uniform vec3 uSightB;
  uniform float uSightFade;

  float dhash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float dnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dhash(i), dhash(i + vec2(1.0, 0.0)), u.x),
      mix(dhash(i + vec2(0.0, 1.0)), dhash(i + vec2(1.0, 1.0)), u.x),
      u.y
    ) * 2.0 - 1.0;
  }
  float dfbm(vec2 p) {
    float n = dnoise(p * ${DETAIL.scaleCoarse.toFixed(3)});
    n += dnoise(p * ${DETAIL.scaleFine.toFixed(3)}) * 0.5 * uDetailFine;
    return n / (1.0 + 0.5 * uDetailFine);
  }
`;

const VARYING_VERTEX = /* glsl */ `
  varying vec3 vDetailPos;
  varying float vDetailNY;
`;

/** After project_vertex: world position + normal.y, instancing-aware. */
const ASSIGN_VERTEX = /* glsl */ `
  #ifdef USE_INSTANCING
    vDetailPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  vDetailNY = normalize(objectNormal).y;
`;

function inject(
  mat: MeshStandardMaterial,
  u: DetailUniforms,
  vertexExtra: string,
  fragmentColor: string,
): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uDetailFine = u.uFine;
    shader.uniforms.uWindPerM = u.uWind;
    shader.uniforms.uWaterMove = u.uWaterMove;
    shader.uniforms.uSightA = u.uSightA;
    shader.uniforms.uSightB = u.uSightB;
    shader.uniforms.uSightFade = u.uSightFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${VARYING_VERTEX}\nuniform float uTime;\nuniform float uWindPerM;`,
      )
      .replace(
        "#include <project_vertex>",
        `${vertexExtra}\n#include <project_vertex>\n${ASSIGN_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${NOISE_GLSL}\nuniform float uTime;\nuniform float uWaterMove;`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${fragmentColor}`);
  };
  // A patched program must not be shared with an unpatched material's cache
  // slot — key it by what was injected.
  mat.customProgramCacheKey = () => `detail:${vertexExtra.length}:${fragmentColor.length}`;
}

/**
 * Terrain: albedo grain, a faint hue pull, crevice darkening by slope. The
 * band colours come in through vertex colour; this only modulates them.
 */
export function patchTerrain(mat: MeshStandardMaterial, u: DetailUniforms): void {
  inject(
    mat,
    u,
    "",
    /* glsl */ `
      {
        float n = dfbm(vDetailPos.xz);
        diffuseColor.rgb *= 1.0 + n * ${DETAIL.terrainAmp.toFixed(3)};
        // Hue pull: brighter grain leans moss-green, darker leans earth-warm.
        vec3 lean = n > 0.0 ? vec3(0.9, 1.1, 0.85) : vec3(1.1, 0.95, 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * lean, abs(n) * ${DETAIL.terrainHue.toFixed(3)} * 2.0);
        // Crevices: steep faces sit out of the bounce light.
        float slope = 1.0 - clamp(vDetailNY, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - slope * ${DETAIL.crevice.toFixed(3)};
      }
    `,
  );
}

/**
 * Blockers (trunks, boulders, huts): the same grain family, quieter — plus
 * the SIGHT-LINE FADE. Placement pre-clears sightlines only for the authored
 * yaw; when the follow camera (round 7) walks the frame around, a blocker can
 * end up between the lens and the hero. Fragments near the camera→hero
 * segment screen-door out: an ordered dither + `discard`, so no blending, no
 * sorting, no extra draw calls, and the depth prepass/shadows still see the
 * full mesh. `uSightFade` is 0 at the authored yaw, so every existing capture
 * stays pixel-identical. The segment rides at head/lens height, which spares
 * roots and ground shadow contact by geometry alone.
 */
export function patchScatter(mat: MeshStandardMaterial, u: DetailUniforms): void {
  inject(
    mat,
    u,
    "",
    /* glsl */ `
      {
        float n = dfbm(vDetailPos.xz + vDetailPos.y * 0.7);
        diffuseColor.rgb *= 1.0 + n * ${DETAIL.scatterAmp.toFixed(3)};
        float fade = 0.0;
        if (uSightFade > 0.001) {
          vec3 ab = uSightB - uSightA;
          float t = clamp(dot(vDetailPos - uSightA, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
          float dSeg = length(vDetailPos - (uSightA + ab * t));
          fade = uSightFade * smoothstep(1.1, 0.55, dSeg);
        }
        // THE NEAR-LENS GUARD (R4.5). The segment fade above cannot save a
        // frame where the camera is INSIDE a blocker: it only touches
        // fragments within ~1.1 m of the camera→hero segment, and a roof the
        // lens has entered is near the LENS, not near the segment's middle —
        // so it would punch a small hole in a wall that still fills the shot.
        // It is also gated on yaw offset (main.ts ramps uSightFade from 8.6°),
        // which is exactly zero help for a prop that occludes at the AUTHORED
        // yaw — fun walked the camera through a village roof at s4→s5 with no
        // dither at all.
        //
        // uSightA is the camera position and is uploaded every frame by both
        // entries regardless of the fade strength, so this costs no uniform.
        // Threshold sits under the fence's own clearance: plantWalls empties a
        // (radius + 2.0) m stand band around the camera's ground point, so
        // nothing at an authored framing comes within 1.6 m of the lens and
        // authored frames are unchanged — asserted by capture, not assumed.
        fade = max(fade, 1.0 - smoothstep(0.9, 1.6, length(vDetailPos - uSightA)));
        if (fade > 0.001) {
          // R2-sequence ordered dither — stable per pixel, no shimmer.
          if (fract(dot(gl_FragCoord.xy, vec2(0.75487766, 0.56984029))) < fade) discard;
        }
      }
    `,
  );
}

/** An authored sRGB triple as a linear Color, for shader uniforms. */
function lin(c: readonly [number, number, number]): Color {
  return new Color(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
}

/**
 * Water: shore-aware colour and alpha, a lapping foam edge, and two moving
 * noise octaves perturbing the normal so the sun breaks up on the surface.
 *
 * The shore factor rides in as the `aShore` vertex attribute (0 at the
 * waterline, 1 in the deep), baked from the heightfield at build time —
 * the shader never needs a depth texture, which the post stack does not
 * have. `uWaterMove = 0` freezes the surface for Low tier's "flat" water.
 * Fixes the old srgb leak in passing: every colour goes through `lin()`.
 */
export function patchWater(mat: MeshStandardMaterial, u: DetailUniforms): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uDetailFine = u.uFine;
    shader.uniforms.uWaterMove = u.uWaterMove;
    shader.uniforms.uWaterShallow = { value: lin(WORLD.water) };
    shader.uniforms.uWaterDeep = { value: lin(WORLD.waterDeep) };
    shader.uniforms.uWaterFoam = { value: lin(WORLD.waterFoam) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aShore;\nvarying float vShore;\nvarying vec3 vDetailPos;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvShore = aShore;\nvDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vShore;
        varying vec3 vDetailPos;
        uniform float uTime;
        uniform float uDetailFine;
        uniform float uWaterMove;
        uniform vec3 uWaterShallow;
        uniform vec3 uWaterDeep;
        uniform vec3 uWaterFoam;
        float whash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float wnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 s = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(whash(i), whash(i + vec2(1.0, 0.0)), s.x),
            mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), s.x),
            s.y
          ) * 2.0 - 1.0;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          diffuseColor.rgb = mix(uWaterShallow, uWaterDeep, smoothstep(0.05, 0.75, vShore));
          // The lap: a noise-driven foam line breathing along the shore.
          float lap = wnoise(vDetailPos.xz * 0.9 + vec2(uTime * 0.25 * uWaterMove, 0.0)) * 0.5 + 0.5;
          float foam = smoothstep(0.09, 0.015, vShore) * (0.35 + 0.65 * lap);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWaterFoam, foam * 0.85);
          // Shallows show the ground through; the deep does not.
          diffuseColor.a *= mix(0.55, 1.0, smoothstep(0.0, 0.6, vShore));
          diffuseColor.a = max(diffuseColor.a, foam * 0.9);
        }`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        /* glsl */ `#include <normal_fragment_begin>
        {
          // Gentle: at 2× this amplitude the whole lake caught the sun at
          // once and read as a silver sheet, not water.
          vec2 p = vDetailPos.xz;
          float t = uTime * uWaterMove;
          float n1 = wnoise(p * 0.55 + vec2(t * 0.10, t * 0.07));
          float n2 = wnoise(p * 1.90 - vec2(t * 0.16, t * 0.11)) * uDetailFine;
          normal = normalize(normal + vec3(n1 * 0.07 + n2 * 0.05, 0.0, n1 * 0.05 + n2 * 0.04));
        }`,
      );
  };
  mat.customProgramCacheKey = () => "detail:water";
}

/**
 * Ground haze: a horizon-coloured breath that thickens toward the valley
 * floor — the "painted valley air" read, and it costs one smoothstep. Patched
 * onto the terrain's fog stage only: the ground carries the read; hazing
 * every material would just be more fog.
 */
export function patchHaze(mat: MeshStandardMaterial, waterLevel: number): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      /* glsl */ `#include <fog_fragment>
      #ifdef USE_FOG
      {
        float haze = smoothstep(
          ${(waterLevel + DETAIL.hazeBelow + DETAIL.hazeFade).toFixed(2)},
          ${(waterLevel + DETAIL.hazeBelow).toFixed(2)},
          vDetailPos.y
        ) * ${DETAIL.hazeAmount.toFixed(3)};
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, haze);
      }
      #endif`,
    );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}:haze`;
}

/**
 * Grass: the scatter grain plus a vertex-stage sway. Per-instance phase from
 * the instance's own translation, amplitude scaled by height above the root
 * so blades bend rather than slide.
 */
export function patchGrass(mat: MeshStandardMaterial, u: DetailUniforms): void {
  inject(
    mat,
    u,
    /* glsl */ `
      {
        #ifdef USE_INSTANCING
          float ph = dot(instanceMatrix[3].xz, vec2(0.31, 0.77));
        #else
          float ph = 0.0;
        #endif
        float sway = sin(uTime * 1.9 + ph) + sin(uTime * 3.1 + ph * 1.7) * 0.4;
        transformed.x += sway * uWindPerM * max(transformed.y, 0.0);
        transformed.z += sway * uWindPerM * 0.6 * max(transformed.y, 0.0);
      }
    `,
    /* glsl */ `
      {
        float n = dfbm(vDetailPos.xz);
        diffuseColor.rgb *= 1.0 + n * ${DETAIL.scatterAmp.toFixed(3)};
      }
    `,
  );
}
