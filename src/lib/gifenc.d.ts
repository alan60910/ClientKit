/**
 * Ambient type declarations for `gifenc@1.0.3`.
 *
 * gifenc ships no TypeScript types and `@types/gifenc` does not exist
 * (see PLAN.md「新增依賴」段). Signatures below are hand-verified against
 * the installed package's source (node_modules/gifenc/src/*.js) and README,
 * scoped to the minimal surface this project uses: `quantize`,
 * `applyPalette`, and `GIFEncoder` (writeFrame/finish/bytes/bytesView).
 */
declare module 'gifenc' {
  /** RGB or RGBA color entry as produced/consumed by quantize/applyPalette. */
  export type GifencColor =
    | [number, number, number]
    | [number, number, number, number]

  export type GifencPalette = GifencColor[]

  export type GifencPixelFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface QuantizeOptions {
    /** Color packing format used during quantization. Default 'rgb565'. */
    format?: GifencPixelFormat
    /**
     * Collapse alpha to fully opaque/transparent (rgba4444 only).
     * `true` uses a 127 threshold; a number sets a custom threshold.
     * Default false.
     */
    oneBitAlpha?: boolean | number
    /**
     * When a quantized alpha is below clearAlphaThreshold, replace its RGB
     * with clearAlphaColor (rgba4444 only). Default true.
     */
    clearAlpha?: boolean
    /** Alpha threshold used by clearAlpha (rgba4444 only). Default 0. */
    clearAlphaThreshold?: number
    /** RGB value used to clear a color under clearAlpha (rgba4444 only). Default 0x00. */
    clearAlphaColor?: number
  }

  /**
   * Reduce the colors of a flat RGBA buffer down to a palette of at most
   * `maxColors` entries (each `[r,g,b]` or `[r,g,b,a]` depending on `format`).
   */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions
  ): GifencPalette

  /**
   * Map each pixel of a flat RGBA buffer to the nearest color's index in
   * `palette`. Returns one byte per pixel (length = rgba.length / 4).
   */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifencPalette,
    format?: GifencPixelFormat
  ): Uint8Array

  export interface GIFEncoderOptions {
    /** Initial byte size of the internal growable buffer. Default 4096. */
    initialCapacity?: number
    /**
     * When true (default), the header and first-frame metadata (global
     * palette) are written automatically on the first `writeFrame` call.
     */
    auto?: boolean
  }

  export interface WriteFrameOptions {
    /**
     * Color table for this frame. Required on the first frame (becomes the
     * global color table); optional afterwards (per-frame local palette).
     */
    palette?: GifencPalette | null
    /** Non-auto mode only: mark this call as the first frame. Default false. */
    first?: boolean
    /** Enable 1-bit transparency for this frame. Default false. */
    transparent?: boolean
    /** Palette index treated as transparent when `transparent` is set. Default 0. */
    transparentIndex?: number
    /** Frame delay in **milliseconds** (converted internally to 1/100s). Default 0. */
    delay?: number
    /** -1 = play once, 0 = loop forever, >0 = repeat count. Default 0. */
    repeat?: number
    /** Bits per pixel for the color table. Default 8. */
    colorDepth?: number
    /** GIF disposal method override; -1 = use default. Default -1. */
    dispose?: number
  }

  export interface GIFEncoderInstance {
    /** Write a single indexed-bitmap frame into the GIF stream. */
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions
    ): void
    /** Write the GIF trailer. Required once after all frames are written. */
    finish(): void
    /** Copy of the encoded bytes so far. */
    bytes(): Uint8Array
    /** Zero-copy view into the encoded bytes so far. */
    bytesView(): Uint8Array
  }

  /** Create a new GIF encoding stream. */
  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance
}
