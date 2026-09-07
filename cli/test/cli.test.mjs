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
  const warned = await run(['share', samplePath, '--api', 'http://ornek-backend.test/api'])
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
