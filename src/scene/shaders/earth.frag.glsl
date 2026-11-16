uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uNormal;
uniform sampler2D uSpecular;
uniform sampler2D uClouds;
uniform sampler2D uDayUltra;
uniform vec4 uDayUltraRect;
uniform vec2 uDayBlend;
uniform sampler2D uNightUltra;
uniform vec4 uNightUltraRect;
uniform vec2 uNightBlend;
uniform sampler2D uNormalUltra;
uniform vec4 uNormalUltraRect;
uniform vec2 uNormalBlend;
uniform sampler2D uSpecularUltra;
uniform vec4 uSpecularUltraRect;
uniform vec2 uSpecularBlend;
uniform sampler2D uCloudsUltra;
uniform vec4 uCloudsUltraRect;
uniform vec2 uCloudsBlend;
uniform float uCloudOffset;
uniform float uNormalStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uOccluder;

void main() {
  computeSphereUv();
  vec3 L = uSunDir;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 geoN = normalize(vWorldNormal);

  // Terrain relief from the normal map (oceans are flat).
  vec3 tangentNormal = ultraTexture(uNormal, uNormalUltra, uNormalUltraRect, uNormalBlend, vec2(0.0)).xyz * 2.0 - 1.0;
  tangentNormal.xy *= uNormalStrength;
  vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));

  float geoNdL = dot(geoN, L);
  float NdL = max(dot(N, L), 0.0);
  // Smooth the terminator so relief can't light up on the night side.
  float dayMask = smoothstep(-0.05, 0.12, geoNdL);

  // Slightly deepen the satellite mosaic: darker oceans, deserts that don't clip.
  vec3 albedo = pow(ultraTexture(uDay, uDayUltra, uDayUltraRect, uDayBlend, vec2(0.0)).rgb, vec3(1.15)) * 0.85;
  float ocean = ultraTexture(uSpecular, uSpecularUltra, uSpecularUltraRect, uSpecularBlend, vec2(0.0)).r;
  float cloud = ultraTexture(uClouds, uCloudsUltra, uCloudsUltraRect, uCloudsBlend, vec2(uCloudOffset, 0.0)).r;

  // Clouds cast soft shadows; the Moon can eclipse the Sun.
  float shadow = (1.0 - 0.55 * cloud) * mix(0.15, 1.0, sphereShadow(vWorldPos, L, uOccluder));

  // Reddened, dimmer light near the terminator (sunlight through more atmosphere).
  vec3 sunTint = mix(vec3(1.0, 0.62, 0.42), vec3(1.0), smoothstep(0.0, 0.35, geoNdL));
  vec3 light = uSunColor * sunTint * shadow;

  vec3 color = albedo * light * NdL * dayMask;

  // Ocean: sharp sun glint plus a broad sheen, stronger at grazing angles (Fresnel).
  vec3 H = normalize(L + V);
  float NdH = max(dot(geoN, H), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float glint = pow(NdH, 180.0) * 3.0 + pow(NdH, 18.0) * 0.12;
  color += ocean * light * glint * (0.35 + fresnel) * smoothstep(0.0, 0.1, geoNdL) * (1.0 - cloud);

  // City lights on the night side, hidden under clouds.
  float night = 1.0 - smoothstep(-0.2, 0.08, geoNdL);
  vec3 lights = ultraTexture(uNight, uNightUltra, uNightUltraRect, uNightBlend, vec2(0.0)).rgb;
  color += lights * vec3(1.0, 0.82, 0.6) * 1.4 * night * (1.0 - 0.8 * cloud);

  // Faint earthshine / ambient so the night side is never pure black.
  color += albedo * vec3(0.012, 0.016, 0.024);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
