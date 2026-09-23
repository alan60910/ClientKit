/**
 * Thin backward-compatible re-export layer over the shared GIF encoding
 * pipeline ((internal design doc) §3: "重新編碼——抽取邊界"). The full
 * pipeline — `encodeGif` (formerly `convertToGif`), option normalization,
 * DEFAULT constants, and quantization — sank to `src/lib/gif-encode.ts` so
 * gif-editor can reuse it verbatim.
 *
 * This layer exists purely so `main.ts`/`encode.worker.ts` can keep
 * importing from `./convert.js` unchanged. The re-export surface is pinned
 * to exactly the consumer set grep-verified at sink time — `convertToGif`,
 * `ConvertOptions`, `DecodedAnimation` — no more, no less. It carries no
 * logic of its own; see `src/lib/gif-encode.test.ts` for the actual pipeline
 * tests and `convert.test.ts` for this layer's own smoke test.
 */
export {
  encodeGif as convertToGif,
  type GifEncodeOptions as ConvertOptions,
  type GifEncodeInput as DecodedAnimation,
} from '../../src/lib/gif-encode.js'
