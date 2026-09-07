import { readFileSync, statSync } from 'node:fs'
import type { JsonValue } from '../../frontend/src/types'
import { describeParseError, parseJson } from '../../frontend/src/utils/json'
import { tryRepair } from '../../frontend/src/utils/repair'
import { looksLikeXml, xmlToJson, XmlParseError } from '../../frontend/src/utils/xml'
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
  /** XML'den cevrildi mi. */
  fromXml: boolean
}

/** Girdi XML olarak islenecek mi: `--xml` bayragi ya da `.xml` uzantisi. */
export function wantsXml(args: { flags: Map<string, string | true> }, name: string): boolean {
  return args.flags.get('xml') !== undefined || /\.xml$/i.test(name)
}

/**
 * Metni JSON'a cevirir. Bozuksa hata satirini soyler; `--fix` verilmisse
 * onarim (yorum, fazla virgul, tek tirnak) denenir — web arayuzundeki
 * "Otomatik düzelt ve dene" ile ayni kod.
 *
 * XML cevirimi yalnizca `xml` acikca istendiginde yapilir (`--xml` ya da `.xml`
 * uzantisi). Onceden girdinin icerigine bakilip "bu XML'e benziyor" diye karar
 * veriliyordu; bir aracin girdisini kendi basina yorumlamasi, yanlis
 * yorumladiginda kullanicinin anlamadigi bir sonuc uretir. Uzanti ve bayrak
 * kullanicinin acik tercihi — icerik degil.
 */
export function loadJson(text: string, name: string, allowFix: boolean, xml = false): LoadedJson {
  const first = parseJson(text)
  if (first.data !== null) return { data: first.data, text, name, repaired: false, fromXml: false }

  if (!first.error) {
    throw new UserError(`${name} boş.`)
  }

  if (xml) {
    try {
      const converted = xmlToJson(text)
      info(`${color.blue('XML çevrildi')} ${name} → kök <${converted.root}> · ${converted.notes.join(' · ')}`)
      return {
        data: converted.data,
        text: JSON.stringify(converted.data, null, 2),
        name,
        repaired: false,
        fromXml: true,
      }
    } catch (error) {
      if (error instanceof XmlParseError) {
        throw new UserError(`${name}: XML ayrıştırılamadı (satır ${error.line}): ${error.message}`)
      }
      throw new UserError(`${name}: XML çevrilemedi: ${(error as Error).message}`)
    }
  }

  if (allowFix) {
    const repaired = tryRepair(text)
    if (repaired !== null) {
      const second = parseJson(repaired)
      if (second.data !== null) {
        info(`${color.yellow('düzeltildi')} ${name}: yorum/fazla virgül/tek tırnak onarıldı.`)
        return { data: second.data, text: repaired, name, repaired: true, fromXml: false }
      }
    }
  }

  const detail = describeParseError(first.error, text)
  const where = detail.line !== null ? ` (satır ${detail.line}${detail.column !== null ? `, sütun ${detail.column}` : ''})` : ''
  // Metin XML'e benziyorsa kendi basina cevirmiyoruz ama yolu soyluyoruz.
  const hint = looksLikeXml(text)
    ? 'Bu girdi XML gibi görünüyor: --xml ekleyin ya da jse xml2json kullanın.'
    : allowFix ? undefined : 'Otomatik onarımı denemek için --fix ekleyin.'
  throw new UserError(`${name} geçerli JSON değil${where}: ${first.error}`, hint)
}
