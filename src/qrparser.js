// ============================================================
// Shared QR-parsing utilities - SAARI files (sheetData, machineStats,
// repeatVisits, pendingVisits) yahi se import karte hain. Isse QR-column
// detect karne ka logic sirf EK jagah maintain hota hai, chaar jagah alag-
// alag nahi - pehle yahi duplication Babaji jaisi bugs ki wajah ban rahi thi.
// ============================================================

// Cells jinko hamesha invalid maana jaayega (case-insensitive)
export const INVALID = /^(na|n\/?a|nil|none|-|--|demo|tbd|multiple\s*machines?|not\s*assigned|new\s*machine)$/i

// Ek cell (jisme kai QR ho sakte hain) ko saaf 6-digit QR codes ke array me todta hai.
// Examples:
//   "235035/36"                -> ['235035','235036']
//   "235035, 36"                -> ['235035','235036']
//   "100012,13,14"              -> ['100012','100013','100014']
//   "030794, 95, 96, 97, 98"    -> ['030794','030795','030796','030797','030798']
//   "124044-124041"             -> ['124044','124041']              (hyphen se alag QR)
//   "40001" (akela, poore cell me)-> '040001'    (Excel number cell se leading 0 gayab ho jata hai)
//   "OOO313"                    -> '000313'      (letter O, digit 0 ki jagah type ho gaya)
//   "NA" / "Demo" / ""          -> []
export function parseQrCell(raw, unresolvedOut) {
  if (raw === null || raw === undefined) return []
  const cellText = String(raw).trim()
  if (!cellText || INVALID.test(cellText)) return []

  let cleaned = cellText
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[[\]"]/g, ' ')
    .replace(/\band\b/gi, ',')
    .replace(/[Oo]/g, '0')

  const tokens = cleaned.split(/[,/&\s-]+/).map((t) => t.trim()).filter(Boolean)
  const codes = []
  let lastFullCode = null

  for (const tok of tokens) {
    if (INVALID.test(tok)) continue
    const digits = tok.replace(/\D/g, '')
    if (!digits) continue
    const n = digits.length

    if (n === 6) { codes.push(digits); lastFullCode = digits }
    else if (n === 5 && lastFullCode === null) { const code = '0' + digits; codes.push(code); lastFullCode = code }
    else if (n < 6 && lastFullCode) {
      const prefixLen = 6 - n
      const code = lastFullCode.slice(0, prefixLen) + digits
      codes.push(code); lastFullCode = code
    } else if (n > 6 && n <= 8) { const code = digits.slice(0, 6); codes.push(code); lastFullCode = code }
    else if (n >= 12 && n % 6 === 0) {
      for (let i = 0; i < n; i += 6) codes.push(digits.slice(i, i + 6))
      lastFullCode = codes[codes.length - 1]
    } else if (unresolvedOut) {
      unresolvedOut.push({ cell: cellText.slice(0, 80), token: tok.slice(0, 40) })
    }
  }
  return codes
}

export function uniqueQrCount(cellValues, unresolvedOut) {
  const set = new Set()
  for (const v of cellValues) parseQrCell(v, unresolvedOut).forEach((c) => set.add(c))
  return set.size
}

// Header ko normalize karke match karte hain (extra spaces, case sab ignore)
export const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// keywordGroups PRIORITY order me di jaati hain: pehle group ka match milte hi
// baaki groups check nahi hote. Isse "Machine Code" (model/variant naam) "Machine QR"
// / "Machine V-pin" (asli QR) se aage galti se pick nahi hoti.
export function findCol(header, keywordGroups) {
  const lower = header.map(normHeader)
  for (const group of keywordGroups) {
    for (let i = 0; i < lower.length; i++) {
      if (group.some((k) => lower[i].includes(k))) return i
    }
  }
  return -1
}

export const QR_COL_PRIORITY = [
  ['machine qr'], ['v pin', 'vpin'], ['qr code', 'qr no', 'qrcode', 'qr'],
  ['machine number'], ['machine code'],
]

function looksLikeQrCell(v) {
  const s = String(v ?? '').trim()
  if (!s || INVALID.test(s)) return false
  const noise = s.replace(/[0-9,/&\-\s[\]()"OoAaNnDd]/g, '')
  if (noise.length > 0) return false
  return /\d{4,}/.test(s) // serial numbers (1,2,3...) reject - QR me kam se kam 4 digit ka run hona chahiye
}

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
    if (score < 0.25) continue
    const avgLen = hits.reduce((a, v) => a + String(v).replace(/\D/g, '').length, 0) / (hits.length || 1)
    if (score > bestScore || (score === bestScore && avgLen > bestAvgLen)) { best = c; bestScore = score; bestAvgLen = avgLen }
  }
  return best
}

// Kisi tab ka QR column agar auto-detect na ho paaye, to yahan exact header naam
// likh kar force set kar sakte hain, e.g. Babaji: 'Machine QR'
// IMPORTANT: agar koi engineer baar-baar "not found" ya galat count de, to sabse
// pakka fix yahi hai - Google Sheet me us tab ke QR column ka header cell (row 1)
// kholkar text copy karein aur neeche exact wahi paste karein.
export const QR_COL_OVERRIDE = {
  // Babaji: 'Machine QR',
}

// Ye sab columns KABHI QR nahi hote - chahe koi bhi caller findQrColumn() ko bulaye,
// ye hamesha automatically exclude honge. Pehle har file (sheetdata/machinestats/
// pendingvisits) apne apne excludeCols bhejti thi, jo ek-dusre se match nahi karte
// the - isi wajah se ek hi tab ke liye alag-alag jagah ALAG column pick ho jaata
// tha (kahin sahi, kahin galat). Ab ye list yahi, ek hi jagah, hamesha lagu hoti hai.
const NEVER_QR_HEADER_KEYWORDS = [
  'date', 'field', 'office', 'remote', 'type of issue', 'issue', 'state', 'city',
  'location', 'client', 'resolution', 'resolved', 'comment', 'warranty', 'model',
  'variant', 'action', 'kae', 'priority', 'remark', 'name of spare', 'spare part',
  's no', 's.no', 'sr no', 'sl no', 'index',
]

function autoExcludeCols(header) {
  const out = []
  header.forEach((h, i) => {
    const n = normHeader(h)
    if (NEVER_QR_HEADER_KEYWORDS.some((k) => n.includes(k))) out.push(i)
  })
  return out
}

// Chaar-step detection: (1) manual override, (2) header keyword match,
// (3) content-based guess (jisme upar ki NEVER_QR list + caller ke diye extra
// excludeCols dono hamesha hata diye jaate hain).
export function findQrColumn(tab, header, data, excludeCols = []) {
  let col = -1
  const override = QR_COL_OVERRIDE[String(tab).trim()]
  if (override) col = header.findIndex((h) => normHeader(h) === normHeader(override))
  if (col < 0) col = findCol(header, QR_COL_PRIORITY)
  if (col < 0) {
    const allExcludes = Array.from(new Set([...excludeCols, ...autoExcludeCols(header)]))
    col = guessQrColByContent(header, data, allExcludes)
  }
  return col
}

// Debug helper: console me "TabName: ColumnHeader" ya "TabName: NOT FOUND" dikhane
// ke liye. Har loader (sheetdata/machinestats/repeatvisits/pendingvisits) ab isi
// se ek jaisa debug output deta hai, taaki pata chale kis column ko QR maana gaya.
export function qrColumnDebugLabel(tab, header, data, excludeCols = []) {
  const col = findQrColumn(tab, header, data, excludeCols)
  return `${String(tab).trim()}: ${col >= 0 ? header[col] : 'NOT FOUND'}`
}