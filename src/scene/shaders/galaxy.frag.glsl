#define PI 3.141592653589793
uniform vec3 uCore;
uniform vec3 uDisc;
uniform float uArms;
uniform float uWinding;
uniform float uBar;
uniform float uBrightness;
uniform float uSeed;
/** The disc's turn on the sky (radians) and the cosine of its tilt away from face-on. */
uniform float uAngle;
uniform float uCosTilt;
/** 0 = grand-design arms, 1 = flocculent: short, patchy arm fragments. */
uniform float uFlocculent;
/** Radius of a star-forming ring (0 = none). */
uniform float uRing;
/** 1 = irregular: no orderly structure, just patchy star clouds around an off-centre bar. */
uniform float uIrregular;
/** Radius of a large round bulge (0 = none), as in the Sombrero galaxy. */
uniform float uSpheroid;
/** Opacity of the dust lane along the near side of a disc seen edge-on (0 = none). */
uniform float uDustLane;
varying vec2 vPos;

// Real discs have some thickness: edge-on they're a thin strip of light rather than a line,
// with a thinner band of dust along it.
const float THICKNESS = 0.07;
const float LANE_THICKNESS = 0.025;

void main() {
  // The quad faces the camera. Undo the disc's turn on the sky, then its tilt, to get the
  // point in the disc's own plane (unit radius).
  float ca = cos(uAngle);
  float sa = sin(uAngle);
  vec2 sky = vec2(ca * vPos.x + sa * vPos.y, -sa * vPos.x + ca * vPos.y);
  vec2 p = vec2(sky.x, sky.y / max(uCosTilt, THICKNESS));
  float r = length(p);
  // A big bulge is (nearly) round on the sky, however the disc is tilted.
  float spheroid = uSpheroid > 0.0 ? length(vec2(sky.x, sky.y * 1.2)) / uSpheroid : 2.0;
  if (r > 1.0 && spheroid > 1.0) discard;

  float theta = atan(p.y, p.x);
  float grain = fbm(vec3(p * 6.0, uSeed));

  // Old stars: a warm bulge (stretched into a bar on barred spirals) and a smooth disc.
  vec2 barred = vec2(p.x / (1.0 + 2.5 * uBar), p.y);
  float bulge = exp(-dot(barred, barred) * 90.0) * 2.2 + exp(-r * r * 22.0) * 0.5;
  float disc = exp(-r * 4.2) * smoothstep(1.0, 0.6, r);

  vec3 light = uCore * bulge;
  if (uIrregular > 0.0) {
    // Patchy clouds of young stars with no arms to speak of, around a bar set off-centre.
    vec2 bar = vec2((p.x - 0.18) / (1.0 + 3.0 * uBar), p.y + 0.08);
    float clouds = fbm(vec3(p * 2.4, uSeed + 5.0));
    float body = smoothstep(0.3, 0.75, clouds + 0.45 * (1.0 - r)) * smoothstep(1.0, 0.45, r);
    light = uCore * exp(-dot(bar, bar) * 40.0) * 0.9 + uDisc * body * (0.5 + 0.8 * grain) * 0.9;
    float knots = smoothstep(0.64, 0.8, fbm(vec3(p * 16.0, uSeed + 3.0))) * body;
    light += vec3(1.0, 0.35, 0.55) * knots * 2.2;
  } else if (uArms > 0.0) {
    // Logarithmic spiral arms, wobbling a little with noise so they aren't perfect.
    float logR = log(max(r, 0.02));
    float phase = uArms * (theta - uWinding * logR) + 2.0 * (grain - 0.5);
    float arm = pow(0.5 + 0.5 * cos(phase), 3.0);
    if (uFlocculent > 0.0) {
      // Flocculent spirals have no long, continuous arms: break them into short fragments.
      float flakes = smoothstep(0.32, 0.7, fbm(vec3(p * 8.0, uSeed + 7.0)));
      arm = mix(arm, (arm * 0.7 + 0.3) * flakes * 1.4, uFlocculent);
    }
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
    // Elliptical or lenticular: a smooth, featureless glow of old stars.
    light += uDisc * exp(-r * 5.0) * 1.2;
  }
  if (uRing > 0.0) {
    // A ring of young, blue stars (and pink star-forming knots), as in Hoag's Object or the
    // Cartwheel: a wave of star formation spreading out from the centre.
    float ring = exp(-pow((r - uRing) / 0.06, 2.0));
    light += uDisc * ring * (0.5 + 1.0 * grain) * 1.2;
    float knots = smoothstep(0.6, 0.8, fbm(vec3(p * 18.0, uSeed + 9.0)));
    light += vec3(1.0, 0.4, 0.6) * ring * knots * 1.8;
  }
  // Soft rim so the quad's edge never shows.
  light *= smoothstep(1.0, 0.8, r);
  if (uSpheroid > 0.0) {
    light += uCore * (exp(-spheroid * spheroid * 5.0) * 1.1 + exp(-spheroid * 14.0) * 1.5)
      * smoothstep(1.0, 0.7, spheroid);
  }
  if (uDustLane > 0.0) {
    // Near edge-on, the near half of the disc is a dark band of dust across the bulge and the
    // light behind it, just to one side of the midline.
    float nearSide = sky.y / max(uCosTilt, LANE_THICKNESS);
    float dust = smoothstep(0.02, -0.15, nearSide) * smoothstep(1.0, 0.5, length(vec2(sky.x, nearSide)));
    light *= 1.0 - uDustLane * dust * (1.0 - smoothstep(0.25, 0.6, uCosTilt));
  }
  gl_FragColor = vec4(light * uBrightness, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
