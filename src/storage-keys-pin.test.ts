// @vitest-environment node
/**
 * T1.3（(internal design doc) §D4「7 把 localStorage
 * key」列、§Verification (f)）：全站 7 把 localStorage key 的字面釘值
 * **單一測試**，取代原本分散在各模組測試的字面斷言。
 *
 * 一律 import 各模組的單一出口常數（不讀原始碼、不複製字面）：key 改名時
 * 本檔是唯一需同步期望值的地方，且任何模組悄悄改值都會在此變紅——使用者
 * 既有 localStorage 資料的相容性由此把關。
 *
 * 環境選 node：六個來源模組頂層皆不碰 `document`／`localStorage`／
 * `window`（全部惰性存取於函式內；`i18n-dom.ts` 唯一的值 import 是
 * `messages.ts`，其頂層只有字面物件），故不需 jsdom。
 */
import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from './theme.js'
import { STORAGE_KEY as STATUSLINE_CONFIG_KEY } from '../tools/statusline-builder/config-storage-key.js'
import { LANG_STORAGE_KEY } from '../tools/statusline-builder/i18n-dom.js'
import { CATALOG_COLLAPSE_KEY } from '../tools/statusline-builder/catalog-collapse.js'
import { TUTORIAL_DISMISS_KEY } from '../tools/statusline-builder/tutorial-band.js'
import {
  BACKUP_KEY as ROOM_PLAN_BACKUP_KEY,
  STORAGE_KEY as ROOM_PLAN_KEY,
} from '../tools/room-layout-planner/storage-keys.js'

/** [來源描述, 期望字面, 實際常數值] ——7 把 key 的權威清單。 */
const PINS: Array<[string, string, string]> = [
  ['src/theme.ts THEME_STORAGE_KEY', 'clientkit-theme', THEME_STORAGE_KEY],
  [
    'statusline-builder/config-storage-key.ts STORAGE_KEY',
    'clientkit:statusline-builder:config',
    STATUSLINE_CONFIG_KEY,
  ],
  ['statusline-builder/i18n-dom.ts LANG_STORAGE_KEY', 'clientkit-statusline-builder-lang', LANG_STORAGE_KEY],
  [
    'statusline-builder/catalog-collapse.ts CATALOG_COLLAPSE_KEY',
    'clientkit-statusline-builder-catalog-collapsed',
    CATALOG_COLLAPSE_KEY,
  ],
  [
    'statusline-builder/tutorial-band.ts TUTORIAL_DISMISS_KEY',
    'clientkit-statusline-builder-drag-tutorial',
    TUTORIAL_DISMISS_KEY,
  ],
  ['room-layout-planner/storage-keys.ts STORAGE_KEY', 'clientkit-room-layout-planner-plan', ROOM_PLAN_KEY],
  [
    'room-layout-planner/storage-keys.ts BACKUP_KEY',
    'clientkit-room-layout-planner-plan-backup',
    ROOM_PLAN_BACKUP_KEY,
  ],
]

describe('7 把 localStorage key 字面釘值', () => {
  it('權威清單恰為 7 把', () => {
    expect(PINS).toHaveLength(7)
  })

  it.each(PINS)('%s ＝ %j', (_source, expected, actual) => {
    expect(actual).toBe(expected)
  })
})

describe('7 把 localStorage key 整體不變式', () => {
  const values = PINS.map(([, , actual]) => actual)

  it('七把值互不相同', () => {
    expect(new Set(values).size).toBe(7)
  })

  it('皆以 clientkit 開頭', () => {
    for (const value of values) {
      expect(value.startsWith('clientkit'), value).toBe(true)
    }
  })

  it('皆不含 eztools（不分大小寫）', () => {
    for (const value of values) {
      expect(value.toLowerCase(), value).not.toContain('eztools')
    }
  })
})
