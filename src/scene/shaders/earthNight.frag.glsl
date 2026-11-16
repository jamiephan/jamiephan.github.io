uniform sampler2D uClouds;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFlashes;

// Glow of one auroral oval around `pole` (object space), ~20° from it.
vec3 aurora(vec3 n, vec3 pole, float seed) {
  float theta = acos(clamp(dot(n, pole), -1.0, 1.0));
  // The oval's centre (below) stays within 0.045 of 0.34 (wobble 0.035, noise 0.01), and the band
  // drops under the 0.01 cut-off 0.0751 from it. Further out the result is zero anyway: skip
  // the noise, which would otherwise run over the whole night side.
  if (abs(theta - 0.34) > 0.121) return vec3(0.0);
  vec3 east = normalize(cross(pole, abs(pole.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1)));
  float lon = atan(dot(n, cross(pole, east)), dot(n, east));
  // The oval wobbles and pulses slowly.
  float centre = 0.34 + 0.035 * sin(lon * 3.0 + uTime * 0.07 + seed)
    + 0.02 * (fbm(vec3(lon * 2.0, uTime * 0.05, seed)) - 0.5);
  float offset = (theta - centre) / 0.035;
  float band = exp(-offset * offset);
  if (band < 0.01) return vec3(0.0);
  // Vertical curtains: fine streaks along the oval that drift and brighten.
  float curtains = smoothstep(0.35, 0.8, fbm(vec3(lon * 14.0, uTime * 0.12, seed * 3.0)));
  // Green oxygen glow, with red/purple at the poleward edge where the curtains are tallest.
  float poleward = smoothstep(0.0, -0.05, theta - centre);
  vec3 colour = mix(vec3(0.15, 1.0, 0.45), vec3(0.75, 0.2, 0.55), poleward * 0.6);
  return colour * band * (0.25 + curtains);
}

void main() {
  computeSphereUv();
  vec3 N = normalize(vWorldNormal);
  float night = smoothstep(0.05, -0.2, dot(N, uSunDir));
  if (night <= 0.0) discard;
  vec3 n = normalize(vObjNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  // Curtains seen edge-on near the limb look brighter.
  float limb = 0.5 + 1.5 * pow(1.0 - abs(dot(N, V)), 2.0);

  vec3 light = (aurora(n, normalize(vec3(0.08, 1.0, 0.05)), 1.7)
    + aurora(n, normalize(vec3(-0.1, -1.0, 0.07)), 5.3)) * limb * 0.22;

  // Thunderstorms: a sparse grid of cells in the tropics, each flashing now and then.
  vec2 grid = vec2(72.0, 36.0);
  vec2 cell = floor(sphereUv * grid);
  float h = hash(vec3(cell, 3.7));
  float tropics = 1.0 - smoothstep(0.35, 0.6, abs(n.y));
  if (h < 0.22 && tropics > 0.0 && uFlashes > 0.0) {
    float period = 3.0 + 9.0 * hash(vec3(cell, 9.1));
    float t = mod(uTime + h * 97.0, period);
    float flash = exp(-t * 9.0) * (0.6 + 0.4 * cos(t * 40.0));
    vec2 jitter = vec2(hash(vec3(cell, 1.3)), hash(vec3(cell, 2.9))) - 0.5;
    vec2 local = fract(sphereUv * grid) - 0.5 - jitter * 0.5;
    float blob = exp(-dot(local, local) * 18.0);
    float cloud = sphereTexture(uClouds, vec2(0.0)).r;
    light += vec3(0.75, 0.82, 1.0) * flash * blob * cloud * tropics * 2.5 * uFlashes;
  }

  gl_FragColor = vec4(light * night, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
