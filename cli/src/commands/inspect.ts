import { writeFileSync } from 'node:fs'
import type { JsonValue } from '../../../frontend/src/types'
import { getType } from '../../../frontend/src/utils/json'
import { collectFieldValues } from '../../../frontend/src/utils/related'
import { buildSearchIndex } from '../../../frontend/src/utils/search'
import { tryRepair } from '../../../frontend/src/utils/repair'
import { flagBool, flagNumber, flagString, type ParsedArgs } from '../args'
import { loadJson, readInput } from '../input'
import { UserError, clip, color, info, out, table } from '../output'

/**
 * Yerel inceleme komutlari. Hepsi on yuzun kendi yardimcilarini kullaniyor
 * (`utils/related`, `utils/search`, `utils/repair`) — tarayicida gordugunuz
 * sayilarla terminalde gordukleriniz ayni kod yolundan geliyor.
 */

const ROOT_KEY = 'json'

export const VALUES_FLAGS = ['json', 'limit', 'fix']
export const FIND_FLAGS = ['json', 'limit', 'values', 'fix']
export const GET_FLAGS = ['raw', 'minify', 'fix']
export const FIX_FLAGS = ['out', 'o', 'minify']

/**
 * Kullanici yolunu ic gosterime cevirir. Kok etiketi ("json"), `$` oneki ve
 * kose parantezli indeksler (Order[0]) kabul edilir.
 */
function normalizePath(input: string): string {
  const trimmed = input.trim().replace(/^\$\.?/, '')
  if (!trimmed) return ROOT_KEY
  const dotted = trimmed.replace(/\[(\d+)\]/g, '.$1')
  return dotted === ROOT_KEY || dotted.startsWith(`${ROOT_KEY}.`) ? dotted : `${ROOT_KEY}.${dotted}`
}

/** Yolun kok etiketi atilmis hali; kullaniciya gosterilen bicim. */
function relative(path: string): string {
  return path === ROOT_KEY ? path : path.replace(new RegExp(`^${ROOT_KEY}\\.`), '')
}

/**
 * Belgedeki tum alan yollari (dizi indeksleri atilmis). CLI'de kullanicidan
 * kokten baslayan tam zinciri yazmasini beklemek ise yaramaz: elinde bir alan
 * adi vardir (`StatusCode`) ya da yolun kuyrugu (`Order.StatusCode`). Bu liste
 * uzerinden kuyruk eslesmesi yapiyoruz.
 */
function collectFieldPaths(data: JsonValue): string[] {
  const paths = new Set<string>()
  function walk(value: JsonValue, field: string) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, field)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, JsonValue>)) {
      const next = field ? `${field}.${key}` : key
      paths.add(next)
      walk(child, next)
    }
  }
  walk(data, '')
  return [...paths]
}

/** Tam yol, sonra kuyruk eslesmesi. Birden fazla adaya hata verilir. */
function pickPath(candidates: string[], input: string, shown: string, what: string): string {
  const wanted = input.replace(new RegExp(`^${ROOT_KEY}\\.`), '')
  const exact = candidates.find(candidate => candidate === wanted)
  if (exact) return exact

  const suffix = candidates.filter(candidate => candidate.endsWith(`.${wanted}`))
  if (suffix.length === 1) return suffix[0]
  if (suffix.length === 0) {
    throw new UserError(
      `${shown} belgede bulunamadı.`,
      `Alan adını \`jse find <dosya> ${wanted.split('.').pop()}\` ile arayabilirsiniz.`,
    )
  }

  // Birden fazla eslesme: hangisini istedigini varsaymak yerine listeliyoruz.
  const list = suffix.slice(0, 10).map(candidate => `  ${candidate}`).join('\n')
  throw new UserError(
    `${shown} birden fazla ${what} ile eşleşiyor (${suffix.length}):\n${list}${suffix.length > 10 ? '\n  …' : ''}`,
    'Yolu daha uzun yazın (örn. Response.Order.StatusCode).',
  )
}

/**
 * Verilen kuyruga uyan gercek dugum yollari (indeksler dahil). `get` icin:
 * kullanici "Order.0.OrderID" yazdiginda kokten baslamasi gerekmiyor.
 */
function findNodePaths(data: JsonValue, wanted: string, limit: number): string[] {
  const found: string[] = []
  function walk(value: JsonValue, path: string) {
    if (found.length >= limit) return
    const rel = relative(path)
    if (rel === wanted || rel.endsWith(`.${wanted}`)) found.push(path)
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`))
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, JsonValue>)) {
      walk(child, `${path}.${key}`)
    }
  }
  walk(data, ROOT_KEY)
  return found
}

function valueAt(data: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue = data
  for (const segment of path.split('.').slice(1)) {
    if (current === null || typeof current !== 'object') return undefined
    const next = Array.isArray(current)
      ? (current as JsonValue[])[Number(segment)]
      : (current as Record<string, JsonValue>)[segment]
    if (next === undefined) return undefined
    current = next
  }
  return current
}

/** `jse values <dosya> <yol>` — alanin belge genelindeki dagilimi. */
export async function valuesCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  const loaded = loadJson(text, name, flagBool(args, 'fix'))
  const rawPath = args.positional[1]
  if (!rawPath) {
    throw new UserError('Alan yolu verilmedi.', 'Örnek: jse values siparis.json Response.Order.StatusCode')
  }
  // Kullanici kuyruk yazabilir: "StatusCode" ya da "Order.StatusCode".
  const fieldPath = pickPath(collectFieldPaths(loaded.data), normalizePath(rawPath), rawPath, 'alan')
  const stats = collectFieldValues(loaded.data, ROOT_KEY, `${ROOT_KEY}.${fieldPath}`)
  if (!stats) {
    throw new UserError(`${rawPath} belgede bulunamadı.`, 'Yolu `jse find` ile arayabilirsiniz.')
  }

  if (flagBool(args, 'json')) {
    out(JSON.stringify(stats, null, 2))
    return 0
  }

  const limit = flagNumber(args, 'limit') ?? stats.distinct.length
  info(`${color.bold(stats.fieldPath)}`)
  info(`${stats.total.toLocaleString('tr-TR')} kayıtta geçiyor · ${stats.distinctTotal.toLocaleString('tr-TR')} farklı değer · ${stats.missing.toLocaleString('tr-TR')} kayıtta alan yok`)
  if (stats.numeric) {
    info(color.dim(`min ${stats.numeric.min} · maks ${stats.numeric.max} · ort ${stats.numeric.avg.toFixed(2)} · toplam ${stats.numeric.sum}`))
  }
  info('')

  const max = stats.distinct[0]?.count ?? 1
  const rows = stats.distinct.slice(0, limit).map(item => [
    clip(item.text, 48),
    item.count.toLocaleString('tr-TR'),
    bar(item.count / max),
  ])
  out(table(['DEĞER', 'ADET', ''], rows, ['left', 'right', 'left']))
  if (stats.distinctTotal > stats.distinct.length) {
    info(color.dim(`+${(stats.distinctTotal - stats.distinct.length).toLocaleString('tr-TR')} değer daha`))
  }
  if (stats.truncated) info(color.yellow('Sayım üst sınıra takıldı; dağılım kısmi.'))
  return 0
}

/** Buyuklugu tek renkli, sirali bir cubukla anlatir (14 karakter). */
function bar(share: number): string {
  const width = Math.max(1, Math.round(share * 14))
  return color.blue('█'.repeat(width))
}

/** `jse find <dosya> <terim>` — yapiya duyarli arama: eslesen yollar. */
export async function findCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  const loaded = loadJson(text, name, flagBool(args, 'fix'))
  const term = args.positional[1]
  if (!term) {
    throw new UserError('Arama terimi verilmedi.', 'Örnek: jse find siparis.json CANCELLED')
  }

  const index = buildSearchIndex(loaded.data, term, ROOT_KEY)
  const limit = flagNumber(args, 'limit') ?? 50
  const showValues = flagBool(args, 'values')

  if (flagBool(args, 'json')) {
    out(JSON.stringify({
      term,
      total: index.matches.length,
      truncated: index.truncated,
      matches: index.matches.slice(0, limit).map(path => ({
        path: path.replace(/^json\.?/, ''),
        value: showValues ? (valueAt(loaded.data, path) ?? null) : undefined,
      })),
    }, null, 2))
    return 0
  }

  if (index.matches.length === 0) {
    info(`${color.yellow('eşleşme yok')} ${term}`)
    return 1
  }

  for (const path of index.matches.slice(0, limit)) {
    const shown = path.replace(/^json\.?/, '')
    if (!showValues) {
      out(shown)
      continue
    }
    const value = valueAt(loaded.data, path)
    const type = value === undefined ? '?' : getType(value)
    const rendered = value === undefined || value === null || typeof value === 'object'
      ? color.dim(type)
      : clip(String(value), 60)
    out(`${shown}  ${rendered}`)
  }
  const shownCount = Math.min(limit, index.matches.length)
  info(color.dim(`${index.matches.length.toLocaleString('tr-TR')} eşleşme${index.truncated ? ' (üst sınıra takıldı)' : ''}, ${shownCount} tanesi listelendi`))
  return 0
}

/** `jse get <dosya> <yol>` — tek bir degeri yazar; boru hattinda kullanmak icin. */
export async function getCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  const loaded = loadJson(text, name, flagBool(args, 'fix'))
  const rawPath = args.positional[1]
  if (!rawPath) {
    throw new UserError('Yol verilmedi.', 'Örnek: jse get siparis.json Response.Order.0.OrderID')
  }
  const literal = normalizePath(rawPath)
  let value = valueAt(loaded.data, literal)
  if (value === undefined) {
    // Tam yol tutmadi: kuyruk eslesmesi dene (kokten yazmak zorunlu olmasin).
    const matches = findNodePaths(loaded.data, relative(literal), 11)
    if (matches.length === 0) {
      throw new UserError(`${rawPath} bulunamadı.`, 'Yolu `jse find` ile arayabilirsiniz.')
    }
    if (matches.length > 1) {
      const shown = matches.slice(0, 10).map(match => `  ${relative(match)}`).join('\n')
      throw new UserError(
        `${rawPath} birden fazla düğümle eşleşiyor:\n${shown}${matches.length > 10 ? '\n  …' : ''}`,
        'Yolu daha uzun yazın ya da indeks ekleyin (örn. Order.0.OrderID).',
      )
    }
    value = valueAt(loaded.data, matches[0])
  }
  if (value === undefined) {
    throw new UserError(`${rawPath} bulunamadı.`)
  }
  // --raw: metinler tirnaksiz, kabuk degiskenine almak icin.
  if (flagBool(args, 'raw') && (value === null || typeof value !== 'object')) {
    out(value === null ? 'null' : String(value))
    return 0
  }
  out(flagBool(args, 'minify') ? JSON.stringify(value) : JSON.stringify(value, null, 2))
  return 0
}

/** `jse fix <dosya>` — yorum, fazla virgul ve tek tirnak onarimi. */
export async function fixCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  const repaired = tryRepair(text) ?? text
  const loaded = loadJson(repaired, name, false)
  const output = flagBool(args, 'minify')
    ? JSON.stringify(loaded.data)
    : JSON.stringify(loaded.data, null, 2)

  const outFile = flagString(args, 'out', 'o')
  if (outFile) {
    writeFileSync(outFile, `${output}\n`, 'utf8')
    info(`${color.green('yazıldı')} ${outFile}`)
    return 0
  }
  out(output)
  return 0
}
