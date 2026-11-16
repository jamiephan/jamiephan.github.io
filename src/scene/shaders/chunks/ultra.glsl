// Ultra-HD detail (see ultraTextures.ts): a window of a body's 16K map, streamed in around the
// point being looked at, laid over the usual map. `rect` is where the window sits in texture
// coordinates (u0, v0, width, height; width 0 = no window). u wraps round, so a window can
// straddle the map's seam. `blend.x` blurs the usual map by that many mip levels (an HD map
// sharpening as it comes in, or softening before it goes, so it never pops); `blend.y` is how
// strongly the window shows (fading in or out). Needs SPHERE_VARYINGS; call `computeSphereUv()`
// first.

// The map, no sharper than `blur` mip levels down from its full size: the level of detail of
// the smaller map it's replacing. (Its usual level where that's blurrier already, far away.)
vec4 sphereTextureBlurred(sampler2D map, vec2 offset, float blur) {
  if (blur <= 0.0) return sphereTexture(map, offset);
  vec2 size = vec2(textureSize(map, 0));
  float footprint = max(length(sphereUvDx * size), length(sphereUvDy * size));
  float scale = max(1.0, exp2(blur) / max(footprint, 1e-6));
  return textureGrad(map, sphereUv + offset, sphereUvDx * scale, sphereUvDy * scale);
}

vec4 ultraTexture(sampler2D map, sampler2D detail, vec4 rect, vec2 blend, vec2 offset) {
  vec4 base = sphereTextureBlurred(map, offset, blend.x);
  if (rect.z <= 0.0 || blend.y <= 0.0) return base;
  vec2 uv = sphereUv + offset;
  vec2 local = vec2(fract(uv.x - rect.x), uv.y - rect.y) / rect.zw;
  // Fade into the usual map towards the window's edges, so they don't show as a line. Not
  // towards a pole, though: there the window ends because the map does.
  vec2 edge = min(local, 1.0 - local);
  if (rect.y <= 0.0) edge.y = 1.0 - local.y;
  if (rect.y + rect.w >= 1.0) edge.y = local.y;
  float weight = smoothstep(0.0, 0.1, min(edge.x, edge.y)) * blend.y;
  if (weight <= 0.0) return base;
  // Explicit gradients: the window is a scaled copy of part of the map, so its mip level is the
  // map's, scaled the same way (and the branch above doesn't upset it).
  vec4 fine = textureGrad(detail, local, sphereUvDx / rect.zw, sphereUvDy / rect.zw);
  return mix(base, fine, weight);
}
