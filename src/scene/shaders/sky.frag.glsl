varying vec3 vLocalDir;
varying vec3 vWorldDir;
uniform sampler2D uMilkyWay;
uniform sampler2D uNebula;
uniform float uNebulaRange;
uniform float uExposure;
uniform float uSunAngularRadius;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

void main() {
  vec3 local = normalize(vLocalDir);
  vec2 uv = vec2(atan(local.z, local.x) / (2.0 * PI) + 0.5, asin(clamp(local.y, -1.0, 1.0)) / PI + 0.5);
  vec3 galaxy = texture2D(uMilkyWay, uv).rgb;
  // Lift the faint nebulosity a touch more than the background so the band reads.
  galaxy = galaxy * uExposure * (1.0 + 1.5 * smoothstep(0.0, 0.08, lum(galaxy)));
  // Baked nebulae (stored square-rooted; see nebula.ts).
  vec3 nebula = texture2D(uNebula, uv).rgb;
  galaxy += nebula * nebula * uNebulaRange;

  vec3 dir = normalize(vWorldDir);
  float angle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));

  // The Sun's glare washes out the faint sky around it.
  galaxy *= 1.0 - 0.9 * exp(-angle * 3.0);

  float disc = smoothstep(uSunAngularRadius * 1.08, uSunAngularRadius * 0.92, angle);
  float corona = exp(-angle * 55.0) * 2.5 + exp(-angle * 9.0) * 0.35 + exp(-angle * 2.2) * 0.04;
  vec3 sun = vec3(1.0, 0.96, 0.9) * disc * 60.0 + uSunColor * vec3(1.0, 0.9, 0.75) * corona;

  gl_FragColor = vec4(galaxy + sun, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
