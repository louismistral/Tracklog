const { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useContext } = React;

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

/* ---- Couleurs de tracker --------------------------------------------------
   Un nuancier construit, pas une liste écrite à la main : toutes les teintes,
   quatre niveaux de luminosité, et une chroma constante — c'est elle qui fait
   que deux trackers de couleurs différentes appartiennent quand même au même
   dessin. Faire varier la saturation en même temps que la teinte donnerait des
   couleurs qui « crient » plus fort que d'autres sans raison.

   Les cinq teintes d'origine (30, 80, 150, 250, 320) sont dans la liste, à leur
   valeur exacte : les trackers déjà créés retombent sur une pastille du
   nuancier, ils n'ont pas l'air d'être hors palette. Et si une couleur stockée
   n'y est vraiment pas (import, ancienne version), TrackerModal l'ajoute en fin
   de grille plutôt que de faire semblant que rien n'est sélectionné. */
/* Le nuancier tient sur UNE ligne de dix ronds : sept teintes, un gris, une
   encre, et le « + » qui ouvre l'éditeur. C'est tout — et c'est délibéré.
   Trente-deux pastilles demandaient de choisir entre des voisines qu'on ne
   distinguait qu'en les comparant, pour une décision qui n'en vaut pas la
   peine : une couleur de tracker sert à séparer deux courbes, pas à assortir
   une identité. Qui veut une nuance précise ouvre l'éditeur, qui donne tout.

   Les sept teintes sont espacées d'environ 50° et nommables d'un mot chacune
   (orange, jaune, vert, cyan, bleu, violet, rose). La première est à 35° :
   c'est exactement celle de l'orange de Tracklog (#e2542f = oklch(0.63 0.184 35)),
   donc la couleur d'origine de l'app est dans la grille, pas à côté.

   L'encre n'est pas « du noir » mais `var(--ink)` : elle est presque noire sur
   le fond clair et presque blanche sur le fond sombre. Une couleur de tracker
   doit rester visible quel que soit le style, et c'est la seule façon d'avoir
   « la couleur du texte » plutôt qu'une valeur qui disparaît dans un thème. */
const COLOR_HUES = [35, 90, 145, 195, 250, 300, 350];
const COLOR_LIGHT = 0.63;
// Au-delà du gamut sRGB pour la plupart des teintes : le navigateur ramène la
// chroma au maximum affichable, ce qui est exactement « saturation à fond ».
const COLOR_CHROMA = 0.20;
const COLOR_GREY = 'oklch(0.62 0 0)';
const COLOR_INK = 'var(--ink)';
const COLORS = [
  ...COLOR_HUES.map(h => `oklch(${COLOR_LIGHT} ${COLOR_CHROMA} ${h})`),
  COLOR_GREY, COLOR_INK,
];
// La couleur proposée à la création : le vert du nuancier.
const DEFAULT_COLOR = `oklch(${COLOR_LIGHT} ${COLOR_CHROMA} 145)`;
// L'accent d'origine de l'app, et la pastille du nuancier qui lui correspond.
const TRACKLOG_ACCENT = `oklch(${COLOR_LIGHT} ${COLOR_CHROMA} 35)`;

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
   Les paramètres ne se désactivent pas : c'est la seule porte pour rallumer le
   reste, et ce n'est de toute façon pas un onglet mais l'engrenage du bout de
   barre. Tous les autres se masquent, Log compris — deux lignes de la même
   liste, dans la même carte, ne peuvent pas se comporter différemment sans que
   ça passe pour un bug. Pas d'entrée « Trackers » : cette page a disparu,
   remplacée par le bouton du Log et l'engrenage par tracker.

   Cette liste ne dit QUE des onglets de la barre du haut. L'analyse IA de la
   page Food y a figuré un temps : c'était une erreur de rangement — ce n'est
   pas un onglet du haut mais une des quatre façons d'ajouter à manger, au même
   titre que la recherche ou le scan. On ne masque pas l'une sans les autres,
   donc elle est toujours là et n'a plus d'interrupteur. */
const TOGGLEABLE_TABS = [
  { id:'log',      label:'Log',      hint:'remplir la journée, l’historique, les chronos' },
  { id:'food',     label:'Food',     hint:'suivi nutritionnel, scanner, aliments et repas' },
  { id:'vues',     label:'Vues',     hint:'graphes, calendrier, grille de KPI' },
  { id:'training', label:'Training', hint:'à venir' },
  { id:'analyst',  label:'AI analyst', hint:'lecture des données par Claude — corrélations entre trackers ; à venir' },
];
const DEFAULT_TABS = { log:true, food:true, vues:true, training:true, analyst:true };

/* Les onglets de la barre du haut, dans leur ordre par défaut. L'ordre affiché
   vient du compte (prefs.tabOrder) : il se réarrange en maintenant un onglet,
   comme les cartes et les pastilles du rail. Les paramètres, eux, ne sont pas
   un onglet : c'est l'engrenage, à sa place fixe au bout de la barre. */
const NAV_TABS = [
  { id:'log',      label:'Log' },
  { id:'food',     label:'Food' },
  { id:'training', label:'Training' },
  { id:'vues',     label:'Vues' },
  { id:'analyst',  label:'AI analyst' },
];

// How a chart draws its line, and how wide one plotted point is. Two
// independent per-tracker display settings — neither changes the stored data.
const CURVE_STYLES = [
  { id:'line',   label:'Polyligne' },
  { id:'smooth', label:'Lissée' },
  { id:'bars',   label:'Bâtons' },
];
const isCurveStyle = (id) => CURVE_STYLES.some(c => c.id === id);
const GRAINS = [
  { id:'day',   label:'Jour' },
  { id:'week',  label:'Semaine' },
  { id:'month', label:'Mois' },
];

/* ---- Densité des cartes de graphe -----------------------------------------
   Combien de cartes par ligne dans la vue Cartes. Au-delà de quatre, une carte
   est plus étroite que son propre axe : le graphe cesse de se lire.
   Chaque cran retire du détail plutôt que de le tasser — c'est ce qui fait la
   différence entre « plus petit » et « illisible ». */
const MAX_PER_ROW = 3;
function chartDetail(perRow){
  // `axisLabels:false` au cran serré n'est pas qu'une simplification voulue :
  // le SVG est étiré en `preserveAspectRatio="none"`, donc son texte se
  // comprime horizontalement avec la carte. À 250 px de large les graduations
  // deviennent des taches. On les retire, la carte devient une sparkline —
  // la valeur du jour reste lisible, elle, dans l'en-tête.
  if (perRow >= 3) return { height: 84,  padL: 8,  padB: 8,  yTicks: 3, midTick: false, axisLabels: false, stats: 'value' };
  if (perRow === 2) return { height: 110, padL: 32, padB: 20, yTicks: 5, midTick: true,  axisLabels: true,  stats: 'short' };
  return                   { height: 160, padL: 40, padB: 24, yTicks: 6, midTick: true,  axisLabels: true,  stats: 'full'  };
}

/* ============================================================
   Supabase — cloud persistence + auth
   ============================================================ */
const SUPABASE_URL = 'https://drrmqrhsfgermgblndzz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycm1xcmhzZmdlcm1nYmxuZHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTI1NzMsImV4cCI6MjA5OTY4ODU3M30.NOV3tKFH2vGI043cGZhB2yu9IlqFUVoXXP4JaXA-9vE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function trackerFromRow(r){
  return { id:r.id, name:r.name, type:r.type, unit:r.unit || undefined, scaleMin:r.scale_min ?? undefined, scaleMax:r.scale_max || undefined, scaleStep:r.scale_step || undefined, choices:Array.isArray(r.choices) ? r.choices : undefined, multiple:!!r.multiple, daily:!!r.daily, aggregate:r.aggregate || 'avg', members:Array.isArray(r.members) ? r.members : undefined, archived:!!r.archived, startDate:r.start_date || undefined, endDate:r.end_date || undefined, windowEnabled:r.window_enabled !== false, jokerEnabled:!!r.joker_enabled, cumulative:!!r.cumulative, curveStyle:isCurveStyle(r.curve_style) ? r.curve_style : 'line', chartGrain:GRAINS.some(g => g.id === r.chart_grain) ? r.chart_grain : 'day', goodDirection:r.good_direction || undefined, targetValue:r.target_value ?? undefined, order:r.order_index ?? 0, color:r.color, createdAt:r.created_at };
}
function trackerToRow(t, userId){
  return { id:t.id, user_id:userId, name:t.name, type:t.type, unit:t.unit || null, scale_min:t.scaleMin ?? null, scale_max:t.scaleMax || null, scale_step:t.scaleStep || null, choices:(t.choices && t.choices.length) ? t.choices : null, multiple:!!t.multiple, daily:!!t.daily, aggregate:t.aggregate || 'avg', members:(t.members && t.members.length) ? t.members : null, archived:!!t.archived, start_date:t.startDate || null, end_date:t.endDate || null, window_enabled:t.windowEnabled !== false, joker_enabled:!!t.jokerEnabled, cumulative:!!t.cumulative, curve_style:isCurveStyle(t.curveStyle) ? t.curveStyle : 'line', chart_grain:GRAINS.some(g => g.id === t.chartGrain) ? t.chartGrain : 'day', good_direction:t.goodDirection || null, target_value:t.targetValue ?? null, order_index:t.order ?? 0, color:t.color, created_at:t.createdAt };
}
function entryFromRow(r){
  return { id:r.id, trackerId:r.tracker_id, value:r.value, note:r.note || '', ts:r.ts };
}
function entryToRow(e, userId){
  return { id:e.id, user_id:userId, tracker_id:e.trackerId, value:e.value, note:e.note || '', ts:e.ts };
}
function chronoFromRow(r){
  return { id:r.id, label:r.label || '', trackerId:r.tracker_id || null,
           accumulatedMs:Number(r.accumulated_ms) || 0, startedAt:r.started_at != null ? Number(r.started_at) : null,
           order:r.order_index || 0 };
}
function chronoToRow(c, userId){
  return { id:c.id, user_id:userId, label:c.label || null, tracker_id:c.trackerId || null,
           accumulated_ms:c.accumulatedMs || 0, started_at:c.startedAt ?? null, order_index:c.order || 0,
           updated_at:Date.now() };
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

/* ---- Bâtons ---------------------------------------------------------------
   La troisième forme, à côté de la polyligne et de la courbe lissée : un bâton
   par point plutôt qu'un trait qui les relie. Ce n'est pas qu'un habillage —
   un trait entre deux jours affirme que la valeur est passée par tout ce qui
   les sépare, ce qu'une mesure quotidienne ne dit jamais. Un bâton ne parle que
   du jour qu'il occupe, et un jour sans donnée reste un vide, pas un pont.
   Le pied des bâtons est le zéro quand l'échelle le contient, le bas du cadre
   sinon : sur une échelle qui ne descend pas à zéro, une longueur de bâton ne
   se compare pas — seule sa hauteur situe la valeur. */
function ChartBars({ points, xAt, yAt, baseY, color, spacing }){
  const w = Math.max(1.5, Math.min(spacing * 0.62, 16));
  return points.map((p, i) => {
    if (p.value == null) return null;
    const y = yAt(p.value);
    // Une valeur posée sur le pied même (le bas de l'échelle) ne dessinerait
    // rien : elle garde un trait d'un pixel, mais au-dessus de la ligne, pas
    // en dessous — sinon la rangée des minimums déborde du cadre d'un pixel et
    // les bâtons n'ont plus tous le même pied.
    const above = y <= baseY;
    const h = Math.max(1, Math.abs(y - baseY));
    return (
      <rect key={i} x={xAt(i) - w/2} y={above ? Math.min(y, baseY - 1) : baseY} width={w} height={h}
            fill={color} opacity={p.hasEntry === false ? 0.45 : 0.75} />
    );
  });
}
// Le pied des bâtons, dans le repère du graphe.
const barBaseY = (yMin, yMax, yAt, bottom) => (yMin <= 0 && yMax >= 0) ? yAt(0) : bottom;

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
// ISO 8601 week number — Monday-first, week 1 is the one holding the year's first Thursday.
function isoWeek(ts){
  const d = new Date(Date.UTC(new Date(ts).getFullYear(), new Date(ts).getMonth(), new Date(ts).getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
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

/* Une explication vit derrière un « i », partout, sans exception : c'est ce que
   dit le réglage « Bulles infos » des paramètres, et une page qui écrirait
   quand même ses descriptions en clair lui donnerait tort. Elles étaient
   inline dans les paramètres à une époque (un composant `Help`) ; l'interrupteur
   parlait alors de deux choses à la fois.

   `always` est l'exception délibérée : une bulle qui ne porte pas une
   explication — le crédit que la licence d'Open Food Facts impose, ou la bulle
   de l'interrupteur lui-même, seule porte pour rallumer les autres — ne doit
   pas disparaître avec l'interrupteur. */
function InfoBubble({ children, title, always = false }){
  const infoEnabled = useContext(InfoVisibilityContext);
  const [open, setOpen] = useState(false);
  if (!infoEnabled && !always) return null;
  return (
    <>
      <button type="button" className={`icon-btn sm info-btn ${open?'on':''}`}
              onClick={()=>setOpen(o=>!o)} aria-expanded={open}
              aria-label={open ? "Masquer l'explication" : "Plus d'infos"}>i</button>
      {/* Le cadre est toujours dans le DOM, replié à zéro : c'est ce qui permet
          de l'animer dans les deux sens (grid-template-rows 0fr → 1fr, la seule
          façon d'animer vers une hauteur automatique). Il occupe une ligne
          entière de son conteneur — d'où `flex:1 0 100%` — et pousse donc ce
          qui suit au lieu de le recouvrir. */}
      <span className={`info-panel ${open?'open':''}`} aria-hidden={!open}>
        <span className="info-panel-in">
          <span className="info-panel-box">
            {title && <span className="info-panel-t">{title}</span>}
            <span className="info-panel-b">{children}</span>
          </span>
        </span>
      </span>
    </>
  );
}
// The one gear in the app. Every "open the settings of this thing" button wears
// it — day cards, chart cards, calendar cards, grid tiles, master strips, food
// goals — so the geste is recognisable before the label is read. Defined once:
// the earlier per-call SVGs had drifted into a spoked circle that read as a sun.
function GearIcon({ size = 13 }){
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.83,3.14L7.15,1.66L8.85,1.66L9.17,3.14A5,5 0 0 1 10.61,3.74L11.88,2.91L13.09,4.12L12.26,5.39A5,5 0 0 1 12.86,6.83L14.34,7.15L14.34,8.85L12.86,9.17A5,5 0 0 1 12.26,10.61L13.09,11.88L11.88,13.09L10.61,12.26A5,5 0 0 1 9.17,12.86L8.85,14.34L7.15,14.34L6.83,12.86A5,5 0 0 1 5.39,12.26L4.12,13.09L2.91,11.88L3.74,10.61A5,5 0 0 1 3.14,9.17L1.66,8.85L1.66,7.15L3.14,6.83A5,5 0 0 1 3.74,5.39L2.91,4.12L4.12,2.91L5.39,3.74A5,5 0 0 1 6.83,3.14Z"/>
      <circle cx="8" cy="8" r="2.2"/>
    </svg>
  );
}

// The one toggle mechanism in the app: a track of buttons with a background
// that *slides* to whichever carries `.on`, measured for real in the DOM
// rather than each button independently swapping its own background. Every
// segmented control in Tracklog — Jour/Historique/Chrono, a tracker's type,
// Oui/Non — renders through this, so "the sliding one" is the only kind.
//
// Deliberately dumb: callers keep writing their own <button className={x===id?'on':''}>
// list exactly as before. Segmented only wraps them, watches its own DOM after
// each render for whichever child carries `.on`, and positions `.seg-thumb`
// under it. That's what makes migrating every existing toggle a one-line change
// instead of a rewrite: nothing about the buttons themselves has to change.
//
// Three sizes carry real, deliberate differences — not leftover drift:
//   (default) sentence-case option chips, each with its own outline — a modal's
//     "Une / jour" / "Plusieurs / jour". Long phrasing stays readable in this size.
//   compact   uppercase nav pills sharing one track — Jour/Historique/Chrono,
//     Graphes/Calendrier/Grille. Short, tracked-out labels only.
//   small     the same compact track, one notch down — rail sort, library tabs,
//     the chart density row (icon-bearing buttons welcome).
// `wrap` lets a track break onto a second line instead of overflowing.
// `scrollx` is the other answer to "too many options for one row": it keeps
// a single line and lets it scroll horizontally instead — for a short,
// exclusive choice (which meal, which mode) where a second line reads as
// broken and a dropdown would hide options that should stay one tap away.
function Segmented({ size, wrap, scrollx, className = '', children, ...rest }){
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);

  // Écrire le même rectangle qu'on tient déjà redéclenche un rendu qui
  // redéclenche cet effet — sans la garde d'égalité, une boucle infinie
  // (React coupe court avec « Maximum update depth exceeded »).
  const measure = () => {
    const track = ref.current;
    // `.on`, pas `button.on` : une option peut être autre chose qu'un bouton dès
    // qu'elle porte une saisie (la valeur cible s'écrit DANS son option, qui
    // s'élargit alors — un <input> dans un <button> ne se laisse pas taper).
    const active = track && track.querySelector(':scope > .on');
    if (!track || !active){
      setThumb(prev => prev === null ? prev : null);
      return;
    }
    // offsetLeft/Top are already relative to the nearest positioned ancestor's
    // padding box — exactly the containing block a `position:absolute` child
    // uses. Diffing two getBoundingClientRect() calls instead looked close but
    // was off by the track's own border width (the thumb landed 1px down-right
    // of the button it was supposed to sit under).
    const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
    setThumb(prev => (prev && prev.left === next.left && prev.top === next.top
      && prev.width === next.width && prev.height === next.height) ? prev : next);
    // `scrollx` : l'option choisie doit être visible sans geste — si elle
    // tombe hors de la fenêtre visible (ex. « Dîner » sélectionné par défaut,
    // rangé en bout de piste), on la ramène dans le cadre plutôt que de
    // forcer l'utilisateur à deviner qu'il faut glisser pour la voir.
    if (scrollx){
      const tb = track.getBoundingClientRect(), ab = active.getBoundingClientRect();
      if (ab.left < tb.left) track.scrollLeft -= (tb.left - ab.left) + 8;
      else if (ab.right > tb.right) track.scrollLeft += (ab.right - tb.right) + 8;
    }
  };

  useLayoutEffect(measure);

  useEffect(() => {
    const track = ref.current;
    if (!track || !window.ResizeObserver) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={`seg-track ${size ? size : ''} ${wrap ? 'wrap' : ''} ${scrollx ? 'scrollx' : ''} ${className}`} role="group" {...rest}>
      {thumb && <span className="seg-thumb" style={{
        transform: `translate(${thumb.left}px, ${thumb.top}px)`, width: thumb.width, height: thumb.height,
      }} aria-hidden="true" />}
      {children}
    </div>
  );
}

// Oui/Non is just a two-option Segmented — kept as its own component because
// callers ask for it by value/onChange, not by rendering the two buttons themselves.
function BoolPill({ value, onChange, onLabel = 'Oui', offLabel = 'Non', disabled = false }){
  return (
    <Segmented size="compact" className={disabled ? 'disabled' : ''}>
      <button type="button" className={value ? 'on' : ''} aria-pressed={value} disabled={disabled} onClick={()=>onChange(true)}>{onLabel}</button>
      <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} disabled={disabled} onClick={()=>onChange(false)}>{offLabel}</button>
    </Segmented>
  );
}
// Barre à icône — the other shared control shape, next to Segmented: one
// full-width bar carrying the main input, and exactly one round icon button
// for the second way of filling it. Two forms, and the difference is meaning,
// not decoration:
//   inset     the button sits INSIDE the bar, sharing its outline — the button
//             is another way to fill the same field (a search bar and its
//             scanner: both end up putting a product in that field).
//   detached  the button sits BESIDE the bar — the bar shows something, the
//             button acts on what it shows (a Aliments/Repas toggle and the
//             star that narrows either one to favourites).
// Sizing and the round button come from `.icon-btn`, like every other lone
// glyph in the app; only the bar shell is new.
function IconBar({ detached = false, className = '', children, buttons,
                   icon, onIcon, iconLabel, iconTitle, iconOn = false, iconDisabled = false }){
  // Un bouton reste le cas courant, et `icon`/`onIcon`… le disent le plus
  // simplement. Mais une barre `detached` peut légitimement en porter deux —
  // ils agissent tous sur ce qu'elle montre (l'étoile réduit aux favoris, le
  // second montre ou cache les vignettes) — d'où la liste, dont le cas à un
  // bouton n'est que le raccourci.
  const list = buttons || (icon
    ? [{ icon, onClick:onIcon, label:iconLabel, title:iconTitle, on:iconOn, disabled:iconDisabled }]
    : []);
  return (
    <div className={`icon-bar ${detached ? 'detached' : 'inset'} ${className}`}>
      <div className="icon-bar-field">{children}</div>
      {list.map((b, i) => (
        <button key={i} type="button" className={`icon-btn icon-bar-btn ${b.on ? 'on' : ''}`}
                onClick={b.onClick} disabled={b.disabled} aria-pressed={!!b.on}
                aria-label={b.label} title={b.title || b.label}>
          {b.icon}
        </button>
      ))}
    </div>
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
  // Un appui long qui arme le glisser ne doit pas, au relâchement, valider aussi
  // le clic de l'élément (une pastille du rail bascule le filtre au clic).
  const armedRef = useRef(false);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    setOrder(prev => {
      // Ce qu'on avait rangé à la main garde son ordre ; ce qui apparaît reprend
      // la place que la liste d'entrée lui donne. On parcourt donc `ids` et on y
      // reverse les anciens dans leur ordre à eux, les nouveaux tels quels —
      // plutôt que d'empiler les nouveaux à la fin. Sans ça, un onglet masqué
      // puis rallumé revenait en bout de barre au lieu de retrouver son créneau.
      const idsSet = new Set(ids);
      const prevSet = new Set(prev);
      const kept = prev.filter(id => idsSet.has(id));
      let k = 0;
      const next = ids.map(id => prevSet.has(id) ? kept[k++] : id);
      orderRef.current = next;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const setNodeRef = (id) => (el) => {
    if (el) nodesRef.current[id] = el; else delete nodesRef.current[id];
  };

  // Une fois le glisser armé, le doigt pilote la carte : ce blocage annule le
  // défilement que `touch-action:pan-y` autoriserait encore. Non passif, et posé
  // alors que le doigt est encore immobile — le seul moment où preventDefault
  // empêche encore un défilement de démarrer.
  const blockScroll = useRef((e) => { if (e.cancelable) e.preventDefault(); }).current;

  const handleMove = useRef((e) => {
    const id = dragIdRef.current;
    if (id == null) return;
    movedRef.current = true;
    // Le doigt (ou la souris) a bougé : c'est un glisser, et le clic qui suivra
    // le relâchement n'en est pas un. Voir `armedRef` plus haut.
    armedRef.current = true;
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
    window.removeEventListener('touchmove', blockScroll);
    // `armedRef` neutralise le clic qui suit le relâchement ; on le rend au tour
    // d'après plutôt que d'attendre le prochain pointerdown, sinon un clic qui
    // n'en est pas précédé (clavier, appel programmatique) resterait avalé.
    setTimeout(() => { armedRef.current = false; }, 0);
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

  // Au doigt, un glisser ne s'arme qu'après un appui maintenu — sinon le simple
  // fait de faire défiler la page en posant le doigt sur une carte la déplaçait.
  // Pendant l'attente on ne bloque rien : si le doigt part avant la fin, c'est
  // un défilement (ou un tap), et le glisser n'a jamais lieu. À la souris il n'y
  // a pas de défilement à confondre avec un glisser : il reste immédiat.
  const HOLD_MS = 350;
  const HOLD_SLOP = 9;   // px de tolérance : un doigt ne tient jamais parfaitement immobile
  const holdRef = useRef(null);

  const cancelHold = useRef(() => {
    if (holdRef.current?.timer) clearTimeout(holdRef.current.timer);
    if (holdRef.current?.cleanup) holdRef.current.cleanup();
    holdRef.current = null;
  }).current;

  // `armed` = ce geste a déjà consommé le clic à venir. C'est vrai d'un appui
  // long au doigt dès qu'il a tenu (le relâcher ne doit rien déclencher d'autre),
  // mais pas d'un simple clic de souris : à la souris, le glisser s'arme dès le
  // pointerdown, et considérer tout de suite le clic comme avalé rendait muettes
  // les pastilles du rail — cliquer pour filtrer ne faisait plus rien. Le clic ne
  // devient un glisser qu'à partir du moment où ça bouge (voir handleMove).
  const beginDrag = (id, x, y, armed = false) => {
    dragIdRef.current = id;
    movedRef.current = false;
    startRef.current = { x, y };
    insRef.current = Math.max(0, orderRef.current.indexOf(id));
    setDragId(id);
    armedRef.current = armed;
    document.body.classList.add('dragging-reorder');
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('touchmove', blockScroll, { passive: false });
  };

  const startDrag = (id) => (e) => {
    if (e.button != null && e.button !== 0) return;
    armedRef.current = false;
    if (e.pointerType !== 'touch'){
      // preventDefault empêche la sélection de texte pendant le glisser.
      if (e.cancelable) e.preventDefault();
      beginDrag(id, e.clientX, e.clientY);
      return;
    }

    // Ni preventDefault ni écouteur bloquant ici : le navigateur doit rester
    // libre de faire défiler tant que l'appui n'a pas tenu.
    cancelHold();
    const x0 = e.clientX, y0 = e.clientY;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - x0) > HOLD_SLOP || Math.abs(ev.clientY - y0) > HOLD_SLOP) cancelHold();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cancelHold);
      window.removeEventListener('pointercancel', cancelHold);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', cancelHold);
    window.addEventListener('pointercancel', cancelHold);
    holdRef.current = {
      cleanup,
      timer: setTimeout(() => {
        cleanup();
        holdRef.current = null;
        // Une petite vibration dit « c'est attrapé » — sans elle, rien ne
        // distingue un appui trop court d'un appui assez long.
        try { navigator.vibrate?.(12); } catch {}
        beginDrag(id, x0, y0, true);
      }, HOLD_MS),
    };
  };

  // Un démontage en pleine attente laisserait le minuteur armer un glisser sur
  // une carte qui n'est plus là.
  useEffect(() => cancelHold, [cancelHold]);

  // Without a reorder handler (the list is under an automatic sort) dragging would
  // fight the sort, so hand back inert controls: `startDrag` yielding null also
  // removes the grip, since cards only draw one when given a handler.
  if (!onReorder) return { order: ids, dragId: null, setNodeRef: () => undefined, startDrag: () => null, wasArmed: () => false };
  return { order, dragId, setNodeRef, startDrag, wasArmed: () => armedRef.current };
}

// Small grip handle that starts a drag. Kept separate from the rest of a
// card so it never steals clicks from buttons/inputs inside it.
function DragHandle({ onPointerDown, dragging }){
  return (
    <span className={`drag-handle ${dragging?'dragging':''}`} onPointerDown={onPointerDown} aria-label="Réordonner" title="Maintenir puis glisser pour réordonner">
      <svg width="9" height="15" viewBox="0 0 9 15"><circle cx="2.2" cy="2.2" r="1"/><circle cx="6.8" cy="2.2" r="1"/><circle cx="2.2" cy="7.5" r="1"/><circle cx="6.8" cy="7.5" r="1"/><circle cx="2.2" cy="12.8" r="1"/><circle cx="6.8" cy="12.8" r="1"/></svg>
    </span>
  );
}
// Une pastille de saisie numérique — la même `.pill` que le rail et les
// nuanciers de couleur, pour que la valeur cible et l'échelle ne soient plus
// les seules boîtes à bordure carrée de la page. Le comportement (parsing,
// bornes) reste entièrement à l'appelant : ceci n'habille qu'un input.
/* Le nuancier de l'app : les neutres en tête, puis les quatre paliers de
   luminosité des douze teintes. Un seul composant pour la couleur d'un tracker
   et pour l'accent de l'app — ce sont les mêmes couleurs, choisies de la même
   façon, et deux grilles jumelles auraient dérivé l'une de l'autre.
   `extra` ajoute une pastille au bout (« la couleur de Tracklog » dans les
   paramètres) sans que la grille ait à connaître ce qu'elle veut dire. */
function SwatchGrid({ value, onChange }){
  const [editing, setEditing] = useState(false);
  const custom = value && !COLORS.includes(value);
  return (
    <div className="swatch-grid">
      <div className="swatch-row">
        {COLORS.map(c => (
          <button key={c} type="button" className={`swatch ${value===c?'on':''}`} style={{background:c}}
                  onClick={()=>{ onChange(c); setEditing(false); }} aria-label={`Couleur ${c}`} />
        ))}
        {/* Le « + » est un rond comme les autres : dix ronds font une ligne, un
            bouton d'une autre forme au bout en ferait neuf et un intrus. */}
        <button type="button" className={`swatch swatch-custom ${editing||custom?'open':''}`}
                onClick={()=>setEditing(v=>!v)} aria-expanded={editing}
                style={custom ? { background:value } : undefined}
                title={custom ? 'Couleur personnalisée' : 'Composer une couleur'}
                aria-label={custom ? 'Couleur personnalisée' : 'Composer une couleur'}>
          {!custom && '+'}
        </button>
      </div>
      {editing && <ColorEditor value={value} onChange={onChange} />}
    </div>
  );
}

/* L'éditeur : trois curseurs pour composer n'importe quelle couleur, plus la
   pipette du système pour en coller une exacte. Les curseurs parlent OKLCH
   comme le reste du nuancier — c'est ce qui fait qu'une teinte déplacée garde
   la même intensité perçue, ce que HSL ne promet pas. La pipette, elle, rend un
   hexadécimal : on le garde tel quel, une couleur reste une chaîne CSS. */
function ColorEditor({ value, onChange }){
  const parsed = useMemo(() => {
    const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value || '');
    return m ? { l:parseFloat(m[1]), c:parseFloat(m[2]), h:parseFloat(m[3]) }
             : { l:COLOR_LIGHT, c:COLOR_CHROMA, h:35 };
  }, [value]);
  const [hsl, setHsl] = useState(parsed);
  // Une pastille cliquée pendant que l'éditeur est ouvert doit y être reprise,
  // sinon le premier mouvement de curseur repartirait de l'ancienne couleur.
  const seen = useRef(value);
  if (seen.current !== value){ seen.current = value; if (parsed.h !== hsl.h || parsed.l !== hsl.l || parsed.c !== hsl.c) setHsl(parsed); }

  const emit = (next) => { setHsl(next); onChange(`oklch(${next.l.toFixed(2)} ${next.c.toFixed(3)} ${Math.round(next.h)})`); };
  const track = (kind) => {
    if (kind === 'h') return 'linear-gradient(to right,' + [0,60,120,180,240,300,360].map(h=>`oklch(${COLOR_LIGHT} ${COLOR_CHROMA} ${h})`).join(',') + ')';
    if (kind === 'c') return `linear-gradient(to right, oklch(${hsl.l} 0 ${hsl.h}), oklch(${hsl.l} 0.37 ${hsl.h}))`;
    return `linear-gradient(to right, oklch(0 0 0), oklch(${hsl.l.toFixed(2)} ${hsl.c} ${hsl.h}), oklch(1 0 0))`;
  };
  const row = (kind, label, min, max, step, val) => (
    <label className="ce-row">
      <span className="ce-lab">{label}</span>
      <input type="range" min={min} max={max} step={step} value={val}
             style={{'--track': track(kind)}}
             onChange={e=>emit({ ...hsl, [kind === 'h' ? 'h' : kind === 'c' ? 'c' : 'l']: parseFloat(e.target.value) })} />
      <span className="ce-val mono">{kind === 'h' ? `${Math.round(val)}°` : Math.round(val * 100) + '%'}</span>
    </label>
  );

  return (
    <div className="color-editor">
      <div className="ce-preview" style={{background:value}} aria-hidden="true"></div>
      <div className="ce-rows">
        {row('h', 'Teinte',     0, 360, 1,    hsl.h)}
        {row('c', 'Saturation', 0, 0.37, 0.005, hsl.c)}
        {row('l', 'Luminosité', 0, 1,   0.01, hsl.l)}
        <label className="ce-row ce-hex">
          <span className="ce-lab">Pipette</span>
          <span className="ce-val">une couleur exacte</span>
          <input type="color" onChange={e=>onChange(e.target.value)} aria-label="Choisir une couleur exacte" />
        </label>
      </div>
    </div>
  );
}
function NumPill({ label, value, onChange, unit, placeholder, min, style }){
  return (
    <label className="pill num-pill" style={style}>
      <span className="np-lab">{label}</span>
      <input type="number" step="any" min={min} value={value} placeholder={placeholder} onChange={onChange} />
      {unit && <span className="np-unit">{unit}</span>}
    </label>
  );
}


/* ============================================================
   Préférences de compte — user_settings
   ------------------------------------------------------------
   Un seul blob jsonb par compte, et c'est lui qui fait autorité :
   Tracklog se vit sur un téléphone ET sur un PC, donc un réglage
   posé d'un côté doit se retrouver de l'autre. Style, bulles
   d'aide, numéro de semaine, interrupteur caméra, ordre et
   visibilité des onglets — tout ça suit le compte.

   localStorage reste, mais comme miroir, pas comme source : il
   sert à afficher le bon réglage AVANT que la base ait répondu
   (le style est même lu par un script en tête de page, avant
   que l'app existe) et à ne pas perdre la main si user_settings
   est injoignable. Voir useSyncedPref juste en dessous.

   Ce qui reste vraiment local : les chronos, qui sont un état de
   travail en cours sur cet appareil-là, pas un réglage.

   Écriture optimiste : l'état local part devant, la base suit.
   Un réglage d'affichage qui attend le réseau donne une app
   qui colle, et l'échec n'y coûte qu'un rechargement.
   ============================================================ */
// Le contexte porte { prefs, savePrefs } jusqu'aux composants trop loin dans
// l'arbre pour qu'on leur passe le réglage à la main — au premier chef le
// scanner de la page Food, qui vit à trois modales de App.
const AccountPrefsContext = React.createContext(null);
// Hors de tout Provider (un composant monté seul dans un test), un réglage
// reste utilisable : il ne fait que ne pas se synchroniser. L'objet est stable
// pour ne pas invalider les mémos qui en dépendent à chaque rendu.
const LOCAL_ONLY_PREFS = { prefs: {}, savePrefs: () => {} };
function useAccountPrefs(userId){
  const [prefs, setPrefs] = useState(null);   // null = pas encore chargé
  // Un réglage touché avant que la base ait répondu ne doit pas partir seul :
  // le blob est écrit en entier, l'envoyer avec un objet vide effacerait tout le
  // reste (les onglets, en premier). On retient donc ce qui a été changé et on
  // le rejoue par-dessus ce qui arrive.
  const pendingRef = useRef(null);

  const write = useCallback((next) => {
    supabase.from('user_settings')
      .upsert({ user_id: userId, prefs: next, updated_at: Date.now() })
      .then(({ error }) => { if (error) console.warn('user_settings', error.message); });
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('user_settings').select('*').maybeSingle();
      if (cancelled) return;
      // Table absente (migration pas encore passée) : on tourne sur les valeurs
      // par défaut plutôt que de bloquer toute l'app sur un réglage d'affichage.
      const loaded = (!error && data && data.prefs) ? data.prefs : {};
      const pending = pendingRef.current;
      pendingRef.current = null;
      const next = pending ? { ...loaded, ...pending } : loaded;
      setPrefs(next);
      if (pending) write(next);
    })();
    return () => { cancelled = true; };
  }, [userId, write]);

  const savePrefs = useCallback(async (patch) => {
    setPrefs(prev => {
      if (prev === null){
        // Pas encore chargé : on garde le changement de côté, l'effet ci-dessus
        // le posera sur les valeurs du compte dès qu'elles arriveront.
        pendingRef.current = { ...(pendingRef.current || {}), ...patch };
        return prev;
      }
      const next = { ...prev, ...patch };
      write(next);
      return next;
    });
  }, [write]);

  // L'onglet « Bouffe » s'appelle « Food » depuis, mais sa préférence est déjà
  // enregistrée sous l'ancienne clé sur les comptes existants : on la relit sous
  // ce nom avant d'appliquer la nouvelle, pour qu'un onglet masqué le reste.
  const stored = (prefs && prefs.tabs) || {};
  const legacy = stored.bouffe !== undefined && stored.food === undefined
    ? { food: stored.bouffe } : null;
  const tabs = { ...DEFAULT_TABS, ...stored, ...legacy };
  const setTab = (id, on) => savePrefs({ tabs: { ...tabs, [id]: on } });

  // L'ordre des onglets : les ids connus, dans l'ordre enregistré, suivis de
  // ceux qui n'y sont pas encore (un onglet ajouté par une mise à jour se range
  // à sa place par défaut plutôt que de disparaître).
  const storedOrder = Array.isArray(prefs && prefs.tabOrder) ? prefs.tabOrder : [];
  const known = NAV_TABS.map(t => t.id);
  const tabOrder = [...storedOrder.filter(id => known.includes(id)),
                    ...known.filter(id => !storedOrder.includes(id))];
  const setTabOrder = (order) => savePrefs({ tabOrder: order });

  return { ready: prefs !== null, prefs: prefs || {}, savePrefs, tabs, setTab, tabOrder, setTabOrder };
}

/* ---- Un réglage qui suit le compte, avec miroir local ----------------------
   Le compte fait autorité, mais il arrive après le premier rendu : tant qu'il
   n'a pas répondu, on affiche la dernière valeur connue sur cet appareil plutôt
   qu'un défaut arbitraire — sinon chaque ouverture montrerait brièvement le
   mauvais réglage, ce qui se lit comme un bug plutôt que comme un chargement.
   Quand la réponse arrive, c'est elle qui gagne, et le miroir se met à jour. */
function useSyncedPref(accountPrefs, key, storageKey, fallback, isValid = () => true){
  const read = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return fallback;
      const v = typeof fallback === 'boolean' ? raw === '1' : raw;
      return isValid(v) ? v : fallback;
    } catch { return fallback; }
  };
  const [local, setLocal] = useState(read);
  const remote = accountPrefs.prefs ? accountPrefs.prefs[key] : undefined;
  const valid = remote !== undefined && typeof remote === typeof fallback && isValid(remote);
  const value = valid ? remote : local;

  useEffect(() => {
    try { localStorage.setItem(storageKey, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)); } catch {}
  }, [value, storageKey]);

  const set = useCallback((v) => {
    setLocal(v);
    accountPrefs.savePrefs({ [key]: v });
  }, [accountPrefs, key]);

  return [value, set];
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
  const [tab, setTab] = useState('log');        // log | food | vues | training | parametres
  const accountPrefs = useAccountPrefs(userId);
  const [logSub, setLogSub] = useState('jour'); // jour | historique | chrono — sub-sections of Log
  const [foodSub, setFoodSub] = useState('jour'); // jour | aliments | vues — sub-sections of Food
  // La nutrition a son propre magasin (foods / food_logs / objectifs), chargé ici
  // une seule fois : la page Food et les compteurs du Jour lisent la même chose.
  const food = useFoodStore(userId);
  // Les chronos suivent le compte, pas l'appareil : démarré sur PC, un chrono
  // doit se voir démarré sur téléphone. `chronos` table + canal Realtime — un
  // chrono qui tourne pousse son horodatage de départ aux autres appareils
  // connectés, le décompte affiché reste calculé localement comme avant
  // (`chronoElapsed`, un `setInterval` par appareil), seul l'instant de départ
  // voyage. Chargement + abonnement une fois par compte.
  const [chronos, setChronos] = useState([]);
  useEffect(() => {
    let cancelled = false;
    supabase.from('chronos').select('*').then(({ data, error }) => {
      if (!cancelled && !error && data) setChronos(data.map(chronoFromRow).sort((a,b)=>(a.order||0)-(b.order||0)));
    });
    const channel = supabase.channel(`chronos:${userId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'chronos', filter:`user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === 'DELETE'){
          setChronos(s => s.filter(c => c.id !== payload.old.id));
          return;
        }
        const row = chronoFromRow(payload.new);
        setChronos(s => s.some(c => c.id === row.id) ? s.map(c => c.id === row.id ? row : c) : [...s, row]);
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [userId]);
  // Écriture optimiste, comme le reste de l'app : l'état local est déjà posé
  // par l'appelant, celle-ci ne fait qu'envoyer derrière. Un échec reste
  // silencieux ici — jamais critique (un chrono se relance), contrairement à
  // un objectif ou un repas qu'on croirait enregistré à tort.
  const writeChrono = (c) => {
    supabase.from('chronos').upsert(chronoToRow(c, userId)).then(({ error }) => {
      if (error) console.error('tracklog: chrono non synchronisé —', error);
    });
  };
  // Whether starting a chrono pauses every other one — a per-device preference,
  // not data, so it lives next to the chronos themselves in localStorage.
  const exclusiveKey = `tracklog.chronoExclusive.${userId}`;
  const [chronoExclusive, setChronoExclusive] = useState(() => {
    try { return localStorage.getItem(exclusiveKey) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(exclusiveKey, chronoExclusive ? '1' : '0'); } catch {}
  }, [chronoExclusive, exclusiveKey]);
  // Les explications (bulles « i » et descriptions sous les réglages) et le numéro
  // de semaine suivent le compte : ils décrivent comment on veut lire l'app, et on
  // la lit sur plusieurs appareils. Le miroir local sert l'affichage immédiat.
  const [infoEnabled, setInfoEnabled] = useSyncedPref(accountPrefs, 'help', `tracklog.infoEnabled.${userId}`, true);
  const [showWeek, setShowWeek] = useSyncedPref(accountPrefs, 'showWeek', 'tracklog.showWeek', true);
  // La barre de composition des cartes d'aliment : lue ici pour le réglage, et
  // relue par app.food.jsx via le contexte, là où les cartes se dessinent.
  const [compBar, setCompBar] = useSyncedPref(accountPrefs, 'compBar', 'tracklog.compBar', true);
  // Le style est lu par un petit script en tête de page, avant même que l'app
  // charge, pour que la page ne clignote jamais dans les mauvaises couleurs — ce
  // script ne peut pas savoir quel compte se connecte, d'où une clé non scopée par
  // utilisateur. Le compte reste la référence : quand il répond, il corrige
  // l'appareil. `document.documentElement.dataset.theme` est ce que lit le CSS.
  const [theme, setTheme] = useSyncedPref(accountPrefs, 'theme', 'tracklog.theme', DEFAULT_STYLE, isStyle);
  useEffect(() => {
    try {
      document.documentElement.dataset.theme = theme;
      const meta = document.querySelector('meta[name="theme-color"]');
      const style = STYLES.find(s => s.id === theme);
      if (meta && style) meta.setAttribute('content', style.themeColor);
    } catch {}
  }, [theme]);
  // La couleur d'accent, à côté du style : le style choisit le fond et l'encre,
  // l'accent choisit ce qui ressort dessus. Chaîne vide = celle de Tracklog.
  // Même mécanique que le style, jusqu'au script en tête de page (window.applyAccent)
  // qui la pose avant le premier rendu — sinon toute l'app clignoterait en orange
  // avant de passer à la couleur choisie.
  const [accent, setAccent] = useSyncedPref(accountPrefs, 'accent', 'tracklog.accent', '');
  useEffect(() => { try { window.applyAccent(accent); } catch {} }, [accent]);
  // Multi-select filter for the rail. `selectedIds` is the remembered set;
  // `showAll` temporarily overrides it (the "Tout" toggle) while keeping the
  // set intact (shown greyed) so it isn't lost.
  //
  // Le filtre survit au rechargement : il décrit sur quoi on travaille en ce
  // moment, et le perdre à chaque ouverture obligeait à le reposer à la main.
  // Il reste par appareil — on ne filtre pas la même chose sur le téléphone que
  // sur le PC — donc localStorage plutôt que le compte, comme les chronos.
  const filterKey = `tracklog.filter.${userId}`;
  const savedFilter = useMemo(() => {
    try {
      const raw = localStorage.getItem(`tracklog.filter.${session.user.id}`);
      const v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedIds, setSelectedIds] = useState(
    () => Array.isArray(savedFilter.selectedIds) ? savedFilter.selectedIds : []);
  const [showAll, setShowAll] = useState(() => savedFilter.showAll !== false);
  // Filtres, tri et groupe démarrent chacun replié — ce sont des réglages
  // occasionnels, et sur téléphone un panneau ouvert pousse les cartes du jour
  // sous la ligne de flottaison. Chacun se rouvre en revanche s'il l'était :
  // c'est là qu'on voit le réglage actif.
  const [filterOpen, setFilterOpen] = useState(() => savedFilter.filterOpen === true);
  const [sortOpen, setSortOpen] = useState(() => savedFilter.sortOpen === true);
  const [groupOpen, setGroupOpen] = useState(() => savedFilter.groupOpen === true);
  const [sortMode, setSortMode] = useState(
    () => SORTS.some(s => s.id === savedFilter.sortMode) ? savedFilter.sortMode : 'manuel');
  const [groupMode, setGroupMode] = useState(
    () => GROUPS.some(g => g.id === savedFilter.groupMode) ? savedFilter.groupMode : 'type');
  // L'ordre des SECTIONS du Jour (masters / quotidiens / plusieurs / alimentation
  // en groupement Type ; masters / une couleur par section / alimentation en
  // Couleur ; masters / fait / pas fait / alimentation en Fait) — un ordre par
  // mode de groupement, parce que « couleur » n'a pas les mêmes clés que
  // « type ». `mergeSectionOrder` (même logique que `mergeSubOrder` pour les
  // trackers) recale les clés disparues et ajoute les nouvelles en fin de liste.
  const [sectionOrders, setSectionOrders] = useState(() => {
    const v = savedFilter.sectionOrders;
    return v && typeof v === 'object' ? v : {};
  });
  useEffect(() => {
    try {
      localStorage.setItem(filterKey, JSON.stringify(
        { selectedIds, showAll, filterOpen, sortOpen, groupOpen, sortMode, groupMode, sectionOrders }));
    } catch {}
  }, [filterKey, selectedIds, showAll, filterOpen, sortOpen, groupOpen, sortMode, groupMode, sectionOrders]);
  const reorderSections = (mode, newOrder) =>
    setSectionOrders(prev => ({ ...prev, [mode]: newOrder }));
  // Un tracker supprimé (ou archivé) depuis un autre appareil laisserait son id
  // dans le filtre restauré, qui ne filtrerait plus rien de visible. On purge
  // une fois les trackers chargés — pas avant, ils sont vides le temps de la
  // requête et ça effacerait le filtre à chaque ouverture.
  useEffect(() => {
    if (loading) return;
    setSelectedIds(prev => {
      const alive = new Set(trackers.filter(t => !t.archived).map(t => t.id));
      const next = prev.filter(id => alive.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [loading, trackers]);
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
    const nextOrder = chronos.length ? Math.max(...chronos.map(c => c.order || 0)) + 1 : 0;
    const c = { id: uid('c_'), label, trackerId: trackerId || null, accumulatedMs: 0, startedAt: null, order: nextOrder };
    setChronos(s => [...s, c]);
    writeChrono(c);
  };
  const startChrono = (id) => {
    const now = Date.now();
    const touched = [];
    setChronos(s => s.map(c => {
      if (c.id === id){
        if (c.startedAt) return c;
        const next = { ...c, startedAt: now };
        touched.push(next);
        return next;
      }
      // In exclusive mode, starting one banks and stops whichever other was running —
      // same accounting as a manual pause, just triggered on the other chrono's behalf.
      if (chronoExclusive && c.startedAt){
        const next = { ...c, accumulatedMs: chronoElapsed(c, now), startedAt: null };
        touched.push(next);
        return next;
      }
      return c;
    }));
    touched.forEach(writeChrono);
  };
  // Pausing banks the running segment, so elapsed time never depends on render timing.
  const pauseChrono = (id) => {
    const now = Date.now();
    let touched = null;
    setChronos(s => s.map(c => {
      if (c.id !== id || !c.startedAt) return c;
      touched = { ...c, accumulatedMs: chronoElapsed(c, now), startedAt: null };
      return touched;
    }));
    if (touched) writeChrono(touched);
  };
  const resetChrono = (id) => {
    let touched = null;
    setChronos(s => s.map(c => {
      if (c.id !== id) return c;
      touched = { ...c, accumulatedMs: 0, startedAt: null };
      return touched;
    }));
    if (touched) writeChrono(touched);
  };
  // Bulk action: stops and zeroes every chrono on the board at once.
  const resetAllChronos = () => {
    const touched = [];
    setChronos(s => s.map(c => { const next = { ...c, accumulatedMs: 0, startedAt: null }; touched.push(next); return next; }));
    touched.forEach(writeChrono);
  };
  const removeChrono = (id) => {
    setChronos(s => s.filter(c => c.id !== id));
    supabase.from('chronos').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('tracklog: suppression du chrono refusée —', error);
    });
  };
  const updateChrono = (id, patch) => {
    let touched = null;
    setChronos(s => s.map(c => { if (c.id !== id) return c; touched = { ...c, ...patch }; return touched; }));
    if (touched) writeChrono(touched);
  };
  // Même mécanique que le réordonnancement des trackers, mais sur une poignée
  // de chronos plutôt que sur un ordre global à préserver ailleurs : l'ordre
  // reçu EST le nouvel ordre complet, pas un sous-ensemble à recoller.
  const reorderChronos = (newOrder) => {
    const orderMap = Object.fromEntries(newOrder.map((id, i) => [id, i]));
    const touched = [];
    setChronos(s => s.map(c => {
      const o = orderMap[c.id];
      if (o == null || o === c.order) return c;
      const next = { ...c, order: o };
      touched.push(next);
      return next;
    }));
    touched.forEach(writeChrono);
  };
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
  // Archived trackers have no card anywhere to carry a gear icon — this list is
  // now their only way back, via Paramètres → Archives.
  const archivedTrackers = trackers.filter(t => t.archived);

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

  // The tracker filter rail is available on every tracker tab (Log, Vues).
  // Not on Food: it filters trackers, and the food page has none.
  const showRail = tab === 'log' || tab === 'vues';

  // Masquer l'onglet sur lequel on se tient laisserait un écran blanc : la vue
  // retombe sur le premier onglet encore affiché, et sur les paramètres s'il
  // n'en reste aucun — le seul écran qui ne se masque jamais, puisque c'est de
  // là qu'on rallume les autres.
  const visibleTabs = accountPrefs.tabs;
  const shownTabs = NAV_TABS.filter(t => visibleTabs[t.id] !== false);
  const fallbackTab = (accountPrefs.tabOrder.find(id => shownTabs.some(t => t.id === id))
                      || shownTabs[0]?.id || 'parametres');
  const activeTab = (tab !== 'parametres' && visibleTabs[tab] === false) ? fallbackTab : tab;

  return (
    <AccountPrefsContext.Provider value={accountPrefs}>
    <InfoVisibilityContext.Provider value={infoEnabled}>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark"></span>
          <h1>Tracklog</h1>
          <span className="by serif">— suivez n'importe quoi.</span>
        </div>
        <div className="topbar-actions">
          <TabBar
            tabs={shownTabs}
            order={accountPrefs.tabOrder}
            activeTab={activeTab}
            onSelect={setTab}
            onReorder={accountPrefs.setTabOrder}
          />
          <button
            className={`gear-btn ${activeTab==='parametres'?'active':''}`}
            onClick={()=>setTab('parametres')}
            aria-label="Paramètres"
            title="Paramètres"
          >
            <GearIcon size={14} />
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
          filterOpen={filterOpen}
          onToggleFilterOpen={()=>setFilterOpen(v=>!v)}
          sortMode={sortMode}
          onSortMode={setSortMode}
          sortOpen={sortOpen}
          onToggleSortOpen={()=>setSortOpen(v=>!v)}
          groupMode={groupMode}
          onGroupMode={setGroupMode}
          groupOpen={groupOpen}
          onToggleGroupOpen={()=>setGroupOpen(v=>!v)}
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
          onReorderChronos={reorderChronos}
          chronoExclusive={chronoExclusive}
          onSetChronoExclusive={setChronoExclusive}
          onRemoveChrono={removeChrono}
          onSaveChrono={saveChronoAsEntry}
          onUpdateChrono={updateChrono}
          foodSummary={(filterActive || !visibleTabs.food) ? null : <FoodDaySummary store={food} onOpen={()=>setTab('food')} />}
          historyJump={historyJump}
          onAddTracker={()=>setNewTrackerOpen(true)}
          onEditTracker={(t)=>setEditTracker(t)}
          showWeek={showWeek}
          groupMode={groupMode}
          sectionOrder={sectionOrders[groupMode]}
          onReorderSections={(next)=>reorderSections(groupMode, next)}
        />
      ) : activeTab === 'food' ? (
        <FoodPage store={food} sub={foodSub} onSub={setFoodSub} />
      ) : activeTab === 'training' ? (
        <TrainingView />
      ) : activeTab === 'analyst' ? (
        <AnalystView />
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
          showWeek={showWeek}
          onSetShowWeek={setShowWeek}
          theme={theme}
          onSetTheme={setTheme}
          accent={accent}
          onSetAccent={setAccent}
          compBar={compBar}
          onSetCompBar={setCompBar}
          tabs={visibleTabs}
          onSetTabVisible={accountPrefs.setTab}
          tabOrder={accountPrefs.tabOrder}
          onSetTabOrder={accountPrefs.setTabOrder}
          prefsReady={accountPrefs.ready}
          archivedTrackers={archivedTrackers}
          onEditTracker={(t)=>setEditTracker(t)}
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
    </AccountPrefsContext.Provider>
  );
}

/* ============================================================
   Settings — account actions (password, sign-out) merged with
   display preferences (info bubbles), one place instead of two
   loose top-bar buttons.
   ============================================================ */
function SettingsView({ userId, email, onChangePassword, onSignOut, infoEnabled, onSetInfoEnabled,
                       showWeek, onSetShowWeek, theme, onSetTheme, accent, onSetAccent,
                       compBar, onSetCompBar,
                       tabs, onSetTabVisible, prefsReady,
                       tabOrder = [], onSetTabOrder = () => {},
                       archivedTrackers = [], onEditTracker }){
  return (
    <div className="settings-view">
      <p className="section-label" style={{margin:'0 0 16px'}}>Paramètres</p>

      <div className="card settings-card">
        <p className="settings-section-title">Compte</p>
        <div className="field spread">
          <label>Connecté</label>
          <span className="settings-value">{email}</span>
        </div>
        <div className="field spread">
          <label>Mot de passe</label>
          <button className="account-btn" onClick={onChangePassword}>Changer</button>
        </div>
        <div className="field spread" style={{borderBottom:'none'}}>
          <label>Session</label>
          <button className="account-btn" onClick={onSignOut}>Déconnexion</button>
        </div>
      </div>

      <div className="card settings-card">
        <p className="settings-section-title">
          Style
          <InfoBubble title="Style">
            Le style suit le compte : choisi sur le téléphone, il s'applique aussi sur
            l'ordinateur. D'autres viendront s'ajouter à cette liste.
          </InfoBubble>
        </p>
        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10}}>
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
        {/* Le style choisit le fond et l'encre ; l'accent choisit ce qui ressort
            dessus. Le même nuancier que la couleur d'un tracker — ce sont les
            mêmes couleurs, il n'y a pas de raison d'en inventer une seconde
            grille — plus une pastille pour revenir à celle de Tracklog. */}
        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,borderBottom:'none'}}>
          <label className="lab-info" style={{width:'auto'}}>
            Couleur d'accent
            <InfoBubble title="Couleur d'accent">
              La couleur des boutons, des liens et de tout ce qui doit attirer l'œil.
              La première pastille remet celle de Tracklog. Comme le style, elle suit le
              compte : posée sur le téléphone, elle est là sur l'ordinateur.
            </InfoBubble>
          </label>
          {/* Pas de pastille « défaut » à part : la teinte 35 du nuancier EST
              l'orange de Tracklog, alors la choisir remet simplement l'app à sa
              couleur d'origine — une pastille de plus, presque identique à sa
              voisine, n'aurait dit qu'une seule chose de deux façons. */}
          <SwatchGrid value={accent || TRACKLOG_ACCENT}
                      onChange={c => onSetAccent(c === TRACKLOG_ACCENT ? '' : c)} />
        </div>
      </div>

      <TabsSettingsCard
        tabs={tabs}
        onSetTabVisible={onSetTabVisible}
        tabOrder={tabOrder}
        onSetTabOrder={onSetTabOrder}
        prefsReady={prefsReady}
      />

      <div className="card settings-card">
        <p className="settings-section-title">Affichage</p>
        <div className="field spread">
          <label>Bulles infos</label>
          <div className="ctl-with-info">
            {/* Oui / Non, pas « Affichées / Masquées » : la carte s'appelle déjà
                Affichage, et les mots longs renvoyaient la bascule à la ligne. */}
            <BoolPill value={infoEnabled} onChange={onSetInfoEnabled} />
            {/* La seule bulle qui ne se masque pas : c'est elle qui dit comment
                rallumer les autres, elle ne peut pas partir avec elles. */}
            <InfoBubble title="Bulles infos" always>
              Les petits « i » posés à côté des réglages, ici et partout dans l'app :
              chacun ouvre son explication quand on le tape. Masquez-les une fois l'app
              bien en main — les explications partent avec eux, et ce réglage-ci garde
              sa bulle dans tous les cas.
            </InfoBubble>
          </div>
        </div>
        <div className="field spread">
          <label>Numéro de semaine</label>
          <div className="ctl-with-info">
            <BoolPill value={showWeek} onChange={onSetShowWeek} />
            <InfoBubble title="Numéro de semaine">À côté de la date du jour, dans le Log et l'Historique.</InfoBubble>
          </div>
        </div>
        <div className="field spread" style={{borderBottom:'none'}}>
          <label>Barre de composition</label>
          <div className="ctl-with-info">
            <BoolPill value={compBar} onChange={onSetCompBar} />
            <InfoBubble title="Barre de composition">
              Sur chaque carte d'aliment de la page Food, une barre qui découpe ses calories en
              <span className="k"> protéines, glucides et lipides</span> — et qui colore ses chiffres.
              Un blanc de poulet est presque tout rouge, des flocons presque tout bleu : la nature de
              l'aliment se lit avant son nom. Masquée, la carte reste la même en plus court.
            </InfoBubble>
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <p className="settings-section-title">
          Archives
          {archivedTrackers.length > 0 && (
            <InfoBubble title="Archives">Ouvre les réglages du tracker pour le désarchiver ou le supprimer.</InfoBubble>
          )}
        </p>
        {!archivedTrackers.length ? (
          <p className="settings-hint" style={{marginTop:0}}>
            Aucun tracker archivé. Archiver un tracker le retire du Log sans supprimer ses
            entrées — il atterrit ici, prêt à être désarchivé.
          </p>
        ) : (
          <div className="archive-list">
            {archivedTrackers.map(t => (
              <button key={t.id} className="archive-row" onClick={()=>onEditTracker(t)}>
                {isMaster(t)
                  ? <span className="master-mark" style={{background:t.color}}></span>
                  : <span className="dot" style={{background:t.color}}></span>}
                <span className="archive-name">{t.name}</span>
                <span className="archive-type">{isMaster(t) ? 'master' : (TYPES.find(x=>x.id===t.type)?.label || t.type)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <FeedbackCard userId={userId} />
    </div>
  );
}

/* ---- Paramètres › Onglets -------------------------------------------------
   La même liste répond aux deux questions qu'on se pose sur un onglet — est-ce
   que je le veux, et où — plutôt que de ranger l'ordre dans un écran et la
   visibilité dans un autre. On y réordonne à la poignée (souris) ou en
   maintenant l'appui (doigt), exactement comme dans la barre du haut, et ce que
   l'on fait ici se voit là-bas immédiatement.
   Toutes les lignes se comportent pareil, « Log » compris : une exception au
   milieu d'une liste d'objets identiques se lit comme une panne, pas comme une
   règle. Les paramètres n'y figurent pas — ce n'est pas un onglet mais
   l'engrenage du bout de barre, et c'est de là qu'on rallume ce qu'on a éteint. */
function TabsSettingsCard({ tabs, onSetTabVisible, tabOrder, onSetTabOrder, prefsReady }){
  const byId = useMemo(() => Object.fromEntries(NAV_TABS.map(t => [t.id, t])), []);
  const hints = useMemo(() => Object.fromEntries(TOGGLEABLE_TABS.map(t => [t.id, t.hint])), []);
  const { order, dragId, startDrag, setNodeRef } = useDragReorder(tabOrder, onSetTabOrder);

  return (
    <div className="card settings-card">
      <p className="settings-section-title">
        Onglets
        <InfoBubble title="Onglets">
          Masquer un onglet ne supprime rien : les données restent, l'onglet disparaît de la
          barre du haut. Glissez une ligne pour changer l'ordre de cette barre — au doigt,
          maintenez d'abord l'appui. Visibilité comme ordre suivent le compte, pas l'appareil :
          la barre est la même sur le téléphone et sur l'ordinateur. Tout masquer est permis —
          il reste cet engrenage pour revenir ici.
        </InfoBubble>
      </p>
      {!prefsReady && <p className="settings-hint" style={{marginTop:0}}>Chargement…</p>}

      {order.map(id => {
        const t = byId[id];
        if (!t) return null;
        return (
          <div className="field spread" key={id} ref={setNodeRef(id)}>
            <label className="label-drag">
              <DragHandle onPointerDown={startDrag(id)} dragging={dragId===id} />
              <span>{t.label}</span>
            </label>
            <div className="ctl-with-info">
              <Segmented size="small" scrollx>
                <button className={tabs[id] !== false ? 'on' : ''} onClick={()=>onSetTabVisible(id, true)}>Affiché</button>
                <button className={tabs[id] === false ? 'on' : ''} onClick={()=>onSetTabVisible(id, false)}>Masqué</button>
              </Segmented>
              <InfoBubble title={t.label}>{hints[id]}</InfoBubble>
            </div>
          </div>
        );
      })}
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
        <Segmented wrap>
          {FEEDBACK_KINDS.map(k => (
            <button key={k.id} className={kind===k.id?'on':''} onClick={()=>{ setKind(k.id); setState('idle'); }}>
              {k.label}
            </button>
          ))}
        </Segmented>
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

/* ---- AI analyst -----------------------------------------------------------
   L'onglet existe avant son contenu, volontairement : c'est lui qui dira ce que
   les données ont à dire quand on les croise — pas un tracker à la fois, mais
   l'un contre l'autre. Réservé pour l'instant, et masquable tant qu'il l'est. */
function AnalystView(){
  return (
    <div className="empty training-empty">
      <span className="em-serif">AI analyst.</span>
      Cet onglet est réservé — Claude y lira vos trackers ensemble : ce qui monte quand autre
      chose descend, ce qui revient toujours le même jour de la semaine, ce qu'un master doit
      surtout à un seul de ses membres. Une lecture croisée, pas un graphe de plus.
      <span className="training-note serif">
        Rien n'est encore branché : la page arrive, les données l'attendent déjà.
        Masquable depuis les paramètres, section Onglets.
      </span>
    </div>
  );
}

/* ---- La barre d'onglets ---------------------------------------------------
   Les onglets se réordonnent comme tout le reste de l'app : on maintient, ça
   s'attrape, on glisse (voir useDragReorder). Le garde-fou du clic est le même
   que celui des pastilles du rail — relâcher un appui long ne doit pas, en plus,
   changer d'onglet. L'ordre suit le compte : la barre est la même sur le
   téléphone et sur le PC. */
function TabBar({ tabs, order, activeTab, onSelect, onReorder }){
  const byId = useMemo(() => Object.fromEntries(tabs.map(t => [t.id, t])), [tabs]);
  // On ne réordonne que ce qui est affiché ; un onglet masqué garde sa place
  // dans l'ordre enregistré et la retrouve quand on le rallume.
  const visibleOrder = useMemo(() => order.filter(id => byId[id]), [order, byId]);
  const { order: dragOrder, dragId, startDrag, setNodeRef, wasArmed } = useDragReorder(visibleOrder, (next) => {
    // Réordonner ce qu'on voit ne doit pas perdre ce qu'on ne voit pas : les
    // onglets masqués gardent leur créneau dans l'ordre complet, et les visibles
    // se répartissent dans les créneaux restants, dans leur nouvel ordre.
    let vi = 0;
    onReorder(order.map(id => byId[id] ? next[vi++] : id));
  });
  const startRef = useRef(null);

  return (
    <div className="tabs" role="tablist">
      {dragOrder.map(id => {
        const t = byId[id];
        if (!t) return null;
        return (
          <button
            key={id}
            ref={setNodeRef(id)}
            role="tab"
            aria-selected={activeTab===id}
            className={`${activeTab===id?'active':''} ${dragId===id?'dragging':''}`}
            onPointerDown={(e)=>{ startRef.current = { x:e.clientX, y:e.clientY }; startDrag(id)(e); }}
            onClickCapture={(e)=>{
              const s = startRef.current;
              const moved = s && (Math.abs(e.clientX-s.x) > 6 || Math.abs(e.clientY-s.y) > 6);
              if (wasArmed() || moved){ e.preventDefault(); e.stopPropagation(); }
            }}
            onClick={()=>onSelect(id)}
            title="Cliquer pour ouvrir · maintenir puis glisser pour réordonner"
          >{t.label}</button>
        );
      })}
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
// Grouper décide comment le Jour range ses trackers en sections ; trier décide
// l'ordre DANS chaque section. Les deux étaient un seul réglage confondu
// (« Filtres & tri ») avant d'avoir de quoi grouper — trois questions
// différentes méritent trois boutons, pas un seul qui grossit.
const GROUPS = [
  { id:'type',  label:'Type',    hint:'quotidiens, plusieurs par jour, alimentation, masters' },
  { id:'color', label:'Couleur', hint:'un groupe par couleur de tracker' },
  { id:'done',  label:'Fait',    hint:'noté aujourd’hui, ou pas encore' },
];
// Les quatre sections possibles du Jour en groupement « Type ». Le master et
// l'alimentation sont des sections comme les autres — réordonnables au même
// titre, pas des blocs fixes en tête et en pied de page.
const SECTION_LABELS = { masters:'Masters', daily:'Quotidiens', multi:'Plusieurs par jour', food:'Alimentation',
                          done:'Fait aujourd\'hui', notdone:'Pas fait' };

function ChevronDown(){
  return <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1L4.5 5L8 1"/></svg>;
}

function TrackerRail({ trackers, selectedIds = [], filterActive, onToggle, onToggleAll, onAdd, onEdit, onReorder,
                        filterOpen, onToggleFilterOpen, sortMode, onSortMode, sortOpen, onToggleSortOpen,
                        groupMode, onGroupMode, groupOpen, onToggleGroupOpen }){
  const byId = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);
  const ids = useMemo(() => trackers.map(t => t.id), [trackers]);
  const { order, dragId, startDrag, setNodeRef, wasArmed } = useDragReorder(ids, onReorder);
  const dragStartRef = useRef(null);
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="rail-wrap">
      <div className="rail-toggles">
        <button className={`rail-toggle ${filterOpen?'open':''}`} onClick={onToggleFilterOpen} aria-expanded={filterOpen}>
          <ChevronDown/>
          <span>Filtres</span>
          {filterActive && <span className="rail-count">{selectedIds.length}</span>}
        </button>
        <button className={`rail-toggle ${sortOpen?'open':''}`} onClick={onToggleSortOpen} aria-expanded={sortOpen}>
          <ChevronDown/>
          <span>Tri</span>
          {sortMode !== 'manuel' && <span className="rail-sort-tag">{SORTS.find(s=>s.id===sortMode)?.label}</span>}
        </button>
        <button className={`rail-toggle ${groupOpen?'open':''}`} onClick={onToggleGroupOpen} aria-expanded={groupOpen}>
          <ChevronDown/>
          <span>Grouper</span>
          {groupMode !== 'type' && <span className="rail-sort-tag">{GROUPS.find(g=>g.id===groupMode)?.label}</span>}
        </button>
      </div>
      {sortOpen && (
        <div className="rail-sort">
          <span className="rail-sort-label">Trier</span>
          <Segmented size="small">
            {SORTS.map(s => (
              <button key={s.id} className={sortMode===s.id?'on':''} title={s.hint}
                onClick={()=>onSortMode(s.id)}>{s.label}</button>
            ))}
          </Segmented>
        </div>
      )}
      {groupOpen && (
        <div className="rail-sort">
          <span className="rail-sort-label">Grouper</span>
          <Segmented size="small">
            {GROUPS.map(g => (
              <button key={g.id} className={groupMode===g.id?'on':''} title={g.hint}
                onClick={()=>onGroupMode(g.id)}>{g.label}</button>
            ))}
          </Segmented>
        </div>
      )}
      {filterOpen && (
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
                  // Un appui long attrape la pastille pour la réordonner ; le relâcher
                  // ne doit pas basculer le filtre par-dessus le marché, même sans
                  // avoir bougé d'un pixel.
                  const s = dragStartRef.current;
                  const moved = s && (Math.abs(e.clientX-s.x) > 6 || Math.abs(e.clientY-s.y) > 6);
                  if (wasArmed() || moved){ e.preventDefault(); e.stopPropagation(); }
                }}
                onClick={()=>onToggle(t.id)}
                onDoubleClick={()=>onEdit(t)}
                title="Cliquer pour filtrer · maintenir puis glisser pour réordonner · double-clic pour modifier"
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
function TodayView({ trackers, masters = [], trackerById = {}, entries, filterIds, onAddEntry, onDeleteEntry, onEditEntry, onReorder, foodSummary = null, onEditTracker, showWeek,
                      groupMode = 'type', sectionOrder, onReorderSections }){
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

  // "Tout ajouter" porte sur toutes les cartes affichées, quel que soit le
  // groupement choisi — une carte n'a jamais qu'un seul bouton "Noter", peu
  // importe la section où elle atterrit.
  const submit = useSubmitAll();
  const sections = buildDaySections({
    groupMode, trackers, masters, entries, dk, foodSummary, trackerById,
    onAddEntry, onDeleteEntry, onEditEntry, todayTs, onReorder, onEditTracker,
    registerSubmit: submit.registerSubmit,
  });
  const sectionIds = sections.map(s => s.id);
  const order = mergeSectionOrder(sectionIds, sectionOrder);
  const sectionDrag = useDragReorder(order, onReorderSections);
  const sectionById = Object.fromEntries(sections.map(s => [s.id, s]));

  return (
    <div>
      <div className="today-head">
        <p className="section-label" style={{textTransform:'capitalize',margin:0}}>
          {todayLabel}{showWeek && <span className="week-tag mono">sem. {isoWeek(todayTs)}</span>}
        </p>
        {dailyTrackers.length > 0 && (
          <span className="today-progress">{dailyDone}/{dailyTrackers.length} quotidien{dailyTrackers.length>1?'s':''}</span>
        )}
      </div>
      {submit.bar}
      {!trackers.length && (
        <div className="empty" style={{padding:'30px 0'}}><span className="em-serif">Aucun tracker à remplir.</span> Vos masters se calculent tout seuls.</div>
      )}
      {/* Déplacer une section entre des sections hautes de plusieurs écrans est
          impossible : on ne voit jamais l'arrivée en même temps que le départ.
          Dès qu'un glisser s'arme, tout le contenu se replie et il ne reste que
          les intitulés — la liste entière tient alors sous les yeux. Replié en
          CSS et non démonté : une carte à moitié remplie ne doit pas perdre son
          brouillon parce qu'on a rangé les sections. */}
      <div className={`day-groups ${sectionDrag.dragId != null ? 'reordering' : ''}`}>
        {sectionDrag.order.map(id => {
          const sec = sectionById[id];
          if (!sec) return null;
          const dragProps = { containerRef: sectionDrag.setNodeRef(id), dragging: sectionDrag.dragId === id,
                               onDragStart: sectionDrag.startDrag(id) };
          return sec.selfLabeled
            ? React.cloneElement(sec.node, { key:id, ...dragProps })
            : (
              <ReorderSection key={id} label={sec.label} swatch={sec.swatch} {...dragProps}>
                {sec.node}
              </ReorderSection>
            );
        })}
      </div>
    </div>
  );
}

// Recale une préférence d'ordre enregistrée sur les clés RÉELLEMENT présentes
// aujourd'hui : celles qu'on retrouve gardent la place relative qu'on leur
// avait donnée, celles apparues depuis (une nouvelle couleur, une section qui
// vient d'avoir du contenu) s'ajoutent à la fin dans leur ordre par défaut.
// Pas la même chose que `mergeSubOrder` : ici on réordonne une liste complète
// selon un souvenir, on ne recolle pas un sous-ensemble glissé dans le tout.
function mergeSectionOrder(defaultIds, saved){
  if (!Array.isArray(saved) || !saved.length) return defaultIds;
  const known = new Set(defaultIds);
  const kept = saved.filter(id => known.has(id));
  const added = defaultIds.filter(id => !kept.includes(id));
  return [...kept, ...added];
}

// Un en-tête de section réordonnable : la même poignée que sur une carte de
// tracker, un rond de couleur pour un groupe "Couleur" (le regroupement se
// voit déjà, un mot de plus ne dirait rien), un intitulé pour tout le reste.
function ReorderSection({ label, swatch, containerRef, dragging, onDragStart, children }){
  return (
    <div ref={containerRef} className={`day-group ${dragging?'dragging':''}`}>
      <p className="section-label day-group-head">
        {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
        {swatch && <span className="dot" style={{background:swatch, width:10, height:10}}></span>}
        {label}
      </p>
      <div className="day-group-body">{children}</div>
    </div>
  );
}

// L'état partagé d'un "Tout ajouter" : chaque DayCard remonte sa propre
// fonction de sauvegarde tant qu'elle porte un brouillon non enregistré, et
// c'est ce que ce bouton groupé déclenche d'un coup. Partagé par DayGrid
// (Historique) et par les sections du Jour — une carte n'a qu'un bouton
// "Noter", peu importe dans quelle section elle se trouve affichée.
function useSubmitAll(){
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
  // Only worth offering once more than one card is waiting — with a single one,
  // that card's own button is right there.
  const bar = pendingIds.length > 1 && (
    <div className="submit-all-bar">
      <button className="submit-all" onClick={submitAll}>
        Tout ajouter <span className="sa-count">{pendingIds.length}</span>
      </button>
    </div>
  );
  return { registerSubmit, bar };
}

// Une grille de cartes de tracker pour un jour donné — la seule façon de
// remplir un tracker de données dans l'app, qu'on soit dans "Quotidiens" ou
// dans un groupe de couleur. Sans `onReorder` (un bucket dérivé d'une donnée —
// couleur, fait/pas fait — plutôt que d'un ordre posé), `useDragReorder`
// dégrade déjà proprement à une grille sans poignée.
function TrackerCardGrid({ ids, byId, byTracker, onAddEntry, onDeleteEntry, onEditEntry, dayTs, isToday, onReorder, onEditTracker, registerSubmit }){
  const drag = useDragReorder(ids, onReorder);
  return (
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
            onEditTracker={onEditTracker}
          />
        );
      })}
    </div>
  );
}

// Range les trackers du Jour en sections selon le groupement choisi. Masters
// et Alimentation restent leurs composants existants — un master garde son
// langage visuel de composite, pas celui d'une carte de tracker — les buckets
// de trackers passent tous par `TrackerCardGrid`.
function buildDaySections({ groupMode, trackers, masters, entries, dk, foodSummary, trackerById,
                             onAddEntry, onDeleteEntry, onEditEntry, todayTs, onReorder, onEditTracker, registerSubmit }){
  const byTracker = {};
  for (const t of trackers) byTracker[t.id] = [];
  for (const e of entries){
    if (dayKey(e.ts) === dk && byTracker[e.trackerId]) byTracker[e.trackerId].push(e);
  }
  const byId = Object.fromEntries(trackers.map(t => [t.id, t]));
  const grid = (ids, reorderable) => (
    <TrackerCardGrid ids={ids} byId={byId} byTracker={byTracker}
      onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry}
      dayTs={todayTs} isToday={true} onReorder={reorderable ? onReorder : null} onEditTracker={onEditTracker}
      registerSubmit={registerSubmit} />
  );

  // Les clés portent le mode en préfixe : « masters » et « alimentation »
  // existent dans les trois groupements, et `useDragReorder` réconcilie son
  // ordre interne d'un rendu à l'autre par identité de clé — sans le préfixe,
  // changer de groupement lui ferait croire que ces deux-là gardaient la
  // position qu'elles avaient dans le groupement précédent.
  const k = (id) => `${groupMode}:${id}`;
  const sections = [];
  if (masters.length){
    sections.push({ id:k('masters'), label:SECTION_LABELS.masters,
      node: <MasterStrips masters={masters} trackerById={trackerById} entries={entries} onReorder={onReorder} onEdit={onEditTracker} /> });
  }

  if (groupMode === 'color'){
    // Une section par couleur réellement utilisée, dans l'ordre où ces
    // couleurs apparaissent (celui du tri courant) — pas de manche à
    // réordonner à l'intérieur : l'appartenance à une couleur n'est pas un
    // ordre posé, glisser une carte d'un bucket de couleur à l'autre ne
        // changerait pas sa couleur.
    const byColor = {};
    const colorOrder = [];
    for (const t of trackers){
      if (!byColor[t.color]) { byColor[t.color] = []; colorOrder.push(t.color); }
      byColor[t.color].push(t.id);
    }
    for (const color of colorOrder){
      sections.push({ id:k(`color:${color}`), swatch:color, label:'', node: grid(byColor[color], false) });
    }
  } else if (groupMode === 'done'){
    // Un joker compte comme "fait" : c'est une journée traitée délibérément,
    // pas une case vide qu'on aurait oubliée.
    const doneIds = trackers.filter(t => (byTracker[t.id] || []).length > 0).map(t => t.id);
    const notDoneIds = trackers.filter(t => !(byTracker[t.id] || []).length).map(t => t.id);
    if (doneIds.length) sections.push({ id:k('done'), label:SECTION_LABELS.done, node: grid(doneIds, false) });
    if (notDoneIds.length) sections.push({ id:k('notdone'), label:SECTION_LABELS.notdone, node: grid(notDoneIds, false) });
  } else {
    // 'type' — le cas d'origine : quotidiens et plusieurs par jour, toujours
    // reorderables entre eux comme avant.
    const dailyIds = trackers.filter(t => t.daily).map(t => t.id);
    const multiIds = trackers.filter(t => !t.daily).map(t => t.id);
    if (dailyIds.length) sections.push({ id:k('daily'), label:SECTION_LABELS.daily, node: grid(dailyIds, true) });
    if (multiIds.length) sections.push({ id:k('multi'), label:SECTION_LABELS.multi, node: grid(multiIds, true) });
  }

  if (foodSummary){
    // Le résumé Food porte déjà son propre intitulé et son lien « ouvrir » sur
    // la même ligne — `selfLabeled` dit à TodayView de lui passer la poignée
    // directement plutôt que de dupliquer un second en-tête au-dessus.
    sections.push({ id:k('food'), selfLabeled:true, node: foodSummary });
  }
  return sections;
}

// Grid of one editable card per tracker, for the given day. Utilisé par
// l'Historique, qui ne connaît ni le groupement ni l'alimentation — il garde
// le partage fixe Quotidiens / Plusieurs par jour d'origine.
function DayGrid({ trackers, entries, onAddEntry, onDeleteEntry, onEditEntry, dayTs, isToday, onReorder, onEditTracker }){
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
  const submit = useSubmitAll();

  if (!trackers.length){
    return <div className="empty"><span className="em-serif">Aucun tracker.</span></div>;
  }

  const grid = (ids) => (
    <TrackerCardGrid ids={ids} byId={byId} byTracker={byTracker}
      onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry}
      dayTs={dayTs} isToday={isToday} onReorder={onReorder} onEditTracker={onEditTracker}
      registerSubmit={submit.registerSubmit} />
  );

  if (!dailyIds.length || !multiIds.length){
    return (
      <>
        {submit.bar}
        {grid(dailyIds.length ? dailyIds : multiIds)}
      </>
    );
  }

  return (
    <div className="day-groups">
      {submit.bar}
      <div className="day-group">
        <p className="section-label">Quotidiens</p>
        {grid(dailyIds)}
      </div>
      <div className="day-group">
        <p className="section-label">Plusieurs par jour</p>
        {grid(multiIds)}
      </div>
    </div>
  );
}

function DayCard({ tracker, dayEntries, onAddEntry, onDeleteEntry, onEditEntry, dayTs, isToday, containerRef, dragging, onDragStart, registerSubmit, onEditTracker }){
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
            onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="0" style={{width:'5.5em',flex:'0 1 auto'}} />
          {t.unit && <span className="unit">{t.unit}</span>}
        </div>
      )}
      {t.type === 'scale' && (() => {
        const min = t.scaleMin ?? 1, max = t.scaleMax || 5, step = t.scaleStep || 1;
        const mid = min + Math.round(((max - min) / step) / 2) * step;
        return (
          <div className="scale-slider">
            <input
              type="range" min={min} max={max} step={step}
              value={scale ?? mid}
              onChange={e=>setScale(parseFloat(e.target.value))}
              aria-label={`Note de ${min} à ${max}`}
              style={{'--fill': `${(((scale ?? mid) - min) / Math.max(1e-9, max-min)) * 100}%`}}
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
          <input type="number" min="0" placeholder="0" value={durH} onChange={e=>setDurH(e.target.value)} style={{width:44,textAlign:'left'}} />
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
            style={{width:44,textAlign:'left'}} />
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
        <div className="tc-name" style={{color:t.color}}>{t.name}</div>
        <div className="tc-actions">
          {/* Left to right: joker · entrées précédentes · effacer · paramètres · noter — the
              geste principal always lands rightmost, the joker (a rarer, deliberate choice)
              always leftmost, as far from "Ajouter" as the row allows. */}
          {!daily && t.jokerEnabled && (
            <button
              className={`tc-act icon joker ${jokerEntry?'on':''}`}
              onClick={toggleJoker}
              aria-pressed={!!jokerEntry}
              title={jokerEntry ? 'Retirer le joker' : 'Marquer ce jour comme joker (exclu des calculs)'}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
                <circle cx="7" cy="7" r="5.2"/><path d="M3.4 10.6L10.6 3.4"/>
              </svg>
            </button>
          )}
          {!daily && count > 0 && (
            <button
              className={`tc-act count ${logOpen?'open':''}`}
              onClick={()=>setLogOpen(o=>!o)}
              aria-expanded={logOpen}
              title={logOpen ? 'Masquer les entrées' : 'Voir les entrées'}
            >{count}×</button>
          )}
          {daily && existing && (
            <button className="tc-act icon danger" onClick={()=>onDeleteEntry(existing.id)} title="Effacer l'entrée du jour">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M2 2L10 10M10 2L2 10"/>
              </svg>
            </button>
          )}
          {onEditTracker && (
            <button className="tc-act icon" onClick={()=>onEditTracker(t)} title="Paramètres du tracker">
              <GearIcon size={14} />
            </button>
          )}
          <button className="tc-act primary" disabled={!canSave} onClick={submit}>
            {daily ? (existing ? 'Remplacer' : 'Noter') : 'Ajouter'}
          </button>
        </div>
      </div>

      {/* A jokered day doesn't invite a new value — it says so instead of composing one. */}
      {!daily && jokerEntry ? (
        <div className="tc-dash-row">
          <span className="tc-dash mono">—</span>
          <span className="tc-dash-msg serif">ce jour ne compte pas</span>
        </div>
      ) : (
        <div className={inputClass}>{inputControls}</div>
      )}

      {!daily && count > 0 && (
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

function ChronoView({ chronos, trackers, trackerById, onAdd, onStart, onPause, onReset, onRemove, onSave, onUpdate, onResetAll, onReorder, exclusive, onSetExclusive }){
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

  // Même ordre partout : chaque appareil connecté voit les chronos dans
  // l'arrangement posé, pas dans l'ordre où ils ont été créés.
  const sortedChronos = useMemo(() => [...chronos].sort((a,b) => (a.order||0) - (b.order||0)), [chronos]);
  const chronoIds = useMemo(() => sortedChronos.map(c => c.id), [sortedChronos]);
  const byChronoId = useMemo(() => Object.fromEntries(sortedChronos.map(c => [c.id, c])), [sortedChronos]);
  const drag = useDragReorder(chronoIds, onReorder);

  const cards = (
    <div className="today-grid">
      {drag.order.map(id => {
        const c = byChronoId[id];
        if (!c) return null;
        return (
          <ChronoCard
            key={c.id} chrono={c} now={now}
            tracker={c.trackerId ? trackerById[c.trackerId] : null}
            onStart={onStart} onPause={onPause} onReset={onReset}
            onSave={onSave} onEdit={()=>setEditing(c)}
            containerRef={drag.setNodeRef(c.id)}
            dragging={drag.dragId === c.id}
            onDragStart={drag.startDrag(c.id)}
          />
        );
      })}
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
            <Segmented size="small" title={exclusive ? 'Un seul chrono actif à la fois' : 'Plusieurs chronos peuvent tourner ensemble'}>
              <button className={!exclusive?'on':''} onClick={()=>onSetExclusive(false)}>Multi</button>
              <button className={exclusive?'on':''} onClick={()=>onSetExclusive(true)}>Solo</button>
            </Segmented>
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

function ChronoCard({ chrono: c, now, tracker, onStart, onPause, onReset, onSave, onEdit, containerRef, dragging, onDragStart }){
  const elapsed = chronoElapsed(c, now);
  const isRunning = !!c.startedAt;
  const minutes = Math.round(elapsed / 60000);

  return (
    <div ref={containerRef} className={`today-card chrono-card ${isRunning?'running':''} ${dragging?'dragging':''}`}>
      <div className="tc-head">
        {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
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
          <input value={label} onChange={e=>setLabel(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && canSave) onSave(payload); }}
            placeholder={linked ? linked.name : 'ex. Lecture'} />
        </div>
        <div className="field" style={{borderBottom:'none'}}>
          <label>Secondes</label>
          <Segmented>
            <button className={!showSeconds?'on':''} onClick={()=>setShowSeconds(false)}>Minutes</button>
            <button className={showSeconds?'on':''} onClick={()=>setShowSeconds(true)}>Sec.</button>
          </Segmented>
          <InfoBubble title="Affichage du chrono">
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
                  chronos, allTrackers, onAddChrono, onStartChrono, onPauseChrono, onResetChrono, onRemoveChrono, onSaveChrono, onUpdateChrono, onResetAllChronos, onReorderChronos, chronoExclusive, onSetChronoExclusive,
                  foodSummary, historyJump, onAddTracker, onEditTracker, showWeek, groupMode, sectionOrder, onReorderSections }){
  return (
    <div>
      <div className="log-subnav">
        <Segmented size="compact">
          <button className={logSub==='jour'?'on':''} onClick={()=>onLogSub('jour')}>Jour</button>
          <button className={logSub==='historique'?'on':''} onClick={()=>onLogSub('historique')}>Historique</button>
          <button className={logSub==='chrono'?'on':''} onClick={()=>onLogSub('chrono')}>Chrono</button>
        </Segmented>
        {/* Rien à droite de la bascule sauf ce qui AGIT : la phrase qui décrivait
            l'onglet ouvert répétait ce que la page montre déjà juste en dessous. */}
        {logSub === 'jour' && (
          <button className="pill add subnav-add" onClick={onAddTracker} title="Nouveau tracker">
            <span className="add-full">＋ Nouveau tracker</span>
            <span className="add-mid">＋ Tracker</span>
            <span className="add-min">＋</span>
          </button>
        )}
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
          onReorder={onReorderChronos}
        />
      ) : logSub === 'jour' ? (
        <TodayView trackers={trackers} masters={masters} trackerById={trackerById} entries={entries} filterIds={filterIds} onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} onReorder={onReorder} foodSummary={foodSummary} onEditTracker={onEditTracker} showWeek={showWeek}
                  groupMode={groupMode} sectionOrder={sectionOrder} onReorderSections={onReorderSections} />
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
          onEditTracker={onEditTracker}
          showWeek={showWeek}
        />
      )}
    </div>
  );
}

/* ============================================================
   History — a month calendar to open any day and edit its entries
   ============================================================ */
function HistoryView({ trackers, masters = [], trackerById, entries, filterIds, onAddEntry, onDeleteEntry, onEditEntry, onReorder, jumpTo, onEditTracker, showWeek }){
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
          <span className="serif de-title">
            {dayLabel(selectedDay)}{showWeek && <span className="week-tag mono">sem. {isoWeek(selectedDay)}</span>}
          </span>
          <span className="de-sub">{dayEntries.length} entrée{dayEntries.length>1?'s':''}{!isToday ? ' · archive' : ''}</span>
          {!isToday && <button className="de-today" onClick={goToday}>→ Aujourd'hui</button>}
        </div>

        {viewMasters.length > 0 && (
          <MasterStrips masters={viewMasters} trackerById={trackerById} entries={entries} dayTs={selectedDay} onReorder={onReorder} onEdit={onEditTracker} />
        )}

        {viewTrackers.length === 0 ? (
          <div className="empty"><span className="em-serif">Aucun tracker.</span> Créez-en un pour commencer.</div>
        ) : (
          <DayGrid trackers={viewTrackers} entries={viewEntries} onAddEntry={onAddEntry} onDeleteEntry={onDeleteEntry} onEditEntry={onEditEntry} dayTs={selectedDay} isToday={isToday} onReorder={onReorder} onEditTracker={onEditTracker} />
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
                      <div className="name"><span className="dot" style={{background:t.color}}></span><span>{t.name}</span></div>
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
        <button className="icon-btn cal-nav" onClick={onPrev} aria-label="Mois précédent">‹</button>
        <span className="cal-title">{monthLabel}</span>
        <button className="icon-btn cal-nav" onClick={onNext} aria-label="Mois suivant">›</button>
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
   Vues view (charts / heatmap / grid)
   ============================================================ */
function VuesView({ trackers, trackerById, entries, filterIds, onReorder, onEdit, onOpenDay }){
  // Quatre vues à plat, pas trois dont une qui en cache trois autres : les
  // cartes, la tendance, le calendrier et la grille sont quatre façons de
  // regarder les mêmes données, aucune n'est un réglage d'une autre. La barre
  // « Affichage » qui vivait sous « Graphes » a donc disparu, et l'overlay
  // Master avec elle — un master a sa propre carte dans les cartes.
  const [mode, setMode] = useState('chart'); // chart | trend | calendar | summary
  const [rangeMode, setRangeMode] = useState('30'); // '7'|'30'|'90'|'365'|'ytd'|'all'|'custom'
  const [customStart, setCustomStart] = useState('');
  // « Liste » et « Grille » ne sont pas deux affichages mais un seul réglé à
  // deux crans : combien de cartes par ligne. Le curseur remplace le choix, et
  // chaque cran de plus rétrécit les cartes et les allège de leurs statistiques
  // secondaires — sans quoi elles se tasseraient au lieu de se simplifier.
  const [perRow, setPerRow] = useState(1);       // 1..MAX_PER_ROW

  const filterSet = filterIds ? new Set(filterIds) : null;
  const visibleTrackers = filterSet ? trackers.filter(t => filterSet.has(t.id)) : trackers;
  // Data trackers only — the overlay/heatmap/grid modes need real entries,
  // so computed masters are handled separately (their own card). The filter
  // now narrows the Master overlay and Tendance too.
  const dataVisible = visibleTrackers.filter(t => !isMaster(t));

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
        <Segmented size="compact" scrollx>
          <button className={mode==='chart'?'on':''} onClick={()=>setMode('chart')}>Graphes</button>
          <button className={mode==='trend'?'on':''} onClick={()=>setMode('trend')}>Tendance</button>
          <button className={mode==='calendar'?'on':''} onClick={()=>setMode('calendar')}>Calendrier</button>
          <button className={mode==='summary'?'on':''} onClick={()=>setMode('summary')}>Grille</button>
        </Segmented>
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
            <span className="layout-label">Densité</span>
            <div className="per-row">
              <span className="per-row-end" aria-hidden="true">−</span>
              <input
                type="range" min="1" max={MAX_PER_ROW} step="1" value={perRow}
                onChange={e=>setPerRow(parseInt(e.target.value, 10))}
                aria-label="Cartes par ligne"
                title={`${perRow} carte${perRow>1?'s':''} par ligne`}
                style={{'--fill': `${((perRow-1)/(MAX_PER_ROW-1))*100}%`}}
              />
              <span className="per-row-end" aria-hidden="true">+</span>
              <span className="per-row-n mono">{perRow}</span>
            </div>
            <InfoBubble title="Densité">
              Combien de cartes par ligne — de 1 à 4. Chaque cran ne rétrécit pas seulement
              la carte : il lui retire ses statistiques secondaires, puis ses graduations,
              jusqu'à la <span className="k">sparkline</span> et sa seule valeur du jour.
              Sur téléphone l'écran ne tient qu'une colonne, et deux sous 880 px : le curseur
              ne change alors que le détail. <span className="k">C'est sur un grand écran
              qu'il change vraiment quelque chose.</span>
            </InfoBubble>
          </div>

          <div className="chart-grid-layout" data-per={perRow}>
            {cardsDrag.order.map(id => {
              const t = visibleById[id];
              if (!t) return null;
              const dragProps = { containerRef: cardsDrag.setNodeRef(t.id), dragging: cardsDrag.dragId===t.id, onDragStart: cardsDrag.startDrag(t.id) };
              return isMaster(t)
                ? <MasterTrackerCard key={t.id} perRow={perRow} master={t} trackerById={trackerById} entries={entries} rangeDays={range} onEdit={onEdit} {...dragProps} />
                : <ChartCard key={t.id} perRow={perRow} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={range} onEdit={onEdit} onOpenDay={onOpenDay} {...dragProps} />;
            })}
          </div>

          {visibleTrackers.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker.</span></div>}
        </>
      )}
      {mode === 'trend' && (
        <>
          <TrendChart trackers={dataVisible} entries={entries} rangeDays={range} />
          {dataVisible.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker à moyenner.</span></div>}
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
        <GridSummary trackers={dataVisible} entries={entries} rangeDays={range} onEdit={onEdit} />
      )}
    </div>
  );
}

/* ============================================================
   Chart card — line chart with axes
   ============================================================ */
function ChartCard({ tracker, entries, rangeDays, perRow = 1, containerRef, dragging, onDragStart, onEdit, onOpenDay, goalAt = null }){
  const detail = chartDetail(perRow);
  const compact = perRow >= 2;
  const now = Date.now();
  const start = now - rangeDays*86400000;
  const isCumulative = !!tracker.cumulative && (tracker.type === 'number' || tracker.type === 'duration');

  // Aggregate per-day: average for number/scale/duration, sum/count for boolean.
  // Cumulative trackers instead run a total across the tracker's whole history,
  // so the range only decides how many days are drawn, not what's summed.
  const grain = GRAINS.some(g => g.id === tracker.chartGrain) ? tracker.chartGrain : 'day';
  const curveStyle = isCurveStyle(tracker.curveStyle) ? tracker.curveStyle : 'line';

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

  /* Une consigne à atteindre, quand le tracker en a une qui change dans le
     temps (les objectifs de Food) : une marche, jamais un trait droit d'un bout
     à l'autre — la cible a pu bouger en route, et une ligne unique dirait que
     celle d'aujourd'hui valait déjà il y a deux mois. Elle entre dans l'échelle,
     sinon un objectif au-dessus du plus haut jour sortirait du cadre. */
  const goalValues = goalAt ? points.map(p => goalAt(p.ts)).filter(v => v != null && v > 0) : [];

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
  const W = 800, H = detail.height, PAD_L = detail.padL, PAD_R = 12, PAD_T = 10, PAD_B = detail.padB;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Domain
  // Scales and booleans have a fixed, meaningful range; everything else gets a
  // domain snapped outward to round steps so the axis never reads 5h24 → 10h36.
  const fixedScale = tracker.type === 'boolean' || tracker.type === 'scale';
  const domain = fixedScale
    ? (() => {
        if (tracker.type !== 'scale') return { min: 0, max: 1, ticks: [0, 1], step: 1 };
        const min = tracker.scaleMin ?? 1, max = tracker.scaleMax || 5;
        return { min, max, ticks: [min, (min+max)/2, max], step: (max-min)/2 || 1 };
      })()
    // Aiming for ~6 gradations is what turns a 4.67-wide range into whole
    // units, an 863-wide one into steps of 200, and a 1.3-wide one into
    // halves — fewer ticks and the step jumps to the next coarser rung.
    : niceDomain(
        Math.min(...numericValues, ...goalValues, Infinity),
        Math.max(...numericValues, ...goalValues, -Infinity),
        detail.yTicks,
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
    if (tracker.type === 'scale')    return v.toFixed(decimalsForStep(tracker.scaleStep || 1));
    if (tracker.type === 'boolean')  return v >= 0.5 ? 'oui' : 'non';
    return v.toFixed(yDecimals);
  };

  // X-axis ticks (start, middle, end). Une carte serrée perd celui du milieu :
  // trois dates dans 250 px se chevauchent au lieu de situer quoi que ce soit.
  const xTicks = [
    { i: 0, label: grainTick(points[0]?.ts, grain) },
    ...(detail.midTick
      ? [{ i: Math.floor(points.length/2), label: grainTick(points[Math.floor(points.length/2)]?.ts, grain) }]
      : []),
    { i: points.length-1, label: grainTick(points[points.length-1]?.ts, grain) },
  ].filter(t => points[t.i]);

  const yTicks = domain.ticks;

  // Le stylo reste au niveau de la consigne jusqu'au jour où elle change, où il
  // monte ou descend sur place. Un jour sans consigne coupe le trait.
  let goalPath = '', prevGoalY = null;
  if (goalAt) points.forEach((p, i) => {
    const g = goalAt(p.ts);
    if (g == null || g <= 0){ prevGoalY = null; return; }
    const y = yAt(g), x = xAt(i);
    if (prevGoalY == null) goalPath += `M${x} ${y}`;
    else if (prevGoalY !== y) goalPath += `L${x} ${prevGoalY}L${x} ${y}`;
    else goalPath += `L${x} ${y}`;
    prevGoalY = y;
  });

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

  // Au doigt, la lecture ne s'ouvre qu'après un appui maintenu : faire défiler
  // la page en effleurant un graphe faisait sinon surgir une bulle qu'on
  // n'avait pas demandée. Une fois ouverte, le doigt balaie librement la courbe.
  // À la souris le survol reste immédiat — il n'y a pas de défilement à
  // confondre avec l'intention de lire.
  const TOUCH_HOLD_MS = 260;
  const TOUCH_SLOP = 10;
  const touchHold = useRef(null);
  const scrubbing = useRef(false);
  const endTouchHold = () => {
    if (touchHold.current?.timer) clearTimeout(touchHold.current.timer);
    touchHold.current = null;
  };
  useEffect(() => endTouchHold, []);

  const handleTouchStart = (e) => {
    const t = e.touches[0]; if (!t) return;
    scrubbing.current = false;
    endTouchHold();
    const x0 = t.clientX, y0 = t.clientY;
    touchHold.current = {
      x0, y0,
      timer: setTimeout(() => {
        touchHold.current = null;
        scrubbing.current = true;
        try { navigator.vibrate?.(10); } catch {}
        const i = pointToIndex(x0);
        if (i != null) setActive(i);
      }, TOUCH_HOLD_MS),
    };
  };
  const handleTouchMove = (e) => {
    const t = e.touches[0]; if (!t) return;
    if (scrubbing.current){
      const i = pointToIndex(t.clientX);
      if (i != null) setActive(i);
      return;
    }
    // Le doigt part avant la fin de l'attente : c'est un défilement, pas une lecture.
    const h = touchHold.current;
    if (h && (Math.abs(t.clientX - h.x0) > TOUCH_SLOP || Math.abs(t.clientY - h.y0) > TOUCH_SLOP)) endTouchHold();
  };
  const handleTouchEnd = () => { endTouchHold(); scrubbing.current = false; };

  const activePoint = active != null ? points[active] : null;

  return (
    <div ref={containerRef} className={`chart-card ${compact?'compact':''} ${perRow>=3?'dense':''} ${dragging?'dragging':''}`}>
      <div className="chart-head">
        <div className="name">
          {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
          <span style={{color:tracker.color}}>{tracker.name}</span>
        </div>
        <div className="chart-head-right">
          <div className="stats">
            {/* Trois paliers de détail : la valeur seule quand la carte est
                étroite, puis la moyenne, puis le compte d'entrées. */}
            {detail.stats === 'value' ? (
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
                {detail.stats === 'full' && isSumMode && <div>total période <span className="v">{total != null ? fmtValue(tracker, +total.toFixed(1)) : '—'}</span></div>}
                {detail.stats === 'full' && <div>entrées <span className="v">{entries.filter(e=>e.ts >= start).length}</span></div>}
              </>
            )}
          </div>
          {onEdit && (
            <button className="icon-btn chart-edit-btn" onClick={()=>onEdit(tracker)} aria-label="Paramètres du tracker" title="Paramètres du tracker">
              <GearIcon />
            </button>
          )}
        </div>
      </div>
      {hasData ? (
        <div className="chart-svg-wrap" style={{position:'relative', touchAction:'pan-y'}}>
        <svg ref={svgRef} className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={()=>setActive(null)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* Y grid */}
          {yTicks.map((v,i)=>(
            <g key={i}>
              <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
              {detail.axisLabels && <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{fmtY(v)}</text>}
            </g>
          ))}
          {curveStyle === 'bars' ? (
            <ChartBars points={points} xAt={xAt} yAt={yAt} color={tracker.color}
              baseY={barBaseY(yMin, yMax, yAt, PAD_T + innerH)}
              spacing={innerW / Math.max(1, points.length - 1)} />
          ) : (
            <>
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
            </>
          )}
          {goalPath && (
            <path d={goalPath} fill="none" stroke="var(--ink-2)" strokeWidth="1"
              strokeDasharray="4 4" opacity="0.7" />
          )}
          {/* X ticks */}
          {detail.axisLabels && xTicks.map((t,i)=>(
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
      <button className="icon-btn sm chart-tooltip-close" onClick={onClose} aria-label="Fermer" title="Fermer">
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 1L8 8M8 1L1 8"/></svg>
      </button>
      <div className="chart-tooltip-date">{date}</div>
      <div className="chart-tooltip-value">{value}</div>
      {onEdit && (
        <button className="icon-btn sm chart-tooltip-edit" onClick={onEdit} aria-label="Éditer ce jour dans l'historique" title="Éditer ce jour dans l'historique">
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
// A tracker's "good direction" decides which raw end reads as 1 (best) once
// normalized: up-is-better (default), down-is-better, or closest-to-target —
// so a metric where less is the win (ex. temps d'écran) can still push a
// master or la Tendance générale upward when it improves.
function directionFrac(tracker, value, min, max){
  const dir = tracker.goodDirection || 'up';
  const target = tracker.targetValue;
  if (dir === 'target' && target != null){
    const maxDev = Math.max(Math.abs(max - target), Math.abs(min - target)) || 1;
    return 1 - Math.min(1, Math.abs(value - target) / maxDev);
  }
  const span = Math.max(1e-9, max - min);
  let frac = (value - min) / span;
  if (dir === 'down') frac = 1 - frac;
  return frac;
}
// Whether a change from prevStat to curStat reads as an improvement, honoring
// the tracker's goodDirection — independent of which way the raw number moved.
function trendGoodness(tracker, curStat, prevStat){
  if (curStat == null || prevStat == null) return null;
  const dir = tracker.goodDirection || 'up';
  if (dir === 'target' && tracker.targetValue != null){
    const curDist = Math.abs(curStat - tracker.targetValue);
    const prevDist = Math.abs(prevStat - tracker.targetValue);
    if (curDist === prevDist) return 0;
    return curDist < prevDist ? 1 : -1;
  }
  if (curStat === prevStat) return 0;
  const wentUp = curStat > prevStat;
  return dir === 'down' ? (wentUp ? -1 : 1) : (wentUp ? 1 : -1);
}
function normalizeSeries(tracker, series){
  if (tracker.type === 'boolean') {
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : p.value }));
  }
  if (tracker.type === 'scale') {
    const min = tracker.scaleMin ?? 1;
    const max = tracker.scaleMax || 5;
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : directionFrac(tracker, p.value, min, max) }));
  }
  // number / duration / text — use min/max within the series
  const vals = series.map(p=>p.value).filter(v=>v!=null);
  if (vals.length < 2) {
    return series.map(p => ({ ts:p.ts, value: p.value == null ? null : 0.5 }));
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) return series.map(p => ({ ts:p.ts, value: p.value == null ? null : 0.5 }));
  return series.map(p => ({ ts:p.ts, value: p.value == null ? null : directionFrac(tracker, p.value, min, max) }));
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
function MasterStrips({ masters, trackerById, entries, dayTs, onReorder, onEdit }){
  const byId = useMemo(() => Object.fromEntries(masters.map(m => [m.id, m])), [masters]);
  const ids = useMemo(() => masters.map(m => m.id), [masters]);
  const drag = useDragReorder(ids, onReorder);
  return (
    <div className="master-strips">
      {drag.order.map(id => {
        const m = byId[id];
        if (!m) return null;
        return (
          <MasterStrip key={m.id} master={m} trackerById={trackerById} entries={entries} dayTs={dayTs} onEdit={onEdit}
            containerRef={drag.setNodeRef(m.id)} dragging={drag.dragId === m.id} onDragStart={drag.startDrag(m.id)} />
        );
      })}
    </div>
  );
}
function MasterStrip({ master, trackerById, entries, dayTs, containerRef, dragging, onDragStart, onEdit }){
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
        {/* Plus de losange ni de pastille « master » à côté du nom : c'est le
            NOM qui porte le contour, en une seule chose au lieu de trois. Le
            reste de la carte — une jauge et un indice sur 100 — dit déjà assez
            qu'on ne remplit pas ça comme un tracker. */}
        <span className="ms-name" style={{color:master.color, borderColor:master.color}}>{master.name}</span>
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
      {onEdit && (
        <button className="icon-btn chart-edit-btn" onClick={()=>onEdit(master)} aria-label="Paramètres du master" title="Paramètres du master">
          <GearIcon size={12} />
        </button>
      )}
    </div>
  );
}

/* ============================================================
   Master tracker card — a saved index: average of the normalized
   performance of its chosen member trackers (0–100 per day).
   ============================================================ */
function MasterTrackerCard({ master, trackerById, entries, rangeDays, perRow = 1, containerRef, dragging, onDragStart, onEdit }){
  const detail = chartDetail(perRow);
  const compact = perRow >= 2;
  const members = masterMembers(master, trackerById);
  const grain = GRAINS.some(g => g.id === master.chartGrain) ? master.chartGrain : 'day';
  const curveStyle = isCurveStyle(master.curveStyle) ? master.curveStyle : 'line';

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

  // Un master a plus d'amplitude à montrer qu'une série brute : il garde une
  // hauteur plus généreuse à densité égale.
  const W = 800, H = perRow >= 3 ? 100 : compact ? 130 : 220, PAD_L = detail.padL, PAD_R = 14, PAD_T = 14, PAD_B = detail.padB;
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
    <div ref={containerRef} className={`chart-card ${compact?'compact':''} ${perRow>=3?'dense':''} ${dragging?'dragging':''}`}>
      <div className="chart-head">
        <div className="name">
          {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
          <span className="master-mark" style={{background:master.color}}></span><span>{master.name}</span>
          {!compact && <span className="master-tag">master</span>}
        </div>
        <div className="chart-head-right">
          <div className="stats">
            {detail.stats === 'value' ? (
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
          {onEdit && (
            <button className="icon-btn chart-edit-btn" onClick={()=>onEdit(master)} aria-label="Paramètres du master" title="Paramètres du master">
              <GearIcon />
            </button>
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
              {detail.axisLabels && <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{Math.round(v*100)}</text>}
            </g>
          ))}
          {curveStyle === 'bars' ? (
            // L'indice est déjà borné 0–1 : les bâtons partent toujours du bas du cadre.
            <ChartBars points={avgSeries} xAt={xAt} yAt={yAt} color={master.color}
              baseY={PAD_T + innerH} spacing={innerW / Math.max(1, avgSeries.length - 1)} />
          ) : (
            <>
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
            </>
          )}
          {detail.axisLabels && xTicks.map((t,i)=>(
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
        <div className="name"><span style={{color:tracker.color}}>{tracker.name}</span></div>
        <div className="chart-head-right">
          <div className="stats">
            <div>jours actifs <span className="v">{dayVals.filter(d=>d.count>0).length}/{totalDays}</span></div>
          </div>
          {onEdit && (
            <button className="icon-btn chart-edit-btn" onClick={()=>onEdit(tracker)} aria-label="Paramètres du tracker" title="Paramètres du tracker">
              <GearIcon />
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
function GridSummary({ trackers, entries, rangeDays, onEdit }){
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
    // Which way is progress depends on the tracker's own goodDirection — a raw
    // increase isn't automatically "up" in the trend's sense if less is better.
    const goodness = (t.type === 'number' || t.type === 'scale' || t.type === 'duration')
      ? trendGoodness(t, curStat, prevStat) : (delta != null ? (delta>0?1:delta<0?-1:0) : null);

    let display = '—';
    if (curStat != null){
      if (t.type === 'boolean') display = `${curStat}j`;
      else if (t.type === 'text' || t.type === 'choice') display = `${curStat}`;
      else display = fmtValue(t, +curStat.toFixed(1));
    }

    const showAggTag = !t.daily && t.aggregate === 'sum' && (t.type === 'number' || t.type === 'duration');
    return { t, display, count: inRange.length, delta, goodness, showAggTag };
  });

  return (
    <div className="gridview">
      {cards.map(c => (
        <div className="gv-card" key={c.t.id}>
          <div className="label">
            <span style={{color:c.t.color}}>{c.t.name}</span>
            {onEdit && (
              <button className="icon-btn sm chart-edit-btn" onClick={()=>onEdit(c.t)} aria-label="Paramètres du tracker" title="Paramètres du tracker">
                <GearIcon size={12} />
              </button>
            )}
          </div>
          <div className="v">
            {c.display}
            {fmtUnit(c.t) && c.display !== '—' && <span className="u">{fmtUnit(c.t)}</span>}
            {c.showAggTag && <span className="tk-chip" style={{marginLeft:8,verticalAlign:'middle'}}>total</span>}
          </div>
          <div className={`trend ${c.goodness != null ? (c.goodness>0?'up':c.goodness<0?'down':'') : ''}`}>
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
                <input type="number" step="any" value={num} onChange={e=>setNum(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter') submit(); }} placeholder="0" style={{width:'5.5em',flex:'0 1 auto'}} />
                {t.unit && <span className="unit">{t.unit}</span>}
              </div>
            )}
            {t.type === 'scale' && (() => {
              const smin = t.scaleMin ?? 1, smax = t.scaleMax || 5, sstep = t.scaleStep || 1;
              const mid = smin + Math.round(((smax - smin) / sstep) / 2) * sstep;
              return (
                <div className="scale-slider">
                  <input
                    type="range" min={smin} max={smax} step={sstep}
                    value={scale ?? mid}
                    onChange={e=>setScale(parseFloat(e.target.value))}
                    aria-label={`Note de ${smin} à ${smax}`}
                    style={{'--fill': `${(((scale ?? mid) - smin) / Math.max(1e-9, smax-smin)) * 100}%`}}
                  />
                  <span className={`scale-val ${scale==null?'unset':''}`}>
                    {scale == null ? '—' : scale}<span className="scale-max">/{smax}</span>
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
              <div style={{display:'flex',gap:8,alignItems:'baseline'}}>
                <input type="number" min="0" placeholder="0" value={durH} onChange={e=>setDurH(e.target.value)} style={{width:50,textAlign:'left'}} />
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
                  style={{width:50,textAlign:'left'}} />
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
/* `scope='display'` : la même page, réduite à ce qui a un sens pour un tracker
   qu'on ne remplit pas soi-même — les graphes de Food. Ce qu'ils suivent est
   décidé par ce qu'on mange, pas par un réglage : leur genre, leur type, leur
   fréquence et leur période n'ont donc rien à proposer, et ce qui reste (le
   nom, la courbe, la granularité, le cumul, la couleur) est exactement ce qui
   reste vrai pour eux. Une seconde page de réglages n'aurait dit qu'une
   variante de celle-ci — c'est le même objet. */
function TrackerModal({ tracker, allTrackers = [], onClose, onSave, onDelete, onArchive, onUnarchive, scope = 'full' }){
  const isEdit = !!tracker;
  const display = scope === 'display';
  // — Cœur : ce que le tracker mesure —
  const [kind, setKind] = useState(tracker?.type === 'master' ? 'master' : 'data'); // data | master
  const [name, setName] = useState(tracker?.name || '');
  const [type, setType] = useState(tracker?.type && tracker.type !== 'master' ? tracker.type : 'number');
  const [unit, setUnit] = useState(tracker?.unit || '');
  const [scaleMin, setScaleMin] = useState(tracker?.scaleMin ?? 1);
  const [scaleMax, setScaleMax] = useState(tracker?.scaleMax || 5);
  const [scaleStep, setScaleStep] = useState(tracker?.scaleStep || 1);
  const [goodDirection, setGoodDirection] = useState(tracker?.goodDirection || 'up');
  const [targetValue, setTargetValue] = useState(tracker?.targetValue != null ? String(tracker.targetValue) : '');
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
  // Le calendrier de la période d'activité — celui de l'Historique (`MonthCalendar`),
  // ouvert en pastille plutôt qu'inventé une seconde fois. `dateField` dit
  // laquelle des deux dates le prochain jour cliqué renseigne.
  const [dateField, setDateField] = useState(null); // 'start' | 'end' | null
  const [calMonth, setCalMonth] = useState(() => startOfMonth(Date.now()));
  const dayKeyToTs = (dk) => new Date(dk + 'T00:00:00').getTime();
  const openDateField = (field) => {
    const dk = field === 'start' ? startDate : endDate;
    setCalMonth(startOfMonth(dk ? dayKeyToTs(dk) : Date.now()));
    setDateField(f => f === field ? null : field);
  };
  const [color, setColor] = useState(tracker?.color || DEFAULT_COLOR);
  const nameRef = useRef();

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
    if (display){
      onSave({ name: name.trim(), color, curveStyle, chartGrain, cumulative });
      return;
    }
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
      t.unit = null; t.scaleMin = null; t.scaleMax = null; t.scaleStep = null; t.choices = null; t.multiple = false;
      t.jokerEnabled = false;
      t.goodDirection = null; t.targetValue = null;
    } else {
      t.type = type;
      t.daily = daily;
      t.aggregate = aggregate;
      t.jokerEnabled = !daily && jokerEnabled;
      t.cumulative = (type === 'number' || type === 'duration') && cumulative;
      t.members = null;
      t.unit = (type === 'number' && unit.trim()) ? unit.trim() : null;
      t.scaleMin = type === 'scale' ? (scaleMin === '' || isNaN(scaleMin) ? 1 : scaleMin) : null;
      t.scaleMax = type === 'scale' ? (scaleMax === '' || isNaN(scaleMax) || scaleMax <= t.scaleMin ? t.scaleMin + 4 : scaleMax) : null;
      t.scaleStep = type === 'scale' ? (scaleStep === '' || isNaN(scaleStep) || scaleStep <= 0 ? 1 : scaleStep) : null;
      t.choices = type === 'choice' ? [...new Set(cleanChoices)] : null;
      t.multiple = type === 'choice' ? multiple : false;
      const directional = type === 'number' || type === 'scale' || type === 'duration';
      t.goodDirection = directional ? goodDirection : null;
      t.targetValue = (directional && goodDirection === 'target' && targetValue !== '' && !isNaN(parseFloat(targetValue)))
        ? parseFloat(targetValue) : null;
    }
    onSave(t);
  };

  return (
    <div className="fd-add-page">
      <div className="fd-add-head">
        <div className="fd-add-head-txt">
          <h2>{display ? 'Réglages du graphe' : isEdit ? 'Modifier le tracker' : 'Nouveau tracker'}</h2>
          <div className="modal-sub">{display
            ? 'Un graphe de Food est un tracker : ce qu’il suit vient de ce que vous mangez, seule sa lecture se règle.'
            : 'Le cœur définit ce que vous mesurez, les paramètres comment.'}</div>
        </div>
        <button className="icon-btn fd-add-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <div className="fd-add-body">

        {/* ============ CŒUR ============ */}
        <div className="card fd-card">
        <p className="section-label">Cœur</p>

        {!display && <div className="field spread">
          <label>Genre</label>
          <div className="ctl-with-info">
            <Segmented size="compact" scrollx>
              <button className={!isMasterKind?'on':''} onClick={()=>setKind('data')}>Tracker</button>
              <button className={isMasterKind?'on':''} onClick={()=>setKind('master')}>Master</button>
            </Segmented>
            <InfoBubble title="Genre">
              <span className="k">Tracker</span> : vous le remplissez avec des données.<br/>
              <span className="k">Master</span> : ne se remplit pas — c’est la moyenne normalisée (0–100) de la performance de plusieurs trackers choisis.
            </InfoBubble>
          </div>
        </div>}

        <div className="field" style={{borderBottom: display ? 'none' : isMasterKind ? '1px solid var(--line)' : undefined}}>
          <label>Nom</label>
          <input ref={nameRef} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter') submit();}}
            placeholder={isMasterKind ? 'ex: Forme, Bien-être, Discipline…' : 'ex: Caféine, Humeur, Sport…'} />
        </div>

        {display ? null : isMasterKind ? (
          <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
            <label style={{width:'auto'}}>Trackers membres</label>
            {memberCandidates.length === 0 ? (
              <span className="tc-empty-note">Créez d’abord des trackers de données à agréger.</span>
            ) : (
              <div className="member-picker">
                {memberCandidates.map(t => (
                  <button key={t.id} type="button" className={`member ${members.includes(t.id)?'on':''}`} onClick={()=>toggleMember(t.id)}>
                    <span className="dot" style={{background:t.color}}></span><span>{t.name}</span>
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
              <div className="field" style={{borderBottom:'none',flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
                <label style={{width:'auto'}}>Échelle</label>
                <div className="period-row">
                  <NumPill label="Min" value={scaleMin}
                    onChange={e=>setScaleMin(e.target.value === '' ? '' : parseFloat(e.target.value))} />
                  <NumPill label="Max" value={scaleMax}
                    onChange={e=>setScaleMax(e.target.value === '' ? '' : parseFloat(e.target.value))} />
                  <NumPill label="Incrément" min="0.01" value={scaleStep}
                    onChange={e=>setScaleStep(e.target.value === '' ? '' : parseFloat(e.target.value))} />
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
                      <button type="button" className="icon-btn choice-del" onClick={()=>removeChoice(i)} aria-label="Retirer" disabled={choices.length<=1}>×</button>
                    </div>
                  ))}
                  <button type="button" className="choice-add" onClick={addChoice}>＋ Ajouter un choix</button>
                </div>
              </div>
            )}
          </>
        )}

        </div>

        {/* ============ PARAMÈTRES ============ */}
        {!display && <div className="card fd-card">
        <p className="section-label">Paramètres</p>

        {!isMasterKind && (
          <div className="field spread">
            <label>Fréquence</label>
            <div className="ctl-with-info">
              <Segmented size="compact" scrollx>
                <button className={daily?'on':''} onClick={()=>setDaily(true)}>1 / jour</button>
                <button className={!daily?'on':''} onClick={()=>setDaily(false)}>Plusieurs / jour</button>
              </Segmented>
              <InfoBubble title="Fréquence">
                <span className="k">Une / jour</span> : une seule entrée par jour, ré-enregistrer un jour déjà noté remplace sa valeur.<br/>
                <span className="k">Plusieurs / jour</span> : autant d’entrées que vous voulez chaque jour.
              </InfoBubble>
            </div>
          </div>
        )}

        {!isMasterKind && !daily && (
          <div className="field spread">
            <label>Case joker</label>
            <div className="ctl-with-info">
              <BoolPill value={jokerEnabled} onChange={setJokerEnabled} />
              <InfoBubble title="Case joker">
                Ajoute un bouton pour marquer une journée entière comme joker (pull day, repos…).
                Les entrées de ce jour sont alors exclues des calculs — pas comptées comme zéro.
                Désactivée par défaut.
              </InfoBubble>
            </div>
          </div>
        )}

        {showAggregate && (
          <div className="field spread">
            <label>Calcul</label>
            <div className="ctl-with-info">
              <Segmented wrap>
                {AGGREGATES.map(a => (
                  <button key={a.id} className={aggregate===a.id?'on':''} onClick={()=>setAggregate(a.id)}>{a.label}</button>
                ))}
              </Segmented>
              <InfoBubble title="Agrégat">
                Combine plusieurs entrées d’un même jour :<br/>
                <span className="k">Moyenne</span> (10, 15, 20 → 15) · <span className="k">Somme</span> (→ 45) · <span className="k">Minimum</span> (→ 10) · <span className="k">Maximum</span> (→ 20).
              </InfoBubble>
            </div>
          </div>
        )}

        {!isMasterKind && type === 'choice' && (
          <div className="field spread">
            <label>Sélection</label>
            <div className="ctl-with-info">
              <Segmented>
                <button className={!multiple?'on':''} onClick={()=>setMultiple(false)}>Choix unique</button>
                <button className={multiple?'on':''} onClick={()=>setMultiple(true)}>Choix multiple</button>
              </Segmented>
              <InfoBubble title="Choix multiple">
                <span className="k">Choix unique</span> : une seule option par entrée.<br/>
                <span className="k">Choix multiple</span> : plusieurs options cochables par entrée.
              </InfoBubble>
            </div>
          </div>
        )}

        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,paddingTop:14}}>
          <div className="ctl-with-info" style={{width:'auto'}}>
            <label style={{width:'auto'}}>Période d’activité</label>
            <BoolPill value={windowEnabled} onChange={setWindowEnabled} />
            <InfoBubble title="Période d’activité">
              Activée, ce tracker n’influence les graphes et moyennes qu’entre les deux dates.
              <span className="k"> Début</span> par défaut = jour de création (utile si vous ne l’utilisez qu’après quelques jours).
              Laissez <span className="k">Fin</span> vide tant qu’il est actif — l’archivage la renseigne automatiquement.
              Désactivée, le tracker compte <span className="k">tous les jours</span>, sans limite.
            </InfoBubble>
          </div>
          {windowEnabled ? (
            <>
              <div className="period-row">
                <button type="button" className={`pill date-pill ${dateField==='start'?'open':''}`} onClick={()=>openDateField('start')}>
                  <span className="np-lab">Début</span>
                  <span className="mono">{startDate ? shortDate(dayKeyToTs(startDate)) : '—'}</span>
                </button>
                <button type="button" className={`pill date-pill ${dateField==='end'?'open':''}`} onClick={()=>openDateField('end')}>
                  <span className="np-lab">Fin</span>
                  <span className="mono">{endDate ? shortDate(dayKeyToTs(endDate)) : 'indéfini'}</span>
                  {endDate && (
                    <span className="date-pill-clear" role="button" aria-label="Effacer la date de fin"
                      onClick={e=>{ e.stopPropagation(); setEndDate(''); }}>✕</span>
                  )}
                </button>
              </div>
              {/* Le calendrier de l'Historique, ouvert ici plutôt que refait :
                  une pastille = un jour choisi, le mois se garde en mémoire
                  entre les deux tant que la modale reste ouverte. */}
              {dateField && (
                <div className="date-pill-cal">
                  <MonthCalendar
                    monthTs={calMonth}
                    onPrev={()=>setCalMonth(m=>addMonths(m,-1))}
                    onNext={()=>setCalMonth(m=>addMonths(m,1))}
                    entries={[]}
                    selectedKey={dateField==='start' ? startDate : endDate}
                    onSelectDay={(ts)=>{
                      const dk = dayKey(ts);
                      if (dateField === 'start'){
                        setStartDate(dk);
                        if (endDate && endDate < dk) setEndDate('');
                      } else {
                        if (startDate && dk < startDate) return; // une fin ne précède pas le début
                        setEndDate(dk);
                      }
                      setDateField(null);
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <span className="tc-empty-note">Ce tracker compte tous les jours, sans limite de période.</span>
          )}
          {isEdit && (
            tracker.archived
              ? <button type="button" className="period-arch unarchive" onClick={onUnarchive}>Désarchiver ce tracker</button>
              : <button type="button" className="period-arch" onClick={onArchive}>Archiver ce tracker</button>
          )}
        </div>

        </div>}

        {/* ============ VUES ============ */}
        <div className="card fd-card">
        <p className="section-label">Vues</p>

        <div className="field spread">
          <label>Courbe</label>
          <div className="ctl-with-info">
            <Segmented size="compact" scrollx>
              {CURVE_STYLES.map(c => (
                <button key={c.id} className={curveStyle===c.id?'on':''} onClick={()=>setCurveStyle(c.id)}>{c.label}</button>
              ))}
            </Segmented>
            <InfoBubble title="Forme de courbe">
              <span className="k">Polyligne</span> : les points reliés par des segments droits.<br/>
              <span className="k">Lissée</span> : une courbe arrondie qui passe quand même exactement par
              chaque point.<br/>
              <span className="k">Bâtons</span> : un bâton par point, rien entre les deux — le tracé
              n’affirme plus rien sur les jours non notés. C’est le tracé qui change, jamais les valeurs.
            </InfoBubble>
          </div>
        </div>

        <div className="field spread">
          <label>Granularité</label>
          <div className="ctl-with-info">
            <Segmented size="compact" scrollx>
              {GRAINS.map(g => (
                <button key={g.id} className={chartGrain===g.id?'on':''} onClick={()=>setChartGrain(g.id)}>{g.label}</button>
              ))}
            </Segmented>
            <InfoBubble title="Granularité">
              Regroupe les jours sur le graphe. <span className="k">Semaine</span> et <span className="k">Mois</span>
              affichent la <span className="k">moyenne</span> des jours renseignés de la période — les jours vides ne
              comptent pas pour zéro. L’échelle reste donc lisible dans la même unité quelle que soit la
              granularité. Réglage indépendant de la forme de courbe.
            </InfoBubble>
          </div>
        </div>

        {!display && !isMasterKind && (type === 'number' || type === 'scale' || type === 'duration') && (
          <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
            <label style={{width:'auto'}}>Sens de l’amélioration</label>
            <div className="ctl-with-info">
              <Segmented wrap>
                <button className={goodDirection==='up'?'on':''} onClick={()=>setGoodDirection('up')}>Monter = mieux</button>
                <button className={goodDirection==='down'?'on':''} onClick={()=>setGoodDirection('down')}>Descendre = mieux</button>
                {/* La cible s'écrit dans son option : choisie, elle s'élargit
                    pour faire place au nombre plutôt que d'ouvrir une seconde
                    ligne en dessous. Un <label> et pas un <button> — un champ
                    dans un bouton ne se laisse pas taper — d'où `seg-opt`, qui
                    lui rend l'allure d'une option de la piste. */}
                {goodDirection === 'target' ? (
                  <label className="seg-opt on">
                    Cible
                    <input type="number" step="any" value={targetValue} placeholder="—"
                           aria-label="Valeur cible"
                           onChange={e=>setTargetValue(e.target.value)} />
                    {unit.trim() && <span className="np-unit">{unit.trim()}</span>}
                  </label>
                ) : (
                  <button onClick={()=>setGoodDirection('target')}>Valeur cible</button>
                )}
              </Segmented>
              <InfoBubble title="Sens de l’amélioration">
                Décide de quel côté est le progrès dans les vues composites (Master, Tendance générale, Grille) —
                un temps d’écran qui baisse doit compter comme une amélioration, pas comme une chute.
                <span className="k"> Valeur cible</span> : se rapprocher d’un nombre précis compte comme un progrès,
                peu importe de quel côté on vient.
              </InfoBubble>
            </div>
          </div>
        )}

        {!isMasterKind && (type === 'number' || type === 'duration') && (
          <div className="field spread">
            <label>Graphe cumulatif</label>
            <div className="ctl-with-info">
              <BoolPill value={cumulative} onChange={setCumulative} />
              <InfoBubble title="Graphe cumulatif">
                Le graphe affiche la somme de toutes les entrées depuis le début plutôt que la valeur du jour —
                une courbe qui ne peut que monter, au lieu de suivre l’entrée du jour.
                Groupé par semaine ou par mois, chaque point porte le total atteint en fin de période.
              </InfoBubble>
            </div>
          </div>
        )}

        </div>

        <div className="card fd-card">
        <p className="section-label">Couleur</p>
        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,borderBottom:'none',paddingTop:0}}>
          <SwatchGrid value={color} onChange={setColor} />
        </div>
        </div>

        <div className="modal-actions">
          {isEdit && !display && <button className="danger" onClick={()=>{ if(confirm(isMaster(tracker) ? 'Supprimer ce master ?' : 'Supprimer ce tracker et toutes ses entrées ?')) onDelete(); }}>Supprimer</button>}
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
          <input type="email" value={email}
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
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="au moins 6 caractères" />
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
// app.food.jsx exécuté : la page Food y déclare ses composants, et App les
// utilise dès le premier rendu.
function mountTracklog(){
  if (window.__tkBootDone) window.__tkBootDone();
  ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
}
