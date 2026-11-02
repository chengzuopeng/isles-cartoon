import { describe, expect, it } from 'vitest'
import { BUFF_ORDER } from '../data/loot'
import { ATTRIBUTE_ORDER } from '../data/progression'
import { SKILL_ORDER } from '../data/skills'
import { SPECIAL_WEAPONS, type PlayerWeaponId } from '../data/weapons'
import { ITEM_ICONS, MODEL_IDS, PORTRAIT_IDS, SCENE_IDS, assetUrl } from './asset-urls'

interface FileSystem {
  readFileSync(path: URL): Uint8Array
}

const FS_MODULE = 'node:fs'
const fs = (await import(/* @vite-ignore */ FS_MODULE)) as FileSystem
const ROOT = new URL('../../', import.meta.url)
const published = new Set(Object.keys(import.meta.glob('/public/assets/**/*.{png,jpg,glb}')))
const MODEL_DIR = '/public/assets/models/'
const TRANSCODER_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm']

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function missing(urls: readonly string[]): string[] {
  return urls.filter((url) => !published.has(`/public${url}`))
}

describe('asset urls', () => {
  it('finds the processed assets under public/assets', () => {
    expect(published.size).toBeGreaterThan(0)
  })

  it('has an icon for every buff, skill, attribute, weapon and item', () => {
    const weapons: PlayerWeaponId[] = ['blaster', ...SPECIAL_WEAPONS]
    expect(missing(BUFF_ORDER.map(assetUrl.buff))).toEqual([])
    expect(missing(SKILL_ORDER.map(assetUrl.skill))).toEqual([])
    expect(missing(ATTRIBUTE_ORDER.map(assetUrl.attribute))).toEqual([])
    expect(missing(weapons.map(assetUrl.weapon))).toEqual([])
    expect(missing(ITEM_ICONS.map(assetUrl.item))).toEqual([])
  })

  it('has every portrait, scene and the logo', () => {
    expect(missing(PORTRAIT_IDS.map(assetUrl.portrait))).toEqual([])
    expect(missing(SCENE_IDS.map(assetUrl.scene))).toEqual([])
    expect(missing([assetUrl.logo()])).toEqual([])
  })

  it('has every 3D model', () => {
    expect(missing(MODEL_IDS.map(assetUrl.model))).toEqual([])
  })

  it('ships the Basis transcoder of the installed three.js next to the models', () => {
    for (const name of TRANSCODER_FILES) {
      const shipped = fs.readFileSync(new URL(`public${assetUrl.basis()}${name}`, ROOT))
      const installed = fs.readFileSync(new URL(`node_modules/three/examples/jsm/libs/basis/${name}`, ROOT))
      expect(sameBytes(shipped, installed), `${name} differs from three's copy, run scripts/build-assets.sh`).toBe(true)
    }
  })

  it('registers every published 3D model', () => {
    const registered: readonly string[] = MODEL_IDS
    const files = [...published].filter((path) => path.startsWith(MODEL_DIR) && path.endsWith('.glb'))
    expect(files.length).toBeGreaterThan(0)
    const ids = files.map((path) => path.slice(MODEL_DIR.length, -'.glb'.length))
    expect(ids.filter((id) => !registered.includes(id))).toEqual([])
  })
})
