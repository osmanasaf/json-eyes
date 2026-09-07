import { existsSync } from 'node:fs'
import type { JsonValue } from '../../../frontend/src/types'
import { diffJson, type DiffCounts, type DiffNode, type DiffResult } from '../../../frontend/src/utils/diff'
import { summaryOf } from '../../../frontend/src/utils/grid'
import { createShare, extractShareId, getShare } from '../api'
import { flagBool, flagNumber, flagString, type ParsedArgs } from '../args'
import { diffUrl, insecureNotice, resolveApi, webBaseFrom } from '../config'
import { loadJson, readInput, wantsXml } from '../input'
import { UserError, color, info, out, warn } from '../output'
import { openInBrowser } from './share'

export const DIFF_FLAGS = [
  'api', 'web', 'title', 'json', 'local', 'exit-code', 'limit', 'open',
  'no-comments', 'quiet', 'q', 'xml', 'fix',
]

/**
 * `jse diff <a> <b>` — iki JSON'u karsilastirir ve **fark linkini** basar.
 *
 * Terminalde ozet vermek kolay kisim; isin degerli yani linkte: fark
 * gorunumunun kendisi (birlesik agac, kimlige gore eslestirilmis diziler,
 * degisiklikler arasinda gezinme) zaten web'de var ve okunmasi gereken sey
 * genellikle bir ekip arkadasiyla paylasilan sey. Bu yuzden komut iki tarafi
 * paylasima yaziyor ve `?s=A&d=B` adresini donduruyor; on yuz `d` gorunce Fark
 * gorunumunu acip ikinci tarafi kendisi getiriyor.
 *
 * Karsilastirma yine de *yerelde* yapiliyor: ozet, `--json` ve `--exit-code`
 * icin sunucuya sormaya gerek yok. `--local` ile hicbir sey gonderilmez —
 * baglanti sifresizken (uretim backend'i su an duz HTTP) tek guvenli yol bu.
 *
 * Motor web arayuzuyle ayni kod (frontend/src/utils/diff.ts), dolayisiyla
 * terminalde gordugunuz sayilar linkte gordukleriniz.
 */
export async function diffCommand(args: ParsedArgs): Promise<number> {
  const quiet = flagBool(args, 'quiet', 'q')
  const asJson = flagBool(args, 'json')
  const local = flagBool(args, 'local')
  const limit = flagNumber(args, 'limit') ?? 10

  const [rawLeft, rawRight] = args.positional
  if (!rawLeft || !rawRight) {
    throw new UserError(
      'İki JSON gerekiyor.',
      'Kullanım: jse diff eski.json yeni.json · dosya, - (stdin) ya da paylaşım linki',
    )
  }
  if (rawLeft === '-' && rawRight === '-') {
    throw new UserError('İki taraf da stdin olamaz.', 'Bir tarafı dosya ya da paylaşım linki verin.')
  }

  const resolved = resolveApi(flagString(args, 'api'))
  const left = await resolveSide(rawLeft, args, resolved.api)
  const right = await resolveSide(rawRight, args, resolved.api)

  const started = Date.now()
  const result = diffJson(left.data, right.data, 'json')
  const total = totalOf(result.counts)
  const changes = collectChanges(result, Math.max(limit, 0) || 10_000)

  if (!quiet && !asJson) {
    info(`${color.dim('karşılaştırılıyor')} ${left.label} ${color.dim('→')} ${right.label} ${color.dim(`(${Date.now() - started} ms)`)}`)
    info(summaryLine(result.counts))
    if (result.degraded) {
      warn('Dizi çok büyük olduğu için indeks hizalı karşılaştırmaya düşüldü; taşınan öğeler değişmiş görünebilir.')
    }
    for (const line of changes.slice(0, limit)) info(`  ${line.text}`)
    if (changes.length > limit) {
      info(color.dim(`  … ${(changes.length - limit).toLocaleString('tr-TR')} değişiklik daha (--limit ile artırın)`))
    }
  }

  // --local: hicbir sey gonderilmez, degisiklik listesi stdout'a yazilir.
  if (local) {
    if (asJson) {
      out(JSON.stringify({
        left: { label: left.label }, right: { label: right.label },
        counts: result.counts, changes: changes.map(toJsonChange),
      }, null, 2))
    } else if (total === 0) {
      out('fark yok')
    } else {
      for (const line of changes) out(line.text)
    }
    return flagBool(args, 'exit-code') && total > 0 ? 1 : 0
  }

  const insecure = insecureNotice(resolved.api)
  if (insecure && !quiet && !asJson) warn(insecure)

  const title = flagString(args, 'title', 't')
  const commentsEnabled = !flagBool(args, 'no-comments')
  const bases: string[] = []
  if (resolved.web) bases.push(resolved.web)
  for (const side of [left, right]) if (side.base) bases.push(side.base)

  // Zaten paylasilmis taraf yeniden gonderilmez: `jse diff <link> <link>`
  // hicbir veri yuklemez.
  const leftId = left.shareId ?? await share(resolved.api, left, sideTitle(title, 'A', left.label), commentsEnabled, bases)
  const rightId = right.shareId ?? await share(resolved.api, right, sideTitle(title, 'B', right.label), commentsEnabled, bases)

  const base = flagString(args, 'web') ?? bases[0]
  if (!base) {
    throw new UserError(
      'Fark linkinin ön yüz tabanı bilinmiyor.',
      'jse config set web https://json-eyes.vercel.app (ya da --web ile verin)',
    )
  }
  const url = diffUrl(base, leftId, rightId)

  if (asJson) {
    out(JSON.stringify({
      url,
      left: { label: left.label, id: leftId },
      right: { label: right.label, id: rightId },
      counts: result.counts,
      changes: changes.map(toJsonChange),
    }, null, 2))
  } else {
    out(url)
    if (!quiet) {
      info(`${color.green('fark linki')} ${color.dim(`A ${leftId} · B ${rightId}`)} · salt okunur · 60 gün saklanır`)
    }
  }

  if (flagBool(args, 'open')) openInBrowser(url)
  return flagBool(args, 'exit-code') && total > 0 ? 1 : 0
}

/** Bir tarafi cozer: dosya, stdin ya da paylasim linki/kimligi. */
interface Side {
  data: JsonValue
  label: string
  /** Taraf zaten paylasimdaysa kimligi; yeniden gonderilmez. */
  shareId: string | null
  /** Linkten cikarilan on yuz tabani (varsa). */
  base: string | null
}

async function resolveSide(raw: string, args: ParsedArgs, api: string): Promise<Side> {
  // Dosya her zaman kazanir: "4bK9zQ1x" adinda bir dosya varsa o okunur.
  if (raw !== '-' && !existsSync(raw) && looksLikeShare(raw)) {
    const id = extractShareId(raw)
    const share = await getShare(api, id)
    return {
      data: share.json,
      label: share.title ?? `paylaşım ${share.id}`,
      shareId: share.id,
      base: raw.includes('://') ? webBaseFrom(raw) : null,
    }
  }
  const { text, name } = await readInput(raw)
  const loaded = loadJson(text, name, flagBool(args, 'fix'), wantsXml(args, name))
  return { data: loaded.data, label: name, shareId: null, base: null }
}

/** Paylasim linki ya da kimligi gibi mi duruyor. */
function looksLikeShare(raw: string): boolean {
  if (/[?&]s=[A-Za-z0-9]+/.test(raw)) return true
  // Cipla kimlik: dosya olmadigi zaten kontrol edildi.
  return /^[A-Za-z0-9]{6,}$/.test(raw) && !raw.includes('.')
}

async function share(
  api: string,
  side: Side,
  title: string,
  commentsEnabled: boolean,
  bases: string[],
): Promise<string> {
  const response = await createShare(api, side.data, { title, commentsEnabled })
  const base = webBaseFrom(response.url)
  if (base) bases.push(base)
  return response.id
}

function sideTitle(title: string | undefined, side: 'A' | 'B', label: string): string {
  return title ? `${title} — ${side}` : `${side}: ${label}`
}

function totalOf(counts: DiffCounts): number {
  return counts.added + counts.removed + counts.changed + counts.moved
}

function summaryLine(counts: DiffCounts): string {
  const total = totalOf(counts)
  if (total === 0) return color.green('fark yok')
  const parts: string[] = []
  if (counts.added) parts.push(`${counts.added.toLocaleString('tr-TR')} eklendi`)
  if (counts.removed) parts.push(`${counts.removed.toLocaleString('tr-TR')} silindi`)
  if (counts.changed) parts.push(`${counts.changed.toLocaleString('tr-TR')} değişti`)
  if (counts.moved) parts.push(`${counts.moved.toLocaleString('tr-TR')} taşındı`)
  return `${color.yellow(`${total.toLocaleString('tr-TR')} değişiklik`)}: ${parts.join(' · ')}`
}

interface Change {
  kind: string
  path: string
  text: string
  left?: JsonValue
  right?: JsonValue
  from?: number
  to?: number
}

const MARKS: Record<string, string> = { added: '+', removed: '-', changed: '~', moved: '→' }

/**
 * Degisiklikleri okunur yollarla toplar.
 *
 * Yol dizi indeksi yerine *kimlik* tasiyor: `Order[ORD100042].StatusCode`,
 * `Order.5.StatusCode` degil. NDC'de indeks iki yanit arasinda kayar, kimlik
 * kaymaz — rapor ancak boyle ise yarar.
 */
function collectChanges(result: DiffResult, limit: number): Change[] {
  const out: Change[] = []

  function walk(node: DiffNode, prefix: string) {
    if (out.length >= limit) return
    const segment = node.label !== undefined
      ? `[${node.label}]`
      : prefix ? `.${node.key}` : node.key
    const path = prefix + segment
    const leaf = node.children.length === 0
    if (node.kind !== 'unchanged' && (leaf || node.kind === 'added' || node.kind === 'removed' || node.kind === 'moved')) {
      out.push(describe(node, path))
    }
    for (const child of node.children) walk(child, path)
  }

  for (const child of result.root.children) walk(child, '')
  return out
}

function describe(node: DiffNode, path: string): Change {
  const mark = MARKS[node.kind] ?? '?'
  const base: Change = { kind: node.kind, path, text: '', left: node.left, right: node.right }
  if (node.kind === 'changed') {
    base.text = `${mark} ${path}   ${color.red(short(node.left))} → ${color.green(short(node.right))}`
  } else if (node.kind === 'added') {
    base.text = `${mark} ${path}   ${color.green(short(node.right))}`
  } else if (node.kind === 'removed') {
    base.text = `${mark} ${path}   ${color.red(short(node.left))}`
  } else {
    base.from = node.from
    base.to = node.to
    base.text = `${mark} ${path}   ${color.dim(`${node.from} → ${node.to}`)}`
  }
  return base
}

const MAX_VALUE_CHARS = 48

/** Deger tek satirda ve kisa: kapsayicilar ozetlenir, uzun metin kirpilir. */
function short(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  if (value !== null && typeof value === 'object') return summaryOf(value)
  const text = value === null ? 'null' : String(value).replace(/\r?\n/g, ' ↵ ')
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

function toJsonChange(change: Change) {
  return {
    kind: change.kind,
    path: change.path,
    ...(change.left !== undefined ? { left: change.left } : {}),
    ...(change.right !== undefined ? { right: change.right } : {}),
    ...(change.from !== undefined ? { from: change.from, to: change.to } : {}),
  }
}
