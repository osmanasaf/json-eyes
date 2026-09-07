import { flagString, parseArgs, unknownFlags, type ParsedArgs } from './args'
import { configPath, normalizeApi, readConfig, resolveApi, writeConfig } from './config'
import { diffCommand, DIFF_FLAGS } from './commands/diff'
import { fetchCommand, FETCH_FLAGS } from './commands/fetch'
import {
  findCommand, FIND_FLAGS,
  fixCommand, FIX_FLAGS,
  getCommand, GET_FLAGS,
  valuesCommand, VALUES_FLAGS,
} from './commands/inspect'
import { shareCommand, xmlShareCommand, SHARE_FLAGS, XML_SHARE_FLAGS } from './commands/share'
import { xmlCommand, XML_FLAGS } from './commands/xml'
import { UserError, color, info, out, printError } from './output'
import { version as VERSION } from '../package.json'

/*
 * Surum elle yazilmiyordu ve `npm version` yalnizca package.json'i degistirdigi
 * icin `jse --version` yayindan sonra yalan soyluyordu (0.2.0 paketi 0.1.0
 * diyordu). Artik tek kaynak package.json; esbuild derlerken degeri pakete
 * gomuyor, dolayisiyla calisma aninda dosya okuma da yok.
 */

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
                         --xml          girdiyi XML olarak çevir
  xmlshare <dosya|->     XML'i JSON'a çevirip paylaşır: XML ver, link al
                         share seçenekleri + --numbers, --keep-prefixes
  diff <a> <b>           iki JSON'u karşılaştırır, fark linkini basar
                         her iki taraf: dosya, - (stdin) ya da paylaşım linki
                         --local  hiçbir şey gönderme, farkı terminale yaz
                         --json   {url, counts, changes}
                         --exit-code  fark varsa 1 ile çık (CI)
                         --limit <n>  listelenen değişiklik sayısı (varsayılan 10)
                         --open, --title, --no-comments, --web, --xml
  fetch <id|link>        paylaşılan JSON'u indirir (--out dosya, --minify, --meta)

${color.bold('İNCELEME')} (yerel, backend gerekmez)
  values <dosya> <yol>   alanın belge genelindeki dağılımı (--json, --limit, --xml)
  find <dosya> <terim>   terimi taşıyan yolları listeler (--values, --limit, --json)
  get <dosya> <yol>      yoldaki değeri yazar (--raw, --minify, --xml)
  fix <dosya>            yorum/fazla virgül/tek tırnak onarır (--out, --minify)
  xml2json <dosya|->     XML'i JSON'a çevirir (--out, --minify, --numbers, --keep-prefixes)

${color.bold('XML')}
  Çeviri açıkça istenir; üç yolu var:
    jse xmlshare siparis.xml         XML ver, paylaşım linki al
    jse xml2json siparis.xml -o s.json
    jse share siparis.xml            .xml uzantısı yeter
    cat s.xml | jse values --xml - StatusCode
  Girdinin içeriğine bakıp tahmin yapılmaz. Ad alanı önekleri atılır,
  öznitelikler "@ad" olur, değerler metin kalır (baştaki sıfır bozulmasın).

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
  jse diff eski.json yeni.json                     fark linki
  jse diff eski.json 'https://…/?s=4bK9zQ1x'       elindeki link ikinci taraf
  jse diff a.json b.json --local --limit 40        ag yok, terminalde oku
  jse diff a.json b.json --exit-code -q > /dev/null || echo "fark var"
  jse xmlshare siparis.xml --title "OrderViewRS (XML)"
  cat siparis.xml | jse xmlshare - -q
  jse xml2json siparis.xml -o siparis.json
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
  xmlshare: { run: xmlShareCommand, flags: XML_SHARE_FLAGS, maxPositional: 1, usage: 'jse xmlshare <dosya|->' },
  diff: { run: diffCommand, flags: DIFF_FLAGS, maxPositional: 2, usage: 'jse diff <a> <b>' },
  fetch: { run: fetchCommand, flags: FETCH_FLAGS, maxPositional: 1, usage: 'jse fetch <id|link>' },
  values: { run: valuesCommand, flags: VALUES_FLAGS, maxPositional: 2, usage: 'jse values <dosya> <yol>' },
  find: { run: findCommand, flags: FIND_FLAGS, maxPositional: 2, usage: 'jse find <dosya> <terim>' },
  get: { run: getCommand, flags: GET_FLAGS, maxPositional: 2, usage: 'jse get <dosya> <yol>' },
  fix: { run: fixCommand, flags: FIX_FLAGS, maxPositional: 1, usage: 'jse fix <dosya>' },
  xml2json: { run: xmlCommand, flags: XML_FLAGS, maxPositional: 1, usage: 'jse xml2json <dosya|->' },
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
