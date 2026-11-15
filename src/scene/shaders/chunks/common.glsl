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

// How fast every penumbra widens with distance from its occluder. Far wider than the Sun's
// real angular size: distances here are compressed, so a true penumbra looks too hard.
#define PENUMBRA_SPREAD 0.045

// Fraction of sunlight reaching `p` past an occluding sphere (xyz = centre, w = radius),
// with a penumbra that widens with distance like a real one.
float sphereShadow(vec3 p, vec3 sunDir, vec4 sphere) {
  vec3 toCentre = sphere.xyz - p;
  float along = dot(toCentre, sunDir);
  if (along <= 0.0) return 1.0;
  float miss = length(toCentre - sunDir * along);
  float penumbra = 0.1 * sphere.w + along * PENUMBRA_SPREAD;
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
