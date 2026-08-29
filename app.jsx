const { useState, useEffect, useMemo, useRef, useCallback, useContext } = React;

/* ============================================================
   Data model
   ------------------------------------------------------------
   Tracker = { id, name, type, unit?, color, scaleMax?, choices?, multiple?,
               daily?, aggregate?, members?, archived?, startDate?, endDate?,
               jokerEnabled?, cumulative?, createdAt }
     — Cœur : name + type (+ config liée au type : unit, scaleMax, choices,
       ou members pour un master)
     — Paramètres : daily (fréquence), aggregate (calcul), multiple (choix),
       période d'activité (startDate/endDate), jokerEnabled (case joker), color
     — Vues : cumulative (graphe cumulatif)

     jokerEnabled: true = un tracker "plusieurs / jour" peut marquer un jour
       entier comme joker, qui exclut toutes ses entrées des calculs (pas un
       zéro). Désactivé par défaut ; sans effet sur un tracker "une / jour".

     cumulative: true = le graphe (ChartCard) affiche la somme cumulée de
       toutes les entrées depuis le début plutôt que la valeur du jour — une
       courbe qui ne peut que monter. Nombre/durée uniquement, désactivé par
       défaut.

     curveStyle: 'line' (polyligne, défaut) | 'smooth' (courbe lissée) — la
       forme du tracé, purement visuelle : les points restent les mêmes.
     chartGrain: 'day' (défaut) | 'week' | 'month' — un point du graphe couvre
       un jour, une semaine (lundi→dimanche) ou un mois. Les jours d'une même
       période sont ramenés à leur MOYENNE, pour que l'échelle reste
       comparable d'une granularité à l'autre (exception : un tracker
       cumulatif prend la valeur de fin de période, son total courant).
       Les deux réglages sont indépendants et s'appliquent aussi aux masters.

     type: 'number' | 'scale' | 'boolean' | 'duration' | 'text' | 'choice' | 'master'
     choices: string[] — options prédéfinies (type 'choice' uniquement)
     multiple: true = plusieurs choix possibles par entrée ; false = un seul.
     daily: true = une seule entrée par jour (ré-enregistrer remplace celle du jour)
     aggregate: 'avg' | 'sum' | 'min' | 'max' — comment combiner plusieurs
       entrées du même jour (nombre/durée uniquement ; pertinent quand daily
       est false). 'avg' par défaut.
     members: string[] — trackers agrégés par un master (type 'master').
       Un master n'a pas d'entrées : sa valeur est la moyenne normalisée des
       performances de ses membres.

     Fenêtre d'activité — un tracker n'influence les graphes/moyennes que pour
     les jours compris entre startDate et endDate (bornes 'YYYY-MM-DD') :
       startDate: premier jour actif (défaut = jour de création, éditable)
       endDate:   dernier jour actif (posé à l'archivage, éditable ; null = en cours)
       archived:  masqué du "Jour", rangé dans les archives ; désarchivable.
   Entry   = { id, trackerId, value, note, ts }
     value pour 'choice' : string (choix unique) ou string[] (choix multiples)
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
  { id:'choice',   label:'Choix',    desc:'options prédéfinies' },
  { id:'text',     label:'Texte',    desc:'note libre' },
];

// Combining modes for multiple same-day entries (number / duration only).
const AGGREGATES = [
  { id:'avg', label:'Moyenne' },
  { id:'sum', label:'Somme' },
  { id:'min', label:'Minimum' },
  { id:'max', label:'Maximum' },
];

/* ---- Styles ---------------------------------------------------------------
   Un style = un jeu de variables CSS sous :root[data-theme="<id>"] dans
   Tracklog.html, plus une ligne ici. Rien d'autre à toucher : l'interface des
   paramètres se construit à partir de cette liste, et le petit script en tête
   de page valide la valeur stockée contre les mêmes identifiants.
   Pour en ajouter un : un bloc de tokens dans le <style>, une entrée ici, et
   son identifiant dans STYLE_IDS de Tracklog.html. */
const STYLES = [
  { id:'dark',  label:'Sombre', hint:'Aristide — canvas presque noir, encre crème', themeColor:'#100f0d' },
  { id:'light', label:'Clair',  hint:'Aristide — canvas crème, mêmes os éditoriaux', themeColor:'#f6f2e9' },
];
const DEFAULT_STYLE = 'dark';
const isStyle = (id) => STYLES.some(s => s.id === id);

/* ---- Onglets --------------------------------------------------------------
   Log et Paramètres ne se désactivent pas : l'un est la raison d'être de
   l'app, l'autre est la seule porte pour rallumer le reste. Le reste se coupe,
   y compris l'analyse IA — qui n'est pas un onglet du haut mais une section de
   la page Bouffe, et se cache donc à part. */
const TOGGLEABLE_TABS = [
  { id:'bouffe',   label:'Bouffe',   hint:'suivi nutritionnel, scanner, aliments et repas' },
  { id:'trackers', label:'Trackers', hint:'gérer les trackers ; le rail permet d’en créer sans cet onglet' },
  { id:'vues',     label:'Vues',     hint:'graphes, calendrier, grille de KPI' },
  { id:'training', label:'Training', hint:'à venir' },
];
const TOGGLEABLE_FEATURES = [
  { id:'ia', label:'Analyse IA', hint:'l’onglet IA de la page Bouffe, qui décompose un repas décrit en texte' },
];
const DEFAULT_TABS = { bouffe:true, trackers:true, vues:true, training:true, ia:true };

// How a chart draws its line, and how wide one plotted point is. Two
// independent per-tracker display settings — neither changes the stored data.
const CURVE_STYLES = [
  { id:'line',   label:'Polyligne' },
  { id:'smooth', label:'Lissée' },
];
const GRAINS = [
  { id:'day',   label:'Jour' },
  { id:'week',  label:'Semaine' },
  { id:'month', label:'Mois' },
];

/* ============================================================
   Supabase — cloud persistence + auth
   ============================================================ */
const SUPABASE_URL = 'https://drrmqrhsfgermgblndzz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycm1xcmhzZmdlcm1nYmxuZHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTI1NzMsImV4cCI6MjA5OTY4ODU3M30.NOV3tKFH2vGI043cGZhB2yu9IlqFUVoXXP4JaXA-9vE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function trackerFromRow(r){
  return { id:r.id, name:r.name, type:r.type, unit:r.unit || undefined, scaleMax:r.scale_max || undefined, choices:Array.isArray(r.choices) ? r.choices : undefined, multiple:!!r.multiple, daily:!!r.daily, aggregate:r.aggregate || 'avg', members:Array.isArray(r.members) ? r.members : undefined, archived:!!r.archived, startDate:r.start_date || undefined, endDate:r.end_date || undefined, windowEnabled:r.window_enabled !== false, jokerEnabled:!!r.joker_enabled, cumulative:!!r.cumulative, curveStyle:r.curve_style === 'smooth' ? 'smooth' : 'line', chartGrain:GRAINS.some(g => g.id === r.chart_grain) ? r.chart_grain : 'day', order:r.order_index ?? 0, color:r.color, createdAt:r.created_at };
}
function trackerToRow(t, userId){
  return { id:t.id, user_id:userId, name:t.name, type:t.type, unit:t.unit || null, scale_max:t.scaleMax || null, choices:(t.choices && t.choices.length) ? t.choices : null, multiple:!!t.multiple, daily:!!t.daily, aggregate:t.aggregate || 'avg', members:(t.members && t.members.length) ? t.members : null, archived:!!t.archived, start_date:t.startDate || null, end_date:t.endDate || null, window_enabled:t.windowEnabled !== false, joker_enabled:!!t.jokerEnabled, cumulative:!!t.cumulative, curve_style:t.curveStyle === 'smooth' ? 'smooth' : 'line', chart_grain:GRAINS.some(g => g.id === t.chartGrain) ? t.chartGrain : 'day', order_index:t.order ?? 0, color:t.color, created_at:t.createdAt };
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
/* ---- Chart scales ---------------------------------------------------------
   Axes land on values a human would have chosen. Durations get their own ladder
   of steps because rounding minutes on powers of ten gives 10h36 → 5h24; the
   readable breaks of a clock are 15/30 min and whole hours. */
function niceStep(raw, type){
  if (raw <= 0) return 1;
  if (type === 'duration'){
    const steps = [1,2,5,10,15,20,30,60,90,120,180,240,360,480,720,1440];
    return steps.find(s => s >= raw) ?? Math.ceil(raw/1440)*1440;
  }
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  const frac = raw / base;
  const mult = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return mult * base;
}
// Widen [min,max] outward to whole steps and hand back the ticks in between.
// The bounds are never the raw extremes: they're the nearest clean multiple of
// the step, outward — so the axis reads 12.6 → 13.4 by 0.2, not 12.6 → 13.4.
// `step` comes back too: it's what decides how many decimals a label needs.
function niceDomain(min, max, tickCount, type){
  if (!isFinite(min) || !isFinite(max)){ min = 0; max = 1; }
  if (min === max){ const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const step = niceStep((max - min) / Math.max(1, tickCount - 1), type);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  return { min: lo, max: hi, ticks, step };
}

// How many decimals a tick label needs so two neighbouring ticks never print
// the same text. Reading it off the step is what stops an axis stepping by 0.5
// from showing "13" twice for 12.5 and 13.0.
function decimalsForStep(step){
  if (!isFinite(step) || step <= 0) return 0;
  const s = String(+Number(step).toPrecision(12));
  if (s.includes('e')) return 0;                 // very large steps: no decimals
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(4, s.length - dot - 1);
}

/* ---- Line shape -----------------------------------------------------------
   Two ways to join the same points, chosen per tracker (`curveStyle`). The
   points themselves never move — only the ink between them. */
function linePath(pts){
  return pts.map((p,i) => `${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ');
}
// Catmull-Rom through every point, emitted as cubic béziers: the curve passes
// exactly through each reading rather than merely near it, so a smoothed chart
// still tells the truth about what was logged.
function smoothPath(pts){
  if (pts.length < 3) return linePath(pts);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++){
    const p0 = pts[i-1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[i+2] || p2;
    d += ` C${p1[0] + (p2[0]-p0[0])/6},${p1[1] + (p2[1]-p0[1])/6}`
       + ` ${p2[0] - (p3[0]-p1[0])/6},${p2[1] - (p3[1]-p1[1])/6}`
       + ` ${p2[0]},${p2[1]}`;
  }
  return d;
}
const curvePath = (pts, style) => style === 'smooth' ? smoothPath(pts) : linePath(pts);

/* ---- Plot grain -----------------------------------------------------------
   Roll a daily series up into weeks (Monday-first) or months. Each bucket is
   the MEAN of the days that carried a value — the unit stays "a typical day",
   so switching grain doesn't move the Y axis by a factor of seven. Days with
   nothing logged contribute nothing (they don't drag the mean toward zero);
   a bucket where nothing at all was logged stays a hole, drawn dashed.
   A cumulative series is the exception: its value is a running total, so the
   bucket takes the last reading it holds — the total as of period end. */
function startOfWeek(ts){
  const d = new Date(ts); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // back to Monday
  return d.getTime();
}
function bucketStart(ts, grain){
  if (grain === 'week')  return startOfWeek(ts);
  if (grain === 'month') return startOfMonth(ts);
  return startOfDay(ts);
}
function rollupPoints(points, grain, { cumulative = false } = {}){
  if (grain !== 'week' && grain !== 'month') return points;
  const buckets = new Map();
  for (const p of points){
    const key = bucketStart(p.ts, grain);
    if (!buckets.has(key)) buckets.set(key, { ts: key, vals: [], last: null, hasEntry: false });
    const b = buckets.get(key);
    if (p.value != null){ b.vals.push(p.value); b.last = p.value; }
    if (p.hasEntry) b.hasEntry = true;
  }
  return [...buckets.values()]
    .sort((a,b) => a.ts - b.ts)
    .map(b => ({
      ts: b.ts,
      value: !b.vals.length ? null
           : cumulative ? b.last
           : b.vals.reduce((x,y)=>x+y,0) / b.vals.length,
      hasEntry: b.hasEntry,
    }));
}
// "sem. du 12 mai" / "mai 2025" — a point that spans a period must not read
// like a single date, or the axis quietly lies about what it shows.
function grainLabel(ts, grain){
  const d = new Date(ts);
  if (grain === 'month') return d.toLocaleDateString('fr-FR', { month:'long', year:'numeric' });
  if (grain === 'week')  return `sem. du ${d.toLocaleDateString('fr-FR', { day:'numeric', month:'long' })}`;
  return dayLabel(ts);
}
function grainTick(ts, grain){
  if (!ts) return '';
  // Spelled-out year: "juin 26" reads as the 26th of June in French.
  if (grain === 'month') return new Date(ts).toLocaleDateString('fr-FR', { month:'short', year:'numeric' });
  return shortDate(ts);
}

// Straight dashed hops across the days with no data, so a broken series still
// reads as one line instead of looking like unrelated fragments.
function bridgesBetween(segments){
  const out = [];
  for (let i = 1; i < segments.length; i++){
    const from = segments[i-1][segments[i-1].length - 1];
    const to = segments[i][0];
    if (from && to) out.push({ from, to });
  }
  return out;
}

// Minutes never stay above 59: 90 becomes 1h30, so the two fields always read
// the way the value will be stored and shown everywhere else.
function normalizeHM(h, m){
  const total = (parseInt(h || '0', 10) || 0) * 60 + (parseInt(m || '0', 10) || 0);
  return { h: String(Math.floor(total / 60)), m: String(total % 60).padStart(2, '0') };
}

// Running clock display, H:MM:SS (or M:SS under an hour).
function fmtChrono(ms){
  const total = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(total/3600), m = Math.floor((total%3600)/60), s = total%60;
  const mm = String(m).padStart(2,'0'), ss = String(s).padStart(2,'0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
// A chrono reads in the same unit its entry will be stored in — minutes — so what
// you watch is what gets logged. Seconds are opt-in, per chrono, for short sessions.
function fmtChronoDisplay(ms, showSeconds){
  if (showSeconds) return fmtChrono(ms);
  return fmtDuration(Math.floor(Math.max(0, ms) / 60000));
}
// A chrono banks time in `accumulatedMs` and, while running, counts from `startedAt`.
// Deriving elapsed from timestamps (rather than ticking a counter) keeps it exact
// across reloads, backgrounded tabs and a phone that went to sleep.
function chronoElapsed(c, now){
  return (c.accumulatedMs || 0) + (c.startedAt ? Math.max(0, now - c.startedAt) : 0);
}

function fmtValue(tracker, v){
  if (v === JOKER) return 'Joker';
  if (v == null || v === '') return '—';
  switch (tracker.type){
    case 'number':   return `${v}`;
    case 'scale':    return `${v}/${tracker.scaleMax||5}`;
    case 'boolean':  return v ? 'Oui' : 'Non';
    case 'duration': return fmtDuration(v);
    case 'choice':   return Array.isArray(v) ? (v.length ? v.join(', ') : '—') : String(v);
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
  switch (tracker.aggregate){
    case 'sum': return nums.reduce((a,b)=>a+b,0);
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default:    return nums.reduce((a,b)=>a+b,0) / nums.length; // avg
  }
}
function aggregateLabel(tracker){
  return AGGREGATES.find(a => a.id === tracker.aggregate)?.label || 'Moyenne';
}
// Normalize a stored choice value into input state (array if multiple, else string|null).
function readChoice(tracker, v){
  if (tracker.multiple) return Array.isArray(v) ? v : (v != null ? [v] : []);
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function dayKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// A "joker" day (pull day, rest day…) is stored as a regular Entry whose value
// is this sentinel. Its whole day is then excluded from every aggregate —
// not counted as zero, simply as if nothing had been logged that day.
const JOKER = '__joker__';
function isJokerEntry(e){ return !!e && e.value === JOKER; }
function jokerDayKeys(trackerEntries){
  const s = new Set();
  for (const e of trackerEntries) if (isJokerEntry(e)) s.add(dayKey(e.ts));
  return s;
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

/* ---- Active window --------------------------------------------------------
   A tracker only counts (charts / averages) on days within [startDate, endDate].
   Dates are 'YYYY-MM-DD' strings so they compare lexicographically. */
function trackerStartKey(t){ return t.startDate || (t.createdAt ? dayKey(t.createdAt) : null); }
function trackerActiveOnKey(t, dk){
  if (t.windowEnabled === false) return true; // window disabled → always counts
  const s = trackerStartKey(t);
  if (s && dk < s) return false;
  if (t.endDate && dk > t.endDate) return false;
  return true;
}
const isMaster = (t) => t.type === 'master';

/* Small "i" button that reveals an explanation only when clicked. */
// Global on/off for the "i" explainer bubbles. A context because InfoBubble is used
// from many unrelated, deeply nested components (modals, cards…) — threading a prop
// through every one of them would touch nearly every component signature in the file,
// and more call sites are coming later, per Louis.
const InfoVisibilityContext = React.createContext(true);

function InfoBubble({ children }){
  const infoEnabled = useContext(InfoVisibilityContext);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') setOpen(false); });
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!infoEnabled) return null;
  return (
    <span className="info" ref={ref}>
      <button type="button" className={`info-btn ${open?'on':''}`} onClick={()=>setOpen(o=>!o)} aria-label="Plus d'infos">i</button>
      {open && <span className="info-pop">{children}</span>}
    </span>
  );
}
function startOfMonth(ts){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function addMonths(ts, n){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth()+n, 1).getTime(); }

/* ============================================================
   Drag-to-reorder — like rearranging apps on a phone home screen.
   ------------------------------------------------------------
   Trackers carry a single global `order`. Any list here only ever shows a
   subset (daily-only, archived-only, the filter rail…), so a reorder inside
   a subset is spliced back into the full order in place — untouched
   trackers elsewhere never move. See mergeSubOrder / useDragReorder below,
   reused by every reorderable list (rail pills, day cards, tracker cards,
   master strips, chart cards).
   ============================================================ */
function mergeSubOrder(fullIds, newSubOrder){
  const subSet = new Set(newSubOrder);
  const rest = [];
  let insertAt = -1;
  fullIds.forEach((id) => {
    if (subSet.has(id)){ if (insertAt === -1) insertAt = rest.length; }
    else rest.push(id);
  });
  if (insertAt === -1) insertAt = rest.length;
  const merged = rest.slice();
  merged.splice(insertAt, 0, ...newSubOrder);
  return merged;
}

// A single highlight bar shared by every reorderable list. It is mounted once
// (<DropIndicatorMount/> in App) and parked, imperatively, in the gap where the
// dragged card would land. Using one fixed-position element keeps positioning in
// viewport coordinates (matches pointer clientX/Y) regardless of scroll/layout.
const dropIndicator = { el: null };
function DropIndicatorMount(){
  const ref = useRef(null);
  useEffect(() => {
    dropIndicator.el = ref.current;
    return () => { dropIndicator.el = null; };
  }, []);
  return <div ref={ref} className="drop-indicator" aria-hidden="true" />;
}
function hideDropIndicator(){ if (dropIndicator.el) dropIndicator.el.style.display = 'none'; }
// Two rects sit on the same visual row when they overlap vertically.
function sameRow(a, b){ return a.top < b.bottom && b.top < a.bottom; }

// Pointer-based (mouse + touch) reorder. While dragging, NOTHING in the list
// moves: the picked card simply follows the finger/cursor (imperative transform)
// and a highlight bar marks the target gap. The reorder is committed once, on
// drop. This avoids re-rendering the list on every move — which is what used to
// replay the page-load entrance animation and make the dragged card vanish.
function useDragReorder(ids, onReorder){
  const idsKey = ids.join('|');
  const [order, setOrder] = useState(ids);
  const [dragId, setDragId] = useState(null);
  const nodesRef = useRef({});
  const orderRef = useRef(order);
  const dragIdRef = useRef(null);
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const insRef = useRef(0);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    setOrder(prev => {
      const idsSet = new Set(ids);
      const kept = prev.filter(id => idsSet.has(id));
      const added = ids.filter(id => !kept.includes(id));
      const next = [...kept, ...added];
      orderRef.current = next;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const setNodeRef = (id) => (el) => {
    if (el) nodesRef.current[id] = el; else delete nodesRef.current[id];
  };

  const handleMove = useRef((e) => {
    const id = dragIdRef.current;
    if (id == null) return;
    movedRef.current = true;
    if (e.cancelable) e.preventDefault();
    const px = e.clientX, py = e.clientY;

    // The dragged card tracks the pointer; everything else stays put.
    const dragNode = nodesRef.current[id];
    if (dragNode){
      dragNode.style.transform =
        `translate(${px - startRef.current.x}px, ${py - startRef.current.y}px) scale(1.03)`;
    }

    // Where would it drop? Insertion index in reading order (row by row, L→R).
    const others = orderRef.current
      .filter(x => x !== id)
      .map(x => { const n = nodesRef.current[x]; return { r: n && n.getBoundingClientRect() }; })
      .filter(o => o.r);
    if (!others.length){ insRef.current = 0; hideDropIndicator(); return; }

    let ins = others.length;
    for (let i = 0; i < others.length; i++){
      const r = others[i].r;
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      const rowTol = r.height * 0.5;
      if ((py < cy - rowTol) || (Math.abs(py - cy) <= rowTol && px < cx)){ ins = i; break; }
    }
    insRef.current = ins;

    // Park the highlight bar in that gap (viewport coords).
    const el = dropIndicator.el;
    if (!el) return;
    const T = 3, G = 7; // bar thickness, offset at the list ends
    let bar;
    if (ins > 0 && ins < others.length){
      const a = others[ins - 1].r, b = others[ins].r;
      if (sameRow(a, b)){
        const top = Math.min(a.top, b.top), bot = Math.max(a.bottom, b.bottom);
        bar = { left: (a.right + b.left) / 2 - T / 2, top, width: T, height: bot - top };
      } else {
        const left = Math.min(a.left, b.left), right = Math.max(a.right, b.right);
        bar = { left, top: (a.bottom + b.top) / 2 - T / 2, width: right - left, height: T };
      }
    } else if (ins === 0){
      const b = others[0].r;
      const multi = others.some((o, i) => i !== 0 && sameRow(o.r, b) && o.r.left > b.left);
      bar = multi ? { left: b.left - G - T / 2, top: b.top, width: T, height: b.height }
                  : { left: b.left, top: b.top - G - T / 2, width: b.width, height: T };
    } else {
      const a = others[others.length - 1].r;
      const multi = others.some((o, i) => i !== others.length - 1 && sameRow(o.r, a) && o.r.left < a.left);
      bar = multi ? { left: a.right + G - T / 2, top: a.top, width: T, height: a.height }
                  : { left: a.left, top: a.bottom + G - T / 2, width: a.width, height: T };
    }
    el.style.display = 'block';
    el.style.left = bar.left + 'px';
    el.style.top = bar.top + 'px';
    el.style.width = bar.width + 'px';
    el.style.height = bar.height + 'px';
  }).current;

  const handleUp = useRef(() => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleUp);
    document.body.classList.remove('dragging-reorder');
    hideDropIndicator();

    const id = dragIdRef.current;
    const dragNode = id != null ? nodesRef.current[id] : null;
    if (dragNode) dragNode.style.transform = '';

    if (id != null && movedRef.current){
      const others = orderRef.current.filter(x => x !== id);
      const ins = Math.max(0, Math.min(insRef.current, others.length));
      const next = others.slice();
      next.splice(ins, 0, id);
      const changed = next.some((x, i) => x !== orderRef.current[i]);
      if (changed){
        // The commit reflows the list; suppress the entrance animation so the
        // reordered cards don't replay the page-load "riseIn".
        document.body.classList.add('reordering');
        setTimeout(() => document.body.classList.remove('reordering'), 400);
        orderRef.current = next;
        setOrder(next);
        onReorderRef.current(next);
      }
    }
    dragIdRef.current = null;
    movedRef.current = false;
    setDragId(null);
  }).current;

  const startDrag = (id) => (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.cancelable) e.preventDefault();
    dragIdRef.current = id;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    insRef.current = Math.max(0, orderRef.current.indexOf(id));
    setDragId(id);
    document.body.classList.add('dragging-reorder');
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  // Without a reorder handler (the list is under an automatic sort) dragging would
  // fight the sort, so hand back inert controls: `startDrag` yielding null also
  // removes the grip, since cards only draw one when given a handler.
  if (!onReorder) return { order: ids, dragId: null, setNodeRef: () => undefined, startDrag: () => null };
  return { order, dragId, setNodeRef, startDrag };
}

// Small grip handle that starts a drag. Kept separate from the rest of a
// card so it never steals clicks from buttons/inputs inside it.
function DragHandle({ onPointerDown, dragging }){
  return (
    <span className={`drag-handle ${dragging?'dragging':''}`} onPointerDown={onPointerDown} aria-label="Réordonner" title="Glisser pour réordonner">
      <svg width="9" height="15" viewBox="0 0 9 15"><circle cx="2.2" cy="2.2" r="1"/><circle cx="6.8" cy="2.2" r="1"/><circle cx="2.2" cy="7.5" r="1"/><circle cx="6.8" cy="7.5" r="1"/><circle cx="2.2" cy="12.8" r="1"/><circle cx="6.8" cy="12.8" r="1"/></svg>
    </span>
  );
}


/* ============================================================
   Préférences de compte — user_settings
   ------------------------------------------------------------
   Un seul blob jsonb par compte. Le thème et les bulles d'aide
   restent en localStorage : ce sont des choix d'appareil (un
   téléphone dehors, un écran de bureau). Ce qui décrit la forme
   de l'app — quels onglets existent — suit le compte, sinon
   masquer Bouffe sur le PC laisserait le téléphone incohérent.

   Écriture optimiste : l'état local part devant, la base suit.
   Un réglage d'affichage qui attend le réseau donne une app
   qui colle, et l'échec n'y coûte qu'un rechargement.
   ============================================================ */
function useAccountPrefs(userId){
  const [prefs, setPrefs] = useState(null);   // null = pas encore chargé
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('user_settings').select('*').maybeSingle();
      if (cancelled) return;
      // Table absente (migration pas encore passée) : on tourne sur les valeurs
      // par défaut plutôt que de bloquer toute l'app sur un réglage d'affichage.
      setPrefs((!error && data && data.prefs) ? data.prefs : {});
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const savePrefs = useCallback(async (patch) => {
    setPrefs(prev => {
      const next = { ...(prev || {}), ...patch };
      supabase.from('user_settings')
        .upsert({ user_id: userId, prefs: next, updated_at: Date.now() })
        .then(({ error }) => { if (error) console.warn('user_settings', error.message); });
      return next;
    });
  }, [userId]);

  const tabs = { ...DEFAULT_TABS, ...((prefs && prefs.tabs) || {}) };
  const setTab = (id, on) => savePrefs({ tabs: { ...tabs, [id]: on } });
  return { ready: prefs !== null, prefs: prefs || {}, savePrefs, tabs, setTab };
}

const FEEDBACK_KINDS = [
  { id:'bug',     label:'Bug' },
  { id:'feature', label:'Idée' },
  { id:'avis',    label:'Avis' },
  { id:'autre',   label:'Autre' },
];

/* ============================================================
   App
   ============================================================ */

function App({ session }){
  const userId = session.user.id;
  const [trackers, setTrackers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('log');        // log | bouffe | trackers | vues | training | parametres
  const accountPrefs = useAccountPrefs(userId);
  const [logSub, setLogSub] = useState('jour'); // jour | historique | chrono — sub-sections of Log
  const [foodSub, setFoodSub] = useState('jour'); // jour | aliments | vues — sub-sections of Bouffe
  // La nutrition a son propre magasin (foods / food_logs / objectifs), chargé ici
  // une seule fois : la page Bouffe et les compteurs du Jour lisent la même chose.
  const food = useFoodStore(userId);
  // Chronos are per-device working state (what's running right now), not history, so they
  // live in localStorage — only the entry a chrono produces is saved to the database.
  const chronoKey = `tracklog.chronos.${userId}`;
  const [chronos, setChronos] = useState(() => {
    try {
      const raw = localStorage.getItem(`tracklog.chronos.${session.user.id}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(chronoKey, JSON.stringify(chronos)); } catch {}
  }, [chronos, chronoKey]);
  // Whether starting a chrono pauses every other one — a per-device preference,
  // not data, so it lives next to the chronos themselves in localStorage.
  const exclusiveKey = `tracklog.chronoExclusive.${userId}`;
  const [chronoExclusive, setChronoExclusive] = useState(() => {
    try { return localStorage.getItem(exclusiveKey) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(exclusiveKey, chronoExclusive ? '1' : '0'); } catch {}
  }, [chronoExclusive, exclusiveKey]);
  // Whether the "i" explainer bubbles show up at all — a per-device preference for
  // once the app is familiar, not data worth syncing across devices.
  const infoKey = `tracklog.infoEnabled.${userId}`;
  const [infoEnabled, setInfoEnabled] = useState(() => {
    try { const v = localStorage.getItem(infoKey); return v === null ? true : v === '1'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(infoKey, infoEnabled ? '1' : '0'); } catch {}
  }, [infoEnabled, infoKey]);
  // Light/dark is read by a tiny inline script in <head>, before this app even loads,
  // so the page never flashes the wrong theme — that script can't know which account
  // is signing in yet, so this stays one unscoped key rather than per-user like the
  // preferences above. `document.documentElement.dataset.theme` is the single source
  // of truth the CSS reads (:root[data-theme="light"|"dark"]); state here just mirrors
  // it so the settings toggle re-renders.
  const [theme, setTheme] = useState(() => {
    try { const t = document.documentElement.dataset.theme; return isStyle(t) ? t : DEFAULT_STYLE; }
    catch { return DEFAULT_STYLE; }
  });
  useEffect(() => {
    try {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('tracklog.theme', theme);
      const meta = document.querySelector('meta[name="theme-color"]');
      const style = STYLES.find(s => s.id === theme);
      if (meta && style) meta.setAttribute('content', style.themeColor);
    } catch {}
  }, [theme]);
  // Multi-select filter for the rail. `selectedIds` is the remembered set;
  // `showAll` temporarily overrides it (the "Tout" toggle) while keeping the
  // set intact (shown greyed) so it isn't lost.
  const [selectedIds, setSelectedIds] = useState([]);
  const [showAll, setShowAll] = useState(true);
  // Filters and sorting start collapsed everywhere — they're occasional controls,
  // and on a phone an expanded rail pushed the day's cards below the fold.
  const [railOpen, setRailOpen] = useState(false);
  const [sortMode, setSortMode] = useState('manuel'); // manuel | alpha | recent | type
  const [newTrackerOpen, setNewTrackerOpen] = useState(false);
  const [editTracker, setEditTracker] = useState(null);
  const [editEntry, setEditEntry] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  // Jumping to a day from a chart's floating tooltip: bump the token on every
  // request so HistoryView re-syncs even when the target day hasn't changed.
  const [historyJump, setHistoryJump] = useState(null); // { ts, token }
  const openDayInHistory = (ts) => {
    setHistoryJump(j => ({ ts, token: (j?.token || 0) + 1 }));
    setLogSub('historique');
    setTab('log');
  };

  useEffect(() => {
    (async () => {
      const [{ data: tr, error: e1 }, { data: en, error: e2 }] = await Promise.all([
        supabase.from('trackers').select('*').order('order_index', { ascending: true }),
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
  const addChrono = ({ label, trackerId }) => {
    setChronos(s => [...s, { id: uid('c_'), label, trackerId: trackerId || null, accumulatedMs: 0, startedAt: null }]);
  };
  const startChrono = (id) => {
    const now = Date.now();
    setChronos(s => s.map(c => {
      if (c.id === id) return c.startedAt ? c : { ...c, startedAt: now };
      // In exclusive mode, starting one banks and stops whichever other was running —
      // same accounting as a manual pause, just triggered on the other chrono's behalf.
      if (chronoExclusive && c.startedAt) return { ...c, accumulatedMs: chronoElapsed(c, now), startedAt: null };
      return c;
    }));
  };
  // Pausing banks the running segment, so elapsed time never depends on render timing.
  const pauseChrono = (id) => {
    const now = Date.now();
    setChronos(s => s.map(c => (c.id !== id || !c.startedAt) ? c
      : { ...c, accumulatedMs: chronoElapsed(c, now), startedAt: null }));
  };
  const resetChrono = (id) => {
    setChronos(s => s.map(c => c.id !== id ? c : { ...c, accumulatedMs: 0, startedAt: null }));
  };
  // Bulk action: stops and zeroes every chrono on the board at once.
  const resetAllChronos = () => {
    setChronos(s => s.map(c => ({ ...c, accumulatedMs: 0, startedAt: null })));
  };
  const removeChrono = (id) => setChronos(s => s.filter(c => c.id !== id));
  const updateChrono = (id, patch) => setChronos(s => s.map(c => c.id === id ? { ...c, ...patch } : c));
  // Bank the elapsed time as a real entry on the linked tracker, then start the chrono over.
  const saveChronoAsEntry = async (id) => {
    const c = chronos.find(x => x.id === id);
    if (!c || !c.trackerId) return;
    const minutes = Math.round(chronoElapsed(c, Date.now()) / 60000);
    if (minutes < 1) return;
    await addEntry({ trackerId: c.trackerId, value: minutes, ts: Date.now() });
    resetChrono(id);
  };

  const addTracker = async (t) => {
    const nextOrder = trackers.length ? Math.max(...trackers.map(x => x.order || 0)) + 1 : 0;
    const tracker = { id: uid('t_'), createdAt: Date.now(), order: nextOrder, ...t };
    const { error } = await supabase.from('trackers').insert(trackerToRow(tracker, userId));
    if (!error){ setTrackers(s => [...s, tracker]); setShowAll(true); /* make the new one visible */ }
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
      setSelectedIds(prev => prev.filter(x => x !== id));
    }
  };
  const archiveTracker = (id) => {
    const t = trackerById[id];
    const patch = { archived: true };
    if (!t.endDate) patch.endDate = dayKey(Date.now()); // stop counting today by default
    updateTracker(id, patch);
    setSelectedIds(prev => prev.filter(x => x !== id));
  };
  const unarchiveTracker = (id) => updateTracker(id, { archived: false, endDate: null });

  // Reorder: `newSubOrder` is the freshly dragged order of a *subset* of
  // trackers (a filter rail, a day-card group, one grid…). It's spliced
  // back into the full global order so every other view — and every other
  // tab — stays in sync without needing its own drag handles.
  const reorderTrackers = (newSubOrder) => {
    const fullIds = trackers.map(t => t.id);
    const merged = mergeSubOrder(fullIds, newSubOrder);
    const orderMap = Object.fromEntries(merged.map((id, i) => [id, i]));
    const changed = trackers.filter(t => orderMap[t.id] !== t.order);
    if (!changed.length) return;
    setTrackers(s => s.map(t => ({ ...t, order: orderMap[t.id] })).sort((a,b) => a.order - b.order));
    Promise.all(changed.map(t => supabase.from('trackers').update({ order_index: orderMap[t.id] }).eq('id', t.id)));
  };

  // Last time each tracker was logged — backs the "activité récente" sort.
  // Must stay above the loading guard: a hook skipped on the first render and run on
  // the next changes the hook order, which React refuses — it blanks the whole app.
  const lastEntryByTracker = useMemo(() => {
    const m = {};
    for (const e of entries){
      if (!m[e.trackerId] || e.ts > m[e.trackerId]) m[e.trackerId] = e.ts;
    }
    return m;
  }, [entries]);

  if (loading){
    return <div className="empty"><span className="em-serif">Chargement…</span></div>;
  }

  // Sorting is a view over the manual order, never a rewrite of it: leaving a sort
  // mode restores the arrangement you dragged into place.
  const sortTrackers = (list) => {
    const arr = [...list];
    switch (sortMode){
      case 'alpha':
        return arr.sort((a,b) => a.name.localeCompare(b.name, 'fr', { sensitivity:'base' }));
      case 'recent': // never-logged trackers sink to the bottom rather than topping the list
        return arr.sort((a,b) => (lastEntryByTracker[b.id] ?? -Infinity) - (lastEntryByTracker[a.id] ?? -Infinity));
      case 'type':
        return arr.sort((a,b) => (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name, 'fr'));
      default:
        return arr; // 'manuel' — keep the drag order
    }
  };
  const manualSort = sortMode === 'manuel';

  // Trackers you still log every day: not archived, and not a computed master.
  const activeTrackers = sortTrackers(trackers.filter(t => !t.archived));
  const loggableTrackers = activeTrackers.filter(t => !isMaster(t));
  const masterTrackers = activeTrackers.filter(t => isMaster(t));

  // Effective filter: `filterActive` when there is a remembered selection and
  // "Tout" isn't overriding it. `filterIds` is null (= show everything) or the
  // list of ids each view should narrow to.
  const filterActive = selectedIds.length > 0 && !showAll;
  const filterIds = filterActive ? selectedIds : null;
  const toggleTracker = (id) => {
    setShowAll(false);
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleAll = () => setShowAll(prev => !prev);

  // The tracker filter rail is available on every tracker tab (Log, Trackers, Vues).
  // Not on Bouffe: it filters trackers, and the food page has none.
  const showRail = tab === 'log' || tab === 'trackers' || tab === 'vues';

  // Turning a tab off while standing on it would leave a blank screen, so the
  // view falls back to Log — which can never be turned off.
  const visibleTabs = accountPrefs.tabs;
  const activeTab = (tab !== 'log' && tab !== 'parametres' && visibleTabs[tab] === false) ? 'log' : tab;

  return (
    <InfoVisibilityContext.Provider value={infoEnabled}>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"></span>
          <h1>Tracklog</h1>
          <span className="by serif">— suivez n'importe quoi.</span>
        </div>
        <div className="topbar-actions">
          <div className="tabs" role="tablist">
            <button className={activeTab==='log'?'active':''} onClick={()=>setTab('log')}>Log</button>
            {visibleTabs.bouffe && <button className={activeTab==='bouffe'?'active':''} onClick={()=>setTab('bouffe')}>Bouffe</button>}
            {visibleTabs.training && <button className={activeTab==='training'?'active':''} onClick={()=>setTab('training')}>Training</button>}
            {visibleTabs.trackers && <button className={activeTab==='trackers'?'active':''} onClick={()=>setTab('trackers')}>Trackers</button>}
            {visibleTabs.vues && <button className={activeTab==='vues'?'active':''} onClick={()=>setTab('vues')}>Vues</button>}
          </div>
          <button
            className={`gear-btn ${activeTab==='parametres'?'active':''}`}
            onClick={()=>setTab('parametres')}
            aria-label="Paramètres"
            title="Paramètres"
          >
            {/* Engrenage à 8 dents, tracé par géométrie : flancs radiaux et
                racines en arc, pour rester net à 16 px. */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
              <path d="M6.83,3.14L7.15,1.66L8.85,1.66L9.17,3.14A5,5 0 0 1 10.61,3.74L11.88,2.91L13.09,4.12L12.26,5.39A5,5 0 0 1 12.86,6.83L14.34,7.15L14.34,8.85L12.86,9.17A5,5 0 0 1 12.26,10.61L13.09,11.88L11.88,13.09L10.61,12.26A5,5 0 0 1 9.17,12.86L8.85,14.34L7.15,14.34L6.83,12.86A5,5 0 0 1 5.39,12.26L4.12,13.09L2.91,11.88L3.74,10.61A5,5 0 0 1 3.14,9.17L1.66,8.85L1.66,7.15L3.14,6.83A5,5 0 0 1 3.74,5.39L2.91,4.12L4.12,2.91L5.39,3.74A5,5 0 0 1 6.83,3.14Z" />
              <circle cx="8" cy="8" r="2.2" />
            </svg>
          </button>
        </div>
      </header>

      {showRail && (
        <TrackerRail
          trackers={activeTrackers}
          selectedIds={selectedIds}
          filterActive={filterActive}
          onToggle={toggleTracker}
          onToggleAll={toggleAll}
          onAdd={()=>setNewTrackerOpen(true)}
          onEdit={(t)=>setEditTracker(t)}
          onReorder={manualSort ? reorderTrackers : null}
          open={railOpen}
          onToggleOpen={()=>setRailOpen(v=>!v)}
          sortMode={sortMode}
          onSortMode={setSortMode}
        />
      )}

      {activeTab === 'log' ? (
        <LogView
          logSub={logSub}
          onLogSub={setLogSub}
          trackers={loggableTrackers}
          masters={masterTrackers}
          trackerById={trackerById}
          entries={entries}
          filterIds={filterIds}
          onAddEntry={addEntry}
          onDeleteEntry={deleteEntry}
          onEditEntry={(e)=>setEditEntry(e)}
          onReorder={manualSort ? reorderTrackers : null}
          chronos={chronos}
          allTrackers={trackers}
          onAddChrono={addChrono}
          onStartChrono={startChrono}
          onPauseChrono={pauseChrono}
          onResetChrono={resetChrono}
          onResetAllChronos={resetAllChronos}
          chronoExclusive={chronoExclusive}
          onSetChronoExclusive={setChronoExclusive}
          onRemoveChrono={removeChrono}
          onSaveChrono={saveChronoAsEntry}
          onUpdateChrono={updateChrono}
          foodSummary={(filterActive || !visibleTabs.bouffe) ? null : <FoodDaySummary store={food} onOpen={()=>setTab('bouffe')} />}
          historyJump={historyJump}
        />
      ) : activeTab === 'bouffe' ? (
        <FoodPage store={food} sub={foodSub} onSub={setFoodSub} aiEnabled={visibleTabs.ia !== false} />
      ) : activeTab === 'training' ? (
        <TrainingView />
      ) : activeTab === 'trackers' ? (
        <TrackersView
          trackers={trackers}
          entries={entries}
          filterIds={filterIds}
          onAdd={()=>setNewTrackerOpen(true)}
          onEdit={(t)=>setEditTracker(t)}
          onArchive={archiveTracker}
          onUnarchive={unarchiveTracker}
          onReorder={manualSort ? reorderTrackers : null}
        />
      ) : activeTab === 'vues' ? (
        <VuesView
          trackers={activeTrackers}
          trackerById={trackerById}
          entries={entries}
          filterIds={filterIds}
          onReorder={manualSort ? reorderTrackers : null}
          onEdit={(t)=>setEditTracker(t)}
          onOpenDay={openDayInHistory}
        />
      ) : (
        <SettingsView
          userId={userId}
          email={session.user.email}
          onChangePassword={()=>setPwOpen(true)}
          onSignOut={()=>supabase.auth.signOut()}
          infoEnabled={infoEnabled}
          onSetInfoEnabled={setInfoEnabled}
          theme={theme}
          onSetTheme={setTheme}
          tabs={visibleTabs}
          onSetTabVisible={accountPrefs.setTab}
          prefsReady={accountPrefs.ready}
        />
      )}

      <footer className="footer-note">
        <span className="mono">tracklog</span> · connecté en tant que {session.user.email}
      </footer>

      {newTrackerOpen && (
        <TrackerModal
          allTrackers={trackers}
          onClose={()=>setNewTrackerOpen(false)}
          onSave={(t)=>{ addTracker(t); setNewTrackerOpen(false); }}
        />
      )}
      {editTracker && (
        <TrackerModal
          tracker={editTracker}
          allTrackers={trackers}
          onClose={()=>setEditTracker(null)}
          onSave={(t)=>{ updateTracker(editTracker.id, t); setEditTracker(null); }}
          onDelete={()=>{ removeTracker(editTracker.id); setEditTracker(null); }}
          onArchive={()=>{ archiveTracker(editTracker.id); setEditTracker(null); }}
          onUnarchive={()=>{ unarchiveTracker(editTracker.id); setEditTracker(null); }}
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
      <DropIndicatorMount />
    </div>
    </InfoVisibilityContext.Provider>
  );
}

/* ============================================================
   Settings — account actions (password, sign-out) merged with
   display preferences (info bubbles), one place instead of two
   loose top-bar buttons.
   ============================================================ */
function SettingsView({ userId, email, onChangePassword, onSignOut, infoEnabled, onSetInfoEnabled,
                       theme, onSetTheme, tabs, onSetTabVisible, prefsReady }){
  return (
    <div className="settings-view">
      <p className="section-label" style={{margin:'0 0 16px'}}>Paramètres</p>

      <div className="card settings-card">
        <p className="settings-section-title">Compte</p>
        <div className="field">
          <label>Connecté</label>
          <span className="settings-value">{email}</span>
        </div>
        <div className="field">
          <label>Mot de passe</label>
          <button className="account-btn" onClick={onChangePassword}>Changer</button>
        </div>
        <div className="field" style={{borderBottom:'none'}}>
          <label>Session</label>
          <button className="account-btn" onClick={onSignOut}>Déconnexion</button>
        </div>
      </div>

      <div className="card settings-card">
        <p className="settings-section-title">Style</p>
        <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:10}}>
          <div className="style-picker">
            {STYLES.map(s => (
              <button key={s.id} className={`style-choice ${theme===s.id?'on':''}`} onClick={()=>onSetTheme(s.id)}>
                <span className="style-swatch" data-style={s.id} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="style-name">{s.label}</span>
                <span className="style-hint">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="settings-hint">
          Le style est propre à cet appareil — un téléphone dehors et un écran de bureau
          n'appellent pas le même. D'autres viendront s'ajouter à cette liste.
        </p>
      </div>

      <div className="card settings-card">
        <p className="settings-section-title">Onglets</p>
        {!prefsReady && <p className="settings-hint" style={{marginTop:0}}>Chargement…</p>}
        {TOGGLEABLE_TABS.map(t => (
          <div className="field" key={t.id}>
            <label>{t.label}</label>
            <div className="ctl-with-info">
              <div className="vue-mode small">
                <button className={tabs[t.id] !== false ? 'on' : ''} onClick={()=>onSetTabVisible(t.id, true)}>Affiché</button>
                <button className={tabs[t.id] === false ? 'on' : ''} onClick={()=>onSetTabVisible(t.id, false)}>Masqué</button>
              </div>
              <span className="settings-inline-hint">{t.hint}</span>
            </div>
          </div>
        ))}
        {TOGGLEABLE_FEATURES.map(f => (
          <div className="field" key={f.id} style={{borderBottom:'none'}}>
            <label>{f.label}</label>
            <div className="ctl-with-info">
              <div className="vue-mode small">
                <button className={tabs[f.id] !== false ? 'on' : ''} onClick={()=>onSetTabVisible(f.id, true)}>Affiché</button>
                <button className={tabs[f.id] === false ? 'on' : ''} onClick={()=>onSetTabVisible(f.id, false)}>Masqué</button>
              </div>
              <span className="settings-inline-hint">{f.hint}</span>
            </div>
          </div>
        ))}
        <p className="settings-hint">
          Masquer un onglet ne supprime rien : les données restent, l'onglet disparaît de la
          barre du haut. <span className="k">Log</span> et les paramètres ne se masquent pas —
          l'un est la raison d'être de l'app, l'autre la seule porte pour rallumer le reste.
          Ce réglage suit le compte, pas l'appareil.
        </p>
      </div>

      <div className="card settings-card">
        <p className="settings-section-title">Affichage</p>
        <div className="field" style={{borderBottom:'none'}}>
          <label>Bulles d'info</label>
          <div className="vue-mode small">
            <button className={infoEnabled?'on':''} onClick={()=>onSetInfoEnabled(true)}>Activées</button>
            <button className={!infoEnabled?'on':''} onClick={()=>onSetInfoEnabled(false)}>Désactivées</button>
          </div>
        </div>
        <p className="settings-hint">
          Les petits « i » qui expliquent chaque réglage, un peu partout dans l'app.
          Désactivez-les une fois l'app bien en main.
        </p>
      </div>

      <FeedbackCard userId={userId} />
    </div>
  );
}

/* ============================================================
   Retours — bugs, idées, avis
   ------------------------------------------------------------
   Écrire pendant qu'on a le nez dedans plutôt que de se
   promettre d'y penser plus tard. Le contexte technique (style,
   taille d'écran, navigateur) part avec le message : c'est
   exactement ce qu'on ne pense jamais à noter et ce qui manque
   toujours pour reproduire un bug.
   ============================================================ */
function FeedbackCard({ userId }){
  const [kind, setKind] = useState('bug');
  const [message, setMessage] = useState('');
  const [state, setState] = useState('idle');   // idle | sending | sent | error
  const [err, setErr] = useState('');
  const canSend = message.trim().length >= 5 && state !== 'sending';

  const send = async () => {
    if (!canSend) return;
    setState('sending'); setErr('');
    const row = {
      id: uid('fb_'),
      user_id: userId,
      kind,
      message: message.trim(),
      context: {
        style: (() => { try { return document.documentElement.dataset.theme || null; } catch { return null; } })(),
        ecran: (() => { try { return `${window.innerWidth}×${window.innerHeight}`; } catch { return null; } })(),
        navigateur: (() => { try { return navigator.userAgent; } catch { return null; } })(),
        envoye_le: new Date().toISOString(),
      },
      created_at: Date.now(),
    };
    const { error } = await supabase.from('feedback').insert(row);
    if (error){
      setState('error');
      setErr(error.message || "L'envoi a échoué.");
      return;
    }
    setState('sent');
    setMessage('');
  };

  return (
    <div className="card settings-card">
      <p className="settings-section-title">Un retour ?</p>

      <div className="field">
        <label>Type</label>
        <div className="seg wrap">
          {FEEDBACK_KINDS.map(k => (
            <button key={k.id} className={kind===k.id?'on':''} onClick={()=>{ setKind(k.id); setState('idle'); }}>
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
        <label style={{width:'auto'}}>Message</label>
        <textarea
          rows={4}
          value={message}
          onChange={e=>{ setMessage(e.target.value); if (state !== 'idle') setState('idle'); }}
          placeholder={
            kind === 'bug' ? "Ce que tu faisais, ce que tu attendais, ce qui s'est passé à la place."
            : kind === 'feature' ? "Ce que tu voudrais pouvoir faire, et pourquoi le contournement actuel ne suffit pas."
            : kind === 'avis' ? "Ce qui marche bien, ce qui agace."
            : "Tout ce qui ne rentre pas dans les cases au-dessus."
          }
        />
        <div className="feedback-foot">
          <span className="settings-inline-hint">
            {state === 'sent' ? 'Envoyé — merci.'
             : state === 'error' ? err
             : 'Le style, la taille d’écran et le navigateur partent avec le message.'}
          </span>
          <button className="primary sm" disabled={!canSend} onClick={send}>
            {state === 'sending' ? 'Envoi…' : state === 'sent' ? 'Envoyer un autre' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Training — la place est prise, le contenu viendra
   ============================================================ */
function TrainingView(){
  return (
    <div className="empty training-empty">
      <span className="em-serif">Training.</span>
      Cet onglet est réservé — le suivi d'entraînement viendra ici. En attendant, une séance
      se suit très bien avec un tracker <span className="k">durée</span> et un chrono, ou un
      tracker <span className="k">choix</span> pour le type de séance.
      <span className="training-note serif">
        Masquable depuis les paramètres, section Onglets, tant qu'il est vide.
      </span>
    </div>
  );
}

/* ============================================================
   Tracker rail (selectable pills)
   ============================================================ */
const SORTS = [
  { id:'manuel', label:'Manuel',  hint:'votre ordre — glissez les cartes pour le changer' },
  { id:'alpha',  label:'A → Z',   hint:'par nom' },
  { id:'recent', label:'Récents', hint:'renseignés le plus récemment en premier' },
  { id:'type',   label:'Type',    hint:'regroupés par type de tracker' },
];

function TrackerRail({ trackers, selectedIds = [], filterActive, onToggle, onToggleAll, onAdd, onEdit, onReorder, open, onToggleOpen, sortMode, onSortMode }){
  const byId = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);
  const ids = useMemo(() => trackers.map(t => t.id), [trackers]);
  const { order, dragId, startDrag, setNodeRef } = useDragReorder(ids, onReorder);
  const dragStartRef = useRef(null);
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="rail-wrap">
      <button className={`rail-toggle ${open?'open':''}`} onClick={onToggleOpen} aria-expanded={open}>
        <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1L4.5 5L8 1"/></svg>
        <span>Filtres & tri</span>
        {filterActive && <span className="rail-count">{selectedIds.length}</span>}
        {sortMode !== 'manuel' && (
          <span className="rail-sort-tag">{SORTS.find(s=>s.id===sortMode)?.label}</span>
        )}
      </button>
      {open && (
        <div className="rail-sort">
          <span className="rail-sort-label">Trier</span>
          <div className="vue-mode small">
            {SORTS.map(s => (
              <button key={s.id} className={sortMode===s.id?'on':''} title={s.hint}
                onClick={()=>onSortMode(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
      {open && (
        <div className="rail">
          <button
            className={`pill ${!filterActive?'active':''}`}
            onClick={onToggleAll}
            title={selectedIds.length ? 'Tout afficher (garde votre sélection en mémoire)' : 'Tout afficher'}
          >
            <span style={{fontSize:13}}>Tout</span>
          </button>
          {order.map(id => {
            const t = byId[id];
            if (!t) return null;
            const selected = selSet.has(t.id);
            // Selected + filtering = fully on. Selected + "Tout" = remembered (greyed).
            const cls = selected ? (filterActive ? 'active' : 'dimmed') : '';
            return (
              <button
                key={t.id}
                ref={setNodeRef(t.id)}
                className={`pill ${cls} ${dragId===t.id?'dragging':''}`}
                onPointerDown={(e)=>{ dragStartRef.current = { x:e.clientX, y:e.clientY }; startDrag(t.id)(e); }}
                onClickCapture={(e)=>{
                  const s = dragStartRef.current;
                  if (s && (Math.abs(e.clientX-s.x) > 6 || Math.abs(e.clientY-s.y) > 6)){ e.preventDefault(); e.stopPropagation(); }
                }}
                onClick={()=>onToggle(t.id)}
                onDoubleClick={()=>onEdit(t)}
                title="Cliquer pour filtrer · glisser pour réordonner · double-clic pour modifier"
              >
                {isMaster(t)
                  ? <span className="master-mark" style={{background:t.color, width:8, height:8}}></span>
                  : <span className="dot" style={{background:t.color}}></span>}
                <span>{t.name}</span>
              </button>
            );
          })}
          <button className="pill add" onClick={onAdd}>＋ Nouveau tracker</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Day view — fill / edit every tracker for one given day.
   Used by the "Jour" tab (today) and the Historique calendar (any day).
   ============================================================ */
function TodayView({ trackers, masters = [], trackerById = {}, entries, filterIds, onAddEntry, onDeleteEntry, onEditEntry, onReorder, foodSummary = null }){
  const todayTs = startOfDay(Date.now());
  const dk = dayKey(todayTs);

  if (filterIds){
    const set = new Set(filterIds);
    trackers = trackers.filter(t => set.has(t.id));
    masters = masters.filter(m => set.has(m.id));
  }

  if (!trackers.length && !masters.length){
    return (
      <div>
        <div className="empty">
          <span className="em-serif">Aucun tracker.</span>
          Créez-en un pour commencer à remplir votre journée.
        </div>
        {foodSummary}
      </div>
    );
  }

  const dailyTrackers = trackers.filter(t => t.daily);
  const dailyDone = dailyTrackers.filter(t => entries.some(e => e.trackerId === t.id && dayKey(e.ts) === dk)).length;
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });

  return (
    <div>
      {masters.length > 0 && (
        <MasterStrips masters={masters} trackerById={trackerById} entries={entries} onReorder={onReorder} />
      )}
      <div className="today-head">
        <p className="section-label" style={{textTransform:'capitalize',margin:0}}>{todayLabel}</p>
        {dailyTrackers.length > 0 && (
          <span className="today-progress">{dailyDone}/{dailyTrackers.length} quotidien{dailyTrackers.length>1?'s':''}</span>
        )}
      </div>
      {trackers.length > 0
        ? <DayGrid trackers={trackers} entries={entries} onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} dayTs={todayTs} isToday={true} onReorder={onReorder} />
        : <div className="empty" style={{padding:'30px 0'}}><span className="em-serif">Aucun tracker à remplir.</span> Vos masters se calculent tout seuls.</div>}
      {/* Troisième catégorie du jour : les compteurs de la page Bouffe. Ils ne se
          remplissent pas ici — ils se lisent, et mènent à la page qui les nourrit. */}
      {foodSummary}
    </div>
  );
}

// Grid of one editable card per tracker, for the given day.
// Trackers are split into two groups so daily ("une entrée/jour") and
// multi-entry trackers don't get mixed in the same visual set. Each group
// is its own reorderable subset (see mergeSubOrder).
function DayGrid({ trackers, entries, onAddEntry, onDeleteEntry, onEditEntry, dayTs, isToday, onReorder }){
  const dk = dayKey(dayTs);
  const byTracker = useMemo(() => {
    const m = {};
    for (const t of trackers) m[t.id] = [];
    for (const e of entries){
      if (dayKey(e.ts) === dk && m[e.trackerId]) m[e.trackerId].push(e);
    }
    return m;
  }, [entries, trackers, dk]);

  const byId = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);
  const dailyIds = useMemo(() => trackers.filter(t => t.daily).map(t => t.id), [trackers]);
  const multiIds = useMemo(() => trackers.filter(t => !t.daily).map(t => t.id), [trackers]);
  const dailyDrag = useDragReorder(dailyIds, onReorder);
  const multiDrag = useDragReorder(multiIds, onReorder);

  // Cards keep their own draft state; each one hands up a submit function while it holds
  // something unsaved, which is what "Tout ajouter" fires in one go.
  const submitters = useRef({});
  const [pendingIds, setPendingIds] = useState([]);
  const registerSubmit = useCallback((id, fn) => {
    if (fn) submitters.current[id] = fn; else delete submitters.current[id];
    const ids = Object.keys(submitters.current);
    setPendingIds(prev =>
      (prev.length === ids.length && prev.every(x => ids.includes(x))) ? prev : ids);
  }, []);
  const submitAll = () => {
    // Snapshot first: submitting mutates the registry as cards reset.
    Object.values({ ...submitters.current }).forEach(ref => ref?.current?.());
  };

  if (!trackers.length){
    return <div className="empty"><span className="em-serif">Aucun tracker.</span></div>;
  }

  const renderGrid = (drag) => (
    <div className="today-grid">
      {drag.order.map(id => {
        const t = byId[id];
        if (!t) return null;
        return (
          <DayCard
            key={t.id} tracker={t} dayEntries={byTracker[t.id] || []}
            onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} dayTs={dayTs} isToday={isToday}
            containerRef={drag.setNodeRef(t.id)}
            dragging={drag.dragId === t.id}
            onDragStart={drag.startDrag(t.id)}
            registerSubmit={registerSubmit}
          />
        );
      })}
    </div>
  );

  // Only worth offering once more than one card is waiting — with a single one,
  // that card's own button is right there.
  const submitAllBar = pendingIds.length > 1 && (
    <div className="submit-all-bar">
      <button className="submit-all" onClick={submitAll}>
        Tout ajouter <span className="sa-count">{pendingIds.length}</span>
      </button>
    </div>
  );

  if (!dailyIds.length || !multiIds.length){
    return (
      <>
        {submitAllBar}
        {renderGrid(dailyIds.length ? dailyDrag : multiDrag)}
      </>
    );
  }

  return (
    <div className="day-groups">
      {submitAllBar}
      <div className="day-group">
        <p className="section-label">Quotidiens</p>
        {renderGrid(dailyDrag)}
      </div>
      <div className="day-group">
        <p className="section-label">Plusieurs par jour</p>
        {renderGrid(multiDrag)}
      </div>
    </div>
  );
}

function DayCard({ tracker, dayEntries, onAddEntry, onDeleteEntry, onEditEntry, dayTs, isToday, containerRef, dragging, onDragStart, registerSubmit }){
  const t = tracker;
  const daily = !!t.daily;
  // The joker entry is a day-level flag, not a logged value — kept out of the
  // real entries so it never inflates the count or shows up as "0".
  const jokerEntry = dayEntries.find(isJokerEntry) || null;
  const realEntries = useMemo(() => dayEntries.filter(e => !isJokerEntry(e)), [dayEntries]);
  const existing = daily && realEntries.length ? realEntries[0] : null;
  const count = realEntries.length;
  // Multi trackers can hold several entries a day; the badge reveals them,
  // read chronologically, so you can re-read or edit them without leaving the card.
  const [logOpen, setLogOpen] = useState(false);
  const logEntries = useMemo(
    () => [...realEntries].sort((a,b) => a.ts - b.ts),
    [realEntries]
  );
  const toggleJoker = () => {
    if (jokerEntry) { onDeleteEntry(jokerEntry.id); return; }
    const ts = isToday ? Date.now() : dayTs + 12*3600000;
    onAddEntry({ trackerId: t.id, value: JOKER, ts });
  };

  const [num, setNum]     = useState('');
  const [scale, setScale] = useState(null);
  const [bool, setBool]   = useState(null);
  const [durH, setDurH]   = useState('');
  const [durM, setDurM]   = useState('');
  const [text, setText]   = useState('');
  const [choice, setChoice] = useState(t.multiple ? [] : null);
  const [flash, setFlash] = useState(false);

  const resetInputs = () => {
    setNum(''); setScale(null); setBool(null); setDurH(''); setDurM(''); setText('');
    setChoice(t.multiple ? [] : null);
  };

  // Prefill a daily tracker already logged that day so it reads as editable;
  // clear when moving to a day/tracker with no existing entry (calendar day switch).
  useEffect(() => {
    if (existing){
      switch (t.type){
        case 'number':   setNum(String(existing.value ?? '')); break;
        case 'scale':    setScale(existing.value ?? null); break;
        case 'boolean':  setBool(typeof existing.value === 'boolean' ? existing.value : null); break;
        case 'duration': setDurH(String(Math.floor((existing.value||0)/60))); setDurM(String((existing.value||0)%60)); break;
        case 'choice':   setChoice(readChoice(t, existing.value)); break;
        case 'text':     setText(String(existing.value ?? '')); break;
      }
    } else {
      resetInputs();
    }
  }, [existing?.id, existing?.value, t.type, dayTs]);

  const toggleChoice = (opt) => {
    if (t.multiple){
      setChoice(prev => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.includes(opt) ? arr.filter(x=>x!==opt) : [...arr, opt];
      });
    } else {
      setChoice(prev => prev === opt ? null : opt);
    }
  };

  const canSave = useMemo(() => {
    switch (t.type){
      case 'number':   return num !== '' && !isNaN(parseFloat(num));
      case 'scale':    return scale != null;
      case 'boolean':  return bool != null;
      case 'duration': return (durH !== '' || durM !== '') && (parseInt(durH||'0',10) + parseInt(durM||'0',10) > 0);
      case 'choice':   return t.multiple ? (Array.isArray(choice) && choice.length > 0) : choice != null;
      case 'text':     return text.trim().length > 0;
    }
    return false;
  }, [t.type, t.multiple, num, scale, bool, durH, durM, text, choice]);

  const draftValue = () => {
    switch (t.type){
      case 'number':   return parseFloat(num);
      case 'scale':    return scale;
      case 'boolean':  return bool;
      case 'duration': return parseInt(durH||'0',10)*60 + parseInt(durM||'0',10);
      case 'choice':   return choice;
      case 'text':     return text.trim();
    }
  };

  const submit = () => {
    if (!canSave) return;
    // Today keeps the real clock time; a past day is anchored at noon.
    const ts = isToday ? Date.now() : dayTs + 12*3600000;
    onAddEntry({ trackerId: t.id, value: draftValue(), ts });
    setFlash(true);
    setTimeout(()=>setFlash(false), 900);
    if (!daily){
      resetInputs();
    }
  };

  // "Pending" = something typed that isn't recorded yet. A daily tracker whose card
  // merely echoes the entry already saved for that day is not pending — otherwise
  // "Tout ajouter" would keep rewriting entries that never changed.
  const sameAsSaved = daily && existing && (() => {
    const a = draftValue(), b = existing.value;
    return Array.isArray(a) || Array.isArray(b)
      ? JSON.stringify([...(a||[])].sort()) === JSON.stringify([...(b||[])].sort())
      : a === b;
  })();
  const pending = canSave && !sameAsSaved;

  // The parent gets a ref, not the closure itself: re-registering on every render would
  // make each render queue an unregister + register, and loop forever. The ref keeps the
  // submit function current while registration only fires when the pending flag flips.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!registerSubmit) return;
    registerSubmit(t.id, pending ? submitRef : null);
    return () => registerSubmit(t.id, null);
  }, [pending, t.id, registerSubmit]);

  // Choice chips and the textarea lay out over several rows, so they take the full width
  // and push the save button below; compact fields — including the scale slider, which
  // stretches into whatever room is left — stay on its line.
  const wideInput = t.type === 'choice' || t.type === 'text';

  // A range input reports a ~159px min-content width, which would force the save button
  // onto its own line; the slider is meant to be squeezable, so it opts out of that floor.
  const inputClass = `tc-input ${wideInput?'wide':''} ${t.type==='scale'?'squeeze':''}`;

  const inputControls = (
    <>
      {t.type === 'number' && (
        <div style={{display:'flex',alignItems:'baseline',gap:6}}>
          <input type="number" step="any" value={num} onChange={e=>setNum(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="0" style={{width:'100%'}} />
          {t.unit && <span className="unit">{t.unit}</span>}
        </div>
      )}
      {t.type === 'scale' && (() => {
        const max = t.scaleMax || 5;
        return (
          <div className="scale-slider">
            <input
              type="range" min="1" max={max} step="1"
              value={scale ?? Math.ceil(max/2)}
              onChange={e=>setScale(parseInt(e.target.value,10))}
              aria-label={`Note sur ${max}`}
              style={{'--fill': `${(((scale ?? Math.ceil(max/2)) - 1) / Math.max(1, max-1)) * 100}%`}}
            />
            {/* Reads "—" until touched, so an untouched slider never looks like a score. */}
            <span className={`scale-val ${scale==null?'unset':''}`}>
              {scale == null ? '—' : scale}<span className="scale-max">/{max}</span>
            </span>
          </div>
        );
      })()}
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
          <input type="number" min="0" placeholder="00" value={durM}
            onChange={e=>{
              const raw = e.target.value;
              // Carry into hours as soon as the minutes pass 59 — typing "90" lands on 1h30.
              if ((parseInt(raw || '0', 10) || 0) >= 60){
                const n = normalizeHM(durH, raw);
                setDurH(n.h); setDurM(n.m);
              } else {
                setDurM(raw);
              }
            }}
            style={{width:44,textAlign:'right'}} />
          <span className="unit">min</span>
        </div>
      )}
      {t.type === 'choice' && (
        (t.choices && t.choices.length) ? (
          <div className="choices">
            {t.choices.map(opt => {
              const active = t.multiple ? (Array.isArray(choice) && choice.includes(opt)) : choice === opt;
              return (
                <button key={opt} className={active?'on':''} onClick={()=>toggleChoice(opt)}>{opt}</button>
              );
            })}
          </div>
        ) : (
          <span className="tc-empty-note">Aucun choix défini. Modifiez le tracker pour en ajouter.</span>
        )
      )}
      {t.type === 'text' && (
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={2} placeholder="…" style={{width:'100%'}} />
      )}
    </>
  );

  // "Done" reads as "you've logged something today" — for a daily tracker that's the
  // one entry it holds; for a multi one, having at least one entry — or a joker —
  // already says that, even though — unlike daily — the card stays fully open to add more.
  const loggedToday = daily ? !!existing : (count > 0 || !!jokerEntry);

  return (
    <div ref={containerRef} className={`today-card ${loggedToday?'done':''} ${flash?'flash':''} ${dragging?'dragging':''}`}>
      <div className="tc-head">
        {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
        <div className="tc-name"><span className="dot" style={{background:t.color}}></span>{t.name}</div>
        {daily
          ? (existing
              ? <span className="tc-badge on">✓ noté</span>
              : <span className="tc-badge">1×/jour</span>)
          : (
              <div className="tc-head-actions">
                {count > 0 && (
                  <button
                    className={`tc-badge badge-btn ${logOpen?'open':''}`}
                    onClick={()=>setLogOpen(o=>!o)}
                    aria-expanded={logOpen}
                    title={logOpen ? 'Masquer les entrées' : 'Voir les entrées'}
                  >{count}×</button>
                )}
                {t.jokerEnabled && (
                  <button
                    className={`tc-badge badge-btn joker-btn ${jokerEntry?'on':''}`}
                    onClick={toggleJoker}
                    aria-pressed={!!jokerEntry}
                    title={jokerEntry ? 'Retirer le joker' : 'Marquer ce jour comme joker (exclu des calculs)'}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                      <path d="M6 1.8L6 10.2M2.36 3.9L9.64 8.1M2.36 8.1L9.64 3.9"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
      </div>

      {!daily && jokerEntry && (
        <div className="tc-joker-note">Jour joker — exclu des calculs</div>
      )}

      {daily ? (
        <>
          <div className={inputClass}>{inputControls}</div>
          <div className="tc-foot">
            {existing && <button className="tc-clear" onClick={()=>onDeleteEntry(existing.id)}>Effacer</button>}
            <button className="primary sm" disabled={!canSave} onClick={submit}>
              {existing ? 'Remplacer' : 'Noter'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tc-input-row">
            <div className={inputClass}>{inputControls}</div>
            <button className="primary sm" disabled={!canSave} onClick={submit}>Ajouter</button>
          </div>

          {count > 0 && (
            <div className={`tc-log ${logOpen?'open':''}`}>
              <span className="tc-log-label">Entrées précédentes</span>
              {logEntries.map(e => {
                const unit = fmtUnit(t);
                return (
                  <div className="tc-log-row" key={e.id}>
                    <span className="t">{timeLabel(e.ts)}</span>
                    <span className="tc-log-actions">
                      {onEditEntry && <button onClick={()=>onEditEntry(e)}>modifier</button>}
                      <button className="del" onClick={()=>onDeleteEntry(e.id)}>suppr.</button>
                    </span>
                    <span className="v">{fmtValue(t, e.value)}{unit && <span className="u">{unit}</span>}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   Chrono — stopwatches for timing sessions across the day. Each one can be
   tied to a duration tracker so the time it measures becomes a real entry.
   ============================================================ */
// A picture-in-picture window is a separate document: it inherits none of the page's
// CSS, so the theme has to be cloned into it for the cards to look like themselves.
function copyStylesTo(win){
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
    win.document.head.appendChild(node.cloneNode(true));
  });
}
const PIP_SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

function ChronoView({ chronos, trackers, trackerById, onAdd, onStart, onPause, onReset, onRemove, onSave, onUpdate, onResetAll, exclusive, onSetExclusive }){
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const running = chronos.some(c => c.startedAt);
  const [now, setNow] = useState(() => Date.now());
  const [pipWin, setPipWin] = useState(null);

  // Only tick while something is actually running — a paused board costs nothing.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Only time-based trackers can receive a chrono's result.
  const durationTrackers = useMemo(
    () => trackers.filter(t => t.type === 'duration' && !t.archived),
    [trackers]
  );

  // The floating window runs in this same JS context, so the chronos it shows are the
  // very same state — no syncing, and the buttons in it drive the app directly.
  const openPip = async () => {
    if (!PIP_SUPPORTED || pipWin) return;
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 300, height: 380 });
      copyStylesTo(win);
      win.document.body.classList.add('pip-body');
      win.addEventListener('pagehide', () => setPipWin(null));
      setPipWin(win);
    } catch { /* user dismissed the window request */ }
  };

  const cards = (
    <div className="today-grid">
      {chronos.map(c => (
        <ChronoCard
          key={c.id} chrono={c} now={now}
          tracker={c.trackerId ? trackerById[c.trackerId] : null}
          onStart={onStart} onPause={onPause} onReset={onReset}
          onSave={onSave} onEdit={()=>setEditing(c)}
        />
      ))}
    </div>
  );

  return (
    <div>
      {chronos.length === 0 ? (
        <div className="chrono-empty">
          <p className="em-serif" style={{margin:'0 0 6px'}}>Aucun chrono.</p>
          <p className="chrono-empty-sub">
            Lancez un chrono quand vous commencez une tâche, mettez-le en pause quand vous en changez.
          </p>
          <button className="chrono-add-big" onClick={()=>setAdding(true)}>+ Ajouter un chrono</button>
        </div>
      ) : (
        <>
          <div className="chrono-bar">
            {/* Solo: starting one banks and stops whichever other was running — never
                more than one clock ticking. Multi: every chrono starts and stops only
                on its own button, exactly as before. */}
            <div className="vue-mode small" title={exclusive ? 'Un seul chrono actif à la fois' : 'Plusieurs chronos peuvent tourner ensemble'}>
              <button className={!exclusive?'on':''} onClick={()=>onSetExclusive(false)}>Multi</button>
              <button className={exclusive?'on':''} onClick={()=>onSetExclusive(true)}>Solo</button>
            </div>
            {PIP_SUPPORTED && (
              <>
                <button className="chrono-btn" onClick={openPip} disabled={!!pipWin}>
                  {pipWin ? 'Fenêtre flottante ouverte' : '⧉ Fenêtre flottante'}
                </button>
                {pipWin && <button className="chrono-btn ghost" onClick={()=>pipWin.close()}>Refermer</button>}
              </>
            )}
            <button
              className="chrono-btn ghost"
              onClick={()=>{ if (confirm('Remettre tous les chronos à zéro ?')) onResetAll(); }}
            >
              Reset all
            </button>
          </div>

          {pipWin
            ? <div className="chrono-detached">
                <span className="em-serif">Vos chronos sont dans la fenêtre flottante.</span>
              </div>
            : cards}

          <button className="chrono-add" onClick={()=>setAdding(true)}>+ Ajouter un chrono</button>
        </>
      )}

      {/* Rendered into the floating window, but still part of this React tree. */}
      {pipWin && ReactDOM.createPortal(cards, pipWin.document.body)}

      {(adding || editing) && (
        <ChronoModal
          chrono={editing}
          trackers={durationTrackers}
          onClose={()=>{ setAdding(false); setEditing(null); }}
          onSave={(data)=>{
            if (editing) onUpdate(editing.id, data); else onAdd(data);
            setAdding(false); setEditing(null);
          }}
          onDelete={editing ? ()=>{ onRemove(editing.id); setEditing(null); } : null}
        />
      )}
    </div>
  );
}

function ChronoCard({ chrono: c, now, tracker, onStart, onPause, onReset, onSave, onEdit }){
  const elapsed = chronoElapsed(c, now);
  const isRunning = !!c.startedAt;
  const minutes = Math.round(elapsed / 60000);

  return (
    <div className={`today-card chrono-card ${isRunning?'running':''}`}>
      <div className="tc-head">
        <div className="tc-name">
          {tracker && <span className="dot" style={{background:tracker.color}}></span>}
          {c.label}
        </div>
        {/* The coloured dot already says "linked"; only name the tracker when the
            chrono carries a different label, so the card never repeats itself. */}
        {!tracker
          ? <span className="tc-badge">libre</span>
          : c.label !== tracker.name
            ? <span className="tc-badge on chrono-link">{tracker.name}</span>
            : null}
      </div>

      <div className={`chrono-time ${isRunning?'running':''}`}>{fmtChronoDisplay(elapsed, c.showSeconds)}</div>

      <div className="chrono-actions">
        {isRunning ? (
          <button className="chrono-btn pause" onClick={()=>onPause(c.id)}>Pause</button>
        ) : (
          <button className="chrono-btn start" onClick={()=>onStart(c.id)}>
            {elapsed > 0 ? 'Reprendre' : 'Lancer'}
          </button>
        )}
        {/* Deleting lives in the settings dialog, like a tracker's — the board stays a
            place to run clocks, not to lose them by mis-tapping. */}
        {!isRunning && (
          <span className="chrono-secondary">
            {elapsed > 0 && (
              <button className="chrono-btn ghost" onClick={()=>onReset(c.id)} title="Remettre à zéro">Reset</button>
            )}
            <button className="chrono-btn ghost" onClick={onEdit} title="Paramètres du chrono">Réglages</button>
          </span>
        )}
      </div>

      {tracker && (
        <button
          className="primary sm chrono-save"
          disabled={isRunning || minutes < 1}
          onClick={()=>onSave(c.id)}
          title={isRunning ? 'Mettez le chrono en pause pour enregistrer'
               : minutes < 1 ? 'Moins d’une minute' : ''}
        >
          Enregistrer {minutes >= 1 ? fmtDuration(minutes) : ''}
        </button>
      )}
    </div>
  );
}

// Serves both creation and settings, the way a tracker's dialog does — same fields,
// plus deletion once the chrono exists.
function ChronoModal({ chrono, trackers, onClose, onSave, onDelete }){
  const editing = !!chrono;
  const [trackerId, setTrackerId] = useState(chrono?.trackerId || '');
  const [label, setLabel] = useState(chrono?.label || '');
  const [showSeconds, setShowSeconds] = useState(!!chrono?.showSeconds);
  const linked = trackers.find(t => t.id === trackerId);
  // The tracker's name is the natural default, so a linked chrono needs no typing.
  const finalLabel = label.trim() || linked?.name || '';
  const canSave = finalLabel.length > 0;
  const payload = { label: finalLabel, trackerId, showSeconds };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <h2>{editing ? 'Paramètres du chrono' : 'Nouveau chrono'}</h2>
        <div className="modal-sub">
          Liez-le à un tracker de durée pour enregistrer le temps mesuré, ou nommez-le librement.
        </div>

        <div className="field">
          <label>Tracker</label>
          <select value={trackerId} onChange={e=>setTrackerId(e.target.value)}>
            <option value="">Aucun — nom libre</option>
            {trackers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Nom</label>
          <input autoFocus value={label} onChange={e=>setLabel(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && canSave) onSave(payload); }}
            placeholder={linked ? linked.name : 'ex. Lecture'} />
        </div>
        <div className="field" style={{borderBottom:'none'}}>
          <label>Secondes</label>
          <div className="seg">
            <button className={!showSeconds?'on':''} onClick={()=>setShowSeconds(false)}>Minutes</button>
            <button className={showSeconds?'on':''} onClick={()=>setShowSeconds(true)}>Sec.</button>
          </div>
          <InfoBubble>
            Par défaut le chrono affiche la minute, comme les trackers l’enregistrent.
            Activez les secondes pour suivre des sessions courtes.
          </InfoBubble>
        </div>

        {trackers.length === 0 && (
          <div style={{fontSize:12,color:'var(--ink-3)',marginTop:10}}>
            Aucun tracker de durée pour l’instant — le chrono sera simplement nommé.
          </div>
        )}

        <div className="modal-actions">
          {onDelete && <button className="danger" onClick={onDelete}>Supprimer</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={()=>onSave(payload)}>
            {editing ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Log view — the entries, split into "Jour", "Historique" and "Chrono"
   ============================================================ */
function LogView({ logSub, onLogSub, trackers, masters, trackerById, entries, filterIds, onAddEntry, onDeleteEntry, onEditEntry, onReorder,
                  chronos, allTrackers, onAddChrono, onStartChrono, onPauseChrono, onResetChrono, onRemoveChrono, onSaveChrono, onUpdateChrono, onResetAllChronos, chronoExclusive, onSetChronoExclusive,
                  foodSummary, historyJump }){
  const hint = logSub === 'jour' ? "les entrées d’aujourd’hui"
             : logSub === 'historique' ? "ouvrez n’importe quel jour pour l’éditer"
             : "chronométrez vos sessions, puis enregistrez-les";
  return (
    <div>
      <div className="log-subnav">
        <div className="vue-mode">
          <button className={logSub==='jour'?'on':''} onClick={()=>onLogSub('jour')}>Jour</button>
          <button className={logSub==='historique'?'on':''} onClick={()=>onLogSub('historique')}>Historique</button>
          <button className={logSub==='chrono'?'on':''} onClick={()=>onLogSub('chrono')}>Chrono</button>
        </div>
        <span className="log-subhint serif">{hint}</span>
      </div>
      {logSub === 'chrono' ? (
        <ChronoView
          chronos={chronos}
          trackers={allTrackers}
          trackerById={trackerById}
          onAdd={onAddChrono}
          onStart={onStartChrono}
          onPause={onPauseChrono}
          onReset={onResetChrono}
          onResetAll={onResetAllChronos}
          exclusive={chronoExclusive}
          onSetExclusive={onSetChronoExclusive}
          onRemove={onRemoveChrono}
          onSave={onSaveChrono}
          onUpdate={onUpdateChrono}
        />
      ) : logSub === 'jour' ? (
        <TodayView trackers={trackers} masters={masters} trackerById={trackerById} entries={entries} filterIds={filterIds} onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} onReorder={onReorder} foodSummary={foodSummary} />
      ) : (
        <HistoryView
          trackers={trackers}
          masters={masters}
          trackerById={trackerById}
          entries={entries}
          filterIds={filterIds}
          onAddEntry={onAddEntry}
          onDeleteEntry={onDeleteEntry}
          onEditEntry={onEditEntry}
          onReorder={onReorder}
          jumpTo={historyJump}
        />
      )}
    </div>
  );
}

/* ============================================================
   History — a month calendar to open any day and edit its entries
   ============================================================ */
function HistoryView({ trackers, masters = [], trackerById, entries, filterIds, onAddEntry, onDeleteEntry, onEditEntry, onReorder, jumpTo }){
  const [monthTs, setMonthTs] = useState(() => startOfMonth(Date.now()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(Date.now()));

  // A chart's floating tooltip can ask to jump straight to one day here —
  // re-sync on every request (the token), even to a day already selected.
  useEffect(() => {
    if (!jumpTo) return;
    setSelectedDay(startOfDay(jumpTo.ts));
    setMonthTs(startOfMonth(jumpTo.ts));
  }, [jumpTo]);

  // Respect the tracker filter rail: narrow everything to the selected set.
  const filterSet = useMemo(() => filterIds ? new Set(filterIds) : null, [filterIds]);
  const viewTrackers = filterSet ? trackers.filter(t => filterSet.has(t.id)) : trackers;
  const viewMasters = filterSet ? masters.filter(m => filterSet.has(m.id)) : masters;
  const viewEntries = useMemo(
    () => filterSet ? entries.filter(e => filterSet.has(e.trackerId)) : entries,
    [entries, filterSet]
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

        {viewMasters.length > 0 && (
          <MasterStrips masters={viewMasters} trackerById={trackerById} entries={entries} dayTs={selectedDay} onReorder={onReorder} />
        )}

        {viewTrackers.length === 0 ? (
          <div className="empty"><span className="em-serif">Aucun tracker.</span> Créez-en un pour commencer.</div>
        ) : (
          <DayGrid trackers={viewTrackers} entries={viewEntries} onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} dayTs={selectedDay} isToday={isToday} onReorder={onReorder} />
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
function TrackersView({ trackers, entries, filterIds, onAdd, onEdit, onArchive, onUnarchive, onReorder }){
  const countByTracker = useMemo(() => {
    const m = {};
    for (const e of entries) m[e.trackerId] = (m[e.trackerId] || 0) + 1;
    return m;
  }, [entries]);

  const filterSet = filterIds ? new Set(filterIds) : null;
  const shown = filterSet ? trackers.filter(t => filterSet.has(t.id)) : trackers;
  const byId = useMemo(() => Object.fromEntries(shown.map(t => [t.id, t])), [shown]);
  const active = shown.filter(t => !t.archived);
  const archived = shown.filter(t => t.archived);
  const activeIds = useMemo(() => active.map(t => t.id), [active]);
  const archivedIds = useMemo(() => archived.map(t => t.id), [archived]);
  const activeDrag = useDragReorder(activeIds, onReorder);
  const archivedDrag = useDragReorder(archivedIds, onReorder);

  const card = (t, drag) => {
    const typeLabel = isMaster(t) ? 'Master' : (TYPES.find(x => x.id === t.type)?.label || t.type);
    const chips = [];
    if (isMaster(t)){
      chips.push(`${(t.members||[]).length} membre${(t.members||[]).length>1?'s':''}`);
    } else {
      if (t.type === 'number' && t.unit) chips.push(t.unit);
      if (t.type === 'scale') chips.push(`1–${t.scaleMax || 5}`);
      if (t.type === 'choice'){
        chips.push(`${(t.choices||[]).length} choix`);
        chips.push(t.multiple ? 'multiple' : 'unique');
      }
      chips.push(t.daily ? 'une entrée/jour' : 'plusieurs/jour');
      if (!t.daily && (t.type === 'number' || t.type === 'duration')){
        chips.push(aggregateLabel(t).toLowerCase());
      }
    }
    const count = countByTracker[t.id] || 0;
    return (
      <div ref={drag.setNodeRef(t.id)} className={`tk-card ${t.archived?'archived':''} ${drag.dragId===t.id?'dragging':''}`} key={t.id}>
        <div className="tk-info">
          <div className="tk-name">
            <DragHandle onPointerDown={drag.startDrag(t.id)} dragging={drag.dragId===t.id} />
            {isMaster(t)
              ? <span className="master-mark" style={{background:t.color}}></span>
              : <span className="dot" style={{background:t.color}}></span>}
            {t.name}
          </div>
          <div className="tk-meta">
            <span className="tk-type">{typeLabel}</span>
            {chips.map((c,i)=><span key={i} className="tk-chip">{c}</span>)}
          </div>
          {!isMaster(t) && <div className="tk-count">{count} entrée{count>1?'s':''}</div>}
          {isMaster(t) && <div className="tk-count">indice calculé</div>}
        </div>
        <div className="tk-actions">
          <button className="tk-edit" onClick={()=>onEdit(t)}>Modifier</button>
          {t.archived
            ? <button className="tk-arch" onClick={()=>onUnarchive(t.id)}>Désarchiver</button>
            : <button className="tk-arch" onClick={()=>onArchive(t.id)}>Archiver</button>}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="trackers-head">
        <p className="section-label" style={{margin:0}}>Trackers · {active.length}</p>
        <button className="pill add" onClick={onAdd}>＋ Nouveau tracker</button>
      </div>

      {trackers.length === 0 ? (
        <div className="empty">
          <span className="em-serif">Aucun tracker.</span>
          Créez-en un pour commencer à suivre quelque chose.
        </div>
      ) : (
        <>
          <div className="trackers-grid">
            {activeDrag.order.map(id => byId[id] && card(byId[id], activeDrag))}
          </div>
          {archived.length > 0 && (
            <>
              <p className="section-label" style={{margin:'32px 0 16px'}}>Archivés · {archived.length}</p>
              <div className="trackers-grid">
                {archivedDrag.order.map(id => byId[id] && card(byId[id], archivedDrag))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================
   Vues view (charts / heatmap / grid)
   ============================================================ */
function VuesView({ trackers, trackerById, entries, filterIds, onReorder, onEdit, onOpenDay }){
  const [mode, setMode] = useState('chart'); // chart | calendar | summary
  const [rangeMode, setRangeMode] = useState('30'); // '7'|'30'|'90'|'365'|'ytd'|'all'|'custom'
  const [customStart, setCustomStart] = useState('');
  const [layout, setLayout] = useState('list'); // list | grid | master | average

  const filterSet = filterIds ? new Set(filterIds) : null;
  const visibleTrackers = filterSet ? trackers.filter(t => filterSet.has(t.id)) : trackers;
  // Data trackers only — the overlay/heatmap/grid modes need real entries,
  // so computed masters are handled separately (their own card). The filter
  // now narrows the Master overlay and Tendance too.
  const dataVisible = visibleTrackers.filter(t => !isMaster(t));
  const effectiveLayout = layout;

  const visibleById = useMemo(() => Object.fromEntries(visibleTrackers.map(t => [t.id, t])), [visibleTrackers]);
  const visibleIds = useMemo(() => visibleTrackers.map(t => t.id), [visibleTrackers]);
  const cardsDrag = useDragReorder(visibleIds, onReorder);

  // "Tout" needs the earliest entry among what's actually shown, so the range
  // stretches back exactly to where the visible trackers' history begins.
  const earliestTs = useMemo(() => {
    const ids = new Set(dataVisible.map(t => t.id));
    let min = null;
    for (const e of entries){
      if (!ids.has(e.trackerId)) continue;
      if (min == null || e.ts < min) min = e.ts;
    }
    return min ?? Date.now();
  }, [entries, dataVisible]);

  // Every card still just wants "how many days back from today" — presets,
  // YTD, "Tout" and a custom start date all resolve down to that one number.
  const range = useMemo(() => {
    const daysSince = (ts) => Math.max(1, Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86400000) + 1);
    if (rangeMode === 'ytd'){
      const jan1 = new Date(); jan1.setMonth(0, 1); jan1.setHours(0,0,0,0);
      return daysSince(jan1.getTime());
    }
    if (rangeMode === 'all') return daysSince(earliestTs);
    if (rangeMode === 'custom') return customStart ? daysSince(new Date(customStart + 'T00:00:00').getTime()) : 30;
    return parseInt(rangeMode, 10);
  }, [rangeMode, customStart, earliestTs]);

  return (
    <div>
      <div className="vue-controls">
        <div className="vue-mode">
          <button className={mode==='chart'?'on':''} onClick={()=>setMode('chart')}>Graphes</button>
          <button className={mode==='calendar'?'on':''} onClick={()=>setMode('calendar')}>Calendrier</button>
          <button className={mode==='summary'?'on':''} onClick={()=>setMode('summary')}>Grille</button>
        </div>
        <div className="range">
          {['7','30','90','365'].map(r => (
            <button key={r} className={rangeMode===r?'on':''} onClick={()=>setRangeMode(r)}>{r}j</button>
          ))}
          <button className={rangeMode==='ytd'?'on':''} onClick={()=>setRangeMode('ytd')}>YTD</button>
          <button className={rangeMode==='all'?'on':''} onClick={()=>setRangeMode('all')}>Tout</button>
          <button className={rangeMode==='custom'?'on':''} onClick={()=>setRangeMode('custom')}>Personnalisé</button>
          {rangeMode === 'custom' && (
            <input
              type="date"
              className="range-custom-date"
              value={customStart}
              max={dayKey(Date.now())}
              onChange={e=>setCustomStart(e.target.value)}
            />
          )}
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
              <button className={effectiveLayout==='master'?'on':''} onClick={()=>setLayout('master')} title="Les séries sélectionnées superposées, normalisées 0–100">
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M0 7 L3 4 L6 6 L9 2 L12 5"/><path d="M0 5 L3 7 L6 3 L9 5 L12 3" opacity="0.5"/></svg>
                Master
              </button>
              <button className={effectiveLayout==='average'?'on':''} onClick={()=>setLayout('average')} title="Moyenne normalisée des trackers sélectionnés">
                <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M0 6 Q3 3 6 5 T12 4"/></svg>
                Tendance
              </button>
            </div>
          </div>

          {effectiveLayout === 'list' && cardsDrag.order.map(id => {
            const t = visibleById[id];
            if (!t) return null;
            const dragProps = { containerRef: cardsDrag.setNodeRef(t.id), dragging: cardsDrag.dragId===t.id, onDragStart: cardsDrag.startDrag(t.id) };
            return isMaster(t)
              ? <MasterTrackerCard key={t.id} master={t} trackerById={trackerById} entries={entries} rangeDays={range} {...dragProps} />
              : <ChartCard key={t.id} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} onEdit={onEdit} onOpenDay={onOpenDay} {...dragProps} />;
          })}

          {effectiveLayout === 'grid' && (
            <div className="chart-grid-layout">
              {cardsDrag.order.map(id => {
                const t = visibleById[id];
                if (!t) return null;
                const dragProps = { containerRef: cardsDrag.setNodeRef(t.id), dragging: cardsDrag.dragId===t.id, onDragStart: cardsDrag.startDrag(t.id) };
                return isMaster(t)
                  ? <MasterTrackerCard key={t.id} compact master={t} trackerById={trackerById} entries={entries} rangeDays={range} {...dragProps} />
                  : <ChartCard key={t.id} compact tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} onEdit={onEdit} onOpenDay={onOpenDay} {...dragProps} />;
              })}
            </div>
          )}

          {effectiveLayout === 'master' && (
            <MasterChart trackers={dataVisible} entries={entries} rangeDays={range} />
          )}

          {effectiveLayout === 'average' && (
            <TrendChart trackers={dataVisible} entries={entries} rangeDays={range} />
          )}

          {visibleTrackers.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker.</span></div>}
        </>
      )}
      {mode === 'calendar' && (
        <>
          {dataVisible.map(t => (
            <CalendarCard key={t.id} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} onEdit={onEdit} />
          ))}
          {dataVisible.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker à afficher ici.</span></div>}
        </>
      )}
      {mode === 'summary' && (
        <GridSummary trackers={dataVisible} entries={entries} rangeDays={range} />
      )}
    </div>
  );
}

/* ============================================================
   Chart card — line chart with axes
   ============================================================ */
function ChartCard({ tracker, entries, rangeDays, compact = false, containerRef, dragging, onDragStart, onEdit, onOpenDay }){
  const now = Date.now();
  const start = now - rangeDays*86400000;
  const isCumulative = !!tracker.cumulative && (tracker.type === 'number' || tracker.type === 'duration');

  // Aggregate per-day: average for number/scale/duration, sum/count for boolean.
  // Cumulative trackers instead run a total across the tracker's whole history,
  // so the range only decides how many days are drawn, not what's summed.
  const grain = GRAINS.some(g => g.id === tracker.chartGrain) ? tracker.chartGrain : 'day';
  const curveStyle = tracker.curveStyle === 'smooth' ? 'smooth' : 'line';

  const dailyPoints = useMemo(() => {
    const jokerKeys = jokerDayKeys(entries);
    if (isCumulative){
      const valid = entries
        .filter(e => !isJokerEntry(e) && trackerActiveOnKey(tracker, dayKey(e.ts)))
        .map(e => ({ ts: e.ts, val: Number(e.value) }))
        .filter(e => !isNaN(e.val))
        .sort((a,b) => a.ts - b.ts);
      const arr = [];
      let vi = 0, running = 0;
      for (let i = rangeDays - 1; i >= 0; i--){
        const d = new Date(now - i*86400000);
        const dayEnd = startOfDay(d.getTime()) + 86400000 - 1;
        const viBefore = vi;
        while (vi < valid.length && valid[vi].ts <= dayEnd){ running += valid[vi].val; vi++; }
        // Nothing to plot before the first entry — the curve starts there, not at a flat zero.
        // hasEntry marks only the days that actually got a new entry, so the line stays at
        // the right height every day but a dot only lands where something was really logged.
        arr.push({ ts: d.getTime(), value: vi > 0 ? running : null, hasEntry: vi > viBefore });
      }
      return arr;
    }
    const map = new Map();
    for (const e of entries){
      if (e.ts < start || isJokerEntry(e)) continue;
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
      // Only days inside the active window count toward the chart & its stats.
      // A joker day is excluded outright — not zeroed, just left out.
      if (items.length && !jokerKeys.has(k) && trackerActiveOnKey(tracker, k)){
        if (tracker.type === 'boolean'){
          v = items.some(x=>x.value === true) ? 1 : 0;
        } else if (tracker.type === 'text' || tracker.type === 'choice'){
          v = items.length;
        } else {
          const nums = items.map(x => Number(x.value)).filter(x => !isNaN(x));
          v = aggregateNums(tracker, nums);
        }
      }
      arr.push({ ts: d.getTime(), value: v, hasEntry: v != null });
    }
    return arr;
  }, [entries, tracker, rangeDays, start, now, isCumulative]);

  // One plotted point per day, week or month — the tracker's own setting.
  const points = useMemo(
    () => rollupPoints(dailyPoints, grain, { cumulative: isCumulative }),
    [dailyPoints, grain, isCumulative]
  );

  const numericValues = points.map(p=>p.value).filter(v=>v!=null);
  const hasData = numericValues.length > 0;

  // Stats
  const latest = useMemo(() => {
    const sorted = entries.slice().sort((a,b)=>b.ts-a.ts);
    return sorted[0]?.value ?? null;
  }, [entries]);
  const avg = hasData ? numericValues.reduce((a,b)=>a+b,0)/numericValues.length : null;
  const cumulativeTotal = isCumulative && points.length ? points[points.length-1].value : null;
  const isSumMode = !tracker.daily && tracker.aggregate === 'sum' && (tracker.type === 'number' || tracker.type === 'duration');
  const total = isSumMode && hasData ? numericValues.reduce((a,b)=>a+b,0) : null;

  // SVG dimensions
  const W = 800, H = compact ? 110 : 160, PAD_L = compact ? 32 : 40, PAD_R = 12, PAD_T = 10, PAD_B = compact ? 20 : 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Domain
  // Scales and booleans have a fixed, meaningful range; everything else gets a
  // domain snapped outward to round steps so the axis never reads 5h24 → 10h36.
  const fixedScale = tracker.type === 'boolean' || tracker.type === 'scale';
  const domain = fixedScale
    ? (() => {
        const max = tracker.type === 'scale' ? (tracker.scaleMax || 5) : 1;
        const ticks = tracker.type === 'scale'
          ? [0, Math.round(max/2), max]
          : [0, 1];
        return { min: 0, max, ticks, step: 1 };
      })()
    // Aiming for ~6 gradations is what turns a 4.67-wide range into whole
    // units, an 863-wide one into steps of 200, and a 1.3-wide one into
    // halves — fewer ticks and the step jumps to the next coarser rung.
    : niceDomain(
        Math.min(...numericValues, Infinity),
        Math.max(...numericValues, -Infinity),
        compact ? 5 : 6,
        tracker.type
      );
  const yMin = domain.min, yMax = domain.max;
  const yDecimals = decimalsForStep(domain.step);

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

  // Format y-axis. Decimals come from the step, never from the value's own
  // size: rounding 12.5 and 13.0 to "13" and "13" made the axis unreadable.
  const fmtY = (v) => {
    if (tracker.type === 'duration') return fmtDuration(v);
    if (tracker.type === 'scale')    return Math.round(v).toString();
    if (tracker.type === 'boolean')  return v >= 0.5 ? 'oui' : 'non';
    return v.toFixed(yDecimals);
  };

  // X-axis ticks (start, middle, end)
  const xTicks = [
    { i: 0, label: grainTick(points[0]?.ts, grain) },
    { i: Math.floor(points.length/2), label: grainTick(points[Math.floor(points.length/2)]?.ts, grain) },
    { i: points.length-1, label: grainTick(points[points.length-1]?.ts, grain) },
  ].filter(t => points[t.i]);

  const yTicks = domain.ticks;

  // Scrub the chart with a mouse or a finger: `active` is the hovered/touched
  // day index, kept until the pointer leaves (mouse) or the close button is
  // tapped (touch — there's no "leave" to rely on there).
  const svgRef = useRef(null);
  const [active, setActive] = useState(null);
  const pointToIndex = (clientX) => {
    const el = svgRef.current;
    if (!el || !points.length) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return null;
    const relX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const xVB = relX * W;
    const idx = Math.round(((xVB - PAD_L) / innerW) * (points.length - 1));
    return Math.min(points.length - 1, Math.max(0, idx));
  };
  const handleMouseMove = (e) => { const i = pointToIndex(e.clientX); if (i != null) setActive(i); };
  const handleTouch = (e) => {
    const t = e.touches[0]; if (!t) return;
    const i = pointToIndex(t.clientX); if (i != null) setActive(i);
  };
  const activePoint = active != null ? points[active] : null;

  return (
    <div ref={containerRef} className={`chart-card ${compact?'compact':''} ${dragging?'dragging':''}`}>
      <div className="chart-head">
        <div className="name">
          {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
          <span className="dot" style={{background:tracker.color}}></span>{tracker.name}
        </div>
        <div className="chart-head-right">
          <div className="stats">
            {compact ? (
              <div><span className="v">{latest != null ? fmtValue(tracker, latest) : '—'}</span></div>
            ) : isCumulative ? (
              <>
                <div>actuel <span className="v">{latest != null ? fmtValue(tracker, latest) : '—'}</span></div>
                <div>cumulé <span className="v">{cumulativeTotal != null ? fmtValue(tracker, +cumulativeTotal.toFixed(1)) : '—'}</span></div>
              </>
            ) : (
              <>
                <div>actuel <span className="v">{latest != null ? fmtValue(tracker, latest) : '—'}</span></div>
                <div>{isSumMode ? 'total/jour' : 'moyenne'} <span className="v">{avg != null ? fmtValue(tracker, +avg.toFixed(1)) : '—'}</span></div>
                {isSumMode && <div>total période <span className="v">{total != null ? fmtValue(tracker, +total.toFixed(1)) : '—'}</span></div>}
                <div>entrées <span className="v">{entries.filter(e=>e.ts >= start).length}</span></div>
              </>
            )}
          </div>
          {onEdit && (
            <button className="chart-edit-btn" onClick={()=>onEdit(tracker)} aria-label="Paramètres du tracker" title="Paramètres du tracker">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.3" />
                <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {hasData ? (
        <div className="chart-svg-wrap" style={{position:'relative', touchAction:'pan-y'}}>
        <svg ref={svgRef} className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={()=>setActive(null)}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
        >
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
            const d = curvePath(seg, curveStyle);
            const area = d + ` L${seg[seg.length-1][0]},${PAD_T+innerH} L${seg[0][0]},${PAD_T+innerH} Z`;
            return (
              <g key={si}>
                <path d={area} fill={tracker.color} opacity="0.08" />
                <path d={d} fill="none" stroke={tracker.color} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {/* Interpolation over days with no data — dashed, so it never passes for a reading */}
          {bridgesBetween(segments).map((b, i) => (
            <line key={`b${i}`} x1={b.from[0]} y1={b.from[1]} x2={b.to[0]} y2={b.to[1]}
              stroke={tracker.color} strokeWidth="1.2" strokeDasharray="3 4" opacity="0.5" />
          ))}
          {/* Lone readings would otherwise be invisible: a segment of one draws no path */}
          {segments.filter(s => s.length === 1).map((s, i) => (
            <circle key={`l${i}`} cx={s[0][0]} cy={s[0][1]} r="2.5" fill="none"
              stroke={tracker.color} strokeWidth="1.2" />
          ))}
          {/* Points — only where something was actually logged, so a dense range (e.g. 365j)
              doesn't turn into a solid row of dots along an otherwise-continuous curve. */}
          {points.map((p,i)=> p.value != null && p.hasEntry && (
            <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r="2" fill={tracker.color}>
              <title>{shortDate(p.ts)} · {fmtValue(tracker, +p.value.toFixed(1))}</title>
            </circle>
          ))}
          {/* X ticks */}
          {xTicks.map((t,i)=>(
            <text key={i} className="chart-axis" x={xAt(t.i)} y={H-6} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
          ))}
          {/* Scrub cursor — the day currently hovered/touched */}
          {active != null && (
            <g>
              <line x1={xAt(active)} x2={xAt(active)} y1={PAD_T} y2={PAD_T+innerH} stroke={tracker.color} strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
              {activePoint?.value != null && <circle cx={xAt(active)} cy={yAt(activePoint.value)} r="3.5" fill={tracker.color} stroke="var(--bg)" strokeWidth="1.5" />}
            </g>
          )}
        </svg>
        {activePoint && (
          <ChartTooltip
            xPct={(xAt(active) / W) * 100}
            date={grainLabel(activePoint.ts, grain)}
            value={activePoint.value != null ? fmtValue(tracker, +activePoint.value.toFixed(1)) + (fmtUnit(tracker) ? ' ' + fmtUnit(tracker) : '') : 'aucune donnée'}
            /* A week or month point covers many days, so "open this day" has no
               single answer — the button only appears at day grain. */
            onEdit={onOpenDay && grain === 'day' ? ()=>onOpenDay(activePoint.ts) : null}
            onClose={()=>setActive(null)}
          />
        )}
        </div>
      ) : (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucune donnée sur la période</div>
      )}
    </div>
  );
}

/* ============================================================
   ChartTooltip — floating readout for a scrubbed day, with a round
   "open in history" button and a round close button. Positioned by
   percentage along the chart's width so it tracks the SVG's own
   responsive scaling without measuring pixels on every render.
   ============================================================ */
function ChartTooltip({ xPct, date, value, onEdit, onClose }){
  const side = xPct > 60 ? 'right' : xPct < 40 ? 'left' : 'center';
  return (
    <div
      className={`chart-tooltip ${side}`}
      style={{ left: `${xPct}%` }}
      onMouseDown={(e)=>e.stopPropagation()}
      onTouchStart={(e)=>e.stopPropagation()}
    >
      <button className="chart-tooltip-close" onClick={onClose} aria-label="Fermer" title="Fermer">
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 1L8 8M8 1L1 8"/></svg>
      </button>
      <div className="chart-tooltip-date">{date}</div>
      <div className="chart-tooltip-value">{value}</div>
      {onEdit && (
        <button className="chart-tooltip-edit" onClick={onEdit} aria-label="Éditer ce jour dans l'historique" title="Éditer ce jour dans l'historique">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 2l3 3-8 8-3.5.5.5-3.5 8-8z"/>
          </svg>
        </button>
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
function buildDailySeries(tracker, entries, rangeDays, endTs = Date.now()){
  const now = endTs;
  const start = now - rangeDays*86400000;
  const jokerKeys = jokerDayKeys(entries);
  const map = new Map();
  for (const e of entries){
    if (e.ts < start || isJokerEntry(e)) continue;
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
    // Outside the tracker's active window it contributes nothing (null), so it
    // never drags an average up or down before it starts or after it's archived.
    // A joker day is excluded the same way — left out, not zeroed.
    if (items.length && !jokerKeys.has(k) && trackerActiveOnKey(tracker, k)){
      if (tracker.type === 'boolean'){
        v = items.some(x=>x.value === true) ? 1 : 0;
      } else if (tracker.type === 'text' || tracker.type === 'choice'){
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
              {bridgesBetween(segs).map((b, i) => (
                <line key={`b${i}`} x1={b.from[0]} y1={b.from[1]} x2={b.to[0]} y2={b.to[1]}
                  stroke={s.tracker.color} strokeWidth="1.1" strokeDasharray="3 4"
                  opacity={hover==null?0.45:0.25} />
              ))}
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

/* Resolve a master's member tracker objects (data trackers only). */
function masterMembers(master, trackerById){
  return (master.members || []).map(id => trackerById[id]).filter(t => t && !isMaster(t));
}
/* Daily 0..1 index for a master: average of its members' normalized, gap-filled
   performance, masked to the master's own active window. */
// Each day's index reflects only what its members actually recorded that day.
// Deliberately no forward-fill here: carrying the last reading onwards made a
// single old entry keep scoring for weeks, so a master read a confident number
// while its members held nothing. Gaps stay gaps — the charts draw them dashed.
function computeMasterSeries(master, members, entries, rangeDays, endTs = Date.now()){
  const series = members.map(t =>
    normalizeSeries(t, buildDailySeries(t, entries.filter(e=>e.trackerId===t.id), rangeDays, endTs))
  );
  if (!series.length) return [];
  const len = series[0].length;
  const out = [];
  for (let i = 0; i < len; i++){
    const ts = series[0][i].ts;
    const k = dayKey(ts);
    if (!trackerActiveOnKey(master, k)){ out.push({ ts, value: null, filled: 0, total: members.length }); continue; }
    const vals = series.map(s => s[i]?.value).filter(v => v != null);
    out.push({
      ts,
      value: vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null,
      filled: vals.length,
      total: members.length,
    });
  }
  return out;
}

/* ============================================================
   Master strips — flat, read-only readings of each master's index
   (0–100). Shown atop the "Jour" view (current value) and atop the
   Historique day editor (value as of the opened day, via `dayTs`).
   Reorderable among themselves.
   ============================================================ */
function MasterStrips({ masters, trackerById, entries, dayTs, onReorder }){
  const byId = useMemo(() => Object.fromEntries(masters.map(m => [m.id, m])), [masters]);
  const ids = useMemo(() => masters.map(m => m.id), [masters]);
  const drag = useDragReorder(ids, onReorder);
  return (
    <div className="master-strips">
      {drag.order.map(id => {
        const m = byId[id];
        if (!m) return null;
        return (
          <MasterStrip key={m.id} master={m} trackerById={trackerById} entries={entries} dayTs={dayTs}
            containerRef={drag.setNodeRef(m.id)} dragging={drag.dragId === m.id} onDragStart={drag.startDrag(m.id)} />
        );
      })}
    </div>
  );
}
function MasterStrip({ master, trackerById, entries, dayTs, containerRef, dragging, onDragStart }){
  const members = masterMembers(master, trackerById);
  // The reading is always *that day's*, never the last one found further back:
  // an index is a statement about a day, so a day with nothing recorded reads "—".
  const today = useMemo(() => {
    const end = (dayTs != null) ? startOfDay(dayTs) : Date.now();
    const s = computeMasterSeries(master, members, entries, 30, end);
    return s.length ? s[s.length - 1] : null;
  }, [master, members, entries, dayTs]);
  const pct = today?.value != null ? Math.round(today.value*100) : null;
  // A partial index (2 of 4 members recorded) shouldn't read like a complete one.
  const partial = pct != null && today.filled < today.total;
  return (
    <div ref={containerRef} className={`master-strip ${dragging?'dragging':''}`}>
      <div className="ms-head">
        {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
        <span className="master-mark" style={{background:master.color}}></span>
        <span className="ms-name">{master.name}</span>
        <span className="master-tag">master</span>
        {partial && (
          <span className="ms-partial" title={`${today.filled} membre(s) renseigné(s) sur ${today.total}`}>
            {today.filled}/{today.total}
          </span>
        )}
      </div>
      <div className="ms-meter">
        <div className="ms-fill" style={{width:`${pct||0}%`, background:master.color}}></div>
      </div>
      <div className="ms-val">{pct != null ? pct : '—'}<span className="ms-unit">/100</span></div>
    </div>
  );
}

/* ============================================================
   Master tracker card — a saved index: average of the normalized
   performance of its chosen member trackers (0–100 per day).
   ============================================================ */
function MasterTrackerCard({ master, trackerById, entries, rangeDays, compact = false, containerRef, dragging, onDragStart }){
  const members = masterMembers(master, trackerById);
  const grain = GRAINS.some(g => g.id === master.chartGrain) ? master.chartGrain : 'day';
  const curveStyle = master.curveStyle === 'smooth' ? 'smooth' : 'line';

  // Per-member normalized+filled series, then the master's own active window.
  // The index is already 0–1, so its axis stays 0–100 whatever the grain —
  // only how many days one point covers changes.
  const dailySeries = useMemo(
    () => computeMasterSeries(master, members, entries, rangeDays),
    [master, members, entries, rangeDays]
  );
  const avgSeries = useMemo(() => rollupPoints(dailySeries, grain), [dailySeries, grain]);

  const numericValues = avgSeries.map(p=>p.value).filter(v=>v!=null);
  const hasData = numericValues.length > 0;
  const latest = numericValues[numericValues.length-1] ?? null;
  const earliest = numericValues[0] ?? null;
  const overallAvg = numericValues.length ? numericValues.reduce((a,b)=>a+b,0)/numericValues.length : null;
  const delta = (latest != null && earliest != null) ? latest - earliest : null;

  const W = 800, H = compact ? 130 : 220, PAD_L = 34, PAD_R = 14, PAD_T = 14, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const xAt = (i) => PAD_L + (i / Math.max(1, avgSeries.length - 1)) * innerW;
  const yAt = (v) => PAD_T + innerH - v * innerH;
  const yTicks = [0, 0.5, 1];

  const segments = [];
  let cur = [];
  avgSeries.forEach((p, i) => {
    if (p.value == null){ if (cur.length) segments.push(cur); cur = []; }
    else cur.push([xAt(i), yAt(p.value)]);
  });
  if (cur.length) segments.push(cur);

  const xTicks = avgSeries.length ? [
    { i: 0, label: grainTick(avgSeries[0].ts, grain) },
    { i: Math.floor(avgSeries.length/2), label: grainTick(avgSeries[Math.floor(avgSeries.length/2)].ts, grain) },
    { i: avgSeries.length-1, label: grainTick(avgSeries[avgSeries.length-1].ts, grain) },
  ] : [];

  return (
    <div ref={containerRef} className={`chart-card ${compact?'compact':''} ${dragging?'dragging':''}`}>
      <div className="chart-head">
        <div className="name">
          {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
          <span className="master-mark" style={{background:master.color}}></span>{master.name}
          <span className="master-tag">master</span>
        </div>
        <div className="stats">
          {compact ? (
            <div><span className="v">{latest!=null ? Math.round(latest*100) : '—'}</span></div>
          ) : (
            <>
              <div>actuel <span className="v">{latest!=null ? Math.round(latest*100) : '—'}</span></div>
              <div>moyenne <span className="v">{overallAvg!=null ? Math.round(overallAvg*100) : '—'}</span></div>
              <div>évolution <span className="v" style={{marginLeft:6, color: delta!=null ? (delta>0?'oklch(0.55 0.10 150)':delta<0?'oklch(0.55 0.10 30)':'inherit') : 'inherit'}}>
                {delta!=null ? (delta>0?'↑':delta<0?'↓':'=')+' '+Math.abs(Math.round(delta*100)) : '—'}
              </span></div>
            </>
          )}
        </div>
      </div>
      {members.length === 0 ? (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucun tracker membre — modifiez ce master pour en choisir</div>
      ) : hasData ? (
        <svg className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {yTicks.map((v,i)=>(
            <g key={i}>
              <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
              <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{Math.round(v*100)}</text>
            </g>
          ))}
          {/* Days where no member recorded anything are bridged dashed, not drawn solid */}
          {bridgesBetween(segments).map((b, i) => (
            <line key={`b${i}`} x1={b.from[0]} y1={b.from[1]} x2={b.to[0]} y2={b.to[1]}
              stroke={master.color} strokeWidth="1.4" strokeDasharray="3 4" opacity="0.5" />
          ))}
          {segments.map((seg, si) => {
            if (seg.length < 2) return seg.length === 1
              ? <circle key={si} cx={seg[0][0]} cy={seg[0][1]} r="2.5" fill={master.color} />
              : null;
            const d = curvePath(seg, curveStyle);
            const area = d + ` L${seg[seg.length-1][0]},${PAD_T+innerH} L${seg[0][0]},${PAD_T+innerH} Z`;
            return (
              <g key={si}>
                <path d={area} fill={master.color} opacity="0.08" />
                <path d={d} fill="none" stroke={master.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {xTicks.map((t,i)=>(
            <text key={i} className="chart-axis" x={xAt(t.i)} y={H-6} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
          ))}
        </svg>
      ) : (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucune donnée sur la période</div>
      )}
      {!compact && members.length > 0 && (
        <div className="master-legend">
          {members.map(t => (
            <div key={t.id} className="lg-item">
              <span className="lg-dot" style={{background:t.color}}></span>
              <span className="lg-name">{t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Calendar heatmap card
   ============================================================ */
function CalendarCard({ tracker, entries, rangeDays, onEdit }){
  // Always render last ~365 days of cells (or rangeDays), aligned to weeks
  const days = Math.min(Math.max(rangeDays, 30), 365);
  const now = new Date(); now.setHours(0,0,0,0);
  // start at most `days` ago, then snap to Monday
  let start = new Date(now); start.setDate(start.getDate() - (days-1));
  // align to Monday (1)
  const dow = (start.getDay() + 6) % 7; // 0=Mon
  start.setDate(start.getDate() - dow);

  // Aggregate per day
  const jokerKeys = jokerDayKeys(entries);
  const byDay = new Map();
  for (const e of entries){
    if (isJokerEntry(e)) continue;
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
    // A joker day reads as empty — excluded, not a zero.
    const items = (trackerActiveOnKey(tracker, k) && !jokerKeys.has(k) ? byDay.get(k) : null) || [];
    let v = 0;
    if (items.length){
      if (tracker.type === 'boolean'){
        v = items.some(x=>x.value === true) ? 1 : 0;
      } else if (tracker.type === 'text' || tracker.type === 'choice'){
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
        <div className="chart-head-right">
          <div className="stats">
            <div>jours actifs <span className="v">{dayVals.filter(d=>d.count>0).length}/{totalDays}</span></div>
          </div>
          {onEdit && (
            <button className="chart-edit-btn" onClick={()=>onEdit(tracker)} aria-label="Paramètres du tracker" title="Paramètres du tracker">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.3" />
                <path d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
    const tEntries = entries.filter(e => e.trackerId === t.id);
    const jokerKeys = jokerDayKeys(tEntries);
    // A joker day drops out entirely — its entries never enter the average/sum.
    const active = (e) => !isJokerEntry(e) && !jokerKeys.has(dayKey(e.ts)) && trackerActiveOnKey(t, dayKey(e.ts));
    const inRange = entries.filter(e => e.trackerId === t.id && e.ts >= start && active(e));
    const prev    = entries.filter(e => e.trackerId === t.id && e.ts >= prevStart && e.ts < start && active(e));
    const stat = (items) => {
      if (!items.length) return null;
      if (t.type === 'boolean') return items.filter(x=>x.value===true).length;
      if (t.type === 'text' || t.type === 'choice') return items.length;
      const nums = items.map(x=>Number(x.value)).filter(x=>!isNaN(x));
      return aggregateNums(t, nums);
    };
    const curStat = stat(inRange);
    const prevStat = stat(prev);
    const delta = curStat != null && prevStat != null && prevStat !== 0 ? (curStat - prevStat) / Math.abs(prevStat) : null;

    let display = '—';
    if (curStat != null){
      if (t.type === 'boolean') display = `${curStat}j`;
      else if (t.type === 'text' || t.type === 'choice') display = `${curStat}`;
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
  const [choice, setChoice] = useState(t.type==='choice' ? readChoice(t, entry.value) : (t.multiple ? [] : null));
  const [note, setNote]   = useState(entry.note || '');
  const [day, setDay]     = useState(() => {
    const d = new Date(entry.ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [at, setAt] = useState(() => {
    const d = new Date(entry.ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });

  const toggleChoice = (opt) => {
    if (t.multiple){
      setChoice(prev => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.includes(opt) ? arr.filter(x=>x!==opt) : [...arr, opt];
      });
    } else {
      setChoice(prev => prev === opt ? null : opt);
    }
  };

  const canSave = useMemo(() => {
    switch (t.type){
      case 'number':   return num !== '' && !isNaN(parseFloat(num));
      case 'scale':    return scale != null;
      case 'boolean':  return bool != null;
      case 'duration': return (durH !== '' || durM !== '') && (parseInt(durH||'0',10) + parseInt(durM||'0',10) > 0);
      case 'choice':   return t.multiple ? (Array.isArray(choice) && choice.length > 0) : choice != null;
      case 'text':     return text.trim().length > 0;
    }
    return false;
  }, [t.type, t.multiple, num, scale, bool, durH, durM, text, choice]);

  const submit = () => {
    if (!canSave) return;
    let value;
    switch (t.type){
      case 'number':   value = parseFloat(num); break;
      case 'scale':    value = scale; break;
      case 'boolean':  value = bool; break;
      case 'duration': value = parseInt(durH||'0',10)*60 + parseInt(durM||'0',10); break;
      case 'choice':   value = choice; break;
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
                <input type="number" min="0" placeholder="00" value={durM}
                  onChange={e=>{
                    const raw = e.target.value;
                    if ((parseInt(raw || '0', 10) || 0) >= 60){
                      const n = normalizeHM(durH, raw);
                      setDurH(n.h); setDurM(n.m);
                    } else {
                      setDurM(raw);
                    }
                  }}
                  style={{width:50,textAlign:'right'}} />
                <span className="unit">min</span>
              </div>
            )}
            {t.type === 'choice' && (
              (t.choices && t.choices.length) ? (
                <div className="choices">
                  {t.choices.map(opt => {
                    const active = t.multiple ? (Array.isArray(choice) && choice.includes(opt)) : choice === opt;
                    return <button key={opt} className={active?'on':''} onClick={()=>toggleChoice(opt)}>{opt}</button>;
                  })}
                </div>
              ) : (
                <span className="tc-empty-note">Aucun choix défini pour ce tracker.</span>
              )
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
function TrackerModal({ tracker, allTrackers = [], onClose, onSave, onDelete, onArchive, onUnarchive }){
  const isEdit = !!tracker;
  // — Cœur : ce que le tracker mesure —
  const [kind, setKind] = useState(tracker?.type === 'master' ? 'master' : 'data'); // data | master
  const [name, setName] = useState(tracker?.name || '');
  const [type, setType] = useState(tracker?.type && tracker.type !== 'master' ? tracker.type : 'number');
  const [unit, setUnit] = useState(tracker?.unit || '');
  const [scaleMax, setScaleMax] = useState(tracker?.scaleMax || 5);
  const [choices, setChoices] = useState(tracker?.choices?.length ? tracker.choices : ['', '']);
  const [members, setMembers] = useState(tracker?.members || []);
  // — Paramètres : comment on le remplit et le lit —
  const [daily, setDaily] = useState(!!tracker?.daily);
  const [aggregate, setAggregate] = useState(tracker?.aggregate || 'avg');
  const [multiple, setMultiple] = useState(!!tracker?.multiple);
  const [windowEnabled, setWindowEnabled] = useState(tracker ? tracker.windowEnabled !== false : true);
  const [jokerEnabled, setJokerEnabled] = useState(!!tracker?.jokerEnabled);
  const [cumulative, setCumulative] = useState(!!tracker?.cumulative);
  const [curveStyle, setCurveStyle] = useState(tracker?.curveStyle === 'smooth' ? 'smooth' : 'line');
  const [chartGrain, setChartGrain] = useState(
    GRAINS.some(g => g.id === tracker?.chartGrain) ? tracker.chartGrain : 'day');
  const [startDate, setStartDate] = useState(tracker?.startDate || dayKey(tracker?.createdAt || Date.now()));
  const [endDate, setEndDate] = useState(tracker?.endDate || '');
  const [color, setColor] = useState(tracker?.color || COLORS[1]);
  const nameRef = useRef();

  useEffect(() => { nameRef.current?.focus(); }, []);

  const setChoiceAt = (i, val) => setChoices(cs => cs.map((c,idx)=>idx===i?val:c));
  const addChoice = () => setChoices(cs => [...cs, '']);
  const removeChoice = (i) => setChoices(cs => cs.filter((_,idx)=>idx!==i));
  const toggleMember = (id) => setMembers(ms => ms.includes(id) ? ms.filter(x=>x!==id) : [...ms, id]);

  const memberCandidates = allTrackers.filter(t => !isMaster(t) && (!tracker || t.id !== tracker.id));
  const cleanChoices = choices.map(c=>c.trim()).filter(Boolean);
  const isMasterKind = kind === 'master';
  const showAggregate = !isMasterKind && !daily && (type === 'number' || type === 'duration');
  const canSave = name.trim().length > 0 && (
    isMasterKind ? members.length > 0 : (type !== 'choice' || cleanChoices.length > 0)
  );

  const submit = () => {
    if (!canSave) return;
    const t = { name: name.trim(), color };
    t.windowEnabled = windowEnabled;
    t.startDate = windowEnabled ? (startDate || null) : null;
    t.endDate = windowEnabled ? (endDate || null) : null;
    // Display only — a master gets these just like a data tracker.
    t.curveStyle = curveStyle;
    t.chartGrain = chartGrain;
    if (isMasterKind){
      t.type = 'master';
      t.members = members;
      t.unit = null; t.scaleMax = null; t.choices = null; t.multiple = false;
      t.jokerEnabled = false;
    } else {
      t.type = type;
      t.daily = daily;
      t.aggregate = aggregate;
      t.jokerEnabled = !daily && jokerEnabled;
      t.cumulative = (type === 'number' || type === 'duration') && cumulative;
      t.members = null;
      t.unit = (type === 'number' && unit.trim()) ? unit.trim() : null;
      t.scaleMax = type === 'scale' ? scaleMax : null;
      t.choices = type === 'choice' ? [...new Set(cleanChoices)] : null;
      t.multiple = type === 'choice' ? multiple : false;
    }
    onSave(t);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <h2>{isEdit ? 'Modifier le tracker' : 'Nouveau tracker'}</h2>
        <div className="modal-sub">Le cœur définit ce que vous mesurez, les paramètres comment.</div>

        {/* ============ CŒUR ============ */}
        <p className="modal-section first">Cœur</p>

        <div className="field">
          <label>Genre</label>
          <div className="ctl-with-info">
            <div className="seg">
              <button className={!isMasterKind?'on':''} onClick={()=>setKind('data')}>Tracker</button>
              <button className={isMasterKind?'on':''} onClick={()=>setKind('master')}>Master</button>
            </div>
            <InfoBubble>
              <span className="k">Tracker</span> : vous le remplissez avec des données.<br/>
              <span className="k">Master</span> : ne se remplit pas — c’est la moyenne normalisée (0–100) de la performance de plusieurs trackers choisis.
            </InfoBubble>
          </div>
        </div>

        <div className="field" style={{borderBottom: isMasterKind ? '1px solid var(--line)' : undefined}}>
          <label>Nom</label>
          <input ref={nameRef} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') submit();}}
            placeholder={isMasterKind ? 'ex: Forme, Bien-être, Discipline…' : 'ex: Caféine, Humeur, Sport…'} />
        </div>

        {isMasterKind ? (
          <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
            <label style={{width:'auto'}}>Trackers membres</label>
            {memberCandidates.length === 0 ? (
              <span className="tc-empty-note">Créez d’abord des trackers de données à agréger.</span>
            ) : (
              <div className="member-picker">
                {memberCandidates.map(t => (
                  <button key={t.id} type="button" className={`member ${members.includes(t.id)?'on':''}`} onClick={()=>toggleMember(t.id)}>
                    <span className="dot" style={{background:t.color}}></span>{t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="field" style={{borderBottom: (type==='number'||type==='scale'||type==='choice') ? '1px solid var(--line)' : 'none', flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
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
              <div className="field" style={{borderBottom:'none'}}>
                <label>Unité</label>
                <input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="kg, €, ml, pas… (optionnel)" />
              </div>
            )}
            {type === 'scale' && (
              <div className="field" style={{borderBottom:'none'}}>
                <label>Max</label>
                <div className="seg">
                  {[3,5,7,10].map(n => (
                    <button key={n} className={scaleMax===n?'on':''} onClick={()=>setScaleMax(n)}>1–{n}</button>
                  ))}
                </div>
              </div>
            )}
            {type === 'choice' && (
              <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
                <label style={{width:'auto'}}>Choix possibles</label>
                <div className="choices-editor">
                  {choices.map((c,i) => (
                    <div className="choice-row" key={i}>
                      <input value={c} onChange={e=>setChoiceAt(i, e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addChoice(); } }}
                        placeholder={`Choix ${i+1}`} />
                      <button type="button" className="choice-del" onClick={()=>removeChoice(i)} aria-label="Retirer" disabled={choices.length<=1}>×</button>
                    </div>
                  ))}
                  <button type="button" className="choice-add" onClick={addChoice}>＋ Ajouter un choix</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ PARAMÈTRES ============ */}
        <p className="modal-section">Paramètres</p>

        {!isMasterKind && (
          <div className="field">
            <label>Fréquence</label>
            <div className="ctl-with-info">
              <div className="seg">
                <button className={daily?'on':''} onClick={()=>setDaily(true)}>Une / jour</button>
                <button className={!daily?'on':''} onClick={()=>setDaily(false)}>Plusieurs / jour</button>
              </div>
              <InfoBubble>
                <span className="k">Une / jour</span> : une seule entrée par jour, ré-enregistrer un jour déjà noté remplace sa valeur.<br/>
                <span className="k">Plusieurs / jour</span> : autant d’entrées que vous voulez chaque jour.
              </InfoBubble>
            </div>
          </div>
        )}

        {!isMasterKind && !daily && (
          <div className="field">
            <label className="period-toggle" style={{width:'auto'}}>
              <input type="checkbox" checked={jokerEnabled} onChange={e=>setJokerEnabled(e.target.checked)}
                style={{flex:'none',width:16,height:16,margin:0,accentColor:'var(--accent)',cursor:'pointer'}} />
              <span>Case joker</span>
              <InfoBubble>
                Ajoute un bouton pour marquer une journée entière comme joker (pull day, repos…).
                Les entrées de ce jour sont alors exclues des calculs — pas comptées comme zéro.
                Désactivée par défaut.
              </InfoBubble>
            </label>
          </div>
        )}

        {showAggregate && (
          <div className="field">
            <label>Calcul</label>
            <div className="ctl-with-info">
              <div className="seg wrap">
                {AGGREGATES.map(a => (
                  <button key={a.id} className={aggregate===a.id?'on':''} onClick={()=>setAggregate(a.id)}>{a.label}</button>
                ))}
              </div>
              <InfoBubble>
                Combine plusieurs entrées d’un même jour :<br/>
                <span className="k">Moyenne</span> (10, 15, 20 → 15) · <span className="k">Somme</span> (→ 45) · <span className="k">Minimum</span> (→ 10) · <span className="k">Maximum</span> (→ 20).
              </InfoBubble>
            </div>
          </div>
        )}

        {!isMasterKind && type === 'choice' && (
          <div className="field">
            <label>Sélection</label>
            <div className="ctl-with-info">
              <div className="seg">
                <button className={!multiple?'on':''} onClick={()=>setMultiple(false)}>Choix unique</button>
                <button className={multiple?'on':''} onClick={()=>setMultiple(true)}>Choix multiple</button>
              </div>
              <InfoBubble>
                <span className="k">Choix unique</span> : une seule option par entrée.<br/>
                <span className="k">Choix multiple</span> : plusieurs options cochables par entrée.
              </InfoBubble>
            </div>
          </div>
        )}

        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,paddingTop:14}}>
          <label className="period-toggle" style={{width:'auto'}}>
            <input type="checkbox" checked={windowEnabled} onChange={e=>setWindowEnabled(e.target.checked)}
              style={{flex:'none',width:16,height:16,margin:0,accentColor:'var(--accent)',cursor:'pointer'}} />
            <span>Période d’activité</span>
            <InfoBubble>
              Cochée, ce tracker n’influence les graphes et moyennes qu’entre les deux dates.
              <span className="k"> Début</span> par défaut = jour de création (utile si vous ne l’utilisez qu’après quelques jours).
              Laissez <span className="k">Fin</span> vide tant qu’il est actif — l’archivage la renseigne automatiquement.
              Décochée, le tracker compte <span className="k">tous les jours</span>, sans limite.
            </InfoBubble>
          </label>
          {windowEnabled ? (
            <div className="period-row">
              <div className="period-field">
                <span>Début</span>
                <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
              </div>
              <div className="period-field">
                <span>Fin</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={e=>setEndDate(e.target.value)} />
              </div>
            </div>
          ) : (
            <span className="tc-empty-note">Ce tracker compte tous les jours, sans limite de période.</span>
          )}
          {isEdit && (
            tracker.archived
              ? <button type="button" className="period-arch unarchive" onClick={onUnarchive}>Désarchiver ce tracker</button>
              : <button type="button" className="period-arch" onClick={onArchive}>Archiver ce tracker</button>
          )}
        </div>

        {/* ============ VUES ============ */}
        <p className="modal-section">Vues</p>

        <div className="field">
          <label>Courbe</label>
          <div className="ctl-with-info">
            <div className="seg">
              {CURVE_STYLES.map(c => (
                <button key={c.id} className={curveStyle===c.id?'on':''} onClick={()=>setCurveStyle(c.id)}>{c.label}</button>
              ))}
            </div>
            <InfoBubble>
              <span className="k">Polyligne</span> : les points reliés par des segments droits.<br/>
              <span className="k">Lissée</span> : une courbe arrondie qui passe quand même exactement par
              chaque point — c’est le tracé qui change, jamais les valeurs.
            </InfoBubble>
          </div>
        </div>

        <div className="field">
          <label>Un point =</label>
          <div className="ctl-with-info">
            <div className="seg">
              {GRAINS.map(g => (
                <button key={g.id} className={chartGrain===g.id?'on':''} onClick={()=>setChartGrain(g.id)}>{g.label}</button>
              ))}
            </div>
            <InfoBubble>
              Regroupe les jours sur le graphe. <span className="k">Semaine</span> et <span className="k">Mois</span>
              affichent la <span className="k">moyenne</span> des jours renseignés de la période — les jours vides ne
              comptent pas pour zéro. L’échelle reste donc lisible dans la même unité quelle que soit la
              granularité. Réglage indépendant de la forme de courbe.
            </InfoBubble>
          </div>
        </div>

        {!isMasterKind && (type === 'number' || type === 'duration') && (
          <div className="field">
            <label className="period-toggle" style={{width:'auto'}}>
              <input type="checkbox" checked={cumulative} onChange={e=>setCumulative(e.target.checked)}
                style={{flex:'none',width:16,height:16,margin:0,accentColor:'var(--accent)',cursor:'pointer'}} />
              <span>Graphe cumulatif</span>
              <InfoBubble>
                Le graphe affiche la somme de toutes les entrées depuis le début plutôt que la valeur du jour —
                une courbe qui ne peut que monter, au lieu de suivre l’entrée du jour.
                Groupé par semaine ou par mois, chaque point porte le total atteint en fin de période.
              </InfoBubble>
            </label>
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
          {isEdit && <button className="danger" onClick={()=>{ if(confirm(isMaster(tracker) ? 'Supprimer ce master ?' : 'Supprimer ce tracker et toutes ses entrées ?')) onDelete(); }}>Supprimer</button>}
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

// Le montage n'a pas lieu ici mais au dernier <script> de Tracklog.html, une fois
// app.food.jsx exécuté : la page Bouffe y déclare ses composants, et App les
// utilise dès le premier rendu.
function mountTracklog(){
  if (window.__tkBootDone) window.__tkBootDone();
  ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
}
