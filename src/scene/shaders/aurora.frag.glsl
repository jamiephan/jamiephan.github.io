// Aurorae as glowing curtains with real height, ray-marched through a shell above the clouds.
// Works in the Earth's object space (the ovals sit round the magnetic poles, which turn with the
// Earth), in units of the Earth's radius. Seen from above they're bright ovals; at the limb the
// curtains stand up against space: a sharp green lower edge (oxygen, ~100 km), fading upward
// into red tops on the tallest rays (oxygen again, ~250 km), with a pink-violet fringe along the
// bottom (nitrogen) where it's most active.
varying vec3 vLocalPos;
varying vec3 vLocalCamera;
varying vec3 vLocalSun;
uniform float uRadius;
/** Lower and upper edge of the glowing layer (multiples of the radius). */
uniform float uBottom;
uniform float uTop;
uniform float uIntensity;
uniform float uTime;

// Emission of one auroral oval around `pole` at point `p` (|p| = len), on the night side.
vec3 oval(vec3 n, float height, vec3 pole, float seed) {
  float theta = acos(clamp(dot(n, pole), -1.0, 1.0));
  // The curtains' centre stays within 0.048 of 0.34, and the faintest part of them has faded
  // below the cut-off 0.095 from it: skip everything further out (most of the globe).
  if (abs(theta - 0.34) > 0.15) return vec3(0.0);
  vec3 east = normalize(cross(pole, abs(pole.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1)));
  float lon = atan(dot(n, cross(pole, east)), dot(n, east));
  float t = uTime;

  // The oval wobbles slowly, and folds into curls and spirals that drift along it.
  float centre = 0.34 + 0.03 * sin(lon * 3.0 + t * 0.07 + seed)
    + 0.012 * sin(lon * 11.0 - t * 0.21 + seed * 2.0)
    + 0.006 * sin(lon * 27.0 + t * 0.5 + seed);
  float offset = theta - centre;
  // A thin, bright main curtain, a fainter parallel arc poleward of it, and a diffuse glow.
  float a = offset / 0.01;
  float b = (offset + 0.032) / 0.008;
  float c = offset / 0.045;
  float sheet = exp(-a * a) + 0.45 * exp(-b * b) + 0.25 * exp(-c * c);
  if (sheet < 0.003) return vec3(0.0);

  // Fine vertical rays along the curtain, shimmering, and slow surges that run round the oval.
  float ray = noise(vec3(lon * 70.0, t * 0.6, seed));
  float rays = 0.25 + 1.2 * ray * ray;
  float surge = 0.45 + 0.75 * noise(vec3(lon * 2.5 + seed, t * 0.15, seed * 1.3));

  // Height profile: a sharp lower edge, green fading upward, red only on the tallest rays.
  float green = exp(-height * 5.0) * smoothstep(0.0, 0.06, height);
  float high = (height - 0.55) / 0.28;
  float low = height / 0.035;
  float red = exp(-high * high) * ray * ray;
  float fringe = exp(-low * low) * smoothstep(0.6, 1.1, surge);
  vec3 colour = vec3(0.12, 1.0, 0.38) * green
    + vec3(1.0, 0.12, 0.28) * red * 0.3
    + vec3(0.75, 0.25, 0.95) * fringe * 0.5;
  return colour * sheet * rays * surge;
}

void main() {
  vec3 origin = vLocalCamera / uRadius;
  vec3 dir = normalize(vLocalPos / uRadius - origin);
  vec3 L = normalize(vLocalSun);

  vec2 outer = raySphere(origin, dir, uTop);
  vec2 ground = raySphere(origin, dir, 1.0);
  float start = max(outer.x, 0.0);
  float end = ground.x > 0.0 ? min(outer.y, ground.x) : outer.y;
  if (end <= start) discard;

  // Short paths straight down through the layer need few steps; the long grazing ones at the
  // limb (where the curtains stand up against space) get the most.
  float chord = end - start;
  float maxChord = 2.0 * sqrt(uTop * uTop - 1.0);
  int steps = int(clamp(ceil(float(MAX_STEPS) * chord / maxChord), float(MIN_STEPS), float(MAX_STEPS)));
  float stepSize = chord / float(steps);
  // Offset each pixel's samples a little, so steps show as fine noise rather than bands.
  float jitter = hash(vec3(gl_FragCoord.xy, 1.7));

  vec3 north = normalize(vec3(0.08, 1.0, 0.05));
  vec3 south = normalize(vec3(-0.1, -1.0, 0.07));
  float thickness = uTop - uBottom;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;
    vec3 p = origin + dir * (start + stepSize * (float(i) + jitter));
    float len = length(p);
    if (len < uBottom) continue;
    vec3 n = p / len;
    // Drowned out on the day side; brightest well into the night.
    float dark = smoothstep(0.15, -0.1, dot(n, L));
    if (dark <= 0.0) continue;
    float height = (len - uBottom) / thickness;
    sum += (oval(n, height, north, 1.7) + oval(n, height, south, 5.3)) * dark * stepSize;
  }

  vec3 color = sum * uIntensity;
  // Ease off the very brightest (long limb paths) so they glow into the bloom rather than clip.
  color /= 1.0 + 0.2 * lum(color);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
