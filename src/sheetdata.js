import Papa from 'papaparse'
import { parseQrCell, findQrColumn, qrColumnDebugLabel } from './qrparser.js'

// Ek row ka "visit weight" - agar QR cell se 1+ code nikle to utni hi ginti,
// warna 1 (purana row-count tarika, data-loss na ho isliye). Alag function me
// rakha hai taaki ye hi logic test file me bhi seedha import karke verify ho sake.
// (export isliye kiya hai taaki test file isi function ko seedha test kar sake)
export function computeRowWeight(qrCellRaw) {
  const codes = parseQrCell(qrCellRaw)
  return codes.length > 0 ? codes.length : 1
}

// 1) Google Sheet ka ID yahan paste karein (URL me /d/ aur /edit ke beech ka part)
export const SHEET_ID = '1A4UjGjOpsuBdm77OLxwBoHZmm32aAkYn6r7AKOERcbs'

// 1B) Open/Pending issues wali doosri Google Sheet ka ID aur us sheet ke tab ka naam
export const ISSUES_SHEET_ID = '1Me4rlrg9B0u9jU4pIS7FPa-RrvE3LbPjOkr4X0nrBbo'
export const ISSUES_TAB = 'Open Issues'

// 2) Engineer -> sheet tab names (tab ka naam bilkul same, trailing space ke saath)
// Shahrukh aur Munavar company chhod chuke hain, isliye list se hata diya
export const ENGINEERS = {
  Sumit: ['Sumit', 'Sumit New'],
  Ujwal: ['Ujwal ', 'Ujwal New'],
  'Arun South': ['Arun south'],
  Babaji: ['Babaji'],
  Partha: ['Partha'],
  Rajan: ['Rajan'],
  Tushar: ['Tushar'],
}

// Cache-busting: Google ka gviz CSV export kabhi-kabhi kuch der ke liye purana
// (stale) data de deta hai jab sheet abhi-abhi edit hui ho. Har fetch me ek unique
// timestamp jodne se Google aur browser dono fresh data dete hain, purana cached nahi.
const tabUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => (y >= 2022 && y <= 2027 && m >= 0 && m < 12 && d >= 1 && d <= 31 ? `${y}-${pad(m + 1)}-${pad(d)}` : null)

// Date ko 'YYYY-MM-DD' me badalta hai. Saal na likha ho to fallbackYear use hota hai.
export function parseDate(v, fallbackYear = null) {
  if (v === null || v === undefined) return null
  let s = String(v).trim().toLowerCase().replace(/(\d+)\s*'?(st|nd|rd|th)\b/, '$1')
  if (!s) return null
  // Typo-tolerance: "14--08 -2026" jaise double-separator/extra-space wale
  // typo ko normalize kar dete hain, taaki genuine typing mistakes bhi parse ho jaayen.
  s = s.replace(/[-]{2,}/g, '-').replace(/\s+/g, ' ').trim()
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2] - 1, +m[3])
  if ((m = s.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]+\s*(\d{2,4})$/))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    const a = +m[1], b = +m[2]
    const dayFirst = iso(y, b - 1, a) // dd/mm/yyyy - sheet ka normal (India) convention
    if (dayFirst) return dayFirst
    // "10/17/2025" jaisी entry: pehla number (10) month nahi ho sakta agar doosra
    // number (17) 12 se zyada hai - matlab ye US-style month/day/year hai, swap kar dein.
    return iso(y, a - 1, b)
  }
  if ((m = s.match(/^(\d{1,2})[\s\-]*([a-z]{3})[a-z]*[\s\-,]*(\d{4})?$/)) && MONTHS[m[2]] !== undefined) {
    const y = m[3] ? +m[3] : fallbackYear
    return y ? iso(y, MONTHS[m[2]], +m[1]) : null
  }
  return null
}

// "Field" = site visit, "Remote" = remote support. Baaki (office/home/warehouse) ignore.
// (export isliye kiya hai taaki test file isi function ko seedha test kar sake)
export function classify(text) {
  const t = String(text || '').toLowerCase()
  if (t.includes('remote')) return 'r'
  if (t.includes('field') || t.includes('fied')) return 's'
  return null
}

// "This month" start - sirf isi date ke baad ke rows detail me console me dikhayenge,
// taaki debug output chhota aur kaam ka rahe (saari history nahi, bas current month).
const thisMonthStart = (() => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`
})()

async function loadTab(tab, out, debugLabels, rowDebugOut) {
  const res = await fetch(tabUrl(tab), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Tab "${tab}" load nahi hua (sheet share/ID check karein)`)
  const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
  if (rows.length < 2) return
  const header = rows[0].map((h) => String(h || '').toLowerCase())
  const data = rows.slice(1)

  const fieldCol = header.findIndex((h) => h.includes('field'))
  if (fieldCol < 0) return

  // Date column content dekh ke dhundte hain (kuch sheets me header 'Date' nahi hota)
  let dateCol = -1, best = 0.15
  for (let c = 0; c < Math.min(8, header.length); c++) {
    const vals = data.map((r) => r[c]).filter((x) => x && String(x).trim())
    if (!vals.length) continue
    const frac = vals.filter((x) => parseDate(x)).length / vals.length
    if (frac > best) { best = frac; dateCol = c }
  }
  if (dateCol < 0) return

  // QR column dhundein - ek hi row me kai machines ho sakti hain (jaise
  // "940013,22,24,27" = 4 machines ek row me). Visit count ab ROWS se nahi,
  // balki us row me likhe MACHINE QR ki ginti se banta hai - matlab agar
  // 1 Oct ko Babaji ki sheet me ek row me 4 QR hain (4 remote installation)
  // aur doosri row me 2 QR hain (field visit), to total visit = 4 + 2 = 6.
  const qrCol = findQrColumn(tab, header, data, [dateCol, fieldCol])
  const qrLabel = qrColumnDebugLabel(tab, header, data, [dateCol, fieldCol])
  if (debugLabels) debugLabels.push(qrLabel)
  if (qrCol < 0) {
    // Ye warning tabhi dikhti hai jab QR column bilkul nahi mila - matlab is tab
    // ke visits ab bhi "1 row = 1 visit" se gine jaa rahe hain, QR-count se nahi.
    console.warn(`[sheetdata] "${tab.trim()}" ke liye QR column NAHI mila - visits row-count se gine jaa rahe hain (galat ho sakta hai agar ek row me kai QR hon). QR_COL_OVERRIDE me is tab ka header manually set karein.`)
  }

  let lastYear = null
  for (const r of data) {
    const qrRaw = qrCol >= 0 ? r[qrCol] : undefined
    const hasQr = qrRaw !== undefined && String(qrRaw).trim() !== ''
    const rawDateText = r[dateCol]

    const d = parseDate(rawDateText, lastYear)
    if (!d) {
      // Date parse hi nahi hui - agar is row me QR data bhi hai, to ye wahi row ho
      // sakti hai jo "this month" me honi chahiye thi par date-format ki wajah se
      // chhoot gayi. Isko bhi console me dikhate hain taaki miss na ho.
      if (rowDebugOut && hasQr) {
        rowDebugOut.push({ tab: tab.trim(), skipped: 'DATE NOT PARSED', rawDateText, qrRaw })
      }
      continue
    }
    lastYear = +d.slice(0, 4)
    const k = classify(r[fieldCol])
    if (!k) {
      if (rowDebugOut && hasQr && d >= thisMonthStart) {
        rowDebugOut.push({ tab: tab.trim(), date: d, skipped: 'FIELD NOT CLASSIFIED (field/remote/office text samajh nahi aaya)', fieldRaw: r[fieldCol], qrRaw })
      }
      continue
    }
    const weight = qrCol >= 0 ? computeRowWeight(qrRaw) : 1
    out[d] = out[d] || [0, 0]
    out[d][k === 's' ? 0 : 1] += weight

    // Is month ke rows ka poora detail console-debug ke liye bhi save karte hain -
    // taaki pata chale raw cell me kya tha aur usse kitne codes nikle.
    if (rowDebugOut && d >= thisMonthStart) {
      rowDebugOut.push({ tab: tab.trim(), date: d, type: k === 's' ? 'Site' : 'Remote', qrRaw, codes: parseQrCell(qrRaw), weight })
    }
  }
}

const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim().toLowerCase()

// Issues sheet se har engineer ke open (unresolved) issues count karta hai.
// Columns header ke naam se dhundhe jate hain, isliye hidden columns se farak nahi padta.
async function loadOpenIssues() {
  const url = `https://docs.google.com/spreadsheets/d/${ISSUES_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(ISSUES_TAB)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Issues sheet load nahi hui (ID, tab ka naam aur sharing check karein)')
  const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
  const header = (rows[0] || []).map(norm)
  const engCol = header.findIndex((h) => h.includes('service engineer'))
  const resCol = header.findIndex((h) => h.startsWith('resolved'))
  const clientCol = header.findIndex((h) => h.includes('client'))
  const issueCol = header.findIndex((h) => h === 'issue')
  if (engCol < 0 || resCol < 0) throw new Error('Issues sheet me "Service Engineer" ya "Resolved Yes/No" column nahi mila')

  const known = {}
  Object.keys(ENGINEERS).forEach((n) => { known[norm(n)] = n })
  const open = {}, unmatched = {}
  for (const r of rows.slice(1)) {
    const hasRow = String(r[clientCol] || '').trim() || String(r[issueCol] || '').trim()
    if (!hasRow) continue
    if (norm(r[resCol]).startsWith('y')) continue // yes = resolved
    const raw = norm(r[engCol])
    const name = known[raw]
    if (name) open[name] = (open[name] || 0) + 1
    else { const k = raw || '(blank)'; unmatched[k] = (unmatched[k] || 0) + 1 }
  }
  return { open, unmatched }
}

// Return: { data: { Sumit: { '2025-02-03': [siteVisits, remote] } }, open: { Sumit: 5 }, ... }
export async function loadAll() {
  const result = {}
  const errors = []
  let open = {}, unmatched = {}
  const qrDebug = {} // { EngineerName: ['TabName: ColumnHeader', ...] } - console me check karne ke liye
  const rowDebug = {} // { EngineerName: [{ tab, date, type, qrRaw, codes, weight }, ...] } - is month ke rows
  await Promise.all([
    ...Object.entries(ENGINEERS).map(async ([name, tabs]) => {
      const out = {}
      const debugLabels = []
      const rowDebugOut = []
      for (const tab of tabs) {
        try { await loadTab(tab, out, debugLabels, rowDebugOut) } catch (e) { errors.push(e.message) }
      }
      result[name] = out
      qrDebug[name] = debugLabels
      rowDebug[name] = rowDebugOut
    }),
    loadOpenIssues()
      .then((r) => { open = r.open; unmatched = r.unmatched })
      .catch((e) => errors.push(e.message)),
  ])
  // Debug: F12 -> Console me dekhein kis column ko QR maan kar visit-count kiya gaya.
  // "NOT FOUND" dikhe to us tab ka QR data row-count fallback se gina ja raha hai.
  console.log('[sheetdata] QR column used for visit counting:', qrDebug)
  // Is month ke har row ka raw QR cell + usse nikle codes + weight - isse seedha
  // dikh jaata hai ki kisi specific row par parsing me kya hua.
  console.log('[sheetdata] This month row-by-row QR detail:', rowDebug)
  return { data: result, errors, open, unmatched }
}