import Papa from 'papaparse'
import { SHEET_ID, ENGINEERS, parseDate } from './sheetdata'
import { parseQrCell, findQrColumn, qrColumnDebugLabel } from './qrparser'

// ============================================================
// Machine Warranty & Pending-Quarterly-Visit Status
// ============================================================
// Har Machine QR ke liye:
//   1. Installation Date = "Type of issue" = "Installation" wali sabse pehli entry ki date
//      (warranty window isi se shuru hoti hai - chahe install Field me hua ho ya Remote me)
//   2. Last Qualifying Visit = in dono me se jo bhi LATEST ho:
//        a) koi bhi "Installation" entry (Field ho ya Remote Support, FARAK NAHI PADTA)
//        b) koi bhi normal "Field" visit (sirf Office Support / Remote Support exclude)
//      Matlab: machine abhi-abhi install hui hai - chahe engineer khud gaya ho ya
//      remotely install kiya ho - dono surat me "is quarter ka kaam ho gaya" maana
//      jaata hai, use turant "pending" nahi dikhaya jaayega.
//   3. Quarterly visit pending = (aaj - Last Qualifying Visit) >= 90 din
//   4. Warranty status = (aaj - Installation Date) < 365 din -> In Warranty, warna Out of Warranty

const tabUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`

const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
function findCol(header, keywordGroups) {
  const lower = header.map(normHeader)
  for (const group of keywordGroups) {
    for (let i = 0; i < lower.length; i++) {
      if (group.some((k) => lower[i].includes(k))) return i
    }
  }
  return -1
}

// "Field" = site visit. "Office Support" / "Remote Support" dono exclude.
function isFieldVisit(text) {
  const t = String(text || '').toLowerCase()
  if (t.includes('remote') || t.includes('office')) return false
  return t.includes('field') || t.includes('fied')
}
function isInstallation(text) {
  return String(text || '').toLowerCase().includes('install')
}

const MS_DAY = 24 * 60 * 60 * 1000
const daysBetween = (fromIso, toIso) => Math.floor((new Date(toIso) - new Date(fromIso)) / MS_DAY)

async function loadTabRecords(tab, debugLabels) {
  const res = await fetch(tabUrl(tab), { cache: 'no-store' })
  if (!res.ok) return []
  const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
  if (rows.length < 2) return []
  const header = rows[0].map((h) => String(h || ''))
  const data = rows.slice(1)

  const issueCol = findCol(header, [['type of issue']])
  const fieldCol = findCol(header, [['field']])

  let dateCol = -1, best = 0.15
  for (let c = 0; c < Math.min(8, header.length); c++) {
    const vals = data.map((r) => r[c]).filter((x) => x && String(x).trim())
    if (!vals.length) continue
    const frac = vals.filter((x) => parseDate(x)).length / vals.length
    if (frac > best) { best = frac; dateCol = c }
  }
  if (dateCol < 0) return []

  const qrCol = findQrColumn(tab, header, data, [dateCol, fieldCol, issueCol])
  const qrLabel = qrColumnDebugLabel(tab, header, data, [dateCol, fieldCol, issueCol])
  if (debugLabels) debugLabels.push(qrLabel)
  if (qrCol < 0) {
    console.warn(`[pendingvisits] "${tab.trim()}" ke liye QR column NAHI mila - is tab ki koi bhi machine search/warranty status me nahi aayegi.`)
    return []
  }

  const out = []
  let lastYear = null
  for (const r of data) {
    const d = parseDate(r[dateCol], lastYear)
    if (!d) continue
    lastYear = +d.slice(0, 4)
    const codes = parseQrCell(r[qrCol])
    if (!codes.length) continue
    out.push({
      date: d,
      codes,
      isInstall: issueCol >= 0 && isInstallation(r[issueCol]),
      isField: fieldCol >= 0 ? isFieldVisit(r[fieldCol]) : false,
    })
  }
  return out
}

// Return: plain object { qr: { engineers, installDate, lastFieldVisit, daysSinceVisit,
//                               pending: bool, inWarranty: true|false|null, status: 'blue'|'red' } }
// Har machine ke liye (sirf pending wali nahi) - taaki search se kisi bhi QR ka
// poora status dikha sakein, chahe uska quarterly visit pending ho ya na ho.
export async function loadAllMachineStatus(engineerOrAll, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10)
  const names = engineerOrAll === 'ALL' ? Object.keys(ENGINEERS) : [engineerOrAll]
  const byQr = {}
  const qrDebug = {}

  await Promise.all(
    names.map(async (name) => {
      const tabs = ENGINEERS[name] || []
      const debugLabels = []
      for (const tab of tabs) {
        const records = await loadTabRecords(tab, debugLabels)
        for (const rec of records) {
          for (const qr of rec.codes) {
            byQr[qr] = byQr[qr] || { installDate: null, lastVisit: null, engineers: new Set() }
            const entry = byQr[qr]
            entry.engineers.add(name)
            // Warranty window ke liye: sabse pehli Installation date (chahe Field/Remote)
            if (rec.isInstall && (!entry.installDate || rec.date < entry.installDate)) {
              entry.installDate = rec.date
            }
            // Pending-check ke liye: Installation (Field ya Remote, dono) + normal Field
            // visit - in sabme se sabse AAKHRI (latest) date "last qualifying visit" hai.
            if ((rec.isField || rec.isInstall) && (!entry.lastVisit || rec.date > entry.lastVisit)) {
              entry.lastVisit = rec.date
            }
          }
        }
      }
      qrDebug[name] = debugLabels
    })
  )
  console.log('[pendingvisits] QR column used:', qrDebug)

  const result = {}
  for (const qr in byQr) {
    const e = byQr[qr]
    const lastVisit = e.lastVisit
    if (!lastVisit) continue

    const daysSinceVisit = daysBetween(lastVisit, today)
    const pending = daysSinceVisit >= 90

    let inWarranty = null
    if (e.installDate) inWarranty = daysBetween(e.installDate, today) < 365

    const status = inWarranty === false ? 'red' : inWarranty === true ? 'blue' : 'red'
    const warrantyNote = inWarranty === true ? 'In Warranty'
      : inWarranty === false ? 'Out of Warranty'
      : 'Out of Warranty (install date unknown)'

    result[qr] = {
      qr,
      engineers: Array.from(e.engineers).join(', '),
      installDate: e.installDate,
      lastFieldVisit: lastVisit,
      daysSinceVisit,
      pending,
      inWarranty,
      status,
      warrantyNote,
    }
  }
  return result
}