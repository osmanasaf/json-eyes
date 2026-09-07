/**
 * Ham JSON metnindeki her dugumun karakter araligini cikarir: goruntuleyicideki
 * bir alan secildiginde editorun o alanin metnine gitmesi ("GridSync") ancak
 * yol -> metin araligi eslesmesiyle mumkun.
 *
 * Ayristirilmis agactan geri gidilemez (JSON.parse konum bilgisi vermez), bu
 * yuzden metin ikinci kez, bu kez konumlari kaydeden bir tarayiciyla geciliyor.
 * Tarayici yalnizca JSON.parse'in kabul ettigi metinlerde cagriliyor; gecersiz
 * girdide gorevi hatali satiri isaretlemek olan mevcut yol devrede kalir.
 */

export interface TextRange {
  /** Degerin ilk karakteri (anahtar degil, degerin kendisi). */
  start: number
  /** Degerin son karakterinden bir sonrasi. */
  end: number
}

export interface JsonTextIndex {
  ranges: Map<string, TextRange>
  /** Her satirin baslangic ofseti; ofset -> satir cevirisi icin. */
  lineStarts: number[]
  /** Ust sinir asildi mi; asildiysa derin dallar indekste yoktur. */
  truncated: boolean
}

export const EMPTY_TEXT_INDEX: JsonTextIndex = {
  ranges: new Map(),
  lineStarts: [0],
  truncated: false,
}

/** Indekslenecek en fazla dugum; cok buyuk belgelerde bellegi sinirlar. */
const MAX_PATHS = 300_000

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13
}

export function buildTextIndex(text: string, rootKey: string): JsonTextIndex {
  const ranges = new Map<string, TextRange>()
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  }

  let i = 0
  let truncated = false
  const n = text.length

  function skipWhitespace() {
    while (i < n && isWhitespace(text.charCodeAt(i))) i++
  }

  /** Tirnak icindeki metni gecer; kacis dizileri atlanir. */
  function skipString(): string {
    const start = i
    i++ // acilis tirnagi
    while (i < n) {
      const code = text.charCodeAt(i)
      if (code === 92) { i += 2; continue }
      i++
      if (code === 34) break
    }
    return text.slice(start, i)
  }

  function record(path: string, start: number, end: number) {
    if (ranges.size >= MAX_PATHS) {
      truncated = true
      return
    }
    ranges.set(path, { start, end })
  }

  function parseValue(path: string) {
    skipWhitespace()
    const start = i
    const ch = text[i]
    if (ch === '{') {
      i++
      parseObject(path)
    } else if (ch === '[') {
      i++
      parseArray(path)
    } else if (ch === '"') {
      skipString()
    } else {
      // Sayi, true, false, null: ayirici veya bosluga kadar.
      while (i < n) {
        const c = text[i]
        if (c === ',' || c === '}' || c === ']' || isWhitespace(text.charCodeAt(i))) break
        i++
      }
    }
    record(path, start, i)
  }

  function parseObject(path: string) {
    for (;;) {
      skipWhitespace()
      if (i >= n) return
      if (text[i] === '}') { i++; return }
      if (text[i] === ',') { i++; continue }
      if (text[i] !== '"') { i++; continue } // beklenmeyen karakter: ilerle
      const raw = skipString()
      // Kacis dizisi varsa anahtar cozulur; yollar cozulmus adlarla kuruluyor.
      const key = raw.includes('\\') ? (JSON.parse(raw) as string) : raw.slice(1, -1)
      skipWhitespace()
      if (text[i] === ':') i++
      parseValue(`${path}.${key}`)
    }
  }

  function parseArray(path: string) {
    let index = 0
    for (;;) {
      skipWhitespace()
      if (i >= n) return
      if (text[i] === ']') { i++; return }
      if (text[i] === ',') { i++; continue }
      const before = i
      parseValue(`${path}.${index}`)
      index++
      // Guvenlik: ilerlemediysek sonsuz donguye girmemek icin cik.
      if (i === before) { i++; }
    }
  }

  parseValue(rootKey)
  return { ranges, lineStarts, truncated }
}

/** Ofsetin 1 tabanli satir numarasi. */
export function lineOfOffset(index: JsonTextIndex, offset: number): number {
  const starts = index.lineStarts
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}
