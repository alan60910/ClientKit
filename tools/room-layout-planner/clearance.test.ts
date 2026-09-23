/**
 * T1.7（(internal design doc) §D3 四段半開區間、§D4 通道／
 * 碰撞／遮擋／門洞（含 r3.4 條件 (b) 的**雙向容差**：超出與短缺皆計，
 * 真子集間距區間不得誤標門洞）／同牆面合併／`passable`／`maxGap` 兩路徑、§D5
 * `sideViolations`、§D6 相交謂詞、§D9 玄關實例正案與反向案 (a)–(f)、
 * §Verification「clearance」全清單）。
 *
 * 差分 oracle 的 O1–O4 fixture 直接移植自 M0 spike
 * `(internal design doc)` 的 `oracleFixtures()`
 * （S1 已證三路徑 deepEqual 且索引版遮擋測試次數嚴格較少），另以 `cellSize`
 * 參數化並加入玄關實例。
 *
 * 全檔以 `analyze()`／`analyzePlan()` 取報告——兩者內建「樸素路徑 ≡ 索引
 * 路徑」斷言，故每一個 fixture 同時是一筆差分 oracle 案。
 */
import { describe, expect, it } from 'vitest'
import {
  buildClearanceInput,
  clearance,
  clearanceCore,
  levelFor,
  type ClearanceDoor,
  type ClearanceInput,
  type ClearanceItem,
  type ClearanceWall,
} from './clearance.js'
import { doorGeometry } from './door.js'
import type { Rect } from './geometry.js'
import {
  DEFAULT_SETTINGS,
  type ClearanceReport,
  type Corridor,
  type Door,
  type Furniture,
  type RoomBlock,
  type RoomPlan,
  type Side,
} from './model.js'
import { frameEdges } from './room-shape.js'

/* ------------------------------------------------------------------ *
 * 測試工具
 * ------------------------------------------------------------------ */

const SETTINGS = {
  ignoreBelow: DEFAULT_SETTINGS.ignoreBelow,
  warnBelow: DEFAULT_SETTINGS.warnBelow,
  adviseBelow: DEFAULT_SETTINGS.adviseBelow,
}

const rect = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 })

const FRAME_SIDES: readonly Side[] = ['N', 'E', 'S', 'W']

/** 外接框四邊零厚矩形，id 與 `buildClearanceInput()` 一致。 */
function frameWalls(bounds: Rect): ClearanceWall[] {
  return frameEdges(bounds).map((r, i) => ({ id: `frame:${FRAME_SIDES[i]}`, rect: r, frame: true }))
}

function mkItem(
  id: string,
  r: Rect,
  extra: Partial<Omit<ClearanceItem, 'id' | 'rect'>> = {},
): ClearanceItem {
  return { id, rect: r, passable: true, rotation: 0, ...extra }
}

/** D9 實體牆（非框邊，**會**當遮擋物）。 */
function mkWall(id: string, r: Rect): ClearanceWall {
  return { id, rect: r, frame: false }
}

function makeInput(opts: {
  bounds: Rect
  items: ClearanceItem[]
  walls?: ClearanceWall[]
  doors?: ClearanceDoor[]
  settings?: ClearanceInput['settings']
}): ClearanceInput {
  return {
    items: opts.items,
    walls: [...(opts.walls ?? []), ...frameWalls(opts.bounds)],
    bounds: opts.bounds,
    doors: opts.doors ?? [],
    settings: opts.settings ?? SETTINGS,
  }
}

/** 跑兩條路徑並斷言逐字相同（差分 oracle 內建於每個 fixture）。 */
function analyze(
  input: ClearanceInput,
  opts: { cellSize?: number; maxGap?: number } = {},
): ClearanceReport {
  const naive = clearanceCore(input, { ...opts, index: false })
  const indexed = clearanceCore(input, { cellSize: 50, ...opts, index: true })
  expect(indexed.report).toEqual(naive.report)
  return indexed.report
}

function analyzePlan(
  plan: RoomPlan,
  opts: { cellSize?: number; maxGap?: number } = {},
): ClearanceReport {
  const naive = clearance(plan, { ...opts, index: false })
  const indexed = clearance(plan, { cellSize: 50, ...opts, index: true })
  expect(indexed).toEqual(naive)
  return indexed
}

/** 不分順序找出某一對的通道筆。 */
function between(report: ClearanceReport, a: string, b: string): Corridor[] {
  return report.corridors.filter(
    (c) => (c.a === a && c.b === b) || (c.a === b && c.b === a),
  )
}

function mkFurniture(over: Partial<Furniture> & Pick<Furniture, 'id'>): Furniture {
  return {
    name: over.id,
    color: '#336699',
    width: 50,
    depth: 50,
    x: 0,
    y: 0,
    rotation: 0,
    passable: true,
    ...over,
  }
}

function mkPlan(opts: {
  width?: number
  depth?: number
  blocks?: RoomBlock[]
  doors?: Door[]
  items?: Furniture[]
}): RoomPlan {
  return {
    version: 1,
    room: {
      width: opts.width ?? 300,
      depth: opts.depth ?? 400,
      blocks: opts.blocks ?? [],
      doors: opts.doors ?? [],
    },
    items: opts.items ?? [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

/**
 * D9 玄關實例：基底 300×400 ＋ extend `E1` x∈[300,360]、y∈[0,`extendDepth`]；
 * 衣櫃（開門式）`width:wardrobeLength depth:60 rotation:90` 於
 * (300, `wardrobeY`)——旋轉後為 60 寬 `wardrobeLength` 深，即
 * [300,360]×[`wardrobeY`, `wardrobeY`+`wardrobeLength`]；需留 local S 90
 * （經 `worldSide(90,'S')` → 世界 W）；門鉸鏈 (360,270)、`leafDir:'-'`、
 * width `doorWidth`、`doorSwing`（預設內開）。
 *
 * `wardrobeLength`／`doorSwing` 供 r3.4 D4 (b) 雙向容差案使用：衣櫃加長會
 * 把「衣櫃×凹槽牆 `S`」的間距區間壓成門扇跨距的**真子集**（門口被擋窄）。
 */
function vestibulePlan(
  opts: {
    extendDepth?: number
    doorWidth?: number
    doorSwing?: 'in' | 'out'
    wardrobeY?: number
    wardrobeLength?: number
    extraBlocks?: RoomBlock[]
  } = {},
): RoomPlan {
  return mkPlan({
    width: 300,
    depth: 400,
    blocks: [
      { id: 'E1', kind: 'extend', x: 300, y: 0, width: 60, depth: opts.extendDepth ?? 270 },
      ...(opts.extraBlocks ?? []),
    ],
    doors: [
      {
        id: 'D1',
        x: 360,
        y: 270,
        wall: 'E',
        leafDir: '-',
        width: opts.doorWidth ?? 70,
        swing: opts.doorSwing ?? 'in',
      },
    ],
    items: [
      mkFurniture({
        id: 'W1',
        name: '衣櫃（開門式）',
        width: opts.wardrobeLength ?? 200,
        depth: 60,
        x: 300,
        y: opts.wardrobeY ?? 0,
        rotation: 90,
        clearances: { S: 90 },
      }),
    ],
  })
}

/** D9 (e) 條件 (a) 反向案的獨立 fixture：純矩形房 250×400、門外開。 */
function reverseAPlan(itemRect = rect(100, 190, 200, 260)): RoomPlan {
  return mkPlan({
    width: 250,
    depth: 400,
    doors: [{ id: 'D1', x: 250, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'out' }],
    items: [
      mkFurniture({
        id: 'A',
        width: itemRect.x1 - itemRect.x0,
        depth: itemRect.y1 - itemRect.y0,
        x: itemRect.x0,
        y: itemRect.y0,
      }),
    ],
  })
}

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

/* ------------------------------------------------------------------ *
 * D3 四段半開區間
 * ------------------------------------------------------------------ */

describe('levelFor — D3 四段半開區間', () => {
  it('邊界值 4／5／59／60／74／75 逐一落在 touch／narrow／narrow／tight／tight／ok', () => {
    expect(levelFor(4, SETTINGS)).toBe('touch')
    expect(levelFor(5, SETTINGS)).toBe('narrow')
    expect(levelFor(59, SETTINGS)).toBe('narrow')
    expect(levelFor(60, SETTINGS)).toBe('tight')
    expect(levelFor(74, SETTINGS)).toBe('tight')
    expect(levelFor(75, SETTINGS)).toBe('ok')
  })

  it('兩件純矩形家具的實際間距同樣落在四段（gap 0 為 touch）', () => {
    const expected: Array<[number, string]> = [
      [0, 'touch'],
      [4, 'touch'],
      [5, 'narrow'],
      [59, 'narrow'],
      [60, 'tight'],
      [74, 'tight'],
      [75, 'ok'],
    ]
    for (const [g, level] of expected) {
      const report = analyze(
        makeInput({
          bounds: rect(0, 0, 400, 200),
          items: [mkItem('A', rect(0, 0, 40, 40)), mkItem('B', rect(40 + g, 0, 80 + g, 40))],
        }),
      )
      const pair = between(report, 'A', 'B')
      expect(pair).toHaveLength(1)
      expect(pair[0].axis).toBe('x')
      expect(pair[0].gap).toBe(g)
      expect(pair[0].kind).toBe('corridor')
      expect(pair[0].level).toBe(level)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 遮擋子段（D4）
 * ------------------------------------------------------------------ */

describe('遮擋子段（D4）', () => {
  it('A–B–C 排成一列時不產生 A–C 通道，A–B／B–C 各一筆', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 300),
        items: [
          mkItem('A', rect(0, 100, 50, 150)),
          mkItem('B', rect(100, 100, 150, 150)),
          mkItem('C', rect(200, 100, 250, 150)),
        ],
      }),
    )
    expect(between(report, 'A', 'C')).toHaveLength(0)
    expect(between(report, 'A', 'B')).toHaveLength(1)
    expect(between(report, 'B', 'C')).toHaveLength(1)
  })

  it('茶几（passable:false）探入 10 cm 時剩餘 90 cm 子段仍 narrow，且含茶几的通道 suppressed', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 140),
        items: [
          mkItem('sofa', rect(0, 0, 100, 90)),
          mkItem('tea', rect(90, 90, 190, 140), { passable: false }),
        ],
      }),
    )
    // 沙發×南框：母通道重疊段 x∈[0,100]，茶几探入 [90,100] → 剩 [0,90]。
    const sofaSouth = between(report, 'sofa', 'frame:S')
    expect(sofaSouth).toHaveLength(1)
    expect(sofaSouth[0].gap).toBe(50)
    expect(sofaSouth[0].level).toBe('narrow')
    expect(sofaSouth[0].kind).toBe('corridor')
    expect(sofaSouth[0].rect).toEqual(rect(0, 90, 90, 140))
    // 含茶几的那一筆（沙發×茶几）不評級。
    const sofaTea = between(report, 'sofa', 'tea')
    expect(sofaTea).toHaveLength(1)
    expect(sofaTea[0].kind).toBe('suppressed')
    expect(sofaTea[0].level).toBeNull()
  })

  it('凹槽內家具不會穿過牆體量到另一側的家具', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 400),
        walls: [mkWall('wall:0', rect(100, 0, 200, 200))],
        items: [mkItem('A', rect(0, 0, 100, 60)), mkItem('B', rect(200, 0, 300, 60))],
      }),
    )
    expect(between(report, 'A', 'B')).toHaveLength(0)
    // 牆體本身仍與兩側家具各有一筆貼齊通道。
    expect(between(report, 'A', 'wall:0')).toHaveLength(1)
    expect(between(report, 'B', 'wall:0')).toHaveLength(1)
  })

  it('d = 0 的通道永不被遮擋（間距軸零寬 → 正面積相交恆不成立）', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 300),
        items: [
          mkItem('A', rect(0, 0, 100, 50)),
          mkItem('B', rect(0, 50, 100, 100)),
          // 橫跨 A／B 接縫的第三件家具：與零寬通道矩形相交面積為 0。
          mkItem('C', rect(40, 20, 60, 80)),
        ],
      }),
    )
    const ab = between(report, 'A', 'B')
    expect(ab).toHaveLength(1)
    expect(ab[0].gap).toBe(0)
    expect(ab[0].segIndex).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * 門洞（D4 三條件／D9 反向案／r3.4 (b) 雙向容差）
 * ------------------------------------------------------------------ */

describe('門洞（D4 三條件）', () => {
  const vestibuleDoor: Door = {
    id: 'D1',
    x: 360,
    y: 270,
    wall: 'E',
    leafDir: '-',
    width: 70,
    swing: 'in',
  }

  it('正案：玄關衣櫃×凹槽牆的 70 cm 間距標為 doorway、不評級', () => {
    const report = analyzePlan(vestibulePlan())
    const doorway = report.corridors.filter((c) => c.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].a).toBe('W1')
    expect(doorway[0].b).toBe('wall:0')
    expect(doorway[0].axis).toBe('y')
    expect(doorway[0].gap).toBe(70)
    expect(doorway[0].level).toBeNull()
    expect(doorway[0].rect).toEqual(rect(300, 200, 360, 270))
  })

  it('間距區間部分超出門扇跨距 → 條件 (b) 不成立，照常評級（D9 (b)：門寬 50 → tight 70）', () => {
    const report = analyzePlan(vestibulePlan({ doorWidth: 50 }))
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toHaveLength(0)
    const pair = between(report, 'W1', 'wall:0')
    expect(pair).toHaveLength(1)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].gap).toBe(70)
    expect(pair[0].level).toBe('tight')
  })

  it('同一間距區間但遠離門（不共邊）→ 條件 (c) 不成立，照常評級', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 360, 400),
        items: [mkItem('P', rect(100, 100, 200, 200)), mkItem('Q', rect(100, 270, 200, 370))],
        doors: [{ id: 'D1', geom: doorGeometry(vestibuleDoor) }],
      }),
    )
    const pair = between(report, 'P', 'Q')
    expect(pair).toHaveLength(1)
    // 間距區間 [200,270] 恰為門扇跨距、間距軸亦相符，僅差「與門扇共邊」。
    expect(pair[0].axis).toBe('y')
    expect(pair[0].gap).toBe(70)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].level).toBe('tight')
  })

  it('D9 (c) 容差正案：extend y∈[0,272]、兩端超出總和 2 < ignoreBelow → 仍 doorway、gap 72', () => {
    const report = analyzePlan(vestibulePlan({ extendDepth: 272 }))
    const doorway = report.corridors.filter((c) => c.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].gap).toBe(72)
    expect(doorway[0].level).toBeNull()
  })

  it('D9 (d) 容差越界案：extend y∈[0,278]、超出 8 ≥ ignoreBelow → kind corridor、gap 78、level ok', () => {
    const report = analyzePlan(vestibulePlan({ extendDepth: 278 }))
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toHaveLength(0)
    const pair = between(report, 'W1', 'wall:0')
    expect(pair).toHaveLength(1)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].gap).toBe(78)
    expect(pair[0].level).toBe('ok')
  })

  it('D9 (e) 條件 (a) 反向案：間距軸 ⟂ 東牆 → 仍評級 narrow 50、無門洞', () => {
    // 註（r3.4）：本 fixture 的間距區間 x∈[200,250] 相對跨距 y∈[200,270] 在
    // 新的雙向容差下偏差 20，故 (a)(b) 同時不成立——PLAN D9 (e) 原文的
    // 「雖 (b)(c) 數值上成立」以舊的單向公式為準。條件 (a) 的**純粹**回歸鎖
    // 已移到上面的 R2-C2 案（兩案只差 (a)）。結論值不變。
    const report = analyzePlan(reverseAPlan())
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toHaveLength(0)
    const pair = between(report, 'A', 'frame:E')
    expect(pair).toHaveLength(1)
    expect(pair[0].axis).toBe('x')
    expect(pair[0].gap).toBe(50)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].level).toBe('narrow')
  })

  it('R2-C2 回歸鎖：同一條通道換上跨距軸相符的門即成門洞 → 兩案只差條件 (a)', () => {
    // 通道矩形 [200,250]×[190,260]、間距區間 [200,250]（x 軸）。
    const base = {
      bounds: rect(0, 0, 250, 400),
      items: [mkItem('A', rect(100, 190, 200, 260))],
    }
    // 東牆門：跨距 y∈[200,250]（與間距區間**數值相同**，故 (b) 的雙向偏差
    // 為 0）、門扇線 x=250 與通道矩形共邊 → (b)(c) 成立，只有間距軸 ⟂ 牆線
    // 使 (a) 不成立 → 不算門洞。
    const wrongAxis = analyze(
      makeInput({
        ...base,
        doors: [
          {
            id: 'D1',
            geom: doorGeometry({
              id: 'D1',
              x: 250,
              y: 250,
              wall: 'E',
              leafDir: '-',
              width: 50,
              swing: 'out',
            }),
          },
        ],
      }),
    )
    expect(between(wrongAxis, 'A', 'frame:E')[0].kind).toBe('corridor')

    // 南牆門：跨距 x∈[200,250]、門扇線 y=260 ——(a)(b)(c) 三條全中。
    const rightAxis = analyze(
      makeInput({
        ...base,
        doors: [
          {
            id: 'D2',
            geom: doorGeometry({
              id: 'D2',
              x: 200,
              y: 260,
              wall: 'S',
              leafDir: '+',
              width: 50,
              swing: 'in',
            }),
          },
        ],
      }),
    )
    const doorway = between(rightAxis, 'A', 'frame:E')
    expect(doorway[0].kind).toBe('doorway')
    expect(doorway[0].level).toBeNull()
  })

  /* --- r3.4 D4 (b)：雙向容差（超出與短缺皆計） -------------------- */

  it('間距區間為跨距**真子集**且偏差 30 ≥ ignoreBelow → corridor／narrow、gap 40（門口被衣櫃擋窄）', () => {
    // 衣櫃加長至 [300,360]×[0,230]（外開門，故不另生 doorViolation）：
    // 衣櫃×牆體 `S` 的間距區間 [230,270] ⊊ 跨距 [200,270]。
    // 舊公式只量「超出」→ 0 → 誤標 doorway 不評級；
    // 新公式 |200−230| + |270−270| = 30 ≥ 5 → 照常評級。
    const report = analyzePlan(vestibulePlan({ wardrobeLength: 230, doorSwing: 'out' }))
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toEqual([])
    const pair = between(report, 'W1', 'wall:0')
    expect(pair).toHaveLength(1)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].level).toBe('narrow')
    expect(pair[0].axis).toBe('y')
    expect(pair[0].gap).toBe(40)
    expect(pair[0].rect).toEqual(rect(300, 230, 360, 270))
  })

  it('同一 fixture 改內開 → 衣櫃進迴旋區，doorViolations 1（通道評級不變）', () => {
    const report = analyzePlan(vestibulePlan({ wardrobeLength: 230, doorSwing: 'in' }))
    expect(report.doorViolations).toHaveLength(1)
    expect(report.doorViolations[0]).toEqual({ doorId: 'D1', itemId: 'W1' })
    expect(between(report, 'W1', 'wall:0')[0].level).toBe('narrow')
  })

  it('真子集但偏差總和 2 < ignoreBelow → 仍 doorway、gap 68（容差雙向對稱）', () => {
    // 衣櫃 [300,360]×[0,202] → 間距區間 [202,270] ⊊ 跨距 [200,270]、偏差 2。
    const report = analyzePlan(vestibulePlan({ wardrobeLength: 202, doorSwing: 'out' }))
    const doorway = report.corridors.filter((c) => c.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].a).toBe('W1')
    expect(doorway[0].b).toBe('wall:0')
    expect(doorway[0].gap).toBe(68)
    expect(doorway[0].level).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * passable、碰撞、配對規則
 * ------------------------------------------------------------------ */

describe('passable、碰撞與配對規則（D4）', () => {
  it('passable:false 只改評級（kind suppressed、level null），不影響碰撞', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 300),
        items: [
          mkItem('A', rect(0, 0, 50, 50)),
          mkItem('tea', rect(80, 0, 130, 50), { passable: false }),
          // 與 tea 正面積重疊 → 碰撞，不得被 passable 抑制。
          mkItem('B', rect(120, 20, 170, 70), { passable: false }),
        ],
      }),
    )
    const pair = between(report, 'A', 'tea')
    expect(pair).toHaveLength(1)
    expect(pair[0].kind).toBe('suppressed')
    expect(pair[0].level).toBeNull()
    expect(pair[0].gap).toBe(30)
    expect(report.collisions).toEqual([
      { a: 'tea', b: 'B', rect: rect(120, 20, 130, 50) },
    ])
  })

  it('恰一軸正重疊且 d<0（家具跨在零厚框線上）→ 碰撞，碰撞矩形為框線上的零厚線段', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 400),
        items: [mkItem('A', rect(100, -20, 200, 50))],
      }),
    )
    expect(report.collisions).toEqual([{ a: 'A', b: 'frame:N', rect: rect(100, 0, 200, 0) }])
  })

  it('牆×牆永不配對：兩道相對的 D9 牆體、零件家具 → 零通道零碰撞', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 400),
        walls: [mkWall('wall:0', rect(0, 0, 100, 400)), mkWall('wall:1', rect(200, 0, 300, 400))],
        items: [],
      }),
    )
    expect(report.corridors).toEqual([])
    expect(report.collisions).toEqual([])
  })

  it('純矩形房內一件家具 → 四邊框各產生一筆通道', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 300, 400),
        items: [mkItem('A', rect(100, 150, 150, 200))],
      }),
    )
    expect(report.corridors).toHaveLength(4)
    expect(report.corridors.map((c) => c.b).sort()).toEqual([
      'frame:E',
      'frame:N',
      'frame:S',
      'frame:W',
    ])
    expect(report.corridors.every((c) => c.a === 'A')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 同牆面合併（D4）
 * ------------------------------------------------------------------ */

describe('同牆面合併（D4）', () => {
  it('cutout A=[200,300]×[0,100]、B=[200,250]×[100,200]、家具 F=[100,150]×[0,200] → 恰一筆 narrow 50', () => {
    const report = analyzePlan(
      mkPlan({
        width: 300,
        depth: 400,
        blocks: [
          { id: 'A', kind: 'cutout', x: 200, y: 0, width: 100, depth: 100 },
          { id: 'B', kind: 'cutout', x: 200, y: 100, width: 50, depth: 100 },
        ],
        items: [mkFurniture({ id: 'F', width: 50, depth: 200, x: 100, y: 0 })],
      }),
    )
    const narrow = report.corridors.filter((c) => c.level === 'narrow')
    expect(narrow).toHaveLength(1)
    expect(narrow[0].a).toBe('F')
    expect(narrow[0].axis).toBe('x')
    expect(narrow[0].gap).toBe(50)
    expect(narrow[0].segIndex).toBe(0)
    // 兩段（y∈[0,100]、y∈[100,200]）併為單一 y∈[0,200] 的通道矩形。
    expect(narrow[0].rect).toEqual(rect(150, 0, 200, 200))
  })
})

/* ------------------------------------------------------------------ *
 * sideViolations（D5）
 * ------------------------------------------------------------------ */

describe('sideViolations（D5）', () => {
  const desk = (rotation: Furniture['rotation']): RoomPlan =>
    mkPlan({
      width: 300,
      depth: 400,
      items: [
        mkFurniture({
          id: 'desk',
          name: '書桌',
          width: 120,
          depth: 60,
          x: 50,
          y: 100,
          rotation,
          clearances: { S: 75 },
        }),
      ],
    })

  it('書桌 local S 需留 75、rotation 90 → 世界面 W，距西框僅 50 → 一筆違規', () => {
    const report = analyzePlan(desk(90))
    expect(report.sideViolations).toEqual([
      { id: 'desk', side: 'S', worldSide: 'W', need: 75, actual: 50, against: 'frame:W' },
    ])
  })

  it('旋轉使需留面朝向開闊側（rotation 270 → 世界面 E）→ 零違規', () => {
    const report = analyzePlan(desk(270))
    expect(report.sideViolations).toEqual([])
  })

  it('該面完全沒有投影重疊的配對時不列違規（斜對角不計）', () => {
    // 刻意不放框邊（否則任一家具在四個方向恆有配對），只留一件斜對角家具。
    const bounds = rect(0, 0, 600, 600)
    const diagonal: ClearanceInput = {
      bounds,
      walls: [],
      doors: [],
      settings: SETTINGS,
      items: [
        mkItem('desk', rect(200, 200, 320, 260), { clearances: { N: 75 } }),
        mkItem('far', rect(0, 0, 60, 60)),
      ],
    }
    // 斜對角（兩軸皆無正重疊）→ 連候選通道都不產生，故北面無違規。
    expect(analyze(diagonal).corridors).toEqual([])
    expect(analyze(diagonal).sideViolations).toEqual([])

    // 對照：把 far 挪到正北、間距 10 → 同一件家具即刻列違規。
    const aligned: ClearanceInput = {
      ...diagonal,
      items: [
        diagonal.items[0],
        mkItem('near', rect(200, 130, 320, 190)),
      ],
    }
    expect(analyze(aligned).sideViolations).toEqual([
      { id: 'desk', side: 'N', worldSide: 'N', need: 75, actual: 10, against: 'near' },
    ])
  })
})

/* ------------------------------------------------------------------ *
 * doorViolations（D6）
 * ------------------------------------------------------------------ */

describe('doorViolations（D6 裁象限相交謂詞）', () => {
  const vestibuleDoor: Door = {
    id: 'D1',
    x: 360,
    y: 270,
    wall: 'E',
    leafDir: '-',
    width: 70,
    swing: 'in',
  }

  it('玄關實例正案：衣櫃恰相切（最近點距 70）→ 零違規', () => {
    expect(analyzePlan(vestibulePlan()).doorViolations).toEqual([])
  })

  it('D9 (a) 反向案：衣櫃 y 改 1 → 一筆門違規', () => {
    expect(analyzePlan(vestibulePlan({ wardrobeY: 1 })).doorViolations).toEqual([
      { doorId: 'D1', itemId: 'W1' },
    ])
  })

  it('跨軸家具：橫跨鉸鏈所在牆線、僅一角落在開象限 → 仍警示', () => {
    const report = analyze(
      makeInput({
        bounds: rect(0, 0, 360, 400),
        items: [mkItem('X', rect(330, 250, 360, 300))],
        doors: [{ id: 'D1', geom: doorGeometry(vestibuleDoor) }],
      }),
    )
    expect(report.doorViolations).toEqual([{ doorId: 'D1', itemId: 'X' }])
  })

  it('貼著門扇滑過不誤警：外開門的門扇線上、家具整體落在開象限之外', () => {
    const report = analyzePlan(reverseAPlan(rect(180, 200, 250, 270)))
    expect(report.doorViolations).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * D9 玄關實例完整驗收 ＋ 反向案 (a)–(f)
 * ------------------------------------------------------------------ */

describe('D9 玄關實例完整驗收', () => {
  it('正案期望 report：零碰撞／零門違規／零各面違規；門洞 1、ok 1、touch 2、無南框通道', () => {
    const report = analyzePlan(vestibulePlan())

    expect(report.collisions).toEqual([])
    expect(report.doorViolations).toEqual([])
    expect(report.sideViolations).toEqual([])
    expect(report.unattachedDoors).toEqual([])
    expect(report.unconnectedBlocks).toEqual([])

    expect(report.corridors).toHaveLength(4)
    const doorway = report.corridors.filter((c) => c.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].b).toBe('wall:0')
    expect(doorway[0].axis).toBe('y')
    expect(doorway[0].gap).toBe(70)

    const ok = report.corridors.filter((c) => c.level === 'ok')
    expect(ok).toHaveLength(1)
    expect(ok[0].b).toBe('frame:W')
    expect(ok[0].gap).toBe(300)

    const touch = report.corridors.filter((c) => c.level === 'touch')
    expect(touch).toHaveLength(2)
    expect(touch.map((c) => c.b).sort()).toEqual(['frame:E', 'frame:N'])
    expect(touch.every((c) => c.gap === 0)).toBe(true)

    // C1 驗收點：衣櫃×南框的母通道被凹槽牆 `S` 全遮 → 作廢。
    expect(between(report, 'W1', 'frame:S')).toHaveLength(0)
    // 零紅：無 narrow 筆。
    expect(report.corridors.filter((c) => c.level === 'narrow')).toEqual([])
  })

  it('(a) 衣櫃 y 改 1 → doorViolations 1', () => {
    expect(analyzePlan(vestibulePlan({ wardrobeY: 1 })).doorViolations).toHaveLength(1)
  })

  it('(b) 門寬改 50 → 該通道依 D3 為 tight', () => {
    const pair = between(analyzePlan(vestibulePlan({ doorWidth: 50 })), 'W1', 'wall:0')
    expect(pair[0].level).toBe('tight')
  })

  it('(c) extend y∈[0,272] → 仍 doorway、gap 72', () => {
    const doorway = analyzePlan(vestibulePlan({ extendDepth: 272 })).corridors.filter(
      (c) => c.kind === 'doorway',
    )
    expect(doorway).toHaveLength(1)
    expect(doorway[0].gap).toBe(72)
  })

  it('(d) extend y∈[0,278] → kind corridor、gap 78、level ok', () => {
    const pair = between(analyzePlan(vestibulePlan({ extendDepth: 278 })), 'W1', 'wall:0')
    expect(pair).toHaveLength(1)
    expect(pair[0].kind).toBe('corridor')
    expect(pair[0].gap).toBe(78)
    expect(pair[0].level).toBe('ok')
  })

  it('(e) 獨立 fixture：條件 (a) 不成立 → narrow 50、無門洞', () => {
    const report = analyzePlan(reverseAPlan())
    expect(report.corridors.filter((c) => c.kind === 'doorway')).toEqual([])
    expect(between(report, 'A', 'frame:E')[0].level).toBe('narrow')
  })

  it('(f) 邊界穩定案：加入不相干 cutout [0,40]×[210,250] 後門仍合法、門洞通道仍在', () => {
    const report = analyzePlan(
      vestibulePlan({
        extraBlocks: [{ id: 'C1', kind: 'cutout', x: 0, y: 210, width: 40, depth: 40 }],
      }),
    )
    expect(report.unattachedDoors).toEqual([])
    const doorway = report.corridors.filter((c) => c.kind === 'doorway')
    expect(doorway).toHaveLength(1)
    expect(doorway[0].gap).toBe(70)
    expect(doorway[0].level).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 差分 oracle（移植 sp1 O1–O4 ＋ 玄關實例，cellSize 參數化）
 * ------------------------------------------------------------------ */

describe('差分 oracle：樸素路徑 ≡ 索引路徑（sp1 O1–O4）', () => {
  /** O1 跨 cell 通道＋中段遮擋。 */
  const o1 = (): ClearanceInput =>
    makeInput({
      bounds: rect(0, 0, 300, 300),
      items: [
        mkItem('a', rect(20, 20, 260, 40)),
        mkItem('b', rect(20, 240, 260, 260)),
        mkItem('c', rect(120, 100, 160, 140)),
      ],
    })

  /** O2 cell 邊界矩形（50／100 對齊、含 d=0 貼齊）。 */
  const o2 = (): ClearanceInput =>
    makeInput({
      bounds: rect(0, 0, 200, 200),
      items: [
        mkItem('a', rect(0, 0, 50, 50)),
        mkItem('b', rect(50, 0, 100, 50)),
        mkItem('c', rect(100, 0, 150, 50)),
        mkItem('d', rect(0, 100, 150, 150)),
        mkItem('e', rect(50, 55, 100, 95)),
      ],
    })

  /** O3 負原點 bounds（含一塊實體牆）。 */
  const o3 = (): ClearanceInput =>
    makeInput({
      bounds: rect(-200, -150, 100, 50),
      walls: [mkWall('wall:0', rect(-60, -140, -40, 40))],
      items: [
        mkItem('a', rect(-180, -130, -100, -90)),
        mkItem('b', rect(-180, -20, -100, 20)),
        mkItem('c', rect(-150, -80, -130, -60)),
        mkItem('d', rect(0, -130, 60, -60)),
      ],
    })

  /** O4 D3 四段邊界（d＝5／60／75／0）。 */
  const o4 = (): ClearanceInput =>
    makeInput({
      bounds: rect(0, 0, 600, 400),
      items: [
        mkItem('a1', rect(0, 0, 40, 40)),
        mkItem('a2', rect(45, 0, 85, 40)),
        mkItem('b1', rect(0, 100, 40, 140)),
        mkItem('b2', rect(100, 100, 140, 140)),
        mkItem('c1', rect(0, 200, 40, 240)),
        mkItem('c2', rect(115, 200, 155, 240)),
        mkItem('d1', rect(300, 300, 340, 340)),
        mkItem('d2', rect(340, 300, 380, 340)),
      ],
    })

  const fixtures: Array<[string, () => ClearanceInput]> = [
    ['O1 跨 cell 通道＋中段遮擋', o1],
    ['O2 cell 邊界矩形', o2],
    ['O3 負原點 bounds', o3],
    ['O4 D3 四段邊界', o4],
    ['玄關實例', () => buildClearanceInput(vestibulePlan())],
    // r3.4 D4 (b)：間距區間為跨距真子集的兩案（偏差 30 ／ 偏差 2）。
    [
      '玄關實例（真子集、偏差 30）',
      () => buildClearanceInput(vestibulePlan({ wardrobeLength: 230, doorSwing: 'out' })),
    ],
    [
      '玄關實例（真子集、偏差 2）',
      () => buildClearanceInput(vestibulePlan({ wardrobeLength: 202, doorSwing: 'out' })),
    ],
  ]

  for (const [name, build] of fixtures) {
    for (const cellSize of [50, 100, 37]) {
      it(`${name} @cellSize=${cellSize}：兩路徑 deepEqual`, () => {
        const input = build()
        const naive = clearanceCore(input, { index: false })
        const indexed = clearanceCore(input, { index: true, cellSize })
        expect(indexed.report).toEqual(naive.report)
      })
    }
  }

  it('O1 的索引版遮擋測試次數嚴格少於樸素版（三個 cellSize 皆然）', () => {
    const input = o1()
    const naive = clearanceCore(input, { index: false })
    expect(naive.occlusionTests).toBeGreaterThan(0)
    for (const cellSize of [50, 100, 37]) {
      const indexed = clearanceCore(input, { index: true, cellSize })
      expect(indexed.occlusionTests).toBeLessThan(naive.occlusionTests)
      expect(indexed.cellVisits).toBeGreaterThan(0)
    }
    expect(naive.cellVisits).toBe(0)
  })

  it('規模級 fixture（60 件家具＋棋盤牆體）兩路徑仍 deepEqual，索引版遮擋測試次數大幅較少', () => {
    // 比照 S1 的 F3 降階：600×800、10×10 格取 (i+j) 偶數者為牆體。
    const bounds = rect(0, 0, 600, 800)
    const walls: ClearanceWall[] = []
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        if ((i + j) % 2 !== 0) continue
        walls.push(
          mkWall(
            `wall:${walls.length}`,
            rect(i * 60, j * 80, (i + 1) * 60, (j + 1) * 80),
          ),
        )
      }
    }
    const rnd = makePrng(20260915)
    const items: ClearanceItem[] = []
    for (let k = 0; k < 60; k++) {
      const w = 40 + Math.floor(rnd() * 161)
      const h = 40 + Math.floor(rnd() * 161)
      const x = Math.floor(rnd() * (600 - w + 1))
      const y = Math.floor(rnd() * (800 - h + 1))
      items.push(mkItem(`i${String(k).padStart(3, '0')}`, rect(x, y, x + w, y + h)))
    }
    const input = makeInput({ bounds, items, walls })

    const naive = clearanceCore(input, { index: false })
    // fixture 有效性下限：棋盤牆體遮掉大量候選，剩餘仍應有數十筆通道。
    expect(naive.report.corridors.length).toBeGreaterThan(50)
    expect(naive.report.collisions.length).toBeGreaterThan(50)
    for (const cellSize of [50, 100, 37]) {
      const indexed = clearanceCore(input, { index: true, cellSize })
      expect(indexed.report).toEqual(naive.report)
      expect(indexed.occlusionTests).toBeLessThan(naive.occlusionTests)
    }
  })

  it('O4 的四段邊界在兩路徑上皆給出 narrow／tight／ok／touch', () => {
    const report = analyze(o4())
    expect(between(report, 'a1', 'a2')[0].level).toBe('narrow')
    expect(between(report, 'b1', 'b2')[0].level).toBe('tight')
    expect(between(report, 'c1', 'c2')[0].level).toBe('ok')
    expect(between(report, 'd1', 'd2')[0].level).toBe('touch')
  })
})

/* ------------------------------------------------------------------ *
 * maxGap 兩路徑（D4 OQ4）
 * ------------------------------------------------------------------ */

describe('maxGap 預篩（D4 OQ4 兩路徑契約）', () => {
  /** 種子化亂數 fixture：20 件家具（部分 passable:false／帶 clearances）＋三塊牆體＋一扇門。 */
  function randomFixture(): ClearanceInput {
    const rnd = makePrng(20260921)
    const bounds = rect(0, 0, 600, 400)
    const items: ClearanceItem[] = []
    for (let k = 0; k < 20; k++) {
      const w = 40 + Math.floor(rnd() * 81)
      const h = 40 + Math.floor(rnd() * 81)
      const x = Math.floor(rnd() * (600 - w + 1))
      const y = Math.floor(rnd() * (400 - h + 1))
      const extra: Partial<Omit<ClearanceItem, 'id' | 'rect'>> = {}
      if (k % 7 === 3) extra.passable = false
      if (k % 5 === 1) extra.clearances = { S: 75, E: 60 }
      if (k % 4 === 2) extra.rotation = 90
      items.push(mkItem(`i${String(k).padStart(2, '0')}`, rect(x, y, x + w, y + h), extra))
    }
    return makeInput({
      bounds,
      items,
      walls: [
        mkWall('wall:0', rect(200, 0, 240, 180)),
        mkWall('wall:1', rect(200, 260, 240, 400)),
        mkWall('wall:2', rect(400, 180, 600, 220)),
      ],
      doors: [
        {
          id: 'D1',
          geom: doorGeometry({
            id: 'D1',
            x: 0,
            y: 100,
            wall: 'W',
            leafDir: '+',
            width: 80,
            swing: 'in',
          }),
        },
      ],
    })
  }

  it('預篩版通道 ≡ 完整版中 gap ≤ maxGap 的子集，三類 violations 逐字相同', () => {
    const input = randomFixture()
    const full = analyze(input)
    const pre = analyze(input, { maxGap: 75 })

    expect(full.corridors.length).toBeGreaterThan(pre.corridors.length)
    expect(pre.corridors).toEqual(full.corridors.filter((c) => c.gap <= 75))
    expect(pre.collisions).toEqual(full.collisions)
    expect(pre.sideViolations).toEqual(full.sideViolations)
    expect(pre.doorViolations).toEqual(full.doorViolations)
    // fixture 有效性：三類判定至少各有內容可比。
    expect(full.collisions.length).toBeGreaterThan(0)
    expect(full.sideViolations.length).toBeGreaterThan(0)
  })

  it('預篩不改變 suppressed／doorway 的標記，只少掉 gap > maxGap 的筆', () => {
    const input = randomFixture()
    const full = analyze(input)
    const pre = analyze(input, { maxGap: 75 })
    expect(pre.corridors.every((c) => c.gap <= 75)).toBe(true)
    const suppressedFull = full.corridors.filter((c) => c.kind === 'suppressed' && c.gap <= 75)
    expect(pre.corridors.filter((c) => c.kind === 'suppressed')).toEqual(suppressedFull)
  })
})

/* ------------------------------------------------------------------ *
 * clearance(plan) 外殼
 * ------------------------------------------------------------------ */

describe('clearance(plan) 外殼', () => {
  it('非法門入 unattachedDoors 且不參與判定；未連接 extend 原樣透傳；deleted 家具排除', () => {
    const plan = mkPlan({
      width: 300,
      depth: 400,
      blocks: [{ id: 'FLOAT', kind: 'extend', x: 400, y: 400, width: 60, depth: 60 }],
      doors: [{ id: 'BAD', x: 150, y: 150, wall: 'N', leafDir: '+', width: 70, swing: 'in' }],
      items: [
        mkFurniture({ id: 'keep', x: 100, y: 100 }),
        mkFurniture({ id: 'gone', x: 200, y: 200, deleted: true }),
      ],
    })
    const report = analyzePlan(plan)
    expect(report.unattachedDoors).toEqual(['BAD'])
    expect(report.unconnectedBlocks).toEqual(['FLOAT'])
    expect(report.doorViolations).toEqual([])
    const mentions = [
      ...report.corridors.flatMap((c) => [c.a, c.b]),
      ...report.collisions.flatMap((c) => [c.a, c.b]),
    ]
    expect(mentions).not.toContain('gone')
    expect(mentions).toContain('keep')
  })

  it('buildClearanceInput 的牆體 id 為 wall:<index> ＋ frame:N|E|S|W，框邊排在最後四筆', () => {
    const input = buildClearanceInput(vestibulePlan())
    expect(input.walls.map((w) => w.id)).toEqual([
      'wall:0',
      'frame:N',
      'frame:E',
      'frame:S',
      'frame:W',
    ])
    expect(input.walls.filter((w) => w.frame).map((w) => w.id)).toEqual([
      'frame:N',
      'frame:E',
      'frame:S',
      'frame:W',
    ])
    expect(input.bounds).toEqual(rect(0, 0, 360, 400))
    expect(input.items).toHaveLength(1)
    expect(input.items[0].rect).toEqual(rect(300, 0, 360, 200))
    expect(input.doors).toHaveLength(1)
    expect(input.doors[0].geom.span).toEqual({ axis: 'y', lo: 200, hi: 270 })
  })

  it('預設走索引路徑、cellSize 50，且與樸素路徑輸出相同', () => {
    const plan = vestibulePlan()
    expect(clearance(plan)).toEqual(clearance(plan, { index: false }))
  })
})
