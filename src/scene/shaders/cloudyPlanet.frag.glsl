uniform sampler2D uMap;
uniform sampler2D uMapUltra;
uniform vec4 uMapUltraRect;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uRim;
uniform float uLimbDarkening;
uniform float uAlbedo;
#ifdef HAS_RING
  uniform sampler2D uRing;
  uniform vec3 uRingNormal;
  uniform vec3 uRingCenter;
  uniform vec2 uRingRadii;
#endif

void main() {
  computeSphereUv();
  vec3 albedo = ultraTexture(uMap, uMapUltra, uMapUltraRect, vec2(0.0)).rgb * uAlbedo;
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  float NdL = max(dot(N, L), 0.0);

  float shadow = 1.0;
  #ifdef HAS_RING
    // Shadow of the rings: follow the sun ray to the ring plane and look up its opacity.
    float denom = dot(L, uRingNormal);
    if (abs(denom) > 1e-4) {
      float t = dot(uRingCenter - vWorldPos, uRingNormal) / denom;
      if (t > 0.0) {
        float width = uRingRadii.y - uRingRadii.x;
        float r = length(vWorldPos + L * t - uRingCenter);
        float x = (r - uRingRadii.x) / width;
        // Penumbra: average the ring's opacity over a radial span that grows with the
        // distance to the rings (triangle filter, weights sum to 16).
        float blur = (0.006 * width + t * PENUMBRA_SPREAD) / width;
        float occlusion = 0.0;
        for (int i = -3; i <= 3; i++) {
          float xi = x + blur * float(i) / 3.0;
          if (xi > 0.0 && xi < 1.0) {
            occlusion += (4.0 - abs(float(i))) * texture2D(uRing, vec2(xi, 0.5)).a;
          }
        }
        shadow = 1.0 - 0.9 * occlusion / 16.0;
      }
    }
  #endif

  // Hazy upper atmosphere: limb darkening and a soft terminator.
  float limb = mix(1.0 - uLimbDarkening, 1.0, pow(max(dot(N, V), 0.0), 0.35));
  float lit = smoothstep(-0.08, 0.25, dot(N, L)) * mix(NdL, 1.0, 0.15);

  vec3 color = albedo * uSunColor * lit * limb * shadow + albedo * 0.006;
  color += atmosphereRim(N, V, L, uRim) * uSunColor;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
