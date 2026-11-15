#define PI 3.141592653589793
uniform vec3 uCore;
uniform vec3 uDisc;
uniform float uArms;
uniform float uWinding;
uniform float uBar;
uniform float uBrightness;
uniform float uSeed;
varying vec2 vPos;

void main() {
  vec2 p = vPos;
  float r = length(p);
  if (r > 1.0) discard;
  float theta = atan(p.y, p.x);
  float grain = fbm(vec3(p * 6.0, uSeed));

  // Old stars: a warm bulge (stretched into a bar on barred spirals) and a smooth disc.
  vec2 barred = vec2(p.x / (1.0 + 2.5 * uBar), p.y);
  float bulge = exp(-dot(barred, barred) * 90.0) * 2.2 + exp(-r * r * 22.0) * 0.5;
  float disc = exp(-r * 4.2) * smoothstep(1.0, 0.6, r);

  vec3 light = uCore * bulge;
  if (uArms > 0.0) {
    // Logarithmic spiral arms, wobbling a little with noise so they aren't perfect.
    float logR = log(max(r, 0.02));
    float phase = uArms * (theta - uWinding * logR) + 2.0 * (grain - 0.5);
    float arm = pow(0.5 + 0.5 * cos(phase), 3.0);
    // Arms emerge from the bar's ends (or the core) and fade out at the rim.
    float armZone = smoothstep(0.08 + uBar * 0.6, 0.25 + uBar * 0.6, r) * smoothstep(1.0, 0.45, r);
    // Dust lanes on the inner (trailing) edge of each arm.
    float lane = pow(0.5 + 0.5 * cos(phase + 0.9), 6.0) * armZone;
    // Pink star-forming knots dotted along the arms.
    float knots = smoothstep(0.62, 0.8, fbm(vec3(p * 22.0, uSeed + 3.0))) * arm * armZone;
    float clumpy = 0.6 + 0.8 * grain;

    light += uDisc * disc * (0.35 + 2.4 * arm * armZone * clumpy);
    light += vec3(1.0, 0.35, 0.55) * knots * 1.6 * disc * 3.0;
    light *= 1.0 - 0.65 * lane * smoothstep(0.08, 0.3, r);
  } else {
    // Elliptical: a smooth, featureless glow of old stars.
    light += uDisc * exp(-r * 5.0) * 1.2;
  }
  // Soft rim so the quad's edge never shows.
  light *= smoothstep(1.0, 0.8, r);
  gl_FragColor = vec4(light * uBrightness, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
