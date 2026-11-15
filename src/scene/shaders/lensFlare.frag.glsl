uniform sampler2D tDiffuse;
uniform vec2 uSunPos;
uniform float uVisibility;
uniform float uAspect;
varying vec2 vUv;

// A soft-edged disc of radius r around p (aspect-corrected).
float disc(vec2 p, float r, float softness) {
  vec2 d = vUv - p;
  d.x *= uAspect;
  return smoothstep(r, r * (1.0 - softness), length(d));
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  // NaN fails every comparison, so this zeroes it; infinities and negatives are clamped.
  bvec3 valid = bvec3(color.r == color.r, color.g == color.g, color.b == color.b);
  color = clamp(mix(vec3(0.0), color, vec3(valid)), 0.0, 6.0e4);
  if (any(isnan(color)) || any(isinf(color))) color = vec3(0.0);
  if (uVisibility > 0.001) {
    vec2 toSun = vUv - uSunPos;
    toSun.x *= uAspect;
    float dist = length(toSun);
    vec3 flare = vec3(0.0);

    // A thin horizontal streak through the Sun, as from a camera's lens coatings.
    flare += vec3(0.75, 0.85, 1.0) * exp(-abs(toSun.y) * 260.0) * exp(-abs(toSun.x) * 3.5) * 0.18;
    // A faint wide halo ring.
    flare += vec3(0.5, 0.7, 1.0) * exp(-pow((dist - 0.42) * 22.0, 2.0)) * 0.025;

    // Ghosts: reflections between lens elements, along the line through the centre.
    vec2 axis = vec2(0.5) - uSunPos;
    flare += vec3(1.0, 0.6, 0.3) * disc(uSunPos + axis * 0.55, 0.035, 0.5) * 0.05;
    flare += vec3(0.4, 1.0, 0.6) * disc(uSunPos + axis * 1.25, 0.07, 0.3) * 0.03;
    flare += vec3(0.4, 0.6, 1.0) * disc(uSunPos + axis * 1.6, 0.11, 0.6) * 0.025;
    flare += vec3(0.8, 0.5, 1.0) * disc(uSunPos + axis * 2.1, 0.05, 0.4) * 0.04;
    flare += vec3(1.0, 0.85, 0.6) * disc(uSunPos + axis * 2.6, 0.16, 0.8) * 0.015;

    color += flare * uVisibility;
  }
  gl_FragColor = vec4(color, 1.0);
}
