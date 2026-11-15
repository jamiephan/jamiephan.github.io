uniform sampler2D uMap;
uniform float uBump;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uOccluder;
uniform vec3 uAmbient;
uniform vec3 uRim;

void main() {
  computeSphereUv();
  vec3 albedo = sphereTexture(uMap, vec2(0.0)).rgb;

  // Bump from the albedo's luminance gradient: craters and ridges catch the light.
  // The relief is tuned for a 2K map, so on an HD map it's taken from the mipmap level that is
  // 2K wide (level 2 of an 8K map): the colour keeps every HD texel, but the bump doesn't turn
  // the HD map's fine grain into hard little shadows all over (an embossed, gritty look).
  // The level is chosen explicitly: a LOD bias wouldn't do, since close up the GPU's own pick
  // is below level 0 and the bias only brings it back to the sharp, full-size level. Further
  // away it follows the usual pick, so the relief still fades out without aliasing.
  vec2 size = vec2(textureSize(uMap, 0));
  float minLevel = max(log2(size.x / 2048.0), 0.0);
  vec2 footprint = max(abs(sphereUvDx * size), abs(sphereUvDy * size));
  float level = max(minLevel, log2(max(max(footprint.x, footprint.y), 1e-6)));
  // Measured over 1.5 texels of that level; sampling further apart on a sharper level would
  // light every edge twice, once each side (a ghosted double). A step in longitude covers less
  // ground towards the poles (cos latitude), so the east-west step widens to keep both the same
  // distance on the surface; otherwise tiny differences near a pole became huge slopes there
  // (dark streaks radiating from it).
  vec2 texel = exp2(minLevel) / size;
  vec3 n = normalize(vObjNormal);
  float cosLatitude = sqrt(max(1.0 - n.y * n.y, 0.0));
  vec2 dx = vec2(min(1.5 * texel.x / max(cosLatitude, 1e-3), 0.25), 0.0);
  vec2 dy = vec2(0.0, 1.5 * texel.y);
  float gx = lum(textureLod(uMap, sphereUv + dx, level).rgb) - lum(textureLod(uMap, sphereUv - dx, level).rgb);
  float gy = lum(textureLod(uMap, sphereUv + dy, level).rgb) - lum(textureLod(uMap, sphereUv - dy, level).rgb);
  // Brightness isn't height: dark crater floors (and shadows already in the photo) read as steep
  // slopes, tilted 60-75 degrees at full strength, so they turned pitch black even with the Sun
  // high overhead. Capping the tilt at ~35 degrees (tan 0.7) leaves gentle relief untouched but
  // only lets slopes fall into shadow where the Sun is low, near the terminator, as on the Moon.
  vec2 slope = -vec2(gx, gy) * uBump;
  slope *= 0.7 / max(0.7, length(slope));
  vec3 tangentNormal = normalize(vec3(slope, 1.0));
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
