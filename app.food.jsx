/* ============================================================
   Tracklog — Bouffe
   ------------------------------------------------------------
   Une page à part, avec ses propres données. Les trackers
   génériques (Tracker/Entry) ne peuvent pas porter un repas :
   une ligne de bouffe c'est (jour, repas, aliment, quantité),
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

/* ============================================================
   Open Food Facts — le seul appel réseau de la page
   ------------------------------------------------------------
   Gratuit, sans clé, CORS ouvert, et de loin la meilleure
   couverture des produits vendus en France. En échange :
   qualité inégale, et beaucoup de fiches sans valeurs
   nutritionnelles — d'où le chemin « compléter à la main »
   partout où un produit revient vide.
   ============================================================ */
const OFF_BASE = 'https://world.openfoodfacts.org';
const OFF_FIELDS = [
  'code','product_name','product_name_fr','generic_name_fr','brands','quantity',
  'serving_size','serving_quantity','image_small_url','image_front_small_url','nutriments',
].join(',');

async function offJson(url, timeoutMs = 12000){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Open Food Facts a répondu ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// null = code inconnu de la base (≠ erreur réseau, qui remonte en exception).
async function offFetchProduct(barcode){
  const j = await offJson(`${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`);
  const p = j && j.product;
  if (!p || j.status === 0 || j.status === 'failure') return null;
  return offToFood(p, barcode);
}

// La recherche plein texte est limitée côté OFF (~10 requêtes/min), d'où un
// bouton plutôt qu'une recherche à la frappe.
async function offSearchFoods(query){
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}`
            + `&search_simple=1&action=process&json=1&page_size=24&fields=${OFF_FIELDS}`;
  const j = await offJson(url, 15000);
  const list = (j && j.products) || [];
  return list.map(p => offToFood(p, p.code)).filter(f => f && f.name);
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
   Le décodeur de codes-barres
   ------------------------------------------------------------
   Deux chemins, parce qu'aucun n'est universel :
     · BarcodeDetector — natif, instantané, mais absent de Safari
       (donc de tout iPhone) au moment où ceci est écrit ;
     · ZXing — décodeur JS chargé à la demande depuis un CDN,
       lent à charger (~200 ko) mais qui marche partout.
   Et si la caméra est refusée ou indisponible : la saisie
   manuelle du code, qui est toujours proposée.
   ============================================================ */
const ZXING_SRC = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
let zxingLoader = null;
function loadZXing(){
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (zxingLoader) return zxingLoader;
  zxingLoader = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_SRC;
    s.async = true;
    s.onload = () => window.ZXing ? resolve(window.ZXing) : reject(new Error('Décodeur indisponible.'));
    s.onerror = () => { zxingLoader = null; reject(new Error('Le décodeur n’a pas pu se charger (réseau ou bloqueur).')); };
    document.head.appendChild(s);
  });
  return zxingLoader;
}

function cameraErrorMessage(e){
  const n = e && e.name;
  if (!window.isSecureContext) return 'La caméra n’est accessible qu’en HTTPS.';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, puis réessaie.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Aucune caméra utilisable sur cet appareil.';
  if (n === 'NotReadableError') return 'La caméra est déjà utilisée par une autre application.';
  return (e && e.message) || 'La caméra n’a pas pu démarrer.';
}

function FoodScanner({ onCode }){
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const stopRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState('init'); // init | live | error
  const [err, setErr] = useState('');
  const [engine, setEngine] = useState('');
  const [canTorch, setCanTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');

  // onCode change à chaque rendu du parent ; le passer en dépendance
  // relancerait la caméra en boucle.
  const onCodeRef = useRef(onCode);
  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    let cancelled = false;

    const hit = (raw) => {
      if (doneRef.current) return;
      const code = String(raw || '').replace(/\D/g, '');
      if (code.length < 8) return;           // un EAN fait 8 ou 13 chiffres
      doneRef.current = true;
      try { navigator.vibrate && navigator.vibrate(60); } catch {}
      onCodeRef.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        setStatus('error');
        setErr('Ce navigateur ne donne pas accès à la caméra. Tape le code à la main.');
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } },
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
      try { setCanTorch(!!(track.getCapabilities && track.getCapabilities().torch)); } catch {}

      if ('BarcodeDetector' in window){
        setEngine('natif');
        let stopped = false, timer = 0;
        let detector;
        try {
          detector = new window.BarcodeDetector({ formats:['ean_13','ean_8','upc_a','upc_e','code_128'] });
        } catch {
          detector = new window.BarcodeDetector();
        }
        const tick = async () => {
          if (stopped || doneRef.current) return;
          try {
            const found = await detector.detect(video);
            if (found && found.length) hit(found[0].rawValue);
          } catch {}
          if (!stopped && !doneRef.current) timer = setTimeout(tick, 200);
        };
        tick();
        stopRef.current = () => { stopped = true; clearTimeout(timer); };
      } else {
        try {
          const ZX = await loadZXing();
          if (cancelled) return;
          setEngine('zxing');
          const hints = new Map();
          hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
            ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
            ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
          ]);
          hints.set(ZX.DecodeHintType.TRY_HARDER, true);
          const reader = new ZX.BrowserMultiFormatReader(hints, 250);
          reader.decodeFromStream(stream, video, (result) => { if (result) hit(result.getText()); });
          stopRef.current = () => { try { reader.reset(); } catch {} };
        } catch(e){
          if (!cancelled){ setStatus('error'); setErr(e.message || 'Décodeur indisponible.'); }
        }
      }
    })();

    return () => {
      cancelled = true;
      try { stopRef.current && stopRef.current(); } catch {}
      const s = streamRef.current;
      if (s) s.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleTorch = async () => {
    const track = streamRef.current && streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced:[{ torch: !torchOn }] });
      setTorchOn(v => !v);
    } catch { setCanTorch(false); }
  };

  const submitManual = () => {
    const code = manual.replace(/\D/g, '');
    if (code.length >= 8) onCodeRef.current(code);
  };

  return (
    <div className="fd-scan">
      <div className={`fd-scan-view ${status}`}>
        <video ref={videoRef} muted playsInline autoPlay />
        {status !== 'error' && <div className="fd-reticle" aria-hidden="true"><span/><span/><span/><span/></div>}
        {status === 'init' && <div className="fd-scan-overlay">Démarrage de la caméra…</div>}
        {status === 'error' && <div className="fd-scan-overlay err">{err}</div>}
        {status === 'live' && canTorch && (
          <button className={`fd-torch ${torchOn?'on':''}`} onClick={toggleTorch} title="Lampe">
            {torchOn ? 'Lampe ●' : 'Lampe ○'}
          </button>
        )}
      </div>
      {status === 'live' && (
        <p className="fd-scan-hint serif">
          Cadre le code-barres, bien à plat et bien éclairé{engine === 'zxing' ? ' — décodeur logiciel, laisse-lui une seconde' : ''}.
        </p>
      )}
      <div className="fd-manual">
        <label>Ou tape le code</label>
        <input
          inputMode="numeric"
          placeholder="3017620422003"
          value={manual}
          onChange={e => setManual(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitManual(); }}
        />
        <button className="primary sm" disabled={manual.replace(/\D/g,'').length < 8} onClick={submitManual}>Chercher</button>
      </div>
    </div>
  );
}

/* ============================================================
   Le magasin — foods / food_logs / nutrition_goals
   ------------------------------------------------------------
   Vit dans App (un seul chargement), pour que la page Bouffe et
   les compteurs de la page Log lisent la même chose.
   ============================================================ */
function useFoodStore(userId){
  const [foods, setFoods] = useState([]);
  const [logs, setLogs] = useState([]);
  const [goals, setGoals] = useState(null);   // null tant que rien n'est réglé
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, l, g] = await Promise.all([
        supabase.from('foods').select('*'),
        supabase.from('food_logs').select('*').order('ts', { ascending:false }),
        supabase.from('nutrition_goals').select('*').maybeSingle(),
      ]);
      if (cancelled) return;
      if (!f.error && f.data) setFoods(f.data.map(foodFromRow));
      if (!l.error && l.data) setLogs(l.data.map(foodLogFromRow));
      if (!g.error && g.data){
        setGoals({ kcal:g.kcal ?? null, protein:g.protein_g ?? null, carbs:g.carbs_g ?? null, fat:g.fat_g ?? null });
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

  const saveGoals = async (g) => {
    const row = { user_id:userId, kcal:g.kcal ?? null, protein_g:g.protein ?? null,
                  carbs_g:g.carbs ?? null, fat_g:g.fat ?? null, updated_at:Date.now() };
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

  return { ready, foods, logs, logsByDay, goals, effectiveGoals: goals || DEFAULT_GOALS, goalsSet: !!goals,
           saveFood, updateFood, removeFood, addLog, updateLog, removeLog, saveGoals, totalsForDay };
}

/* ============================================================
   Page Bouffe
   ============================================================ */
function FoodPage({ store, sub, onSub }){
  const [addOpen, setAddOpen] = useState(null);      // { meal, day } | null
  const [editFood, setEditFood] = useState(null);    // aliment en cours d'édition
  const [newFood, setNewFood] = useState(null);      // brouillon d'aliment (création)
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [day, setDay] = useState(() => dayKey(Date.now()));

  const hint = sub === 'jour' ? 'ce que vous avez mangé'
             : sub === 'aliments' ? 'vos produits scannés et vos aliments perso'
             : 'calories et macros dans le temps';

  return (
    <div>
      <div className="log-subnav">
        <div className="vue-mode">
          <button className={sub==='jour'?'on':''} onClick={()=>onSub('jour')}>Jour</button>
          <button className={sub==='aliments'?'on':''} onClick={()=>onSub('aliments')}>Aliments</button>
          <button className={sub==='vues'?'on':''} onClick={()=>onSub('vues')}>Vues</button>
        </div>
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
          onNew={()=>setNewFood({ id:uid('f_'), source:'custom', name:'', brand:'', basis:'g',
                                  servingG:null, imageUrl:'', nutriments:{}, barcode:null,
                                  favorite:false, lastUsedAt:null, createdAt:Date.now() })}
          onScan={()=>setAddOpen({ meal:null, day })}
        />
      ) : (
        <FoodVuesView store={store} onGoals={()=>setGoalsOpen(true)} />
      )}

      {addOpen && (
        <AddFoodModal
          store={store}
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
          goals={store.effectiveGoals}
          isSet={store.goalsSet}
          onClose={()=>setGoalsOpen(false)}
          onSave={async (g)=>{ await store.saveGoals(g); setGoalsOpen(false); }}
        />
      )}
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
        <button className="cal-nav" onClick={()=>onDay(shiftDayKey(day,-1))} aria-label="Jour précédent">‹</button>
        <div className="fd-date">
          <span className="fd-date-main">{dayLabel(dayKeyToTs(day))}</span>
          <span className="fd-date-sub mono">{day}</span>
        </div>
        <button className="cal-nav" onClick={()=>onDay(shiftDayKey(day,1))} disabled={isToday} aria-label="Jour suivant">›</button>
        {!isToday && <button className="de-today" onClick={()=>onDay(today)}>Aujourd'hui</button>}
      </div>

      <div className="fd-totals">
        {FOOD_MACROS.map(m => {
          const v = totals[m.key] || 0;
          const goal = goals[m.key] || 0;
          const pct = goal > 0 ? Math.min(100, (v / goal) * 100) : 0;
          const over = goal > 0 && v > goal;
          return (
            <div className={`fd-total ${m.key==='kcal'?'lead':''}`} key={m.key} onClick={onGoals} title="Régler les objectifs">
              <span className="fd-total-label">{m.label}</span>
              <span className="fd-total-v">
                {m.key === 'kcal' ? fmtNum(v, 0) : fmtMacro(v)}
                <span className="u">{m.unit}</span>
              </span>
              <span className="fd-meter"><span className={`fd-fill ${over?'over':''}`} style={{width:`${pct}%`, background:m.color}} /></span>
              <span className="fd-total-goal mono">{goal > 0 ? `sur ${fmtNum(goal,0)}` : 'sans objectif'}</span>
            </div>
          );
        })}
      </div>

      {!store.goalsSet && (
        <p className="fd-note serif">
          Objectifs par défaut, à ajuster : <button className="fd-link" onClick={onGoals}>régler mes objectifs</button>.
        </p>
      )}

      <div className="fd-scan-cta">
        <button className="fd-primary" onClick={()=>onAdd(defaultMealForNow())}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M2 5.2V3.4A1.4 1.4 0 0 1 3.4 2h1.8M10.8 2h1.8A1.4 1.4 0 0 1 14 3.4v1.8M14 10.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8M5.2 14H3.4A1.4 1.4 0 0 1 2 12.6v-1.8" />
            <path d="M4.6 8h6.8" />
          </svg>
          Scanner un produit
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
           servingG:null, nutriments: log.grams > 0 ? per100 : {}, source:'custom' };
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

/* ---- Ajouter un aliment (scanner / recherche / bibliothèque) --------------- */
function AddFoodModal({ store, day, meal, onClose, onNeedsFood }){
  const [source, setSource] = useState('scan');   // scan | recherche | bibliotheque
  const [picked, setPicked] = useState(null);     // aliment choisi → étape quantité
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState(null);
  const [query, setQuery] = useState('');
  const [libQuery, setLibQuery] = useState('');
  // Le scanner s'arrête au premier code lu. Si ce code ne donne rien, il faut le
  // relancer : changer sa clé le remonte, caméra comprise.
  const [scanNonce, setScanNonce] = useState(0);

  // Un code scanné : d'abord la bibliothèque locale (instantané, marche hors ligne),
  // ensuite seulement le réseau.
  const handleCode = useCallback(async (code) => {
    setMsg('');
    const cached = store.foods.find(f => f.barcode === code);
    if (cached){ setPicked(cached); return; }
    setBusy(true);
    try {
      const found = await offFetchProduct(code);
      if (!found){
        setMsg(`Code ${code} inconnu d'Open Food Facts. Tu peux créer l'aliment à la main.`);
        setPicked(null);
        setScanNonce(n => n + 1);
        setBusy(false);
        return;
      }
      if (!foodIsUsable(found)){
        setMsg(`« ${found.name} » est référencé mais sans valeurs nutritionnelles. Complète-les une fois, et le produit sera reconnu ensuite.`);
        setBusy(false);
        onNeedsFood(found);
        return;
      }
      const saved = await store.saveFood(found);
      setPicked(saved || found);
    } catch(e){
      setMsg(e.name === 'AbortError' ? 'Open Food Facts ne répond pas. Réessaie.' : (e.message || 'Recherche impossible.'));
      setScanNonce(n => n + 1);
    }
    setBusy(false);
  }, [store]);

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true); setMsg(''); setResults(null);
    try {
      const list = await offSearchFoods(q);
      setResults(list);
      if (!list.length) setMsg('Aucun produit trouvé.');
    } catch(e){
      setMsg(e.name === 'AbortError' ? 'La recherche a expiré. Réessaie.' : (e.message || 'Recherche impossible.'));
    }
    setBusy(false);
  };

  const pickFromSearch = async (f) => {
    if (!foodIsUsable(f)){ onNeedsFood(f); return; }
    const saved = await store.saveFood(f);
    setPicked(saved || f);
  };

  const library = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    const list = q ? store.foods.filter(f => foodLabel(f).toLowerCase().includes(q)) : store.foods;
    return [...list].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt)).slice(0, 60);
  }, [store.foods, libQuery]);

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

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal fd-modal" onClick={e=>e.stopPropagation()}>
        <h2>Ajouter</h2>
        <div className="modal-sub">
          {meal ? MEAL_LABEL[meal] : 'Bibliothèque'} · {dayLabel(dayKeyToTs(day)).toLowerCase()}
        </div>

        <div className="seg" style={{marginBottom:14}}>
          <button className={source==='scan'?'on':''} onClick={()=>setSource('scan')}>Scanner</button>
          <button className={source==='recherche'?'on':''} onClick={()=>setSource('recherche')}>Rechercher</button>
          <button className={source==='bibliotheque'?'on':''} onClick={()=>setSource('bibliotheque')}>Mes aliments</button>
        </div>

        {source === 'scan' && <FoodScanner key={scanNonce} onCode={handleCode} />}

        {source === 'recherche' && (
          <div className="fd-search">
            <div className="fd-search-bar">
              <input
                autoFocus placeholder="skyr, pain de mie, poulet…" value={query}
                onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter') runSearch(); }}
              />
              <button className="primary sm" disabled={busy || query.trim().length < 2} onClick={runSearch}>Chercher</button>
            </div>
            {results && (
              <div className="fd-list">
                {results.map(f => <FoodPickRow key={f.barcode || f.id} food={f} onPick={()=>pickFromSearch(f)} />)}
              </div>
            )}
          </div>
        )}

        {source === 'bibliotheque' && (
          <div className="fd-search">
            <div className="fd-search-bar">
              <input placeholder="filtrer…" value={libQuery} onChange={e=>setLibQuery(e.target.value)} />
            </div>
            <div className="fd-list">
              {library.length
                ? library.map(f => <FoodPickRow key={f.id} food={f} onPick={()=>setPicked(f)} />)
                : <p className="fd-note serif">Rien encore. Scanne un produit ou crée un aliment dans l'onglet Aliments.</p>}
            </div>
          </div>
        )}

        {busy && <p className="fd-note serif">Recherche…</p>}
        {msg && <p className="fd-note warn serif">{msg}</p>}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

function FoodPickRow({ food, onPick }){
  const n = food.nutriments || {};
  return (
    <button className="fd-item" onClick={onPick}>
      {food.imageUrl
        ? <img src={food.imageUrl} alt="" loading="lazy" />
        : <span className="fd-item-ph" aria-hidden="true">{(food.name || '?').slice(0,1).toUpperCase()}</span>}
      <span className="fd-item-txt">
        <span className="n">{food.name}</span>
        <span className="m mono">
          {food.brand ? food.brand + ' · ' : ''}
          {n.kcal != null ? `${fmtNum(n.kcal,0)} kcal` : 'valeurs manquantes'}
          {n.protein != null ? ` · ${fmtMacro(n.protein)}g prot` : ''}
          {' '}/ 100 {food.basis}
        </span>
      </span>
    </button>
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
        <div className="modal-sub">{foodLabel(food)}</div>

        <div className="fd-qty">
          <input
            type="number" step="any" min="0" autoFocus value={qty}
            onChange={e=>setQty(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter' && canSave) onSubmit({ qty:Number(qty), unit, grams, meal, nutriments }); }}
          />
          <div className="seg">
            <button className={unit===food.basis?'on':''} onClick={()=>setUnit(food.basis)}>{food.basis}</button>
            {hasServing && (
              <button className={unit==='portion'?'on':''} onClick={()=>setUnit('portion')}>
                portion ({fmtNum(food.servingG,0)} {food.basis})
              </button>
            )}
          </div>
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
          <div className="seg wrap">
            {MEALS.map(m => (
              <button key={m.id} className={meal===m.id?'on':''} onClick={()=>setMeal(m.id)}>{m.label}</button>
            ))}
          </div>
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
function FoodLibraryView({ store, onEdit, onNew, onScan }){
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const arr = needle
      ? store.foods.filter(f => foodLabel(f).toLowerCase().includes(needle) || (f.barcode || '').includes(needle))
      : store.foods;
    return [...arr].sort((a,b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
  }, [store.foods, q]);

  return (
    <div>
      <div className="trackers-head">
        <p className="section-label" style={{margin:0}}>
          {store.foods.length} aliment{store.foods.length>1?'s':''}
        </p>
        <div className="fd-lib-actions">
          <input className="fd-lib-search" placeholder="filtrer…" value={q} onChange={e=>setQ(e.target.value)} />
          <button className="pill add" onClick={onScan}>Scanner et noter</button>
          <button className="pill add" onClick={onNew}>+ Aliment</button>
        </div>
      </div>

      {!list.length ? (
        <div className="empty">
          <span className="em-serif">Aucun aliment.</span>
          Scannez une étiquette : le produit est enregistré ici, et reste disponible même hors ligne.
        </div>
      ) : (
        <div className="trackers-grid">
          {list.map(f => {
            const n = f.nutriments || {};
            return (
              <div className="tk-card fd-food-card" key={f.id}>
                <div className="tk-info">
                  <div className="tk-name">{f.name}</div>
                  <div className="tk-meta">
                    {f.brand && <span className="tk-chip">{f.brand}</span>}
                    <span className="tk-type">{f.source === 'off' ? 'scanné' : 'perso'}</span>
                    {f.barcode && <span className="tk-count mono">{f.barcode}</span>}
                  </div>
                  <div className="fd-food-nums mono">
                    {n.kcal != null ? `${fmtNum(n.kcal,0)} kcal` : 'sans valeurs'}
                    {n.protein != null ? ` · P ${fmtMacro(n.protein)}` : ''}
                    {n.carbs != null ? ` · G ${fmtMacro(n.carbs)}` : ''}
                    {n.fat != null ? ` · L ${fmtMacro(n.fat)}` : ''}
                    <span className="fd-per"> / 100 {f.basis}</span>
                  </div>
                </div>
                <div className="tk-actions">
                  <button className="tk-edit" onClick={()=>onEdit(f)}>Modifier</button>
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
    <div className="field" key={key}>
      <label>{label}</label>
      <div style={{display:'flex',alignItems:'baseline',flex:1}}>
        <input type="number" step="any" min="0" placeholder="—" style={{width:'100%'}}
          value={vals[key] ?? ''} onChange={e=>setVal(key, e.target.value)} />
        <span className="unit">{unit}</span>
      </div>
    </div>
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
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Riz basmati cuit" />
        </div>
        <div className="field">
          <label>Marque</label>
          <input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="optionnel" />
        </div>
        <div className="field">
          <label>Base</label>
          <div className="seg">
            <button className={basis==='g'?'on':''} onClick={()=>setBasis('g')}>solide (g)</button>
            <button className={basis==='ml'?'on':''} onClick={()=>setBasis('ml')}>liquide (ml)</button>
          </div>
        </div>
        <div className="field">
          <label>Portion</label>
          <div style={{display:'flex',alignItems:'baseline',flex:1}}>
            <input type="number" step="any" min="0" placeholder="optionnel" style={{width:'100%'}}
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
function GoalsModal({ goals, isSet, onClose, onSave }){
  const [v, setV] = useState(() => ({
    kcal: goals.kcal != null ? String(goals.kcal) : '',
    protein: goals.protein != null ? String(goals.protein) : '',
    carbs: goals.carbs != null ? String(goals.carbs) : '',
    fat: goals.fat != null ? String(goals.fat) : '',
  }));
  const num = (k) => { const n = parseFloat(String(v[k]).replace(',', '.')); return isNaN(n) ? null : n; };
  // 4 kcal/g pour les protéines et les glucides, 9 pour les lipides : de quoi
  // voir tout de suite si les trois macros tiennent dans l'objectif calorique.
  const implied = (num('protein') || 0) * 4 + (num('carbs') || 0) * 4 + (num('fat') || 0) * 9;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <h2>Objectifs du jour</h2>
        <div className="modal-sub">
          {isSet ? 'Ce que vous visez chaque jour.' : 'Valeurs par défaut — remplacez-les par les vôtres.'}
        </div>
        {FOOD_MACROS.map(m => (
          <div className="field" key={m.key}>
            <label>{m.label}</label>
            <div style={{display:'flex',alignItems:'baseline',flex:1}}>
              <input type="number" step="any" min="0" style={{width:'100%'}}
                value={v[m.key]} onChange={e=>setV(s => ({ ...s, [m.key]: e.target.value }))} />
              <span className="unit">{m.unit}</span>
            </div>
          </div>
        ))}
        {implied > 0 && (
          <p className="fd-note serif">
            Ces macros font <span className="mono">{fmtNum(implied,0)} kcal</span>
            {num('kcal') ? ` pour un objectif de ${fmtNum(num('kcal'),0)} kcal.` : '.'}
          </p>
        )}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Annuler</button>
          <button className="primary"
            onClick={()=>onSave({ kcal:num('kcal'), protein:num('protein'), carbs:num('carbs'), fat:num('fat') })}>
            Enregistrer
          </button>
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
        <div className="vue-mode">
          {FOOD_MACROS.map(x => (
            <button key={x.key} className={metric===x.key?'on':''} onClick={()=>setMetric(x.key)}>{x.label}</button>
          ))}
        </div>
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
            <button className="chart-edit-btn" onClick={onGoals} title="Objectifs" aria-label="Objectifs">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="8" cy="8" r="2.3" /><circle cx="8" cy="8" r="6" />
              </svg>
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
   Lecture seule : on note la bouffe dans la page Bouffe, ici
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
          {rows.length ? `${rows.length} ligne${rows.length>1?'s':''} — ouvrir` : 'ouvrir la page Bouffe'}
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
                <div className="tc-name"><span className="dot" style={{background:m.color}}></span>{m.label}</div>
                <span className="tc-badge">bouffe</span>
              </div>
              <div className="fd-card-v">
                {m.key === 'kcal' ? fmtNum(v,0) : fmtMacro(v)}
                <span className="u">{m.unit}</span>
              </div>
              <span className="fd-meter"><span className={`fd-fill ${over?'over':''}`} style={{width:`${pct}%`,background:m.color}} /></span>
              <div className="fd-card-goal mono">{goal > 0 ? `objectif ${fmtNum(goal,0)}` : 'sans objectif'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
