import { writeFileSync } from 'node:fs'
import { extractShareId, getShare } from '../api'
import { flagBool, flagString, type ParsedArgs } from '../args'
import { resolveApi } from '../config'
import { color, info, out } from '../output'
import { requireArgument } from './share'

export const FETCH_FLAGS = ['api', 'minify', 'out', 'o', 'meta', 'quiet', 'q']

/**
 * `jse fetch <id|link>` — paylasilan JSON'u geri indirir. Paylasim akisinin
 * diger yarisi: bir link elinize geldiginde tarayici acmadan icerigi almak.
 */
export async function fetchCommand(args: ParsedArgs): Promise<number> {
  const target = requireArgument(args.positional[0], 'Paylaşım kimliği veya linki')
  const id = extractShareId(target)
  const resolved = resolveApi(flagString(args, 'api'))
  const share = await getShare(resolved.api, id)

  if (flagBool(args, 'meta')) {
    out(JSON.stringify({
      id: share.id,
      title: share.title,
      commentsEnabled: share.commentsEnabled,
      createdAt: share.createdAt,
    }, null, 2))
    return 0
  }

  const text = flagBool(args, 'minify')
    ? JSON.stringify(share.json)
    : JSON.stringify(share.json, null, 2)

  const outFile = flagString(args, 'out', 'o')
  if (outFile) {
    writeFileSync(outFile, `${text}\n`, 'utf8')
    if (!flagBool(args, 'quiet', 'q')) {
      info(`${color.green('indirildi')} ${outFile} ${color.dim(`(id ${share.id}${share.title ? `, "${share.title}"` : ''})`)}`)
    }
    return 0
  }

  out(text)
  return 0
}
