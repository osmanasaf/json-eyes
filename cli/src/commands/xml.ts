import { writeFileSync } from 'node:fs'
import { xmlToJson, XmlParseError } from '../../../frontend/src/utils/xml'
import { flagBool, flagString, type ParsedArgs } from '../args'
import { readInput } from '../input'
import { UserError, color, info, out } from './../output'

export const XML_FLAGS = ['out', 'o', 'minify', 'numbers', 'keep-prefixes', 'quiet', 'q']

/**
 * `jse xml2json <dosya|->` — XML'i JSON'a cevirip yazar.
 *
 * Cevirinin ana adresi burasi. `share`, `values`, `find`, `get` komutlari da
 * XML kabul eder ama yalnizca acikca istendiginde (`.xml` uzantisi ya da
 * `--xml`); girdinin icerigine bakip tahmin yapan bir arac, yanlis
 * tahmininde kullanicinin anlamadigi bir sonuc uretir.
 */
export async function xmlCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  let converted
  try {
    converted = xmlToJson(text, {
      numbers: flagBool(args, 'numbers'),
      keepPrefixes: flagBool(args, 'keep-prefixes'),
    })
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new UserError(`${name}: XML ayrıştırılamadı (satır ${error.line}): ${error.message}`)
    }
    throw new UserError(`${name}: XML çevrilemedi: ${(error as Error).message}`)
  }

  const output = flagBool(args, 'minify')
    ? JSON.stringify(converted.data)
    : JSON.stringify(converted.data, null, 2)

  const quiet = flagBool(args, 'quiet', 'q')
  const outFile = flagString(args, 'out', 'o')
  if (outFile) {
    writeFileSync(outFile, `${output}\n`, 'utf8')
    if (!quiet) info(`${color.green('yazıldı')} ${outFile} ${color.dim(`(kök <${converted.root}>)`)}`)
    return 0
  }
  if (!quiet) info(`${color.dim(`kök <${converted.root}> · ${converted.notes.join(' · ')}`)}`)
  out(output)
  return 0
}
