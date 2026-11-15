uniform mat4 modelMatrix;
varying vec2 vUv;
varying vec3 vObjNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

// Texture coordinates for the sphere's equirectangular maps, worked out per pixel from the
// surface direction instead of interpolated between the mesh's vertices. At the poles every
// longitude meets in one point, and interpolating across the thin triangles of the polar fan
// maps each one differently: the map looked cut into wedges seen from above. This is the exact
// mapping SphereGeometry's vertices use (u: longitude from -x towards +z, v: 0 south to 1 north).
// Call `computeSphereUv()` first thing in `main`, then sample with `sphereTexture`.
vec2 sphereUv;
// Screen-space derivatives for choosing mipmap levels. u jumps from 1 back to 0 along one
// meridian; taking each derivative from whichever of u and u + 0.5 (wrapped) is continuous there
// keeps that from showing as a line of the blurriest mip level.
vec2 sphereUvDx;
vec2 sphereUvDy;

void computeSphereUv() {
  vec3 n = normalize(vObjNormal);
  float u = fract(atan(n.z, -n.x) / (2.0 * PI));
  float v = 1.0 - acos(clamp(n.y, -1.0, 1.0)) / PI;
  float shifted = fract(u + 0.5);
  float dxU = dFdx(u);
  float dxS = dFdx(shifted);
  float dyU = dFdy(u);
  float dyS = dFdy(shifted);
  sphereUvDx = vec2(abs(dxU) < abs(dxS) ? dxU : dxS, dFdx(v));
  sphereUvDy = vec2(abs(dyU) < abs(dyS) ? dyU : dyS, dFdy(v));
  sphereUv = vec2(u, v);
}

vec4 sphereTexture(sampler2D map, vec2 offset) {
  return textureGrad(map, sphereUv + offset, sphereUvDx, sphereUvDy);
}
