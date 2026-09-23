/**
 * T1.2（(internal design doc) §D1 A-3／Verification）：
 * row-separators.ts 純函式單元測試——`removeRealAt`／`insertNullAtReal`／
 * `padToLength` 各自基本案＋不 mutate 輸入＋邊界防禦，並釘死 PLAN
 * Verification 明列的「reindex 三型正反案」（刪中間列／空列壓縮／移列
 * swap）＋pending 物化案，收尾以組合矩陣 spike 案（比照 row-slots.test.ts
 * 既有矩陣風格：窮舉 ≤4 ops 全組合，斷言「非 null 覆寫恆跟隨其初始指派
 * 的渲染列、直到該列被刪除／壓縮則消滅」不變量）。
 */
import { describe, expect, it } from 'vitest'
import { insertNullAtReal, padToLength, removeRealAt, type RowSeparator } from './row-separators.js'

/** 測試用可區辨分隔符覆寫：每個原始列一個獨一無二的值，供追蹤「該列的
 * 覆寫是否仍跟著它」（value-equality 即身分）。 */
function tagFor(id: number): RowSeparator {
  return { kind: 'custom', value: `r${id}` }
}

describe('removeRealAt（real slot 消滅：真實列刪除／清空壓縮）', () => {
  it('移除中間位置，其後覆寫前移一格，不 mutate 輸入', () => {
    const input: RowSeparator[] = [tagFor(0), tagFor(1), tagFor(2)]
    const next = removeRealAt(input, 1)
    expect(next).toEqual([tagFor(0), tagFor(2)])
    expect(input).toEqual([tagFor(0), tagFor(1), tagFor(2)])
  })

  it('移除頭部', () => {
    expect(removeRealAt([tagFor(0), tagFor(1)], 0)).toEqual([tagFor(1)])
  })

  it('移除尾端', () => {
    expect(removeRealAt([tagFor(0), tagFor(1)], 1)).toEqual([tagFor(0)])
  })

  it('移除 null 覆寫（未覆寫列被壓縮）', () => {
    expect(removeRealAt([tagFor(0), null, tagFor(2)], 1)).toEqual([tagFor(0), tagFor(2)])
  })

  it('越界（防禦）→ no-op，回傳淺拷貝', () => {
    const input: RowSeparator[] = [tagFor(0), tagFor(1)]
    expect(removeRealAt(input, 5)).toEqual(input)
    expect(removeRealAt(input, -1)).toEqual(input)
  })
})

describe('insertNullAtReal（pending 空列物化成真實列：splice 入 null）', () => {
  it('於中間插入 null，其後覆寫同步後移，不 mutate 輸入', () => {
    const input: RowSeparator[] = [tagFor(0), tagFor(1)]
    const next = insertNullAtReal(input, 1)
    expect(next).toEqual([tagFor(0), null, tagFor(1)])
    expect(input).toEqual([tagFor(0), tagFor(1)])
  })

  it('於頭部插入', () => {
    expect(insertNullAtReal([tagFor(0), tagFor(1)], 0)).toEqual([null, tagFor(0), tagFor(1)])
  })

  it('於末端插入（等於長度）', () => {
    expect(insertNullAtReal([tagFor(0), tagFor(1)], 2)).toEqual([tagFor(0), tagFor(1), null])
  })

  it('空陣列插入', () => {
    expect(insertNullAtReal([], 0)).toEqual([null])
  })

  it('超出長度（防禦）→ clamp 至末端追加', () => {
    expect(insertNullAtReal([tagFor(0)], 99)).toEqual([tagFor(0), null])
  })

  it('負值（防禦）→ clamp 至 0', () => {
    expect(insertNullAtReal([tagFor(0)], -3)).toEqual([null, tagFor(0)])
  })
})

describe('padToLength（防禦性長度對齊：僅補不足，過長委回 config 清洗）', () => {
  it('不足 → 尾端補 null，不 mutate 輸入', () => {
    const input: RowSeparator[] = [tagFor(0)]
    const next = padToLength(input, 3)
    expect(next).toEqual([tagFor(0), null, null])
    expect(input).toEqual([tagFor(0)])
  })

  it('已達標 → no-op（仍回傳新陣列）', () => {
    const input: RowSeparator[] = [tagFor(0), tagFor(1)]
    expect(padToLength(input, 2)).toEqual(input)
  })

  it('已超過 target → no-op（不修剪，交由 config 端序列化清洗處理）', () => {
    const input: RowSeparator[] = [tagFor(0), tagFor(1), tagFor(2)]
    expect(padToLength(input, 1)).toEqual(input)
  })

  it('空陣列補到 0 → no-op', () => {
    expect(padToLength([], 0)).toEqual([])
  })
})

// ── reindex 三型正反案（PLAN Verification 明列）＋pending 物化案 ──

describe('reindex 三型正反案（PLAN §D1 A-3／Verification）', () => {
  it('型 1：刪中間列（上方留、下方降位）', () => {
    // row0=A、row1=B（待刪）、row2=C。B 所在列因故被刪除／壓縮。
    const before: RowSeparator[] = [tagFor(0), tagFor(1), tagFor(2)]
    const after = removeRealAt(before, 1)
    // 上方（row0=A）維持原值原位；下方（row2=C）覆寫跟著列降一位，值不變。
    expect(after[0]).toEqual(tagFor(0))
    expect(after).toEqual([tagFor(0), tagFor(2)])
  })

  it('型 2：空列壓縮（該列覆寫消滅，不殘留、不外洩至相鄰位置）', () => {
    // row1（覆寫 B）因段全數停用／搬空而壓縮消失。
    const before: RowSeparator[] = [tagFor(0), tagFor(1), null]
    const after = removeRealAt(before, 1)
    expect(after).toEqual([tagFor(0), null])
    // B 不得殘留於結果陣列任何位置（消滅，非搬移/外洩）。
    expect(after).not.toContainEqual(tagFor(1))
  })

  it('型 3：移列 swap（覆寫跟列走）——來源列搬空＋落點物化成真實列的組合', () => {
    // 比照 commitSegmentMove：段唯一段從 row0（覆寫 A）搬走，row0 因而
    // 耗盡消失（removeRealAt）；同時落點於其餘列之間物化出新真實列
    // （insertNullAtReal）。row1(B)／row2(C) 的覆寫全程只認自己的值，
    // 完全不受來源列消滅或新列插入影響——只有位置跟著列走。
    const before: RowSeparator[] = [tagFor(0), tagFor(1), tagFor(2)]
    const afterDrain = removeRealAt(before, 0) // 來源列（A）耗盡消滅。
    expect(afterDrain).toEqual([tagFor(1), tagFor(2)])
    const afterMaterialize = insertNullAtReal(afterDrain, 1) // 落點物化於 B、C 之間。
    expect(afterMaterialize).toEqual([tagFor(1), null, tagFor(2)])
    // A 徹底消滅；B／C 全程保留各自原值（僅位置改變）。
    expect(afterMaterialize).not.toContainEqual(tagFor(0))
  })

  it('pending 物化案（PLAN A-3 原句：於啟用列位 splice 入 null，其後覆寫同步後移）', () => {
    const before: RowSeparator[] = [tagFor(0), tagFor(1)]
    const after = insertNullAtReal(before, 0) // 暫存空列於最前物化成真實列。
    expect(after).toEqual([null, tagFor(0), tagFor(1)])
    // A／B 皆整組後移一位，但值本身不變（跟著自己的列走）。
    expect(after[1]).toEqual(tagFor(0))
    expect(after[2]).toEqual(tagFor(1))
  })
})

// ── 組合矩陣 spike 案（比照 row-slots.test.ts 既有矩陣風格） ──

describe('組合矩陣 spike 案：窮舉 ≤4 ops 全組合（PLAN Verification／Spike plan #1）', () => {
  /**
   * 操作：`remove`＝對應 `removeRealAt`；`insertNull`＝對應
   * `insertNullAtReal`。窮舉每一步在當下陣列長度下所有合法索引，深度上限
   * 4（「小規模操作序列」，見 dispatch brief；長度上限見下方 countSeqs
   * 量級量測：初始 3 列、maxOps=4 共 4273 個節點，皆可瞬間跑完）。
   */
  type Op = { kind: 'remove'; index: number } | { kind: 'insertNull'; index: number }

  const initialLength = 3
  const maxOps = 4

  /** 每個位置的「列身分」：數字＝某原始列 id（其覆寫值恆為 tagFor(id)）；
   * `null`＝該位置由某次 insertNullAtReal 新物化、無原始身分。以純陣列
   * splice（內建、獨立於待測程式碼）維護，作為不依賴實作本身的獨立
   * ground truth，供比對 removeRealAt／insertNullAtReal 的實際輸出。 */
  type Identity = number | null

  let assertionCount = 0

  function assertInvariant(seps: readonly RowSeparator[], identity: readonly Identity[]): void {
    expect(seps.length).toBe(identity.length)
    for (let i = 0; i < identity.length; i++) {
      const id = identity[i]
      if (id === null) {
        expect(seps[i]).toBeNull()
      } else {
        expect(seps[i]).toEqual(tagFor(id))
      }
    }
    // 任何已從 identity 消失的原始列 id，其覆寫值不得殘留於 seps 任何位置
    // （消滅即消滅，不得因實作 bug 搬移/複製到別處存活）。
    for (let id = 0; id < initialLength; id++) {
      if (!identity.includes(id)) {
        expect(seps).not.toContainEqual(tagFor(id))
      }
    }
    assertionCount += 1
  }

  function walk(seps: readonly RowSeparator[], identity: readonly Identity[], depth: number): void {
    assertInvariant(seps, identity)
    if (depth === maxOps) return

    const length = seps.length
    const ops: Op[] = []
    for (let i = 0; i < length; i++) ops.push({ kind: 'remove', index: i })
    for (let i = 0; i <= length; i++) ops.push({ kind: 'insertNull', index: i })

    for (const op of ops) {
      if (op.kind === 'remove') {
        const nextSeps = removeRealAt(seps, op.index)
        const nextIdentity = [...identity]
        nextIdentity.splice(op.index, 1)
        walk(nextSeps, nextIdentity, depth + 1)
      } else {
        const nextSeps = insertNullAtReal(seps, op.index)
        const nextIdentity = [...identity]
        nextIdentity.splice(op.index, 0, null)
        walk(nextSeps, nextIdentity, depth + 1)
      }
    }
  }

  it('任意 ≤4 步 remove／insertNull 混合序列後，非 null 覆寫恆跟隨其初始指派的渲染列', () => {
    const seps0: RowSeparator[] = Array.from({ length: initialLength }, (_, i) => tagFor(i))
    const identity0: Identity[] = Array.from({ length: initialLength }, (_, i) => i)
    walk(seps0, identity0, 0)
    // 量級量測（.scratch-count 腳本結果）：3 列、maxOps=4 應走訪 4273 個節點
    // ——若此數大幅偏離，代表窮舉邏輯本身跑偏（如未涵蓋末端插入索引）。
    expect(assertionCount).toBe(4273)
  })
})
