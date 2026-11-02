import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYS, KEY_ACTIONS, actionCodes, isBindable, keyLabel, rebind, sanitizeKeys } from './keymap'

describe('keymap', () => {
  it('defaults when nothing is saved', () => {
    expect(sanitizeKeys(null)).toEqual(DEFAULT_KEYS)
    expect(sanitizeKeys('junk')).toEqual(DEFAULT_KEYS)
  })

  it('keeps saved bindings and fills actions added later from the defaults', () => {
    const keys = sanitizeKeys({ forward: 'KeyZ', jump: 'KeyX' })
    expect(keys.forward).toBe('KeyZ')
    expect(keys.jump).toBe('KeyX')
    expect(keys.back).toBe(DEFAULT_KEYS.back)
  })

  it('drops reserved, unknown and duplicated codes', () => {
    const keys = sanitizeKeys({ forward: 'Escape', back: 'Banana', left: 'KeyQ', skillQ: 'KeyQ' })
    expect(keys.forward).toBeNull()
    expect(keys.back).toBeNull()
    expect(keys.left).toBe('KeyQ')
    expect(keys.skillQ).toBeNull()
    const codes = KEY_ACTIONS.map(({ id }) => keys[id]).filter((code) => code !== null)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('swaps when a key is already taken', () => {
    const keys = { ...DEFAULT_KEYS }
    expect(rebind(keys, 'jump', 'KeyF')).toBe('interact')
    expect(keys.jump).toBe('KeyF')
    expect(keys.interact).toBe('Space')
    expect(rebind(keys, 'jump', 'Escape')).toBeNull()
    expect(keys.jump).toBe('KeyF')
  })

  it('always adds the fixed alternatives', () => {
    expect(actionCodes(DEFAULT_KEYS, 'forward')).toEqual(['KeyW', 'ArrowUp'])
    expect(actionCodes(DEFAULT_KEYS, 'melee')).toEqual([])
    expect(isBindable('ArrowUp')).toBe(false)
  })

  it('names keys for the settings panel', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('Digit2')).toBe('2')
    expect(keyLabel('Space')).toBe('空格')
    expect(keyLabel(null)).toBe('未绑定')
  })
})
