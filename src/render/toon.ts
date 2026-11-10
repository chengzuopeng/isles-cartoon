import * as THREE from 'three'

export const INK_UNIFORMS = {
  inkShadowTint: { value: new THREE.Color('#5a5f8a') },
  inkLitTint: { value: new THREE.Color('#ffffff') },
  inkTintAmount: { value: 0.82 },
  inkShadowDesat: { value: 0.45 },
  inkShadeLow: { value: 0.42 },
  inkShadeHigh: { value: 0.62 },
  inkMidLevel: { value: 0.86 },
  inkShadowLevel: { value: 0.62 },
  inkDotCell: { value: 8 },
  inkDotDarken: { value: 0.6 },
  inkDots: { value: 1 },
  inkSurfaceDots: { value: 0 },
  inkSpecular: { value: 0.16 },
  inkSpecAmount: { value: 0.28 },
}

export const INK_COLOR = new THREE.Color('#1d1714')

const INK_HEAD = /* glsl */ `
uniform vec3 inkShadowTint;
uniform vec3 inkLitTint;
uniform float inkTintAmount;
uniform float inkShadowDesat;
uniform float inkShadeLow;
uniform float inkShadeHigh;
uniform float inkMidLevel;
uniform float inkShadowLevel;
uniform float inkDotCell;
uniform float inkDotDarken;
uniform float inkDots;
uniform float inkSurfaceDots;
uniform float inkSpecular;
uniform float inkSpecAmount;
varying vec3 inkWorldPosition;
varying vec3 inkWorldNormal;

float inkHalftone(vec2 point, float amount) {
  vec2 rotated = mat2(0.7071, -0.7071, 0.7071, 0.7071) * point;
  vec2 cell = fract(rotated) - 0.5;
  float distanceToCenter = length(cell);
  float radius = sqrt(clamp(amount, 0.0, 1.0)) * 0.6;
  float soft = max(fwidth(distanceToCenter), 0.02);
  return 1.0 - smoothstep(radius - soft, radius + soft, distanceToCenter);
}

float inkSurfaceHalftone(float amount) {
  vec3 blend = abs(normalize(inkWorldNormal));
  blend = pow(blend, vec3(4.0));
  blend /= max(blend.x + blend.y + blend.z, 0.0001);
  vec3 scaled = inkWorldPosition * 9.0;
  return inkHalftone(scaled.yz, amount) * blend.x + inkHalftone(scaled.xz, amount) * blend.y + inkHalftone(scaled.xy, amount) * blend.z;
}
`

const INK_BODY = /* glsl */ `
vec3 inkLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
float inkAlbedo = max(dot(material.diffuseColor, vec3(0.299, 0.587, 0.114)), 0.004);
float inkLit = dot(inkLight, vec3(0.299, 0.587, 0.114)) / inkAlbedo;
float inkEdge = max(fwidth(inkLit) * 0.75, 0.012);
float inkShade = 1.0 - smoothstep(inkShadeLow - inkEdge, inkShadeLow + inkEdge, inkLit);
float inkMid = 1.0 - smoothstep(inkShadeHigh - inkEdge, inkShadeHigh + inkEdge, inkLit);
vec3 inkLitColor = diffuseColor.rgb * inkLitTint * mix(1.0, inkMidLevel, inkMid);
vec3 inkShadowBase = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), inkShadowDesat);
vec3 inkShadowColor = inkShadowBase * mix(vec3(1.0), inkShadowTint * 2.2, inkTintAmount) * inkShadowLevel;
vec3 inkColor = mix(inkLitColor, inkShadowColor, inkShade);
float inkDarkness = inkShade * clamp(1.0 - inkLit / max(inkShadeLow, 0.001), 0.3, 1.0);
float inkScreenDots = inkHalftone(gl_FragCoord.xy / inkDotCell, inkDarkness);
float inkDotMask = mix(inkScreenDots, inkSurfaceHalftone(inkDarkness), inkSurfaceDots) * inkDots;
inkColor = mix(inkColor, inkColor * inkDotDarken, inkDotMask);
#ifdef STANDARD
float inkSpec = dot(reflectedLight.directSpecular, vec3(0.333));
inkColor += vec3(smoothstep(inkSpecular - 0.01, inkSpecular + 0.01, inkSpec) * inkSpecAmount * (1.0 - inkShade));
#endif
outgoingLight = inkColor + totalEmissiveRadiance;
`

const INK_VERTEX_HEAD = /* glsl */ `
varying vec3 inkWorldPosition;
varying vec3 inkWorldNormal;
`

const INK_VERTEX_BODY = /* glsl */ `
#include <worldpos_vertex>
vec4 inkWorld = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  inkWorld = batchingMatrix * inkWorld;
#endif
#ifdef USE_INSTANCING
  inkWorld = instanceMatrix * inkWorld;
#endif
inkWorld = modelMatrix * inkWorld;
inkWorldPosition = inkWorld.xyz;
inkWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
`

let gradient: THREE.DataTexture | null = null

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  gradient = new THREE.DataTexture(new Uint8Array([60, 160, 255]), 3, 1, THREE.RedFormat)
  gradient.minFilter = THREE.NearestFilter
  gradient.magFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

function inkable(material: THREE.Material): boolean {
  return (
    material instanceof THREE.MeshStandardMaterial ||
    material instanceof THREE.MeshToonMaterial ||
    material instanceof THREE.MeshLambertMaterial ||
    material instanceof THREE.MeshPhongMaterial
  )
}

export function inkify<T extends THREE.Material>(material: T): T {
  if (material.userData.ink || !inkable(material)) return material
  const previous = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    Object.assign(shader.uniforms, INK_UNIFORMS)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${INK_VERTEX_HEAD}`)
      .replace('#include <worldpos_vertex>', INK_VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${INK_HEAD}`)
      .replace('#include <opaque_fragment>', `${INK_BODY}\n#include <opaque_fragment>`)
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${key()}|ink`
  material.userData.ink = true
  if (material.version > 0) material.needsUpdate = true
  return material
}

export function toonMaterial(parameters: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return inkify(new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...parameters }))
}

export function cloneInked<T extends THREE.Material>(material: T): T {
  const copy = material.clone() as T
  delete copy.userData.ink
  return inkify(copy)
}

export function toToon(source: THREE.Material): THREE.Material {
  return inkify(source)
}

export function toonify(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    if (Array.isArray(mesh.material)) for (const material of mesh.material) inkify(material)
    else if (mesh.material) inkify(mesh.material)
  })
}
