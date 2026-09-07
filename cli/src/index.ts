import { flagString, parseArgs, unknownFlags, type ParsedArgs } from './args'
import { configPath, normalizeApi, readConfig, resolveApi, writeConfig } from './config'
import { fetchCommand, FETCH_FLAGS } from './commands/fetch'
import {
  findCommand, FIND_FLAGS,
  fixCommand, FIX_FLAGS,
  getCommand, GET_FLAGS,
  valuesCommand, VALUES_FLAGS,
} from './commands/inspect'
import { shareCommand, SHARE_FLAGS } from './commands/share'
import { UserError, color, info, out, printError } from './output'

const VERSION = '0.1.0'

/**
 * Boru hatti erken kapandiginda (`jse find … | head -3`) Node ham bir EPIPE
 * hatasi firlatiyor; kullanicinin gordugu sey yigin izi oluyor. Bir CLI icin
 * dogru davranis sessizce cikmak.
 */
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0)
    throw error
  })
}

const HELP = `${color.bold('jse')} — JSON Eyes komut satırı aracı

${color.bold('KULLANIM')}
  jse <komut> [argümanlar] [--seçenekler]

${color.bold('PAYLAŞIM')}
  share <dosya|->        JSON'u paylaşır, salt okunur linki stdout'a yazar
                         --title <ad>   linkte görünen başlık
                         --no-comments  yorumları kapat
                         --web <adres>  linkin ön yüz tabanı
                         --open         linki tarayıcıda aç
                         --json         {id,url} olarak yaz
                         --fix          bozuk JSON'u onarmayı dene
  fetch <id|link>        paylaşılan JSON'u indirir (--out dosya, --minify, --meta)

${color.bold('İNCELEME')} (yerel, backend gerekmez)
  values <dosya> <yol>   alanın belge genelindeki dağılımı (--json, --limit)
  find <dosya> <terim>   terimi taşıyan yolları listeler (--values, --limit, --json)
  get <dosya> <yol>      yoldaki değeri yazar (--raw, --minify)
  fix <dosya>            yorum/fazla virgül/tek tırnak onarır (--out, --minify)

${color.bold('YAPILANDIRMA')}
  config show            geçerli adresleri ve dosya yolunu gösterir
  config set api <adres> backend adresini kaydeder
  config set web <adres> paylaşım linklerinin ön yüz tabanını kaydeder

${color.bold('ADRES SIRASI')}
  --api > JSON_EYES_API > yapılandırma dosyası > gömülü üretim adresi
  Kendi kurulumunuz için: jse config set api http://localhost:8080

${color.bold('ÖRNEKLER')}
  jse share siparis.json --title "OrderViewRS canlı"
  curl -s https://api.ornek.com/order | jse share - --json
  LINK=$(jse share siparis.json -q) && echo $LINK
  jse values siparis.json Response.Order.StatusCode
  jse find siparis.json PAX42 --values
  jse fetch https://json-eyes.vercel.app/?s=4bK9zQ1x --out kopya.json
`

async function configCommand(args: ParsedArgs): Promise<number> {
  const action = args.positional[0] ?? 'show'
  if (action === 'show') {
    const resolved = resolveApi(flagString(args, 'api'))
    out(`api   ${resolved.api}   ${color.dim(`(${resolved.source})`)}`)
    out(`web   ${resolved.web ?? color.dim('(sunucunun verdiği link kullanılır)')}`)
    out(`dosya ${configPath()}`)
    return 0
  }
  if (action === 'set') {
    const key = args.positional[1]
    const value = args.positional[2]
    if (key !== 'api' && key !== 'web') {
      throw new UserError(`Bilinmeyen ayar: ${key ?? '(yok)'}`, 'Kullanılabilir: api, web')
    }
    if (!value) throw new UserError(`${key} için değer verilmedi.`)
    const config = readConfig()
    const next = { ...config, [key]: key === 'api' ? normalizeApi(value) : value.replace(/\/+$/, '') }
    const path = writeConfig(next)
    info(`${color.green('kaydedildi')} ${key} = ${next[key]}`)
    info(color.dim(path))
    return 0
  }
  throw new UserError(`Bilinmeyen config komutu: ${action}`, 'Kullanılabilir: show, set')
}

interface Command {
  run: (args: ParsedArgs) => Promise<number>
  flags: string[]
  /** Komutun aldigi en fazla konumsal arguman; fazlasi hata. */
  maxPositional: number
  usage: string
}

const COMMANDS: Record<string, Command> = {
  share: { run: shareCommand, flags: SHARE_FLAGS, maxPositional: 1, usage: 'jse share <dosya|->' },
  fetch: { run: fetchCommand, flags: FETCH_FLAGS, maxPositional: 1, usage: 'jse fetch <id|link>' },
  values: { run: valuesCommand, flags: VALUES_FLAGS, maxPositional: 2, usage: 'jse values <dosya> <yol>' },
  find: { run: findCommand, flags: FIND_FLAGS, maxPositional: 2, usage: 'jse find <dosya> <terim>' },
  get: { run: getCommand, flags: GET_FLAGS, maxPositional: 2, usage: 'jse get <dosya> <yol>' },
  fix: { run: fixCommand, flags: FIX_FLAGS, maxPositional: 1, usage: 'jse fix <dosya>' },
  config: { run: configCommand, flags: ['api'], maxPositional: 3, usage: 'jse config show | jse config set <api|web> <adres>' },
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  if (args.flags.has('version') || args.flags.has('V') || args.command === 'version') {
    out(VERSION)
    return 0
  }
  if (!args.command || args.command === 'help' || args.flags.has('help') || args.flags.has('h')) {
    out(HELP)
    return args.command ? 0 : 1
  }

  const entry = COMMANDS[args.command]
  if (!entry) {
    throw new UserError(`Bilinmeyen komut: ${args.command}`, `Komutlar: ${Object.keys(COMMANDS).join(', ')} · yardım için: jse help`)
  }

  // Yazim hatasi olan bir bayragi sessizce yok saymak, kullanicinin istedigi
  // davranisin gerceklestigini sanmasina yol acar; bu yuzden hata veriyoruz.
  const unknown = unknownFlags(args, [...entry.flags, 'help', 'h'])
  if (unknown.length > 0) {
    throw new UserError(
      `${args.command} komutunda bilinmeyen seçenek: ${unknown.map(name => `--${name}`).join(', ')}`,
      `Bu komutun seçenekleri: ${entry.flags.map(name => `--${name}`).join(', ')}`,
    )
  }

  // Fazladan arguman da sessizce yutulmamali: `jse share veri.json StatusCode`
  // yazan kullanici muhtemelen `jse values` demek istiyor; dosyayi paylasip
  // ikinci argumani atmak istedigi sey degil.
  if (args.positional.length > entry.maxPositional) {
    const extra = args.positional.slice(entry.maxPositional)
    throw new UserError(
      `${args.command} komutu ${entry.maxPositional} argüman alır; fazlası: ${extra.join(' ')}`,
      `Kullanım: ${entry.usage}`,
    )
  }

  return await entry.run(args)
}

main()
  .then((code) => { process.exitCode = code })
  .catch((error) => {
    printError(error)
    process.exitCode = error instanceof UserError ? 2 : 1
  })
