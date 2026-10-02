import Papa from 'papaparse'
import { SHEET_ID, ENGINEERS } from './sheetdata'
import { parseQrCell, findQrColumn } from './qrparser'

// Simple single-keyword column finder (state/city jaise chhote lookups ke liye)
function findColSimple(header, keyword) {
  return header.findIndex((h) => String(h || '').toLowerCase().includes(keyword))
}

// ============================================================
// 2) CITY -> STATE/REGION MAPPING
// ============================================================
// Target regions: Kerala, Bengaluru, Maharashtra, Gujarat, Delhi, Chennai
// Naya city aaye to bas is list me ek line add kar dein.
const CITY_TO_REGION = {
  // Kerala
  trivandrum: 'Kerala', thiruvananthapuram: 'Kerala', kochi: 'Kerala', cochin: 'Kerala',
  kozhikode: 'Kerala', calicut: 'Kerala', kollam: 'Kerala', thrissur: 'Kerala', kannur: 'Kerala',
  // Bengaluru
  bengaluru: 'Bengaluru', bangalore: 'Bengaluru',
  // Maharashtra
  mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra', nashik: 'Maharashtra',
  thane: 'Maharashtra', navi_mumbai: 'Maharashtra',
  // Gujarat
  ahmedabad: 'Gujarat', surat: 'Gujarat', vadodara: 'Gujarat', rajkot: 'Gujarat',
  sanand: 'Gujarat', gandhinagar: 'Gujarat',
  // Delhi / NCR
  delhi: 'Delhi', 'new_delhi': 'Delhi', gurugram: 'Delhi', gurgaon: 'Delhi',
  noida: 'Delhi', faridabad: 'Delhi', ghaziabad: 'Delhi',
  // Chennai
  chennai: 'Chennai', madras: 'Chennai',
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '_')
}

// City ya State column ki value se region nikalta hai. Match na mile to raw value hi laut aati hai.
export function cityToRegion(value) {
  const key = normalize(value)
  if (!key) return null
  if (CITY_TO_REGION[key]) return CITY_TO_REGION[key]
  // partial match (e.g. "Bengaluru South" -> "Bengaluru")
  for (const city in CITY_TO_REGION) {
    if (key.includes(city)) return CITY_TO_REGION[city]
  }
  return value.trim() // pehchana nahi gaya to jaisa likha hai waisa hi dikha do
}

// ============================================================
// 3) HAR ENGINEER KE LIYE: STATE + UNIQUE MACHINE COUNT
//    + STATE/CITY-WISE AGGREGATION (BAR CHART KE LIYE)
// ============================================================

// Cache-busting: Google ka gviz CSV export kabhi-kabhi kuch der ke liye purana
// (stale) data de deta hai jab sheet abhi-abhi edit hui ho. Har fetch me ek unique
// timestamp jodne se Google aur browser dono fresh data dete hain, purana cached nahi.
const tabUrl = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`

async function loadSheetForMachines(tab, unresolvedOut) {
  const res = await fetch(tabUrl(tab), { cache: 'no-store' })
  if (!res.ok) return { qrValues: [], regionCounts: {} }
  const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
  if (rows.length < 2) return { qrValues: [], regionCounts: {} }
  const header = rows[0].map((h) => String(h || ''))
  const data = rows.slice(1)

  const stateCol = findColSimple(header, 'state')
  const cityCol = findColSimple(header, 'city') >= 0 ? findColSimple(header, 'city') : findColSimple(header, 'location')

  const qrCol = findQrColumn(tab, header, data, [stateCol, cityCol])
  if (qrCol < 0) return { qrValues: [], regionCounts: {} }

  const qrColName = header[qrCol]
  const qrValues = data.map((r) => r[qrCol])

  // region-wise unique QR sets, taaki duplicate QR ek hi region me ek baar gine jaaye
  const regionSets = {}
  data.forEach((r) => {
    const region = stateCol >= 0 && r[stateCol] ? cityToRegion(r[stateCol])
      : cityCol >= 0 ? cityToRegion(r[cityCol]) : null
    if (!region) return
    const codes = parseQrCell(r[qrCol], unresolvedOut)
    if (!codes.length) return
    regionSets[region] = regionSets[region] || new Set()
    codes.forEach((c) => regionSets[region].add(c))
  })
  const regionCounts = {}
  for (const r in regionSets) regionCounts[r] = regionSets[r].size

  return { qrValues, regionCounts, qrColName }
}

// Manually confirmed regions har engineer ke liye (auto-detection ke bajaye).
// Naya engineer aaye ya region badle to bas yahan update kar dein.
export const ENGINEER_REGION = {
  Sumit: 'Maharashtra, Goa, MP',
  Ujwal: 'Hyderabad',
  'Arun South': 'Kerala',
  Babaji: 'Bengaluru',
  Partha: 'Chennai',
  Rajan: 'Gujarat',
  Tushar: 'Pune',
}

// Return:
// {
//   perEngineer: { Rajan: { state: 'Gujarat', machineCount: 90, uniqueCodes: ['023301', ...], unresolved: [...] }, ... },
//   byRegion: { Kerala: 120, Gujarat: 300, ... }   // bar chart ke liye ready data
// }
export async function loadMachineStats() {
  const perEngineer = {}
  const byRegion = {}

  await Promise.all(
    Object.entries(ENGINEERS).map(async ([name, tabs]) => {
      let qrValues = []
      let regionCounts = {}
      const unresolved = []
      const qrColumnsUsed = []
      for (const tab of tabs) {
        const r = await loadSheetForMachines(tab, unresolved)
        qrValues = qrValues.concat(r.qrValues)
        qrColumnsUsed.push(`${tab.trim()}: ${r.qrColName || 'NOT FOUND'}`)
        for (const region in r.regionCounts) {
          regionCounts[region] = (regionCounts[region] || 0) + r.regionCounts[region]
        }
      }
      const set = new Set()
      qrValues.forEach((v) => parseQrCell(v).forEach((c) => set.add(c)))
      const uniqueCodes = Array.from(set).sort()
      const state = ENGINEER_REGION[name] || null
      perEngineer[name] = {
        state,
        machineCount: uniqueCodes.length,
        uniqueCodes,
        // agar koi cell safely resolve nahi ho payi (jaise akela "461" bina kisi
        // poore 6-digit QR ke context ke), wo yahan dikhegi taaki sheet me manually theek ki ja sake
        unresolved,
        // debug: kis column ko QR maan kar padha gaya - console me check kar sakte hain
        qrColumnsUsed,
      }
      for (const region in regionCounts) {
        byRegion[region] = (byRegion[region] || 0) + regionCounts[region]
      }
    })
  )

  // Debug ke liye: F12 -> Console me dekh sakte hain kis engineer ke liye kaunsa
  // column QR maan kar padha gaya, aur kitni cells resolve nahi ho payi.
  console.log('[machineStats] per engineer QR debug:', perEngineer)

  return { perEngineer, byRegion }
}

// UI bar chart ko seedha ye array de sakte hain: [{ region: 'Kerala', machines: 120 }, ...]
export function toChartData(byRegion) {
  return Object.entries(byRegion)
    .map(([region, machines]) => ({ region, machines }))
    .sort((a, b) => b.machines - a.machines)
}