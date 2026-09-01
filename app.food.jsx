/* ============================================================
   Tracklog — Food
   ------------------------------------------------------------
   Une page à part, avec ses propres données. Les trackers
   génériques (Tracker/Entry) ne peuvent pas porter un repas :
   une ligne de food c'est (jour, repas, aliment, quantité),
   pas une valeur scalaire. D'où trois tables dédiées :

     foods            = la bibliothèque d'aliments, valeurs
                        pour 100 g/ml. Source 'off' (scanné sur
                        Open Food Facts) ou 'custom' (saisi).
     food_logs        = ce qui a été mangé. Chaque ligne garde
                        un SNAPSHOT de ses valeurs : si une fiche
                        produit est corrigée plus tard, l'historique
                        ne se réécrit pas tout seul.
     nutrition_goals  = les objectifs du jour (kcal + macros).

   Ce fichier est un second <script type="text/babel">, chargé
   après app.jsx : tout ce que app.jsx déclare au premier niveau
   (supabase, uid, dayKey, useState…) est visible ici, et le
   montage de React est déclenché après les deux (mountTracklog).

   Le seul pont avec le reste de l'app : les 4 compteurs du jour
   (kcal, protéines, glucides, lipides) affichés dans Log → Jour
   comme une troisième catégorie, à côté des quotidiens et des
   « plusieurs par jour ». Rien d'autre n'est partagé.
   ============================================================ */

/* ---- Repas ---------------------------------------------------------------- */
const MEALS = [
  { id:'matin',     label:'Petit-déjeuner' },
  { id:'midi',      label:'Déjeuner' },
  { id:'soir',      label:'Dîner' },
  { id:'collation', label:'Collation' },
];
const MEAL_LABEL = Object.fromEntries(MEALS.map(m => [m.id, m.label]));

/* ---- Les items et leur origine ---------------------------------------------
   Tout ce qu'on peut verser dans une journée est un ITEM : une ligne de la
   table Ciqual, un produit Open Food Facts, un aliment ou un repas qu'on a
   créé soi-même, une analyse IA. Ils étaient déjà rangés dans des tiroirs
   séparés par le code (`food.source`), mais nulle part cette distinction
   n'était posée, nommée, ni lisible sur l'item lui-même : quatre origines,
   quatre façons d'arriver dans la bibliothèque, un seul registre pour les
   dire — et une pastille (`OriginTag`) que porte tout item, partout où il
   apparaît, pour qu'on sache d'où il vient sans ouvrir sa fiche.

   `source` reste le champ persisté (colonne `foods.source`, `meals.source`) ;
   ce registre en est la lecture. Une valeur inconnue retombe sur 'custom'
   plutôt que de faire disparaître la pastille — un item sans origine lisible
   serait pire qu'un item mal étiqueté.

   Les sous-catégories, elles, existaient déjà et ne sont pas refaites : le
   groupe Ciqual pour un aliment simple, la marque pour un produit à code, la
   provenance de l'analyse pour un item IA. `itemSub()` va les chercher là où
   chaque origine les range.                                                  */
const ITEM_ORIGINS = [
  { id:'ref',    label:'Aliment simple', tag:'simple', hint:'Table Ciqual (ANSES) — un aliment officiel sans étiquette : poulet, riz, framboise.' },
  { id:'off',    label:'Aliment à code', tag:'code',   hint:'Open Food Facts — un produit emballé, reconnu à son code-barres.' },
  { id:'ai',     label:'Item IA',        tag:'ia',     hint:'Décomposé par l’analyse IA à partir d’un texte ou d’une photo.' },
  { id:'custom', label:'Personnel',      tag:'perso',  hint:'Créé à la main, ici, par toi.' },
];
const ORIGIN_BY_ID = Object.fromEntries(ITEM_ORIGINS.map(o => [o.id, o]));
const FALLBACK_ORIGIN = ORIGIN_BY_ID.custom;

// L'origine d'un item, quoi qu'il arrive : un aliment, un repas, ou une ligne
// de journal (qui n'en porte pas et retombe donc sur « personnel »).
function itemOrigin(x){
  return (x && ORIGIN_BY_ID[x.source]) || FALLBACK_ORIGIN;
}
// La sous-catégorie, là où chaque origine la range déjà. Un aliment simple
// perd son groupe Ciqual en rejoignant la bibliothèque (la table `foods` n'a
// pas de colonne pour ça) : il garde en revanche son code `ciqual:…`, ce qui
// suffit à le retrouver dans la table — le même détour que `foodSourceUrl`.
function itemSub(x, refByBarcode){
  if (!x) return '';
  if (x.source === 'ref'){
    if (x.sub || x.group) return x.sub || x.group;
    const ref = refByBarcode && refByBarcode[x.barcode];
    return ref ? (ref.sub || ref.group || '') : '';
  }
  if (x.source === 'ai')  return Array.isArray(x.items) ? 'analyse d’un repas' : 'analyse';
  return x.brand || '';
}
// La pastille d'origine — le même objet visuel partout où un item se montre :
// résultat de recherche, carte de bibliothèque, carte de repas.
function OriginTag({ item, origin }){
  const o = origin || itemOrigin(item);
  return <span className={`item-tag o-${o.id}`} title={o.hint}>{o.tag}</span>;
}

/* ---- Les icônes de la page ------------------------------------------------
   Trois glyphes qui reviennent à plusieurs endroits chacun. Recopiés à la main
   là où on en avait besoin, ils auraient dérivé — c'est déjà arrivé à
   l'engrenage, qui s'était transformé en soleil ; ils sont donc définis une
   fois, comme GearIcon.                                                      */
function ScanIcon({ size = 15 }){
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M2 5.2V3.4A1.4 1.4 0 0 1 3.4 2h1.8M10.8 2h1.8A1.4 1.4 0 0 1 14 3.4v1.8M14 10.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8M5.2 14H3.4A1.4 1.4 0 0 1 2 12.6v-1.8" />
      <path d="M4.6 8h6.8" />
    </svg>
  );
}
function StarIcon({ size = 13, filled = false }){
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}
function PlusIcon({ size = 15 }){
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

// Une ligne de champ numérique — label à gauche, saisie et unité à droite —
// la même rangée dense que tout `.field` de l'app. Trois formulaires posaient
// chacun leur propre variante (une grille 4 colonnes ici, un style en ligne
// là) pour dire la même chose ; ils partagent maintenant celle-ci plutôt que
// de continuer à dériver chacun de son côté.
function NumField({ label, unit, value, onChange, onKeyDown, placeholder = '—' }){
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-num">
        <input type="number" step="any" min="0" inputMode="decimal" placeholder={placeholder}
               value={value ?? ''} onChange={e=>onChange(e.target.value)} onKeyDown={onKeyDown} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

/* ---- Ce qu'on compte -----------------------------------------------------
   Les 4 macros sont les compteurs de tête : ce sont elles qui remontent dans
   la page Log, elles qui ont un objectif, elles qui ont un graphe.
   Tout le reste (sucres, sel, vitamines…) est du détail affiché quand
   l'étiquette le porte. */
const FOOD_MACROS = [
  { key:'kcal',    label:'Calories',  short:'kcal', unit:'kcal', color:'var(--accent)' },
  { key:'protein', label:'Protéines', short:'prot', unit:'g',    color:'oklch(0.62 0.11 150)' },
  { key:'carbs',   label:'Glucides',  short:'gluc', unit:'g',    color:'oklch(0.62 0.11 250)' },
  { key:'fat',     label:'Lipides',   short:'lip',  unit:'g',    color:'oklch(0.68 0.11 80)' },
];
const MACRO_BY_KEY = Object.fromEntries(FOOD_MACROS.map(m => [m.key, m]));

// Le reste de l'étiquette réglementaire — toujours en grammes pour 100 g/ml.
const FOOD_DETAILS = [
  { key:'sugars', label:'dont sucres',  unit:'g', off:'sugars' },
  { key:'sat',    label:'dont saturés', unit:'g', off:'saturated-fat' },
  { key:'fiber',  label:'Fibres',       unit:'g', off:'fiber' },
  { key:'salt',   label:'Sel',          unit:'g', off:'salt' },
];

/* Micronutriments. `off` = clé Open Food Facts (leurs valeurs _100g sont
   normalisées en grammes) ; `unit` = l'unité dans laquelle on stocke et affiche,
   d'où le facteur de conversion depuis le gramme. `rda` = repère nutritionnel
   journalier européen (VNR), pour afficher un % qui veut dire quelque chose.

   Attention : la couverture des micros sur les produits emballés est faible.
   Un aliment perso saisi à la main, ou plus tard une table CIQUAL, est la
   seule façon d'en avoir sur l'essentiel de ce qu'on mange. */
const FOOD_MICROS = [
  { key:'calcium',    label:'Calcium',      unit:'mg', off:'calcium',     rda:1000 },
  { key:'iron',       label:'Fer',          unit:'mg', off:'iron',        rda:14 },
  { key:'magnesium',  label:'Magnésium',    unit:'mg', off:'magnesium',   rda:375 },
  { key:'potassium',  label:'Potassium',    unit:'mg', off:'potassium',   rda:2000 },
  { key:'phosphorus', label:'Phosphore',    unit:'mg', off:'phosphorus',  rda:700 },
  { key:'zinc',       label:'Zinc',         unit:'mg', off:'zinc',        rda:10 },
  { key:'sodium',     label:'Sodium',       unit:'mg', off:'sodium',      rda:2400 },
  { key:'vitaminA',   label:'Vitamine A',   unit:'µg', off:'vitamin-a',   rda:800 },
  { key:'vitaminC',   label:'Vitamine C',   unit:'mg', off:'vitamin-c',   rda:80 },
  { key:'vitaminD',   label:'Vitamine D',   unit:'µg', off:'vitamin-d',   rda:5 },
  { key:'vitaminE',   label:'Vitamine E',   unit:'mg', off:'vitamin-e',   rda:12 },
  { key:'vitaminB6',  label:'Vitamine B6',  unit:'mg', off:'vitamin-b6',  rda:1.4 },
  { key:'vitaminB9',  label:'Vitamine B9',  unit:'µg', off:'vitamin-b9',  rda:200 },
  { key:'vitaminB12', label:'Vitamine B12', unit:'µg', off:'vitamin-b12', rda:2.5 },
];
const UNIT_FROM_GRAM = { g:1, mg:1000, 'µg':1e6 };

// Objectifs par défaut tant que rien n'est réglé — un ordre de grandeur, pas une
// prescription : la page pousse à les remplacer dès la première ouverture.
const DEFAULT_GOALS = { kcal:2200, protein:130, carbs:250, fat:70 };

/* ---- Objectifs de macros : trois façons d'arriver au même gramme ---------
   Un objectif de macro n'est pas toujours pensé en grammes : « 2 g/kg de
   protéines » ou « 30 % des calories en lipides » sont des règles qu'on fixe
   une fois et qui doivent suivre le poids ou l'objectif calorique quand ils
   changent, pas un nombre à recalculer à la main à chaque fois. `mode` +
   `ratio` sont donc la source de vérité (`ratio` = un pourcentage pour
   'percent', un g/kg pour 'perkg', ignoré pour 'grams') ; les grammes qui en
   sortent sont ce que le reste de l'app lit — rien d'autre n'a besoin de
   savoir qu'un objectif vient d'un ratio plutôt que d'un chiffre posé. */
const GOAL_MODES = [
  { id:'grams',   label:'Grammes', unit:(m)=>m.unit },
  { id:'percent', label:'% kcal',  unit:()=>'%' },
  { id:'perkg',   label:'g/kg',    unit:()=>'g/kg' },
];
// 4 kcal/g pour les protéines et les glucides, 9 pour les lipides.
const MACRO_KCAL_FACTOR = { protein:4, carbs:4, fat:9 };

function macroGramsFromRatio(macroKey, mode, ratio, kcalTarget, weightKg){
  if (ratio == null || isNaN(ratio)) return null;
  if (mode === 'percent'){
    if (!kcalTarget) return null;
    return (kcalTarget * (ratio / 100)) / MACRO_KCAL_FACTOR[macroKey];
  }
  if (mode === 'perkg'){
    if (!weightKg) return null;
    return ratio * weightKg;
  }
  return ratio; // 'grams' : le ratio EST le grammage.
}

/* ============================================================
   Lignes ↔ objets
   ============================================================ */
function foodFromRow(r){
  return { id:r.id, source:r.source || 'custom', barcode:r.barcode || null, name:r.name,
           brand:r.brand || '', basis:r.basis === 'ml' ? 'ml' : 'g', servingG:r.serving_g != null ? Number(r.serving_g) : null,
           imageUrl:r.image_url || '', nutriments:r.nutriments || {}, favorite:!!r.favorite,
           lastUsedAt:r.last_used_at ? Number(r.last_used_at) : null, createdAt:Number(r.created_at) };
}
function foodToRow(f, userId){
  return { id:f.id, user_id:userId, source:f.source || 'custom', barcode:f.barcode || null, name:f.name,
           brand:f.brand || null, basis:f.basis === 'ml' ? 'ml' : 'g', serving_g:f.servingG ?? null,
           image_url:f.imageUrl || null, nutriments:f.nutriments || {}, favorite:!!f.favorite,
           last_used_at:f.lastUsedAt ?? null, created_at:f.createdAt };
}
/* Un repas enregistré = un preset : une liste d'ingrédients pesés qu'on rajoute
   d'un coup, plus une recette facultative (juste des étapes, pas un objet à
   part). Les ingrédients portent leurs valeurs POUR 100 g et leur poids
   séparément — corriger un poids recalcule les macros sans rien redemander. */
function mealFromRow(r){
  return { id:r.id, name:r.name, source:r.source || 'custom', items:Array.isArray(r.items) ? r.items : [],
           steps:Array.isArray(r.steps) ? r.steps : [], favorite:!!r.favorite,
           createdAt:Number(r.created_at), lastUsedAt:r.last_used_at ? Number(r.last_used_at) : null };
}
function mealToRow(m, userId){
  return { id:m.id, user_id:userId, name:m.name, source:m.source || 'custom',
           items:m.items || [], steps:m.steps || [], favorite:!!m.favorite,
           created_at:m.createdAt, last_used_at:m.lastUsedAt ?? null };
}

function foodLogFromRow(r){
  return { id:r.id, day:r.day, meal:r.meal || 'autre', foodId:r.food_id || null, name:r.name,
           brand:r.brand || '', qty:Number(r.qty), unit:r.unit || 'g', grams:Number(r.grams),
           nutriments:r.nutriments || {}, ts:Number(r.ts) };
}
function foodLogToRow(l, userId){
  return { id:l.id, user_id:userId, day:l.day, meal:l.meal || 'autre', food_id:l.foodId || null, name:l.name,
           brand:l.brand || null, qty:l.qty, unit:l.unit || 'g', grams:l.grams,
           nutriments:l.nutriments || {}, ts:l.ts };
}

/* ============================================================
   Calculs
   ============================================================ */
// Les valeurs d'un aliment sont pour 100 g/ml ; une ligne de log les porte en
// absolu (ce qui a été réellement avalé).
function scaleNutriments(per100, grams){
  const f = (Number(grams) || 0) / 100;
  const out = {};
  for (const k in per100){
    const v = per100[k];
    if (typeof v === 'number' && isFinite(v)) out[k] = v * f;
  }
  return out;
}
function sumNutriments(list){
  const out = {};
  for (const n of list){
    if (!n) continue;
    for (const k in n){
      const v = n[k];
      if (typeof v === 'number' && isFinite(v)) out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}
// Combien de grammes vaut la quantité saisie, selon l'unité choisie.
function resolveGrams(qty, unit, food){
  const q = Number(qty) || 0;
  if (unit === 'portion') return q * (food?.servingG || 0);
  return q; // 'g' et 'ml' : on compte 1 ml = 1 g, comme toutes les étiquettes
}
function fmtNum(v, d = 0){
  if (v == null || !isFinite(v)) return '—';
  const r = Number(v).toFixed(d);
  return d > 0 ? String(parseFloat(r)) : r;
}
// Un total de macro : arrondi au gramme, sauf sous 10 g où le dixième compte.
function fmtMacro(v){
  if (v == null || !isFinite(v)) return '—';
  return v < 10 ? fmtNum(v, 1) : fmtNum(v, 0);
}
function shiftDayKey(dk, n){
  const [y, m, d] = dk.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return dayKey(dt.getTime());
}
function dayKeyToTs(dk){
  const [y, m, d] = dk.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
// Le nom d'un aliment tel qu'on veut le lire dans une liste.
function foodLabel(f){
  return f.brand ? `${f.name} · ${f.brand}` : f.name;
}

/* ---- Ingrédients ----------------------------------------------------------
   La monnaie commune entre l'analyse IA et les repas enregistrés : un nom, un
   poids, et des valeurs pour 100 g. Les deux fonctionnalités manipulent
   exactement la même chose, donc un seul éditeur les sert toutes les deux, et
   un repas peut naître d'une analyse sans conversion. */
function mkItem(partial = {}){
  return { id: uid('it_'), name:'', grams:100, per100:{}, foodId:null, note:'', ...partial };
}
// Un ingrédient de la bibliothèque garde son lien : la ligne de journal qu'il
// produira pointera vers la fiche, comme un ajout normal.
function itemFromFood(food, grams){
  return mkItem({ name: food.name, grams: grams ?? (food.servingG || 100),
                  per100: food.nutriments || {}, foodId: food.id || null });
}
const itemNutriments = (it) => scaleNutriments(it.per100 || {}, Number(it.grams) || 0);
const itemsTotals = (items) => sumNutriments((items || []).map(itemNutriments));

/* ============================================================
   Open Food Facts — le seul appel réseau de la page
   ------------------------------------------------------------
   Gratuit, sans clé, CORS ouvert, et de loin la meilleure
   couverture des produits vendus en France. En échange :
   qualité inégale, beaucoup de fiches sans valeurs
   nutritionnelles — d'où le chemin « compléter à la main »
   partout où un produit revient vide — et des quotas serrés
   côté recherche, d'où le cache et le limiteur plus bas.
   ============================================================ */
const OFF_BASE   = 'https://world.openfoodfacts.org';
const OFF_FR     = 'https://fr.openfoodfacts.org';
const OFF_SEARCH = 'https://search.openfoodfacts.org';   // « search-a-licious », le moteur actuel
const OFF_FIELDS = [
  'code','product_name','product_name_fr','generic_name_fr','brands','quantity',
  'serving_size','serving_quantity','image_small_url','image_front_small_url','nutriments',
].join(',');

// Liens publics, pour pouvoir toujours aller vérifier la source à la main.
const offProductUrl = (code) => code ? `${OFF_FR}/produit/${encodeURIComponent(String(code))}` : null;
const offSearchUrl  = (q) => `${OFF_FR}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process`;

async function offJson(url, { timeoutMs = 12000, signal } = {}){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const relay = () => ctrl.abort();
  if (signal){
    if (signal.aborted) ctrl.abort();
    signal.addEventListener('abort', relay);
  }
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    // 429/503 = quota ou surcharge côté OFF : le dire tel quel plutôt que « erreur réseau ».
    if (r.status === 429) throw new Error('Trop de requêtes d’un coup — Open Food Facts nous met en pause une minute.');
    if (!r.ok) throw new Error(`Open Food Facts a répondu ${r.status}.`);
    return await r.json();
  } catch(e){
    // Safari dit « Load failed », Chrome « Failed to fetch » : ni l'un ni l'autre
    // n'aide, alors qu'ici la cause est presque toujours la même.
    if (e && e.name === 'AbortError') throw e;
    if (e instanceof TypeError) throw new Error('Open Food Facts injoignable (réseau, blocage ou quota).');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }
}

// null = code inconnu de la base (≠ erreur réseau, qui remonte en exception).
async function offFetchProduct(barcode){
  const path = `/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`;
  let last;
  for (const base of [OFF_BASE, OFF_FR]){          // le miroir fr sert de repli
    try {
      const j = await offJson(base + path);
      const p = j && j.product;
      if (!p || j.status === 0 || j.status === 'failure') return null;
      return offToFood(p, barcode);
    } catch(e){
      if (e.name === 'AbortError') throw e;
      last = e;
    }
  }
  throw last || new Error('Recherche impossible.');
}

/* ---- Recherche plein texte ------------------------------------------------
   OFF impose un quota serré sur la recherche (de l'ordre de 10 requêtes par
   minute et par IP) et répond 429 au-delà — c'est ce qui, côté Safari,
   s'affiche en « Load failed ». Trois garde-fous, dans cet ordre :
     · un cache par requête, pour que revenir en arrière ne coûte rien ;
     · un seau à jetons, qui espace les appels sous le quota ;
     · deux moteurs, le nouveau puis l'ancien, avant de rendre les armes.   */

const searchCache = new Map();                  // requête normalisée → résultats
const SEARCH_BUCKET = { tokens: 6, max: 6, refillMs: 6500, last: Date.now() };
function takeSearchToken(){
  const now = Date.now();
  const gained = Math.floor((now - SEARCH_BUCKET.last) / SEARCH_BUCKET.refillMs);
  if (gained > 0){
    SEARCH_BUCKET.tokens = Math.min(SEARCH_BUCKET.max, SEARCH_BUCKET.tokens + gained);
    SEARCH_BUCKET.last = now;
  }
  if (SEARCH_BUCKET.tokens < 1) return false;
  SEARCH_BUCKET.tokens -= 1;
  return true;
}
// Combien de temps avant le prochain jeton — pour l'annoncer plutôt que d'échouer.
function searchCooldownMs(){
  return Math.max(0, SEARCH_BUCKET.refillMs - (Date.now() - SEARCH_BUCKET.last));
}

const SEARCH_FIELDS = 'code,product_name,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,image_url';

// L'index de recherche est multilingue : un champ y est soit une chaîne,
// soit un objet { fr: …, en: …, main: … }.
function pickLang(v){
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object'){
    for (const k of ['fr','main','en']) if (typeof v[k] === 'string' && v[k]) return v[k];
    for (const k in v) if (typeof v[k] === 'string' && v[k]) return v[k];
  }
  return '';
}

// search-a-licious → la même forme de fiche que l'API produit.
function searchHitToFood(h){
  return offToFood({
    code: h.code,
    product_name_fr: pickLang(h.product_name),
    product_name: pickLang(h.product_name),
    generic_name_fr: pickLang(h.generic_name),
    brands: Array.isArray(h.brands) ? h.brands.join(', ') : (h.brands || ''),
    quantity: pickLang(h.quantity),
    serving_size: pickLang(h.serving_size),
    serving_quantity: h.serving_quantity,
    image_front_small_url: h.image_url || '',
    nutriments: h.nutriments || {},
  }, h.code);
}

async function searchViaSearchalicious(q, signal, withFields){
  const url = `${OFF_SEARCH}/search?q=${encodeURIComponent(q)}&langs=fr,en&page_size=25`
            + (withFields ? `&fields=${encodeURIComponent(SEARCH_FIELDS)}` : '');
  const j = await offJson(url, { timeoutMs: 12000, signal });
  const hits = (j && j.hits) || [];
  return hits.map(searchHitToFood).filter(f => f && f.name);
}

async function searchViaCgi(base, q, signal){
  const url = `${base}/cgi/search.pl?search_terms=${encodeURIComponent(q)}`
            + `&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`;
  const j = await offJson(url, { timeoutMs: 15000, signal });
  const list = (j && j.products) || [];
  return list.map(p => offToFood(p, p.code)).filter(f => f && f.name);
}

// Les moteurs sont essayés dans l'ordre ; on s'arrête au premier qui répond,
// même les mains vides — sinon un mot rare consommerait tout le quota.
const SEARCH_ENGINES = [
  { label:'moteur OFF',        run:(q,s) => searchViaSearchalicious(q, s, true) },
  { label:'moteur OFF (brut)', run:(q,s) => searchViaSearchalicious(q, s, false) },
  { label:'ancien moteur',     run:(q,s) => searchViaCgi(OFF_BASE, q, s) },
  { label:'ancien moteur fr',  run:(q,s) => searchViaCgi(OFF_FR, q, s) },
];

// Renvoie { list, via, cached }. Lève une erreur seulement si *tous* les
// moteurs ont échoué — le message dit alors lequel a dit quoi.
async function offSearchFoods(query, { signal, force = false } = {}){
  const q = query.trim();
  const key = q.toLowerCase();
  if (!force && searchCache.has(key)) return { ...searchCache.get(key), cached:true };
  if (!takeSearchToken()){
    const s = Math.ceil(searchCooldownMs() / 1000);
    throw new Error(`Pause de ${s} s — Open Food Facts limite le nombre de recherches par minute.`);
  }
  const errors = [];
  for (const engine of SEARCH_ENGINES){
    try {
      const list = await engine.run(q, signal);
      const out = { list, via: engine.label };
      searchCache.set(key, out);
      return out;
    } catch(e){
      if (e.name === 'AbortError') throw e;
      errors.push(`${engine.label} — ${e.message}`);
    }
  }
  throw new Error(errors.join(' · '));
}

const offNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

// Une fiche OFF → un aliment de la bibliothèque. Tout est ramené « pour 100 »,
// les micros convertis du gramme vers leur unité d'affichage.
function offToFood(p, fallbackCode){
  const n = p.nutriments || {};
  const nutriments = {};

  let kcal = offNum(n['energy-kcal_100g']);
  if (kcal == null){
    const kj = offNum(n['energy-kj_100g'])
            ?? (String(n.energy_unit || '').toLowerCase() === 'kj' ? offNum(n.energy_100g) : null);
    if (kj != null) kcal = kj / 4.184;
  }
  if (kcal != null) nutriments.kcal = Math.round(kcal);

  const macro = { protein:'proteins', carbs:'carbohydrates', fat:'fat' };
  for (const key in macro){
    const v = offNum(n[`${macro[key]}_100g`]);
    if (v != null) nutriments[key] = v;
  }
  for (const d of FOOD_DETAILS){
    const v = offNum(n[`${d.off}_100g`]);
    if (v != null) nutriments[d.key] = v;
  }
  for (const m of FOOD_MICROS){
    const v = offNum(n[`${m.off}_100g`]);   // en grammes chez OFF
    if (v != null) nutriments[m.key] = v * (UNIT_FROM_GRAM[m.unit] || 1);
  }

  const qty = String(p.quantity || '');
  const serving = String(p.serving_size || '');
  const basis = /(^|\s|\d)(ml|cl|l)\b/i.test(qty) || /\bml\b/i.test(serving) ? 'ml' : 'g';

  let servingG = offNum(p.serving_quantity);
  if (servingG == null){
    const m = serving.match(/([\d.,]+)\s*(g|ml)/i);
    if (m) servingG = parseFloat(m[1].replace(',', '.'));
  }

  const name = (p.product_name_fr || p.product_name || p.generic_name_fr || '').trim();
  const brand = String(p.brands || '').split(',')[0].trim();

  return {
    id: uid('f_'),
    source: 'off',
    barcode: String(p.code || fallbackCode || '') || null,
    name: name || (brand ? brand : `Produit ${p.code || fallbackCode || ''}`.trim()),
    brand,
    basis,
    servingG: servingG && servingG > 0 ? servingG : null,
    imageUrl: p.image_front_small_url || p.image_small_url || '',
    nutriments,
    favorite: false,
    lastUsedAt: null,
    createdAt: Date.now(),
  };
}

// Une fiche sans calories n'est pas exploitable telle quelle.
const foodIsUsable = (f) => !!f && typeof f.nutriments?.kcal === 'number';

/* ============================================================
   La table des aliments simples
   ------------------------------------------------------------
   Open Food Facts référence des produits emballés : très bon
   pour un paquet de biscuits, muet sur un blanc de poulet, une
   pomme de terre ou des framboises — qui n'ont pas d'étiquette.
   D'où cette table, livrée avec l'app : la table Ciqual 2025 de
   l'ANSES, 3 341 aliments français, crus et cuits, avec leurs
   micronutriments — que les étiquettes n'affichent presque
   jamais.

   Le fichier est colonnaire (une liste de clés, un tableau de
   valeurs par aliment) : répéter « protein » 3 341 fois coûtait
   300 Ko pour rien. Il est servi depuis le même domaine que
   l'app, donc sans dépendre du réseau de personne, et il tient
   en cache une fois chargé.
   ============================================================ */
const REF_URL = 'foods-ref.json';
const CIQUAL_FOOD_URL = 'https://ciqual.anses.fr/#/aliments/';

const deburr = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Ciqual nomme ses aliments au singulier — « Lentille, cuite » — alors qu'on
// cherche « lentilles ». Les deux côtés perdent donc leur pluriel avant
// comparaison, sinon la moitié des recherches passent à côté de l'essentiel
// et ne ramènent que des plats préparés.
const stem = (s) => deburr(s).replace(/([a-z])[sx](?![a-z])/g, '$1');

let refCache = null, refLoader = null;
function loadRefFoods(){
  if (refCache) return Promise.resolve(refCache);
  if (refLoader) return refLoader;
  refLoader = fetch(REF_URL)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`table des aliments : ${r.status}`)))
    .then(doc => { refCache = expandRefTable(doc); return refCache; })
    .catch(e => { refLoader = null; throw e; });
  return refLoader;
}

// Le fichier colonnaire → des aliments de la même forme que les autres.
// `hay` est calculé ici une fois pour toutes : la recherche tape dessus à
// chaque lettre, sur 3 341 lignes, et ne peut pas se permettre de
// re-normaliser les accents à chaque fois.
function expandRefTable(doc){
  const keys = doc.keys || [];
  const groups = doc.groups || [];
  return (doc.foods || []).map(row => {
    const [code, name, groupIdx, basis, sub, vals] = row;
    const nutriments = {};
    for (let i = 0; i < keys.length; i++){
      if (vals[i] != null) nutriments[keys[i]] = vals[i];
    }
    const group = groups[groupIdx] || '';
    return {
      id: 'ref_' + code, source:'ref', barcode: 'ciqual:' + code,
      name, brand:'', basis: basis === 'ml' ? 'ml' : 'g', servingG:null, imageUrl:'',
      nutriments, ciqual: code, group, sub: sub || '',
      hay: stem(name + ' ' + (sub || '') + ' ' + group),
      nameHay: stem(name),
      nameRaw: deburr(name),
      favorite:false, lastUsedAt:null, createdAt: Date.now(),
    };
  });
}

// Recherche locale, instantanée, insensible aux accents.
function searchRefFoods(list, query, limit = 12){
  const words = stem(query).split(/\s+/).filter(Boolean);
  // Sans pluriel ni accent, « pâtes » et « pâté » deviennent le même mot. Le
  // filtre reste large (c'est lui qui trouve « Lentille » depuis « lentilles »),
  // mais le mot tel qu'il a été tapé rapporte un bonus au classement : les
  // vraies pâtes repassent devant le pâté breton.
  const rawWords = deburr(query).split(/\s+/).filter(Boolean);
  if (!words.length || !list) return [];
  const scored = [];
  for (const f of list){
    if (!words.every(w => f.hay.includes(w))) continue;
    // Trois niveaux, du plus au moins parlant : l'aliment *est* ce qu'on cherche
    // (« Banane, chair sans peau, crue » — le nom, puis une virgule, puis la
    // préparation), le nom commence par le mot (« Banane plantain »), le mot est
    // quelque part. À score égal, le nom le plus court gagne : « Framboise,
    // crue » avant « Framboise, surgelée, non cuite, avec sucre ajouté ».
    const name = f.nameHay;
    let score = 0;
    for (const w of words){
      if (name === w || name.startsWith(w + ',')) score += 5;
      else if (name.startsWith(w)) score += 3;
      else if (name.includes(w)) score += 2;
    }
    for (const w of rawWords){
      if (f.nameRaw.includes(w)) score += 2;
    }
    scored.push({ f, score: score * 200 - f.name.length });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.f);
}

// D'où vient la fiche : produit Open Food Facts, ou aliment de la table.
function foodSourceUrl(food, refByBarcode){
  if (!food) return null;
  if (food.source === 'off' && food.barcode) return offProductUrl(food.barcode);
  const code = food.ciqual
    || (String(food.barcode || '').startsWith('ciqual:') ? food.barcode.slice(7) : null)
    || (refByBarcode && refByBarcode[food.barcode] && refByBarcode[food.barcode].ciqual);
  return code ? CIQUAL_FOOD_URL + encodeURIComponent(code) : null;
}

/* ============================================================
   Le décodeur de codes-barres
   ------------------------------------------------------------
   Ouvrir la caméra est facile ; décoder ne l'est pas. Ce qui
   fait la différence sur un téléphone, dans l'ordre :
     · ne donner au décodeur que la bande centrale du cadre —
       un EAN qui occupe 20 % de l'image passe rarement, le même
       recadré passe presque toujours ;
     · retenter la même image pivotée d'un quart de tour, parce
       qu'un code tenu à la verticale est invisible pour un
       décodeur 1D qui ne balaie que des lignes horizontales ;
     · et garder deux moteurs : BarcodeDetector, natif et
       instantané mais absent de Safari (donc de tout iPhone),
       et ZXing, chargé à la demande depuis un CDN.
   Le scanner ne fait plus que scanner : il n'a ni photo de
   secours ni champ à lui. Un code qui ne se lit pas se tape
   dans le champ à côté — la barre de recherche, ou le champ
   code-barres de l'ajout rapide — qui reconnaissent une suite
   de chiffres pour ce qu'elle est. Une seule façon d'entrer un
   code au clavier, au lieu de trois selon l'endroit.
   ============================================================ */
const ZXING_SRCS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js',
];
let zxingLoader = null;
function loadZXing(){
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLoader) return zxingLoader;
  const one = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => window.ZXing ? resolve(window.ZXing) : reject(new Error('vide'));
    s.onerror = () => reject(new Error('réseau'));
    document.head.appendChild(s);
  });
  zxingLoader = ZXING_SRCS.reduce(
    (chain, src) => chain.catch(() => one(src)),
    Promise.reject(new Error('init'))
  ).catch(e => {
    zxingLoader = null;
    throw new Error('Le décodeur n’a pas pu se charger (réseau ou bloqueur).');
  });
  return zxingLoader;
}

// Un décodeur = un nom + une fonction qui rend un code (ou null) pour un canvas.
async function makeNativeDecoder(){
  if (!('BarcodeDetector' in window)) return null;
  const wanted = ['ean_13','ean_8','upc_a','upc_e','code_128'];
  let formats = wanted;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const keep = wanted.filter(f => supported.includes(f));
    if (!keep.length) return null;                 // caméra sans format produit
    formats = keep;
  } catch {}
  let det;
  try { det = new window.BarcodeDetector({ formats }); }
  catch { try { det = new window.BarcodeDetector(); } catch { return null; } }
  return {
    name: 'natif',
    decode: async (canvas) => {
      const found = await det.detect(canvas);
      return found && found.length ? found[0].rawValue : null;
    },
  };
}

async function makeZXingDecoder(){
  const ZX = await loadZXing();
  const formats = [
    ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
    ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
  ];
  // Deux jeux d'options, parce que l'écart de coût est énorme : une image sans
  // code se rejette en ~10 ms, ou en ~240 ms si on demande à ZXing d'insister.
  // Balayer beaucoup d'images vite bat largement en insister sur chacune —
  // la main bouge, la mise au point cherche, et une seule image nette suffit.
  const hintsFast = new Map([[ZX.DecodeHintType.POSSIBLE_FORMATS, formats]]);
  const hintsHard = new Map(hintsFast);
  hintsHard.set(ZX.DecodeHintType.TRY_HARDER, true);
  const reader = new ZX.MultiFormatReader();
  reader.setHints(hintsFast);
  return {
    name: 'zxing',
    decode: async (canvas, hard) => {
      // La rotation intégrée à ZXing modifie la source sur place sans corriger
      // ses dimensions : on lui donne des images déjà orientées (rotateCanvas).
      const src = new ZX.HTMLCanvasElementLuminanceSource(canvas);
      try {
        const res = reader.decode(new ZX.BinaryBitmap(new ZX.HybridBinarizer(src)), hard ? hintsHard : hintsFast);
        return res ? res.getText() : null;
      } catch {                 // NotFoundException : rien sur cette image
        return null;
      } finally { reader.reset(); }
    },
  };
}

// Le quart de tour, fait à la main : un code tenu à la verticale est invisible
// pour un décodeur 1D, qui ne balaie que des lignes horizontales.
function rotateCanvas(src, dst){
  dst.width = src.height;
  dst.height = src.width;
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.save();
  ctx.translate(dst.width / 2, dst.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  ctx.restore();
  return dst;
}

// Recopie une région de la source dans le canvas de travail. `tight` = la bande
// centrale (là où l'utilisateur vise), sinon l'image entière.
function drawRegion(source, canvas, tight, srcW, srcH, maxW = 900){
  const vw = srcW, vh = srcH;
  if (!vw || !vh) return false;
  const cw = Math.round(vw * (tight ? 0.92 : 1));
  const ch = Math.round(vh * (tight ? 0.46 : 1));
  const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
  // Plafonner la largeur de travail : au-delà, le décodage coûte cher sans rien
  // gagner — un EAN reste lisible bien en dessous de la résolution du capteur.
  const scale = Math.min(1, maxW / cw);
  canvas.width = Math.max(2, Math.round(cw * scale));
  canvas.height = Math.max(2, Math.round(ch * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  return true;
}

// Le tour de rôle des tentatives. Trois passes rapides — le cas courant, le
// code tenu à la verticale, le code hors du réticule — puis une passe lente
// qui insiste, pour l'image un peu floue ou un peu de travers.
const PASSES = [
  { tight:true,  rotate:false, hard:false },
  { tight:true,  rotate:true,  hard:false },
  { tight:false, rotate:false, hard:false },
  { tight:true,  rotate:false, hard:true  },
];

const cleanCode = (raw) => String(raw || '').replace(/\D/g, '');
const codeLooksValid = (c) => c.length === 8 || c.length === 12 || c.length === 13 || c.length === 14;

function cameraErrorMessage(e){
  const n = e && e.name;
  if (!window.isSecureContext) return 'La caméra n’est accessible qu’en HTTPS.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, puis réessaie.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Aucune caméra utilisable sur cet appareil.';
  if (n === 'NotReadableError') return 'La caméra est déjà utilisée par une autre application.';
  return (e && e.message) || 'La caméra n’a pas pu démarrer.';
}

// La caméra est un interrupteur, pas un effet de bord de l'ouverture de l'onglet :
// tant qu'il est éteint, aucun flux n'est demandé (donc aucune pastille
// « enregistrement » ni aucune consommation de batterie). Le choix suit le compte
// (useSyncedPref, app.jsx) avec un miroir local : allumé une fois, le scanner
// démarre seul à chaque ouverture, sur cet appareil comme sur l'autre.
// L'autorisation du navigateur, elle, reste évidemment propre à chaque appareil :
// ce qu'on synchronise est l'intention « je veux la caméra », pas la permission.
const CAMERA_KEY = 'tracklog.cameraOn';

function FoodScanner({ onCode }){
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const stopRef = useRef(null);
  const doneRef = useRef(false);
  const accountPrefs = useContext(AccountPrefsContext) || LOCAL_ONLY_PREFS;
  const [camOn, setCamOn] = useSyncedPref(accountPrefs, 'cameraOn', CAMERA_KEY, false);
  const [status, setStatus] = useState('init'); // init | live | error
  const [err, setErr] = useState('');
  const [engine, setEngine] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(null);       // { min, max, step, value } si l'appareil le permet

  // onCode change à chaque rendu du parent ; le passer en dépendance
  // relancerait la caméra en boucle.
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  const hit = useCallback((raw) => {
    if (doneRef.current) return false;
    const code = cleanCode(raw);
    if (!codeLooksValid(code)) return false;
    doneRef.current = true;
    try { navigator.vibrate && navigator.vibrate(60); } catch {}
    onCodeRef.current(code);
    return true;
  }, []);

  const toggleCamera = () => {
    const next = !camOn;
    if (!next){ setStatus('init'); setErr(''); setAttempts(0); }
    setCamOn(next);
  };

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    (async () => {
      if (!camOn) return;             // interrupteur éteint : aucun flux demandé
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        setStatus('error');
        setErr('Ce navigateur ne donne pas accès à la caméra. Tape le code dans le champ à côté.');
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal:'environment' }, width:{ ideal:1920 }, height:{ ideal:1080 } },
          audio: false,
        });
      } catch(e){
        if (!cancelled){ setStatus('error'); setErr(cameraErrorMessage(e)); }
        return;
      }
      if (cancelled){ stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video){ stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');   // iOS : sans ça, la vidéo passe en plein écran
      try { await video.play(); } catch {}
      if (cancelled) return;
      setStatus('live');

      const track = stream.getVideoTracks()[0];
      let caps = {};
      try { caps = (track.getCapabilities && track.getCapabilities()) || {}; } catch {}
      setCanTorch(!!caps.torch);
      if (caps.zoom && caps.zoom.max > caps.zoom.min){
        let value = caps.zoom.min;
        try { value = track.getSettings().zoom ?? caps.zoom.min; } catch {}
        setZoom({ min:caps.zoom.min, max:caps.zoom.max, step:caps.zoom.step || 0.1, value });
      }
      // Mise au point continue quand l'appareil l'expose — un code net se lit, un code flou non.
      try { await track.applyConstraints({ advanced:[{ focusMode:'continuous' }] }); } catch {}

      const decoders = [];
      const native = await makeNativeDecoder();
      if (native) decoders.push(native);
      if (!decoders.length){
        try { decoders.push(await makeZXingDecoder()); }
        catch(e){
          if (!cancelled){ setStatus('error'); setErr(e.message || 'Décodeur indisponible.'); }
          return;
        }
      }
      if (cancelled) return;
      setEngine(decoders.map(d => d.name).join(' + '));

      const canvas = canvasRef.current || document.createElement('canvas');
      canvasRef.current = canvas;
      const rot = document.createElement('canvas');
      let n = 0;
      let secondTried = false;

      const tryAll = async (c, hard) => {
        for (const d of decoders){
          try {
            const code = await d.decode(c, hard);
            if (code) return code;
          } catch {}
        }
        return null;
      };

      const tick = async () => {
        if (cancelled || doneRef.current) return;
        const v = videoRef.current;
        if (v && v.videoWidth){
          // Le cas courant — code horizontal dans le réticule — passe seul et
          // souvent ; le quart de tour et l'image entière ne coûtent leur temps
          // qu'un tour sur trois chacun.
          const pass = PASSES[n % PASSES.length];
          if (drawRegion(v, canvas, pass.tight, v.videoWidth, v.videoHeight)){
            let code = await tryAll(canvas, pass.hard);
            if (!code && pass.rotate) code = await tryAll(rotateCanvas(canvas, rot), pass.hard);
            if (code && hit(code)) return;
          }
          n += 1;
          if (n % 5 === 0) setAttempts(n);
          // Le natif a eu sa chance : on lui adjoint ZXing plutôt que de s'entêter.
          if (!secondTried && n > 45 && decoders.length === 1 && decoders[0].name === 'natif'){
            secondTried = true;
            makeZXingDecoder().then(d => {
              if (cancelled || doneRef.current) return;
              decoders.push(d);
              setEngine(decoders.map(x => x.name).join(' + '));
            }).catch(()=>{});
          }
        }
        if (!cancelled && !doneRef.current) timer = setTimeout(tick, 40);
      };
      tick();
      stopRef.current = () => clearTimeout(timer);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { stopRef.current && stopRef.current(); } catch {}
      const s = streamRef.current;
      if (s) s.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [hit, camOn]);

  const toggleTorch = async () => {
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced:[{ torch: !torchOn }] });
      setTorchOn(v => !v);
    } catch { setCanTorch(false); }
  };

  const applyZoom = async (value) => {
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (!track) return;
    setZoom(z => z ? { ...z, value } : z);
    try { await track.applyConstraints({ advanced:[{ zoom: value }] }); } catch {}
  };

  return (
    <div className="fd-scan">
      <div className={`fd-scan-view ${camOn ? status : 'off'}`}>
        <video ref={videoRef} muted playsInline autoPlay />
        {camOn && status !== 'error' && <div className="fd-reticle" aria-hidden="true"><span/><span/><span/><span/></div>}
        {!camOn && <div className="fd-scan-overlay">Caméra éteinte</div>}
        {camOn && status === 'init' && <div className="fd-scan-overlay">Démarrage de la caméra…</div>}
        {camOn && status === 'error' && <div className="fd-scan-overlay err">{err}</div>}
        {camOn && status === 'live' && canTorch && (
          <button className={`fd-torch ${torchOn?'on':''}`} onClick={toggleTorch} title="Lampe">
            {torchOn ? 'Lampe ●' : 'Lampe ○'}
          </button>
        )}
        <button
          className={`fd-cam-toggle ${camOn?'on':''}`}
          onClick={toggleCamera}
          aria-pressed={camOn}
          title={camOn ? 'Éteindre la caméra' : 'Allumer la caméra'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <path d="M2 5.5h2.4l1-1.6h5.2l1 1.6H14v7H2z" />
            <circle cx="8" cy="9" r="2.2" />
          </svg>
          <span>{camOn ? 'Caméra' : 'Allumer'}</span>
        </button>
      </div>

      {camOn && status === 'live' && zoom && (
        <div className="fd-zoom">
          <label>Zoom</label>
          <input
            type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value}
            onChange={e => applyZoom(Number(e.target.value))}
          />
        </div>
      )}

      {camOn ? status === 'live' && (
        <p className="fd-scan-hint serif">
          Cadre le code dans la bande, à plat, à une quinzaine de centimètres.
          {engine && <span className="fd-scan-diag mono"> {engine} · {attempts} essais</span>}
        </p>
      ) : (
        <p className="fd-scan-hint serif">
          Allume la caméra pour scanner. Le choix est retenu sur cet appareil : la prochaine fois
          elle démarrera toute seule, sans redemander l'autorisation.
        </p>
      )}

    </div>
  );
}

/* ============================================================
   Le magasin — foods / food_logs / nutrition_goals
   ------------------------------------------------------------
   Vit dans App (un seul chargement), pour que la page Food et
   les compteurs de la page Log lisent la même chose.
   ============================================================ */
function useFoodStore(userId){
  const [foods, setFoods] = useState([]);
  const [logs, setLogs] = useState([]);
  const [meals, setMeals] = useState([]);     // presets d'ingrédients
  const [goals, setGoals] = useState(null);   // null tant que rien n'est réglé
  const [ready, setReady] = useState(false);
  // La table des aliments simples : un fichier statique, chargé une fois, jamais
  // bloquant — si elle manque, tout le reste marche pareil.
  const [refFoods, setRefFoods] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadRefFoods().then(list => { if (!cancelled) setRefFoods(list); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const refByBarcode = useMemo(
    () => Object.fromEntries((refFoods || []).map(f => [f.barcode, f])), [refFoods]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, l, g, m] = await Promise.all([
        supabase.from('foods').select('*'),
        supabase.from('food_logs').select('*').order('ts', { ascending:false }),
        supabase.from('nutrition_goals').select('*').maybeSingle(),
        supabase.from('meals').select('*'),
      ]);
      if (cancelled) return;
      if (!f.error && f.data) setFoods(f.data.map(foodFromRow));
      if (!l.error && l.data) setLogs(l.data.map(foodLogFromRow));
      // Les repas sont arrivés après les autres tables : si la migration n'a pas
      // encore été passée, l'erreur est ignorée et le reste de la page marche.
      if (!m.error && m.data) setMeals(m.data.map(mealFromRow));
      // Les colonnes sont sur g.data, pas sur g (qui est la réponse { data, error }).
      // Les lire sur g rendait quatre null : les objectifs étaient bien enregistrés
      // en base, mais revenaient vides à chaque ouverture — et comme l'objet était
      // quand même là, `goalsSet` répondait « oui, ils sont réglés ».
      if (!g.error && g.data){
        const row = g.data;
        setGoals({
          kcal:row.kcal ?? null, protein:row.protein_g ?? null, carbs:row.carbs_g ?? null, fat:row.fat_g ?? null,
          weightKg:row.weight_kg ?? null,
          proteinMode:row.protein_mode || 'grams', proteinRatio:row.protein_ratio ?? null,
          carbsMode:row.carbs_mode || 'grams', carbsRatio:row.carbs_ratio ?? null,
          fatMode:row.fat_mode || 'grams', fatRatio:row.fat_ratio ?? null,
        });
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Un produit scanné deux fois ne fait qu'une ligne : le code-barres est unique
  // par compte (index côté base), on met donc à jour la fiche existante.
  const saveFood = async (food) => {
    const known = food.barcode ? foods.find(f => f.barcode === food.barcode) : null;
    const merged = known ? { ...known, ...food, id:known.id, createdAt:known.createdAt } : food;
    const { error } = await supabase.from('foods').upsert(foodToRow(merged, userId));
    if (error) return null;
    setFoods(s => known ? s.map(f => f.id === merged.id ? merged : f) : [merged, ...s]);
    return merged;
  };
  const updateFood = async (id, patch) => {
    const current = foods.find(f => f.id === id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    const { error } = await supabase.from('foods').update(foodToRow(updated, userId)).eq('id', id);
    if (error) return null;
    setFoods(s => s.map(f => f.id === id ? updated : f));
    return updated;
  };
  const removeFood = async (id) => {
    const { error } = await supabase.from('foods').delete().eq('id', id);
    if (!error) setFoods(s => s.filter(f => f.id !== id));
  };

  const addLog = async (log) => {
    const l = { id: uid('fl_'), ts: Date.now(), unit:'g', ...log };
    const { error } = await supabase.from('food_logs').insert(foodLogToRow(l, userId));
    if (error) return;
    setLogs(s => [l, ...s]);
    if (l.foodId) updateFood(l.foodId, { lastUsedAt: Date.now() });
  };
  const updateLog = async (id, patch) => {
    const current = logs.find(l => l.id === id);
    if (!current) return;
    const updated = { ...current, ...patch };
    const { error } = await supabase.from('food_logs').update(foodLogToRow(updated, userId)).eq('id', id);
    if (!error) setLogs(s => s.map(l => l.id === id ? updated : l));
  };
  const removeLog = async (id) => {
    const { error } = await supabase.from('food_logs').delete().eq('id', id);
    if (!error) setLogs(s => s.filter(l => l.id !== id));
  };

  const toggleFavorite = (id) => {
    const f = foods.find(x => x.id === id);
    if (f) updateFood(id, { favorite: !f.favorite });
  };

  /* ---- Repas enregistrés ---- */
  const saveMeal = async (meal) => {
    const m = { steps:[], items:[], source:'custom', favorite:false, createdAt:Date.now(), lastUsedAt:null, ...meal,
                id: meal.id || uid('m_') };
    const { error } = await supabase.from('meals').upsert(mealToRow(m, userId));
    if (error) return null;
    setMeals(s => s.some(x => x.id === m.id) ? s.map(x => x.id === m.id ? m : x) : [m, ...s]);
    return m;
  };
  // Un repas se met en favori exactement comme un aliment : ce sont deux items,
  // l'étoile ne peut pas vouloir dire deux choses.
  const toggleMealFavorite = async (id) => {
    const m = meals.find(x => x.id === id);
    if (m) await saveMeal({ ...m, favorite: !m.favorite });
  };
  const removeMeal = async (id) => {
    const { error } = await supabase.from('meals').delete().eq('id', id);
    if (!error) setMeals(s => s.filter(m => m.id !== id));
  };
  // Verser un repas au journal : une ligne par ingrédient, comme si on les avait
  // ajoutés un à un — chacune reste corrigeable et supprimable seule ensuite.
  const addMealToDay = async (mealObj, day, mealSlot) => {
    for (const it of (mealObj.items || [])){
      const grams = Number(it.grams) || 0;
      if (grams <= 0) continue;
      await addLog({ day, meal: mealSlot, foodId: it.foodId || null, name: it.name,
                     brand:'', qty: grams, unit:'g', grams, nutriments: itemNutriments(it) });
    }
    if (mealObj.id) saveMeal({ ...mealObj, lastUsedAt: Date.now() });
  };

  const saveGoals = async (g) => {
    const row = { user_id:userId, kcal:g.kcal ?? null, protein_g:g.protein ?? null,
                  carbs_g:g.carbs ?? null, fat_g:g.fat ?? null, weight_kg:g.weightKg ?? null,
                  protein_mode:g.proteinMode || 'grams', protein_ratio:g.proteinRatio ?? null,
                  carbs_mode:g.carbsMode || 'grams', carbs_ratio:g.carbsRatio ?? null,
                  fat_mode:g.fatMode || 'grams', fat_ratio:g.fatRatio ?? null,
                  updated_at:Date.now() };
    const { error } = await supabase.from('nutrition_goals').upsert(row);
    if (!error) setGoals(g);
  };

  // Index jour → lignes, refait une seule fois par changement de log.
  const logsByDay = useMemo(() => {
    const m = {};
    for (const l of logs) (m[l.day] = m[l.day] || []).push(l);
    return m;
  }, [logs]);

  const totalsForDay = useCallback((dk) => sumNutriments((logsByDay[dk] || []).map(l => l.nutriments)), [logsByDay]);

  // Un objectif laissé vide retombe sur sa valeur par défaut plutôt que sur zéro :
  // régler ses calories sans toucher aux macros ne doit pas effacer les trois autres cibles.
  // Seules les 4 macros comptent pour « un objectif est réglé » — le poids et
  // les modes/ratios ne sont que la manière dont ces grammes ont été obtenus.
  const setGoalValues = Object.fromEntries(
    FOOD_MACROS.map(m => m.key).filter(k => goals && goals[k] != null).map(k => [k, goals[k]]));
  const effectiveGoals = { ...DEFAULT_GOALS, ...setGoalValues };
  return { ready, foods, logs, logsByDay, meals, goals, effectiveGoals, goalsSet: Object.keys(setGoalValues).length > 0,
           refFoods, refByBarcode,
           saveFood, updateFood, removeFood, toggleFavorite,
           saveMeal, removeMeal, addMealToDay, toggleMealFavorite,
           addLog, updateLog, removeLog, saveGoals, totalsForDay };
}

/* ============================================================
   Analyse IA — le seul appel qui sort vers autre chose qu'Open
   Food Facts. La clé API vit dans une Edge Function Supabase
   (supabase/functions/analyse-repas) : le navigateur n'envoie
   que sa session, et ne reçoit que la décomposition.
   ============================================================ */
const ANALYSE_URL = `${SUPABASE_URL}/functions/v1/analyse-repas`;

async function analyseRepas(description, { signal, image } = {}){
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Session expirée — reconnecte-toi.');

  let r;
  try {
    r = await fetch(ANALYSE_URL, {
      method: 'POST',
      signal,
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      // La photo voyage en base64 dans le même corps que la description — une
      // seule requête, le modèle voit les deux ensemble plutôt que de recouper
      // deux réponses séparées.
      body: JSON.stringify(image ? { description, image } : { description }),
    });
  } catch(e){
    if (e.name === 'AbortError') throw e;
    throw new Error("Service d'analyse injoignable (réseau, ou fonction non déployée).");
  }

  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok){
    // 404 = la fonction n'existe pas encore côté Supabase : c'est le cas au
    // premier lancement, et le message doit le dire plutôt que « erreur 404 ».
    if (r.status === 404) throw new Error("La fonction d'analyse n'est pas déployée sur ce projet Supabase.");
    throw new Error((body && body.error) || `Le service d'analyse a répondu ${r.status}.`);
  }

  // Les valeurs du modèle sont pour 100 g ; on les range dans la même forme que
  // tout le reste de la page, pour que l'éditeur d'ingrédients n'ait rien à savoir
  // de leur provenance.
  const items = (body.ingredients || []).map(ing => mkItem({
    name: String(ing.nom || '').trim() || 'Ingrédient',
    grams: Math.max(0, Number(ing.grammes) || 0),
    note: String(ing.hypothese || '').trim(),
    per100: {
      kcal: Number(ing.kcal) || 0,
      protein: Number(ing.proteines) || 0,
      carbs: Number(ing.glucides) || 0,
      fat: Number(ing.lipides) || 0,
    },
  }));
  return { plat: body.plat || '', items, marge: body.marge || '', question: body.question || '' };
}

/* ============================================================
   Page Food
   ============================================================ */
function FoodPage({ store, sub, onSub, aiEnabled = true }){
  const [addOpen, setAddOpen] = useState(null);      // { meal, day } | null
  const [editFood, setEditFood] = useState(null);    // aliment en cours d'édition
  const [newFood, setNewFood] = useState(null);      // brouillon d'aliment (création)
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [mealDraft, setMealDraft] = useState(null);   // repas en cours de création/édition
  const [day, setDay] = useState(() => dayKey(Date.now()));

  const hint = sub === 'jour' ? 'ce que vous avez mangé'
             : sub === 'aliments' ? 'vos items — aliments simples, produits à code, IA, perso'
             : 'calories et macros dans le temps';

  return (
    <div>
      <div className="log-subnav">
        <Segmented size="compact">
          <button className={sub==='jour'?'on':''} onClick={()=>onSub('jour')}>Jour</button>
          <button className={sub==='aliments'?'on':''} onClick={()=>onSub('aliments')}>Aliments</button>
          <button className={sub==='vues'?'on':''} onClick={()=>onSub('vues')}>Vues</button>
        </Segmented>
        <span className="log-subhint serif">{hint}</span>
      </div>

      {!store.ready ? (
        <div className="empty"><span className="em-serif">Chargement…</span></div>
      ) : sub === 'jour' ? (
        <FoodDayView
          store={store} day={day} onDay={setDay}
          onAdd={(meal)=>setAddOpen({ meal, day })}
          onGoals={()=>setGoalsOpen(true)}
        />
      ) : sub === 'aliments' ? (
        <FoodLibraryView
          store={store}
          onEdit={setEditFood}
          onDelete={(f)=>{ if (confirm(`Supprimer « ${f.name} » ? Les repas déjà notés gardent leurs valeurs.`)) store.removeFood(f.id); }}
          onNew={()=>setNewFood({ id:uid('f_'), source:'custom', name:'', brand:'', basis:'g',
                                  servingG:null, imageUrl:'', nutriments:{}, barcode:null,
                                  favorite:false, lastUsedAt:null, createdAt:Date.now() })}
          onScan={()=>setAddOpen({ meal:null, day })}
          onNewMeal={()=>setMealDraft({ name:'', items:[], steps:[], source:'custom' })}
          onEditMeal={setMealDraft}
        />
      ) : (
        <FoodVuesView store={store} onGoals={()=>setGoalsOpen(true)} />
      )}

      <FoodSources />

      {addOpen && (
        <AddFoodModal
          store={store}
          aiEnabled={aiEnabled}
          day={addOpen.day}
          meal={addOpen.meal}
          onClose={()=>setAddOpen(null)}
          onNeedsFood={(draft)=>{ setAddOpen(null); setNewFood(draft); }}
        />
      )}
      {(editFood || newFood) && (
        <FoodEditModal
          food={editFood || newFood}
          isNew={!editFood}
          onClose={()=>{ setEditFood(null); setNewFood(null); }}
          onSave={async (f)=>{ await store.saveFood(f); setEditFood(null); setNewFood(null); }}
          onDelete={editFood ? async ()=>{ await store.removeFood(editFood.id); setEditFood(null); } : null}
        />
      )}
      {goalsOpen && (
        <GoalsModal
          // effectiveGoals ne porte que les 4 grammes (avec repli sur les
          // valeurs par défaut) ; le mode/ratio/poids qui ont produit ces
          // grammes ne vivent que sur goals — la modale a besoin des deux :
          // les grammes pour afficher quelque chose de sensé la première fois,
          // et le mode/ratio pour se rouvrir tel qu'on l'a laissé.
          goals={{ ...store.effectiveGoals, ...(store.goals || {}) }}
          isSet={store.goalsSet}
          onClose={()=>setGoalsOpen(false)}
          onSave={async (g)=>{ await store.saveGoals(g); setGoalsOpen(false); }}
        />
      )}
      {mealDraft && (
        <MealEditModal
          meal={mealDraft.id ? mealDraft : null}
          store={store}
          onClose={()=>setMealDraft(null)}
          onSave={async (m)=>{ await store.saveMeal({ ...mealDraft, ...m }); setMealDraft(null); }}
          onDelete={mealDraft.id ? async ()=>{ await store.removeMeal(mealDraft.id); setMealDraft(null); } : null}
        />
      )}
    </div>
  );
}

/* ---- Les sources ----------------------------------------------------------
   Aucune valeur affichée dans cette page ne vient de nulle part : soit d'une
   fiche Open Food Facts, soit d'un aliment saisi à la main. Les liens sont là
   pour pouvoir aller vérifier la fiche d'origine plutôt que nous croire.     */
function FoodSources(){
  return (
    <div className="fd-sources">
      <p className="section-label">Sources</p>
      <p className="serif">
        Les produits scannés et cherchés viennent d'<a href={OFF_FR} target="_blank" rel="noopener noreferrer">Open
        Food Facts</a>, base collaborative et ouverte (licence ODbL) — les valeurs y sont saisies par ses
        contributeurs, donc parfois incomplètes ou fausses. Chaque produit garde son lien « ↗ » vers sa fiche
        d'origine, et le bouton Modifier permet de corriger les valeurs dans ta bibliothèque sans toucher à la
        fiche publique.
      </p>
      <p className="serif">
        Les aliments simples — ceux qui n'ont pas d'étiquette : un blanc de poulet, une pomme de terre,
        des framboises — viennent de la <b>table Ciqual 2025</b> de l'ANSES, livrée avec l'app et
        consultable hors ligne : 3 341 aliments français, crus et cuits, avec leurs micronutriments,
        sous Licence Ouverte. Ce sont des moyennes de référence, pas un produit précis : le poulet que
        tu as acheté n'est pas exactement celui-là, mais l'ordre de grandeur est juste, et chaque valeur
        reste corrigeable.
      </p>
      <div className="fd-source-links mono">
        <a href="https://ciqual.anses.fr/" target="_blank" rel="noopener noreferrer">table ciqual ↗</a>
        <a href={OFF_FR} target="_blank" rel="noopener noreferrer">fr.openfoodfacts.org ↗</a>
        <a href={OFF_SEARCH} target="_blank" rel="noopener noreferrer">moteur de recherche ↗</a>
        <a href="https://openfoodfacts.github.io/openfoodfacts-server/api/" target="_blank" rel="noopener noreferrer">l'API utilisée ↗</a>
        <a href="https://world.openfoodfacts.org/data" target="_blank" rel="noopener noreferrer">la base complète ↗</a>
      </div>
    </div>
  );
}

/* ---- Jour ----------------------------------------------------------------- */
function FoodDayView({ store, day, onDay, onAdd, onGoals }){
  const [showMicros, setShowMicros] = useState(false);
  const [editLog, setEditLog] = useState(null);
  const dayLogs = store.logsByDay[day] || [];
  const totals = useMemo(() => sumNutriments(dayLogs.map(l => l.nutriments)), [dayLogs]);
  const goals = store.effectiveGoals;
  const today = dayKey(Date.now());
  const isToday = day === today;

  const byMeal = useMemo(() => {
    const m = {};
    for (const meal of MEALS) m[meal.id] = [];
    m.autre = [];
    for (const l of dayLogs) (m[l.meal] || m.autre).push(l);
    for (const k in m) m[k].sort((a,b) => a.ts - b.ts);
    return m;
  }, [dayLogs]);

  return (
    <div className="fd-day">
      <div className="fd-datebar">
        <button className="icon-btn cal-nav" onClick={()=>onDay(shiftDayKey(day,-1))} aria-label="Jour précédent">‹</button>
        <div className="fd-date">
          <span className="fd-date-main">{dayLabel(dayKeyToTs(day))}</span>
          <span className="fd-date-sub mono">{day}</span>
        </div>
        <button className="icon-btn cal-nav" onClick={()=>onDay(shiftDayKey(day,1))} disabled={isToday} aria-label="Jour suivant">›</button>
        {!isToday && <button className="de-today" onClick={()=>onDay(today)}>Aujourd'hui</button>}
      </div>

      {/* Les calories prennent toute la largeur — c'est le chiffre qu'on vient
          lire — et les trois macros se partagent la ligne suivante. L'engrenage
          n'est que sur la carte calories : il ouvre les objectifs des quatre,
          alors le poser sur chacune répéterait la même porte quatre fois. */}
      <div className="fd-totals">
        {FOOD_MACROS.map(m => {
          const v = totals[m.key] || 0;
          const goal = goals[m.key] || 0;
          const pct = goal > 0 ? Math.min(100, (v / goal) * 100) : 0;
          const over = goal > 0 && v > goal;
          const lead = m.key === 'kcal';
          const amount = (n) => lead ? `${fmtNum(n, 0)} kcal` : `${fmtMacro(n)}g`;
          return (
            <div className={`fd-total ${lead?'lead':''}`} key={m.key}>
              <span className="fd-total-head">
                <span className="fd-total-label">{m.label}</span>
                {lead && (
                  <button className="icon-btn chart-edit-btn" onClick={onGoals}
                          aria-label="Régler les objectifs" title="Régler les objectifs">
                    <GearIcon />
                  </button>
                )}
              </span>
              <span className="fd-total-v">
                {lead ? fmtNum(v, 0) : fmtMacro(v)}
                <span className="u">{m.unit}</span>
              </span>
              <span className="fd-meter"><span className={`fd-fill ${over?'over':''}`} style={{width:`${pct}%`, background:m.color}} /></span>
              <span className="fd-total-goal mono">
                {goal > 0 ? `${amount(v)} / ${amount(goal)}` : 'sans objectif'}
              </span>
            </div>
          );
        })}
      </div>

      {!store.goalsSet && (
        <p className="fd-note serif">
          Objectifs par défaut, à ajuster : <button className="fd-link" onClick={onGoals}>régler mes objectifs</button>.
        </p>
      )}

      {/* Le bouton principal de la page n'est plus « scanner » : le scan est une
          façon d'ajouter parmi quatre, pas la porte d'entrée. Il ouvre l'ajout,
          qui range les quatre dans le même endroit. */}
      <div className="fd-scan-cta">
        <button className="fd-primary" onClick={()=>onAdd(defaultMealForNow())}>
          <PlusIcon />
          Ajouter
        </button>
      </div>

      {MEALS.map(meal => {
        const rows = byMeal[meal.id] || [];
        const kcal = rows.reduce((s, l) => s + (l.nutriments.kcal || 0), 0);
        return (
          <div className="fd-meal" key={meal.id}>
            <div className="fd-meal-head">
              <p className="section-label" style={{margin:0}}>{meal.label}</p>
              <span className="fd-meal-kcal mono">{rows.length ? `${fmtNum(kcal,0)} kcal` : '—'}</span>
            </div>
            {rows.map(l => (
              <FoodLogRow key={l.id} log={l} onEdit={()=>setEditLog(l)} onDelete={()=>store.removeLog(l.id)} />
            ))}
            <button className="fd-add" onClick={()=>onAdd(meal.id)}>+ Ajouter</button>
          </div>
        );
      })}

      {(byMeal.autre || []).length > 0 && (
        <div className="fd-meal">
          <div className="fd-meal-head"><p className="section-label" style={{margin:0}}>Autre</p></div>
          {byMeal.autre.map(l => (
            <FoodLogRow key={l.id} log={l} onEdit={()=>setEditLog(l)} onDelete={()=>store.removeLog(l.id)} />
          ))}
        </div>
      )}

      <div className="fd-micros-block">
        <button className="fd-link" onClick={()=>setShowMicros(v=>!v)}>
          {showMicros ? 'Masquer' : 'Voir'} le détail et les micronutriments
        </button>
        {showMicros && <MicroPanel totals={totals} />}
      </div>

      {editLog && (
        <QuantityModal
          title="Modifier la quantité"
          food={foodForLog(store, editLog)}
          initialQty={editLog.qty}
          initialUnit={editLog.unit}
          initialMeal={editLog.meal}
          onClose={()=>setEditLog(null)}
          onSubmit={({ qty, unit, grams, meal, nutriments })=>{
            store.updateLog(editLog.id, { qty, unit, grams, meal, nutriments });
            setEditLog(null);
          }}
        />
      )}
    </div>
  );
}

// Le repas proposé par défaut selon l'heure — un raccourci, jamais un verrou.
function defaultMealForNow(){
  const h = new Date().getHours();
  if (h < 11) return 'matin';
  if (h < 15) return 'midi';
  if (h < 18) return 'collation';
  return 'soir';
}

// Une ligne de log garde son propre snapshot : si l'aliment a été supprimé de la
// bibliothèque, on reconstruit un aliment « pour 100 » à partir de ce snapshot.
function foodForLog(store, log){
  const known = log.foodId ? store.foods.find(f => f.id === log.foodId) : null;
  if (known) return known;
  const per100 = scaleNutriments(log.nutriments, log.grams > 0 ? (100 / log.grams) * 100 : 100);
  return { id:log.foodId || 'orphan', name:log.name, brand:log.brand, basis:log.unit === 'ml' ? 'ml' : 'g',
           // Une portion valait 100 g en interne dans l'ancienne saisie à la main :
           // sans ça, rouvrir une telle ligne donnerait une quantité nulle.
           servingG: log.unit === 'portion' ? 100 : null,
           nutriments: log.grams > 0 ? per100 : {}, source:'custom' };
}

function FoodLogRow({ log, onEdit, onDelete }){
  const n = log.nutriments || {};
  return (
    <div className="fd-row">
      <div className="fd-row-main">
        <span className="fd-row-name">{log.name}</span>
        {log.brand && <span className="fd-row-brand">{log.brand}</span>}
        <span className="fd-row-qty mono">{fmtNum(log.qty, 1)} {log.unit === 'portion' ? (log.qty > 1 ? 'portions' : 'portion') : log.unit}</span>
      </div>
      <div className="fd-row-macros mono">
        <span>{fmtMacro(n.protein)}<i>P</i></span>
        <span>{fmtMacro(n.carbs)}<i>G</i></span>
        <span>{fmtMacro(n.fat)}<i>L</i></span>
      </div>
      <span className="fd-row-kcal">{fmtNum(n.kcal, 0)}<i>kcal</i></span>
      <span className="fd-row-actions">
        <button onClick={onEdit}>modifier</button>
        <button className="del" onClick={onDelete}>suppr.</button>
      </span>
    </div>
  );
}

// Détail réglementaire + micros, avec le % du repère journalier européen quand
// on en a un. Rien n'est inventé : ce qui manque sur l'étiquette reste vide.
function MicroPanel({ totals }){
  const details = FOOD_DETAILS.filter(d => totals[d.key] != null);
  const micros = FOOD_MICROS.filter(m => totals[m.key] != null);
  if (!details.length && !micros.length){
    return (
      <p className="fd-note serif">
        Rien à afficher : les produits d'aujourd'hui ne portent pas ce détail.
        C'est la limite d'Open Food Facts — un aliment saisi à la main peut, lui, tout porter.
      </p>
    );
  }
  return (
    <div className="fd-micros">
      {details.map(d => (
        <div className="fd-micro" key={d.key}>
          <span className="fd-micro-label">{d.label}</span>
          <span className="fd-micro-v mono">{fmtMacro(totals[d.key])} {d.unit}</span>
        </div>
      ))}
      {micros.map(m => {
        const v = totals[m.key];
        const pct = m.rda ? Math.round((v / m.rda) * 100) : null;
        return (
          <div className="fd-micro" key={m.key}>
            <span className="fd-micro-label">{m.label}</span>
            <span className="fd-micro-v mono">
              {fmtNum(v, v < 10 ? 1 : 0)} {m.unit}
              {pct != null && <i className="fd-micro-rda">{pct}% AJR</i>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Éditeur d'ingrédients
   ------------------------------------------------------------
   Le même objet sert deux fonctionnalités : ce que l'IA a
   décomposé, et ce qu'un repas enregistré contient. Les deux
   sont une liste de {nom, poids, valeurs pour 100 g}, donc un
   seul éditeur — et un résultat d'analyse devient un repas
   sans la moindre conversion.

   Chaque ligne est corrigeable jusqu'au bout : le poids (le
   geste courant), mais aussi les valeurs pour 100 g, parce
   qu'une estimation d'IA reste une estimation et qu'il faut
   pouvoir la reprendre sans repartir de zéro.
   ============================================================ */
function IngredientRow({ item, onPatch, onRemove }){
  const [open, setOpen] = useState(false);
  const n = itemNutriments(item);
  const per = item.per100 || {};
  const setPer = (k, v) => {
    const num = parseFloat(String(v).replace(',', '.'));
    onPatch({ per100: { ...per, [k]: isNaN(num) ? undefined : num } });
  };
  return (
    <div className={`fd-ing ${open?'open':''}`}>
      <div className="fd-ing-main">
        <input className="fd-ing-name" value={item.name}
               onChange={e=>onPatch({ name: e.target.value })} placeholder="Ingrédient" />
        <span className="fd-ing-qty">
          <input type="number" step="any" min="0" inputMode="decimal" value={item.grams}
                 onChange={e=>onPatch({ grams: e.target.value })} />
          <i>g</i>
        </span>
        <span className="fd-ing-kcal mono">{fmtNum(n.kcal, 0)}<i>kcal</i></span>
        <button className="icon-btn fd-ing-btn" onClick={()=>setOpen(o=>!o)} aria-expanded={open}
                title="Valeurs pour 100 g">{open ? '×' : '···'}</button>
        <button className="icon-btn fd-ing-btn del" onClick={onRemove} title="Retirer">−</button>
      </div>
      <div className="fd-ing-macros mono">
        <span>{fmtMacro(n.protein)}<i>P</i></span>
        <span>{fmtMacro(n.carbs)}<i>G</i></span>
        <span>{fmtMacro(n.fat)}<i>L</i></span>
        {item.note && !open && <em className="fd-ing-note">{item.note}</em>}
      </div>
      {open && (
        <div className="fd-ing-edit">
          <p className="fd-list-label">Valeurs pour 100 g</p>
          {FOOD_MACROS.map(m => (
            <NumField key={m.key} label={m.short} unit={m.unit}
                      value={per[m.key]} onChange={v=>setPer(m.key, v)} />
          ))}
          {item.note && <p className="fd-note serif" style={{margin:'8px 0 0'}}>{item.note}</p>}
        </div>
      )}
    </div>
  );
}

// Ajouter un ingrédient sans quitter l'éditeur : la bibliothèque et la table
// Ciqual sont toutes deux locales, donc la recherche est instantanée et marche
// hors ligne. Ce qui n'est dans ni l'une ni l'autre se saisit en ligne vide.
function IngredientPicker({ store, onPick, onBlank }){
  const [q, setQ] = useState('');
  const query = q.trim();
  const mine = useMemo(() => {
    if (query.length < 2) return [];
    const needle = query.toLowerCase();
    return store.foods.filter(f => foodLabel(f).toLowerCase().includes(needle))
      .sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt)).slice(0, 5);
  }, [store.foods, query]);
  const ref = useMemo(
    () => query.length >= 2 ? searchRefFoods(store.refFoods, query, 6) : [], [store.refFoods, query]);

  return (
    <div className="fd-ing-picker">
      <div className="fd-search-bar">
        <input value={q} onChange={e=>setQ(e.target.value)}
               placeholder="ajouter un ingrédient — riz, poulet, huile…" />
        <button className="primary sm" onClick={()=>{ onBlank(query); setQ(''); }}>À la main</button>
      </div>
      {(mine.length > 0 || ref.length > 0) && (
        <div className="fd-list">
          {mine.map(f => (
            <FoodPickRow key={'m_'+f.id} food={f} onPick={()=>{ onPick(f); setQ(''); }} />
          ))}
          {ref.map(f => (
            <FoodPickRow key={f.id} food={f} onPick={()=>{ onPick(f); setQ(''); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function IngredientEditor({ items, onChange, store, children }){
  const totals = itemsTotals(items);
  const patch = (id, p) => onChange(items.map(it => it.id === id ? { ...it, ...p } : it));
  return (
    <div className="fd-ing-editor">
      {items.length === 0
        ? <p className="fd-note serif">Aucun ingrédient pour l'instant.</p>
        : items.map(it => (
            <IngredientRow key={it.id} item={it}
              onPatch={p=>patch(it.id, p)}
              onRemove={()=>onChange(items.filter(x => x.id !== it.id))} />
          ))}

      <IngredientPicker
        store={store}
        onPick={f=>onChange([...items, itemFromFood(f)])}
        onBlank={name=>onChange([...items, mkItem({ name: name || 'Ingrédient' })])}
      />

      {items.length > 0 && (
        <div className="fd-ing-total">
          <span className="fd-ing-total-l">Total</span>
          <span className="mono">{fmtNum(totals.kcal, 0)}<i>kcal</i></span>
          <span className="mono">{fmtMacro(totals.protein)}<i>P</i></span>
          <span className="mono">{fmtMacro(totals.carbs)}<i>G</i></span>
          <span className="mono">{fmtMacro(totals.fat)}<i>L</i></span>
        </div>
      )}
      {children}
    </div>
  );
}

/* ============================================================
   Analyse IA — décrire un repas, le récupérer décomposé
   ------------------------------------------------------------
   Le chemin pour tout ce qui n'a ni code-barres ni fiche : un
   plat maison, une assiette au restaurant, un reste. Ce qui
   revient est une hypothèse chiffrée, pas une vérité — d'où
   l'éditeur en dessous, la marge affichée telle quelle, et la
   question que le modèle pose quand une précision resserrerait
   nettement l'estimation.
   ============================================================ */
const AI_PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 Mo — large marge avant l'encodage base64

function AiAnalyseTab({ store, day, initialMeal, onDone, onEditAsMeal }){
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);   // { dataUrl, base64, mediaType }
  const [photoErr, setPhotoErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);   // { plat, items, marge, question }
  const [items, setItems] = useState([]);
  const [mealSlot, setMealSlot] = useState(initialMeal || defaultMealForNow());
  const abortRef = useRef(null);

  useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch {} }, []);

  const pickPhoto = (file) => {
    setPhotoErr('');
    if (!file) return;
    if (!file.type.startsWith('image/')){ setPhotoErr("Ce fichier n'est pas une image."); return; }
    if (file.size > AI_PHOTO_MAX_BYTES){ setPhotoErr('Photo trop lourde (5 Mo max).'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      const mediaType = (dataUrl.match(/^data:([^;]+);base64/) || [])[1] || file.type;
      setPhoto({ dataUrl, base64, mediaType });
    };
    reader.onerror = () => setPhotoErr('Photo illisible.');
    reader.readAsDataURL(file);
  };

  const canRun = (description.trim().length >= 3 || !!photo) && !busy;

  const run = async () => {
    const d = description.trim();
    if ((d.length < 3 && !photo) || busy) return;
    setBusy(true); setErr('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const image = photo ? { data: photo.base64, mediaType: photo.mediaType } : null;
      const out = await analyseRepas(d, { signal: ctrl.signal, image });
      setResult(out);
      setItems(out.items);
      if (!out.items.length) setErr("L'analyse n'a rien pu décomposer. Reformule en détaillant le plat, ou précise la photo.");
    } catch(e){
      if (e.name !== 'AbortError') setErr(e.message || 'Analyse impossible.');
    }
    setBusy(false);
  };

  const totals = itemsTotals(items);
  const canAdd = items.some(it => (Number(it.grams) || 0) > 0);
  const aiName = () => (result && result.plat) || description.trim().slice(0, 60) || 'Analyse IA';

  // Ce qui sort d'ici est un item, pas seulement des lignes de journal : le
  // repas analysé est enregistré tel quel, marqué `source:'ai'`, et se retrouve
  // dans Mes items › Repas avec sa pastille. Sans ça, une analyse qu'on refait
  // deux fois par semaine serait à redemander au modèle deux fois par semaine.
  const addToJournal = async () => {
    const saved = { name: aiName(), items, steps: [], source: 'ai' };
    await store.saveMeal(saved);
    await store.addMealToDay({ items }, day, mealSlot);
    onDone();
  };

  return (
    <div className="fd-ai">
      {/* La photo d'abord, en grand : c'est elle qui porte la composition
          visible, le texte ne sert qu'à dire ce qu'elle ne montre pas.
          Deux rectangles pleine largeur, l'un au-dessus de l'autre — deux
          façons de décrire la même assiette, pas deux réglages d'un formulaire. */}
      <div className="fd-ai-input">
        {photo ? (
          <div className="fd-ai-drop filled">
            <img src={photo.dataUrl} alt="" />
            <button className="icon-btn fd-ai-photo-del" title="Retirer la photo"
                    aria-label="Retirer la photo" onClick={()=>setPhoto(null)}>✕</button>
          </div>
        ) : (
          <label className="fd-ai-drop">
            <input type="file" accept="image/*" capture="environment"
                   onChange={e => { pickPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            <span className="fd-ai-drop-plus" aria-hidden="true"><PlusIcon size={22} /></span>
            <span className="fd-ai-drop-label">Photo du repas</span>
          </label>
        )}
        {photoErr && <p className="fd-note warn serif">{photoErr}</p>}

        <textarea
          className="fd-ai-text"
          rows={4}
          value={description}
          onChange={e=>setDescription(e.target.value)}
          onKeyDown={e=>{ if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
          placeholder="Poke bowl saumon, riz, avocat, edamame, sauce soja sucrée — bol moyen de resto"
        />

        <div className="fd-ai-actions">
          <span className="fd-ai-hint serif">
            Texte, photo, ou les deux — envoyés dans la même analyse. Plus tu donnes de détails —
            poids pesés, morceau de viande, huile de cuisson — plus l'estimation se resserre.
          </span>
          <button className="primary sm" disabled={!canRun} onClick={run}>
            {busy ? 'Analyse…' : result ? 'Relancer' : 'Analyser'}
          </button>
        </div>
      </div>

      {err && <p className="fd-note warn serif">{err}</p>}

      {result && items.length > 0 && (
        <>
          <div className="fd-ai-head">
            <span className="fd-ai-plat serif">{result.plat || 'Repas'}</span>
            <span className="fd-ai-tags">
              <OriginTag origin={ORIGIN_BY_ID.ai} />
              {result.marge && <span className="fd-ai-marge mono">{result.marge}</span>}
            </span>
          </div>
          {result.question && (
            <p className="fd-note serif">
              <b>Pour affiner :</b> {result.question} — précise-le dans la description et relance.
            </p>
          )}

          <IngredientEditor items={items} onChange={setItems} store={store} />

          <div className="field" style={{borderBottom:'none'}}>
            <label>Repas</label>
            <Segmented scrollx>
              {MEALS.map(m => (
                <button key={m.id} className={mealSlot===m.id?'on':''} onClick={()=>setMealSlot(m.id)}>{m.label}</button>
              ))}
            </Segmented>
          </div>

          <p className="fd-note serif">
            Ajouter note la journée <b>et</b> range l'analyse dans Mes items › Repas, marquée IA —
            de quoi la remettre en un geste sans redemander au modèle.
          </p>

          <div className="modal-actions">
            <button className="ghost" onClick={()=>onEditAsMeal({
              name: aiName(), items, steps: [], source: 'ai',
            })}>Nommer / ajouter une recette</button>
            <button className="primary" disabled={!canAdd} onClick={addToJournal}>
              Ajouter {fmtNum(totals.kcal, 0)} kcal
            </button>
          </div>
        </>
      )}

      {!result && !busy && !err && (
        <p className="fd-note fd-src-line serif">
          L'analyse tourne sur Claude, appelé depuis une fonction Supabase pour que la clé
          reste côté serveur. Ce qui revient est une estimation à relire, pas une mesure.
        </p>
      )}
    </div>
  );
}

/* ---- Mes repas : les presets, dans la page d'ajout -------------------------
   Un repas est un item comme un aliment — il se met en favori, il porte son
   origine (créé à la main, ou sorti d'une analyse IA) — d'où la même étoile et
   la même pastille que sur une ligne d'aliment. La bascule Aliments/Repas et
   le filtre vivent au-dessus, dans la barre à icône : cette liste ne fait que
   les appliquer.                                                             */
function MealsTab({ store, day, initialMeal, favOnly, query, onDone, onNew, onEdit }){
  const [mealSlot, setMealSlot] = useState(initialMeal || defaultMealForNow());
  const list = useMemo(() => {
    const needle = (query || '').trim().toLowerCase();
    let arr = favOnly ? store.meals.filter(m => m.favorite) : store.meals;
    if (needle) arr = arr.filter(m => m.name.toLowerCase().includes(needle));
    return [...arr].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
  }, [store.meals, favOnly, query]);

  return (
    <>
      <div className="fd-mine-head">
        <span className="fd-ai-hint serif">
          Un repas ajoute tous ses ingrédients d'un coup, chacun sur sa propre ligne.
        </span>
        <button className="pill add" onClick={onNew}>+ Repas</button>
      </div>

      {!list.length ? (
        <p className="fd-note serif">
          {favOnly
            ? "Aucun repas favori. L'étoile sur un repas le range ici."
            : "Aucun repas enregistré. Crée-en un à partir de ce que tu manges souvent — une analyse IA en fabrique un toute seule."}
        </p>
      ) : (
        <>
          <div className="field" style={{borderBottom:'none'}}>
            <label>Repas</label>
            <Segmented scrollx>
              {MEALS.map(m => (
                <button key={m.id} className={mealSlot===m.id?'on':''} onClick={()=>setMealSlot(m.id)}>{m.label}</button>
              ))}
            </Segmented>
          </div>
          <div className="fd-list">
            {list.map(m => {
              const t = itemsTotals(m.items);
              return (
                <div className="fd-item-row" key={m.id}>
                  <button className={`fd-fav ${m.favorite?'on':''}`} onClick={()=>store.toggleMealFavorite(m.id)}
                          aria-pressed={!!m.favorite} title={m.favorite ? 'Retirer des favoris' : 'Mettre en favori'}>
                    <StarIcon filled={m.favorite} />
                  </button>
                  <button className="fd-item" onClick={async ()=>{ await store.addMealToDay(m, day, mealSlot); onDone(); }}>
                    <span className="fd-item-txt">
                      <span className="n">{m.name}</span>
                      <span className="fd-item-tags">
                        <OriginTag item={m} />
                        <span className="fd-item-sub">
                          {m.items.length} ingrédient{m.items.length>1?'s':''}
                          {m.steps && m.steps.length ? ` · ${m.steps.length} étape${m.steps.length>1?'s':''}` : ''}
                        </span>
                      </span>
                      <span className="m mono">
                        <b>{fmtNum(t.kcal,0)} kcal</b> · P {fmtMacro(t.protein)} · G {fmtMacro(t.carbs)} · L {fmtMacro(t.fat)}
                      </span>
                    </span>
                  </button>
                  <button className="fd-item-src" title="Modifier ce repas"
                          onClick={()=>onEdit(m)}>✎</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/* ---- Créer / modifier un repas -------------------------------------------- */
function MealEditModal({ meal, store, onClose, onSave, onDelete }){
  const [name, setName] = useState(meal?.name || '');
  const [items, setItems] = useState(() => (meal?.items || []).map(it => ({ ...mkItem(), ...it })));
  // La recette est facultative et volontairement pauvre : une liste d'étapes,
  // pas un objet à part avec ses propres champs. Ce qui compte reste les macros.
  const [steps, setSteps] = useState(() => (meal?.steps || []).length ? [...meal.steps] : ['']);
  const totals = itemsTotals(items);
  const canSave = name.trim().length > 0 && items.length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({
      ...(meal || {}),
      name: name.trim(),
      items: items.map(({ id, name:n, grams, per100, foodId, note }) =>
        ({ id, name:n, grams: Number(grams) || 0, per100, foodId: foodId || null, note: note || '' })),
      steps: steps.map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal fd-modal" onClick={e=>e.stopPropagation()}>
        <h2>{meal ? 'Modifier le repas' : 'Nouveau repas'}</h2>
        <div className="modal-sub">
          Un ensemble d'ingrédients à ajouter d'un coup. La recette est facultative.
        </div>

        <div className="field">
          <label>Nom</label>
          <input value={name} onChange={e=>setName(e.target.value)}
                 placeholder="Poke bowl du dimanche, porridge, salade César…" />
        </div>

        <div className="modal-section">
          <p className="section-label">Ingrédients</p>
          <IngredientEditor items={items} onChange={setItems} store={store} />
        </div>

        <div className="modal-section">
          <p className="section-label">Recette — facultatif</p>
          <div className="fd-steps">
            {steps.map((s, i) => (
              <div className="fd-step" key={i}>
                <span className="fd-step-n mono">{i+1}</span>
                <input value={s} placeholder={`Étape ${i+1}`}
                  onChange={e=>setSteps(arr => arr.map((x,j) => j===i ? e.target.value : x))}
                  onKeyDown={e=>{ if (e.key === 'Enter'){ e.preventDefault(); setSteps(a => [...a, '']); } }} />
                <button className="icon-btn fd-ing-btn del" title="Retirer l'étape"
                        onClick={()=>setSteps(a => a.length > 1 ? a.filter((_,j)=>j!==i) : [''])}>−</button>
              </div>
            ))}
            <button className="choice-add" onClick={()=>setSteps(a => [...a, ''])}>＋ Ajouter une étape</button>
          </div>
        </div>

        <div className="modal-actions">
          {onDelete && <button className="danger" onClick={()=>{ if(confirm('Supprimer ce repas ? Les repas déjà notés ne changent pas.')) onDelete(); }}>Supprimer</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>
            Enregistrer{items.length ? ` · ${fmtNum(totals.kcal,0)} kcal` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- La page d'ajout -------------------------------------------------------
   Le bouton principal de la page Food n'ouvre plus un scanner : il ouvre
   l'ajout, et le scan n'est plus qu'une des façons d'y arriver. Quatre
   onglets, parce que ce sont quatre gestes distincts :

     Recherche   chercher dehors — table Ciqual, Open Food Facts — dans une
                 seule barre qui accepte aussi bien un nom qu'un code-barres,
                 et dont le bouton rond sort la caméra.
     Mes items   reprendre ce qui est déjà à soi : aliments ou repas, avec
                 l'étoile pour ne garder que les favoris des deux.
     IA          décrire, photographier, ou les deux, et laisser décomposer.
     À la main   poser soi-même les chiffres (`QuickAddTab`, voir plus bas).

   L'ancienne modale en avait sept, sur deux rangées, qui mélangeaient « où je
   cherche » et « quoi je cherche » — le scan était un onglet à lui seul alors
   que c'est une façon de remplir la recherche, et « à la main » ne disait pas
   ce qu'il fabriquait. Rien n'a disparu : les sept sont devenues les
   sous-bascules de ces quatre.

   Une page entière, pas une fenêtre : les quatre onglets ont besoin d'assez de
   place pour respirer (des cartes empilées dans l'ajout à la main, une liste
   qui défile dans la recherche) — une modale au centre de l'écran, avec sa
   propre limite de hauteur, revenait à mettre un couloir là où il faut une
   pièce. `.fd-add-head` (titre + fermeture) et `.fd-add-tabs` restent fixes
   en haut pendant que `.fd-add-body` défile en dessous — le choix
   d'onglet reste à portée, quoi qu'on ait déjà descendu.                     */
function AddFoodModal({ store, day, meal, onClose, onNeedsFood, aiEnabled = true }){
  // recherche | mesitems | ia | rapide
  const [tab, setTab] = useState('recherche');
  const [scanOpen, setScanOpen] = useState(false);      // la caméra de l'onglet Recherche
  const [quickSeed, setQuickSeed] = useState(null);     // { name?, barcode?, mode? } pour l'ajout rapide
  // L'ajout rapide lit son amorce au montage. Un nouveau code scanné alors
  // qu'on y est déjà ne le remonterait pas tout seul : cette clé le force.
  const [quickKey, setQuickKey] = useState(0);
  const [mealDraft, setMealDraft] = useState(null);     // repas en cours de création/édition
  const [picked, setPicked] = useState(null);           // aliment choisi → étape quantité
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState(null);
  const [via, setVia] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [query, setQuery] = useState('');
  const [thumbs, setThumbs] = useState(false);    // vignettes : coupées par défaut, c'est plus vif
  // « Mes items » : la bascule aliments/repas, l'étoile, et le filtre.
  const [mine, setMine] = useState('aliments');   // aliments | repas
  const [favOnly, setFavOnly] = useState(false);
  const [libQuery, setLibQuery] = useState('');
  // Le scanner s'arrête au premier code lu. Si ce code ne donne rien, il faut le
  // relancer : changer sa clé le remonte, caméra comprise.
  const [scanNonce, setScanNonce] = useState(0);

  // L'ajout rapide, avec un code déjà connu : c'est là qu'atterrit un code
  // scanné qu'aucune base ne reconnaît, et le renseigner une fois suffit à ce
  // qu'il soit reconnu au scan suivant.
  const openQuick = useCallback((seed) => {
    setQuickSeed(seed || {});
    setQuickKey(n => n + 1);
    setMsg('');
    setScanOpen(false);
    setTab('rapide');
  }, []);

  // Un code scanné : d'abord la bibliothèque locale (instantané, marche hors ligne),
  // ensuite seulement le réseau.
  const handleCode = useCallback(async (code) => {
    setMsg('');
    const cached = store.foods.find(f => f.barcode === code);
    if (cached){ setScanOpen(false); setPicked(cached); return; }
    setBusy(true);
    try {
      const found = await offFetchProduct(code);
      if (!found){
        setMsg('');
        setPicked(null);
        setBusy(false);
        openQuick({ barcode: code, mode:'codebarre' });   // le code est gardé : reconnu au prochain scan
        return;
      }
      if (!foodIsUsable(found)){
        setMsg(`« ${found.name} » est référencé mais sans valeurs nutritionnelles. Complète-les une fois, et le produit sera reconnu ensuite.`);
        setBusy(false);
        onNeedsFood(found);
        return;
      }
      const saved = await store.saveFood(found);
      setScanOpen(false);
      setPicked(saved || found);
    } catch(e){
      setMsg(e.name === 'AbortError' ? 'Open Food Facts ne répond pas. Réessaie.' : (e.message || 'Recherche impossible.'));
      setScanNonce(n => n + 1);
    }
    setBusy(false);
  }, [store, openQuick]);

  // Recherche : une requête en vol à la fois, la plus récente gagne.
  const seqRef = useRef(0);
  const abortRef = useRef(null);
  const runSearch = useCallback(async (raw) => {
    const q = raw.trim();
    if (q.length < 3) return;
    if (/^\d{8,14}$/.test(q)){ handleCode(q); return; }   // un code tapé dans la barre
    const id = ++seqRef.current;
    try { abortRef.current && abortRef.current.abort(); } catch {}
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true); setSearchErr('');
    try {
      const out = await offSearchFoods(q, { signal: ctrl.signal });
      if (seqRef.current !== id) return;
      setResults(out.list);
      setVia(out.cached ? 'déjà chargé' : out.via);
    } catch(e){
      if (e.name === 'AbortError' || seqRef.current !== id) return;
      setSearchErr(e.message || 'Recherche impossible.');
      setResults(null);
    } finally {
      if (seqRef.current === id) setSearching(false);
    }
  }, [handleCode]);

  // Aperçu à la frappe : on laisse retomber la saisie une demi-seconde pour ne
  // pas brûler le quota d'OFF à chaque lettre.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3){ setResults(null); setSearchErr(''); setVia(''); return; }
    if (/^\d{8,14}$/.test(q)) return;                     // un code se cherche au bouton
    const t = setTimeout(() => runSearch(q), 500);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => () => { try { abortRef.current && abortRef.current.abort(); } catch {} }, []);

  // L'ajout rapide fait toujours une ligne de journal. Il fabrique en plus un
  // item — un aliment de la bibliothèque — dès qu'il y a de quoi en faire un :
  // un nom et des valeurs ramenables à 100 g. Le bloc de macros nu, lui, n'est
  // pas un item : c'est un correctif de journée, il n'a rien à venir encombrer.
  const submitQuickAdd = async ({ name, qty, unit, grams, meal:m, nutriments, per100, basis, keep, barcode }) => {
    let foodId = null;
    if (keep){
      const saved = await store.saveFood({
        id: uid('f_'), source:'custom', barcode: barcode || null, name, brand:'',
        basis, servingG:null, imageUrl:'', nutriments: per100,
        favorite:false, lastUsedAt:Date.now(), createdAt:Date.now(),
      });
      if (saved) foodId = saved.id;
    }
    await store.addLog({ day, meal:m, foodId, name, brand:'', qty, unit, grams, nutriments });
    onClose();
  };

  const pickFromSearch = async (f) => {
    if (!foodIsUsable(f)){ onNeedsFood(f); return; }
    const saved = await store.saveFood(f);
    setPicked(saved || f);
  };

  // Un aliment de la table rejoint la bibliothèque à la première utilisation :
  // ensuite il sort en tête, instantanément, même hors ligne. L'identifiant est
  // refait au passage — celui de la table est le même pour tout le monde.
  const pickFromRef = async (f) => {
    const saved = await store.saveFood({ ...f, id: uid('f_'), lastUsedAt: Date.now() });
    setPicked(saved || f);
  };

  const refMatches = useMemo(
    () => searchRefFoods(store.refFoods, query.trim(), 10), [store.refFoods, query]);

  // Ce qui est déjà dans la bibliothèque remonte en premier : c'est instantané,
  // c'est déjà validé, et c'est presque toujours ce qu'on cherche.
  const localMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return store.foods
      .filter(f => foodLabel(f).toLowerCase().includes(q))
      .sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
      .slice(0, 6);
  }, [store.foods, query]);

  const myFoods = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    let list = favOnly ? store.foods.filter(f => f.favorite) : store.foods;
    if (q) list = list.filter(f => foodLabel(f).toLowerCase().includes(q) || (f.barcode || '').includes(q));
    return [...list].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt)).slice(0, 60);
  }, [store.foods, libQuery, favOnly]);

  if (picked){
    return (
      <QuantityModal
        title="Quelle quantité ?"
        food={picked}
        initialMeal={meal || defaultMealForNow()}
        onClose={onClose}
        onBack={()=>{ setPicked(null); setScanNonce(n => n + 1); }}
        onSubmit={({ qty, unit, grams, meal:m, nutriments })=>{
          // Si l'aliment n'a pas pu être enregistré (réseau, conflit), on note quand
          // même le repas : le snapshot suffit à le lire, seul le lien est perdu.
          const linked = store.foods.some(f => f.id === picked.id) ? picked.id : null;
          store.addLog({ day, meal:m, foodId:linked, name:picked.name, brand:picked.brand,
                         qty, unit, grams, nutriments });
          onClose();
        }}
      />
    );
  }

  const q = query.trim();
  const isCode = /^\d{8,14}$/.test(q);

  return (
    <div className="fd-add-page">
      <div className="fd-add-head">
        <div className="fd-add-head-txt">
          <h2>Ajouter</h2>
          <div className="modal-sub">
            {meal ? MEAL_LABEL[meal] : 'Bibliothèque'} · {dayLabel(dayKeyToTs(day)).toLowerCase()}
          </div>
        </div>
        <button className="icon-btn fd-add-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>

      {/* Une seule rangée : les quatre façons d'ajouter quelque chose. Reste
          fixe pendant que le contenu en dessous défile — changer d'onglet ne
          demande jamais de remonter la page. */}
      <div className="fd-tabs fd-add-tabs">
        <Segmented size="small" scrollx>
          <button className={tab==='recherche'?'on':''} onClick={()=>setTab('recherche')}>Recherche</button>
          <button className={tab==='mesitems'?'on':''} onClick={()=>setTab('mesitems')}>Mes items</button>
          {aiEnabled && <button className={tab==='ia'?'on':''} onClick={()=>setTab('ia')}>IA</button>}
          <button className={tab==='rapide'?'on':''} onClick={()=>{ if (tab !== 'rapide') openQuick({ name: q }); }}>À la main</button>
        </Segmented>
      </div>

      <div className="fd-add-body">
        {tab === 'recherche' && (
          <div className="fd-search">
            {/* Barre à icône, forme intégrée : le bouton rond est dans la barre
                parce qu'il ne fait pas autre chose qu'elle — il la remplit
                autrement. Un nom, ou une suite de chiffres : la barre reconnaît
                un code-barres pour ce qu'il est et va chercher le produit. */}
            <IconBar
              icon={<ScanIcon />} onIcon={()=>setScanOpen(v=>!v)} iconOn={scanOpen}
              iconLabel={scanOpen ? 'Fermer le scanner' : 'Scanner un code-barres'}
              className="fd-search-bar">
              <input placeholder="skyr, pain de mie, poulet, ou un code-barres…" value={query}
                onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') runSearch(query); }}
              />
            </IconBar>

            {scanOpen && (
              <div className="fd-scan-panel">
                <FoodScanner key={scanNonce} onCode={handleCode} />
              </div>
            )}

            <div className="fd-search-meta">
              <span className="serif">
                {isCode ? 'Un code-barres — Entrée pour aller chercher le produit.'
                  : q.length < 3 ? 'Trois lettres suffisent — les résultats arrivent à la frappe.'
                  : searching ? 'Recherche…'
                  : results ? `${results.length} résultat${results.length>1?'s':''}${via ? ` · ${via}` : ''}`
                  : ''}
              </span>
              <button className={`fd-thumb-toggle ${thumbs?'on':''}`} onClick={()=>setThumbs(v=>!v)}>
                {thumbs ? 'sans images' : 'avec images'}
              </button>
            </div>

            {localMatches.length > 0 && (
              <div className="fd-list">
                <p className="fd-list-label">Déjà à toi</p>
                {localMatches.map(f => (
                  <FoodPickRow key={'lib_'+f.id} food={f} showImage={thumbs} onPick={()=>setPicked(f)} refByBarcode={store.refByBarcode} />
                ))}
              </div>
            )}

            {refMatches.length > 0 && (
              <div className="fd-list">
                <p className="fd-list-label">Aliments simples — table Ciqual</p>
                {refMatches.map(f => (
                  <FoodPickRow key={f.id} food={f} showImage={false} onPick={()=>pickFromRef(f)} refByBarcode={store.refByBarcode} />
                ))}
              </div>
            )}

            {results && results.length > 0 && (
              <div className="fd-list">
                <p className="fd-list-label">Aliments à code — Open Food Facts</p>
                {results.map(f => (
                  <FoodPickRow key={f.barcode || f.id} food={f} showImage={thumbs} onPick={()=>pickFromSearch(f)} refByBarcode={store.refByBarcode} />
                ))}
              </div>
            )}

            {results && !results.length && !searching && !refMatches.length && (
              <p className="fd-note serif">
                Aucun produit trouvé pour « {q} ».{' '}
                <button className="fd-link" onClick={()=>openQuick({ name: q, mode:'ingredient' })}>Le saisir à la main</button>
              </p>
            )}
            {searchErr && <p className="fd-note warn serif">{searchErr}</p>}

            {q.length >= 3 && !isCode && (
              <p className="fd-note fd-src-line serif">
                Vérifier par soi-même :{' '}
                <a href={offSearchUrl(q)} target="_blank" rel="noopener noreferrer">cette recherche sur Open Food Facts ↗</a>
              </p>
            )}
          </div>
        )}

        {tab === 'mesitems' && (
          <div className="fd-search">
            {/* Barre à icône, forme séparée : la barre est ici une bascule — ce
                qu'on regarde — et l'étoile agit dessus, en la réduisant aux
                favoris. Deux objets, donc deux contours. */}
            <IconBar detached
              icon={<StarIcon filled={favOnly} />} onIcon={()=>setFavOnly(v=>!v)} iconOn={favOnly}
              iconLabel={favOnly ? 'Voir tout' : 'Ne voir que les favoris'}>
              <Segmented size="small">
                <button className={mine==='aliments'?'on':''} onClick={()=>setMine('aliments')}>Aliments</button>
                <button className={mine==='repas'?'on':''} onClick={()=>setMine('repas')}>Repas</button>
              </Segmented>
            </IconBar>

            <div className="fd-mine-filter">
              <input placeholder="filtrer…" value={libQuery} onChange={e=>setLibQuery(e.target.value)} />
            </div>

            {mine === 'aliments' ? (
              <div className="fd-list">
                {myFoods.length
                  ? myFoods.map(f => (
                      <FoodPickRow key={f.id} food={f} showImage onPick={()=>setPicked(f)}
                        favorite={f.favorite} onToggleFavorite={()=>store.toggleFavorite(f.id)}
                        refByBarcode={store.refByBarcode} />
                    ))
                  : <p className="fd-note serif">
                      {favOnly
                        ? "Aucun aliment favori. L'étoile sur un aliment le range ici — de quoi retrouver en un geste ce que tu manges tous les jours."
                        : "Rien encore. Cherche un aliment, scanne un produit, ou crée-en un dans l'ajout rapide."}
                    </p>}
              </div>
            ) : (
              <MealsTab
                store={store} day={day} initialMeal={meal}
                favOnly={favOnly} query={libQuery}
                onDone={onClose}
                onNew={()=>setMealDraft({ name:'', items:[], steps:[], source:'custom' })}
                onEdit={(m)=>setMealDraft(m)}
              />
            )}
          </div>
        )}

        {aiEnabled && tab === 'ia' && (
          <AiAnalyseTab
            store={store} day={day} initialMeal={meal}
            onDone={onClose}
            onEditAsMeal={(draft)=>setMealDraft(draft)}
          />
        )}

        {tab === 'rapide' && (
          <QuickAddTab
            key={quickKey}
            seed={quickSeed}
            initialMeal={meal || defaultMealForNow()}
            onSubmit={submitQuickAdd}
            onCancel={onClose}
          />
        )}

        {busy && <p className="fd-note serif">Recherche…</p>}
        {msg && <p className="fd-note warn serif">{msg}</p>}
      </div>

      {mealDraft && (
        <MealEditModal
          meal={mealDraft.id ? mealDraft : null}
          store={store}
          onClose={()=>setMealDraft(null)}
          onSave={async (m)=>{ await store.saveMeal({ ...mealDraft, ...m }); setMealDraft(null); setTab('mesitems'); setMine('repas'); }}
          onDelete={mealDraft.id ? async ()=>{ await store.removeMeal(mealDraft.id); setMealDraft(null); } : null}
        />
      )}
    </div>
  );
}

// Une ligne de résultat : le nom, puis l'aperçu chiffré pour 100 g — de quoi
// trancher entre deux produits sans en ouvrir aucun. Les vignettes sont
// optionnelles : sans elles, la liste s'affiche instantanément.
function FoodPickRow({ food, onPick, showImage = false, favorite, onToggleFavorite, refByBarcode }){
  const n = food.nutriments || {};
  const src = foodSourceUrl(food, refByBarcode);
  const sub = itemSub(food, refByBarcode);
  return (
    <div className="fd-item-row">
      {onToggleFavorite && (
        <button className={`fd-fav ${favorite?'on':''}`} onClick={onToggleFavorite}
                aria-pressed={!!favorite} title={favorite ? 'Retirer des favoris' : 'Mettre en favori'}>
          <StarIcon filled={!!favorite} />
        </button>
      )}
      <button className="fd-item" onClick={onPick}>
        {showImage && (food.imageUrl
          ? <img src={food.imageUrl} alt="" loading="lazy" />
          : <span className="fd-item-ph" aria-hidden="true">{(food.name || '?').slice(0,1).toUpperCase()}</span>)}
        <span className="fd-item-txt">
          <span className="n">{food.name}</span>
          {/* D'où vient cet item, puis sa sous-catégorie — le groupe Ciqual,
              la marque. La pastille d'abord : c'est elle qui dit s'il faut
              croire ce nom sur parole ou aller vérifier une étiquette. */}
          <span className="fd-item-tags">
            <OriginTag item={food} />
            {sub && <span className="fd-item-sub">{sub}</span>}
          </span>
          <span className="m mono">
            {n.kcal != null
              ? <>
                  <b>{fmtNum(n.kcal,0)} kcal</b>
                  {n.protein != null && <> · P {fmtMacro(n.protein)}</>}
                  {n.carbs != null && <> · G {fmtMacro(n.carbs)}</>}
                  {n.fat != null && <> · L {fmtMacro(n.fat)}</>}
                  {' '}/ 100 {food.basis}
                </>
              : 'valeurs nutritionnelles manquantes'}
          </span>
        </span>
      </button>
      {src && (
        <a className="fd-item-src" href={src} target="_blank" rel="noopener noreferrer"
           title={food.source === 'ref' ? `Table Ciqual — ${food.sub || food.group}` : 'Voir la fiche sur Open Food Facts'}
           onClick={e=>e.stopPropagation()}>↗</a>
      )}
    </div>
  );
}

/* ---- Ajout rapide ----------------------------------------------------------
   Poser des chiffres soi-même, quand ni la recherche ni l'IA ne servent à
   rien. Trois choses différentes sortent d'ici, et la bascule du haut dit
   laquelle — parce que la question « est-ce que ça reste ? » n'a pas la même
   réponse dans les trois cas :

     Ajout rapide  des calories et trois macros, versées dans la journée et
                   rien d'autre. Ce n'est pas un item : c'est un correctif de
                   journée — le sandwich du midi dont on connaît l'étiquette
                   mais qu'on ne remangera jamais. Il n'a rien à faire dans la
                   bibliothèque.
     Ingrédient    la même base, plus le poids mangé et ce que les macros
                   décrivent (100 g, ou tout le poids). Ça fabrique un item :
                   un aliment personnel, réutilisable.
     À code-barres l'ingrédient, plus son code. Même item, mais reconnu au
                   scan la prochaine fois — c'est tout ce que le code ajoute,
                   et c'est ce qui en fait la peine.

   Les trois partagent la même première section, dans le même ordre, au même
   endroit : passer de l'une à l'autre ne redispose rien, ça ajoute ou retire
   une section en dessous.                                                    */
const QUICK_MODES = [
  { id:'rapide',     label:'Ajout rapide' },
  { id:'ingredient', label:'Ingrédient' },
  { id:'codebarre',  label:'À code-barres' },
];

function QuickAddTab({ seed, initialMeal, onSubmit, onCancel }){
  // Un code déjà en main (scanné, inconnu de la base) ouvre directement le
  // troisième mode : c'est le seul qui sache quoi en faire.
  const [mode, setMode] = useState(seed?.mode || (seed?.barcode ? 'codebarre' : 'rapide'));
  const [name, setName] = useState(seed?.name || '');
  const [vals, setVals] = useState({});
  const [grams, setGrams] = useState('100');
  const [per100, setPer100] = useState(true);     // les macros décrivent 100 g, ou tout le poids
  const [basis, setBasis] = useState('g');        // g | ml
  const [barcode, setBarcode] = useState(seed?.barcode || '');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNonce, setScanNonce] = useState(0);
  const [meal, setMeal] = useState(initialMeal || defaultMealForNow());

  const isItem = mode !== 'rapide';               // ce mode fabrique-t-il un aliment ?
  const g = Number(grams) || 0;

  const entered = useMemo(() => {
    const out = {};
    for (const k in vals){
      const v = parseFloat(String(vals[k]).replace(',', '.'));
      if (!isNaN(v)) out[k] = v;
    }
    return out;
  }, [vals]);

  // Un ajout rapide n'a pas de poids à déclarer : ce qu'on tape EST ce qu'on a
  // mangé, et la ligne de journal pèse 100 g par convention — invisible, et
  // suffisant pour que les totaux du jour tombent juste.
  const eatenGrams = isItem ? g : 100;
  const perQty = isItem ? !per100 : true;         // les chiffres valent pour le poids saisi
  const nutriments = perQty ? entered : scaleNutriments(entered, eatenGrams);
  const per100Values = perQty
    ? (eatenGrams > 0 ? scaleNutriments(entered, (100 / eatenGrams) * 100) : {})
    : entered;

  const hasKcal = typeof entered.kcal === 'number';
  const canSave = hasKcal && eatenGrams > 0 && (!isItem || name.trim().length > 0);

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      name: name.trim() || 'Ajout rapide',
      qty: eatenGrams, unit: isItem ? basis : 'g', grams: eatenGrams, meal, nutriments,
      per100: per100Values,
      basis,
      keep: isItem,
      barcode: mode === 'codebarre' ? cleanCode(barcode) || null : null,
    });
  };

  const enterSubmits = e=>{ if (e.key === 'Enter') submit(); };

  return (
    <div className="fd-manual-entry">
      <div className="fd-tabs">
        <Segmented size="small" scrollx>
          {QUICK_MODES.map(m => (
            <button key={m.id} className={mode===m.id?'on':''} onClick={()=>setMode(m.id)}>{m.label}</button>
          ))}
        </Segmented>
      </div>

      <p className="fd-note serif">
        {mode === 'rapide'
          ? "Des calories et trois macros, versées dans la journée. Rien n'est enregistré comme aliment : c'est un correctif de journée, pas un item."
          : mode === 'ingredient'
          ? "Un aliment personnel, gardé dans tes items — réutilisable, corrigeable, et déjà noté pour aujourd'hui."
          : "Un aliment personnel avec son code-barres : le scanner le reconnaîtra tout seul la prochaine fois."}
      </p>

      {/* Chaque section vit dans son propre cadre — la même carte que partout
          ailleurs dans l'app — plutôt qu'un simple filet horizontal : le
          regard sait où une question finit et où la suivante commence. */}
      <div className="card fd-card">
        <p className="section-label">Nom et macros</p>
        <div className="field">
          <label>Nom</label>
          <input value={name} onChange={e=>setName(e.target.value)}
                 placeholder={mode==='rapide' ? 'Sandwich du midi (facultatif)' : 'Poulet rôti, gâteau de mamie…'} />
        </div>
        {FOOD_MACROS.map(m => (
          <NumField key={m.key} label={m.short} unit={m.unit} value={vals[m.key]}
                    onChange={v=>setVals(s => ({ ...s, [m.key]: v }))} onKeyDown={enterSubmits} />
        ))}
      </div>

      {/* Section 2 — le poids, et ce que les macros au-dessus décrivent. */}
      {isItem && (
        <div className="card fd-card">
          <p className="section-label">Quantité et valeurs</p>
          <div className="field">
            <label>Mangé</label>
            <div className="fd-qty-inline">
              <input type="number" step="any" min="0" inputMode="decimal"
                     value={grams} onChange={e=>setGrams(e.target.value)} />
              <Segmented>
                {['g','ml'].map(u => (
                  <button key={u} className={basis===u?'on':''} onClick={()=>setBasis(u)}>{u}</button>
                ))}
              </Segmented>
            </div>
          </div>
          <div className="field" style={{borderBottom:'none'}}>
            <label>Les macros</label>
            <Segmented scrollx>
              <button className={per100?'on':''} onClick={()=>setPer100(true)}>valent pour 100 {basis}</button>
              <button className={!per100?'on':''} onClick={()=>setPer100(false)}>valent pour tout</button>
            </Segmented>
          </div>
          {hasKcal && g > 0 && Math.abs(g - 100) > 0.01 && (
            <div className="fd-preview">
              {FOOD_MACROS.map(m => (
                <div key={m.key}>
                  <span className="l">{m.short}</span>
                  <span className="v">{m.key==='kcal' ? fmtNum(nutriments.kcal,0) : fmtMacro(nutriments[m.key])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section 3 — le code, tapé ou scanné : les deux remplissent le même champ. */}
      {mode === 'codebarre' && (
        <div className="card fd-card">
          <p className="section-label">Code-barres</p>
          {/* Barre à icône, forme intégrée : le champ EST la barre, le bouton
              rond qui sort la caméra n'y ajoute qu'une seconde façon de
              l'écrire — comme la recherche et son scanner. */}
          <IconBar className="fd-code-bar"
            icon={<ScanIcon />} onIcon={()=>setScanOpen(v=>!v)} iconOn={scanOpen}
            iconLabel={scanOpen ? 'Fermer le scanner' : 'Scanner le code'}>
            <input inputMode="numeric" placeholder="3017620422003" value={barcode}
                   onChange={e=>setBarcode(e.target.value)} />
          </IconBar>
          {scanOpen && (
            <div className="fd-scan-panel">
              <FoodScanner key={scanNonce} onCode={(code)=>{ setBarcode(code); setScanOpen(false); setScanNonce(n=>n+1); }} />
            </div>
          )}
          <p className="fd-note serif fd-card-note">
            {cleanCode(barcode).length >= 8
              ? <>Code <span className="mono">{cleanCode(barcode)}</span> — cet aliment sortira tout seul au prochain scan.</>
              : 'Sans code, ça reste un aliment normal : simplement, aucun scan ne le retrouvera.'}
          </p>
        </div>
      )}

      <div className="card fd-card">
        <p className="section-label">Repas</p>
        <Segmented scrollx>
          {MEALS.map(m => (
            <button key={m.id} className={meal===m.id?'on':''} onClick={()=>setMeal(m.id)}>{m.label}</button>
          ))}
        </Segmented>
      </div>

      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Annuler</button>
        <button className="primary" disabled={!canSave} onClick={submit}>
          {isItem ? 'Créer et noter' : 'Noter'}
        </button>
      </div>
    </div>
  );
}

/* ---- Quantité ------------------------------------------------------------- */
function QuantityModal({ title, food, initialQty, initialUnit, initialMeal, onClose, onBack, onSubmit }){
  const hasServing = !!(food.servingG && food.servingG > 0);
  const [unit, setUnit] = useState(initialUnit || (hasServing ? 'portion' : (food.basis || 'g')));
  const [qty, setQty] = useState(initialQty != null ? String(initialQty) : (hasServing ? '1' : '100'));
  const [meal, setMeal] = useState(initialMeal || defaultMealForNow());

  const grams = resolveGrams(qty, unit, food);
  const nutriments = useMemo(() => scaleNutriments(food.nutriments || {}, grams), [food, grams]);
  const canSave = grams > 0;

  const chips = hasServing
    ? [['1 portion', 1, 'portion'], ['2 portions', 2, 'portion'], ['100 ' + food.basis, 100, food.basis]]
    : [['50 ' + food.basis, 50, food.basis], ['100 ' + food.basis, 100, food.basis], ['200 ' + food.basis, 200, food.basis]];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal fd-modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
        <h2>{title}</h2>
        <div className="modal-sub">
          {foodLabel(food)}
          {foodSourceUrl(food) && (
            <>{' · '}<a className="fd-src-link" href={foodSourceUrl(food)} target="_blank" rel="noopener noreferrer">
              {food.source === 'ref' ? 'fiche Ciqual ↗' : 'fiche Open Food Facts ↗'}
            </a></>
          )}
        </div>

        <div className="fd-qty">
          <input
            type="number" step="any" min="0" value={qty}
            onChange={e=>setQty(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && canSave) onSubmit({ qty:Number(qty), unit, grams, meal, nutriments }); }}
          />
          <Segmented>
            <button className={unit===food.basis?'on':''} onClick={()=>setUnit(food.basis)}>{food.basis}</button>
            {hasServing && (
              <button className={unit==='portion'?'on':''} onClick={()=>setUnit('portion')}>
                portion ({fmtNum(food.servingG,0)} {food.basis})
              </button>
            )}
          </Segmented>
        </div>

        <div className="fd-chips">
          {chips.map(([label, v, u]) => (
            <button key={label} onClick={()=>{ setQty(String(v)); setUnit(u); }}>{label}</button>
          ))}
        </div>

        <div className="fd-preview">
          {FOOD_MACROS.map(m => (
            <div key={m.key}>
              <span className="l">{m.short}</span>
              <span className="v">{m.key==='kcal' ? fmtNum(nutriments.kcal,0) : fmtMacro(nutriments[m.key])}</span>
            </div>
          ))}
        </div>

        <div className="field" style={{borderBottom:'none'}}>
          <label>Repas</label>
          <Segmented scrollx>
            {MEALS.map(m => (
              <button key={m.id} className={meal===m.id?'on':''} onClick={()=>setMeal(m.id)}>{m.label}</button>
            ))}
          </Segmented>
        </div>

        <div className="modal-actions">
          {onBack && <button className="ghost" onClick={onBack}>Retour</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave}
            onClick={()=>onSubmit({ qty:Number(qty), unit, grams, meal, nutriments })}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Aliments (la bibliothèque) ------------------------------------------- */

function FoodLibraryView({ store, onEdit, onDelete, onNew, onScan, onNewMeal, onEditMeal }){
  const [q, setQ] = useState('');
  // Trois vues sur ce qui est déjà à soi, la même distinction que dans la modale
  // d'ajout : tous les aliments, ceux mis de côté, et les repas.
  const [tab, setTab] = useState('aliments');   // aliments | favoris | repas
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let arr = tab === 'favoris' ? store.foods.filter(f => f.favorite) : store.foods;
    if (needle) arr = arr.filter(f => foodLabel(f).toLowerCase().includes(needle) || (f.barcode || '').includes(needle));
    return [...arr].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
  }, [store.foods, q, tab]);
  const mealList = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = needle ? store.meals.filter(m => m.name.toLowerCase().includes(needle)) : store.meals;
    return [...arr].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
  }, [store.meals, q]);

  const favCount = store.foods.filter(f => f.favorite).length;


  if (tab === 'repas'){
    return (
      <div>
        <div className="trackers-head">
          <Segmented size="small">
            <button onClick={()=>setTab('aliments')}>Mes aliments</button>
            <button onClick={()=>setTab('favoris')}>Mes favoris</button>
            <button className="on">Mes repas · {store.meals.length}</button>
          </Segmented>
          <div className="fd-lib-actions">
            <input className="fd-lib-search" placeholder="filtrer…" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="pill add" onClick={onNewMeal}>+ Repas</button>
          </div>
        </div>
        {!mealList.length ? (
          <div className="empty">
            <span className="em-serif">Aucun repas.</span>
            Un repas est un ensemble d'ingrédients qu'on ajoute d'un coup — un petit-déjeuner
            habituel, un plat qui revient. Une recette peut y être attachée.
          </div>
        ) : (
          <div className="trackers-grid">
            {mealList.map(m => {
              const t = itemsTotals(m.items);
              return (
                <div className="tk-card fd-food-card" key={m.id}>
                  <div className="tk-info">
                    <div className="tk-name"><span>{m.name}</span></div>
                    <div className="tk-meta">
                      <OriginTag item={m} />
                      <span className="tk-chip">{m.items.length} ingrédient{m.items.length>1?'s':''}</span>
                      {m.steps && m.steps.length > 0 && <span className="tk-type">recette · {m.steps.length} étapes</span>}
                    </div>
                    <div className="fd-food-nums mono">
                      {fmtNum(t.kcal,0)} kcal · P {fmtMacro(t.protein)} · G {fmtMacro(t.carbs)} · L {fmtMacro(t.fat)}
                      <span className="fd-per"> au total</span>
                    </div>
                  </div>
                  {/* Un repas est un item : il porte la même étoile qu'un aliment. */}
                  <div className="tk-actions fd-food-actions">
                    <button className={`tk-edit fd-fav-btn ${m.favorite?'on':''}`}
                            onClick={()=>store.toggleMealFavorite(m.id)} aria-pressed={!!m.favorite}>
                      {m.favorite ? '★ Favori' : '☆ Favori'}
                    </button>
                    <button className="tk-edit" onClick={()=>onEditMeal(m)}>Modifier</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="trackers-head">
        <Segmented size="small">
          <button className={tab==='aliments'?'on':''} onClick={()=>setTab('aliments')}>
            Mes aliments · {store.foods.length}
          </button>
          <button className={tab==='favoris'?'on':''} onClick={()=>setTab('favoris')}>
            Mes favoris{favCount ? ` · ${favCount}` : ''}
          </button>
          <button onClick={()=>setTab('repas')}>Mes repas · {store.meals.length}</button>
        </Segmented>
        <div className="fd-lib-actions">
          <input className="fd-lib-search" placeholder="filtrer…" value={q} onChange={e=>setQ(e.target.value)} />
          <button className="pill add" onClick={onScan}>Ajouter à ma journée</button>
          <button className="pill add" onClick={onNew}>+ Aliment</button>
        </div>
      </div>

      {!list.length ? (
        <div className="empty">
          <span className="em-serif">Aucun aliment.</span>
          Scannez une étiquette, ou cherchez un aliment simple — poulet, riz, framboise : tout ce que
          vous utilisez atterrit ici, et y reste disponible même hors ligne.
        </div>
      ) : (
        <div className="trackers-grid fd-foods-grid">
          {list.map(f => {
            const n = f.nutriments || {};
            return (
              <div className="tk-card fd-food-card" key={f.id}>
                <div className="tk-info">
                  <div className="tk-name"><span>{f.name}</span></div>
                  <div className="tk-meta">
                    <OriginTag item={f} />
                    {itemSub(f, store.refByBarcode) && <span className="tk-chip">{itemSub(f, store.refByBarcode)}</span>}
                    {f.barcode && !String(f.barcode).startsWith('ciqual:') && <span className="tk-count mono">{f.barcode}</span>}
                  </div>
                  <div className="fd-food-nums mono">
                    {n.kcal != null ? `${fmtNum(n.kcal,0)} kcal` : 'sans valeurs'}
                    {n.protein != null ? ` · P ${fmtMacro(n.protein)}` : ''}
                    {n.carbs != null ? ` · G ${fmtMacro(n.carbs)}` : ''}
                    {n.fat != null ? ` · L ${fmtMacro(n.fat)}` : ''}
                    <span className="fd-per"> / 100 {f.basis}</span>
                  </div>
                </div>
                {/* Une seule ligne d'actions : favori, modifier, supprimer, puis la
                    source — celle-ci réduite à sa flèche, parce qu'elle sort de
                    l'app et n'a pas à peser autant que ce qu'on fait dedans. */}
                <div className="tk-actions fd-food-actions">
                  <button className={`tk-edit fd-fav-btn ${f.favorite?'on':''}`}
                          onClick={()=>store.toggleFavorite(f.id)} aria-pressed={!!f.favorite}>
                    {f.favorite ? '★ Favori' : '☆ Favori'}
                  </button>
                  <button className="tk-edit" onClick={()=>onEdit(f)}>Modifier</button>
                  <button className="tk-edit danger-edit" onClick={()=>onDelete(f)}>Supprimer</button>
                  {foodSourceUrl(f, store.refByBarcode) && (
                    <a className="icon-btn fd-src-btn" href={foodSourceUrl(f, store.refByBarcode)}
                       target="_blank" rel="noopener noreferrer"
                       aria-label="Voir la fiche d'origine" title="Voir la fiche d'origine">
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                           strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4.6 9.4L9.4 4.6"/><path d="M5.4 4.6h4v4"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Créer / corriger un aliment ------------------------------------------ */
function FoodEditModal({ food, isNew, onClose, onSave, onDelete }){
  const [name, setName] = useState(food.name || '');
  const [brand, setBrand] = useState(food.brand || '');
  const [basis, setBasis] = useState(food.basis || 'g');
  const [serving, setServing] = useState(food.servingG != null ? String(food.servingG) : '');
  const [vals, setVals] = useState(() => {
    const o = {};
    for (const k in (food.nutriments || {})) o[k] = String(food.nutriments[k]);
    return o;
  });
  const [showMore, setShowMore] = useState(
    FOOD_DETAILS.concat(FOOD_MICROS).some(x => food.nutriments && food.nutriments[x.key] != null)
  );

  const setVal = (k, v) => setVals(s => ({ ...s, [k]: v }));
  const canSave = name.trim().length > 0 && vals.kcal !== '' && vals.kcal != null && !isNaN(parseFloat(vals.kcal));

  const submit = () => {
    const nutriments = {};
    for (const k in vals){
      const v = parseFloat(String(vals[k]).replace(',', '.'));
      if (!isNaN(v)) nutriments[k] = v;
    }
    onSave({
      ...food,
      name: name.trim(),
      brand: brand.trim(),
      basis,
      servingG: serving.trim() ? parseFloat(serving.replace(',', '.')) : null,
      nutriments,
      // Un produit scanné qu'on complète à la main reste rattaché à son code-barres :
      // c'est ce qui fait qu'au prochain scan, il est reconnu tout de suite.
      source: food.source === 'off' ? 'off' : 'custom',
    });
  };

  const numField = (key, label, unit) => (
    <NumField key={key} label={label} unit={unit} value={vals[key]} onChange={v=>setVal(key, v)} />
  );

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal fd-modal" onClick={e=>e.stopPropagation()}>
        <h2>{isNew ? 'Nouvel aliment' : 'Modifier l’aliment'}</h2>
        <div className="modal-sub">
          Les valeurs sont celles de l'étiquette, pour 100 {basis}.
          {food.barcode ? ` Code ${food.barcode}.` : ''}
        </div>

        <div className="field">
          <label>Nom</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Riz basmati cuit" />
        </div>
        <div className="field">
          <label>Marque</label>
          <input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="optionnel" />
        </div>
        <div className="field">
          <label>Base</label>
          <Segmented>
            <button className={basis==='g'?'on':''} onClick={()=>setBasis('g')}>solide (g)</button>
            <button className={basis==='ml'?'on':''} onClick={()=>setBasis('ml')}>liquide (ml)</button>
          </Segmented>
        </div>
        <div className="field">
          <label>Portion</label>
          <div className="field-num">
            <input type="number" step="any" min="0" placeholder="optionnel"
              value={serving} onChange={e=>setServing(e.target.value)} />
            <span className="unit">{basis}</span>
          </div>
        </div>

        <div className="modal-section">
          <p className="section-label">Pour 100 {basis}</p>
          {FOOD_MACROS.map(m => numField(m.key, m.label, m.unit))}
        </div>

        <div className="modal-section">
          <button className="fd-link" onClick={()=>setShowMore(v=>!v)}>
            {showMore ? 'Masquer' : 'Ajouter'} le détail et les micronutriments
          </button>
          {showMore && (
            <div className="fd-more-fields">
              {FOOD_DETAILS.map(d => numField(d.key, d.label, d.unit))}
              {FOOD_MICROS.map(m => numField(m.key, m.label, m.unit))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          {onDelete && <button className="danger" onClick={()=>{ if(confirm('Supprimer cet aliment ? Les repas déjà enregistrés ne changent pas.')) onDelete(); }}>Supprimer</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Objectifs ------------------------------------------------------------ */
const MACRO_GOAL_KEYS = ['protein', 'carbs', 'fat'];

function GoalsModal({ goals, isSet, onClose, onSave }){
  const [kcalStr, setKcalStr] = useState(goals.kcal != null ? String(goals.kcal) : '');
  const [weightStr, setWeightStr] = useState(goals.weightKg != null ? String(goals.weightKg) : '');
  // Un objectif de macro se retape sous la forme où il a été réglé : un
  // gramme direct, ou le ratio (% de kcal, g/kg) qui l'a produit — pas le
  // gramme calculé, qu'on redemanderait sinon à recalculer à la main à
  // chaque ouverture.
  const initMacro = (key) => {
    const mode = goals[key + 'Mode'] || 'grams';
    const raw = mode === 'grams' ? goals[key] : goals[key + 'Ratio'];
    return { mode, raw: raw != null ? String(raw) : '' };
  };
  const [macro, setMacro] = useState(() => Object.fromEntries(MACRO_GOAL_KEYS.map(k => [k, initMacro(k)])));

  const kcalNum = (() => { const n = parseFloat(kcalStr.replace(',', '.')); return isNaN(n) ? null : n; })();
  const weightNum = (() => { const n = parseFloat(weightStr.replace(',', '.')); return isNaN(n) ? null : n; })();
  const macroNum = (key) => { const n = parseFloat(String(macro[key].raw).replace(',', '.')); return isNaN(n) ? null : n; };
  const macroGrams = (key) => macroGramsFromRatio(key, macro[key].mode, macroNum(key), kcalNum, weightNum);
  const setMode = (key, mode) => setMacro(s => ({ ...s, [key]: { ...s[key], mode } }));
  const setRaw = (key, raw) => setMacro(s => ({ ...s, [key]: { ...s[key], raw } }));

  const grams = Object.fromEntries(MACRO_GOAL_KEYS.map(k => [k, macroGrams(k)]));
  // 4 kcal/g pour les protéines et les glucides, 9 pour les lipides : de quoi
  // voir tout de suite si les trois macros tiennent dans l'objectif calorique,
  // quel que soit le mode qui les a produites.
  const implied = (grams.protein || 0) * 4 + (grams.carbs || 0) * 4 + (grams.fat || 0) * 9;
  const usesWeight = MACRO_GOAL_KEYS.some(k => macro[k].mode === 'perkg');

  const submit = () => {
    const patch = { kcal: kcalNum, weightKg: weightNum };
    for (const k of MACRO_GOAL_KEYS){
      patch[k] = grams[k];
      patch[k + 'Mode'] = macro[k].mode;
      patch[k + 'Ratio'] = macro[k].mode === 'grams' ? null : macroNum(k);
    }
    onSave(patch);
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <h2>Objectifs du jour</h2>
        <div className="modal-sub">
          {isSet ? 'Ce que vous visez chaque jour.' : 'Valeurs par défaut — remplacez-les par les vôtres.'}
        </div>

        <div className="field">
          <label>{MACRO_BY_KEY.kcal.label}</label>
          <div className="field-num">
            <input type="number" step="any" min="0"
              value={kcalStr} onChange={e=>setKcalStr(e.target.value)} />
            <span className="unit">{MACRO_BY_KEY.kcal.unit}</span>
          </div>
        </div>

        {/* Le poids n'est demandé que pour calculer un g/kg — mais il reste ici,
            pas replié derrière le mode, pour ne pas le faire disparaître et
            réapparaître à chaque bascule de Segmented. */}
        <div className="field" style={{opacity: usesWeight ? 1 : 0.55}}>
          <label>Poids</label>
          <div className="field-num">
            <input type="number" step="any" min="0"
              value={weightStr} onChange={e=>setWeightStr(e.target.value)}
              placeholder={usesWeight ? 'requis pour g/kg' : 'optionnel'} />
            <span className="unit">kg</span>
          </div>
        </div>

        {MACRO_GOAL_KEYS.map(key => {
          const m = MACRO_BY_KEY[key];
          const mode = macro[key].mode;
          const modeDef = GOAL_MODES.find(g => g.id === mode);
          const computed = grams[key];
          return (
            <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:8}} key={key}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                <label style={{width:'auto'}}>{m.label}</label>
                <Segmented size="small">
                  {GOAL_MODES.map(gm => (
                    <button key={gm.id} className={mode===gm.id?'on':''} onClick={()=>setMode(key, gm.id)}>{gm.label}</button>
                  ))}
                </Segmented>
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                <input type="number" step="any" min="0" style={{width:'100%'}}
                  value={macro[key].raw} onChange={e=>setRaw(key, e.target.value)} />
                <span className="unit">{modeDef.unit(m)}</span>
                {mode !== 'grams' && (
                  <span className="goal-macro-derived mono">
                    {computed != null ? `→ ${fmtNum(computed, 0)} g` : `→ renseigne ${mode==='percent' ? 'les calories' : 'le poids'}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {implied > 0 && (
          <p className="fd-note serif">
            Ces macros font <span className="mono">{fmtNum(implied,0)} kcal</span>
            {kcalNum ? ` pour un objectif de ${fmtNum(kcalNum,0)} kcal.` : '.'}
          </p>
        )}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Vues ----------------------------------------------------------------- */
const FOOD_RANGES = [7, 14, 30, 90];

function FoodVuesView({ store, onGoals }){
  const [rangeDays, setRangeDays] = useState(14);
  const [metric, setMetric] = useState('kcal');
  const goals = store.effectiveGoals;

  // Une barre par jour, y compris les jours vides : un trou dans le suivi est
  // une information, pas un jour à sauter.
  const series = useMemo(() => {
    const out = [];
    const today = startOfDay(Date.now());
    for (let i = rangeDays - 1; i >= 0; i--){
      const ts = today - i * 86400000;
      const dk = dayKey(ts);
      const rows = store.logsByDay[dk] || [];
      out.push({ dk, ts, logged: rows.length > 0, totals: sumNutriments(rows.map(l => l.nutriments)) });
    }
    return out;
  }, [store.logsByDay, rangeDays]);

  const loggedDays = series.filter(d => d.logged);
  const avg = loggedDays.length
    ? loggedDays.reduce((s,d) => s + (d.totals[metric] || 0), 0) / loggedDays.length
    : null;
  const goal = goals[metric] || 0;
  const inRange = goal > 0
    ? loggedDays.filter(d => Math.abs((d.totals[metric] || 0) - goal) <= goal * 0.1).length
    : null;

  // Répartition calorique moyenne sur les jours notés.
  const split = useMemo(() => {
    if (!loggedDays.length) return null;
    const p = loggedDays.reduce((s,d) => s + (d.totals.protein || 0), 0) * 4;
    const c = loggedDays.reduce((s,d) => s + (d.totals.carbs || 0), 0) * 4;
    const f = loggedDays.reduce((s,d) => s + (d.totals.fat || 0), 0) * 9;
    const tot = p + c + f;
    if (tot <= 0) return null;
    return { protein:(p/tot)*100, carbs:(c/tot)*100, fat:(f/tot)*100 };
  }, [loggedDays]);

  const m = MACRO_BY_KEY[metric];

  return (
    <div>
      <div className="vue-controls">
        <Segmented size="compact">
          {FOOD_MACROS.map(x => (
            <button key={x.key} className={metric===x.key?'on':''} onClick={()=>setMetric(x.key)}>{x.label}</button>
          ))}
        </Segmented>
        <div className="range">
          {FOOD_RANGES.map(r => (
            <button key={r} className={rangeDays===r?'on':''} onClick={()=>setRangeDays(r)}>{r}j</button>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-head">
          <div className="name"><span className="dot" style={{background:m.color}}></span>{m.label} par jour</div>
          <div className="chart-head-right">
            <div className="stats">
              <div>moyenne <span className="v">{avg != null ? `${fmtNum(avg,0)} ${m.unit}` : '—'}</span></div>
              <div>objectif <span className="v">{goal > 0 ? `${fmtNum(goal,0)} ${m.unit}` : '—'}</span></div>
              <div>jours notés <span className="v">{loggedDays.length}</span></div>
              {inRange != null && <div>dans la cible <span className="v">{inRange}</span></div>}
            </div>
            <button className="icon-btn chart-edit-btn" onClick={onGoals} title="Objectifs" aria-label="Objectifs">
              <GearIcon />
            </button>
          </div>
        </div>
        <NutritionBars series={series} metric={metric} color={m.color} goal={goal} />
      </div>

      {split && (
        <div className="chart-card" style={{marginTop:14}}>
          <div className="chart-head">
            <div className="name">Répartition des calories</div>
            <div className="stats"><div>sur {loggedDays.length} jour{loggedDays.length>1?'s':''} noté{loggedDays.length>1?'s':''}</div></div>
          </div>
          <div className="fd-split">
            {['protein','carbs','fat'].map(k => (
              <span key={k} className="fd-split-part" style={{width:`${split[k]}%`, background:MACRO_BY_KEY[k].color}}
                title={`${MACRO_BY_KEY[k].label} ${Math.round(split[k])}%`} />
            ))}
          </div>
          <div className="master-legend">
            {['protein','carbs','fat'].map(k => (
              <span className="lg-item" key={k}>
                <span className="lg-dot" style={{background:MACRO_BY_KEY[k].color}} />
                <span className="lg-name">{MACRO_BY_KEY[k].label}</span>
                <span className="lg-val">{Math.round(split[k])}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NutritionBars({ series, metric, color, goal }){
  const W = 680, H = 170, PAD_L = 38, PAD_R = 8, PAD_T = 10, PAD_B = 20;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const values = series.map(d => d.totals[metric] || 0);
  const max = Math.max(goal || 0, ...values, 1);
  const dom = niceDomain(0, max, 4, 'number');
  const yAt = (v) => PAD_T + innerH - ((v - dom.min) / (dom.max - dom.min)) * innerH;
  const slot = innerW / series.length;
  const barW = Math.max(2, Math.min(26, slot * 0.62));

  if (!series.some(d => d.logged)){
    return <div style={{padding:'30px 0',textAlign:'center',color:'var(--ink-3)',fontSize:13}}>aucun repas noté sur la période</div>;
  }

  return (
    <svg className="chart-svg" style={{height:H+'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {dom.ticks.map((v,i) => (
        <g key={i}>
          <line className="chart-grid" x1={PAD_L} x2={W-PAD_R} y1={yAt(v)} y2={yAt(v)} />
          <text className="chart-axis" x={PAD_L-6} y={yAt(v)+3} textAnchor="end">{fmtNum(v,0)}</text>
        </g>
      ))}
      {series.map((d,i) => {
        const v = d.totals[metric] || 0;
        const x = PAD_L + slot*i + (slot - barW)/2;
        const y = yAt(v);
        return (
          <rect key={d.dk} x={x} y={Math.min(y, PAD_T+innerH-1)} width={barW}
            height={Math.max(d.logged ? 1 : 0, PAD_T + innerH - y)}
            fill={color} opacity={d.logged ? 0.85 : 0.15} rx="1">
            <title>{shortDate(d.ts)} · {fmtNum(v,0)}</title>
          </rect>
        );
      })}
      {goal > 0 && (
        <line x1={PAD_L} x2={W-PAD_R} y1={yAt(goal)} y2={yAt(goal)}
          stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      )}
      {series.map((d,i) => (i === 0 || i === series.length-1 || i === Math.floor(series.length/2)) && (
        <text key={`x${i}`} className="chart-axis" x={PAD_L + slot*i + slot/2} y={H-5}
          textAnchor={i===0?'start':i===series.length-1?'end':'middle'}>{shortDate(d.ts)}</text>
      ))}
    </svg>
  );
}

/* ============================================================
   Le pont vers la page Log — troisième catégorie du Jour,
   à côté des quotidiens et des « plusieurs par jour ».
   Lecture seule : on note ce qu'on mange dans la page Food, ici
   on ne fait que voir où en est la journée.
   ============================================================ */
function FoodDaySummary({ store, onOpen }){
  const dk = dayKey(Date.now());
  const rows = store.logsByDay[dk] || [];
  const totals = useMemo(() => sumNutriments(rows.map(l => l.nutriments)), [rows]);
  const goals = store.effectiveGoals;

  return (
    <div className="day-group fd-log-group">
      <div className="fd-log-head">
        <p className="section-label" style={{margin:0}}>Alimentation</p>
        <button className="fd-link" onClick={onOpen}>
          {rows.length ? `${rows.length} ligne${rows.length>1?'s':''} — ouvrir` : 'ouvrir la page Food'}
        </button>
      </div>
      <div className="today-grid">
        {FOOD_MACROS.map(m => {
          const v = totals[m.key] || 0;
          const goal = goals[m.key] || 0;
          const pct = goal > 0 ? Math.min(100, (v/goal)*100) : 0;
          const over = goal > 0 && v > goal;
          return (
            <div className={`today-card fd-card ${rows.length?'done':''}`} key={m.key} onClick={onOpen} role="button" tabIndex={0}
                 onKeyDown={e=>{ if(e.key==='Enter') onOpen(); }}>
              <div className="tc-head">
                {/* Même convention que les cartes de tracker : le nom porte la
                    couleur, pas de puce qui répète la même information. */}
                <div className="tc-name" style={{color:m.color}}>{m.label}</div>
                <span className="tc-badge">food</span>
              </div>
              <div className="fd-card-v">
                {m.key === 'kcal' ? fmtNum(v,0) : fmtMacro(v)}
                <span className="u">{m.unit}</span>
              </div>
              <span className="fd-meter"><span className={`fd-fill ${over?'over':''}`} style={{width:`${pct}%`,background:m.color}} /></span>
              <div className="fd-card-goal mono">
                {goal > 0
                  ? (m.key === 'kcal'
                      ? `${fmtNum(v,0)} kcal / ${fmtNum(goal,0)} kcal`
                      : `${fmtMacro(v)}g / ${fmtMacro(goal)}g`)
                  : 'sans objectif'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
