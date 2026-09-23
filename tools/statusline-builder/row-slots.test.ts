/**
 * T5.14（(internal design doc) T5.14／PLAN Rev 11，
 * 2026-07-12 使用者裁決「列耗盡保留＋暫存列位置制」）：row-slots.ts 純
 * 函式單元測試——slots 位置制的枚舉／映射（realCount／realIndexOfSlot／
 * slotIndexOfRealRow）、各變異點（append／remove／consume／convert）＋
 * 防禦收斂（reconcileRealSlots），並釘死「consume 與 convert 皆不改變
 * slot 位置」不變量與中間 pending 的組合情境。
 *
 * T5.14 追修（協調者 CDP 實證 S4「空列成真＋來源耗盡抵銷」）：新增
 * `slotsEqual` 測試——含「real +1／−1 抵銷後 slots 實際不同（kind 序不同）
 * 但長度相同」情境（釘死本追修的 root cause 案例）。
 *
 * MAGI code review I-3（(internal design doc)
 * REVIEW.md，2026-07-12 使用者裁決「修」）：新增 `planSegmentMove`
 * 組合矩陣測試——每案斷言 targetRow／nextSlots／bumpIds 三者，涵蓋
 * pending/real target × 耗盡/非耗盡/同列、sourceRow 相對 targetRow 三向、
 * 多個中間 pending 擇一 consume、S4 抵銷案原樣重現、bumpIds 排除 moved
 * 與停用段。
 */
import { describe, expect, it } from 'vitest'
import {
  appendPendingSlot,
  consumePendingSlot,
  convertRealToPending,
  planSegmentMove,
  realCount,
  realIndexOfSlot,
  reconcileRealSlots,
  removeSlotAt,
  slotIndexOfRealRow,
  slotsEqual,
  type PlanSegmentInput,
  type RowSlot,
} from './row-slots.js'

describe('realCount（real slot 數）', () => {
  it('空 slots → 0', () => {
    expect(realCount([])).toBe(0)
  })

  it('僅 real', () => {
    expect(realCount(['real', 'real', 'real'])).toBe(3)
  })

  it('real／pending 交錯只計 real', () => {
    expect(realCount(['real', 'pending', 'real'])).toBe(2)
    expect(realCount(['pending', 'pending'])).toBe(0)
  })
})

describe('realIndexOfSlot（slotIndex 之前不含的 real 數）', () => {
  it('real slot 之上＝其真實列 index', () => {
    const slots: RowSlot[] = ['real', 'real', 'real']
    expect(realIndexOfSlot(slots, 0)).toBe(0)
    expect(realIndexOfSlot(slots, 1)).toBe(1)
    expect(realIndexOfSlot(slots, 2)).toBe(2)
  })

  it('pending slot 之上＝指派成真時的插入 real index', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    // 中間 pending：其前有 1 個 real → 插入時成為第 1 個 real（0-index）。
    expect(realIndexOfSlot(slots, 1)).toBe(1)
  })

  it('slotIndex 為長度（末端）→ 全部 real 數', () => {
    expect(realIndexOfSlot(['real', 'pending', 'real'], 3)).toBe(2)
    expect(realIndexOfSlot(['pending'], 1)).toBe(0)
  })

  it('前導 pending 不計入', () => {
    expect(realIndexOfSlot(['pending', 'real'], 0)).toBe(0)
    expect(realIndexOfSlot(['pending', 'real'], 1)).toBe(0)
    expect(realIndexOfSlot(['pending', 'real'], 2)).toBe(1)
  })
})

describe('slotIndexOfRealRow（第 rowIndex 個 real 的 slot 位置）', () => {
  it('僅 real 時＝rowIndex 本身', () => {
    const slots: RowSlot[] = ['real', 'real', 'real']
    expect(slotIndexOfRealRow(slots, 0)).toBe(0)
    expect(slotIndexOfRealRow(slots, 2)).toBe(2)
  })

  it('中間 pending 使其後 real 的 slot 位置右移', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    expect(slotIndexOfRealRow(slots, 0)).toBe(0)
    expect(slotIndexOfRealRow(slots, 1)).toBe(2)
  })

  it('前導 pending', () => {
    expect(slotIndexOfRealRow(['pending', 'real', 'real'], 0)).toBe(1)
    expect(slotIndexOfRealRow(['pending', 'real', 'real'], 1)).toBe(2)
  })

  it('rowIndex 超出範圍（防禦）→ 回傳長度（past-the-end）', () => {
    expect(slotIndexOfRealRow(['real', 'real'], 2)).toBe(2)
    expect(slotIndexOfRealRow(['pending'], 0)).toBe(1)
  })

  it('與 realIndexOfSlot 互逆：real slot 經 realIndexOfSlot 再 slotIndexOfRealRow 回到原位', () => {
    const slots: RowSlot[] = ['pending', 'real', 'pending', 'real']
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== 'real') continue
      const rowIndex = realIndexOfSlot(slots, i)
      expect(slotIndexOfRealRow(slots, rowIndex)).toBe(i)
    }
  })
})

describe('appendPendingSlot（新增一列＝末端補 pending）', () => {
  it('於末端追加 pending，不 mutate 輸入', () => {
    const input: RowSlot[] = ['real']
    const next = appendPendingSlot(input)
    expect(next).toEqual(['real', 'pending'])
    expect(input).toEqual(['real'])
  })

  it('空 slots → 單一 pending', () => {
    expect(appendPendingSlot([])).toEqual(['pending'])
  })
})

describe('removeSlotAt（點哪刪哪／真實列消失）', () => {
  it('移除指定位置的 slot，不 mutate 輸入', () => {
    const input: RowSlot[] = ['real', 'pending', 'real']
    const next = removeSlotAt(input, 1)
    expect(next).toEqual(['real', 'real'])
    expect(input).toEqual(['real', 'pending', 'real'])
  })

  it('移除中間 real', () => {
    expect(removeSlotAt(['real', 'real', 'real'], 1)).toEqual(['real', 'real'])
  })

  it('移除末端', () => {
    expect(removeSlotAt(['real', 'pending'], 1)).toEqual(['real'])
  })
})

describe('consumePendingSlot（pending→real，位置不變）', () => {
  it('翻該位置為 real、其餘不動、不 mutate 輸入', () => {
    const input: RowSlot[] = ['real', 'pending', 'real']
    const next = consumePendingSlot(input, 1)
    expect(next).toEqual(['real', 'real', 'real'])
    expect(input).toEqual(['real', 'pending', 'real'])
  })

  it('位置不變（陣列長度與其他 slot 保持）', () => {
    const next = consumePendingSlot(['pending', 'pending', 'real'], 0)
    expect(next).toEqual(['real', 'pending', 'real'])
  })
})

describe('convertRealToPending（real→pending，列耗盡保留；位置不變）', () => {
  it('翻該位置為 pending、其餘不動、不 mutate 輸入', () => {
    const input: RowSlot[] = ['real', 'real', 'real']
    const next = convertRealToPending(input, 2)
    expect(next).toEqual(['real', 'real', 'pending'])
    expect(input).toEqual(['real', 'real', 'real'])
  })

  it('中間 real 耗盡保留為中間 pending（不壓縮）', () => {
    expect(convertRealToPending(['real', 'real', 'real'], 1)).toEqual(['real', 'pending', 'real'])
  })
})

describe('不變量：consume 與 convert 皆不改變 slot 位置（僅翻 kind、長度不變）', () => {
  it('consume 後長度不變、其他索引 kind 不變', () => {
    const input: RowSlot[] = ['real', 'pending', 'pending', 'real']
    const next = consumePendingSlot(input, 2)
    expect(next.length).toBe(input.length)
    for (let i = 0; i < input.length; i++) {
      if (i === 2) continue
      expect(next[i]).toBe(input[i])
    }
  })

  it('convert 後長度不變、其他索引 kind 不變', () => {
    const input: RowSlot[] = ['real', 'real', 'pending', 'real']
    const next = convertRealToPending(input, 0)
    expect(next.length).toBe(input.length)
    for (let i = 0; i < input.length; i++) {
      if (i === 0) continue
      expect(next[i]).toBe(input[i])
    }
  })
})

describe('組合情境（映射連貫性）', () => {
  it('中間 pending 被 consume 後，realIndexOfSlot 映射連續遞增', () => {
    // ['real','pending','real'] → 指派入中間空列（consume slot 1）。
    const consumed = consumePendingSlot(['real', 'pending', 'real'], 1)
    expect(consumed).toEqual(['real', 'real', 'real'])
    expect(realIndexOfSlot(consumed, 0)).toBe(0)
    expect(realIndexOfSlot(consumed, 1)).toBe(1)
    expect(realIndexOfSlot(consumed, 2)).toBe(2)
  })

  it('來源列 convert 後，slotIndexOfRealRow 對其餘 real 列的映射（原位保留空列）', () => {
    // ['real','real','real']（第1／2/3列）→ 第 2 列（real index 1）耗盡保留。
    const converted = convertRealToPending(['real', 'real', 'real'], 1)
    expect(converted).toEqual(['real', 'pending', 'real'])
    // 其餘兩個 real 列的 slot 位置：real index 0 仍在 slot 0；real index 1
    // （原第 3 列）現在 slot 2 → 顯示編號仍為「第 3 列」（slot+1）。
    expect(slotIndexOfRealRow(converted, 0)).toBe(0)
    expect(slotIndexOfRealRow(converted, 1)).toBe(2)
  })
})

describe('reconcileRealSlots（防禦收斂；理論上為 no-op）', () => {
  it('real 數已等於 target → 原樣（no-op）', () => {
    expect(reconcileRealSlots(['real', 'pending', 'real'], 2)).toEqual(['real', 'pending', 'real'])
  })

  it('real 數不足 → 於最後一個 real 之後補', () => {
    expect(reconcileRealSlots(['real', 'pending'], 2)).toEqual(['real', 'real', 'pending'])
  })

  it('無 real 且需補 → 於 slot 0 補', () => {
    expect(reconcileRealSlots(['pending', 'pending'], 1)).toEqual(['real', 'pending', 'pending'])
  })

  it('real 數過多 → 自尾端 real 移除', () => {
    expect(reconcileRealSlots(['real', 'real', 'pending', 'real'], 2)).toEqual(['real', 'real', 'pending'])
  })

  it('收斂為 0 real', () => {
    expect(reconcileRealSlots(['real', 'pending'], 0)).toEqual(['pending'])
  })

  it('收斂後 realCount 恆等於 target', () => {
    expect(realCount(reconcileRealSlots(['real', 'pending'], 3))).toBe(3)
    expect(realCount(reconcileRealSlots(['real', 'real', 'real'], 1))).toBe(1)
  })
})

describe('slotsEqual（T5.14 追修：main.ts 重繪閘門之 slots 變動偵測）', () => {
  it('兩者皆空 → true', () => {
    expect(slotsEqual([], [])).toBe(true)
  })

  it('長度與逐位置 kind 皆相同 → true（不同陣列參照亦視為相等）', () => {
    expect(slotsEqual(['real', 'pending', 'real'], ['real', 'pending', 'real'])).toBe(true)
  })

  it('長度不同 → false', () => {
    expect(slotsEqual(['real'], ['real', 'pending'])).toBe(false)
  })

  it('長度相同但某位置 kind 不同 → false', () => {
    expect(slotsEqual(['real', 'real'], ['real', 'pending'])).toBe(false)
  })

  it('CDP 實證 S4「空列成真＋來源耗盡抵銷」：real +1／−1 抵銷後長度相同、\
kind 序不同 → false（本追修 root cause 案例：real 總數與分組結構不變，\
但 slots 實際已變）', () => {
    // 初態 [pending, real(cost), real(duration,model)]；把 cost（其列唯一
    // 段）指派入 slot 0 空列 → consume slot 0（real+1）＋來源列（slot 1）
    // 耗盡 convert（real-1）→ 淨變動：kind 序由 [p,r,r] 變 [r,p,r]。
    const before: RowSlot[] = ['pending', 'real', 'real']
    const after: RowSlot[] = ['real', 'pending', 'real']
    expect(realCount(before)).toBe(realCount(after)) // real 總數抵銷後相同。
    expect(slotsEqual(before, after)).toBe(false) // 但 slots 本身已變。
  })

  it('與 row 分組無關的 commit（slots 未變）→ true，維持 Rev 2「不觸發全體刷新」語意', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    expect(slotsEqual(slots, [...slots])).toBe(true)
  })
})

describe('planSegmentMove（I-3：commitSegmentMove 決策層抽出，組合矩陣）', () => {
  it('pending target × 來源耗盡（sourceRow < targetRow）：末端插入且來源在其前', () => {
    // slots：row0(slot0)＝a、row1(slot1)＝b、slot2＝pending。移動 a（row0
    // 唯一段）入 slot2 → targetRow=2＞sourceRow=0。
    const slots: RowSlot[] = ['real', 'real', 'pending']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'b', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'a', { kind: 'pending', slotIndex: 2 })
    expect(plan.targetRow).toBe(2)
    expect(plan.nextSlots).toEqual(['pending', 'real', 'real'])
    expect(plan.bumpIds).toEqual([]) // b（row1）< targetRow(2)，不需 bump。
  })

  it('pending target × 來源耗盡（sourceRow > targetRow）：來源在其後，其餘段需 bump', () => {
    // slots：slot0＝pending、row0(slot1)＝a、row1(slot2)＝m（唯一段）。
    // 移動 m（row1）入 slot0 → targetRow=0＜sourceRow=1；a（row0）須 bump。
    const slots: RowSlot[] = ['pending', 'real', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'm', enabled: true, row: 1 },
      { id: 'a', enabled: true, row: 0 },
    ]
    const plan = planSegmentMove(slots, segments, 'm', { kind: 'pending', slotIndex: 0 })
    expect(plan.targetRow).toBe(0)
    expect(plan.nextSlots).toEqual(['real', 'real', 'pending'])
    expect(plan.bumpIds).toEqual(['a'])
  })

  it('pending target × 來源耗盡（sourceRow === targetRow，數值相同但仍非「同列插入」）：pending target 恆走轉換分支', () => {
    // slots：row0(slot0)＝a、slot1＝pending、row1(slot2)＝m（唯一段）。
    // realIndexOfSlot(slots,1)=1＝sourceRow(m 的 row1)——數值相同，但因
    // target.kind==='pending'，sameRowInsert 恆 false（僅 real target 才
    // 判同列），故仍走 convertRealToPending。
    const slots: RowSlot[] = ['real', 'pending', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'm', enabled: true, row: 1 },
      { id: 'a', enabled: true, row: 0 },
    ]
    const plan = planSegmentMove(slots, segments, 'm', { kind: 'pending', slotIndex: 1 })
    expect(plan.targetRow).toBe(1)
    expect(plan.nextSlots).toEqual(['real', 'real', 'pending'])
    expect(plan.bumpIds).toEqual([]) // a（row0）< targetRow(1)，不需 bump。
  })

  it('S4 抵銷案原樣重現（協調者 CDP 實證，2026-07-12）：consume+convert 後 realCount 不變但 slots 內容變', () => {
    // 初態 slots=[pending, real(cost), real(duration,model)]；把 cost（其列
    // 唯一段）指派入 slot 0 空列。
    const slots: RowSlot[] = ['pending', 'real', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'cost', enabled: true, row: 0 },
      { id: 'duration', enabled: true, row: 1 },
      { id: 'model', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'cost', { kind: 'pending', slotIndex: 0 })
    expect(plan.targetRow).toBe(0)
    expect(plan.nextSlots).toEqual(['real', 'pending', 'real'])
    expect(plan.bumpIds).toEqual(['duration', 'model']) // row1 ≥ targetRow(0) → 讓出空間。
    expect(realCount(plan.nextSlots)).toBe(realCount(slots)) // 抵銷：real 總數不變。
    expect(slotsEqual(plan.nextSlots, slots)).toBe(false) // 但 slots 內容已變（root cause）。
  })

  it('pending target × 非耗盡（來源列仍有其他啟用段）：不轉 pending', () => {
    // row0 有 a、x 兩段；移動 a 入 slot2（pending）。
    const slots: RowSlot[] = ['real', 'real', 'pending']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'x', enabled: true, row: 0 },
      { id: 'b', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'a', { kind: 'pending', slotIndex: 2 })
    expect(plan.targetRow).toBe(2)
    expect(plan.nextSlots).toEqual(['real', 'real', 'real']) // 無空列殘留——來源列未耗盡。
    expect(plan.bumpIds).toEqual([])
  })

  it('real target × 耗盡：移入既有真實列，來源原地保留為空列', () => {
    // a 為 row0 唯一段，移入 row1（與 b 同列）。
    const slots: RowSlot[] = ['real', 'real', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'b', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'a', { kind: 'real', row: 1 })
    expect(plan.targetRow).toBe(1)
    expect(plan.nextSlots).toEqual(['pending', 'real', 'real'])
    expect(plan.bumpIds).toEqual([]) // real target 恆無 bump。
  })

  it('real target × 同列（拖曳列內重排）：即使來源耗盡亦不轉 pending', () => {
    // a 為 row0 唯一段，target 仍為 row0（同列插入，如列內重排的退化情形）。
    const slots: RowSlot[] = ['real', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'b', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'a', { kind: 'real', row: 0 })
    expect(plan.targetRow).toBe(0)
    expect(plan.nextSlots).toEqual(['real', 'real']) // 不轉 pending（同列插入）。
    expect(plan.bumpIds).toEqual([])
  })

  it('多個中間 pending 擇一 consume：僅指定的那個翻 real，其餘 pending 不受影響', () => {
    // slot0=real(row0=a)、slot1=pending、slot2=real(row1=b，唯一段)、
    // slot3=pending。移動 b 入 slot3（非 slot1）。
    const slots: RowSlot[] = ['real', 'pending', 'real', 'pending']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'b', enabled: true, row: 1 },
    ]
    const plan = planSegmentMove(slots, segments, 'b', { kind: 'pending', slotIndex: 3 })
    expect(plan.targetRow).toBe(2)
    // slot1（另一個 pending）維持不變；被 consume 的是 slot3；b 原本的
    // slot（slot2）耗盡轉為 pending。
    expect(plan.nextSlots).toEqual(['real', 'pending', 'pending', 'real'])
    expect(plan.bumpIds).toEqual([]) // a（row0）< targetRow(2)，不需 bump。
  })

  it('bumpIds 排除 moved 自身與停用段', () => {
    // slot0=real(row0=a)、slot1=pending、slot2=real(row1=m+x 兩段)。移動
    // m 入 slot1（targetRow=1）：a（row0<1）不 bump；x（row1≥1）須 bump；
    // moved 自身（m）與停用段 d（雖 row≥targetRow）皆須排除。
    const slots: RowSlot[] = ['real', 'pending', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'm', enabled: true, row: 1 },
      { id: 'a', enabled: true, row: 0 },
      { id: 'x', enabled: true, row: 1 },
      { id: 'd', enabled: false, row: 5 },
    ]
    const plan = planSegmentMove(slots, segments, 'm', { kind: 'pending', slotIndex: 1 })
    expect(plan.targetRow).toBe(1)
    expect(plan.bumpIds).toEqual(['x']) // 排除 m（moved）與 d（停用）。
    // m 與 x 同列（row1）→ x 仍在，m 移出後該列未耗盡（srcDrains=false）
    // → 不轉 pending，僅 consume slot1。
    expect(plan.nextSlots).toEqual(['real', 'real', 'real'])
  })

  it('純函式：不 mutate 輸入 slots／segments', () => {
    const slots: RowSlot[] = ['real', 'pending', 'real']
    const segments: PlanSegmentInput[] = [
      { id: 'a', enabled: true, row: 0 },
      { id: 'm', enabled: true, row: 1 },
    ]
    const slotsSnapshot = [...slots]
    const segmentsSnapshot = segments.map((s) => ({ ...s }))
    planSegmentMove(slots, segments, 'm', { kind: 'pending', slotIndex: 1 })
    expect(slots).toEqual(slotsSnapshot)
    expect(segments).toEqual(segmentsSnapshot)
  })
})
