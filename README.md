# JSON Sarp

IATA NDC JSON viewer — jsongrid benzeri tree/grid görünüm, paylaşılabilir linkler ve IATA 24.4 XSD alan açıklamaları.

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

## Özellikler

- **Tree**: JSON sözdizimi görünümü, yerinde aç/kapa, alan başına XSD tooltip'i
- **Grid**: hiyerarşik tablo — Alan / Tip / Değer sütunları, satırlar yerinde açılıp
  kapanır (drill-down ve breadcrumb yok), "Tümünü aç / Tümünü kapat" düğmeleri
- **NDC referansları**: `PaxRefID`, `PaxSegmentRefID`, `ServiceDefinitionRefID` gibi
  alanların yanında `↳ referans` rozeti çıkar; tıklayınca `DataLists` içindeki hedef
  nesne satırın altında açılır, "Hedefe git" ile hedefin bulunduğu yere atlanır.
  Eşleştirme değer üzerinden yapılır, `XxxRefID → XxxID` adlandırması önceliklendirilir;
  dizi hâlindeki referanslar (`PaxRefID: ["PAX1","PAX2"]`) de tek tek çözülür.
- **Arama**: anahtar ve değerlerde arar, eşleşme sayısını gösterir, eşleşmeler arasında
  Enter / Shift+Enter (veya ↑ ↓) ile gezinir ve eşleşen düğüme giden yolu otomatik açar.
  "Sadece eşleşenler" ile ağaç yalnızca eşleşmelere ve onlara giden yola indirgenir;
  grid'de eşleşme alt dalda ise satır soluk vurguyla korunur, böylece drill-down yolu kaybolmaz.
- **Paylaş**: JSON sunucuya kaydedilir, `/?s=<id>` kısa linki üretilir
- **Salt okunur paylaşım**: `/?s=<id>` ile açılan JSON düzenlenemez — editör, Yükle ve
  Paylaş kontrolleri gizlenir. Değişiklik yapmak isteyen kullanıcı "Kopyasını al ve
  düzenle" ile yerel bir kopya üzerinde çalışır; orijinal paylaşım etkilenmez.
  Paylaşıma isteğe bağlı bir başlık verilebilir; bağlantıyı açan kişi başlığı görür.
- **Alan bazlı yorumlar**: paylaşılan JSON'da her alanın yanında 💬 düğmesi çıkar;
  GitHub'daki satır yorumları gibi, alanın altında yanıtlanabilir bir zincir açılır.
  Yorum JSON yoluna sabitlenir — paylaşılan JSON değişmediği için bağ kalıcıdır.
  İsim tarayıcıda saklanır (giriş yok); yorumu bırakan kişi kendi yorumunu silebilir.
  Paylaşırken "Yorum" kutusuyla yorumlar kapatılabilir.
- **Büyük JSON**: çok elemanlı düğümler sayfa sayfa gösterilir ("N öğe daha göster");
  arama eşleşmesi sayfa sınırının ötesindeyse otomatik olarak açılır.
- **IATA**: JSON mesaj tipi otomatik tespit edilir; her alan için XSD'deki **tip adı**
  (ör. `ID_Type`) ve açıklama gösterilir. Eşleştirme yol tabanlıdır: NDC'de `DescText`,
  `TypeCode`, `RefID` gibi adlar onlarca tipte farklı anlam taşıdığı için açıklama
  alanın bulunduğu bağlamdan alınır.
- **Alan açıklaması**: XSD karşılığı olan alanların yanında `ⓘ` işareti çıkar; üzerine
  gelince açıklama balonu açılır, tıklayınca sabitlenir (metin seçilebilir). Sağdaki
  IATA paneli mesaj özetini, üzerine gelinen alanın detayını ve **şemada karşılığı
  olmayan alanların listesini** gösterir; listeden bir alana tıklayınca görüntüleyicide
  o alana atlanır.

## Yapılandırma

`backend/src/main/resources/application.properties` içinde:

| Ayar | Varsayılan | Açıklama |
|------|-----------|----------|
| `jsonsarp.public-base-url` | `http://localhost:5173` | Paylaşım linklerinin taban adresi. **Deploy ederken mutlaka değiştirin.** |
| `jsonsarp.share.max-bytes` | `2097152` (2 MB) | Tek paylaşımda saklanabilecek en büyük JSON. Aşılırsa HTTP 413. |
| `spring.h2.console.enabled` | `false` | Kapalı tutun; açıkken paylaşımlar veritabanından değiştirilebilir. |
| `jsonsarp.comments.max-per-share` | `500` | Bir paylaşımdaki toplam yorum sınırı. |
| `jsonsarp.comments.max-per-minute` | `20` | Dakikalık yorum sınırı (basit spam koruması). |

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
cd backend
mvn test
```

XSD indeksleme ve alan eşleştirme testleri gerçek IATA şemalarıyla çalışır.

## Yapı

```
json-sarp/
├── frontend/          Vue 3 + Vite + TypeScript
└── backend/           Spring Boot + H2 + XSD indeksleyici
    └── src/main/resources/xsd/   IATA 24.4 şemaları (52 dosya)
```
