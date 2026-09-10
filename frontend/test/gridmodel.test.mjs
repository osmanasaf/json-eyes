/**
 * Grid'in olcu modelinin testleri.
 *
 * Kolon genisligi ve seyrek kolon gizleme ekranda dogrudan gorunen ama gozle
 * dogrulanmasi zor kararlar: bir kolon yanlis hesaplanirsa tablo kayar, bir
 * kolon sessizce dusulurse kullanici veriyi kaybettigini fark etmez. Ikisi de
 * burada sabitlendi.
 *
 * Modul TypeScript oldugu icin test oncesi esbuild ile paketlenir (pretest).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COL_MAX, COL_MIN, applyFilters, cellLabel, columnWidth, jsonPathOf, listModel,
  initialNode, modelOf, nextSort, objectModel, recordModel,
} from './.gridmodel.bundle.mjs'

const order = (id, status, extra = {}) => ({ OrderID: id, StatusCode: status, ...extra })

test('kolon genisligi icerikten gelir, alt ve ust sinira kilitlidir', () => {
  // Kisa icerik alt sinira dayanir.
  assert.equal(columnWidth('ab', ['x']), COL_MIN)
  // Uzun icerik ust sinirda kesilir.
  assert.equal(columnWidth('a'.repeat(200), []), COL_MAX)
  // Arada formul: karakter*8+30, en genis olan kazanir (baslik ya da hucre).
  assert.equal(columnWidth('OrderID', ['ORD100001']), 9 * 8 + 30)
  assert.equal(columnWidth('CreateDateTime', ['x']), 14 * 8 + 30)
})

test('kayit tablosu: kolonlar ilk gorunme sirasinda, sayisal kolon isaretli', () => {
  const model = recordModel([
    order('A', 'OPENED', { Amount: 10 }),
    order('B', 'CLOSED', { Amount: 20 }),
  ])
  assert.deepEqual(model.columns.map(c => c.name), ['OrderID', 'StatusCode', 'Amount'])
  assert.equal(model.columns[2].numeric, true)
  assert.equal(model.columns[0].numeric, false)
  assert.equal(model.total, 2)
})

test('seyrek kolonlar gizlenir ve sayisi bildirilir', () => {
  // Bes kolon; `Nadir` yalnizca 1/10 kayitta -> %10 < %30, duser.
  const items = Array.from({ length: 10 }, (_, i) => ({
    A: i, B: i, C: i, D: i, ...(i === 0 ? { Nadir: 1 } : {}),
  }))
  const model = recordModel(items)
  assert.equal(model.hiddenColumns, 1)
  assert.ok(!model.columns.some(c => c.name === 'Nadir'))
})

test('az kolonlu tabloda seyreklik uygulanmaz', () => {
  // Dort kolon esik degil; hicbir sey gizlenmez.
  const items = Array.from({ length: 10 }, (_, i) => ({ A: i, B: i, ...(i === 0 ? { C: 1 } : {}) }))
  const model = recordModel(items)
  assert.equal(model.hiddenColumns, 0)
})

test('hucre etiketi: kapsayicilar sayiyla, eksik alan tire', () => {
  assert.equal(cellLabel({ a: 1, b: 2 }), '{2}')
  assert.equal(cellLabel([1, 2, 3]), '[3]')
  assert.equal(cellLabel(undefined), '—')
  assert.equal(cellLabel(null), 'null')
  assert.equal(cellLabel(12.5), '12.5')
})

test('sekil secimi: kayit dizisi, skaler dizi ve nesne ayrisir', () => {
  assert.equal(modelOf([order('A', 'X')]).shape, 'records')
  assert.equal(modelOf([1, 2, 3]).shape, 'list')
  assert.equal(modelOf({ a: 1 }).shape, 'object')
  assert.equal(objectModel({ a: 1, b: 2 }).total, 2)
  assert.equal(listModel([1, 2]).total, 2)
})

test('kolon filtreleri kesisimle uygulanir ve yola gore ayrisir', () => {
  const items = [
    order('ORD1', 'OPENED'),
    order('ORD2', 'PENDING'),
    order('ORD3', 'PENDING'),
  ]
  const path = 'json.Order'
  // Tek filtre.
  assert.equal(applyFilters(items, path, { 'json.Order::StatusCode': 'pend' }).length, 2)
  // Kesisim: ikisini birden saglayan tek kayit.
  assert.deepEqual(
    applyFilters(items, path, {
      'json.Order::StatusCode': 'PEND',
      'json.Order::OrderID': 'ORD3',
    }).map(r => r.index),
    [2],
  )
  // Baska bir yolun filtresi bu tabloyu etkilemez.
  assert.equal(applyFilters(items, path, { 'json.Other::StatusCode': 'yok' }).length, 3)
  // Bos filtre yok sayilir.
  assert.equal(applyFilters(items, path, { 'json.Order::StatusCode': '   ' }).length, 3)
})

test('siralama dongusu: artan -> azalan -> kapali', () => {
  const a = nextSort(undefined, 'OrderID')
  assert.deepEqual(a, { column: 'OrderID', dir: 'asc' })
  const b = nextSort(a, 'OrderID')
  assert.deepEqual(b, { column: 'OrderID', dir: 'desc' })
  assert.equal(nextSort(b, 'OrderID'), undefined)
  // Baska kolona gecince siralama o kolona tasinir, artandan baslar.
  assert.deepEqual(nextSort(b, 'Amount'), { column: 'Amount', dir: 'asc' })
})

test('JSONPath: sayisal segment kose parantez, digerleri nokta', () => {
  assert.equal(
    jsonPathOf('json.IATA_OrderViewRS.Response.Order.2.StatusCode'),
    '$.IATA_OrderViewRS.Response.Order[2].StatusCode',
  )
  assert.equal(jsonPathOf('json'), '$')
})

test('acilis dugumu: tek alanli sarmalayici zinciri inilir, kayit dizisinde durulur', () => {
  const doc = { IATA_OrderViewRS: { Response: { Order: [order('A', 'X')] } } }
  assert.equal(initialNode(doc, 'json'), 'json.IATA_OrderViewRS.Response.Order')
  // Coklu alan gorulunce durulur.
  const multi = { A: { x: 1, y: 2 } }
  assert.equal(initialNode(multi, 'json'), 'json.A')
  // Skaler kokte kokte kalinir.
  assert.equal(initialNode({ a: 1, b: 2 }, 'json'), 'json')
})
