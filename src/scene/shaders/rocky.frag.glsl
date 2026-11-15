uniform sampler2D uMap;
uniform float uBump;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uOccluder;
uniform vec3 uAmbient;
uniform vec3 uRim;

void main() {
  vec3 albedo = texture2D(uMap, vUv).rgb;

  // Bump from the albedo's luminance gradient: craters and ridges catch the light.
  // Measured over 1.5 texels of whichever map is loaded (preview, full or HD). Sampling
  // further apart would light every sharp edge twice, once each side: a ghosted double.
  vec2 size = vec2(textureSize(uMap, 0));
  vec2 dx = vec2(1.5 / size.x, 0.0);
  vec2 dy = vec2(0.0, 1.5 / size.y);
  float gx = lum(texture2D(uMap, vUv + dx).rgb) - lum(texture2D(uMap, vUv - dx).rgb);
  float gy = lum(texture2D(uMap, vUv + dy).rgb) - lum(texture2D(uMap, vUv - dy).rgb);
  // Finer texels see smaller steps, so an HD map would look flatter than the 2K one; boost
  // it part of the way back (fully would also boost its fine noise as much).
  float bump = uBump * sqrt(max(size.x / 2048.0, 1.0));
  vec3 tangentNormal = normalize(vec3(-gx * bump, -gy * bump, 1.0));
  vec3 N = normalize(mat3(modelMatrix) * perturbSphereNormal(normalize(vObjNormal), tangentNormal));
  vec3 geoN = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;

  // Regolith reflects light back towards the source (Lommel–Seeliger), so a full Moon
  // looks evenly bright instead of fading to the limb like a Lambertian sphere.
  float mu0 = max(dot(N, L), 0.0);
  float mu = max(dot(geoN, V), 0.0);
  float lommel = 2.0 * mu0 / (mu0 + mu + 0.1);
  float lit = mix(mu0, lommel, 0.55) * smoothstep(-0.02, 0.06, dot(geoN, L));

  // Eclipse: an umbra tinted red by sunsets around the occluding planet's rim.
  float shadow = uOccluder.w > 0.0 ? sphereShadow(vWorldPos, L, uOccluder) : 1.0;
  vec3 eclipse = mix(vec3(0.22, 0.06, 0.02), vec3(1.0), shadow);

  vec3 color = albedo * uSunColor * lit * eclipse;
  color += albedo * uAmbient;
  color += atmosphereRim(geoN, V, L, uRim) * uSunColor;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
