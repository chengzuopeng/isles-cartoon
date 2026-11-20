import { expect, test, type Page } from '@playwright/test'

async function open(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.location().url.endsWith('/favicon.ico')) return
    errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/')
  await page.waitForFunction(() => window.__game?.screen === 'prep')
  await page.waitForLoadState('networkidle')
  return errors
}

async function play(page: Page, level: string): Promise<void> {
  await page.evaluate(async (id) => {
    const pending = window.__game?.startLevel(id)
    window.__game?.skipDialogue()
    await pending
    window.__game?.skipDialogue()
  }, level)
  await page.waitForFunction((id) => window.__game?.screen === 'play' && window.__game.level === id, level)
}

test('the prep screen lists the missions and marks the levels the first-person version has not redone', async ({ page }) => {
  const errors = await open(page)
  await expect(page.locator('.prep-mission-title')).toHaveText([
    '1-1 出发 · 晨风镇郊外',
    '1-2 牧场 · 老汤的牧场',
    '1-3 废弃农庄 · 军团的粮仓',
    '1-4 林间小道 · 雾林里的信号',
    '1-5 收割场 · 麦田尽头的工厂',
    '试炼 · 混编部队 · 六种敌人和精英一次见齐',
    '试炼 · 巨型收割机 · 第 1 章大 Boss',
  ])
  await expect(page.locator('.prep-mission').nth(0).locator('.prep-mission-wip')).toHaveCount(0)
  await expect(page.locator('.prep-mission').nth(1).locator('.prep-mission-wip')).toContainText('待试玩校准')
  await expect(page.locator('.prep-mission').nth(2).locator('.prep-mission-wip')).toContainText('第一人称版还没做')
  await expect(page).toHaveScreenshot('prep.png')
  expect(errors).toEqual([])
})

test('settings carry the view options and key bindings, and a rebound key survives a reload', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.prep-settings').click()
  const panel = page.locator('.settings-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.settings-row', { hasText: '视野角' })).toBeVisible()
  await expect(panel.locator('.settings-row', { hasText: '眼睛高度' })).toBeVisible()
  const binds = panel.locator('.settings-bind')
  await expect(binds).toHaveCount(15)
  await binds.nth(4).click()
  await expect(binds.nth(4)).toHaveText('按下新按键…')
  await page.keyboard.press('KeyF')
  await expect(binds.nth(4)).toHaveText('F')
  await expect(binds.nth(6)).toHaveText('空格')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await page.reload()
  await page.waitForFunction(() => window.__game?.screen === 'prep')
  await page.locator('.prep-settings').click()
  await expect(binds.nth(4)).toHaveText('F')
  await panel.getByRole('button', { name: '按键恢复默认' }).click()
  await expect(binds.nth(4)).toHaveText('空格')
  expect(errors).toEqual([])
})

test('the pasture shows Lao Tang, anchors visible dialogue and reaches its results', async ({ page }) => {
  const errors = await open(page)
  await page.evaluate(() => window.__game!.startLevel('1-2'))
  await expect(page.locator('.dialogue-text')).toHaveText('它们把干草和麦子都装车了！')
  await page.waitForFunction(() => window.__game!.scene.getObjectByName('story-actor-laoTang-0')?.visible)

  await page.evaluate(async () => {
    const game = window.__game!
    game.skipDialogue()
    game.freeze(true)
    game.debug.invincible = true
    game.teleport(2)
    game.advance(0.05)
    const actor = game.world.level.actors.find((item) => item.area === 2)!
    const { x, y } = game.world.player.pos
    game.look(Math.atan2(y - actor.y, x - actor.x), 0)
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    game.breakTargets(2)
    game.advance(0.05)
  })
  await expect(page.locator('.bark-bar.visible .bark-text')).toHaveText('钱箱就在那儿，碰都没碰。')

  await page.evaluate(async () => {
    const game = window.__game!
    const { grid, player, level } = game.world
    const wreck = level.landmarks.find((item) => item.id === 'grunt-wreck')!
    const actor = level.actors.find((item) => item.area === wreck.area)!
    const x = wreck.column + wreck.width + 2.5
    const y = wreck.row + 0.5
    const floor = grid.floor[Math.floor(y) * grid.columns + Math.floor(x)]
    Object.assign(player, { pos: { x, y }, prev: { x, y }, z: floor, prevZ: floor })
    game.look(Math.atan2(actor.y - y, actor.x - x), 0)
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    game.advance(0.05)
  })
  await expect(page.locator('.bark-bubble.actor')).toContainText('二十年前镇上买的耕地机')

  const result = await page.evaluate(() => {
    const game = window.__game!
    game.restart()
    game.setAutopilot(true, 'perfect')
    game.advance(540)
    game.setAutopilot(false)
    return game.world.status
  })
  expect(result).toBe('complete')
  await expect(page.locator('.dialogue-text')).toContainText('谷仓塌了一半')
  await page.evaluate(() => window.__game!.skipDialogue())
  await expect(page.locator('.results-screen .screen-button', { hasText: '下一关' })).toContainText('1-3')
  expect(errors).toEqual([])
})

test('1-1 plays in first person: the hero shoots a charger, walks into the barn and clears the boss into the results', async ({ page }) => {
  const errors = await open(page)
  await play(page, '1-1')
  const shot = await page.evaluate(() => {
    const game = window.__game!
    game.debug.invincible = true
    const world = game.world
    const target = world.enemies.find((enemy) => enemy.area === 0 && enemy.idleMode === 'patrol')!
    const player = world.player
    player.pos.x = target.pos.x + 6
    player.pos.y = target.pos.y
    player.prev.x = player.pos.x
    player.prev.y = player.pos.y
    const before = target.hp
    const pitch = Math.atan2(target.z + 0.7 - (player.z + 1.5), 6)
    game.act({ fire: true, aimX: target.pos.x, aimY: target.pos.y, pitch }, 1.2)
    return { before, after: target.hp }
  })
  expect(shot.after).toBeLessThan(shot.before)
  const barn = await page.evaluate(() => {
    const game = window.__game!
    const world = game.world
    const placement = world.level.landmarks.find((item) => item.id === 'ch1-barn')!
    const player = world.player
    player.pos.x = placement.column + 3.5
    player.pos.y = placement.row + placement.depth + 1.5
    player.prev.x = player.pos.x
    player.prev.y = player.pos.y
    game.act({ moveX: 0, moveY: -1 }, 1.6)
    return { y: player.pos.y, inside: player.pos.y < placement.row + placement.depth - 1, top: placement.row }
  })
  expect(barn.inside).toBe(true)
  const finale = await page.evaluate(() => {
    const game = window.__game!
    game.teleportToBoss()
    game.act({ moveX: 0, moveY: -1 }, 2)
    const world = game.world
    const boss = world.boss!
    for (let tries = 0; tries < 40 && boss.hp > 0; tries++) {
      boss.hp = Math.min(boss.hp, 1)
      const player = world.player
      const distance = Math.hypot(boss.pos.x - player.pos.x, boss.pos.y - player.pos.y)
      const pitch = Math.atan2(boss.z + 2 - (player.z + 1.5), distance)
      game.act({ fire: true, aimX: boss.pos.x, aimY: boss.pos.y, pitch }, 0.25)
    }
    game.advance(3)
    const exit = world.level.exits[0]
    const player = world.player
    player.pos.x = (exit % world.grid.columns) + 0.5
    player.pos.y = Math.floor(exit / world.grid.columns) + 0.5
    player.prev.x = player.pos.x
    player.prev.y = player.pos.y
    game.advance(0.5)
    return { bossHp: boss.hp, status: world.status }
  })
  expect(finale.bossHp).toBeLessThanOrEqual(0)
  await page.waitForFunction(() => window.__game?.world.status === 'complete', null, { timeout: 30_000 })
  await page.evaluate(() => window.__game?.skipDialogue())
  await expect(page.locator('.results-screen')).toBeVisible()
  await expect(page.locator('.results-screen .screen-button', { hasText: '下一关' })).toContainText('1-2')
  expect(errors).toEqual([])
})

test('switching levels unloads the models of levels left behind and keeps one', async ({ page }) => {
  const errors = await open(page)
  await play(page, '1-1')
  const first = await page.evaluate(() => window.__game!.models.slice())
  await play(page, '1-2')
  await play(page, '1-3')
  const third = await page.evaluate(() => window.__game!.models.slice())
  expect(third).not.toContain('ch1-windmill')
  expect(first).toContain('ch1-windmill')
  expect(third).toContain('ch1-sheep-pen')
  expect(errors).toEqual([])
})
