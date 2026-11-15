{
  // Triangular noise (sum of two uniforms) dithers more evenly than a single sample.
  vec2 p = gl_FragCoord.xy + fract(uTime * 7.31) * 517.0;
  float noise = grainHash(p) + grainHash(p + 71.3) - 1.0;
  // Film grain shows most in the mid-tones and darks, little in highlights.
  float luma = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb += noise * uGrain * (1.0 - 0.7 * luma);
}
