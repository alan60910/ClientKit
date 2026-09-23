/**
 * T1.2（(internal design doc) §Verification「model」）：
 * `effectiveRect` 四個 rotation 的寬深與座標表；`worldSide` 12 組映射
 * 直測（順時針）＋rotation 0 恆等 4 組；`rotateAboutCenter` 未觸發夾框時
 * 中心不變（誤差 ≤1）、91×188 連按四次 R 回原座標、玄關衣櫃（200×60、
 * rotation 90、(300,0)）再按 R 的unclamped 數值（夾框案屬 reducer／T1.8，
 * 本檔不測）；`defaultPlan()` 每次呼叫回傳全新深物件；id 產生器過
 * `ID_RE`、16 碼小寫 hex、1000 次不重複；`LIMITS.items`／`LIMITS.walls`
 * 釘值（OQ4 定案）。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  defaultPlan,
  effectiveRect,
  effectiveSize,
  ID_RE,
  isValidMaxItems,
  LIMITS,
  MAX_ITEMS_DEFAULT,
  MAX_ITEMS_WARN_ABOVE,
  newId,
  rotateAboutCenter,
  worldSide,
  type Furniture,
  type Rotation,
  type Side,
} from './model.js'

describe('effectiveRect／effectiveSize（90/270 寬深互換，0/180 不變）', () => {
  // 狀態與資料形釘值範例：200×60 at (300,0)
  it.each([
    [0 as Rotation, { x0: 300, y0: 0, x1: 500, y1: 60 }],
    [90 as Rotation, { x0: 300, y0: 0, x1: 360, y1: 200 }],
    [180 as Rotation, { x0: 300, y0: 0, x1: 500, y1: 60 }], // 同 rotation 0
    [270 as Rotation, { x0: 300, y0: 0, x1: 360, y1: 200 }], // 同 rotation 90
  ])('width=200 depth=60 x=300 y=0 rotation=%s', (rotation, expected) => {
    const item = { x: 300, y: 0, width: 200, depth: 60, rotation }
    expect(effectiveRect(item)).toEqual(expected)
  })

  it('effectiveSize：90/270 互換、0/180 不互換', () => {
    const base = { width: 91, depth: 188 }
    expect(effectiveSize({ ...base, rotation: 0 })).toEqual({ w: 91, d: 188 })
    expect(effectiveSize({ ...base, rotation: 180 })).toEqual({ w: 91, d: 188 })
    expect(effectiveSize({ ...base, rotation: 90 })).toEqual({ w: 188, d: 91 })
    expect(effectiveSize({ ...base, rotation: 270 })).toEqual({ w: 188, d: 91 })
  })
})

describe('worldSide（rotation 為順時針度數）', () => {
  it.each([
    // rotation 0：恆等 4 組
    [0 as Rotation, 'N' as Side, 'N' as Side],
    [0 as Rotation, 'E' as Side, 'E' as Side],
    [0 as Rotation, 'S' as Side, 'S' as Side],
    [0 as Rotation, 'W' as Side, 'W' as Side],
    // rotation 90：N→E、E→S、S→W、W→N
    [90 as Rotation, 'N' as Side, 'E' as Side],
    [90 as Rotation, 'E' as Side, 'S' as Side],
    [90 as Rotation, 'S' as Side, 'W' as Side],
    [90 as Rotation, 'W' as Side, 'N' as Side],
    // rotation 180：N↔S、E↔W
    [180 as Rotation, 'N' as Side, 'S' as Side],
    [180 as Rotation, 'S' as Side, 'N' as Side],
    [180 as Rotation, 'E' as Side, 'W' as Side],
    [180 as Rotation, 'W' as Side, 'E' as Side],
    // rotation 270：N→W、W→S、S→E、E→N
    [270 as Rotation, 'N' as Side, 'W' as Side],
    [270 as Rotation, 'W' as Side, 'S' as Side],
    [270 as Rotation, 'S' as Side, 'E' as Side],
    [270 as Rotation, 'E' as Side, 'N' as Side],
  ])('rotation=%s local=%s → %s', (rotation, local, expected) => {
    expect(worldSide(rotation, local)).toBe(expected)
  })
})

describe('rotateAboutCenter（有效外框中心為軸；不做夾框）', () => {
  const centerOf = (item: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>) => {
    const r = effectiveRect(item)
    return { cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 }
  }

  it.each([
    { width: 91, depth: 188, x: 10, y: 10, rotation: 0 as Rotation },
    { width: 200, depth: 60, x: 300, y: 0, rotation: 90 as Rotation },
    { width: 120, depth: 75, x: 5, y: 5, rotation: 180 as Rotation },
    { width: 45, depth: 40, x: -3, y: 7, rotation: 270 as Rotation },
  ])('未夾框時中心不變（誤差 ≤1）：%j', (item) => {
    const before = centerOf(item)
    const rotated = rotateAboutCenter(item)
    const after = centerOf({ ...item, x: rotated.x, y: rotated.y, rotation: rotated.rotation })
    expect(Math.abs(after.cx - before.cx)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.cy - before.cy)).toBeLessThanOrEqual(1)
  })

  it('91×188 連按四次 R 回原座標與 rotation 0', () => {
    let item: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'> = {
      width: 91,
      depth: 188,
      x: 17,
      y: 23,
      rotation: 0,
    }
    const origin = { x: item.x, y: item.y }
    for (let i = 0; i < 4; i++) {
      const next = rotateAboutCenter(item)
      item = { ...item, x: next.x, y: next.y, rotation: next.rotation }
    }
    expect(item.x).toBe(origin.x)
    expect(item.y).toBe(origin.y)
    expect(item.rotation).toBe(0)
  })

  it('玄關衣櫃（200×60、rotation 90、(300,0)）再按 R → rotation 180，unclamped 數值以舊中心為準', () => {
    // 舊有效外框 [300,360]×[0,200]，中心 (330,100)；夾框案屬 reducer（T1.8），本案只斷言未夾框數值。
    const item = { width: 200, depth: 60, x: 300, y: 0, rotation: 90 as Rotation }
    const before = centerOf(item)
    expect(before).toEqual({ cx: 330, cy: 100 })

    const rotated = rotateAboutCenter(item)
    expect(rotated.rotation).toBe(180)
    // w_eff/d_eff 為旋轉前（60×200）；目標 180 用 ceil：newX=300+(60-200)/2=230、newY=0+(200-60)/2=70
    expect(rotated.x).toBe(230)
    expect(rotated.y).toBe(70)

    const after = centerOf({ ...item, x: rotated.x, y: rotated.y, rotation: rotated.rotation })
    expect(after).toEqual(before)
  })
})

describe('defaultPlan()', () => {
  it('每次呼叫回傳全新深物件（互不影響）', () => {
    const a = defaultPlan()
    const b = defaultPlan()
    expect(a).not.toBe(b)
    expect(a.room.blocks).not.toBe(b.room.blocks)
    expect(a.room.doors).not.toBe(b.room.doors)
    expect(a.items).not.toBe(b.items)
    expect(a.settings).not.toBe(b.settings)

    a.room.blocks.push({ id: 'x', kind: 'extend', x: 0, y: 0, width: 1, depth: 1 })
    a.items.push({
      id: 'y',
      name: 'n',
      color: '#000000',
      width: 1,
      depth: 1,
      x: 0,
      y: 0,
      rotation: 0,
      passable: true,
    })
    a.settings.snap = 10

    expect(b.room.blocks).toHaveLength(0)
    expect(b.items).toHaveLength(0)
    expect(b.settings.snap).toBe(5)
  })

  it('version 1、settings 等於 DEFAULT_SETTINGS、room 300×400', () => {
    const plan = defaultPlan()
    expect(plan.version).toBe(1)
    expect(plan.settings).toEqual(DEFAULT_SETTINGS)
    expect(plan.room.width).toBe(300)
    expect(plan.room.depth).toBe(400)
    expect(plan.room.blocks).toEqual([])
    expect(plan.room.doors).toEqual([])
    expect(plan.items).toEqual([])
  })
})

describe('newId()', () => {
  it('符合 ID_RE，為 16 碼小寫 hex', () => {
    const id = newId()
    expect(id).toMatch(ID_RE)
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('1000 次呼叫皆不重複', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(newId())
    expect(ids.size).toBe(1000)
  })
})

describe('LIMITS（OQ4 定案）', () => {
  it('items === 75、walls === 200', () => {
    expect(LIMITS.items).toBe(75)
    expect(LIMITS.walls).toBe(200)
  })
})

describe('家具件數軟上限（T4.7）', () => {
  it('預設 20，且警告門檻與預設值同數', () => {
    expect(MAX_ITEMS_DEFAULT).toBe(20)
    expect(MAX_ITEMS_WARN_ABOVE).toBe(20)
    expect(DEFAULT_SETTINGS.maxItems).toBe(MAX_ITEMS_DEFAULT)
    expect(defaultPlan().settings.maxItems).toBe(MAX_ITEMS_DEFAULT)
  })

  it('isValidMaxItems：整數 1–75 為真，越界／非整數／非數值為假', () => {
    for (const good of [1, 20, 74, 75]) expect(isValidMaxItems(good)).toBe(true)
    for (const bad of [0, -1, 76, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null, undefined]) {
      expect(isValidMaxItems(bad)).toBe(false)
    }
  })

  it('上界恰為 LIMITS.items（軟上限永不超過硬上限）', () => {
    expect(isValidMaxItems(LIMITS.items)).toBe(true)
    expect(isValidMaxItems(LIMITS.items + 1)).toBe(false)
  })
})
