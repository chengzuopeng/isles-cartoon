import { MUSIC_FADE, TRACKS, type MusicTrack, type TrackId } from '../data/music'

export interface Music {
  unlock(): void
  play(track: TrackId | null): void
  update(): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  current(): TrackId | null
}

interface Voice {
  track: MusicTrack
  gain: GainNode
  step: number
  nextTime: number
}

const LOOKAHEAD = 0.25
const STEPS_PER_BAR = 16
const MASTER_LEVEL = 0.7

export function createMusic(): Music {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let volume = 0.6
  let muted = false
  let wanted: TrackId | null = null
  let playing: TrackId | null = null
  let voice: Voice | null = null

  const level = () => (muted ? 0 : volume * MASTER_LEVEL)

  const switchTo = (id: TrackId | null) => {
    if (!context || !master) return
    const now = context.currentTime
    if (voice) {
      const old = voice.gain
      old.gain.cancelScheduledValues(now)
      old.gain.setValueAtTime(old.gain.value, now)
      old.gain.linearRampToValueAtTime(0, now + MUSIC_FADE)
      window.setTimeout(() => old.disconnect(), (MUSIC_FADE + LOOKAHEAD + 0.5) * 1000)
      voice = null
    }
    playing = id
    if (!id) return
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + MUSIC_FADE)
    gain.connect(master)
    voice = { track: TRACKS[id], gain, step: 0, nextTime: now + 0.05 }
  }

  const tone = (
    out: GainNode,
    type: OscillatorType,
    midi: number,
    start: number,
    duration: number,
    peak: number,
    cutoff: number,
  ) => {
    if (!context || peak <= 0) return
    const oscillator = context.createOscillator()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.02, duration * 0.2))
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(filter).connect(gain).connect(out)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.05)
  }

  const pad = (out: GainNode, midi: number, start: number, duration: number, peak: number) => {
    if (!context || peak <= 0) return
    for (const detune of [-7, 7]) {
      const oscillator = context.createOscillator()
      const filter = context.createBiquadFilter()
      const gain = context.createGain()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
      oscillator.detune.value = detune
      filter.type = 'lowpass'
      filter.frequency.value = 900
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(peak, start + duration * 0.3)
      gain.gain.linearRampToValueAtTime(0, start + duration)
      oscillator.connect(filter).connect(gain).connect(out)
      oscillator.start(start)
      oscillator.stop(start + duration + 0.05)
    }
  }

  const kick = (out: GainNode, start: number, peak: number) => {
    if (!context || peak <= 0) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.setValueAtTime(150, start)
    oscillator.frequency.exponentialRampToValueAtTime(45, start + 0.12)
    gain.gain.setValueAtTime(peak, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    oscillator.connect(gain).connect(out)
    oscillator.start(start)
    oscillator.stop(start + 0.2)
  }

  const hiss = (
    out: GainNode,
    start: number,
    duration: number,
    peak: number,
    type: BiquadFilterType,
    frequency: number,
  ) => {
    if (!context || !noise || peak <= 0) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = noise
    filter.type = type
    filter.frequency.value = frequency
    gain.gain.setValueAtTime(peak, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter).connect(gain).connect(out)
    source.start(start)
    source.stop(start + duration + 0.02)
  }

  const scheduleStep = (current: Voice, time: number) => {
    const { track } = current
    const bars = track.chords.length
    const bar = Math.floor(current.step / STEPS_PER_BAR) % bars
    const sixteenth = current.step % STEPS_PER_BAR
    const stepSeconds = 60 / track.bpm / 4
    const chord = track.chords[bar]
    const note = (degree: number) => {
      const octave = Math.floor(degree / track.scale.length)
      const index = degree - octave * track.scale.length
      return track.scale[index] + octave * 12
    }
    const out = current.gain
    if (sixteenth === 0 && track.pad) {
      const length = stepSeconds * STEPS_PER_BAR
      for (const offset of [0, 2, 4]) pad(out, track.root + note(chord + offset), time, length, track.mix.pad)
    }
    if (sixteenth % 2 === 0) {
      const eighth = sixteenth / 2
      const bass = track.bass[eighth % track.bass.length]
      if (bass !== null && bass !== undefined) {
        tone(out, 'triangle', track.root - 12 + note(chord + bass), time, stepSeconds * 1.8, track.mix.bass, 1200)
      }
      const lead = track.lead[(bar * 8 + eighth) % track.lead.length]
      if (lead !== null && lead !== undefined) {
        tone(out, 'square', track.root + 12 + note(lead), time, stepSeconds * 1.7, track.mix.lead, 2400)
      }
    }
    if (track.drums.kick[sixteenth] === 'x') kick(out, time, track.mix.kick)
    if (track.drums.snare[sixteenth] === 'x') hiss(out, time, 0.12, track.mix.snare, 'bandpass', 1800)
    if (track.drums.hat[sixteenth] === 'x') hiss(out, time, 0.04, track.mix.hat, 'highpass', 7000)
    current.step += 1
    current.nextTime += stepSeconds
  }

  return {
    unlock() {
      if (!context) {
        const AudioContextClass = window.AudioContext
        if (!AudioContextClass) return
        context = new AudioContextClass()
        master = context.createGain()
        master.gain.value = level()
        master.connect(context.destination)
        noise = context.createBuffer(1, context.sampleRate, context.sampleRate)
        const data = noise.getChannelData(0)
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      }
      if (context.state === 'suspended') void context.resume()
    },
    play(id) {
      wanted = id
    },
    update() {
      if (!context || context.state !== 'running') return
      if (wanted !== playing) switchTo(wanted)
      if (!voice) return
      const horizon = context.currentTime + LOOKAHEAD
      if (voice.nextTime < context.currentTime) voice.nextTime = context.currentTime + 0.02
      while (voice.nextTime < horizon) scheduleStep(voice, voice.nextTime)
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, next))
      if (master) master.gain.value = level()
    },
    setMuted(next) {
      muted = next
      if (master) master.gain.value = level()
    },
    current: () => playing,
  }
}
