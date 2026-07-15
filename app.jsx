const { useState, useEffect, useMemo, useRef } = React;

/* ============================================================
   Data model
   ------------------------------------------------------------
   Tracker = { id, name, type, unit?, color, scaleMax?, daily?, aggregate?, createdAt }
     type: 'number' | 'scale' | 'boolean' | 'duration' | 'text'
     daily: true = une seule entrée par jour (ré-enregistrer remplace celle du jour)
     aggregate: 'sum' | 'avg' — comment combiner plusieurs entrées du même jour
       (nombre/durée uniquement ; pertinent quand daily est false). 'avg' par défaut.
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
  return { id:r.id, name:r.name, type:r.type, unit:r.unit || undefined, scaleMax:r.scale_max || undefined, daily:!!r.daily, aggregate:r.aggregate || 'avg', color:r.color, createdAt:r.created_at };
}
function trackerToRow(t, userId){
  return { id:t.id, user_id:userId, name:t.name, type:t.type, unit:t.unit || null, scale_max:t.scaleMax || null, daily:!!t.daily, aggregate:t.aggregate || 'avg', color:t.color, created_at:t.createdAt };
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

// Combine several numeric entries (same day, or same period) into one value,
// according to the tracker's aggregation mode. Defaults to average.
function aggregateNums(tracker, nums){
  if (!nums.length) return null;
  const sum = nums.reduce((a,b)=>a+b,0);
  return tracker.aggregate === 'sum' ? sum : sum / nums.length;
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
function startOfDay(ts){ const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
function startOfMonth(ts){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function addMonths(ts, n){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth()+n, 1).getTime(); }

/* ============================================================
   App
   ============================================================ */

function App({ session }){
  const userId = session.user.id;
  const [trackers, setTrackers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('log');        // log | trackers | vues
  const [logSub, setLogSub] = useState('jour'); // jour | historique — sub-sections of Log
  const [selectedTracker, setSelectedTracker] = useState(null); // for quick-add filter / chart focus
  const [newTrackerOpen, setNewTrackerOpen] = useState(false);
  const [editTracker, setEditTracker] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);

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
    // "Une entrée par jour" : si le tracker est en mode journalier et qu'une
    // entrée existe déjà pour ce jour, on la remplace plutôt que d'en créer une.
    const tracker = trackerById[entry.trackerId];
    if (tracker?.daily){
      const targetDay = dayKey(entry.ts ?? Date.now());
      const existing = entries.find(e => e.trackerId === entry.trackerId && dayKey(e.ts) === targetDay);
      if (existing){
        await updateEntry(existing.id, {
          value: entry.value,
          note: entry.note ?? existing.note,
          ts: entry.ts ?? existing.ts,
        });
        return;
      }
    }
    const e = { id: uid('e_'), ts: Date.now(), note:'', ...entry };
    const { error } = await supabase.from('entries').insert(entryToRow(e, userId));
    if (!error) setEntries(s => [e, ...s]);
  };
  const deleteEntry = async (id) => {
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (!error) setEntries(s => s.filter(e => e.id !== id));
  };
  const updateEntry = async (id, patch) => {
    const current = entries.find(e => e.id === id);
    if (!current) return;
    const updated = { ...current, ...patch };
    const { error } = await supabase.from('entries').update(entryToRow(updated, userId)).eq('id', id);
    if (!error) setEntries(s => s.map(e => e.id===id ? updated : e));
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

  // The tracker filter rail only makes sense where it filters something:
  // the full history list and the charts. The Trackers tab manages trackers
  // directly, and the "Jour" view always shows every tracker.
  const showRail = (tab === 'log' && logSub === 'historique') || tab === 'vues';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"></span>
          <h1>Tracklog</h1>
          <span className="by serif">— suivez n'importe quoi.</span>
        </div>
        <div className="topbar-actions">
          <div className="tabs" role="tablist">
            <button className={tab==='log'?'active':''} onClick={()=>setTab('log')}>Log</button>
            <button className={tab==='trackers'?'active':''} onClick={()=>setTab('trackers')}>Trackers</button>
            <button className={tab==='vues'?'active':''} onClick={()=>setTab('vues')}>Vues</button>
          </div>
          <button className="account-btn" onClick={()=>setPwOpen(true)}>Mot de passe</button>
          <button className="account-btn" onClick={()=>supabase.auth.signOut()}>Déconnexion</button>
        </div>
      </header>

      {showRail && (
        <TrackerRail
          trackers={trackers}
          selected={selectedTracker}
          onSelect={setSelectedTracker}
          onAdd={()=>setNewTrackerOpen(true)}
          onEdit={(t)=>setEditTracker(t)}
        />
      )}

      {tab === 'log' ? (
        <LogView
          logSub={logSub}
          onLogSub={setLogSub}
          trackers={trackers}
          trackerById={trackerById}
          entries={entries}
          selectedTracker={selectedTracker}
          onAddEntry={addEntry}
          onDeleteEntry={deleteEntry}
          onEditEntry={(e)=>setEditEntry(e)}
        />
      ) : tab === 'trackers' ? (
        <TrackersView
          trackers={trackers}
          entries={entries}
          onAdd={()=>setNewTrackerOpen(true)}
          onEdit={(t)=>setEditTracker(t)}
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
      {editEntry && (
        <EntryModal
          entry={editEntry}
          tracker={trackerById[editEntry.trackerId]}
          onClose={()=>setEditEntry(null)}
          onSave={(patch)=>{ updateEntry(editEntry.id, patch); setEditEntry(null); }}
          onDelete={()=>{ deleteEntry(editEntry.id); setEditEntry(null); }}
        />
      )}
      {pwOpen && <PasswordModal onClose={()=>setPwOpen(false)} />}
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
   Day view — fill / edit every tracker for one given day.
   Used by the "Jour" tab (today) and the Historique calendar (any day).
   ============================================================ */
function TodayView({ trackers, entries, onAddEntry }){
  const todayTs = startOfDay(Date.now());
  const dk = dayKey(todayTs);

  if (!trackers.length){
    return (
      <div className="empty">
        <span className="em-serif">Aucun tracker.</span>
        Créez-en un pour commencer à remplir votre journée.
      </div>
    );
  }

  const dailyTrackers = trackers.filter(t => t.daily);
  const dailyDone = dailyTrackers.filter(t => entries.some(e => e.trackerId === t.id && dayKey(e.ts) === dk)).length;
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

  return (
    <div>
      <div className="today-head">
        <p className="section-label" style={{textTransform:'capitalize',margin:0}}>{todayLabel}</p>
        {dailyTrackers.length > 0 && (
          <span className="today-progress">{dailyDone}/{dailyTrackers.length} quotidien{dailyTrackers.length>1?'s':''}</span>
        )}
      </div>
      <DayGrid trackers={trackers} entries={entries} onAddEntry={onAddEntry} dayTs={todayTs} isToday={true} />
    </div>
  );
}

// Grid of one editable card per tracker, for the given day.
function DayGrid({ trackers, entries, onAddEntry, dayTs, isToday }){
  const dk = dayKey(dayTs);
  const byTracker = useMemo(() => {
    const m = {};
    for (const t of trackers) m[t.id] = [];
    for (const e of entries){
      if (dayKey(e.ts) === dk && m[e.trackerId]) m[e.trackerId].push(e);
    }
    return m;
  }, [entries, trackers, dk]);

  if (!trackers.length){
    return <div className="empty"><span className="em-serif">Aucun tracker.</span></div>;
  }

  return (
    <div className="today-grid">
      {trackers.map(t => (
        <DayCard key={t.id} tracker={t} dayEntries={byTracker[t.id] || []} onAddEntry={onAddEntry} dayTs={dayTs} isToday={isToday} />
      ))}
    </div>
  );
}

function DayCard({ tracker, dayEntries, onAddEntry, dayTs, isToday }){
  const t = tracker;
  const daily = !!t.daily;
  const existing = daily && dayEntries.length ? dayEntries[0] : null;
  const count = dayEntries.length;

  const [num, setNum]     = useState('');
  const [scale, setScale] = useState(null);
  const [bool, setBool]   = useState(null);
  const [durH, setDurH]   = useState('');
  const [durM, setDurM]   = useState('');
  const [text, setText]   = useState('');
  const [flash, setFlash] = useState(false);

  // Prefill a daily tracker already logged that day so it reads as editable;
  // clear when moving to a day/tracker with no existing entry (calendar day switch).
  useEffect(() => {
    if (existing){
      switch (t.type){
        case 'number':   setNum(String(existing.value ?? '')); break;
        case 'scale':    setScale(existing.value ?? null); break;
        case 'boolean':  setBool(typeof existing.value === 'boolean' ? existing.value : null); break;
        case 'duration': setDurH(String(Math.floor((existing.value||0)/60))); setDurM(String((existing.value||0)%60)); break;
        case 'text':     setText(String(existing.value ?? '')); break;
      }
    } else {
      setNum(''); setScale(null); setBool(null); setDurH(''); setDurM(''); setText('');
    }
  }, [existing?.id, existing?.value, t.type, dayTs]);

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
    // Today keeps the real clock time; a past day is anchored at noon.
    const ts = isToday ? Date.now() : dayTs + 12*3600000;
    onAddEntry({ trackerId: t.id, value, ts });
    setFlash(true);
    setTimeout(()=>setFlash(false), 900);
    if (!daily){
      setNum(''); setScale(null); setBool(null); setDurH(''); setDurM(''); setText('');
    }
  };

  return (
    <div className={`today-card ${existing?'done':''} ${flash?'flash':''}`}>
      <div className="tc-head">
        <div className="tc-name"><span className="dot" style={{background:t.color}}></span>{t.name}</div>
        {daily
          ? (existing
              ? <span className="tc-badge on">✓ noté</span>
              : <span className="tc-badge">1×/jour</span>)
          : (count > 0 && <span className="tc-badge">{count}×</span>)}
      </div>

      <div className="tc-input">
        {t.type === 'number' && (
          <div style={{display:'flex',alignItems:'baseline',gap:6}}>
            <input type="number" step="any" value={num} onChange={e=>setNum(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="0" style={{width:'100%'}} />
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
          <div style={{display:'flex',gap:6,alignItems:'baseline'}}>
            <input type="number" min="0" placeholder="0" value={durH} onChange={e=>setDurH(e.target.value)} style={{width:44,textAlign:'right'}} />
            <span className="unit">h</span>
            <input type="number" min="0" max="59" placeholder="00" value={durM} onChange={e=>setDurM(e.target.value)} style={{width:44,textAlign:'right'}} />
            <span className="unit">min</span>
          </div>
        )}
        {t.type === 'text' && (
          <textarea value={text} onChange={e=>setText(e.target.value)} rows={2} placeholder="…" style={{width:'100%'}} />
        )}
      </div>

      <div className="tc-foot">
        <button className="primary sm" disabled={!canSave} onClick={submit}>
          {existing ? 'Remplacer' : daily ? 'Noter' : 'Ajouter'}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Log view — the entries, split into "Jour" (today) and "Historique"
   ============================================================ */
function LogView({ logSub, onLogSub, trackers, trackerById, entries, selectedTracker, onAddEntry, onDeleteEntry, onEditEntry }){
  return (
    <div>
      <div className="log-subnav">
        <div className="vue-mode">
          <button className={logSub==='jour'?'on':''} onClick={()=>onLogSub('jour')}>Jour</button>
          <button className={logSub==='historique'?'on':''} onClick={()=>onLogSub('historique')}>Historique</button>
        </div>
        <span className="log-subhint serif">
          {logSub==='jour' ? "les entrées d’aujourd’hui" : "ouvrez n’importe quel jour pour l’éditer"}
        </span>
      </div>
      {logSub === 'jour' ? (
        <TodayView trackers={trackers} entries={entries} onAddEntry={onAddEntry} />
      ) : (
        <HistoryView
          trackers={trackers}
          trackerById={trackerById}
          entries={entries}
          selectedTracker={selectedTracker}
          onAddEntry={onAddEntry}
          onDeleteEntry={onDeleteEntry}
          onEditEntry={onEditEntry}
        />
      )}
    </div>
  );
}

/* ============================================================
   History — a month calendar to open any day and edit its entries
   ============================================================ */
function HistoryView({ trackers, trackerById, entries, selectedTracker, onAddEntry, onDeleteEntry, onEditEntry }){
  const [monthTs, setMonthTs] = useState(() => startOfMonth(Date.now()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(Date.now()));

  // Respect the tracker filter rail: narrow everything to the selected tracker.
  const viewTrackers = selectedTracker ? trackers.filter(t => t.id === selectedTracker) : trackers;
  const viewEntries = useMemo(
    () => selectedTracker ? entries.filter(e => e.trackerId === selectedTracker) : entries,
    [entries, selectedTracker]
  );

  const selKey = dayKey(selectedDay);
  const isToday = selKey === dayKey(Date.now());

  const dayEntries = useMemo(
    () => viewEntries.filter(e => dayKey(e.ts) === selKey).sort((a,b) => b.ts - a.ts),
    [viewEntries, selKey]
  );

  const goToday = () => { const now = Date.now(); setSelectedDay(startOfDay(now)); setMonthTs(startOfMonth(now)); };

  return (
    <div className="hist">
      <MonthCalendar
        monthTs={monthTs}
        onPrev={()=>setMonthTs(m=>addMonths(m,-1))}
        onNext={()=>setMonthTs(m=>addMonths(m,1))}
        entries={viewEntries}
        selectedKey={selKey}
        onSelectDay={(ts)=>setSelectedDay(ts)}
      />

      <div className="day-editor">
        <div className="day-editor-head">
          <span className="serif de-title">{dayLabel(selectedDay)}</span>
          <span className="de-sub">{dayEntries.length} entrée{dayEntries.length>1?'s':''}{!isToday ? ' · archive' : ''}</span>
          {!isToday && <button className="de-today" onClick={goToday}>→ Aujourd'hui</button>}
        </div>

        {viewTrackers.length === 0 ? (
          <div className="empty"><span className="em-serif">Aucun tracker.</span> Créez-en un pour commencer.</div>
        ) : (
          <DayGrid trackers={viewTrackers} entries={viewEntries} onAddEntry={onAddEntry} dayTs={selectedDay} isToday={isToday} />
        )}

        {dayEntries.length > 0 && (
          <div className="day-entries">
            <p className="section-label" style={{margin:'22px 0 8px'}}>Entrées de ce jour</p>
            <div className="entries">
              {dayEntries.map(e => {
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
                        <button onClick={()=>onEditEntry(e)}>modifier</button>
                        <button onClick={()=>onDeleteEntry(e.id)}>supprimer</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Month calendar — click any day to open it below
   ============================================================ */
function MonthCalendar({ monthTs, onPrev, onNext, entries, selectedKey, onSelectDay }){
  const first = new Date(monthTs);
  const year = first.getFullYear(), month = first.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const leading = (first.getDay()+6)%7; // Monday-first blank cells
  const todayKey = dayKey(Date.now());

  const countByDay = useMemo(() => {
    const m = {};
    for (const e of entries){
      const d = new Date(e.ts);
      if (d.getFullYear() === year && d.getMonth() === month){
        const k = dayKey(e.ts);
        m[k] = (m[k]||0) + 1;
      }
    }
    return m;
  }, [entries, year, month]);

  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++){
    const ts = new Date(year, month, day).getTime();
    cells.push({ day, ts, key: dayKey(ts) });
  }

  const monthLabel = first.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="cal-nav" onClick={onPrev} aria-label="Mois précédent">‹</button>
        <span className="cal-title">{monthLabel}</span>
        <button className="cal-nav" onClick={onNext} aria-label="Mois suivant">›</button>
      </div>
      <div className="cal-grid">
        {['L','M','M','J','V','S','D'].map((d,i)=>(
          <div key={'h'+i} className="cal-dow">{d}</div>
        ))}
        {cells.map((c,i)=> c === null
          ? <div key={'b'+i} className="cal-cell blank"></div>
          : (
            <button
              key={c.key}
              className={`cal-cell ${c.key===selectedKey?'sel':''} ${c.key===todayKey?'today':''}`}
              onClick={()=>onSelectDay(c.ts)}
            >
              <span className="cal-day">{c.day}</span>
              {countByDay[c.key] ? <span className="cal-dot"></span> : null}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Trackers view — manage trackers and edit their properties
   ============================================================ */
function TrackersView({ trackers, entries, onAdd, onEdit }){
  const countByTracker = useMemo(() => {
    const m = {};
    for (const e of entries) m[e.trackerId] = (m[e.trackerId] || 0) + 1;
    return m;
  }, [entries]);

  return (
    <div>
      <div className="trackers-head">
        <p className="section-label" style={{margin:0}}>Trackers · {trackers.length}</p>
        <button className="pill add" onClick={onAdd}>＋ Nouveau tracker</button>
      </div>

      {trackers.length === 0 ? (
        <div className="empty">
          <span className="em-serif">Aucun tracker.</span>
          Créez-en un pour commencer à suivre quelque chose.
        </div>
      ) : (
        <div className="trackers-grid">
          {trackers.map(t => {
            const typeLabel = TYPES.find(x => x.id === t.type)?.label || t.type;
            const chips = [];
            if (t.type === 'number' && t.unit) chips.push(t.unit);
            if (t.type === 'scale') chips.push(`1–${t.scaleMax || 5}`);
            chips.push(t.daily ? 'une entrée/jour' : 'plusieurs/jour');
            if (!t.daily && (t.type === 'number' || t.type === 'duration')){
              chips.push(t.aggregate === 'sum' ? 'somme' : 'moyenne');
            }
            const count = countByTracker[t.id] || 0;
            return (
              <div className="tk-card" key={t.id}>
                <div className="tk-info">
                  <div className="tk-name"><span className="dot" style={{background:t.color}}></span>{t.name}</div>
                  <div className="tk-meta">
                    <span className="tk-type">{typeLabel}</span>
                    {chips.map((c,i)=><span key={i} className="tk-chip">{c}</span>)}
                  </div>
                  <div className="tk-count">{count} entrée{count>1?'s':''}</div>
                </div>
                <button className="tk-edit" onClick={()=>onEdit(t)}>Modifier</button>
              </div>
            );
          })}
        </div>
      )}
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
          v = aggregateNums(tracker, nums);
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
  const isSumMode = !tracker.daily && tracker.aggregate === 'sum' && (tracker.type === 'number' || tracker.type === 'duration');
  const total = isSumMode && hasData ? numericValues.reduce((a,b)=>a+b,0) : null;

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
              <div>{isSumMode ? 'total/jour' : 'moyenne'} <span className="v">{avg != null ? fmtValue(tracker, +avg.toFixed(1)) : '—'}</span></div>
              {isSumMode && <div>total période <span className="v">{total != null ? fmtValue(tracker, +total.toFixed(1)) : '—'}</span></div>}
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
        v = aggregateNums(tracker, nums);
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
        v = aggregateNums(tracker, nums) ?? 0;
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
      return aggregateNums(t, nums);
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

    const showAggTag = !t.daily && t.aggregate === 'sum' && (t.type === 'number' || t.type === 'duration');
    return { t, display, count: inRange.length, delta, showAggTag };
  });

  return (
    <div className="gridview">
      {cards.map(c => (
        <div className="gv-card" key={c.t.id}>
          <div className="label"><span className="dot" style={{background:c.t.color}}></span>{c.t.name}</div>
          <div className="v">
            {c.display}
            {fmtUnit(c.t) && c.display !== '—' && <span className="u">{fmtUnit(c.t)}</span>}
            {c.showAggTag && <span className="tk-chip" style={{marginLeft:8,verticalAlign:'middle'}}>total</span>}
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
   Entry modal (edit an existing entry)
   ============================================================ */
function EntryModal({ entry, tracker, onClose, onSave, onDelete }){
  const t = tracker;
  const [num, setNum]     = useState(t.type==='number' ? String(entry.value ?? '') : '');
  const [scale, setScale] = useState(t.type==='scale' ? entry.value : null);
  const [bool, setBool]   = useState(t.type==='boolean' ? entry.value : null);
  const [durH, setDurH]   = useState(t.type==='duration' ? String(Math.floor((entry.value||0)/60)) : '');
  const [durM, setDurM]   = useState(t.type==='duration' ? String((entry.value||0)%60) : '');
  const [text, setText]   = useState(t.type==='text' ? String(entry.value ?? '') : '');
  const [note, setNote]   = useState(entry.note || '');
  const [day, setDay]     = useState(() => {
    const d = new Date(entry.ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [at, setAt] = useState(() => {
    const d = new Date(entry.ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });

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
    const [yy, mo, dd] = day.split('-').map(x=>parseInt(x,10));
    const [hh, mm] = at.split(':').map(x=>parseInt(x,10));
    const ts = new Date(yy, (mo||1)-1, dd||1, hh||0, mm||0).getTime();
    onSave({ value, note: note.trim(), ts });
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>Modifier l'entrée</h2>
        <div className="modal-sub"><span className="dot" style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:t.color,marginRight:6}}></span>{t.name}</div>

        <div className="field">
          <label>Valeur</label>
          <div style={{flex:1}}>
            {t.type === 'number' && (
              <div style={{display:'flex',alignItems:'baseline'}}>
                <input type="number" step="any" autoFocus value={num} onChange={e=>setNum(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="0" style={{width:'100%'}} />
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
              <textarea value={text} onChange={e=>setText(e.target.value)} rows={2} style={{width:'100%'}} />
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

        <div className="field" style={{borderBottom:'none'}}>
          <label>Note</label>
          <input value={note} onChange={e=>setNote(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="optionnel" />
        </div>

        <div className="modal-actions">
          <button className="danger" onClick={()=>{ if(confirm('Supprimer cette entrée ?')) onDelete(); }}>Supprimer</button>
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>Enregistrer</button>
        </div>
      </div>
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
  const [daily, setDaily] = useState(!!tracker?.daily);
  const [aggregate, setAggregate] = useState(tracker?.aggregate || 'avg');
  const [color, setColor] = useState(tracker?.color || COLORS[1]);
  const nameRef = useRef();

  useEffect(() => { nameRef.current?.focus(); }, []);

  const canSave = name.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    const t = { name: name.trim(), type, color, daily, aggregate };
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

        <div className="field">
          <label>Fréquence</label>
          <button
            type="button"
            className={`toggle ${daily?'on':''}`}
            role="switch"
            aria-checked={daily}
            onClick={()=>setDaily(d=>!d)}
          >
            <span className="knob"></span>
            <span className="toggle-text">{daily ? 'Une entrée par jour' : 'Plusieurs par jour'}</span>
          </button>
        </div>
        <div className="field-hint" style={{borderBottom: (!daily && (type==='number'||type==='duration')) ? '1px solid var(--line)' : 'none'}}>
          {daily
            ? 'Ré-enregistrer pour un jour déjà noté remplace l’entrée de ce jour.'
            : 'Vous pouvez enregistrer autant d’entrées que vous voulez chaque jour.'}
        </div>

        {!daily && (type === 'number' || type === 'duration') && (
          <>
            <div className="field">
              <label>Calcul</label>
              <div className="seg">
                <button className={aggregate==='avg'?'on':''} onClick={()=>setAggregate('avg')}>Moyenne</button>
                <button className={aggregate==='sum'?'on':''} onClick={()=>setAggregate('sum')}>Somme</button>
              </div>
            </div>
            <div className="field-hint">
              {aggregate === 'sum'
                ? 'Les entrées d’un même jour s’additionnent (ex: 10 + 15 + 20 = 45).'
                : 'Les entrées d’un même jour sont moyennées (ex: 10, 15, 20 → 15).'}
            </div>
          </>
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
   Auth — email + password (magic link as fallback)
   ============================================================ */
function SignIn(){
  const [mode, setMode] = useState('signin'); // signin | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim() && password.length >= 6;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setErr(''); setInfo(''); setBusy(true);
    if (mode === 'signup'){
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) setErr(error.message);
      else if (!data.session) setInfo("Compte créé. Vérifiez vos e-mails pour confirmer, puis connectez-vous.");
      // if a session comes back, onAuthStateChange logs us in automatically
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setErr("E-mail ou mot de passe incorrect.");
    }
    setBusy(false);
  };

  const magicLink = async () => {
    if (!email.trim()){ setErr("Entrez votre e-mail d'abord."); return; }
    setErr(''); setInfo('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { emailRedirectTo: window.location.href },
    });
    if (error) setErr(error.message); else setInfo(`Lien de connexion envoyé à ${email}.`);
  };

  const forgot = async () => {
    if (!email.trim()){ setErr("Entrez votre e-mail d'abord."); return; }
    setErr(''); setInfo('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.href });
    if (error) setErr(error.message); else setInfo(`E-mail de réinitialisation envoyé à ${email}.`);
  };

  return (
    <div className="app" style={{maxWidth:400, paddingTop:80}}>
      <div className="brand" style={{marginBottom:28}}>
        <span className="mark"></span>
        <h1>Tracklog</h1>
      </div>
      <div className="card">
        <h3 style={{margin:0,fontSize:15,fontWeight:500}}>{mode==='signup' ? 'Créer un compte' : 'Connexion'}</h3>
        <p style={{fontSize:13,color:'var(--ink-3)',marginTop:6,marginBottom:6}}>
          {mode==='signup' ? 'Choisissez un e-mail et un mot de passe.' : 'Entrez votre e-mail et votre mot de passe.'}
        </p>
        <div className="field">
          <label>Email</label>
          <input type="email" autoFocus value={email}
            onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
            placeholder="vous@exemple.com" />
        </div>
        <div className="field" style={{borderBottom:'none'}}>
          <label>Mot de passe</label>
          <input type="password" value={password}
            onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); }}
            placeholder="au moins 6 caractères" />
        </div>
        {err && <div style={{color:'var(--warn)', fontSize:12, marginTop:10}}>{err}</div>}
        {info && <div style={{color:'var(--accent)', fontSize:12, marginTop:10}}>{info}</div>}
        <div className="save">
          <span className="hint">
            {mode==='signin' && <button style={{fontSize:12,color:'var(--ink-3)'}} onClick={forgot}>Mot de passe oublié ?</button>}
          </span>
          <button className="primary" disabled={!canSubmit || busy} onClick={submit}>
            {busy ? '…' : (mode==='signup' ? 'Créer' : 'Se connecter')}
          </button>
        </div>
        <hr className="thin" />
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,color:'var(--ink-3)'}}>
          {mode==='signup' ? (
            <button style={{fontSize:12,color:'var(--ink-2)'}} onClick={()=>{setMode('signin');setErr('');setInfo('');}}>← J'ai déjà un compte</button>
          ) : (
            <button style={{fontSize:12,color:'var(--ink-2)'}} onClick={()=>{setMode('signup');setErr('');setInfo('');}}>Créer un compte</button>
          )}
          <button style={{fontSize:12,color:'var(--ink-3)'}} onClick={magicLink}>Recevoir un lien par e-mail</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Set / change password (used while logged in and after reset link)
   ============================================================ */
function PasswordModal({ recovery, onClose }){
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const canSave = password.length >= 6 && password === confirm;

  const submit = async () => {
    if (!canSave) return;
    setErr('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setErr(error.message); else setDone(true);
  };

  return (
    <div className="scrim" onClick={recovery ? undefined : onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <h2>{recovery ? 'Nouveau mot de passe' : 'Définir un mot de passe'}</h2>
        <div className="modal-sub">Vous pourrez ensuite vous connecter avec votre e-mail et ce mot de passe.</div>
        {done ? (
          <>
            <p style={{fontSize:13,color:'var(--accent)',margin:'10px 0 0'}}>Mot de passe enregistré ✓</p>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>Fermer</button>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Mot de passe</label>
              <input type="password" autoFocus value={password} onChange={e=>setPassword(e.target.value)} placeholder="au moins 6 caractères" />
            </div>
            <div className="field" style={{borderBottom:'none'}}>
              <label>Confirmer</label>
              <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="retapez le mot de passe" />
            </div>
            {err && <div style={{color:'var(--warn)', fontSize:12, marginTop:10}}>{err}</div>}
            {password && confirm && password !== confirm && <div style={{color:'var(--warn)', fontSize:12, marginTop:10}}>Les mots de passe ne correspondent pas.</div>}
            <div className="modal-actions">
              {!recovery && <button className="ghost" onClick={onClose}>Annuler</button>}
              <button className="primary" disabled={!canSave} onClick={submit}>Enregistrer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Root(){
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [recovery, setRecovery] = useState(false);   // arrived via password-reset link

  // Recognise a password-reset link synchronously (implicit flow puts
  // "type=recovery" in the URL hash) so we show the "new password" form
  // right away instead of briefly flashing the sign-in or main screen.
  const [urlRecovery, setUrlRecovery] = useState(() => (window.location.hash || '').includes('type=recovery'));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const closeRecovery = () => {
    setRecovery(false);
    setUrlRecovery(false);
    // Drop the token from the URL so a refresh doesn't re-open recovery.
    if (window.history && window.history.replaceState){
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  if (session === undefined) return <div className="empty"><span className="em-serif">Chargement…</span></div>;
  if ((recovery || urlRecovery) && session) return <PasswordModal recovery onClose={closeRecovery} />;
  if (!session) return <SignIn />;
  return <App session={session} />;
}

/* ============================================================ */

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
