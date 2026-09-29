import './App.css'
import { useEffect, useState } from 'react'
import { loadAll } from './sheetdata'
import { loadMachineStats } from './machineStats'
import { loadRepeatVisits } from './Repeatvisits'

const BLUE = '#2563eb', ORANGE = '#f97316'
const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function quickRange(k) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth()
  if (k === 'this') return [fmt(new Date(y, m, 1)), fmt(t)]
  if (k === 'last') return [fmt(new Date(y, m - 1, 1)), fmt(new Date(y, m, 0))]
  const w = (t.getDay() + 6) % 7 // pichhla Monday-Sunday
  return [fmt(new Date(y, m, t.getDate() - w - 7)), fmt(new Date(y, m, t.getDate() - w - 1))]
}

function count(days, a, b) {
  let s = 0, r = 0
  for (const d in days) if (d >= a && d <= b) { s += days[d][0]; r += days[d][1] }
  return [s, r]
}
const pct = (r, t) => (t ? ((r * 100) / t).toFixed(1) + '%' : '0%')

function Pie({ s, r }) {
  const t = s + r, R = 90, C = 100
  if (!t) return <div className="empty">Data Not Found.</div>
  const P = (a) => [C + R * Math.cos(a), C + R * Math.sin(a)]
  const a0 = -Math.PI / 2, a1 = a0 + (2 * Math.PI * s) / t, a2 = a0 + 2 * Math.PI
  const slice = (x, y, color) => {
    if (y - x >= 2 * Math.PI - 1e-6) return <circle cx={C} cy={C} r={R} fill={color} />
    const [p, q] = P(x), [u, v] = P(y)
    return <path d={`M${C} ${C}L${p} ${q}A${R} ${R} 0 ${y - x > Math.PI ? 1 : 0} 1 ${u} ${v}Z`} fill={color} />
  }
  return (
    <svg viewBox="0 0 200 200" width="100%" role="img" aria-label="Site visit vs remote">
      {s > 0 && slice(a0, a1, BLUE)}
      {r > 0 && slice(a1, a2, ORANGE)}
    </svg>
  )
}


export default function App() {
  const [data, setData] = useState(null)
  const [errors, setErrors] = useState([])
  const [open, setOpen] = useState({})
  const [unmatched, setUnmatched] = useState({})
  const [machines, setMachines] = useState({}) // { EngName: { state, machineCount } }
  const [loading, setLoading] = useState(true)
  const [eng, setEng] = useState('')
  const [kind, setKind] = useState('this')
  const [range, setRange] = useState(quickRange('this'))
  const [res, setRes] = useState(null)
  const [msg, setMsg] = useState('')
  const [repeats, setRepeats] = useState(null) // [{ qr, visits, engineers }]
  const [repeatsLoading, setRepeatsLoading] = useState(false)

  const load = () => {
    setLoading(true)
    loadAll().then(({ data, errors, open, unmatched }) => { setData(data); setErrors(errors); setOpen(open); setUnmatched(unmatched) }).finally(() => setLoading(false))
    loadMachineStats().then(({ perEngineer }) => { setMachines(perEngineer) })
  }
  useEffect(load, [])

  const pick = (k) => { setKind(k); if (k !== 'custom') setRange(quickRange(k)) }

  const search = () => {
    if (!eng) return setMsg('Select service engineer datafield*')
    if (!range[0] || !range[1] || range[0] > range[1]) return setMsg('Sahi date range select karein (From <= To).')
    setMsg('')
    const list = eng === 'ALL' ? Object.keys(data) : [eng]
    const rate = (x) => (x[1] + x[2] ? x[2] / (x[1] + x[2]) : 0) // remote %
    const rows = list
      .map((n) => [n, ...count(data[n], range[0], range[1]), open[n] || 0])
      .sort((x, y) => rate(y) - rate(x) || y[2] - x[2]) // sabse zyada remote % upar
    const s = rows.reduce((a, x) => a + x[1], 0), r = rows.reduce((a, x) => a + x[2], 0)
    const o = rows.reduce((a, x) => a + x[3], 0)
    setRes({ eng, from: range[0], to: range[1], s, r, o, rows })

    setRepeats(null)
    setRepeatsLoading(true)
    loadRepeatVisits(eng, range[0], range[1])
      .then(setRepeats)
      .finally(() => setRepeatsLoading(false))
  }

  if (loading) return <div className="w"><p className="sub">Data loading...</p></div>

  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <span className="nav-title">Service Engineer Dashboard</span>
        </div>
      </header>
      <div className="w">
        <p className="sub">
          <span className="live" title="Live data" />Service Tracker...
          <button className="refresh" onClick={load} title="Refresh data" aria-label="Refresh data">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        </p>
        {errors.length > 0 && <div className="err">{errors.map((e, i) => <div key={i}>{e}</div>)}</div>}

        <div className="card">
          <label>Service Engineer</label>
          <select value={eng} onChange={(e) => setEng(e.target.value)}>
            <option value="">-- Select engineer --</option>
            <option value="ALL">All Engineers</option>
            {Object.keys(data || {}).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>

          <div className="chips">
            {[['this', 'This Month'], ['last', 'Last Month'], ['week', 'Last Week'], ['custom', 'Custom']].map(([id, l]) => (
              <button key={id} className={'chip' + (kind === id ? ' on' : '')} onClick={() => pick(id)}>{l}</button>
            ))}
          </div>

          <div className="row">
            <div><label>From date</label>
              <input type="date" value={range[0]} onChange={(e) => { setKind('custom'); setRange([e.target.value, range[1]]) }} /></div>
            <div><label>To date</label>
              <input type="date" value={range[1]} onChange={(e) => { setKind('custom'); setRange([range[0], e.target.value]) }} /></div>
          </div>
          <button className="go" onClick={search}>Search</button>
          {msg && <div className="err">{msg}</div>}
        </div>

        {res && (
          <div className="card">
            <div className="note">
              {res.eng === 'ALL' ? 'All Engineers' : `${res.eng} (${machines[res.eng]?.state || '-'}) — ${machines[res.eng]?.machineCount ?? 0} machines`}
              {' '}| {res.from} to {res.to}
            </div>
            <div className="res">
              <Pie s={res.s} r={res.r} />
              <div>
                <div className="kp">
                  <div className="k"><span><i className="dot" style={{ background: BLUE }} />Site Visit</span><b>{res.s}</b></div>
                  <div className="k"><span><i className="dot" style={{ background: ORANGE }} />Remote Support</span><b>{res.r}</b></div>
                  <div className="k"><span>Total</span><b>{res.s + res.r}</b></div>
                </div>
                <div className="big">Remotely Solved: <b>{pct(res.r, res.s + res.r)}</b>
                  <span className="note"> ({res.r} / {res.s + res.r})</span></div>
                <div className="big open">Open / Pending issues: <b>{res.o}</b>
                  <span className="note"> (Unresolved)</span></div>
              </div>
            </div>
            {res.eng === 'ALL' && (
              <div style={{ overflowX: 'auto', marginTop: 14 }}>
                <table>
                  <thead><tr><th>Engineer</th><th>Region (Machines)</th><th>Site Visit</th><th>Remote</th><th>Remote %</th><th>Open Issues</th></tr></thead>
                  <tbody>{res.rows.map(([n, a, b, c]) => (
                    <tr key={n}><td>{n}</td><td className="note">{machines[n]?.state || '-'} ({machines[n]?.machineCount ?? 0})</td><td style={{ color: BLUE }}>{a}</td><td style={{ color: ORANGE }}>{b}</td><td>{pct(b, a + b)}</td><td style={{ color: '#dc2626', fontWeight: 600 }}>{c}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {res && (
          <div className="card">
            <div className="note" style={{ marginBottom: 10, fontWeight: 600 }}>
              Machines Visited Multiple Times ({res.from} to {res.to})
            </div>
            {repeatsLoading && <div className="note">Loading...</div>}
            {!repeatsLoading && repeats && repeats.length === 0 && (
              <div className="empty">No machine had visited more than one during this period.</div>
            )}
            {!repeatsLoading && repeats && repeats.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Machine QR</th>{res.eng === 'ALL' && <th>Engineer</th>}<th>Visits in Period</th></tr></thead>
                  <tbody>
                    {repeats.map((r) => (
                      <tr key={r.qr}>
                        <td>{r.qr}</td>
                        {res.eng === 'ALL' && <td className="note">{r.engineers}</td>}
                        <td style={{ color: '#dc2626', fontWeight: 600 }}>{r.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="note" style={{ marginTop: 10 }}>
              Only those machines are visible whose QR codes appear in 2 or more distinct entries (comprising both site visits and remote support) within the selected date range.            </p>
          </div>
        )}
        {Object.keys(unmatched).length > 0 && (
          <p className="note">Issues sheet me ye naam dashboard ke engineers se match nahi hue: {Object.entries(unmatched).map(([k, v]) => `${k} (${v})`).join(', ')}</p>
        )}
        <p className="note">Open Issues | Site Visits | Remote Supports | Repeated Visits | Locate Machines</p>
      </div>
    </>
  )
}