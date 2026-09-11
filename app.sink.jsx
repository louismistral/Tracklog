/* ============================================================
   app.sink.jsx — la page d'atelier (« kitchen sink »)
   ------------------------------------------------------------
   Une page qui ne montre qu'une chose : le vocabulaire visuel de
   Tracklog, au complet, sur un écran. Chaque brique partagée y est
   rendue pour de vrai — pas décrite, pas capturée en image — dans
   tous ses états, avec le nom sous lequel on l'appelle.

   À quoi ça sert, et pourquoi ce n'est pas une documentation :
     — Changer un style, l'accent, ou une règle CSS partagée touche
       des dizaines d'endroits. Ici on voit d'un coup ce qui a bougé,
       au lieu de visiter six écrans en se souvenant de l'avant.
     — Avant d'inventer un contrôle, on regarde ce qui existe. Les
       formes se dupliquent parce qu'on ne les voit jamais côte à côte :
       trois formulaires avaient chacun leur rangée de champ numérique
       avant de converger sur NumField.
     — Un bout de vocabulaire qui n'a plus sa place ici n'en a plus
       nulle part.

   Pourquoi une route (#sink) et pas un fichier HTML à part, comme le
   font les projets shadcn : la feuille de style entière vit dans le
   <style> de Tracklog.html et les composants ne sont exportés nulle
   part — il n'y a pas de registre à parcourir. Une page séparée
   demanderait une copie du CSS, donc deux vérités qui divergent, ce
   qu'une page d'atelier est précisément censée empêcher. Ouverte
   depuis l'app, elle hérite de tout, gratuitement.

   Ce n'est pas un onglet : ce n'est pas une page de l'app mais une
   page pour celui qui la fabrique. Elle n'écrit rien en base — les
   trackers et les entrées sont fabriqués ici, en mémoire, et les
   cartes sont vraiment utilisables (noter, effacer, régler) pour
   qu'on juge les composants en s'en servant, pas en les regardant.
   ============================================================ */

/* Le jeu de données : déterministe (le même à chaque chargement, sinon
   deux captures ne se comparent pas), couvrant les sept genres de
   tracker et assez long pour que les graphes aient une histoire. */
const SINK_DAYS = 120;
function makeSinkData(){
  // Générateur congruentiel : une graine fixe, donc toujours la même page.
  let x = 20240917;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const today = startOfDay(Date.now());
  const createdAt = today - (SINK_DAYS + 10) * 86400000;
  const mk = (t) => ({ daily:true, createdAt, order:0, ...t });

  const trackers = [
    mk({ id:'sink-num',    name:'Caféine',  type:'number',   unit:'mg', color:COLORS[0],
         daily:false, aggregate:'sum', goodDirection:'down', order:0 }),
    mk({ id:'sink-scale',  name:'Humeur',   type:'scale',    scaleMin:1, scaleMax:5, scaleStep:1,
         color:COLORS[3], order:1 }),
    mk({ id:'sink-bool',   name:'Sport',    type:'boolean',  color:COLORS[2], jokerEnabled:true, order:2 }),
    mk({ id:'sink-dur',    name:'Lecture',  type:'duration', color:COLORS[4], daily:false,
         aggregate:'sum', curveStyle:'bars', order:3 }),
    mk({ id:'sink-choice', name:'Météo',    type:'choice',   choices:['Soleil','Nuages','Pluie'],
         color:COLORS[1], order:4 }),
    mk({ id:'sink-text',   name:'Note',     type:'text',     color:COLORS[5], order:5 }),
    mk({ id:'sink-master', name:'Forme',    type:'master',   color:COLORS[6],
         members:['sink-scale','sink-bool','sink-dur'], order:6 }),
  ];

  const entries = [];
  const at = (d, h) => today - d * 86400000 + h * 3600000;
  const push = (trackerId, ts, value) => entries.push({ id:uid('sk_'), trackerId, value, note:'', ts });

  for (let d = SINK_DAYS; d >= 0; d--){
    // Des trous, et pas les mêmes d'un tracker à l'autre : c'est ce qui fait
    // apparaître les pontillés de pontage et les jours « — » des masters.
    if (rnd() > 0.12) push('sink-scale', at(d, 21), 1 + Math.round(rnd() * 4));
    if (rnd() > 0.25) push('sink-bool',  at(d, 19), rnd() > 0.38);
    if (rnd() > 0.18){
      push('sink-num', at(d, 8), 60 + Math.round(rnd() * 90));
      if (rnd() > 0.55) push('sink-num', at(d, 14), 40 + Math.round(rnd() * 80));
    }
    if (rnd() > 0.4)  push('sink-dur', at(d, 22), 10 + Math.round(rnd() * 65));
    if (rnd() > 0.55) push('sink-choice', at(d, 9), pick(['Soleil','Nuages','Pluie']));
  }
  // Un joker posé quelques jours en arrière : une journée hors calcul, pas un zéro.
  push('sink-bool', at(4, 12), JOKER);
  push('sink-text', at(1, 20), 'Une note un peu longue, écrite pour voir comment la carte respire quand le texte dépasse une ligne.');

  return { trackers, entries };
}

/* Un aliment et un repas de démonstration, pour les briques de Food. */
const SINK_FOOD = {
  ref:    { id:'sink-f1', name:'Blanc de poulet, cuit', source:'ref',    barcode:'ciqual:36018', basis:'g',
            kcal:165, protein:31, carbs:0,  fat:3.6 },
  off:    { id:'sink-f2', name:'Skyr nature',           source:'off',    brand:'Danone', basis:'g',
            kcal:63,  protein:11, carbs:4,  fat:0.2 },
  ai:     { id:'sink-f3', name:'Poke bowl saumon',      source:'ai',     basis:'g',
            kcal:148, protein:9,  carbs:16, fat:5.4 },
  custom: { id:'sink-f4', name:'Mon granola',           source:'custom', basis:'g',
            kcal:432, protein:11, carbs:58, fat:16 },
};

/* Un spécimen : son nom à gauche, la chose elle-même à droite.
   `col` borne la largeur : un formulaire et un nuancier vivent dans une
   colonne étroite partout dans l'app, et les étaler sur toute la page ne
   montrerait pas le composant mais une mise en page qui n'existe nulle part. */
function Spec({ label, code, wide = false, col = false, children }){
  return (
    <div className={`sink-spec ${wide ? 'wide' : ''} ${col ? 'col' : ''}`}>
      <div className="sink-spec-lab">
        <span>{label}</span>
        {code && <code className="mono">{code}</code>}
      </div>
      <div className="sink-spec-body">{children}</div>
    </div>
  );
}

function SinkSection({ id, title, note, children }){
  return (
    <section className="sink-sec" id={`sink-${id}`}>
      <h2 className="sink-h">{title}</h2>
      {note && <p className="sink-note">{note}</p>}
      <div className="card">{children}</div>
    </section>
  );
}

const SINK_SECTIONS = [
  { id:'fondations', label:'Fondations' },
  { id:'couleurs',   label:'Couleurs' },
  { id:'bascules',   label:'Bascules' },
  { id:'boutons',    label:'Boutons' },
  { id:'barres',     label:'Barres' },
  { id:'champs',     label:'Champs' },
  { id:'bulles',     label:'Bulles' },
  { id:'etiquettes', label:'Étiquettes' },
  { id:'cartes',     label:'Cartes' },
  { id:'food',       label:'Food' },
];

const SINK_TOKENS = [
  ['--bg','fond de page'], ['--bg-2','carte'], ['--bg-3','relief'],
  ['--ink','encre'], ['--ink-2','encre secondaire'], ['--ink-3','encre tertiaire'],
  ['--line','filet'], ['--line-2','filet marqué'],
  ['--accent','accent'], ['--accent-2','accent foncé'], ['--accent-soft','accent pâle'],
  ['--warn','alerte'],
];

function SinkView(){
  /* Le style et l'accent sont ici un APERÇU, pas un réglage : les changer
     dans l'atelier ne doit pas reconfigurer l'app de quelqu'un qui voulait
     juste comparer deux fonds. Quitter la page remet ce qui était choisi. */
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || DEFAULT_STYLE);
  const [accent, setAccent] = useState(() => {
    try { return localStorage.getItem('tracklog.accent') || TRACKLOG_ACCENT; } catch(e){ return TRACKLOG_ACCENT; }
  });
  const [infoEnabled, setInfoEnabled] = useState(true);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { window.applyAccent(accent); }, [accent]);
  useEffect(() => () => {
    try {
      const stored = localStorage.getItem('tracklog.theme');
      document.documentElement.dataset.theme = isStyle(stored) ? stored : DEFAULT_STYLE;
      window.applyAccent(localStorage.getItem('tracklog.accent') || '');
    } catch(e){}
  }, []);

  /* Les données de démonstration, vivantes : les cartes écrivent dedans. */
  const seed = useMemo(makeSinkData, []);
  const [trackers, setTrackers] = useState(seed.trackers);
  const [entries, setEntries] = useState(seed.entries);
  const [editEntry, setEditEntry] = useState(null);
  const [editTracker, setEditTracker] = useState(null);

  const byId = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);
  const dataTrackers = useMemo(() => trackers.filter(t => !isMaster(t)), [trackers]);
  const master = byId['sink-master'];
  const today = startOfDay(Date.now());
  const dayEntries = (id) => entries.filter(e => e.trackerId === id && dayKey(e.ts) === dayKey(today));
  const entriesOf = (id) => entries.filter(e => e.trackerId === id);

  // Une entrée quotidienne remplace celle du jour, comme dans l'app — le
  // joker, lui, est un marqueur de journée et ne remplace rien.
  const addEntry = (e) => setEntries(prev => {
    const t = byId[e.trackerId];
    const keep = (x) => !(t && t.daily && x.trackerId === e.trackerId
      && dayKey(x.ts) === dayKey(e.ts) && !isJokerEntry(x) && !isJokerEntry(e));
    return [...prev.filter(keep), { id:uid('sk_'), note:'', ...e }];
  });
  const deleteEntry = (id) => setEntries(prev => prev.filter(e => e.id !== id));
  const saveEntry = (patch) => setEntries(prev => prev.map(e => e.id === editEntry.id ? { ...e, ...patch } : e));
  const saveTracker = (patch) => setTrackers(prev => prev.map(t => t.id === editTracker.id ? { ...t, ...patch } : t));

  const noop = () => {};
  const cardProps = {
    onAddEntry: addEntry, onDeleteEntry: deleteEntry, onEditEntry: setEditEntry,
    dayTs: today, isToday: true, onEditTracker: setEditTracker,
  };

  return (
    <InfoVisibilityContext.Provider value={infoEnabled}>
      <div className="app sink">
        <div className="topbar">
          <div className="brand">
            <span className="mark" />
            <h1>Atelier</h1>
            <span className="by">le vocabulaire de Tracklog</span>
          </div>
          <a className="account-btn" href="#" onClick={()=>{ window.location.hash = ''; }}>← l’app</a>
        </div>

        <div className="sink-bar">
          <Segmented size="small">
            {STYLES.map(s => (
              <button key={s.id} className={theme===s.id?'on':''} onClick={()=>setTheme(s.id)}>{s.label}</button>
            ))}
          </Segmented>
          <div className="sink-bar-accent">
            <span className="sink-bar-lab">Accent</span>
            <SwatchGrid value={accent} onChange={setAccent} />
          </div>
          <div className="sink-bar-accent">
            <span className="sink-bar-lab">Bulles infos</span>
            <BoolPill value={infoEnabled} onChange={setInfoEnabled} />
          </div>
        </div>

        <nav className="sink-nav">
          {SINK_SECTIONS.map(s => <a key={s.id} className="pill" href={`#sink-${s.id}`}>{s.label}</a>)}
        </nav>

        {/* ---- Fondations ------------------------------------------------ */}
        <SinkSection id="fondations" title="Fondations"
          note="Les jetons du thème « Aristide ». Tout le reste de la page n’est que leur assemblage : une couleur écrite en dur ailleurs serait une couleur qui ne suit pas le style.">
          <Spec label="Surfaces et encres" code="var(--…)" wide>
            <div className="sink-toks">
              {SINK_TOKENS.map(([t, label]) => (
                <div key={t} className="sink-tok">
                  <span style={{background:`var(${t})`}} />
                  <span className="sink-tok-txt"><code className="mono">{t}</code><em>{label}</em></span>
                </div>
              ))}
            </div>
          </Spec>
          <Spec label="Titre" code='.serif'>
            <span className="serif" style={{fontSize:28}}>Instrument Serif, italique</span>
          </Spec>
          <Spec label="Intitulé" code='.section-label'>
            <span className="section-label" style={{margin:0}}>Petites capitales interlettrées</span>
          </Spec>
          <Spec label="Courant" code="Geist">
            <span style={{fontSize:14}}>Le corps de texte, en Geist — 14 px.</span>
          </Spec>
          <Spec label="Chiffres" code='.mono'>
            <span className="mono" style={{fontSize:16}}>0123456789 — tabulaires</span>
          </Spec>
          <Spec label="Vide" code='.empty' wide>
            <div className="empty"><span className="em-serif">Rien à afficher.</span></div>
          </Spec>
        </SinkSection>

        {/* ---- Couleurs -------------------------------------------------- */}
        <SinkSection id="couleurs" title="Couleurs"
          note="Dix ronds sur une ligne : sept teintes espacées d’environ 50°, un gris, l’encre du thème, et le « + » qui ouvre l’éditeur. Le même nuancier sert à la couleur d’un tracker et à l’accent de l’app — ce sont les mêmes couleurs.">
          <Spec label="Nuancier" code="SwatchGrid" wide col>
            <SinkSwatchDemo />
          </Spec>
          <Spec label="Éditeur" code="ColorEditor" wide col>
            <SinkColorEditorDemo />
          </Spec>
        </SinkSection>

        {/* ---- Bascules -------------------------------------------------- */}
        <SinkSection id="bascules" title="Bascules"
          note="Segmented est le seul mécanisme de bascule de l’app : un fond qui glisse jusqu’à l’option portant .on. Trois tailles, et deux réponses à « trop d’options pour une ligne » — wrap replie, scrollx glisse."
        >
          <Spec label="Par défaut" code="<Segmented>">
            <SinkSeg options={['Une / jour','Plusieurs / jour']} />
          </Spec>
          <Spec label="Compact" code='size="compact"'>
            <SinkSeg size="compact" options={['Jour','Historique','Chrono']} />
          </Spec>
          <Spec label="Petit" code='size="small"'>
            <SinkSeg size="small" options={['Manuel','A→Z','Récents','Type']} />
          </Spec>
          <Spec label="Replié" code="wrap" wide>
            <SinkSeg size="small" wrap options={['Nombre','Échelle','Oui / Non','Durée','Choix','Texte','Master']} />
          </Spec>
          <Spec label="Glissant" code="scrollx" wide>
            <SinkSeg size="compact" scrollx options={['Graphes','Tendance','Calendrier','Grille','Répartition','Micros']} />
          </Spec>
          <Spec label="Oui / Non" code="BoolPill">
            <SinkBool />
          </Spec>
          <Spec label="Désactivé" code="disabled">
            <BoolPill value={false} onChange={noop} disabled />
          </Spec>
        </SinkSection>

        {/* ---- Boutons --------------------------------------------------- */}
        <SinkSection id="boutons" title="Boutons"
          note="Un accent plein pour l’action principale, une pastille pour un choix, un rond pour une icône seule. .icon-btn porte la forme ; la couleur et le survol restent propres à chaque usage — un survol qui vire au rouge pour une suppression n’a pas à ressembler à un survol neutre.">
          <Spec label="Accent" code=".btn-primary">
            <button className="btn-primary">Enregistrer</button>
            <button className="primary sm">Analyser</button>
          </Spec>
          <Spec label="Pied de modale" code=".modal-actions">
            <div className="modal-actions" style={{margin:0}}>
              <button className="ghost">Annuler</button>
              <button className="primary">Enregistrer</button>
            </div>
          </Spec>
          <Spec label="Désactivé" code=":disabled">
            <div className="save" style={{margin:0}}><button className="primary" disabled>Enregistrer</button></div>
          </Spec>
          <Spec label="Pastilles" code=".pill">
            <button className="pill"><span className="dot" style={{background:COLORS[2]}} />Sport</button>
            <button className="pill active"><span className="dot" style={{background:COLORS[3]}} />Humeur</button>
            <button className="pill dimmed"><span className="dot" style={{background:COLORS[0]}} />Caféine</button>
            <button className="pill add">＋ Nouveau</button>
          </Spec>
          <Spec label="Ronds" code=".icon-btn">
            <button className="icon-btn chart-edit-btn" aria-label="Réglages"><GearIcon size={13} /></button>
            <button className="icon-btn sm" aria-label="Fermer">×</button>
            <button className="icon-btn xs" aria-label="Favori"><StarIcon size={11} filled /></button>
            <button className="icon-btn" disabled aria-label="Indisponible">＋</button>
          </Spec>
          <Spec label="Engrenage" code="GearIcon">
            <button className="gear-btn" aria-label="Paramètres"><GearIcon size={15} /></button>
          </Spec>
          <Spec label="Poignée" code="DragHandle">
            <DragHandle onPointerDown={noop} />
            <DragHandle onPointerDown={noop} dragging />
          </Spec>
          <Spec label="Échelle de périodes" code=".range" wide>
            <SinkRange />
          </Spec>
        </SinkSection>

        {/* ---- Barres ---------------------------------------------------- */}
        <SinkSection id="barres" title="Barres à icône"
          note="L’autre forme partagée : une barre pleine largeur et un bouton rond. Deux formes qui veulent dire deux choses — inset, le bouton est DANS la barre (il ne fait que la remplir autrement) ; detached, le bouton est À CÔTÉ (il agit sur ce que la barre montre).">
          <Spec label="Inset" code="IconBar" wide>
            <IconBar icon={<ScanIcon />} onIcon={noop} iconLabel="Scanner">
              <input placeholder="Un nom, ou un code-barres" />
            </IconBar>
          </Spec>
          <Spec label="Detached" code="detached" wide>
            <SinkIconBarDetached />
          </Spec>
        </SinkSection>

        {/* ---- Champs ---------------------------------------------------- */}
        <SinkSection id="champs" title="Champs"
          note="Une rangée = un intitulé à gauche, le contrôle à droite. Elle ne se replie que quand il n’y a plus la place, jamais par principe. Ce qui se tape porte un trait sous le texte ; ce qui n’est pas modifiable reste du texte nu.">
          <Spec label="Rangées" code=".field" wide col>
            <SinkFields />
          </Spec>
          <Spec label="Numérique" code="NumField" wide col>
            <SinkNumFields />
          </Spec>
          <Spec label="Pastille de saisie" code="NumPill">
            <SinkNumPills />
          </Spec>
          <Spec label="Curseur" code=".scale-slider" wide col>
            <SinkScale />
          </Spec>
        </SinkSection>

        {/* ---- Bulles ---------------------------------------------------- */}
        <SinkSection id="bulles" title="Bulles infos"
          note="Une explication a une seule forme : un « i » qui déplie un cadre DANS le corps de la page, sous ce qu’il explique, en poussant la suite vers le bas. Pas un calque — un calque recouvre justement ce dont il parle. La bascule en haut de page les éteint toutes, sauf celles posées « always ».">
          <Spec label="Sur une rangée" code="InfoBubble" wide col>
            <div className="field spread">
              <label>Joker</label>
              <div className="ctl-with-info">
                <BoolPill value onChange={noop} />
                <InfoBubble title="Joker">
                  Un jour marqué joker est <span className="k">exclu</span> des calculs — ce n’est pas un zéro,
                  c’est une journée qui ne compte pas.
                </InfoBubble>
              </div>
            </div>
          </Spec>
          <Spec label="Toujours visible" code="always" wide col>
            <div className="field spread">
              <label>Sources</label>
              <div className="ctl-with-info">
                <span className="settings-value">Open Food Facts</span>
                <InfoBubble title="Attribution" always>
                  Ce qui n’est pas une explication ne suit pas l’interrupteur : le crédit
                  qu’impose une licence reste là quand les bulles sont éteintes.
                </InfoBubble>
              </div>
            </div>
          </Spec>
        </SinkSection>

        {/* ---- Étiquettes ------------------------------------------------ */}
        <SinkSection id="etiquettes" title="Étiquettes"
          note="De petites pastilles qui nomment, pas des états à cliquer. L’origine d’un item a une largeur fixe — celle du plus long des quatre mots — pour que les icônes qui la suivent tombent au même endroit sur toutes les cartes.">
          <Spec label="Genre" code=".tc-badge">
            <span className="tc-badge">nombre</span>
            <span className="tc-badge on">3 aujourd’hui</span>
            <span className="archive-type">archivé</span>
            <span className="rail-sort-tag">A→Z</span>
          </Spec>
          <Spec label="Master" code=".master-tag">
            <span className="master-tag" style={{marginLeft:0}}>master</span>
            <span className="ms-partial">2/3</span>
          </Spec>
          <Spec label="Semaine" code=".week-tag">
            <span className="week-tag mono" style={{marginLeft:0}}>sem. {isoWeek(Date.now())}</span>
          </Spec>
          <Spec label="Origine d’un item" code="OriginTag">
            {ITEM_ORIGINS.map(o => <OriginTag key={o.id} origin={o} />)}
          </Spec>
        </SinkSection>

        {/* ---- Cartes ---------------------------------------------------- */}
        <SinkSection id="cartes" title="Cartes"
          note="Les composants vivants, sur des données fabriquées ici. Ils sont utilisables : noter une valeur, effacer une entrée, ouvrir un engrenage — rien n’est enregistré, tout se remet à zéro au rechargement. Toutes portent la même convention : le nom en gras teinté à gauche, l’engrenage rond à droite.">
          <Spec label="Remplir le jour" code="DayCard" wide>
            <div className="today-grid">
              {dataTrackers.map(t => (
                <DayCard key={t.id} tracker={t} dayEntries={dayEntries(t.id)} {...cardProps} />
              ))}
            </div>
          </Spec>
          <Spec label="Indice composite" code="MasterStrip" wide>
            <div className="master-strips">
              <MasterStrip master={master} trackerById={byId} entries={entries} dayTs={today} onEdit={setEditTracker} />
            </div>
          </Spec>
          <Spec label="Formes de courbe" code="curveStyle" wide>
            <div className="chart-grid-layout" data-per="3">
              {CURVE_STYLES.map(c => (
                <ChartCard key={c.id} perRow={3} rangeDays={30} onEdit={setEditTracker}
                  tracker={{ ...byId['sink-num'], name:c.label, curveStyle:c.id }}
                  entries={entriesOf('sink-num')} />
              ))}
            </div>
          </Spec>
          <Spec label="Densité" code="perRow" wide>
            <SinkDensity tracker={byId['sink-scale']} entries={entriesOf('sink-scale')} onEdit={setEditTracker} />
          </Spec>
          <Spec label="Carte de master" code="MasterTrackerCard" wide>
            <div className="chart-grid-layout" data-per="1">
              <MasterTrackerCard master={master} trackerById={byId} entries={entries} rangeDays={30} onEdit={setEditTracker} />
            </div>
          </Spec>
          <Spec label="Tendance générale" code="TrendChart" wide>
            <TrendChart trackers={dataTrackers} entries={entries} rangeDays={30} />
          </Spec>
          <Spec label="Heatmap" code="CalendarCard" wide>
            <CalendarCard tracker={byId['sink-bool']} entries={entriesOf('sink-bool')} rangeDays={90} onEdit={setEditTracker} />
          </Spec>
          <Spec label="Grille de KPI" code="GridSummary" wide>
            <GridSummary trackers={dataTrackers} entries={entries} rangeDays={30} onEdit={setEditTracker} />
          </Spec>
          <Spec label="Mois" code="MonthCalendar" wide>
            <SinkMonth entries={entries} />
          </Spec>
        </SinkSection>

        {/* ---- Food ------------------------------------------------------ */}
        <SinkSection id="food" title="Food"
          note="Les quatre chiffres d’un item sur une ligne : les calories calées à gauche, les trois macros en colonnes de largeur fixe. Aucun trait dessiné — c’est l’alignement qui fait le tableau, et la barre de composition découpe les calories, pas les grammes.">
          <Spec label="Colonnes de macros" code="MacroStrip" wide col>
            <MacroStrip n={SINK_FOOD.ref} per="100 g" />
          </Spec>
          <Spec label="Avec composition" code="compBar" wide col>
            <div className="sink-stack">
              {Object.values(SINK_FOOD).map(f => (
                <MacroStrip key={f.id} n={f} per="100 g" compBar />
              ))}
            </div>
          </Spec>
          <Spec label="En grand" code=".fd-macros-wide" wide col>
            <MacroStrip n={SINK_FOOD.custom} per={null} className="fd-macros-wide" />
          </Spec>
        </SinkSection>

        <p className="footer-note">
          Cette page ne lit ni n’écrit rien : ses trackers, ses entrées et ses aliments
          sont fabriqués dans <code className="mono">app.sink.jsx</code>.
        </p>

        {editEntry && (
          <EntryModal entry={editEntry} tracker={byId[editEntry.trackerId]}
            onClose={()=>setEditEntry(null)}
            onSave={(patch)=>{ saveEntry(patch); setEditEntry(null); }}
            onDelete={()=>{ deleteEntry(editEntry.id); setEditEntry(null); }} />
        )}
        {editTracker && (
          <TrackerModal tracker={editTracker} allTrackers={trackers}
            onClose={()=>setEditTracker(null)}
            onSave={(patch)=>{ saveTracker(patch); setEditTracker(null); }}
            onDelete={()=>setEditTracker(null)}
            onArchive={()=>setEditTracker(null)}
            onUnarchive={()=>setEditTracker(null)} />
        )}
      </div>
    </InfoVisibilityContext.Provider>
  );
}

/* ---- Les spécimens qui ont besoin d'un état à eux -------------------------
   Un contrôle figé sur une valeur ne montre que la moitié de ce qu'il fait :
   ce qui se juge dans une bascule, c'est le fond qui glisse. */
/* Les propriétés sont recopiées une à une, et surtout pas ramassées dans un
   `...rest` : Babel traduit un reste d'objet par un `var _excluded = [...]`
   posé à la racine du fichier, donc dans le MÊME global que les deux autres
   scripts. Deux fichiers qui en déclarent un s'écrasent l'un l'autre, et le
   perdant se met à recopier ses propres propriétés sur son <div>. Voir le
   piège « Un reste d'objet… » dans CLAUDE.md. */
function SinkSeg({ options, size, wrap, scrollx }){
  const [v, setV] = useState(options[0]);
  return (
    <Segmented size={size} wrap={wrap} scrollx={scrollx}>
      {options.map(o => <button key={o} className={v===o?'on':''} onClick={()=>setV(o)}>{o}</button>)}
    </Segmented>
  );
}

function SinkBool(){
  const [v, setV] = useState(true);
  return <BoolPill value={v} onChange={setV} />;
}

function SinkSwatchDemo(){
  const [c, setC] = useState(DEFAULT_COLOR);
  return (
    <>
      <SwatchGrid value={c} onChange={setC} />
      <div className="sink-out mono">{c}</div>
    </>
  );
}

function SinkColorEditorDemo(){
  const [c, setC] = useState(TRACKLOG_ACCENT);
  return (
    <>
      <ColorEditor value={c} onChange={setC} />
      <div className="sink-out mono">{c}</div>
    </>
  );
}

function SinkRange(){
  const [r, setR] = useState('30');
  return (
    <div className="range">
      {['7','30','90','365'].map(v => (
        <button key={v} className={r===v?'on':''} onClick={()=>setR(v)}>{v}j</button>
      ))}
      <button className={r==='ytd'?'on':''} onClick={()=>setR('ytd')}>YTD</button>
      <button className={r==='all'?'on':''} onClick={()=>setR('all')}>Tout</button>
    </div>
  );
}

function SinkIconBarDetached(){
  const [tab, setTab] = useState('foods');
  const [fav, setFav] = useState(false);
  return (
    <IconBar detached icon={<StarIcon filled={fav} />} onIcon={()=>setFav(f=>!f)}
             iconOn={fav} iconLabel="Favoris">
      <Segmented size="small">
        <button className={tab==='foods'?'on':''} onClick={()=>setTab('foods')}>Aliments</button>
        <button className={tab==='meals'?'on':''} onClick={()=>setTab('meals')}>Repas</button>
      </Segmented>
    </IconBar>
  );
}

function SinkFields(){
  const [name, setName] = useState('Caféine');
  const [unit, setUnit] = useState('mg');
  const [note, setNote] = useState('');
  const [freq, setFreq] = useState(false);
  return (
    <>
      <div className="field">
        <label>Nom</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Le nom du tracker" />
      </div>
      <div className="field">
        <label>Unité</label>
        <input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="mg, €, pas…" />
        <span className="unit">par prise</span>
      </div>
      <div className="field spread">
        <label>Fréquence</label>
        <div className="ctl-with-info">
          <Segmented size="compact">
            <button className={freq?'':'on'} onClick={()=>setFreq(false)}>Une / jour</button>
            <button className={freq?'on':''} onClick={()=>setFreq(true)}>Plusieurs</button>
          </Segmented>
        </div>
      </div>
      <div className="field">
        <label>Note</label>
        <textarea rows="2" value={note} onChange={e=>setNote(e.target.value)} placeholder="Une note libre" />
      </div>
    </>
  );
}

function SinkNumFields(){
  const [g, setG] = useState({ kcal:'165', protein:'31', carbs:'', fat:'3.6' });
  const set = (k) => (v) => setG(p => ({ ...p, [k]:v }));
  return (
    <>
      <NumField label="Calories" unit="kcal" value={g.kcal} onChange={set('kcal')} />
      <NumField label="Protéines" unit="g" value={g.protein} onChange={set('protein')} />
      <NumField label="Glucides" unit="g" value={g.carbs} onChange={set('carbs')}
        info={<>Un champ vide dit qu’il est vide : rien n’est pré-rempli, sauf quand on <span className="k">corrige</span> une ligne déjà notée.</>} />
      <NumField label="Lipides" unit="g" value={g.fat} onChange={set('fat')} />
    </>
  );
}

function SinkNumPills(){
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('5');
  const [step, setStep] = useState('1');
  return (
    <>
      <NumPill label="Min" value={min} onChange={e=>setMin(e.target.value)} />
      <NumPill label="Max" value={max} onChange={e=>setMax(e.target.value)} />
      <NumPill label="Pas" value={step} onChange={e=>setStep(e.target.value)} unit="par cran" />
    </>
  );
}

function SinkScale(){
  const [v, setV] = useState(3);
  return (
    <div className="scale-slider">
      <input type="range" min="1" max="5" step="1" value={v}
             onChange={e=>setV(parseInt(e.target.value, 10))} aria-label="Humeur" />
      <span className="scale-val mono">{v}<span className="scale-max">/5</span></span>
    </div>
  );
}

/* Le curseur de densité, avec ses cartes derrière : c'est le seul moyen de
   voir qu'un cran de plus ne rétrécit pas la carte mais lui retire du détail. */
function SinkDensity({ tracker, entries, onEdit }){
  const [perRow, setPerRow] = useState(2);
  return (
    <>
      <div className="layout-bar">
        <span className="layout-label">Densité</span>
        <div className="per-row">
          <span className="per-row-end" aria-hidden="true">−</span>
          <input type="range" min="1" max={MAX_PER_ROW} step="1" value={perRow}
                 onChange={e=>setPerRow(parseInt(e.target.value, 10))} aria-label="Cartes par ligne"
                 style={{'--fill': `${((perRow-1)/(MAX_PER_ROW-1))*100}%`}} />
          <span className="per-row-end" aria-hidden="true">+</span>
          <span className="per-row-n mono">{perRow}</span>
        </div>
      </div>
      <div className="chart-grid-layout" data-per={perRow}>
        {Array.from({ length: perRow }, (_, i) => (
          <ChartCard key={i} perRow={perRow} tracker={tracker} entries={entries} rangeDays={30} onEdit={onEdit} />
        ))}
      </div>
    </>
  );
}

function SinkMonth({ entries }){
  const [monthTs, setMonthTs] = useState(() => startOfMonth(Date.now()));
  const [sel, setSel] = useState(() => dayKey(Date.now()));
  return (
    <MonthCalendar monthTs={monthTs} entries={entries} selectedKey={sel} onSelectDay={setSel}
      onPrev={()=>setMonthTs(t => addMonths(t, -1))} onNext={()=>setMonthTs(t => addMonths(t, 1))} />
  );
}
