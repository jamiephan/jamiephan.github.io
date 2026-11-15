#define PI 3.141592653589793
varying vec2 vUv;
uniform vec4 uCentres[NEBULA_COUNT];
uniform vec3 uPrimary[NEBULA_COUNT];
uniform vec3 uSecondary[NEBULA_COUNT];
uniform vec4 uParams[NEBULA_COUNT];
uniform float uRange;

void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

  vec3 light = vec3(0.0);
  for (int i = 0; i < NEBULA_COUNT; i++) {
    vec4 centre = uCentres[i];
    // (angle / radius)² for small angles; skip pixels well outside the cloud.
    float reach = (1.0 - dot(dir, centre.xyz)) / (0.5 * centre.w * centre.w);
    if (reach > 12.0) continue;

    vec4 params = uParams[i];
    // Scale the noise to the cloud so small and large ones have similar structure.
    vec3 p = dir * (2.2 / centre.w) + params.z;
    vec3 warp = vec3(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)), fbm(p + vec3(9.7, 4.1, 7.3)));
    float n = fbm(p + 1.6 * warp);

    // Ragged edges: denser gas reaches further from the centre.
    float envelope = exp(-reach * mix(1.4, 0.35, n));
    // Billowy body plus thin bright filaments where the warped noise folds over.
    float ridge = 1.0 - abs(2.0 * fbm(p * 1.9 + 2.0 * warp) - 1.0);
    float density = envelope * (smoothstep(0.3, 0.85, n) + 0.5 * pow(ridge, 8.0));

    vec3 colour = mix(uPrimary[i], uSecondary[i], smoothstep(0.4, 0.75, fbm(p * 0.8 + 3.3)));
    // Dense cores glow whiter.
    colour = mix(colour, vec3(1.0, 0.92, 0.9), 0.35 * smoothstep(0.5, 1.2, density));
    // Dark dust lanes cutting across the glow.
    float lanes = smoothstep(0.5, 0.72, fbm(p * 2.4 + warp.yzx * 1.3)) * params.y;

    light += colour * density * (1.0 - lanes) * params.x;
  }

  gl_FragColor = vec4(sqrt(clamp(light / uRange, 0.0, 1.0)), 1.0);
}
