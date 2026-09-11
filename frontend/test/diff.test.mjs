/**
 * Fark motorunun testleri. Diff sessizce yanlis olursa kullanici yanlis
 * sonuca guvenir; bu yuzden kritik davranislar burada sabitlendi:
 * kimlige gore eslestirme, kayma ile gercek tasima ayrimi, kimliksiz
 * dizilerde LCS ve tip degisiklikleri.
 *
 * Motor TypeScript oldugu icin test oncesi esbuild ile paketlenir (pretest).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectIdentityKey, diffJson, flattenDiff, changedPaths, isExpandable, childrenOf,
} from './.diff.bundle.mjs'

const order = (id, status, amount) => ({
  OrderID: id,
  StatusCode: status,
  TotalPrice: { TotalAmount: amount, CurCode: 'EUR' },
})

function counts(a, b) {
  return diffJson(a, b, 'json').counts
}

/** Belirli bir yolun dugumunu bulur. */
function nodeAt(result, path) {
  let found = null
  const walk = (node) => {
    if (node.path === path) found = node
    node.children.forEach(walk)
  }
  walk(result.root)
  return found
}

test('nesne: deger degisikligi, alan ekleme ve silme ayri ayri sayilir', () => {
  assert.deepEqual(
    counts({ a: 1, b: 'x', gidecek: true }, { a: 2, b: 'x', gelen: 'var' }),
    { added: 1, removed: 1, changed: 1, moved: 0 },
  )
})

test('dizi: basa kayit eklemek digerlerini "tasindi" yapmaz', () => {
  // Indekse gore karsilastirmada bu senaryo "her sey degisti" verirdi.
  const before = { Order: [order('ORD1', 'OPEN', 100), order('ORD2', 'OPEN', 200), order('ORD3', 'OPEN', 300)] }
  const after = { Order: [order('ORD0', 'OPEN', 50), order('ORD1', 'OPEN', 100), order('ORD2', 'CLOSED', 200)] }
  assert.deepEqual(counts(before, after), { added: 1, removed: 1, changed: 1, moved: 0 })

  const result = diffJson(before, after, 'json')
  assert.equal(result.identityKeys.get('json.Order'), 'OrderID')
  // Degisen alan dogru kayitta gorunmeli.
  assert.equal(nodeAt(result, 'json.Order.2.StatusCode').left, 'OPEN')
  assert.equal(nodeAt(result, 'json.Order.2.StatusCode').right, 'CLOSED')
  // Silinen ve eklenen kayitlar kimlik etiketi tasir.
  const removed = result.root.children[0].children.find(child => child.kind === 'removed')
  assert.equal(removed.label, 'ORD3')
})

test('dizi: gercek yeniden siralama tasima olarak raporlanir', () => {
  const result = diffJson(
    { Order: [order('A', 'OPEN', 1), order('B', 'OPEN', 2)] },
    { Order: [order('B', 'OPEN', 2), order('A', 'OPEN', 1)] },
    'json',
  )
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 0, moved: 1 })
  const moved = result.root.children[0].children.find(child => child.kind === 'moved')
  assert.equal(moved.label, 'B')
  assert.equal(moved.from, 1)
  assert.equal(moved.to, 0)
})

test('skaler dizi: LCS ile silindi + eklendi (yanlis eslestirme yok)', () => {
  const result = diffJson({ Tags: ['a', 'b', 'c', 'd'] }, { Tags: ['a', 'c', 'd', 'e'] }, 'json')
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 0, moved: 0 })
})

test('kimlik anahtari secimi: benzersizlik, ortak deger ve tip kontrolu', () => {
  assert.equal(detectIdentityKey([{ OrderID: '1', x: 1 }], [{ OrderID: '1', x: 2 }]), 'OrderID')
  // Tekrarlayan deger kimlik olamaz; benzersiz olan digeri secilir.
  assert.equal(detectIdentityKey([{ k: 'ayni', v: 1 }, { k: 'ayni', v: 2 }], [{ k: 'ayni', v: 1 }]), 'v')
  // Iki taraf hic kesismiyorsa eslestirme yapilmaz.
  assert.equal(detectIdentityKey([{ id: 'a' }], [{ id: 'z' }]), null)
  // Ic ice deger kimlik olamaz.
  assert.equal(detectIdentityKey([{ id: { a: 1 } }], [{ id: { a: 1 } }]), null)
})

test('tip degisikligi degisiklik olarak raporlanir', () => {
  assert.deepEqual(counts({ a: '1' }, { a: 1 }), { added: 0, removed: 0, changed: 1, moved: 0 })
  assert.deepEqual(counts({ a: null }, { a: {} }), { added: 0, removed: 0, changed: 1, moved: 0 })
})

test('ayni belge: hic degisiklik yok', () => {
  const doc = { Order: [order('A', 'OPEN', 1)], Meta: { x: [1, 2, 3] } }
  assert.deepEqual(counts(doc, structuredClone(doc)), { added: 0, removed: 0, changed: 0, moved: 0 })
})

test('duzlestirme: degisen dallar acik, degismeyen kardesler tek satirda toplanir', () => {
  const result = diffJson(
    { Order: [order('A', 'OPEN', 1), order('B', 'OPEN', 2), order('C', 'OPEN', 3)] },
    { Order: [order('A', 'OPEN', 1), order('B', 'CLOSED', 2), order('C', 'OPEN', 3)] },
    'json',
  )
  const rows = flattenDiff(result, { expanded: changedPaths(result), onlyChanges: true })
  const folded = rows.filter(row => row.collapsedCount !== undefined)
  // Order dizisinde iki degismeyen oge tek ozet satirinda.
  assert.ok(folded.some(row => row.collapsedCount === 2 && row.collapsedUnit === 'öğe'))
  // Degisen alan satir listesinde yer aliyor.
  assert.ok(rows.some(row => row.node.path === 'json.Order.1.StatusCode'))
  // Degismeyen kardes satirlar tek tek listelenmiyor.
  assert.equal(rows.filter(row => row.node.kind === 'unchanged' && row.collapsedCount === undefined).length, 0)
})

/**
 * Fark ekrani yalnizca bir rapor degil, elde gezilen bir agac: degismeyen,
 * butunuyle eklenen ve butunuyle silinen dallar da acilabilmeli. Motor bu
 * dallarin cocuklarini uretmedigi icin (alt agac ayni hikayeyi anlatir)
 * cocuklar istendiginde turetilir — asagidaki testler o sozlesmeyi sabitliyor.
 */

test('degismeyen dal acilabilir; cocuklari istendiginde turetilir', () => {
  const doc = { Meta: { a: 1, b: { c: 2 } }, x: 1 }
  const result = diffJson(doc, { ...structuredClone(doc), x: 2 }, 'json')

  const meta = result.root.children.find(child => child.key === 'Meta')
  assert.equal(meta.kind, 'unchanged')
  // Motor degismeyen dala hic girmez...
  assert.equal(meta.children.length, 0)
  // ...ama ekran yine de icini acabilmeli.
  assert.ok(isExpandable(meta))

  const children = childrenOf(meta)
  assert.deepEqual(children.map(child => child.key), ['a', 'b'])
  assert.ok(children.every(child => child.kind === 'unchanged'))
  // Iki taraf da dolu: satir A ve B sutununda ayni degeri gosterir.
  assert.equal(children[0].left, 1)
  assert.equal(children[0].right, 1)
  assert.equal(children[0].path, 'json.Meta.a')
  // Ic ice dallar da acilabilir.
  assert.ok(isExpandable(children[1]))
  assert.equal(childrenOf(children[1])[0].path, 'json.Meta.b.c')
})

test('eklenen ve silinen kapsayicilarin ici tek tarafli acilir', () => {
  const result = diffJson({ Gone: { p: 1 } }, { New: { q: 2, r: [3] } }, 'json')

  const added = result.root.children.find(child => child.key === 'New')
  assert.equal(added.kind, 'added')
  assert.ok(isExpandable(added))
  const addedKids = childrenOf(added)
  assert.deepEqual(addedKids.map(child => child.key), ['q', 'r'])
  // Eklenen tarafta yalnizca B dolu; A sutunu bos kalmali.
  assert.ok(addedKids.every(child => child.kind === 'added' && child.left === undefined))
  assert.equal(addedKids[0].right, 2)

  const removed = result.root.children.find(child => child.key === 'Gone')
  assert.equal(removed.kind, 'removed')
  const removedKids = childrenOf(removed)
  assert.deepEqual(removedKids.map(child => child.key), ['p'])
  assert.equal(removedKids[0].kind, 'removed')
  assert.equal(removedKids[0].left, 1)
  assert.equal(removedKids[0].right, undefined)
})

test('bos kapsayici ve skalerler acilamaz', () => {
  const result = diffJson({ a: 1, bos: {}, liste: [] }, { a: 2, bos: {}, liste: [] }, 'json')
  const byKey = Object.fromEntries(result.root.children.map(child => [child.key, child]))
  assert.equal(isExpandable(byKey.a), false)
  assert.equal(isExpandable(byKey.bos), false)
  assert.equal(isExpandable(byKey.liste), false)
})

test('turetilen satirlar ozet sayilarina karismaz', () => {
  const result = diffJson({}, { New: { q: 1, r: 2 } }, 'json')
  assert.deepEqual(result.counts, { added: 1, removed: 0, changed: 0, moved: 0 })
  const kids = childrenOf(result.root.children[0])
  // Dal bir kez sayildi; icini acmak ayni degisikligi ikinci kez saydirmamali.
  assert.ok(kids.every(child => child.counts.added === 0))
})

test('duzlestirme: elle acilan degismeyen dal satir uretir', () => {
  const doc = { Meta: { a: 1, b: 2 }, x: 1 }
  const result = diffJson(doc, { ...structuredClone(doc), x: 2 }, 'json')

  // Kapali: Meta tek satir, acilabilir isaretli.
  const closed = flattenDiff(result, { expanded: new Set(['json']), onlyChanges: false })
  const metaRow = closed.find(row => row.node.path === 'json.Meta')
  assert.equal(metaRow.expandable, true)
  assert.equal(metaRow.isOpen, false)
  assert.equal(closed.some(row => row.node.path === 'json.Meta.a'), false)

  // Acik: alanlari tek tek listelenir — iki tarafi gozle kiyaslamanin yolu.
  const open = flattenDiff(result, { expanded: new Set(['json', 'json.Meta']), onlyChanges: false })
  assert.deepEqual(
    open.filter(row => row.node.path.startsWith('json.Meta.')).map(row => row.node.path),
    ['json.Meta.a', 'json.Meta.b'],
  )
  assert.equal(open.find(row => row.node.path === 'json.Meta.a').depth, 2)
})

test('duzlestirme: kok kapali oldugunda tek satir kalir', () => {
  const result = diffJson({ a: 1 }, { a: 2 }, 'json')
  const rows = flattenDiff(result, { expanded: new Set(), onlyChanges: true })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].node.path, 'json')
  assert.equal(rows[0].expandable, true)
})

test('birebir ayni belgelerde kok yine de gezilebilir', () => {
  const doc = { Order: [order('A', 'OPEN', 1)] }
  const result = diffJson(doc, structuredClone(doc), 'json')
  assert.deepEqual(result.counts, { added: 0, removed: 0, changed: 0, moved: 0 })
  assert.ok(isExpandable(result.root))
  const rows = flattenDiff(result, { expanded: new Set(['json']), onlyChanges: false })
  assert.ok(rows.some(row => row.node.path === 'json.Order'))
})
