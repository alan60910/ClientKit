/**
 * T1.3（(internal design doc) §D8 i18n；§Recommended
 * approach 模組表）：typed message key、`t(locale)` 取字典——比照
 * `tools/statusline-builder/messages.ts` 的存取形式（`interface
 * Messages`＋顯式標型字典＋回整包字典而非逐 key 查表），但**本工具初版
 * zh-Hant only**（D8：「本工具初版 zh-Hant only，但 messages.ts 比照
 * statusline 的 interface Messages＋t(locale) 定型，v1 只填 zhHant，
 * 日後補 en 不改呼叫點」）。故 `t('en')` 在 v1 回退 `zhHant`——見 `t()`
 * 函式註解；日後補 `en` 字典時只需在 `t()` 內接上第二個分支，呼叫端
 * 簽章不變。
 *
 * 純函式模組：零 DOM、零 localStorage——不 import 任何 DOM-facing 模組。
 * 插值訊息一律建模為函式鍵（如 `status.itemMoved`），插值 arity 由
 * TypeScript 簽章鎖死，取代手寫 placeholder 一致性測試。
 *
 * 四個頂層群組：`ui`（畫面可見文案／按鈕／switch／閾值 label 等）、
 * `status`（`main.ts` 播報至 `#status` 的動態組句模板）、`errors`
 * （`#error` 一次性錯誤文案）、`report`（`ClearanceReport` 的 level／kind
 * 顯示名——D3 四段半開區間、D4 `kind` 列舉的人類可讀形）。
 */
import type { Side } from './model.js'

export type Locale = 'zh-Hant' | 'en'

export const DEFAULT_LOCALE: Locale = 'zh-Hant'

/**
 * 兩語言字典皆須 implement 的介面——字串鍵＋函式鍵（插值）混合。v1 只有
 * `zhHant` 一份具體實作；`en` 留待日後補上時對照同一介面撰寫。
 */
export interface Messages {
  ui: {
    /** 工具標題（`<h1>`／`<title>` 消費）。 */
    title: string
    /** 四條 skip-nav（PLAN §Component tree 三條＋T5.3 的「跳至屬性」）。 */
    skipNav: {
      toCanvas: string
      toSettings: string
      /** T5.3：`#props-section`（DOM 序在設定與清單之間，skip-nav 同序）。 */
      toProps: string
      toList: string
    }
    /** 七個分區標題（D5／D6／D9／D10 各面板共用的 `<h2>`）。 */
    section: {
      room: string
      structure: string
      addItem: string
      analysis: string
      importExport: string
      itemList: string
      analysisResult: string
    }
    /** 按鈕可見文字（同時作為可及名稱，沿專案既定慣例）。 */
    button: {
      add: string
      rotate: string
      delete: string
      /** 「還原 {name}」——列上鈕，accessible name 含項目身分（D10 非破壞性刪除）。 */
      restore: (name: string) => string
      undo: string
      redo: string
      clear: string
      clearDeleted: string
      exportJson: string
      importJson: string
      exportPng: string
      copyShareLink: string
      saveAsMine: string
      restorePrevious: string
      fitView: string
      zoomIn: string
      zoomOut: string
    }
    /** 三個 `button[aria-pressed]` switch（D3／D6）。 */
    switch: {
      showDistance: string
      showWarnings: string
      showDoorSwing: string
    }
    /** 三閾值＋網格＋家具件數上限欄位 label（D3／D10／T4.7）。 */
    threshold: {
      ignoreBelow: string
      warnBelow: string
      adviseBelow: string
      grid: string
      /** T4.7 `#max-items` 的 label（軟上限，使用者可調）。 */
      maxItems: string
    }
    /**
     * T2.4 `panel.ts` 動態建列時掛上的欄位 label 與欄位級錯誤文案
     * （PLAN §Accessibility「Forms：`label[for]`＋獨立 id；錯誤
     * `aria-describedby`＋`aria-invalid`」）。靜態表單的 label 由
     * `index.html` 自帶，本群組只服務**程式產生**的列與其錯誤 `<p>`。
     */
    form: {
      name: string
      width: string
      depth: string
      x: string
      y: string
      rotation: string
      color: string
      passable: string
      /** `#add-preset` 第一個選項（value 為空字串）的顯示字。 */
      presetCustom: string
      leafDir: string
      leafDirPlus: string
      leafDirMinus: string
      swing: string
      /** 門的「牆」欄 label——D6：**唯讀**，值以文字呈現不設輸入控件。 */
      wall: string
      door: string
      /** D9 方塊種類顯示名（凸出區／凹入區）。 */
      kindExtend: string
      kindCutout: string
      /** D3 三元組違序（`0 ≤ ignoreBelow ≤ warnBelow ≤ adviseBelow`）。 */
      thresholdOrder: string
      /**
       * T4.7 `#max-items-warning` 的常駐提示（非錯誤）：`n` 為警告門檻
       * `MAX_ITEMS_WARN_ABOVE`，文案帶 e2e 案 6／案 7 的實測數字。
       */
      maxItemsWarning: (n: number) => string
      /** T4.7 軟上限低於現有件數（含已刪除）的欄位級錯誤。 */
      maxItemsBelowCount: (count: number) => string
      integerRange: (min: number, max: number) => string
      nameRequired: string
      sizeRequired: string
      /** `reducer.ts` 的 `door-invalid` 拒絕原因（D6 合法性）。 */
      doorInvalid: string
      notFound: string
      invalidInput: string
    }
    /**
     * T5.3 物件屬性欄（`#props-section`）。可編輯欄位的 label 與分區標題由
     * `index.html` 靜態提供，本群組是它們的 i18n 事實來源（同 `section`／
     * `button` 的既有慣例：日後補 en 時由此對照改寫靜態文字）；`need` 另由
     * `props.ts` 於欄位級錯誤時取用面向名。
     */
    props: {
      heading: string
      /** 未選取任何物件時的提示句。 */
      empty: string
      /** 各面需留的欄位 label：「北側需留」…（D5 區域座標四向）。 */
      need: (side: Side) => string
      kindItem: string
      kindBlock: string
      kindDoor: string
      /** 清單列「選取」鈕的可見文字（可及名稱另由 `list.select` 組）。 */
      selectAction: string
    }
    /**
     * T2.4 清單與分頁（PLAN §Accessibility「大量項目分頁＋換頁焦點管理與
     * 播報」；OQ1 門檻 20）。T5.3 後每列只剩「選取＋摘要＋動作」一行，
     * 摘要文字（下列三個組句）取代原本的整排輸入欄。
     */
    list: {
      pageLabel: (page: number, total: number) => string
      /** 列首「選取」鈕的可及名稱——項目身分承載於控件 accessible name。 */
      select: (name: string) => string
      /** 非破壞性刪除的列標記（D10：列仍在，只是標為已刪除）。 */
      deleted: string
      /** 家具列摘要：有效外框寬深與左上角座標。 */
      itemSummary: (width: number, depth: number, x: number, y: number) => string
      /** 方塊列摘要：座標與寬深（種類另以 badge 呈現）。 */
      blockSummary: (x: number, y: number, width: number, depth: number) => string
      /** 門列摘要：門寬與所在牆（D6：牆唯讀，故只出現在文字裡）。 */
      doorSummary: (width: number, wall: string) => string
    }
    /** 門扇方向與牆位顯示名（D6）。 */
    door: {
      swingIn: string
      swingOut: string
      /** 牆 N/E/S/W → 北牆/東牆/南牆/西牆（D6 `wall` 欄顯示；唯讀）。 */
      wallName: (side: Side) => string
    }
    /** 畫布層可見與 a11y 文案（PLAN §Component tree）。 */
    board: {
      label: string
      /** 家具節點 `aria-roledescription`（PLAN：「可拖移的家具」）。 */
      itemRoledescription: string
      /** 家具節點 `aria-label`：`{name} {w}×{d} cm，位置 {x},{y}`。 */
      itemAriaLabel: (name: string, width: number, depth: number, x: number, y: number) => string
    }
    /** 「複製分享連結」鈕旁常駐提示句（D7 URL hash 分享）。 */
    shareNotice: string
    /**
     * T4.w：自分享連結載入後於 `#io-notice` **常駐**的預覽態提示（D7：
     * 「`#status` 提示＋『儲存為我的平面圖』鈕」——一次性播報走
     * `status.previewLoaded`，本句留在畫面上直到存檔或離開）。
     */
    previewNotice: string
    /**
     * 預覽態下按「還原上一份」的 `#io-notice` 提示（PLAN D7 r3.4）：還原是
     * 對 localStorage 兩把 key 的 swap，與「預覽態不觸碰 localStorage」相衝，
     * 故直接拒絕並指路「儲存為我的平面圖」。句中自帶「分享預覽」四字——
     * `#io-notice` 是單一寫入者、只顯示最新一句，本句會蓋掉
     * `previewNotice`，故不可依賴它仍在畫面上。
     */
    restoreBlockedInPreview: string
    /**
     * T2.5 `main.ts` 的兩句 `window.confirm()` 問句（D7「清空前
     * （confirm）」、§Implementation notes「`item/purge` 只由『清空已刪除』
     * 鈕（confirm）觸發」）。
     */
    confirmClear: string
    /**
     * 預覽態專用的清空問句（PLAN D7 r3.4）：此時清空**不寫** localStorage、
     * 也不寫 backup，`confirmClear` 的「清空前會自動備份，可用『還原上一份』
     * 救回」在預覽態是不成立的承諾，故分流一句。
     */
    confirmClearPreview: string
    confirmPurge: string
    /**
     * autosave 首次失敗後於 io-panel **常駐**的提示句（D7：「`setItem`
     * 失敗首次於 `#status` 播報並在 io-panel 常駐提示」）——`#status` 的
     * 一次性播報走 `errors.autosaveFailed`，本句留在畫面上不被覆寫。
     */
    autosaveNotice: string
  }
  /** `main.ts` 播報至 `#status`（`aria-live="polite"`）的動態組句模板。 */
  status: {
    itemMoved: (name: string, x: number, y: number) => string
    itemRotated: (name: string, rotation: number) => string
    itemDeleted: (name: string) => string
    itemRestored: (name: string) => string
    /** T2.4 加入表單成功後的播報（三種種類各一句）。 */
    itemAdded: (name: string) => string
    blockAdded: (kind: 'extend' | 'cutout') => string
    doorAdded: () => string
    /** 上限守衛「不變＋拒絕原因」（D10 結構 50／門 10；家具走 `itemCapReached`）。 */
    limitReached: (kind: '家具' | '結構' | '門', max: number) => string
    /**
     * T4.7 家具**軟上限**專用播報：`max` 為目前的 `settings.maxItems`、
     * `hard` 為 `LIMITS.items`。與 `limitReached` 分流的理由是它多一句
     * 出路（可於設定調高），而結構／門沒有這個出路。
     */
    itemCapReached: (max: number, hard: number) => string
    /** 牆體硬上限後置條件（D9；含「建議先移除其他方塊」）。 */
    wallCapExceeded: (count: number, max: number) => string
    pageChanged: (page: number, total: number) => string
    /** report-list 摘要播報（過窄／碰撞／各面違規／門違規四類計數）。 */
    warningsSummary: (narrow: number, collisions: number, side: number, door: number) => string
    /** 方塊／門拖移 commit 後的播報（家具走 `itemMoved`，此二者無名稱欄）。 */
    blockMoved: (x: number, y: number) => string
    doorMoved: (x: number, y: number) => string
    /** io-panel 的「復原／重做」鈕（D10 非破壞性刪除段的命名）。 */
    undone: string
    redone: string
    /** T2.5 backup 四時點與「還原上一份」（D7）。 */
    planCleared: string
    planImported: string
    backupRestored: string
    noBackup: string
    /** `parsePlan()` 逐項丟棄後的一次性提示（D7 drop-and-continue）。 */
    planRepaired: (dropped: number) => string
    /** 「清空已刪除」（`item/purge`）後的播報。 */
    itemsPurged: (count: number) => string
    /**
     * T4.w M4 io 接線的六句（原先散在 `io-json.ts`／`io-png.ts`／
     * `io-share.ts` 的在地常數，接線時一併收攏至此，見 D8「日後補 en 不改
     * 呼叫點」）。`pngDone` 與 `io-png.ts` 的 `PNG_TEXT.done` 逐字相同，兩者
     * 以 `io-wiring.dom.test.ts` 的同步測項鎖住。
     */
    planExported: string
    pngDone: (widthPx: number, heightPx: number) => string
    linkCopied: string
    linkCopyFallback: string
    /** 自分享連結載入成功後的開機播報（D7 生命週期：預覽態）。 */
    previewLoaded: string
    /** backup 時點 (2)「儲存為我的平面圖」成功後的播報。 */
    savedAsMine: string
    /**
     * `reducer.ts` 三種非上限類拒絕原因的播報形（D6 門合法性／查無項目／
     * 欄位級非法）；面板另有 `ui.form.*` 的欄位旁文案，兩者刻意分流。
     */
    doorInvalid: string
    notFound: string
    invalidInput: string
  }
  /** `#error`（`role="alert"`）一次性錯誤文案。 */
  errors: {
    importFailed: string
    /** 匯入前置閘：`File.size` > 1 MB（D7「匯入 ≤1 MB」）。 */
    importTooLarge: string
    /** hash 載入：原始長度 >32 KB（D7 三種失敗之一）。 */
    hashTooLong: string
    /** hash 載入：`decodeURIComponent`／base64url／`TextDecoder` 失敗。 */
    hashDecodeFailed: string
    /** hash 載入：`parsePlan()` 判定內容非有效平面圖。 */
    hashInvalidPlan: string
    autosaveFailed: string
    backupFailed: string
    /** 開機時 localStorage 內容整份無法解析（D7 backup 時點 (3)）。 */
    storedPlanInvalid: string
    pngFailed: string
    /** 產生分享連結：編碼後 >8,000 字元，提示改用 JSON（D7，非載入失敗）。 */
    shareTooLong: string
  }
  /** `ClearanceReport` 顯示名（D3 四段半開區間、D4 `kind` 列舉）。 */
  report: {
    /** D3：touch／narrow／tight／ok 四段。 */
    level: {
      touch: string
      narrow: string
      tight: string
      ok: string
    }
    /** D4：`doorway`＝門洞；`doorway`／`suppressed` 共用「不評級」顯示。 */
    kind: {
      doorway: string
      unrated: string
    }
    /**
     * T3.2 `report-list.ts` 的**文字等價**（PLAN §Accessibility「overlay
     * `aria-hidden`，資訊由 `report-list` 文字等價」）。overlay 上每一筆
     * 通道／碰撞／各面違規／門違規在此各有一條組句模板。
     */
    text: {
      corridor: (a: string, b: string, gap: number, level: string) => string
      /** D4 門洞：不評級，另以門洞尺寸線顯示。 */
      doorway: (a: string, b: string, gap: number) => string
      /** D4 `passable:false` 抑制：不評級但仍可見尺寸線。 */
      suppressed: (a: string, b: string, gap: number) => string
      collision: (a: string, b: string) => string
      side: (name: string, sideName: string, need: number, actual: number, against: string) => string
      door: (name: string, doorName: string) => string
      /** D6：門扇跨距超出牆段或鉸鏈不在 `edges` 上。 */
      unattachedDoor: (id: string) => string
      /** D9：自基底不可達的 `extend`（不阻擋拖曳，只標示）。 */
      unconnectedBlock: (id: string) => string
    }
    /** D9 牆體矩形的顯示名（逐條編號對使用者無意義，一律稱「牆體」）。 */
    wallName: string
    /** 門的顯示名（門無名稱欄，以所在牆側命名）。 */
    doorName: (side: Side) => string
    /** 面向顯示名（北／東／南／西，不帶「牆」字；`ui.door.wallName` 用於牆位）。 */
    sideName: (side: Side) => string
    /** 摘要句後綴：`status.warningsSummary` 之外的提示／不評級筆數。 */
    summaryExtra: (tight: number, unrated: number) => string
    /** 尚未算出報告時（開機前一瞬）的 `#report-summary` 文字。 */
    empty: string
  }
}

const WALL_NAME_ZH: Readonly<Record<Side, string>> = {
  N: '北牆',
  E: '東牆',
  S: '南牆',
  W: '西牆',
}

/** 面向顯示名（T3.2 各面違規組句：「{name} 的{北}側需留 …」）。 */
const SIDE_NAME_ZH: Readonly<Record<Side, string>> = {
  N: '北',
  E: '東',
  S: '南',
  W: '西',
}

/** D9 方塊種類顯示名——`ui.form.kind*` 與 `status.blockAdded` 共用同一份字面。 */
const BLOCK_KIND_ZH = { extend: '凸出區', cutout: '凹入區' } as const

const zhHant: Messages = {
  ui: {
    title: '房間家具擺放規劃器',
    skipNav: {
      toCanvas: '跳至畫布',
      toSettings: '跳至設定',
      toProps: '跳至屬性',
      toList: '跳至清單',
    },
    section: {
      room: '房間',
      structure: '房間結構',
      addItem: '加入家具',
      analysis: '分析',
      importExport: '匯入匯出',
      itemList: '家具清單',
      analysisResult: '分析結果',
    },
    button: {
      add: '加入',
      rotate: '旋轉',
      delete: '刪除',
      restore: (name) => `還原 ${name}`,
      undo: '復原',
      redo: '重做',
      clear: '清空',
      clearDeleted: '清空已刪除',
      exportJson: '匯出 JSON',
      importJson: '匯入 JSON',
      exportPng: '匯出 PNG',
      copyShareLink: '複製分享連結',
      saveAsMine: '儲存為我的平面圖',
      restorePrevious: '還原上一份',
      fitView: '符合視窗',
      zoomIn: '放大',
      zoomOut: '縮小',
    },
    switch: {
      showDistance: '顯示距離',
      showWarnings: '顯示警示',
      showDoorSwing: '顯示迴旋區',
    },
    threshold: {
      ignoreBelow: '忽略低於',
      warnBelow: '警示低於',
      adviseBelow: '建議低於',
      grid: '網格',
      maxItems: '家具件數上限',
    },
    form: {
      name: '名稱',
      width: '寬',
      depth: '深',
      x: 'X',
      y: 'Y',
      rotation: '旋轉角度',
      color: '顏色',
      passable: '可通行',
      presetCustom: '自訂',
      leafDir: '門扇方向',
      leafDirPlus: '正向',
      leafDirMinus: '反向',
      swing: '開門方向',
      wall: '牆',
      door: '門',
      kindExtend: BLOCK_KIND_ZH.extend,
      kindCutout: BLOCK_KIND_ZH.cutout,
      thresholdOrder: '須滿足 0 ≤ 忽略 ≤ 警示 ≤ 建議',
      maxItemsWarning: (n) =>
        `超過 ${n} 件後拖移可能變慢：實測 20 件內每幀 ≤16.7 ms，75 件約 <100 ms（低階裝置 4× 節流）`,
      maxItemsBelowCount: (count) => `不得低於目前 ${count} 件（含已刪除）`,
      integerRange: (min, max) => `請輸入 ${min} 到 ${max} 之間的整數`,
      nameRequired: '請輸入名稱（1 到 30 個字）',
      sizeRequired: '請輸入寬與深，或先選一項預設家具',
      doorInvalid: '門必須貼在牆上，且門扇須完整落在同一道牆內',
      notFound: '找不到對應的項目',
      invalidInput: '輸入值不合法，本次變更已取消',
    },
    props: {
      heading: '物件屬性',
      empty: '尚未選取物件——點選畫布上的家具、方塊或門。',
      need: (side) => `${SIDE_NAME_ZH[side]}側需留`,
      kindItem: '家具',
      kindBlock: '房間結構',
      kindDoor: '門',
      selectAction: '選取',
    },
    list: {
      pageLabel: (page, total) => `第 ${page}/${total} 頁`,
      select: (name) => `選取 ${name}`,
      deleted: '已刪除',
      itemSummary: (width, depth, x, y) => `${width}×${depth}，(${x},${y})`,
      blockSummary: (x, y, width, depth) => `${x},${y} ${width}×${depth}`,
      doorSummary: (width, wall) => `門 ${width} cm，${wall}`,
    },
    door: {
      swingIn: '內開',
      swingOut: '外開',
      wallName: (side) => WALL_NAME_ZH[side],
    },
    board: {
      label: '房間平面圖',
      itemRoledescription: '可拖移的家具',
      itemAriaLabel: (name, width, depth, x, y) => `${name} ${width}×${depth} cm，位置 ${x},${y}`,
    },
    shareNotice: '連結本身即包含整份平面圖，會留在瀏覽紀錄與收件者手上',
    previewNotice:
      '目前顯示的是他人分享的平面圖預覽，尚未儲存至本機；按下「儲存為我的平面圖」即可保留。',
    restoreBlockedInPreview:
      '目前是他人分享的平面圖預覽，無法還原上一份；請先按「儲存為我的平面圖」再試。',
    confirmClear: '確定要清空整份平面圖嗎？清空前會自動備份，可用「還原上一份」救回。',
    confirmClearPreview:
      '確定要清空這份分享預覽嗎？本機既有的平面圖不會被更動，但預覽內容清掉後無法復原。',
    confirmPurge: '確定要永久移除所有已刪除的家具嗎？此動作無法以「還原」復原。',
    autosaveNotice: '自動儲存目前無法寫入（可能是瀏覽器無痕模式或儲存空間已滿），請改用「匯出 JSON」保存。',
  },
  status: {
    itemMoved: (name, x, y) => `${name} 已移至 ${x},${y}`,
    itemRotated: (name, rotation) => `${name} 已旋轉至 ${rotation}°`,
    itemDeleted: (name) => `${name} 已刪除`,
    itemRestored: (name) => `${name} 已還原`,
    itemAdded: (name) => `已加入 ${name}`,
    blockAdded: (kind) => `已加入${BLOCK_KIND_ZH[kind]}`,
    doorAdded: () => '已加入門',
    limitReached: (kind, max) => `已達${kind}上限 ${max} 件，本次操作已取消`,
    itemCapReached: (max, hard) => `已達家具上限 ${max} 件，可於設定調高（最多 ${hard} 件）`,
    wallCapExceeded: (count, max) => `牆體已達上限 ${max} 條（目前 ${count} 條），本次操作已取消，建議先移除其他方塊`,
    pageChanged: (page, total) => `已切換至第 ${page} 頁，共 ${total} 頁`,
    warningsSummary: (narrow, collisions, side, door) =>
      `過窄 ${narrow} 處、碰撞 ${collisions} 處、各面違規 ${side} 處、門違規 ${door} 處`,
    blockMoved: (x, y) => `房間結構已移至 ${x},${y}`,
    doorMoved: (x, y) => `門已移至 ${x},${y}`,
    undone: '已復原上一步',
    redone: '已重做一步',
    planCleared: '已清空平面圖，先前內容已備份',
    planImported: '已匯入平面圖，先前內容已備份',
    backupRestored: '已還原上一份平面圖，再按一次可換回',
    noBackup: '目前沒有可還原的備份',
    planRepaired: (dropped) => `存檔有 ${dropped} 處無法辨識，已略過後載入其餘內容`,
    itemsPurged: (count) => `已永久移除 ${count} 件已刪除的家具`,
    planExported: '已匯出 JSON',
    pngDone: (widthPx, heightPx) => `PNG 匯出完成，${widthPx}×${heightPx} 像素`,
    linkCopied: '分享連結已複製到剪貼簿。',
    linkCopyFallback: '瀏覽器不支援自動複製，已將連結顯示於下方，請手動複製。',
    previewLoaded: '已載入分享連結中的平面圖預覽，尚未儲存至本機',
    savedAsMine: '已儲存為我的平面圖。',
    doorInvalid: '門必須貼在牆上，且門扇須完整落在同一道牆內，本次操作已取消',
    notFound: '找不到對應的項目，本次操作已取消',
    invalidInput: '輸入值不合法，本次操作已取消',
  },
  errors: {
    importFailed: '匯入失敗，檔案格式無法辨識',
    importTooLarge: '檔案過大，僅接受 1 MB 以內的 JSON',
    hashTooLong: '分享連結內容過長，無法載入',
    hashDecodeFailed: '分享連結解碼失敗',
    hashInvalidPlan: '分享連結內容不是有效的平面圖',
    autosaveFailed: '自動儲存失敗，變更可能不會保留',
    backupFailed: '備份寫入失敗，本次操作已取消',
    storedPlanInvalid: '先前的存檔內容無法辨識，已備份原始資料並改用空白平面圖',
    pngFailed: 'PNG 匯出失敗',
    shareTooLong: '平面圖內容過長，無法產生分享連結，請改用匯出 JSON',
  },
  report: {
    level: {
      touch: '貼齊',
      narrow: '過窄',
      tight: '偏窄',
      ok: '足夠',
    },
    kind: {
      doorway: '門洞',
      unrated: '不評級',
    },
    text: {
      corridor: (a, b, gap, level) => `${a} 與 ${b} 之間 ${gap} cm：${level}`,
      doorway: (a, b, gap) => `${a} 與 ${b} 之間 ${gap} cm：門洞（不評級）`,
      suppressed: (a, b, gap) => `${a} 與 ${b} 之間 ${gap} cm：不評級（可通行）`,
      collision: (a, b) => `${a} 與 ${b} 重疊`,
      side: (name, sideName, need, actual, against) =>
        `${name} 的${sideName}側需留 ${need} cm，實際 ${actual} cm（${against}）`,
      door: (name, doorName) => `${name} 進入${doorName}的迴旋區`,
      unattachedDoor: (id) => `門 ${id} 未附著於牆`,
      unconnectedBlock: (id) => `${BLOCK_KIND_ZH.extend} ${id} 未連接`,
    },
    wallName: '牆體',
    doorName: (side) => `${WALL_NAME_ZH[side]}的門`,
    sideName: (side) => SIDE_NAME_ZH[side],
    summaryExtra: (tight, unrated) => `偏窄 ${tight} 處、不評級 ${unrated} 處`,
    empty: '尚無分析結果',
  },
}

/**
 * locale → 完整字典（純函式；呼叫端注入取用，不逐 key 查表）。v1 只有
 * `zhHant` 一份實作——`'en'` 落到 fallback，回傳同一份 `zhHant`（D8：
 * 「日後補 en 不改呼叫點」，故簽章維持 `(locale) => Messages`，只是 v1
 * 內部恆回 zh-Hant）。
 */
export function t(locale: Locale = DEFAULT_LOCALE): Messages {
  if (locale === 'en') return zhHant
  return zhHant
}

export { zhHant }
