import * as THREE from 'three'

export type HatchEdge = 'disc' | 'lane'

export interface HatchOptions {
  color: THREE.ColorRepresentation
  opacity: number
  gap: number
  edge: HatchEdge
}

export const TELEGRAPH_HATCH = {
  spacing: 0.6,
  width: 0.45,
  speed: 0.8,
  edgePixels: 3,
  edgeOpacity: 0.95,
  edgeGlow: 1.45,
  area: { opacity: 0.45, gap: 0.2 },
  fill: { opacity: 0.7, gap: 0.35 },
} as const

export const HATCH_TIME = { value: 0 }

const HATCH_VERTEX_HEAD = /* glsl */ `
varying vec3 vHatchWorld;
`

const HATCH_VERTEX_BODY = /* glsl */ `
#include <project_vertex>
vHatchWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const HATCH_FRAGMENT_HEAD = /* glsl */ `
uniform float hatchTime;
uniform float hatchGap;
uniform float hatchSpacing;
uniform float hatchWidth;
uniform float hatchEdgePixels;
uniform float hatchEdgeOpacity;
uniform float hatchEdgeGlow;
varying vec3 vHatchWorld;

float hatchPixels(float distance) {
  return distance / max(fwidth(distance), 0.00001);
}
`

const HATCH_FRAGMENT_BODY = /* glsl */ `
float hatchCoord = (vHatchWorld.x + vHatchWorld.z) / hatchSpacing;
float hatchBand = fract(hatchCoord - hatchTime);
float hatchSoft = max(fwidth(hatchCoord) * 1.2, 0.001);
float hatchStripe = smoothstep(0.0, hatchSoft, hatchBand) * (1.0 - smoothstep(hatchWidth - hatchSoft, hatchWidth, hatchBand));
hatchStripe = mix(hatchStripe, hatchWidth, clamp(hatchSoft * 2.0 - 0.4, 0.0, 1.0));
float hatchEdgeDistance = 1000.0;
#ifdef HATCH_DISC
hatchEdgeDistance = hatchPixels(0.5 - length(vUv - 0.5));
#endif
#ifdef HATCH_LANE
hatchEdgeDistance = min(hatchPixels(min(vUv.y, 1.0 - vUv.y)), hatchPixels(1.0 - vUv.x));
#endif
float hatchEdge = 1.0 - smoothstep(hatchEdgePixels - 1.0, hatchEdgePixels, hatchEdgeDistance);
diffuseColor.a = max(diffuseColor.a * mix(hatchGap, 1.0, hatchStripe), hatchEdge * hatchEdgeOpacity);
outgoingLight = mix(outgoingLight, outgoingLight * hatchEdgeGlow, hatchEdge);
#include <opaque_fragment>
`

export function hatchedMaterial({ color, opacity, gap, edge }: HatchOptions): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  material.defines = { USE_UV: '', [edge === 'disc' ? 'HATCH_DISC' : 'HATCH_LANE']: '' }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      hatchTime: HATCH_TIME,
      hatchGap: { value: gap },
      hatchSpacing: { value: TELEGRAPH_HATCH.spacing },
      hatchWidth: { value: TELEGRAPH_HATCH.width },
      hatchEdgePixels: { value: TELEGRAPH_HATCH.edgePixels },
      hatchEdgeOpacity: { value: TELEGRAPH_HATCH.edgeOpacity },
      hatchEdgeGlow: { value: TELEGRAPH_HATCH.edgeGlow },
    })
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${HATCH_VERTEX_HEAD}`).replace('#include <project_vertex>', HATCH_VERTEX_BODY)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${HATCH_FRAGMENT_HEAD}`).replace('#include <opaque_fragment>', HATCH_FRAGMENT_BODY)
  }
  material.customProgramCacheKey = () => `hatch-${edge}`
  material.userData.hatch = { gap, edge }
  return material
}

export function advanceHatch(seconds: number): void {
  HATCH_TIME.value = (HATCH_TIME.value + seconds * TELEGRAPH_HATCH.speed) % 1000
}
