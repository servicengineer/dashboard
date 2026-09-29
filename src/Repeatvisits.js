import Papa from 'papaparse'
import { SHEET_ID, ENGINEERS, parseDate } from './sheetData'
import { parseQrCell } from './machineStats'

// ============================================================
// "Ek hi machine par multiple visits" — selected date range ke andar
// ============================================================
// Logic: har row (SIRF site visit, remote support nahi) ki date + us
// row me likhe QR code nikalte hain. Selected range ke andar jo QR
// 2 ya usse zyada alag ROWS me dikhe, uska matlab hai us machine par
// 1 se zyada baar physically visit gaya - wahi "repeat machine" hai.
// Remote support wali entries yahan bilkul count nahi hoti.

const tabUrl = (tab) =>
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`

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
const QR_COL_PRIORITY = [
    ['machine qr'], ['v pin', 'vpin'], ['qr code', 'qr no', 'qrcode', 'qr'],
    ['machine number'], ['machine code'],
]

// "Field" = site visit, "Remote" = remote support. sheetData.js ke classify() jaisa hi.
function isSiteVisit(text) {
    const t = String(text || '').toLowerCase()
    if (t.includes('remote')) return false
    return t.includes('field') || t.includes('fied')
}

async function loadTabVisits(tab) {
    const res = await fetch(tabUrl(tab))
    if (!res.ok) return []
    const rows = Papa.parse(await res.text(), { skipEmptyLines: true }).data
    if (rows.length < 2) return []
    const header = rows[0].map((h) => String(h || ''))
    const data = rows.slice(1)

    const qrCol = findCol(header, QR_COL_PRIORITY)
    if (qrCol < 0) return []

    // Field/Office/Remote column dhundein - isके bina remote entries filter nahi ho sakti
    const fieldCol = findCol(header, [['field']])

    // date column: content dekh kar dhundte hain (sheetData.js ki tarah)
    let dateCol = -1, best = 0.15
    for (let c = 0; c < Math.min(8, header.length); c++) {
        const vals = data.map((r) => r[c]).filter((x) => x && String(x).trim())
        if (!vals.length) continue
        const frac = vals.filter((x) => parseDate(x)).length / vals.length
        if (frac > best) { best = frac; dateCol = c }
    }
    if (dateCol < 0) return []

    const out = []
    let lastYear = null
    for (const r of data) {
        // Sirf "Field" (site visit) rows count hoti hain, "Remote" wali skip
        if (fieldCol >= 0 && !isSiteVisit(r[fieldCol])) continue

        const d = parseDate(r[dateCol], lastYear)
        if (!d) continue
        lastYear = +d.slice(0, 4)
        const codes = parseQrCell(r[qrCol])
        if (codes.length) out.push({ date: d, codes })
    }
    return out
}

// Return: [{ qr: '195001', visits: 3 }, ...] sorted zyada visits pehle,
// sirf wahi machines jinke SITE VISIT (remote support ignore) selected
// range me 2 ya usse zyada alag rows me mile.
export async function loadRepeatVisits(engineerOrAll, from, to) {
    const names = engineerOrAll === 'ALL' ? Object.keys(ENGINEERS) : [engineerOrAll]
    const counts = {} // qr -> { visits, engineers: Set }

    await Promise.all(
        names.map(async (name) => {
            const tabs = ENGINEERS[name] || []
            for (const tab of tabs) {
                const rows = await loadTabVisits(tab)
                for (const row of rows) {
                    if (row.date < from || row.date > to) continue
                    for (const qr of row.codes) {
                        counts[qr] = counts[qr] || { visits: 0, engineers: new Set() }
                        counts[qr].visits += 1
                        counts[qr].engineers.add(name)
                    }
                }
            }
        })
    )

    return Object.entries(counts)
        .filter(([, v]) => v.visits > 1)
        .map(([qr, v]) => ({ qr, visits: v.visits, engineers: Array.from(v.engineers).join(', ') }))
        .sort((a, b) => b.visits - a.visits)
}