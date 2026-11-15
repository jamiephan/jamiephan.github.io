uniform vec3 uColor;
uniform float uIntensity;
uniform float uStreamers;
uniform float uTime;
uniform float uActivity;
varying vec2 vTail;

void main() {
  float s = vTail.x;
  float across = exp(-vTail.y * vTail.y * 4.0);
  // Clamped: interpolation can push s a hair past 1, and pow() of a negative is NaN.
  float along = pow(max(1.0 - s, 0.0), 1.6) * smoothstep(0.0, 0.04, s);
  // Slowly shifting streamers that grow out of the smooth coma.
  float wave = sin(vTail.y * 23.0 + s * 9.0 - uTime * 0.3) * sin(vTail.y * 7.0 - uTime * 0.11);
  float rays = max(1.0 + uStreamers * wave * smoothstep(0.05, 0.4, s), 0.0);
  gl_FragColor = vec4(uColor * uIntensity * uActivity * across * along * rays, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
