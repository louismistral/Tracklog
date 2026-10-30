/* ============================================================
   Tracklog — Finance
   ------------------------------------------------------------
   Les comptes des business (Redline Editions, Arro Designs) :
   ventes, frais Etsy, production, taxes, par mois et par
   commande. Les chiffres ne se saisissent pas, ils se LISENT
   chez Etsy et Gelato par la fonction Edge `finance`, qui
   remplace à chaque synchro les tables `finance_lines` (une
   ligne d'argent, en HT et TVA) et `finance_orders` (le net de
   chaque commande). La page n'écrit que ce qu'aucun service ne
   connaît : les frais externes (`finance_extra`). Arro, arrêté,
   n'a pas de boutique reliée : ses lignes ont été importées une
   fois (tableau des commandes Notion + relevés mensuels Etsy).

   Pas de statut TVA : la TVA payée sur les frais est un coût,
   le résultat se lit dans la colonne Total. La taxe de
   l'acheteur entre avec la vente et repart aussitôt (net 0).
   ============================================================ */

// `archived` : business arrêté, ses chiffres ont été importés une fois (commandes du
// tableau Notion, frais hors commandes des relevés Etsy) et ne se relisent plus.
const FIN_BUSINESSES = [
  { id:'redline', label:'Redline' },
  { id:'arro',    label:'Arro', archived:true },
];
const FIN_SECTIONS = ['Etsy', 'Site', 'Gelato', 'Production', 'Frais externes', 'Frais uniques'];
const FIN_LINE_ORDER = ['Ventes', 'Taxe acheteur reversée', 'Frais de transaction', 'Frais de paiement',
  'Frais réglementaires', 'Mise en ligne', 'Renouvellement après vente', 'Pub Etsy Ads', 'Pub hors Etsy',
  'Crédit trafic vendeur', 'Frais Etsy', 'Frais Webflow', 'Pub et frais hors commandes',
  'Production + livraison', 'Impression + emballage', 'Timbre', 'Dédouanement'];
const finEur = new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' });
const finMoney = (v) => finEur.format(v || 0);
// Dans un tableau, le « € » est dans l'en-tête : sans lui à chaque case, quatre colonnes tiennent sur un téléphone.
const finNum = new Intl.NumberFormat('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });
const finAmount = (v) => finNum.format(Math.abs(v) < 0.005 ? 0 : v);
const finSign = (v) => v < 0 ? 'fin-neg' : '';
const finMonthLong = (m) => new Intl.DateTimeFormat('fr-FR', { month:'long', year:'numeric', timeZone:'UTC' })
  .format(new Date(m + '-15T00:00:00Z'));

/* Le chiffre d'affaires et le bénéfice vus comme des trackers, sur le modèle
   des graphes de Food (`useFoodCharts`) : même `ChartCard`, même engrenage,
   réglages dans `prefs.financeCharts`, jamais dans la table `trackers` — on ne
   les remplit pas, ils se lisent dans les lignes d'argent. CA = ventes HT,
   bénéfice = le Résultat de la page (Total de toutes les lignes) : leurs
   cumuls sur la période valent les chiffres clés juste en dessous. */
const FIN_CHARTS = [
  { key:'ca',       label:'Chiffre d’affaires', color:'oklch(0.62 0.11 250)', of:(l) => l.ligne === 'Ventes' ? l.ht : 0 },
  { key:'benefice', label:'Bénéfice',           color:'oklch(0.62 0.14 150)', of:(l) => l.ht + l.tva },
];

/* @atelier technique — Le CA et le bénéfice vus comme des trackers, fabriqués à la volée. */
function useFinanceCharts(){
  const accountPrefs = useContext(AccountPrefsContext) || LOCAL_ONLY_PREFS;
  const saved = accountPrefs.prefs.financeCharts || {};
  const trackerFor = useCallback((spec) => ({
    id: 'fin:' + spec.key, name: spec.label, color: spec.color, type: 'number', unit: '€',
    daily: true, aggregate: 'avg', multiple: false, choices: null, members: null,
    windowEnabled: false, jokerEnabled: false, goodDirection: 'up', targetValue: null,
    // Cumulé par défaut : la courbe finit sur le total de la période.
    curveStyle: 'line', chartGrain: 'day', cumulative: true,
    ...(saved[spec.key] || {}),
  }), [saved]);
  const saveChart = useCallback((key, patch) => {
    accountPrefs.savePrefs({ financeCharts: { ...saved, [key]: { ...(saved[key] || {}), ...patch } } });
  }, [accountPrefs, saved]);
  return { trackerFor, saveChart };
}

// Une entrée par jour de la période, zéro compris : un jour sans vente vaut 0 €,
// ce n'est pas un trou. Midi comme horodatage, qu'un changement d'heure ne
// fasse pas glisser un jour dans son voisin.
function finEntries(lines, spec, startKey, endKey){
  const byDay = {};
  for (const l of lines){ const d = String(l.day).slice(0, 10); byDay[d] = (byDay[d] || 0) + spec.of(l); }
  const out = [];
  for (let ts = dayKeyToTs(startKey) + 43200000; dayKey(ts) <= endKey; ts += 86400000){
    const d = dayKey(ts);
    out.push({ id: `${spec.key}@${d}`, trackerId: 'fin:' + spec.key, value: +(byDay[d] || 0).toFixed(2), ts });
  }
  return out;
}

/* @atelier technique — Les données Finance du compte : lignes, commandes, frais externes, état des boutiques, et la synchro. */
function useFinanceData(){
  const [data, setData] = useState({ lines:[], orders:[], extra:[] });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Une table manquante ne bloque jamais l'app : on lit en tolérant l'erreur.
  const load = useCallback(async () => {
    const read = async (q) => { const { data:d, error } = await q; return error ? [] : (d || []); };
    const [lines, orders, extra] = await Promise.all([
      read(supabase.from('finance_lines').select('business,day,section,ligne,commande,ht,tva').limit(20000)),
      read(supabase.from('finance_orders').select('*').limit(5000)),
      read(supabase.from('finance_extra').select('*').order('day', { ascending:false })),
    ]);
    setData({ lines, orders, extra });
  }, []);

  const refreshStatus = useCallback(async () => {
    try { setStatus((await callFunction('finance', 'status', { method:'GET' })).businesses); }
    catch (e){ setMsg(String(e.message || e)); }
  }, []);

  // Relire Etsy et Gelato : à l'ouverture de l'onglet, et au bouton.
  const sync = useCallback(async (business) => {
    setBusy(true); setMsg('Lecture d’Etsy et Gelato…');
    try {
      const r = await callFunction('finance', 'sync', { body: business ? { business } : {} });
      const errs = (r.results || []).filter(x => x.error).map(x => x.error);
      setMsg(errs.join(' · '));
    } catch (e){ setMsg(String(e.message || e)); }
    await Promise.all([load(), refreshStatus()]);
    setBusy(false);
  }, [load, refreshStatus]);

  useEffect(() => { load(); refreshStatus(); sync(); }, []);
  return { ...data, status, busy, msg, setMsg, load, sync, refreshStatus };
}

/* @atelier page — L’onglet Finance : bénéfice des business, par mois et par commande. */
function FinanceView(){
  const fin = useFinanceData();
  const [business, setBusiness] = useState('all');
  // Les mêmes périodes que l'onglet Vues, plus un mois précis.
  const [rangeMode, setRangeMode] = useState('all'); // '7'|'30'|'90'|'365'|'ytd'|'all'|'month'|'custom'
  const [month, setMonth] = useState('');             // vide = le dernier mois
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [uniques, setUniques] = useState(true);
  const [editKey, setEditKey] = useState(null);
  const { trackerFor, saveChart } = useFinanceCharts();

  const inBiz = (r) => business === 'all' || r.business === business;
  // Les frais externes sont des lignes comme les autres, saisies en positif.
  const allLines = useMemo(() => [
    ...fin.lines.map(l => ({ ...l, ht:Number(l.ht), tva:Number(l.tva) })),
    ...fin.extra.map(x => ({ business:x.business, day:x.day, section:x.is_unique ? 'Frais uniques' : 'Frais externes',
                             ligne:x.libelle, commande:null, ht:-Math.abs(Number(x.ht)), tva:-Math.abs(Number(x.tva)) })),
  ], [fin.lines, fin.extra]);

  const months = useMemo(() => [...new Set(allLines.filter(inBiz).map(l => String(l.day).slice(0, 7)))].sort(), [allLines, business]);
  const today = dayKey(Date.now());
  const firstDay = useMemo(() => allLines.filter(inBiz).reduce((m, l) => { const d = String(l.day).slice(0, 10); return d < m ? d : m; }, today),
    [allLines, business, today]);
  const curMonth = month || months[months.length - 1] || today.slice(0, 7);
  // Une période = deux jours `AAAA-MM-JJ`, comparés comme des chaînes.
  const [startKey, endKey] = useMemo(() => {
    const back = (n) => dayKey(startOfDay(Date.now()) - (n - 1) * 86400000);
    if (rangeMode === 'all') return [firstDay, today];
    if (rangeMode === 'ytd') return [today.slice(0, 4) + '-01-01', today];
    if (rangeMode === 'month'){
      const [y, m] = curMonth.split('-').map(Number);
      const last = `${curMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
      return [curMonth + '-01', last < today ? last : today];
    }
    if (rangeMode === 'custom') return [customStart || back(30), customEnd || today];
    return [back(parseInt(rangeMode, 10)), today];
  }, [rangeMode, curMonth, customStart, customEnd, firstDay, today]);
  const inPeriod = (day) => { const d = String(day).slice(0, 10); return d >= startKey && d <= endKey; };
  const rangeDays = Math.max(1, Math.round((dayKeyToTs(endKey) - dayKeyToTs(startKey)) / 86400000) + 1);
  const lines = allLines.filter(l => inBiz(l) && inPeriod(l.day) && (uniques || l.section !== 'Frais uniques'));
  const orders = fin.orders.filter(o => inBiz(o) && inPeriod(o.day)).sort((a, b) => String(b.day).localeCompare(String(a.day)));

  const sum = (ls) => ls.reduce((s, l) => s + l.ht + l.tva, 0);
  const ventes = lines.filter(l => l.ligne === 'Ventes').reduce((s, l) => s + l.ht, 0);
  const hors = lines.filter(l => !l.commande);
  const kpi = { ventes, net: sum(lines.filter(l => l.commande)), hors: sum(hors), result: sum(lines) };

  return (
    <div className="fin">
      <div className="log-subnav fin-bar">
        <Segmented size="compact">
          <button className={business==='all'?'on':''} onClick={()=>{ setBusiness('all'); setMonth(''); }}>Tout</button>
          {FIN_BUSINESSES.map(b => (
            <button key={b.id} className={business===b.id?'on':''} onClick={()=>{ setBusiness(b.id); setMonth(''); }}>{b.label}</button>
          ))}
        </Segmented>
      </div>
      <div className="fin-bar range">
        {['7','30','90','365'].map(r => (
          <button key={r} className={rangeMode===r?'on':''} onClick={()=>setRangeMode(r)}>{r}j</button>
        ))}
        <button className={rangeMode==='ytd'?'on':''} onClick={()=>setRangeMode('ytd')}>YTD</button>
        <button className={rangeMode==='all'?'on':''} onClick={()=>setRangeMode('all')}>Tout</button>
        <button className={rangeMode==='month'?'on':''} onClick={()=>setRangeMode('month')}>Mois</button>
        <button className={rangeMode==='custom'?'on':''} onClick={()=>setRangeMode('custom')}>Personnalisé</button>
        {rangeMode === 'month' && (
          <select className="range-custom-date" aria-label="Mois" value={curMonth} onChange={e=>setMonth(e.target.value)}>
            {months.slice().reverse().map(m => <option key={m} value={m}>{finMonthLong(m)}</option>)}
          </select>
        )}
        {rangeMode === 'custom' && (
          <>
            <input type="date" className="range-custom-date" aria-label="Du"
              value={customStart} max={customEnd || today} onChange={e=>setCustomStart(e.target.value)} />
            <span className="range-custom-sep">→</span>
            <input type="date" className="range-custom-date" aria-label="Au"
              value={customEnd} min={customStart} max={today} onChange={e=>setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      <div className="chart-grid-layout" data-per="2">
        {FIN_CHARTS.map(sp => (
          <ChartCard key={sp.key} perRow={2} tracker={trackerFor(sp)}
            entries={finEntries(lines, sp, startKey, endKey)}
            rangeDays={rangeDays} endTs={dayKeyToTs(endKey) + 86400000 - 1}
            onEdit={()=>setEditKey(sp.key)} />
        ))}
      </div>

      <div className="fin-kpis">
        <FinKpi label="Ventes HT" value={kpi.ventes} plain />
        <FinKpi label="Net des commandes" value={kpi.net} />
        <FinKpi label="Hors commandes" value={kpi.hors} />
        <FinKpi label="Résultat" value={kpi.result} strong />
      </div>

      <div className="card fd-card">
        <div className="fin-head">
          <p className="section-label">Gains et coûts</p>
          <div className="ctl-with-info">
            <span className="fin-ctl-label">Frais uniques</span>
            <BoolPill value={uniques} onChange={setUniques} onLabel="Avec" offLabel="Sans" />
            <InfoBubble title="Gains et coûts">
              HT, TVA et <span className="k">Total</span> de chaque ligne d’argent. Sans statut TVA, la TVA payée
              sur les frais est un coût : le résultat se lit dans la colonne Total. La taxe de l’acheteur entre
              avec la vente et repart aussitôt.<br/>
              <span className="k">Frais uniques</span> : ouverture de boutique, matériel… à inclure ou non.
            </InfoBubble>
          </div>
        </div>
        <FinTable lines={lines} />
        <div className="fin-recap">
          <span>Net des commandes</span><b className={finSign(kpi.net)}>{finMoney(kpi.net)}</b>
          <span>Hors commandes</span><b className={finSign(kpi.hors)}>{finMoney(kpi.hors)}</b>
          <span className="fin-strong">Résultat</span><b className={`fin-strong ${finSign(kpi.result)}`}>{finMoney(kpi.result)}</b>
        </div>
      </div>

      <div className="card fd-card">
        <p className="section-label">Par commande · {orders.length}</p>
        <p className="tc-empty-note fin-note">Net = prix HT moins frais Etsy (TVA comprise) et production + envoi. La taxe de l’acheteur, comprise dans le TTC, repart aussitôt. Pub, mises en ligne et frais externes sont hors commandes.</p>
        {orders.length === 0
          ? <span className="tc-empty-note">Aucune commande sur cette période.</span>
          : <FinOrdersTable orders={orders} showBiz={business==='all'} />}
      </div>

      <div className="card fd-card">
        <p className="section-label">Hors commandes</p>
        <p className="tc-empty-note fin-note">Ce qui se paie même sans vente.</p>
        <FinTable lines={hors} />
      </div>

      <FinExtraCard extra={fin.extra.filter(inBiz)} business={business} onChange={fin.load} />
      <FinShopsCard fin={fin} />

      {editKey && (
        <TrackerModal scope="display" tracker={trackerFor(FIN_CHARTS.find(x => x.key === editKey))}
          onClose={()=>setEditKey(null)}
          onSave={(patch)=>{ saveChart(editKey, patch); setEditKey(null); }} />
      )}
    </div>
  );
}

/* @atelier molecule — Un chiffre clé de Finance, en rouge s’il est négatif. */
function FinKpi({ label, value, plain = false, strong = false }){
  return (
    <div className={`fin-kpi ${strong ? 'fin-strong' : ''}`}>
      <span className="fin-kpi-label">{label}</span>
      <span className={`fin-kpi-value ${plain ? '' : finSign(value)}`}>{finMoney(value)}</span>
    </div>
  );
}

/* @atelier organisme — Le tableau HT / TVA / Total : un total par section, ses lignes en dessous. */
function FinTable({ lines }){
  const rows = [];
  for (const s of FIN_SECTIONS){
    const ls = lines.filter(l => l.section === s);
    if (!ls.length) continue;
    const by = {};
    for (const l of ls){ const b = by[l.ligne] || (by[l.ligne] = { ht:0, tva:0 }); b.ht += l.ht; b.tva += l.tva; }
    const tot = Object.values(by).reduce((t, b) => ({ ht:t.ht + b.ht, tva:t.tva + b.tva }), { ht:0, tva:0 });
    rows.push({ key:s, label:s, ...tot, sec:true });
    Object.entries(by)
      .sort(([a, x], [b, y]) => ((FIN_LINE_ORDER.indexOf(a) + 1 || 99) - (FIN_LINE_ORDER.indexOf(b) + 1 || 99)) || (x.ht + x.tva) - (y.ht + y.tva))
      .forEach(([k, v]) => rows.push({ key:s + k, label:k, ht:v.ht, tva:v.tva }));
  }
  if (!rows.length) return <span className="tc-empty-note">Rien sur cette période.</span>;
  return (
    <div className="fin-table">
      <div className="fin-row fin-th"><span>€</span><span>HT</span><span>TVA</span><span>Total</span></div>
      {rows.map(r => (
        <div key={r.key} className={`fin-row ${r.sec ? 'fin-sec' : ''}`}>
          <span className="fin-label">{r.label}</span>
          <span>{finAmount(r.ht)}</span>
          <span>{finAmount(r.tva)}</span>
          <span className={finSign(r.ht + r.tva)}>{finAmount(r.ht + r.tva)}</span>
        </div>
      ))}
    </div>
  );
}

/* @atelier organisme — Le tableau des commandes : date, produit, variante et net ; une ligne se déplie sur tout son détail. */
function FinOrdersTable({ orders, showBiz }){
  const [open, setOpen] = useState(null);
  const n = (v) => Number(v) || 0;
  return (
    <div className="fin-scroll">
      <table className="fin-otable">
        <thead><tr><th>Date</th><th className="fin-txt">Produit</th><th className="fin-txt">Variante</th><th>Net</th></tr></thead>
        <tbody>
          {orders.map(o => {
            const k = o.business + o.commande, isOpen = open === k;
            const ttc = n(o.prix_ht) + n(o.taxe_acheteur);
            return (
              <React.Fragment key={k}>
                <tr className={`fin-orow ${o.statut ? 'fin-cancel' : ''} ${isOpen ? 'open' : ''}`} onClick={()=>setOpen(isOpen ? null : k)}>
                  <td>{String(o.day)}</td>
                  <td className="fin-txt"><span className="fin-clamp">{o.produit || 'Commande'}</span>{showBiz ? <span className="fin-biz">{o.business === 'arro' ? 'Arro' : 'Redline'}</span> : null}</td>
                  <td className="fin-txt fin-muted">{o.variante || '—'}</td>
                  <td className={`fin-strong ${finSign(n(o.net))}`}>{finAmount(n(o.net))}</td>
                </tr>
                {isOpen && (
                  <tr className="fin-odetail"><td colSpan={4}>
                    <div className="fin-kv"><span>Prix TTC payé</span><b>{finMoney(ttc)}</b></div>
                    <div className="fin-kv"><span>Taxe acheteur (reversée)</span><b>{finMoney(-n(o.taxe_acheteur))}</b></div>
                    <div className="fin-kv"><span>Prix HT</span><b>{finMoney(n(o.prix_ht))}</b></div>
                    <div className="fin-kv"><span>Frais Etsy (TVA comprise)</span><b>{finMoney(n(o.frais_etsy))}</b></div>
                    <div className="fin-kv"><span>Production + envoi</span><b>{finMoney(n(o.couts))}</b></div>
                    <div className="fin-kv fin-strong"><span>Net</span><b className={finSign(n(o.net))}>{finMoney(n(o.net))}</b></div>
                    {o.statut && <span className="tc-empty-note">{o.statut}</span>}
                    {/^[0-9]+$/.test(o.commande) && <span className="tc-empty-note">Commande n° {o.commande}</span>}
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* @atelier organisme — Les frais qu’aucun service ne connaît : la liste et le formulaire d’ajout. */
function FinExtraCard({ extra, business, onChange }){
  const [form, setForm] = useState(null);
  const blank = () => ({ business: business === 'all' ? 'redline' : business, day: dayKey(Date.now()), libelle:'', ht:'', tva:'', is_unique:false });
  const save = async () => {
    if (!form.libelle.trim() || form.ht === '') return;
    const { error } = await supabase.from('finance_extra').insert({ business:form.business, day:form.day, libelle:form.libelle.trim(),
      ht:Math.abs(Number(form.ht)), tva:Math.abs(Number(form.tva || 0)), is_unique:form.is_unique, created_at:Date.now() });
    if (error) return alert(error.message);
    setForm(null); onChange();
  };
  const remove = async (id) => {
    if (!confirm('Supprimer ce frais ?')) return;
    const { error } = await supabase.from('finance_extra').delete().eq('id', id);
    if (error) alert(error.message); else onChange();
  };
  return (
    <div className="card fd-card">
      <div className="fin-head">
        <p className="section-label">Frais externes</p>
        {!form && <button type="button" className="period-arch go" onClick={()=>setForm(blank())}>＋ Ajouter</button>}
      </div>
      {form && (
        <div className="fin-form">
          <div className="field spread">
            <label>Business</label>
            <Segmented size="compact">
              {FIN_BUSINESSES.map(b => (
                <button key={b.id} className={form.business===b.id?'on':''} onClick={()=>setForm(f => ({ ...f, business:b.id }))}>{b.label}</button>
              ))}
            </Segmented>
          </div>
          <div className="field spread">
            <label>Libellé</label>
            <input className="fin-input" value={form.libelle} placeholder="Imprimante, nom de domaine…"
              onChange={e=>{ const v = e.target.value; setForm(f => ({ ...f, libelle:v })); }} />
          </div>
          <div className="field spread">
            <label>Date</label>
            <input className="fin-input" type="date" value={form.day} onChange={e=>{ const v = e.target.value; setForm(f => ({ ...f, day:v })); }} />
          </div>
          <NumField label="Montant HT" unit="€" value={form.ht} onChange={v=>setForm(f => ({ ...f, ht:v }))} />
          <NumField label="TVA" unit="€" value={form.tva} onChange={v=>setForm(f => ({ ...f, tva:v }))} placeholder="0" />
          <div className="field spread">
            <label>Type</label>
            <BoolPill value={form.is_unique} onChange={v=>setForm(f => ({ ...f, is_unique:v }))} onLabel="Unique" offLabel="Courant" />
          </div>
          <div className="period-row">
            <button type="button" className="period-arch go" onClick={save}>Enregistrer</button>
            <button type="button" className="period-arch" onClick={()=>setForm(null)}>Annuler</button>
          </div>
        </div>
      )}
      {!extra.length && !form && <span className="tc-empty-note">Aucun pour l’instant : matériel, abonnements, domaine…</span>}
      <div className="fin-orders">
        {extra.map(x => (
          <div key={x.id} className="fin-extra">
            <span className="fin-order-main">
              <span className="fin-order-name">{x.libelle}</span>
              <span className="fin-order-sub">{String(x.day)} · {x.business === 'arro' ? 'Arro' : 'Redline'} · {x.is_unique ? 'unique' : 'courant'}</span>
            </span>
            <span className="fin-neg">{finMoney(-(Number(x.ht) + Number(x.tva)))}</span>
            <button type="button" className="icon-btn sm" aria-label="Supprimer" onClick={()=>remove(x.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* @atelier organisme — Les boutiques reliées : connecter un compte Etsy, relire, dernière lecture. */
function FinShopsCard({ fin }){
  const connect = async (id) => {
    try {
      const { url } = await callFunction('finance', 'start', { body:{ business:id } });
      // Un onglet à part : la page d'Etsy refuse d'être encadrée.
      window.open(url, '_blank', 'noopener');
      fin.setMsg('Autorisez Tracklog dans l’onglet ouvert (connecté au bon compte Etsy), puis revenez et touchez « Vérifier ».');
    } catch (e){ fin.setMsg(String(e.message || e)); }
  };
  const disconnect = async (id) => {
    if (!confirm('Oublier cette boutique ? Les chiffres déjà lus restent.')) return;
    try { await callFunction('finance', 'disconnect', { body:{ business:id } }); fin.refreshStatus(); }
    catch (e){ fin.setMsg(String(e.message || e)); }
  };
  return (
    <div className="card fd-card">
      <div className="fin-head">
        <p className="section-label">Boutiques</p>
        <button type="button" className="period-arch go" disabled={fin.busy} onClick={()=>fin.sync()}>{fin.busy ? 'Lecture…' : 'Actualiser'}</button>
      </div>
      {FIN_BUSINESSES.map(b => {
        const s = fin.status?.[b.id];
        if (b.archived) return (
          <div key={b.id} className="field spread">
            <label>{b.label}</label>
            <span className="tc-empty-note">Arrêté — chiffres importés (Notion + relevés Etsy), plus de lecture.</span>
          </div>
        );
        return (
          <div key={b.id} className="field spread">
            <label>{s?.label || b.label}</label>
            <span className="fin-shop">
              <span className="tc-empty-note">
                {!s ? '…' : s.connected ? `${s.shop || 'Connectée'}${s.syncedAt ? ' · lu ' + shortDate(s.syncedAt) : ''}` : 'Non connectée'}
              </span>
              {s?.connected
                ? <button type="button" className="period-arch" onClick={()=>disconnect(b.id)}>Déconnecter</button>
                : <><button type="button" className="period-arch go" onClick={()=>connect(b.id)}>Connecter</button>
                    <button type="button" className="period-arch" onClick={fin.refreshStatus}>Vérifier</button></>}
            </span>
            {s?.note && <span className="tc-empty-note">{s.note}</span>}
          </div>
        );
      })}
      {fin.msg && <span className="tc-empty-note">{fin.msg}</span>}
    </div>
  );
}
