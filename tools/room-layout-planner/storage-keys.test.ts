/**
 * T1.3（(internal design doc) §D7；§Verification
 * storage-keys bullet）：`storage-keys.ts` 零相依保證＋兩把 key 關係。
 *
 * 讀原始碼逐字斷言不含四類非可抹除語法標記（`import`／`from '`／
 * `require(`／`enum `／`namespace `），防止未來修改悄悄引入會讓 Node
 * 型別剝離失敗的語法（見 storage-keys.ts 檔頭）；另外載入模組本身斷言
 * 兩把 key 互異。
 *
 * 兩把 key 的**字面釘值**已移至集中測試 `src/storage-keys-pin.test.ts`
 * （(internal design doc) §D4「7 把 key 字面釘值單一
 * 測試取代分散字面斷言」），本檔不再重複字面值，改名時只需同步一處。
 *
 * 本測試檔自身讀寫檔案、載入模組，不受此約束——約束只針對
 * `storage-keys.ts` 一檔。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BACKUP_KEY, STORAGE_KEY } from './storage-keys.js'

const SOURCE_PATH = fileURLToPath(new URL('./storage-keys.ts', import.meta.url))
const FORBIDDEN_SUBSTRINGS = ['import', "from '", 'require(', 'enum ', 'namespace ']

describe('storage-keys.ts：零相依原始碼掃描', () => {
  const source = readFileSync(SOURCE_PATH, 'utf-8')

  it.each(FORBIDDEN_SUBSTRINGS)('原始碼不含 %j', (needle) => {
    expect(source).not.toContain(needle)
  })
})

describe('storage-keys.ts：兩把 key 關係（字面釘值見 src/storage-keys-pin.test.ts）', () => {
  it('兩把 key 不相等', () => {
    expect(STORAGE_KEY).not.toBe(BACKUP_KEY)
  })
})
