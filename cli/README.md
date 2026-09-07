# jse — JSON Eyes CLI

Terminalden JSON paylaşma ve inceleme aracı. Ana işi tek satırlık: **JSON ver, salt
okunur paylaşım linki al.**

```bash
$ jse share siparis.json --title "OrderViewRS canlı"
https://json-eyes.vercel.app/?s=4bK9zQ1x
```

Link `stdout`'a, geri kalan her şey `stderr`'e yazılır; boru hattında rahat kullanılır:

```bash
jse share siparis.json | pbcopy                  # linki panoya al
LINK=$(jse share siparis.json -q) && echo $LINK  # değişkene al
curl -s https://api.ornek.com/order | jse share -  # doğrudan API çıktısını paylaş
```

## Kurulum

```bash
npm install -g json-eyes     # jse komutu PATH'e girer
jse help
```

Tek seferlik kullanım için kurmadan da çalışır:

```bash
npx json-eyes share veri.json
```

Node 18+ gerekir. Komut adı `jse`; 2015'ten kalma başka bir `jse` paketiyle çakışma
ihtimaline karşı aynı araç `json-eyes` adıyla da çağrılabilir.

### Kaynaktan

```bash
git clone https://github.com/osmanasaf/json-eyes.git
cd json-eyes/cli
npm install        # dist/jse.mjs otomatik derlenir (prepare)
npm link           # `jse` komutu PATH'e girer
```

Global kurulum istemiyorsanız:

```bash
node ~/json-eyes/cli/dist/jse.mjs share veri.json
alias jse='node ~/json-eyes/cli/dist/jse.mjs'    # ~/.zshrc veya ~/.bashrc
```

Kaldırmak için: `npm uninstall -g json-eyes` (kaynaktan kurduysanız `npm unlink -g json-eyes`).

## Backend adresi

Paylaşım komutları (`share`, `fetch`) backend'e gider; inceleme komutları
(`values`, `find`, `get`, `fix`) tamamen yereldir, ağ kullanmaz.

Kurulumdan sonra ayar gerekmez: üretim backend'i gömülü gelir. Kendi kurulumunuza
yönlendirmek isterseniz:

```bash
jse config set api http://localhost:8080          # yerel backend
jse config set web https://kendi-adresiniz.com    # linklerin ön yüz tabanı
jse config show
```

Sıra: `--api` > `JSON_EYES_API` > yapılandırma dosyası
(`~/.config/json-eyes/config.json`) > gömülü üretim adresi.

`web` isteğe bağlıdır: verilmezse sunucunun döndürdüğü link kullanılır. Backend'in
`jsonsarp.public-base-url` ayarı eksikse sunucu localhost gösteren bir link üretir;
CLI bunu uyarı olarak söyler, `--web` ile düzeltebilirsiniz.

### Şifresiz bağlantı uyarısı

Üretim backend'i şu an düz HTTP üzerinden yayında: Coolify'ın verdiği `*.sslip.io`
alan adında HTTPS çalışmıyor (Let's Encrypt bu ortak alan adına rate limit
uyguluyor — ayrıntı: deponun kök README'sindeki "Alan adı ve HTTPS"). Bu yüzden
`jse share` gönderdiğiniz JSON'u açık metin olarak iletir ve CLI her seferinde
bunu söyler:

```
uyarı Bağlantı şifresiz (…sslip.io): gönderilen JSON yolda açık metin gider.
```

Hassas veri paylaşıyorsanız backend'i kendi alan adınıza taşıyıp (`https://`)
`jse config set api https://…` demeniz gerekir. Uyarı yerel adreslerde
(localhost/127.0.0.1) çıkmaz.

## Komutlar

| Komut | İş |
|---|---|
| `share <dosya\|->` | JSON'u paylaşır, linki basar. `--title`, `--no-comments`, `--web`, `--open`, `--json`, `--fix`, `-q` |
| `fetch <id\|link>` | Paylaşılan JSON'u indirir. `--out`, `--minify`, `--meta` |
| `values <dosya> <yol>` | Alanın belge genelindeki dağılımı. `--json`, `--limit` |
| `find <dosya> <terim>` | Terimi taşıyan yolları listeler. `--values`, `--limit`, `--json` |
| `get <dosya> <yol>` | Yoldaki değeri yazar. `--raw`, `--minify` |
| `fix <dosya>` | Yorum / fazla virgül / tek tırnak onarır. `--out`, `--minify` |
| `config show\|set` | Adresleri gösterir ve kaydeder |

### Yol yazımı

Kökten başlayan tam zinciri yazmak zorunda değilsiniz; kuyruk yeterlidir. Birden fazla
alan eşleşirse CLI adayları listeler.

```bash
jse values siparis.json StatusCode                      # kuyruk
jse values siparis.json Response.Order.StatusCode       # daha belirgin
jse get   siparis.json 'Order[0].TotalPrice.CurCode'    # köşeli parantez de olur
```

### Örnek çıktı

```
$ jse values siparis.json StatusCode
IATA_OrderViewRS.Response.Order.StatusCode
1.200 kayıtta geçiyor · 4 farklı değer · 0 kayıtta alan yok

DEĞER      ADET
CANCELLED   300  ██████████████
CLOSED      300  ██████████████
OPEN        300  ██████████████
PENDING     300  ██████████████
```

## Çıkış kodları

| Kod | Anlamı |
|---|---|
| 0 | başarılı |
| 1 | sonuç yok (`find` eşleşme bulamadı) veya beklenmeyen hata |
| 2 | kullanım hatası: geçersiz JSON, bulunamayan yol, ulaşılamayan backend, bilinmeyen seçenek |

## Geliştirme

```bash
npm run build      # esbuild ile tek dosya (~34 KB); npm install bunu kendisi çağırır
npm run typecheck
npm test           # CLI'yi derlenmiş haliyle, sahte bir API sunucusuna karşı koşar
```

Yayınlama (paket sahibi için):

```bash
npm login
npm publish        # prepublishOnly: derleme + tip kontrolü + testler geçmeden yayınlanmaz
```

Ayrıştırma, arama, alan dağılımı ve JSON onarımı `frontend/src/utils/` altındaki saf
TypeScript modüllerinden geliyor — tarayıcıda gördüğünüz sayılarla terminalde
gördükleriniz aynı kod yolundan çıkıyor. (Bu paylaşım şimdilik doğrudan içe alma ile
yapılıyor; npm'e çıkarken `packages/core` + `packages/cli` ayrımına taşınmalı.)
