uniform sampler2D uClouds;
uniform sampler2D uCloudsUltra;
uniform vec4 uCloudsUltraRect;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uOccluder;

void main() {
  computeSphereUv();
  float density = ultraTexture(uClouds, uCloudsUltra, uCloudsUltraRect, vec2(0.0)).r;
  vec3 N = normalize(vWorldNormal);
  float NdL = dot(N, uSunDir);

  // Wrapped diffuse: clouds scatter light a little past the terminator.
  float lit = clamp((NdL + 0.18) / 1.18, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0), smoothstep(-0.05, 0.3, NdL));
  float shadow = sphereShadow(vWorldPos, uSunDir, uOccluder);

  vec3 color = uSunColor * tint * lit * shadow * 0.85 + vec3(0.006, 0.008, 0.014);
  gl_FragColor = vec4(color, density * 0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
