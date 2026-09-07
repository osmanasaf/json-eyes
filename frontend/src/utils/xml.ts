import type { JsonObject, JsonValue } from '../types'

/**
 * XML -> JSON cevirisi.
 *
 * Neden elle yazilmis bir ayristirici: tarayicida `DOMParser` var ama Node'da
 * yok; CLI ile web farkli kutuphaneler kullansa ayni XML iki tarafta farkli
 * JSON'a cevrilirdi. Tek kaynak, tek sonuc.
 *
 * IATA NDC'ye gore alinan kararlar:
 *
 * - **Metinler string kalir.** "0123" sayiya cevrilse basindaki sifir gider;
 *   NDC'de ucus numarasi, havayolu kodu, bilet numarasi gibi alanlar bu yuzden
 *   bozulur. Otomatik tip cikarimi yok (isteyen `numbers: true` verebilir).
 * - **Ad alani onekleri atilir** (`iata:Order` -> `Order`): XSD indeksi yerel
 *   adlarla kurulu, alan eslestirmesi ancak boyle tutar. `xmlns` bildirimleri de
 *   duser; veri degil, tasima ayrintisi.
 * - **Ozellikler `@` onekiyle** ayni nesneye girer, metin icerigi `#text` olur.
 *   Ozellik ve cocuk yoksa eleman dogrudan metne iner (`{ CurCode: "EUR" }`).
 * - **Tekrarlayan kardesler diziye** dusurulur; tek geciste bilinemeyecegi icin
 *   ikinci kardeste diziye cevriliyor. Tek ogeli listeler (NDC'de `Order` tek
 *   siparisle gelebilir) bu yuzden dizi *olmaz* — tuketen taraf bunu bilmeli.
 */

export interface XmlToJsonOptions {
  /** Ad alani oneklerini koru (`iata:Order`). Varsayilan: atilir. */
  keepPrefixes?: boolean
  /** Sayi ve dogruluk degerlerini cikar. Varsayilan: kapali (kod alanlari bozulur). */
  numbers?: boolean
}

export interface XmlToJsonResult {
  data: JsonObject
  /** Kok elemanin adi. */
  root: string
  /** Kullaniciya soylenmesi gereken cevirim notlari. */
  notes: string[]
}

export class XmlParseError extends Error {
  /** Hatanin metindeki satiri; editorde isaretlemek icin. */
  readonly line: number
  constructor(message: string, line: number) {
    super(message)
    this.name = 'XmlParseError'
    this.line = line
  }
}

/** Metin XML'e mi benziyor; JSON ayristirmasi basarisiz oldugunda sorulur. */
export function looksLikeXml(text: string): boolean {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<')) return false
  // `<` ile baslayip kapanan bir etiketi olan her sey aday sayilir.
  return /^<(\?xml|!--|!DOCTYPE|[A-Za-z_])/.test(trimmed)
}

interface XmlNode {
  name: string
  attributes: Array<{ name: string; value: string }>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    const named = ENTITIES[body]
    return named ?? match
  })
}

function localName(name: string, keepPrefixes: boolean): string {
  if (keepPrefixes) return name
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

/** Adin ad alani oneki var mi; not yalnizca gercekten atildiysa yazilir. */
function hasPrefix(name: string): boolean {
  return name.includes(':')
}

/** XML metnini agaca cevirir. Bicimsel dogrulama degil, pratik ayristirma. */
export function parseXml(text: string): XmlNode {
  let i = 0
  const n = text.length
  const stack: XmlNode[] = []
  let root: XmlNode | null = null

  const lineAt = (offset: number) => {
    let line = 1
    for (let k = 0; k < offset && k < n; k++) {
      if (text.charCodeAt(k) === 10) line++
    }
    return line
  }

  const fail = (message: string, offset: number): never => {
    throw new XmlParseError(message, lineAt(offset))
  }

  while (i < n) {
    const open = text.indexOf('<', i)
    if (open === -1) break

    // Etiketler arasindaki metin, icinde bulundugumuz elemana yazilir.
    if (open > i && stack.length > 0) {
      const chunk = text.slice(i, open)
      if (chunk.trim()) stack[stack.length - 1].text += decodeEntities(chunk)
    }

    // Yorum, CDATA, isleme yonergesi ve DOCTYPE atlanir (CDATA metne girer).
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9)
      const body = text.slice(open + 9, end === -1 ? n : end)
      if (stack.length > 0) stack[stack.length - 1].text += body
      i = end === -1 ? n : end + 3
      continue
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (text.startsWith('<!', open)) {
      const end = text.indexOf('>', open + 2)
      i = end === -1 ? n : end + 1
      continue
    }

    // Kapanis etiketi
    if (text.startsWith('</', open)) {
      const end = text.indexOf('>', open + 2)
      if (end === -1) fail('Kapanış etiketi tamamlanmamış', open)
      const name = text.slice(open + 2, end).trim()
      const current = stack.pop()
      if (!current) fail(`Fazladan kapanış etiketi: </${name}>`, open)
      else if (current.name !== name) {
        fail(`Etiketler eşleşmiyor: <${current.name}> ... </${name}>`, open)
      }
      i = end + 1
      continue
    }

    // Acilis etiketi: adi ve ozellikleri oku
    let cursor = open + 1
    while (cursor < n && !/[\s/>]/.test(text[cursor])) cursor++
    const name = text.slice(open + 1, cursor)
    if (!name) fail('Etiket adı boş', open)

    const attributes: Array<{ name: string; value: string }> = []
    let selfClosing = false

    for (;;) {
      while (cursor < n && /\s/.test(text[cursor])) cursor++
      if (cursor >= n) fail(`<${name}> etiketi kapanmamış`, open)
      if (text[cursor] === '>') { cursor++; break }
      if (text.startsWith('/>', cursor)) { selfClosing = true; cursor += 2; break }

      const attrStart = cursor
      while (cursor < n && !/[\s=/>]/.test(text[cursor])) cursor++
      const attrName = text.slice(attrStart, cursor)
      while (cursor < n && /\s/.test(text[cursor])) cursor++
      if (text[cursor] !== '=') {
        // Degeri olmayan ozellik: bos string kabul edilir.
        if (attrName) attributes.push({ name: attrName, value: '' })
        continue
      }
      cursor++ // =
      while (cursor < n && /\s/.test(text[cursor])) cursor++
      const quote = text[cursor]
      if (quote !== '"' && quote !== "'") fail(`${attrName} özniteliğinin değeri tırnaksız`, cursor)
      const valueEnd = text.indexOf(quote, cursor + 1)
      if (valueEnd === -1) fail(`${attrName} özniteliğinin tırnağı kapanmamış`, cursor)
      attributes.push({ name: attrName, value: decodeEntities(text.slice(cursor + 1, valueEnd)) })
      cursor = valueEnd + 1
    }

    const node: XmlNode = { name, attributes, children: [], text: '' }
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else if (root) fail(`Belgede ikinci bir kök eleman var: <${name}>`, open)
    else root = node

    if (!selfClosing) stack.push(node)
    i = cursor
  }

  if (stack.length > 0) {
    throw new XmlParseError(`<${stack[stack.length - 1].name}> etiketi kapanmamış`, 0)
  }
  if (!root) throw new XmlParseError('Belgede eleman bulunamadı', 1)
  return root
}

/** Sayi/dogruluk cikarimi; yalnizca `numbers` acikken kullanilir. */
function coerce(text: string): JsonValue {
  if (text === 'true') return true
  if (text === 'false') return false
  // Basinda sifir olan ya da cok uzun sayilar bilincli olarak metin kalir.
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(text)) return Number(text)
  return text
}

export function xmlToJson(text: string, options: XmlToJsonOptions = {}): XmlToJsonResult {
  const keepPrefixes = options.keepPrefixes === true
  const root = parseXml(text)
  const notes: string[] = []
  let droppedNamespaces = 0
  let droppedPrefixes = 0
  let attributeCount = 0
  let mixedContent = 0

  function convert(node: XmlNode): JsonValue {
    const attributes = node.attributes.filter((attribute) => {
      const isNamespace = attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')
      if (isNamespace && !keepPrefixes) {
        droppedNamespaces++
        return false
      }
      return true
    })

    const trimmedText = node.text.trim()

    // Yalnizca metin: eleman dogrudan degere iner.
    if (node.children.length === 0 && attributes.length === 0) {
      if (!trimmedText) return ''
      return options.numbers ? coerce(trimmedText) : trimmedText
    }

    const out: JsonObject = {}
    for (const attribute of attributes) {
      attributeCount++
      const key = `@${localName(attribute.name, keepPrefixes)}`
      out[key] = options.numbers ? coerce(attribute.value) : attribute.value
    }
    if (trimmedText) {
      if (node.children.length > 0) mixedContent++
      out['#text'] = options.numbers ? coerce(trimmedText) : trimmedText
    }

    for (const child of node.children) {
      if (!keepPrefixes && hasPrefix(child.name)) droppedPrefixes++
      const key = localName(child.name, keepPrefixes)
      const value = convert(child)
      const existing = out[key]
      if (existing === undefined) {
        out[key] = value
        continue
      }
      // Ikinci kardeste diziye cevriliyor: tek geciste tekrar bilinemez.
      if (Array.isArray(existing)) existing.push(value)
      else out[key] = [existing, value]
    }
    return out
  }

  if (!keepPrefixes && hasPrefix(root.name)) droppedPrefixes++
  const rootName = localName(root.name, keepPrefixes)
  const data: JsonObject = { [rootName]: convert(root) }

  if (droppedNamespaces > 0) {
    notes.push(`${droppedNamespaces} ad alanı bildirimi (xmlns) atıldı`)
  }
  if (droppedPrefixes > 0) {
    notes.push(`${droppedPrefixes} elemanda ad alanı öneki atıldı (iata:Order → Order)`)
  }
  if (attributeCount > 0) notes.push(`${attributeCount} öznitelik "@ad" olarak eklendi`)
  if (mixedContent > 0) notes.push(`${mixedContent} elemanda hem metin hem çocuk var; metin "#text" oldu`)
  if (!options.numbers) notes.push('değerler metin olarak korundu (kod alanlarındaki baştaki sıfırlar bozulmasın)')

  return { data, root: rootName, notes }
}
