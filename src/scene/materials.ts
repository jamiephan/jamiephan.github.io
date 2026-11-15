/**
 * Custom shaders for the space scene.
 *
 * Everything is lit by a single directional "Sun" (`uSunDir`, world space, pointing *towards*
 * the Sun). Shadows between bodies (eclipses, ring shadows) are computed analytically against
 * spheres and planes, so there are no shadow maps or extra render passes.
 */
import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  Color,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from "three";

/** Shared uniform objects: updating `.value` once updates every material that uses them. */
export interface LightingUniforms {
  uSunDir: { value: Vector3 };
  uSunColor: { value: Color };
}

export const createLightingUniforms = (direction: Vector3, color: Color): LightingUniforms => ({
  uSunDir: { value: direction.clone().normalize() },
  uSunColor: { value: color.clone() },
});

/* ---------------------------------------------------------------------------------------------
 * GLSL helpers
 * ------------------------------------------------------------------------------------------- */

const COMMON = /* glsl */ `
  #define PI 3.141592653589793

  // Distances along a ray to the near/far intersections with a sphere at the origin.
  // Returns (1e9, -1e9) on a miss.
  vec2 raySphere(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  // Fraction of sunlight reaching \`p\` past an occluding sphere (xyz = centre, w = radius),
  // with a penumbra that widens with distance like a real one.
  float sphereShadow(vec3 p, vec3 sunDir, vec4 sphere) {
    vec3 toCentre = sphere.xyz - p;
    float along = dot(toCentre, sunDir);
    if (along <= 0.0) return 1.0;
    float miss = length(toCentre - sunDir * along);
    // Wider than a real penumbra: distances here are compressed, so a real one looks too hard.
    float penumbra = 0.08 * sphere.w + along * 0.03;
    return smoothstep(sphere.w - penumbra, sphere.w + penumbra, miss);
  }

  // Object-space normal on a UV sphere perturbed by a tangent-space normal.
  vec3 perturbSphereNormal(vec3 n, vec3 tangentNormal) {
    vec3 t = cross(vec3(0.0, 1.0, 0.0), n);
    float len = length(t);
    t = len > 1e-5 ? t / len : vec3(1.0, 0.0, 0.0);
    vec3 b = cross(n, t);
    return normalize(t * tangentNormal.x + b * tangentNormal.y + n * tangentNormal.z);
  }

  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

const SPHERE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vObjNormal = normal;
    vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SPHERE_VARYINGS = /* glsl */ `
  uniform mat4 modelMatrix;
  varying vec2 vUv;
  varying vec3 vObjNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
`;

/* ---------------------------------------------------------------------------------------------
 * Earth
 * ------------------------------------------------------------------------------------------- */

export interface EarthTextures {
  day: Texture;
  night: Texture;
  normal: Texture;
  specular: Texture;
  clouds: Texture;
}

export const createEarthMaterial = (
  textures: EarthTextures,
  lighting: LightingUniforms,
  occluder: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uDay: { value: textures.day },
      uNight: { value: textures.night },
      uNormal: { value: textures.normal },
      uSpecular: { value: textures.specular },
      uClouds: { value: textures.clouds },
      uCloudOffset: { value: 0 },
      uNormalStrength: { value: 1.6 },
      uOccluder: occluder,
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SPHERE_VARYINGS}
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform sampler2D uNormal;
      uniform sampler2D uSpecular;
      uniform sampler2D uClouds;
      uniform float uCloudOffset;
      uniform float uNormalStrength;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;

      void main() {
        vec3 L = uSunDir;
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 geoN = normalize(vWorldNormal);

        // Terrain relief from the normal map (oceans are flat).
        vec3 tangentNormal = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
        tangentNormal.xy *= uNormalStrength;
        vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));

        float geoNdL = dot(geoN, L);
        float NdL = max(dot(N, L), 0.0);
        // Smooth the terminator so relief can't light up on the night side.
        float dayMask = smoothstep(-0.05, 0.12, geoNdL);

        // Slightly deepen the satellite mosaic: darker oceans, deserts that don't clip.
        vec3 albedo = pow(texture2D(uDay, vUv).rgb, vec3(1.15)) * 0.85;
        float ocean = texture2D(uSpecular, vUv).r;
        float cloud = texture2D(uClouds, vUv + vec2(uCloudOffset, 0.0)).r;

        // Clouds cast soft shadows; the Moon can eclipse the Sun.
        float shadow = (1.0 - 0.55 * cloud) * mix(0.15, 1.0, sphereShadow(vWorldPos, L, uOccluder));

        // Reddened, dimmer light near the terminator (sunlight through more atmosphere).
        vec3 sunTint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0), smoothstep(0.0, 0.35, geoNdL));
        vec3 light = uSunColor * sunTint * shadow;

        vec3 color = albedo * light * NdL * dayMask;

        // Ocean: sharp sun glint plus a broad sheen, stronger at grazing angles (Fresnel).
        vec3 H = normalize(L + V);
        float NdH = max(dot(geoN, H), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
        float glint = pow(NdH, 180.0) * 3.0 + pow(NdH, 18.0) * 0.12;
        color += ocean * light * glint * (0.35 + fresnel) * smoothstep(0.0, 0.1, geoNdL) * (1.0 - cloud);

        // City lights on the night side, hidden under clouds.
        float night = 1.0 - smoothstep(-0.2, 0.08, geoNdL);
        vec3 lights = texture2D(uNight, vUv).rgb;
        color += lights * vec3(1.0, 0.82, 0.6) * 1.4 * night * (1.0 - 0.8 * cloud);

        // Faint earthshine / ambient so the night side is never pure black.
        color += albedo * vec3(0.012, 0.016, 0.024);

        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

export const createCloudMaterial = (
  clouds: Texture,
  lighting: LightingUniforms,
  occluder: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uClouds: { value: clouds }, uOccluder: occluder },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SPHERE_VARYINGS}
      uniform sampler2D uClouds;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;

      void main() {
        float density = texture2D(uClouds, vUv).r;
        vec3 N = normalize(vWorldNormal);
        float NdL = dot(N, uSunDir);

        // Wrapped diffuse: clouds scatter light a little past the terminator.
        float lit = clamp((NdL + 0.18) / 1.18, 0.0, 1.0);
        vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(-0.05, 0.3, NdL));
        float shadow = sphereShadow(vWorldPos, uSunDir, uOccluder);

        vec3 color = uSunColor * tint * lit * shadow * 0.85 + vec3(0.006, 0.008, 0.014);
        gl_FragColor = vec4(color, density * 0.95);
        ${OUTPUT}
      }
    `,
  });

/**
 * Single-scattering atmosphere (Rayleigh + Mie), ray-marched per pixel on a shell around the
 * planet. Distances are normalised to the planet radius; densities are tuned so a vertical
 * column has Earth's real optical depth, just over a slightly thicker shell for readability.
 */
export const createAtmosphereMaterial = (
  lighting: LightingUniforms,
  planetRadius: number,
  atmosphereRadius: number,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uCenter: { value: new Vector3() },
      uPlanetRadius: { value: planetRadius },
      uAtmosphereRadius: { value: atmosphereRadius / planetRadius },
      uIntensity: { value: 14 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    defines: { PRIMARY_STEPS: 14, LIGHT_STEPS: 4 },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vWorldPos;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uCenter;
      uniform float uPlanetRadius;
      uniform float uAtmosphereRadius;
      uniform float uIntensity;

      // Scale heights (fraction of planet radius) and scattering coefficients (per radius).
      const float H_R = 0.0052;
      const float H_M = 0.0016;
      const vec3 BETA_R = vec3(8.9, 20.8, 51.0);
      const float BETA_M = 15.0;
      const float MIE_G = 0.76;

      void main() {
        vec3 origin = (cameraPosition - uCenter) / uPlanetRadius;
        vec3 dir = normalize(vWorldPos - cameraPosition);
        vec3 L = uSunDir;

        vec2 atmo = raySphere(origin, dir, uAtmosphereRadius);
        vec2 ground = raySphere(origin, dir, 1.0);
        float start = max(atmo.x, 0.0);
        float end = ground.x > 0.0 ? min(atmo.y, ground.x) : atmo.y;
        if (end <= start) discard;

        float stepSize = (end - start) / float(PRIMARY_STEPS);
        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        float depthR = 0.0;
        float depthM = 0.0;

        for (int i = 0; i < PRIMARY_STEPS; i++) {
          vec3 p = origin + dir * (start + stepSize * (float(i) + 0.5));
          float height = length(p) - 1.0;
          float densityR = exp(-height / H_R) * stepSize;
          float densityM = exp(-height / H_M) * stepSize;
          depthR += densityR;
          depthM += densityM;

          // Soft planet shadow: how far the sun ray dips below the surface.
          float along = dot(p, L);
          float closest = length(p - L * along);
          float sunlit = along > 0.0 ? 1.0 : smoothstep(0.985, 1.003, closest);
          if (sunlit <= 0.0) continue;

          float lightStep = raySphere(p, L, uAtmosphereRadius).y / float(LIGHT_STEPS);
          float lightR = 0.0;
          float lightM = 0.0;
          for (int j = 0; j < LIGHT_STEPS; j++) {
            float h = length(p + L * (lightStep * (float(j) + 0.5))) - 1.0;
            lightR += exp(-max(h, 0.0) / H_R) * lightStep;
            lightM += exp(-max(h, 0.0) / H_M) * lightStep;
          }

          vec3 attenuation = exp(-(BETA_R * (depthR + lightR) + BETA_M * 1.1 * (depthM + lightM)));
          sumR += densityR * attenuation * sunlit;
          sumM += densityM * attenuation * sunlit;
        }

        float mu = dot(dir, L);
        float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
        float g2 = MIE_G * MIE_G;
        float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu))
          / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

        vec3 color = uIntensity * uSunColor * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
        // Keep the haze over the disc subtle so surface detail stays crisp; the limb keeps full glow.
        if (ground.x > 0.0) color *= 0.4;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

/* ---------------------------------------------------------------------------------------------
 * Planets and moons
 * ------------------------------------------------------------------------------------------- */

/**
 * Thin-atmosphere glow at the limb of the sunlit side (cheap stand-in for real scattering on
 * bodies that are only ever a few hundred pixels across).
 */
const RIM = /* glsl */ `
  vec3 atmosphereRim(vec3 N, vec3 V, vec3 L, vec3 rimColor) {
    float edge = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    return rimColor * edge * smoothstep(-0.25, 0.35, dot(N, L));
  }
`;

export interface RockyBodyOptions {
  /** Height of one texel in UV units: [1 / width, 1 / height]. */
  texelSize: [number, number];
  /** Strength of the bump derived from albedo. */
  bump?: number;
  /** A sphere that can eclipse the Sun (xyz = centre, w = radius). */
  occluder?: { value: Vector4 };
  /** Light reflected from a nearby planet onto the night side. */
  ambient?: Color;
  /** Colour of a thin atmosphere at the limb (black = none). */
  rim?: Color;
}

/** Airless (or nearly airless) rocky bodies: the Moon, Mercury, Mars. */
export const createRockyMaterial = (
  map: Texture,
  lighting: LightingUniforms,
  {
    texelSize,
    bump = 7,
    occluder = { value: new Vector4(0, 0, 0, 0) },
    ambient = new Color(0.004, 0.005, 0.007),
    rim = new Color(0, 0, 0),
  }: RockyBodyOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uMap: { value: map },
      uTexel: { value: new Vector2(...texelSize) },
      uBump: { value: bump },
      uOccluder: occluder,
      uAmbient: { value: ambient },
      uRim: { value: rim },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${RIM}
      ${SPHERE_VARYINGS}
      uniform sampler2D uMap;
      uniform vec2 uTexel;
      uniform float uBump;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uOccluder;
      uniform vec3 uAmbient;
      uniform vec3 uRim;

      void main() {
        vec3 albedo = texture2D(uMap, vUv).rgb;

        // Bump from the albedo's luminance gradient: craters and ridges catch the light.
        vec2 dx = vec2(uTexel.x * 1.5, 0.0);
        vec2 dy = vec2(0.0, uTexel.y * 1.5);
        float gx = lum(texture2D(uMap, vUv + dx).rgb) - lum(texture2D(uMap, vUv - dx).rgb);
        float gy = lum(texture2D(uMap, vUv + dy).rgb) - lum(texture2D(uMap, vUv - dy).rgb);
        vec3 tangentNormal = normalize(vec3(-gx * uBump, -gy * uBump, 1.0));
        vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));
        vec3 geoN = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = uSunDir;

        // Regolith reflects light back towards the source (Lommel–Seeliger), so a full Moon
        // looks evenly bright instead of fading to the limb like a Lambertian sphere.
        float mu0 = max(dot(N, L), 0.0);
        float mu = max(dot(geoN, V), 0.0);
        float lommel = 2.0 * mu0 / (mu0 + mu + 0.1);
        float lit = mix(mu0, lommel, 0.55) * smoothstep(-0.02, 0.06, dot(geoN, L));

        // Eclipse: an umbra tinted red by sunsets around the occluding planet's rim.
        float shadow = uOccluder.w > 0.0 ? sphereShadow(vWorldPos, L, uOccluder) : 1.0;
        vec3 eclipse = mix(vec3(0.22, 0.06, 0.02), vec3(1.0), shadow);

        vec3 color = albedo * uSunColor * lit * eclipse;
        color += albedo * uAmbient;
        color += atmosphereRim(geoN, V, L, uRim) * uSunColor;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

export interface RingUniforms {
  uRingNormal: { value: Vector3 };
  uRingCenter: { value: Vector3 };
  /** Inner / outer ring radius in world units. */
  uRingRadii: { value: Vector2 };
  uRing: { value: Texture };
}

export const createRingUniforms = (ring: Texture, inner: number, outer: number): RingUniforms => ({
  uRingNormal: { value: new Vector3(0, 1, 0) },
  uRingCenter: { value: new Vector3() },
  uRingRadii: { value: new Vector2(inner, outer) },
  uRing: { value: ring },
});

export interface CloudyPlanetOptions {
  /** Ring system that casts shadows onto the planet. */
  ring?: RingUniforms;
  /** Colour of the haze at the limb (black = none). */
  rim?: Color;
  /** 0 = no limb darkening, 1 = strong. */
  limbDarkening?: number;
}

/** Planets whose visible surface is cloud tops: Venus and the giants. */
export const createCloudyPlanetMaterial = (
  map: Texture,
  lighting: LightingUniforms,
  { ring, rim = new Color(0, 0, 0), limbDarkening = 0.35 }: CloudyPlanetOptions = {},
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      ...ring,
      uMap: { value: map },
      uRim: { value: rim },
      uLimbDarkening: { value: limbDarkening },
    },
    defines: ring ? { HAS_RING: "" } : {},
    vertexShader: SPHERE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${RIM}
      ${SPHERE_VARYINGS}
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uRim;
      uniform float uLimbDarkening;
      #ifdef HAS_RING
        uniform sampler2D uRing;
        uniform vec3 uRingNormal;
        uniform vec3 uRingCenter;
        uniform vec2 uRingRadii;
      #endif

      void main() {
        vec3 albedo = texture2D(uMap, vUv).rgb;
        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 L = uSunDir;
        float NdL = max(dot(N, L), 0.0);

        float shadow = 1.0;
        #ifdef HAS_RING
          // Shadow of the rings: follow the sun ray to the ring plane and look up its opacity.
          float denom = dot(L, uRingNormal);
          if (abs(denom) > 1e-4) {
            float t = dot(uRingCenter - vWorldPos, uRingNormal) / denom;
            if (t > 0.0) {
              float r = length(vWorldPos + L * t - uRingCenter);
              float x = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
              if (x > 0.0 && x < 1.0) shadow = 1.0 - 0.9 * texture2D(uRing, vec2(x, 0.5)).a;
            }
          }
        #endif

        // Hazy upper atmosphere: limb darkening and a soft terminator.
        float limb = mix(1.0 - uLimbDarkening, 1.0, pow(max(dot(N, V), 0.0), 0.35));
        float lit = smoothstep(-0.08, 0.25, dot(N, L)) * mix(NdL, 1.0, 0.15);

        vec3 color = albedo * uSunColor * lit * limb * shadow + albedo * 0.006;
        color += atmosphereRim(N, V, L, uRim) * uSunColor;
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

export const createRingMaterial = (
  lighting: LightingUniforms,
  ring: RingUniforms,
  planet: { value: Vector4 },
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, ...ring, uPlanet: planet },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vWorldPos;
      uniform sampler2D uRing;
      uniform vec3 uRingNormal;
      uniform vec3 uRingCenter;
      uniform vec2 uRingRadii;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec4 uPlanet;

      void main() {
        float r = length(vWorldPos - uRingCenter);
        float x = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
        if (x < 0.0 || x > 1.0) discard;
        vec4 ring = texture2D(uRing, vec2(x, 0.5));

        vec3 L = uSunDir;
        vec3 V = normalize(cameraPosition - vWorldPos);
        float sunSide = dot(uRingNormal, L);
        float viewSide = dot(uRingNormal, V);

        // Lit face reflects; the unlit face only glows where sunlight diffuses through gaps.
        float incidence = min(abs(sunSide) * 4.0, 1.0);
        float brightness = sunSide * viewSide > 0.0
          ? 0.4 + 0.6 * incidence
          : (1.0 - ring.a) * 1.2 * incidence;

        // Icy particles scatter strongly forward when backlit.
        float forward = pow(max(dot(-V, L), 0.0), 6.0);
        brightness *= 1.0 + 2.5 * forward;

        float shadow = sphereShadow(vWorldPos, L, vec4(uPlanet.xyz, uPlanet.w * 0.995));
        shadow = mix(0.04, 1.0, shadow);

        vec3 color = ring.rgb * uSunColor * brightness * shadow;
        gl_FragColor = vec4(color, ring.a * 0.95);
        ${OUTPUT}
      }
    `,
  });

/* ---------------------------------------------------------------------------------------------
 * Sky
 * ------------------------------------------------------------------------------------------- */

/**
 * Milky Way panorama plus the Sun's disc and glare. Rendered on a sphere that follows the
 * camera; texture lookups use the sphere's local (rotating) direction, the Sun its world one.
 */
export const createSkyMaterial = (milkyWay: Texture, lighting: LightingUniforms): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...lighting,
      uMilkyWay: { value: milkyWay },
      uExposure: { value: 2.6 },
      uSunAngularRadius: { value: 0.012 },
    },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vLocalDir;
      varying vec3 vWorldDir;
      void main() {
        vLocalDir = position;
        vWorldDir = mat3(modelMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      varying vec3 vLocalDir;
      varying vec3 vWorldDir;
      uniform sampler2D uMilkyWay;
      uniform float uExposure;
      uniform float uSunAngularRadius;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;

      void main() {
        vec3 local = normalize(vLocalDir);
        vec2 uv = vec2(atan(local.z, local.x) / (2.0 * PI) + 0.5, asin(clamp(local.y, -1.0, 1.0)) / PI + 0.5);
        vec3 galaxy = texture2D(uMilkyWay, uv).rgb;
        // Lift the faint nebulosity a touch more than the background so the band reads.
        galaxy = galaxy * uExposure * (1.0 + 1.5 * smoothstep(0.0, 0.08, lum(galaxy)));

        vec3 dir = normalize(vWorldDir);
        float angle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));

        // The Sun's glare washes out the faint sky around it.
        galaxy *= 1.0 - 0.9 * exp(-angle * 3.0);

        float disc = smoothstep(uSunAngularRadius * 1.08, uSunAngularRadius * 0.92, angle);
        float corona = exp(-angle * 55.0) * 2.5 + exp(-angle * 9.0) * 0.35 + exp(-angle * 2.2) * 0.04;
        vec3 sun = vec3(1.0, 0.96, 0.9) * disc * 60.0 + uSunColor * vec3(1.0, 0.9, 0.75) * corona;

        gl_FragColor = vec4(galaxy + sun, 1.0);
        ${OUTPUT}
      }
    `,
  });

export const createStarMaterial = (lighting: LightingUniforms): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      uniform vec3 uSunDir;
      varying vec3 vColor;

      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Stars vanish in the Sun's glare.
        float sunAngle = dot(normalize(mat3(modelMatrix) * position), uSunDir);
        vColor = aColor * (1.0 - smoothstep(0.85, 0.99, sunAngle));
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = exp(-dot(c, c) * 18.0);
        if (falloff < 0.01) discard;
        gl_FragColor = vec4(vColor * falloff, 1.0);
        ${OUTPUT}
      }
    `,
  });

/* ---------------------------------------------------------------------------------------------
 * Asteroids and comets
 * ------------------------------------------------------------------------------------------- */

/** Instanced, flat-shaded rocks lit by the Sun. Per-instance tint comes from `instanceColor`. */
export const createAsteroidMaterial = (lighting: LightingUniforms): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: { ...lighting },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vTint;
      void main() {
        mat4 model = modelMatrix * instanceMatrix;
        vNormal = normalize(mat3(model) * normal);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3(0.4);
        #endif
        gl_Position = projectionMatrix * viewMatrix * model * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vTint;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      void main() {
        float NdL = max(dot(normalize(vNormal), uSunDir), 0.0);
        vec3 color = vTint * (uSunColor * NdL + vec3(0.01, 0.012, 0.016));
        gl_FragColor = vec4(color, 1.0);
        ${OUTPUT}
      }
    `,
  });

export interface CometTailOptions {
  color: Color;
  /** World-space length and maximum half-width. */
  length: number;
  width: number;
  /** Peak brightness (HDR). */
  intensity: number;
  /** Fine streamers, as seen in ion tails. */
  streamers: number;
}

/** Shared per-comet uniforms: head position, anti-sun axis and orbital curvature. */
export interface CometUniforms {
  uHead: { value: Vector3 };
  uAxis: { value: Vector3 };
  uCurve: { value: Vector3 };
  uTime: { value: number };
  /** 0–1: how strongly the comet is outgassing (it brightens near perihelion). */
  uActivity: { value: number };
}

/**
 * A comet tail drawn as a camera-facing ribbon that follows a (possibly curved) spine, with
 * soft gaussian falloff across it and fading along it. Additive, so it reads as glowing gas.
 */
export const createCometTailMaterial = (
  comet: CometUniforms,
  { color, length, width, intensity, streamers }: CometTailOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...comet,
      uColor: { value: color },
      uLength: { value: length },
      uWidth: { value: width },
      uIntensity: { value: intensity },
      uStreamers: { value: streamers },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aTail; // x: 0 at the head → 1 at the tip, y: -1 → 1 across
      uniform vec3 uHead;
      uniform vec3 uAxis;
      uniform vec3 uCurve;
      uniform float uLength;
      uniform float uWidth;
      uniform float uActivity;
      varying vec2 vTail;

      void main() {
        float s = aTail.x;
        float length = uLength * (0.35 + 0.65 * uActivity);
        vec3 spine = uHead + (uAxis * s + uCurve * s * s) * length;
        vec3 tangent = normalize(uAxis + 2.0 * s * uCurve);
        vec3 side = normalize(cross(tangent, normalize(cameraPosition - spine)));
        float halfWidth = uWidth * (0.08 + 0.92 * sqrt(s));
        vTail = aTail;
        gl_Position = projectionMatrix * viewMatrix * vec4(spine + side * aTail.y * halfWidth, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uStreamers;
      uniform float uTime;
      uniform float uActivity;
      varying vec2 vTail;

      void main() {
        float s = vTail.x;
        float across = exp(-vTail.y * vTail.y * 4.0);
        float along = pow(1.0 - s, 1.6) * smoothstep(0.0, 0.04, s);
        // Slowly shifting streamers that grow out of the smooth coma.
        float wave = sin(vTail.y * 23.0 + s * 9.0 - uTime * 0.3) * sin(vTail.y * 7.0 - uTime * 0.11);
        float rays = 1.0 + uStreamers * wave * smoothstep(0.05, 0.4, s);
        gl_FragColor = vec4(uColor * uIntensity * uActivity * across * along * rays, 1.0);
        ${OUTPUT}
      }
    `,
  });

/** Glowing coma around a comet's nucleus: a camera-facing gaussian sprite. */
export const createComaMaterial = (
  comet: CometUniforms,
  size: number,
  color: Color,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uHead: comet.uHead,
      uActivity: comet.uActivity,
      uSize: { value: size },
      uColor: { value: color },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform vec3 uHead;
      uniform float uSize;
      varying vec2 vOffset;
      void main() {
        vOffset = position.xy;
        vec4 view = viewMatrix * vec4(uHead, 1.0);
        view.xy += position.xy * uSize;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uActivity;
      varying vec2 vOffset;
      void main() {
        float r2 = dot(vOffset, vOffset);
        float glow = exp(-r2 * 6.0) * 0.6 * uActivity + exp(-r2 * 60.0) * (1.0 + 1.5 * uActivity);
        gl_FragColor = vec4(uColor * glow, 1.0);
        ${OUTPUT}
      }
    `,
  });

/** Orbit and environment shared by every dust grain of a comet. */
export interface CometDustUniforms {
  /** Orbital plane axes in world space: towards periapsis, and 90° ahead of it. */
  uOrbitP: { value: Vector3 };
  uOrbitQ: { value: Vector3 };
  uSemiMajorAxis: { value: number };
  uEccentricity: { value: number };
  /** The nucleus's current mean anomaly and mean motion (radians per second). */
  uMeanAnomaly: { value: number };
  uMeanMotion: { value: number };
  uTime: { value: number };
  uActivity: { value: number };
  /** Unit vector pointing away from the Sun. */
  uAxis: { value: Vector3 };
  /** Device pixels per world unit at distance 1 (for perspective point sizes). */
  uPointScale: { value: number };
  /** The nucleus's current position. */
  uHead: { value: Vector3 };
}

export interface CometDustOptions {
  color: Color;
  /** Seconds a grain stays visible after leaving the nucleus. */
  lifetime: number;
  /** Radiation-pressure acceleration (world units / s²) for the most strongly pushed grains. */
  pressure: number;
  /** Random ejection speed (world units / s). */
  spread: number;
  /** World-space grain glow size. */
  size: number;
  intensity: number;
  /**
   * How much of the grains' lag along the orbit to keep (0–1). Our comet moves far faster
   * than a real one so it can come back every ~20 s; at full lag the dust would trail straight
   * behind it instead of streaming away from the Sun. A fraction gives the gentle curve real
   * dust tails have.
   */
  orbitLag: number;
}

/**
 * Dust tail as individual grains. Each grain is released from the nucleus `age` seconds ago:
 * the shader solves Kepler's equation for where the nucleus *was* then, and adds the drift
 * since — radiation pressure pushing it straight away from the Sun (½·β·a·t², with β varying
 * per grain) plus a little ejection velocity. That reproduces the curved, fanned shape of real
 * dust tails (syndynes), lagging behind along the orbit.
 */
export const createCometDustMaterial = (
  dust: CometDustUniforms,
  { color, lifetime, pressure, spread, size, intensity, orbitLag }: CometDustOptions,
): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      ...dust,
      uColor: { value: color },
      uLifetime: { value: lifetime },
      uPressure: { value: pressure },
      uSpread: { value: spread },
      uSize: { value: size },
      uIntensity: { value: intensity },
      uOrbitLag: { value: orbitLag },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aRandom; // phase, β, size, brightness — all 0..1
      attribute vec3 aDirection; // unit ejection direction
      uniform vec3 uOrbitP;
      uniform vec3 uOrbitQ;
      uniform float uSemiMajorAxis;
      uniform float uEccentricity;
      uniform float uMeanAnomaly;
      uniform float uMeanMotion;
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uAxis;
      uniform float uPointScale;
      uniform float uLifetime;
      uniform float uPressure;
      uniform float uSpread;
      uniform float uSize;
      uniform float uOrbitLag;
      uniform vec3 uHead;
      varying float vBrightness;

      void main() {
        float age = fract(aRandom.x + uTime / uLifetime) * uLifetime;
        float life = age / uLifetime;

        // Where the nucleus was when this grain left it (Kepler's equation, Newton's method).
        float e = uEccentricity;
        float M = uMeanAnomaly - uMeanMotion * age;
        float E = M + e * sin(M);
        for (int i = 0; i < 5; i++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
        float b = uSemiMajorAxis * sqrt(1.0 - e * e);
        vec3 released = uOrbitP * (uSemiMajorAxis * (cos(E) - e)) + uOrbitQ * (b * sin(E));

        // Radiation pressure (stronger on small grains) plus a slow random spread.
        float beta = mix(0.2, 1.0, aRandom.y);
        vec3 position = uHead + (released - uHead) * uOrbitLag
          + uAxis * (0.5 * uPressure * uActivity * beta * age * age)
          + aDirection * (uSpread * age);

        vec4 view = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;

        // Grains spread out (bigger, fainter) as they age; keep total light constant when the
        // point would be smaller than a pixel so distant tails don't sparkle.
        float worldSize = uSize * mix(0.6, 1.4, aRandom.z) * (1.0 + 1.5 * life);
        float pixels = worldSize * uPointScale / max(-view.z, 1e-3);
        gl_PointSize = clamp(pixels, 1.5, 48.0);
        float coverage = min(1.0, (pixels * pixels) / (gl_PointSize * gl_PointSize));

        vBrightness = pow(1.0 - life, 1.4) * smoothstep(0.0, 0.04, life)
          * mix(0.4, 1.0, aRandom.w) * uActivity * coverage;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying float vBrightness;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float falloff = exp(-dot(c, c) * 14.0);
        gl_FragColor = vec4(uColor * uIntensity * vBrightness * falloff, 1.0);
        ${OUTPUT}
      }
    `,
  });
