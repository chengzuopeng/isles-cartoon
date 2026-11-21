export type AlarmTuning = {
  pull: number
  runScale: number
  arrive: number
  reinforceWarning: number
  wheatSpeed: number
}

export const ALARM: AlarmTuning = {
  pull: 1,
  runScale: 1.15,
  arrive: 0.45,
  reinforceWarning: 1.2,
  wheatSpeed: 0.82,
}
