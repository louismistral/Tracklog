const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   Data model
   ------------------------------------------------------------
   Tracker = { id, name, type, unit?, color, scaleMax?, createdAt }
     type: 'number' | 'scale' | 'boolean' | 'duration' | 'text'
   Entry   = { id, trackerId, value, note, ts }
   ============================================================ */

const COLORS = [
  '#1c1b18', // ink
  'oklch(0.55 0.10 150)', // green
  'oklch(0.55 0.10 250)', // blue
  'oklch(0.55 0.10 30)',  // terracotta
  'oklch(0.55 0.10 80)',  // ochre
  'oklch(0.55 0.10 320)', // mauve
];

const TYPES = [
  { id:'number',   label:'Nombre',   desc:'kg, €, pas, ml…' },
  { id:'scale',    label:'Échelle',  desc:'1 à 5' },
  { id:'boolean',  label:'Oui / Non',desc:'fait, pas fait' },
  { id:'duration', label:'Durée',    desc:'minutes' },
  { id:'text',     label:'Texte',    desc:'note libre' },
];

/* ============================================================
   Supabase — cloud persistence + auth
   ============================================================ */
const SUPABASE_URL = 'https://drrmqrhsfgermgblndzz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycm1xcmhzZmdlcm1nYmxuZHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTI1NzMsImV4cCI6MjA5OTY4ODU3M30.NOV3tKFH2vGI043cGZhB2yu9IlqFUVoXXP4JaXA-9vE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function trackerFromRow(r){
  return { id:r.id, name:r.name, type:r.type, unit:r.unit || undefined, scaleMax:r.scale_max || undefined, color:r.color, createdAt:r.created_at };
}
function trackerToRow(t, userId){
  return { id:t.id, user_id:userId, name:t.name, type:t.type, unit:t.unit || null, scale_max:t.scaleMax || null, color:t.color, created_at:t.createdAt };
}
function entryFromRow(r){
  return { id:r.id, trackerId:r.tracker_id, value:r.value, note:r.note || '', ts:r.ts };
}
function entryToRow(e, userId){
  return { id:e.id, user_id:userId, tracker_id:e.trackerId, value:e.value, note:e.note || '', ts:e.ts };
}

/* ============================================================ */

function fmtDuration(min){
  if (min == null) return '';
  const h = Math.floor(min/60), m = Math.round(min%60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2,'0')}`;
}
function fmtValue(tracker, v){
  if (v == null || v === '') return '—';
  switch (tracker.type){
    case 'number':   return `${v}`;
    case 'scale':    return `${v}/${tracker.scaleMax||5}`;
    case 'boolean':  return v ? 'Oui' : 'Non';
    case 'duration': return fmtDuration(v);
    case 'text':     return String(v);
  }
}
function fmtUnit(tracker){
  if (tracker.type === 'number' && tracker.unit) return tracker.unit;
  return '';
}

function dayKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dayLabel(ts){
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  if (dd.getTime() === today.getTime()) return "Aujourd'hui";
  if (dd.getTime() === yest.getTime()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
}
function timeLabel(ts){
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function uid(p){ return p + Math.random().toString(36).slice(2,9); }

/* ============================================================
   App
   ============================================================ */

function App({ session }){
  const userId = session.user.id;
  const [trackers, setTrackers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('log');
  const [selectedTracker, setSelectedTracker] = useState(null); // for quick-add filter / chart focus
  const [newTrackerOpen, setNewTrackerOpen] = useState(false);
  const [editTracker, setEditTracker] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: tr, error: e1 }, { data: en, error: e2 }] = await Promise.all([
        supabase.from('trackers').select('*').order('created_at', { ascending: true }),
        supabase.from('entries').select('*').order('ts', { ascending: false }),
      ]);
      if (!e1 && tr) setTrackers(tr.map(trackerFromRow));
      if (!e2 && en) setEntries(en.map(entryFromRow));
      setLoading(false);
    })();
  }, []);

  const trackerById = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);

  const addEntry = async (entry) => {
    const e = { id: uid('e_'), ts: Date.now(), note:'', ...entry };
    const { error } = await supabase.from('entries').insert(entryToRow(e, userId));
    if (!error) setEntries(s => [e, ...s]);
  };
  const deleteEntry = async (id) => {
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (!error) setEntries(s => s.filter(e => e.id !== id));
  };
  const addTracker = async (t) => {
    const tracker = { id: uid('t_'), createdAt: Date.now(), ...t };
    const { error } = await supabase.from('trackers').insert(trackerToRow(tracker, userId));
    if (!error){ setTrackers(s => [...s, tracker]); setSelectedTracker(tracker.id); }
  };
  const updateTracker = async (id, patch) => {
    const updated = { ...trackerById[id], ...patch };
    const { error } = await supabase.from('trackers').update(trackerToRow(updated, userId)).eq('id', id);
    if (!error) setTrackers(s => s.map(t => t.id===id ? updated : t));
  };
  const removeTracker = async (id) => {
    const { error } = await supabase.from('trackers').delete().eq('id', id);
    if (!error){
      setTrackers(s => s.filter(t => t.id !== id));
      setEntries(s => s.filter(e => e.trackerId !== id));
      setSelectedTracker(prev => prev === id ? null : prev);
    }
  };

  if (loading){
    return <div className="empty"><span className="em-serif">Chargement…</span></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"></span>
          <h1>Tracklog</h1>
          <span className="by serif">— suivez n'importe quoi.</span>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:16}}>
          <div className="tabs" role="tablist">
            <button className={tab==='log'?'active':''} onClick={()=>setTab('log')}>Log</button>
            <button className={tab==='vues'?'active':''} onClick={()=>setTab('vues')}>Vues</button>
          </div>
          <button onClick={()=>supabase.auth.signOut()} style={{fontSize:12,color:'var(--ink-3)'}}>Déconnexion</button>
        </div>
      </header>

      <TrackerRail
        trackers={trackers}
        selected={selectedTracker}
        onSelect={setSelectedTracker}
        onAdd={()=>setNewTrackerOpen(true)}
        onEdit={(t)=>setEditTracker(t)}
      />

      {tab === 'log' ? (
        <LogView
          trackers={trackers}
          trackerById={trackerById}
          entries={entries}
          selectedTracker={selectedTracker}
          onAddEntry={addEntry}
          onDeleteEntry={deleteEntry}
        />
      ) : (
        <VuesView
          trackers={trackers}
          trackerById={trackerById}
          entries={entries}
          selectedTracker={selectedTracker}
        />
      )}

      <footer className="footer-note">
        <span className="mono">tracklog</span> · connecté en tant que {session.user.email}
      </footer>

      {newTrackerOpen && (
        <TrackerModal
          onClose={()=>setNewTrackerOpen(false)}
          onSave={(t)=>{ addTracker(t); setNewTrackerOpen(false); }}
        />
      )}
      {editTracker && (
        <TrackerModal
          tracker={editTracker}
          onClose={()=>setEditTracker(null)}
          onSave={(t)=>{ updateTracker(editTracker.id, t); setEditTracker(null); }}
          onDelete={()=>{ removeTracker(editTracker.id); setEditTracker(null); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Tracker rail (selectable pills)
   ============================================================ */
function TrackerRail({ trackers, selected, onSelect, onAdd, onEdit }){
  return (
    <div className="rail">
      <button
        className={`pill ${selected===null?'active':''}`}
        onClick={()=>onSelect(null)}
      >
        <span style={{fontSize:13}}>Tout</span>
      </button>
      {trackers.map(t => (
        <button
          key={t.id}
          className={`pill ${selected===t.id?'active':''}`}
          onClick={()=>onSelect(t.id)}
          onDoubleClick={()=>onEdit(t)}
          title="Double-clic pour modifier"
        >
          <span className="dot" style={{background:t.color}}></span>
          <span>{t.name}</span>
        </button>
      ))}
      <button className="pill add" onClick={onAdd}>＋ Nouveau tracker</button>
    </div>
  );
}

/* ============================================================
   Log view
   ============================================================ */
function LogView({ trackers, trackerById, entries, selectedTracker, onAddEntry, onDeleteEntry }){
  // Filter entries
  const filtered = useMemo(() => {
    let es = entries.slice().sort((a,b) => b.ts - a.ts);
    if (selectedTracker) es = es.filter(e => e.trackerId === selectedTracker);
    return es;
  }, [entries, selectedTracker]);

  // Group by day
  const groups = useMemo(() => {
    const out = [];
    let curKey = null;
    for (const e of filtered){
      const k = dayKey(e.ts);
      if (k !== curKey){
        out.push({ key:k, ts:e.ts, items:[] });
        curKey = k;
      }
      out[out.length-1].items.push(e);
    }
    return out;
  }, [filtered]);

  // Pick a tracker to "quick add" against — selected, or first one
  const quickTrackerId = selectedTracker || trackers[0]?.id;
  const quickTracker = trackerById[quickTrackerId];

  return (
    <div className="grid2">
      <div>
        <p className="section-label">{selectedTracker ? trackerById[selectedTracker]?.name : 'Toutes les entrées'} · {filtered.length}</p>
        {groups.length === 0 ? (
          <div className="empty">
            <span className="em-serif">Rien à montrer.</span>
            Ajoutez une première entrée à droite →
          </div>
        ) : (
          <div className="entries">
            {groups.map(g => (
              <div key={g.key} className="day-group">
                <div className="day-head">
                  <span>{dayLabel(g.ts)}</span>
                  <span className="count">{g.items.length}</span>
                </div>
                {g.items.map(e => {
                  const t = trackerById[e.trackerId];
                  if (!t) return null;
                  const unit = fmtUnit(t);
                  return (
                    <div className="entry" key={e.id}>
                      <div className="when">{timeLabel(e.ts)}</div>
                      <div className="what">
                        <div className="name"><span className="dot" style={{background:t.color}}></span>{t.name}</div>
                        {e.note && <div className="note">{e.note}</div>}
                      </div>
                      <div style={{display:'flex',gap:10,alignItems:'baseline'}}>
                        <div className="val">
                          {fmtValue(t, e.value)}
                          {unit && <span className="u">{unit}</span>}
                        </div>
                        <div className="actions">
                          <button onClick={()=>onDeleteEntry(e.id)}>supprimer</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {quickTracker ? (
        <QuickAdd
          tracker={quickTracker}
          trackers={trackers}
          onChangeTracker={(id)=>{ /* via select */ }}
          onAddEntry={onAddEntry}
        />
      ) : (
        <div className="card">
          <h3 style={{margin:0,fontSize:15,fontWeight:500}}>Aucun tracker</h3>
          <p style={{fontSize:13,color:'var(--ink-3)',marginTop:6}}>Créez votre premier tracker pour commencer à enregistrer des données.</p>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Quick add card
   ============================================================ */
function QuickAdd({ tracker, trackers, onAddEntry }){
  const [trackerId, setTrackerId] = useState(tracker.id);
  const t = trackers.find(x=>x.id===trackerId) || tracker;

  // local form state per type
  const [num, setNum] = useState('');
  const [scale, setScale] = useState(null);
  const [bool, setBool] = useState(null);
  const [durH, setDurH] = useState('');
  const [durM, setDurM] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [at, setAt] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [day, setDay] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });

  // reset values when tracker changes
  useEffect(() => {
    setNum(''); setScale(null); setBool(null); setDurH(''); setDurM(''); setText('');
  }, [trackerId, t.type]);

  // when tracker prop updates from outside (selection), follow it
  useEffect(()=>{ setTrackerId(tracker.id); }, [tracker.id]);

  const canSave = useMemo(() => {
    switch (t.type){
      case 'number':   return num !== '' && !isNaN(parseFloat(num));
      case 'scale':    return scale != null;
      case 'boolean':  return bool != null;
      case 'duration': return (durH !== '' || durM !== '') && (parseInt(durH||'0',10) + parseInt(durM||'0',10) > 0);
      case 'text':     return text.trim().length > 0;
    }
    return false;
  }, [t.type, num, scale, bool, durH, durM, text]);

  const submit = () => {
    if (!canSave) return;
    let value;
    switch (t.type){
      case 'number':   value = parseFloat(num); break;
      case 'scale':    value = scale; break;
      case 'boolean':  value = bool; break;
      case 'duration': value = parseInt(durH||'0',10)*60 + parseInt(durM||'0',10); break;
      case 'text':     value = text.trim(); break;
    }
    // Compute ts from "day" (YYYY-MM-DD) at "at" (HH:MM)
    const [yy, mo, dd] = day.split('-').map(x=>parseInt(x,10));
    const [hh, mm] = at.split(':').map(x=>parseInt(x,10));
    const ts = new Date(yy, (mo||1)-1, dd||1, hh||0, mm||0).getTime();

    onAddEntry({ trackerId: t.id, value, note: note.trim(), ts });
    // reset
    setNum(''); setScale(null); setBool(null); setDurH(''); setDurM(''); setText(''); setNote('');
  };

  return (
    <div className="card qa">
      <h3>Nouvelle entrée</h3>
      <div className="sub">Saisissez une valeur · <kbd className="mono" style={{fontSize:11,color:'var(--ink-3)'}}>↵</kbd></div>

      <div className="field">
        <label>Tracker</label>
        <select value={trackerId} onChange={e=>setTrackerId(e.target.value)}>
          {trackers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Valeur</label>
        <div style={{flex:1}}>
          {t.type === 'number' && (
            <div style={{display:'flex',alignItems:'baseline'}}>
              <input
                type="number" step="any" autoFocus
                value={num} onChange={e=>setNum(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
                placeholder="0"
                style={{width:'100%'}}
              />
              {t.unit && <span className="unit">{t.unit}</span>}
            </div>
          )}
          {t.type === 'scale' && (
            <div className="scale">
              {Array.from({length: t.scaleMax||5}).map((_,i)=>(
                <button key={i} className={scale===i+1?'on':''} onClick={()=>setScale(i+1)}>{i+1}</button>
              ))}
            </div>
          )}
          {t.type === 'boolean' && (
            <div className="bool">
              <button className={bool===true?'on':''} onClick={()=>setBool(true)}>Oui</button>
              <button className={bool===false?'on':''} onClick={()=>setBool(false)}>Non</button>
            </div>
          )}
          {t.type === 'duration' && (
            <div style={{display:'flex',gap:8,alignItems:'baseline'}}>
              <input type="number" min="0" placeholder="0" value={durH} onChange={e=>setDurH(e.target.value)} style={{width:50,textAlign:'right'}} />
              <span className="unit">h</span>
              <input type="number" min="0" max="59" placeholder="00" value={durM} onChange={e=>setDurM(e.target.value)} style={{width:50,textAlign:'right'}} />
              <span className="unit">min</span>
            </div>
          )}
          {t.type === 'text' && (
            <textarea
              value={text} onChange={e=>setText(e.target.value)}
              placeholder="…"
              rows={2}
              style={{width:'100%'}}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label>Date</label>
        <input type="date" value={day} max={new Date().toISOString().slice(0,10)} onChange={e=>setDay(e.target.value)} />
      </div>

      <div className="field">
        <label>Heure</label>
        <input type="time" value={at} onChange={e=>setAt(e.target.value)} />
      </div>

      <div className="field">
        <label>Note</label>
        <input
          value={note} onChange={e=>setNote(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
          placeholder="optionnel"
        />
      </div>

      <div className="save">
        <span className="hint">{t.type === 'number' && t.unit ? `en ${t.unit}` : t.type === 'scale' ? `1 — ${t.scaleMax||5}` : ''}</span>
        <button className="primary" disabled={!canSave} onClick={submit}>Enregistrer</button>
      </div>
    </div>
  );
}

/* ============================================================
   Vues view (charts / heatmap / grid)
   ============================================================ */
function VuesView({ trackers, trackerById, entries, selectedTracker }){
  const [mode, setMode] = useState('chart'); // chart | calendar | summary
  const [range, setRange] = useState(30);    // days
  const [layout, setLayout] = useState('list'); // list | grid | master | average

  const visibleTrackers = selectedTracker
    ? trackers.filter(t => t.id === selectedTracker)
    : trackers;

  // When a single tracker is selected, master/average don't make sense
  const effectiveLayout = (selectedTracker && (layout === 'master' || layout === 'average')) ? 'list' : layout;

  return (
    <div>
      <div className="vue-controls">
        <div className="vue-mode">
          <button className={mode==='chart'?'on':''} onClick={()=>setMode('chart')}>Graphes</button>
          <button className={mode==='calendar'?'on':''} onClick={()=>setMode('calendar')}>Calendrier</button>
          <button className={mode==='summary'?'on':''} onClick={()=>setMode('summary')}>Grille</button>
        </div>
        <div className="range">
          {[7,30,90,365].map(r => (
            <button key={r} className={range===r?'on':''} onClick={()=>setRange(r)}>{r}j</button>
          ))}
        </div>
      </div>

      {mode === 'chart' && (
        <>
          <div className="layout-bar">
            <span className="layout-label">Affichage</span>
            <div className="vue-mode small">
              <button className={effectiveLayout==='list'?'on':''} onClick={()=>setLayout('list')} title="Une ligne par tracker, plein largeur">
                <svg width="12" height="10" viewBox="0 0 12 10"><rect x="0" y="0" width="12" height="2.5" fill="currentColor"/><rect x="0" y="3.75" width="12" height="2.5" fill="currentColor"/><rect x="0" y="7.5" width="12" height="2.5" fill="currentColor"/></svg>
                Liste
              </button>
              <button className={effectiveLayout==='grid'?'on':''} onClick={()=>setLayout('grid')} title="Tuiles compactes">
                <svg width="12" height="10" viewBox="0 0 12 10"><rect x="0" y="0" width="5" height="4.5" fill="currentColor"/><rect x="7" y="0" width="5" height="4.5" fill="currentColor"/><rect x="0" y="5.5" width="5" height="4.5" fill="currentColor"/><rect x="7" y="5.5" width="5" height="4.5" fill="currentColor"/></svg>
                Grille
              </button>
              <button className={effectiveLayout==='master'?'on':''} onClick={()=>setLayout('master')} disabled={!!selectedTracker} title="Toutes les séries superposées, normalisées 0–100">
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M0 7 L3 4 L6 6 L9 2 L12 5"/><path d="M0 5 L3 7 L6 3 L9 5 L12 3" opacity="0.5"/></svg>
                Master
              </button>
              <button className={effectiveLayout==='average'?'on':''} onClick={()=>setLayout('average')} disabled={!!selectedTracker} title="Moyenne normalisée de tous les trackers">
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M0 6 Q3 3 6 5 T12 4"/></svg>
                Tendance
              </button>
            </div>
          </div>

          {effectiveLayout === 'list' && visibleTrackers.map(t => (
            <ChartCard key={t.id} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} />
          ))}

          {effectiveLayout === 'grid' && (
            <div className="chart-grid-layout">
              {visibleTrackers.map(t => (
                <ChartCard key={t.id} compact tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} />
              ))}
            </div>
          )}

          {effectiveLayout === 'master' && (
            <MasterChart trackers={visibleTrackers} entries={entries} rangeDays={range} />
          )}

          {effectiveLayout === 'average' && (
            <TrendChart trackers={visibleTrackers} entries={entries} rangeDays={range} />
          )}

          {visibleTrackers.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker.</span></div>}
        </>
      )}
      {mode === 'calendar' && (
        <>
          {visibleTrackers.map(t => (
            <CalendarCard key={t.id} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} />
          ))}
        </>
      )}
      {mode === 'summary' && (
        <GridSummary trackers={visibleTrackers} entries={entries} rangeDays={range} />
      )}
    </div>
  );
}

/* ============================================================
   Chart card — line chart with axes
   ============================================================ */
function ChartCard({ tracker, entries, rangeDays, compact = false }){
  const now = Date.now();
  const start = now - rangeDays*86400000;

  // Aggregate per-day: average for number/scale/duration, sum/count for boolean
  const points = useMemo(() => {
    const map = new Map();
    for (const e of entries){
      if (e.ts < start) continue;
      const k = dayKey(e.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    const arr = [];
    for (let i = rangeDays - 1; i >= 0; i--){
      const d = new Date(now - i*86400000);
      const k = dayKey(d.getTime());
      const items = map.get(k) || [];
      let v = null;
      if (items.length){
        if (tracker.type === 'boolean'){
          v = items.some(x=>x.value === true) ? 1 : 0;
        } else if (tracker.type === 'text'){
          v = items.length;
        } else {
          const nums = items.map(x => Number(x.value)).filter(x => !isNaN(x));
          v = nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
        }
      }
      arr.push({ ts: d.getTime(), value: v });
    }
    return arr;
  }, [entries, tracker, rangeDays, start, now]);

  const numericValues = points.map(p=>p.value).filter(v=>v!=null);
  const hasData = numericValues.length > 0;

  // Stats
  const latest = useMemo(() => {
    const sorted = entries.slice().sort((a,b)=>b.ts-a.ts);
    return sorted[0]?.value ?? null;
  }, [entries]);
  const avg = hasData ? numericValues.reduce((a,b)=>a+b,0)/numericValues.length : null;

  // SVG dimensions
  const W = 800, H = compact ? 110 : 160, PAD_L = compact ? 32 : 40, PAD_R = 12, PAD_T = 10, PAD_B = compact ? 20 : 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Domain
  let yMin = Math.min(...numericValues, Infinity);
  let yMax = Math.max(...numericValues, -Infinity);
  if (!isFinite(yMin) || !isFinite(yMax)){ yMin = 0; yMax = 1; }
  if (yMin === yMax){ yMin -= 1; yMax += 1; }
  // Pad domain
  const pad = (yMax - yMin) * 0.15;
  yMin -= pad; yMax += pad;
  if (tracker.type === 'boolean' || tracker.type === 'scale'){
    yMin = 0; yMax = tracker.type === 'scale' ? (tracker.scaleMax || 5) : 1;
  }

  const xAt = (i) => PAD_L + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v) => PAD_T + innerH - ((v - yMin)/(yMax - yMin)) * innerH;

  // Build path with gaps for null
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value == null){
      if (cur.length) segments.push(cur); cur = [];
    } else {
      cur.push([xAt(i), yAt(p.value)]);
    }
  });
  if (cur.length) segments.push(cur);

  // Format y-axis
  const fmtY = (v) => {
    if (tracker.type === 'duration') return fmtDuration(v);
    if (tracker.type === 'scale')    return Math.round(v).toString();
    if (tracker.type === 'boolean')  return v >= 0.5 ? 'oui' : 'non';
    return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
  };

  // X-axis ticks (start, middle, end)
  const xTicks = [
    { i: 0, label: shortDate(points[0]?.ts) },
    { i: Math.floor(points.length/2), label: shortDate(points[Math.floor(points.length/2)]?.ts) },
    { i: points.length-1, label: shortDate(points[points.length-1]?.ts) },
  ].filter(t => points[t.i]);

  // Y-axis ticks
  const yTickCount = 3;
  const yTicks = Array.from({length:yTickCount},(_,i)=>yMin + (yMax-yMin)*i/(yTickCount-1));

  return (
    <div className={`chart-card ${compact?'compact':''}`}>
      <div className="chart-head">
        <div className="name"><span className="dot" style={{background:tracker.color}}></span>{tracker.name}</div>
        <div className="stats">
          {compact ? (
            <div><span className="v">{latest != null ? fmtValue(tracker, latest) : '—'}</span></div>
          ) : (
            <>
              <div>actuel <span className="v">{latest != null ? fmtValue(tracker, latest) : '—'}</span></div>
              <div>moyenne <span className="v">{avg != null ? fmtValue(tracker, +avg.toFixed(1)) : '—'}</span></div>
              <div>entrées <span className="v">{entries.filter(e=>e.ts >= start).length}</span></div>
            </>
          )}
        </div>
      </div>
      {hasData ? (
        <svg className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Y grid */}
          {yTicks.map((v,i)=>(
            <g key={i}>
              <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
              <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{fmtY(v)}</text>
            </g>
          ))}
          {/* Area fill */}
          {segments.map((seg, si) => {
            if (seg.length < 2) return null;
            const d = seg.map((p,i)=>`${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ');
            const area = d + ` L${seg[seg.length-1][0]},${PAD_T+innerH} L${seg[0][0]},${PAD_T+innerH} Z`;
            return (
              <g key={si}>
                <path d={area} fill={tracker.color} opacity="0.08" />
                <path d={d} fill="none" stroke={tracker.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {/* Points */}
          {points.map((p,i)=> p.value != null && (
            <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r="2" fill={tracker.color}>
              <title>{shortDate(p.ts)} · {fmtValue(tracker, +p.value.toFixed(1))}</title>
            </circle>
          ))}
          {/* X ticks */}
          {xTicks.map((t,i)=>(
            <text key={i} className="chart-axis" x={xAt(t.i)} y={H-6} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
          ))}
        </svg>
      ) : (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucune donnée sur la période</div>
      )}
    </div>
  );
}

function shortDate(ts){
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
}

/* ============================================================
   Normalization helpers for master/average charts
   ============================================================ */
// Build daily series [{ts, value|null}] for a tracker over rangeDays.
function buildDailySeries(tracker, entries, rangeDays){
  const now = Date.now();
  const start = now - rangeDays*86400000;
  const map = new Map();
  for (const e of entries){
    if (e.ts < start) continue;
    const k = dayKey(e.ts);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const arr = [];
  for (let i = rangeDays - 1; i >= 0; i--){
    const d = new Date(now - i*86400000);
    const k = dayKey(d.getTime());
    const items = map.get(k) || [];
    let v = null;
    if (items.length){
      if (tracker.type === 'boolean'){
        v = items.some(x=>x.value === true) ? 1 : 0;
      } else if (tracker.type === 'text'){
        v = Math.min(1, items.length / 3); // count cap
      } else {
        const nums = items.map(x => Number(x.value)).filter(x => !isNaN(x));
        v = nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
      }
    }
    arr.push({ ts: d.getTime(), value: v });
  }
  return arr;
}

// Normalize a series to 0..1 using tracker-aware bounds.
function normalizeSeries(tracker, series){
  if (tracker.type === 'boolean') {
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : p.value }));
  }
  if (tracker.type === 'scale') {
    const max = tracker.scaleMax || 5;
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : p.value / max }));
  }
  // number / duration / text — use min/max within the series
  const vals = series.map(p=>p.value).filter(v=>v!=null);
  if (vals.length < 2) {
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : 0.5 }));
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) return series.map(p => ({ ts:p.ts, value: p.value == null ? null : 0.5 }));
  return series.map(p => ({ ts:p.ts, value: p.value == null ? null : (p.value - min) / (max - min) }));
}

// Forward-fill nulls so trend averages don't drop holes
function forwardFill(series){
  let last = null;
  return series.map(p => {
    if (p.value != null) { last = p.value; return p; }
    return { ts:p.ts, value: last };
  });
}

/* ============================================================
   MasterChart — all trackers overlaid, normalized 0..100
   ============================================================ */
function MasterChart({ trackers, entries, rangeDays }){
  const series = useMemo(() => trackers.map(t => {
    const raw = buildDailySeries(t, entries.filter(e=>e.trackerId===t.id), rangeDays);
    const norm = normalizeSeries(t, raw);
    return { tracker: t, raw, norm };
  }), [trackers, entries, rangeDays]);

  const W = 800, H = 260, PAD_L = 38, PAD_R = 14, PAD_T = 16, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const points = series[0]?.raw || [];
  const xAt = (i) => PAD_L + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v) => PAD_T + innerH - v * innerH;

  const xTicks = points.length ? [
    { i: 0, label: shortDate(points[0].ts) },
    { i: Math.floor(points.length/2), label: shortDate(points[Math.floor(points.length/2)].ts) },
    { i: points.length-1, label: shortDate(points[points.length-1].ts) },
  ] : [];

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const [hover, setHover] = useState(null);

  if (!trackers.length) return <div className="empty"><span className="em-serif">Pas de tracker.</span></div>;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="name"><span className="serif" style={{fontSize:18}}>Master</span> <span style={{color:'var(--ink-3)',fontSize:12,marginLeft:8}}>{trackers.length} séries normalisées</span></div>
        <div className="stats">
          <div>plage <span className="v">{rangeDays}j</span></div>
        </div>
      </div>
      <svg className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        onMouseMove={(e)=>{
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((x - PAD_L) / innerW) * (points.length - 1));
          if (i >= 0 && i < points.length) setHover(i);
        }}
        onMouseLeave={()=>setHover(null)}
      >
        {/* Y grid */}
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
            <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{Math.round(v*100)}</text>
          </g>
        ))}
        {/* Series */}
        {series.map(s => {
          const segs = [];
          let cur = [];
          s.norm.forEach((p,i)=>{
            if (p.value == null){ if (cur.length) segs.push(cur); cur = []; }
            else cur.push([xAt(i), yAt(p.value)]);
          });
          if (cur.length) segs.push(cur);
          return (
            <g key={s.tracker.id}>
              {segs.map((seg, si) => seg.length >= 2 && (
                <path key={si}
                  d={seg.map((p,i)=>`${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ')}
                  fill="none" stroke={s.tracker.color} strokeWidth="1.5"
                  strokeLinejoin="round" strokeLinecap="round"
                  opacity={hover==null?0.9:0.55}
                />
              ))}
            </g>
          );
        })}
        {/* Hover vertical + dots */}
        {hover != null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD_T} y2={PAD_T+innerH} stroke="var(--ink)" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5" />
            {series.map(s => s.norm[hover]?.value != null && (
              <circle key={s.tracker.id} cx={xAt(hover)} cy={yAt(s.norm[hover].value)} r="3" fill={s.tracker.color} stroke="var(--bg)" strokeWidth="1.5" />
            ))}
          </g>
        )}
        {/* X ticks */}
        {xTicks.map((t,i)=>(
          <text key={i} className="chart-axis" x={xAt(t.i)} y={H-8} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
        ))}
      </svg>

      {/* Legend / hover readouts */}
      <div className="master-legend">
        {series.map(s => {
          const p = hover != null ? s.raw[hover] : s.raw[s.raw.length-1];
          return (
            <div key={s.tracker.id} className="lg-item">
              <span className="lg-dot" style={{background:s.tracker.color}}></span>
              <span className="lg-name">{s.tracker.name}</span>
              <span className="lg-val mono">{p && p.value != null ? fmtValue(s.tracker, +(+p.value).toFixed(1)) : '—'}</span>
            </div>
          );
        })}
      </div>
      {hover != null && points[hover] && (
        <div className="hover-date">{new Date(points[hover].ts).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</div>
      )}
    </div>
  );
}

/* ============================================================
   TrendChart — single line: average of normalized series
   ============================================================ */
function TrendChart({ trackers, entries, rangeDays }){
  const series = useMemo(() => trackers.map(t => {
    const raw = buildDailySeries(t, entries.filter(e=>e.trackerId===t.id), rangeDays);
    return forwardFill(normalizeSeries(t, raw));
  }), [trackers, entries, rangeDays]);

  // Average per day
  const avgSeries = useMemo(() => {
    if (!series.length) return [];
    const len = series[0].length;
    const out = [];
    for (let i = 0; i < len; i++){
      const vals = series.map(s => s[i]?.value).filter(v => v != null);
      out.push({ ts: series[0][i].ts, value: vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null });
    }
    return out;
  }, [series]);

  const numericValues = avgSeries.map(p=>p.value).filter(v=>v!=null);
  const hasData = numericValues.length > 0;

  const latest = numericValues[numericValues.length-1] ?? null;
  const earliest = numericValues[0] ?? null;
  const overallAvg = numericValues.length ? numericValues.reduce((a,b)=>a+b,0)/numericValues.length : null;
  const delta = (latest != null && earliest != null) ? latest - earliest : null;

  const W = 800, H = 260, PAD_L = 38, PAD_R = 14, PAD_T = 16, PAD_B = 28;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xAt = (i) => PAD_L + (i / Math.max(1, avgSeries.length - 1)) * innerW;
  const yAt = (v) => PAD_T + innerH - v * innerH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // Path with gaps
  const segments = [];
  let cur = [];
  avgSeries.forEach((p, i) => {
    if (p.value == null){ if (cur.length) segments.push(cur); cur = []; }
    else cur.push([xAt(i), yAt(p.value)]);
  });
  if (cur.length) segments.push(cur);

  // Smoothed line — simple 7-day moving average
  const smoothed = avgSeries.map((p, i) => {
    if (p.value == null) return { ts:p.ts, value: null };
    const w = 7;
    let sum = 0, n = 0;
    for (let j = Math.max(0, i-w+1); j <= i; j++){
      if (avgSeries[j].value != null){ sum += avgSeries[j].value; n++; }
    }
    return { ts:p.ts, value: n ? sum/n : null };
  });
  const smSegs = [];
  let scur = [];
  smoothed.forEach((p,i)=>{
    if (p.value == null){ if (scur.length) smSegs.push(scur); scur = []; }
    else scur.push([xAt(i), yAt(p.value)]);
  });
  if (scur.length) smSegs.push(scur);

  const xTicks = avgSeries.length ? [
    { i: 0, label: shortDate(avgSeries[0].ts) },
    { i: Math.floor(avgSeries.length/2), label: shortDate(avgSeries[Math.floor(avgSeries.length/2)].ts) },
    { i: avgSeries.length-1, label: shortDate(avgSeries[avgSeries.length-1].ts) },
  ] : [];

  if (!trackers.length) return <div className="empty"><span className="em-serif">Pas de tracker.</span></div>;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="name">
          <span className="serif" style={{fontSize:18}}>Tendance générale</span>
          <span style={{color:'var(--ink-3)',fontSize:12,marginLeft:8}}>moyenne normalisée — {trackers.length} séries</span>
        </div>
        <div className="stats">
          <div>actuel <span className="v">{latest!=null ? Math.round(latest*100) : '—'}</span></div>
          <div>moyenne <span className="v">{overallAvg!=null ? Math.round(overallAvg*100) : '—'}</span></div>
          <div className={delta != null ? (delta>0?'pos':delta<0?'neg':'') : ''}>évolution
            <span className="v" style={{marginLeft:6, color: delta != null ? (delta>0?'oklch(0.55 0.10 150)':delta<0?'oklch(0.55 0.10 30)':'inherit') : 'inherit'}}>
              {delta != null ? (delta>0?'↑':delta<0?'↓':'=')+' '+Math.abs(Math.round(delta*100))+' pts' : '—'}
            </span>
          </div>
        </div>
      </div>
      {hasData ? (
        <svg className="chart-svg" style={{height:H+'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* zone bands */}
          <rect x={PAD_L} y={yAt(1)} width={innerW} height={innerH*0.25} fill="oklch(0.55 0.10 150)" opacity="0.04" />
          <rect x={PAD_L} y={yAt(0.25)} width={innerW} height={innerH*0.25} fill="oklch(0.55 0.10 30)" opacity="0.04" />
          {/* Y grid */}
          {yTicks.map((v,i)=>(
            <g key={i}>
              <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
              <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{Math.round(v*100)}</text>
            </g>
          ))}
          {/* Raw avg — faint */}
          {segments.map((seg, si) => seg.length >= 2 && (
            <path key={`r${si}`} d={seg.map((p,i)=>`${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ')}
              fill="none" stroke="var(--ink-3)" strokeWidth="1" opacity="0.35" />
          ))}
          {/* Smoothed — bold */}
          {smSegs.map((seg, si) => {
            if (seg.length < 2) return null;
            const d = seg.map((p,i)=>`${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ');
            const area = d + ` L${seg[seg.length-1][0]},${PAD_T+innerH} L${seg[0][0]},${PAD_T+innerH} Z`;
            return (
              <g key={`s${si}`}>
                <path d={area} fill="var(--ink)" opacity="0.06" />
                <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {/* X ticks */}
          {xTicks.map((t,i)=>(
            <text key={i} className="chart-axis" x={xAt(t.i)} y={H-8} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
          ))}
        </svg>
      ) : (
        <div style={{padding:'40px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucune donnée sur la période</div>
      )}
      <div className="trend-foot">
        <span className="serif">Lecture :</span> chaque tracker est ramené à une échelle 0–100 selon ses propres extrêmes, puis moyenné jour par jour. La ligne fine est la moyenne brute ; la ligne épaisse est lissée sur 7 jours.
      </div>
    </div>
  );
}

/* ============================================================
   Calendar heatmap card
   ============================================================ */
function CalendarCard({ tracker, entries, rangeDays }){
  // Always render last ~365 days of cells (or rangeDays), aligned to weeks
  const days = Math.min(Math.max(rangeDays, 30), 365);
  const now = new Date(); now.setHours(0,0,0,0);
  // start at most `days` ago, then snap to Monday
  let start = new Date(now); start.setDate(start.getDate() - (days-1));
  // align to Monday (1)
  const dow = (start.getDay() + 6) % 7; // 0=Mon
  start.setDate(start.getDate() - dow);

  // Aggregate per day
  const byDay = new Map();
  for (const e of entries){
    const k = dayKey(e.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  // Build cells from start..now in weeks (columns)
  const cells = [];
  const totalDays = Math.floor((now - start) / 86400000) + 1;
  const weeks = Math.ceil(totalDays / 7);
  // values for color scaling
  const dayVals = [];
  for (let i = 0; i < totalDays; i++){
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = dayKey(d.getTime());
    const items = byDay.get(k) || [];
    let v = 0;
    if (items.length){
      if (tracker.type === 'boolean'){
        v = items.some(x=>x.value === true) ? 1 : 0;
      } else if (tracker.type === 'text'){
        v = items.length;
      } else {
        const nums = items.map(x => Number(x.value)).filter(x => !isNaN(x));
        v = nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0;
      }
    }
    dayVals.push({ ts: d.getTime(), v, count: items.length, items });
  }
  const max = Math.max(...dayVals.map(d=>d.v), 0.0001);

  // 7 rows × N columns (weeks)
  const rows = 7;
  const cols = weeks;

  const W = 800, H = 7 * 14 + 20;
  const CELL = 11, GAP = 3;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="name"><span className="dot" style={{background:tracker.color}}></span>{tracker.name}</div>
        <div className="stats">
          <div>jours actifs <span className="v">{dayVals.filter(d=>d.count>0).length}/{totalDays}</span></div>
        </div>
      </div>
      <svg viewBox={`0 0 ${cols*(CELL+GAP)} ${H}`} preserveAspectRatio="xMinYMid meet" style={{width:'100%',height:`${H}px`}}>
        {dayVals.map((d, i) => {
          const col = Math.floor(i/7);
          const row = i % 7;
          const intensity = max > 0 ? d.v / max : 0;
          let fill = 'var(--bg-2)';
          if (d.count > 0){
            // 4 buckets
            const bucket = Math.min(3, Math.floor(intensity * 4));
            const lights = [0.92, 0.80, 0.65, 0.50];
            const chrs   = [0.04, 0.07, 0.10, 0.12];
            // parse hue from tracker.color if oklch, else fallback
            fill = `oklch(${lights[bucket]} ${chrs[bucket]} 150)`;
            // Use tracker color hue if it's an oklch string
            const m = String(tracker.color).match(/oklch\([\d\.]+ [\d\.]+ ([\d\.]+)\)/);
            if (m){ fill = `oklch(${lights[bucket]} ${chrs[bucket]} ${m[1]})`; }
            else if (tracker.color === '#1c1b18'){
              const grays = ['#e3dfd5','#bdb8a9','#7a766c','#1c1b18'];
              fill = grays[bucket];
            }
          }
          const dateLabel = new Date(d.ts).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'});
          return (
            <rect
              key={i}
              x={col*(CELL+GAP)}
              y={row*(CELL+GAP)}
              width={CELL} height={CELL}
              rx="2"
              fill={fill}
            >
              <title>{dateLabel} · {d.count ? fmtValue(tracker, +d.v.toFixed(1)) : 'rien'}</title>
            </rect>
          );
        })}
      </svg>
      <div className="heat-legend">
        moins
        <span className="lg" style={{background:'var(--bg-2)'}}></span>
        <span className="lg" style={{background:'oklch(0.92 0.04 150)'}}></span>
        <span className="lg" style={{background:'oklch(0.80 0.07 150)'}}></span>
        <span className="lg" style={{background:'oklch(0.65 0.10 150)'}}></span>
        <span className="lg" style={{background:'oklch(0.50 0.12 150)'}}></span>
        plus
      </div>
    </div>
  );
}

/* ============================================================
   Grid summary (KPI cards)
   ============================================================ */
function GridSummary({ trackers, entries, rangeDays }){
  const now = Date.now();
  const start = now - rangeDays*86400000;
  const prevStart = start - rangeDays*86400000;

  const cards = trackers.map(t => {
    const inRange = entries.filter(e => e.trackerId === t.id && e.ts >= start);
    const prev    = entries.filter(e => e.trackerId === t.id && e.ts >= prevStart && e.ts < start);
    const stat = (items) => {
      if (!items.length) return null;
      if (t.type === 'boolean') return items.filter(x=>x.value===true).length;
      if (t.type === 'text') return items.length;
      const nums = items.map(x=>Number(x.value)).filter(x=>!isNaN(x));
      if (!nums.length) return null;
      return nums.reduce((a,b)=>a+b,0)/nums.length;
    };
    const curStat = stat(inRange);
    const prevStat = stat(prev);
    const delta = curStat != null && prevStat != null && prevStat !== 0 ? (curStat - prevStat) / Math.abs(prevStat) : null;

    let display = '—';
    if (curStat != null){
      if (t.type === 'boolean') display = `${curStat}j`;
      else if (t.type === 'text') display = `${curStat}`;
      else display = fmtValue(t, +curStat.toFixed(1));
    }

    return { t, display, count: inRange.length, delta };
  });

  return (
    <div className="gridview">
      {cards.map(c => (
        <div className="gv-card" key={c.t.id}>
          <div className="label"><span className="dot" style={{background:c.t.color}}></span>{c.t.name}</div>
          <div className="v">
            {c.display}
            {fmtUnit(c.t) && c.display !== '—' && <span className="u">{fmtUnit(c.t)}</span>}
          </div>
          <div className={`trend ${c.delta != null ? (c.delta>0?'up':c.delta<0?'down':'') : ''}`}>
            {c.count} entrée{c.count>1?'s':''}
            {c.delta != null && <> · {c.delta>0?'↑':c.delta<0?'↓':'='} {Math.abs(c.delta*100).toFixed(0)}%</>}
          </div>
        </div>
      ))}
      {cards.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker.</span></div>}
    </div>
  );
}

/* ============================================================
   Tracker modal (create / edit)
   ============================================================ */
function TrackerModal({ tracker, onClose, onSave, onDelete }){
  const isEdit = !!tracker;
  const [name, setName] = useState(tracker?.name || '');
  const [type, setType] = useState(tracker?.type || 'number');
  const [unit, setUnit] = useState(tracker?.unit || '');
  const [scaleMax, setScaleMax] = useState(tracker?.scaleMax || 5);
  const [color, setColor] = useState(tracker?.color || COLORS[1]);
  const nameRef = useRef();

  useEffect(() => { nameRef.current?.focus(); }, []);

  const canSave = name.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    const t = { name: name.trim(), type, color };
    if (type === 'number' && unit.trim()) t.unit = unit.trim();
    if (type === 'scale') t.scaleMax = scaleMax;
    onSave(t);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>{isEdit ? 'Modifier le tracker' : 'Nouveau tracker'}</h2>
        <div className="modal-sub">Donnez-lui un nom et un type. Vous pourrez l'ajuster plus tard.</div>

        <div className="field">
          <label>Nom</label>
          <input ref={nameRef} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') submit();}} placeholder="ex: Caféine, Médication, Méditation…" />
        </div>

        <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
          <label style={{width:'auto'}}>Type de donnée</label>
          <div className="typegrid">
            {TYPES.map(ty => (
              <button key={ty.id} className={type===ty.id?'on':''} onClick={()=>setType(ty.id)}>
                <span className="ty">{ty.label}</span>
                <span className="desc">{ty.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {type === 'number' && (
          <div className="field">
            <label>Unité</label>
            <input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="kg, €, ml, pas… (optionnel)" />
          </div>
        )}
        {type === 'scale' && (
          <div className="field">
            <label>Max</label>
            <div className="seg">
              {[3,5,7,10].map(n => (
                <button key={n} className={scaleMax===n?'on':''} onClick={()=>setScaleMax(n)}>1–{n}</button>
              ))}
            </div>
          </div>
        )}

        <div className="field" style={{borderBottom:'none'}}>
          <label>Couleur</label>
          <div className="swatches">
            {COLORS.map(c => (
              <button key={c} className={color===c?'on':''} style={{background:c}} onClick={()=>setColor(c)} />
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {isEdit && <button className="danger" onClick={()=>{ if(confirm('Supprimer ce tracker et toutes ses entrées ?')) onDelete(); }}>Supprimer</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>{isEdit ? 'Enregistrer' : 'Créer'}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Auth — magic-link sign-in gate
   ============================================================ */
function SignIn(){
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    if (error) setErr(error.message); else setSent(true);
  };

  return (
    <div className="app" style={{maxWidth:400, paddingTop:80}}>
      <div className="brand" style={{marginBottom:28}}>
        <span className="mark"></span>
        <h1>Tracklog</h1>
      </div>
      <div className="card">
        {sent ? (
          <>
            <h3 style={{margin:0,fontSize:15,fontWeight:500}}>Vérifiez vos e-mails</h3>
            <p style={{fontSize:13,color:'var(--ink-3)',marginTop:6}}>Un lien de connexion a été envoyé à {email}.</p>
          </>
        ) : (
          <>
            <h3 style={{margin:0,fontSize:15,fontWeight:500}}>Connexion</h3>
            <p style={{fontSize:13,color:'var(--ink-3)',marginTop:6,marginBottom:14}}>Entrez votre e-mail pour recevoir un lien de connexion.</p>
            <div className="field" style={{borderBottom:'none'}}>
              <label>Email</label>
              <input
                type="email" autoFocus value={email}
                onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
                placeholder="vous@exemple.com"
              />
            </div>
            {err && <div style={{color:'var(--warn)', fontSize:12, marginTop:8}}>{err}</div>}
            <div className="save">
              <span className="hint"></span>
              <button className="primary" disabled={!email.trim()} onClick={submit}>Envoyer le lien</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Root(){
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="empty"><span className="em-serif">Chargement…</span></div>;
  if (!session) return <SignIn />;
  return <App session={session} />;
}

/* ============================================================ */

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
