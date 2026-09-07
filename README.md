# JSON EYES

IATA NDC JSON viewer — grid odaklı görünüm, dizi tabloları, paylaşılabilir linkler ve
IATA 24.4 XSD alan açıklamaları.

> Ürün daha önce **JSON Sarp** adıyla geliştirildi. Depo klasörü (`json-sarp/`) ve
> backend'in Java paketi (`com.jsonsarp`) ile yapılandırma önekleri (`jsonsarp.*`)
> eski adı taşımaya devam ediyor; yalnızca kullanıcıya görünen isimler değişti.

## Gereksinimler

- Node.js 18+
- Java 17+
- Maven 3.9+

## XSD Dosyaları

IATA 24.4 XSD dosyaları `backend/src/main/resources/xsd/` altında hazır gelir (52 dosya).
Başka bir sürüm kullanmak isterseniz bu klasörü değiştirin veya
`jsonsarp.xsd.path` ayarıyla kendi klasörünüzü gösterin.

Ortak tip dosyaları (`IATA_OffersAndOrdersCommonTypes.xsd` ve `xmldsig-core-schema.xsd`)
şart: alan açıklamalarının neredeyse tamamı oradan gelir.

## Çalıştırma

### Backend (port 8080)

```bash
cd backend
mvn spring-boot:run
```

H2 veritabanı `./data/jsonshare` dosyasında oluşturulur.

### Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Vite dev sunucusu `/api` isteklerini `http://localhost:8080` adresine proxy eder.

### Komut satırı

[![npm](https://img.shields.io/npm/v/json-eyes?color=0b7285&label=json-eyes)](https://www.npmjs.com/package/json-eyes)

```bash
npm install -g json-eyes                  # ya da: npx json-eyes …
jse share siparis.json                    # JSON ver, paylaşım linki al
jse xmlshare siparis.xml                  # XML ver, JSON'a çevirip linki al
```

Ayrıntılar ve tüm komutlar: [cli/README.md](cli/README.md) · paket: [npmjs.com/package/json-eyes](https://www.npmjs.com/package/json-eyes)

## Arayüz

Tek bir kabuk: 56px üst bar (dosya adı + geçerlilik rozeti, komut çubuğu, mod anahtarı,
Paylaş), 38px bağlam şeridi (breadcrumb, yolu kopyala, görünüm filtresi),
solda 292px editör, ortada görüntüleyici, sağda 240px IATA paneli, altta 30px durum
çubuğu. Boş durumda editör, bağlam şeridi ve IATA paneli gizlenir; yalnızca bırakma
alanı ve "Son açılanlar" görünür.

**Klavye**: `Ctrl+K` / `Ctrl+F` görünüm filtresine odaklanır, `Enter` / `Shift+Enter`
eşleşmeler arasında gezer, `J` / `K` satır seçimini kaydırır, `Esc` aramayı temizler.

**Logo** ana sayfaya (boş durum) döner. Üzerinde çalışılan JSON önce "Son açılanlar"a
yazılır, tek tıkla geri alınır.

**Tema**: üst bardaki ☀ / ☾ düğmesi karanlık ve aydınlık tema arasında geçer, seçim
tarayıcıda saklanır. Her iki tema aynı token setini kullanır
([styles/index.css](frontend/src/styles/index.css)); bileşenlerde ham renk yoktur,
yeni bir tema eklemek `:root[data-theme='...']` bloğu yazmaktan ibarettir.

## Özellikler

- **Tree**: JSON sözdizimi görünümü, yerinde aç/kapa, alan başına XSD tooltip'i
- **Grid**: **iç içe tablolar**. Tablo biçimi düğümün şeklinden gelir:
  nesne → `anahtar | değer`, **nesne dizisi → kayıt tablosu** (kolonlar öğelerin
  anahtarlarının birleşimi, `#` indeks kolonu), diğer diziler → `# | değer`.
  İç içe bir değer tıklanan **hücrenin içinde** açılır: hiçbir tıklama görünümü
  değiştirmez, bakılan tablo kaybolmaz. (Eskiden grid girintili düz bir satır
  listesiydi ve nesne dizileri o modele sığmadığı için "Tablo" ayrı bir görünüm
  olmak zorunda kalmıştı; artık öyle bir mod yok — görünümler **Tree · Grid ·
  Kolon**.)
  - Kayıt tablosunda: başlığa tıklayarak sıralama (artan ⇄ azalan ⇄ JSON sırası),
    kolon başına `contains` filtresi (AND ile birleşir), CSV indirme, satır sayısı /
    kolon sayısı / seçili sıralama / sayısal kolon toplamı şeridi. Kolon başlığı
    alanın XSD açıklamasını da taşır ve `4/1200` gibi bir not eksik alanları söyler.
  - `#` hücresine tıklamak satırın tamamını altta bir tablo olarak açar.
  - Açılışta ilk üç seviye ve tek alanlı sarmalayıcı zincirler (`IATA_OrderViewRS >
    Response > Order`) kendiliğinden açılır; kayıt satırları açılmaz (alanları zaten
    kolon olarak görünüyor). "tümünü aç" 800 tabloda durur ve bunu söyler — iç içe
    tablolar gerçek DOM üretiyor.
  - Her tablo kendi penceresini yönetir: 200 satır çizilir, "daha fazla göster"
    büyütür. Alt durum çubuğu çizilen satır ve açık tablo sayısını gösterir.
  - 40'tan fazla farklı anahtarı olan dizilerde en seyrek dolan kolonlar gizlenir ve
    kaç kolonun gizlendiği şeritte yazılır — sessizce alan düşürmek yok.
- **Otomatik düzeltme**: geçersiz JSON'da "Otomatik düzelt ve dene" yorum satırlarını,
  sondaki fazla virgülleri ve tek tırnaklı metinleri onarır; onarım da ayrıştırılamazsa
  metne dokunulmaz.
- **Son açılanlar**: açılan dosyalar tarayıcıda saklanır (512 KB'ın altındakilerin
  içeriğiyle birlikte), boş durumdan ve editörün "Geçmiş" sekmesinden tekrar açılır.
- **NDC referansları**: `PaxRefID`, `PaxSegmentRefID`, `ServiceDefinitionRefID` gibi
  alanların yanında `↳ referans` rozeti çıkar; tıklayınca `DataLists` içindeki hedef
  nesne satırın altında açılır, "Hedefe git" ile hedefin bulunduğu yere atlanır.
  Eşleştirme değer üzerinden yapılır, `XxxRefID → XxxID` adlandırması önceliklendirilir;
  dizi hâlindeki referanslar (`PaxRefID: ["PAX1","PAX2"]`) de tek tek çözülür.
- **Arama**: anahtar ve değerlerde arar, eşleşme sayısını gösterir, eşleşmeler arasında
  Enter / Shift+Enter (veya ↑ ↓) ile gezinir ve eşleşen düğüme giden yolu otomatik açar.
  "yalnız eşleşen" ile ağaç yalnızca eşleşmelere ve onlara giden yola indirgenir;
  grid'de eşleşme alt dalda ise satır soluk vurguyla korunur, böylece drill-down yolu kaybolmaz.
- **Paylaş**: JSON sunucuya kaydedilir, `/?s=<id>` kısa linki üretilir.
  Paylaşımların ömrü `jsonsarp.share.retention-days` kadardır (varsayılan 60 gün);
  süresi dolanlar yorumlarıyla birlikte silinir, linkleri 404 döner. Ömür olmasaydı
  veritabanı yalnızca büyürdü — hiçbir kayıt silinmiyor.
- **Salt okunur paylaşım**: `/?s=<id>` ile açılan JSON düzenlenemez — editör, Yükle ve
  Paylaş kontrolleri gizlenir. Değişiklik yapmak isteyen kullanıcı "Kopyasını al ve
  düzenle" ile yerel bir kopya üzerinde çalışır; orijinal paylaşım etkilenmez.
  Paylaşıma isteğe bağlı bir başlık verilebilir; bağlantıyı açan kişi başlığı görür.
- **Alan bazlı yorumlar**: paylaşılan JSON'da her alanın yanında 💬 düğmesi çıkar;
  GitHub'daki satır yorumları gibi, alanın altında yanıtlanabilir bir zincir açılır.
  Yorum JSON yoluna sabitlenir — paylaşılan JSON değişmediği için bağ kalıcıdır.
  İsim tarayıcıda saklanır (giriş yok); yorumu bırakan kişi kendi yorumunu silebilir.
  Paylaşırken "Yorum" kutusuyla yorumlar kapatılabilir.
- **Büyük JSON**: çok elemanlı düğümler sayfa sayfa gösterilir ("N satır daha göster");
  arama eşleşmesi sayfa sınırının ötesindeyse otomatik olarak açılır.
- **IATA**: JSON mesaj tipi otomatik tespit edilir; her alan için XSD'deki **tip adı**
  (ör. `ID_Type`) ve açıklama gösterilir. Eşleştirme yol tabanlıdır: NDC'de `DescText`,
  `TypeCode`, `RefID` gibi adlar onlarca tipte farklı anlam taşıdığı için açıklama
  alanın bulunduğu bağlamdan alınır.
- **Alan açıklaması**: XSD karşılığı kesin olan alanların yanında `ⓘ`, yapıdan
  çıkarılanların yanında camgöbeği `≈`, karşılığı bulunamayanların yanında turuncu `●`
  çıkar. İşaretin üzerine gelince açıklama balonu açılır, tıklayınca sabitlenir.
  Sağdaki IATA paneli **seçili** alanın tipini ve açıklamasını, altta da **şemada
  karşılığı olmayan alanların listesini** gösterir; listeden bir alana tıklayınca
  görüntüleyicide o alana atlanır.
- **Panel şeritleri**: editör ve IATA panelleri kendi başlıklarındaki `‹` / `›` ile
  kapanır; kapalıyken kenarda dikey yazılı bir şerit kalır, tıklayınca geri açılır.

### XML → JSON aracı

Üst bardaki **XML** düğmesi ayrı bir ekran açar: solda XML, sağda JSON. Girdinin
içeriğine bakıp "bu XML'e benziyor" diye **tahmin yapılmaz** — çeviriyi kullanıcı
başlatır. `.xml` uzantılı bir dosya seçmek (uzantı açık bir tercih) doğrudan bu
aracı açar, dosya kendiliğinden çevrilmez. Sonuç "JSON'u görüntüleyiciye yükle" ile
normal boru hattına girer (grid, kolon, fark, paylaşım, XSD eşleştirmesi) ya da
kopyalanır / `.json` olarak indirilir. Seçenekler CLI'daki bayrakların aynısı:
ad alanı öneklerini koru (`--keep-prefixes`), sayıları çıkar (`--numbers`).

Terminalde aynı iş tek komut: `jse xmlshare siparis.xml` XML'i çevirip paylaşım
linkini basar (`cat s.xml | jse xmlshare -` boru hattında da çalışır).

Kurallar: ad alanı önekleri atılır (`iata:Order` → `Order`), öznitelikler `@ad`, metin
içeriği `#text` olur, tekrarlayan kardeşler diziye düşer ve **değerler metin kalır**
(`0123` sayıya çevrilse baştaki sıfır giderdi — uçuş/bilet kodları bozulur). Ne
yapıldığı üstteki bantta tek tek yazılır. Aynı çevirici CLI'de de kullanılır
(`jse share siparis.xml`), dolayısıyla iki tarafta birebir aynı JSON çıkar.

### Fark görünümü

`Fark` düğmesi mevcut JSON'u ikinci bir JSON ile karşılaştırır (dosya, sürükle-bırak,
yapıştır ya da paylaşım linki). Sonuç yan yana iki metin değil **tek bir birleşik
ağaç**: değişiklikler kendi yerinde, değişmeyen dallar katlı.

Diziler indekse göre değil **kimliğe göre** eşleştirilir: `Order` dizisinde `OrderID`,
`Pax` listesinde `PaxID` kendiliğinden bulunur. Böylece başa bir kayıt eklendiğinde
rapor "her şey değişti" demez; yalnızca gerçekten değişen kayıt görünür ve satırda
hangi kayıt olduğu (`ORD100005`) yazar. Kayma ile gerçek yeniden sıralama ayrılır —
sadece sırası değişen öğeler "taşındı" olarak raporlanır (LIS). Kimliği olmayan
dizilerde metin diff'lerinin LCS'i kullanılır.

Üstteki dört sayı (eklendi / silindi / değişti / taşındı), ↑↓ ile değişiklikler
arasında gezinme, "yalnız değişenler" filtresi ve uzun değerlerde A/B yan yana tam
metin var. 4,3 MB'lık iki NDC yanıtı ~15 ms'de karşılaştırılıyor.

## Alan eşleştirme

Gerçek JSON'larda kapsayıcı adları standarttan sapar (`PaxList` → `passengerList`,
`segments`, `travelers`) ama veriyi taşıyan yaprak adları (`PaxID`, `PTC`, `CurCode`)
standart kalır. Eşleştirme bunun üzerine kurulu: **kap adından değil içindekilerden
tanınır.** Elle bakım gerektiren eş anlamlı sözlüğü yoktur — üretimde hangi adların
geleceği önceden bilinemez.

Katmanlar sırayla denenir ([ElementMatcher.java](backend/src/main/java/com/jsonsarp/iata/ElementMatcher.java)):

| # | Katman | Örnek |
|---|--------|-------|
| 1 | Ad birebir | `Order` → `Order` |
| 2 | Biçimsel normalizasyon: harf, ayraç, çoğul, `List`/`Collection` eki | `segments`, `SegmentList`, `pax_list` |
| 3 | `<X>ID` konvansiyonu — içinde `PaxID` olan nesne `Pax`'tır (2 seviye derine bakar) | `passengerList.traveler[].PaxID` → `PaxList.Pax` |
| 4 | Nadirlik ağırlıklı çocuk/yaprak örtüşmesi — `PTC` teşhis edici, `ID` değil | tamamen yeniden adlandırılmış kaplar |
| 5 | Kardinalite ve şekil uyumu (`maxOccurs` ↔ dizi) | tekil elemana çok elemanlı dizi gelirse aday zayıflar |

Karar güvenliği: bir aday eşiği geçmiyorsa **veya** ikinciyi belirgin farkla geçmiyorsa
eşleştirme yapılmaz — kararsız kalmak, kendinden emin yanlış açıklama göstermekten
iyidir. Kabul edilen tahminler `matchKind: INFERRED` ile işaretlenir, arayüzde `≈` ile
ayrılır ve dayanağı (`içindeki PaxID alanından`) kullanıcıya gösterilir.

Ad tutmasa bile **alt ağaç terk edilmez**: bilinmeyen bir sarmalayıcının
(`{"data": {…}}`) altındaki torunlar aynı tiple eşleşmeye devam eder.

### Nasıl ölçülüyor

Gerçek müşteri JSON'u olmadan doğrulamak için XSD'nin kendisi yer gerçeği olarak
kullanılır: şemadan JSON iskeleti üretilir, **kapsayıcı** adları kasıtlı bozulur ve
yaprakların ne kadarının hâlâ açıklandığına bakılır
([ElementMatcherTest](backend/src/test/java/com/jsonsarp/iata/ElementMatcherTest.java)).

| Mutasyon | Kurtarma |
|----------|----------|
| `PAXLIST` (büyük harf) | %100 |
| `paxlists` (çoğul) | %100 |
| `pax_list` (snake_case) | %100 |
| `PaxListCollection` (ek) | %100 |
| `bolum7` (tamamen alakasız) | %63 |

Son satır yapısal katmanın gerçek gücü: hiçbir biçimsel ipucu yokken bile alanların
üçte ikisi kurtarılıyor. Testler ayrıca **yanlış eşleştirmeye** karşı da koruyor:
adlar doğruyken hiç tahmin üretilmemeli ve şemayla ilgisiz bir nesne zorla
eşleştirilmemeli.

## Yapılandırma

`backend/src/main/resources/application.properties` içinde:

| Ayar | Varsayılan | Açıklama |
|------|-----------|----------|
| `jsonsarp.public-base-url` | `http://localhost:5173` | Paylaşım linklerinin taban adresi. **Deploy ederken mutlaka değiştirin.** |
| `jsonsarp.share.max-bytes` | `8388608` (8 MB) | Tek paylaşımda saklanabilecek en büyük JSON. Aşılırsa HTTP 413. |
| `jsonsarp.share.retention-days` | `60` | Paylaşımların saklama süresi. Bu süreden eski paylaşımlar ve yorumları günlük çalışan bir görevle silinir; `0` verilirse temizlik kapanır. |
| `spring.h2.console.enabled` | `false` | Kapalı tutun; açıkken paylaşımlar veritabanından değiştirilebilir. |
| `jsonsarp.comments.max-per-share` | `500` | Bir paylaşımdaki toplam yorum sınırı. |
| `jsonsarp.comments.max-per-minute` | `20` | Dakikalık yorum sınırı (basit spam koruması). |
| `jsonsarp.cors.allowed-origins` | `*` | Backend'e tarayıcıdan **doğrudan** gidecek ön yüz adresleri. Rewrite kullanılıyorsa devreye girmez. |

Her ayar ortam değişkeniyle de verilebilir: `jsonsarp.public-base-url` →
`JSONSARP_PUBLIC_BASE_URL`.

Ön yüz tarafında tek ayar `frontend/.env` içindeki `VITE_API_BASE`
(bkz. [.env.example](frontend/.env.example)); boş bırakmak önerilir.

## Yayına alma

Mimari: **backend Coolify'da Docker olarak**, **ön yüz Vercel'de statik**. Ön yüz
istekleri `/api` altına gider, Vercel bunları backend'e taşır (rewrite). Böylece
tarayıcı her zaman kendi alan adıyla konuşur; ne CORS ne de HTTPS sayfadan HTTP
backend'e gitmenin doğurduğu **karışık içerik (mixed content)** sorunu çıkar.

Sıra önemli: backend'in alan adı belli olmadan `vercel.json` doldurulamaz.

### 1. Backend — Coolify

Yeni kaynak: **Private Repository (with GitHub App)** → depoyu seç → Build Pack:
**Dockerfile**.

| Ayar | Değer |
|------|-------|
| Base Directory | `/backend` |
| Dockerfile Location | `/backend/Dockerfile` |
| Ports Exposes | `8080` |
| Domain | Coolify'ın verdiği alt alan adı (Let's Encrypt sertifikasıyla) |

**Environment Variables:**

| Değişken | Değer |
|----------|-------|
| `JSONSARP_PUBLIC_BASE_URL` | Vercel adresi, ör. `https://json-eyes.vercel.app` |

**Persistent Storage** (şart): `/app/data` için bir volume tanımlayın. H2 dosya
veritabanı orada durur; volume bağlanmazsa her yeni dağıtımda paylaşımlar ve
yorumlar silinir.

Veritabanını sıfırlamak gerekirse volume'ü silmeyin (kalıcı depolama ayarını da
götürür). Bunun yerine `SPRING_DATASOURCE_URL` ile yeni bir dosya adı verin:
`jdbc:h2:file:./data/<yeni-ad>;DB_CLOSE_DELAY=-1`. Uygulama boş bir veritabanıyla
açılır, eski dosya diskte durur ve istendiğinde geri dönülebilir.

**Health Check Path** (isteğe bağlı): `/api/iata/messages` — 200 dönüyorsa XSD
indeksi de yüklenmiş demektir.

İlk derleme uzun sürer (Maven bağımlılıkları çekilir); sonraki dağıtımlarda
`pom.xml` değişmediği sürece o katman önbellekten gelir.

### 2. Ön yüz — Vercel

1. [vercel.json](frontend/vercel.json) içindeki rewrite hedefi **1. adımda alınan
   alan adı** olmalı:

   ```json
   { "source": "/api/:path*", "destination": "http://<coolify-alan-adiniz>/api/:path*" }
   ```

   Backend'de HTTPS yoksa bu hop şifresizdir; bkz. aşağıdaki "Alan adı ve HTTPS".

2. Vercel'de projeyi aynı depodan oluşturun, **Root Directory** ayarını `frontend`
   yapın. Derleme ayarlarını `vercel.json` taşıdığı için başka bir şey gerekmez.
3. `VITE_API_BASE` ayarlamayın (boş kalsın) — rewrite zaten `/api`'yi karşılıyor.
4. Vercel adresi belli olunca Coolify'daki `JSONSARP_PUBLIC_BASE_URL` değerini o
   adresle güncelleyip backend'i yeniden başlatın. Bu adım atlanırsa "Paylaş"
   düğmesinin ürettiği linkler `localhost:5173`'ü gösterir.

**Alternatif** (rewrite yerine doğrudan çağrı): Vercel'de
`VITE_API_BASE=https://<coolify-alan-adiniz>/api`, Coolify'da
`JSONSARP_CORS_ALLOWED_ORIGINS=https://<vercel-adresiniz>`. Bir hop daha az, ama
CORS'u doğru ayarlamak size kalır.

### Alan adı ve HTTPS

Coolify'ın otomatik verdiği `*.sslip.io` adresinde HTTPS **çalışmaz**: Let's Encrypt
bu ortak alan adına rate limit uyguluyor, sertifika doğrulaması başarısız oluyor.
Bu yüzden backend şu an düz HTTP üzerinden yayında.

Sonuç: tarayıcı ile Vercel arası HTTPS, **Vercel ile backend arası şifresiz**.
Paylaşılan JSON içerikleri ve yorumlar bu hopta açık metin gider. CLI (`jse`)
backend'e doğrudan gittiği için orada tüm yol şifresizdir; araç bunu her paylaşımda
uyarı olarak yazar.

Kalıcı çözüm: sahip olduğunuz bir alan adına alt alan adı açmak
(ör. `json-eyes-api.ornek.com` → A kaydı sunucu IP'sine), Coolify'da Domains
alanına `https://json-eyes-api.ornek.com` yazmak. Coolify Let's Encrypt
sertifikasını kendisi alır; ardından `vercel.json`'daki hedefi de `https://` yapın.

### Erişim kontrolü

Uygulamada kimlik doğrulama yok: linki bilen herkes paylaşımı okuyabilir, backend'e
erişebilen herkes yeni paylaşım oluşturabilir. Yalnızca şirket içi kullanım için ön
yüzü Vercel'in erişim korumasına, backend'i de Cloudflare Access / VPN arkasına
almak gerekir.

## API

| Endpoint | Açıklama |
|----------|----------|
| `POST /api/shares` | `{ "json": {...}, "title": "...", "commentsEnabled": true }` → `{ "id", "url" }` |
| `GET /api/shares/{id}/comments` | `{ "enabled", "comments": [...] }` |
| `POST /api/shares/{id}/comments` | `{ path, author, body, parentId? }` → yorum + `editToken` |
| `DELETE /api/shares/{id}/comments/{commentId}` | `X-Edit-Token` başlığı gerekir |
| `GET /api/shares/{id}` | Paylaşılan JSON (yalnızca okuma; güncelleme/silme endpoint'i yoktur) |
| `POST /api/iata/annotate` | `{ "json": {...} }` → mesaj tipi, güven oranı, alan açıklamaları (`schemaLoaded` false ise sunucuda XSD yoktur) |
| `GET /api/iata/messages` | Desteklenen mesaj tipleri (48 IATA mesajı) |

## Testler

```bash
cd backend && mvn test     # XSD indeksleme ve alan eşleştirme (gerçek IATA şemaları)
cd frontend && npm test    # fark motoru + XML çevirici + grid modeli (36 test)
cd cli && npm test         # CLI: derlenmiş paket, sahte API sunucusuna karşı
```

## Yapı

```
json-sarp/
├── frontend/          Vue 3 + Vite + TypeScript
│   └── src/
│       ├── App.vue                 uygulama kabuğu (header, breadcrumb, durum çubuğu)
│       ├── components/             EditorPane · JsonGrid + GridTable · XmlPane · IataPanel
│       └── utils/grid.ts           tablo modeli: şekil, kolonlar, açılış bütçesi, CSV
├── backend/           Spring Boot + H2 + XSD indeksleyici
│   └── src/main/resources/xsd/     IATA 24.4 şemaları (52 dosya)
├── cli/               `jse` komut satırı aracı (paylaşım linki + yerel inceleme)
└── design_handoff_json_eyes/       uygulanan tasarım referansı (Tur 5)
```

## Lisans

MIT — bkz. [LICENSE](LICENSE).
