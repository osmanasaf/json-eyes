# jse — JSON Eyes CLI

[![npm](https://img.shields.io/npm/v/json-eyes?color=0b7285&label=npm)](https://www.npmjs.com/package/json-eyes)
[![node](https://img.shields.io/node/v/json-eyes?color=0b7285)](https://www.npmjs.com/package/json-eyes)
[![lisans](https://img.shields.io/npm/l/json-eyes?color=0b7285)](https://github.com/osmanasaf/json-eyes/blob/master/LICENSE)

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
jse xmlshare siparis.xml                         # XML ver, JSON linki al
```

## Kurulum

```bash
npm install -g json-eyes     # jse komutu PATH'e girer
jse help
```

Paket: [npmjs.com/package/json-eyes](https://www.npmjs.com/package/json-eyes)

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
| `share <dosya\|->` | JSON'u paylaşır, linki basar. `--title`, `--no-comments`, `--web`, `--open`, `--json`, `--fix`, `--xml`, `-q` |
| `fetch <id\|link>` | Paylaşılan JSON'u indirir. `--out`, `--minify`, `--meta` |
| `values <dosya> <yol>` | Alanın belge genelindeki dağılımı. `--json`, `--limit`, `--xml` |
| `find <dosya> <terim>` | Terimi taşıyan yolları listeler. `--values`, `--limit`, `--json` |
| `get <dosya> <yol>` | Yoldaki değeri yazar. `--raw`, `--minify`, `--xml` |
| `fix <dosya>` | Yorum / fazla virgül / tek tırnak onarır. `--out`, `--minify` |
| `xmlshare <dosya\|->` | **XML ver, paylaşım linki al.** `share` seçenekleri + `--numbers`, `--keep-prefixes` |
| `xml2json <dosya\|->` | XML'i JSON'a çevirir. `--out`, `--minify`, `--numbers`, `--keep-prefixes` |
| `config show\|set` | Adresleri gösterir ve kaydeder |

### XML girdisi

Çeviri **açıkça istenir**: `.xml` uzantısı ya da `--xml` bayrağı. Girdinin içeriğine
bakıp "bu XML'e benziyor" diye tahmin yapılmaz — yanlış tahmin eden bir araç,
kullanıcının anlamadığı bir sonuç üretir. Uzantı ve bayrak kullanıcının açık tercihi.

```bash
jse xmlshare siparis.xml --title "OrderViewRS"   # XML ver, link al
cat siparis.xml | jse xmlshare -                 # boru hattında da bayrak gerekmez
jse xml2json siparis.xml -o siparis.json         # yalnızca çevir
jse share siparis.xml                            # .xml uzantısı da yeter
jse values siparis.xml StatusCode                # aynı şekilde
cat siparis.xml | jse values --xml - StatusCode  # uzantı yoksa bayrak
```

`xmlshare` ile `share`ın farkı niyet: `xmlshare` XML beklediğini adıyla söylüyor,
bu yüzden boru hattında `--xml` gerekmiyor ve çevirim seçenekleri (`--numbers`,
`--keep-prefixes`) burada. JSON verirseniz durur ve `jse share` der.

JSON beklenen bir yerde XML gelirse komut durur ve yolu söyler:
`Bu girdi XML gibi görünüyor: --xml ekleyin ya da jse xml2json kullanın.`

Çevirim kuralları (web arayüzüyle **aynı kod**, dolayısıyla aynı sonuç):

- Ad alanı önekleri atılır (`iata:Order` → `Order`) ve `xmlns` bildirimleri düşer:
  XSD indeksi yerel adlarla kurulu, alan eşleştirmesi ancak böyle tutar.
  `--keep-prefixes` ile korunur.
- Öznitelikler `@ad`, metin içeriği `#text` olur. Özniteliği ve çocuğu olmayan
  eleman doğrudan değere iner (`<CurCode>EUR</CurCode>` → `"CurCode": "EUR"`).
- Tekrarlayan kardeşler diziye düşer. **Tek öğeli listeler dizi olmaz** — tek
  `<Order>` gelen bir yanıtta `Order` bir nesnedir, tüketen taraf bunu bilmeli.
- **Değerler metin kalır.** `0123` sayıya çevrilse baştaki sıfır giderdi; uçuş
  numarası, havayolu ve bilet kodları bu yüzden bozulur. Sayı istiyorsanız
  `--numbers` (o modda bile baştaki sıfırlı değerler metin kalır).
- CDATA, yorum, `<!DOCTYPE>`, XML bildirimi ve varlıklar (`&amp;`, `&#65;`)
  desteklenir. Bozuk XML satır numarasıyla hata verir.

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
npm test           # önce derler (pretest), sonra derlenmiş paketi sahte bir API'ye karşı koşar
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
