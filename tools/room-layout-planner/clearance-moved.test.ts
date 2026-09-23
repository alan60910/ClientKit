/**
 * T3.4a — 拖移期增量 `clearanceForMoved()` 的等價回歸網
 * （(internal design doc) §D10「處置（OQ4 定案）」落 (b) 即
 * 啟用備案 `clearanceForMoved`（cache 含候選全集、每筆 `occluderCount`、
 * 每面配對間距表；**S6 斷言含 suppressed**）、§D4 候選／遮擋／門洞／同牆面
 * 合併／`maxGap` 兩路徑、§Verification「S6 等價 property test」）。
 *
 * 全檔只釘**一條**契約：`clearanceForMoved(cache, plan, id).report` 與
 * `clearance(plan, cache.opts)` 逐字相同。增量路徑若在任何一個分支上抄近路
 * 抄錯了，這裡就會紅——兩條路徑的輸出必須是同一份，不是「差不多」。
 *
 * 亂數案以 mulberry32 固定種子（移植自 `sp1/fixtures.mjs`）：失敗可重現，
 * 不會是 flake。省下多少工作量一律以**決定性的記帳**（`pairsRecomputed`／
 * `corridorsReused`）斷言，不用計時——計時在 CI 上必然是 flake 來源，
 * 單幀預算由 e2e（T4.5）在真瀏覽器量。
 */
import { describe, expect, it } from 'vitest'
import { clearance, clearanceForMoved, clearanceWithCache } from './clearance.js'
import {
  DEFAULT_SETTINGS,
  type ClearanceReport,
  type Collision,
  type Corridor,
  type Door,
  type DoorViolation,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type SideViolation,
} from './model.js'

/* ------------------------------------------------------------------ *
 * 測試工具
 * ------------------------------------------------------------------ */

/** mulberry32（移植自 `sp1/fixtures.mjs`）：32-bit 種子、無相依、可重現。 */
function makePrng(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 閉區間整數亂數。 */
function randInt(rnd: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rnd() * (hi - lo + 1))
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 報告的正規序。兩條路徑的輸出**本來就**該逐字相同（`clearance.ts` 的
 * 排序是決定性的），這層正規化只是讓失敗訊息指得準：先排序再 deepEqual，
 * 紅的時候看到的是「哪一筆不一樣」而不是「整包順序位移」。
 */
function canonical(report: ClearanceReport): ClearanceReport {
  const corridorKey = (c: Corridor): string =>
    `${c.a}|${c.b}|${c.axis}|${c.gap}|${c.rect.x0}|${c.rect.y0}|${c.rect.x1}|${c.rect.y1}|${c.segIndex}|${c.kind}|${c.level}`
  return {
    corridors: [...report.corridors].sort((p, q) => cmpStr(corridorKey(p), corridorKey(q))),
    collisions: [...report.collisions].sort((p: Collision, q: Collision) =>
      cmpStr(`${p.a}|${p.b}|${p.rect.x0}|${p.rect.y0}`, `${q.a}|${q.b}|${q.rect.x0}|${q.rect.y0}`),
    ),
    sideViolations: [...report.sideViolations].sort((p: SideViolation, q: SideViolation) =>
      cmpStr(`${p.id}|${p.side}|${p.against}`, `${q.id}|${q.side}|${q.against}`),
    ),
    doorViolations: [...report.doorViolations].sort((p: DoorViolation, q: DoorViolation) =>
      cmpStr(`${p.doorId}|${p.itemId}`, `${q.doorId}|${q.itemId}`),
    ),
    unattachedDoors: [...report.unattachedDoors].sort(cmpStr),
    unconnectedBlocks: [...report.unconnectedBlocks].sort(cmpStr),
  }
}

/**
 * 移動一件家具。**保留 `plan.room` 與其餘家具的物件參考**——這正是
 * `reducer.apply()` 的結構共享硬契約（「只改一件家具時 `plan.room` 參考
 * 不變」），也是 `clearanceForMoved()` 走增量路徑的前提。
 */
function movePlan(plan: RoomPlan, id: string, x: number, y: number): RoomPlan {
  return {
    ...plan,
    items: plan.items.map((item) => (item.id === id ? { ...item, x, y } : item)),
  }
}

const ROOM_W = 600
const ROOM_D = 800

/**
 * 隨機平面圖：600×800 基底、0–3 個方塊（extend／cutout，含會落在
 * `unconnectedBlocks` 的懸空 extend）、1–2 扇門、5–40 件家具（其中約 1/4
 * `passable:false` → S6 要求的 `suppressed` 覆蓋，約 1/3 帶 `clearances`
 * → `sideViolations` 覆蓋，約 1/3 貼著外牆）。
 */
function randomPlan(rnd: () => number): RoomPlan {
  const blocks: RoomBlock[] = []
  const blockCount = randInt(rnd, 0, 3)
  for (let i = 0; i < blockCount; i++) {
    const kind: RoomBlock['kind'] = rnd() < 0.5 ? 'extend' : 'cutout'
    const width = randInt(rnd, 20, 140)
    const depth = randInt(rnd, 20, 140)
    blocks.push({
      id: `b${i}`,
      kind,
      // extend 貼在東邊外側（多半可連通），cutout 落在房內任意處。
      x: kind === 'extend' ? ROOM_W : randInt(rnd, 0, ROOM_W - width),
      y: randInt(rnd, 0, ROOM_D - depth),
      width,
      depth,
    })
  }

  const doors: Door[] = []
  const doorCount = randInt(rnd, 1, 2)
  for (let i = 0; i < doorCount; i++) {
    const width = randInt(rnd, 70, 100)
    if (rnd() < 0.5) {
      // N 牆：鉸鏈 y=0，跨距沿 x ＝ `[x, x+width]`（D6 表，`leafDir:'+'`）。
      doors.push({
        id: `d${i}`,
        x: randInt(rnd, width + 150, ROOM_W - width),
        y: 0,
        wall: 'N',
        leafDir: '+',
        width,
        swing: 'in',
      })
    } else {
      // W 牆：鉸鏈 x=0，跨距沿 y ＝ `[y-width, y]`（`leafDir:'-'`）。
      doors.push({
        id: `d${i}`,
        x: 0,
        y: randInt(rnd, width + 150, ROOM_D - width),
        wall: 'W',
        leafDir: '-',
        width,
        swing: 'in',
      })
    }
  }

  const items: Furniture[] = []
  // 門兩側各擺一件貼牆家具，讓它們之間的母通道**恰好**等於門扇跨距——
  // D4 門洞三條件 (a)(b)(c) 全中，隨機案才真的涵蓋 `kind:'doorway'`
  // （純亂數幾乎撞不到「間距區間 ⊆ 門扇跨距」這個條件）。
  const front = doors[0]
  for (const flank of [0, 1]) {
    const size = randInt(rnd, 30, 60)
    const thickness = randInt(rnd, 30, 70)
    items.push({
      id: `f${flank}`,
      name: `門側${flank}`,
      color: '#336699',
      width: front.wall === 'N' ? size : thickness,
      depth: front.wall === 'N' ? thickness : size,
      x: front.wall === 'N' ? (flank === 0 ? front.x - size : front.x + front.width) : 0,
      y: front.wall === 'N' ? 0 : flank === 0 ? front.y - front.width - size : front.y,
      rotation: 0,
      passable: true,
    })
  }

  const itemCount = randInt(rnd, 5, 40)
  for (let i = 0; i < itemCount; i++) {
    const width = randInt(rnd, 30, 180)
    const depth = randInt(rnd, 30, 120)
    const roll = rnd()
    const item: Furniture = {
      id: `i${i}`,
      name: `家具${i}`,
      color: '#336699',
      width,
      depth,
      x: randInt(rnd, 0, ROOM_W - 30),
      y: randInt(rnd, 0, ROOM_D - 30),
      rotation: ([0, 90, 180, 270] as const)[randInt(rnd, 0, 3)],
      passable: roll >= 0.25,
    }
    if (roll < 0.6 && roll >= 0.25) {
      item.clearances = { N: randInt(rnd, 30, 100), W: randInt(rnd, 30, 100) }
    }
    // 約 1/3 貼著外牆擺（實務房型如此，也才會產生同牆面合併的多筆子段）。
    const snap = rnd()
    if (snap < 0.12) item.y = 0
    else if (snap < 0.24) item.x = 0
    else if (snap < 0.34) item.y = ROOM_D - item.depth
    // 少量 deleted 家具：不入分析，但會佔著 `plan.items` 的位置。
    if (rnd() < 0.08) item.deleted = true
    items.push(item)
  }

  return {
    version: 1,
    room: { width: ROOM_W, depth: ROOM_D, blocks, doors },
    items,
    settings: { ...DEFAULT_SETTINGS },
  }
}

/** 進得了分析（未刪除）的家具 id。 */
function liveIds(plan: RoomPlan): string[] {
  return plan.items.filter((item) => item.deleted !== true).map((item) => item.id)
}

/* ------------------------------------------------------------------ *
 * S6 等價 property test
 * ------------------------------------------------------------------ */

describe('S6 等價 property test：clearanceForMoved ≡ clearance', () => {
  const PLANS = 60
  const MOVES = 5

  for (const maxGap of [undefined, 75] as const) {
    const label = maxGap === undefined ? '完整路徑' : `maxGap ${maxGap} 預篩路徑`

    it(`${label}：60 份隨機平面圖 × 5 步連鎖移動逐步等價（cache 接力）`, () => {
      let sawReuse = false
      let reuseItemCount = 0

      for (let seed = 1; seed <= PLANS; seed++) {
        const rnd = makePrng(seed * 7919)
        const basePlan = randomPlan(rnd)
        const ids = liveIds(basePlan)
        if (ids.length === 0) continue

        const opts = maxGap === undefined ? {} : { maxGap }
        let cache = clearanceWithCache(basePlan, opts).cache
        let plan = basePlan
        const doors = basePlan.room.doors

        for (let step = 0; step < MOVES; step++) {
          const movedId = ids[randInt(rnd, 0, ids.length - 1)]
          const roll = rnd()
          let x: number
          let y: number
          if (roll < 0.25) {
            // 疊到另一件家具身上 → 製造／解除碰撞。
            const other = plan.items[randInt(rnd, 0, plan.items.length - 1)]
            x = other.x
            y = other.y
          } else if (roll < 0.4 && doors.length > 0) {
            // 壓到門的迴旋區上 → doorViolations 覆蓋。
            const door = doors[randInt(rnd, 0, doors.length - 1)]
            x = door.x
            y = door.y
          } else {
            x = randInt(rnd, 0, ROOM_W)
            y = randInt(rnd, 0, ROOM_D)
          }

          const nextPlan = movePlan(plan, movedId, x, y)
          const moved = clearanceForMoved(cache, nextPlan, movedId)
          const full = clearance(nextPlan, cache.opts)
          expect(canonical(moved.report), `seed ${seed} step ${step} 移動 ${movedId}`).toEqual(
            canonical(full),
          )
          if (moved.stats.corridorsReused > 0 && ids.length >= 20) {
            sawReuse = true
            reuseItemCount = ids.length
          }
          // 接力：下一步吃上一步回的 cache（S6 要求的連鎖等價）。
          cache = moved.cache
          plan = nextPlan
        }
      }

      // 「不是偽裝的全量重算」：至少一份 ≥20 件的平面圖真的沿用了候選子段。
      expect(sawReuse, '沒有任何一步重用到 cache 候選').toBe(true)
      expect(reuseItemCount).toBeGreaterThanOrEqual(20)
    })
  }

  it('suppressed／doorway／sideViolations／碰撞四類在隨機案中確實出現（否則等價斷言是空的）', () => {
    let suppressed = 0
    let doorway = 0
    let sideViolations = 0
    let collisions = 0
    for (let seed = 1; seed <= PLANS; seed++) {
      const report = clearance(randomPlan(makePrng(seed * 7919)))
      suppressed += report.corridors.filter((c) => c.kind === 'suppressed').length
      doorway += report.corridors.filter((c) => c.kind === 'doorway').length
      sideViolations += report.sideViolations.length
      collisions += report.collisions.length
    }
    expect(suppressed).toBeGreaterThan(0)
    expect(doorway).toBeGreaterThan(0)
    expect(sideViolations).toBeGreaterThan(0)
    expect(collisions).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ *
 * 記帳與退化情形
 * ------------------------------------------------------------------ */

describe('clearanceForMoved 記帳與邊界', () => {
  const plan = randomPlan(makePrng(20260921))

  it('原地未動：回同一份 report 參考、同一份 cache、零配對重算', () => {
    const first = clearanceWithCache(plan)
    const ids = liveIds(plan)
    const same = clearanceForMoved(first.cache, plan, ids[0])
    expect(same.report).toBe(first.report)
    expect(same.cache).toBe(first.cache)
    expect(same.stats.pairsRecomputed).toBe(0)
    expect(same.stats.corridorsReused).toBeGreaterThan(0)
  })

  it('重算的配對數 ＝ entries 數 − 1，遠少於全量的逐對數', () => {
    const first = clearanceWithCache(plan)
    const ids = liveIds(plan)
    const moved = clearanceForMoved(first.cache, movePlan(plan, ids[0], 7, 11), ids[0])
    expect(moved.stats.pairsRecomputed).toBe(first.cache.entries.length - 1)
    // 全量會跑「家具數 × 其餘所有 entry」量級的配對，增量必須明顯更少。
    expect(moved.stats.pairsRecomputed).toBeLessThan(first.cache.itemCount * 2)
  })

  it('非家具 id（門／方塊／不存在／已刪除）擲 TypeError', () => {
    const first = clearanceWithCache(plan)
    expect(() => clearanceForMoved(first.cache, plan, plan.room.doors[0].id)).toThrow(TypeError)
    expect(() => clearanceForMoved(first.cache, plan, 'nope')).toThrow(TypeError)
    const deletedPlan: RoomPlan = {
      ...plan,
      items: plan.items.map((item, i) => (i === 0 ? { ...item, deleted: true as const } : item)),
    }
    expect(() => clearanceForMoved(first.cache, deletedPlan, plan.items[0].id)).toThrow(TypeError)
  })

  it('房型變動（增一個方塊）→ 自行退回全量，結果仍與 clearance() 逐字相同', () => {
    const first = clearanceWithCache(plan)
    const ids = liveIds(plan)
    const reshaped: RoomPlan = {
      ...plan,
      room: {
        ...plan.room,
        blocks: [...plan.room.blocks, { id: 'bx', kind: 'cutout', x: 10, y: 10, width: 60, depth: 60 }],
      },
    }
    const moved = clearanceForMoved(first.cache, reshaped, ids[0])
    expect(canonical(moved.report)).toEqual(canonical(clearance(reshaped)))
    expect(moved.stats.corridorsReused).toBe(0)
  })

  it('閾值變動 → 退回全量（評級隨 D3 四段重算）', () => {
    const first = clearanceWithCache(plan)
    const ids = liveIds(plan)
    const retuned: RoomPlan = {
      ...plan,
      settings: { ...plan.settings, warnBelow: 40, adviseBelow: 50 },
    }
    const moved = clearanceForMoved(first.cache, retuned, ids[0])
    expect(canonical(moved.report)).toEqual(canonical(clearance(retuned)))
  })

  it('同一件家具同時改 rotation／passable／clearances 亦等價（變動限於那一件即可）', () => {
    const first = clearanceWithCache(plan)
    const target = plan.items.find((item) => item.deleted !== true)
    expect(target).toBeDefined()
    const id = target!.id
    const mutated: RoomPlan = {
      ...plan,
      items: plan.items.map((item) =>
        item.id === id
          ? {
              ...item,
              x: 120,
              y: 240,
              rotation: 90 as const,
              passable: !item.passable,
              clearances: { S: 80 },
            }
          : item,
      ),
    }
    const moved = clearanceForMoved(first.cache, mutated, id)
    expect(canonical(moved.report)).toEqual(canonical(clearance(mutated)))
  })

  it('樸素路徑（index:false）的增量同樣等價——cache 帶著自己的 opts', () => {
    const first = clearanceWithCache(plan, { index: false })
    const ids = liveIds(plan)
    const next = movePlan(plan, ids[0], 260, 300)
    const moved = clearanceForMoved(first.cache, next, ids[0])
    expect(first.cache.opts.index).toBe(false)
    expect(canonical(moved.report)).toEqual(canonical(clearance(next, { index: false })))
  })

  it('clearanceWithCache 的 report 與 clearance 逐字相同（含 unattachedDoors／unconnectedBlocks）', () => {
    expect(clearanceWithCache(plan).report).toEqual(clearance(plan))
  })

  it('cache 不可變：同一份舊 cache 連用三次，結果不受前一次呼叫影響', () => {
    const first = clearanceWithCache(plan)
    const ids = liveIds(plan)
    const a = movePlan(plan, ids[0], 90, 90)
    const b = movePlan(plan, ids[0], 400, 500)
    const viaA = clearanceForMoved(first.cache, a, ids[0])
    // 同一份 first.cache 再用一次：若上一次呼叫就地改寫了 cache 裡的候選或
    // 子段，這裡就會歪掉。
    const viaB = clearanceForMoved(first.cache, b, ids[0])
    const again = clearanceForMoved(first.cache, a, ids[0])
    expect(canonical(viaA.report)).toEqual(canonical(clearance(a)))
    expect(canonical(viaB.report)).toEqual(canonical(clearance(b)))
    expect(canonical(again.report)).toEqual(canonical(viaA.report))
  })
})

/* ------------------------------------------------------------------ *
 * 守衛上限下的節省量（決定性記帳，不計時）
 * ------------------------------------------------------------------ */

describe('D10 守衛上限（家具 75）下的重算量', () => {
  /** 75 件家具 ＋ 50 個 cutout 方塊：OQ4 守衛上限下的最壞形狀。 */
  function worstCasePlan(): RoomPlan {
    const blocks: RoomBlock[] = []
    for (let i = 0; i < 50; i++) {
      blocks.push({
        id: `c${i}`,
        kind: 'cutout',
        x: (i % 10) * 60,
        y: Math.floor(i / 10) * 160,
        width: 30,
        depth: 40,
      })
    }
    const items: Furniture[] = []
    for (let i = 0; i < 75; i++) {
      items.push({
        id: `i${i}`,
        name: `家具${i}`,
        color: '#336699',
        width: 80,
        depth: 50,
        x: (i % 8) * 70 + 5,
        y: Math.floor(i / 8) * 80 + 5,
        rotation: 0,
        passable: true,
      })
    }
    return {
      version: 1,
      room: { width: ROOM_W, depth: ROOM_D, blocks, doors: [] },
      items,
      settings: { ...DEFAULT_SETTINGS },
    }
  }

  it('拖一件家具：絕大多數候選沿用 cache 子段，且連鎖 20 步仍與全量逐字相同', () => {
    const plan = worstCasePlan()
    const start = clearanceWithCache(plan)
    const totalCandidates = start.cache.candidates.length
    expect(totalCandidates).toBeGreaterThan(100)

    let cache = start.cache
    let current = plan
    let minReuseRatio = 1
    for (let step = 0; step < 20; step++) {
      const next = movePlan(current, 'i40', 100 + step * 7, 200 + step * 5)
      const moved = clearanceForMoved(cache, next, 'i40')
      expect(canonical(moved.report), `step ${step}`).toEqual(canonical(clearance(next)))
      const ratio = moved.stats.corridorsReused / totalCandidates
      if (ratio < minReuseRatio) minReuseRatio = ratio
      cache = moved.cache
      current = next
    }
    // 重跑遮擋的只有「含被拖家具」與「舊／新矩形壓到的」那幾筆；其餘整批沿用。
    expect(minReuseRatio).toBeGreaterThan(0.7)
  })
})

/* ------------------------------------------------------------------ *
 * D9 玄關實例（門迴旋區違規的增量路徑）
 * ------------------------------------------------------------------ */

describe('玄關實例：衣櫃 y 0↔1 的門違規增量', () => {
  /**
   * D9 玄關實例（與 `clearance.test.ts` 的 `vestibulePlan()` 同一組數字）：
   * 基底 300×400 ＋ extend `E1` x∈[300,360]、y∈[0,270]；衣櫃
   * `width:200 depth:60 rotation:90` 於 (300, y)；門鉸鏈 (360,270)、
   * `leafDir:'-'`、寬 70、內開。y=0 時恰相切（零違規），y=1 即壓進迴旋區。
   */
  function vestibulePlan(wardrobeY: number): RoomPlan {
    return {
      version: 1,
      room: {
        width: 300,
        depth: 400,
        blocks: [{ id: 'E1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
        doors: [{ id: 'D1', x: 360, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }],
      },
      items: [
        {
          id: 'W1',
          name: '衣櫃（開門式）',
          color: '#336699',
          width: 200,
          depth: 60,
          x: 300,
          y: wardrobeY,
          rotation: 90,
          passable: true,
          clearances: { S: 90 },
        },
      ],
      settings: { ...DEFAULT_SETTINGS },
    }
  }

  it('y 0→1 增量後 doorViolations 1 筆；退回 0 又歸零，且全程與全量逐字相同', () => {
    const base = vestibulePlan(0)
    const start = clearanceWithCache(base)
    expect(start.report.doorViolations).toEqual([])

    const pushed = movePlan(base, 'W1', 300, 1)
    const nudged = clearanceForMoved(start.cache, pushed, 'W1')
    expect(nudged.report.doorViolations).toEqual([{ doorId: 'D1', itemId: 'W1' }])
    expect(canonical(nudged.report)).toEqual(canonical(clearance(pushed)))

    const restored = clearanceForMoved(nudged.cache, movePlan(pushed, 'W1', 300, 0), 'W1')
    expect(restored.report.doorViolations).toEqual([])
    expect(canonical(restored.report)).toEqual(canonical(start.report))
  })

  it('門洞筆（kind:doorway、不評級）在增量路徑上照樣產出', () => {
    const base = vestibulePlan(0)
    const start = clearanceWithCache(base)
    expect(start.report.corridors.filter((c) => c.kind === 'doorway').length).toBeGreaterThan(0)

    // 衣櫃往西推 10 cm：門洞母通道仍在，增量須與全量逐字相同。
    const shifted = movePlan(base, 'W1', 290, 0)
    const moved = clearanceForMoved(start.cache, shifted, 'W1')
    expect(canonical(moved.report)).toEqual(canonical(clearance(shifted)))
  })
})
