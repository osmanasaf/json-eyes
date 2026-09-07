/**
 * Grid'in veri modelinin testleri. Cizim Vue tarafinda ama tablonun *ne*
 * gosterdigine bu modul karar veriyor: kolonlarin nereden geldigi, hangi
 * dugumun kayit tablosu oldugu, hangi dallarin kendiliginden acildigi.
 * Sessizce alan dusuren ya da 1200 satirlik bir diziyi tek tek acan bir grid
 * kullanilamaz hale gelir; kritik kararlar burada sabitlendi.
 *
 * Modul TypeScript oldugu icin test oncesi esbuild ile paketlenir (pretest).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  autoOpenPaths, cellText, filterOpenable, gridShape, highlightParts, isLongValue,
  isRecordArray, previewFields, recordColumns, sortRecords, summaryOf, toCsv, valueAtPath,
} from './.grid.bundle.mjs'

const order = (id, status, amount) => ({
  OrderID: id,
  StatusCode: status,
  TotalPrice: { TotalAmount: amount, CurCode: 'EUR' },
})

test('nesne, nesne dizisi ve duz dizi ayri tablo bicimleri', () => {
  assert.equal(gridShape({ a: 1 }), 'object')
  assert.equal(gridShape([order('A', 'OPEN', 1)]), 'records')
  assert.equal(gridShape([1, 2, 3]), 'list')
  // Karisik dizi kayit tablosu olamaz: kolonlar yalnizca nesnelerden gelir.
  assert.equal(gridShape([{ a: 1 }, 'metin']), 'list')
  assert.equal(gridShape([]), 'list')
  assert.equal(gridShape('metin'), 'scalar')
  assert.equal(isRecordArray([{ a: 1 }]), true)
  assert.equal(isRecordArray([[1], [2]]), false)
})

test('kolonlar anahtarlarin birlesimi, ilk gorunme sirasinda', () => {
  const { columns, hidden } = recordColumns([
    { OrderID: 'A', StatusCode: 'OPEN' },
    { OrderID: 'B', OwnerCode: 'TK' },
  ])
  assert.deepEqual(columns.map(c => c.name), ['OrderID', 'StatusCode', 'OwnerCode'])
  assert.equal(hidden, 0)
  // Eksik alanlar sayilir: baslikta "1/2" olarak gorunur.
  assert.deepEqual(columns.map(c => c.filled), [2, 1, 1])
})

test('karisik tipli kolon metin, sayisal kolon sayi olarak isaretlenir', () => {
  const { columns } = recordColumns([
    { Amount: 10, Nested: { a: 1 }, Mixed: 1 },
    { Amount: 20, Nested: { b: 2 }, Mixed: 'x' },
  ])
  const kind = name => columns.find(c => c.name === name).kind
  assert.equal(kind('Amount'), 'number')
  assert.equal(kind('Nested'), 'nested')
  assert.equal(kind('Mixed'), 'text')
})

test('cok anahtarli dizide kolonlar kirpilir ve kirpim bildirilir', () => {
  const items = [Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]))]
  const { columns, hidden } = recordColumns(items, 40)
  assert.equal(columns.length, 40)
  assert.equal(hidden, 20)
})

test('kirpim en cok dolu kolonlari korur', () => {
  const items = [
    { a: 1, b: 1, c: 1 },
    { a: 1, b: 1 },
    { a: 1 },
  ]
  const { columns } = recordColumns(items, 2)
  assert.deepEqual(columns.map(c => c.name), ['a', 'b'])
})

test('eksik alanli satirlar siralamada iki yonde de sona gider', () => {
  const rows = [
    { index: 0, item: { Amount: 30 } },
    { index: 1, item: {} },
    { index: 2, item: { Amount: 10 } },
  ]
  const asc = sortRecords(rows, { column: 'Amount', dir: 'asc' }, 'number')
  assert.deepEqual(asc.map(r => r.index), [2, 0, 1])
  const desc = sortRecords(rows, { column: 'Amount', dir: 'desc' }, 'number')
  assert.deepEqual(desc.map(r => r.index), [0, 2, 1])
})

test('hucre metni tek satira iner, kapsayicilar ozet gosterir', () => {
  assert.equal(cellText('a\nb'), 'a ↵ b')
  assert.equal(cellText(null), 'null')
  assert.equal(cellText(undefined), '')
  assert.equal(cellText({ a: 1, b: 2 }), '2 alan')
  assert.equal(cellText([1, 2, 3]), '3 öğe')
  assert.equal(summaryOf([]), 'boş dizi')
  assert.equal(summaryOf({}), 'boş nesne')
})

test('uzun ve cok satirli degerler kirpilmis sayilir', () => {
  assert.equal(isLongValue('kısa'), false)
  assert.equal(isLongValue('x'.repeat(65)), true)
  // Tek satira sigsa da satir sonu iceren deger hucrede okunamaz.
  assert.equal(isLongValue('a\nb'), true)
  assert.equal(isLongValue({ a: 1 }), false)
})

test('arama terimi parcalara ayrilir, isaretlenecek yerler belli olur', () => {
  assert.deepEqual(highlightParts('OrderID', 'id'), [
    { text: 'Order', hit: false },
    { text: 'ID', hit: true },
  ])
  assert.deepEqual(highlightParts('aXaXa', 'x'), [
    { text: 'a', hit: false },
    { text: 'X', hit: true },
    { text: 'a', hit: false },
    { text: 'X', hit: true },
    { text: 'a', hit: false },
  ])
  assert.deepEqual(highlightParts('abc', ''), [{ text: 'abc', hit: false }])
  assert.deepEqual(highlightParts('abc', 'z'), [{ text: 'abc', hit: false }])
})

test('CSV ic ice alanlari JSON olarak yazar ve ayiriciyi kacar', () => {
  const csv = toCsv(['OrderID', 'TotalPrice', 'Not'], [
    { OrderID: 'A;1', TotalPrice: { TotalAmount: 5 }, Not: 'a"b' },
  ])
  const [head, row] = csv.split('\r\n')
  assert.equal(head, 'OrderID;TotalPrice;Not')
  // Ic ice alanin JSON metni tirnak icerdigi icin CSV kurallarina gore kacilir.
  assert.equal(row, '"A;1";"{""TotalAmount"":5}";"a""b"')
})

test('acilis tek alanli sarmalayici zincirini sonuna kadar takip eder', () => {
  const data = { IATA_OrderViewRS: { Response: { Order: [order('A', 'OPEN', 1)] } } }
  const open = autoOpenPaths(data, 'json')
  assert.equal(open.has('json.IATA_OrderViewRS'), true)
  assert.equal(open.has('json.IATA_OrderViewRS.Response'), true)
  assert.equal(open.has('json.IATA_OrderViewRS.Response.Order'), true)
  // Kayit tablosunun ogeleri acilmaz: alanlari zaten kolon olarak gorunuyor.
  assert.equal(open.has('json.IATA_OrderViewRS.Response.Order.0'), false)
})

test('bos kapsayicilar acilmaz, kayit ogelerinin icine inilir', () => {
  const data = {
    Bos: {},
    BosDizi: [],
    Order: [order('A', 'OPEN', 1), order('B', 'OPEN', 2)],
  }
  const open = autoOpenPaths(data, 'json')
  // Bos nesne acilsa hucrede "Boş." yazan bir alt tablo cizilirdi.
  assert.equal(open.has('json.Bos'), false)
  assert.equal(open.has('json.BosDizi'), false)
  assert.equal(open.has('json.Order'), true)
  assert.equal(open.has('json.Order.0'), false)
  // Satirin kendisi acilmaz ama hucresindeki nesne acilir.
  assert.equal(open.has('json.Order.0.TotalPrice'), true)
})

test('kayit dizisinin tamamina inilmez', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ Id: i, Nested: { a: i } }))
  const open = autoOpenPaths({ Rows: items }, 'json', { budget: 1000 })
  const opened = [...open].filter(p => /Nested$/.test(p))
  assert.equal(opened.length, 50)
})

test('acilis butcesi asilmaz', () => {
  const data = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [`k${i}`, { a: { b: { c: 1 } } }]),
  )
  assert.equal(autoOpenPaths(data, 'json', { budget: 10 }).size <= 10, true)
})

test('kayit ogesi yollari kendiliginden acilacaklar arasindan dusuyor', () => {
  const data = { Order: [order('A', 'OPEN', 1), order('B', 'OPEN', 2)] }
  const paths = ['json.Order', 'json.Order.0', 'json.Order.1.TotalPrice']
  const openable = filterOpenable(data, 'json', paths)
  assert.equal(openable.has('json.Order'), true)
  assert.equal(openable.has('json.Order.0'), false)
  // Kayit ogesinin *icindeki* nesne acilabilir; kolon hucresinde aciliyor.
  assert.equal(openable.has('json.Order.1.TotalPrice'), true)
})

test('yol cozumu dizi indekslerini ve eksik dallari bilir', () => {
  const data = { Order: [{ OrderID: 'A' }] }
  assert.equal(valueAtPath(data, 'json', 'json.Order.0.OrderID'), 'A')
  assert.equal(valueAtPath(data, 'json', 'json.Order.5'), undefined)
  assert.equal(valueAtPath(data, 'json', 'baska.Order'), undefined)
  assert.deepEqual(valueAtPath(data, 'json', 'json'), data)
})

test('referans onizlemesi bir seviye derine iner, listeyi kirpar', () => {
  const target = {
    PaxID: 'PAX1',
    Individual: { GivenName: 'Ada', Surname: 'L' },
    Segments: [1, 2],
  }
  const fields = previewFields(target)
  assert.deepEqual(fields.map(f => f.key), ['PaxID', 'Individual.GivenName', 'Individual.Surname'])
  assert.equal(previewFields([1, 2]).length, 0)
})
