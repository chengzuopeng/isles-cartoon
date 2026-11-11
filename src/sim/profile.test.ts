import { describe, expect, it } from 'vitest'
import { CLUES } from '../data/clues'
import { LEVEL_1_1 } from '../data/levels/level-1-1'
import { LEVEL_1_2 } from '../data/levels/level-1-2'
import { LEVEL_1_3 } from '../data/levels/level-1-3'
import { LEVEL_1_4 } from '../data/levels/level-1-4'
import { LEVEL_1_5 } from '../data/levels/level-1-5'
import { KILL_XP, LEVEL_CAP } from '../data/progression'
import { createDefaultTuning } from '../data/tuning'
import { killEnemy } from './combat'
import {
  PROFILE_VERSION,
  allocate,
  allocationBlock,
  clueBook,
  computeReward,
  createProfile,
  equipSkill,
  grantXp,
  keepClues,
  learnSkill,
  levelUnlocked,
  loadoutOf,
  markInterlude,
  pendingInterlude,
  refund,
  resetSkills,
  respec,
  runXp,
  sanitizeProfile,
  seenInterludes,
  settleRun,
  skillBlock,
  skillPointsLeft,
  slotUnlocked,
  totalXpAt,
  xpScaleFor,
  xpToNext,
} from './profile'
import { rateRun } from './rating'
import { singleArea } from './testing'
import { createEnemy, createWorld } from './world'

const ROWS = ['#########', '#P......#', '#########']

function finishedWorld(xpScale = 1, chapter = 1) {
  const world = createWorld(singleArea(ROWS, 'normal', { chapter }), createDefaultTuning(), { xpScale })
  world.status = 'complete'
  return world
}

describe('experience curve', () => {
  it('needs 200 plus 100 per level to reach the next level', () => {
    expect(xpToNext(1)).toBe(200)
    expect(xpToNext(10)).toBe(1100)
    expect(xpToNext(29)).toBe(3000)
    expect(totalXpAt(3, 50)).toBe(550)
  })

  it('levels up several times from one reward and grants a point per level', () => {
    const profile = createProfile()
    expect(grantXp(profile, 550)).toBe(2)
    expect(profile).toMatchObject({ level: 3, xp: 50, points: 2 })
  })

  it('stops at the level cap', () => {
    const profile = createProfile()
    grantXp(profile, 10_000_000)
    expect(profile.level).toBe(LEVEL_CAP)
    expect(profile.xp).toBe(0)
    expect(profile.points).toBe(LEVEL_CAP - 1)
    expect(grantXp(profile, 5000)).toBe(0)
  })
})

describe('specialisation points', () => {
  it('spends points until the tree is full at rank ten', () => {
    const profile = createProfile()
    profile.points = 12
    for (let i = 0; i < 10; i++) expect(allocate(profile, 'brawl')).toBe(true)
    expect(allocationBlock(profile, 'brawl')).toBe('maxed')
    expect(allocate(profile, 'brawl')).toBe(false)
    expect(profile.points).toBe(2)
  })

  it('refuses to spend points the hero does not have', () => {
    const profile = createProfile()
    expect(allocationBlock(profile, 'gun')).toBe('noPoints')
    expect(allocate(profile, 'gun')).toBe(false)
  })

  it('takes a single rank back with a refund', () => {
    const profile = createProfile()
    profile.points = 2
    allocate(profile, 'move')
    allocate(profile, 'move')
    expect(refund(profile, 'move')).toBe(true)
    expect(profile.specs.move).toBe(1)
    expect(profile.points).toBe(1)
    expect(refund(profile, 'energy')).toBe(false)
  })

  it('gives every point back for free on respec', () => {
    const profile = createProfile()
    profile.points = 4
    allocate(profile, 'move')
    allocate(profile, 'gun')
    allocate(profile, 'gun')
    respec(profile)
    expect(profile.points).toBe(4)
    expect(profile.specs.gun).toBe(0)
    expect(profile.specs.move).toBe(0)
  })
})

describe('skills', () => {
  it('starts with the concussion grenade on Q without spending an earned point', () => {
    const profile = createProfile()
    expect(profile.skills).toEqual({ concussion: 1 })
    expect(profile.equipped).toEqual({ q: 'concussion', e: null })
    expect(skillPointsLeft(profile)).toBe(0)
    expect(loadoutOf(profile).skills).toEqual([{ slot: 'q', id: 'concussion', rank: 1 }])
  })

  it('earns a skill point every two levels', () => {
    const profile = createProfile()
    profile.level = 2
    expect(skillPointsLeft(profile)).toBe(1)
    profile.level = 8
    expect(skillPointsLeft(profile)).toBe(4)
  })

  it('learns, upgrades and equips skills into unlocked slots', () => {
    const profile = createProfile()
    profile.level = 3
    expect(learnSkill(profile, 'shockwave')).toBe(true)
    expect(profile.equipped).toEqual({ q: 'concussion', e: null })
    expect(learnSkill(profile, 'barrier')).toBe(false)
    expect(equipSkill(profile, 'shockwave', 'e')).toBe(false)
    expect(equipSkill(profile, 'shockwave', 'q')).toBe(true)
    expect(profile.equipped).toEqual({ q: 'shockwave', e: null })
  })

  it('opens the E slot at level 4 and fills it with a learned skill', () => {
    const profile = createProfile()
    profile.level = 3
    learnSkill(profile, 'shockwave')
    equipSkill(profile, 'shockwave', 'q')
    expect(slotUnlocked(profile, 'e')).toBe(false)
    grantXp(profile, xpToNext(profile.level))
    expect(profile.level).toBe(4)
    expect(slotUnlocked(profile, 'e')).toBe(true)
    expect(profile.equipped).toEqual({ q: 'shockwave', e: 'concussion' })
    expect(learnSkill(profile, 'concussion')).toBe(true)
    expect(loadoutOf(profile).skills).toEqual([
      { slot: 'q', id: 'shockwave', rank: 1 },
      { slot: 'e', id: 'concussion', rank: 2 },
    ])
  })

  it('caps every skill at rank three', () => {
    const profile = createProfile()
    profile.level = 30
    for (let i = 0; i < 3; i++) learnSkill(profile, 'barrier')
    expect(skillBlock(profile, 'barrier')).toBe('maxed')
    expect(learnSkill(profile, 'barrier')).toBe(false)
  })

  it('resets skills for free, the starting point included', () => {
    const profile = createProfile()
    profile.level = 4
    learnSkill(profile, 'concussion')
    learnSkill(profile, 'barrier')
    resetSkills(profile)
    expect(skillPointsLeft(profile)).toBe(3)
    expect(profile.equipped).toEqual({ q: null, e: null })
  })

  it('drops skills a save cannot afford, ignores unknown ones and hands back the starting grenade', () => {
    const profile = sanitizeProfile({ level: 3, skills: { concussion: 3, fly: 2 }, equipped: { q: 'concussion', e: 'fly' } })
    expect(profile.skills).toEqual({ concussion: 1 })
    expect(profile.equipped).toEqual({ q: 'concussion', e: null })
    const fine = sanitizeProfile({ level: 6, skills: { concussion: 1 }, equipped: { q: 'concussion', e: 'concussion' } })
    expect(fine.equipped).toEqual({ q: 'concussion', e: null })
  })

  it('gives old saves without any skill the starting grenade and fills open slots', () => {
    const empty = sanitizeProfile({ level: 2, skills: {}, equipped: { q: null, e: null } })
    expect(empty.skills).toEqual({ concussion: 1 })
    expect(empty.equipped).toEqual({ q: 'concussion', e: null })
    const two = sanitizeProfile({ level: 9, skills: { barrier: 1, shockwave: 2 }, equipped: { q: 'barrier', e: null } })
    expect(two.equipped).toEqual({ q: 'barrier', e: 'shockwave' })
  })
})

describe('saved profiles', () => {
  it('starts fresh from missing or broken data', () => {
    expect(sanitizeProfile(null)).toEqual(createProfile())
    expect(sanitizeProfile('nope')).toEqual(createProfile())
    expect(sanitizeProfile([1, 2])).toEqual(createProfile())
  })

  it('clamps values and recomputes points from the level', () => {
    const profile = sanitizeProfile({
      level: 4,
      xp: 99_999,
      points: 50,
      specs: { brawl: 2, move: 99, bogus: 3 },
      records: { '1-1': { cleared: true, bestStars: 7, bestTime: 300, clears: 2 } },
    })
    expect(profile.level).toBe(4)
    expect(profile.xp).toBe(xpToNext(4) - 1)
    expect(profile.specs.brawl).toBe(0)
    expect(profile.points).toBe(3)
    expect(profile.records['1-1']).toEqual({ cleared: true, bestStars: 3, bestTime: 300, clears: 2, challenges: [] })
  })

  it('keeps a consistent allocation', () => {
    const profile = sanitizeProfile({ level: 5, specs: { brawl: 2, gun: 1 } })
    expect(profile.specs.brawl).toBe(2)
    expect(profile.points).toBe(1)
  })

  it('hands every point back to a save from before the specialisations', () => {
    const profile = sanitizeProfile({ version: 2, level: 6, attributes: { health: 3, damage: 2 } })
    expect(profile.specs).toEqual({ gun: 0, brawl: 0, move: 0, energy: 0 })
    expect(profile.points).toBe(5)
  })

  it('upgrades a version 1 save that has no clue book yet', () => {
    const old = { version: 1, level: 2, xp: 120, attributes: { health: 1 }, records: { '1-1': { cleared: true, bestStars: 2, bestTime: 80, clears: 1 } } }
    const profile = sanitizeProfile(old)
    expect(profile.version).toBe(PROFILE_VERSION)
    expect(PROFILE_VERSION).toBe(3)
    expect(profile.clues).toEqual([])
    expect(profile).toMatchObject({ level: 2, xp: 120, points: 1 })
    expect(profile.records['1-1'].cleared).toBe(true)
  })

  it('keeps known clues once each, in book order, and drops anything else', () => {
    const profile = sanitizeProfile({ level: 1, clues: ['iou', 'crayon', 3, 'star-altar', 'iou'] })
    expect(profile.clues).toEqual(['star-altar', 'iou'])
    expect(sanitizeProfile({ level: 1, clues: 'iou' }).clues).toEqual([])
  })

  it('keeps the interludes already seen once each and drops unknown ones', () => {
    expect(sanitizeProfile({ level: 1 }).interludes).toEqual([])
    expect(sanitizeProfile({ level: 1, interludes: ['interlude-9', 4, 'interlude-1', 'interlude-1'] }).interludes).toEqual(['interlude-1'])
    expect(sanitizeProfile({ level: 1, interludes: 'interlude-1' }).interludes).toEqual([])
  })
})

describe('interludes', () => {
  it('holds interlude 1 back until 1-5 is cleared, then plays it once and lists it for watching again', () => {
    const profile = createProfile()
    expect(profile.interludes).toEqual([])
    profile.records['1-4'] = { cleared: true, bestStars: 2, bestTime: 400, clears: 1 }
    expect(pendingInterlude(profile)).toBeNull()
    profile.records['1-5'] = { cleared: true, bestStars: 1, bestTime: 700, clears: 1 }
    expect(pendingInterlude(profile)?.id).toBe('interlude-1')
    expect(seenInterludes(profile, 1)).toEqual([])
    expect(markInterlude(profile, 'interlude-1')).toBe(true)
    expect(markInterlude(profile, 'interlude-1')).toBe(false)
    expect(markInterlude(profile, 'interlude-9')).toBe(false)
    expect(profile.interludes).toEqual(['interlude-1'])
    expect(pendingInterlude(profile)).toBeNull()
    expect(seenInterludes(profile, 1).map((item) => item.title)).toEqual(['初到星穹塔'])
    expect(seenInterludes(profile, 2)).toEqual([])
  })
})

describe('clue book', () => {
  it('lists the chapter clues and hides the ones not found yet', () => {
    const profile = createProfile()
    profile.clues = ['iou']
    expect(clueBook(profile, 1)).toEqual([
      { id: 'star-altar', level: '1-1', found: false, title: '？？？', text: '' },
      { id: 'iou', level: '1-2', found: true, title: CLUES.iou.title, text: CLUES.iou.text },
      { id: 'manifest', level: '1-3', found: false, title: '？？？', text: '' },
      { id: 'drawing', level: '1-4', found: false, title: '？？？', text: '' },
      { id: 'anchor-crate', level: '1-5', found: false, title: '？？？', text: '' },
    ])
    expect(clueBook(profile, 2)).toEqual([])
  })

  it('keeps the clues picked up in a run, once', () => {
    const profile = createProfile()
    const world = finishedWorld()
    world.cluesFound = ['iou']
    expect(keepClues(profile, world)).toEqual(['iou'])
    expect(keepClues(profile, world)).toEqual([])
    world.cluesFound = ['iou', 'star-altar']
    expect(keepClues(profile, world)).toEqual(['star-altar'])
    expect(profile.clues).toEqual(['star-altar', 'iou'])
  })

  it('reports new clues when settling a cleared run', () => {
    const profile = createProfile()
    const world = finishedWorld()
    world.cluesFound = ['star-altar']
    expect(settleRun(profile, world, rateRun(world)).newClues).toEqual(['star-altar'])
    expect(profile.clues).toEqual(['star-altar'])
  })
})

describe('unlocking levels', () => {
  it('opens 1-2 after 1-1 is cleared, and always in development', () => {
    const profile = createProfile()
    expect(levelUnlocked(profile, LEVEL_1_1)).toBe(true)
    expect(levelUnlocked(profile, LEVEL_1_2)).toBe(false)
    expect(levelUnlocked(profile, LEVEL_1_2, true)).toBe(true)
    profile.records['1-1'] = { cleared: false, bestStars: 0, bestTime: 0, clears: 0 }
    expect(levelUnlocked(profile, LEVEL_1_2)).toBe(false)
    profile.records['1-1'] = { cleared: true, bestStars: 1, bestTime: 400, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_2)).toBe(true)
  })

  it('opens 1-3 after 1-2 is cleared', () => {
    const profile = createProfile()
    profile.records['1-1'] = { cleared: true, bestStars: 3, bestTime: 90, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_3)).toBe(false)
    expect(levelUnlocked(profile, LEVEL_1_3, true)).toBe(true)
    profile.records['1-2'] = { cleared: true, bestStars: 2, bestTime: 300, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_3)).toBe(true)
  })

  it('opens 1-4 after 1-3 is cleared', () => {
    const profile = createProfile()
    profile.records['1-2'] = { cleared: true, bestStars: 3, bestTime: 110, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_4)).toBe(false)
    expect(levelUnlocked(profile, LEVEL_1_4, true)).toBe(true)
    profile.records['1-3'] = { cleared: true, bestStars: 2, bestTime: 300, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_4)).toBe(true)
  })

  it('opens 1-5 after 1-4 is cleared', () => {
    const profile = createProfile()
    profile.records['1-3'] = { cleared: true, bestStars: 3, bestTime: 150, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_5)).toBe(false)
    expect(levelUnlocked(profile, LEVEL_1_5, true)).toBe(true)
    profile.records['1-4'] = { cleared: true, bestStars: 2, bestTime: 400, clears: 1 }
    expect(levelUnlocked(profile, LEVEL_1_5)).toBe(true)
  })
})

describe('run rewards', () => {
  it('counts kill experience times the chapter number', () => {
    const world = createWorld(singleArea(ROWS, 'normal', { chapter: 2 }), createDefaultTuning())
    const enemy = createEnemy(world, 'gunner', { x: 4.5, y: 1.5 }, 0)
    world.enemies.push(enemy)
    killEnemy(world, enemy, true)
    expect(world.rewards.kills).toBe(KILL_XP.gunner * 2)
  })

  it('pays kills, the boss, the clear and the first three stars', () => {
    const world = finishedWorld()
    world.rewards.kills = 120
    world.rewards.boss = 80
    const profile = createProfile()
    const settlement = settleRun(profile, world, rateRun(world))
    expect(settlement.reward.lines.map((line) => line.label)).toEqual(['击败敌人', '击败 Boss', '通关', '首次三星', '挑战「无伤」'])
    expect(settlement.reward.total).toBe(380)
    expect(settlement.levelsGained).toBe(1)
    expect(settlement.firstClear).toBe(true)
    expect(profile).toMatchObject({ level: 2, xp: 180, points: 1 })
    expect(profile.records.test).toMatchObject({ cleared: true, bestStars: 3, clears: 1, challenges: ['flawless'] })
  })

  it('halves replays and pays the three-star bonus only once', () => {
    const profile = createProfile()
    profile.records.test = { cleared: true, bestStars: 3, bestTime: 100, clears: 1, challenges: ['flawless'] }
    const world = finishedWorld(xpScaleFor(profile, 'test'))
    world.rewards.kills = 120
    const reward = computeReward(world, rateRun(world), profile.records.test)
    expect(reward.replay).toBe(true)
    expect(reward.total).toBe(60 + 50)
  })

  it('pays for broken targets on their own line', () => {
    const world = finishedWorld()
    world.rewards.kills = 40
    world.rewards.targets = 45
    expect(runXp(world)).toBe(85)
    const reward = computeReward(world, rateRun(world), undefined)
    expect(reward.lines.slice(0, 2)).toEqual([
      { label: '击败敌人', amount: 40 },
      { label: '破坏目标', amount: 45 },
    ])
  })

  it('pays each challenge once and keeps the ones already done', () => {
    const profile = createProfile()
    const clean = finishedWorld()
    const first = settleRun(profile, clean, rateRun(clean))
    expect(first.reward.lines).toContainEqual({ label: '挑战「无伤」', amount: 30 })
    const hit = finishedWorld()
    hit.stats.hits = 2
    const second = settleRun(profile, hit, rateRun(hit))
    expect(second.reward.lines.some((line) => line.label.startsWith('挑战'))).toBe(false)
    expect(profile.records.test.challenges).toEqual(['flawless'])
  })

  it('pays nothing for a run that ends in death', () => {
    const world = finishedWorld()
    world.status = 'dead'
    world.rewards.kills = 200
    expect(computeReward(world, rateRun(world), undefined).total).toBe(0)
  })
})

describe('saves from before the dash took over the roll', () => {
  it('turns a learned and equipped roll into the concussion grenade', () => {
    const profile = sanitizeProfile({ level: 6, skills: { roll: 2 }, equipped: { q: 'roll', e: null } })
    expect(profile.skills).toEqual({ concussion: 2 })
    expect(profile.equipped.q).toBe('concussion')
  })
})
