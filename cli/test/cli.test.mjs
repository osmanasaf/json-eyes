/**
 * CLI testleri. Derlenmis pakete (dist/jse.mjs) karsi cocuk surec olarak
 * kosuyorlar: sinanan sey kullanicinin gerektigi gibi cagirdigi arayuz —
 * argumanlar, cikis kodlari ve stdout/stderr ayrimi.
 *
 * Paylasim komutu icin gercek backend yerine kucuk bir sahte sunucu ayaga
 * kalkiyor; boylece testler ag ve veritabani olmadan calisiyor.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'jse.mjs')
const workDir = mkdtempSync(join(tmpdir(), 'jse-test-'))

const SAMPLE = {
  IATA_OrderViewRS: {
    Response: {
      Order: [
        {
          OrderID: 'ORD1',
          StatusCode: 'OPEN',
          TotalPrice: { TotalAmount: 100, CurCode: 'EUR' },
          OrderItem: [{ Price: { BaseAmount: 40, CurCode: 'EUR' } }],
        },
        { OrderID: 'ORD2', StatusCode: 'CLOSED', TotalPrice: { TotalAmount: 250, CurCode: 'TRY' } },
        // Ucuncu siparisin TotalPrice'i hic yok: "alan yok" sayimini sinar.
        { OrderID: 'ORD3', StatusCode: 'OPEN' },
      ],
    },
  },
}

const samplePath = join(workDir, 'ornek.json')
writeFileSync(samplePath, JSON.stringify(SAMPLE, null, 2))

const brokenPath = join(workDir, 'bozuk.json')
writeFileSync(brokenPath, '{\n  // yorum\n  "a": 1,\n}\n')

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<iata:IATA_OrderViewRS xmlns:iata="http://iata.org/ndc" Version="21.3">
  <Response>
    <Order><OrderID>ORD1</OrderID><StatusCode>OPEN</StatusCode><FlightNumber>0123</FlightNumber></Order>
    <Order><OrderID>ORD2</OrderID><StatusCode>CLOSED</StatusCode><FlightNumber>0456</FlightNumber></Order>
    <Warning Code="100">Kısmi &amp; uyarı</Warning>
  </Response>
</iata:IATA_OrderViewRS>`
const xmlPath = join(workDir, 'ornek.xml')
writeFileSync(xmlPath, XML)

const brokenXmlPath = join(workDir, 'bozuk.xml')
writeFileSync(brokenXmlPath, '<a><b>x</c></a>')

/**
 * CLI'yi cocuk surec olarak kosar. stdin her durumda kapatiliyor: acik
 * birakildiginda boru hattindan okuyan komutlar sonsuza kadar bekler
 * (execFile'in `input` secenegi yok, bu yuzden spawn kullaniliyor).
 */
function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, NO_COLOR: '1', XDG_CONFIG_HOME: join(workDir, 'config'), ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 0, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })
}

/** Paylasim ucunu taklit eden sunucu; gelen govdeyi de sinamak icin sakliyor. */
async function withMockApi(handler) {
  const received = []
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/shares') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        received.push(JSON.parse(body))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 'testID12', url: 'http://localhost:5173/?s=testID12' }))
      })
      return
    }
    if (req.method === 'GET' && req.url === '/api/shares/testID12') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'testID12', title: 'başlık', commentsEnabled: true,
        json: SAMPLE, createdAt: '2026-09-07T10:00:00Z',
      }))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Paylasim bulunamadi' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const api = `http://127.0.0.1:${server.address().port}/api`
  try {
    await handler(api, received)
  } finally {
    // fetch (undici) baglantiyi canli tutuyor; kapatmadan server.close() bitmez.
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

test('share: stdout yalnizca linki tasir, bilgi stderr\'e gider', async () => {
  await withMockApi(async (api, received) => {
    const result = await run(['share', samplePath, '--api', api, '--title', 'CLI'])
    assert.equal(result.code, 0)
    assert.equal(result.stdout.trim(), 'http://localhost:5173/?s=testID12')
    assert.match(result.stderr, /paylaşıldı/)
    assert.equal(received[0].title, 'CLI')
    assert.equal(received[0].commentsEnabled, true)
    assert.deepEqual(received[0].json, SAMPLE)
  })
})

test('share: --no-comments sunucuya iletilir', async () => {
  await withMockApi(async (api, received) => {
    await run(['share', samplePath, '--api', api, '--no-comments'])
    assert.equal(received[0].commentsEnabled, false)
  })
})

test('share: stdin\'den okur ve --web ile link tabani degisir', async () => {
  await withMockApi(async (api) => {
    const result = await run(['share', '-', '--api', api, '--web', 'https://ornek.com'], {
      input: JSON.stringify(SAMPLE),
    })
    assert.equal(result.stdout.trim(), 'https://ornek.com/?s=testID12')
  })
})

test('share: --json makine okunur cikti verir', async () => {
  await withMockApi(async (api) => {
    const result = await run(['share', samplePath, '--api', api, '--json'])
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.id, 'testID12')
    assert.ok(parsed.bytes > 0)
  })
})

test('share: bozuk JSON hata verir, --fix ile gonderilir', async () => {
  await withMockApi(async (api) => {
    const failed = await run(['share', brokenPath, '--api', api])
    assert.equal(failed.code, 2)
    assert.match(failed.stderr, /geçerli JSON değil/)
    assert.equal(failed.stdout, '')

    const fixed = await run(['share', brokenPath, '--api', api, '--fix'])
    assert.equal(fixed.code, 0)
    assert.equal(fixed.stdout.trim(), 'http://localhost:5173/?s=testID12')
  })
})

test('fetch: kimlik ve link ayni sonucu verir, --meta ust bilgiyi doner', async () => {
  await withMockApi(async (api) => {
    const byId = await run(['fetch', 'testID12', '--api', api])
    assert.deepEqual(JSON.parse(byId.stdout), SAMPLE)

    const byUrl = await run(['fetch', 'https://ornek.com/?s=testID12', '--api', api])
    assert.deepEqual(JSON.parse(byUrl.stdout), SAMPLE)

    const meta = await run(['fetch', 'testID12', '--api', api, '--meta'])
    assert.equal(JSON.parse(meta.stdout).title, 'başlık')
  })
})

test('fetch: bulunamayan paylasim 2 ile cikar', async () => {
  await withMockApi(async (api) => {
    const result = await run(['fetch', 'yokYok12', '--api', api])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /Paylaşım bulunamadı/)
  })
})

test('values: dagilim ve eksik alan sayisi', async () => {
  const result = await run(['values', samplePath, 'StatusCode'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /OPEN\s+2/)
  assert.match(result.stdout, /CLOSED\s+1/)
})

test('values: --json cikti sayilari tasir', async () => {
  const result = await run(['values', samplePath, 'TotalAmount', '--json'])
  const stats = JSON.parse(result.stdout)
  assert.equal(stats.total, 2)
  // Ucuncu siparisin TotalPrice'i yok: eksik kayit sayilir.
  assert.equal(stats.missing, 1)
  assert.equal(stats.numeric.sum, 350)
})

test('values: belirsiz yol adaylari listeler', async () => {
  const result = await run(['values', samplePath, 'CurCode'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /birden fazla alan ile eşleşiyor/)
  assert.match(result.stderr, /TotalPrice\.CurCode/)
  assert.match(result.stderr, /OrderItem\.Price\.CurCode/)
})

test('values: kapsayici alan da ozetlenir', async () => {
  const result = await run(['values', samplePath, 'Response.Order'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /3 öğe/)
})

test('find: eslesen yollari verir, eslesme yoksa 1 doner', async () => {
  const hit = await run(['find', samplePath, 'ORD2', '--values'])
  assert.equal(hit.code, 0)
  assert.match(hit.stdout, /Order\.1\.OrderID/)

  const miss = await run(['find', samplePath, 'YOKBOYLEBIRSEY'])
  assert.equal(miss.code, 1)
})

test('get: tam yol, kuyruk yolu ve --raw', async () => {
  const full = await run(['get', samplePath, 'IATA_OrderViewRS.Response.Order.0.OrderID'])
  assert.equal(full.stdout.trim(), '"ORD1"')

  const tail = await run(['get', samplePath, 'Order.1.StatusCode', '--raw'])
  assert.equal(tail.stdout.trim(), 'CLOSED')

  const ambiguous = await run(['get', samplePath, 'OrderID'])
  assert.equal(ambiguous.code, 2)
  assert.match(ambiguous.stderr, /birden fazla/)
})

test('fix: onarilmis JSON basar', async () => {
  const result = await run(['fix', brokenPath])
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout), { a: 1 })
})

test('bilinmeyen komut ve secenek anlatan hata verir', async () => {
  const command = await run(['paylas', samplePath])
  assert.equal(command.code, 2)
  assert.match(command.stderr, /Bilinmeyen komut/)

  const flag = await run(['share', samplePath, '--titel', 'x'])
  assert.equal(flag.code, 2)
  assert.match(flag.stderr, /bilinmeyen seçenek/)
})

test('fazladan arguman sessizce yutulmaz', async () => {
  // Windows oturumunda `jse share veri.json statusCode` yazildiginda ikinci
  // arguman atiliyordu; kullanici muhtemelen `jse values` demek istiyor.
  const result = await run(['share', samplePath, 'StatusCode'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /argüman alır/)
  assert.equal(result.stdout, '')

  const ok = await run(['values', samplePath, 'StatusCode'])
  assert.equal(ok.code, 0)
})

test('xml2json: XML JSON\'a cevrilir, oznitelik ve kod alanlari korunur', async () => {
  const result = await run(['xml2json', xmlPath])
  assert.equal(result.code, 0)
  const data = JSON.parse(result.stdout)
  assert.deepEqual(data, {
    IATA_OrderViewRS: {
      '@Version': '21.3',
      Response: {
        Order: [
          { OrderID: 'ORD1', StatusCode: 'OPEN', FlightNumber: '0123' },
          { OrderID: 'ORD2', StatusCode: 'CLOSED', FlightNumber: '0456' },
        ],
        // Oznitelikli eleman: metin #text'e iner.
        Warning: { '@Code': '100', '#text': 'Kısmi & uyarı' },
      },
    },
  })
  // Cevirim notlari stderr'e; stdout yalnizca JSON tasir.
  assert.match(result.stderr, /kök <IATA_OrderViewRS>/)
})

test('xml2json: --numbers acikca istenmedikce sayi cikarimi yapilmaz', async () => {
  const asText = JSON.parse((await run(['xml2json', xmlPath, '-q'])).stdout)
  assert.equal(asText.IATA_OrderViewRS['@Version'], '21.3')

  const asNumber = JSON.parse((await run(['xml2json', xmlPath, '--numbers', '-q'])).stdout)
  assert.equal(asNumber.IATA_OrderViewRS['@Version'], 21.3)
  // Bastaki sifir sayiya cevrilmemeli: kod alanlari bozulmasin.
  assert.equal(asNumber.IATA_OrderViewRS.Response.Order[0].FlightNumber, '0123')
})

test('xml2json: --keep-prefixes ad alani oneklerini korur', async () => {
  const kept = JSON.parse((await run(['xml2json', xmlPath, '--keep-prefixes', '-q'])).stdout)
  assert.ok(Object.prototype.hasOwnProperty.call(kept, 'iata:IATA_OrderViewRS'))
})

test('share: XML dosyasi verilince cevrilip paylasilir', async () => {
  await withMockApi(async (api, received) => {
    const result = await run(['share', xmlPath, '--api', api])
    assert.equal(result.code, 0)
    assert.equal(result.stdout.trim(), 'http://localhost:5173/?s=testID12')
    assert.match(result.stderr, /XML çevrildi/)
    // Sunucuya giden govde cevrilmis JSON olmali.
    assert.equal(received[0].json.IATA_OrderViewRS.Response.Order.length, 2)
    assert.equal(received[0].json.IATA_OrderViewRS.Response.Order[0].OrderID, 'ORD1')
  })
})

test('inceleme komutlari da XML girdisini kabul eder', async () => {
  const values = await run(['values', xmlPath, 'StatusCode'])
  assert.equal(values.code, 0)
  assert.match(values.stdout, /OPEN\s+1/)
  assert.match(values.stdout, /CLOSED\s+1/)

  const got = await run(['get', xmlPath, 'Order.0.OrderID', '--raw'])
  assert.equal(got.stdout.trim(), 'ORD1')
})

test('xmlshare: XML ver, paylasim linki al', async () => {
  await withMockApi(async (api, received) => {
    const result = await run(['xmlshare', xmlPath, '--api', api, '--title', 'OrderViewRS (XML)'])
    assert.equal(result.code, 0)
    // stdout yalnizca link: `LINK=$(jse xmlshare x.xml -q)` calissin.
    assert.equal(result.stdout.trim(), 'http://localhost:5173/?s=testID12')
    assert.match(result.stderr, /XML çevrildi/)
    assert.equal(received[0].title, 'OrderViewRS (XML)')
    assert.equal(received[0].json.IATA_OrderViewRS.Response.Order.length, 2)
    // Kod alanlari metin kalir: 0123 sayiya cevrilse bastaki sifir giderdi.
    assert.equal(received[0].json.IATA_OrderViewRS.Response.Order[0].FlightNumber, '0123')
  })
})

test('xmlshare: boru hattinda bayrak gerekmez, niyet komut adinda', async () => {
  await withMockApi(async (api, received) => {
    const result = await run(['xmlshare', '-', '--api', api, '-q'], { input: XML })
    assert.equal(result.code, 0)
    assert.equal(result.stdout.trim(), 'http://localhost:5173/?s=testID12')
    // -q ile bilgi satirlari da susuyor.
    assert.equal(result.stderr, '')
    assert.equal(received[0].json.IATA_OrderViewRS.Response.Order[0].OrderID, 'ORD1')
  })
})

test('xmlshare: --numbers ve --keep-prefixes cevirime geciyor', async () => {
  await withMockApi(async (api, received) => {
    await run(['xmlshare', xmlPath, '--api', api, '--numbers', '--keep-prefixes', '-q'])
    const root = received[0].json['iata:IATA_OrderViewRS']
    assert.ok(root, 'ad alani oneki korunmali')
    // --numbers acikken bile bastaki sifirli deger metin kalir.
    assert.equal(root.Response.Order[0].FlightNumber, '0123')
    assert.equal(root.Response.Warning['@Code'], 100)
  })
})

test('xmlshare: JSON verilirse dogru komutu soyler', async () => {
  const result = await run(['xmlshare', samplePath])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /XML değil/)
  assert.match(result.stderr, /jse share/)
  assert.equal(result.stdout, '')
})

test('xmlshare: bozuk XML satir numarasiyla durur, sunucuya gitmez', async () => {
  await withMockApi(async (api, received) => {
    const result = await run(['xmlshare', brokenXmlPath, '--api', api])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /XML ayrıştırılamadı \(satır 1\)/)
    assert.equal(received.length, 0)
  })
})

test('XML icerigi kendiliginden cevrilmez; --xml ile cevrilir', async () => {
  // Uzantisi .json olan bir dosyanin icine XML koyuyoruz: arac icerige bakip
  // karar vermemeli, kullaniciya yolu soylemeli.
  const gizliXml = join(workDir, 'gizli.json')
  writeFileSync(gizliXml, XML)

  const guessed = await run(['values', gizliXml, 'StatusCode'])
  assert.equal(guessed.code, 2)
  assert.match(guessed.stderr, /XML gibi görünüyor/)
  assert.match(guessed.stderr, /--xml/)

  const asked = await run(['values', gizliXml, 'StatusCode', '--xml'])
  assert.equal(asked.code, 0)
  assert.match(asked.stdout, /OPEN\s+1/)

  // Boru hattinda uzanti yok; bayrak tek yol.
  const piped = await run(['get', '-', 'Order.0.OrderID', '--raw', '--xml'], { input: XML })
  assert.equal(piped.stdout.trim(), 'ORD1')
})

test('bozuk XML satir numarasiyla hata verir', async () => {
  const result = await run(['xml2json', brokenXmlPath])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /XML ayrıştırılamadı \(satır 1\)/)
  assert.equal(result.stdout, '')
})

test('yardim ve surum', async () => {
  const help = await run(['help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /PAYLAŞIM/)

  const version = await run(['--version'])
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)
})

test('varsayilan adres uretim backend\'i ve duz HTTP uyarisi cikiyor', async () => {
  // Yapilandirma ve ortam degiskeni olmadan: gomulu uretim adresi kullanilmali.
  const show = await run(['config', 'show'], { env: { XDG_CONFIG_HOME: join(workDir, 'bos-config') } })
  assert.match(show.stdout, /^api\s+http:\/\/\S+\/api\s+\(default\)/m)

  // Duz HTTP ile konusuluyorsa kullanici uyarilmali (yerel adresler haric).
  // Adres 127.0.0.2: DNS'e gitmedigi icin baglanti aninda reddediliyor ama
  // "yerel" listesinde (localhost/127.0.0.1/::1) olmadigi icin uyari cikiyor.
  // Onceden `ornek-backend.test` kullaniliyordu; Windows'ta DNS arama
  // sonekleriyle ugrasip testi 12 saniye bekletiyordu.
  const warned = await run(['share', samplePath, '--api', 'http://127.0.0.2:9/api'])
  assert.match(warned.stderr, /şifresiz/)

  const local = await run(['share', samplePath, '--api', 'http://localhost:9/api'])
  assert.doesNotMatch(local.stderr, /şifresiz/)
})

test('config: yazip geri okur, env dosyayi ezer', async () => {
  const set = await run(['config', 'set', 'api', 'https://api.ornek.com'])
  assert.equal(set.code, 0)

  const show = await run(['config', 'show'])
  assert.match(show.stdout, /https:\/\/api\.ornek\.com\/api\s+\(config\)/)

  const env = await run(['config', 'show'], { env: { JSON_EYES_API: 'http://localhost:8080/api' } })
  assert.match(env.stdout, /localhost:8080\/api\s+\(env\)/)

  const invalid = await run(['config', 'set', 'api', 'ornek.com'])
  assert.equal(invalid.code, 2)
})
