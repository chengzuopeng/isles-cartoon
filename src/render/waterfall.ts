import * as THREE from 'three'
import type { RegionPlacement } from '../sim/level'
import type { World } from '../sim/world'
import { glowSprite, groundGlow, radialTexture } from './glow-textures'
import { FOG_LAYER, WATERFALL } from './themes'

export interface Waterfall {
  sync(world: World, clock: number, dt: number, fresh: boolean): void
  dispose(): void
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
uniform float uTime;
uniform float uOpacity;
uniform float uSpeed;
uniform vec3 uColor;
uniform vec3 uDeep;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float across = vUv.x;
  float fall = 1.0 - vUv.y;
  float flow = fall * 2.6 - uTime * uSpeed;
  float streak = noise(vec2(across * 22.0, flow * 1.4));
  float fine = noise(vec2(across * 55.0 + 7.0, flow * 3.1));
  float foam = smoothstep(0.55, 0.95, streak * 0.65 + fine * 0.45);
  float edge = smoothstep(0.0, 0.16, across) * smoothstep(1.0, 0.84, across);
  float lip = smoothstep(0.0, 0.05, fall);
  float base = 1.0 - 0.35 * smoothstep(0.82, 1.0, fall);
  float alpha = uOpacity * edge * lip * base * (0.62 + 0.38 * (streak * 0.7 + fine * 0.3));
  vec3 color = mix(uDeep, uColor, clamp(0.35 + 0.65 * foam + 0.25 * streak, 0.0, 1.0));
  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`

export function curtainGeometry(height: number): THREE.BufferGeometry {
  const W = WATERFALL
  const geometry = new THREE.PlaneGeometry(1, 1, W.columns, W.rows)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i++) {
    const across = position.getX(i)
    const fall = 0.5 - position.getY(i)
    const out = W.forward + W.bulge * fall ** 1.6
    position.setXYZ(i, out, height * (1 - fall), across * W.width * (1 - 0.08 * fall))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

export function createWaterfall(
  group: THREE.Group,
  at: THREE.Vector3,
  yaw: number,
  secrets: readonly RegionPlacement[],
): Waterfall {
  const W = WATERFALL
  const root = new THREE.Group()
  root.position.set(at.x, 0, at.z)
  root.rotation.y = yaw
  const geometry = curtainGeometry(Math.max(0.5, at.y))
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: W.opacity },
      uSpeed: { value: W.speed },
      uColor: { value: new THREE.Color(W.color) },
      uDeep: { value: new THREE.Color(W.deep) },
    },
  })
  const curtain = new THREE.Mesh(geometry, material)
  curtain.renderOrder = FOG_LAYER.under
  curtain.castShadow = false
  root.add(curtain)
  const texture = radialTexture(48, 1.4, 0)
  const splashes = [0, 1].map(() => {
    const splash = groundGlow(texture, W.splash, 1, 0.07)
    splash.position.x = W.forward + W.bulge
    splash.renderOrder = FOG_LAYER.under
    root.add(splash)
    return splash
  })
  const mists = Array.from({ length: W.mistCount }, (_, index) => {
    const sprite = glowSprite(texture, W.mist, 1)
    sprite.renderOrder = FOG_LAYER.under
    root.add(sprite)
    return { sprite, born: -index * (W.mistSeconds / W.mistCount), side: 0 }
  })
  group.add(root)
  const up = new THREE.Vector3(0, 1, 0)
  const foot = new THREE.Vector3(W.forward + W.bulge, 0, 0).applyAxisAngle(up, yaw).add(root.position)
  const near = secrets.filter((secret) => {
    const x = secret.column + secret.width / 2
    const y = secret.row + secret.depth / 2
    return Math.hypot(x - foot.x, y - foot.z) <= W.secretReach
  })
  let opacity: number = W.opacity

  return {
    sync(world, clock, dt, fresh) {
      material.uniforms.uTime.value = clock
      const { x, y } = world.player.pos
      const inside = near.some((secret) => x >= secret.column && x < secret.column + secret.width && y >= secret.row && y < secret.row + secret.depth)
      const goal = inside ? W.faded : W.opacity
      opacity = fresh ? goal : opacity + (goal - opacity) * Math.min(1, dt / W.fadeSeconds)
      material.uniforms.uOpacity.value = opacity
      const strength = opacity / W.opacity
      splashes.forEach((splash, index) => {
        const phase = (clock * 1.3 + index * 0.5) % 1
        splash.scale.setScalar(W.splashRadius * (0.55 + 0.6 * phase))
        splash.material.opacity = W.splashOpacity * (1 - phase) * strength
      })
      const close = Math.hypot(x - foot.x, y - foot.z) <= W.range
      for (const mist of mists) {
        let age = clock - mist.born
        if (age >= W.mistSeconds) {
          mist.born = clock
          mist.side = (Math.random() - 0.5) * W.width * 0.8
          age = 0
        }
        const k = Math.max(0, age) / W.mistSeconds
        mist.sprite.visible = close && age >= 0
        mist.sprite.position.set(W.forward + W.bulge + 0.1 + k * 0.25, 0.2 + k * W.mistRise, mist.side)
        mist.sprite.scale.setScalar(W.mistSize[0] + (W.mistSize[1] - W.mistSize[0]) * k)
        mist.sprite.material.opacity = W.mistOpacity * Math.sin(Math.PI * k) * strength
      }
    },
    dispose() {
      root.removeFromParent()
      geometry.dispose()
      material.dispose()
      texture.dispose()
      for (const splash of splashes) {
        splash.geometry.dispose()
        splash.material.dispose()
      }
      for (const mist of mists) mist.sprite.material.dispose()
    },
  }
}
