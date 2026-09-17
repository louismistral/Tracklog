/* ============================================================
   app.charts.jsx — tout ce qui dessine les données
   ------------------------------------------------------------
   Les cartes de graphe (`ChartCard`) et leur infobulle, les
   échelles d'axe, les formes de tracé (ligne, lissée, bâtons), la
   granularité (jour/semaine/mois), la normalisation et la
   tendance, les masters (`MasterStrip`, `MasterTrackerCard`), le
   calendrier heatmap et la grille.

   Chargé après app.ui.jsx, dont il emprunte `GearIcon`,
   `DragHandle` et `Segmented`, et avant app.jsx et app.food.jsx,
   qui montent ces cartes dans leurs écrans.
   ============================================================ */

/* ---- Densité des cartes de graphe -----------------------------------------
   Combien de cartes par ligne dans la vue Cartes. Au-delà de quatre, une carte
   est plus étroite que son propre axe : le graphe cesse de se lire.
   Chaque cran retire du détail plutôt que de le tasser — c'est ce qui fait la
   différence entre « plus petit » et « illisible ». */
const MAX_PER_ROW = 3;

/* ---- Un graphe se dessine à la taille qu'il occupe ------------------------
   Les SVG des graphes étaient tracés dans un repère fixe de 800 unités de
   large, puis écrasés à la largeur réelle de la carte (`preserveAspectRatio:
   none`). Sur un téléphone de 350 px, tout l'horizontal passait donc à 44 % :
   les graduations devenaient des taches illisibles et les points, des ovales
   couchés — un cercle de rayon 3 rendu 1,3 px de large sur 3 de haut.

   On mesure donc la largeur réellement occupée et on s'en sert comme repère :
   une unité du dessin vaut alors un pixel, dans les deux sens. Le texte reste
   à sa taille, un rond reste rond. `ResizeObserver` plutôt qu'un écouteur de
   redimensionnement : la carte change aussi de largeur quand le curseur de
   densité bouge, sans que la fenêtre bouge. */
/* @atelier technique — La largeur réelle d’un graphe, mesurée plutôt que devinée. */
function useDrawWidth(ref, fallback = 800){
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const px = Math.round(entries[0].contentRect.width);
      // Un arrondi au pixel : sans lui, une largeur fractionnaire relancerait
      // un rendu à chaque image pendant une animation de mise en page.
      if (px > 0) setW(px);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function chartDetail(perRow){
  // `axisLabels:false` au cran serré est une simplification voulue : à 250 px
  // de large, six graduations se touchent. Le texte n'est plus déformé depuis
  // que le repère du dessin suit la largeur réelle (`useDrawWidth`) — il est
  // juste trop nombreux. On les retire, la carte devient une sparkline, et la
  // valeur du jour reste lisible dans l'en-tête.
  if (perRow >= 3) return { height: 84,  padL: 8,  padB: 8,  yTicks: 3, midTick: false, axisLabels: false, stats: 'value' };
  if (perRow === 2) return { height: 110, padL: 32, padB: 20, yTicks: 5, midTick: true,  axisLabels: true,  stats: 'short' };
  return                   { height: 160, padL: 40, padB: 24, yTicks: 6, midTick: true,  axisLabels: true,  stats: 'full'  };
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
/* @atelier technique — Les bâtons d’un graphe, dessinés dans le SVG de ChartCard — pas de spécimen isolé. */
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
/* ============================================================
   Chart card — line chart with axes
   ============================================================ */
/* @atelier organisme — La carte de graphe : axes, courbe, statistiques, densité — le composant le plus réglé de l’app. */
function ChartCard({ tracker, entries, rangeDays, endTs = Date.now(), perRow = 1, containerRef, dragging, onDragStart, onEdit, onOpenDay, goalAt = null }){
  const detail = chartDetail(perRow);
  const compact = perRow >= 2;
  // `endTs` et non « maintenant » : une période personnalisée peut se fermer
  // sur un jour passé, et toute la carte se lit alors depuis cette borne.
  const now = endTs;
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
  // Le repère du dessin fait la largeur réelle de la carte (voir `useDrawWidth`) :
  // une unité = un pixel, donc un rond reste rond et une graduation reste lisible.
  const svgRef = useRef(null);
  const W = useDrawWidth(svgRef), H = detail.height, PAD_L = detail.padL, PAD_R = 12, PAD_T = 10, PAD_B = detail.padB;
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
        <svg ref={svgRef} className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice"
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
            <path d={goalPath} fill="none" stroke="var(--muted-foreground)" strokeWidth="1"
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
              {activePoint?.value != null && <circle cx={xAt(active)} cy={yAt(activePoint.value)} r="3.5" fill={tracker.color} stroke="var(--background)" strokeWidth="1.5" />}
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
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--muted-foreground-2)',fontSize:13}}>aucune donnée sur la période</div>
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
/* @atelier molecule — Le relevé d’un jour pointé sur un graphe, placé en pourcentage de la largeur. */
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
/* @atelier organisme — Une seule courbe : la moyenne des séries normalisées de tous les trackers choisis. */
function TrendChart({ trackers, entries, rangeDays, endTs = Date.now() }){
  const series = useMemo(() => trackers.map(t => {
    const raw = buildDailySeries(t, entries.filter(e=>e.trackerId===t.id), rangeDays, endTs);
    return forwardFill(normalizeSeries(t, raw));
  }), [trackers, entries, rangeDays, endTs]);

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

  const svgRef = useRef(null);
  const W = useDrawWidth(svgRef), H = 260, PAD_L = 38, PAD_R = 14, PAD_T = 16, PAD_B = 28;
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
          <span style={{color:'var(--muted-foreground-2)',fontSize:12,marginLeft:8}}>moyenne normalisée — {trackers.length} séries</span>
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
        <svg ref={svgRef} className="chart-svg" style={{height:H+'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
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
              fill="none" stroke="var(--muted-foreground-2)" strokeWidth="1" opacity="0.35" />
          ))}
          {/* Smoothed — bold */}
          {smSegs.map((seg, si) => {
            if (seg.length < 2) return null;
            const d = seg.map((p,i)=>`${i===0?'M':'L'}${p[0]},${p[1]}`).join(' ');
            const area = d + ` L${seg[seg.length-1][0]},${PAD_T+innerH} L${seg[0][0]},${PAD_T+innerH} Z`;
            return (
              <g key={`s${si}`}>
                <path d={area} fill="var(--foreground)" opacity="0.06" />
                <path d={d} fill="none" stroke="var(--foreground)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {/* X ticks */}
          {xTicks.map((t,i)=>(
            <text key={i} className="chart-axis" x={xAt(t.i)} y={H-8} textAnchor={i===0?'start':i===xTicks.length-1?'end':'middle'}>{t.label}</text>
          ))}
        </svg>
      ) : (
        <div style={{padding:'40px 0',textAlign:'center',color:'var(--muted-foreground-2)',fontSize:13}}>aucune donnée sur la période</div>
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
/* @atelier organisme — La bande des masters du jour, réordonnable entre eux. */
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
/* @atelier organisme — La jauge 0–100 d’un master pour un jour donné. */
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
/* @atelier organisme — Le master en carte de graphe : son indice dans le temps, et ses membres en dessous. */
function MasterTrackerCard({ master, trackerById, entries, rangeDays, endTs = Date.now(), perRow = 1, containerRef, dragging, onDragStart, onEdit }){
  const detail = chartDetail(perRow);
  const compact = perRow >= 2;
  const members = masterMembers(master, trackerById);
  const grain = GRAINS.some(g => g.id === master.chartGrain) ? master.chartGrain : 'day';
  const curveStyle = isCurveStyle(master.curveStyle) ? master.curveStyle : 'line';

  // Per-member normalized+filled series, then the master's own active window.
  // The index is already 0–1, so its axis stays 0–100 whatever the grain —
  // only how many days one point covers changes.
  const dailySeries = useMemo(
    () => computeMasterSeries(master, members, entries, rangeDays, endTs),
    [master, members, entries, rangeDays, endTs]
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
  const svgRef = useRef(null);
  const W = useDrawWidth(svgRef), H = perRow >= 3 ? 100 : compact ? 130 : 220, PAD_L = detail.padL, PAD_R = 14, PAD_T = 14, PAD_B = detail.padB;
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
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--muted-foreground-2)',fontSize:13}}>aucun tracker membre — modifiez ce master pour en choisir</div>
      ) : hasData ? (
        <svg ref={svgRef} className="chart-svg" style={{height: H + 'px'}} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
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
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--muted-foreground-2)',fontSize:13}}>aucune donnée sur la période</div>
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
/* @atelier organisme — Le calendrier heatmap d’un tracker : une case par jour, teintée par la valeur. */
function CalendarCard({ tracker, entries, rangeDays, endTs = Date.now(), onEdit }){
  // Always render last ~365 days of cells (or rangeDays), aligned to weeks
  const days = Math.min(Math.max(rangeDays, 30), 365);
  const now = new Date(endTs); now.setHours(0,0,0,0);
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
          let fill = 'var(--card)';
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
        <span className="lg" style={{background:'var(--card)'}}></span>
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
/* @atelier organisme — La grille de KPI : une tuile par tracker, valeur du jour et sparkline. */
function GridSummary({ trackers, entries, rangeDays, endTs = Date.now(), onEdit }){
  const now = endTs;
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
