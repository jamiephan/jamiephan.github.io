attribute vec2 aTail; // x: 0 at the head → 1 at the tip, y: -1 → 1 across
uniform vec3 uHead;
uniform vec3 uAxis;
uniform vec3 uCurve;
uniform float uLength;
uniform float uWidth;
uniform float uActivity;
varying vec2 vTail;

void main() {
  float s = aTail.x;
  float length = uLength * (0.35 + 0.65 * uActivity);
  vec3 spine = uHead + (uAxis * s + uCurve * s * s) * length;
  vec3 tangent = normalize(uAxis + 2.0 * s * uCurve);
  // Seen straight down the tail the cross product vanishes; any perpendicular will do.
  vec3 across = cross(tangent, normalize(cameraPosition - spine));
  // ("length" is a local variable here, hiding the built-in function.)
  float acrossLength = sqrt(dot(across, across));
  vec3 side = acrossLength > 1e-5
    ? across / acrossLength
    : normalize(cross(tangent, abs(tangent.z) < 0.9 ? vec3(0, 0, 1) : vec3(1, 0, 0)));
  float halfWidth = uWidth * (0.08 + 0.92 * sqrt(s));
  vTail = aTail;
  gl_Position = projectionMatrix * viewMatrix * vec4(spine + side * aTail.y * halfWidth, 1.0);
}
