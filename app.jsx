/* ============================================================
   app.jsx — l'app elle-même : ses écrans et son montage
   ------------------------------------------------------------
   Ce qui reste une fois sorti le socle (app.core.jsx), les briques
   partagées (app.ui.jsx) et le dessin des données
   (app.charts.jsx) : le composant `App` et son état, les écrans
   (Jour, Historique, Chrono, Vues, Paramètres…), les modales
   d'entrée et de tracker, l'écran de connexion, et `Root` /
   `mountTracklog`.

   Chargé après les trois autres et avant app.food.jsx et
   app.atelier.jsx, qui montent leurs pages dans cet `App`.
   ============================================================ */

/* ============================================================
   App
   ============================================================ */

/* @atelier page — L’app elle-même : l’état partagé, la barre d’onglets, et l’écran affiché. */
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
  // Le thème est lu par un petit script en tête de page, avant même que l'app
  // charge, pour que la page ne clignote jamais dans les mauvaises couleurs — ce
  // script ne peut pas savoir quel compte se connecte, d'où une clé non scopée par
  // utilisateur. Le compte reste la référence : quand il répond, il corrige
  // l'appareil. `document.documentElement.dataset.theme` est ce que lit le CSS.
  const [theme, setTheme] = useSyncedPref(accountPrefs, 'theme', 'tracklog.theme', DEFAULT_THEME, isTheme);
  useEffect(() => {
    try {
      document.documentElement.dataset.theme = theme;
      const meta = document.querySelector('meta[name="theme-color"]');
      const th = THEMES.find(s => s.id === theme);
      if (meta && th) meta.setAttribute('content', th.themeColor);
    } catch {}
  }, [theme]);
  // La couleur d'accent, à côté du thème : le thème choisit le fond et l'encre,
  // l'accent choisit ce qui ressort dessus. Chaîne vide = celle de Tracklog.
  // Même mécanique que le thème, jusqu'au script en tête de page (window.applyAccent)
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
  /* ---- Remplir un tracker depuis son service extérieur ----------------------
     La fonction Edge rend une valeur par jour ; ici on la range en entrées
     ordinaires. C'est ce qui fait qu'un tracker synchronisé se lit, se filtre,
     se moyenne et s'affiche exactement comme un autre : rien en aval ne sait
     d'où vient le chiffre.

     Deux règles qui ne vont pas de soi :
       · Un jour sans vente vaut ZÉRO, pas « rien ». Un trou ferait ponter la
         courbe par-dessus et sortirait le jour des moyennes, alors qu'une
         journée sans commande est une information. On ne remonte cependant pas
         avant le premier jour qui a une valeur — inventer des zéros avant
         l'ouverture de la boutique serait inventer une histoire.
       · On relit quelques jours déjà lus. Une commande peut être remboursée
         après coup ; son jour doit alors se corriger tout seul. */
  const [externalErrors, setExternalErrors] = useState({});
  const syncExternal = async (id, { full = false } = {}) => {
    const t = trackerById[id];
    if (!t?.externalSource) return { written: 0 };
    const now = Date.now();
    const since = full || !t.externalLastSync
      ? Math.max(dayKeyToTs(t.startDate || dayKey(t.createdAt)), now - 400 * 86400000)
      : t.externalLastSync - 3 * 86400000;
    let res;
    try {
      res = await callFunction(t.externalSource, 'sync',
        { body: { metric: t.externalMetric || 'revenue', from: since, to: now } });
    } catch (e){
      setExternalErrors(m => ({ ...m, [id]: String(e.message || e) }));
      throw e;
    }
    setExternalErrors(m => { const { [id]:_, ...rest } = m; return rest; });

    const days = res?.days || {};
    const dks = Object.keys(days).sort();
    if (dks.length){
      // Du premier jour qui a une valeur jusqu'à aujourd'hui, sans trou.
      for (let ts = dayKeyToTs(dks[0]); ts <= now; ts += 86400000){
        const dk = dayKey(ts);
        if (!(dk in days)) days[dk] = 0;
      }
    }
    const mine = entries.filter(e => e.trackerId === id);
    const byDay = {};
    for (const e of mine) byDay[dayKey(e.ts)] = e;
    const fresh = [], fixed = [];
    for (const [dk, value] of Object.entries(days)){
      const existing = byDay[dk];
      if (!existing) fresh.push({ id: uid('e_'), trackerId: id, value, note: '',
                                  ts: dayKeyToTs(dk) + 43200000 }); // midi : aucun fuseau ne le déplace de jour
      else if (existing.value !== value) fixed.push({ ...existing, value });
    }
    if (fresh.length){
      const { error } = await supabase.from('entries').insert(fresh.map(e => entryToRow(e, userId)));
      if (error) throw new Error(error.message);
    }
    for (const e of fixed){
      await supabase.from('entries').update(entryToRow(e, userId)).eq('id', e.id);
    }
    if (fresh.length || fixed.length){
      const fixedById = Object.fromEntries(fixed.map(e => [e.id, e]));
      setEntries(s => [...fresh, ...s.map(e => fixedById[e.id] || e)]);
    }
    await updateTracker(id, { externalLastSync: now });
    return { written: fresh.length + fixed.length, shop: res?.shop };
  };
  // Au chargement, ce qui n'a pas été relu depuis une demi-heure se remet à
  // jour tout seul — un tracker synchronisé qui demande un clic pour être à
  // jour n'est pas synchronisé. L'échec reste rangé dans `externalErrors` et
  // s'affiche dans les réglages du tracker : silencieux ici, jamais perdu.
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (loading || autoSyncedRef.current || !trackers.length) return;
    autoSyncedRef.current = true;
    trackers
      .filter(t => t.externalSource && !t.archived
                && (!t.externalLastSync || Date.now() - t.externalLastSync > 1800000))
      .forEach(t => { syncExternal(t.id).catch(() => {}); });
  }, [loading, trackers]);

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
          onSync={(opts)=>syncExternal(editTracker.id, opts)}
          syncError={externalErrors[editTracker.id] || null}
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
/* ---- Montrer plutôt que décrire ------------------------------------------
   Un réglage d'affichage se juge à l'œil, pas à la phrase : « une barre qui
   découpe les calories » demande de l'imaginer, deux vignettes côte à côte
   répondent en une seconde. Les bulles des réglages d'affichage portent donc
   un avant/après en vrai — même encre, mêmes tokens que ce qu'elles montrent,
   sinon l'exemple ne ressemblerait pas à ce qu'on va obtenir. */
/* @atelier molecule — Deux états côte à côte, « Sans » / « Avec » : un réglage qui se montre mieux qu’il ne se décrit. */
function DemoPair({ off, on, offLabel = 'Sans', onLabel = 'Avec' }){
  return (
    <span className="demo-pair" aria-hidden="true">
      <span className="demo-pane">
        <span className="demo-cap">{offLabel}</span>
        <span className="demo-body">{off}</span>
      </span>
      <span className="demo-pane">
        <span className="demo-cap">{onLabel}</span>
        <span className="demo-body">{on}</span>
      </span>
    </span>
  );
}

/* @atelier page — Les paramètres : compte, thème, accent, onglets, archives, retour. */
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
          Thème
          <InfoBubble title="Thème">
            Le thème suit le compte : choisi sur le téléphone, il s'applique aussi sur
            l'ordinateur. D'autres viendront s'ajouter à cette liste.
          </InfoBubble>
        </p>
        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10}}>
          <div className="theme-picker">
            {THEMES.map(s => (
              <button key={s.id} className={`theme-choice ${theme===s.id?'on':''}`} onClick={()=>onSetTheme(s.id)}>
                <span className="theme-swatch" data-theme-id={s.id} aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span className="theme-name">{s.label}</span>
                <span className="theme-hint">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
        {/* Le thème choisit le fond et l'encre ; l'accent choisit ce qui ressort
            dessus. Le même nuancier que la couleur d'un tracker — ce sont les
            mêmes couleurs, il n'y a pas de raison d'en inventer une seconde
            grille — plus une pastille pour revenir à celle de Tracklog. */}
        <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,borderBottom:'none'}}>
          <label className="lab-info" style={{width:'auto'}}>
            Couleur d'accent
            <InfoBubble title="Couleur d'accent">
              La couleur des boutons, des liens et de tout ce qui doit attirer l'œil.
              La première pastille remet celle de Tracklog. Comme le thème, elle suit le
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
              <DemoPair
                off={<span className="demo-row"><span className="demo-lab">Granularité</span>
                       <span className="demo-pill">Jour</span></span>}
                on={<span className="demo-row"><span className="demo-lab">Granularité</span>
                      <span className="demo-pill">Jour</span>
                      <span className="demo-i">i</span></span>} />
            </InfoBubble>
          </div>
        </div>
        <div className="field spread">
          <label>Numéro de semaine</label>
          <div className="ctl-with-info">
            <BoolPill value={showWeek} onChange={onSetShowWeek} />
            <InfoBubble title="Numéro de semaine">
              À côté de la date du jour, dans le Log et l'Historique.
              <DemoPair
                off={<span className="demo-date">samedi 12 septembre</span>}
                on={<span className="demo-date">samedi 12 septembre <span className="demo-wk">S37</span></span>} />
            </InfoBubble>
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
              {/* Les vraies couleurs des macros, par leurs variables : si vous les
                  changez dans les Vues de Food, l'exemple change avec elles. */}
              <DemoPair
                off={<span className="demo-macros">
                       <b>121</b><span className="demo-mc"><b>26</b><u>P</u></span>
                       <span className="demo-mc"><b>0</b><u>G</u></span>
                       <span className="demo-mc"><b>1.8</b><u>L</u></span>
                     </span>}
                on={<span className="demo-macros">
                      <b>121</b>
                      <span className="demo-mc" style={{color:'var(--macro-protein)'}}><b>26</b></span>
                      <span className="demo-mc" style={{color:'var(--macro-carbs)'}}><b>0</b></span>
                      <span className="demo-mc" style={{color:'var(--macro-fat)'}}><b>1.8</b></span>
                      <span className="demo-comp">
                        <i style={{width:'86%',background:'var(--macro-protein)'}} />
                        <i style={{width:'0%',background:'var(--macro-carbs)'}} />
                        <i style={{width:'14%',background:'var(--macro-fat)'}} />
                      </span>
                    </span>} />
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
/* @atelier organisme — Les onglets de la barre du haut : lesquels s’affichent, dans quel ordre. */
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
   promettre d'y penser plus tard. Le contexte technique (thème,
   taille d'écran, navigateur) part avec le message : c'est
   exactement ce qu'on ne pense jamais à noter et ce qui manque
   toujours pour reproduire un bug.
   ============================================================ */
/* @atelier organisme — Le formulaire de retour, avec le contexte technique capté automatiquement. */
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
        theme: (() => { try { return document.documentElement.dataset.theme || null; } catch { return null; } })(),
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
             : 'Le thème, la taille d’écran et le navigateur partent avec le message.'}
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
/* @atelier page — L’écran Training — à venir. */
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
/* @atelier page — L’écran AI analyst — à venir. */
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
/* @atelier organisme — La barre d’onglets du haut, réordonnable en maintenant un onglet. */
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
   ------------------------------------------------------------
   Ses trois registres — SORTS, GROUPS, SECTION_LABELS — sont dans
   app.core.jsx : des listes de choix, pas un rendu.
   ============================================================ */

/* @atelier organisme — Le rail : une pastille par tracker, plus Filtres, Tri et Grouper. */
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
/* @atelier page — Le Jour : remplir la journée, section par section. */
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
/* @atelier organisme — Un bloc du Jour, réordonnable au même titre qu’une carte. */
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
/* @atelier technique — Le « Tout ajouter » : chaque carte remonte sa sauvegarde, le bouton groupé les déclenche d’un coup. */
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
/* @atelier organisme — La grille de cartes d’une section, avec son glisser-déposer. */
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
/* @atelier organisme — Les cartes du jour, rangées en sections selon le groupement choisi. */
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

/* @atelier organisme — La carte qui remplit une journée — une forme de saisie par genre de tracker. */
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

/* @atelier page — Les chronomètres, en solo ou en parallèle. */
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

/* @atelier organisme — Un chronomètre : son temps, ses boutons, le tracker où il se verse. */
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
/* @atelier modale — Les réglages d’un chronomètre. */
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
          <div style={{fontSize:12,color:'var(--muted-foreground-2)',marginTop:10}}>
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
/* @atelier page — Le Log et ses trois sous-écrans : Jour, Historique, Chrono. */
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
/* @atelier page — L’historique : un jour passé, rouvert et modifiable. */
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
/* @atelier organisme — Le calendrier d’un mois, une pastille par jour rempli. */
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
/* @atelier page — Les vues : graphes, tendance, calendrier, grille. */
function VuesView({ trackers, trackerById, entries, filterIds, onReorder, onEdit, onOpenDay }){
  // Quatre vues à plat, pas trois dont une qui en cache trois autres : les
  // cartes, la tendance, le calendrier et la grille sont quatre façons de
  // regarder les mêmes données, aucune n'est un réglage d'une autre. La barre
  // « Affichage » qui vivait sous « Graphes » a donc disparu, et l'overlay
  // Master avec elle — un master a sa propre carte dans les cartes.
  const [mode, setMode] = useState('chart'); // chart | trend | calendar | summary
  const [rangeMode, setRangeMode] = useState('30'); // '7'|'30'|'90'|'365'|'ytd'|'all'|'custom'
  // Une période personnalisée a deux bornes. Sans la seconde, « personnalisé »
  // ne savait dire que « depuis tel jour, jusqu'à aujourd'hui » — impossible de
  // regarder un mois de l'an dernier. Fin vide = aujourd'hui.
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
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

  /* « Tout » veut dire « toute l'histoire de CE tracker », pas « toute
     l'histoire du plus ancien d'entre eux ». Un tracker né la semaine dernière
     affichait 500 jours de vide parce qu'un voisin en avait 500 — sa courbe
     tenait alors dans le dernier centimètre du cadre. Chaque carte reçoit donc
     sa propre profondeur, calculée sur ses seules entrées.
     Les vues qui mélangent plusieurs trackers dans UN dessin (Tendance) n'ont
     qu'une échelle possible : elles gardent la plus ancienne de toutes. */
  const firstTsById = useMemo(() => {
    const m = {};
    for (const e of entries){
      if (m[e.trackerId] == null || e.ts < m[e.trackerId]) m[e.trackerId] = e.ts;
    }
    return m;
  }, [entries]);
  const earliestTs = useMemo(() => {
    let min = null;
    for (const t of dataVisible){
      const ts = firstTsById[t.id];
      if (ts != null && (min == null || ts < min)) min = ts;
    }
    return min ?? Date.now();
  }, [firstTsById, dataVisible]);

  /* Deux nombres décrivent maintenant une période : jusqu'où on regarde
     (`endTs`, aujourd'hui sauf période personnalisée fermée) et sur combien de
     jours (`range`). Les cartes savaient déjà recevoir une fin — leurs
     fonctions de série portaient un `endTs` optionnel jamais utilisé —, il
     suffisait de la leur donner. */
  const endTs = useMemo(() => {
    if (rangeMode !== 'custom' || !customEnd) return Date.now();
    // Fin de journée : un jour choisi comme borne doit être inclus en entier.
    return dayKeyToTs(customEnd) + 86400000 - 1;
  }, [rangeMode, customEnd]);
  const customRange = useMemo(() => {
    if (!customStart) return 30;
    const days = Math.floor((startOfDay(endTs) - dayKeyToTs(customStart)) / 86400000) + 1;
    return Math.max(1, days);
  }, [customStart, endTs]);

  // Every card still just wants "how many days back from today" — presets,
  // YTD, "Tout" and a custom start date all resolve down to that one number.
  const range = useMemo(() => {
    const daysSince = (ts) => Math.max(1, Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86400000) + 1);
    if (rangeMode === 'ytd'){
      const jan1 = new Date(); jan1.setMonth(0, 1); jan1.setHours(0,0,0,0);
      return daysSince(jan1.getTime());
    }
    if (rangeMode === 'all') return daysSince(earliestTs);
    if (rangeMode === 'custom') return customRange;
    return parseInt(rangeMode, 10);
  }, [rangeMode, customStart, customEnd, earliestTs]);

  // La profondeur d'une carte : la même que tout le monde, sauf en « Tout » où
  // chacune remonte à sa première entrée. Un master prend la plus ancienne de
  // ses membres — c'est de là que son indice peut commencer à se calculer.
  const rangeFor = useCallback((t) => {
    if (rangeMode !== 'all') return range;
    const daysSince = (ts) => Math.max(1, Math.floor((startOfDay(Date.now()) - startOfDay(ts)) / 86400000) + 1);
    const ids = isMaster(t) ? (t.members || []) : [t.id];
    let min = null;
    for (const id of ids){
      const ts = firstTsById[id];
      if (ts != null && (min == null || ts < min)) min = ts;
    }
    return min == null ? 7 : daysSince(min);
  }, [rangeMode, range, firstTsById]);

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
            <>
              <input
                type="date" className="range-custom-date" aria-label="Du"
                value={customStart} max={customEnd || dayKey(Date.now())}
                onChange={e=>setCustomStart(e.target.value)}
              />
              <span className="range-custom-sep">→</span>
              <input
                type="date" className="range-custom-date" aria-label="Au"
                value={customEnd} min={customStart} max={dayKey(Date.now())}
                onChange={e=>setCustomEnd(e.target.value)}
              />
            </>
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
                ? <MasterTrackerCard key={t.id} perRow={perRow} master={t} trackerById={trackerById} entries={entries} rangeDays={rangeFor(t)} endTs={endTs} onEdit={onEdit} {...dragProps} />
                : <ChartCard key={t.id} perRow={perRow} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={rangeFor(t)} endTs={endTs} onEdit={onEdit} onOpenDay={onOpenDay} {...dragProps} />;
            })}
          </div>

          {visibleTrackers.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker.</span></div>}
        </>
      )}
      {mode === 'trend' && (
        <>
          <TrendChart trackers={dataVisible} entries={entries} rangeDays={range} endTs={endTs} />
          {dataVisible.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker à moyenner.</span></div>}
        </>
      )}
      {mode === 'calendar' && (
        <>
          {dataVisible.map(t => (
            <CalendarCard key={t.id} tracker={t} entries={entries.filter(e=>e.trackerId===t.id)} rangeDays={rangeFor(t)} endTs={endTs} onEdit={onEdit} />
          ))}
          {dataVisible.length === 0 && <div className="empty"><span className="em-serif">Pas de tracker à afficher ici.</span></div>}
        </>
      )}
      {mode === 'summary' && (
        <GridSummary trackers={dataVisible} entries={entries} rangeDays={range} endTs={endTs} onEdit={onEdit} />
      )}
    </div>
  );
}


/* ============================================================
   Entry modal (edit an existing entry)
   ============================================================ */
/* @atelier modale — Corriger ou effacer une entrée déjà notée. */
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
/* @atelier modale — Les réglages d’un tracker — la plus grande modale de l’app, réduite à l’affichage avec scope="display". */
function TrackerModal({ tracker, allTrackers = [], onClose, onSave, onDelete, onArchive, onUnarchive, onSync, syncError = null, scope = 'full' }){
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
  // `isCurveStyle`, pas un test à la main : la liste des tracés a grandi
  // (les bâtons sont arrivés après) et ce test ne connaissait que « lissée »,
  // donc rouvrir les réglages d'un tracker en bâtons affichait « polyligne »
  // et le réenregistrait tel quel. Un choix valide se relit de son registre.
  const [curveStyle, setCurveStyle] = useState(isCurveStyle(tracker?.curveStyle) ? tracker.curveStyle : 'line');
  const [chartGrain, setChartGrain] = useState(
    GRAINS.some(g => g.id === tracker?.chartGrain) ? tracker.chartGrain : 'day');
  const [startDate, setStartDate] = useState(tracker?.startDate || dayKey(tracker?.createdAt || Date.now()));
  const [endDate, setEndDate] = useState(tracker?.endDate || '');
  // Le calendrier de la période d'activité — celui de l'Historique (`MonthCalendar`),
  // ouvert en pastille plutôt qu'inventé une seconde fois. `dateField` dit
  // laquelle des deux dates le prochain jour cliqué renseigne.
  const [dateField, setDateField] = useState(null); // 'start' | 'end' | null
  const [calMonth, setCalMonth] = useState(() => startOfMonth(Date.now()));
  const openDateField = (field) => {
    const dk = field === 'start' ? startDate : endDate;
    setCalMonth(startOfMonth(dk ? dayKeyToTs(dk) : Date.now()));
    setDateField(f => f === field ? null : field);
  };
  // — Source extérieure : qui remplit ce tracker à notre place —
  const [externalSource, setExternalSource] = useState(tracker?.externalSource || '');
  const [externalMetric, setExternalMetric] = useState(tracker?.externalMetric || '');
  const [conn, setConn] = useState(null);        // {loading}|{connected,label}|{error}
  const [connBusy, setConnBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [color, setColor] = useState(tracker?.color || DEFAULT_COLOR);
  const nameRef = useRef();

  /* L'état de la connexion se demande au service, pas à la base : les jetons
     vivent dans une table que la page ne peut pas lire (c'est le but), donc
     seule la fonction Edge sait si le compte est relié. */
  const loadStatus = useCallback((service) => {
    if (!service) return;
    setConn({ loading: true });
    callFunction(service, 'status', { method: 'GET' })
      .then(r => setConn(r))
      .catch(e => setConn({ error: String(e.message || e) }));
  }, []);
  useEffect(() => {
    if (!externalSource){ setConn(null); return; }
    loadStatus(externalSource);
  }, [externalSource, loadStatus]);

  const connectService = async () => {
    setConnBusy(true); setSyncMsg('');
    try {
      const { url } = await callFunction(externalSource, 'start', { body: {} });
      // Un onglet à part : la page d'autorisation d'Etsy refuse d'être encadrée,
      // et revenir ici ne doit pas coûter le brouillon en cours.
      window.open(url, '_blank', 'noopener');
      setSyncMsg('Autorisez Tracklog dans l’onglet qui vient de s’ouvrir, puis revenez et touchez « Vérifier ».');
    } catch (e){ setConn({ error: String(e.message || e) }); }
    setConnBusy(false);
  };
  const disconnectService = async () => {
    if (!confirm('Oublier ce compte ? Les entrées déjà enregistrées restent.')) return;
    setConnBusy(true); setSyncMsg('');
    try { await callFunction(externalSource, 'disconnect', { body: {} }); setConn({ connected: false }); }
    catch (e){ setConn({ error: String(e.message || e) }); }
    setConnBusy(false);
  };
  const runSync = async (full) => {
    if (!onSync) return;
    setConnBusy(true); setSyncMsg('Lecture en cours…');
    try {
      const r = await onSync({ full });
      setSyncMsg(r?.written ? `${r.written} jour${r.written > 1 ? 's' : ''} mis à jour.` : 'Rien de nouveau.');
    } catch (e){ setSyncMsg(String(e.message || e)); }
    setConnBusy(false);
  };

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
    // La source extérieure ne vaut que pour un nombre qu'on ne saisit pas —
    // un master calcule déjà, un choix ou un texte n'ont rien à recevoir.
    const wired = !isMasterKind && type === 'number' && !!externalSource;
    t.externalSource = wired ? externalSource : null;
    t.externalMetric = wired ? (externalMetric || serviceById(externalSource).metrics[0].id) : null;
    // Changer de source ou de donnée, c'est changer ce que les jours veulent
    // dire : la prochaine synchro doit tout relire, pas reprendre où elle en
    // était sur l'ancienne mesure.
    if (t.externalSource !== (tracker?.externalSource || null)
     || t.externalMetric !== (tracker?.externalMetric || null)) t.externalLastSync = null;
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

        <div className="field" style={{borderBottom: display ? 'none' : isMasterKind ? '1px solid var(--border)' : undefined}}>
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
            <div className="field" style={{borderBottom: (type==='number'||type==='scale'||type==='choice') ? '1px solid var(--border)' : 'none', flexDirection:'column',alignItems:'stretch',gap:8,paddingTop:14}}>
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

        {/* ============ SOURCE EXTÉRIEURE ============
            Un tracker n'est pas forcément rempli à la main. Le brancher sur un
            service, c'est déléguer la SAISIE — tout le reste (graphe, filtre,
            master, moyennes) continue de le traiter comme n'importe quel
            nombre, et c'est exactement ce qu'on veut : un bénéfice se lit comme
            une caféine. D'où une section de plus ici, et pas un genre de
            tracker à part. */}
        {!display && !isMasterKind && type === 'number' && (
        <div className="card fd-card">
        <p className="section-label">Source</p>

        <div className="field spread" style={{borderBottom: externalSource ? undefined : 'none'}}>
          <label>Remplissage</label>
          <div className="ctl-with-info">
            <Segmented size="compact" scrollx>
              <button className={!externalSource?'on':''} onClick={()=>setExternalSource('')}>À la main</button>
              {EXTERNAL_SERVICES.map(sv => (
                <button key={sv.id} className={externalSource===sv.id?'on':''}
                  onClick={()=>{ setExternalSource(sv.id); if (!externalMetric) setExternalMetric(sv.metrics[0].id); }}>
                  {sv.label}
                </button>
              ))}
            </Segmented>
            <InfoBubble title="Source">
              <span className="k">À la main</span> : vous notez la valeur du jour vous-même.<br/>
              <span className="k">Un service</span> : Tracklog va chercher le chiffre à votre place et
              l’écrit dans la journée correspondante. Les entrées restent des entrées ordinaires —
              corrigeables, et gardées si vous débranchez la source.
            </InfoBubble>
          </div>
        </div>

        {externalSource && (<>
          <div className="field spread">
            <label>Donnée</label>
            <div className="ctl-with-info">
              <Segmented size="compact" scrollx>
                {serviceById(externalSource).metrics.map(m => (
                  <button key={m.id} className={externalMetric===m.id?'on':''}
                    onClick={()=>setExternalMetric(m.id)}>{m.label}</button>
                ))}
              </Segmented>
              <InfoBubble title="Donnée récupérée">
                {serviceById(externalSource).metrics.map(m => (
                  <React.Fragment key={m.id}>
                    <span className="k">{m.label}</span> : {m.hint}<br/>
                  </React.Fragment>
                ))}
                Une journée sans vente vaut <span className="k">zéro</span>, pas « rien » : c’est une
                information, et un trou ferait passer la courbe par-dessus.
              </InfoBubble>
            </div>
          </div>

          <div className="field" style={{flexDirection:'column',alignItems:'stretch',gap:10,borderBottom:'none',paddingTop:14}}>
            <label style={{width:'auto'}}>Compte</label>
            <span className="tc-empty-note">
              {conn?.loading ? 'Vérification…'
               : conn?.error ? conn.error
               : conn?.connected ? `Connecté${conn.label ? ' — ' + conn.label : ''}.`
               : 'Aucun compte relié pour l’instant.'}
            </span>
            <div className="period-row">
              {conn?.connected ? (
                <>
                  <button type="button" className="period-arch go" disabled={connBusy}
                    onClick={()=>runSync(false)}>Synchroniser</button>
                  <button type="button" className="period-arch go" disabled={connBusy}
                    onClick={()=>runSync(true)}>Tout relire</button>
                  <button type="button" className="period-arch" disabled={connBusy}
                    onClick={disconnectService}>Déconnecter</button>
                </>
              ) : (
                <>
                  <button type="button" className="period-arch go" disabled={connBusy}
                    onClick={connectService}>Connecter mon compte</button>
                  <button type="button" className="period-arch go" disabled={connBusy}
                    onClick={()=>loadStatus(externalSource)}>Vérifier</button>
                </>
              )}
            </div>
            {(syncMsg || syncError) && <span className="tc-empty-note">{syncMsg || syncError}</span>}
            {tracker?.externalLastSync && (
              <span className="tc-empty-note">Dernière lecture : {shortDate(tracker.externalLastSync)}.</span>
            )}
            {!isEdit && (
              <span className="tc-empty-note">Créez le tracker : la première lecture se fera juste après.</span>
            )}
          </div>
        </>)}

        </div>)}

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
/* @atelier page — La connexion. */
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
        <p style={{fontSize:13,color:'var(--muted-foreground-2)',marginTop:6,marginBottom:6}}>
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
        {err && <div style={{color:'var(--destructive)', fontSize:12, marginTop:10}}>{err}</div>}
        {info && <div style={{color:'var(--primary)', fontSize:12, marginTop:10}}>{info}</div>}
        <div className="save">
          <span className="hint">
            {mode==='signin' && <button style={{fontSize:12,color:'var(--muted-foreground-2)'}} onClick={forgot}>Mot de passe oublié ?</button>}
          </span>
          <button className="primary" disabled={!canSubmit || busy} onClick={submit}>
            {busy ? '…' : (mode==='signup' ? 'Créer' : 'Se connecter')}
          </button>
        </div>
        <hr className="thin" />
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12,color:'var(--muted-foreground-2)'}}>
          {mode==='signup' ? (
            <button style={{fontSize:12,color:'var(--muted-foreground)'}} onClick={()=>{setMode('signin');setErr('');setInfo('');}}>← J'ai déjà un compte</button>
          ) : (
            <button style={{fontSize:12,color:'var(--muted-foreground)'}} onClick={()=>{setMode('signup');setErr('');setInfo('');}}>Créer un compte</button>
          )}
          <button style={{fontSize:12,color:'var(--muted-foreground-2)'}} onClick={magicLink}>Recevoir un lien par e-mail</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Set / change password (used while logged in and after reset link)
   ============================================================ */
/* @atelier modale — Changer de mot de passe, y compris après un lien de réinitialisation. */
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
            <p style={{fontSize:13,color:'var(--primary)',margin:'10px 0 0'}}>Mot de passe enregistré ✓</p>
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
            {err && <div style={{color:'var(--destructive)', fontSize:12, marginTop:10}}>{err}</div>}
            {password && confirm && password !== confirm && <div style={{color:'var(--destructive)', fontSize:12, marginTop:10}}>Les mots de passe ne correspondent pas.</div>}
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

/* L'atelier (app.atelier.jsx) vit à une adresse plutôt que dans un onglet : ce
   n'est pas une page de l'app mais une page pour celui qui la fabrique, et
   elle n'a besoin ni de compte ni de données. Le test est exact — le lien de
   réinitialisation de mot de passe arrive lui aussi par le hash.
   `#sink` reste accepté : c'était son adresse, et un lien posé quelque part ne
   doit pas tomber dans le vide parce qu'on a changé le mot.

   Les ancres internes de l'atelier (`#atelier-fam-jeton`) comptent pour
   l'atelier, et c'est toute la raison de leur préfixe : un sommaire qui change
   le hash sortait de la page qu'il servait à parcourir, et cliquer « Jetons »
   renvoyait à l'app. */
const ATELIER_HASHES = ['#atelier', '#sink'];
const isAtelierHash = () => {
  const h = window.location.hash || '';
  return ATELIER_HASHES.some(a => h === a || h.indexOf(a + '-') === 0);
};

/* @atelier technique — Le routeur : atelier, récupération de mot de passe, connexion, ou app. */
function Root(){
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [recovery, setRecovery] = useState(false);   // arrived via password-reset link
  // Taper #atelier dans la barre d'adresse ne recharge pas la page : sans
  // écouter le changement de hash, l'atelier ne s'ouvrirait qu'au rechargement.
  const [atelier, setAtelier] = useState(isAtelierHash);
  useEffect(() => {
    const onHash = () => setAtelier(isAtelierHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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

  // Avant l'attente de session : l'atelier ne montre que des composants, il
  // n'a rien à attendre de la base.
  if (atelier) return <AtelierView />;
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
