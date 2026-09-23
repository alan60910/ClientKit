/**
 * T1.9（(internal design doc) §Verification「serialize」）：
 * 白名單重建（未知欄、`__proto__`、`1e309`、非法列舉、`snap:0`、閾值
 * `[100,'bad',75]` 與**純違序** `[80,60,75]` 皆整組退預設、門 `wall`
 * 偽造重推（r3.4 D7：幾何非法者**保留**並記資訊性 `door-unattached`，
 * 「縮房 → autosave → reload」門不得消失、round-trip 冪等）、
 * 非法／重複 id 重生、新產 id round-trip 不重生、10⁵ 件先截斷、
 * blocks 整組判定自尾端丟至 ≤200 且順序不影響「≤200」與等冪性）、部分壞
 * 保留其餘、版本遷移、`stripDeleted`（逐欄保留且原 plan 參考不變）、
 * hash round-trip 含中文＋emoji 與三種失敗、`domId` 前綴。
 *
 * 另含 §Verification「model」的一條：**`defaultPlan()` 過 `parsePlan`
 * 不變**。
 *
 * 門相關 fixture 一律用 D9 使用者玄關實例（基底 300×400、extend
 * x∈[300,360]×y∈[0,270]、門鉸鏈 (360,270)）。
 */
import { describe, expect, it } from 'vitest'
import { defaultPlan, DEFAULT_SETTINGS, ID_RE, LIMITS, MAX_ITEMS_DEFAULT, newId, type Furniture, type RoomBlock, type RoomPlan } from './model.js'
import { clearance } from './clearance.js'
import { apply } from './reducer.js'
import { normalize } from './room-shape.js'
import {
  countDropped,
  DEFAULT_COLOR,
  decodePlanHash,
  domId,
  encodePlanHash,
  HASH_RAW_MAX,
  HASH_SHARE_MAX,
  MIGRATION_STEPS,
  NAME_MAX_CODEPOINTS,
  parsePlan,
  PLAN_VERSION,
  serializePlan,
  stripDeleted,
  type DropNote,
  type HashResult,
  type MigrationStep,
  type ParseResult,
} from './serialize.js'

/* ------------------------------------------------------------------ *
 * 共用 helper
 * ------------------------------------------------------------------ */

function expectOk(result: ParseResult | HashResult): { plan: RoomPlan; dropped: DropNote[] } {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
  return { plan: result.plan, dropped: result.dropped }
}

/** D9 玄關實例的 room（extend E1 x∈[300,360]、y∈[0,270]）。 */
function vestibuleRoom(doors: unknown[] = []): Record<string, unknown> {
  return {
    width: 300,
    depth: 400,
    blocks: [{ id: 'e1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
    doors,
  }
}

/** 最小可用外殼；`patch` 覆寫任一頂層欄。 */
function planRaw(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    room: { width: 300, depth: 400, blocks: [], doors: [] },
    items: [],
    settings: { ...DEFAULT_SETTINGS },
    ...patch,
  }
}

const goodItem = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: newId(),
  name: '書桌',
  color: '#123456',
  width: 120,
  depth: 60,
  x: 10,
  y: 20,
  rotation: 0,
  passable: true,
  ...over,
})

/** D9 棋盤對抗集（縱 25 × 橫 25、基底 50×50 → normalize 650 條）。 */
function checkerboardBlocks(): RoomBlock[] {
  const blocks: RoomBlock[] = []
  for (let i = 0; i < 25; i++) {
    blocks.push({ id: `v${i}`, kind: 'cutout', x: 2 * i, y: 0, width: 1, depth: 50 })
  }
  for (let j = 0; j < 25; j++) {
    blocks.push({ id: `h${j}`, kind: 'cutout', x: 0, y: 2 * j, width: 50, depth: 1 })
  }
  return blocks
}

const reasonsOf = (dropped: DropNote[]): string[] => dropped.map((d) => d.reason)

/* ================================================================== *
 * 1. 契約常數與 defaultPlan round-trip
 * ================================================================== */

describe('契約常數', () => {
  it('PLAN_VERSION 1、名稱上限 30 code point、預設色為小寫 #rrggbb', () => {
    expect(PLAN_VERSION).toBe(1)
    expect(NAME_MAX_CODEPOINTS).toBe(30)
    expect(DEFAULT_COLOR).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('MIGRATION_STEPS 現為空表（v1 即現行版本），且凍結', () => {
    expect(Object.keys(MIGRATION_STEPS)).toHaveLength(0)
    expect(Object.isFrozen(MIGRATION_STEPS)).toBe(true)
  })

  it('hash 長度閘＝原始 32 KB／編碼後 8,000 字元', () => {
    expect(HASH_RAW_MAX).toBe(32 * 1024)
    expect(HASH_SHARE_MAX).toBe(8000)
  })
})

describe('defaultPlan() 過 parsePlan 不變（Verification「model」）', () => {
  it('ok、逐欄等於 defaultPlan()、dropped 為空', () => {
    const result = expectOk(parsePlan(defaultPlan()))
    expect(result.plan).toEqual(defaultPlan())
    expect(result.dropped).toEqual([])
  })

  it('JSON 字串形同樣不變', () => {
    const result = expectOk(parsePlan(JSON.stringify(defaultPlan())))
    expect(result.plan).toEqual(defaultPlan())
    expect(result.dropped).toEqual([])
  })
})

/* ================================================================== *
 * 2. 敵意輸入表格（D7 白名單）
 * ================================================================== */

describe('白名單重建 — 未知欄不搬運', () => {
  it('頂層／巢狀未知欄皆不出現在輸出，且鍵序為白名單順序', () => {
    const raw = planRaw({
      nope: 'x',
      room: { width: 300, depth: 400, blocks: [], doors: [], extra: 1 },
      items: [goodItem({ color: '#ABCDEF', bogus: 9 })],
      settings: { ...DEFAULT_SETTINGS, junk: true },
    })
    const { plan } = expectOk(parsePlan(raw))
    expect(Object.keys(plan)).toEqual(['version', 'room', 'items', 'settings'])
    expect(Object.keys(plan.room)).toEqual(['width', 'depth', 'blocks', 'doors'])
    expect(Object.keys(plan.items[0])).toEqual([
      'id',
      'name',
      'color',
      'width',
      'depth',
      'x',
      'y',
      'rotation',
      'passable',
    ])
    expect(Object.keys(plan.settings)).toEqual([
      'ignoreBelow',
      'warnBelow',
      'adviseBelow',
      'snap',
      'showSwing',
      'maxItems',
    ])
    // 大寫 hex 合法但一律小寫化
    expect(plan.items[0].color).toBe('#abcdef')
  })
})

describe('白名單重建 — __proto__ 不污染', () => {
  it('items 內的 __proto__ 鍵既不污染 Object.prototype 也不成為自有欄', () => {
    const raw = JSON.parse(
      '{"version":1,"room":{"width":300,"depth":400,"blocks":[],"doors":[]},' +
        '"items":[{"id":"aaaa1111","name":"x","width":10,"depth":10,' +
        '"__proto__":{"polluted":1}}],"settings":{}}',
    ) as unknown
    const { plan } = expectOk(parsePlan(raw))
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    expect(plan.items).toHaveLength(1)
    expect(Object.hasOwn(plan.items[0], 'polluted')).toBe(false)
    expect(Object.hasOwn(plan.items[0], '__proto__')).toBe(false)
  })

  it('頂層 __proto__ 物件（無 version）→ unsupported-version 且不污染', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":1}}') as unknown
    expect(parsePlan(raw)).toEqual({ ok: false, reason: 'unsupported-version' })
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('原型鏈上的 version 不算數（自有屬性才讀）', () => {
    const polluted = Object.create({ version: 1 }) as Record<string, unknown>
    polluted.items = []
    expect(parsePlan(polluted)).toEqual({ ok: false, reason: 'unsupported-version' })
  })
})

describe('白名單重建 — 數值範圍（家具寬深）', () => {
  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['字串 "12"', '12'],
    ['1e309（JSON 解析後為 Infinity）', JSON.parse('1e309') as unknown],
    ['小數 12.5', 12.5],
    ['0（低於下限）', 0],
    ['5001（高於上限）', 5001],
    ['null', null],
  ])('width=%s → 整件丟棄並記 note', (_label, width) => {
    const raw = planRaw({ items: [goodItem({ width })] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(0)
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'width', level: 'drop' }])
  })

  it('room 寬深非法 → 退 DEFAULT_ROOM 並記 note', () => {
    const raw = planRaw({ room: { width: 0, depth: 99999, blocks: [], doors: [] } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.room.width).toBe(300)
    expect(plan.room.depth).toBe(400)
    expect(dropped).toEqual([
      { path: 'room', reason: 'width', level: 'drop' },
      { path: 'room', reason: 'depth', level: 'drop' },
    ])
  })
})

describe('白名單重建 — 列舉', () => {
  it('rotation 45 → 退 0 且保留該件', () => {
    const raw = planRaw({ items: [goodItem({ rotation: 45 })] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].rotation).toBe(0)
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'rotation', level: 'drop' }])
  })

  it("block kind 'hole' → 丟該塊", () => {
    const raw = planRaw({
      room: {
        width: 300,
        depth: 400,
        blocks: [{ id: 'b1', kind: 'hole', x: 0, y: 0, width: 10, depth: 10 }],
        doors: [],
      },
    })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.room.blocks).toHaveLength(0)
    expect(dropped).toEqual([{ path: 'blocks[0]', reason: 'kind', level: 'drop' }])
  })

  it.each([
    ['leafDir', { leafDir: 'x' }, 'leafDir'],
    ['swing', { swing: 'up' }, 'swing'],
  ])('門 %s 非法 → 丟該扇', (_label, over, reason) => {
    const door = { id: 'd1', x: 360, y: 270, leafDir: '-', width: 70, swing: 'in', ...over }
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors).toHaveLength(0)
    expect(dropped).toEqual([{ path: 'doors[0]', reason, level: 'drop' }])
  })

  it('passable 非布林 → 退 true 且保留該件', () => {
    const raw = planRaw({ items: [goodItem({ passable: 'yes' })] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items[0].passable).toBe(true)
    expect(reasonsOf(dropped)).toEqual(['passable'])
  })

  it('color 非法 → 退預設色且保留該件', () => {
    const raw = planRaw({ items: [goodItem({ color: 'red' })] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items[0].color).toBe(DEFAULT_COLOR)
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'color', level: 'drop' }])
  })
})

describe('白名單重建 — settings', () => {
  it('snap: 0 → 退預設 5', () => {
    const raw = planRaw({ settings: { ...DEFAULT_SETTINGS, snap: 0 } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.snap).toBe(DEFAULT_SETTINGS.snap)
    expect(dropped).toEqual([{ path: 'settings', reason: 'snap', level: 'drop' }])
  })

  it.each([1, 5, 10])('snap: %s 為合法列舉', (snap) => {
    const raw = planRaw({ settings: { ...DEFAULT_SETTINGS, snap } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.snap).toBe(snap)
    expect(dropped).toEqual([])
  })

  it("閾值 [100, 'bad', 75]（含非法值）→ 三者整組退預設", () => {
    const raw = planRaw({
      settings: { ignoreBelow: 100, warnBelow: 'bad', adviseBelow: 75, snap: 5, showSwing: true },
    })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.ignoreBelow).toBe(DEFAULT_SETTINGS.ignoreBelow)
    expect(plan.settings.warnBelow).toBe(DEFAULT_SETTINGS.warnBelow)
    expect(plan.settings.adviseBelow).toBe(DEFAULT_SETTINGS.adviseBelow)
    expect(dropped).toEqual([{ path: 'settings', reason: 'thresholds', level: 'drop' }])
  })

  it('閾值 [80, 60, 75]（數值皆合法、**純違序**）→ 三者整組退預設', () => {
    const raw = planRaw({
      settings: { ignoreBelow: 80, warnBelow: 60, adviseBelow: 75, snap: 5, showSwing: true },
    })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.ignoreBelow).toBe(5)
    expect(plan.settings.warnBelow).toBe(60)
    expect(plan.settings.adviseBelow).toBe(75)
    expect(dropped).toEqual([{ path: 'settings', reason: 'thresholds', level: 'drop' }])
  })

  it('閾值三者相等（0 ≤ a ≤ b ≤ c 的邊界）→ 原樣採用', () => {
    const raw = planRaw({
      settings: { ignoreBelow: 60, warnBelow: 60, adviseBelow: 60, snap: 5, showSwing: true },
    })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.ignoreBelow).toBe(60)
    expect(plan.settings.adviseBelow).toBe(60)
    expect(dropped).toEqual([])
  })

  it('T4.7：缺 maxItems 欄 → 退預設 20 且不記 note', () => {
    const settings = { ...DEFAULT_SETTINGS } as Record<string, unknown>
    delete settings.maxItems
    const { plan, dropped } = expectOk(parsePlan(planRaw({ settings })))
    expect(plan.settings.maxItems).toBe(MAX_ITEMS_DEFAULT)
    expect(dropped).toEqual([])
  })

  it.each([
    ['字串', 'abc'],
    ['零', 0],
    ['超出硬上限', 76],
    ['非整數', 20.5],
    ['負值', -1],
  ])('T4.7：maxItems 為%s → 退預設 20 並記 note', (_label, maxItems) => {
    const raw = planRaw({ settings: { ...DEFAULT_SETTINGS, maxItems } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.maxItems).toBe(MAX_ITEMS_DEFAULT)
    expect(dropped).toEqual([{ path: 'settings', reason: 'maxItems', level: 'drop' }])
  })

  it.each([1, 20, 21, 75])('T4.7：maxItems %s 為合法值', (maxItems) => {
    const raw = planRaw({ settings: { ...DEFAULT_SETTINGS, maxItems } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.maxItems).toBe(maxItems)
    expect(dropped).toEqual([])
  })

  it('T4.7：30 件家具但 maxItems 20 → 抬高至 30、家具一件不少', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      goodItem({ id: `item${String(i).padStart(4, '0')}`, x: 0, y: 0 }),
    )
    const raw = planRaw({ items, settings: { ...DEFAULT_SETTINGS, maxItems: MAX_ITEMS_DEFAULT } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(30)
    expect(plan.settings.maxItems).toBe(30)
    expect(dropped).toEqual([{ path: 'settings', reason: 'maxItems-raised', level: 'info' }])
  })

  it('T4.7：舊版存檔（無 settings 欄）帶 25 件家具 → maxItems 抬到 25', () => {
    const items = Array.from({ length: 25 }, (_, i) =>
      goodItem({ id: `item${String(i).padStart(4, '0')}`, x: 0, y: 0 }),
    )
    const raw = planRaw({ items })
    delete raw.settings
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(25)
    expect(plan.settings.maxItems).toBe(25)
    expect(reasonsOf(dropped)).toEqual(['maxItems-raised'])
  })

  it('T4.8：`maxItems-raised` 為 info 筆——countDropped 不計進 drop', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      goodItem({ id: `item${String(i).padStart(4, '0')}`, x: 0, y: 0 }),
    )
    const raw = planRaw({ items })
    delete raw.settings
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.settings.maxItems).toBe(30)
    expect(countDropped(dropped)).toEqual({ drop: 0, info: 1 })
  })

  it('T4.8：抬高軟上限＋1 件壞家具同時發生 → countDropped 為 {drop:1, info:1}', () => {
    const items = [
      goodItem({ name: '\u0007' }), // 控制字元 → 丟棄（level: 'drop'）
      ...Array.from({ length: 30 }, (_, i) =>
        goodItem({ id: `item${String(i).padStart(4, '0')}`, x: 0, y: 0 }),
      ),
    ]
    const raw = planRaw({ items })
    delete raw.settings
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(30)
    expect(plan.settings.maxItems).toBe(30)
    expect(countDropped(dropped)).toEqual({ drop: 1, info: 1 })
  })

  it('showSwing 非布林 → 退預設；settings 非物件 → 整組預設', () => {
    const a = expectOk(parsePlan(planRaw({ settings: { ...DEFAULT_SETTINGS, showSwing: 1 } })))
    expect(a.plan.settings.showSwing).toBe(true)
    expect(reasonsOf(a.dropped)).toEqual(['showSwing'])

    const b = expectOk(parsePlan(planRaw({ settings: 'nope' })))
    expect(b.plan.settings).toEqual(DEFAULT_SETTINGS)
    expect(reasonsOf(b.dropped)).toEqual(['not-object'])
  })
})

describe('白名單重建 — 名稱字元集與 code point 長度', () => {
  it('恰 30 code point（含 emoji）→ 保留', () => {
    const name = '衣'.repeat(29) + '🛏'
    expect(Array.from(name)).toHaveLength(30)
    const { plan, dropped } = expectOk(parsePlan(planRaw({ items: [goodItem({ name })] })))
    expect(plan.items[0].name).toBe(name)
    expect(dropped).toEqual([])
  })

  it.each([
    ['31 code point', '衣'.repeat(31)],
    ['C0 控制字元', '好\u0001名'],
    ['DEL', '好\u007F名'],
    ['U+FFFE', '好\uFFFE名'],
    ['U+FFFF', '好\uFFFF名'],
    ['孤立高位代理', '好\uD800名'],
    ['孤立低位代理', '好\uDC00名'],
    ['非字串', 123],
    ['超長字串（先以 UTF-16 長度粗篩）', 'a'.repeat(10000)],
  ])('%s → 丟該件', (_label, name) => {
    const { plan, dropped } = expectOk(parsePlan(planRaw({ items: [goodItem({ name })] })))
    expect(plan.items).toHaveLength(0)
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'name', level: 'drop' }])
  })

  it('完整代理對（emoji）不被誤判為孤立代理', () => {
    const { plan } = expectOk(parsePlan(planRaw({ items: [goodItem({ name: '衣櫃 🛏️' })] })))
    expect(plan.items[0].name).toBe('衣櫃 🛏️')
  })
})

describe('白名單重建 — clearances 與 deleted', () => {
  it('只留 N/E/S/W 的正整數；非法值記 note、未知鍵靜默忽略', () => {
    const raw = planRaw({ items: [goodItem({ clearances: { N: 60, E: 0, X: 5 } })] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items[0].clearances).toEqual({ N: 60 })
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'clearances', level: 'drop' }])
  })

  it('全無合法鍵 → 省略該欄', () => {
    const { plan } = expectOk(parsePlan(planRaw({ items: [goodItem({ clearances: {} })] })))
    expect(Object.hasOwn(plan.items[0], 'clearances')).toBe(false)
  })

  it('deleted 僅接受字面 true', () => {
    const raw = planRaw({
      items: [
        goodItem({ deleted: true }),
        goodItem({ deleted: false }),
        goodItem({ deleted: 'yes' }),
      ],
    })
    const { plan } = expectOk(parsePlan(raw))
    expect(plan.items[0].deleted).toBe(true)
    expect(Object.hasOwn(plan.items[1], 'deleted')).toBe(false)
    expect(Object.hasOwn(plan.items[2], 'deleted')).toBe(false)
  })
})

describe('白名單重建 — x/y 夾至正規化外接框', () => {
  it('純矩形房：超界座標夾回框內（含負座標）', () => {
    const raw = planRaw({
      items: [
        goodItem({ width: 100, depth: 50, x: 1000, y: -50, rotation: 0 }),
        goodItem({ width: 100, depth: 50, x: -1000, y: 9999, rotation: 0 }),
      ],
    })
    const { plan } = expectOk(parsePlan(raw))
    expect({ x: plan.items[0].x, y: plan.items[0].y }).toEqual({ x: 200, y: 0 })
    expect({ x: plan.items[1].x, y: plan.items[1].y }).toEqual({ x: 0, y: 350 })
  })

  it('夾的是**有效外框**：rotation 90 時以互換後寬深為準', () => {
    const raw = planRaw({ items: [goodItem({ width: 100, depth: 50, x: 1000, y: 1000, rotation: 90 })] })
    const { plan } = expectOk(parsePlan(raw))
    // 有效外框 50 寬 100 深 → x ≤ 300−50、y ≤ 400−100
    expect({ x: plan.items[0].x, y: plan.items[0].y }).toEqual({ x: 250, y: 300 })
  })

  it('外接框含負座標（extend 貼西側）時夾到負原點', () => {
    const room = {
      width: 300,
      depth: 400,
      blocks: [{ id: 'w1', kind: 'extend', x: -60, y: 0, width: 60, depth: 100 }],
      doors: [],
    }
    const raw = planRaw({ room, items: [goodItem({ width: 10, depth: 10, x: -9999, y: 0 })] })
    const { plan } = expectOk(parsePlan(raw))
    expect(plan.items[0].x).toBe(-60)
  })

  it('x 非整數 → 退 0 並記 note（缺欄則不記）', () => {
    const withBad = expectOk(parsePlan(planRaw({ items: [goodItem({ x: 1.5 })] })))
    expect(withBad.plan.items[0].x).toBe(0)
    expect(reasonsOf(withBad.dropped)).toEqual(['x'])

    const noKey = goodItem()
    delete noKey.x
    delete noKey.y
    const missing = expectOk(parsePlan(planRaw({ items: [noKey] })))
    expect(missing.plan.items[0].x).toBe(0)
    expect(missing.dropped).toEqual([])
  })
})

/* ================================================================== *
 * 3. 門：wall 重推、欄位級丟棄、幾何非法**保留**（r3.4 D7）
 * ================================================================== */

describe('門（D6／D7）', () => {
  it("偽造 wall:'N' 的玄關東牆門 → 重推為 'E'", () => {
    const door = { id: 'd1', x: 360, y: 270, wall: 'N', leafDir: '-', width: 70, swing: 'in' }
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors).toHaveLength(1)
    expect(plan.room.doors[0].wall).toBe('E')
    expect(Object.keys(plan.room.doors[0])).toEqual([
      'id',
      'x',
      'y',
      'wall',
      'leafDir',
      'width',
      'swing',
    ])
    expect(dropped).toEqual([])
  })

  it('鉸鏈不在任何極大牆段上 → **保留**該扇並記資訊性 door-unattached', () => {
    const door = { id: 'd1', x: 150, y: 200, leafDir: '+', width: 70, swing: 'in' }
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors).toHaveLength(1)
    expect(plan.room.doors[0]).toEqual({
      id: 'd1',
      x: 150,
      y: 200,
      wall: 'N',
      leafDir: '+',
      width: 70,
      swing: 'in',
    })
    expect(dropped).toEqual([{ path: 'doors[0]', reason: 'door-unattached', level: 'info' }])
    expect(countDropped(dropped)).toEqual({ drop: 0, info: 1 })
  })

  it('門扇跨距超出極大牆段 → **保留**該扇並記資訊性 door-unattached', () => {
    // 鉸鏈在東牆 (360,270)，leafDir '+' 會往 y>270 延伸，但該牆段止於 270
    const door = { id: 'd1', x: 360, y: 270, leafDir: '+', width: 70, swing: 'in' }
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors).toHaveLength(1)
    expect(plan.room.doors[0].x).toBe(360)
    expect(plan.room.doors[0].wall).toBe('N')
    expect(dropped).toEqual([{ path: 'doors[0]', reason: 'door-unattached', level: 'info' }])
  })

  it.each([
    ["非法列舉 'Z' → 佔位 'N'", 'Z', 'N'],
    ["合法列舉 'E' → 保留 'E'", 'E', 'E'],
    ['缺欄 → 佔位 N', undefined, 'N'],
  ])('未附著門的 wall 取值：%s', (_label, input, expected) => {
    const door: Record<string, unknown> = {
      id: 'd1',
      x: 150,
      y: 200,
      leafDir: '+',
      width: 70,
      swing: 'in',
    }
    if (input !== undefined) door.wall = input
    const { plan } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors[0].wall).toBe(expected)
  })

  it('門寬非法／座標非整數 → 丟該扇', () => {
    const doors = [
      { id: 'd1', x: 360, y: 270, leafDir: '-', width: 0, swing: 'in' },
      { id: 'd2', x: 360.5, y: 270, leafDir: '-', width: 70, swing: 'in' },
    ]
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom(doors) })))
    expect(plan.room.doors).toHaveLength(0)
    expect(reasonsOf(dropped)).toEqual(['width', 'x'])
  })

  it.each([
    ['x 超出 10000', 10001, 270, 'x'],
    ['x 低於 −5000', -5001, 270, 'x'],
    ['y 超出 10000', 360, 10001, 'y'],
    ['y 低於 −5000', 360, -5001, 'y'],
  ])('座標超出 [−5000, 10000] → 丟該扇（%s）', (_label, x, y, reason) => {
    const door = { id: 'd1', x, y, leafDir: '-', width: 70, swing: 'in' }
    const { plan, dropped } = expectOk(parsePlan(planRaw({ room: vestibuleRoom([door]) })))
    expect(plan.room.doors).toHaveLength(0)
    expect(dropped).toEqual([{ path: 'doors[0]', reason, level: 'drop' }])
  })
})

/* ================================================================== *
 * 3b. 縮房 → autosave → reload：門不得憑空消失（review 🟡-3）
 * ================================================================== */

describe('未附著門的保留與冪等（r3.4 D7 × D6）', () => {
  /** 300×400 純矩形房＋東牆門 (300,270)，再縮成 250×400 使該門脫離牆段。 */
  function shrunkPlan(): RoomPlan {
    const base = expectOk(parsePlan(planRaw())).plan
    const withDoor = apply(base, {
      type: 'door/add',
      door: { id: 'd1', x: 300, y: 270, leafDir: '-', width: 70, swing: 'in' },
    })
    if (!withDoor.ok) throw new Error(`door/add rejected: ${withDoor.rejection.reason}`)
    expect(withDoor.plan.room.doors[0].wall).toBe('E')
    const shrunk = apply(withDoor.plan, { type: 'room/set', width: 250, depth: 400 })
    if (!shrunk.ok) throw new Error(`room/set rejected: ${shrunk.rejection.reason}`)
    // reducer 依 D6 把非法門留在 plan（report 標「門未附著」）
    expect(shrunk.plan.room.doors).toHaveLength(1)
    return shrunk.plan
  }

  it('reducer 留下的未附著門過 parsePlan 仍在，且只記一筆資訊性註', () => {
    const { plan, dropped } = expectOk(parsePlan(JSON.stringify(shrunkPlan())))
    expect(plan.room.doors).toHaveLength(1)
    expect(plan.room.doors[0].id).toBe('d1')
    expect(plan.room.doors[0].x).toBe(300)
    expect(plan.room.doors[0].y).toBe(270)
    expect(dropped).toContainEqual({ path: 'doors[0]', reason: 'door-unattached', level: 'info' })
    expect(countDropped(dropped).drop).toBe(0)
  })

  it('保留的未附著門 round-trip 冪等（再一次 parsePlan 逐欄相同）', () => {
    const first = expectOk(parsePlan(JSON.stringify(shrunkPlan())))
    const second = expectOk(parsePlan(JSON.stringify(first.plan)))
    expect(second.plan.room.doors).toEqual(first.plan.room.doors)
    expect(second.plan).toEqual(first.plan)
    expect(second.dropped).toEqual(first.dropped)
  })

  it('未附著門 wall 佔位後，clearance 仍判其未附著（不參與 doorViolations）', () => {
    const { plan } = expectOk(parsePlan(JSON.stringify(shrunkPlan())))
    const report = clearance(plan)
    expect(report.unattachedDoors).toEqual(['d1'])
    expect(report.doorViolations).toEqual([])
  })
})

/* ================================================================== *
 * 4. id：重生、唯一性、round-trip
 * ================================================================== */

describe('id（D7：ID_RE、三陣列聯集唯一、先出現者勝）', () => {
  it('非法與重複 id 重生；合法且唯一者原樣保留', () => {
    const raw = planRaw({
      room: {
        width: 300,
        depth: 400,
        blocks: [{ id: 'dup', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
        doors: [{ id: 123, x: 360, y: 270, leafDir: '-', width: 70, swing: 'in' }],
      },
      items: [
        goodItem({ id: 'dup' }),
        goodItem({ id: 'a b' }),
        goodItem({ id: 'x'.repeat(33) }),
        goodItem({ id: 'keep-me_1' }),
      ],
    })
    const { plan, dropped } = expectOk(parsePlan(raw))

    // items 先於 blocks／doors 指派 → 'dup' 由 items[0] 取得
    expect(plan.items[0].id).toBe('dup')
    expect(plan.items[3].id).toBe('keep-me_1')
    expect(plan.room.blocks[0].id).not.toBe('dup')

    const ids = [
      ...plan.items.map((i) => i.id),
      ...plan.room.blocks.map((b) => b.id),
      ...plan.room.doors.map((d) => d.id),
    ]
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
    for (const id of ids) expect(id).toMatch(ID_RE)
    // items[1]／items[2]／blocks[0]／doors[0] 共四次重生
    expect(dropped.filter((d) => d.reason === 'id')).toHaveLength(4)
  })

  it('newId() 產出的 id round-trip 不被重生', () => {
    const id = newId()
    const { plan, dropped } = expectOk(parsePlan(planRaw({ items: [goodItem({ id })] })))
    expect(plan.items[0].id).toBe(id)
    expect(dropped).toEqual([])
  })

  it('缺 id 欄 → 重生並記 note', () => {
    const item = goodItem()
    delete item.id
    const { plan, dropped } = expectOk(parsePlan(planRaw({ items: [item] })))
    expect(plan.items[0].id).toMatch(ID_RE)
    expect(dropped).toEqual([{ path: 'items[0]', reason: 'id', level: 'drop' }])
  })
})

/* ================================================================== *
 * 5. 硬上限：先 slice、blocks 整組判定
 * ================================================================== */

describe('硬上限（D7／D9／D10）', () => {
  it('10⁵ 件家具 → 先 slice 至 75，且遠快於 1 秒', () => {
    const template = goodItem({ id: 'shared-id' })
    const raw = planRaw({ items: new Array(100000).fill(template) })
    const t0 = performance.now()
    const { plan, dropped } = expectOk(parsePlan(raw))
    const elapsed = performance.now() - t0
    expect(plan.items).toHaveLength(LIMITS.items)
    expect(plan.items).toHaveLength(75)
    expect(dropped[0]).toEqual({ path: 'items', reason: 'over-limit', level: 'drop' })
    expect(elapsed).toBeLessThan(2000)
  })

  it('doors／blocks 亦先 slice 至 10／50', () => {
    const door = { id: 'd1', x: 360, y: 270, leafDir: '-', width: 70, swing: 'in' }
    const blocks = new Array(60).fill({ kind: 'cutout', x: 0, y: 0, width: 1, depth: 1 })
    const raw = planRaw({
      room: { width: 300, depth: 400, blocks, doors: new Array(12).fill(door) },
    })
    const { dropped } = expectOk(parsePlan(raw))
    expect(dropped).toContainEqual({ path: 'blocks', reason: 'over-limit', level: 'drop' })
    expect(dropped).toContainEqual({ path: 'doors', reason: 'over-limit', level: 'drop' })
  })

  it('items／blocks／doors 非陣列 → 視為空', () => {
    const raw = planRaw({ items: 'nope', room: { width: 300, depth: 400, blocks: 1, doors: {} } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toEqual([])
    expect(plan.room.blocks).toEqual([])
    expect(plan.room.doors).toEqual([])
    expect(reasonsOf(dropped)).toEqual(['not-array', 'not-array', 'not-array'])
  })

  it('棋盤 50 塊（樸素 650 條）→ 自尾端丟至牆體 ≤200', () => {
    const blocks = checkerboardBlocks()
    expect(normalize({ width: 50, depth: 50, blocks }).walls.length).toBeGreaterThan(LIMITS.walls)

    const raw = planRaw({ room: { width: 50, depth: 50, blocks, doors: [] } })
    const { plan, dropped } = expectOk(parsePlan(raw))
    const walls = normalize(plan.room).walls.length
    expect(walls).toBeLessThanOrEqual(LIMITS.walls)
    // 整組判定的落點恰與 reducer 逐塊守衛的 S4 實測值一致（PLAN §Verification
    // 「棋盤 50 塊依序加入 → 32 收／18 拒／牆體 182」）——兩層上限同口徑。
    expect(plan.room.blocks).toHaveLength(32)
    expect(walls).toBe(182)
    expect(plan.room.blocks.length).toBeLessThan(blocks.length)
    // 被丟的是尾端的塊，逐塊記 note
    expect(dropped.filter((d) => d.reason === 'wall-limit')).toHaveLength(
      blocks.length - plan.room.blocks.length,
    )
    // 保留的塊為原陣列前綴（自尾端丟）
    for (let i = 0; i < plan.room.blocks.length; i++) {
      expect(plan.room.blocks[i].kind).toBe(blocks[i].kind)
      expect(plan.room.blocks[i].x).toBe(blocks[i].x)
      expect(plan.room.blocks[i].y).toBe(blocks[i].y)
    }
  })

  it('匯出→匯入等冪：parse(serialize(parse(x))) 等於 parse(x)', () => {
    const raw = planRaw({
      room: { width: 50, depth: 50, blocks: checkerboardBlocks(), doors: [] },
    })
    const once = expectOk(parsePlan(raw)).plan
    const twice = expectOk(parsePlan(serializePlan(once)))
    expect(twice.plan).toEqual(once)
    expect(twice.dropped).toEqual([])
  })

  it('輸入 blocks 重排後仍滿足牆體 ≤200', () => {
    const shuffled = checkerboardBlocks().reverse()
    const raw = planRaw({ room: { width: 50, depth: 50, blocks: shuffled, doors: [] } })
    const { plan } = expectOk(parsePlan(raw))
    expect(normalize(plan.room).walls.length).toBeLessThanOrEqual(LIMITS.walls)
  })
})

/* ================================================================== *
 * 6. 部分壞保留其餘
 * ================================================================== */

describe('drop-and-continue', () => {
  it('2 件好 + 1 件壞名稱 → 留 2 件、恰 1 筆 note', () => {
    const raw = planRaw({
      items: [goodItem({ name: '床' }), goodItem({ name: '\u0007' }), goodItem({ name: '書桌' })],
    })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items.map((i) => i.name)).toEqual(['床', '書桌'])
    expect(dropped).toEqual([{ path: 'items[1]', reason: 'name', level: 'drop' }])
  })

  it('不改動輸入 raw（含其陣列與元素）', () => {
    const raw = planRaw({
      room: { width: 50, depth: 50, blocks: checkerboardBlocks(), doors: [] },
      items: [goodItem({ id: 'dup' }), goodItem({ id: 'dup', color: 'red' })],
    })
    const before = structuredClone(raw)
    expectOk(parsePlan(raw))
    expect(raw).toEqual(before)
  })

  it('非物件元素逐個丟棄，其餘照留', () => {
    const raw = planRaw({ items: [null, goodItem(), 42] })
    const { plan, dropped } = expectOk(parsePlan(raw))
    expect(plan.items).toHaveLength(1)
    expect(reasonsOf(dropped)).toEqual(['not-object', 'not-object'])
  })
})

/* ================================================================== *
 * 7. 版本遷移與整份失敗
 * ================================================================== */

describe('版本遷移（比照 statusline MIGRATION_STEPS）', () => {
  const stepTo1: MigrationStep = (old) => ({ ...old, version: 1 })

  it('version 0 + 注入步進 → 成功遷移', () => {
    const raw = planRaw({ version: 0 })
    const { plan } = expectOk(parsePlan(raw, { steps: { 0: stepTo1 } }))
    expect(plan.version).toBe(1)
  })

  it('version 0 無步進（預設空表）→ unsupported-version', () => {
    expect(parsePlan(planRaw({ version: 0 }))).toEqual({
      ok: false,
      reason: 'unsupported-version',
    })
  })

  it('連續兩步接力：−1 → 0 → 1，欄位沿路接力', () => {
    const steps: Record<number, MigrationStep> = {
      [-1]: (old) => ({ ...old, relay: 'a' }),
      0: (old) => ({ ...old, relay: `${String(old.relay)}b` }),
    }
    const raw = planRaw({ version: -1, items: [goodItem({ name: '沿路保留' })] })
    const { plan } = expectOk(parsePlan(raw, { steps }))
    expect(plan.version).toBe(1)
    expect(plan.items[0].name).toBe('沿路保留')
    // relay 為遷移中繼欄，非白名單欄位 → 不進輸出
    expect(Object.hasOwn(plan, 'relay')).toBe(false)
  })

  it.each([
    ['version 2（高於現行版本）', 2],
    ['version 缺欄', undefined],
    ['version 為字串 "1"', '1'],
    ['version 為小數 1.5', 1.5],
  ])('%s → unsupported-version', (_label, version) => {
    const raw = planRaw()
    if (version === undefined) delete raw.version
    else raw.version = version
    expect(parsePlan(raw)).toEqual({ ok: false, reason: 'unsupported-version' })
  })

  it('即使提供了高版本步進，version > PLAN_VERSION 仍拒收（無降版路徑）', () => {
    const steps: Record<number, MigrationStep> = { 2: (old) => ({ ...old }) }
    expect(parsePlan(planRaw({ version: 2 }), { steps })).toEqual({
      ok: false,
      reason: 'unsupported-version',
    })
  })
})

describe('整份失敗的三種出口', () => {
  it('壞 JSON 字串 → not-json', () => {
    expect(parsePlan('{ nope')).toEqual({ ok: false, reason: 'not-json' })
  })

  it.each([
    ['陣列', [] as unknown],
    ['null', null],
    ['數字', 42],
    ['JSON 字串 "null"', 'null'],
    ['JSON 字串 "[]"', '[]'],
    ['undefined', undefined],
  ])('%s → not-object', (_label, raw) => {
    expect(parsePlan(raw)).toEqual({ ok: false, reason: 'not-object' })
  })
})

/* ================================================================== *
 * 8. stripDeleted／serializePlan
 * ================================================================== */

describe('stripDeleted', () => {
  const sourcePlan = (): RoomPlan => ({
    version: 1,
    room: {
      width: 300,
      depth: 400,
      blocks: [{ id: 'b1', kind: 'extend', x: 300, y: 0, width: 60, depth: 270 }],
      doors: [{ id: 'd1', x: 360, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }],
    },
    items: [
      {
        id: 'i1',
        name: '衣櫃',
        color: '#9db4d6',
        width: 120,
        depth: 60,
        x: 0,
        y: 0,
        rotation: 0,
        passable: true,
        clearances: { S: 90 },
      },
      {
        id: 'i2',
        name: '已刪除',
        color: '#112233',
        width: 45,
        depth: 40,
        x: 10,
        y: 10,
        rotation: 90,
        passable: true,
        deleted: true,
      },
    ],
    settings: { ...DEFAULT_SETTINGS },
  })

  it('移除 deleted 家具，其餘逐欄保留', () => {
    const plan = sourcePlan()
    const stripped = stripDeleted(plan)
    expect(stripped.items).toHaveLength(1)
    expect(stripped.items[0]).toEqual(plan.items[0])
    expect(stripped.room).toEqual(plan.room)
    expect(stripped.settings).toEqual(plan.settings)
  })

  it('輸出為全新物件圖（含 clearances 子物件）', () => {
    const plan = sourcePlan()
    const stripped = stripDeleted(plan)
    expect(stripped).not.toBe(plan)
    expect(stripped.items).not.toBe(plan.items)
    expect(stripped.items[0]).not.toBe(plan.items[0])
    expect(stripped.items[0].clearances).not.toBe(plan.items[0].clearances)
    expect(stripped.room).not.toBe(plan.room)
    expect(stripped.room.blocks).not.toBe(plan.room.blocks)
    expect(stripped.room.blocks[0]).not.toBe(plan.room.blocks[0])
    expect(stripped.room.doors[0]).not.toBe(plan.room.doors[0])
    expect(stripped.settings).not.toBe(plan.settings)
  })

  it('原 plan 與其陣列不被改動', () => {
    const plan = sourcePlan()
    const before = structuredClone(plan)
    const stripped = stripDeleted(plan)
    stripped.items[0].x = 999
    stripped.room.blocks.push({ id: 'zz', kind: 'cutout', x: 0, y: 0, width: 1, depth: 1 })
    expect(plan).toEqual(before)
    expect(plan.items).toHaveLength(2)
    expect(plan.items[1].deleted).toBe(true)
  })

  it('serializePlan 恆經 stripDeleted', () => {
    const plan = sourcePlan()
    const json = serializePlan(plan)
    expect(json).not.toContain('已刪除')
    expect(JSON.parse(json)).toEqual(stripDeleted(plan))
  })
})

/* ================================================================== *
 * 9. hash 編解碼（OQ3）
 * ================================================================== */

describe('hash 編解碼', () => {
  const sharePlan = (): RoomPlan =>
    expectOk(
      parsePlan(
        planRaw({
          room: vestibuleRoom([
            { id: 'door0001', x: 360, y: 270, leafDir: '-', width: 70, swing: 'in' },
          ]),
          items: [
            goodItem({
              id: 'item0001',
              name: '衣櫃 🛏️',
              color: '#ff8800',
              width: 120,
              depth: 60,
              x: 10,
              y: 20,
              rotation: 90,
              passable: false,
              clearances: { S: 90 },
            }),
            goodItem({ id: 'item0002', name: '書桌／椅', x: 0, y: 200 }),
          ],
          settings: { ignoreBelow: 5, warnBelow: 60, adviseBelow: 75, snap: 10, showSwing: false },
        }),
      ),
    ).plan

  it('round-trip（含中文＋emoji）：payload 形', () => {
    const plan = sharePlan()
    const encoded = encodePlanHash(plan)
    expect(encoded).not.toBeNull()
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    const decoded = expectOk(decodePlanHash(encoded as string))
    expect(decoded.plan).toEqual(plan)
    expect(decoded.dropped).toEqual([])
  })

  it("round-trip：完整 '#plan=' 前綴形", () => {
    const plan = sharePlan()
    const encoded = encodePlanHash(plan) as string
    const decoded = expectOk(decodePlanHash(`#plan=${encoded}`))
    expect(decoded.plan).toEqual(plan)
  })

  it('round-trip：百分號編碼過的 payload（decodeURIComponent 容錯）', () => {
    const plan = sharePlan()
    const encoded = encodePlanHash(plan) as string
    const pct =
      '%' + encoded.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase() + encoded.slice(1)
    const decoded = expectOk(decodePlanHash(`#plan=${pct}`))
    expect(decoded.plan).toEqual(plan)
  })

  it('壞的百分號序列不擲錯，續以原字串判定', () => {
    // '%zz' 會讓 decodeURIComponent 擲 URIError；落回原字串後字元集不合法
    expect(decodePlanHash('#plan=%zz')).toEqual({ ok: false, reason: 'decode-failed' })
  })

  it('失敗一：原始 hash 超過 32 KB → too-long', () => {
    const raw = '#plan=' + 'a'.repeat(HASH_RAW_MAX)
    expect(raw.length).toBeGreaterThan(HASH_RAW_MAX)
    expect(decodePlanHash(raw)).toEqual({ ok: false, reason: 'too-long' })
  })

  it.each([
    ['非 base64 字元', '!!!!'],
    ['長度 %4===1', 'AAAAA'],
    ['非法 UTF-8 位元組（0xff 0xfe 0xfd）', '__79'],
  ])('失敗二：%s → decode-failed', (_label, payload) => {
    expect(decodePlanHash(`#plan=${payload}`)).toEqual({ ok: false, reason: 'decode-failed' })
  })

  it("失敗三：合法 base64 的 '[]' → not-object（透傳 parsePlan）", () => {
    expect(decodePlanHash('#plan=W10')).toEqual({ ok: false, reason: 'not-object' })
  })

  it('壞 JSON 的合法 base64 → not-json（透傳）', () => {
    const payload = btoa('{ nope').replace(/=+$/, '')
    expect(decodePlanHash(payload)).toEqual({ ok: false, reason: 'not-json' })
  })

  it('編碼超過 8,000 字元 → 回 null（不產生連結）', () => {
    const items: Furniture[] = []
    for (let i = 0; i < LIMITS.items; i++) {
      items.push({
        id: `item${String(i).padStart(4, '0')}`,
        name: '長'.repeat(NAME_MAX_CODEPOINTS),
        color: '#9db4d6',
        width: 120,
        depth: 60,
        x: 0,
        y: 0,
        rotation: 0,
        passable: true,
      })
    }
    const plan: RoomPlan = {
      version: 1,
      room: { width: 300, depth: 400, blocks: [], doors: [] },
      items,
      settings: { ...DEFAULT_SETTINGS },
    }
    expect(serializePlan(plan).length).toBeGreaterThan(HASH_SHARE_MAX)
    expect(encodePlanHash(plan)).toBeNull()
  })

  it('deleted 家具不進分享連結', () => {
    const plan = sharePlan()
    const withDeleted: RoomPlan = {
      ...plan,
      items: [...plan.items, { ...plan.items[0], id: 'gone0001', name: '不該出現', deleted: true }],
    }
    const decoded = expectOk(decodePlanHash(encodePlanHash(withDeleted) as string))
    expect(decoded.plan.items.map((i) => i.name)).not.toContain('不該出現')
    expect(decoded.plan.items).toHaveLength(plan.items.length)
  })
})

/* ================================================================== *
 * 10. domId
 * ================================================================== */

describe('domId（D7：裸 id 不進 DOM）', () => {
  it.each([
    ['item' as const, 'item-abc123'],
    ['block' as const, 'block-abc123'],
    ['door' as const, 'door-abc123'],
  ])('%s → %s', (kind, expected) => {
    expect(domId(kind, 'abc123')).toBe(expected)
  })
})
