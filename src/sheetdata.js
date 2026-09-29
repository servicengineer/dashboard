import Papa from 'papaparse'

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

const tabUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => (y >= 2022 && y <= 2027 && m >= 0 && m < 12 && d >= 1 && d <= 31 ? `${y}-${pad(m + 1)}-${pad(d)}` : null)

// Date ko 'YYYY-MM-DD' me badalta hai. Saal na likha ho to fallbackYear use hota hai.
export function parseDate(v, fallbackYear = null) {
  if (v === null || v === undefined) return null
  const s = String(v).trim().toLowerCase().replace(/(\d+)\s*'?(st|nd|rd|th)\b/, '$1')
  if (!s) return null
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2] - 1, +m[3])
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]+(\d{2,4})$/))) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    return iso(y, +m[2] - 1, +m[1]) // dd/mm/yyyy (India format)
  }
  if ((m = s.match(/^(\d{1,2})[\s\-]*([a-z]{3})[a-z]*[\s\-,]*(\d{4})?$/)) && MONTHS[m[2]] !== undefined) {
    const y = m[3] ? +m[3] : fallbackYear
    return y ? iso(y, MONTHS[m[2]], +m[1]) : null
  }
  return null
}

// "Field" = site visit, "Remote" = remote support. Baaki (office/home/warehouse) ignore.
function classify(text) {
  const t = String(text || '').toLowerCase()
  if (t.includes('remote')) return 'r'
  if (t.includes('field') || t.includes('fied')) return 's'
  return null
}

async function loadTab(tab, out) {
  const res = await fetch(tabUrl(tab))
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

  let lastYear = null
  for (const r of data) {
    const d = parseDate(r[dateCol], lastYear)
    if (!d) continue
    lastYear = +d.slice(0, 4)
    const k = classify(r[fieldCol])
    if (!k) continue
    out[d] = out[d] || [0, 0]
    out[d][k === 's' ? 0 : 1] += 1
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
  await Promise.all([
    ...Object.entries(ENGINEERS).map(async ([name, tabs]) => {
      const out = {}
      for (const tab of tabs) {
        try { await loadTab(tab, out) } catch (e) { errors.push(e.message) }
      }
      result[name] = out
    }),
    loadOpenIssues()
      .then((r) => { open = r.open; unmatched = r.unmatched })
      .catch((e) => errors.push(e.message)),
  ])
  return { data: result, errors, open, unmatched }
}