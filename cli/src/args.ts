/**
 * Kucuk bir argument ayristirici. Bir bagimliligi (commander/yargs) surunmemek
 * icin elle yazildi: CLI'nin ihtiyaci konumsal argumanlar, `--anahtar deger`,
 * `--anahtar=deger` ve `--bayrak`tan ibaret.
 */

export interface ParsedArgs {
  /** Komut adi; hic arguman yoksa undefined. */
  command?: string
  /** Komuttan sonraki konumsal argumanlar. */
  positional: string[]
  flags: Map<string, string | true>
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = []
  const flags = new Map<string, string | true>()

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) {
        flags.set(body.slice(0, eq), body.slice(eq + 1))
        continue
      }
      const next = argv[i + 1]
      // Bir sonraki token deger gibi duruyorsa (tire ile baslamiyorsa) onu al.
      if (next !== undefined && !next.startsWith('-')) {
        flags.set(body, next)
        i++
      } else {
        flags.set(body, true)
      }
      continue
    }
    if (token.startsWith('-') && token.length > 1 && token !== '-') {
      // Kisa bayraklar: -q, -o dosya
      const body = token.slice(1)
      const next = argv[i + 1]
      if (body.length === 1 && next !== undefined && !next.startsWith('-')) {
        flags.set(body, next)
        i++
      } else {
        for (const char of body) flags.set(char, true)
      }
      continue
    }
    positional.push(token)
  }

  const [command, ...rest] = positional
  return { command, positional: rest, flags }
}

export function flagString(args: ParsedArgs, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = args.flags.get(name)
    if (typeof value === 'string') return value
  }
  return undefined
}

export function flagBool(args: ParsedArgs, ...names: string[]): boolean {
  return names.some(name => args.flags.get(name) !== undefined)
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const raw = flagString(args, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Taninmayan bayraklari yakalar: sessizce yok saymak sessiz hatalara yol acar. */
export function unknownFlags(args: ParsedArgs, allowed: string[]): string[] {
  return [...args.flags.keys()].filter(name => !allowed.includes(name))
}
