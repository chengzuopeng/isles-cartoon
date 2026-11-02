export type TrackId = 'prep' | 'explore' | 'battle' | 'boss'

export type Step = number | null

export type DrumPattern = {
  kick: string
  snare: string
  hat: string
}

export type MusicTrack = {
  bpm: number
  root: number
  scale: readonly number[]
  chords: readonly number[]
  bass: readonly Step[]
  lead: readonly Step[]
  drums: DrumPattern
  pad: boolean
  mix: { bass: number; lead: number; pad: number; kick: number; snare: number; hat: number }
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11]
const _ = null

export const TRACKS: Readonly<Record<TrackId, MusicTrack>> = {
  prep: {
    bpm: 80,
    root: 60,
    scale: MAJOR,
    chords: [0, 5, 3, 4],
    bass: [0, _, _, _, 4, _, _, _],
    lead: [
      2, _, 1, _, 0, _, 1, 2,
      5, _, 4, _, 2, _, _, _,
      3, _, 4, _, 5, _, 7, _,
      6, _, 4, _, 1, _, _, _,
    ],
    drums: { kick: 'x...............', snare: '................', hat: '....x.......x...' },
    pad: true,
    mix: { bass: 0.12, lead: 0.05, pad: 0.03, kick: 0.25, snare: 0, hat: 0.03 },
  },
  explore: {
    bpm: 112,
    root: 62,
    scale: MAJOR,
    chords: [0, 4, 5, 3],
    bass: [0, _, 0, 4, 0, _, 4, _],
    lead: [
      4, _, 4, 5, 4, _, 2, _,
      1, _, 1, 2, 4, _, _, _,
      5, _, 4, 2, 1, _, 2, _,
      3, _, 2, 1, 0, _, _, _,
    ],
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    pad: true,
    mix: { bass: 0.13, lead: 0.05, pad: 0.025, kick: 0.35, snare: 0.12, hat: 0.03 },
  },
  battle: {
    bpm: 132,
    root: 57,
    scale: MINOR,
    chords: [0, 5, 6, 4],
    bass: [0, 0, 7, 0, 0, 0, 7, 4],
    lead: [
      4, _, 4, 3, 4, _, 6, _,
      5, _, 4, 3, 2, _, _, _,
      6, _, 6, 5, 6, _, 7, _,
      4, _, 3, 1, 4, _, _, _,
    ],
    drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
    pad: true,
    mix: { bass: 0.14, lead: 0.05, pad: 0.025, kick: 0.4, snare: 0.15, hat: 0.02 },
  },
  boss: {
    bpm: 150,
    root: 52,
    scale: HARMONIC_MINOR,
    chords: [0, 0, 5, 4],
    bass: [0, 0, 0, 0, 0, 0, 7, 0],
    lead: [
      0, _, 2, _, 4, _, 2, 0,
      7, _, 6, _, 4, _, _, _,
      5, _, 4, _, 2, _, 4, 5,
      6, _, 4, _, 6, _, 8, _,
    ],
    drums: { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    pad: true,
    mix: { bass: 0.15, lead: 0.055, pad: 0.03, kick: 0.45, snare: 0.16, hat: 0.03 },
  },
}

export const MUSIC_FADE = 1.2
export const BATTLE_ENEMIES = 3
export const BATTLE_RANGE = 12
export const BATTLE_HOLD = 4
