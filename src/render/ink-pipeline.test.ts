import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK, createInkPipeline, detailGain } from './ink-pipeline'

describe('ink pipeline detail fade', () => {
  it('keeps inner lines on characters that fill the screen', () => {
    expect(detailGain(2, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(1)
    expect(detailGain(DEFAULT_LOOK.detailNear, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(1)
  })

  it('drops inner lines once a character is small on screen', () => {
    expect(detailGain(DEFAULT_LOOK.detailFar, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(0)
    expect(detailGain(40, 1, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)).toBe(0)
  })

  it('fades smoothly in between', () => {
    const near = DEFAULT_LOOK.detailNear
    const far = DEFAULT_LOOK.detailFar
    let previous = 1
    for (let distance = near; distance <= far; distance += 0.5) {
      const gain = detailGain(distance, 1, near, far)
      expect(gain).toBeLessThanOrEqual(previous)
      previous = gain
    }
    expect(detailGain((near + far) / 2, 1, near, far)).toBeCloseTo(0.5, 5)
  })

  it('scales with the size of the character', () => {
    const small = detailGain(10, 0.8, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)
    const large = detailGain(10, 3, DEFAULT_LOOK.detailNear, DEFAULT_LOOK.detailFar)
    expect(large).toBe(1)
    expect(small).toBeLessThan(large)
  })

  it('thins outlines with distance only past the near range', () => {
    expect(DEFAULT_LOOK.lineNear).toBeGreaterThan(DEFAULT_LOOK.detailNear)
    expect(DEFAULT_LOOK.lineMin).toBeLessThan(DEFAULT_LOOK.lineWidth)
    expect(DEFAULT_LOOK.creaseStart).toBeLessThan(DEFAULT_LOOK.creaseEnd)
  })

  it('skips shadow map updates during the normal pass and restores flags afterward', () => {
    const calls: { scene: THREE.Object3D; autoUpdate: boolean; needsUpdate: boolean }[] = []
    const shadowMap = { autoUpdate: true, needsUpdate: true }
    const renderer = {
      shadowMap,
      getContext: () => ({ getExtension: () => null }),
      getClearColor: (target: THREE.Color) => target.set('#000000'),
      getClearAlpha: () => 1,
      setRenderTarget: () => {},
      clear: () => {},
      setClearColor: () => {},
      render: (target: THREE.Object3D) => {
        calls.push({ scene: target, autoUpdate: shadowMap.autoUpdate, needsUpdate: shadowMap.needsUpdate })
      },
    }
    const pipeline = createInkPipeline(renderer as unknown as THREE.WebGLRenderer)
    pipeline.toggles.bloom = false
    const scene = new THREE.Scene()
    const farMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    farMesh.userData.normalDistance = 60
    farMesh.position.z = -80
    scene.add(farMesh)
    const camera = new THREE.PerspectiveCamera()
    pipeline.render(scene, camera, null)
    const sceneCalls = calls.filter((entry) => entry.scene === scene)
    expect(sceneCalls).toHaveLength(2)
    expect(sceneCalls[0]).toMatchObject({ autoUpdate: true, needsUpdate: true })
    expect(sceneCalls[1]).toMatchObject({ autoUpdate: false, needsUpdate: false })
    expect(shadowMap).toEqual({ autoUpdate: true, needsUpdate: true })
    pipeline.dispose()
  })
})
