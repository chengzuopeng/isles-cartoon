export type AutopilotSkillId = 'perfect' | 'human' | 'novice'

export type AutopilotSkill = {
  name: string
  reaction: number
  aimError: number
  aimHold: number
  dodgeChance: number
  bladeMisread: number
  jumpError: number
}

export const AUTOPILOT_SKILL_ORDER: readonly AutopilotSkillId[] = ['perfect', 'human', 'novice']

export const AUTOPILOT_SKILLS: Readonly<Record<AutopilotSkillId, AutopilotSkill>> = {
  perfect: { name: '完美', reaction: 0, aimError: 0, aimHold: 0, dodgeChance: 1, bladeMisread: 0, jumpError: 0 },
  human: { name: '普通玩家', reaction: 0.25, aimError: 7, aimHold: 0.3, dodgeChance: 0.85, bladeMisread: 0.1, jumpError: 0.1 },
  novice: { name: '新手', reaction: 0.4, aimError: 14, aimHold: 0.3, dodgeChance: 0.65, bladeMisread: 0.3, jumpError: 0.2 },
}

export const AUTOPILOT = {
  engageRange: 14.4,
  keepMin: 5.1,
  keepMax: 9.6,
  replanSteps: 30,
  dodgeMargin: 0.5,
  lootRange: 12.8,
  chestRange: 32,
  lootStick: 1.5,
  healBelow: 0.75,
  supplyBelow: 0.6,
  ammoBelow: 0.5,
  barrierBelow: 0.8,
  crowdRange: 11.2,
  ultimateRange: 16,
  urgentSeconds: 0.3,
  flankRange: 4.2,
  lobWarning: 0.9,
  bulletWarning: 4.8,
  baitGap: 0.9,
  behindGap: 2.8,
  stunGap: 2.4,
  kiteGap: 3.6,
  siegeSeconds: 6,
  siegeRing: 2.4,
  siegeProbe: 0.8,
  lampRange: 9.6,
  mineMargin: 0.3,
  mineLook: 1.9,
  mineShotMin: 2.2,
  mineShotMax: 9.6,
  mineAimHeight: 0.4,
  laneReach: 4,
  laneMargin: 0.15,
  mineWallProbe: 0.6,
  mineDetourStick: 2,
  bladeMargin: 0.15,
  bladeLead: 0.35,
  bladeSlack: 0.25,
  bladeStop: 0.3,
  bladeForget: 1.5,
  bladeHold: 1.2,
  bladeHorizon: 3,
  bladePreview: 40,
  bladeReachAhead: 9.6,
  bladeSample: 0.25,
  bladeStep: 0.04,
  bladeSlide: 0.2,
  bladeExitPace: 6,
  kiteSlim: 0.75,
  kiteRoom: 4.8,
  kiteTurns: [Math.PI / 6, Math.PI / 3, Math.PI / 2, (Math.PI * 2) / 3],
  kiteTurnCost: 0.3,
  dodgeRoom: 2.2,
  barrierThreat: 9.6,
  bulletUrgent: 1.9,
  bulletMargin: 0.3,
  chargeOvershoot: 3,
  hiddenPenalty: 9.6,
  calmPenalty: 4.8,
  guardedPenalty: 8,
  baitTooFar: 12,
  meleeMargin: 0.2,
  chestShare: 0.6,
  targetAimHeight: 1,
  jumpMargin: 0.05,
  jumpCost: 3,
  jumpLead: 0.3,
  ledgeProbe: 0.3,
  perchedArrive: 0.15,
  ledgeTurns: [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (Math.PI * 3) / 4, (-Math.PI * 3) / 4],
  safeReplan: 120,
  ringNotice: 1.5,
  ringSlowest: 0.5,
  smashRange: 4.5,
  snackRange: 4.8,
  smashBelow: 0.9,
} as const

export const AUTOPILOT_SIEGE_LEVELS: readonly string[] = ['1-3', '1-5']

export const AUTOPILOT_ONWARD_LEVELS: readonly string[] = ['1-5']

export const AUTOPILOT_KITE_LEVELS: readonly string[] = ['1-5']
