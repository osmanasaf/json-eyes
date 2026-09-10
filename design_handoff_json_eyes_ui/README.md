# Handoff: JSON EYES — ön yüz yenilemesi

## Overview
JSON EYES'ın ön yüzünü yeniliyoruz. Mevcut arayüzde üç somut şikâyet var: **grid** iç içe
tablolarla kullanışsız, **fark** görünümü okunmuyor, **girdi paneli** işlevsel değil. Kolon
görünümü sevildi, korunuyor. Bu paket yeni arayüzün tam davranışını ve ölçülerini tanımlar.

Hedef kod tabanı: `frontend/` — **Vue 3 + TypeScript (`<script setup>`)**, CSS değişkenleri
`src/styles/index.css` içinde, iş mantığı `src/utils/*.ts` içinde. Yeni tasarım bu yapıyla
uyumlu; aşağıda hangi dosyanın neye karşılık geldiği tek tek yazıyor.

## About the Design Files
Bu pakette bulunan `JSON EYES - Yeni On Yuz.dc.html` ve `Mevcut UI (birebir).dc.html`
dosyaları **HTML ile üretilmiş tasarım referanslarıdır** — hedeflenen görünümü ve davranışı
gösteren prototiplerdir, üretime kopyalanacak kod değildir. Bu dosyalar tek dosyalık bir
prototip runtime'ı kullanır (inline stiller, tek sınıf içinde durum) ve bilinçli olarak
üretim mimarisine benzemez.

Görev: **bu tasarımları mevcut Vue 3 + TS kod tabanında, o kod tabanının kendi
desenleriyle yeniden kurmak** — SFC bileşenleri, `src/styles/index.css` içindeki CSS
değişkenleri (inline stil değil), `src/utils/*` içindeki saf fonksiyonlar. Prototipteki
JavaScript mantığı (diff eşleştirme, XML çevirme, JSON onarma, referans indeksi) kod
tabanında zaten `utils/` altında mevcut; onları yeniden yazma, gerekiyorsa genişlet.

Prototipi tarayıcıda açıp her ekranı tıklayarak gezin — statik ekran görüntüsü değil,
çalışan bir prototiptir. Tereddütte kalınan her yerde **prototipin davranışı esas alınır**.

## Fidelity
**High-fidelity (hifi).** Renkler, tipografi, ölçüler ve etkileşimler nihaidir; birebir
uygulanmalı. Tek istisna: prototip 1440×900 sabit tuvalde çizildi; üretimde düzen akışkan
olmalı (aşağıdaki "Responsive" bölümü).

---

## Design Tokens

Prototip aydınlık temayı gösteriyor. Kod tabanında iki tema tek token setinden okuyor
(`src/styles/index.css`); aşağıdaki değerleri **aydınlık tema token'larına** yaz, karanlık
tema karşılıklarını mevcut mantıkla üret.

### Renkler — yüzeyler
| Rol | Hex | Kullanım |
|---|---|---|
| `--bg-app` | `#f4f3f0` | uygulama zemini, orta bölge |
| `--bg-chrome` | `#fbfaf8` | header, footer, sol panel, sağ panel, tablo araç çubuğu |
| `--bg-data` | `#ffffff` | tablo gövdesi, editör metin alanı, ağaç gövdesi |
| `--bg-subtle` | `#f0efe9` | tablo başlık satırı, hover zemini, banner |
| `--bg-inset` | `#eeece7` | görünüm anahtarı yuvası, ilerleme çubuğu boşluğu |
| `--bg-nested` | `#fbfaf8` | 2. seviye iç tablo zemini |
| `--bg-cell-open` | `#f7f6f2` | açık hücre zemini |

### Renkler — çizgiler
| Rol | Hex | Kullanım |
|---|---|---|
| `--line-strong` | `#d4d2ca` | tablo dış çerçevesi, başlık alt çizgisi |
| `--line` | `#e2e0d9` | panel ayırıcıları, header alt çizgisi |
| `--line-soft` | `#e6e4de` | kırıntı şeridi alt çizgisi |
| `--line-cell` | `#eceae4` | tablo satır/hücre çizgileri |
| `--line-cell-head` | `#e4e2db` | başlık hücre ayırıcıları |
| `--line-panel` | `#eae8e2` | panel içi ayırıcılar |
| `--line-nested` | `#dcdad3` | iç tablo çerçevesi |

### Renkler — mürekkep
| Rol | Hex | Kontrast notu |
|---|---|---|
| `--ink` | `#1b1d1e` | birincil metin, değerler |
| `--ink-2` | `#4a4e50` | anahtarlar, ikincil eylemler |
| `--ink-3` | `#6f7376` | meta, araç çubuğu bilgisi |
| `--ink-4` | `#7a7d79` | pasif sekme, ipucu |
| `--ink-5` | `#82868a` | satır numarası olukları, kopya ikonu — **bundan daha soluk gri kullanma** |
| `--ink-row` | `#7d8184` | tablo satır indeksi, `null` değeri |
| `--ink-empty` | `#b6b8b3` | `—` (alan yok) işareti |

### Renkler — anlam
| Rol | Hex | Kullanım |
|---|---|---|
| `--accent` | `#2f6f5e` | seçim, aktif sekme, birincil düğme zemini, referans oku |
| `--accent-sel-bg` | `rgba(47,111,94,.07)` | seçili satır zemini |
| `--accent-sel-bar` | `inset 2px 0 0 #2f6f5e` | seçili satır sol şeridi |
| `--accent-soft` | `rgba(47,111,94,.08)` | kolon görünümünde seçili giriş |
| `--added` | `#2c6b45` | fark: eklendi |
| `--added-bg` | `rgba(44,107,69,.07)` | fark: B tarafı zemini |
| `--removed` | `#a3382f` | fark: silindi, JSON hatası, "düzelt" düğmesi |
| `--removed-bg` | `rgba(163,56,47,.07)` | fark: A tarafı zemini |
| `--removed-bg-soft` | `rgba(163,56,47,.05)` | editör hata durumu şeridi |
| `--changed` | `#8a5a00` | fark: değişti; şemada olmayan alan işareti |
| `--changed-bg` | `rgba(138,90,0,.09)` | değişen alan zemini (isteğe bağlı) |
| `--search-hit` | `rgba(214,180,60,.16)` | arama eşleşen satır zemini |
| `--type-number` | `#7a4a12` | sayı değerleri |
| `--type-boolean` | `#2f5fa8` | boolean değerleri; "tahmini eşleşme" etiketi |
| `--link` / `--link-hover` | `#2f6f5e` / `#21514a` | bağlantılar |

### Tipografi
- Tek aile: **JetBrains Mono**, ağırlıklar 400/500/600. Google Fonts:
  `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap`
- Yedek zincir: `ui-monospace, monospace`.
- `line-height: 1.5` gövde; `-webkit-font-smoothing: antialiased`.
- Ölçek (px): `13` marka/başlık · `12.5` tablo değeri · `12` ağaç ve girdi metni ·
  `11.5` anahtar, sekme, iç tablo değeri · `11` meta, düğme, kolon içeriği ·
  `10.5` etiket, satır numarası · `10` küçük işaret · `9`–`8` caret ve sıralama oku.
- Etiketlerde `letter-spacing: .4px`, marka adında `.3px`. **Büyük harfe çevirme yok**
  (mevcut UI'daki `text-transform: uppercase` etiket dili kaldırıldı).

### Ölçüler
- Yarıçap: `6px` düğme/girdi/panel, `4px` küçük kutu; tablolar **köşesiz** (`0`).
- Gölge: yalnız açılır menüde — `0 14px 30px rgba(27,29,30,.12)`.
- Yükseklikler: header `46px`, banner `31px`, kırıntı `32px`, yol satırı `25px`,
  panel sekme çubuğu `33px`, tablo araç çubuğu `32px`, fark A/B başlığı `27px`,
  footer `25px`.
- Editör satır yüksekliği `19px` (oluk hizası buna bağlı), oluk genişliği `42px`.
- Sağ panel `272px` sabit; sol panel `344px` **varsayılan, sürüklenebilir 210–760px**.
- Kapalı panel şeritleri `24px`.
- Scrollbar: `9px`, thumb `#d6d4cd` → hover `#bdbab2`, track saydam, yarıçap `5px`.

---

## Screens / Views

### 0. Kabuk (her ekranda)

**Header** (`46px`, `--bg-chrome`, alt `1px --line`), soldan sağa:
1. **Marka** `JSON EYES` — "JSON" `--ink` 13px/600, "EYES" `--ink-4` 400. Düğme; tıklayınca
   veri boşaltılır ve boş duruma dönülür.
2. **Dosya durumu** — `5px` daire (`--added` geçerli / `--removed` geçersiz) + dosya adı
   12px `--ink-2`, `max-width:180px` ellipsis. Veri yokken görünmez.
3. **Arama** (esnek, ortada, `320px`): `⌕` + input + sağda ipucu. Çerçeve yok, yalnız alt
   çizgi: boşken `--line`, doluyken `--accent`. Placeholder "alan veya değer ara".
   Sağdaki metin boşken `⌘K`, doluyken "eşleşenler işaretli".
4. **Tema anahtarı** `☀` — 12px `--ink-4`, çerçevesiz.
5. **Görünüm anahtarı** — `--bg-inset` yuva, `2px` iç boşluk, `6px` yarıçap. Sırası
   **kesin: `Tree · Grid · Kolon`**. Aktif: `#ffffff` zemin + `--ink`; pasif `--ink-4`.
   **Fark ve XML burada olmaz** — ikisi de sol panelde yaşar.
6. **Paylaş** — çerçeveli ikincil düğme (`1px --line`, `6px`, hover `--bg-inset`).

**Paylaş menüsü** (`270px`, header'a `34px` altında, sağa hizalı): başlık input'u,
"alan yorumlarına açık" onay satırı (`14px` kutu, seçili `--accent` zemin + beyaz `✓`),
açıklama metni (`11px --ink-3`), "Link oluştur" birincil düğmesi (`--accent`, beyaz metin).

**Banner** (`31px`, `--bg-subtle`) — paylaşım linki ya da tema notu. Sol: küçük etiket
(`11px --ink-4`), sonra içerik, sonra not. Sağ: "kopyala" (tıklayınca "kopyalandı") ve `×`.

**Kırıntı şeridi** (`32px`, `--bg-app`): `json › Response › Order › 11 › TotalPrice`.
Ayırıcı `›` `#82868a` 10px. Son parça `--ink`, öncekiler `--ink-4`, hepsi tıklanır ve o
düğüme gider (yol üzerindeki tüm düğümler açılır). Bir dizi öğesindeyken hemen sağda
**kardeş gezinme**: `‹ 12/12 ›` — aynı alanda önceki/sonraki kayda atlar.

**Yol satırı** (`25px`, kırıntının hemen altında, sola hizalı): seçili alanın **canlı
JSONPath ifadesi** — `$.IATA_OrderViewRS.Response.Order[2].StatusCode` (sayısal segment
`[n]`, diğerleri `.ad`). `10.5px --ink-2`, ellipsis. Yanında `⧉` `--ink-5`. Tümü tek
düğme: tıklayınca ifade panoya kopyalanır, işaret `✓ kopyalandı` (`--accent`) olur ve
**1600ms sonra kendi kendine geri döner**. (Eski "yolu kopyala" etiketli düğme kaldırıldı.)

**Footer** (`25px`): sol `N node`, `ayrıştırma N ms`; sağ senkron durumu —
`satır 214 · json.IATA_OrderViewRS…` ya da "grid ↔ json senkron".

---

### 1. Sol panel — Girdi (`Girdi · Fark · Geçmiş`)

`344px` varsayılan, `--bg-chrome`, sağ kenarında `1px --line`.

**Yeniden boyutlandırma (yeni):** panelin sağ kenarında `7px` genişlikte, tam yüksekte,
`cursor: col-resize` bir tutamaç var (`position:absolute; right:-3px`). Basılı tutup
sürüklerken genişlik `210–760px` arasında güncellenir; sürükleme sırasında tutamaç
`--accent` renginde görünür. **Çift tıklama `344px`'e sıfırlar.** Uygulama açılışında panel
**açık** başlar; sekme çubuğundaki `‹` ile kapanır, kapanınca yerinde dikey `GİRDİ`
yazan `24px` şerit kalır, tıklayınca geri açılır. (Genişliği `localStorage`'a yazmak
serbest — prototipte oturum içi tutuluyor.)

**Sekme çubuğu** (`33px`): `Girdi`, `Fark`, `Geçmiş` — aktif olanın altında `1px --accent`
çizgi ve `--ink` metin; pasif `--ink-4`. Sağda panel kapatma `‹`.

#### 1a. Girdi sekmesi
- **Biçim satırı** (`32px`): `JSON` | `XML` — aktif `--ink`, pasif `--ink-5`. Sağda
  `N satır`. XML seçilince metin alanı XML tohumuyla dolar; **XML ayrı bir üst sekme
  değil, girdinin bir biçimi.**
- **Eylem satırı** (`31px`), hepsi çerçevesiz metin düğme (`11px --ink-2`, hover `--ink`):
  `biçim` · `küçült` · `yapıştır` · `örnek` — sağda `canlı`/`elle` anahtarı (aktifken
  `--accent`), elle modda değişiklik varsa `uygula` birincil düğmesi, en sağda `temizle`
  (`--ink-5`, hover `--removed`).
- **Editör** (esnek): solda `42px` satır numarası oluğu (`--bg-chrome`, sağ `1px
  --line-panel`), sağda `textarea` (`--bg-data`, `11.5px`, `line-height:19px`,
  `white-space:pre`). Oluk textarea'nın `scrollTop`'una **senkron** kaydırılır.
  Hatalı satırın numarası `--removed` + `rgba(163,56,47,.10)` zemin; **GridSync ile seçilen
  satır** `--accent` + `rgba(47,111,94,.12)` zemin.
- **Durum satırı**: geçerliyken `geçerli · 4.412 node · 3 ms` (`--ink-2`), hatalıyken
  ayrıştırıcı mesajı + `· satır N` (`--removed`, zemin `--removed-bg-soft`) ve sağda
  **`düzelt`** düğmesi (`--removed` zemin, beyaz metin) — tek tıkla yorumları, sondaki
  virgülleri ve tek tırnakları onarır (`utils/repair.ts`).
- **XML modunda** durum satırı çeviri özetini gösterir (`kök: … · öznitelikler @ad,
  tekrarlar dizi`) ve sağda **`JSON'a çevir`** bulunur; altta iki anahtar: `ad alanı
  önekleri`, `sayıya çevir` (aktif `--accent`). Çevir'e basınca sonuç veri olarak yüklenir,
  yol kökten kurulur ve Grid'e geçilir.

#### 1b. Fark sekmesi (iki JSON da elle girilebilir)
- **A bloğu**: `A` etiketi + kaynak adı + sağda `girdide düzenle` (A'yı ana editöre alır).
  Altında `96px` yüksekliğinde, `resize: vertical` bir `textarea` (placeholder
  "A tarafı JSON"). Çerçeve geçerliyken `--line`, geçersizken `--removed`.
- **B bloğu**: aynı yapı + sağda `yapıştır` (panodan okur). Altında `ya da B'yi geçmişten
  seç` ve geçmiş listesi (seçili olanın zemini `--accent-soft`, noktası `--accent`).
- Her iki kutunun altında canlı durum: `geçerli · 214 satır` (`--ink-3`) ya da
  `geçersiz · satır 37` (`--removed`).
- **Özet**: `N eklendi` / `N silindi` / `N değişti` — her biri `74px` etiket + `4px`
  yüksek oran çubuğu (`--added` / `--removed` / `--changed`, boşluk `--bg-inset`).
  Altında not: diziler kimliğe göre eşleşti (Order → OrderID), sıra değişikliği fark
  sayılmaz. Bir taraf geçersizken not bunu söyler ve son geçerli hâl gösterilir.
- **Gezinme satırı**: `yalnız değişenler` anahtarı (aktif `--accent`), `↑ N/M ↓`
  değişiklikler arası atlama (hedef satırı görünür kılacak şekilde kaydırır),
  `A↔B` yer değiştirme. En altta `← karşılaştırmayı kapat`.
- **Fark canlıdır**: iki kutunun içeriği her değişiklikte yeniden ayrıştırılır ve
  `utils/diff.ts` yeniden çalıştırılır. Girdi uzunluğu + baş 64 karakter üzerinden
  memoize edilir; büyük girdide her tuş vuruşunda tam diff çalıştırmayın.

#### 1c. Geçmiş sekmesi
Son açılan dosyalar listesi: ad (`12px --ink`) + meta (`11px --ink-4`), satır hover
`--bg-subtle`, `6px` yarıçap, çerçevesiz.

---

### 2. Grid (ana görünüm — en kritik ekran)

**Şikâyet:** eski grid iç içe tablolarla ve dolu araç çubuğuyla kullanışsızdı. **Yeni
model: gerçek ızgara.** Hücreler kendi içinde açılıyor, satır listesi değil.

**Araç çubuğu** (`32px`, `--bg-chrome`): `⊞ tümünü aç` · `⊟ tümünü kapat` · `CSV` —
ikonlar `9px --ink-3`, etiketler `11px --ink-2`. Sağda tek meta: `12 satır · 8 kolon`.
**Filtre düğmesi burada yok** (bilinçli olarak tablonun içine taşındı).

**Tuval**: `--bg-app` zemin, `12px 14px 28px` iç boşluk; tablo `inline-block`, `1px
--line-strong` çerçeve, `--bg-data` zemin — yani tablo sayfada duran bir nesne, tam
genişliği kaplayan bir liste değil.

**Görüntülenen düğüm** kırıntı yolundaki düğümdür. İki şekil:

**(a) Kayıt dizisi → kolon başlıklı tablo**
- **Başlık satırı** (`--bg-subtle`, alt `1px --line-strong`): sol köşe hücresi `44px` ve
  **filtre anahtarıdır** — `▽` kapalı / `▼` açık, `--accent` aktifken. Sonra her kolon:
  ad (`11px`) + sıralama oku (`8px --accent`) + sağda şema işareti (`9px`): şemada varsa
  işaret yok, tahmini `≈`, karşılığı yoksa `●` (`--changed`).
- Kolon başlığına tıklama sıralamayı döngüler: `asc → desc → kapalı`. Aktif kolonun
  başlık zemini `#e8e7e0`, metni `--ink`.
- **Filtre satırı** (yalnız açıkken, `--bg-chrome`): her kolon altında "içerir" input'u —
  çerçevesiz, yalnız alt çizgi (dolu `--accent`, boş `--line`), `box-sizing: border-box`
  (kırpılmayı önler). Filtreler kesişimle uygulanır, `pk::kolonAdı` anahtarıyla saklanır.
- **Satırlar**: sol `44px` indeks hücresi (`--ink-row`; seçiliyken `--accent`), sonra
  hücreler. Satır çizgileri `1px --line-cell`. Seçili satır: `--accent-sel-bg` +
  `--accent-sel-bar`. Arama eşleşen satır: `--search-hit`.
- **Kolon genişliği içeriğe göre hesaplanır**: `min(310, max(90, karakter*8+30))`,
  başlık adı + o kolondaki en geniş hücre içeriği baz alınır; açık iç tablo varsa kolon
  o tabloyu saracak kadar genişler. Tüm hücreler kolon genişliğine kilitlenir.

**(b) Nesne → anahtar/değer tablosu**
Başlık satırı yok. Sol kolon anahtar (`--ink-2`; şemada olmayan alan adının yanında `●`),
sağ kolon değer. Genişlikler yine içerikten hesaplanır.

**Hücre içeriği**
- *Skaler*: metin, tipe göre renk (`--ink` string, `--type-number` sayı sağa hizalı,
  `--type-boolean` boolean, `--ink-row` null). Alan yoksa `—` (`--ink-empty`).
- *Referans* (`*RefID` ve hedefi indeks*te var): değerden sonra `↳` (`10px --accent`).
  Tıklama hedef kaydı sağ panelde açar (tweak ile satır içinde açılabilir).
- *Nesne/dizi → açılabilir kutu*: `+ {2}` / `+ [3]` biçiminde düğme (işaret `10px
  --ink-3`, etiket `11.5px --ink-2`). Tıklayınca **hücrenin içinde** tam bir alt tablo
  açılır: `1px --line-nested` çerçeve, `--bg-nested` zemin, `0 5px 6px` kenar boşluğu;
  kendi başlık satırı, sıralaması ve satırları vardır. İşaret `−` olur, tekrar tıklama
  kapatır.
- **Üç seviye** iç içe açılır (0/1/2). Daha derin bir düğümde etiket
  `{5} → yolu aç` olur ve tıklama o düğüme geçer (kırıntı oraya taşınır) — sonsuz iç içe
  açılma yok. İç seviyelerde satır penceresi `12`, tipografi bir kademe küçülür
  (`11px` / `10.5px`), iç boşluklar `4px 8px` → `3px 7px`.
- Alt tablo açıkken hücre zemini `--bg-cell-open`.

**Satır penceresi**: kök tabloda ilk `pageSize` satır (varsayılan 50) çizilir; fazlası
`N satır daha var · M seyrek kolon gizli` notuyla altta belirtilir.

**Seyrek kolonlar**: kolon sayısı 4'ten fazlaysa doluluk oranı `< %30` olan kolonlar
gizlenir, sayısı not satırında yazılır (tweak ile kapatılabilir).

**GridSync (kritik davranış)**: herhangi bir hücre/satır/anahtara tıklandığında
1. seçim o yola taşınır (sol şerit + zemin),
2. sağdaki IATA paneli o alanın dokümantasyonunu gösterir,
3. **sol editördeki JSON o alanın satırına kaydırılır** ve satır numarası vurgulanır,
4. footer `satır N · $.yol` yazar.
Bunun için JSON'u serialize ederken **yol → satır numarası** haritası üretilmeli
(prototipte `serializeWithMap`; `2` boşluk girinti, `JSON.stringify` ile birebir aynı
metin). Kaydırma hedefi: `(satır-1) * 19 - 130`, oluk aynı `scrollTop`'a ayarlanır.
**`scrollIntoView` kullanma** — doğrudan `scrollTop` ata.

**CSV**: görüntülenen kayıt dizisinin kolonlarını başlık, satırları veri olarak dışa
aktarır (Blob + `download`).

---

### 3. Tree
`⊞ tümünü aç` / `⊟ tümünü kapat` + sağda `N açık satır`. Gövde `--bg-data`.
Her satır: caret (`▾`/`▸`, yaprakta `·`, `10px --ink-5`), anahtar (`12px --ink-2`,
yaprakta `anahtar:`), değer — kapsayıcıda `{4}` / `[12]` (`--ink-5`), yaprakta tipe göre
renkli (string `"..."` tırnaklı). Şemada olmayan alanda sonda `şemada yok` (`10.5px
--ink-5`). Girinti `14 + derinlik*17` px. Seçili satır grid ile aynı vurgu. Satıra
tıklama seçer (GridSync tetikler), carete tıklama açar/kapatır.

### 4. Kolon (korunuyor, yalnız yeni palete taşındı)
Üstte klavye ipuçları (`↑ ↓ kardeşler`, `→ içine gir`, `← üst seviye`), `30px`,
`11px --ink-4`. Yatay kaydırılan `224px` sabit genişlikte sütunlar, aralarında `1px
--line`. Sütun başlığı `28px`: düğüm adı + sağda öğe sayısı. Girişler: anahtar
(`11.5px`, seçili `--ink`), sağda özet (`N öğe` / `N alan` / değer), kapsayıcıda `›`.
Seçili giriş `--accent-soft` + `--accent-sel-bar`. Son sütun zemini `--bg-chrome`,
diğerleri `--bg-data`. **Üst sütunda gezinirken alt yol korunur.**

### 5. Fark (orta bölge)
Sol panelde Fark sekmesi aktifken orta bölge yan yana A/B'ye döner.
- **A/B başlığı** (`27px`, `--bg-chrome`): iki eşit yarı, ortada `1px --line` ayırıcı;
  her yarıda `A`/`B` etiketi (`10.5px --ink-5`) + kaynak adı.
- **Satırlar** (`min-height:24px`), **hizalı**: aynı yol her iki tarafta aynı satırda.
  Her yarıda: işaret (`9px`; A tarafında `−`/`~` `--removed`, B tarafında `+`/`~`
  `--added`), girinti (`derinlik*14`px), anahtar, **kayıt kimliği notu**
  (`11px #55595c` — `ORD100003`, `PAX3`, `sıra 4 → 5`; dekorasyon değil, hangi kaydın
  değiştiğini söyler), sonra değer.
- Zeminler: silinen/değişen A tarafı `--removed-bg`, eklenen/değişen B tarafı
  `--added-bg`. Kapsayıcı ve değişmemiş satırlar `--ink-5` ile sakin kalır.
- Geçerli değişiklik satırında sol şerit `--accent-sel-bar`.
- `yalnız değişenler` açıkken **yalnız değişen yapraklar ve onlara giden dallar** kalır
  (değişmemiş dallar tamamen düşer) — mevcut UI'daki en büyük fark şikâyeti buydu.

### 6. IATA paneli (sağ, `272px`) — kapatılabilir (yeni)
- **Başlık** (`33px`): `IATA 24.4` etiketi, sağda eşleşme oranı (`OrderViewRS · %86
  eşleşme`), sonra **`×`**. Kapanınca yerinde dikey `IATA` yazan `24px` şerit kalır,
  tıklayınca geri açılır.
- **Referans kartı** (varsa, en üstte, `--bg-data`): `referans` etiketi + `×`, hedef
  kaydın başlığı, alan/değer listesi (`98px` etiket kolonu), altta `hedefe git →`
  (tıklayınca o düğüme gider ve seçer).
- **Alan dokümantasyonu**: alan adı (`13px --ink`), altında XSD tipi ve durum —
  `şemada var` (`--added`), `tahmini eşleşme` (`--type-boolean`), `karşılığı yok`
  (`--changed`). Sonra açıklama (`11.5px --ink-2`, `line-height:1.55`,
  `text-wrap: pretty`), altta tam yol (`10.5px --ink-5`, `word-break: break-all`).
- **Değer dağılımı**: başlık `TotalPrice.CurCode dağılımı`; her değer için ad + adet ve
  `4px` yüksek çubuk (`#8c9a93`, boşluk `--bg-inset`), orana göre genişlik.
- **Şemada yok** listesi: `●` (`--changed`) + alan yolu; tıklayınca o alana gider
  (yol açılır, Grid'e geçilir, alan seçilir).
- **Yorumlar** (yalnız paylaşım linki oluşturulmuş ve yorumlar açıksa, en altta,
  `max-height:250px`): `yorumlar` + son iki yol parçası; her yorum sol `1px --line-strong`
  çizgi + `9px` iç boşluk, yazar (`11px --ink`) + zaman (`10.5px --ink-5`) + gövde
  (`11.5px --ink-2`). Altta input + `gönder` birincil düğmesi.

### 7. Boş durum
Ortada: tek satır açıklama (`13px --ink-4`), `500px` genişlikte kesikli çerçeveli
(`1px dashed #cdcbc4`, `10px`) bırakma alanı — içinde "dosyayı buraya bırak · .json ya da
.xml", `Örneği aç` (birincil) ve `Panodan yapıştır` (ikincil) düğmeleri. Altında son
açılanlar listesi (satır hover `--bg-inset`). **Veri yokken sol panel ve sağ panel
gizlenir, kırıntı ve yol satırı da gizlenir.**

---

## Interactions & Behavior
- **Görünüm anahtarı**: Tree/Grid/Kolon — Fark ve XML buraya asla eklenmez.
- **Grid hücre açma/kapama**, üç seviye; dördüncüde yola geçiş.
- **Sıralama**: kolon başlığı asc → desc → kapalı. Sıralama düğüm başına saklanır
  (`pk` = yol), iç tabloların kendi sıralaması olur.
- **Filtre**: tablo köşesindeki `▽` ile açılır, kolon başına "içerir" araması, kesişim.
- **Arama** (header): eşleşen satırlar `--search-hit` ile işaretlenir; satır gizleme yok.
- **Panel yeniden boyutlandırma**: `mousedown` → `mousemove`/`mouseup` window dinleyicileri,
  `210–760px` sınır, çift tıkla `344px`. `mousedown` üzerinde `preventDefault` (metin
  seçimini engeller). Vue'da `onBeforeUnmount` içinde dinleyicileri temizle.
- **Canlı ayrıştırma**: `canlı` modda her tuş vuruşunda ayrıştırılır ve görünüm güncellenir;
  `elle` modda `uygula`ya basılana kadar bekler ("büyük dosyada donma" şikâyetinin çözümü —
  büyük girdide varsayılanı `elle`ye çekmek serbest).
- **Otomatik düzelt**: yorum kaldırma, sondaki virgül, tek tırnak → çift tırnak.
- **Kopyalama geri bildirimi**: yol satırı `✓ kopyalandı` → 1600ms sonra geri döner;
  paylaşım "kopyala" → "kopyalandı".
- **Klavye** (mevcut kod tabanındaki kısayollar korunur): kolon görünümünde `↑↓→←`,
  `⌘K` arama. Yeni tasarım klavye sözleşmesini değiştirmiyor.

## State Management
Mevcut `App.vue` + composable yapısı korunabilir. Gereken durum:
`view` (tree|grid|columns) · `tab` (input|diff|history) · `inputKind` (json|xml) ·
`text` / `data` / `err` / `parseMs` · `live` · `dirty` · `editorOpen` · **`editorW`** ·
`sideOpen` · `path[]` · `sel[]` · `activeLine` · `open{}` (yol → açık) · `sort{}`
(yol → {col,dir}) · `filters{}` (`yol::kolon` → metin) · `filtersOn` · `query` ·
`peek` (referans kartı) · `inlineRef` · `textA` / `textB` (fark girdileri) · `diffOnlyChanges` ·
`diffIdx` · `diffSwapped` · `share*` · `threads{}` / `draft` · `xmlPrefixes` / `xmlNumbers`.

`open{}`, `sort{}`, `filters{}` **yol anahtarlıdır** — iç içe tabloların kendi durumu
böyle ayrışır. Veri değiştiğinde geçersiz yolları temizle.

## Responsive
Prototip 1440×900 sabit; üretimde: header ve paneller sabit yükseklik, orta bölge esner.
Sol/sağ paneller sabit genişlik + `flex-shrink:0`, orta bölge `min-width:0` ve kendi
içinde kaydırılır. `1200px` altında sağ paneli varsayılan kapalı başlatmak makul.
Tablo genişliği içerikten gelir ve yatay kaydırılır — tuvali daraltma.

## Assets
Yeni görsel varlık yok. Tek dış kaynak JetBrains Mono (Google Fonts). İkonlar metin
karakteri: `⌕ ☀ ⧉ ✓ × ‹ › ▸ ▾ ▽ ▼ ⊞ ⊟ ↳ ↑ ↓ − + ● ≈ ▲`. SVG ikon seti eklemek isterseniz
aynı ağırlıkta, `1.5px` çizgili ve `--ink-3` renginde olmalı; **emoji kullanma**.

## Kod tabanı eşlemesi
| Tasarım parçası | Mevcut dosya | Ne yapılacak |
|---|---|---|
| Kabuk, header, görünüm anahtarı, durum | `src/App.vue` | Header'dan Fark/XML sekmelerini kaldır, sırayı Tree·Grid·Kolon yap, yol satırını ekle |
| Girdi paneli + XML biçimi | `src/components/EditorPane.vue`, `XmlPane.vue` | XML'i ayrı ekran değil girdi biçimi yap; sürüklenebilir genişlik; hata + `düzelt` |
| Grid | `src/components/JsonGrid.vue`, `GridTable.vue`, `utils/grid.ts` | Hücre içinde açılan iç tablo modeli, içerikten kolon genişliği, köşedeki filtre anahtarı, GridSync |
| Tree | `JsonTree.vue`, `JsonTreeNode.vue` | Yeni palet ve tipografi |
| Kolon | `ColumnView.vue` | Yalnız palet |
| Fark | `DiffView.vue`, `utils/diff.ts` | İki elle girdi, canlı hesap, hizalı A/B, kimlik notu, "yalnız değişenler" dal filtresi |
| IATA paneli | `IataPanel.vue`, `FieldDocCard.vue`, `FieldValuesPanel.vue` | Kapatılabilir panel + şeritten geri açma |
| Yorumlar | `CommentThread.vue`, `composables/useComments.ts` | Yeni görsel dil |
| Referanslar | `utils/references.ts`, `related.ts` | `↳` ve referans kartı akışı |
| Token'lar | `src/styles/index.css` | Yukarıdaki tüm renk/ölçü token'ları |

## Files
- `JSON EYES - Yeni On Yuz.dc.html` — **hedef tasarım** (çalışan prototip; tarayıcıda açıp gezin)
- `Mevcut UI (birebir).dc.html` — mevcut arayüzün birebir kopyası (öncesi/sonrası karşılaştırması için)

## Kabul ölçütleri
1. Header'da yalnız `Tree · Grid · Kolon`; Fark ve XML sol panelde.
2. Grid'de bir hücre açıldığında alt tablo **o hücrenin içinde** açılıyor; üç seviye
   sonrası yola geçiyor.
3. Bir hücreye tıklamak soldaki JSON'u o satıra kaydırıyor ve satır numarasını
   vurguluyor.
4. Fark sekmesinde iki JSON da elle girilebiliyor; sayılar ve A/B satırları yazdıkça
   güncelleniyor.
5. Girdi paneli açılışta açık, kenarından sürüklenerek 210–760px arasında boyutlanıyor,
   çift tıkla sıfırlanıyor, `‹` ile kapanıp şeritten geri açılıyor.
6. IATA paneli `×` ile kapanıyor, şeritten geri açılıyor.
7. Filtre satırı tablonun köşesindeki `▽` ile açılıyor; araç çubuğunda filtre düğmesi yok.
8. Hiçbir metin `#82868a`'dan daha soluk değil; hiçbir input çerçevesi kırpılmıyor.
