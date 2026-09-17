/* ============================================================
   app.core.jsx — le socle, et rien qui s'affiche
   ------------------------------------------------------------
   Chargé en premier : c'est lui qui pose l'espace de noms que les
   autres fichiers trouvent déjà là (les hooks React, `supabase`,
   `dayKey`, `uid`, `startOfDay`…). Ce qui vit ici : le modèle de
   données, les registres (types, agrégats, styles, onglets, formes
   de courbe, granularités, services extérieurs, tris et
   groupements), le client Supabase et l'appel aux fonctions Edge,
   les mappers de lignes, les helpers de calcul et de format, et
   les préférences de compte.

   La règle qui décide ce qui entre : ça ne rend rien. Pas de JSX,
   pas de mesure du DOM. Un composant n'a pas sa place ici même
   quand il est court.
   ============================================================ */

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

   L'encre n'est pas « du noir » mais `var(--foreground)` : elle est presque noire sur
   le fond clair et presque blanche sur le fond sombre. Une couleur de tracker
   doit rester visible quel que soit le style, et c'est la seule façon d'avoir
   « la couleur du texte » plutôt qu'une valeur qui disparaît dans un thème. */
const COLOR_HUES = [35, 90, 145, 195, 250, 300, 350];
const COLOR_LIGHT = 0.63;
// Au-delà du gamut sRGB pour la plupart des teintes : le navigateur ramène la
// chroma au maximum affichable, ce qui est exactement « saturation à fond ».
const COLOR_CHROMA = 0.20;
const COLOR_GREY = 'oklch(0.62 0 0)';
const COLOR_INK = 'var(--foreground)';
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
   styles.css, plus une ligne ici. Rien d'autre à toucher : l'interface des
   paramètres se construit à partir de cette liste, et le petit script en tête
   de page valide la valeur stockée contre les mêmes identifiants.
   Pour en ajouter un : un bloc de tokens dans styles.css, une entrée ici, et
   son identifiant dans STYLE_IDS de Tracklog.html. */
const STYLES = [
  { id:'dark',       label:'Sombre', hint:'Aristide — canvas presque noir, encre crème', themeColor:'#100f0d' },
  { id:'light',      label:'Clair',  hint:'Aristide — canvas crème, mêmes os éditoriaux', themeColor:'#f6f2e9' },
  { id:'matrix',     label:'Matrix', hint:'Terminal — canvas noir, vert phosphore, coins carrés', themeColor:'#000000' },
  { id:'paper',      label:'Papier', hint:'Livre de poche — parchemin, encre brune, serifs', themeColor:'#f5f1e6' },
  { id:'paper-dark', label:'Papier sombre', hint:'Le même livre, lu de nuit', themeColor:'#2d2621' },
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

/* ---- Sources extérieures ---------------------------------------------------
   Un tracker peut être rempli par un service du dehors plutôt qu'à la main :
   même objet, mêmes graphes, mêmes entrées — c'est la SAISIE qui change, pas
   la nature de la chose suivie. D'où une section de plus dans ses réglages, et
   surtout pas un « type » de tracker à part : un bénéfice se lit comme
   n'importe quel nombre.

   `metrics` liste ce qu'un service sait rendre. Un service = une fonction Edge
   du même nom, qui expose /start /status /disconnect /sync ; en ajouter un
   revient à écrire cette fonction et une ligne ici. Rien d'autre dans l'app ne
   connaît le nom « Etsy ». */
const EXTERNAL_SERVICES = [
  { id:'etsy', label:'Etsy', metrics:[
    // Trois mots courts : la piste compacte ne doit jamais passer sur deux
    // lignes, et « Chiffre d'affaires » la faisait déborder de sa carte.
    // Ce que chacun veut dire exactement est dans la bulle, pas dans le bouton.
    { id:'net',     label:'Bénéfice',  unit:'€',
      hint:'Ce qui reste des ventes du jour une fois les frais Etsy retirés — mais avant le coût d’impression, qu’Etsy ne connaît pas.' },
    { id:'revenue', label:'Ventes',    unit:'€',
      hint:'Ce que les acheteurs ont payé ce jour-là, frais compris.' },
    { id:'orders',  label:'Commandes', unit:'',
      hint:'Le nombre de commandes passées ce jour-là.' },
  ] },
];
const serviceById = (id) => EXTERNAL_SERVICES.find(s => s.id === id) || null;
const metricOf = (serviceId, metricId) =>
  serviceById(serviceId)?.metrics.find(m => m.id === metricId) || null;

/* ============================================================
   Supabase — cloud persistence + auth
   ============================================================ */
const SUPABASE_URL = 'https://drrmqrhsfgermgblndzz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycm1xcmhzZmdlcm1nYmxuZHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTI1NzMsImV4cCI6MjA5OTY4ODU3M30.NOV3tKFH2vGI043cGZhB2yu9IlqFUVoXXP4JaXA-9vE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Parler à une fonction Edge au nom du compte. Le jeton de session part dans
   l'en-tête : la fonction sait qui demande sans que la page ait à le dire, et
   ce qu'elle garde pour nous (les jetons d'un service extérieur) ne redescend
   jamais ici. Un échec revient en `Error` — l'appelant décide quoi en montrer. */
async function callFunction(name, route, { method = 'POST', body } = {}){
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Session expirée — reconnecte-toi.');
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}/${route}`, {
      method,
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // « Failed to fetch » ne dit rien à qui n'écrit pas de code : c'est le
    // réseau, ou le service qui ne répond pas. On le dit dans ces mots-là.
    throw new Error('Service injoignable — vérifiez votre connexion.');
  }
  let payload = null;
  try { payload = await r.json(); } catch {}
  if (!r.ok) throw new Error(payload?.error || `Le service a répondu ${r.status}.`);
  return payload;
}

function trackerFromRow(r){
  return { id:r.id, name:r.name, type:r.type, unit:r.unit || undefined, scaleMin:r.scale_min ?? undefined, scaleMax:r.scale_max || undefined, scaleStep:r.scale_step || undefined, choices:Array.isArray(r.choices) ? r.choices : undefined, multiple:!!r.multiple, daily:!!r.daily, aggregate:r.aggregate || 'avg', members:Array.isArray(r.members) ? r.members : undefined, archived:!!r.archived, startDate:r.start_date || undefined, endDate:r.end_date || undefined, windowEnabled:r.window_enabled !== false, jokerEnabled:!!r.joker_enabled, cumulative:!!r.cumulative, curveStyle:isCurveStyle(r.curve_style) ? r.curve_style : 'line', chartGrain:GRAINS.some(g => g.id === r.chart_grain) ? r.chart_grain : 'day', goodDirection:r.good_direction || undefined, targetValue:r.target_value ?? undefined, externalSource:r.external_source || undefined, externalMetric:r.external_metric || undefined, externalLastSync:r.external_last_sync ?? undefined, order:r.order_index ?? 0, color:r.color, createdAt:r.created_at };
}
function trackerToRow(t, userId){
  return { id:t.id, user_id:userId, name:t.name, type:t.type, unit:t.unit || null, scale_min:t.scaleMin ?? null, scale_max:t.scaleMax || null, scale_step:t.scaleStep || null, choices:(t.choices && t.choices.length) ? t.choices : null, multiple:!!t.multiple, daily:!!t.daily, aggregate:t.aggregate || 'avg', members:(t.members && t.members.length) ? t.members : null, archived:!!t.archived, start_date:t.startDate || null, end_date:t.endDate || null, window_enabled:t.windowEnabled !== false, joker_enabled:!!t.jokerEnabled, cumulative:!!t.cumulative, curve_style:isCurveStyle(t.curveStyle) ? t.curveStyle : 'line', chart_grain:GRAINS.some(g => g.id === t.chartGrain) ? t.chartGrain : 'day', good_direction:t.goodDirection || null, target_value:t.targetValue ?? null, external_source:t.externalSource || null, external_metric:t.externalMetric || null, external_last_sync:t.externalLastSync ?? null, order_index:t.order ?? 0, color:t.color, created_at:t.createdAt };
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
// L'inverse : minuit local du jour nommé. Deux endroits en avaient besoin (le
// calendrier de la période d'activité, la synchro d'un service extérieur) —
// une seule écriture, sinon les deux dériveraient sur le fuseau.
const dayKeyToTs = (dk) => new Date(dk + 'T00:00:00').getTime();

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

function startOfMonth(ts){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function addMonths(ts, n){ const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth()+n, 1).getTime(); }


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
/* ---- Tri et groupement du rail --------------------------------------------
   Les trois registres que lisent le rail (app.jsx) et `buildDaySections` : ce
   sont des listes de choix, pas un rendu, d'où leur place ici à côté de TYPES
   et AGGREGATES. */
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
