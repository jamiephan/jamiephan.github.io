// Thin-atmosphere glow at the limb of the sunlit side (cheap stand-in for real scattering on
// bodies that are only ever a few hundred pixels across).
vec3 atmosphereRim(vec3 N, vec3 V, vec3 L, vec3 rimColor) {
  float edge = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  return rimColor * edge * smoothstep(-0.25, 0.35, dot(N, L));
}
