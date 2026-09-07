import { writeFileSync } from 'node:fs'
import { flagBool, flagString, type ParsedArgs } from '../args'
import { convertXmlInput, readInput } from '../input'
import { color, info, out } from './../output'

export const XML_FLAGS = ['out', 'o', 'minify', 'numbers', 'keep-prefixes', 'quiet', 'q']

/**
 * `jse xml2json <dosya|->` — XML'i JSON'a cevirip yazar.
 *
 * Cevrilmis JSON'un kendisini isteyenler icin: dosyaya yazmak, baska bir araca
 * boru hattiyla vermek. Paylasim linki isteyen `jse xmlshare` kullanir;
 * `share`, `values`, `find`, `get` da XML kabul eder ama yalnizca acikca
 * istendiginde (`.xml` uzantisi ya da `--xml`) — girdinin icerigine bakip
 * tahmin yapan bir arac, yanlis tahmininde kullanicinin anlamadigi bir sonuc
 * uretir.
 */
export async function xmlCommand(args: ParsedArgs): Promise<number> {
  const { text, name } = await readInput(args.positional[0])
  const converted = convertXmlInput(text, name, {
    numbers: flagBool(args, 'numbers'),
    keepPrefixes: flagBool(args, 'keep-prefixes'),
  })

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
