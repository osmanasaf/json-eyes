# Handoff: JSON EYES — JSON görüntüleyici (Grid odaklı UX yenilemesi)

## Overview

`JSON EYES`, IATA NDC JSON yanıtlarını (ör. `IATA_OrderViewRS`) inceleyen developer / QA / iş analisti ekipleri için bir JSON görüntüleyicidir. Mevcut uygulama Vue 3 + Vite (`frontend/`) ile yazılmıştır: sol JSON editörü, orta Tree/Grid görüntüleyici, sağ IATA XSD paneli, paylaşım linki ve alan bazlı yorumlar.

Bu paket, ürünün **yeniden markalanmış (JSON EYES) ve UX'i elden geçirilmiş** halinin tasarım referansıdır. Odak: **Grid modunun** kullanılabilir hale getirilmesi (dizilerin gerçek tabloya dönmesi, referans çözümleme, alan yorumları, kalıcı bağlam) ve tüm akışın (yükleme → hata → grid → tablo → referans → yorum → paylaşım) tanımlanması.

Uygulanacak hedef ekran: **Tur 5 (`#5a`)** — tek, nihai tasarım. Diğer turlar (1–4) karar geçmişidir, uygulanmayacaktır.

## About the Design Files

Bu paketteki HTML dosyaları **tasarım referansıdır** — hedeflenen görünüm ve davranışı gösteren prototiplerdir, doğrudan kopyalanacak üretim kodu değildir.

Görev: bu tasarımları **mevcut kod tabanının kendi ortamında yeniden kurmak** — yani `frontend/` içindeki **Vue 3 + TypeScript + Vite** yapısında, mevcut bileşen ve CSS değişkeni düzenini koruyarak. HTML/inline stiller birebir taşınmamalı; değerler (renk, ölçü, tipografi) alınıp mevcut `src/styles/index.css` token setine ve `<style scoped>` düzenine uyarlanmalıdır.

`support.js` yalnızca prototipin tarayıcıda çalışması içindir; üretim koduna girmez.

## Fidelity

**High-fidelity (hifi).** Renkler, ölçüler, tipografi ve etkileşimler nihai değerlerdir. Prototip etkileşimli çalışır: satır aç/kapa, filtre, kolon sıralama/filtreleme, referans açma, yorum yazma, adım geçişleri.

Not: Prototipteki veriler sahte (64 adet üretilmiş `Order` kaydı) ve IATA XSD açıklamaları örnek amaçlıdır; gerçek veriler backend'in `/annotate` yanıtından gelir.

---

## Screens / Views

Tüm ekranlar tek bir uygulama kabuğu (shell) içinde yaşar; yalnızca orta alan ve bazı üst çubuk parçaları değişir.

### Ortak kabuk (shell)

Çerçeve: `1440 × 900` referans; gerçek uygulamada `100vw × 100vh`, `display:flex; flex-direction:column; overflow:hidden`.

**1. Üst bar (header)** — yükseklik `56px`, arka plan `#161b22`, alt kenarlık `1px solid #30363d`, yatay padding `16px`, elemanlar arası `gap: 14px`.
- **Logo kilidi (sol)**: `26×26` SVG + kelime markası.
  - SVG: `viewBox="0 0 24 24"`; `rect x=1 y=1 w=22 h=22 rx=6 fill=#58a6ff opacity=.14`; `ellipse cx=12 cy=12 rx=8 ry=5.2 fill=none stroke=#58a6ff stroke-width=1.6`; `circle cx=12 cy=12 r=2.7 fill=#58a6ff`; `circle cx=13.4 cy=10.6 r=0.9 fill=#0d1117` (göz parıltısı).
  - Kelime markası: `JSON EYES`, 15.5px/700, harf aralığı `.2px`; "EYES" `#58a6ff`.
- Ayraç: `1px × 22px`, `#30363d`.
- **Dosya adı**: JetBrains Mono 12.5px `#e6edf3`. Yanında **geçerlilik rozeti**: 10.5px `#3fb950`, arka plan `rgba(63,185,80,.12)`, `border-radius: 20px`, padding `2px 8px`, önünde `5px` yeşil nokta. Geçersizken: `#ff7b72` / `rgba(255,123,114,.10)`, metin "geçersiz".
- **Salt okunur rozeti** (yalnızca paylaşılan görünümde): `🔒 salt okunur`, 10.5px `#8b949e`, `#21262d` zemin, `1px solid #30363d`, radius 20px.
- **Komut çubuğu (orta, ortalanmış)**: genişlik `360px`, `#0d1117` zemin, `1px solid #30363d`, radius `9px`, padding `7px 11px`; içerik: `⌕` ikon `#6e7681`, placeholder "Alan, değer veya komut" 12.5px `#6e7681`, sağda `⌘K` rozeti (10.5px, `1px solid #30363d`, radius 4px, padding `1px 5px`).
- **Yorum sayacı**: `💬 {n}`, 11.5px `#bc8cff`, zemin `rgba(188,140,255,.12)`, radius 20px, padding `4px 10px`.
- **Mod anahtarı**: `#0d1117` zemin, `1px solid #30363d`, radius 8px, padding 3px. Sekmeler 12.5px, pasif `#6e7681`, aktif `#21262d` zemin + `#e6edf3`. Değerler: `Tree`, `Grid` (üretimde `Tablo` da eklenebilir).
- **Paylaş butonu**: 12.5px/600, metin `#0d1117`, zemin `#58a6ff`, radius 7px, padding `6px 13px`.

**2. Bağlam şeridi (breadcrumb bar)** — yükseklik `38px`, zemin `#0d1117`, alt kenarlık `1px solid #21262d`, padding `0 16px`.
- Breadcrumb parçaları: JetBrains Mono 11.5px; ara segmentler `#8b949e`, son segment `#e6edf3` + `#21262d` zemin (radius 5px, padding `2px 7px`); ayırıcı `›` `#30363d`.
- **Yolu kopyala**: `⧉ yolu kopyala`, 11px `#8b949e`, `1px solid #30363d`, radius 6px, padding `2px 8px`; hover `#58a6ff` (metin + kenarlık).
- Sağda **görünüm filtresi**: `#161b22` zemin, `1px solid #30363d`, radius 7px; içinde `⌕` + input (190px, 12px, JetBrains Mono) + sonuç sayacı (10.5px `#6e7681`, boşken `⌘F`).
- Sağ uçta **İç içe / Tablo** segmenti: radius 7px, padding 2px; pasif `#6e7681`, aktif `Tablo` → `#3fb950` + `rgba(63,185,80,.14)`, aktif `İç içe` → `#e6edf3` + `#21262d`.

**3. Sol panel (editör)** — genişlik `292px`, zemin `#161b22`, sağ kenarlık `1px solid #30363d`.
- Sekmeler: `Girdi · Şema · Geçmiş`, 11.5px `#6e7681`, padding `6px 11px`, hover `#e6edf3`; altında `1px solid #21262d`.
- Kod alanı: zemin `#0d1117`, satır başına `display:flex; gap:10px; padding:0 12px`, JetBrains Mono 11.5px, `line-height: 1.75`. Satır numarası `#30363d` (18px, sağa yaslı); anahtar `#ff7b72`; iki nokta `#6e7681`; değer tipe göre renklenir (aşağıdaki token tablosu). Alt kenara doğru `-webkit-mask-image: linear-gradient(#000 88%, transparent)` ile solar.
- Alt durum satırı: geçerliyken `#3fb950` + nokta, "Geçerli JSON · 48.216 node"; hatalıyken `rgba(255,123,114,.06)` zemin, `#ff7b72`, "Satır 14: beklenen "," — Düzelt".

**4. Sağ panel (IATA)** — genişlik `240px`, zemin `#161b22`, sol kenarlık `1px solid #30363d`.
- Başlık satırı: "IATA" 11px/600 uppercase `letter-spacing:.5px` `#6e7681`; sağda `%86` rozeti (10.5px `#3fb950`, `rgba(63,185,80,.12)`, radius 10px).
- Seçili alan: alan adı JetBrains Mono 13px `#ff7b72`; altında etiketler (10.5px, radius 10px, padding `2px 8px`) — XSD tipi `#79c0ff`/`rgba(121,192,255,.12)`, zorunluluk `#3fb950`/`rgba(63,185,80,.12)` veya `#8b949e`/`#21262d`, şemada yoksa tek etiket `#d29922`/`rgba(210,153,34,.14)`.
- Açıklama: 12px `#8b949e`, `line-height:1.5`, `text-wrap: pretty`.
- Panelin en altı (`margin-top:auto`): lejant — `ⓘ şemada var` (`#58a6ff`) · `● şemada yok` (`#d29922`), ve "7 alan karşılıksız — listele".

**5. Alt durum çubuğu** — yükseklik `30px`, zemin `#161b22`, üst kenarlık `1px solid #30363d`. Sol: `48.216 node`, `ayrıştırma 42 ms`, `22 satır render`, `IATA_OrderViewRS %86` (JetBrains Mono 10.5px `#6e7681`). Sağ: `⌘K komutlar · ⌘F filtre · J/K satır`.

---

### Ekran 1 — Yükle (boş durum)

**Amaç**: JSON'u sisteme almak. Ekranda tek karar var.

- Sol panel, sağ panel ve breadcrumb **gizlidir**; yalnızca header + footer görünür.
- Orta alan dikey ortalanır, `gap: 26px`.
- **Bırakma alanı**: genişlik `520px`, `1px dashed #30363d`, radius `14px`, padding `48px 40px`, zemin `#161b22`, içerik ortalanmış, `gap: 14px`.
  - Göz ikonu `42×42` (ellipse `rx=9 ry=5.8`, stroke `#58a6ff` `opacity:.7`; pupil `r=2.8` dolu).
  - Başlık: "JSON'u buraya bırakın" 17px/600.
  - Alt metin: 13px `#8b949e`, max-width `320px`, ortalı — "Dosya sürükleyin, panodan yapıştırın (⌘V) veya bir örnekle başlayın."
  - Butonlar (`gap:10px`): birincil "Dosya seç" (`#58a6ff` zemin, `#0d1117` metin, 13px/600, radius 8px, padding `8px 18px`); ikincil "Örnek yükle" (`1px solid #30363d`, `#8b949e`, hover `#e6edf3`).
- **Son açılanlar**: 520px genişlik; başlık 11px uppercase `.5px` `#6e7681`. Satırlar: dosya adı JetBrains Mono 12.5px `#e6edf3`, sağda meta 11.5px `#6e7681`, padding `9px 12px`, radius 8px, hover `#161b22`.
  - İçerik: `orderview-prod.json · 2,4 MB · dün`, `airshopping-test.json · 840 KB · 3 gün önce`, `ordercreate-uat.json · 1,1 MB · geçen hafta`.

### Ekran 2 — Geçersiz JSON

**Amaç**: Hatayı tek cümlede göstermek ve düzeltmeye yönlendirmek.

- Sol editör **açık** (hata satırı işaretli), sağ panel ve breadcrumb **gizli**.
- Header'da "geçersiz" rozeti.
- Orta alan ortalanmış: başlık "JSON ayrıştırılamadı" 17px/600 `#ff7b72`; kod kutusu (JetBrains Mono 12.5px `#8b949e`, `#161b22` zemin, `1px solid #30363d`, radius 8px, padding `12px 16px`) — `Unexpected token "}" at line 14, column 7`; açıklama 13px `#6e7681` (max 360px, ortalı); eylem "Otomatik düzelt ve dene" (13px `#58a6ff`, `rgba(88,166,255,.15)` zemin, radius 8px, padding `8px 18px`).

### Ekran 3 — Grid (ana ekran)

**Amaç**: Ağacı tarayıp alan bulmak. Bu, ürünün varsayılan ekranıdır.

- Tablo başlığı: `display:grid; grid-template-columns: minmax(300px,1fr) 84px minmax(220px,1.4fr)`; zemin `#161b22`, alt kenarlık `1px solid #30363d`; başlık hücreleri 10.5px/600 uppercase `.5px` `#8b949e`, padding `8px 12px`. Kolonlar: **Alan · Tip · Değer**.
- **Satır**: aynı grid; alt kenarlık `1px solid #21262d`; hover `#161b22`; tıklama satırı açar/kapatır ve seçer.
  - *Alan hücresi*: girinti `depth × 18px` boşluk → caret (`16px` genişlik, 10px, `#6e7681`, kapalı `▸` / açık `▾`) → alan adı (JetBrains Mono 12.5px/500 `#ff7b72`, taşarsa ellipsis) → şema işareti (`9px`, `opacity:.75`): şemada varsa `ⓘ` `#58a6ff`, yoksa `●` `#d29922`.
  - *Tip hücresi*: rozet 10px/600 uppercase, radius 4px, padding `2px 6px`, JetBrains Mono; renkler tip tablosundan.
  - *Değer hücresi*: `display:flex; align-items:center; gap:8px`. Değer JetBrains Mono 12.5px, tipe göre renkli; container satırlarda `"4 öğe" / "3 alan"` `#6e7681` italik. Sağda: referans rozeti (varsa) ve `💬` yorum düğmesi (`opacity:.35`, yorum varsa `1` ve `#bc8cff`, formatı `💬 2`).
- Satır yüksekliği yoğunluğa bağlı dikey padding: **compact 4px · normal 6px · comfortable 9px** (yatay padding sabit `12px`).
- Boyut/performans: 100k+ satırda sanallaştırma zorunlu (yalnızca görünür satırlar render edilir); alt durum çubuğu render edilen satır sayısını gösterir.

### Ekran 4 — Tablo (dizi görünümü)

**Amaç**: Nesne dizisini (ör. `Response.Order[]`) kayıtlar arası karşılaştırılabilir hale getirmek.

- Üst şerit: `Response.Order[]` (JetBrains Mono 12px), kayıt sayısı rozeti (`#bc8cff` / `rgba(188,140,255,.12)`, radius 20px), aktif filtre özeti (11.5px `#8b949e`), sağda "Filtreleri temizle" (hover `#ff7b72`) ve "CSV indir" (`#58a6ff`).
- **Kolon başlıkları**: her kolon `flex` ile esner (`OrderID` 1.2, `CreateDateTime` 1.3, `CurCode` .6, diğerleri 1); sağ kenarlık `1px solid #21262d`.
  - Üst satır: kolon adı JetBrains Mono 10.5px/700 (aktif sıralamada `#58a6ff`, değilse `#8b949e`), yanında `▲/▼`; sağda tip etiketi (`num`/`str`, 9px `#6e7681`). Tıklama sıralamayı çevirir (asc ⇄ desc).
  - Alt satır: kolon filtre input'u — `#0d1117` zemin, `1px solid #30363d` (doluyken `#58a6ff`), radius 5px, JetBrains Mono 11px, padding `3px 7px`, placeholder "filtre".
- **Satırlar**: `display:flex`; hücreler JetBrains Mono 12px, padding `6px 10px`, sağ kenarlık `1px solid #21262d`, taşma ellipsis. Sayısal kolon sağa yaslı. Zebra: tek satırlarda `rgba(255,255,255,.012)`. Seçili satır: `rgba(188,140,255,.10)` + `inset 2px 0 0 #bc8cff`.
  - Hücre renkleri: `StatusCode` → OPENED `#3fb950`, PENDING `#d29922`, CLOSED `#6e7681`; sayısal `#f78166`; `PaxRefID` `#79c0ff`; diğer metinler `#a5d6ff`.
- Liste sonunda sanallaştırma notu: turuncu nokta + `{n} kayıt eşleşti · 22 satır render edildi · sanal scroll`.
- **Alt toplam şeridi** (32px, `#161b22`, üst kenarlık `#30363d`): `kayıt {n}` · `toplam tutar {sum}` (`#f78166`) · `sıralama {kolon} ↑/↓` (`#58a6ff`) · `seçili {OrderID}` (`#bc8cff`).

### Ekran 5 — Referans çözümleme

**Amaç**: `PaxRefID` gibi IDREF alanlarının hedefini bağlamdan çıkmadan görmek.

- Değer hücresinde rozet: `↳ referans`, 10px `#58a6ff`, zemin `rgba(88,166,255,.15)` (açıkken `rgba(88,166,255,.28)`), radius 10px, padding `1px 8px`.
- Tıklanınca **satırın hemen altında** kutu: sol kenarlık `2px solid #58a6ff`, zemin `rgba(88,166,255,.05)`, radius `0 6px 6px 0`, padding `7px 11px`, sol dış boşluk `(depth+1) × 18px`.
  - Üst satır: hedef yol `code` 10.5px `#6e7681`; "Hedefe git" (10.5px `#58a6ff`, `1px solid #30363d`, radius 4px) → görüntüleyiciyi hedef düğüme odaklar ve dalları açar.
  - Alan listesi: `PaxID`, `PTC`, `GivenName`, `Surname` — anahtar `#ff7b72` (110px sabit), değer `#a5d6ff`, JetBrains Mono 12px.

### Ekran 6 — Yorumlar

**Amaç**: Alan bazlı tartışma; paylaşılan linkte iş birliği.

- Yorum düğmesi satır sonunda `💬` (yorum varsa `💬 {n}`, `#bc8cff`, kalıcı görünür; yoksa `opacity:.35`, hover'da belirginleşir).
- Tıklanınca satır altında konu kutusu: sol kenarlık `2px solid #bc8cff`, zemin `rgba(188,140,255,.05)`, radius `0 6px 6px 0`, padding `9px 12px`, sol dış boşluk `(depth+1) × 18px`.
  - Yorum: `22px` daire avatar (`rgba(188,140,255,.2)` zemin, `#bc8cff` baş harf, 11px/600) + yazar (11.5px/600 `#e6edf3`) + zaman (10.5px `#6e7681`) + gövde (12px `#8b949e`, `line-height:1.45`).
  - Boşsa: "Bu alana ilk yorumu siz bırakın." 11.5px `#6e7681`.
  - Giriş: input (`#0d1117`, `1px solid #30363d`, radius 6px, 12px, padding `6px 9px`, placeholder "Bu alana yorum yaz…") + "Gönder" (12px/600, `#0d1117` metin, `#bc8cff` zemin, radius 6px, padding `6px 14px`).
- Header'daki `💬 {toplam}` sayacı tüm yorumların toplamıdır; ileri/geri gezinme (`↑`/`↓`) mevcut üründeki gibi korunur.

### Ekran 7 — Paylaşım / salt okunur

**Amaç**: Linki üretmek ve alan kişinin ne yapabileceğini net söylemek.

- Header'da `🔒 salt okunur` rozeti; **sol editör paneli hiç render edilmez**.
- Header altında banner: zemin `rgba(88,166,255,.10)`, alt kenarlık `1px solid #21262d`, padding `9px 16px`, 12.5px `#58a6ff` — "Link kopyalandı — `jsoneyes.app/s/7f3a91`", yanında `#6e7681` ile "Açan herkes yorum bırakabilir, veriyi değiştiremez."; sağda "Kopyasını al ve düzenle" (`1px solid #30363d`, radius 6px).
- Geri kalan her şey (grid, referans, yorum) aynı; yalnızca düzenleme kapalı.

---

## Interactions & Behavior

- **Satır aç/kapat**: satıra tıklama container ise genişletir/daraltır ve o satırı seçer (sağ IATA paneli seçime göre güncellenir). Caret `▸ → ▾`.
- **Tümünü aç / Kapat**: ağacın tamamını açar (üst sınır ~5000 düğüm) veya köke döner.
- **Filtre (görünüm)**: 150–200 ms debounce; alan adı **veya** değer eşleşen satırlar ve onlara giden yol korunur (derin eşleşme). Sonuç sayacı input'un sağında.
- **Kolon sıralama (tablo)**: başlığa tıklama `asc ⇄ desc`; ikinci bir kolona tıklamak sıralamayı o kolona taşır (varsayılan `asc`). Sayısal kolonlar sayısal karşılaştırılır.
- **Kolon filtresi (tablo)**: her kolon için `contains`, büyük/küçük harf duyarsız; filtreler `AND` ile birleşir; "Filtreleri temizle" hepsini sıfırlar.
- **Referans**: rozet tıklaması önizlemeyi açar/kapatır (satır tıklamasıyla çakışmaması için `stopPropagation`). "Hedefe git" hedef yolu odaklar — hedefe giden tüm dallar açılır ve satır vurgulanır (`inset 2px 0 0 #58a6ff` + `rgba(88,166,255,.10)`).
- **Yorum**: `💬` konuyu açar/kapatır (`stopPropagation`); "Gönder" boş metinde no-op, gönderince taslak temizlenir ve yorum listeye eklenir.
- **Yol kopyalama**: breadcrumb'daki `⧉` seçili yolu panoya yazar; buton kısa süre "✓ kopyalandı" gösterir.
- **Hover durumları**: satır `#161b22`; ikon/buton hover'ları yukarıda her bileşende belirtildi; geçişler `transition: background .1s`.
- **Boş/yükleniyor/hata**: yükleme sırasında "Paylaşılan JSON yükleniyor…"; veri yoksa Ekran 1; ayrıştırma hatasında Ekran 2.
- **Klavye**: `⌘K` komut paleti (ara + komut), `⌘F` görünüm filtresi, `J/K` satır gezinme, `Enter/Shift+Enter` arama sonuçları arası, `Esc` aramayı temizler. (Komut paleti bu turda tasarlanmadı; kısayol ipucu alt çubukta duruyor.)
- **Responsive**: `< 1280px` sağ IATA paneli daraltılabilir/gizlenebilir; `< 1024px` sol editör sekmeye dönüşür. Grid kolonları `minmax()` ile esner, `Aksiyon`/`Değer` alanı asla taşmamalı.

## State Management

Mevcut Vue yapısına oturacak durum değişkenleri:

| Durum | Tip | Açıklama |
|---|---|---|
| `rawInput` / `parsedInput` | `string` | Editör metni; 200 ms debounce ile ayrıştırılır |
| `parsed` / `parseError` | `JsonValue \| null` / `string \| null` | Ayrıştırma sonucu |
| `viewMode` | `'tree' \| 'grid' \| 'table'` | Görünüm modu (yeni: `table`) |
| `expanded` | `Set<string>` | Açık satır yolları (grid) |
| `arrayTableMode` | `boolean` | Nesne dizileri tablolaşsın mı |
| `filterText` | `string` | Görünüm filtresi (debounce 150 ms) |
| `selectedPath` | `string \| null` | Seçili düğüm — sağ panel ve breadcrumb kaynağı |
| `focusRequest` | `{ path, seq }` | Odak isteği; `seq` tekrar tetiklemeyi garanti eder (mevcut çözüm korunmalı) |
| `refOpenPath` | `string \| null` | Açık referans önizlemesi |
| `openThreadPath` | `string \| null` | Açık yorum konusu |
| `tableSort` | `{ col: string, dir: 'asc' \| 'desc' }` | Tablo sıralaması |
| `columnFilters` | `Record<string, string>` | Kolon filtreleri |
| `pinnedPaths` | `string[]` | (Opsiyonel, Tur 2'den) sabitlenen alanlar |
| `shareId` / `shareUrl` / `sharedTitle` | `string \| null` | Paylaşım durumu; `shareId` varsa salt okunur |
| `annotation` | `AnnotateResponse \| null` | `POST /annotate` yanıtı (400 ms debounce) |

Veri ihtiyaçları mevcut `src/api.ts` ile aynı: `annotateJson(json)`, `createShare(json, title, commentsEnabled)`, `getShare(id)`, yorum uçları (`useComments`).

## Design Tokens

Mevcut `src/styles/index.css` değişkenleri **değişmedi**; tasarım bunların üzerine kuruludur.

**Yüzeyler / kenarlıklar**
| Token | Değer |
|---|---|
| `--bg-primary` | `#0d1117` |
| `--bg-secondary` | `#161b22` |
| `--bg-tertiary` | `#21262d` |
| `--bg-hover` | `#30363d` |
| `--border` | `#30363d` |
| `--border-subtle` | `#21262d` |

**Metin**
| Token | Değer |
|---|---|
| `--text-primary` | `#e6edf3` |
| `--text-secondary` | `#8b949e` |
| `--text-muted` | `#6e7681` |

**Aksan / durum**
| Token | Değer |
|---|---|
| `--accent` | `#58a6ff` |
| `--accent-dim` | `rgba(88,166,255,.15)` |
| `--green` | `#3fb950` |
| `--orange` | `#d29922` |
| `--purple` | `#bc8cff` |
| `--red` | `#ff7b72` |
| `--pink` | `#f78166` |
| `--cyan` | `#79c0ff` |

**JSON tip renkleri (metin / rozet zemini)**
| Tip | Metin | Rozet zemini |
|---|---|---|
| string | `#a5d6ff` | `rgba(165,214,255,.12)` |
| number | `#f78166` | `rgba(247,129,102,.12)` |
| boolean | `#79c0ff` | `rgba(121,192,255,.12)` |
| null | `#6e7681` | `rgba(110,118,129,.12)` |
| object | `#bc8cff` | `rgba(188,140,255,.12)` |
| array | `#3fb950` | `rgba(63,185,80,.12)` |
| key (alan adı) | `#ff7b72` | — |

**Aydınlık tema** (Tur 2'de tasarlandı, opsiyonel — uygulanacaksa aynı token isimleriyle)
`--bg-primary #ffffff` · `--bg-secondary #f6f8fa` · `--bg-tertiary #eaeef2` · `--border #d0d7de` · `--border-subtle #eaeef2` · `--text-primary #1f2328` · `--text-secondary #656d76` · `--text-muted #8c959f` · `--accent #0969da` · `--green #1a7f37` · `--orange #9a6700` · `--purple #8250df` · `--red #cf222e`; tip renkleri: string `#0a3069`, number `#953800`, boolean `#0550ae`, null `#6e7781`, object `#8250df`, array `#1a7f37`.

**Tipografi**
- UI: `Inter, system-ui, sans-serif` — 10px / 10.5px / 11px / 11.5px / 12px / 12.5px / 13px / 13.5px / 15.5px (logo) / 17px (ekran başlığı); ağırlıklar 400 / 500 / 600 / 700; `line-height: 1.5` (metin blokları 1.45–1.6).
- Kod ve veri: `'JetBrains Mono', monospace` — 10.5px / 11px / 11.5px / 12px / 12.5px / 13px; kod listesi `line-height: 1.75`.
- Uppercase etiketler: 10px–11px, `font-weight: 600`, `letter-spacing: .5px`.

**Boşluk ölçeği**: 2 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 12 · 14 · 16 · 18 · 22 · 26 · 40 · 48 px. Girinti adımı **18px/derinlik** (grid), sakin varyantta 22px.

**Köşe yarıçapı**: 4 (rozet) · 5 (küçük input) · 6 (buton/chip) · 7 (segment) · 8 (kart/kutu) · 9 (arama) · 10–20 (pill) · 12 (uygulama çerçevesi) · 14 (bırakma alanı) · 50% (avatar/nokta).

**Gölge / vurgu**: gerçek gölge yok. Seçim vurgusu `box-shadow: inset 2px 0 0 <accent>` + `rgba(<accent>,.10)` zemin. Kod paneli alt solma: `-webkit-mask-image: linear-gradient(#000 88%, transparent)`.

**Kenarlık kalınlıkları**: 1px (tüm ayraçlar), 2px (referans/yorum kutusu sol şeridi), 3px (IATA eşleşme halkası).

## Assets

- **Logo**: satır içi SVG (yukarıda tam geometri verildi). Ayrı dosya yok; `public/favicon.svg` bu göz ikonuyla güncellenmeli.
- **İkonlar**: tamamı satır içi SVG (arama büyüteci, tree/grid) veya metin glifi (`▸ ▾ ⌕ ⧉ ⌾ ↳ ⓘ ● × ↑ ↓ ⇅ ☾ ☀ 💬 🔒`). Glifleri korumak isterseniz sistem emoji/sembol yeterlidir; kurumsal bir ikon setine geçilecekse `💬` ve `🔒` öncelikli değiştirilmelidir.
- **Fontlar**: Google Fonts — `Inter` (400/500/600/700) ve `JetBrains Mono` (400/500/600/700). Mevcut uygulama zaten bu aileleri kullanıyor.
- **Görsel yok**: tasarımda fotoğraf/illüstrasyon kullanılmadı.

## Files

- `JSON Eyes - Full Flow.dc.html` — tüm tasarım turlarını içeren tek dosya. **Uygulanacak olan: `#5a` (TUR 5)** — 7 adımlı tam akış, etkileşimli. Adım şeridindeki butonlarla ekranlar arasında geçilir.
  - Aynı dosyadaki diğer turlar bağlam içindir: **Tur 1** mevcut ürünün birebir kopyası (`#1a`) ve iki grid denemesi (`#1b`, `#1c`); **Tur 2** iki temalı tam yenileme (`#2a` karanlık, `#2b` aydınlık) — aydınlık tema tokenlarının kaynağı; **Tur 3** sade grid (`#3a`, `#3b`) — Tur 5'in temeli; **Tur 4** minimal "sakin" alternatif (`#4a`, `#4b`) — uygulanmayacak.
- `support.js` — prototip çalışma zamanı. **Üretime alınmaz.**
- Kaynak kod referansı (kullanıcının kendi deposunda): `frontend/src/App.vue`, `frontend/src/components/JsonGrid.vue`, `frontend/src/components/GridRow.vue`, `frontend/src/components/IataPanel.vue`, `frontend/src/components/CommentThread.vue`, `frontend/src/components/FieldDocCard.vue`, `frontend/src/components/InfoBubble.vue`, `frontend/src/styles/index.css`, `frontend/src/utils/{json,search,references,injection}.ts`, `frontend/src/composables/useComments.ts`, `frontend/src/api.ts`.

## Implementation notes

- `JsonGrid.vue` / `GridRow.vue` bugünkü özyinelemeli yapısını koruyabilir; eklenecekler: **XSD işareti**, **referans satırı**, **yorum satırı** (zaten var), **dizi → tablo** dalı ve **sanallaştırma**.
- Dizi tablosu için ayrı bir `ArrayTable.vue` bileşeni önerilir: `props: { items, path }`, kolonları `items`in skaler anahtarlarının birleşiminden üretir, sıralama/filtre durumunu kendi içinde tutar.
- Sanallaştırma: `@tanstack/vue-virtual` veya benzeri; ağacı önce düz bir satır listesine (`flattenTree`) çevirip pencerelemek en basit yoldur — mevcut özyinelemeli render bunu engeller, bu yüzden düzleştirme refactor'ı planlanmalı.
- Erişilebilirlik: caret ve rozetler gerçek `<button>` olmalı (`aria-expanded`, `aria-label`); sessiz gri tonlar en az 3:1 kontrast; odak halkası `2px solid var(--accent)`.
