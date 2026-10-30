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
   connaît : les frais externes (`finance_extra`) et, pour un
   business qui produit lui-même, le coût réel d'une commande
   (`finance_order_costs`).

   Pas de statut TVA : la TVA payée sur les frais est un coût,
   le résultat se lit dans la colonne Total. La taxe de
   l'acheteur entre avec la vente et repart aussitôt (net 0).
   ============================================================ */

const FIN_BUSINESSES = [
  { id:'redline', label:'Redline' },
  { id:'arro',    label:'Arro' },
];
const FIN_SECTIONS = ['Etsy', 'Gelato', 'Production', 'Frais externes', 'Frais uniques'];
const FIN_LINE_ORDER = ['Ventes', 'Taxe acheteur reversée', 'Frais de transaction', 'Frais de paiement',
  'Frais réglementaires', 'Mise en ligne', 'Renouvellement après vente', 'Pub Etsy Ads', 'Pub hors Etsy',
  'Crédit trafic vendeur', 'Production + livraison', 'Impression + emballage', 'Timbre'];
const finEur = new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' });
const finMoney = (v) => finEur.format(v || 0);
// Dans un tableau, le « € » est dans l'en-tête : sans lui à chaque case, quatre colonnes tiennent sur un téléphone.
const finNum = new Intl.NumberFormat('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 });
const finAmount = (v) => finNum.format(Math.abs(v) < 0.005 ? 0 : v);
const finMonth = (m, withYear) => new Intl.DateTimeFormat('fr-FR', { month:'short', ...(withYear ? { year:'2-digit' } : {}), timeZone:'UTC' })
  .format(new Date(m + '-15T00:00:00Z'));
const finSign = (v) => v < 0 ? 'fin-neg' : '';

/* @atelier technique — Les données Finance du compte : lignes, commandes, frais externes, état des boutiques, et la synchro. */
function useFinanceData(){
  const [data, setData] = useState({ lines:[], orders:[], extra:[], costs:[] });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Une table manquante ne bloque jamais l'app : on lit en tolérant l'erreur.
  const load = useCallback(async () => {
    const read = async (q) => { const { data:d, error } = await q; return error ? [] : (d || []); };
    const [lines, orders, extra, costs] = await Promise.all([
      read(supabase.from('finance_lines').select('business,day,section,ligne,commande,ht,tva').limit(20000)),
      read(supabase.from('finance_orders').select('*').limit(5000)),
      read(supabase.from('finance_extra').select('*').order('day', { ascending:false })),
      read(supabase.from('finance_order_costs').select('*')),
    ]);
    setData({ lines, orders, extra, costs });
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
  const [period, setPeriod] = useState('all');
  const [uniques, setUniques] = useState(true);
  const [openOrder, setOpenOrder] = useState(null);

  const inBiz = (r) => business === 'all' || r.business === business;
  // Les frais externes sont des lignes comme les autres, saisies en positif.
  const allLines = useMemo(() => [
    ...fin.lines.map(l => ({ ...l, ht:Number(l.ht), tva:Number(l.tva) })),
    ...fin.extra.map(x => ({ business:x.business, day:x.day, section:x.is_unique ? 'Frais uniques' : 'Frais externes',
                             ligne:x.libelle, commande:null, ht:-Math.abs(Number(x.ht)), tva:-Math.abs(Number(x.tva)) })),
  ], [fin.lines, fin.extra]);

  const months = useMemo(() => [...new Set(allLines.filter(inBiz).map(l => String(l.day).slice(0, 7)))].sort(), [allLines, business]);
  const inPeriod = (day) => period === 'all' || String(day).slice(0, 7) === period;
  const lines = allLines.filter(l => inBiz(l) && inPeriod(l.day) && (uniques || l.section !== 'Frais uniques'));
  const orders = fin.orders.filter(o => inBiz(o) && inPeriod(o.day)).sort((a, b) => String(b.day).localeCompare(String(a.day)));

  const sum = (ls) => ls.reduce((s, l) => s + l.ht + l.tva, 0);
  const ventes = lines.filter(l => l.ligne === 'Ventes').reduce((s, l) => s + l.ht, 0);
  const hors = lines.filter(l => !l.commande);
  const kpi = { ventes, net: sum(lines.filter(l => l.commande)), hors: sum(hors), result: sum(lines) };
  const oneYear = months.length && months[0].slice(0, 4) === months[months.length - 1].slice(0, 4);

  return (
    <div className="fin">
      <div className="log-subnav fin-bar">
        <Segmented size="compact">
          <button className={business==='all'?'on':''} onClick={()=>{ setBusiness('all'); setPeriod('all'); }}>Tout</button>
          {FIN_BUSINESSES.map(b => (
            <button key={b.id} className={business===b.id?'on':''} onClick={()=>{ setBusiness(b.id); setPeriod('all'); }}>{b.label}</button>
          ))}
        </Segmented>
      </div>
      <div className="fin-bar">
        <Segmented size="small" scrollx>
          <button className={period==='all'?'on':''} onClick={()=>setPeriod('all')}>Tout</button>
          {months.map(m => (
            <button key={m} className={period===m?'on':''} onClick={()=>setPeriod(m)}>{finMonth(m, !oneYear)}</button>
          ))}
        </Segmented>
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
        <p className="tc-empty-note fin-note">Prix HT moins frais Etsy (TVA comprise) et coût de production. Pub, mises en ligne et frais externes sont hors commandes.</p>
        {orders.length === 0 && <span className="tc-empty-note">Aucune commande sur cette période.</span>}
        <div className="fin-orders">
          {orders.map(o => (
            <FinOrder key={o.business + o.commande} o={o} showBiz={business==='all'}
              open={openOrder === o.business + o.commande}
              onToggle={()=>setOpenOrder(k => k === o.business + o.commande ? null : o.business + o.commande)}
              cost={fin.costs.find(c => c.business === o.business && c.commande === o.commande)}
              onSaved={()=>fin.sync(o.business)} />
          ))}
        </div>
      </div>

      <div className="card fd-card">
        <p className="section-label">Hors commandes</p>
        <p className="tc-empty-note fin-note">Ce qui se paie même sans vente.</p>
        <FinTable lines={hors} />
      </div>

      <FinExtraCard extra={fin.extra.filter(inBiz)} business={business} onChange={fin.load} />
      <FinShopsCard fin={fin} />
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

/* @atelier molecule — Une commande : produit et net ; dépliée, le détail et, pour un business qui produit lui-même, ses coûts corrigeables. */
function FinOrder({ o, showBiz, open, onToggle, cost, onSaved }){
  const editable = o.business === 'arro' && o.statut !== 'Annulée';
  const [prod, setProd] = useState('');
  const [stamp, setStamp] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setProd(cost?.production ?? ''); setStamp(cost?.postage ?? ''); }, [cost, open]);
  const save = async () => {
    setSaving(true);
    const row = { business:o.business, commande:o.commande,
                  production: prod === '' ? null : Number(prod), postage: stamp === '' ? null : Number(stamp) };
    const { error } = await supabase.from('finance_order_costs').upsert(row);
    if (error) alert(error.message); else await onSaved();
    setSaving(false);
  };
  const d = String(o.day);
  return (
    <div className={`fin-order ${o.statut ? 'fin-cancel' : ''}`}>
      <button type="button" className="fin-order-head" onClick={onToggle}>
        <span className="fin-order-main">
          <span className="fin-order-name">{o.produit || 'Commande'}</span>
          <span className="fin-order-sub">
            {d.slice(8, 10)}/{d.slice(5, 7)} · {o.variante || '—'}{showBiz ? ` · ${o.business === 'arro' ? 'Arro' : 'Redline'}` : ''}{o.statut ? ` · ${o.statut}` : ''}
          </span>
        </span>
        <span className={`fin-order-net ${finSign(Number(o.net))}`}>{finMoney(Number(o.net))}</span>
      </button>
      {open && (
        <div className="fin-order-body">
          <div className="fin-kv"><span>Prix HT</span><b>{finMoney(Number(o.prix_ht))}</b></div>
          <div className="fin-kv"><span>Taxe acheteur (reversée)</span><b>{finMoney(Number(o.taxe_acheteur))}</b></div>
          <div className="fin-kv"><span>Frais Etsy</span><b>{finMoney(Number(o.frais_etsy))}</b></div>
          <div className="fin-kv"><span>{o.business === 'redline' ? 'Gelato' : 'Production + timbre'}</span><b>{finMoney(Number(o.couts))}</b></div>
          <div className="fin-kv fin-strong"><span>Net</span><b className={finSign(Number(o.net))}>{finMoney(Number(o.net))}</b></div>
          <span className="tc-empty-note">Commande n° {o.commande}</span>
          {editable && (
            <div className="fin-edit">
              <NumField label="Production" unit="€" value={prod} onChange={setProd} placeholder="auto" />
              <NumField label="Timbre" unit="€" value={stamp} onChange={setStamp} placeholder="auto" />
              <span className="tc-empty-note">Vide = valeur par défaut selon la taille (10×10 ou 18×18).</span>
              <div className="period-row">
                <button type="button" className="period-arch go" disabled={saving} onClick={save}>{saving ? 'Calcul…' : 'Enregistrer'}</button>
              </div>
            </div>
          )}
        </div>
      )}
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
