/**
 * T1.8 — `reducer.ts` 單元測試（(internal design doc)
 * §Verification「snap／reducer：…夾框對 `item/*`／`block/*`／`room/set` 生效
 * 且門走 D6 拒收、非凸房型不卡住、上限守衛第 76／51／11 件回『不變＋拒絕
 * 原因』、牆體硬上限後置條件（棋盤 50 塊第 33 塊起拒收，32 收／18 拒／
 * 牆體 182；橋接 cutout remove 拒）、undo 棧深 50 時第 50 次到最舊、第 51 次
 * no-op、結構共享參考不變、拖移態靜默期間 undo → 先 commit 再 undo」）。
 *
 * 釘死 fixture 沿用 D9 玄關實例（基底 300×400、extend `E1`
 * [300,360]×[0,270]、衣櫃 200×60 rotation 90 於 (300,0)）與 D9 棋盤
 * （基底 50×50、縱橫各 25 條 1 cm 寬 cutout；全加為 650 條），與
 * room-shape／clearance／model 的測試同一組座標。
 */
import { describe, expect, it } from 'vitest'
import { intersectArea, type Rect } from './geometry.js'
import {
  DEFAULT_SETTINGS,
  effectiveRect,
  LIMITS,
  MAX_ITEMS_DEFAULT,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
} from './model.js'
import { PRESETS } from './presets.js'
import {
  apply,
  beginDrag,
  cancelDrag,
  commit,
  commitDrag,
  createHistory,
  dragTo,
  HISTORY_LIMIT,
  interruptDrag,
  redo,
  undo,
  type ApplyResult,
  type History,
  type Rejection,
} from './reducer.js'
import { normalize } from './room-shape.js'
import { parsePlan } from './serialize.js'

/* ------------------------------------------------------------------ *
 * 測試工具與 fixture
 * ------------------------------------------------------------------ */

function expectOk(result: ApplyResult): RoomPlan {
  if (!result.ok) {
    throw new Error(`expected ok, got rejection ${JSON.stringify(result.rejection)}`)
  }
  return result.plan
}

/** 取拒絕分支，並就地鎖住「不變」——`plan` 必須是傳進去的同一參考。 */
function expectRejected(result: ApplyResult, plan: RoomPlan): Rejection {
  if (result.ok) throw new Error('expected rejection, got ok')
  expect(result.plan).toBe(plan)
  return result.rejection
}

function itemAt(id: string, x: number, y: number, over: Partial<Furniture> = {}): Furniture {
  return {
    id,
    name: '方塊',
    color: '#336699',
    width: 100,
    depth: 50,
    x,
    y,
    rotation: 0,
    passable: true,
    ...over,
  }
}

/** 300×400 基底房（D9 玄關實例的基底）＋指定家具／方塊／門。 */
function planOf(items: Furniture[], blocks: RoomBlock[] = [], doors: Door[] = []): RoomPlan {
  return {
    version: 1,
    room: { width: 300, depth: 400, blocks, doors },
    items,
    settings: { ...DEFAULT_SETTINGS },
  }
}

/** D9 玄關凹槽的 extend（`bounds` 因此為 [0,360]×[0,400]）。 */
const VESTIBULE_BLOCK: RoomBlock = { id: 'e1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }

/** D9 玄關衣櫃：本身 200×60、rotation 90 → 有效外框 [300,360]×[0,200]。 */
const WARDROBE: Furniture = {
  id: 'w1',
  name: '衣櫃（開門式）',
  color: '#9db4d6',
  width: 200,
  depth: 60,
  x: 300,
  y: 0,
  rotation: 90,
  passable: true,
  clearances: { S: 90 },
}

/** D9 棋盤 50 塊：縱 `x∈[2i,2i+1]×y∈[0,50]`、橫 `x∈[0,50]×y∈[2j,2j+1]`。 */
function checkerboardBlocks(verticals = 25, horizontals = 25): RoomBlock[] {
  const blocks: RoomBlock[] = []
  for (let i = 0; i < verticals; i++) {
    blocks.push({ id: `v${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 })
  }
  for (let j = 0; j < horizontals; j++) {
    blocks.push({ id: `h${j}`, kind: 'cutout', x: 0, y: 2 * j, width: 50, depth: 1 })
  }
  return blocks
}

/** 基底 50×50、空 blocks 的棋盤起手式。 */
function emptyBoard(): RoomPlan {
  return {
    version: 1,
    room: { width: 50, depth: 50, blocks: [], doors: [] },
    items: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

const within = (r: Rect, b: Rect): boolean =>
  r.x0 >= b.x0 && r.y0 >= b.y0 && r.x1 <= b.x1 && r.y1 <= b.y1

/* ------------------------------------------------------------------ *
 * 夾框（PLAN 六類）
 * ------------------------------------------------------------------ */

describe('apply — 夾框六類', () => {
  it('item/move：超出外接框時夾到邊界', () => {
    const plan = planOf([itemAt('a', 0, 0)])
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: 500, y: 500 }))
    // 有效外框 100×50、bounds [0,300]×[0,400] → (200, 350)。
    expect(next.items[0].x).toBe(200)
    expect(next.items[0].y).toBe(350)
  })

  it('item/move：負座標夾回原點', () => {
    const plan = planOf([itemAt('a', 100, 100)])
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: -40, y: -40 }))
    expect(next.items[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('item/move：家具比外接框大時 pin 到左上角', () => {
    const plan: RoomPlan = {
      version: 1,
      room: { width: 50, depth: 50, blocks: [], doors: [] },
      items: [itemAt('a', 0, 0, { width: 100, depth: 100 })],
      settings: { ...DEFAULT_SETTINGS },
    }
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: 30, y: 30 }))
    expect(next.items[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('item/rotate：玄關衣櫃再按 R，夾框優先於中心不變且位移為最小量', () => {
    const plan = planOf([WARDROBE], [VESTIBULE_BLOCK])
    const next = expectOk(apply(plan, { type: 'item/rotate', id: 'w1' }))
    const rotated = next.items[0]
    expect(rotated.rotation).toBe(180)
    // 中心不變會算出 x=230（rawX = 300 + (60−200)/2），有效外框 200 寬 →
    // 右緣 430 超出 bounds.x1=360，夾到 360−200=160；y 未觸發夾框。
    expect(rotated.x).toBe(160)
    expect(rotated.y).toBe(70)
    const bounds = normalize(next.room).bounds
    expect(within(effectiveRect(rotated), bounds)).toBe(true)
    // 「最小量」＝恰好貼齊 bounds 右緣，再多 1 cm 就出框。
    expect(rotated.x).toBe(bounds.x1 - 200)
  })

  it('item/rotate：未觸發夾框時中心不變', () => {
    const plan = planOf([itemAt('a', 100, 100, { width: 100, depth: 50 })])
    const next = expectOk(apply(plan, { type: 'item/rotate', id: 'a' }))
    // rawX = 100 + (100−50)/2 = 125、rawY = 100 + (50−100)/2 = 75，→90 取 floor。
    expect(next.items[0]).toMatchObject({ x: 125, y: 75, rotation: 90 })
  })

  it('item/update：放大後重夾', () => {
    const plan = planOf([itemAt('a', 200, 350)])
    const next = expectOk(apply(plan, { type: 'item/update', id: 'a', patch: { width: 200 } }))
    expect(next.items[0]).toMatchObject({ width: 200, x: 100, y: 350 })
  })

  it('item/update：改 rotation 造成寬深互換後亦重夾', () => {
    const plan = planOf([itemAt('a', 200, 350, { width: 100, depth: 50 })])
    const next = expectOk(apply(plan, { type: 'item/update', id: 'a', patch: { rotation: 90 } }))
    // 有效外框變 50×100 → maxY = 400−100 = 300。
    expect(next.items[0]).toMatchObject({ rotation: 90, x: 200, y: 300 })
  })

  it('block/add：擴大 bounds 不動家具，`items` 陣列與元素參考皆不變', () => {
    const plan = planOf([itemAt('a', 10, 10)])
    const next = expectOk(
      apply(plan, { type: 'block/add', block: { ...VESTIBULE_BLOCK, id: undefined } }),
    )
    expect(normalize(next.room).bounds).toEqual({ x0: 0, y0: 0, x1: 360, y1: 400 })
    expect(next.items).toBe(plan.items)
    expect(next.room).not.toBe(plan.room)
  })

  it('room/set：縮小房間後所有未刪除家具重夾，已刪除者座標保留', () => {
    const plan = planOf([
      itemAt('a', 200, 350),
      itemAt('d', 200, 350, { deleted: true }),
    ])
    const next = expectOk(apply(plan, { type: 'room/set', width: 200, depth: 200 }))
    expect(next.items[0]).toMatchObject({ x: 100, y: 150 })
    expect(next.items[1]).toMatchObject({ x: 200, y: 350, deleted: true })
    expect(next.items[1]).toBe(plan.items[1])
  })

  it('block/update：cutout 移動不改 bounds 時家具原封不動', () => {
    const plan = planOf([itemAt('a', 10, 10)], [{ id: 'c1', kind: 'cutout', x: 0, y: 300, width: 100, depth: 100 }])
    const next = expectOk(apply(plan, { type: 'block/update', id: 'c1', patch: { y: 200 } }))
    expect(next.room.blocks[0]).toMatchObject({ y: 200 })
    expect(next.items).toBe(plan.items)
  })
})

/* ------------------------------------------------------------------ *
 * 門：只拒收、不夾框（D6）
 * ------------------------------------------------------------------ */

describe('apply — 門走 D6 拒收、不套夾框', () => {
  const doorOnNorth: Omit<Door, 'wall'> = {
    id: 'd1',
    x: 100,
    y: 0,
    leafDir: '+',
    width: 80,
    swing: 'in',
  }

  it('door/add：鉸鏈在極大牆段上且跨距落入 → 收，`wall` 由 x,y 推導', () => {
    const plan = planOf([])
    const next = expectOk(apply(plan, { type: 'door/add', door: doorOnNorth }))
    expect(next.room.doors).toHaveLength(1)
    expect(next.room.doors[0]).toMatchObject({ x: 100, y: 0, wall: 'N', width: 80 })
  })

  it('door/add：鉸鏈不在任何 `edges` 上 → door-invalid 且 plan 參考不變', () => {
    const plan = planOf([])
    const rejection = expectRejected(
      apply(plan, { type: 'door/add', door: { ...doorOnNorth, x: 150, y: 200 } }),
      plan,
    )
    expect(rejection.reason).toBe('door-invalid')
  })

  it('door/add：跨距超出牆段 → door-invalid（不夾成合法跨距）', () => {
    const plan = planOf([])
    const rejection = expectRejected(
      apply(plan, { type: 'door/add', door: { ...doorOnNorth, x: 290 } }),
      plan,
    )
    expect(rejection.reason).toBe('door-invalid')
  })

  it('door/move：合法位置座標逐字保留；非法位置整個拒收而非夾到最近合法點', () => {
    const plan = expectOk(apply(planOf([]), { type: 'door/add', door: doorOnNorth }))
    const moved = expectOk(apply(plan, { type: 'door/move', id: plan.room.doors[0].id, x: 200, y: 0 }))
    expect(moved.room.doors[0]).toMatchObject({ x: 200, y: 0, wall: 'N' })
    // 跨距 [250,330] 超出北牆 [0,300]：家具會被夾到 220，門則整筆拒收。
    const rejection = expectRejected(
      apply(moved, { type: 'door/move', id: moved.room.doors[0].id, x: 250, y: 0 }),
      moved,
    )
    expect(rejection.reason).toBe('door-invalid')
  })

  it('door/update：非法寬度回 invalid-input，合法寬度重推 `wall`', () => {
    const plan = expectOk(apply(planOf([]), { type: 'door/add', door: doorOnNorth }))
    const id = plan.room.doors[0].id
    expect(expectRejected(apply(plan, { type: 'door/update', id, patch: { width: 0 } }), plan).reason).toBe(
      'invalid-input',
    )
    const next = expectOk(apply(plan, { type: 'door/update', id, patch: { width: 120 } }))
    expect(next.room.doors[0]).toMatchObject({ width: 120, wall: 'N' })
  })

  it('房間變動讓門失去附著時不刪門（report 另標「門未附著」）', () => {
    const plan = expectOk(
      apply(planOf([]), { type: 'door/add', door: { ...doorOnNorth, x: 100, y: 400 } }),
    )
    expect(plan.room.doors[0].wall).toBe('S')
    const next = expectOk(apply(plan, { type: 'room/set', width: 300, depth: 200 }))
    expect(next.room.doors).toHaveLength(1)
    expect(next.room.doors).toBe(plan.room.doors)
    expect(next.room.doors[0].y).toBe(400)
  })

  it('door/remove：不存在的 id 回 not-found', () => {
    const plan = planOf([])
    expect(expectRejected(apply(plan, { type: 'door/remove', id: 'nope' }), plan).reason).toBe(
      'not-found',
    )
  })
})

/* ------------------------------------------------------------------ *
 * 非凸房型不卡住
 * ------------------------------------------------------------------ */

describe('apply — 非凸房型（L 形）只夾外接框', () => {
  /** 300×400 挖掉左上 [0,150]×[0,200] → L 形；bounds 不變。 */
  const L_CUTOUT: RoomBlock = { id: 'c1', kind: 'cutout', x: 0, y: 0, width: 150, depth: 200 }

  it('家具可移到凹口（牆體）上方，不被卡住', () => {
    const plan = planOf([itemAt('a', 200, 300, { width: 50, depth: 50 })], [L_CUTOUT])
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: 10, y: 10 }))
    expect(next.items[0]).toMatchObject({ x: 10, y: 10 })
    // 確認它真的壓在牆體上（碰撞由 clearance 回報，不由 reducer 阻擋）。
    const wall = normalize(next.room).walls.find((w) => intersectArea(w, effectiveRect(next.items[0])) > 0)
    expect(wall).toBeDefined()
  })

  it('L 形房仍以 bounds 夾框（超框才動）', () => {
    const plan = planOf([itemAt('a', 200, 300, { width: 50, depth: 50 })], [L_CUTOUT])
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: 400, y: 400 }))
    expect(next.items[0]).toMatchObject({ x: 250, y: 350 })
  })

  it('凹口內的任一整數位置都到得了（逐點掃描不卡住）', () => {
    const plan = planOf([itemAt('a', 200, 300, { width: 50, depth: 50 })], [L_CUTOUT])
    for (let x = 0; x <= 100; x += 20) {
      for (let y = 0; y <= 100; y += 20) {
        const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x, y }))
        expect(next.items[0]).toMatchObject({ x, y })
      }
    }
  })
})

/* ------------------------------------------------------------------ *
 * 上限守衛（D10 n 口徑；OQ4 家具 75）
 * ------------------------------------------------------------------ */

describe('apply — 上限守衛回「不變＋拒絕原因」', () => {
  it('第 76 件家具（含 deleted 計入）→ limit-items（硬上限，軟上限已開到 75）', () => {
    const items: Furniture[] = []
    for (let i = 0; i < LIMITS.items; i++) {
      items.push(itemAt(`i${i}`, 0, 0, i % 5 === 0 ? { deleted: true } : {}))
    }
    // T4.7：軟上限開到硬上限，本案測的才是 `LIMITS.items` 那一道。
    const base = planOf(items)
    const plan: RoomPlan = { ...base, settings: { ...base.settings, maxItems: LIMITS.items } }
    expect(plan.items.filter((item) => item.deleted === true)).toHaveLength(15)
    const rejection = expectRejected(
      apply(plan, { type: 'item/add', item: { name: '書桌', width: 120, depth: 60 } }),
      plan,
    )
    expect(rejection.reason).toBe('limit-items')

    // 清掉已刪除後再加就過得了（證明是「含 deleted 的 75」而非活件數）。
    const purged = expectOk(apply(plan, { type: 'item/purge' }))
    expect(purged.items).toHaveLength(60)
    expect(expectOk(apply(purged, { type: 'item/add', item: { name: '書桌', width: 120, depth: 60 } })).items).toHaveLength(61)
  })

  it('T4.7：軟上限預設 20 → 第 21 件被拒，detail 帶當前上限', () => {
    const items = Array.from({ length: MAX_ITEMS_DEFAULT }, (_, i) => itemAt(`i${i}`, 0, 0))
    const plan = planOf(items)
    expect(plan.settings.maxItems).toBe(MAX_ITEMS_DEFAULT)

    const rejection = expectRejected(
      apply(plan, { type: 'item/add', item: { name: '書桌', width: 120, depth: 60 } }),
      plan,
    )
    expect(rejection.reason).toBe('limit-items')
    expect(rejection.detail).toBe(String(MAX_ITEMS_DEFAULT))
  })

  it('T4.7：調高至 30 後同一件即加得進去（軟上限是使用者的取捨）', () => {
    const items = Array.from({ length: MAX_ITEMS_DEFAULT }, (_, i) => itemAt(`i${i}`, 0, 0))
    const raised = expectOk(
      apply(planOf(items), { type: 'settings/update', patch: { maxItems: 30 } }),
    )
    expect(raised.settings.maxItems).toBe(30)

    const added = expectOk(
      apply(raised, { type: 'item/add', item: { name: '書桌', width: 120, depth: 60 } }),
    )
    expect(added.items).toHaveLength(MAX_ITEMS_DEFAULT + 1)
  })

  it('T4.7：軟上限低於現有件數（含 deleted）→ invalid-input／max-items-below-count', () => {
    const items = Array.from({ length: MAX_ITEMS_DEFAULT }, (_, i) =>
      itemAt(`i${i}`, 0, 0, i % 4 === 0 ? { deleted: true } : {}),
    )
    const plan = planOf(items)
    const rejection = expectRejected(
      apply(plan, { type: 'settings/update', patch: { maxItems: 10 } }),
      plan,
    )
    expect(rejection.reason).toBe('invalid-input')
    expect(rejection.detail).toBe('max-items-below-count')
  })

  it('T4.7：軟上限超出硬上限 75 或非整數 → invalid-input／maxItems', () => {
    const plan = planOf([])
    for (const bad of [76, 0, -1, 2.5, Number.NaN, '20']) {
      const rejection = expectRejected(
        apply(plan, { type: 'settings/update', patch: { maxItems: bad as unknown as number } }),
        plan,
      )
      expect(rejection.reason).toBe('invalid-input')
      expect(rejection.detail).toBe('maxItems')
    }
    // 邊界 75 合法（等於硬上限）
    expect(expectOk(apply(plan, { type: 'settings/update', patch: { maxItems: 75 } })).settings.maxItems).toBe(75)
  })

  it('第 51 個方塊 → limit-blocks', () => {
    const blocks: RoomBlock[] = []
    for (let i = 0; i < LIMITS.blocks; i++) {
      blocks.push({ id: `b${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 })
    }
    const plan: RoomPlan = {
      version: 1,
      room: { width: 200, depth: 50, blocks, doors: [] },
      items: [],
      settings: { ...DEFAULT_SETTINGS },
    }
    // 先確認這 50 塊本身沒撞到牆體上限（否則會測成 wall-cap）。
    expect(normalize(plan.room).walls).toHaveLength(50)
    const rejection = expectRejected(
      apply(plan, { type: 'block/add', block: { kind: 'cutout', x: 120, y: 0, width: 1, depth: 50 } }),
      plan,
    )
    expect(rejection.reason).toBe('limit-blocks')
  })

  it('第 11 扇門 → limit-doors', () => {
    let plan = planOf([])
    for (let i = 0; i < LIMITS.doors; i++) {
      plan = expectOk(
        apply(plan, {
          type: 'door/add',
          door: { id: `d${i}`, x: 10 + i * 20, y: 0, leafDir: '+', width: 20, swing: 'in' },
        }),
      )
    }
    expect(plan.room.doors).toHaveLength(10)
    const rejection = expectRejected(
      apply(plan, { type: 'door/add', door: { id: 'd10', x: 250, y: 0, leafDir: '+', width: 20, swing: 'in' } }),
      plan,
    )
    expect(rejection.reason).toBe('limit-doors')
  })
})

/* ------------------------------------------------------------------ *
 * 牆體硬上限後置條件（D9）
 * ------------------------------------------------------------------ */

describe('apply — 牆體硬上限（D9 執行期後置條件）', () => {
  it('棋盤 50 塊依序加入：第 33 塊起拒收，32 收／18 拒／牆體 182', () => {
    const blocks = checkerboardBlocks()
    // 對照組：全數加入時 `normalize()` 為 650 條（D9 釘死值）。
    expect(normalize({ width: 50, depth: 50, blocks }).walls).toHaveLength(650)

    let plan = emptyBoard()
    let accepted = 0
    const rejections: Rejection[] = []
    let firstRejectionAt = 0
    for (let n = 0; n < blocks.length; n++) {
      const before = plan
      const result = apply(plan, { type: 'block/add', block: blocks[n] })
      if (result.ok) {
        accepted += 1
        plan = result.plan
        continue
      }
      rejections.push(expectRejected(result, before))
      if (firstRejectionAt === 0) firstRejectionAt = n + 1
    }

    expect(firstRejectionAt).toBe(33)
    expect(accepted).toBe(32)
    expect(rejections).toHaveLength(18)
    expect(plan.room.blocks).toHaveLength(32)
    expect(normalize(plan.room).walls).toHaveLength(182)
    for (const rejection of rejections) {
      expect(rejection.reason).toBe('wall-cap')
      expect(rejection.walls).toBe(208)
      expect(rejection.walls).toBeGreaterThan(LIMITS.walls)
    }
  })

  it('橋接 cutout：加齒期間牆體恆 1，移除橋接塊被拒（block/remove 亦過後置條件）', () => {
    // `LIMITS.blocks` 為 50，故橋接塊＋49 根梳齒（縱 25／橫 24）恰好用滿。
    let plan = expectOk(
      apply(emptyBoard(), {
        type: 'block/add',
        block: { id: 'bridge', kind: 'cutout', x: 0, y: 0, width: 50, depth: 50 },
      }),
    )
    expect(normalize(plan.room).walls).toHaveLength(1)

    for (const block of checkerboardBlocks(25, 24)) {
      plan = expectOk(apply(plan, { type: 'block/add', block }))
      // 地板已被橋接塊整片挖空，牆體恆為單一合併矩形。
      expect(normalize(plan.room).walls).toHaveLength(1)
    }
    expect(plan.room.blocks).toHaveLength(LIMITS.blocks)

    const rejection = expectRejected(apply(plan, { type: 'block/remove', id: 'bridge' }), plan)
    expect(rejection.reason).toBe('wall-cap')
    expect(rejection.walls).toBe(624)
    expect(plan.room.blocks).toHaveLength(50)
  })

  it('room/set 若讓牆體爆表同樣拒收（放大房間喚醒被裁掉的 cutout）', () => {
    // 起手 50×10：25 條縱齒各被裁成 10 cm 高（25 條牆），另外 8 條橫齒位於
    // y≥20 完全落在框外 → `normalize()` 直接忽略。
    let plan: RoomPlan = {
      version: 1,
      room: { width: 50, depth: 10, blocks: [], doors: [] },
      items: [],
      settings: { ...DEFAULT_SETTINGS },
    }
    for (let i = 0; i < 25; i++) {
      plan = expectOk(
        apply(plan, { type: 'block/add', block: { id: `v${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 } }),
      )
    }
    for (let j = 0; j < 8; j++) {
      plan = expectOk(
        apply(plan, {
          type: 'block/add',
          block: { id: `h${j}`, kind: 'cutout', x: 0, y: 20 + 2 * j, width: 50, depth: 1 },
        }),
      )
    }
    expect(normalize(plan.room).walls).toHaveLength(25)

    // 加深到 50 後 8 條橫齒全部生效 → 8 條滿帶＋9 帶各 25 條＝233 > 200。
    const rejection = expectRejected(apply(plan, { type: 'room/set', width: 50, depth: 50 }), plan)
    expect(rejection.reason).toBe('wall-cap')
    expect(rejection.walls).toBe(233)
    expect(rejection.walls).toBeGreaterThan(LIMITS.walls)
    expect(plan.room.depth).toBe(10)
  })
})

/* ------------------------------------------------------------------ *
 * 結構共享（D10）
 * ------------------------------------------------------------------ */

describe('apply — 結構共享', () => {
  it('移動 A 時 B、room、settings 參考皆不變', () => {
    const plan = planOf([itemAt('a', 0, 0), itemAt('b', 0, 100)])
    const next = expectOk(apply(plan, { type: 'item/move', id: 'a', x: 20, y: 0 }))
    expect(next).not.toBe(plan)
    expect(next.items).not.toBe(plan.items)
    expect(next.items[0]).not.toBe(plan.items[0])
    expect(next.items[1]).toBe(plan.items[1])
    expect(next.room).toBe(plan.room)
    expect(next.settings).toBe(plan.settings)
  })

  it('刪除 A 時其餘家具參考不變', () => {
    const plan = planOf([itemAt('a', 0, 0), itemAt('b', 0, 100)])
    const next = expectOk(apply(plan, { type: 'item/delete', id: 'a' }))
    expect(next.items[0].deleted).toBe(true)
    expect(next.items[1]).toBe(plan.items[1])
    expect(next.room).toBe(plan.room)
  })

  it('原地移動為 no-op，回同一個 plan 參考', () => {
    const plan = planOf([itemAt('a', 20, 30)])
    const result = apply(plan, { type: 'item/move', id: 'a', x: 20, y: 30 })
    expect(expectOk(result)).toBe(plan)
  })

  it('夾框後與原座標相同的移動亦為 no-op', () => {
    const plan = planOf([itemAt('a', 200, 350)])
    expect(expectOk(apply(plan, { type: 'item/move', id: 'a', x: 900, y: 900 }))).toBe(plan)
  })

  it('settings/update 不動 items 與 room', () => {
    const plan = planOf([itemAt('a', 0, 0)])
    const next = expectOk(apply(plan, { type: 'settings/update', patch: { snap: 10 } }))
    expect(next.settings.snap).toBe(10)
    expect(next.items).toBe(plan.items)
    expect(next.room).toBe(plan.room)
    expect(next.settings).not.toBe(plan.settings)
  })

  it('door/add 不動 items 與 blocks', () => {
    const plan = planOf([itemAt('a', 0, 0)], [VESTIBULE_BLOCK])
    const next = expectOk(
      apply(plan, { type: 'door/add', door: { x: 100, y: 0, leafDir: '+', width: 80, swing: 'in' } }),
    )
    expect(next.items).toBe(plan.items)
    expect(next.room.blocks).toBe(plan.room.blocks)
  })
})

/* ------------------------------------------------------------------ *
 * 家具生命週期與欄位驗證
 * ------------------------------------------------------------------ */

describe('apply — item/add', () => {
  it('明示欄位：色碼小寫化、座標與旋轉取預設、id 過 ID_RE', () => {
    const plan = planOf([])
    const next = expectOk(
      apply(plan, { type: 'item/add', item: { name: '書桌', color: '#ABCDEF', width: 120, depth: 60 } }),
    )
    expect(next.items[0]).toMatchObject({
      name: '書桌',
      color: '#abcdef',
      width: 120,
      depth: 60,
      x: 0,
      y: 0,
      rotation: 0,
      passable: true,
    })
    expect(next.items[0].id).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
  })

  it('preset 填名稱／尺寸／passable／clearances，明示欄位優先', () => {
    const desk = PRESETS.find((preset) => preset.key === 'desk')
    expect(desk).toBeDefined()
    const plan = planOf([])
    const filled = expectOk(apply(plan, { type: 'item/add', preset: 'desk' }))
    expect(filled.items[0]).toMatchObject({
      name: desk!.name,
      width: desk!.width,
      depth: desk!.depth,
      passable: true,
    })
    expect(filled.items[0].clearances).toEqual({ S: 75 })

    const overridden = expectOk(
      apply(plan, { type: 'item/add', preset: 'desk', item: { name: '我的桌', width: 90 } }),
    )
    expect(overridden.items[0]).toMatchObject({ name: '我的桌', width: 90, depth: desk!.depth })
  })

  it('preset 的 passable:false 會被帶進來（茶几）', () => {
    const next = expectOk(apply(planOf([]), { type: 'item/add', preset: 'coffee-table' }))
    expect(next.items[0].passable).toBe(false)
  })

  it('加入時即夾框', () => {
    const next = expectOk(
      apply(planOf([]), { type: 'item/add', item: { name: '書桌', width: 120, depth: 60, x: 1000, y: 1000 } }),
    )
    expect(next.items[0]).toMatchObject({ x: 180, y: 340 })
  })

  it('重複 id 會重新產生', () => {
    const plan = planOf([itemAt('dup', 0, 0)])
    const next = expectOk(
      apply(plan, { type: 'item/add', item: { id: 'dup', name: '書桌', width: 120, depth: 60 } }),
    )
    expect(next.items[1].id).not.toBe('dup')
    expect(next.items[1].id).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
  })

  it('非法欄位回 invalid-input 且 plan 不變', () => {
    const plan = planOf([])
    const cases: { patch: Record<string, unknown>; detail: string }[] = [
      { patch: { name: '', width: 120, depth: 60 }, detail: 'name' },
      { patch: { name: '長'.repeat(31), width: 120, depth: 60 }, detail: 'name' },
      { patch: { name: '書桌', width: 0, depth: 60 }, detail: 'width' },
      { patch: { name: '書桌', width: 120, depth: 5001 }, detail: 'depth' },
      { patch: { name: '書桌', width: 120, depth: 60, color: 'red' }, detail: 'color' },
      { patch: { name: '書桌', width: 120, depth: 60, rotation: 45 }, detail: 'rotation' },
      { patch: { name: '書桌', width: 120, depth: 60, x: 1.5 }, detail: 'x' },
      { patch: { name: '書桌', width: 120, depth: 60, clearances: { X: 10 } }, detail: 'clearances' },
    ]
    for (const testCase of cases) {
      const rejection = expectRejected(
        apply(plan, { type: 'item/add', item: testCase.patch as Partial<Furniture> }),
        plan,
      )
      expect(rejection.reason).toBe('invalid-input')
      expect(rejection.detail).toBe(testCase.detail)
    }
  })

  it('未知 preset key 不補欄位，缺名稱即 invalid-input', () => {
    const plan = planOf([])
    const rejection = expectRejected(apply(plan, { type: 'item/add', preset: 'no-such-preset' }), plan)
    expect(rejection.reason).toBe('invalid-input')
    expect(rejection.detail).toBe('name')
  })
})

describe('apply — item/update、move、delete、restore、purge', () => {
  it('item/update 逐欄驗證，非法即拒且不落地', () => {
    const plan = planOf([itemAt('a', 0, 0)])
    for (const patch of [{ name: '' }, { color: '#xyzxyz' }, { width: -1 }, { rotation: 1 }, { x: 0.5 }]) {
      const rejection = expectRejected(
        apply(plan, { type: 'item/update', id: 'a', patch: patch as Partial<Furniture> }),
        plan,
      )
      expect(rejection.reason).toBe('invalid-input')
    }
  })

  it('item/update 可清掉 clearances', () => {
    const plan = planOf([itemAt('a', 0, 0, { clearances: { S: 90 } })])
    const next = expectOk(apply(plan, { type: 'item/update', id: 'a', patch: { clearances: undefined } }))
    expect(next.items[0].clearances).toBeUndefined()
  })

  it('item/move 非整數座標 → invalid-input；不存在的 id → not-found', () => {
    const plan = planOf([itemAt('a', 0, 0)])
    expect(expectRejected(apply(plan, { type: 'item/move', id: 'a', x: 1.5, y: 0 }), plan).detail).toBe('x')
    expect(expectRejected(apply(plan, { type: 'item/move', id: 'zz', x: 1, y: 0 }), plan).reason).toBe(
      'not-found',
    )
  })

  it('delete → restore 還原旗標，重複操作為 no-op', () => {
    const plan = planOf([itemAt('a', 10, 20)])
    const deleted = expectOk(apply(plan, { type: 'item/delete', id: 'a' }))
    expect(deleted.items[0].deleted).toBe(true)
    expect(expectOk(apply(deleted, { type: 'item/delete', id: 'a' }))).toBe(deleted)

    const restored = expectOk(apply(deleted, { type: 'item/restore', id: 'a' }))
    expect(restored.items[0].deleted).toBeUndefined()
    expect(restored.items[0]).toMatchObject({ x: 10, y: 20 })
    expect(expectOk(apply(restored, { type: 'item/restore', id: 'a' }))).toBe(restored)
  })

  it('刪除期間房間縮小時，restore 會重夾（deleted 不入 clampAllItems）', () => {
    const plan = planOf([itemAt('a', 200, 350)])
    const deleted = expectOk(apply(plan, { type: 'item/delete', id: 'a' }))
    const shrunk = expectOk(apply(deleted, { type: 'room/set', width: 200, depth: 200 }))
    expect(shrunk.items[0]).toMatchObject({ x: 200, y: 350, deleted: true })
    const restored = expectOk(apply(shrunk, { type: 'item/restore', id: 'a' }))
    expect(restored.items[0]).toMatchObject({ x: 100, y: 150 })
    expect(restored.items[0].deleted).toBeUndefined()
  })

  it('item/purge 只清已刪除者；無可清時回同一 plan 參考', () => {
    const plan = planOf([itemAt('a', 0, 0), itemAt('b', 0, 100, { deleted: true })])
    const purged = expectOk(apply(plan, { type: 'item/purge' }))
    expect(purged.items).toHaveLength(1)
    expect(purged.items[0]).toBe(plan.items[0])
    expect(expectOk(apply(purged, { type: 'item/purge' }))).toBe(purged)
  })
})

describe('apply — 方塊與房間欄位驗證', () => {
  it('block/add 非法欄位回 invalid-input', () => {
    const plan = planOf([])
    const bad: Record<string, unknown>[] = [
      { kind: 'hole', x: 0, y: 0, width: 10, depth: 10 },
      { kind: 'cutout', x: 20000, y: 0, width: 10, depth: 10 },
      { kind: 'cutout', x: 0, y: 0, width: 0, depth: 10 },
      { kind: 'cutout', x: 0, y: 1.5, width: 10, depth: 10 },
    ]
    for (const block of bad) {
      const rejection = expectRejected(
        apply(plan, { type: 'block/add', block: block as unknown as RoomBlock }),
        plan,
      )
      expect(rejection.reason).toBe('invalid-input')
    }
  })

  it('block/move 與 block/remove 的 not-found', () => {
    const plan = planOf([])
    expect(expectRejected(apply(plan, { type: 'block/move', id: 'x', x: 0, y: 0 }), plan).reason).toBe(
      'not-found',
    )
    expect(expectRejected(apply(plan, { type: 'block/remove', id: 'x' }), plan).reason).toBe('not-found')
  })

  it('room/set 非法寬深 → invalid-input；同尺寸 → no-op', () => {
    const plan = planOf([])
    expect(expectRejected(apply(plan, { type: 'room/set', width: 0, depth: 400 }), plan).detail).toBe(
      'width',
    )
    expect(expectRejected(apply(plan, { type: 'room/set', width: 300, depth: 5001 }), plan).detail).toBe(
      'depth',
    )
    expect(expectOk(apply(plan, { type: 'room/set', width: 300, depth: 400 }))).toBe(plan)
  })

  it('plan/replace 直接換上（已由 parsePlan 清洗），非物件則拒', () => {
    const plan = planOf([])
    const incoming = planOf([itemAt('z', 1, 1)])
    expect(expectOk(apply(plan, { type: 'plan/replace', plan: incoming }))).toBe(incoming)
    expect(
      expectRejected(apply(plan, { type: 'plan/replace', plan: null as unknown as RoomPlan }), plan).reason,
    ).toBe('invalid-input')
  })
})

/* ------------------------------------------------------------------ *
 * settings/update（D3 三元組）
 * ------------------------------------------------------------------ */

describe('apply — settings/update', () => {
  it('合法 patch 逐欄合併', () => {
    const plan = planOf([])
    const next = expectOk(
      apply(plan, { type: 'settings/update', patch: { ignoreBelow: 10, warnBelow: 70, adviseBelow: 90 } }),
    )
    expect(next.settings).toMatchObject({ ignoreBelow: 10, warnBelow: 70, adviseBelow: 90, snap: 5 })
  })

  it('合併後違序 → 整組退預設並回 notes，其餘欄位不受影響', () => {
    const plan: RoomPlan = {
      ...planOf([]),
      settings: {
        ignoreBelow: 10,
        warnBelow: 70,
        adviseBelow: 80,
        snap: 10,
        showSwing: false,
        maxItems: 20,
      },
    }
    const result = apply(plan, { type: 'settings/update', patch: { warnBelow: 5 } })
    const next = expectOk(result)
    expect(result.ok && result.notes).toEqual(['thresholds-reset'])
    expect(next.settings).toMatchObject({
      ignoreBelow: DEFAULT_SETTINGS.ignoreBelow,
      warnBelow: DEFAULT_SETTINGS.warnBelow,
      adviseBelow: DEFAULT_SETTINGS.adviseBelow,
      snap: 10,
      showSwing: false,
    })
  })

  it('非整數閾值亦整組退預設', () => {
    const plan = planOf([])
    const result = apply(plan, {
      type: 'settings/update',
      patch: { warnBelow: Number.NaN as unknown as number },
    })
    expect(expectOk(result).settings.warnBelow).toBe(DEFAULT_SETTINGS.warnBelow)
    expect(result.ok && result.notes).toEqual(['thresholds-reset'])
  })

  it('snap: 3 → invalid-input；showSwing 非布林 → invalid-input', () => {
    const plan = planOf([])
    expect(
      expectRejected(apply(plan, { type: 'settings/update', patch: { snap: 3 as unknown as 5 } }), plan).detail,
    ).toBe('snap')
    expect(
      expectRejected(
        apply(plan, { type: 'settings/update', patch: { showSwing: 'yes' as unknown as boolean } }),
        plan,
      ).detail,
    ).toBe('showSwing')
  })

  it('同一組壞三元組：apply 與 parsePlan 同規（共用 isValidThresholds）', () => {
    // 純違序：三者皆為合法整數，只是順序不對（D3 明文案例）。
    const bad = { ignoreBelow: 80, warnBelow: 60, adviseBelow: 75 }

    const viaApply = expectOk(apply(planOf([]), { type: 'settings/update', patch: bad }))
    expect(viaApply.settings).toMatchObject({
      ignoreBelow: DEFAULT_SETTINGS.ignoreBelow,
      warnBelow: DEFAULT_SETTINGS.warnBelow,
      adviseBelow: DEFAULT_SETTINGS.adviseBelow,
    })

    const parsed = parsePlan({
      version: 1,
      room: { width: 300, depth: 400, blocks: [], doors: [] },
      items: [],
      settings: { ...bad, snap: 5, showSwing: true },
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.plan.settings).toMatchObject({
        ignoreBelow: DEFAULT_SETTINGS.ignoreBelow,
        warnBelow: DEFAULT_SETTINGS.warnBelow,
        adviseBelow: DEFAULT_SETTINGS.adviseBelow,
      })
    }
  })
})

/* ------------------------------------------------------------------ *
 * undo／redo 棧
 * ------------------------------------------------------------------ */

describe('undo／redo 棧（不經 apply）', () => {
  /** 產生 n+1 份可辨識的 plan（家具 x ＝序號）。 */
  function series(n: number): RoomPlan[] {
    const out: RoomPlan[] = []
    for (let i = 0; i <= n; i++) out.push(planOf([itemAt('a', i, 0)]))
    return out
  }

  it('commit 60 次後棧深 50；第 50 次 undo 到最舊、第 51 次 no-op（同參考）', () => {
    const plans = series(60)
    let h = createHistory(plans[0])
    for (let i = 1; i <= 60; i++) h = commit(h, plans[i])
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.present).toBe(plans[60])

    for (let i = 0; i < HISTORY_LIMIT; i++) h = undo(h)
    expect(h.past).toHaveLength(0)
    // 被丟掉的是最舊的 10 份，留下的最舊者是 plans[10]。
    expect(h.present).toBe(plans[10])
    expect(undo(h)).toBe(h)
  })

  it('空棧 undo 與空 redo 皆回同一 History 參考', () => {
    const h = createHistory(planOf([]))
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('undo 後 redo 回到原位；再 commit 則清空 future', () => {
    const plans = series(2)
    let h = createHistory(plans[0])
    h = commit(h, plans[1])
    h = commit(h, plans[2])
    h = undo(h)
    expect(h.present).toBe(plans[1])
    expect(h.future).toHaveLength(1)

    const redone = redo(h)
    expect(redone.present).toBe(plans[2])
    expect(redone.future).toHaveLength(0)

    const branched = commit(h, planOf([itemAt('a', 99, 0)]))
    expect(branched.future).toHaveLength(0)
    expect(branched.past[branched.past.length - 1]).toBe(plans[1])
  })
})

/* ------------------------------------------------------------------ *
 * 拖移態（D10 純狀態部分）
 * ------------------------------------------------------------------ */

describe('拖移態 — begin／to／cancel／commit／interrupt', () => {
  /** 起手：past 一層、future 一層，便於觀察入棧與清 redo。 */
  function primed(): History {
    const snapshot = (x: number): RoomPlan => planOf([itemAt('a', x, 0), itemAt('b', 0, 200)])
    let h = createHistory(snapshot(0))
    h = commit(h, snapshot(5))
    h = commit(h, snapshot(8))
    return undo(h) // past 1 層、future 1 層
  }

  it('拖移期間只改 present，不入棧也不清 redo；commit 才入棧並清 future', () => {
    const h0 = primed()
    expect(h0.past).toHaveLength(1)
    expect(h0.future).toHaveLength(1)

    const drag = beginDrag(h0, 'a', 'item', 'pointer')
    let h = dragTo(h0, drag, 10, 0)
    h = dragTo(h, drag, 20, 0)
    h = dragTo(h, drag, 30, 0)
    expect(h.present.items[0].x).toBe(30)
    expect(h.past).toHaveLength(1)
    expect(h.future).toHaveLength(1)

    const committed = commitDrag(h, drag)
    expect(committed.past).toHaveLength(2)
    expect(committed.past[committed.past.length - 1]).toBe(drag.origin)
    expect(committed.future).toHaveLength(0)
    expect(committed.present.items[0].x).toBe(30)
  })

  it('cancelDrag 回 origin 並標記；之後的 dragTo 與 commitDrag 皆為 no-op', () => {
    const h0 = primed()
    const drag = beginDrag(h0, 'a', 'item', 'keyboard')
    const moved = dragTo(h0, drag, 40, 0)
    expect(moved.present).not.toBe(drag.origin)

    const cancelled = cancelDrag(moved, drag)
    expect(cancelled.drag.cancelled).toBe(true)
    expect(cancelled.history.present).toBe(drag.origin)
    expect(dragTo(cancelled.history, cancelled.drag, 99, 0)).toBe(cancelled.history)
    expect(commitDrag(cancelled.history, cancelled.drag)).toBe(cancelled.history)
    expect(cancelled.history.past).toHaveLength(1)
  })

  it('原地拖移（present === origin）不入棧', () => {
    const h0 = primed()
    const drag = beginDrag(h0, 'a', 'item', 'pointer')
    expect(commitDrag(h0, drag)).toBe(h0)
  })

  it('被拒的 dragTo 不動 History（非整數座標）', () => {
    const h0 = primed()
    const drag = beginDrag(h0, 'a', 'item', 'pointer')
    expect(dragTo(h0, drag, 1.5, 0)).toBe(h0)
  })

  it('dragTo 亦支援 block 與 door 兩種 kind', () => {
    const start = planOf([], [VESTIBULE_BLOCK])
    const h0 = createHistory(start)
    const blockDrag = beginDrag(h0, 'e1', 'block', 'pointer')
    const movedBlock = dragTo(h0, blockDrag, 300, 10)
    expect(movedBlock.present.room.blocks[0]).toMatchObject({ x: 300, y: 10 })

    const withDoor = expectOk(
      apply(planOf([]), { type: 'door/add', door: { id: 'd1', x: 100, y: 0, leafDir: '+', width: 80, swing: 'in' } }),
    )
    const h1 = createHistory(withDoor)
    const doorDrag = beginDrag(h1, 'd1', 'door', 'pointer')
    const movedDoor = dragTo(h1, doorDrag, 150, 0)
    expect(movedDoor.present.room.doors[0]).toMatchObject({ x: 150, wall: 'N' })
    // 非法落點被 apply 拒 → History 不動。
    expect(dragTo(movedDoor, doorDrag, 150, 123)).toBe(movedDoor)
  })

  it('靜默期間 undo：先 commit 再 undo（棧深 +1 後退回 origin）', () => {
    const h0 = primed()
    const before = h0.past.length
    const drag = beginDrag(h0, 'a', 'item', 'keyboard')
    const dragged = dragTo(h0, drag, 25, 0)
    expect(dragged.present.items[0].x).toBe(25)

    const after = interruptDrag(dragged, drag, undo)
    // commit 推進一層、undo 又退回一層 → 棧深回到拖移前。
    expect(after.past).toHaveLength(before)
    expect(after.present).toBe(drag.origin)
    expect(after.present).toEqual(drag.origin)
    // 被 commit 的拖移結果進了 redo，按重做鍵可再拿回來。
    expect(after.future[0].items[0].x).toBe(25)
    expect(redo(after).present.items[0].x).toBe(25)
  })

  it('靜默期間的其他 action 同樣先 commit（以 redo 為例）', () => {
    const h0 = primed()
    const drag = beginDrag(h0, 'a', 'item', 'pointer')
    const dragged = dragTo(h0, drag, 25, 0)
    const after = interruptDrag(dragged, drag, (h) =>
      commit(h, expectOk(apply(h.present, { type: 'item/delete', id: 'b' }))),
    )
    expect(after.past).toHaveLength(3)
    expect(after.present.items[1].deleted).toBe(true)
    expect(after.present.items[0].x).toBe(25)
  })
})
