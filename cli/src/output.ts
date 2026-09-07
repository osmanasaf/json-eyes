/**
 * Terminal cikti yardimcilari.
 *
 * Kural: stdout yalnizca komutun *sonucunu* tasir (paylasim linki, JSON, tablo);
 * bilgi ve uyarilar stderr'e gider. Boylece `jse share x.json | pbcopy` calisir,
 * boru hattina bilgi mesaji karismaz.
 */

const colorEnabled = process.stdout.isTTY === true
  && process.env.NO_COLOR === undefined
  && process.env.TERM !== 'dumb'

function wrap(code: string, text: string): string {
  return colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text
}

export const color = {
  bold: (text: string) => wrap('1', text),
  dim: (text: string) => wrap('2', text),
  red: (text: string) => wrap('31', text),
  green: (text: string) => wrap('32', text),
  yellow: (text: string) => wrap('33', text),
  blue: (text: string) => wrap('36', text),
  purple: (text: string) => wrap('35', text),
}

/** Sonuc: stdout. */
export function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

/** Bilgi: stderr. */
export function info(line: string): void {
  process.stderr.write(`${line}\n`)
}

export function warn(line: string): void {
  process.stderr.write(`${color.yellow('uyarı')} ${line}\n`)
}

/** Kullanicinin yaptigi bir hata; yigin izi basmadan cikilir. */
export class UserError extends Error {
  readonly hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'UserError'
    this.hint = hint
  }
}

export function printError(error: unknown): void {
  if (error instanceof UserError) {
    process.stderr.write(`${color.red('hata')} ${error.message}\n`)
    if (error.hint) process.stderr.write(`${color.dim(error.hint)}\n`)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${color.red('hata')} ${message}\n`)
}

/** Sabit genislikli tablo; sayisal kolonlar saga yaslanir. */
export function table(
  headers: string[],
  rows: string[][],
  align: Array<'left' | 'right'> = [],
): string {
  const widths = headers.map((header, index) =>
    Math.max(visibleLength(header), ...rows.map(row => visibleLength(row[index] ?? ''))),
  )
  const pad = (text: string, index: number) => {
    const space = ' '.repeat(Math.max(0, widths[index] - visibleLength(text)))
    return align[index] === 'right' ? space + text : text + space
  }
  const lines = [
    headers.map((header, index) => color.dim(pad(header, index))).join('  '),
    ...rows.map(row => row.map((cell, index) => pad(cell ?? '', index)).join('  ')),
  ]
  return lines.join('\n')
}

/** ANSI kodlarini saymayan uzunluk. */
function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, '').length
}

/** Terminal genisligine sigacak sekilde kirpar. */
export function clip(text: string, max: number): string {
  const single = text.replace(/\r?\n/g, ' ↵ ')
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}
