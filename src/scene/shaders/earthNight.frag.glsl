uniform sampler2D uClouds;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uFlashes;

void main() {
  computeSphereUv();
  vec3 N = normalize(vWorldNormal);
  float night = smoothstep(0.05, -0.2, dot(N, uSunDir));
  if (night <= 0.0) discard;
  vec3 n = normalize(vObjNormal);
  vec3 light = vec3(0.0);

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
