/**
 * Grid'in duz satir listesinin testleri.
 *
 * Cizim Vue tarafinda, ama ekranda *hangi satirlarin, hangi sirada* olacagina
 * bu modul karar veriyor. Sanallastirma dogrudan bu listenin uzunluguna
 * baglandigi icin buradaki iki hata da sessiz: kapali bir dalin altina inmek
 * 100k satirlik bir liste uretir, filtrenin atalari dusurmesi ise eslesmeyi
 * belgede yersiz birakir. Kritik kararlar burada sabitlendi.
 *
 * Modul TypeScript oldugu icin test oncesi esbuild ile paketlenir (pretest).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenRows, pathToOpen, scalarText } from './.rows.bundle.mjs'

const DATA = {
  Response: {
    Order: [
      { OrderID: 'A1', StatusCode: 'OPENED' },
      { OrderID: 'A2', StatusCode: 'CLOSED' },
    ],
    Warning: [{ DescText: 'kısmi' }],
  },
}

const BASE = {
  expanded: new Set(),
  visible: null,
  arrayTable: false,
  refOpen: null,
  threadOpen: null,
}

const flatten = (options = {}) => flattenRows(DATA, 'json', { ...BASE, ...options })
const paths = rows => rows.map(row => row.path)

test('kapali kokte yalnizca birinci seviye cizilir', () => {
  const rows = flatten()
  assert.deepEqual(paths(rows), ['json.Response'])
  assert.equal(rows[0].container, true)
  assert.equal(rows[0].open, false)
  assert.equal(rows[0].summary, '2 alan')
})

test('acilan dalin altina inilir, kapali kardesin altina inilmez', () => {
  const rows = flatten({ expanded: new Set(['json.Response']) })
  assert.deepEqual(paths(rows), ['json.Response', 'json.Response.Order', 'json.Response.Warning'])
})

test('dizi ogeleri indeksleriyle satir olur', () => {
  const rows = flatten({ expanded: new Set(['json.Response', 'json.Response.Order']) })
  assert.deepEqual(paths(rows), [
    'json.Response',
    'json.Response.Order',
    'json.Response.Order.0',
    'json.Response.Order.1',
    'json.Response.Warning',
  ])
  assert.equal(rows[2].key, '0')
  assert.equal(rows[1].summary, '2 öğe')
})

test('Tablo modunda nesne dizisinin cocuklari yerine tek tablo satiri gelir', () => {
  const rows = flatten({
    expanded: new Set(['json.Response', 'json.Response.Order']),
    arrayTable: true,
  })
  assert.deepEqual(paths(rows), [
    'json.Response',
    'json.Response.Order',
    'json.Response.Order',
    'json.Response.Warning',
  ])
  const table = rows[2]
  assert.equal(table.kind, 'table')
  assert.equal(table.items.length, 2)
  // Ayni yolda iki satir var; anahtarlarin ayrisiyor olmasi sart.
  assert.notEqual(rows[1].id, table.id)
})

test('filtre: eslesmeyen dallar dusuyor, eslesmeye giden yol duruyor', () => {
  const visible = new Set(['json.Response', 'json.Response.Warning'])
  const rows = flatten({ expanded: new Set(['json.Response']), visible })
  assert.deepEqual(paths(rows), ['json.Response', 'json.Response.Warning'])
})

test('referans ve yorum seritleri satirin hemen altinda', () => {
  const rows = flatten({
    expanded: new Set(['json.Response', 'json.Response.Order', 'json.Response.Order.0']),
    refOpen: 'json.Response.Order.0.OrderID',
    threadOpen: 'json.Response.Order.0.OrderID',
  })
  const at = paths(rows).indexOf('json.Response.Order.0.OrderID')
  assert.equal(rows[at].kind, 'row')
  assert.equal(rows[at + 1].kind, 'ref')
  assert.equal(rows[at + 2].kind, 'thread')
  // Serit satirlari bir seviye iceriden ciziliyor; derinlik satirin kendisiyle ayni.
  assert.equal(rows[at + 1].depth, rows[at].depth)
})

test('odak hedefin atalarini acar, hedefin kendisini acmaz', () => {
  assert.deepEqual(
    pathToOpen('json.Response.Order.0.OrderID', 'json'),
    ['json.Response', 'json.Response.Order', 'json.Response.Order.0'],
  )
  assert.deepEqual(pathToOpen('json.Response', 'json'), [])
})

test('deger metni: dizeler tirnakli, satir sonlari gorunur', () => {
  assert.equal(scalarText('A1'), '"A1"')
  assert.equal(scalarText(12), '12')
  assert.equal(scalarText(null), 'null')
  assert.equal(scalarText(true), 'true')
  assert.equal(scalarText('a\nb'), '"a ↵ b"')
})
