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
// « Modifier cette chose » quand ce n'est pas un réglage mais un contenu : un
// crayon, là où l'engrenage dirait « réglages ».
function PencilIcon({ size = 12 }){
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9.1 2.3l2.6 2.6M2 12l.5-2.4 7-7 2.6 2.6-7 7L2 12z" />
    </svg>
  );
}
// Oublier un item : le retirer de ce qui est à soi, comme si on ne l'avait
// jamais utilisé. Une corbeille, parce que ce n'est pas « masquer ».
function TrashIcon({ size = 12 }){
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.5 3.6h9M5.6 3.6V2.4h2.8v1.2M3.6 3.6l.5 7.4h5.8l.5-7.4M5.9 5.9v3M8.1 5.9v3" />
    </svg>
  );
}
// Montrer ou cacher les vignettes d'une liste.
function ImageIcon({ size = 12 }){
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="1.8" y="2.8" width="10.4" height="8.4" rx="1.4" />
      <circle cx="5" cy="5.9" r="0.9" /><path d="M2.4 9.6l2.9-2.5 3 2.4 1.6-1.3 1.7 1.5" />
    </svg>
  );
}
// La flèche « ça sort de l'app » — fiche Ciqual, fiche Open Food Facts.
function ExternalIcon({ size = 12 }){
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.6 9.4L9.4 4.6"/><path d="M5.4 4.6h4v4"/>
    </svg>
  );
}

// Une ligne de champ numérique — label à gauche, saisie et unité à droite —
// la même rangée dense que tout `.field` de l'app. Trois formulaires posaient
// chacun leur propre variante (une grille 4 colonnes ici, un style en ligne
// là) pour dire la même chose ; ils partagent maintenant celle-ci plutôt que
// de continuer à dériver chacun de son côté.
function NumField({ label, unit, value, onChange, onKeyDown, placeholder = '—', info = null }){
  return (
    <div className={`field ${info ? 'field-info' : ''}`}>
      <label>{label}</label>
      <div className="field-num">
        <input type="number" step="any" min="0" inputMode="decimal" placeholder={placeholder}
               value={value ?? ''} onChange={e=>onChange(e.target.value)} onKeyDown={onKeyDown} />
        <span className="unit">{unit}</span>
      </div>
      {/* Le « i » est posé sur la rangée, pas dans l'intitulé : c'est la rangée
          entière qui accueille le cadre d'explication en dessous. */}
      {info && <InfoBubble title={label}>{info}</InfoBubble>}
    </div>
  );
}

/* ---- Ce qu'on compte -----------------------------------------------------
   Les 4 macros sont les compteurs de tête : ce sont elles qui remontent dans
   la page Log, elles qui ont un objectif, elles qui ont un graphe.
   Tout le reste (sucres, sel, vitamines…) est du détail affiché quand
   l'étiquette le porte. */
/* Une couleur par macro, prises dans le nuancier de l'app (mêmes paliers de
   luminosité, même chroma que les couleurs de tracker) : vert les calories,
   rouge les protéines, bleu les glucides, jaune les lipides. Elles ne suivent
   pas l'accent — ce sont quatre repères qu'on apprend une fois, et qui doivent
   rester les mêmes quelle que soit la couleur choisie pour l'app. */
const FOOD_MACROS = [
  { key:'kcal',    label:'Calories',  short:'kcal', unit:'kcal', color:'oklch(0.62 0.11 150)' },
  { key:'protein', label:'Protéines', short:'prot', unit:'g',    color:'oklch(0.60 0.13 25)'  },
  { key:'carbs',   label:'Glucides',  short:'gluc', unit:'g',    color:'oklch(0.62 0.11 250)' },
  { key:'fat',     label:'Lipides',   short:'lip',  unit:'g',    color:'oklch(0.75 0.12 90)'  },
];
/* Dépasser sa cible calorique de quelques calories n'est pas un écart : c'est
   la précision de l'estimation. Au-delà de 2,5 %, c'en est un, et le chiffre
   comme la barre passent au rouge. Seules les calories : une macro au-dessus de
   sa cible n'est pas une mauvaise nouvelle en soi (des protéines, par exemple). */
const KCAL_OVER_TOLERANCE = 0.025;
const kcalOverrun = (key, v, goal) => key === 'kcal' && goal > 0 && v > goal * (1 + KCAL_OVER_TOLERANCE);
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
/* Une étape de recette : un texte, un état coché, et un identifiant stable —
   le glisser-déposer désigne une ligne, pas son rang, et le rang change
   justement à chaque réordonnancement. Les repas enregistrés avant portaient
   de simples chaînes : elles sont relues telles quelles plutôt que perdues. */
function mkStep(partial = {}){ return { id: uid('st_'), text:'', done:false, mins:null, ...partial }; }
function stepsFromRows(raw){
  return (Array.isArray(raw) ? raw : []).map(s => typeof s === 'string'
    ? mkStep({ text: s })
    : mkStep({ ...s, text: String(s.text || ''), done: !!s.done,
               mins: Number(s.mins) > 0 ? Number(s.mins) : null }));
}

/* Combien de portions la recette produit. La recette entière reste la vérité —
   les ingrédients sont pesés pour elle — et une portion s'en déduit par
   division. L'inverse (tout stocker par portion) obligerait à remultiplier
   partout, et à retoucher chaque ingrédient dès qu'on change le nombre. */
const mealPortions = (m) => { const n = Number(m && m.portions); return n > 0 ? n : 1; };

function mealFromRow(r){
  return { id:r.id, name:r.name, source:r.source || 'custom', items:Array.isArray(r.items) ? r.items : [],
           steps:stepsFromRows(r.steps), favorite:!!r.favorite, portions:mealPortions(r),
           createdAt:Number(r.created_at), lastUsedAt:r.last_used_at ? Number(r.last_used_at) : null };
}
function mealToRow(m, userId){
  return { id:m.id, user_id:userId, name:m.name, source:m.source || 'custom',
           items:m.items || [], steps:stepsFromRows(m.steps), favorite:!!m.favorite,
           portions:mealPortions(m),
           created_at:m.createdAt, last_used_at:m.lastUsedAt ?? null };
}

/* Un objectif et sa date de prise d'effet. `fromDay` fait partie de la clé :
   deux consignes ne peuvent pas se disputer le même jour, et l'ordre des dates
   est celui des chaînes 'AAAA-MM-JJ', donc trier et comparer se font sans rien
   convertir. Les lignes d'avant la datation portent la date plancher — elles
   valaient « depuis toujours », et continuent. */
function goalFromRow(r){
  return { fromDay: r.from_day || '1970-01-01',
           kcal:r.kcal ?? null, protein:r.protein_g ?? null, carbs:r.carbs_g ?? null, fat:r.fat_g ?? null,
           weightKg:r.weight_kg ?? null,
           proteinMode:r.protein_mode || 'grams', proteinRatio:r.protein_ratio ?? null,
           carbsMode:r.carbs_mode || 'grams', carbsRatio:r.carbs_ratio ?? null,
           fatMode:r.fat_mode || 'grams', fatRatio:r.fat_ratio ?? null };
}
function goalToRow(g, userId, fromDay){
  return { user_id:userId, from_day:fromDay, kcal:g.kcal ?? null, protein_g:g.protein ?? null,
           carbs_g:g.carbs ?? null, fat_g:g.fat ?? null, weight_kg:g.weightKg ?? null,
           protein_mode:g.proteinMode || 'grams', protein_ratio:g.proteinRatio ?? null,
           carbs_mode:g.carbsMode || 'grams', carbs_ratio:g.carbsRatio ?? null,
           fat_mode:g.fatMode || 'grams', fat_ratio:g.fatRatio ?? null,
           updated_at:Date.now() };
}
const sortGoals = (rows) => [...rows].sort((a, b) => a.fromDay < b.fromDay ? -1 : a.fromDay > b.fromDay ? 1 : 0);

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
  // Les objectifs sont datés : une ligne par date de prise d'effet, triées du
  // plus ancien au plus récent. Un jour lit la dernière consigne posée à cette
  // date ou avant — changer d'objectif vaut donc pour ce jour-là et les
  // suivants, et l'histoire d'avant garde la sienne. C'est la seule façon
  // qu'un graphe sur 90 jours dise la vérité : la cible d'il y a deux mois
  // n'était pas celle d'aujourd'hui.
  const [goalRows, setGoalRows] = useState([]);
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
        supabase.from('nutrition_goals').select('*'),
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
      if (!g.error && g.data) setGoalRows(sortGoals(g.data.map(goalFromRow)));
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /* ---- Écrire d'abord dans l'écran, envoyer ensuite -------------------------
     Attendre la base avant de refermer une page, c'est faire porter à
     l'utilisateur un aller-retour réseau qu'il n'a aucune raison de voir : ce
     qu'il vient de saisir est déjà connu, la base ne fait que le confirmer.
     L'état local est donc posé tout de suite et l'écriture part derrière.

     La contrepartie est qu'un échec n'a plus de « return » pour l'arrêter : il
     doit défaire ce qu'il a affiché ET le dire. Un échec muet serait pire que
     l'attente — c'est exactement ce qui laissait croire un objectif enregistré
     alors qu'il ne l'était pas. */
  const writeFailed = (what, error) => {
    console.error('tracklog: écriture refusée —', what, error);
    alert(`Impossible d'enregistrer ${what} : ${(error && error.message) || 'la base a refusé.'}`);
  };

  // Un produit scanné deux fois ne fait qu'une ligne : le code-barres est unique
  // par compte (index côté base), on met donc à jour la fiche existante.
  const saveFood = (food) => {
    const known = food.barcode ? foods.find(f => f.barcode === food.barcode) : null;
    const merged = known ? { ...known, ...food, id:known.id, createdAt:known.createdAt } : food;
    setFoods(s => known ? s.map(f => f.id === merged.id ? merged : f) : [merged, ...s]);
    supabase.from('foods').upsert(foodToRow(merged, userId)).then(({ error }) => {
      if (!error) return;
      setFoods(s => known ? s.map(f => f.id === merged.id ? known : f) : s.filter(f => f.id !== merged.id));
      writeFailed(`« ${merged.name} »`, error);
    });
    return merged;
  };
  const updateFood = (id, patch) => {
    const current = foods.find(f => f.id === id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    setFoods(s => s.map(f => f.id === id ? updated : f));
    supabase.from('foods').update(foodToRow(updated, userId)).eq('id', id).then(({ error }) => {
      if (!error) return;
      setFoods(s => s.map(f => f.id === id ? current : f));
      writeFailed(`« ${current.name} »`, error);
    });
    return updated;
  };
  const removeFood = (id) => {
    const current = foods.find(f => f.id === id);
    setFoods(s => s.filter(f => f.id !== id));
    supabase.from('foods').delete().eq('id', id).then(({ error }) => {
      if (!error) return;
      if (current) setFoods(s => [current, ...s]);
      writeFailed('la suppression', error);
    });
  };

  const addLog = (log) => {
    const l = { id: uid('fl_'), ts: Date.now(), unit:'g', ...log };
    setLogs(s => [l, ...s]);
    if (l.foodId) updateFood(l.foodId, { lastUsedAt: Date.now() });
    supabase.from('food_logs').insert(foodLogToRow(l, userId)).then(({ error }) => {
      if (!error) return;
      setLogs(s => s.filter(x => x.id !== l.id));
      writeFailed(`« ${l.name} »`, error);
    });
    return l;
  };
  const updateLog = (id, patch) => {
    const current = logs.find(l => l.id === id);
    if (!current) return;
    const updated = { ...current, ...patch };
    setLogs(s => s.map(l => l.id === id ? updated : l));
    supabase.from('food_logs').update(foodLogToRow(updated, userId)).eq('id', id).then(({ error }) => {
      if (!error) return;
      setLogs(s => s.map(l => l.id === id ? current : l));
      writeFailed(`« ${current.name} »`, error);
    });
  };
  const removeLog = (id) => {
    const current = logs.find(l => l.id === id);
    setLogs(s => s.filter(l => l.id !== id));
    supabase.from('food_logs').delete().eq('id', id).then(({ error }) => {
      if (!error) return;
      if (current) setLogs(s => [current, ...s]);
      writeFailed('la suppression', error);
    });
  };

  const toggleFavorite = (id) => {
    const f = foods.find(x => x.id === id);
    if (f) updateFood(id, { favorite: !f.favorite });
  };

  /* ---- Repas enregistrés ---- */
  const saveMeal = (meal) => {
    const m = { steps:[], items:[], source:'custom', favorite:false, portions:1,
                createdAt:Date.now(), lastUsedAt:null, ...meal,
                id: meal.id || uid('m_') };
    const known = meals.find(x => x.id === m.id) || null;
    setMeals(s => known ? s.map(x => x.id === m.id ? m : x) : [m, ...s]);
    supabase.from('meals').upsert(mealToRow(m, userId)).then(({ error }) => {
      if (!error) return;
      setMeals(s => known ? s.map(x => x.id === m.id ? known : x) : s.filter(x => x.id !== m.id));
      writeFailed(`le repas « ${m.name} »`, error);
    });
    return m;
  };
  // Un repas se met en favori exactement comme un aliment : ce sont deux items,
  // l'étoile ne peut pas vouloir dire deux choses.
  const toggleMealFavorite = (id) => {
    const m = meals.find(x => x.id === id);
    if (m) saveMeal({ ...m, favorite: !m.favorite });
  };
  const removeMeal = (id) => {
    const current = meals.find(m => m.id === id);
    setMeals(s => s.filter(m => m.id !== id));
    supabase.from('meals').delete().eq('id', id).then(({ error }) => {
      if (!error) return;
      if (current) setMeals(s => [current, ...s]);
      writeFailed('la suppression', error);
    });
  };
  // Verser un repas au journal : une ligne par ingrédient, comme si on les avait
  // ajoutés un à un — chacune reste corrigeable et supprimable seule ensuite.
  // `share` est la fraction de la recette réellement mangée (une demi-portion
  // d'une recette qui en fait quatre = 0.125) : elle pèse chaque ingrédient,
  // plutôt que d'ajouter une ligne « ×0,5 » que personne ne saurait relire.
  //
  // Les lignes partent en UNE insertion, pas une par ingrédient : une recette de
  // huit composants faisait huit allers-retours réseau à la suite avant de
  // rendre la main, et c'est ça qu'on sentait en refermant la page.
  const addMealToDay = (mealObj, day, mealSlot, share = 1) => {
    const now = Date.now();
    const rows = (mealObj.items || [])
      .map(it => ({ it, grams: (Number(it.grams) || 0) * share }))
      .filter(x => x.grams > 0)
      .map(({ it, grams }, i) => ({
        id: uid('fl_'), ts: now + i, day, meal: mealSlot, foodId: it.foodId || null,
        name: it.name, brand:'', qty: grams, unit:'g', grams, nutriments: itemNutriments(it),
      }));
    if (rows.length){
      setLogs(s => [...rows, ...s]);
      supabase.from('food_logs').insert(rows.map(l => foodLogToRow(l, userId))).then(({ error }) => {
        if (!error) return;
        const ids = new Set(rows.map(l => l.id));
        setLogs(s => s.filter(l => !ids.has(l.id)));
        writeFailed(`le repas « ${mealObj.name || 'sans nom'} »`, error);
      });
    }
    if (mealObj.id) saveMeal({ ...mealObj, lastUsedAt: now });
  };

  // Régler un objectif, c'est le poser À PARTIR d'un jour — celui qu'on
  // regardait en ouvrant la fenêtre. Les jours d'avant ne bougent pas ; ceux
  // d'après suivent, jusqu'à la prochaine consigne.
  const saveGoals = (g, fromDay) => {
    const day = fromDay || dayKey(Date.now());
    const before = goalRows;
    setGoalRows(rows => sortGoals([...rows.filter(r => r.fromDay !== day), { ...g, fromDay: day }]));
    supabase.from('nutrition_goals')
      .upsert(goalToRow(g, userId, day), { onConflict: 'user_id,from_day' })
      .then(({ error }) => {
        if (!error) return;
        setGoalRows(before);
        writeFailed('les objectifs', error);
      });
  };

  // Index jour → lignes, refait une seule fois par changement de log.
  const logsByDay = useMemo(() => {
    const m = {};
    for (const l of logs) (m[l.day] = m[l.day] || []).push(l);
    return m;
  }, [logs]);

  const totalsForDay = useCallback((dk) => sumNutriments((logsByDay[dk] || []).map(l => l.nutriments)), [logsByDay]);

  // La consigne qui s'applique à un jour : la dernière posée à cette date ou
  // avant. Rien avant elle → rien, et c'est aux valeurs par défaut de répondre.
  const goalsAt = useCallback((dk) => {
    let found = null;
    for (const g of goalRows){ if (g.fromDay <= dk) found = g; else break; }
    return found;
  }, [goalRows]);

  // Un objectif laissé vide retombe sur sa valeur par défaut plutôt que sur zéro :
  // régler ses calories sans toucher aux macros ne doit pas effacer les trois autres cibles.
  // Seules les 4 macros comptent pour « un objectif est réglé » — le poids et
  // les modes/ratios ne sont que la manière dont ces grammes ont été obtenus.
  const effectiveGoalsAt = useCallback((dk) => {
    const g = goalsAt(dk);
    const set = Object.fromEntries(
      FOOD_MACROS.map(m => m.key).filter(k => g && g[k] != null).map(k => [k, g[k]]));
    return { ...DEFAULT_GOALS, ...set };
  }, [goalsAt]);

  const goalsSetAt = useCallback(
    (dk) => { const g = goalsAt(dk); return !!g && FOOD_MACROS.some(m => g[m.key] != null); }, [goalsAt]);

  return { ready, foods, logs, logsByDay, meals, goalRows, goalsAt, effectiveGoalsAt, goalsSetAt,
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

// Les micros que l'app sait ranger. Ce qui revient de l'analyse est filtré sur
// cette liste plutôt que recopié tel quel : une clé inventée par le modèle
// n'aurait aucune ligne où s'afficher, et se promènerait dans les snapshots.
const AI_MICRO_KEYS = [...FOOD_DETAILS, ...FOOD_MICROS].map(d => d.key);

async function analyseRepas(description, { signal, image, mode } = {}){
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
      body: JSON.stringify({ description, ...(image ? { image } : {}), ...(mode ? { mode } : {}) }),
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
      // Le mode approfondi rend en plus les micros, dans les mêmes unités que
      // le reste de l'app (g pour le détail, mg/µg pour les micros) : ils se
      // rangent donc dans le même `per100`, et se mettent à l'échelle du poids
      // comme les macros sans que rien d'autre ait à savoir d'où ils viennent.
      ...Object.fromEntries(AI_MICRO_KEYS
        .filter(k => ing.micros && Number(ing.micros[k]) > 0)
        .map(k => [k, Number(ing.micros[k])])),
    },
  }));
  return { plat: body.plat || '', items, marge: body.marge || '', question: body.question || '',
           sources: Array.isArray(body.sources) ? body.sources : [] };
}

/* ============================================================
   Page Food
   ============================================================ */
function FoodPage({ store, sub, onSub }){
  const [addOpen, setAddOpen] = useState(null);      // { meal, day } | null
  // Un aliment ne se corrige pas après coup : ce qu'on garde est la fiche
  // telle qu'elle vient de Ciqual, d'Open Food Facts ou de sa création. Il n'y
  // a donc qu'un brouillon de création, jamais d'édition en cours.
  const [newFood, setNewFood] = useState(null);
  // Régler des objectifs se fait toujours DEPUIS un jour : celui qu'on
  // regardait. C'est cette date qui devient la prise d'effet, donc on la garde
  // plutôt qu'un simple booléen ouvert/fermé.
  const [goalsDay, setGoalsDay] = useState(null);
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
          onGoals={(d)=>setGoalsDay(d || dayKey(Date.now()))}
        />
      ) : sub === 'aliments' ? (
        <FoodLibraryView
          store={store}
          onDelete={(f)=>{ if (confirm(`Oublier « ${f.name} » ? Il quitte tes items ; les repas déjà notés gardent leurs valeurs.`)) store.removeFood(f.id); }}
          onNew={()=>setNewFood({ id:uid('f_'), source:'custom', name:'', brand:'', basis:'g',
                                  servingG:null, imageUrl:'', nutriments:{}, barcode:null,
                                  favorite:false, lastUsedAt:null, createdAt:Date.now() })}
          onScan={()=>setAddOpen({ meal:null, day })}
          onNewMeal={()=>setMealDraft({ name:'', items:[], steps:[], source:'custom' })}
          onEditMeal={setMealDraft}
        />
      ) : (
        <FoodVuesView store={store} onGoals={()=>setGoalsDay(dayKey(Date.now()))} />
      )}

      <FoodSources />

      {addOpen && (
        <AddFoodModal
          store={store}
          day={addOpen.day}
          meal={addOpen.meal}
          onClose={()=>setAddOpen(null)}
          onNeedsFood={(draft)=>{ setAddOpen(null); setNewFood(draft); }}
        />
      )}
      {newFood && (
        <FoodEditModal
          food={newFood}
          onClose={()=>setNewFood(null)}
          onSave={(f)=>{ store.saveFood(f); setNewFood(null); }}
        />
      )}
      {goalsDay && (
        <GoalsModal
          // effectiveGoalsAt ne porte que les 4 grammes (avec repli sur les
          // valeurs par défaut) ; le mode/ratio/poids qui ont produit ces
          // grammes ne vivent que sur la consigne — la modale a besoin des
          // deux : les grammes pour afficher quelque chose de sensé la
          // première fois, et le mode/ratio pour se rouvrir tel qu'on l'a laissé.
          goals={{ ...store.effectiveGoalsAt(goalsDay), ...(store.goalsAt(goalsDay) || {}) }}
          isSet={store.goalsSetAt(goalsDay)}
          fromDay={goalsDay}
          onClose={()=>setGoalsDay(null)}
          onSave={(g)=>{ store.saveGoals(g, goalsDay); setGoalsDay(null); }}
        />
      )}
      {mealDraft && (
        <MealEditModal
          meal={mealDraft.id ? mealDraft : null}
          store={store}
          onClose={()=>setMealDraft(null)}
          onSave={(m)=>{ store.saveMeal({ ...mealDraft, ...m }); setMealDraft(null); }}
          onDelete={mealDraft.id ? ()=>{ store.removeMeal(mealDraft.id); setMealDraft(null); } : null}
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
      {/* Le crédit reste écrit — la licence d'Open Food Facts le demande, et il
          tient sur une ligne. Ce qui passe derrière la bulle, c'est ce qui
          l'explique : quinze lignes de texte au bas de chaque journée se
          lisaient une fois et encombraient ensuite. Les bulles sont posées
          `always` : elles ne portent pas une explication de réglage, elles
          portent l'attribution elle-même. */}
      <span className="fd-src-credit serif">
        Open Food Facts <span className="fd-src-lic mono">ODbL</span>
        <InfoBubble title="Open Food Facts" always>
          Les produits scannés et cherchés viennent d'<a href={OFF_FR} target="_blank" rel="noopener noreferrer">Open
          Food Facts</a>, base collaborative et ouverte (licence ODbL) — les valeurs y sont saisies par ses
          contributeurs, donc parfois incomplètes ou fausses. Chaque produit garde son lien « ↗ » vers sa
          fiche d'origine ; une fiche qui ne te convient pas s'oublie, et l'onglet Créer fabrique la tienne.
        </InfoBubble>
      </span>
      <span className="fd-src-credit serif">
        Ciqual 2025 — ANSES <span className="fd-src-lic mono">Licence Ouverte</span>
        <InfoBubble title="Table Ciqual" always>
          Les aliments simples — ceux qui n'ont pas d'étiquette : un blanc de poulet, une pomme de terre,
          des framboises — viennent de la <b>table Ciqual 2025</b> de l'ANSES, livrée avec l'app et
          consultable hors ligne : 3 341 aliments français, crus et cuits, avec leurs micronutriments.
          Ce sont des moyennes de référence, pas un produit précis : le poulet que tu as acheté n'est pas
          exactement celui-là, mais l'ordre de grandeur est juste.
        </InfoBubble>
      </span>
      <span className="fd-src-credit serif">
        Liens
        <InfoBubble title="Liens" always>
          <span className="fd-source-links mono">
            <a href="https://ciqual.anses.fr/" target="_blank" rel="noopener noreferrer">table ciqual ↗</a>
            <a href={OFF_FR} target="_blank" rel="noopener noreferrer">fr.openfoodfacts.org ↗</a>
            <a href={OFF_SEARCH} target="_blank" rel="noopener noreferrer">moteur de recherche ↗</a>
            <a href="https://openfoodfacts.github.io/openfoodfacts-server/api/" target="_blank" rel="noopener noreferrer">l'API utilisée ↗</a>
            <a href="https://world.openfoodfacts.org/data" target="_blank" rel="noopener noreferrer">la base complète ↗</a>
          </span>
        </InfoBubble>
      </span>
    </div>
  );
}

/* ---- Jour ----------------------------------------------------------------- */
function FoodDayView({ store, day, onDay, onAdd, onGoals }){
  const [showMicros, setShowMicros] = useState(false);
  const [editLog, setEditLog] = useState(null);
  const dayLogs = store.logsByDay[day] || [];
  const totals = useMemo(() => sumNutriments(dayLogs.map(l => l.nutriments)), [dayLogs]);
  const goals = store.effectiveGoalsAt(day);
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
          const bad = kcalOverrun(m.key, v, goal);
          const lead = m.key === 'kcal';
          const amount = (n) => lead ? `${fmtNum(n, 0)} kcal` : `${fmtMacro(n)}g`;
          return (
            <div className={`fd-total ${lead?'lead':''} ${bad?'bad':''}`} key={m.key}>
              <span className="fd-total-head">
                {/* Le nom porte la couleur de sa macro, comme le nom d'un tracker
                    porte la sienne : la jauge ne la montre qu'une fois remplie,
                    et une journée à zéro n'apprendrait rien. */}
                <span className="fd-total-label" style={{color:m.color}}>{m.label}</span>
                {lead && (
                  <button className="icon-btn chart-edit-btn" onClick={()=>onGoals(day)}
                          aria-label="Régler les objectifs" title="Régler les objectifs">
                    <GearIcon />
                  </button>
                )}
              </span>
              <span className="fd-total-v">
                {lead ? fmtNum(v, 0) : fmtMacro(v)}
                <span className="u">{m.unit}</span>
              </span>
              <span className="fd-meter"><span className={`fd-fill ${bad?'over':''}`} style={{width:`${pct}%`, background:m.color}} /></span>
              <span className="fd-total-goal mono">
                {goal > 0 ? `${amount(v)} / ${amount(goal)}` : 'sans objectif'}
              </span>
            </div>
          );
        })}
      </div>

      {!store.goalsSetAt(day) && (
        <p className="fd-note serif">
          Objectifs par défaut, à ajuster : <button className="fd-link" onClick={()=>onGoals(day)}>régler mes objectifs</button>.
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
          /* Une carte par repas, comme partout ailleurs dans l'app : les quatre
             moments de la journée sont quatre choses distinctes, et un simple
             titre suivi de lignes les laissait couler les uns dans les autres. */
          <div className="card fd-card fd-meal" key={meal.id}>
            <div className="fd-meal-head">
              <p className="section-label" style={{margin:0}}>{meal.label}</p>
              <span className="fd-meal-kcal mono">{rows.length ? `${fmtNum(kcal,0)} kcal` : '—'}</span>
            </div>
            {rows.map(l => (
              <FoodLogRow key={l.id} log={l} onEdit={()=>setEditLog(l)} />
            ))}
            <button className="fd-add" onClick={()=>onAdd(meal.id)}>+ Ajouter</button>
          </div>
        );
      })}

      {(byMeal.autre || []).length > 0 && (
        <div className="card fd-card fd-meal">
          <div className="fd-meal-head"><p className="section-label" style={{margin:0}}>Autre</p></div>
          {byMeal.autre.map(l => (
            <FoodLogRow key={l.id} log={l} onEdit={()=>setEditLog(l)} />
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
          onDelete={()=>{ store.removeLog(editLog.id); setEditLog(null); }}
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

/* Une ligne de journal : la ligne entière ouvre sa fenêtre de modification, et
   c'est là-dedans qu'on la supprime. Deux mots d'action au bout de chaque ligne
   répétaient « modifier » et « suppr. » autant de fois qu'il y avait de lignes,
   pour un geste qu'on fait rarement — et la quantité, collée au nom, se lisait
   comme une partie de ce nom. */
function FoodLogRow({ log, onEdit }){
  const n = log.nutriments || {};
  return (
    <button className="fd-row" onClick={onEdit} title="Modifier cette ligne">
      <span className="fd-row-main">
        <span className="fd-row-name">{log.name}</span>
        {log.brand && <span className="fd-row-brand">{log.brand}</span>}
      </span>
      <span className="fd-row-qty mono">{fmtNum(log.qty, 1)} {log.unit === 'portion' ? (log.qty > 1 ? 'portions' : 'portion') : log.unit}</span>
      <span className="fd-row-macros mono">
        <span>{fmtMacro(n.protein)}<i>P</i></span>
        <span>{fmtMacro(n.carbs)}<i>G</i></span>
        <span>{fmtMacro(n.fat)}<i>L</i></span>
      </span>
      <span className="fd-row-kcal">{fmtNum(n.kcal, 0)}<i>kcal</i></span>
    </button>
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
/* Un ingrédient n'est pas un brouillon : son nom et ses valeurs sont ceux de
   l'aliment d'où il vient, et les retoucher ici ferait dire à « riz » deux
   choses différentes selon la recette. Seul le POIDS se règle — ce n'est pas
   une propriété de l'aliment mais la quantité qu'on en met. Pour autre chose,
   l'onglet Créer fabrique l'aliment qu'on veut vraiment. */
function IngredientRow({ item, onPatch, onRemove }){
  const n = itemNutriments(item);
  return (
    <div className="fd-ing">
      <div className="fd-ing-main">
        <span className="fd-ing-name">{item.name || 'Ingrédient'}</span>
        <span className="fd-ing-qty">
          <input type="number" step="any" min="0" inputMode="decimal" value={item.grams}
                 onChange={e=>onPatch({ grams: e.target.value })} aria-label={`Poids de ${item.name}`} />
          <i>g</i>
        </span>
        <span className="fd-ing-kcal mono">{fmtNum(n.kcal, 0)}<i>kcal</i></span>
        <button className="icon-btn fd-ing-btn del" onClick={onRemove} title="Retirer">−</button>
      </div>
      <div className="fd-ing-macros mono">
        <span>{fmtMacro(n.protein)}<i>P</i></span>
        <span>{fmtMacro(n.carbs)}<i>G</i></span>
        <span>{fmtMacro(n.fat)}<i>L</i></span>
        {item.note && <em className="fd-ing-note">{item.note}</em>}
      </div>
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

/* `onAdd` décide de la façon d'ajouter une ligne, parce que les deux endroits
   qui utilisent cet éditeur ne demandent pas la même chose. Un repas envoie
   vers la page d'ajout entière (on peut y verser un aliment, une analyse IA,
   un autre repas) : une ligne pleine largeur suffit à y aller. L'analyse IA,
   elle, est déjà DANS cette page — la renvoyer sur elle-même n'aurait pas de
   sens, donc elle garde la recherche en ligne. */
function IngredientEditor({ items, onChange, store, onAdd, children }){
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

      {onAdd
        ? <button className="fd-add full" onClick={onAdd}>＋ Ajouter un ingrédient</button>
        : <IngredientPicker
            store={store}
            onPick={f=>onChange([...items, itemFromFood(f)])}
            onBlank={name=>onChange([...items, mkItem({ name: name || 'Ingrédient' })])}
          />}

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

function AiAnalyseTab({ store, day, initialMeal, pickMode, onPickItems, onDone, onEditAsMeal }){
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);   // { dataUrl, base64, mediaType }
  const [photoErr, setPhotoErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);   // { plat, items, marge, question }
  const [items, setItems] = useState([]);
  const [mealSlot, setMealSlot] = useState(initialMeal || defaultMealForNow());
  // Deux façons de demander, pas deux réglages : le mode normal estime de tête
  // et répond vite ; le mode approfondi laisse le modèle chercher sur le web
  // (la carte d'un restaurant nommé, la fiche d'un produit) et remplir les
  // micronutriments — plus juste, plus lent, plus cher.
  const [advanced, setAdvanced] = useState(false);
  // Ce qui sort d'une analyse peut devenir un item, mais ça se demande : une
  // assiette de resto qu'on ne remangera jamais n'a rien à faire dans Mes
  // items. Même drapeau `keep` que l'ajout rapide, même intention.
  const [keep, setKeep] = useState(true);
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
      const out = await analyseRepas(d, { signal: ctrl.signal, image, mode: advanced ? 'advanced' : 'normal' });
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
  const addToJournal = () => {
    // Ouverte depuis un repas en cours d'écriture, l'analyse ne note rien et
    // n'enregistre pas un second item : elle rend ses ingrédients à la recette
    // qui les a demandés.
    if (onPickItems){ onPickItems(items); return; }
    if (keep) store.saveMeal({ name: aiName(), items, steps: [], source: 'ai' });
    store.addMealToDay({ items }, day, mealSlot);
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

        <div className="fd-ai-mode">
          <Segmented size="small">
            <button className={!advanced?'on':''} onClick={()=>setAdvanced(false)}>Normal</button>
            <button className={advanced?'on':''} onClick={()=>setAdvanced(true)}>Approfondi</button>
          </Segmented>
          <InfoBubble title="Mode d’analyse">
            <b>Normal</b> — le modèle estime de tête, à partir de ce que tu donnes. Rapide.<br/>
            <b>Approfondi</b> — il cherche aussi sur le web de vraies références (la carte du
            restaurant que tu nommes, la fiche d'un produit) et remplit les micronutriments.
            Plus juste sur un plat identifiable, mais nettement plus lent.
          </InfoBubble>
        </div>

        <div className="fd-ai-actions">
          <span className="fd-ai-hint serif">
            Texte, photo, ou les deux — envoyés dans la même analyse. Plus tu donnes de détails —
            poids pesés, morceau de viande, huile de cuisson — plus l'estimation se resserre.
            {advanced && <> En approfondi, <b>nomme l'établissement</b> : c'est ce qui lui donne
            quelque chose à chercher.</>}
          </span>
          <button className="primary sm" disabled={!canRun} onClick={run}>
            {busy ? (advanced ? 'Recherche…' : 'Analyse…') : result ? 'Relancer' : 'Analyser'}
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
          {/* Ce que le mode approfondi a réellement lu. Une estimation qui dit
              « d'après la carte du restaurant » sans dire laquelle n'est pas
              plus vérifiable qu'une estimation de tête. */}
          {result.sources && result.sources.length > 0 && (
            <p className="fd-note serif">
              <b>D'après :</b>{' '}
              {result.sources.map((u, i) => (
                <React.Fragment key={i}>
                  {i > 0 && ' · '}
                  <a className="fd-src-link" href={u} target="_blank" rel="noopener noreferrer">
                    {(() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } })()}
                  </a>
                </React.Fragment>
              ))}
            </p>
          )}

          <IngredientEditor items={items} onChange={setItems} store={store} />

          {!pickMode && (
            <>
              <div className="field">
                <label>Repas</label>
                <Segmented size="small" scrollx>
                  {MEALS.map(m => (
                    <button key={m.id} className={mealSlot===m.id?'on':''} onClick={()=>setMealSlot(m.id)}>{m.label}</button>
                  ))}
                </Segmented>
              </div>
              <div className="field" style={{borderBottom:'none'}}>
                <label>En faire un item</label>
                <BoolPill value={keep} onChange={setKeep} />
              </div>
            </>
          )}

          <p className="fd-note serif">
            {pickMode
              ? <>Les {items.length} ingrédient{items.length>1?'s':''} rejoignent la recette en cours, où ils restent corrigeables un par un.</>
              : keep
                ? <>La journée est notée <b>et</b> l'analyse rejoint Mes items › Repas, marquée IA —
                   de quoi la remettre en un geste sans redemander au modèle.</>
                : <>La journée est notée, et rien n'est gardé : une assiette qu'on ne remangera pas
                   n'a pas à encombrer Mes items.</>}
          </p>

          <div className="modal-actions">
            {!pickMode && (
              <button className="ghost" onClick={()=>onEditAsMeal({
                name: aiName(), items, steps: [], source: 'ai',
              })}>Nommer / ajouter une recette</button>
            )}
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
/* ---- Combien on en a mangé -------------------------------------------------
   Deux nombres différents, souvent confondus : ce que la recette PRODUIT (elle
   fait quatre portions) et ce qu'on en A PRIS (une demie). Le premier est une
   propriété du repas, écrite une fois dans son éditeur ; le second se demande
   à chaque fois qu'on le verse dans une journée, et c'est tout ce que cette
   étape fait.

   Le facteur pèse chaque ingrédient plutôt que de poser une ligne « ×0,5 » :
   le journal garde une ligne par ingrédient, chacune juste, chacune
   corrigeable seule — la règle ne change pas parce qu'on a mangé une demie. */
function MealPortionModal({ meal, initialMeal, pickMode, onClose, onSubmit }){
  const portions = mealPortions(meal);
  const [eaten, setEaten] = useState('1');
  const [slot, setSlot] = useState(initialMeal || defaultMealForNow());

  const n = parseFloat(String(eaten).replace(',', '.'));
  const eatenPortions = isNaN(n) ? 0 : n;
  const share = eatenPortions / portions;          // fraction de la recette entière
  const scaled = useMemo(
    () => (meal.items || []).map(it => ({ ...it, grams: (Number(it.grams) || 0) * share })),
    [meal, share]);
  const nutriments = itemsTotals(scaled);
  const canSave = share > 0;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal fd-modal" onClick={e=>e.stopPropagation()} style={{maxWidth:420}}>
        <h2>Combien de portions ?</h2>
        <div className="modal-sub">
          {meal.name} · la recette en fait {fmtNum(portions, portions % 1 ? 1 : 0)}
        </div>

        <div className="fd-qty">
          <input type="number" step="any" min="0" inputMode="decimal" value={eaten}
                 onChange={e=>setEaten(e.target.value)}
                 onKeyDown={e=>{ if (e.key === 'Enter' && canSave) onSubmit({ items: scaled, meal: slot, share }); }} />
          <span className="fd-qty-unit">portion{eatenPortions > 1 ? 's' : ''}</span>
        </div>

        <div className="fd-chips">
          {['0.5', '1', '2'].map(v => (
            <button key={v} onClick={()=>setEaten(v)}>{v.replace('.', ',')} portion{v === '0.5' ? '' : 's'}</button>
          ))}
          <button onClick={()=>setEaten(String(portions))}>toute la recette</button>
        </div>

        {/* Les mêmes cases que sur une carte d'item — mais ici les chiffres
            portent sur la quantité saisie, pas sur 100 g : la première case le
            dit, comme là-bas. */}
        <div className="fd-preview">
          <MacroStrip n={nutriments} per={null} className="fd-macros-wide" />
        </div>

        {!pickMode && (
          <div className="field" style={{borderBottom:'none'}}>
            <label>Repas</label>
            <Segmented size="small" scrollx>
              {MEALS.map(m => (
                <button key={m.id} className={slot===m.id?'on':''} onClick={()=>setSlot(m.id)}>{m.label}</button>
              ))}
            </Segmented>
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave}
                  onClick={()=>onSubmit({ items: scaled, meal: slot, share })}>Ajouter</button>
        </div>
      </div>
    </div>
  );
}

function MealsTab({ store, day, initialMeal, favOnly, query, pickMode, onPick, onDone, onNew, onEdit }){
  const [mealSlot, setMealSlot] = useState(initialMeal || defaultMealForNow());
  const [portioning, setPortioning] = useState(null);   // le repas dont on choisit la part
  const compBar = useCompBar();
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
          {pickMode
            ? "Reprendre un repas entier : tous ses ingrédients rejoignent la recette d'un coup."
            : "Un repas ajoute tous ses ingrédients d'un coup, chacun sur sa propre ligne."}
        </span>
        {/* Créer un repas depuis l'intérieur d'un repas empilerait un éditeur
            sur l'autre pour rien : ici on ne fait que piocher. */}
        {onNew && <button className="pill add" onClick={onNew}>+ Repas</button>}
      </div>

      {!list.length ? (
        <p className="fd-note serif">
          {favOnly
            ? "Aucun repas favori. L'étoile sur un repas le range ici."
            : "Aucun repas enregistré. Crée-en un à partir de ce que tu manges souvent — une analyse IA en fabrique un toute seule."}
        </p>
      ) : (
        <>
          {/* Pas de sélecteur de repas ici : la fenêtre qui suit demande déjà
              à quel repas et en quelle quantité — le poser deux fois ferait
              douter de celui qui compte. */}
          <div className="fd-list">
            {list.map(m => {
              const t = itemsTotals(m.items);
              return (
                /* Exactement la carte d'un aliment : un repas est un item, il
                   n'a pas de raison de se présenter autrement. Il s'ouvre au
                   crayon plutôt que de s'oublier à la corbeille — son éditeur
                   porte déjà la suppression. */
                <div className="fd-item-row" key={m.id}>
                  <button className="fd-item fd-item-name" onClick={()=>setPortioning(m)}>
                    <span className="n">{m.name}</span>
                    <span className="fd-item-sub">
                      {m.items.length} ingrédient{m.items.length>1?'s':''}
                      {mealPortions(m) > 1 ? ` · ${fmtNum(mealPortions(m), 0)} portions` : ''}
                      {m.steps && m.steps.length ? ` · ${m.steps.length} étape${m.steps.length>1?'s':''}` : ''}
                    </span>
                  </button>
                  <span className="fd-item-foot">
                    <OriginTag item={m} />
                    <button className={`icon-btn xs fd-fav ${m.favorite?'on':''}`} onClick={()=>store.toggleMealFavorite(m.id)}
                            aria-pressed={!!m.favorite} title={m.favorite ? 'Retirer des favoris' : 'Mettre en favori'}>
                      <StarIcon filled={m.favorite} size={10} />
                    </button>
                    {onEdit && (
                      <button className="icon-btn xs fd-edit-btn" title="Modifier ce repas"
                              aria-label="Modifier ce repas" onClick={()=>onEdit(m)}><PencilIcon size={10} /></button>
                    )}
                  </span>
                  <button className="fd-item-nums" onClick={()=>setPortioning(m)} tabIndex={-1} aria-hidden="true">
                    <MacroStrip n={t} per={null} compBar={compBar} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {portioning && (
        <MealPortionModal
          meal={portioning}
          initialMeal={mealSlot}
          pickMode={pickMode}
          onClose={()=>setPortioning(null)}
          onSubmit={async ({ items, meal:slot, share })=>{
            const m = portioning;
            setPortioning(null);
            // Verser dans une recette : ce sont les ingrédients pesés qui
            // partent. Verser dans une journée : le magasin en fait une ligne
            // par ingrédient, et note le repas comme récemment utilisé.
            if (onPick){ onPick({ ...m, items }); return; }
            store.addMealToDay(m, day, slot, share);
            onDone();
          }}
        />
      )}
    </>
  );
}

/* ---- Les étapes d'une recette ----------------------------------------------
   Une liste de lignes qu'on écrit, coche et réordonne. Trois choix qui se
   tiennent :

     · Le texte s'enroule. Une étape est une phrase, pas un mot : un champ
       d'une seule ligne qui défile latéralement cache ce qu'on vient d'écrire.
       D'où un `textarea` qui prend la hauteur de son contenu.
     · Le rond numéroté fait trois choses à la fois — il dit le rang, il se
       coche d'un tap, et il s'attrape d'un appui maintenu pour réordonner.
       C'est exactement le double geste des pastilles du rail, garde-fou
       `wasArmed()` compris : maintenir pour glisser ne doit pas cocher au
       relâchement, mais un simple clic, si.
     · Les numéros sont lus de l'ordre affiché, jamais stockés. Réordonner
       renumérote donc tout seul, sans rien à recalculer.

   Cocher n'est enregistré que si on enregistre le repas : cocher en cuisinant
   puis fermer ne laisse aucune trace, cocher puis « Enregistrer » garde l'état.
   Les deux usages tombent juste sans réglage à part.                          */
const autoGrowStep = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
};

function RecipeSteps({ steps, onChange }){
  const ids = useMemo(() => steps.map(s => s.id), [steps]);
  const byId = useMemo(() => Object.fromEntries(steps.map(s => [s.id, s])), [steps]);
  const { order, dragId, startDrag, setNodeRef, wasArmed } = useDragReorder(
    ids, (next) => onChange(next.map(id => byId[id]).filter(Boolean)));
  const downRef = useRef(null);

  /* Le minuteur d'une étape. `mins` est une donnée du repas (« ce riz cuit en
     10 minutes ») ; le décompte, lui, ne l'est pas — il n'existe que pendant
     qu'on cuisine, donc il vit ici et meurt en fermant. Un seul à la fois :
     une recette se suit dans l'ordre. */
  const [timer, setTimer] = useState(null);   // { id, left } en secondes
  useEffect(() => {
    if (!timer) return;
    const h = setInterval(() => {
      setTimer(t => {
        if (!t) return t;
        if (t.left <= 1){
          try { navigator.vibrate?.([90, 60, 90]); } catch {}
          return null;                        // le temps est écoulé : à toi de cocher
        }
        return { ...t, left: t.left - 1 };
      });
    }, 1000);
    return () => clearInterval(h);
  }, [!!timer]);

  const patch = (id, p) => onChange(steps.map(s => s.id === id ? { ...s, ...p } : s));

  // Un rond, deux histoires. Sans minuteur : un tap coche. Avec minuteur : le
  // premier tap lance le décompte, le second l'arrête en validant l'étape.
  const hitStep = (st) => {
    const mins = Number(st.mins) || 0;
    if (!mins) return patch(st.id, { done: !st.done });
    if (timer && timer.id === st.id){
      setTimer(null);
      patch(st.id, { done: true });
      return;
    }
    try { navigator.vibrate?.(12); } catch {}
    setTimer({ id: st.id, left: Math.round(mins * 60) });
  };

  const clock = (sec) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;

  return (
    <div className="fd-steps">
      {order.map((id, i) => {
        const st = byId[id];
        if (!st) return null;
        const running = timer && timer.id === id;
        return (
          <div className={`fd-step ${st.done?'done':''} ${running?'running':''} ${dragId===id?'dragging':''}`}
               key={id} ref={setNodeRef(id)}>
            <button
              type="button"
              className={`icon-btn fd-step-n ${st.done?'on':''} ${running?'ticking':''}`}
              onPointerDown={(e)=>{ downRef.current = { x:e.clientX, y:e.clientY }; startDrag(id)(e); }}
              onClickCapture={(e)=>{
                const d = downRef.current;
                const moved = d && (Math.abs(e.clientX-d.x) > 6 || Math.abs(e.clientY-d.y) > 6);
                if (wasArmed() || moved){ e.preventDefault(); e.stopPropagation(); }
              }}
              onClick={()=>hitStep(st)}
              aria-pressed={st.done}
              title={Number(st.mins) > 0
                ? 'Cliquer pour lancer le minuteur · encore une fois pour valider l’étape'
                : 'Cliquer pour cocher · maintenir puis glisser pour réordonner'}>
              {i + 1}
            </button>
            <textarea
              className="fd-step-txt" rows={1} value={st.text} placeholder={`Étape ${i + 1}`}
              ref={el => { autoGrowStep(el); }}
              onInput={e=>autoGrowStep(e.target)}
              onChange={e=>patch(id, { text: e.target.value })} />
            {/* La pastille dit la durée quand rien ne tourne, et le décompte
                quand ça tourne : un seul endroit à regarder. */}
            {running ? (
              <span className="fd-step-timer running mono">{clock(timer.left)}</span>
            ) : (
              <span className="fd-step-timer">
                <input type="number" step="1" min="0" inputMode="numeric" placeholder="—"
                       value={st.mins ?? ''} aria-label="Durée de l’étape en minutes"
                       onChange={e=>patch(id, { mins: e.target.value === '' ? null : Number(e.target.value) })} />
                <i>min</i>
              </span>
            )}
            <button className="icon-btn fd-ing-btn del" title="Retirer l'étape"
                    onClick={()=>{ if (running) setTimer(null); onChange(steps.filter(s => s.id !== id)); }}>−</button>
          </div>
        );
      })}
      <button className="fd-add full" onClick={()=>onChange([...steps, mkStep()])}>
        ＋ Ajouter une étape
      </button>
    </div>
  );
}

/* ---- Créer / modifier un repas ---------------------------------------------
   Trois sections, trois cadres : le titre, les ingrédients, la recette. Comme
   la page d'ajout, c'est une page entière et non une fenêtre — une liste
   d'ingrédients et une liste d'étapes ne tiennent pas dans une boîte centrée.

   Ajouter un ingrédient rouvre la page d'ajout elle-même, en mode « choisir » :
   un repas peut donc se composer d'un produit scanné, d'un aliment de la table
   Ciqual, d'une analyse IA ou même d'un autre repas entier, sans qu'aucun de
   ces chemins n'ait à être réécrit ici.                                       */
function MealEditModal({ meal, store, onClose, onSave, onDelete }){
  const [name, setName] = useState(meal?.name || '');
  const [items, setItems] = useState(() => (meal?.items || []).map(it => ({ ...mkItem(), ...it })));
  const [steps, setSteps] = useState(() => stepsFromRows(meal?.steps));
  const [portionsStr, setPortionsStr] = useState(() => String(mealPortions(meal)));
  const [adding, setAdding] = useState(false);
  const totals = itemsTotals(items);
  // Les ingrédients pèsent la recette entière ; le nombre de portions dit
  // seulement en combien elle se coupe. Une portion est donc une division,
  // jamais une saisie de plus à tenir à jour.
  const portions = (() => { const n = parseFloat(String(portionsStr).replace(',', '.')); return n > 0 ? n : 1; })();
  const perPortion = itemsTotals(items.map(it => ({ ...it, grams: (Number(it.grams) || 0) / portions })));
  const canSave = name.trim().length > 0 && items.length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({
      ...(meal || {}),
      name: name.trim(),
      portions,
      items: items.map(({ id, name:n, grams, per100, foodId, note }) =>
        ({ id, name:n, grams: Number(grams) || 0, per100, foodId: foodId || null, note: note || '' })),
      steps: steps.filter(s => s.text.trim()).map(s => ({ ...s, text: s.text.trim() })),
    });
  };

  return (
    <div className="fd-add-page">
      <div className="fd-add-head">
        <div className="fd-add-head-txt">
          <h2>{meal ? 'Modifier le repas' : 'Nouveau repas'}</h2>
          <div className="modal-sub">Un ensemble d'ingrédients à ajouter d'un coup</div>
        </div>
        <button className="icon-btn fd-add-close" onClick={onClose} aria-label="Fermer">✕</button>
      </div>

      <div className="fd-add-body">
        <div className="card fd-card">
          <p className="section-label">Titre</p>
          {/* Pas de label « Nom » à côté : la section s'appelle déjà Titre, et
              le répéter n'aide personne à savoir quoi écrire. */}
          <div className="field fd-title-field">
            <input value={name} onChange={e=>setName(e.target.value)}
                   placeholder="Poke bowl du dimanche, porridge, salade César…" />
          </div>
          <NumField label="Portions" unit={portions > 1 ? 'parts' : 'part'} placeholder="1"
                    value={portionsStr} onChange={setPortionsStr}
                    info={<>
                      Ce que la recette produit, pas ce qu'on en mange : les ingrédients ci-dessous
                      pèsent le plat entier, et une portion en est la division. Au moment de l'ajouter
                      à une journée, on dira combien de portions on a prises — une demie comprise.
                    </>} />
        </div>

        <div className="card fd-card">
          <p className="section-label">Ingrédients</p>
          <IngredientEditor items={items} onChange={setItems} store={store}
                            onAdd={()=>setAdding(true)}>
            {items.length > 0 && portions > 1 && (
              <div className="fd-ing-total fd-per-portion">
                <span className="fd-ing-total-l">Une portion</span>
                <span className="mono">{fmtNum(perPortion.kcal, 0)}<i>kcal</i></span>
                <span className="mono">{fmtMacro(perPortion.protein)}<i>P</i></span>
                <span className="mono">{fmtMacro(perPortion.carbs)}<i>G</i></span>
                <span className="mono">{fmtMacro(perPortion.fat)}<i>L</i></span>
              </div>
            )}
          </IngredientEditor>
        </div>

        <div className="card fd-card">
          <p className="section-label">Recette — facultatif</p>
          <RecipeSteps steps={steps} onChange={setSteps} />
        </div>

        <div className="modal-actions">
          {onDelete && <button className="danger" onClick={()=>{ if(confirm('Supprimer ce repas ? Les repas déjà notés ne changent pas.')) onDelete(); }}>Supprimer</button>}
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>
            Enregistrer{items.length ? ` · ${fmtNum(totals.kcal,0)} kcal` : ''}
          </button>
        </div>
      </div>

      {adding && (
        <AddFoodModal
          store={store}
          day={dayKey(Date.now())}
          meal={null}
          onClose={()=>setAdding(false)}
          onPickItems={(picked)=>{
            // Les identifiants sont refaits : verser deux fois le même repas
            // dans une recette ne doit pas produire deux lignes qui se croient
            // la même.
            setItems(list => [...list, ...picked.map(it => ({ ...mkItem(), ...it, id: uid('it_') }))]);
            setAdding(false);
          }}
        />
      )}
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
     Créer       poser soi-même les chiffres — un correctif de journée, un
                 aliment à soi, ou un repas entier (`QuickAddTab`, plus bas).

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
function AddFoodModal({ store, day, meal, onClose, onNeedsFood, onPickItems }){
  // Mode « choisir » : la page ne verse rien dans une journée, elle rend des
  // ingrédients à qui l'a ouverte (l'éditeur de repas). Les quatre onglets
  // restent les mêmes — on peut donc composer une recette avec un produit
  // scanné, un aliment de la table, une analyse IA ou un autre repas, sans
  // qu'aucun d'eux n'ait besoin d'un chemin à part.
  const pick = !!onPickItems;
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

  // Un produit référencé mais vide de valeurs : normalement on ouvre sa fiche
  // pour la compléter. Ouverte depuis un repas, la page n'a pas cette porte —
  // elle bascule alors sur la saisie à la main, déjà amorcée avec ce qu'on sait.
  const needsFood = useCallback((f) => {
    if (onNeedsFood){ onNeedsFood(f); return; }
    openQuick({ name: f.name, barcode: f.barcode || null,
                mode:'aliment' });
  }, [onNeedsFood, openQuick]);

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
        openQuick({ barcode: code, mode:'aliment' });   // le code est gardé : reconnu au prochain scan
        return;
      }
      if (!foodIsUsable(found)){
        setMsg(`« ${found.name} » est référencé mais sans valeurs nutritionnelles. Complète-les une fois, et le produit sera reconnu ensuite.`);
        setBusy(false);
        needsFood(found);
        return;
      }
      const saved = store.saveFood(found);
      setScanOpen(false);
      setPicked(saved || found);
    } catch(e){
      setMsg(e.name === 'AbortError' ? 'Open Food Facts ne répond pas. Réessaie.' : (e.message || 'Recherche impossible.'));
      setScanNonce(n => n + 1);
    }
    setBusy(false);
  }, [store, openQuick, needsFood]);

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
      const saved = store.saveFood({
        id: uid('f_'), source:'custom', barcode: barcode || null, name, brand:'',
        basis, servingG:null, imageUrl:'', nutriments: per100,
        favorite:false, lastUsedAt:Date.now(), createdAt:Date.now(),
      });
      if (saved) foodId = saved.id;
    }
    // Le mode « choisir » garde la moitié qui fabrique un item (c'est tout
    // l'intérêt d'« ingrédient » et « à code-barres ») et remplace seulement
    // la ligne de journal par une ligne de recette.
    if (pick){ onPickItems([mkItem({ name, grams, per100, foodId })]); return; }
    store.addLog({ day, meal:m, foodId, name, brand:'', qty, unit, grams, nutriments });
    onClose();
  };

  const pickFromSearch = async (f) => {
    if (!foodIsUsable(f)){ needsFood(f); return; }
    const saved = store.saveFood(f);
    setPicked(saved || f);
  };

  // Un aliment de la table rejoint la bibliothèque à la première utilisation :
  // ensuite il sort en tête, instantanément, même hors ligne. L'identifiant est
  // refait au passage — celui de la table est le même pour tout le monde.
  const pickFromRef = async (f) => {
    const saved = store.saveFood({ ...f, id: uid('f_'), lastUsedAt: Date.now() });
    setPicked(saved || f);
  };

  /* Les trois provenances en une seule liste. Ce qui les distingue est déjà
     écrit sur chaque ligne (la pastille d'origine), donc les séparer en trois
     colonnes qui défilent chacune de leur côté ne rangeait rien — ça obligeait
     juste à chercher trois fois.

     L'ordre, lui, porte une intention : ce qui s'appelle EXACTEMENT comme ce
     qu'on tape passe devant (« riz » ne doit pas se faire doubler par « riz au
     lait de coco »), puis ce qu'on a mis en favori, puis ce qu'on a déjà
     enregistré — le référentiel vient après, il est là pour ce qu'on n'a pas
     encore. À rang égal, l'ordre d'arrivée décide. */
  const hits = useMemo(() => {
    const raw = query.trim();
    if (raw.length < 2) return [];
    const needle = deburr(raw);
    const lower = raw.toLowerCase();

    const mine = store.foods
      .filter(f => foodLabel(f).toLowerCase().includes(lower))
      .sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
      .slice(0, 12);
    const mineIds = new Set(mine.map(f => f.id));
    // Un aliment déjà à soi et sa fiche d'origine sont le même produit : on
    // garde le sien, corrigé et déjà utilisé, pas la fiche brute par-dessus.
    const known = new Set(store.foods.map(f => f.barcode).filter(Boolean));

    const outside = [...searchRefFoods(store.refFoods, raw, 10), ...(results || [])]
      .filter(f => !f.barcode || !known.has(f.barcode));

    const rank = (f) => (deburr(f.name || '') === needle ? 8 : 0)
                      + (f.favorite ? 4 : 0)
                      + (mineIds.has(f.id) ? 2 : 0);
    return [...mine, ...outside]
      .map((f, i) => ({ f, i, r: rank(f) }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .map(x => x.f);
  }, [store.foods, store.refFoods, query, results]);

  // Oublier un item : le retirer de ce qui est à soi, comme s'il n'avait jamais
  // servi. Les journées déjà notées ne bougent pas — chaque ligne garde son
  // instantané de valeurs, seul le lien vers la fiche disparaît.
  const forgetFood = (f) => {
    if (confirm(`Oublier « ${f.name} » ? Il quitte tes items, comme si tu ne l'avais jamais utilisé. Les repas déjà notés gardent leurs valeurs.`))
      store.removeFood(f.id);
  };

  // Choisir une ligne : ce qui est déjà à soi s'ouvre tel quel, une fiche de la
  // table ou d'Open Food Facts rejoint d'abord la bibliothèque.
  const pickAny = (f) => {
    if (store.foods.some(x => x.id === f.id)) return setPicked(f);
    if (f.source === 'ref') return pickFromRef(f);
    return pickFromSearch(f);
  };

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
        pickMode={pick}
        onClose={onClose}
        onBack={()=>{ setPicked(null); setScanNonce(n => n + 1); }}
        onSubmit={({ qty, unit, grams, meal:m, nutriments })=>{
          if (pick){ onPickItems([itemFromFood(picked, grams)]); return; }
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
          <h2>{pick ? 'Ajouter un ingrédient' : 'Ajouter'}</h2>
          <div className="modal-sub">
            {pick
              ? 'À la recette en cours'
              : <>{meal ? MEAL_LABEL[meal] : 'Bibliothèque'} · {dayLabel(dayKeyToTs(day)).toLowerCase()}</>}
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
          <button className={tab==='ia'?'on':''} onClick={()=>setTab('ia')}>IA</button>
          <button className={tab==='rapide'?'on':''} onClick={()=>{ if (tab !== 'rapide') openQuick({ name: q }); }}>Créer</button>
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
                onKeyDown={e=>{ if(e.key==='Enter'){ runSearch(query); e.target.blur(); } }}
              />
            </IconBar>

            {scanOpen && (
              <div className="fd-scan-panel">
                <FoodScanner key={scanNonce} onCode={handleCode} />
              </div>
            )}

            {/* La même barre à icône que l'onglet d'à côté, à la même place :
                ce qu'on regarde à gauche, ce qui agit dessus à droite. Le
                bouton vignettes est le dernier rond des deux onglets — un
                même geste ne peut pas changer de coin selon l'onglet. */}
            <IconBar detached className="fd-mine-bar" buttons={[
              { icon:<ImageIcon />, onClick:()=>setThumbs(v=>!v), on:thumbs,
                label: thumbs ? 'Masquer les images' : 'Afficher les images' },
            ]}>
              <span className="serif fd-bar-note">
                {isCode ? 'Un code-barres — Entrée pour aller chercher le produit.'
                  : q.length < 3 ? 'Trois lettres suffisent — les résultats arrivent à la frappe.'
                  : searching ? 'Recherche…'
                  : `${hits.length} résultat${hits.length>1?'s':''}${via ? ` · ${via}` : ''}`}
              </span>
            </IconBar>

            {/* Une seule liste. Les pastilles d'origine disent déjà d'où vient
                chaque ligne, donc trois listes qui défilaient chacune de leur
                côté ne séparaient plus que le regard. */}
            <div className="fd-list">
              {hits.map(f => (
                <FoodPickRow key={`${f.source}_${f.id || f.barcode}`} food={f}
                  showImage={thumbs} onPick={()=>pickAny(f)}
                  refByBarcode={store.refByBarcode} />
              ))}
            </div>

            {results && !hits.length && !searching && (
              <p className="fd-note serif">
                Aucun produit trouvé pour « {q} ».{' '}
                <button className="fd-link" onClick={()=>openQuick({ name: q, mode:'aliment' })}>Le saisir à la main</button>
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
            {/* La même barre que l'onglet Recherche : chercher dans ce qui est
                à soi n'est pas un autre geste que chercher dehors, seule la
                source change — et un code scanné retrouve d'abord ses items. */}
            <IconBar
              icon={<ScanIcon />} onIcon={()=>setScanOpen(v=>!v)} iconOn={scanOpen}
              iconLabel={scanOpen ? 'Fermer le scanner' : 'Scanner un code-barres'}
              className="fd-search-bar">
              <input placeholder="chercher dans mes items…" value={libQuery}
                onChange={e=>setLibQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') e.target.blur(); }} />
            </IconBar>

            {scanOpen && (
              <div className="fd-scan-panel">
                <FoodScanner key={scanNonce} onCode={handleCode} />
              </div>
            )}

            {/* Barre à icône, forme séparée : la barre est ici une bascule — ce
                qu'on regarde — et les deux ronds agissent dessus, l'un en la
                réduisant aux favoris, l'autre en montrant ou cachant les
                vignettes. Deux objets, donc deux contours. */}
            <IconBar detached className="fd-mine-bar" buttons={[
              { icon:<StarIcon filled={favOnly} />, onClick:()=>setFavOnly(v=>!v), on:favOnly,
                label: favOnly ? 'Voir tout' : 'Ne voir que les favoris' },
              { icon:<ImageIcon />, onClick:()=>setThumbs(v=>!v), on:thumbs,
                label: thumbs ? 'Masquer les images' : 'Afficher les images' },
            ]}>
              <Segmented size="small">
                <button className={mine==='aliments'?'on':''} onClick={()=>setMine('aliments')}>Aliments</button>
                <button className={mine==='repas'?'on':''} onClick={()=>setMine('repas')}>Repas</button>
              </Segmented>
            </IconBar>

            {mine === 'aliments' ? (
              <div className="fd-list">
                {myFoods.length
                  ? myFoods.map(f => (
                      <FoodPickRow key={f.id} food={f} showImage={thumbs} onPick={()=>setPicked(f)}
                        favorite={f.favorite} onToggleFavorite={()=>store.toggleFavorite(f.id)}
                        onForget={()=>forgetFood(f)}
                        refByBarcode={store.refByBarcode} />
                    ))
                  : <p className="fd-note serif">
                      {favOnly
                        ? "Aucun aliment favori. L'étoile sur un aliment le range ici — de quoi retrouver en un geste ce que tu manges tous les jours."
                        : "Rien encore. Cherche un aliment, scanne un produit, ou crée-en un dans l'onglet Créer."}
                    </p>}
              </div>
            ) : (
              <MealsTab
                store={store} day={day} initialMeal={meal}
                favOnly={favOnly} query={libQuery}
                pickMode={pick}
                onPick={pick ? (m)=>onPickItems(m.items) : null}
                onDone={onClose}
                onNew={null}
                onEdit={pick ? null : (m)=>setMealDraft(m)}
              />
            )}
          </div>
        )}

        {tab === 'ia' && (
          <AiAnalyseTab
            store={store} day={day} initialMeal={meal}
            pickMode={pick}
            onPickItems={pick ? onPickItems : null}
            onDone={onClose}
            onEditAsMeal={(draft)=>setMealDraft(draft)}
          />
        )}

        {tab === 'rapide' && (
          <QuickAddTab
            key={quickKey}
            seed={quickSeed}
            initialMeal={meal || defaultMealForNow()}
            pickMode={pick}
            onNewMeal={()=>setMealDraft({ name:'', items:[], steps:[], source:'custom' })}
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
          onSave={(m)=>{ store.saveMeal({ ...mealDraft, ...m }); setMealDraft(null); setTab('mesitems'); setMine('repas'); }}
          onDelete={mealDraft.id ? ()=>{ store.removeMeal(mealDraft.id); setMealDraft(null); } : null}
        />
      )}
    </div>
  );
}

// Une ligne de résultat : le nom, puis l'aperçu chiffré pour 100 g — de quoi
// trancher entre deux produits sans en ouvrir aucun. Les vignettes sont
// optionnelles : sans elles, la liste s'affiche instantanément.
/* Les actions d'une ligne, dans le même ordre partout : à gauche ce qui touche
   à l'item lui-même (l'oublier pour un aliment, l'ouvrir pour un repas) puis
   l'étoile ; à droite, seule, la flèche qui sort de l'app. Toutes sont des
   ronds `.icon-btn` — une icône cliquable est un bouton, pas un glyphe posé
   dans la marge. */
/* La part de chaque macro dans les calories d'un aliment — en calories, pas en
   grammes : un gramme de lipide en pèse 9 quand un gramme de glucide en pèse 4,
   et une barre calculée sur les grammes ferait paraître le gras trois fois plus
   léger qu'il n'est. */
function macroShare(n){
  const p = (n.protein || 0) * 4, g = (n.carbs || 0) * 4, l = (n.fat || 0) * 9;
  const t = p + g + l;
  if (!(t > 0)) return null;
  return { p: (p/t)*100, g: (g/t)*100, l: (l/t)*100 };
}

/* Les quatre chiffres d'un aliment, en cases jointes — un bout de tableau, pas
   quatre pastilles : les bords partagés et les angles vifs sont ce qui aligne
   une carte sur la suivante. La première case dit « kcal / 100 g » et sert de
   légende aux trois autres : sans elle, rien ne dirait à quoi ces grammes se
   rapportent. La barre de composition, quand elle est allumée, se pose dessus
   et les chiffres prennent alors la couleur de leur macro. */
function MacroStrip({ n = {}, per = '100 g', compBar = false, className = '' }){
  const share = compBar ? macroShare(n) : null;
  const cell = (key, lab) => (
    <span className={`mc mc-${key}`} key={key} style={compBar ? { color: MACRO_BY_KEY[key].color } : undefined}>
      <b>{key === 'kcal' ? fmtNum(n.kcal, 0) : fmtMacro(n[key])}</b>
      <u>{lab}</u>
    </span>
  );
  return (
    <span className={`fd-macros ${className}`}>
      {share && (
        <span className="comp" aria-hidden="true">
          <i style={{width:`${share.p}%`, background:MACRO_BY_KEY.protein.color}} />
          <i style={{width:`${share.g}%`, background:MACRO_BY_KEY.carbs.color}} />
          <i style={{width:`${share.l}%`, background:MACRO_BY_KEY.fat.color}} />
        </span>
      )}
      <span className="fd-macro-strip">
        {cell('kcal', per ? `kcal/${per.replace(/\s+/g,'')}` : 'kcal')}
        {cell('protein', 'P')}
        {cell('carbs', 'G')}
        {cell('fat', 'L')}
      </span>
    </span>
  );
}

// La barre de composition est un réglage de compte : la carte marche avec et
// sans, et c'est le même interrupteur pour toutes les listes.
const COMPBAR_KEY = 'tracklog.compBar';
function useCompBar(){
  const accountPrefs = useContext(AccountPrefsContext) || LOCAL_ONLY_PREFS;
  const [on] = useSyncedPref(accountPrefs, 'compBar', COMPBAR_KEY, true);
  return on;
}

/* La carte d'un item, en trois zones : l'image à gauche quand on l'a demandée,
   le nom et sa provenance au milieu, les chiffres à droite.
   La pastille d'origine a une largeur fixe — celle du plus long des quatre mots
   — pour que les trois ronds qui la suivent tombent au même endroit sur toutes
   les cartes ; alignés d'une ligne à l'autre, ils deviennent une colonne qu'on
   vise sans regarder. */
function FoodPickRow({ food, onPick, showImage = false, favorite, onToggleFavorite,
                       onForget, onEdit, refByBarcode }){
  const n = food.nutriments || {};
  const src = foodSourceUrl(food, refByBarcode);
  const sub = itemSub(food, refByBarcode);
  const compBar = useCompBar();
  return (
    <div className={`fd-item-row ${showImage?'with-img':''}`}>
      {showImage && (
        <span className="fd-item-thumb">
          {food.imageUrl
            ? <img src={food.imageUrl} alt="" loading="lazy" />
            : <span className="fd-item-ph" aria-hidden="true">{(food.name || '?').slice(0,1).toUpperCase()}</span>}
        </span>
      )}
      <button className="fd-item fd-item-name" onClick={onPick}>
        <span className="n">{food.name}</span>
        {sub && <span className="fd-item-sub">{sub}</span>}
      </button>
      <span className="fd-item-foot">
        <OriginTag item={food} />
        {src && (
          <a className="icon-btn xs fd-src-btn" href={src} target="_blank" rel="noopener noreferrer"
             aria-label="Voir la fiche d'origine"
             title={food.source === 'ref' ? `Table Ciqual — ${food.sub || food.group}` : 'Voir la fiche sur Open Food Facts'}
             onClick={e=>e.stopPropagation()}><ExternalIcon size={10} /></a>
        )}
        {onToggleFavorite && (
          <button className={`icon-btn xs fd-fav ${favorite?'on':''}`} onClick={onToggleFavorite}
                  aria-pressed={!!favorite} title={favorite ? 'Retirer des favoris' : 'Mettre en favori'}>
            <StarIcon filled={!!favorite} size={10} />
          </button>
        )}
        {onEdit && (
          <button className="icon-btn xs fd-edit-btn" onClick={onEdit}
                  aria-label="Modifier" title="Modifier"><PencilIcon size={10} /></button>
        )}
        {onForget && (
          <button className="icon-btn xs fd-forget-btn" onClick={onForget}
                  aria-label="Oublier cet item" title="Oublier cet item"><TrashIcon size={10} /></button>
        )}
      </span>
      {/* Les chiffres sont eux aussi une zone de choix : la carte entière
          répond, sauf la rangée d'actions qui, elle, fait autre chose. */}
      <button className="fd-item-nums" onClick={onPick} tabIndex={-1} aria-hidden="true">
        <MacroStrip n={n} per={`100 ${food.basis || 'g'}`} compBar={compBar} />
      </button>
    </div>
  );
}

/* ---- Créer -----------------------------------------------------------------
   Poser les chiffres soi-même, quand ni la recherche ni l'IA ne servent à
   rien. Trois choses différentes sortent d'ici, et la bascule du haut dit
   laquelle — parce que la question « est-ce que ça reste ? » n'a pas la même
   réponse dans les trois cas :

     Ajout rapide  des calories et trois macros, versées dans la journée et
                   rien d'autre. Ce n'est pas un item : c'est un correctif de
                   journée — le sandwich du midi dont on connaît l'étiquette
                   mais qu'on ne remangera jamais. Il n'a rien à faire dans la
                   bibliothèque.
     Aliment       la même base, plus le poids mangé, ce que les macros
                   décrivent (100 g ou tout le poids), et — facultatif — son
                   code-barres. Ça fabrique un item : un aliment à soi,
                   réutilisable, et reconnu au scan s'il porte un code. Le
                   code n'est plus un mode à part : c'était le même formulaire
                   avec un champ de plus.
     Repas         une recette : plusieurs ingrédients d'un coup, avec ses
                   portions et ses étapes. Ouvre l'éditeur de repas.

   Les trois partagent la même première section, dans le même ordre, au même
   endroit : passer de l'une à l'autre ne redispose rien, ça ajoute ou retire
   une section en dessous.                                                    */
const QUICK_MODES = [
  { id:'rapide',  label:'Ajout rapide' },
  { id:'aliment', label:'Aliment' },
  { id:'repas',   label:'Repas' },
];

function QuickAddTab({ seed, initialMeal, pickMode, onNewMeal, onSubmit, onCancel }){
  // Un code déjà en main (scanné, inconnu de la base) ouvre directement le
  // mode Aliment : c'est le seul qui sache quoi en faire.
  const [mode, setMode] = useState(seed?.mode || (seed?.barcode ? 'aliment' : 'rapide'));
  const [name, setName] = useState(seed?.name || '');
  const [vals, setVals] = useState({});
  const [grams, setGrams] = useState('100');
  const [per100, setPer100] = useState(true);     // les macros décrivent 100 g, ou tout le poids
  const [basis, setBasis] = useState('g');        // g | ml
  const [barcode, setBarcode] = useState(seed?.barcode || '');
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNonce, setScanNonce] = useState(0);
  const [meal, setMeal] = useState(initialMeal || defaultMealForNow());

  const isItem = mode === 'aliment';             // ce mode fabrique-t-il un aliment ?
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
      barcode: isItem ? cleanCode(barcode) || null : null,
    });
  };

  const enterSubmits = e=>{ if (e.key === 'Enter') submit(); };

  return (
    <div className="fd-manual-entry">
      <div className="fd-tabs">
        <Segmented size="small" scrollx>
          {QUICK_MODES.map(m => (
            <button key={m.id} className={mode===m.id?'on':''}
                    onClick={()=>{ setMode(m.id); if (m.id === 'repas') onNewMeal(); }}>{m.label}</button>
          ))}
        </Segmented>
      </div>

      <p className="fd-note serif">
        {mode === 'rapide'
          ? (pickMode
              ? "Des calories et trois macros, posées telles quelles dans la recette. Rien n'est enregistré comme aliment à part."
              : "Des calories et trois macros, versées dans la journée. Rien n'est enregistré comme aliment : c'est un correctif de journée, pas un item.")
          : mode === 'aliment'
          ? (pickMode
              ? "Un aliment à toi, gardé dans tes items — réutilisable ailleurs, et ajouté ici tout de suite."
              : "Un aliment à toi, gardé dans tes items — réutilisable, et déjà noté pour aujourd'hui.")
          : "Une recette : plusieurs ingrédients d'un coup, ses portions, ses étapes."}
      </p>

      {mode === 'repas' ? (
        <div className="card fd-card">
          <p className="section-label">Nouveau repas</p>
          <p className="fd-note serif fd-card-note" style={{marginTop:0}}>
            Un repas rassemble plusieurs ingrédients — un petit-déjeuner habituel, un plat qui
            revient — avec ce qu'il produit en portions et, si tu veux, sa recette. Son éditeur
            s'ouvre par-dessus ; en le fermant tu reviens ici.
          </p>
          <button className="fd-add full" onClick={onNewMeal}>＋ Créer un repas</button>
        </div>
      ) : (
      <>
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
              <MacroStrip n={nutriments} per={null} className="fd-macros-wide" />
            </div>
          )}
        </div>
      )}

      {/* Section 3 — le code, tapé ou scanné : les deux remplissent le même
          champ. Facultative : sans code l'aliment existe pareil, il ne se
          retrouve simplement pas au scan. */}
      {isItem && (
        <div className="card fd-card">
          <p className="section-label">Code-barres — facultatif</p>
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

      {/* Ce qu'on fabrique ici rejoint une recette, pas une journée, quand la
          page est ouverte depuis un repas : plus de repas à choisir. */}
      {!pickMode && (
        <div className="card fd-card">
          <p className="section-label">Repas</p>
          <Segmented size="small" scrollx>
            {MEALS.map(m => (
              <button key={m.id} className={meal===m.id?'on':''} onClick={()=>setMeal(m.id)}>{m.label}</button>
            ))}
          </Segmented>
        </div>
      )}

      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>Annuler</button>
        <button className="primary" disabled={!canSave} onClick={submit}>
          {pickMode ? (isItem ? 'Créer et ajouter' : 'Ajouter')
                    : (isItem ? 'Créer et noter' : 'Noter')}
        </button>
      </div>
      </>
      )}
    </div>
  );
}

/* ---- Quantité ------------------------------------------------------------- */
function QuantityModal({ title, food, initialQty, initialUnit, initialMeal, pickMode, onClose, onBack, onSubmit, onDelete }){
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

        {/* Les mêmes cases que sur une carte d'item — mais ici les chiffres
            portent sur la quantité saisie, pas sur 100 g. */}
        <div className="fd-preview">
          <MacroStrip n={nutriments} per={null} className="fd-macros-wide" />
        </div>

        {/* En mode « choisir un ingrédient », l'aliment ne rejoint pas une
            journée mais une recette : demander à quel repas n'aurait aucun sens. */}
        {!pickMode && (
          <div className="field" style={{borderBottom:'none'}}>
            <label>Repas</label>
            <Segmented size="small" scrollx>
              {MEALS.map(m => (
                <button key={m.id} className={meal===m.id?'on':''} onClick={()=>setMeal(m.id)}>{m.label}</button>
              ))}
            </Segmented>
          </div>
        )}

        {/* Deux boutons, pas trois : « Annuler » remet là d'où l'on vient — la
            liste — plutôt que de fermer tout l'ajout. Renoncer à une quantité
            n'est pas renoncer à ajouter quelque chose. */}
        {/* La suppression vit ici, dans la fenêtre de modification : c'est le
            même geste que corriger la ligne, et la sortir sur chaque ligne du
            journal l'aurait mise à un pouce de distance d'un tap de trop. */}
        <div className="modal-actions">
          {onDelete && (
            <button className="danger" onClick={()=>{ if (confirm('Supprimer cette ligne du journal ?')) onDelete(); }}>
              Supprimer
            </button>
          )}
          <button className="ghost" onClick={onBack || onClose}>Annuler</button>
          <button className="primary" disabled={!canSave}
            onClick={()=>onSubmit({ qty:Number(qty), unit, grams, meal, nutriments })}>
            {pickMode ? 'Ajouter' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Aliments (la bibliothèque) ------------------------------------------- */

function FoodLibraryView({ store, onDelete, onNew, onScan, onNewMeal, onEditMeal }){
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
                      {mealPortions(m) > 1 && <span className="tk-chip">{fmtNum(mealPortions(m), 0)} portions</span>}
                      {m.steps && m.steps.length > 0 && <span className="tk-type">recette · {m.steps.length} étapes</span>}
                    </div>
                    <div className="fd-food-nums mono">
                      {fmtNum(t.kcal,0)} kcal · P {fmtMacro(t.protein)} · G {fmtMacro(t.carbs)} · L {fmtMacro(t.fat)}
                      <span className="fd-per"> au total</span>
                      {mealPortions(m) > 1 && (
                        <span className="fd-per"> · {fmtNum(t.kcal / mealPortions(m), 0)} kcal par portion</span>
                      )}
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
                  <button className="tk-edit danger-edit" onClick={()=>onDelete(f)}>Oublier</button>
                  {foodSourceUrl(f, store.refByBarcode) && (
                    <a className="icon-btn fd-src-btn" href={foodSourceUrl(f, store.refByBarcode)}
                       target="_blank" rel="noopener noreferrer"
                       aria-label="Voir la fiche d'origine" title="Voir la fiche d'origine">
                      <ExternalIcon />
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

/* ---- Créer un aliment ------------------------------------------------------
   Uniquement créer : un aliment déjà enregistré ne se corrige plus. Ce qui
   vient de Ciqual ou d'Open Food Facts est traité comme la fiche de l'aliment,
   pas comme un brouillon à retoucher — sinon deux personnes qui scannent le
   même produit ne parlent bientôt plus de la même chose. Pour un aliment à
   soi, il y a l'onglet Créer ; pour se débarrasser d'une fiche, il y a
   « oublier ».                                                               */
function FoodEditModal({ food, onClose, onSave }){
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
        <h2>Nouvel aliment</h2>
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
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!canSave} onClick={submit}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Objectifs ------------------------------------------------------------ */
const MACRO_GOAL_KEYS = ['protein', 'carbs', 'fat'];

function GoalsModal({ goals, isSet, fromDay, onClose, onSave }){
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

  /* Ce qu'il resterait à mettre dans la troisième macro pour tomber sur la
     cible calorique. Deux macros posées et des calories visées laissent une
     seule inconnue : autant l'afficher plutôt que de faire sortir la
     calculette. C'est une suggestion, pas une valeur — d'où le placeholder :
     tant qu'on n'a rien tapé, rien n'est enregistré.

     Elle est rendue dans l'unité du mode choisi pour CE champ : le nombre
     change de forme quand on bascule en % ou en g/kg, parce que c'est le même
     objectif dit autrement. */
  const suggestion = (key) => {
    if (!kcalNum || macroNum(key) != null) return '';
    const others = MACRO_GOAL_KEYS.filter(k => k !== key);
    if (others.some(k => grams[k] == null)) return '';
    const left = kcalNum - others.reduce((sum, k) => sum + grams[k] * MACRO_KCAL_FACTOR[k], 0);
    if (left <= 0) return '';
    const mode = macro[key].mode;
    if (mode === 'percent') return fmtNum((left / kcalNum) * 100, 0);
    if (mode === 'perkg') return weightNum ? fmtNum(left / MACRO_KCAL_FACTOR[key] / weightNum, 1) : '';
    return fmtNum(left / MACRO_KCAL_FACTOR[key], 0);
  };
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
        {/* Un objectif n'est pas un réglage global mais une consigne datée :
            dire depuis quand elle vaut est ce qui rend lisible le fait que les
            jours d'avant, eux, gardent la leur. */}
        <div className="modal-sub">
          {fromDay === dayKey(Date.now())
            ? "À partir d'aujourd'hui"
            : `À partir du ${dayLabel(dayKeyToTs(fromDay)).toLowerCase()}`}
        </div>
        <p className="fd-note serif">
          {isSet
            ? 'Ce que vous visez à partir de ce jour-là. Les jours précédents gardent l’objectif qui était le leur.'
            : 'Valeurs par défaut — remplacez-les par les vôtres. Elles vaudront à partir de ce jour-là, et pour les suivants.'}
        </p>

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
                  placeholder={suggestion(key)}
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
            {kcalNum && MACRO_GOAL_KEYS.every(k => grams[k] != null) && Math.abs(kcalNum - implied) >= 5
              ? ` Il ${kcalNum > implied ? 'manque' : 'dépasse de'} ${fmtNum(Math.abs(kcalNum - implied),0)} kcal.`
              : ''}
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

  // Une barre par jour, y compris les jours vides : un trou dans le suivi est
  // une information, pas un jour à sauter. Chaque jour porte AUSSI l'objectif
  // qui était le sien : sur 90 jours, la cible a pu changer en route, et une
  // seule ligne d'objectif mentirait sur les deux tiers du graphe.
  const series = useMemo(() => {
    const out = [];
    const today = startOfDay(Date.now());
    for (let i = rangeDays - 1; i >= 0; i--){
      const ts = today - i * 86400000;
      const dk = dayKey(ts);
      const rows = store.logsByDay[dk] || [];
      out.push({ dk, ts, logged: rows.length > 0, totals: sumNutriments(rows.map(l => l.nutriments)),
                 goals: store.effectiveGoalsAt(dk) });
    }
    return out;
  }, [store.logsByDay, store.effectiveGoalsAt, rangeDays]);

  const loggedDays = series.filter(d => d.logged);
  const avg = loggedDays.length
    ? loggedDays.reduce((s,d) => s + (d.totals[metric] || 0), 0) / loggedDays.length
    : null;
  // L'objectif affiché en statistique est celui de la fin de période — celui
  // qui court aujourd'hui. « Dans la cible », lui, compare chaque jour à SON
  // objectif du moment, pas au dernier en date.
  const goal = (series.length ? series[series.length-1].goals[metric] : 0) || 0;
  const goalsVaried = series.some(d => (d.goals[metric] || 0) !== goal);
  const inRange = loggedDays.filter(d => {
    const g = d.goals[metric] || 0;
    return g > 0 && Math.abs((d.totals[metric] || 0) - g) <= g * 0.1;
  }).length;

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
              <div>objectif <span className="v">
                {goal > 0 ? `${fmtNum(goal,0)} ${m.unit}` : '—'}{goalsVaried ? ' *' : ''}
              </span></div>
              <div>jours notés <span className="v">{loggedDays.length}</span></div>
              <div>dans la cible <span className="v">{inRange}</span></div>
            </div>
            <button className="icon-btn chart-edit-btn" onClick={onGoals} title="Objectifs" aria-label="Objectifs">
              <GearIcon />
            </button>
          </div>
        </div>
        <NutritionBars series={series} metric={metric} color={m.color} />
        {goalsVaried && (
          <p className="fd-note serif" style={{margin:'10px 0 0'}}>
            * l'objectif a changé sur la période — la ligne en pointillés suit celui de chaque
            jour, et « dans la cible » compare chaque jour au sien.
          </p>
        )}
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

function NutritionBars({ series, metric, color }){
  const W = 680, H = 170, PAD_L = 38, PAD_R = 8, PAD_T = 10, PAD_B = 20;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const values = series.map(d => d.totals[metric] || 0);
  const goalOf = (d) => d.goals ? (d.goals[metric] || 0) : 0;
  const max = Math.max(...series.map(goalOf), ...values, 1);
  const dom = niceDomain(0, max, 4, 'number');
  const yAt = (v) => PAD_T + innerH - ((v - dom.min) / (dom.max - dom.min)) * innerH;
  const slot = innerW / series.length;
  const barW = Math.max(2, Math.min(26, slot * 0.62));

  // Une marche par jour, reliée verticalement quand la consigne change. Le
  // stylo termine chaque jour au bord droit de son créneau, donc la marche
  // suivante n'a qu'à monter ou descendre sur place.
  let goalPath = '', prevY = null;
  series.forEach((d, i) => {
    const g = goalOf(d);
    const x0 = PAD_L + slot * i, x1 = x0 + slot;
    if (g <= 0){ prevY = null; return; }
    const y = yAt(g);
    if (prevY == null) goalPath += `M${x0} ${y}`;
    else if (prevY !== y) goalPath += `L${x0} ${y}`;
    goalPath += `L${x1} ${y}`;
    prevY = y;
  });

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
            <title>{shortDate(d.ts)} · {fmtNum(v,0)}{goalOf(d) > 0 ? ` / ${fmtNum(goalOf(d),0)}` : ''}</title>
          </rect>
        );
      })}
      {/* L'objectif est une marche, pas un trait : il a pu changer en cours de
          période, et une ligne droite d'un bout à l'autre dirait que la cible
          d'il y a deux mois était celle d'aujourd'hui. */}
      {goalPath && (
        <path d={goalPath} fill="none"
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
// Section du Jour comme les autres, réordonnable au même titre : elle porte
// déjà son propre intitulé (« Alimentation ») et son lien « ouvrir » sur la
// même ligne — la poignée de `TodayView` s'y ajoute plutôt que de dupliquer
// un second en-tête au-dessus.
function FoodDaySummary({ store, onOpen, containerRef, dragging, onDragStart }){
  const dk = dayKey(Date.now());
  const rows = store.logsByDay[dk] || [];
  const totals = useMemo(() => sumNutriments(rows.map(l => l.nutriments)), [rows]);
  const goals = store.effectiveGoalsAt(dk);

  return (
    <div ref={containerRef} className={`day-group fd-log-group ${dragging?'dragging':''}`}>
      <div className="fd-log-head">
        <span className="fd-log-title">
          {onDragStart && <DragHandle onPointerDown={onDragStart} dragging={dragging} />}
          <p className="section-label" style={{margin:0}}>Alimentation</p>
        </span>
        <button className="fd-link" onClick={onOpen}>
          {rows.length ? `${rows.length} ligne${rows.length>1?'s':''} — ouvrir` : 'ouvrir la page Food'}
        </button>
      </div>
      {/* `day-group-body` : le même repli que les autres sections du Jour quand
          on les réorganise — c'est le Log qui décide, pas cette carte. */}
      <div className="today-grid day-group-body">
        {FOOD_MACROS.map(m => {
          const v = totals[m.key] || 0;
          const goal = goals[m.key] || 0;
          const pct = goal > 0 ? Math.min(100, (v/goal)*100) : 0;
          const bad = kcalOverrun(m.key, v, goal);
          return (
            <div className={`today-card fd-card ${rows.length?'done':''} ${bad?'bad':''}`} key={m.key} onClick={onOpen} role="button" tabIndex={0}
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
              <span className="fd-meter"><span className={`fd-fill ${bad?'over':''}`} style={{width:`${pct}%`,background:m.color}} /></span>
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
