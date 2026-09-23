// @vitest-environment jsdom
/**
 * T2.3 — `drag.ts` 的 jsdom 接線網（(internal design doc)
 * §D2「jsdom 承接（Round 1 C4 實證）」的 stub 清單、§D10「拖移態統一」、
 * §Verification jsdom 段「pointer 拖移接線案／capture 缺席不 throw／方向鍵
 * 進拖移態→靜默後 commit→`aria-label`＋播報／Esc 還原／靜默期間 undo 先
 * commit」）。
 *
 * jsdom 29.1.1 的實測邊界（本檔 fixture 即依此建立，probe 已核對）：
 * 有 `PointerEvent` 建構子且 `pointerId`／`clientX`／`button` 可用；
 * **無** `setPointerCapture`／`hasPointerCapture`／`releasePointerCapture`；
 * SVG `getBoundingClientRect()` 恆全零，故本檔 stub 一個假 rect；
 * `<g tabindex>` 的 `focus()` 會正常設定 `document.activeElement`。
 *
 * 斷言範圍限「事件接線與拖移態」——像素精度歸 e2e（PLAN D2）。計時器與
 * rAF 一律由 `DragHost` 注入假物件手動 flush，不用 `vi.useFakeTimers()`：
 * 本檔同時跑多個 controller，全域假計時器會讓「哪個 controller 的計時器」
 * 難以區辨。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachDrag, DOOR_SNAP_CM, KEYBOARD_QUIET_MS, STEP_CM, STEP_CM_SHIFT } from './drag.js'
import type { DragController, DragHost, NodeKind } from './drag.js'
import { defaultPlan } from './model.js'
import type { RoomPlan } from './model.js'
import type { Edge } from './room-shape.js'
import type { GridSize } from './snap.js'
import type { UiState } from './ui-state.js'

/** 假畫布尺寸：scale 恰為 1、letterbox 位移恰為 0 → px 數值即 cm 數值。 */
const BOARD_RECT = { left: 0, top: 0, width: 300, height: 400 }
const VIEW_BOX = { minX: 0, minY: 0, w: 300, h: 400 }

/** 家具 a：60×100、左上角 (100,50)；家具 b：40×40、左上角 (10,10)。 */
function buildPlan(): RoomPlan {
  const plan = defaultPlan()
  plan.items = [
    {
      id: 'a',
      name: '衣櫃',
      color: '#9db4d6',
      width: 60,
      depth: 100,
      x: 100,
      y: 50,
      rotation: 0,
      passable: false,
    },
    {
      id: 'b',
      name: '書桌',
      color: '#9db4d6',
      width: 40,
      depth: 40,
      x: 10,
      y: 10,
      rotation: 0,
      passable: false,
    },
  ]
  // T5.2：東牆上的門（鉸鏈 (300,270)、leafDir '-'、寬 70、內開），迴旋區
  // 覆蓋 [230,300]×[200,270]——命中區測試的落點取自這一片。
  plan.room.doors = [{ id: 'd1', x: 300, y: 270, wall: 'E', leafDir: '-', width: 70, swing: 'in' }]
  return plan
}

/** 預設房（300×400）東牆的極大牆段；門的磁吸軌道（D6／T5.2）。 */
const EAST_EDGE: Edge = { x0: 300, y0: 0, x1: 300, y1: 400, wall: 'E' }

function stubbedRect(): DOMRect {
  const { left, top, width, height } = BOARD_RECT
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

function keyEvent(type: string, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init })
}

interface Harness {
  svg: SVGSVGElement
  controller: DragController
  host: DragHost
  plan: RoomPlan
  ui: { selectedId: string | null }
  /** 依序記錄 host 回呼（用來斷言「select 先於 dragBegin」這類次序契約）。 */
  calls: string[]
  spies: {
    select: ReturnType<typeof vi.fn>
    dragBegin: ReturnType<typeof vi.fn>
    dragMove: ReturnType<typeof vi.fn>
    dragCancel: ReturnType<typeof vi.fn>
    dragCommit: ReturnType<typeof vi.fn>
    dispatch: ReturnType<typeof vi.fn>
    focusRestoreButton: ReturnType<typeof vi.fn>
    setTimeout: ReturnType<typeof vi.fn>
    clearTimeout: ReturnType<typeof vi.fn>
    rafRequest: ReturnType<typeof vi.fn>
    rafCancel: ReturnType<typeof vi.fn>
  }
  node(id: string): SVGElement
  hit(id: string): SVGElement
  flushFrames(): void
  flushTimers(): void
  pendingTimerDelays(): number[]
}

let attached: DragController[] = []

afterEach(() => {
  for (const controller of attached) controller.detach()
  attached = []
  document.body.innerHTML = ''
})

/**
 * T5.2 門節點的 fixture 片段：命中形（扇形＋門扇加厚帶）在前、可見門扇在
 * 後，形狀與 `board.ts` `createDoorNode()`／`doorHitRect()` 的輸出逐字
 * 相同。**只在 `options.door` 時加入**——既有的 `,`／`.` 環狀切換案以
 * 「畫布上恰兩個節點」為前提，不得被本批的新節點改寫。
 */
const DOOR_FIXTURE = [
  '<g class="node node--door" data-kind="door" data-id="d1" role="button" tabindex="-1"',
  ' aria-label="門 70 cm，東牆，內開">',
  '<path class="door-hit door-hit--swing" data-part="hit-swing" data-testid="door-hit-d1"',
  ' d="M 300 270 L 300 200 A 70 70 0 0 0 230 270 Z"></path>',
  '<rect class="door-hit door-hit--leaf" data-part="hit-leaf" data-testid="door-band-d1"',
  ' x="288" y="200" width="12" height="70"></rect>',
  '<line class="door-leaf" data-part="leaf" x1="300" y1="200" x2="300" y2="270"></line></g>',
].join('')

function createHarness(
  options: { grid?: GridSize; magnet?: number; edges?: Edge[]; door?: boolean } = {},
): Harness {
  // fixture 以 HTML 字串建立：jsdom 的 HTML 剖析器會把 `<svg>` 內的子節點
  // 放進 SVG 命名空間，`data-*`／`closest()`／`focus()` 行為與真實瀏覽器
  // 一致（probe 實測）。節點形狀依 board.ts 的 DOM 契約。
  document.body.innerHTML = [
    '<svg id="board-svg" xmlns="http://www.w3.org/2000/svg">',
    '<g class="node node--item" data-kind="item" data-id="a" role="button" tabindex="0"',
    ' aria-label="衣櫃 60×100 cm，位置 100,50">',
    '<rect data-testid="item-a" x="100" y="50" width="60" height="100"></rect></g>',
    '<g class="node node--item" data-kind="item" data-id="b" role="button" tabindex="-1"',
    ' aria-label="書桌 40×40 cm，位置 10,10">',
    '<rect data-testid="item-b" x="10" y="10" width="40" height="40"></rect></g>',
    options.door === true ? DOOR_FIXTURE : '',
    '</svg>',
  ].join('')
  const svg = document.querySelector('#board-svg') as unknown as SVGSVGElement
  // D2：SVG `getBoundingClientRect()` 在 jsdom 恆全零，stub 成假 rect。
  svg.getBoundingClientRect = stubbedRect

  const plan = buildPlan()
  const ui = { selectedId: 'a' as string | null }
  const calls: string[] = []

  const frames = new Map<number, () => void>()
  let nextFrame = 0
  const rafRequest = vi.fn((fn: () => void): number => {
    nextFrame += 1
    frames.set(nextFrame, fn)
    return nextFrame
  })
  const rafCancel = vi.fn((handle: number): void => {
    frames.delete(handle)
  })

  const pendingTimers = new Map<number, { fn: () => void; ms: number }>()
  let nextTimer = 0
  const setTimeoutSpy = vi.fn((fn: () => void, ms: number): unknown => {
    nextTimer += 1
    pendingTimers.set(nextTimer, { fn, ms })
    return nextTimer
  })
  const clearTimeoutSpy = vi.fn((handle: unknown): void => {
    pendingTimers.delete(handle as number)
  })

  /** host 的 dragMove＝`reducer.dragTo` 的最小替身：直接寫回 plan。 */
  function writePosition(kind: NodeKind, id: string, x: number, y: number): void {
    if (kind !== 'item') return
    const item = plan.items.find((candidate) => candidate.id === id)
    if (item === undefined) return
    item.x = x
    item.y = y
  }

  const select = vi.fn((kind: NodeKind, id: string) => {
    calls.push(`select:${kind}:${id}`)
    ui.selectedId = id
  })
  const dragBegin = vi.fn((kind: NodeKind, id: string, source: string) => {
    calls.push(`dragBegin:${kind}:${id}:${source}`)
  })
  const dragMove = vi.fn((kind: NodeKind, id: string, x: number, y: number) => {
    calls.push(`dragMove:${kind}:${id}:${x},${y}`)
    writePosition(kind, id, x, y)
  })
  const dragCancel = vi.fn(() => {
    calls.push('dragCancel')
  })
  const dragCommit = vi.fn(() => {
    calls.push('dragCommit')
  })
  const dispatch = vi.fn((action: { type: string }) => {
    calls.push(`dispatch:${action.type}`)
  })
  const focusRestoreButton = vi.fn((id: string) => {
    calls.push(`focusRestoreButton:${id}`)
  })

  const host: DragHost = {
    getPlan: () => plan,
    getUi: () => ui as UiState,
    messages: {} as DragHost['messages'],
    getBoardRect: () => {
      const rect = svg.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    },
    getViewBox: () => VIEW_BOX,
    snapContext: () => ({
      grid: options.grid ?? 1,
      magnet: options.magnet ?? 0,
      edges: options.edges ?? [],
      neighbors: [],
    }),
    select,
    dragBegin,
    dragMove,
    dragCancel,
    dragCommit,
    dispatch,
    announce: () => {},
    focusRestoreButton,
    timers: { setTimeout: setTimeoutSpy, clearTimeout: clearTimeoutSpy },
    raf: { request: rafRequest, cancel: rafCancel },
  }

  const controller = attachDrag(svg, host)
  attached.push(controller)

  return {
    svg,
    controller,
    host,
    plan,
    ui,
    calls,
    spies: {
      select,
      dragBegin,
      dragMove,
      dragCancel,
      dragCommit,
      dispatch,
      focusRestoreButton,
      setTimeout: setTimeoutSpy,
      clearTimeout: clearTimeoutSpy,
      rafRequest,
      rafCancel,
    },
    node: (id) => svg.querySelector(`[data-id="${id}"]`) as unknown as SVGElement,
    hit: (id) => svg.querySelector(`[data-testid="item-${id}"]`) as unknown as SVGElement,
    flushFrames: () => {
      const pending = [...frames.values()]
      frames.clear()
      for (const fn of pending) fn()
    },
    flushTimers: () => {
      const pending = [...pendingTimers.values()]
      pendingTimers.clear()
      for (const entry of pending) entry.fn()
    },
    pendingTimerDelays: () => [...pendingTimers.values()].map((entry) => entry.ms),
  }
}

describe('pointer 拖移接線（PLAN D2 stub 清單）', () => {
  it('down→move→up：座標與假 rect 換算一致、select 先於 dragBegin、commit 恰一次', () => {
    const h = createHarness()

    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )

    // 抓取位移＝已提交座標 (100,50) − 指標 cm (110,60) ＝ (−10,−10)。
    expect(h.calls).toEqual(['select:item:a', 'dragBegin:item:a:pointer'])
    expect(document.activeElement).toBe(h.node('a'))

    h.svg.dispatchEvent(
      pointerEvent('pointermove', { clientX: 150, clientY: 80, button: -1, pointerId: 1 }),
    )
    // rAF 合併：尚未 flush 前不得有任何位移送出。
    expect(h.spies.dragMove).not.toHaveBeenCalled()
    expect(h.spies.rafRequest).toHaveBeenCalledTimes(1)

    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenCalledTimes(1)
    expect(h.spies.dragMove).toHaveBeenCalledWith('item', 'a', 140, 70)

    h.svg.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 80, pointerId: 1 }))
    expect(h.spies.rafCancel).toHaveBeenCalled()
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)
    expect(h.spies.dragCancel).not.toHaveBeenCalled()
    expect(h.controller.isDragging()).toBe(false)
  })

  it('多筆 pointermove 只排一個幀，pointerup 同步補上未套用的最後一筆', () => {
    const h = createHarness()
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )

    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 130, clientY: 70, pointerId: 1 }))
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 80, pointerId: 1 }))
    expect(h.spies.rafRequest).toHaveBeenCalledTimes(1)

    // 未 flush 就放開：三出口先 cancel，再以同一算式同步套用最後一筆。
    h.svg.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 80, pointerId: 1 }))
    expect(h.spies.dragMove).toHaveBeenCalledTimes(1)
    expect(h.spies.dragMove).toHaveBeenCalledWith('item', 'a', 140, 70)
    expect(h.spies.rafCancel).toHaveBeenCalledTimes(1)
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)

    // 已被 cancel 的幀不得再跑（否則會多送一筆位移）。
    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenCalledTimes(1)
  })

  it('位移落點確實過 snapContext（grid 10 → 143,73 吸為 140,70）', () => {
    const h = createHarness({ grid: 10 })
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 153, clientY: 83, pointerId: 1 }))
    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenCalledWith('item', 'a', 140, 70)
  })

  it('capture 三件缺席（jsdom 原生）不 throw；存在時 down/up 各呼叫一次', () => {
    const bare = createHarness()
    expect(
      (bare.svg as unknown as { setPointerCapture?: unknown }).setPointerCapture,
    ).toBeUndefined()
    expect(() => {
      bare
        .hit('a')
        .dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }))
      bare.svg.dispatchEvent(pointerEvent('pointerup', { clientX: 110, clientY: 60, pointerId: 1 }))
    }).not.toThrow()
    expect(bare.spies.dragCommit).toHaveBeenCalledTimes(1)

    const h = createHarness()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(h.svg, { setPointerCapture, releasePointerCapture })
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )
    expect(setPointerCapture).toHaveBeenCalledWith(1)
    h.svg.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 80, pointerId: 1 }))
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('pointercancel → dragCancel，且該指標後續的 pointermove 不再送位移', () => {
    const h = createHarness()
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 80, pointerId: 1 }))
    h.svg.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 }))

    expect(h.spies.dragCancel).toHaveBeenCalledTimes(1)
    expect(h.spies.rafCancel).toHaveBeenCalledTimes(1)
    expect(h.controller.isDragging()).toBe(false)

    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 200, clientY: 200, pointerId: 1 }))
    h.flushFrames()
    expect(h.spies.dragMove).not.toHaveBeenCalled()
    expect(h.spies.dragCommit).not.toHaveBeenCalled()
  })

  it('lostpointercapture 與 Esc 同樣取消（D2 三者等效）', () => {
    const lost = createHarness()
    lost
      .hit('a')
      .dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }))
    lost.svg.dispatchEvent(pointerEvent('lostpointercapture', { pointerId: 1 }))
    expect(lost.spies.dragCancel).toHaveBeenCalledTimes(1)
    expect(lost.spies.dragCommit).not.toHaveBeenCalled()

    const esc = createHarness()
    esc
      .hit('a')
      .dispatchEvent(pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }))
    esc.node('a').dispatchEvent(keyEvent('keydown', 'Escape'))
    expect(esc.spies.dragCancel).toHaveBeenCalledTimes(1)
    expect(esc.spies.dragCommit).not.toHaveBeenCalled()
    expect(esc.controller.isDragging()).toBe(false)
  })

  it('非主鍵與非節點目標不進拖移態', () => {
    const h = createHarness()
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 2, pointerId: 1 }),
    )
    h.svg.dispatchEvent(pointerEvent('pointerdown', { clientX: 5, clientY: 5, button: 0, pointerId: 2 }))
    expect(h.spies.dragBegin).not.toHaveBeenCalled()
    expect(h.spies.select).not.toHaveBeenCalled()
    expect(h.controller.isDragging()).toBe(false)
  })
})

describe('門的命中區與磁吸（T5.2，M5 回饋 2／6）', () => {
  /** 迴旋區扇形內的一點（鉸鏈 (300,270) 往室內 20,20 → 距鉸鏈 28.3 < 70）。 */
  const INSIDE_SECTOR = { clientX: 280, clientY: 250 }

  function sector(h: Harness): SVGElement {
    return h.svg.querySelector('[data-testid="door-hit-d1"]') as unknown as SVGElement
  }

  it('pointerdown 落在迴旋區扇形內 → 命中門節點（select→dragBegin），move 送 door 位移', () => {
    const h = createHarness({ door: true, edges: [EAST_EDGE] })
    sector(h).dispatchEvent(pointerEvent('pointerdown', { ...INSIDE_SECTOR, button: 0, pointerId: 1 }))
    expect(h.calls).toEqual(['select:door:d1', 'dragBegin:door:d1:pointer'])
    expect(document.activeElement).toBe(h.node('d1'))

    // 抓取位移 (20,20)：指標往上 30 cm → 門的鉸鏈自 (300,270) 到 (300,240)。
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 280, clientY: 220, pointerId: 1 }))
    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenCalledWith('door', 'd1', 300, 240)

    h.svg.dispatchEvent(pointerEvent('pointerup', { clientX: 280, clientY: 220, pointerId: 1 }))
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)
  })

  it('加厚的門扇帶同樣命中（零寬門扇線拖不到，正是回饋 6 的成因）', () => {
    const h = createHarness({ door: true, edges: [EAST_EDGE] })
    const band = h.svg.querySelector('[data-testid="door-band-d1"]') as unknown as SVGElement
    band.dispatchEvent(
      pointerEvent('pointerdown', { clientX: 294, clientY: 230, button: 0, pointerId: 1 }),
    )
    expect(h.spies.dragBegin).toHaveBeenCalledWith('door', 'd1', 'pointer')
  })

  it('落點吸到極大牆段：偏離 5 cm 仍吸回牆線上（門沿牆拖有黏性）', () => {
    const h = createHarness({ door: true, edges: [EAST_EDGE] })
    sector(h).dispatchEvent(pointerEvent('pointerdown', { ...INSIDE_SECTOR, button: 0, pointerId: 1 }))
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 275, clientY: 220, pointerId: 1 }))
    h.flushFrames()
    // 原始落點 (295,240) → 牆線上最近點 (300,240)。
    expect(h.spies.dragMove).toHaveBeenLastCalledWith('door', 'd1', 300, 240)
  })

  it('超過 DOOR_SNAP_CM 不吸（維持原落點，由 reducer 依 D6 拒收）', () => {
    const h = createHarness({ door: true, edges: [EAST_EDGE] })
    sector(h).dispatchEvent(pointerEvent('pointerdown', { ...INSIDE_SECTOR, button: 0, pointerId: 1 }))
    // 指標左移 40 cm → 落點 (260,240)，距牆 40 > 30。
    expect(DOOR_SNAP_CM).toBe(30)
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 240, clientY: 220, pointerId: 1 }))
    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenLastCalledWith('door', 'd1', 260, 240)
  })

  it('無牆段時退回「只取整」（不因磁吸而改變舊行為）', () => {
    const h = createHarness({ door: true })
    sector(h).dispatchEvent(pointerEvent('pointerdown', { ...INSIDE_SECTOR, button: 0, pointerId: 1 }))
    h.svg.dispatchEvent(pointerEvent('pointermove', { clientX: 275.4, clientY: 220, pointerId: 1 }))
    h.flushFrames()
    expect(h.spies.dragMove).toHaveBeenLastCalledWith('door', 'd1', 295, 240)
  })
})

describe('鍵盤拖移態（PLAN D10：keyup 後 500 ms 靜默才 commit）', () => {
  it('方向鍵進拖移態 → 靜默 commit → 再按一次另起新拖移', () => {
    const h = createHarness()
    const node = h.node('a')
    node.focus()

    node.dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    expect(h.calls).toEqual(['dragBegin:item:a:keyboard', `dragMove:item:a:${100 + STEP_CM},50`])
    expect(h.controller.isDragging()).toBe(true)
    expect(h.spies.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), KEYBOARD_QUIET_MS)

    // Shift＝十倍步進，且自**目前** plan 座標累加（不重回原點）。
    node.dispatchEvent(keyEvent('keydown', 'ArrowDown', { shiftKey: true }))
    expect(h.spies.dragMove).toHaveBeenLastCalledWith('item', 'a', 101, 50 + STEP_CM_SHIFT)
    expect(h.spies.dragBegin).toHaveBeenCalledTimes(1)

    // keyup 亦重啟靜默計時，且全程只留一個未決計時器。
    const clearsBefore = h.spies.clearTimeout.mock.calls.length
    node.dispatchEvent(keyEvent('keyup', 'ArrowDown'))
    expect(h.spies.clearTimeout.mock.calls.length).toBe(clearsBefore + 1)
    expect(h.pendingTimerDelays()).toEqual([KEYBOARD_QUIET_MS])

    h.flushTimers()
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)
    expect(h.controller.isDragging()).toBe(false)

    node.dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    expect(h.spies.dragBegin).toHaveBeenCalledTimes(2)
    expect(h.spies.dragBegin).toHaveBeenLastCalledWith('item', 'a', 'keyboard')
    expect(h.spies.dragMove).toHaveBeenLastCalledWith('item', 'a', 102, 60)
  })

  it('方向鍵一律 preventDefault（不捲動頁面）', () => {
    const h = createHarness()
    const event = keyEvent('keydown', 'ArrowRight')
    h.node('a').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Esc 取消鍵盤拖移：計時器清空、之後不再 commit', () => {
    const h = createHarness()
    const node = h.node('a')
    node.dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    node.dispatchEvent(keyEvent('keydown', 'Escape'))

    expect(h.spies.dragCancel).toHaveBeenCalledTimes(1)
    expect(h.pendingTimerDelays()).toEqual([])
    h.flushTimers()
    expect(h.spies.dragCommit).not.toHaveBeenCalled()
    expect(h.controller.isDragging()).toBe(false)
  })

  it('靜默期間 undo（host 呼叫 commitNow）→ 先 commit，計時器不再重複 commit', () => {
    const h = createHarness()
    h.node('a').dispatchEvent(keyEvent('keydown', 'ArrowRight'))

    h.controller.commitNow()
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)
    expect(h.calls).toEqual(['dragBegin:item:a:keyboard', 'dragMove:item:a:101,50', 'dragCommit'])
    expect(h.controller.isDragging()).toBe(false)

    h.flushTimers()
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)

    // 指標拖移態不受 commitNow 影響（其 commit 觸發恆為 pointerup）。
    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )
    h.controller.commitNow()
    expect(h.spies.dragCommit).toHaveBeenCalledTimes(1)
    expect(h.controller.isDragging()).toBe(true)
  })

  it('靜默期間 pointerdown → 先 commit 再開新的指標拖移（commit-then-handle）', () => {
    const h = createHarness()
    h.node('a').dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    h.hit('b').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, pointerId: 1 }),
    )
    expect(h.calls).toEqual([
      'dragBegin:item:a:keyboard',
      'dragMove:item:a:101,50',
      'dragCommit',
      'select:item:b',
      'dragBegin:item:b:pointer',
    ])
  })
})

describe('鍵盤動作：R／Delete／`,`／`.`', () => {
  it('R → 先 commit 未決拖移再送 item/rotate', () => {
    const h = createHarness()
    const node = h.node('a')
    node.dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    node.dispatchEvent(keyEvent('keydown', 'r'))

    expect(h.calls).toEqual([
      'dragBegin:item:a:keyboard',
      'dragMove:item:a:101,50',
      'dragCommit',
      'dispatch:item/rotate',
    ])
    expect(h.spies.dispatch).toHaveBeenLastCalledWith({ type: 'item/rotate', id: 'a' })
  })

  it('Ctrl+R 不攔截（留給瀏覽器重新整理）', () => {
    const h = createHarness()
    const event = keyEvent('keydown', 'r', { ctrlKey: true })
    h.node('a').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(h.spies.dispatch).not.toHaveBeenCalled()
  })

  it('Delete → item/delete，焦點交給「還原 {name}」鈕', () => {
    const h = createHarness()
    h.node('a').dispatchEvent(keyEvent('keydown', 'Delete'))
    expect(h.spies.dispatch).toHaveBeenCalledWith({ type: 'item/delete', id: 'a' })
    expect(h.calls).toEqual(['dispatch:item/delete', 'focusRestoreButton:a'])
  })

  it('Backspace 等效於 Delete', () => {
    const h = createHarness()
    h.node('b').dispatchEvent(keyEvent('keydown', 'Backspace'))
    expect(h.spies.dispatch).toHaveBeenCalledWith({ type: 'item/delete', id: 'b' })
    expect(h.spies.focusRestoreButton).toHaveBeenCalledWith('b')
  })

  it('`.`／`,` 依 DOM 序切換並環繞，focus 跟著移動', () => {
    const h = createHarness()
    h.node('a').focus()

    h.node('a').dispatchEvent(keyEvent('keydown', '.'))
    expect(h.spies.select).toHaveBeenLastCalledWith('item', 'b')
    expect(document.activeElement).toBe(h.node('b'))

    h.node('b').dispatchEvent(keyEvent('keydown', '.'))
    expect(h.spies.select).toHaveBeenLastCalledWith('item', 'a')
    expect(document.activeElement).toBe(h.node('a'))

    h.node('a').dispatchEvent(keyEvent('keydown', ','))
    expect(h.spies.select).toHaveBeenLastCalledWith('item', 'b')
    expect(document.activeElement).toBe(h.node('b'))
  })

  it('deleted 家具沒有節點，切換時自然跳過（不需另設過濾）', () => {
    const h = createHarness()
    // 模擬 b 被刪除後 board.renderCommit 移除其節點。
    h.node('b').remove()
    h.node('a').dispatchEvent(keyEvent('keydown', '.'))
    expect(h.spies.select).toHaveBeenLastCalledWith('item', 'a')
    expect(document.activeElement).toBe(h.node('a'))
  })

  it('切換選取前先 commit 未決的鍵盤拖移', () => {
    const h = createHarness()
    h.node('a').dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    h.node('a').dispatchEvent(keyEvent('keydown', '.'))
    expect(h.calls).toEqual([
      'dragBegin:item:a:keyboard',
      'dragMove:item:a:101,50',
      'dragCommit',
      'select:item:b',
    ])
  })
})

describe('生命週期與原始碼不變量', () => {
  it('detach() 後事件不再作用，且清掉未決計時器', () => {
    const h = createHarness()
    h.node('a').dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    expect(h.pendingTimerDelays()).toEqual([KEYBOARD_QUIET_MS])

    h.controller.detach()
    expect(h.pendingTimerDelays()).toEqual([])
    expect(h.controller.isDragging()).toBe(false)

    h.hit('a').dispatchEvent(
      pointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 0, pointerId: 1 }),
    )
    h.node('a').dispatchEvent(keyEvent('keydown', 'ArrowRight'))
    expect(h.spies.dragBegin).toHaveBeenCalledTimes(1)
    expect(h.spies.select).not.toHaveBeenCalled()
  })

  it('drag.ts 不使用 innerHTML（PLAN D7 DOM 寫入不變量）', () => {
    const source = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'drag.ts'),
      'utf-8',
    )
    expect(source).not.toContain('innerHTML')
    expect(source).not.toContain('insertAdjacentHTML')
  })
})
