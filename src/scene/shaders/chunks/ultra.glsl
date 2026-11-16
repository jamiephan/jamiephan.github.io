// Ultra-HD detail (see ultraTextures.ts): a window of a body's 16K map, streamed in around the
// point being looked at, laid over the usual map. `rect` is where the window sits in texture
// coordinates (u0, v0, width, height; width 0 = no window). u wraps round, so a window can
// straddle the map's seam. Needs SPHERE_VARYINGS; call `computeSphereUv()` first.
vec4 ultraTexture(sampler2D map, sampler2D detail, vec4 rect, vec2 offset) {
  vec4 base = sphereTexture(map, offset);
  if (rect.z <= 0.0) return base;
  vec2 uv = sphereUv + offset;
  vec2 local = vec2(fract(uv.x - rect.x), uv.y - rect.y) / rect.zw;
  // Fade into the usual map towards the window's edges, so they don't show as a line. Not
  // towards a pole, though: there the window ends because the map does.
  vec2 edge = min(local, 1.0 - local);
  if (rect.y <= 0.0) edge.y = 1.0 - local.y;
  if (rect.y + rect.w >= 1.0) edge.y = local.y;
  float weight = smoothstep(0.0, 0.1, min(edge.x, edge.y));
  if (weight <= 0.0) return base;
  // Explicit gradients: the window is a scaled copy of part of the map, so its mip level is the
  // map's, scaled the same way (and the branch above doesn't upset it).
  vec4 fine = textureGrad(detail, local, sphereUvDx / rect.zw, sphereUvDy / rect.zw);
  return mix(base, fine, weight);
}
