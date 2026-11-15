varying vec2 vUv;
varying vec3 vObjNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vObjNormal = normal;
  vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
