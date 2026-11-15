varying vec2 vUv;

void main() {
  vec2 tile = floor(vUv * 2.0);
  vec2 local = fract(vUv * 2.0) * 2.0 - 1.0;
  vec3 seed = vec3(tile * 13.7, tile.x * 3.1 + tile.y * 7.9);

  vec3 p = vec3(local * 1.8, 0.0) + seed;
  vec2 warp = vec2(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8)));
  float n = fbm(p + vec3(warp * 1.8, 0.0));
  // Ragged outline; keep a margin so nothing touches the tile edge.
  float r = length(local) * mix(1.25, 0.8, n);
  float body = smoothstep(0.95, 0.15, r);
  float wisps = pow(1.0 - abs(2.0 * fbm(p * 2.1 + vec3(warp, 1.0) * 2.0) - 1.0), 6.0);
  float density = body * (smoothstep(0.25, 0.8, n) * 0.85 + 0.5 * wisps);
  density *= smoothstep(1.0, 0.85, max(abs(local.x), abs(local.y)));
  gl_FragColor = vec4(vec3(clamp(density, 0.0, 1.0)), 1.0);
}
