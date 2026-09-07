/**
 * XML -> JSON cevirisinin testleri. Ayni ayristirici hem web hem CLI
 * tarafinda kullanildigi icin buradaki davranis iki tarafi birden baglar.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeXml, parseXml, xmlToJson, XmlParseError } from './.xml.bundle.mjs'

const json = (text, options) => xmlToJson(text, options).data

test('metin tanima: XML mi', () => {
  assert.equal(looksLikeXml('<?xml version="1.0"?><a/>'), true)
  assert.equal(looksLikeXml('  <IATA_OrderViewRS>x</IATA_OrderViewRS>'), true)
  assert.equal(looksLikeXml('<!-- yorum --><a/>'), true)
  assert.equal(looksLikeXml('{"a":1}'), false)
  assert.equal(looksLikeXml('merhaba'), false)
  assert.equal(looksLikeXml('<'), false)
})

test('yalnizca metin iceren eleman degere iner', () => {
  assert.deepEqual(json('<CurCode>EUR</CurCode>'), { CurCode: 'EUR' })
})

test('ic ice elemanlar nesneye cevrilir', () => {
  assert.deepEqual(
    json('<TotalPrice><TotalAmount>1250.50</TotalAmount><CurCode>EUR</CurCode></TotalPrice>'),
    { TotalPrice: { TotalAmount: '1250.50', CurCode: 'EUR' } },
  )
})

test('tekrarlayan kardesler diziye dusurulur', () => {
  assert.deepEqual(
    json('<Response><Order><OrderID>A</OrderID></Order><Order><OrderID>B</OrderID></Order></Response>'),
    { Response: { Order: [{ OrderID: 'A' }, { OrderID: 'B' }] } },
  )
  // Tek oge dizi olmaz; tuketen taraf bunu bilmeli (nota da yaziliyor).
  assert.deepEqual(
    json('<Response><Order><OrderID>A</OrderID></Order></Response>'),
    { Response: { Order: { OrderID: 'A' } } },
  )
})

test('oznitelikler @ onekiyle, metin #text olarak girer', () => {
  assert.deepEqual(
    json('<Amount CurCode="EUR" Decimals="2">1250.50</Amount>'),
    { Amount: { '@CurCode': 'EUR', '@Decimals': '2', '#text': '1250.50' } },
  )
})

test('ad alani onekleri ve xmlns bildirimleri atilir', () => {
  const xml = '<iata:IATA_OrderViewRS xmlns:iata="http://iata.org/ndc" xmlns="urn:x"><iata:Order>A</iata:Order></iata:IATA_OrderViewRS>'
  assert.deepEqual(json(xml), { IATA_OrderViewRS: { Order: 'A' } })
  // Istenirse korunur.
  assert.deepEqual(json(xml, { keepPrefixes: true }), {
    'iata:IATA_OrderViewRS': {
      '@xmlns:iata': 'http://iata.org/ndc',
      '@xmlns': 'urn:x',
      'iata:Order': 'A',
    },
  })
})

test('degerler varsayilan olarak metin kalir; kod alanlari bozulmaz', () => {
  assert.deepEqual(json('<F><FlightNumber>0123</FlightNumber><N>42</N></F>'),
    { F: { FlightNumber: '0123', N: '42' } })
  // Istenirse sayi cikarimi acilir; bastaki sifir yine korunur.
  assert.deepEqual(json('<F><FlightNumber>0123</FlightNumber><N>42</N><B>true</B></F>', { numbers: true }),
    { F: { FlightNumber: '0123', N: 42, B: true } })
})

test('kendinden kapanan etiket, CDATA, yorum, bildirim ve varliklar', () => {
  assert.deepEqual(json('<a><b/><c><![CDATA[<ham> & veri]]></c><!-- yorum --><d>a &amp; b &#65;</d></a>'),
    { a: { b: '', c: '<ham> & veri', d: 'a & b A' } })
  assert.deepEqual(json('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE a>\n<a>x</a>'), { a: 'x' })
})

test('bozuk XML: satir numarasiyla hata', () => {
  assert.throws(() => parseXml('<a><b>x</c></a>'), (error) => {
    assert.ok(error instanceof XmlParseError)
    assert.match(error.message, /eşleşmiyor/)
    return true
  })
  assert.throws(() => parseXml('<a><b>x</b>'), /kapanmamış/)
  assert.throws(() => parseXml('metin'), /eleman bulunamadı/)
  assert.throws(() => parseXml('<a/><b/>'), /ikinci bir kök/)
})

test('cevirim notlari kullaniciya ne oldugunu soyler', () => {
  const result = xmlToJson('<a xmlns="urn:x" id="1">x</a>')
  assert.ok(result.notes.some(note => note.includes('xmlns')))
  assert.ok(result.notes.some(note => note.includes('öznitelik')))
  assert.equal(result.root, 'a')
})

test('gercekci NDC parcasi', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<IATA_OrderViewRS xmlns="http://www.iata.org/IATA/2015/EASD/00/IATA_OrderViewRS">
  <Response>
    <Order>
      <OrderID>ORD123</OrderID>
      <OwnerCode>TK</OwnerCode>
      <TotalPrice><TotalAmount CurCode="EUR">1250.50</TotalAmount></TotalPrice>
      <OrderItem><OrderItemID>OI-1</OrderItemID></OrderItem>
      <OrderItem><OrderItemID>OI-2</OrderItemID></OrderItem>
    </Order>
    <Warning Code="100">Kısmi uygunluk</Warning>
  </Response>
</IATA_OrderViewRS>`
  assert.deepEqual(json(xml), {
    IATA_OrderViewRS: {
      Response: {
        Order: {
          OrderID: 'ORD123',
          OwnerCode: 'TK',
          TotalPrice: { TotalAmount: { '@CurCode': 'EUR', '#text': '1250.50' } },
          OrderItem: [{ OrderItemID: 'OI-1' }, { OrderItemID: 'OI-2' }],
        },
        Warning: { '@Code': '100', '#text': 'Kısmi uygunluk' },
      },
    },
  })
})
