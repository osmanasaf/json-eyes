import { readFileSync, statSync } from 'node:fs'
import type { JsonValue } from '../../frontend/src/types'
import { describeParseError, parseJson } from '../../frontend/src/utils/json'
import { tryRepair } from '../../frontend/src/utils/repair'
import { UserError, color, info } from './output'

/**
 * Girdi okuma. Dosya yolu ya da `-` (stdin) kabul ediliyor; arguman verilmezse
 * ve stdin bir terminale bagli degilse boru hattindan okunur — `curl … | jse
 * share` en dogal kullanim.
 */

export async function readInput(target: string | undefined): Promise<{ text: string; name: string }> {
  if (target === undefined) {
    if (process.stdin.isTTY) {
      throw new UserError(
        'Girdi yok.',
        'Bir dosya verin (jse share veri.json) ya da boru hattından okutun (cat veri.json | jse share).',
      )
    }
    return { text: await readStdin(), name: '(stdin)' }
  }
  if (target === '-') return { text: await readStdin(), name: '(stdin)' }

  try {
    const stats = statSync(target)
    if (stats.isDirectory()) {
      throw new UserError(`${target} bir dizin, dosya bekleniyordu.`)
    }
  } catch (error) {
    if (error instanceof UserError) throw error
    throw new UserError(`Dosya okunamadı: ${target}`, 'Yolu kontrol edin.')
  }
  return { text: readFileSync(target, 'utf8'), name: target }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) throw new UserError('Boru hattından boş girdi geldi.')
  return text
}

export interface LoadedJson {
  data: JsonValue
  text: string
  name: string
  /** Otomatik onarim uygulandi mi. */
  repaired: boolean
}

/**
 * Metni JSON'a cevirir. Bozuksa hata satirini soyler; `--fix` verilmisse
 * onarim (yorum, fazla virgul, tek tirnak) denenir — web arayuzundeki
 * "Otomatik düzelt ve dene" ile ayni kod.
 */
export function loadJson(text: string, name: string, allowFix: boolean): LoadedJson {
  const first = parseJson(text)
  if (first.data !== null) return { data: first.data, text, name, repaired: false }

  if (!first.error) {
    throw new UserError(`${name} boş.`)
  }

  if (allowFix) {
    const repaired = tryRepair(text)
    if (repaired !== null) {
      const second = parseJson(repaired)
      if (second.data !== null) {
        info(`${color.yellow('düzeltildi')} ${name}: yorum/fazla virgül/tek tırnak onarıldı.`)
        return { data: second.data, text: repaired, name, repaired: true }
      }
    }
  }

  const detail = describeParseError(first.error, text)
  const where = detail.line !== null ? ` (satır ${detail.line}${detail.column !== null ? `, sütun ${detail.column}` : ''})` : ''
  throw new UserError(
    `${name} geçerli JSON değil${where}: ${first.error}`,
    allowFix ? undefined : 'Otomatik onarımı denemek için --fix ekleyin.',
  )
}
