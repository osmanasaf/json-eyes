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

npm'de yayınlanmadı; kaynaktan kurulur. Node 18+ gerekir.

```bash
git clone https://github.com/osmanasaf/json-eyes.git
cd json-eyes/cli
npm install        # dist/jse.mjs otomatik derlenir (prepare)
npm link           # `jse` komutu PATH'e girer

jse help
```

Depo zaten sizdeyse ilk satırı atlayın. `npm link` sudo isterse ya da global kurulum
istemiyorsanız üç alternatif:

```bash
# 1) doğrudan çağırın
node ~/json-eyes/cli/dist/jse.mjs share veri.json

# 2) kabuk takma adı (~/.zshrc veya ~/.bashrc)
alias jse='node ~/json-eyes/cli/dist/jse.mjs'

# 3) paket olarak global kurulum
cd json-eyes/cli && npm pack && npm install -g ./json-eyes-cli-0.1.0.tgz
```

Kaldırmak için: `npm unlink -g json-eyes-cli` (ya da `npm uninstall -g json-eyes-cli`).

Depoyu güncelledikten sonra `cd cli && npm install` derlemeyi yeniler; `npm link` ile
kurduysanız `jse` doğrudan yeni sürümü çalıştırır (symlink olduğu için).

## Backend adresi

Paylaşım komutları backend'e ihtiyaç duyar (`share`, `fetch`). İnceleme komutları
(`values`, `find`, `get`, `fix`) tamamen yereldir, ağ kullanmaz.

```bash
jse config set api https://api.ornek.com          # bir kez ayarla
jse config set web https://json-eyes.vercel.app   # linklerin ön yüz tabanı
jse config show
```

Sıra: `--api` > `JSON_EYES_API` > yapılandırma dosyası
(`~/.config/json-eyes/config.json`) > `http://localhost:8080/api`.

`web` ayarı isteğe bağlıdır: verilmezse sunucunun döndürdüğü link kullanılır. Backend
`jsonsarp.public-base-url` ayarı eksikse sunucu localhost gösteren bir link üretir; CLI
bu durumu uyarı olarak söyler, `--web` ile düzeltebilirsiniz.

Yerel backend:

```bash
cd backend && mvn spring-boot:run   # http://localhost:8080
```

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
npm run build      # esbuild ile tek dosya (~31 KB); npm install bunu kendisi çağırır
npm run typecheck
npm test           # CLI'yi derlenmiş haliyle, sahte bir API sunucusuna karşı koşar
```

Ayrıştırma, arama, alan dağılımı ve JSON onarımı `frontend/src/utils/` altındaki saf
TypeScript modüllerinden geliyor — tarayıcıda gördüğünüz sayılarla terminalde
gördükleriniz aynı kod yolundan çıkıyor. (Bu paylaşım şimdilik doğrudan içe alma ile
yapılıyor; npm'e çıkarken `packages/core` + `packages/cli` ayrımına taşınmalı.)
