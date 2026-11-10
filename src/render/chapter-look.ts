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
  shadowTint: '#7550a8',
  sky: {
    base: '#f9d39a',
    high: '#b48cb0',
    cloud: '#ffe9c2',
    cloudShade: '#cf93a2',
    horizon: '#ffe6ae',
    sun: '#fff4d2',
    sunHalo: '#ffe2a6',
  },
  sea: '#ffdcae',
  seaShadow: '#dc9a88',
  haze: '#f6c994',
}
