/**
 * SP-6 型別探針（PLAN.md §「gifuct-js@2.1.2」／Open questions）。
 *
 * 目的：驗證 gifuct-js@2.1.2 自帶的 shipped 型別
 * （node_modules/gifuct-js/index.d.ts）在本專案 strict 設定下，對
 * decode.ts 實際會用到的欄位——`dims.{top,left,width,height}`、
 * `delay`、`disposalType`、`transparentIndex`、`patch`、`pixels`、
 * `colorTable`——是否可直接編譯通過。長期保留作為 shipped 型別回歸守
 * 門：日後升級 gifuct-js 若改變型別形狀，本檔會在 `npm run typecheck`
 * 炸掉，及早暴露，不必等到 decode.ts 才發現。
 *
 * 結論（S3-T1.1 已驗，`npm run typecheck` exit 0，未使用任何 fallback）：
 * shipped 型別**足夠**，不需要 module augmentation 或 wrapper `as` 收
 * 斂，因此本檔沒有第二個 `declare module 'gifuct-js'`。
 *
 * 已知的型別不精確之處（不影響本檔編譯，記錄供 decode.ts 實作參考）：
 * shipped 型別把 `delay`／`disposalType`／`transparentIndex` 宣告為必
 * 要的 `number`，但 PLAN.md 已查證事實指出幀無 GCE 時這三欄位在執行期
 * 實際為 `undefined`（不拋錯）。TypeScript 對「具名 `number` 型別」與
 * `undefined` 的 `!==` 比較不視為零重疊而報錯（不同於窄化後的字面量型
 * 別比較），故下方防禦式判斷可直接編譯——decode.ts 可放心採用同樣寫
 * 法，仍必須在執行期做這個判斷（型別不會幫忙擋，只是不會擋編譯）。
 */
import { parseGIF, decompressFrames } from 'gifuct-js'

const buffer: ArrayBuffer = new ArrayBuffer(0)
const parsedGif = parseGIF(buffer)
const frames = decompressFrames(parsedGif, true)

for (const frame of frames) {
  const top: number = frame.dims.top
  const left: number = frame.dims.left
  const width: number = frame.dims.width
  const height: number = frame.dims.height
  const colorTable: [number, number, number][] = frame.colorTable
  const pixels: number[] = frame.pixels
  const patch: Uint8ClampedArray = frame.patch
  const delay: number = frame.delay
  const disposalType: number = frame.disposalType
  const transparentIndex: number = frame.transparentIndex

  // 防禦式 undefined 判斷（見上方檔頭說明）——編譯需通過，執行期才是
  // 真正擋下「幀無 GCE」情形的地方。
  if (frame.transparentIndex !== undefined) {
    void frame.transparentIndex
  }
  if (frame.delay !== undefined) {
    void frame.delay
  }
  if (frame.disposalType !== undefined) {
    void frame.disposalType
  }

  void top
  void left
  void width
  void height
  void colorTable
  void pixels
  void patch
  void delay
  void disposalType
  void transparentIndex
}
