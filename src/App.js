import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { SEED_HOMES } from './seed'
import './App.css'
 
// ── helpers ──────────────────────────────────────────────────────────────────
const fmtP = p => '$' + Number(p).toLocaleString()
const avg = h => {
  if (h.rob && h.kelly) return ((+h.rob + +h.kelly) / 2).toFixed(1)
  if (h.rob) return (+h.rob).toFixed(1)
  if (h.kelly) return (+h.kelly).toFixed(1)
  return null
}
const scoreCol = s => {
  if (!s) return 'var(--t3)'
  const n = +s
  return n >= 8 ? 'var(--green)' : n >= 6 ? 'var(--gold)' : 'var(--red)'
}
const statCol = s =>
  s === 'Active' ? 'var(--green)'
  : s === 'Coming Soon' ? 'var(--gold)'
  : s === 'Pending' || s === 'Active Under Contract' ? 'var(--red)'
  : 'var(--t3)'
 
const parseOHMin = oh => {
  if (!oh) return Infinity
  const m = oh.match(/(\d+):(\d+)(am|pm)/i)
  if (!m) return Infinity
  let h = +m[1], mn = +m[2]
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0
  return h * 60 + mn
}
 
const hdist = (a, b) => {
  if (!a.lat || !b.lat) return 999
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}
 
const routeOpt = list => {
  if (!list.length) return []
  const s = [...list].sort((a,b) => parseOHMin(a.oh) - parseOHMin(b.oh))
  const res = [s[0]], rem = s.slice(1)
  while (rem.length) {
    const last = res[res.length-1]
    let bi = 0, bd = Infinity
    rem.forEach((h,i) => { const d = hdist(last,h); if (d < bd) { bd=d; bi=i } })
    res.push(rem.splice(bi,1)[0])
  }
  return res
}
 
const uid = () => 'h' + Date.now() + Math.random().toString(36).slice(2,5)
 
const callAI = async (system, user, max = 900) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: max,
      system,
      messages: [{ role: 'user', content: user }]
    })
  })
  const d = await res.json()
  return d.content?.[0]?.text || ''
}
 
// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [homes, setHomes]         = useState([])
  const [loaded, setLoaded]       = useState(false)
  const [tab, setTab]             = useState('homes')
  const [filter, setFilter]       = useState('all')
  const [sort, setSort]           = useState('avg_desc')
  const [detailId, setDetailId]   = useState(null)
  const [detail, setDetail]       = useState({})
  const [addOpen, setAddOpen]     = useState(false)
  const [addUrl, setAddUrl]       = useState('')
  const [addForm, setAddForm]     = useState({})
  const [fetching, setFetching]   = useState(false)
  const [toast, setToast]         = useState('')
  const [cmpIds, setCmpIds]       = useState(['','','',''])
  const [schedDate, setSchedDate] = useState('')
  const [plan, setPlan]           = useState(null)
  const [planning, setPlanning]   = useState(false)
  const [syncing, setSyncing]     = useState(false)
 
  // ── load from Supabase ──
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('homes')
        .select('*')
        .order('created_at', { ascending: true })
 
      if (error || !data?.length) {
        // Seed on first load only — upsert prevents duplicates
        const { error: insErr } = await supabase.from('homes').upsert(
          SEED_HOMES.map(h => ({ ...h, created_at: new Date().toISOString() })),
          { onConflict: 'id', ignoreDuplicates: true }
        )
        if (!insErr) setHomes(SEED_HOMES)
      } else {
        setHomes(data)
      }
      setLoaded(true)
    }
    load()
  }, [])
 
  // ── real-time subscription ──
  useEffect(() => {
    const channel = supabase
      .channel('homes_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homes' }, payload => {
        if (payload.eventType === 'INSERT') {
          setHomes(p => [...p, payload.new])
        } else if (payload.eventType === 'UPDATE') {
          setHomes(p => p.map(h => h.id === payload.new.id ? payload.new : h))
        } else if (payload.eventType === 'DELETE') {
          setHomes(p => p.filter(h => h.id !== payload.old.id))
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])
 
  const toast_ = msg => { setToast(msg); setTimeout(() => setToast(''), 2500) }
 
  // ── save a home update ──
  const saveHome = async updated => {
    setSyncing(true)
    const { error } = await supabase.from('homes').update(updated).eq('id', updated.id)
    if (error) toast_('Sync error — changes saved locally')
    else setHomes(p => p.map(h => h.id === updated.id ? updated : h))
    setSyncing(false)
  }
 
  // ── add home ──
  const addHome = async newHome => {
    setSyncing(true)
    const { error } = await supabase.from('homes').insert({ ...newHome, created_at: new Date().toISOString() })
    if (error) toast_('Could not add home')
    else { setHomes(p => [newHome, ...p]); toast_('Home added') }
    setSyncing(false)
  }
 
  // ── delete home ──
  const deleteHome = async id => {
    if (!window.confirm('Remove this home?')) return
    setSyncing(true)
    await supabase.from('homes').delete().eq('id', id)
    setHomes(p => p.filter(h => h.id !== id))
    setDetailId(null)
    setSyncing(false)
    toast_('Removed')
  }
 
  // ── URL auto-fill ──
  const fetchUrl = async () => {
    if (!addUrl.trim()) return
    setFetching(true)
    try {
      const txt = await callAI(
        'You extract real estate listing data. Given a Compass or Redfin listing URL, extract property details and return ONLY valid JSON with these exact keys: addr (string), hood (neighborhood string), price (number), sqft (number), year (number), beds (number), baths (full baths number), half (half baths number), ppsf (price per sqft number), fees (monthly HOA/fees number, 0 if none), status (one of: Active, Coming Soon, Pending, Active Under Contract), oh (open house date and time string, empty string if none). Return ONLY the raw JSON object, no markdown, no extra text.',
        'Extract listing data from this URL: ' + addUrl.trim()
      )
      const parsed = JSON.parse(txt.replace(/```json|```/g,'').trim())
      setAddForm(p => ({ ...p, ...parsed }))
      toast_('Details pulled from listing')
    } catch {
      toast_('Could not auto-fill — please fill in manually')
    }
    setFetching(false)
  }
 
  // ── open house scheduler ──
  const buildPlan = async () => {
    if (!schedDate) return
    const dt = new Date(schedDate + 'T12:00:00')
    const dayStr = dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    const [mon, day] = dayStr.split(' ')
    const ohH = homes.filter(h => h.oh && h.oh.includes(mon) && h.oh.includes(day))
    if (!ohH.length) { toast_('No open houses found for that date'); return }
    setPlanning(true)
    const routed = routeOpt(ohH)
    try {
      const ctx = routed.map((h,i) =>
        `${i+1}. ${h.addr} (${h.hood}) — ${h.oh} — $${h.price.toLocaleString()}, ${h.beds}bd/${h.baths}ba, $${h.ppsf}/sqft`
      ).join('\n')
      const notes = await callAI(
        'You are a Charlotte NC real estate expert helping a couple plan their open house tour. For each stop write ONE practical tip, max 12 words. Return ONLY a JSON array of strings, no markdown.',
        `Route for ${dayStr}:\n${ctx}`
      )
      const notesArr = JSON.parse(notes.replace(/```json|```/g,'').trim())
      setPlan({
        date: dt.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }),
        homes: routed.map((h,i) => ({ ...h, planNote: notesArr[i] || '' }))
      })
    } catch {
      setPlan({
        date: dt.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }),
        homes: routed.map(h => ({ ...h, planNote: '' }))
      })
    }
    setPlanning(false)
  }
 
  // ── filtered + sorted list ──
  const displayed = (() => {
    let l = [...homes]
    if (filter === 'visited')   l = l.filter(h => h.visited)
    if (filter === 'openhouse') l = l.filter(h => h.oh)
    if (filter === 'scored')    l = l.filter(h => h.rob || h.kelly)
    if (filter === 'unscored')  l = l.filter(h => !h.rob && !h.kelly)
    l.sort((a,b) => {
      if (sort === 'avg_desc')  return (+avg(b)||0) - (+avg(a)||0) || b.price - a.price
      if (sort === 'price_asc') return a.price - b.price
      if (sort === 'price_desc')return b.price - a.price
      if (sort === 'ppsf_asc')  return a.ppsf - b.ppsf
      if (sort === 'sqft_desc') return b.sqft - a.sqft
      return 0
    })
    return l
  })()
 
  const detailH = homes.find(h => h.id === detailId)
  const openDetail = id => {
    const h = homes.find(x => x.id === id)
    if (!h) return
    setDetail({ rob:h.rob||'', kelly:h.kelly||'', pros:h.pros||'', cons:h.cons||'', notes:h.notes||'', visited:h.visited||'', compass:h.compass||'', redfin:h.redfin||'' })
    setDetailId(id)
  }
 
  const saveDetail = async () => {
    const h = homes.find(x => x.id === detailId)
    await saveHome({ ...h, ...detail, rob: detail.rob||null, kelly: detail.kelly||null })
    setDetailId(null)
    toast_('Saved')
  }
 
  const saveAdd = async () => {
    const f = addForm
    if (!f.addr || !f.price) { toast_('Address and price required'); return }
    const sqft = +f.sqft || 0
    const price = +String(f.price).replace(/,/g,'')
    await addHome({
      id: uid(), addr: f.addr, hood: f.hood||'', price, sqft,
      year: +f.year||0, beds: +f.beds||0, baths: +f.baths||0, half: +f.half||0,
      ppsf: f.ppsf || (sqft ? Math.round(price/sqft) : 0),
      fees: +f.fees||0, status: f.status||'Active', oh: f.oh||'',
      rob:null, kelly:null, pros:'', cons:'', notes:'', visited:'',
      compass: addUrl.includes('compass') ? addUrl : f.compass||'',
      redfin:  addUrl.includes('redfin')  ? addUrl : f.redfin||'',
      lat: null, lng: null,
    })
    setAddOpen(false); setAddUrl(''); setAddForm({})
  }
 
  // ── stats ──
  const visitedCount = homes.filter(h => h.visited).length
  const ohCount = homes.filter(h => h.oh).length
  const avgs = homes.filter(h => avg(h)).map(h => +avg(h))
  const topAvg = avgs.length ? (avgs.reduce((a,b) => a+b,0)/avgs.length).toFixed(1) : '—'
 
  // ── OH groups ──
  const ohGroups = (() => {
    const d = {}
    homes.filter(h => h.oh).forEach(h => {
      const k = h.oh.split(',')[0].trim()
      if (!d[k]) d[k] = []
      d[k].push(h)
    })
    Object.keys(d).forEach(k => d[k].sort((a,b) => parseOHMin(a.oh) - parseOHMin(b.oh)))
    return d
  })()
 
  // ── compare ──
  const cmpH = cmpIds.map(id => homes.find(h => h.id === id)).filter(Boolean)
 
  // ── SVG map ──
  const mapH = (plan?.homes || []).filter(h => h.lat)
  const lats = mapH.map(h => h.lat), lngs = mapH.map(h => h.lng)
  const mnLat = lats.length ? Math.min(...lats) : 35.1, mxLat = lats.length ? Math.max(...lats) : 35.3
  const mnLng = lngs.length ? Math.min(...lngs) : -80.9, mxLng = lngs.length ? Math.max(...lngs) : -80.7
  const toXY = (lat, lng) => [
    ((lng-mnLng)/(mxLng-mnLng||.01))*620 + 30,
    (1-(lat-mnLat)/(mxLat-mnLat||.01))*200 + 20
  ]
 
  const dRob = detail.rob, dKelly = detail.kelly
  const dAvg = dRob && dKelly ? ((+dRob + +dKelly)/2).toFixed(1) : dRob ? (+dRob).toFixed(1) : dKelly ? (+dKelly).toFixed(1) : null
 
  if (!loaded) return (
    <div className="loading">
      <div className="loading-inner">
        <div className="brand-lg">Rob &amp; <em>Kelly</em></div>
        <div className="loading-sub">Loading your home search...</div>
      </div>
    </div>
  )
 
  return (
    <div className="app">
      {/* NAV */}
      <nav className="nav">
        <div className="brand">Rob &amp; <em>Kelly</em></div>
        <div className="tabs">
          {[['homes','Homes'],['openhouses','Open Houses'],['scheduler','Scheduler'],['compare','Compare']].map(([v,l]) => (
            <button key={v} className={`tab${tab===v?' on':''}`} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
        <div className="nav-right">
          {syncing && <span className="sync-dot" title="Syncing..."/>}
          <button className="add-btn" onClick={() => setAddOpen(true)}>+ Add</button>
        </div>
      </nav>
 
      {/* ── HOMES ── */}
      {tab === 'homes' && (
        <div className="page">
          <div className="stats">
            <div className="stat"><div className="lbl">Total</div><div className="val">{homes.length}</div><div className="sub">homes tracked</div></div>
            <div className="stat"><div className="lbl">Visited</div><div className="val">{visitedCount}</div><div className="sub">of {homes.length}</div></div>
            <div className="stat"><div className="lbl">Open Houses</div><div className="val">{ohCount}</div><div className="sub">scheduled</div></div>
            <div className="stat"><div className="lbl">Avg Score</div><div className="val">{topAvg}</div><div className="sub">across rated</div></div>
          </div>
          <div className="filters">
            {[['all','All'],['visited','Visited'],['openhouse','Has Open House'],['scored','Scored'],['unscored','Unscored']].map(([v,l]) => (
              <button key={v} className={`fb${filter===v?' on':''}`} onClick={() => setFilter(v)}>{l}</button>
            ))}
            <select className="ssel" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="avg_desc">Top Rated</option>
              <option value="price_asc">Price Low–High</option>
              <option value="price_desc">Price High–Low</option>
              <option value="ppsf_asc">$/sqft Low–High</option>
              <option value="sqft_desc">Largest First</option>
            </select>
          </div>
          {!displayed.length ? (
            <div className="empty"><h3>No homes match this filter</h3></div>
          ) : (
            <div className="grid">
              {displayed.map(h => {
                const a = avg(h)
                return (
                  <div key={h.id} className={`card${a && +a >= 8 ? ' gold' : ''}`} onClick={() => openDetail(h.id)}>
                    <div className="ch">
                      <div className="ca">{h.addr}</div>
                      <div className="chood">{h.hood}</div>
                      <div className="chips">
                        <span className="chip p">{fmtP(h.price)}</span>
                        <span className="chip">{h.beds}bd/{h.baths}ba</span>
                        <span className="chip">{(h.sqft||0).toLocaleString()} sf</span>
                        <span className="chip">${h.ppsf}/sf</span>
                        {h.oh && <span className="chip oh">{h.oh.split(',')[0]}</span>}
                      </div>
                    </div>
                    <div className="cb">
                      <div className="sc">
                        <div className="sb"><div className="who">Rob</div><div className="num" style={{color:scoreCol(h.rob)}}>{h.rob||'—'}</div></div>
                        <div className="sdiv"/>
                        <div className="sb"><div className="who">Kelly</div><div className="num" style={{color:scoreCol(h.kelly)}}>{h.kelly||'—'}</div></div>
                        <div className="sdiv"/>
                        <div className="sb"><div className="who">Avg</div><div className="num" style={{color:scoreCol(a)}}>{a||'—'}</div></div>
                      </div>
                      {(h.pros||h.cons) && (
                        <div className="pc-preview">
                          {h.pros && <div><span className="pro-plus">+</span> {h.pros.slice(0,50)}{h.pros.length>50?'...':''}</div>}
                          {h.cons && <div><span className="con-minus">-</span> {h.cons.slice(0,50)}{h.cons.length>50?'...':''}</div>}
                        </div>
                      )}
                    </div>
                    <div className="cf">
                      <div className="dot" style={{background:statCol(h.status)}}/>
                      <div className="stat-txt">{h.status}</div>
                      {h.visited && <span className="badge">Visited {h.visited}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
 
      {/* ── OPEN HOUSES ── */}
      {tab === 'openhouses' && (
        <div className="page">
          {!Object.keys(ohGroups).length ? (
            <div className="empty"><h3>No open houses scheduled</h3><p>Add open house dates when adding a home.</p></div>
          ) : (
            Object.entries(ohGroups).map(([day, list]) => {
              const cls = day.includes('May 2') ? 'sat' : day.includes('May 3') ? 'sun' : 'oth'
              return (
                <div key={day} className="oh-day">
                  <div className="oh-dt">{day} — {list.length} open house{list.length>1?'s':''}</div>
                  <div className="oh-list">
                    {list.map((h,i) => (
                      <div key={h.id} className="ohi" onClick={() => openDetail(h.id)}>
                        <div className={`onum ${cls}`}>{i+1}</div>
                        <div className="oh-info">
                          <div className="oh-addr">{h.addr}</div>
                          <div className="oh-hood">{h.hood}</div>
                          <div className="oh-time">{h.oh}</div>
                          <div className="chips" style={{marginTop:6}}>
                            <span className="chip p">{fmtP(h.price)}</span>
                            <span className="chip">{h.beds}bd/{h.baths}ba</span>
                            <span className="chip">${h.ppsf}/sf</span>
                            <span className="chip" style={{background:statCol(h.status)+'22',color:statCol(h.status)}}>{h.status}</span>
                          </div>
                        </div>
                        {avg(h) && <div className="oh-score" style={{color:scoreCol(avg(h))}}>{avg(h)}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
 
      {/* ── SCHEDULER ── */}
      {tab === 'scheduler' && (
        <div className="page">
          <div className="sch-bar">
            <div>
              <div className="sch-label">Pick a free day</div>
              <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className="date-input"/>
            </div>
            <button className="sch-btn" disabled={!schedDate || planning} onClick={buildPlan}>
              {planning && <span className="spin"/>}{planning ? 'Planning...' : 'Plan My Day'}
            </button>
            {plan && <button className="btn-c" onClick={() => setPlan(null)} style={{marginLeft:'auto'}}>Clear</button>}
          </div>
 
          {plan && (
            <>
              <div className="plan-box">
                <h3 className="plan-title">{plan.date} — {plan.homes.length} stops</h3>
                {plan.homes.map(h => (
                  <div key={h.id} className="pi" onClick={() => openDetail(h.id)}>
                    <div className="pi-time">{h.oh.split(',')[1]?.trim() || h.oh}</div>
                    <div className="pi-body">
                      <div className="pi-addr">{h.addr}</div>
                      <div className="pi-hood">{h.hood} · {fmtP(h.price)} · {h.beds}bd/{h.baths}ba · ${h.ppsf}/sf</div>
                      {h.planNote && <div className="pi-note">{h.planNote}</div>}
                    </div>
                    {avg(h) && <div className="pi-score" style={{color:scoreCol(avg(h))}}>{avg(h)}</div>}
                  </div>
                ))}
              </div>
              {mapH.length > 1 && (
                <div className="map-wrap">
                  <svg viewBox="0 0 680 240" style={{width:'100%',display:'block'}}>
                    <rect width="680" height="240" fill="#EEE9E2"/>
                    {mapH.map((h,i) => {
                      const [x,y] = toXY(h.lat, h.lng)
                      const nxt = mapH[i+1]
                      return (
                        <g key={h.id}>
                          {nxt && (() => { const [nx,ny] = toXY(nxt.lat,nxt.lng); return <line x1={x} y1={y} x2={nx} y2={ny} stroke="#2C5F2E" strokeWidth="1.5" strokeDasharray="4 3" opacity=".55"/> })()}
                          <circle cx={x} cy={y} r="13" fill="#2C5F2E"/>
                          <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="white" fontSize="9" fontWeight="600">{i+1}</text>
                          <text x={x} y={y+19} textAnchor="middle" fill="#1C1A17" fontSize="8.5" fontWeight="500">{h.hood.split(' ')[0]}</text>
                        </g>
                      )
                    })}
                  </svg>
                </div>
              )}
            </>
          )}
          {!plan && !planning && (
            <div className="empty">
              <h3>Pick a day to plan your tour</h3>
              <p>I'll find all open houses on that date, optimize the driving route, and add a tip for each stop.</p>
            </div>
          )}
        </div>
      )}
 
      {/* ── COMPARE ── */}
      {tab === 'compare' && (
        <div className="page">
          <div className="cmp-sel">
            <span className="cmp-label">Compare:</span>
            {[0,1,2,3].map(i => (
              <select key={i} value={cmpIds[i]} onChange={e => setCmpIds(p => p.map((v,j) => j===i ? e.target.value : v))}>
                <option value="">— select —</option>
                {homes.map(h => <option key={h.id} value={h.id}>{h.addr.slice(0,28)}</option>)}
              </select>
            ))}
          </div>
          {cmpH.length < 2 ? (
            <div className="empty"><h3>Select 2 or more homes to compare</h3></div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table className="ct">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {cmpH.map(h => (
                      <th key={h.id}>{h.addr.split(',')[0]}<br/><span className="th-sub">{h.hood}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {l:'Price',       g:h=>h.price,      f:v=>'$'+Number(v).toLocaleString(), low:true},
                    {l:'$/sqft',      g:h=>h.ppsf,       f:v=>'$'+v,                          low:true},
                    {l:'Sq Ft',       g:h=>h.sqft,       f:v=>Number(v).toLocaleString(),     hi:true},
                    {l:'Beds',        g:h=>h.beds,       f:v=>v,                              hi:true},
                    {l:'Full Baths',  g:h=>h.baths,      f:v=>v,                              hi:true},
                    {l:'Year Built',  g:h=>h.year,       f:v=>v,                              hi:true},
                    {l:'Monthly Fees',g:h=>h.fees||0,    f:v=>v?'$'+v:'None',                 low:true},
                    {l:'Rob',         g:h=>+h.rob||0,    f:v=>v||'—',                         hi:true},
                    {l:'Kelly',       g:h=>+h.kelly||0,  f:v=>v||'—',                         hi:true},
                    {l:'Average',     g:h=>+avg(h)||0,   f:v=>v||'—',                         hi:true},
                  ].map(({l,g,f,hi,low}) => {
                    const vs = cmpH.map(g)
                    const best  = hi  ? Math.max(...vs) : low ? Math.min(...vs) : null
                    const worst = hi  ? Math.min(...vs) : low ? Math.max(...vs) : null
                    return (
                      <tr key={l}>
                        <td className="lbl">{l}</td>
                        {cmpH.map((h,i) => {
                          const v = vs[i], uniq = vs.filter(x=>x===v).length < cmpH.length
                          const cls = uniq && v===best ? 'hi' : uniq && v===worst ? 'lo' : ''
                          return <td key={h.id} className={cls} style={{textAlign:'center'}}>{f(v,h)}</td>
                        })}
                      </tr>
                    )
                  })}
                  {cmpH.some(h=>h.pros) && <tr><td className="lbl">Pros</td>{cmpH.map(h=><td key={h.id} className="pro-cell">{h.pros||'—'}</td>)}</tr>}
                  {cmpH.some(h=>h.cons) && <tr><td className="lbl">Cons</td>{cmpH.map(h=><td key={h.id} className="con-cell">{h.cons||'—'}</td>)}</tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
 
      {/* ── DETAIL MODAL ── */}
      {detailId && detailH && (
        <div className="ov" onClick={e => e.target === e.currentTarget && setDetailId(null)}>
          <div className="modal">
            <div className="mh">
              <div>
                <h2>{detailH.addr}</h2>
                <div className="mh-sub">{detailH.hood}{detailH.oh && ' · ' + detailH.oh}</div>
              </div>
              <button className="xb" onClick={() => setDetailId(null)}>✕</button>
            </div>
            <div className="mb">
              <div className="ms"><h3>Details</h3>
                <div className="ig">
                  {[['Price',fmtP(detailH.price)],['$/sqft','$'+detailH.ppsf],['Sq Ft',(detailH.sqft||0).toLocaleString()],
                    ['Beds',detailH.beds],['Baths',`${detailH.baths}f / ${detailH.half||0}h`],['Year',detailH.year],
                    ['Fees',detailH.fees?'$'+detailH.fees:'None'],['Status',detailH.status]].map(([l,v]) => (
                    <div key={l} className="ii"><div className="il">{l}</div><div className="iv">{v}</div></div>
                  ))}
                </div>
              </div>
              <div className="ms"><h3>Scores (1–10)</h3>
                <div className="sg">
                  <div className="sib"><label>Rob</label>
                    <input type="number" min="1" max="10" value={dRob} onChange={e=>setDetail(p=>({...p,rob:e.target.value}))} placeholder="—"/>
                  </div>
                  <div className="sib"><label>Kelly</label>
                    <input type="number" min="1" max="10" value={dKelly} onChange={e=>setDetail(p=>({...p,kelly:e.target.value}))} placeholder="—"/>
                  </div>
                  <div className="sib"><label>Average</label>
                    <div className="adis" style={{color:scoreCol(dAvg)}}>{dAvg||'—'}</div>
                  </div>
                </div>
              </div>
              <div className="ms"><h3>Pros &amp; Cons</h3>
                <div className="pc2">
                  <div><div className="pcl pro-label">Pros</div><textarea value={detail.pros} onChange={e=>setDetail(p=>({...p,pros:e.target.value}))} placeholder="What you love..."/></div>
                  <div><div className="pcl con-label">Cons</div><textarea value={detail.cons} onChange={e=>setDetail(p=>({...p,cons:e.target.value}))} placeholder="Concerns..."/></div>
                </div>
              </div>
              <div className="ms"><h3>Notes</h3>
                <textarea value={detail.notes} onChange={e=>setDetail(p=>({...p,notes:e.target.value}))} placeholder="Impressions after visiting..."/>
              </div>
              <div className="ms"><h3>Visit Date</h3>
                <input type="date" value={detail.visited} onChange={e=>setDetail(p=>({...p,visited:e.target.value}))} style={{width:180}}/>
              </div>
              <div className="ms" style={{marginBottom:0}}><h3>Listing Links</h3>
                <div className="fg2">
                  <div className="fr"><label>Compass URL</label><input type="url" value={detail.compass} onChange={e=>setDetail(p=>({...p,compass:e.target.value}))} placeholder="https://compass.com/..."/></div>
                  <div className="fr"><label>Redfin URL</label><input type="url" value={detail.redfin} onChange={e=>setDetail(p=>({...p,redfin:e.target.value}))} placeholder="https://redfin.com/..."/></div>
                </div>
                <div className="link-row">
                  {detail.compass && <a href={detail.compass} target="_blank" rel="noreferrer">Open on Compass</a>}
                  {detail.redfin  && <a href={detail.redfin}  target="_blank" rel="noreferrer">Open on Redfin</a>}
                </div>
              </div>
            </div>
            <div className="mf">
              <button className="btn-d" onClick={() => deleteHome(detailId)}>Remove</button>
              <button className="btn-c" onClick={() => setDetailId(null)}>Cancel</button>
              <button className="btn-s" onClick={saveDetail}>Save</button>
            </div>
          </div>
        </div>
      )}
 
      {/* ── ADD MODAL ── */}
      {addOpen && (
        <div className="ov" onClick={e => e.target === e.currentTarget && (setAddOpen(false), setAddUrl(''), setAddForm({}))}>
          <div className="modal">
            <div className="mh">
              <div><h2>Add a Home</h2><div className="mh-sub">Paste a listing URL to auto-fill details</div></div>
              <button className="xb" onClick={() => { setAddOpen(false); setAddUrl(''); setAddForm({}) }}>✕</button>
            </div>
            <div className="mb">
              <div className="ms"><h3>Listing URL (optional)</h3>
                <div className="urow">
                  <input type="url" value={addUrl} onChange={e=>setAddUrl(e.target.value)} placeholder="https://compass.com/listing/... or redfin.com/..."/>
                  <button className="fbtn" disabled={!addUrl.trim()||fetching} onClick={fetchUrl}>
                    {fetching ? <><span className="spin"/>Fetching...</> : 'Auto-fill'}
                  </button>
                </div>
              </div>
              <div className="ms"><h3>Details</h3>
                <div className="fg2">
                  <div className="fr"><label>Street Address *</label><input value={addForm.addr||''} onChange={e=>setAddForm(p=>({...p,addr:e.target.value}))} placeholder="1234 Oak Lane"/></div>
                  <div className="fr"><label>Neighborhood</label><input value={addForm.hood||''} onChange={e=>setAddForm(p=>({...p,hood:e.target.value}))} placeholder="Cotswold"/></div>
                </div>
                <div className="fg3">
                  <div className="fr"><label>Price *</label><input value={addForm.price||''} onChange={e=>setAddForm(p=>({...p,price:e.target.value}))} placeholder="850000"/></div>
                  <div className="fr"><label>Sq Ft</label><input value={addForm.sqft||''} onChange={e=>setAddForm(p=>({...p,sqft:e.target.value}))} placeholder="2800"/></div>
                  <div className="fr"><label>Year Built</label><input value={addForm.year||''} onChange={e=>setAddForm(p=>({...p,year:e.target.value}))} placeholder="2018"/></div>
                </div>
                <div className="fg3">
                  <div className="fr"><label>Beds</label><input value={addForm.beds||''} onChange={e=>setAddForm(p=>({...p,beds:e.target.value}))} placeholder="4"/></div>
                  <div className="fr"><label>Full Baths</label><input value={addForm.baths||''} onChange={e=>setAddForm(p=>({...p,baths:e.target.value}))} placeholder="3"/></div>
                  <div className="fr"><label>Half Baths</label><input value={addForm.half||''} onChange={e=>setAddForm(p=>({...p,half:e.target.value}))} placeholder="1"/></div>
                </div>
                <div className="fg2">
                  <div className="fr"><label>Status</label>
                    <select value={addForm.status||'Active'} onChange={e=>setAddForm(p=>({...p,status:e.target.value}))}>
                      <option>Active</option><option>Coming Soon</option><option>Pending</option><option>Active Under Contract</option>
                    </select>
                  </div>
                  <div className="fr"><label>Monthly Fees / HOA</label><input value={addForm.fees||''} onChange={e=>setAddForm(p=>({...p,fees:e.target.value}))} placeholder="0"/></div>
                </div>
                <div className="fr" style={{marginBottom:0}}><label>Open House Date &amp; Time</label>
                  <input value={addForm.oh||''} onChange={e=>setAddForm(p=>({...p,oh:e.target.value}))} placeholder="May 10, 12:00pm–2:00pm"/>
                </div>
              </div>
            </div>
            <div className="mf">
              <button className="btn-c" onClick={()=>{setAddOpen(false);setAddUrl('');setAddForm({})}}>Cancel</button>
              <button className="btn-s" onClick={saveAdd}>Add Home</button>
            </div>
          </div>
        </div>
      )}
 
      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </div>
  )
}
 
