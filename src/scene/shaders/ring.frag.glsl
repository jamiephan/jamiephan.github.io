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
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
