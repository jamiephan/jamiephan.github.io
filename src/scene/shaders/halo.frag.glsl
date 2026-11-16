// Thin glowing haze around the limb of a planet with an atmosphere: a cheap, analytic stand-in
// for the ray-marched one on Earth. Light scattered along a ray grows with the gas it grazes,
// which falls off exponentially with height above the surface, so the glow is brightest right
// at the limb and fades over a few scale heights. Drawn on the back faces of a slightly larger
// shell, so it works from inside too, and the planet's own depth hides it over the disc.
varying vec3 vLocalPos;
varying vec3 vLocalCamera;
varying vec3 vLocalSun;
uniform vec3 uSunColor;
uniform vec3 uColor;
uniform float uRadius;
/** Scale height as a fraction of the radius. */
uniform float uHeight;
/** Shell radius as a multiple of the planet radius. */
uniform float uShell;

void main() {
  vec3 origin = vLocalCamera / uRadius;
  vec3 dir = normalize(vLocalPos - vLocalCamera);
  vec3 L = normalize(vLocalSun);

  // Closest approach of the ray to the centre (the camera itself if it looks away, from inside).
  float along = max(-dot(origin, dir), 0.0);
  vec3 closest = origin + dir * along;
  float height = max(length(closest) - 1.0, 0.0);

  // Density at the grazing point, faded to exactly zero at the shell so it has no edge.
  float floorDensity = exp(-(uShell - 1.0) / uHeight);
  float density = max(exp(-height / uHeight) - floorDensity, 0.0) / (1.0 - floorDensity);

  // Lit where the Sun is up over that point (a little past the terminator: the haze sits
  // high), plus forward scattering, so a backlit planet shows a faint ring of light.
  float sunUp = smoothstep(-0.25, 0.35, dot(normalize(closest), L));
  float forward = pow(max(dot(dir, L), 0.0), 6.0);
  float glow = density * (sunUp + 0.6 * forward);

  gl_FragColor = vec4(uColor * uSunColor * glow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
