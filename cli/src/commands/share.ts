import { execFile } from 'node:child_process'
import { countNodes } from '../../../frontend/src/utils/json'
import { createShare } from '../api'
import { flagBool, flagString, type ParsedArgs } from '../args'
import { insecureNotice, resolveApi, shareUrl } from '../config'
import { loadJson, readInput } from '../input'
import { UserError, color, info, out, warn } from '../output'

export const SHARE_FLAGS = ['title', 't', 'api', 'web', 'no-comments', 'open', 'json', 'quiet', 'q', 'fix']

/**
 * `jse share <dosya>` — CLI'nin ana isi: JSON'u backend'e yazip salt okunur
 * paylasim linkini basar.
 *
 * Linkin stdout'a tek basina yazilmasi bilincli: `jse share x.json | pbcopy`
 * ya da `LINK=$(jse share x.json)` calissin diye butun bilgi mesajlari stderr'e
 * gidiyor.
 */
export async function shareCommand(args: ParsedArgs): Promise<number> {
  const quiet = flagBool(args, 'quiet', 'q')
  const asJson = flagBool(args, 'json')
  const { text, name } = await readInput(args.positional[0])
  const loaded = loadJson(text, name, flagBool(args, 'fix'))

  const resolved = resolveApi(flagString(args, 'api'))
  const web = flagString(args, 'web') ?? resolved.web

  const bytes = Buffer.byteLength(JSON.stringify(loaded.data), 'utf8')
  if (!quiet && !asJson) {
    info(`${color.dim('gönderiliyor')} ${name} · ${formatBytes(bytes)} · ${countNodes(loaded.data).toLocaleString('tr-TR')} node → ${resolved.api}`)
  }

  const insecure = insecureNotice(resolved.api)
  if (insecure && !quiet && !asJson) warn(insecure)

  const title = flagString(args, 'title', 't')
  const response = await createShare(resolved.api, loaded.data, {
    title,
    commentsEnabled: !flagBool(args, 'no-comments'),
  })

  const url = shareUrl(response.url, response.id, web)

  if (asJson) {
    out(JSON.stringify({ id: response.id, url, bytes, title: title ?? null }, null, 2))
  } else {
    out(url)
    if (!quiet) {
      info(`${color.green('paylaşıldı')} ${color.dim(`id ${response.id}`)} · salt okunur · 60 gün saklanır`)
      // Sunucunun kendi taban adresi yanlis yapilandirilmissa link ise yaramaz;
      // sessizce yanlis link vermek yerine uyariyoruz.
      if (!web && /localhost|127\.0\.0\.1/.test(url) && !/localhost|127\.0\.0\.1/.test(resolved.api)) {
        warn('Link localhost gösteriyor: backend `jsonsarp.public-base-url` ayarı eksik. --web ile taban adresi verebilirsiniz.')
      }
    }
  }

  if (flagBool(args, 'open')) openInBrowser(url)
  return 0
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Isletim sistemine gore tarayicida acar; basarisiz olursa sessiz kalir. */
function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open'
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  execFile(command, commandArgs, (error) => {
    if (error) warn(`Tarayıcı açılamadı: ${error.message}`)
  })
}

/** `jse fetch <id|link>` yardimi icin ortak dogrulama. */
export function requireArgument(value: string | undefined, what: string): string {
  if (!value) throw new UserError(`${what} verilmedi.`)
  return value
}
