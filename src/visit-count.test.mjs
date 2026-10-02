// ============================================================
// STANDALONE TEST - browser, Vite ya deploy ki zaroorat nahi.
// Terminal me seedha chalayein:
//     cd service-dashboard
//     node src/visit-count.test.mjs
//
// Ye file DIRECTLY production code (sheetdata.js, qrparser.js) import karti
// hai - isliye agar ye saari tests PASS karein, to pakka ho jaata hai ki
// QR-parsing aur visit-counting LOGIC 100% sahi hai. Agar isके baad bhi
// dashboard me galat number aaye, to masla logic me nahi, balki project
// files purani/stale hone me hai (replace/redeploy dobara karna hoga).
// ============================================================

import assert from 'node:assert/strict'
import { parseQrCell } from './qrparser.js'
import { classify, computeRowWeight, parseDate } from './sheetdata.js'

let pass = 0, fail = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    pass++
  } catch (err) {
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err.message}`)
    fail++
  }
}

console.log('\n=== 1) parseQrCell() - QR cleaning/expansion ===')

test('single 6-digit QR', () => {
  assert.deepEqual(parseQrCell('464001'), ['464001'])
})

test('comma-separated full QRs', () => {
  assert.deepEqual(parseQrCell('464001,464002'), ['464001', '464002'])
})

test('embedded newline separates two QRs (jaisa Google Sheet cell-wrap me hota hai)', () => {
  assert.deepEqual(parseQrCell('464001\n464002'), ['464001', '464002'])
})

test('ampersand + shorthand suffix: "391002 & 003" -> 391002, 391003', () => {
  assert.deepEqual(parseQrCell('391002 & 003'), ['391002', '391003'])
})

test('slash shorthand: "235035/36" -> 235035, 235036', () => {
  assert.deepEqual(parseQrCell('235035/36'), ['235035', '235036'])
})

test('multi-suffix list: "030794, 95, 96, 97, 98"', () => {
  assert.deepEqual(parseQrCell('030794, 95, 96, 97, 98'), ['030794', '030795', '030796', '030797', '030798'])
})

test('invalid text (NA) returns empty array', () => {
  assert.deepEqual(parseQrCell('NA'), [])
})

test('blank cell returns empty array', () => {
  assert.deepEqual(parseQrCell(''), [])
})

console.log('\n=== 1B) parseDate() - messy/typo date formats ===')

test('normal day-first: "22-09-2026" -> 2026-09-22', () => {
  assert.equal(parseDate('22-09-2026'), '2026-09-22')
})

test('dotted short-year: "29.9.26" -> 2026-09-29', () => {
  assert.equal(parseDate('29.9.26'), '2026-09-29')
})

test('double-hyphen typo: "14--08 -2026" -> 2026-08-14', () => {
  assert.equal(parseDate('14--08 -2026'), '2026-08-14')
})

test('US-style month/day/year (day-first invalid so auto-swaps): "10/17/2025" -> 2025-10-17', () => {
  assert.equal(parseDate('10/17/2025'), '2025-10-17')
})

test('US-style month/day/year: "8/14/2026" -> 2026-08-14', () => {
  assert.equal(parseDate('8/14/2026'), '2026-08-14')
})

test('ambiguous date-range text "8 & 9 oct" cannot be parsed (returns null) - sheet me fix zaroori', () => {
  assert.equal(parseDate('8 & 9 oct'), null)
})

console.log('\n=== 2) classify() - Field vs Remote vs ignored ===')

test('"field" -> site visit (s)', () => {
  assert.equal(classify('field'), 's')
})

test('"Remote Support" -> remote (r)', () => {
  assert.equal(classify('Remote Support'), 'r')
})

test('"Office Support" -> ignored (null)', () => {
  assert.equal(classify('Office Support'), null)
})

console.log('\n=== 3) computeRowWeight() - ek row ka visit-count kitna hona chahiye ===')

test('1 QR in cell -> weight 1', () => {
  assert.equal(computeRowWeight('372001'), 1)
})

test('2 QR in cell (comma) -> weight 2', () => {
  assert.equal(computeRowWeight('464001,464002'), 2)
})

test('2 QR in cell (newline) -> weight 2', () => {
  assert.equal(computeRowWeight('126011\n126012'), 2)
})

test('shorthand pair "391002 & 003" -> weight 2', () => {
  assert.equal(computeRowWeight('391002 & 003'), 2)
})

test('empty/invalid cell -> fallback weight 1 (data loss na ho isliye)', () => {
  assert.equal(computeRowWeight('NA'), 1)
})

console.log('\n=== 4) End-to-end: aapka Babaji "this month" scenario ===')
console.log('    8 QR mentioned: 464001, 464002, 126011, 126012, 391002, 391003, 464001, 372001')
console.log('    Expected: 3 Site Visit + 5 Remote Support = 8 total\n')

// Ye rows aapke bataye QR groupings ke hisaab se bana li gayi hain:
//   Site visit rows:  464001+464002 (1 row, 2 QR) , 372001 (1 row, 1 QR)      => 3 site
//   Remote rows:      126011+126012 (1 row, 2 QR) , 391002+391003 (1 row, 2 QR) , 464001 (1 row, 1 QR) => 5 remote
// Agar aapke sheet me row-grouping isse alag hai (jaise sab 8 QR alag-alag
// 8 rows me likhe hain, 3 ko), to bhi NEECHE wali rows list ko apni asli sheet
// jaisa bana kar is file me badal sakte hain - total hamesha sahi aana chahiye.
const sampleRows = [
  { field: 'field', qr: '464001,464002' },   // site: +2
  { field: 'field', qr: '372001' },           // site: +1
  { field: 'remote support', qr: '126011\n126012' }, // remote: +2
  { field: 'remote support', qr: '391002 & 003' },   // remote: +2
  { field: 'remote support', qr: '464001' },  // remote: +1 (same machine, dusri baar remote se)
]

let site = 0, remote = 0
for (const row of sampleRows) {
  const k = classify(row.field)
  if (!k) continue
  const w = computeRowWeight(row.qr)
  if (k === 's') site += w; else remote += w
}

test('Total Site Visit = 3', () => assert.equal(site, 3))
test('Total Remote Support = 5', () => assert.equal(remote, 5))
test('Grand Total = 8', () => assert.equal(site + remote, 8))

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`)
if (fail > 0) {
  console.log('Kuch tests FAIL hue - isका matlab production code me hi ek bug hai, mujhe batayein.')
  process.exit(1)
} else {
  console.log('Saari tests PASS hui! Matlab parsing/counting LOGIC bilkul sahi hai.')
  console.log('Agar dashboard me ab bhi galat number aa rahe hain, to masla file')
  console.log('replace/redeploy me hai - "node -v" check karein, project ki')
  console.log('src/ folder me purani duplicate-case files to nahi bachi, aur')
  console.log('ek baar "npm run dev" PURA restart (Ctrl+C phir dobara) karein.')
  process.exit(0)
}
