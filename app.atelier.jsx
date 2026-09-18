/* ============================================================
   app.atelier.jsx — l'atelier, page #atelier
   ------------------------------------------------------------
   Une vitrine de tout ce qui compose l'interface de Tracklog :
   les jetons du thème, les classes de la feuille de style, et
   les composants eux-mêmes, rendus pour de vrai, dans tous
   leurs états, sous n'importe lequel des thèmes.

   TROIS PROPRIÉTÉS, ET COMMENT ELLES TIENNENT
   ------------------------------------------------------------
   1. Non divergent. L'atelier n'a pas de copie : il monte les
      composants de l'app et charge la même feuille de style.
      C'est pour ça qu'il vit à une ADRESSE (#atelier) et pas
      dans un fichier HTML à part — une page séparée voudrait
      dire un second CSS, donc deux vérités qui divergent, ce
      qu'une vitrine est précisément censée empêcher.

   2. Exhaustif, sans liste écrite à la main. L'atelier RELIT
      ses propres sources à l'exécution : `fetch` sur les cinq
      .jsx et sur styles.css, puis lecture. Il n'y a pas de
      build, donc les fichiers sont servis tels quels — ce que
      le navigateur lit, l'atelier le lit aussi.
        · Composants — toute déclaration `function <Majuscule>`,
          `function use<Majuscule>` ou `const <Majuscule> =` de
          l'app est trouvée, qu'on y ait pensé ou non.
        · Jetons — toute variable `--…` déclarée dans styles.css
          ou posée en JS par `setProperty`.
        · Classes — tout sélecteur `.…` de la feuille.

   3. L'oubli est visible. Un composant se présente par une
      ligne `@atelier <famille> — <description>` posée au-dessus
      de lui, DANS SON FICHIER. Celui qui n'en a pas n'est pas
      absent de l'atelier : il s'affiche en tête, dans « Non
      déclarés », avec son fichier et sa ligne. Idem pour les
      classes de styles.css que l'atelier ne rend nulle part.
      Rien ne disparaît en silence ; le trou se montre.

   Pourquoi la description vit dans le fichier du composant et
   pas ici : écrite ici, elle serait une seconde description à
   tenir à jour, et c'est toujours la copie qui pourrit. Collée
   au composant, elle se déplace avec lui, se relit quand on le
   modifie, et meurt quand il meurt.

   Le chrome de l'atelier (ses fiches, ses en-têtes, ses menus)
   est délibérément différent de celui de l'app : on doit voir
   d'un coup d'œil ce qui est la marchandise et ce qui est
   l'étagère. D'où le préfixe `.at-`, et le seul `<select>` du
   projet.
   ============================================================ */

/* ---- Ce que l'atelier s'inspecte ------------------------------------------
   Les cinq fichiers de l'app, dans l'ordre de chargement. `app.atelier.jsx`
   n'y est pas : ses composants à lui sont l'étagère, pas la marchandise. */
const ATELIER_SOURCES = ['app.core.jsx', 'app.ui.jsx', 'app.charts.jsx', 'app.jsx', 'app.food.jsx'];

/* Les familles, dans l'ordre où on les traverse. « Atomic Design », avec deux
   ajouts que l'app impose : une modale n'est pas un organisme comme un autre
   (elle se superpose au lieu de se poser), et « technique » range ce qui ne se
   dessine pas — hooks, contextes, montages impératifs. */
const ATELIER_FAMILIES = [
  { id:'jeton',     label:'Jetons',
    note:"Les variables CSS. Tout le reste n'en est qu'un assemblage : une couleur écrite en dur ailleurs serait une couleur qui ne suit pas le thème." },
  { id:'atome',     label:'Atomes',
    note:"Ce qui ne se découpe plus : un glyphe, une bascule, une pastille. Aucun n'a de sens seul, aucun n'en perd en changeant de page." },
  { id:'molecule',  label:'Molécules',
    note:"Deux ou trois atomes qui forment un geste : un intitulé et son champ, une barre et son bouton, un « i » et son cadre." },
  { id:'organisme', label:'Organismes',
    note:"Un bloc qui se tient tout seul, avec ses données et sa logique — une carte, une grille, un rail." },
  { id:'modale',    label:'Modales',
    note:"Ce qui se superpose : une tâche qu'on ouvre, qu'on finit, et qu'on ferme. Toutes se rendent ici pour de vrai." },
  { id:'page',      label:'Pages',
    note:"Les écrans complets. Ils demandent un compte et des données : l'atelier les nomme et les décrit, il ne les monte pas." },
  { id:'technique', label:'Technique',
    note:"Ce qui n'a pas de forme : hooks, contextes, montages impératifs. Présents parce qu'ils font partie du vocabulaire, sans spécimen à regarder." },
  { id:'classe',    label:'Classes',
    note:"Les sélecteurs de styles.css, et lesquels l'atelier rend réellement. Une classe jamais rendue ici est soit un manque de cette page, soit du CSS mort." },
];

/* ---- Lire une source ------------------------------------------------------
   Deux formes seulement, cherchées en début de ligne :
     · l'annotation  `@atelier <famille> — <description>`
     · la déclaration d'un composant, d'un hook ou d'un contexte
   L'annotation vaut pour la PREMIÈRE déclaration qui la suit ; une déclaration
   sans annotation au-dessus est un oubli, et c'est ce qu'on veut voir.

   Ce qui doit être annoté est volontairement étroit — une fonction à nom
   majuscule, un hook, un `const X = (` ou un contexte. Les registres
   (`const COLORS = [`) et les constantes n'ont rien à déclarer, et les faire
   apparaître en « oubli » aurait noyé les vrais. */
const AT_ANNOT = /@atelier\s+([a-zé]+)\s*[—–-]\s*(.+?)\s*(?:\*\/)?\s*$/;
const AT_DECL = /^(?:function\s+(use[A-Z]\w*|[A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*=\s*(?:\(|React\.createContext))/;
/* `FOOD_CHART_ID`, `COLORS`, `JOKER` : un nom tout en capitales est une
   constante, jamais un composant. Sans ce filtre, chaque registre du socle
   serait venu grossir la liste des oublis, et les vrais s'y seraient noyés. */
const AT_SHOUTED = /^[A-Z0-9_]+$/;

function parseAtelierSource(file, text){
  const lines = text.split('\n');
  const out = [];
  let pending = null;
  for (let i = 0; i < lines.length; i++){
    const a = lines[i].match(AT_ANNOT);
    if (a){ pending = { family:a[1], desc:a[2] }; continue; }
    const d = lines[i].match(AT_DECL);
    if (!d) continue;
    const name = d[1] || d[2];
    if (AT_SHOUTED.test(name)){ pending = null; continue; }
    out.push({
      name, file, line: i + 1,
      family: pending ? pending.family : null,
      desc: pending ? pending.desc : null,
    });
    pending = null;
  }
  return out;
}

/* Les jetons : tout `--nom:` déclaré dans styles.css, plus ceux que le JS pose
   lui-même (`setProperty('--mc-protein', …)` pour les couleurs des macros) —
   sans quoi la liste mentirait par omission sur une famille entière. */
function parseTokens(css, jsSources){
  const seen = new Set();
  const order = [];
  /* Les commentaires sont retirés d'abord : le `:root{}` de styles.css
     EXPLIQUE `background:var(--ink);color:var(--bg)` en prose, et deux jetons
     fantômes se seraient invités dans la liste au premier passage. Un nom qui
     s'arrête sur un tiret vient d'un nom calculé (`--macro-${key}`) : c'est le
     préfixe, pas un jeton. */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const push = (name) => {
    if (name.endsWith('-') || seen.has(name)) return;
    seen.add(name); order.push(name);
  };
  const cleanCss = strip(css);
  const cleanJs = jsSources.map(strip);
  const decl = /(--[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = decl.exec(cleanCss))) push(m[1]);
  const js = /setProperty\(\s*[`'"](--[a-z0-9-]+)/gi;
  for (const src of cleanJs){ while ((m = js.exec(src))) push(m[1]); }
  /* Et ceux qu'on ne trouve que par leur USAGE : `--macro-protein` est posé en
     JS sous un nom calculé (`--macro-${key}`), donc aucune déclaration ne le
     nomme — seul le `var(--macro-protein)` du registre des macros le dit. */
  const used = /var\(\s*(--[a-z0-9-]+)/gi;
  while ((m = used.exec(cleanCss))) push(m[1]);
  for (const src of cleanJs){ while ((m = used.exec(src))) push(m[1]); }
  return order;
}

/* Les classes : ce qui ressemble à `.nom` dans une position de sélecteur,
   c'est-à-dire avant l'accolade d'une règle. Les blocs de déclarations sont
   sautés pour ne pas ramasser un `.5` de nombre décimal ou une valeur. */
function parseClasses(css){
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const seen = new Set();
  let depth = 0, buf = '';
  for (let i = 0; i < noComments.length; i++){
    const ch = noComments[i];
    if (ch === '{'){
      if (depth === 0){
        const cls = buf.match(/\.(-?[A-Za-z_][\w-]*)/g) || [];
        cls.forEach(c => seen.add(c.slice(1)));
      }
      depth++; buf = '';
    } else if (ch === '}'){
      depth = Math.max(0, depth - 1); buf = '';
    } else if (depth === 0){
      buf += ch;
    }
  }
  return [...seen].sort();
}

/* Le chargement : cinq sources, une feuille, tout en parallèle. En échec —
   ouvert depuis le disque en `file://`, où `fetch` refuse — l'atelier le dit
   plutôt que de se montrer vide et d'avoir l'air en panne. */
function useAtelierSources(){
  const [state, setState] = useState({ ready:false, error:null, components:[], tokens:[], classes:[] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const texts = await Promise.all(
          [...ATELIER_SOURCES, 'styles.css'].map(f =>
            fetch(`${f}?atelier=${Date.now()}`).then(r => {
              if (!r.ok) throw new Error(`${f} — ${r.status}`);
              return r.text();
            })
          )
        );
        if (cancelled) return;
        const css = texts[texts.length - 1];
        const jsSources = texts.slice(0, -1);
        const components = [];
        ATELIER_SOURCES.forEach((f, i) => components.push(...parseAtelierSource(f, jsSources[i])));
        setState({ ready:true, error:null, components,
                   tokens: parseTokens(css, jsSources), classes: parseClasses(css) });
      } catch(e){
        if (!cancelled) setState({ ready:true, error:e.message || String(e), components:[], tokens:[], classes:[] });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

/* ---- Le cadre à thème -----------------------------------------------------
   Poser `data-theme` sur un div suffit à repeindre ce qu'il contient : les
   thèmes s'accrochent à `[data-theme]` et non à `:root[data-theme]` (voir
   styles.css). L'accent, lui, est posé en ligne sur <html> par `applyAccent` —
   une déclaration de thème plus profonde l'écraserait, donc on le recopie sur
   le cadre pour que la couleur choisie vaille aussi dans les aperçus. */
function ThemeFrame({ theme, accent, label, children }){
  const vars = {};
  if (accent){
    vars['--primary'] = accent;
    vars['--primary-hover'] = `color-mix(in oklab, ${accent} 84%, #000)`;
    vars['--primary-soft'] = `color-mix(in srgb, ${accent} 14%, transparent)`;
  }
  return (
    <div className="at-frame" data-theme={theme} style={vars}>
      {label && <span className="at-frame-lab">{label}</span>}
      <div className="at-frame-in">{children}</div>
    </div>
  );
}

/* Le sélecteur de thème d'une fiche. « Global » n'est pas un thème : c'est
   l'absence de choix, et une fiche qui n'a rien choisi suit la barre du haut —
   changer le thème en tête doit repeindre la page entière, sinon le réglage
   global ne servirait qu'aux fiches qu'on n'a pas touchées. */
function ThemeSelect({ value, onChange, withAll = false }){
  return (
    <select className="at-sel" value={value} onChange={e=>onChange(e.target.value)} aria-label="Thème">
      <option value="">Global</option>
      {withAll && <option value="all">Tous</option>}
      {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
    </select>
  );
}

/* ---- La fiche d'un élément ------------------------------------------------
   Nom, famille, description tirée de la source, où il vit, son sélecteur de
   thème — puis la chose elle-même, ses variantes côte à côte dans le même
   cadre : c'est en les voyant l'une à côté de l'autre qu'on voit ce qui les
   sépare, et c'est la seule raison d'être de cette page. */
function SpecCard({ entry, variants, themes, accent }){
  const [own, setOwn] = useState('');
  const shown = own ? (own === 'all' ? THEMES.map(t => t.id) : [own]) : themes;
  const many = shown.length > 1;
  return (
    <article className={`at-card ${variants ? '' : 'bare'}`} id={`at-${entry.name}`}>
      <header className="at-card-h">
        <div className="at-card-id">
          <code className="mono at-name">{entry.name}</code>
          <span className="at-fam">{entry.family}</span>
        </div>
        {variants && <ThemeSelect value={own} onChange={setOwn} withAll />}
      </header>
      {entry.desc && <p className="at-desc">{entry.desc}</p>}
      <p className="at-src mono">{entry.file}:{entry.line}</p>
      {variants ? (
        <div className={`at-frames ${many ? 'multi' : ''}`}>
          {shown.map(th => (
            <ThemeFrame key={th} theme={th} accent={accent} label={many ? themeLabel(th) : null}>
              <div className="at-vars">
                {variants.map((v, i) => (
                  <div className={`at-var ${v.wide ? 'wide' : ''} ${v.col ? 'col' : ''}`} key={i}>
                    {(v.label || v.code) && (
                      <div className="at-var-h">
                        {v.label && <span>{v.label}</span>}
                        {v.code && <code className="mono">{v.code}</code>}
                      </div>
                    )}
                    <div className="at-var-b">{v.node}</div>
                  </div>
                ))}
              </div>
            </ThemeFrame>
          ))}
        </div>
      ) : (
        <p className="at-nospec">
          Pas de spécimen : {entry.family === 'page'
            ? "un écran complet, qui demande un compte et des données."
            : entry.family === 'technique'
              ? "rien à dessiner."
              : "à monter ici dès qu'on saura lui fabriquer ses données."}
        </p>
      )}
    </article>
  );
}

const themeLabel = (id) => (THEMES.find(t => t.id === id) || {}).label || id;

/* Les familles qui tiennent à plusieurs par ligne : les atomes parce qu'ils
   sont petits, les pages et la technique parce qu'elles n'ont rien à montrer —
   treize fiches sans spécimen en pleine largeur, c'est treize écrans de vide. */
const AT_DENSE = { atome:true, page:true, technique:true };

/* ---- Les données de démonstration -----------------------------------------
   Déterministes : la même page à chaque chargement, sinon deux captures ne se
   comparent pas. Sept genres de tracker, 120 jours, des trous — un jeu qui
   fait apparaître les pontillés de pontage et les jours « — » des masters. */
const AT_DAYS = 120;
function makeAtelierData(){
  let x = 20240917;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const today = startOfDay(Date.now());
  const createdAt = today - (AT_DAYS + 10) * 86400000;
  const mk = (t) => ({ daily:true, createdAt, order:0, ...t });

  const trackers = [
    mk({ id:'at-num',    name:'Caféine',  type:'number',   unit:'mg', color:COLORS[0],
         daily:false, aggregate:'sum', goodDirection:'down', order:0 }),
    mk({ id:'at-scale',  name:'Humeur',   type:'scale',    scaleMin:1, scaleMax:5, scaleStep:1,
         color:COLORS[3], order:1 }),
    mk({ id:'at-bool',   name:'Sport',    type:'boolean',  color:COLORS[2], jokerEnabled:true, order:2 }),
    mk({ id:'at-dur',    name:'Lecture',  type:'duration', color:COLORS[4], daily:false,
         aggregate:'sum', curveStyle:'bars', order:3 }),
    mk({ id:'at-choice', name:'Météo',    type:'choice',   choices:['Soleil','Nuages','Pluie'],
         color:COLORS[1], order:4 }),
    mk({ id:'at-text',   name:'Note',     type:'text',     color:COLORS[5], order:5 }),
    mk({ id:'at-master', name:'Forme',    type:'master',   color:COLORS[6],
         members:['at-scale','at-bool','at-dur'], order:6 }),
  ];

  const entries = [];
  const at = (d, h) => today - d * 86400000 + h * 3600000;
  const push = (trackerId, ts, value) => entries.push({ id:uid('at_'), trackerId, value, note:'', ts });

  for (let d = AT_DAYS; d >= 0; d--){
    if (rnd() > 0.12) push('at-scale', at(d, 21), 1 + Math.round(rnd() * 4));
    if (rnd() > 0.25) push('at-bool',  at(d, 19), rnd() > 0.38);
    if (rnd() > 0.18){
      push('at-num', at(d, 8), 60 + Math.round(rnd() * 90));
      if (rnd() > 0.55) push('at-num', at(d, 14), 40 + Math.round(rnd() * 80));
    }
    if (rnd() > 0.4)  push('at-dur', at(d, 22), 10 + Math.round(rnd() * 65));
    if (rnd() > 0.55) push('at-choice', at(d, 9), pick(['Soleil','Nuages','Pluie']));
  }
  push('at-bool', at(4, 12), JOKER);
  push('at-text', at(1, 20), 'Une note un peu longue, écrite pour voir comment la carte respire quand le texte dépasse une ligne.');

  // Les journées alimentaires, dans la forme exacte que rend `useFoodDays`.
  const days = [];
  for (let i = 59; i >= 0; i--){
    const ts = today - i * 86400000;
    const logged = rnd() > 0.15;
    days.push({ dk: dayKey(ts), ts, logged,
      totals: logged ? {
        kcal: 1600 + Math.round(rnd() * 900), protein: 90 + Math.round(rnd() * 70),
        carbs: 140 + Math.round(rnd() * 130), fat: 50 + Math.round(rnd() * 45),
        fiber: 12 + Math.round(rnd() * 14), sodium: 1.2 + rnd() * 2,
        calcium: 500 + Math.round(rnd() * 600), iron: 8 + Math.round(rnd() * 9),
        vitc: 40 + Math.round(rnd() * 90),
      } : {} });
  }

  return { trackers, entries, days };
}

/* Quatre items, un par origine : c'est la seule façon de voir que les quatre
   pastilles ont bien la même largeur, donc que les icônes qui les suivent
   tombent au même endroit. */
const AT_FOOD = {
  ref:    { id:'at-f1', name:'Blanc de poulet, cuit', source:'ref',    barcode:'ciqual:36018', basis:'g',
            nutriments:{ kcal:165, protein:31, carbs:0,  fat:3.6 }, kcal:165, protein:31, carbs:0,  fat:3.6 },
  off:    { id:'at-f2', name:'Skyr nature',           source:'off',    brand:'Danone', basis:'g',
            nutriments:{ kcal:63,  protein:11, carbs:4,  fat:0.2 }, kcal:63,  protein:11, carbs:4,  fat:0.2 },
  ai:     { id:'at-f3', name:'Poke bowl saumon',      source:'ai',     basis:'g',
            nutriments:{ kcal:148, protein:9,  carbs:16, fat:5.4 }, kcal:148, protein:9,  carbs:16, fat:5.4 },
  custom: { id:'at-f4', name:'Mon granola',           source:'custom', basis:'g',
            nutriments:{ kcal:432, protein:11, carbs:58, fat:16 },  kcal:432, protein:11, carbs:58, fat:16 },
};

const AT_LOGS = [
  { id:'at-l1', name:'Blanc de poulet, cuit', qty:180, unit:'g', meal:'midi',
    nutriments:{ kcal:297, protein:56, carbs:0, fat:6.5 } },
  { id:'at-l2', name:'Skyr nature', brand:'Danone', qty:150, unit:'g', meal:'matin',
    nutriments:{ kcal:95, protein:16.5, carbs:6, fat:0.3 } },
  { id:'at-l3', name:'Café', qty:1, unit:UNIT_NONE, meal:'matin',
    nutriments:{ kcal:2, protein:0.2, carbs:0, fat:0 } },
];

const AT_MICRO_TOTALS = { fiber:26, sodium:2.4, sugars:48, satFat:14,
                          calcium:820, iron:13, magnesium:310, vitc:95 };

/* ---- Le registre des spécimens --------------------------------------------
   Une entrée par composant : ses variantes, dans l'ordre où on veut les
   comparer. Ce registre ne dit PAS ce qui existe — c'est la source qui le dit.
   Il dit seulement comment montrer ce qui existe ; un composant qui n'y figure
   pas s'affiche quand même, en fiche sans spécimen. */
const V = (label, node, code, opts) => ({ label, node, code, ...(opts || {}) });

function atelierSpecimens(c){
  const t = c.byId;
  const noop = () => {};
  const cardProps = {
    onAddEntry: c.addEntry, onDeleteEntry: c.deleteEntry, onEditEntry: c.setEditEntry,
    dayTs: c.today, isToday: true, onEditTracker: c.setEditTracker,
  };
  return {
    /* ---- Atomes ---- */
    GearIcon: [
      V('13 px', <button className="icon-btn chart-edit-btn" aria-label="Réglages"><GearIcon size={13} /></button>, 'dans .icon-btn'),
      V('15 px', <button className="gear-btn" aria-label="Paramètres"><GearIcon size={15} /></button>, '.gear-btn'),
      V('Nu', <GearIcon size={22} />, '<GearIcon size={22} />'),
    ],
    Segmented: [
      V('Par défaut', <AtSeg options={['Une / jour','Plusieurs / jour']} />, '<Segmented>'),
      V('Compact', <AtSeg size="compact" options={['Jour','Historique','Chrono']} />, 'size="compact"'),
      V('Petit', <AtSeg size="small" options={['Manuel','A→Z','Récents','Type']} />, 'size="small"'),
      V('Replié', <AtSeg size="small" wrap options={['Nombre','Échelle','Oui / Non','Durée','Choix','Texte','Master']} />, 'wrap', { wide:true }),
      V('Glissant', <AtSeg size="compact" scrollx options={['Graphes','Tendance','Calendrier','Grille','Répartition','Micros']} />, 'scrollx', { wide:true }),
    ],
    BoolPill: [
      V('Vivante', <AtBool />, 'value / onChange'),
      V('Désactivée', <BoolPill value={false} onChange={noop} disabled />, 'disabled'),
      V('Autres mots', <BoolPill value onChange={noop} onLabel="Haut" offLabel="Bas" />, 'onLabel / offLabel'),
    ],
    DragHandle: [
      V('Au repos', <DragHandle onPointerDown={noop} />, '<DragHandle>'),
      V('En cours', <DragHandle onPointerDown={noop} dragging />, 'dragging'),
    ],
    NumPill: [ V('Trois bornes', <AtNumPills />, '<NumPill>', { wide:true }) ],
    ChevronDown: [ V(null, <span className="mono" style={{display:'inline-flex',alignItems:'center',gap:8}}>replier <ChevronDown /></span>, '<ChevronDown />') ],
    OriginTag: [ V('Les quatre origines', <>{ITEM_ORIGINS.map(o => <OriginTag key={o.id} origin={o} />)}</>, 'ITEM_ORIGINS', { wide:true }) ],
    ScanIcon:     [ V(null, <button className="icon-btn" aria-label="Scanner"><ScanIcon /></button>, '<ScanIcon />') ],
    StarIcon:     [ V('Vide', <button className="icon-btn xs" aria-label="Favori"><StarIcon size={11} /></button>, 'filled={false}'),
                    V('Pleine', <button className="icon-btn xs" aria-label="Favori"><StarIcon size={11} filled /></button>, 'filled') ],
    PlusIcon:     [ V(null, <button className="icon-btn" aria-label="Ajouter"><PlusIcon /></button>, '<PlusIcon />') ],
    PencilIcon:   [ V(null, <button className="icon-btn xs" aria-label="Modifier"><PencilIcon /></button>, '<PencilIcon />') ],
    TrashIcon:    [ V(null, <button className="icon-btn xs" aria-label="Supprimer"><TrashIcon /></button>, '<TrashIcon />') ],
    SortIcon:     [ V(null, <button className="icon-btn xs" aria-label="Trier"><SortIcon /></button>, '<SortIcon />') ],
    ImageIcon:    [ V(null, <button className="icon-btn xs" aria-label="Photo"><ImageIcon /></button>, '<ImageIcon />') ],
    ExternalIcon: [ V(null, <button className="icon-btn xs" aria-label="Ouvrir"><ExternalIcon /></button>, '<ExternalIcon />') ],
    SwipeDel:     [ V('Le fond découvert', <span className="fd-row-swipe" style={{display:'block',position:'relative',height:44}}><SwipeDel /></span>, '<SwipeDel />', { wide:true }) ],

    /* ---- Molécules ---- */
    InfoBubble: [
      V('Sur une rangée', (
        <div className="field spread">
          <label>Joker</label>
          <div className="ctl-with-info">
            <BoolPill value onChange={noop} />
            <InfoBubble title="Joker">
              Un jour marqué joker est <span className="k">exclu</span> des calculs — ce n'est pas un zéro,
              c'est une journée qui ne compte pas.
            </InfoBubble>
          </div>
        </div>
      ), '<InfoBubble>', { wide:true, col:true }),
      V('Toujours visible', (
        <div className="field spread">
          <label>Sources</label>
          <div className="ctl-with-info">
            <span className="settings-value">Open Food Facts</span>
            <InfoBubble title="Attribution" always>
              Ce qui n'est pas une explication ne suit pas l'interrupteur : le crédit
              qu'impose une licence reste là quand les bulles sont éteintes.
            </InfoBubble>
          </div>
        </div>
      ), 'always', { wide:true, col:true }),
    ],
    IconBar: [
      V('Inset', (
        <IconBar icon={<ScanIcon />} onIcon={noop} iconLabel="Scanner">
          <input placeholder="Un nom, ou un code-barres" />
        </IconBar>
      ), 'le bouton remplit le champ', { wide:true }),
      V('Detached', <AtIconBarDetached />, 'detached', { wide:true }),
    ],
    SwatchGrid:  [ V('Vivant', <AtSwatch />, '<SwatchGrid>', { wide:true, col:true }) ],
    ColorEditor: [ V('Vivant', <AtColorEditor />, '<ColorEditor>', { wide:true, col:true }) ],
    NumField:    [ V('Quatre rangées', <AtNumFields />, '<NumField>', { wide:true, col:true }) ],
    MacroStrip: [
      V('Nue', <MacroStrip n={AT_FOOD.ref.nutriments} per="100 g" />, 'per="100 g"', { wide:true, col:true }),
      V('Avec composition', (
        <div className="at-stack">
          {Object.keys(AT_FOOD).map(k => <MacroStrip key={k} n={AT_FOOD[k].nutriments} per="100 g" compBar />)}
        </div>
      ), 'compBar', { wide:true, col:true }),
      V('En grand', <MacroStrip n={AT_FOOD.custom.nutriments} per={null} className="fd-macros-wide" />, '.fd-macros-wide', { wide:true, col:true }),
    ],
    QtyPresets:  [ V('Raccourcis', <QtyPresets itemId="at-f1" unit="g" value="180" onPick={noop} />, '<QtyPresets>', { wide:true }) ],
    IngredientRow: [ V('Une ligne', <AtIngredientRow />, '<IngredientRow>', { wide:true, col:true }) ],
    MicroPicker: [ V('Le filtre des micros', <AtMicroPicker />, '<MicroPicker>', { wide:true }) ],
    DemoPair: [
      V('Sans / Avec', <DemoPair off={<span className="tc-badge">nombre</span>} on={<span className="tc-badge on">3 aujourd'hui</span>} />, '<DemoPair>', { wide:true }),
    ],
    ChartTooltip: [
      V('Relevé d\'un jour', (
        <div style={{position:'relative', height:96}}>
          <ChartTooltip xPct={50} date={shortDate(Date.now())} value="128 mg" onEdit={noop} onClose={noop} />
        </div>
      ), '<ChartTooltip>', { wide:true }),
    ],

    /* ---- Organismes ---- */
    DayCard: [
      V('Les sept genres', (
        <div className="today-grid">
          {c.dataTrackers.map(tr => (
            <DayCard key={tr.id} tracker={tr} dayEntries={c.dayEntries(tr.id)} {...cardProps} />
          ))}
        </div>
      ), 'un par type de tracker', { wide:true }),
    ],
    ChartCard: [
      V('Formes de courbe', (
        <div className="chart-grid-layout" data-per="3">
          {CURVE_STYLES.map(cs => (
            <ChartCard key={cs.id} perRow={3} rangeDays={30} onEdit={c.setEditTracker}
              tracker={{ ...t['at-num'], name:cs.label, curveStyle:cs.id }}
              entries={c.entriesOf('at-num')} />
          ))}
        </div>
      ), 'curveStyle', { wide:true }),
      V('Densité', <AtDensity tracker={t['at-scale']} entries={c.entriesOf('at-scale')} onEdit={c.setEditTracker} />, 'perRow', { wide:true }),
      V('Cumulatif', (
        <div className="chart-grid-layout" data-per="2">
          <ChartCard perRow={2} rangeDays={90} onEdit={c.setEditTracker}
            tracker={{ ...t['at-num'], name:'Caféine — cumul', cumulative:true }} entries={c.entriesOf('at-num')} />
          <ChartCard perRow={2} rangeDays={90} onEdit={c.setEditTracker}
            tracker={{ ...t['at-dur'], name:'Lecture — par semaine', chartGrain:'week' }} entries={c.entriesOf('at-dur')} />
        </div>
      ), 'cumulative · chartGrain', { wide:true }),
      V('Sans donnée', (
        <div className="chart-grid-layout" data-per="2">
          <ChartCard perRow={2} rangeDays={30} tracker={t['at-text']} entries={[]} onEdit={c.setEditTracker} />
        </div>
      ), 'période vide', { wide:true }),
    ],
    MasterStrip:       [ V(null, <div className="master-strips"><MasterStrip master={c.master} trackerById={t} entries={c.entries} dayTs={c.today} onEdit={c.setEditTracker} /></div>, '<MasterStrip>', { wide:true }) ],
    MasterStrips:      [ V(null, <MasterStrips masters={[c.master]} trackerById={t} entries={c.entries} dayTs={c.today} onEdit={c.setEditTracker} />, 'la bande entière', { wide:true }) ],
    MasterTrackerCard: [ V(null, <div className="chart-grid-layout" data-per="1"><MasterTrackerCard master={c.master} trackerById={t} entries={c.entries} rangeDays={30} onEdit={c.setEditTracker} /></div>, '<MasterTrackerCard>', { wide:true }) ],
    TrendChart:        [ V(null, <TrendChart trackers={c.dataTrackers} entries={c.entries} rangeDays={30} />, '<TrendChart>', { wide:true }) ],
    CalendarCard:      [ V(null, <CalendarCard tracker={t['at-bool']} entries={c.entriesOf('at-bool')} rangeDays={90} onEdit={c.setEditTracker} />, '<CalendarCard>', { wide:true }) ],
    GridSummary:       [ V(null, <GridSummary trackers={c.dataTrackers} entries={c.entries} rangeDays={30} onEdit={c.setEditTracker} />, '<GridSummary>', { wide:true }) ],
    MonthCalendar:     [ V(null, <AtMonth entries={c.entries} />, '<MonthCalendar>', { wide:true }) ],
    TabBar: [
      V(null, <AtTabBar />, 'les cinq onglets', { wide:true }),
    ],
    TrackerRail: [
      V(null, <AtRail trackers={c.trackers} />, '<TrackerRail>', { wide:true }),
    ],
    ReorderSection: [
      V(null, (
        <ReorderSection label="Quotidiens" swatch={COLORS[3]} onDragStart={null}>
          <div className="today-grid">
            <DayCard tracker={t['at-scale']} dayEntries={c.dayEntries('at-scale')} {...cardProps} />
          </div>
        </ReorderSection>
      ), '<ReorderSection>', { wide:true }),
    ],
    ChronoCard: [
      V('Arrêté', <AtChrono running={false} tracker={t['at-dur']} />, 'startedAt: null', { wide:true }),
      V('En marche', <AtChrono running tracker={t['at-dur']} />, 'startedAt', { wide:true }),
    ],
    FoodLogRow: [
      V('Trois lignes', (
        <div className="fd-list">
          {AT_LOGS.map(l => <FoodLogRow key={l.id} log={l} onEdit={noop} onDelete={noop} />)}
        </div>
      ), '<FoodLogRow>', { wide:true, col:true }),
      V('Mode sélection', (
        <div className="fd-list">
          <FoodLogRow log={AT_LOGS[0]} selecting onToggle={noop} onEdit={noop} onDelete={noop} />
          <FoodLogRow log={AT_LOGS[1]} selecting selected onToggle={noop} onEdit={noop} onDelete={noop} />
        </div>
      ), 'selecting / selected', { wide:true, col:true }),
    ],
    FoodGroupBlock: [
      V('Un repas versé', (
        <div className="fd-list">
          <FoodGroupBlock group={{ id:'at-g1', name:'Poke bowl', qty:1, rows:AT_LOGS }} onQty={noop} onDelete={noop}>
            {AT_LOGS.map(l => <FoodLogRow key={l.id} log={l} onEdit={noop} onDelete={noop} />)}
          </FoodGroupBlock>
        </div>
      ), '<FoodGroupBlock>', { wide:true, col:true }),
    ],
    FoodPickRow: [
      V('Les quatre origines', (
        <div className="fd-list">
          {Object.keys(AT_FOOD).map(k => (
            <FoodPickRow key={k} food={AT_FOOD[k]} onPick={noop} favorite={k === 'ref'}
              onToggleFavorite={noop} onEdit={noop} />
          ))}
        </div>
      ), '<FoodPickRow>', { wide:true, col:true }),
      V('Avec vignette', <div className="fd-list"><FoodPickRow food={AT_FOOD.off} onPick={noop} showImage onToggleFavorite={noop} /></div>, 'showImage', { wide:true, col:true }),
    ],
    MicroPanel:     [ V(null, <MicroPanel totals={AT_MICRO_TOTALS} />, '<MicroPanel>', { wide:true, col:true }) ],
    MacroSplitCard: [ V(null, <MacroSplitCard days={c.days} />, '<MacroSplitCard>', { wide:true }) ],
    RecipeSteps:    [ V(null, <AtRecipeSteps />, '<RecipeSteps>', { wide:true, col:true }) ],
    IngredientEditor: [ V(null, <AtIngredientEditor />, '<IngredientEditor>', { wide:true, col:true }) ],
    FoodSources:    [ V(null, <FoodSources />, '<FoodSources>', { wide:true, col:true }) ],
    FeedbackCard:   [ V(null, <FeedbackCard userId={null} />, '<FeedbackCard>', { wide:true, col:true }) ],
    TabsSettingsCard: [
      V(null, <AtTabsSettings />, '<TabsSettingsCard>', { wide:true, col:true }),
    ],

    /* ---- Modales ----
       Une modale se juge ouverte : elle se pose sur la page, et sa moitié
       basse est un pied de boutons qu'on ne voit nulle part ailleurs. */
    EntryModal:       [ V(null, <AtModal label="Corriger une entrée" render={(close) => (
                          <EntryModal entry={c.entries.find(e => e.trackerId === 'at-num')} tracker={t['at-num']}
                            onClose={close} onSave={close} onDelete={close} />)} />, '<EntryModal>') ],
    TrackerModal:     [ V('Complète', <AtModal label="Réglages d'un tracker" render={(close) => (
                          <TrackerModal tracker={t['at-num']} allTrackers={c.trackers}
                            onClose={close} onSave={close} onDelete={close} onArchive={close} onUnarchive={close} />)} />, 'scope="full"'),
                        V('Affichage seul', <AtModal label="Réglages d'affichage" render={(close) => (
                          <TrackerModal tracker={t['at-num']} allTrackers={c.trackers} scope="display"
                            onClose={close} onSave={close} onDelete={close} onArchive={close} onUnarchive={close} />)} />, 'scope="display"') ],
    ChronoModal:      [ V(null, <AtModal label="Réglages d'un chrono" render={(close) => (
                          <ChronoModal chrono={{ id:'at-c1', label:'Lecture', trackerId:'at-dur', startedAt:null, elapsed:0 }}
                            trackers={c.trackers} onClose={close} onSave={close} onDelete={close} />)} />, '<ChronoModal>') ],
    CopyToModal:      [ V(null, <AtModal label="Copier vers…" render={(close) => (
                          <CopyToModal day={dayKey(Date.now())} n={2} onClose={close} onSubmit={close} />)} />, '<CopyToModal>') ],
    GoalsModal:       [ V(null, <AtModal label="Objectifs" render={(close) => (
                          <GoalsModal goals={{ kcal:2400, protein:170, carbs:240, fat:80 }} isSet fromDay={dayKey(Date.now())}
                            onClose={close} onSave={close} />)} />, '<GoalsModal>') ],
    FoodEditModal:    [ V(null, <AtModal label="Fiche d'un aliment" render={(close) => (
                          <FoodEditModal food={AT_FOOD.custom} onClose={close} onSave={close} />)} />, '<FoodEditModal>') ],
    PasswordModal:    [ V(null, <AtModal label="Mot de passe" render={(close) => (
                          <PasswordModal onClose={close} />)} />, '<PasswordModal>') ],
    QuantityModal:    [ V(null, <AtModal label="Quelle quantité" render={(close) => (
                          <QuantityModal title="Blanc de poulet, cuit" food={AT_FOOD.ref} initialMeal="midi"
                            onClose={close} onSubmit={close} />)} />, '<QuantityModal>') ],
    MealPortionModal: [ V(null, <AtModal label="Quelle part" render={(close) => (
                          <MealPortionModal meal={{ id:'at-m1', name:'Poke bowl', portions:2,
                            items:[{ id:'i1', name:'Riz', grams:150, per100:{ kcal:130, protein:2.7, carbs:28, fat:0.3 } },
                                   { id:'i2', name:'Saumon', grams:120, per100:{ kcal:208, protein:20, carbs:0, fat:13 } }] }}
                            initialMeal="midi" onClose={close} onSubmit={close} />)} />, '<MealPortionModal>') ],
  };
}

/* ---- Les spécimens qui ont besoin d'un état à eux -------------------------
   Un contrôle figé sur une valeur ne montre que la moitié de ce qu'il fait :
   ce qui se juge dans une bascule, c'est le fond qui glisse.
   Les propriétés sont recopiées une à une, jamais ramassées dans un `...rest` :
   voir le piège « Un reste d'objet… » dans .claude/notes/pieges.md. */
function AtSeg({ options, size, wrap, scrollx }){
  const [v, setV] = useState(options[0]);
  return (
    <Segmented size={size} wrap={wrap} scrollx={scrollx}>
      {options.map(o => <button key={o} className={v===o?'on':''} onClick={()=>setV(o)}>{o}</button>)}
    </Segmented>
  );
}

function AtBool(){
  const [v, setV] = useState(true);
  return <BoolPill value={v} onChange={setV} />;
}

function AtSwatch(){
  const [col, setCol] = useState(DEFAULT_COLOR);
  return (<><SwatchGrid value={col} onChange={setCol} /><div className="at-out mono">{col}</div></>);
}

function AtColorEditor(){
  const [col, setCol] = useState(TRACKLOG_ACCENT);
  return (<><ColorEditor value={col} onChange={setCol} /><div className="at-out mono">{col}</div></>);
}

function AtIconBarDetached(){
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

function AtNumFields(){
  const [g, setG] = useState({ kcal:'165', protein:'31', carbs:'', fat:'3.6' });
  const set = (k) => (v) => setG(p => ({ ...p, [k]:v }));
  return (
    <>
      <NumField label="Calories" unit="kcal" value={g.kcal} onChange={set('kcal')} />
      <NumField label="Protéines" unit="g" value={g.protein} onChange={set('protein')} />
      <NumField label="Glucides" unit="g" value={g.carbs} onChange={set('carbs')}
        info={<>Un champ vide dit qu'il est vide : rien n'est pré-rempli, sauf quand on <span className="k">corrige</span> une ligne déjà notée.</>} />
      <NumField label="Lipides" unit="g" value={g.fat} onChange={set('fat')} />
    </>
  );
}

function AtNumPills(){
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

/* Le curseur de densité avec ses cartes derrière : le seul moyen de voir qu'un
   cran de plus ne rétrécit pas la carte, il lui retire du détail. */
function AtDensity({ tracker, entries, onEdit }){
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

function AtMonth({ entries }){
  const [monthTs, setMonthTs] = useState(() => startOfMonth(Date.now()));
  const [sel, setSel] = useState(() => dayKey(Date.now()));
  return (
    <MonthCalendar monthTs={monthTs} entries={entries} selectedKey={sel} onSelectDay={setSel}
      onPrev={()=>setMonthTs(ts => addMonths(ts, -1))} onNext={()=>setMonthTs(ts => addMonths(ts, 1))} />
  );
}

function AtRail({ trackers }){
  const [sel, setSel] = useState([]);
  return (
    <TrackerRail trackers={trackers} selectedIds={sel} filterActive={sel.length > 0}
      onToggle={(id)=>setSel(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id])}
      onToggleAll={()=>setSel([])} onAdd={()=>{}} onEdit={()=>{}} onReorder={()=>{}} />
  );
}

/* Un chrono se juge en marche : le décompte est calculé localement à partir du
   seul horodatage de départ, donc il faut le laisser tourner pour le voir. */
function AtChrono({ running, tracker }){
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);
  const chrono = { id:'at-c1', label:'Lecture', trackerId: tracker.id,
                   startedAt: running ? now - 754000 : null, elapsed: running ? 0 : 1834000, order:0 };
  return (
    <ChronoCard chrono={chrono} now={now} tracker={tracker}
      onStart={()=>{}} onPause={()=>{}} onReset={()=>{}} onSave={()=>{}} onEdit={()=>{}} />
  );
}

function AtRecipeSteps(){
  const [steps, setSteps] = useState([
    { id:'s1', text:'Faire cuire le riz 12 minutes.', done:true, mins:12 },
    { id:'s2', text:'Découper le saumon en cubes.', done:false, mins:null },
    { id:'s3', text:'Assembler, arroser de sauce soja.', done:false, mins:null },
  ]);
  return <RecipeSteps steps={steps} onChange={setSteps} />;
}

function AtIngredientRow(){
  const [item, setItem] = useState({ id:'i1', name:'Riz basmati, cuit', grams:150,
                                     per100:{ kcal:130, protein:2.7, carbs:28, fat:0.3 }, note:'pesé cuit' });
  return <IngredientRow item={item} onPatch={(p)=>setItem(x => ({ ...x, ...p }))} onRemove={()=>{}} />;
}

function AtIngredientEditor(){
  const [items, setItems] = useState([
    { id:'i1', name:'Riz basmati, cuit', grams:150, per100:{ kcal:130, protein:2.7, carbs:28, fat:0.3 }, note:'' },
    { id:'i2', name:'Saumon cru', grams:120, per100:{ kcal:208, protein:20, carbs:0, fat:13 }, note:'' },
    { id:'i3', name:'Avocat', grams:60, per100:{ kcal:160, protein:2, carbs:9, fat:15 }, note:'' },
  ]);
  return <IngredientEditor items={items} onChange={setItems} onAdd={()=>{}} />;
}

function AtMicroPicker(){
  const specs = FOOD_MICRO_SPECS.slice(0, 8);
  const [sel, setSel] = useState(specs.slice(0, 3).map(s => s.key));
  const withData = new Set(specs.slice(0, 5).map(s => s.key));
  return <MicroPicker specs={specs} withData={withData} selected={sel} onSelect={setSel} />;
}

/* `tabs` est la LISTE des onglets affichés, pas la carte des visibilités : le
   même mot désigne les deux choses dans l'app, et un spécimen se trompe de
   forme aussi vite qu'un appelant. */
function AtTabBar(){
  const [tab, setTab] = useState('log');
  const [order, setOrder] = useState(NAV_TABS.map(t => t.id));
  return <TabBar tabs={NAV_TABS} order={order} activeTab={tab} onSelect={setTab} onReorder={setOrder} />;
}

function AtTabsSettings(){
  const [tabs, setTabs] = useState(DEFAULT_TABS);
  const [order, setOrder] = useState(NAV_TABS.map(t => t.id));
  return (
    <TabsSettingsCard tabs={tabs} onSetTabVisible={(id, v)=>setTabs(p => ({ ...p, [id]:v }))}
      tabOrder={order} onSetTabOrder={setOrder} prefsReady />
  );
}

/* Une modale ne se montre pas repliée dans une fiche : elle couvre la page, et
   c'est justement ce qu'on veut juger. Le bouton l'ouvre pour de vrai. */
function AtModal({ label, render }){
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="primary sm" onClick={()=>setOpen(true)}>{label}</button>
      {open && render(()=>setOpen(false))}
    </>
  );
}

/* ---- Les jetons -----------------------------------------------------------
   Chaque variable est lue TELLE QU'ELLE EST CALCULÉE dans le cadre du thème
   affiché : une valeur écrite dans la feuille ne dit pas ce qu'elle vaut une
   fois `color-mix` et `var()` résolus, et c'est la valeur résolue qu'on voit à
   l'écran. Le rond n'apparaît que si la valeur est une couleur. */
function TokenGrid({ tokens, theme, accent }){
  const ref = useRef(null);
  const [vals, setVals] = useState({});
  useEffect(() => {
    if (!ref.current) return;
    const cs = getComputedStyle(ref.current);
    const next = {};
    tokens.forEach(t => { next[t] = (cs.getPropertyValue(t) || '').trim(); });
    setVals(next);
  }, [tokens, theme, accent]);
  const isColor = (v) => /^(#|rgb|hsl|oklch|oklab|lab|lch|color-mix|transparent)/i.test(v);
  return (
    <div className="at-toks" ref={ref}>
      {tokens.map(t => {
        const v = vals[t] || '';
        return (
          <div key={t} className="at-tok">
            {isColor(v)
              ? <span className="at-tok-sw" style={{ background:`var(${t})` }} />
              : <span className="at-tok-sw flat" aria-hidden="true" />}
            <span className="at-tok-txt">
              <code className="mono">{t}</code>
              <em className="mono">{v || '—'}</em>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---- L'audit des classes --------------------------------------------------
   Ce que la feuille déclare, moins ce que l'atelier rend vraiment. Le calcul
   se fait sur le DOM, après rendu : aucune liste à tenir, et une classe qu'on
   cesse de montrer réapparaît toute seule dans les manques.
   Trois familles sont exclues d'office — le chrome de l'atelier lui-même, le
   curseur de bureau et l'écran de secours de chargement : ils ne font pas
   partie du vocabulaire de l'app. */
const AT_OFF_STAGE = /^(at-|cursor-|has-cursor|boot-)/;

function useClassCoverage(rootRef, classes, deps){
  const [seen, setSeen] = useState(null);
  const measure = useCallback(() => {
    if (!rootRef.current) return;
    const found = new Set();
    rootRef.current.querySelectorAll('*').forEach(el => {
      if (el.classList) el.classList.forEach(cl => found.add(cl));
    });
    setSeen(found);
  }, [rootRef]);
  useEffect(() => {
    const id = setTimeout(measure, 400);
    return () => clearTimeout(id);
  }, deps);
  if (!classes.length) return { missing:[], covered:0, total:0, measure };
  const kept = classes.filter(cl => !AT_OFF_STAGE.test(cl));
  const missing = seen ? kept.filter(cl => !seen.has(cl)) : [];
  return { missing, covered: kept.length - missing.length, total: kept.length, measure };
}

/* ============================================================
   La page
   ============================================================ */
function AtelierView(){
  /* Le thème et l'accent sont ici un APERÇU, pas un réglage : les changer dans
     l'atelier ne doit pas reconfigurer l'app de quelqu'un qui voulait juste
     comparer deux fonds. Quitter la page remet ce qui était choisi. */
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || DEFAULT_THEME);
  const [accent, setAccent] = useState(() => {
    try { return localStorage.getItem('tracklog.accent') || TRACKLOG_ACCENT; } catch(e){ return TRACKLOG_ACCENT; }
  });
  const [infoEnabled, setInfoEnabled] = useState(true);
  const [q, setQ] = useState('');

  /* Les couleurs des macros (`--macro-protein`…) sont posées par le magasin de
     Food, que l'atelier ne monte pas — sans ce hook, `MacroStrip` s'afficherait
     ici dans d'autres couleurs que dans l'app. C'est l'atelier lui-même qui a
     montré le trou : les quatre jetons y étaient listés sans valeur. */
  useMacroColorVars();

  useEffect(() => { if (theme !== 'all') document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { window.applyAccent(accent); }, [accent]);
  useEffect(() => () => {
    try {
      const stored = localStorage.getItem('tracklog.theme');
      document.documentElement.dataset.theme = isTheme(stored) ? stored : DEFAULT_THEME;
      window.applyAccent(localStorage.getItem('tracklog.accent') || '');
    } catch(e){}
  }, []);

  const src = useAtelierSources();
  const rootRef = useRef(null);

  /* Les données de démonstration, vivantes : les cartes écrivent dedans. */
  const seed = useMemo(makeAtelierData, []);
  const [trackers, setTrackers] = useState(seed.trackers);
  const [entries, setEntries] = useState(seed.entries);
  const [editEntry, setEditEntry] = useState(null);
  const [editTracker, setEditTracker] = useState(null);

  const byId = useMemo(() => Object.fromEntries(trackers.map(t => [t.id, t])), [trackers]);
  const dataTrackers = useMemo(() => trackers.filter(t => !isMaster(t)), [trackers]);
  const today = startOfDay(Date.now());

  const addEntry = (e) => setEntries(prev => {
    const tr = byId[e.trackerId];
    const keep = (x) => !(tr && tr.daily && x.trackerId === e.trackerId
      && dayKey(x.ts) === dayKey(e.ts) && !isJokerEntry(x) && !isJokerEntry(e));
    return [...prev.filter(keep), { id:uid('at_'), note:'', ...e }];
  });
  const deleteEntry = (id) => setEntries(prev => prev.filter(e => e.id !== id));

  const ctx = {
    trackers, entries, byId, dataTrackers, today, days: seed.days,
    master: byId['at-master'],
    dayEntries: (id) => entries.filter(e => e.trackerId === id && dayKey(e.ts) === dayKey(today)),
    entriesOf: (id) => entries.filter(e => e.trackerId === id),
    addEntry, deleteEntry, setEditEntry, setEditTracker,
  };
  const specimens = atelierSpecimens(ctx);

  /* Ce que la source a trouvé, rangé par famille. L'ordre à l'intérieur d'une
     famille suit le fichier puis la ligne : deux composants voisins dans le
     code le restent ici, et c'est presque toujours qu'ils vont ensemble. */
  const declared = src.components.filter(c => c.family);
  const orphans = src.components.filter(c => !c.family);
  const filtered = q
    ? declared.filter(c => (c.name + ' ' + (c.desc || '')).toLowerCase().includes(q.toLowerCase()))
    : declared;
  const byFamily = {};
  filtered.forEach(c => { (byFamily[c.family] = byFamily[c.family] || []).push(c); });

  const themes = theme === 'all' ? THEMES.map(t => t.id) : [theme];
  const cover = useClassCoverage(rootRef, src.classes, [src.ready, q, theme]);

  const counts = {};
  declared.forEach(c => { counts[c.family] = (counts[c.family] || 0) + 1; });
  const withSpec = declared.filter(c => specimens[c.name]).length;

  return (
    <InfoVisibilityContext.Provider value={infoEnabled}>
      <div className="app atelier" ref={rootRef}>
        <div className="topbar">
          <div className="brand">
            <span className="mark" />
            <h1>Atelier</h1>
            <span className="by">le vocabulaire de Tracklog</span>
          </div>
          <a className="account-btn" href="#" onClick={()=>{ window.location.hash = ''; }}>← l'app</a>
        </div>

        <div className="at-bar">
          <div className="at-bar-grp">
            <span className="at-bar-lab">Thème</span>
            <Segmented size="small" wrap>
              {THEMES.map(t => (
                <button key={t.id} className={theme===t.id?'on':''} onClick={()=>setTheme(t.id)}>{t.label}</button>
              ))}
              <button className={theme==='all'?'on':''} onClick={()=>setTheme('all')}>Tous</button>
            </Segmented>
          </div>
          <div className="at-bar-grp">
            <span className="at-bar-lab">Accent</span>
            <SwatchGrid value={accent} onChange={setAccent} />
          </div>
          <div className="at-bar-grp">
            <span className="at-bar-lab">Bulles</span>
            <BoolPill value={infoEnabled} onChange={setInfoEnabled} />
          </div>
          <div className="at-bar-grp grow">
            <IconBar icon={<span aria-hidden="true">✕</span>} onIcon={()=>setQ('')} iconLabel="Vider">
              <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Chercher un composant…" />
            </IconBar>
          </div>
        </div>

        {!src.ready && <div className="empty"><span className="em-serif">Lecture des sources…</span></div>}

        {src.error && (
          <div className="card at-alert">
            <p className="at-alert-h">L'atelier n'a pas pu relire ses sources</p>
            <p className="at-desc">
              {src.error}. Cette page se construit en relisant les fichiers du projet à
              l'exécution : servie depuis un vrai serveur elle se remplit toute seule, ouverte
              depuis le disque (<code className="mono">file://</code>) le navigateur le refuse.
            </p>
          </div>
        )}

        {src.ready && !src.error && (
          <>
            <div className="at-summary">
              <AtCount n={declared.length} label="composants déclarés" />
              <AtCount n={withSpec} label="avec spécimen" />
              <AtCount n={src.tokens.length} label="jetons" />
              <AtCount n={cover.total} label="classes" />
              <AtCount n={orphans.length} label="non déclarés" bad={orphans.length > 0} />
            </div>

            {orphans.length > 0 && (
              <div className="card at-alert" id="at-orphelins">
                <p className="at-alert-h">{orphans.length} composant{orphans.length>1?'s':''} sans annotation</p>
                <p className="at-desc">
                  Un composant se présente par une ligne <code className="mono">@atelier &lt;famille&gt; — &lt;description&gt;</code>
                  posée juste au-dessus de lui, dans son fichier. Sans elle, l'atelier ne sait ni où le ranger
                  ni comment le dire — alors il le montre ici.
                </p>
                <ul className="at-orphans">
                  {orphans.map(o => (
                    <li key={o.file + o.name}>
                      <code className="mono">{o.name}</code>
                      <span className="at-src mono">{o.file}:{o.line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <nav className="at-nav">
              {ATELIER_FAMILIES.map(f => (
                <a key={f.id} className="pill" href={`#at-fam-${f.id}`}>
                  {f.label}
                  {counts[f.id] != null && <span className="at-nav-n mono">{counts[f.id]}</span>}
                </a>
              ))}
            </nav>

            {/* ---- Jetons ---- */}
            <section className="at-fam-sec" id="at-fam-jeton">
              <h2 className="at-h">Jetons</h2>
              <p className="at-note">{ATELIER_FAMILIES[0].note}</p>
              <div className="at-grid one">
                <article className="at-card">
                  <header className="at-card-h">
                    <div className="at-card-id">
                      <code className="mono at-name">--…</code>
                      <span className="at-fam">jeton</span>
                    </div>
                  </header>
                  <p className="at-desc">
                    Les {src.tokens.length} variables déclarées dans <code className="mono">styles.css</code> ou posées
                    en JS, lues résolues dans le thème affiché — c'est la valeur calculée qui arrive à l'écran,
                    pas celle qui est écrite.
                  </p>
                  <div className={`at-frames ${themes.length > 1 ? 'multi' : ''}`}>
                    {themes.map(th => (
                      <ThemeFrame key={th} theme={th} accent={accent} label={themes.length > 1 ? themeLabel(th) : null}>
                        <TokenGrid tokens={src.tokens} theme={th} accent={accent} />
                      </ThemeFrame>
                    ))}
                  </div>
                </article>
              </div>
            </section>

            {/* ---- Les familles de composants ---- */}
            {ATELIER_FAMILIES.filter(f => f.id !== 'jeton' && f.id !== 'classe').map(f => (
              <section className="at-fam-sec" key={f.id} id={`at-fam-${f.id}`}>
                <h2 className="at-h">{f.label} <span className="at-h-n mono">{(byFamily[f.id] || []).length}</span></h2>
                <p className="at-note">{f.note}</p>
                {(byFamily[f.id] || []).length === 0 ? (
                  <div className="empty"><span className="em-serif">Rien ici pour cette recherche.</span></div>
                ) : (
                  <div className={`at-grid ${AT_DENSE[f.id] ? 'many' : 'one'}`}>
                    {(byFamily[f.id] || []).map(entry => (
                      <SpecCard key={entry.file + entry.name} entry={entry}
                        variants={specimens[entry.name] || null} themes={themes} accent={accent} />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {/* ---- Classes ---- */}
            <section className="at-fam-sec" id="at-fam-classe">
              <h2 className="at-h">Classes <span className="at-h-n mono">{cover.total}</span></h2>
              <p className="at-note">{ATELIER_FAMILIES[ATELIER_FAMILIES.length-1].note}</p>
              <div className="card">
                <p className="at-desc">
                  <b>{cover.covered}</b> des <b>{cover.total}</b> classes de la feuille sont rendues quelque part
                  sur cette page. Les autres sont listées ci-dessous : chacune est soit un état que l'atelier ne
                  montre pas encore, soit du CSS que plus personne n'utilise.
                  {' '}<button className="fd-link" onClick={cover.measure}>Recompter</button>
                </p>
                <div className="at-classes">
                  {cover.missing.map(cl => <code className="mono" key={cl}>.{cl}</code>)}
                </div>
              </div>
            </section>
          </>
        )}

        <p className="footer-note">
          Cette page ne lit ni n'écrit rien en base : ses trackers, ses entrées et ses aliments sont
          fabriqués dans <code className="mono">app.atelier.jsx</code>, et son inventaire est relu
          dans les sources du projet à chaque ouverture.
        </p>

        {editEntry && (
          <EntryModal entry={editEntry} tracker={byId[editEntry.trackerId]}
            onClose={()=>setEditEntry(null)}
            onSave={(patch)=>{ setEntries(prev => prev.map(e => e.id === editEntry.id ? { ...e, ...patch } : e)); setEditEntry(null); }}
            onDelete={()=>{ deleteEntry(editEntry.id); setEditEntry(null); }} />
        )}
        {editTracker && (
          <TrackerModal tracker={editTracker} allTrackers={trackers}
            onClose={()=>setEditTracker(null)}
            onSave={(patch)=>{ setTrackers(prev => prev.map(t => t.id === editTracker.id ? { ...t, ...patch } : t)); setEditTracker(null); }}
            onDelete={()=>setEditTracker(null)}
            onArchive={()=>setEditTracker(null)}
            onUnarchive={()=>setEditTracker(null)} />
        )}
      </div>
    </InfoVisibilityContext.Provider>
  );
}

function AtCount({ n, label, bad }){
  return (
    <div className={`at-count ${bad ? 'bad' : ''}`}>
      <span className="at-count-n mono">{n}</span>
      <span className="at-count-l">{label}</span>
    </div>
  );
}
