// Works in the planet's object space, where an oblate planet is a sphere again; the camera and
// Sun are brought into it once per vertex (they're the same for every vertex).
varying vec3 vLocalPos;
varying vec3 vLocalCamera;
varying vec3 vLocalSun;
uniform vec3 uSunDir;

void main() {
  mat4 toLocal = inverse(modelMatrix);
  vLocalPos = position;
  vLocalCamera = (toLocal * vec4(cameraPosition, 1.0)).xyz;
  vLocalSun = mat3(toLocal) * uSunDir;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
