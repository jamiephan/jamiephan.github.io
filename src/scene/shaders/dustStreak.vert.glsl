attribute float aEnd;
attribute vec2 aRandom;
uniform vec3 uVelocity;
uniform float uStreakTime;
uniform vec2 uStreakSpeeds;
uniform vec2 uStreakThinSpeeds;
varying vec3 vColor;

void main() {
  vec3 head = dustOffset(position);
  // The tail is where the grain appeared to be a moment ago, relative to the camera.
  vec3 offset = head + uVelocity * uStreakTime * aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(uCameraPos + offset, 1.0);

  float speed = length(uVelocity);
  float streaking = smoothstep(uStreakSpeeds.x, uStreakSpeeds.y, speed);
  // Faster still, drop up to three quarters of the grains (picked by aRandom.x, with a soft edge so
  // they fade rather than pop) so the field doesn't turn into a blur.
  float keep = mix(1.0, 0.25, smoothstep(uStreakThinSpeeds.x, uStreakThinSpeeds.y, speed));
  float thinning = clamp((keep - aRandom.x) / 0.05 + 1.0, 0.0, 1.0);
  vColor = dustLight(head) * streaking * thinning * (1.0 - aEnd) * 3.0
    * mix(0.3, 1.0, aRandom.y);
}
