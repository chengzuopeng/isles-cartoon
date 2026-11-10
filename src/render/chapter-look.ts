import * as THREE from 'three'

export interface ChapterLook {
  sunDirection: THREE.Vector3
  sunColor: string
  sunIntensity: number
  skyLight: string
  groundLight: string
  ambient: number
  litTint: string
  shadowTint: string
  sky: {
    base: string
    high: string
    cloud: string
    cloudShade: string
    horizon: string
    sun: string
    sunHalo: string
  }
  sea: string
  seaShadow: string
  haze: string
}

export const CHAPTER_1_LOOK: ChapterLook = {
  sunDirection: new THREE.Vector3(-10, 5.2, 5).normalize(),
  sunColor: '#ffdca8',
  sunIntensity: 3.2,
  skyLight: '#c9b6ff',
  groundLight: '#8a6a9c',
  ambient: 0.6,
  litTint: '#ffecbc',
  shadowTint: '#6a4cb4',
  sky: {
    base: '#63c2d6',
    high: '#3f9fc8',
    cloud: '#fff2d2',
    cloudShade: '#b9a0dc',
    horizon: '#ffe2a4',
    sun: '#fff7dc',
    sunHalo: '#ffe9a8',
  },
  sea: '#fff3dc',
  seaShadow: '#b9a0dc',
  haze: '#f3d9ae',
}
