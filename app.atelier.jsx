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
  { id:'declinaison', label:'Déclinaisons',
    note:"L'autre façon de compter. Un composant est une brique du code, avec un nom ; une DÉCLINAISON est une forme qui existe vraiment quelque part dans l'app — une combinaison de classes, ou l'un de ses états. Rangées par classe de base : `.icon-btn` porte la forme partagée, `.cal-nav`, `.sm` ou `.on` la modifient. Deux sections, parce qu'on ne les regarde pas pareil : ce qui se décline se compare — les formes côte à côte, l'intruse se voit —, ce qui n'est écrit qu'une fois n'a rien à comparer et reste là pour l'inventaire, sans noyer le reste sous le nombre. Rien n'est écrit à la main ici — tout est relu dans les `className=` des sources." },
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
  const all = new Set();
  /* Le chrome de l'atelier ne se juge pas lui-même. On le reconnaît sans liste
     à tenir : une classe qui n'apparaît JAMAIS que dans un sélecteur portant
     aussi un `.at-…` appartient à l'étagère, pas à la marchandise. C'est
     comme ça que `.multi` (de `.at-frames.multi`) ou `.dead` (de
     `.at-classes code.dead`) cessent de se dénoncer comme du CSS mort — elles
     sont bien portées, mais par cette page, qui n'est pas l'app. */
  const outside = new Set();
  let depth = 0, buf = '';
  for (let i = 0; i < noComments.length; i++){
    const ch = noComments[i];
    if (ch === '{'){
      if (depth === 0){
        const cls = (buf.match(/\.(-?[A-Za-z_][\w-]*)/g) || []).map(c => c.slice(1));
        const chrome = cls.some(c => c.indexOf('at-') === 0 || c === 'atelier');
        cls.forEach(c => { all.add(c); if (!chrome) outside.add(c); });
      }
      depth++; buf = '';
    } else if (ch === '}'){
      depth = Math.max(0, depth - 1); buf = '';
    } else if (depth === 0){
      buf += ch;
    }
  }
  const list = [...all].sort();
  return { list, chrome: new Set(list.filter(c => !outside.has(c))) };
}

/* ---- L'autre inventaire : les apparitions ---------------------------------
   Un composant est une brique du CODE : il a un nom, il se réutilise, et c'est
   lui qu'on trouve par son annotation. Une APPARITION est une brique du RENDU :
   la combinaison de classes qu'un élément porte réellement quelque part dans
   l'app — `button.icon-btn.cal-nav`. Les deux existent, aucune ne remplace
   l'autre, et elles ne se recouvrent pas :

     · `GearIcon` est un composant, et il apparaît sous six habillages.
     · `button.icon-btn.cal-nav` est une apparition, et n'est aucun composant —
       c'est un bouton écrit à la main dans un écran. Sans cet inventaire, il
       n'existerait nulle part dans l'atelier.

   Tout se lit dans la source, rien ne s'écrit à la main : une combinaison
   nouvelle apparaît le lendemain, une combinaison supprimée disparaît.

   Les classes de base les plus déclinées sont celles qui portent une FORME
   partagée — `.icon-btn` en a dix-sept. C'est là qu'une incohérence se voit :
   dix-sept ronds censés être le même rond, posés l'un à côté de l'autre. */

/* Les tags qu'on sait rendre seuls. Un `input` ou un `svg` demandent des
   attributs qu'on n'a pas ; un tag à Majuscule est un composant React, donc il
   relève de l'autre inventaire et n'a rien à faire ici. */
const AT_TAGS = ['div','span','button','a','p','section','article','header','footer','nav',
                 'label','li','ul','ol','h1','h2','h3','h4','i','b','em','strong','code','small','u'];
const AT_CLASS_WORD = /^[a-z][a-z0-9-]*$/;
const AT_CLASSNAME = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

/* Avance jusqu'au `>` qui ferme la balise ouvrante. Les accolades et les
   chaînes sont sautées : un `onClick={()=>x}` contient un `>` qui n'est pas la
   fin de la balise, et le prendre pour tel décalerait tout ce qui suit. */
function atEndOfOpenTag(text, from){
  let depth = 0;
  for (let i = from; i < text.length; i++){
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '"' || c === "'" || c === '`'){
      const q = c; i++;
      while (i < text.length && text[i] !== q){ if (text[i] === '\\') i++; i++; }
    }
    else if (depth === 0 && c === '>') return { at:i, selfClosing: text[i-1] === '/' };
  }
  return { at:-1, selfClosing:false };
}

function parseAppearances(file, text){
  const out = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  AT_CLASSNAME.lastIndex = 0;
  let m;
  while ((m = AT_CLASSNAME.exec(text))){
    // Le tag : le `<` le plus proche en remontant.
    const open = text.lastIndexOf('<', m.index);
    if (open === -1 || m.index - open > 600) continue;
    const tm = /^<([A-Za-z][\w.]*)/.exec(text.slice(open, open + 40));
    if (!tm) continue;
    const tag = tm[1];

    /* Deux formes d'écriture. `className="a b"` donne la combinaison exacte.
       Un gabarit à accolades donne une base — ce qui précède la première
       accolade — plus des classes d'ÉTAT, celles qui ne sont là que dans
       certaines conditions. Les deux sont montrées, séparément : une classe
       d'état posée en permanence mentirait sur ce qu'elle est. */
    let words = [], optional = [];
    if (m[1] != null){
      words = m[1].split(/\s+/);
    } else {
      words = m[2].split('${')[0].split(/\s+/);
      const inner = m[2].match(/\$\{[^}]*\}/g) || [];
      inner.forEach(seg => {
        const lits = seg.match(/['"][a-z][a-z0-9 -]*['"]/g) || [];
        lits.forEach(l => l.slice(1, -1).split(/\s+/).forEach(w => {
          if (AT_CLASS_WORD.test(w) && optional.indexOf(w) === -1) optional.push(w);
        }));
      });
    }
    words = words.filter(w => AT_CLASS_WORD.test(w));
    if (!words.length) continue;

    const end = atEndOfOpenTag(text, m.index + m[0].length);
    if (end.at === -1) continue;
    const opening = text.slice(open, end.at);

    // Le nom humain : celui que l'app donne déjà aux lecteurs d'écran.
    const lab = /aria-label="([^"]{1,44})"/.exec(opening) || /title="([^"]{1,44})"/.exec(opening);

    // Ce qu'il y a dedans : un texte court, ou une icône auto-fermante.
    let content = null, icon = null;
    if (!end.selfClosing){
      const after = text.slice(end.at + 1, end.at + 200);
      const im = /^\s*<([A-Z]\w*)[^<>]*\/>/.exec(after);
      if (im) icon = im[1];
      else {
        const stop = after.indexOf('<');
        const raw = stop === -1 ? '' : after.slice(0, stop);
        const t = raw.trim();
        if (t && t.length <= 14 && !/[{}]/.test(raw)) content = t;
      }
    }
    out.push({ tag, classes:words, optional, content, icon,
               label: lab ? lab[1] : null, file, line: lineOf(m.index),
               isComponent: /^[A-Z]/.test(tag), renderable: AT_TAGS.indexOf(tag) !== -1 });
  }
  return out;
}

/* Une apparition = un tag + un jeu de classes. Le même bouton écrit à cinq
   endroits est UNE apparition vue cinq fois, pas cinq : ce qui compte est la
   forme, et le nombre d'usages dit seulement à quel point elle est répandue. */
function groupAppearances(rows){
  const byKey = new Map();
  rows.forEach(r => {
    if (!r.renderable) return;
    const key = r.tag + '.' + r.classes.join('.');
    let a = byKey.get(key);
    if (!a){
      a = { key, tag:r.tag, classes:r.classes, optional:[], content:null,
            icon:null, label:null, uses:0, where:[] };
      byKey.set(key, a);
    }
    a.uses++;
    r.optional.forEach(o => { if (a.optional.indexOf(o) === -1) a.optional.push(o); });
    if (!a.content && r.content) a.content = r.content;
    if (!a.icon && r.icon) a.icon = r.icon;
    if (!a.label && r.label) a.label = r.label;
    if (a.where.length < 6) a.where.push(`${r.file}:${r.line}`);
  });

  /* Le regroupement par PREMIÈRE classe. Ce n'est pas une règle du CSS — il
     n'y a ni parent ni enfant entre deux classes — c'est la convention de ce
     projet, et elle est tenue : la forme partagée s'écrit en premier, ce qui
     la modifie ensuite. C'est exactement ce que dit `.icon-btn.sm` dans la
     feuille, où la règle n'existe que pour les deux ensemble. */
  const byBase = new Map();
  byKey.forEach(a => {
    const b = a.classes[0];
    if (!byBase.has(b)) byBase.set(b, { base:b, items:[] });
    byBase.get(b).items.push(a);
  });
  const all = [...byBase.values()];
  all.forEach(g => {
    g.items.sort((x, y) => y.uses - x.uses || x.key.localeCompare(y.key));
    /* Le compte d'une base, ÉTATS COMPRIS. Un `.icon-btn` et le même `.icon-btn`
       en `.on` ne se ressemblent pas : ce sont deux formes à regarder, donc
       deux déclinaisons. Les compter pour une seule faisait dire à la page
       qu'elle montre moins de formes qu'elle n'en montre. */
    g.count = g.items.reduce((n, it) => n + 1 + it.optional.length, 0);
  });
  // De la plus déclinée à la moins : c'est là qu'une intruse se voit.
  const bases = all.sort((a, b) => b.count - a.count || a.base.localeCompare(b.base));
  return { bases, total: byKey.size, variants: bases.reduce((n, g) => n + g.count, 0) };
}

/* Toutes les classes que l'app porte vraiment, états compris — plus celles
   qu'un bout de JS pose à la main (`classList.add('reordering')`), invisibles
   d'un `className=`. Sert à distinguer une classe que l'atelier ne montre pas
   encore d'une classe que PLUS PERSONNE ne porte, c'est-à-dire du CSS mort. */
function wornClasses(rows, jsSources){
  const worn = new Set();
  rows.forEach(r => { r.classes.forEach(c => worn.add(c)); r.optional.forEach(c => worn.add(c)); });
  const add = /classList\.(?:add|remove|toggle)\(\s*['"`]([a-z][a-z0-9-]*)/g;
  jsSources.forEach(src => { let m; while ((m = add.exec(src))) worn.add(m[1]); });
  return worn;
}

/* Le chargement : cinq sources, une feuille, tout en parallèle. En échec —
   ouvert depuis le disque en `file://`, où `fetch` refuse — l'atelier le dit
   plutôt que de se montrer vide et d'avoir l'air en panne. */
function useAtelierSources(){
  const [state, setState] = useState({ ready:false, error:null, components:[], tokens:[],
                                       classes:[], chrome:new Set(),
                                       decl:{ bases:[], total:0, variants:0 }, worn:new Set() });
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
        /* Les apparitions ne se lisent que dans les fichiers qui RENDENT
           quelque chose : app.core.jsx ne dessine rien, par sa règle d'entrée. */
        const rows = [];
        ATELIER_SOURCES.forEach((f, i) => {
          if (f !== 'app.core.jsx') rows.push(...parseAppearances(f, jsSources[i]));
        });
        const cls = parseClasses(css);
        setState({ ready:true, error:null, components,
                   tokens: parseTokens(css, jsSources), classes: cls.list, chrome: cls.chrome,
                   decl: groupAppearances(rows), worn: wornClasses(rows, jsSources) });
      } catch(e){
        if (!cancelled) setState({ ready:true, error:e.message || String(e), components:[], tokens:[],
                                   classes:[], chrome:new Set(),
                                       decl:{ bases:[], total:0, variants:0 }, worn:new Set() });
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
   le cadre pour que la couleur choisie vaille aussi dans les aperçus.

   Il n'y a plus de sélecteur de thème par fiche : un seul choix, celui de la
   barre du haut. Cinquante menus qui disent tous « Global » n'étaient pas
   cinquante réglages, c'était cinquante fois le même, et ils prenaient la
   place du nom du composant dans l'en-tête. */
function atAccentVars(accent){
  if (!accent) return undefined;
  return {
    '--primary': accent,
    '--primary-hover': `color-mix(in oklab, ${accent} 84%, #000)`,
    '--primary-soft': `color-mix(in srgb, ${accent} 14%, transparent)`,
  };
}

function ThemeFrame({ theme, accent, label, children }){
  return (
    <div className="at-frame" data-theme={theme} style={atAccentVars(accent)}>
      {label && <span className="at-frame-lab">{label}</span>}
      <div className="at-frame-in">{children}</div>
    </div>
  );
}

/* ---- La vignette ----------------------------------------------------------
   L'unité de toute la page : une chose, seule, centrée, sur le fond de son
   thème. Deux raisons de ne pas s'en passer :

   · `contain: layout paint` (dans la feuille) n'est pas une coquetterie, c'est
     ce qui rend cette page possible. L'app a des calques `position:fixed` —
     `.scrim`, `.fd-add-page`, la barre de sélection. Rendus nus dans une
     liste, ils se collent au bord de la FENÊTRE et repeignent la page.
     Contenue, la vignette devient le repère de ses propres descendants fixés.
   · Le nom ne s'écrit plus sous la chose, il vit dans le survol. Écrits en
     ligne, les libellés et les sélecteurs doublaient la hauteur de chaque
     fiche et faisaient lire du texte là où on venait regarder une forme. */
function Spec({ theme, accent, onShow, active, children }){
  return (
    <div className={`at-spec${active ? ' on' : ''}`}
         onMouseEnter={onShow || undefined} onFocus={onShow || undefined}>
      <div className="at-stage" data-theme={theme} style={atAccentVars(accent)}>{children}</div>
    </div>
  );
}

/* ---- Ce que dit une carte ouverte -----------------------------------------
   Une ligne par information : le type à gauche, la valeur à droite. Ces lignes
   ont été une bulle flottante au survol, et une bulle s'en va au premier
   mouvement — il fallait retrouver la vignette pour relire une ligne, et rien
   ne se comparait d'une vignette à l'autre. Posées dans le corps de la carte,
   elles restent ; c'est la vignette survolée qui décide ce qu'elles disent.
   Une carte fermée n'en montre aucune : elle n'a que son nom et son nombre. */
function AtInfo({ rows }){
  const list = (rows || []).filter(r => r && r.v);
  if (!list.length) return null;
  return (
    <dl className="at-info">
      {list.map(r => (
        <div className={`at-info-row${r.full ? ' full' : ''}`} key={r.k}>
          <dt>{r.k}</dt>
          <dd className={r.prose ? '' : 'mono'}>{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* Des vignettes LIÉES : les états d'une même apparition, ou le même spécimen
   sous plusieurs thèmes. Elles partagent un fond, et c'est tout ce qu'il y a à
   en dire — ce sont la même chose, vue autrement. Une vignette qui n'a rien à
   lier n'a pas de fond : le liant doit vouloir dire quelque chose. */
function SpecTie({ solo, wide, col, children }){
  return (
    <div className={`at-tie${solo ? ' solo' : ''}${wide ? ' wide' : ''}${col ? ' col' : ''}`}>
      {children}
    </div>
  );
}

/* Les variantes d'un composant. Une variante par groupe ; sous « Tous », le
   groupe tient ses thèmes côte à côte, ce qui est exactement ce qu'on lui
   demande de comparer. */
function AtSpecs({ variants, themes, accent, onShow, active }){
  return (
    <div className="at-specs">
      {variants.map((v, i) => (
        <SpecTie key={i} solo={themes.length < 2} wide={v.wide} col={v.col}>
          {themes.map(th => (
            <Spec key={th} theme={th} accent={accent}
                  active={!!active && active.i === i && active.th === th}
                  onShow={onShow ? () => onShow(i, th) : null}>
              {v.node}
            </Spec>
          ))}
        </SpecTie>
      ))}
    </div>
  );
}

/* ---- La fiche d'un élément ------------------------------------------------
   Fermée : la chose, son nom, et le nombre de variantes qu'elle garde pour
   quand on l'ouvrira. Rien d'autre — une vitrine se regarde avant de se lire,
   et la description au repos faisait de chaque fiche un paragraphe à traverser.
   Ouverte : le nom, les variantes côte à côte, puis tout ce qu'on en sait —
   la description tirée de la source, la variante survolée, sa manette, et où
   le composant est déclaré. */
function SpecCard({ entry, variants, themes, accent }){
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(null);
  const first = variants ? variants[0] : null;
  const head = (
    <button className="at-card-h" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
      <span className="at-fold" aria-hidden="true"><ChevronDown /></span>
      <code className="mono at-name">{entry.name}</code>
      <span className="at-card-n mono">{variants ? variants.length : '·'}</span>
    </button>
  );
  const nospec = (
    <p className="at-nospec">
      Pas de spécimen : {entry.family === 'page'
        ? "un écran complet, qui demande un compte et des données."
        : entry.family === 'technique'
          ? "rien à dessiner."
          : "à monter ici dès qu'on saura lui fabriquer ses données."}
    </p>
  );

  if (!open) return (
    <article className="at-card" data-span={first && first.wide ? 2 : 1} id={`atelier-c-${entry.name}`}>
      {variants
        ? <AtSpecs variants={[first]} themes={themes} accent={accent} />
        : <div className="at-specs"><div className="at-spec"><div className="at-stage void" /></div></div>}
      {head}
    </article>
  );

  /* La vignette survolée, ou la première tant qu'on n'a survolé personne : le
     corps d'une carte ouverte ne doit jamais être vide. */
  const i = hov && variants && hov.i < variants.length ? hov.i : 0;
  const th = hov && themes.indexOf(hov.th) !== -1 ? hov.th : themes[0];
  const v = variants ? variants[i] : null;
  const rows = [
    { k:'Description', v: entry.desc, full:true, prose:true },
    { k:'Famille', v: entry.family },
    { k:'Déclinaisons', v: variants ? String(variants.length) : 'aucune' },
    v ? { k:'Variante', v: v.label || '—' } : null,
    v ? { k:'Manette', v: v.code } : null,
    themes.length > 1 ? { k:'Thème', v: themeLabel(th) } : null,
    { k:'Déclaré', v:`${entry.file}:${entry.line}` },
  ];

  return (
    <article className="at-card open" id={`atelier-c-${entry.name}`}>
      {head}
      {variants
        ? <AtSpecs variants={variants} themes={themes} accent={accent}
                   active={{ i, th }} onShow={(vi, vth)=>setHov({ i:vi, th:vth })} />
        : nospec}
      <AtInfo rows={rows} />
    </article>
  );
}

/* ---- Rendre une apparition ------------------------------------------------
   On refabrique l'élément tel que la source l'écrit : son tag, ses classes,
   son contenu. Pas une imitation — le vrai tag avec les vraies classes, donc
   la vraie feuille de style s'y applique, exactement comme dans l'app.

   Ce qu'on met dedans, dans l'ordre de préférence :
     1. le texte littéral trouvé dans la source (« ‹ », « ✕ », « i »)
     2. l'icône que la source y pose, si c'est un composant qu'on sait monter —
        tout vit dans un seul espace de noms, donc `GearIcon` est joignable par
        son nom (voir CLAUDE.md, « un seul espace de noms »)
     3. rien : un conteneur de mise en page n'a pas de contenu, et sa boîte
        vide est précisément ce qu'on veut voir. */
function atIconByName(name){
  try {
    const fn = (typeof window !== 'undefined' && window[name]) || undefined;
    return typeof fn === 'function' ? fn : null;
  } catch(e){ return null; }
}

function Appearance({ item, extra }){
  const cls = item.classes.concat(extra || []).join(' ');
  const props = { className: cls };
  // Un bouton d'atelier ne doit rien déclencher, et ne doit pas non plus
  // envoyer un formulaire fantôme en étant cliqué.
  if (item.tag === 'button') props.type = 'button';
  if (item.tag === 'a') props.href = '#';
  if (item.label) props['aria-label'] = item.label;

  let child = null;
  if (item.content) child = item.content;
  else if (item.icon){
    const Icon = atIconByName(item.icon);
    child = Icon ? React.createElement(Icon, null) : null;
  }
  /* Un conteneur de mise en page n'a pas de contenu littéral, et rendu vide il
     n'a pas de taille non plus : une case blanche, où l'app montre une boîte.
     Ce trait lui rend ce qu'il encadre toujours, sans prétendre être du vrai
     texte — et c'est du chrome d'atelier, préfixé `at-` comme le reste. */
  if (child == null) child = React.createElement('span', { className:'at-ghost' });
  return React.createElement(item.tag, props, child);
}

/* ---- La carte d'une classe de base ----------------------------------------
   Fermée : la forme, et combien de déclinaisons portent ce nom. Ouverte : les
   dix-sept ronds censés être le même rond, posés côte à côte — c'est LA vue
   que cette famille existe pour donner, et une intruse s'y voit en une seconde.

   Chaque ÉTAT compte pour une déclinaison, parce qu'il se regarde comme une
   forme de plus. Mais les états d'une même combinaison restent sur leur fond
   commun : ce sont des variantes d'une chose, pas des choses.

   Le sélecteur — `button.icon-btn.sm` — n'est pas écrit à côté de chaque
   vignette : il s'affiche dans le corps de la carte, pour celle qu'on survole,
   avec le nom humain, le nombre d'usages et les endroits où elle est écrite.
   C'est sous ce nom-là qu'on la retrouvera en inspectant la page. */
function DeclCard({ group, themes, accent }){
  const [open, setOpen] = useState(false);
  const [hov, setHov] = useState(null);
  const first = group.items[0];
  const head = (
    <button className="at-card-h" onClick={()=>setOpen(o=>!o)} aria-expanded={open}>
      <span className="at-fold" aria-hidden="true"><ChevronDown /></span>
      <code className="mono at-name">.{group.base}</code>
      <span className="at-card-n mono">{group.count}</span>
    </button>
  );

  if (!open) return (
    <article className="at-card" id={`atelier-d-${group.base}`}>
      <div className="at-specs">
        <SpecTie solo={themes.length < 2}>
          {themes.map(th => (
            <Spec key={th} theme={th} accent={accent}>
              <Appearance item={first} />
            </Spec>
          ))}
        </SpecTie>
      </div>
      {head}
    </article>
  );

  const hi = hov && group.items[hov.i] ? hov.i : 0;
  const it = group.items[hi];
  const st = hov && hov.i === hi ? hov.st : null;
  const th = hov && themes.indexOf(hov.th) !== -1 ? hov.th : themes[0];
  const rows = [
    { k:'Classe de base', v:'.' + group.base },
    { k:'Déclinaisons', v:String(group.count) },
    { k:'Sélecteur', v: it.tag + it.classes.map(c => '.' + c).join('') + (st ? '.' + st : '') },
    { k:'État', v: st ? '.' + st : 'aucun' },
    { k:'Nom', v: it.label },
    { k:'Occurrences', v: `${it.uses} ${it.uses > 1 ? 'usages' : 'usage'}` },
    { k:'Apparaît', v: it.where.join('   '), full:true },
    themes.length > 1 ? { k:'Thème', v: themeLabel(th) } : null,
  ];

  return (
    <article className="at-card open" id={`atelier-d-${group.base}`}>
      {head}
      <div className="at-specs">
        {group.items.map((item, i) => (
          <SpecTie key={item.key} solo={item.optional.length === 0 && themes.length < 2}>
            {[null].concat(item.optional).map(s => themes.map(t => (
              <Spec key={(s || '·') + t} theme={t} accent={accent}
                    active={i === hi && (st || null) === (s || null) && t === th}
                    onShow={()=>setHov({ i, st:s || null, th:t })}>
                <Appearance item={item} extra={s ? [s] : null} />
              </Spec>
            )))}
          </SpecTie>
        ))}
      </div>
      <AtInfo rows={rows} />
    </article>
  );
}

const themeLabel = (id) => (THEMES.find(t => t.id === id) || {}).label || id;

/* Les familles qui viennent de l'annotation d'un composant. Les trois autres —
   jetons, déclinaisons, classes — se construisent autrement et ont leur propre
   section, d'où cette liste plutôt qu'un filtre par élimination. */
const AT_COMPONENT_FAMS = ['atome','molecule','organisme','modale','page','technique'];

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
  /* Deux listes, pas une. Une couleur se juge d'un coup d'œil, à son rond ;
     un rayon, une police ou une durée se lisent. Mêlées, les secondes se
     perdaient entre cent pastilles et on ne trouvait plus `--radius`. */
  const couleurs = tokens.filter(t => isColor(vals[t] || ''));
  const autres = tokens.filter(t => !isColor(vals[t] || ''));
  const grid = (list) => (
    <div className="at-toks">
      {list.map(t => {
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
  return (
    <div className="at-tok-split" ref={ref}>
      <p className="at-sub-lab">Couleurs <span className="mono">{couleurs.length}</span></p>
      {grid(couleurs)}
      <p className="at-sub-lab">Formes, polices, durées <span className="mono">{autres.length}</span></p>
      {grid(autres)}
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
const AT_OFF_STAGE = /^(at-|atelier$|cursor-|has-cursor|boot-)/;

function useClassCoverage(rootRef, classes, chrome, worn, deps){
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
    const id = setTimeout(measure, 500);
    return () => clearTimeout(id);
  }, deps);

  const kept = classes.filter(cl => !AT_OFF_STAGE.test(cl) && !chrome.has(cl));
  if (!kept.length || !seen) return { morte:[], absente:[], couverte:0, total:kept.length, measure };

  /* Trois seaux, et c'est le croisement des deux inventaires qui les sépare :
     ce que la FEUILLE déclare, ce que l'APP porte, ce que l'ATELIER rend.
       · déclarée mais portée nulle part  → du CSS mort, à supprimer
       · portée mais pas rendue ici       → un trou de cette page
       · rendue                           → couverte
     Avant, tout ce qui manquait était dans le même sac et il fallait aller
     voir soi-même laquelle des deux choses c'était. */
  const morte = kept.filter(cl => !worn.has(cl) && !seen.has(cl));
  const absente = kept.filter(cl => worn.has(cl) && !seen.has(cl));
  return { morte, absente, couverte: kept.length - morte.length - absente.length,
           total: kept.length, measure };
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

  /* La recherche filtre les deux inventaires du même geste : taper « icon »
     doit montrer et les composants et les apparitions qui en parlent. */
  const matchDecl = (g) => !q || (g.base + ' ' + g.items.map(i => i.key + ' ' + (i.label || '')).join(' '))
                                   .toLowerCase().includes(q.toLowerCase());
  const declBases = src.decl.bases.filter(matchDecl);
  /* Deux seaux, et ils ne se regardent pas pareil. Une classe de base qui se
     décline est une FORME PARTAGÉE : ses déclinaisons côte à côte, c'est là
     qu'une intruse se voit. Une classe qui n'existe qu'en un exemplaire n'a
     rien à comparer — elle est là pour l'inventaire, et mêlée aux autres elle
     les noyait sous le nombre. */
  const declMulti = declBases.filter(g => g.count > 1);
  const declSolo = declBases.filter(g => g.count === 1);

  const themes = theme === 'all' ? THEMES.map(t => t.id) : [theme];
  const cover = useClassCoverage(rootRef, src.classes, src.chrome, src.worn, [src.ready, q, theme]);

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
            {/* Les deux inventaires, côte à côte, dès la première ligne : ce sont
                deux façons de compter la même app, et aucune ne se déduit de
                l'autre. 98 composants d'un côté, 412 apparitions de l'autre. */}
            <div className="at-summary">
              <AtCount n={declared.length} label="composants déclarés" />
              <AtCount n={withSpec} label="avec spécimen" />
              <AtCount n={src.decl.variants} label="déclinaisons" />
              <AtCount n={src.decl.bases.length} label="classes de base" />
              <AtCount n={src.tokens.length} label="jetons" />
              <AtCount n={cover.total} label="classes" />
              <AtCount n={orphans.length} label="non déclarés" bad={orphans.length > 0} />
            </div>

            {orphans.length > 0 && (
              <div className="card at-alert" id="atelier-orphelins">
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
                <a key={f.id} className="pill" href={`#atelier-fam-${f.id}`}>
                  {f.label}
                  {counts[f.id] != null && <span className="at-nav-n mono">{counts[f.id]}</span>}
                </a>
              ))}
            </nav>

            {/* ---- Jetons ---- */}
            <section className="at-fam-sec" id="atelier-fam-jeton">
              <h2 className="at-h">Jetons</h2>
              <p className="at-note">{ATELIER_FAMILIES[0].note}</p>
              <article className="at-card open">
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
            </section>

            {/* ---- Déclinaisons (l'axe des apparitions) ---- */}
            <section className="at-fam-sec" id="atelier-fam-declinaison">
              <h2 className="at-h">Déclinaisons <span className="at-h-n mono">{src.decl.variants}</span></h2>
              <p className="at-note">{ATELIER_FAMILIES[1].note}</p>
              <p className="at-sub-lab">
                Formes partagées, plusieurs déclinaisons <span className="mono">{declMulti.length}</span>
              </p>
              <div className="at-grid">
                {declMulti.map(g => (
                  <DeclCard key={g.base} group={g} themes={themes} accent={accent} />
                ))}
              </div>
              <p className="at-sub-lab">
                Écrites une seule fois <span className="mono">{declSolo.length}</span>
              </p>
              <div className="at-grid">
                {declSolo.map(g => (
                  <DeclCard key={g.base} group={g} themes={themes} accent={accent} />
                ))}
              </div>
            </section>

            {/* ---- Les familles de composants ---- */}
            {ATELIER_FAMILIES.filter(f => AT_COMPONENT_FAMS.indexOf(f.id) !== -1).map(f => (
              <section className="at-fam-sec" key={f.id} id={`atelier-fam-${f.id}`}>
                <h2 className="at-h">{f.label} <span className="at-h-n mono">{(byFamily[f.id] || []).length}</span></h2>
                <p className="at-note">{f.note}</p>
                {(byFamily[f.id] || []).length === 0 ? (
                  <div className="empty"><span className="em-serif">Rien ici pour cette recherche.</span></div>
                ) : (
                  <div className="at-grid">
                    {(byFamily[f.id] || []).map(entry => (
                      <SpecCard key={entry.file + entry.name} entry={entry}
                        variants={specimens[entry.name] || null} themes={themes} accent={accent} />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {/* ---- Classes ---- */}
            <section className="at-fam-sec" id="atelier-fam-classe">
              <h2 className="at-h">Classes <span className="at-h-n mono">{cover.total}</span></h2>
              <p className="at-note">{ATELIER_FAMILIES[ATELIER_FAMILIES.length-1].note}</p>
              <div className="card">
                <p className="at-desc">
                  <b>{cover.couverte}</b> des <b>{cover.total}</b> classes de la feuille sont rendues quelque part
                  sur cette page. Les autres se divisent en deux, et la différence commande deux gestes opposés :
                  ce que l'app porte sans que l'atelier le montre est un trou <em>de cette page</em> ; ce que
                  personne ne porte est du CSS à supprimer.
                  {' '}<button className="fd-link" onClick={cover.measure}>Recompter</button>
                </p>

                <p className="at-sub-lab">
                  Portées par l'app, pas montrées ici <span className="mono">{cover.absente.length}</span>
                </p>
                <div className="at-classes">
                  {cover.absente.map(cl => <code className="mono" key={cl}>.{cl}</code>)}
                </div>

                <p className="at-sub-lab">
                  Déclarées, portées nulle part <span className="mono">{cover.morte.length}</span>
                </p>
                <p className="at-desc at-desc-sm">
                  Aucun <code className="mono">className=</code> de l'app ne les nomme, aucun JS ne les pose.
                  Restent les fausses pistes : une classe construite par un calcul que la lecture ne sait pas
                  suivre, ou posée par une bibliothèque. À vérifier une par une avant de couper.
                </p>
                <div className="at-classes">
                  {cover.morte.map(cl => <code className="mono dead" key={cl}>.{cl}</code>)}
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
