import Papa from 'papaparse'
import { SHEET_ID, ENGINEERS } from './sheetdata'

// ============================================================
// 1) QR CLEANING & EXPANSION
// ============================================================

// Cells jinko hamesha invalid maana jaayega (case-insensitive)
const INVALID = /^(na|n\/?a|nil|none|-|--|demo|tbd|multiple\s*machines?|not\s*assigned|new\s*machine)$/i

// Ek cell (jisme kai QR ho sakte hain) ko saaf 6-digit QR codes ke array me todta hai.
// Examples:
//   "235035/36"                -> ['235035','235036']
//   "235035, 36"                -> ['235035','235036']
//   "100012,13,14"              -> ['100012','100013','100014']
//   "030794, 95, 96, 97, 98"    -> ['030794','030795','030796','030797','030798']
//   "124044-124041"             -> ['124044','124041']              (hyphen se alag QR)
//   "40001" (akela, poore cell me)-> '040001'    (Excel number cell se leading 0 gayab ho jata hai)
//   "OOO313"                    -> '000313'      (letter O, digit 0 ki jagah type ho gaya)
//   "290001110001000360..." (36 digits)-> 6 alag QR me tod diya (agar length 6 ka multiple ho)
//   "NA" / "Demo" / ""          -> []
// NOTE: agar kisi cell me sirf 3-4 digit ka akela number ho (jaise "461" ya "2341")
// bina kisi poore 6-digit code ke context ke, to use safely guess nahi kiya ja sakta -
// aisi cells "unresolved" list me chali jaati hain (loadMachineStats() ke result me).
export function parseQrCell(raw, unresolvedOut) {
    if (raw === null || raw === undefined) return []
    const cellText = String(raw).trim()
    if (!cellText || INVALID.test(cellText)) return []

    let cleaned = cellText
        .replace(/\([^)]*\)/g, ' ')      // (comments) hata dein
        .replace(/[[\]"]/g, ' ')          // [ ] aur " hata dein, andar ka content rakhein
        .replace(/\band\b/gi, ',')       // "and" -> comma
        .replace(/[Oo]/g, '0')            // typo: letter O -> digit 0

    // delimiters: comma, slash, ampersand, hyphen, ya koi bhi whitespace
    const tokens = cleaned.split(/[,/&\s-]+/).map((t) => t.trim()).filter(Boolean)

    const codes = []
    let lastFullCode = null // pichla poora mila hua 6-digit code, suffix expand karne ke liye

    for (const tok of tokens) {
        if (INVALID.test(tok)) continue
        const digits = tok.replace(/\D/g, '') // sirf digits rakho
        if (!digits) continue
        const n = digits.length

        if (n === 6) {
            codes.push(digits)
            lastFullCode = digits
        } else if (n === 5 && lastFullCode === null) {
            // cell me akela 5-digit number = Excel number format se leading 0 gayab, pad kar dein
            const code = '0' + digits
            codes.push(code)
            lastFullCode = code
        } else if (n < 6 && lastFullCode) {
            // suffix jaise "36", "13" -> pichhle full code ke prefix se jod dein
            const prefixLen = 6 - n
            const code = lastFullCode.slice(0, prefixLen) + digits
            codes.push(code)
            lastFullCode = code
        } else if (n > 6 && n <= 8) {
            // typo wale lambe number, pehle 6 digit le lo
            const code = digits.slice(0, 6)
            codes.push(code)
            lastFullCode = code
        } else if (n >= 12 && n % 6 === 0) {
            // bina kisi delimiter ke ek saath chipke hue kai QR (e.g. 6 ka clean multiple)
            for (let i = 0; i < n; i += 6) codes.push(digits.slice(i, i + 6))
            lastFullCode = codes[codes.length - 1]
        } else if (unresolvedOut) {
            unresolvedOut.push({ cell: cellText.slice(0, 80), token: tok.slice(0, 40) })
        }
    }
    return codes
}

// Poore column ke liye unique QR count (duplicates ek hi engineer ke andar hata di jaati hain)
// unresolvedOut diya ho to usme wo cells collect ho jaati hain jinhe safely resolve nahi kiya ja saka.
export function uniqueQrCount(cellValues, unresolvedOut) {
    const set = new Set()
    for (const v of cellValues) parseQrCell(v, unresolvedOut).forEach((c) => set.add(c))
    return set.size
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

const tabUrl = (tab) =>
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`

// Header ko normalize karke match karte hain (extra spaces, ":" , case sab ignore) -
// isse "Machine  QR", "QR:", "QR Code" jaise chhote naming variations bhi pakde jaate hain.
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// keywordGroups PRIORITY order me di jaati hain: pehle group ka match milte hi
// baaki groups check nahi hote. Isse "Machine Code" (jisme model/variant naam hote
// hain, QR nahi) "Machine QR" / "Machine V-pin" (jisme asli QR hote hain) se aage
// galti se pick nahi hoti.
function findCol(header, keywordGroups) {
    const lower = header.map(normHeader)
    for (const group of keywordGroups) {
        for (let i = 0; i < lower.length; i++) {
            if (group.some((k) => lower[i].includes(k))) return i
        }
    }
    return -1
}

const QR_COL_PRIORITY = [
    ['machine qr'], ['v pin', 'vpin'], ['qr code', 'qr no', 'qrcode', 'qr'],
    ['machine number'], ['machine code'],
]

// FALLBACK: agar header ke naam se QR column na mile (renamed/typo/missing header),
// to column ke ACTUAL DATA se pehchante hain - jis column me zyadatar values
// "6-digit number" ya "comma/slash se juda hua shorthand" jaisi dikhti hain, wahi QR column hai.
function looksLikeQrCell(v) {
    const s = String(v ?? '').trim()
    if (!s || INVALID.test(s)) return false
    // ijaazat: digits, comma, slash, ampersand, hyphen, space, bracket, quote, letter O/o (typo)
    const noise = s.replace(/[0-9,/&\-\s[\]()"OoAaNnDd]/g, '')
    if (noise.length > 0) return false
    // Serial number columns (1,2,3...) ko reject karne ke liye: QR cell me kam se kam
    // ek 4-ya-zyada digit ka lagatar run hona chahiye (asli QR 5-6 digit ke hote hain).
    return /\d{4,}/.test(s)
}

// Column ka header agar "sr no", "s.no", "index", "#" jaisa lage to use kabhi QR mat maanो,
// chahe uski values digits hi kyun na ho.
const SERIAL_HEADER = /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|index|id|#)$/i

function guessQrColByContent(header, data, excludeCols) {
    let best = -1, bestScore = 0, bestAvgLen = 0
    for (let c = 0; c < header.length; c++) {
        if (excludeCols.includes(c)) continue
        if (SERIAL_HEADER.test(normHeader(header[c]))) continue
        const vals = data.map((r) => r[c]).filter((v) => v !== undefined && String(v).trim() !== '')
        if (vals.length < 3) continue
        const hits = vals.filter(looksLikeQrCell)
        const score = hits.length / vals.length
        if (score < 0.4) continue
        // dono candidate columns score>=0.4 ho to jiski average digit-length zyada ho
        // (asli QR) usko prefer karein, na ki chhote serial numbers ko
        const avgLen = hits.reduce((a, v) => a + String(v).replace(/\D/g, '').length, 0) / (hits.length || 1)
        if (score > bestScore || (score === bestScore && avgLen > bestAvgLen)) {
            best = c; bestScore = score; bestAvgLen = avgLen
        }
    }
    return best
}

// Kisi tab ka QR column agar auto-detect na ho paaye, to yahan exact header naam
// likh kar force set kar sakte hain, e.g. Babaji: 'Machine  QR'
const QR_COL_OVERRIDE = {
    // Babaji: 'Machine QR',
}

async function loadSheetForMachines(tab, unresolvedOut) {
    const res = await fetch(tabUrl(tab))
    if (!res.ok) return { qrValues: [], regionCounts: {} }
    const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
    if (rows.length < 2) return { qrValues: [], regionCounts: {} }
    const header = rows[0].map((h) => String(h || ''))
    const data = rows.slice(1)

    const stateCol = findCol(header, [['state']])
    const cityCol = findCol(header, [['city', 'location']])

    let qrCol = -1
    if (QR_COL_OVERRIDE[tab.trim()]) {
        qrCol = header.findIndex((h) => normHeader(h) === normHeader(QR_COL_OVERRIDE[tab.trim()]))
    }
    if (qrCol < 0) qrCol = findCol(header, QR_COL_PRIORITY)
    if (qrCol < 0) qrCol = guessQrColByContent(header, data, [stateCol, cityCol])
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