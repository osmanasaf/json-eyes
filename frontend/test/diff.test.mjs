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
import { detectIdentityKey, diffJson, flattenDiff, changedPaths } from './.diff.bundle.mjs'

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
