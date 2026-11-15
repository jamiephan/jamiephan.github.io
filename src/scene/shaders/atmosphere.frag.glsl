varying vec3 vWorldPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform float uIntensity;

// Scale heights (fraction of planet radius) and scattering coefficients (per radius).
const float H_R = 0.0052;
const float H_M = 0.0016;
const vec3 BETA_R = vec3(8.9, 20.8, 51.0);
const float BETA_M = 15.0;
const float MIE_G = 0.76;

void main() {
  vec3 origin = (cameraPosition - uCenter) / uPlanetRadius;
  vec3 dir = normalize(vWorldPos - cameraPosition);
  vec3 L = uSunDir;

  vec2 atmo = raySphere(origin, dir, uAtmosphereRadius);
  vec2 ground = raySphere(origin, dir, 1.0);
  float start = max(atmo.x, 0.0);
  float end = ground.x > 0.0 ? min(atmo.y, ground.x) : atmo.y;
  if (end <= start) discard;

  // Most pixels look down through the thin shell over the disc: a short path that
  // converges in a few steps (well under one display level from 14, and far below the
  // film grain). Only the long grazing paths near the limb need the full count, so
  // scale it by the path's share of the longest one (tangent to the ground).
  float chord = end - start;
  float maxChord = 2.0 * sqrt(uAtmosphereRadius * uAtmosphereRadius - 1.0);
  int steps = int(clamp(
    ceil(float(PRIMARY_STEPS) * chord / maxChord),
    float(MIN_PRIMARY_STEPS),
    float(PRIMARY_STEPS)
  ));
  float stepSize = chord / float(steps);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float depthR = 0.0;
  float depthM = 0.0;

  for (int i = 0; i < PRIMARY_STEPS; i++) {
    if (i >= steps) break;
    vec3 p = origin + dir * (start + stepSize * (float(i) + 0.5));
    float height = length(p) - 1.0;
    float densityR = exp(-height / H_R) * stepSize;
    float densityM = exp(-height / H_M) * stepSize;
    depthR += densityR;
    depthM += densityM;

    // Soft planet shadow: how far the sun ray dips below the surface.
    float along = dot(p, L);
    float closest = length(p - L * along);
    float sunlit = along > 0.0 ? 1.0 : smoothstep(0.985, 1.003, closest);
    if (sunlit <= 0.0) continue;

    float lightStep = raySphere(p, L, uAtmosphereRadius).y / float(LIGHT_STEPS);
    float lightR = 0.0;
    float lightM = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      float h = length(p + L * (lightStep * (float(j) + 0.5))) - 1.0;
      lightR += exp(-max(h, 0.0) / H_R) * lightStep;
      lightM += exp(-max(h, 0.0) / H_M) * lightStep;
    }

    vec3 attenuation = exp(-(BETA_R * (depthR + lightR) + BETA_M * 1.1 * (depthM + lightM)));
    sumR += densityR * attenuation * sunlit;
    sumM += densityM * attenuation * sunlit;
  }

  float mu = dot(dir, L);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = MIE_G * MIE_G;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu))
    / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

  vec3 color = uIntensity * uSunColor * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
  // Keep the haze over the disc subtle so surface detail stays crisp; the limb keeps full glow.
  if (ground.x > 0.0) color *= 0.4;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
