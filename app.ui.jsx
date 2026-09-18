/* ============================================================
   app.ui.jsx — les briques d'interface partagées
   ------------------------------------------------------------
   Les contrôles que toute l'app réutilise, décrits dans
   `.claude/notes/ui.md` : `Segmented` (le seul mécanisme de
   bascule), `BoolPill`, `IconBar`, `GearIcon`, `InfoBubble`,
   `SwatchGrid` et `ColorEditor`, plus les briques que l'atelier
   montre au même titre — `NumPill`, `ChevronDown`, `DragHandle`
   et la machinerie de glisser-déposer (`useDragReorder`).

   Chargé après app.core.jsx et avant app.charts.jsx : les cartes
   de graphe portent un `GearIcon` et une `DragHandle`.

   Piège : `Segmented` est le SEUL reste d'objet (`{ …, ...rest }`)
   statique de l'app, donc le seul `_excluded` que Babel émette.
   En déclarer un second dans un fichier chargé plus tard le
   ferait mentir (voir `.claude/notes/pieges.md`).
   ============================================================ */

/* Small "i" button that reveals an explanation only when clicked. */
// Global on/off for the "i" explainer bubbles. A context because InfoBubble is used
// from many unrelated, deeply nested components (modals, cards…) — threading a prop
// through every one of them would touch nearly every component signature in the file,
// and more call sites are coming later, per Louis.
/* @atelier technique — L’interrupteur des bulles infos, lu par chaque InfoBubble. */
const InfoVisibilityContext = React.createContext(true);

/* Une explication vit derrière un « i », partout, sans exception : c'est ce que
   dit le réglage « Bulles infos » des paramètres, et une page qui écrirait
   quand même ses descriptions en clair lui donnerait tort. Elles étaient
   inline dans les paramètres à une époque (un composant `Help`) ; l'interrupteur
   parlait alors de deux choses à la fois.

   `always` est l'exception délibérée : une bulle qui ne porte pas une
   explication — le crédit que la licence d'Open Food Facts impose, ou la bulle
   de l'interrupteur lui-même, seule porte pour rallumer les autres — ne doit
   pas disparaître avec l'interrupteur. */
/* @atelier molecule — La seule forme d’explication : un « i » qui déplie un cadre dans la page, sous ce qu’il explique. */
function InfoBubble({ children, title, always = false }){
  const infoEnabled = useContext(InfoVisibilityContext);
  const [open, setOpen] = useState(false);
  if (!infoEnabled && !always) return null;
  return (
    <>
      <button type="button" className={`icon-btn sm info-btn ${open?'on':''}`}
              onClick={()=>setOpen(o=>!o)} aria-expanded={open}
              aria-label={open ? "Masquer l'explication" : "Plus d'infos"}>i</button>
      {/* Le cadre est toujours dans le DOM, replié à zéro : c'est ce qui permet
          de l'animer dans les deux sens (grid-template-rows 0fr → 1fr, la seule
          façon d'animer vers une hauteur automatique). Il occupe une ligne
          entière de son conteneur — d'où `flex:1 0 100%` — et pousse donc ce
          qui suit au lieu de le recouvrir. */}
      <span className={`info-panel ${open?'open':''}`} aria-hidden={!open}>
        <span className="info-panel-in">
          <span className="info-panel-box">
            {title && <span className="info-panel-t">{title}</span>}
            <span className="info-panel-b">{children}</span>
          </span>
        </span>
      </span>
    </>
  );
}
// The one gear in the app. Every "open the settings of this thing" button wears
// it — day cards, chart cards, calendar cards, grid tiles, master strips, food
// goals — so the geste is recognisable before the label is read. Defined once:
// the earlier per-call SVGs had drifted into a spoked circle that read as a sun.
/* @atelier atome — Le seul engrenage de l’app : « ouvre les réglages de cette chose ». */
function GearIcon({ size = 13 }){
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.83,3.14L7.15,1.66L8.85,1.66L9.17,3.14A5,5 0 0 1 10.61,3.74L11.88,2.91L13.09,4.12L12.26,5.39A5,5 0 0 1 12.86,6.83L14.34,7.15L14.34,8.85L12.86,9.17A5,5 0 0 1 12.26,10.61L13.09,11.88L11.88,13.09L10.61,12.26A5,5 0 0 1 9.17,12.86L8.85,14.34L7.15,14.34L6.83,12.86A5,5 0 0 1 5.39,12.26L4.12,13.09L2.91,11.88L3.74,10.61A5,5 0 0 1 3.14,9.17L1.66,8.85L1.66,7.15L3.14,6.83A5,5 0 0 1 3.74,5.39L2.91,4.12L4.12,2.91L5.39,3.74A5,5 0 0 1 6.83,3.14Z"/>
      <circle cx="8" cy="8" r="2.2"/>
    </svg>
  );
}

// The one toggle mechanism in the app: a track of buttons with a background
// that *slides* to whichever carries `.on`, measured for real in the DOM
// rather than each button independently swapping its own background. Every
// segmented control in Tracklog — Jour/Historique/Chrono, a tracker's type,
// Oui/Non — renders through this, so "the sliding one" is the only kind.
//
// Deliberately dumb: callers keep writing their own <button className={x===id?'on':''}>
// list exactly as before. Segmented only wraps them, watches its own DOM after
// each render for whichever child carries `.on`, and positions `.seg-thumb`
// under it. That's what makes migrating every existing toggle a one-line change
// instead of a rewrite: nothing about the buttons themselves has to change.
//
// Three sizes carry real, deliberate differences — not leftover drift:
//   (default) sentence-case option chips, each with its own outline — a modal's
//     "Une / jour" / "Plusieurs / jour". Long phrasing stays readable in this size.
//   compact   uppercase nav pills sharing one track — Jour/Historique/Chrono,
//     Graphes/Calendrier/Grille. Short, tracked-out labels only.
//   small     the same compact track, one notch down — rail sort, library tabs,
//     the chart density row (icon-bearing buttons welcome).
// `wrap` lets a track break onto a second line instead of overflowing.
// `scrollx` is the other answer to "too many options for one row": it keeps
// a single line and lets it scroll horizontally instead — for a short,
// exclusive choice (which meal, which mode) where a second line reads as
// broken and a dropdown would hide options that should stay one tap away.
/* @atelier atome — La seule bascule : un fond qui glisse jusqu’à l’option active. Trois tailles, deux réponses au débordement. */
function Segmented({ size, wrap, scrollx, className = '', children, ...rest }){
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);

  // Écrire le même rectangle qu'on tient déjà redéclenche un rendu qui
  // redéclenche cet effet — sans la garde d'égalité, une boucle infinie
  // (React coupe court avec « Maximum update depth exceeded »).
  const measure = () => {
    const track = ref.current;
    // `.on`, pas `button.on` : une option peut être autre chose qu'un bouton dès
    // qu'elle porte une saisie (la valeur cible s'écrit DANS son option, qui
    // s'élargit alors — un <input> dans un <button> ne se laisse pas taper).
    const active = track && track.querySelector(':scope > .on');
    if (!track || !active){
      setThumb(prev => prev === null ? prev : null);
      return;
    }
    // offsetLeft/Top are already relative to the nearest positioned ancestor's
    // padding box — exactly the containing block a `position:absolute` child
    // uses. Diffing two getBoundingClientRect() calls instead looked close but
    // was off by the track's own border width (the thumb landed 1px down-right
    // of the button it was supposed to sit under).
    const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
    setThumb(prev => (prev && prev.left === next.left && prev.top === next.top
      && prev.width === next.width && prev.height === next.height) ? prev : next);
    // `scrollx` : l'option choisie doit être visible sans geste — si elle
    // tombe hors de la fenêtre visible (ex. « Dîner » sélectionné par défaut,
    // rangé en bout de piste), on la ramène dans le cadre plutôt que de
    // forcer l'utilisateur à deviner qu'il faut glisser pour la voir.
    if (scrollx){
      const tb = track.getBoundingClientRect(), ab = active.getBoundingClientRect();
      if (ab.left < tb.left) track.scrollLeft -= (tb.left - ab.left) + 8;
      else if (ab.right > tb.right) track.scrollLeft += (ab.right - tb.right) + 8;
    }
  };

  useLayoutEffect(measure);

  useEffect(() => {
    const track = ref.current;
    if (!track || !window.ResizeObserver) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={`seg-track ${size ? size : ''} ${wrap ? 'wrap' : ''} ${scrollx ? 'scrollx' : ''} ${className}`} role="group" {...rest}>
      {thumb && <span className="seg-thumb" style={{
        transform: `translate(${thumb.left}px, ${thumb.top}px)`, width: thumb.width, height: thumb.height,
      }} aria-hidden="true" />}
      {children}
    </div>
  );
}

// Oui/Non is just a two-option Segmented — kept as its own component because
// callers ask for it by value/onChange, not by rendering the two buttons themselves.
/* @atelier atome — Oui / Non — un Segmented à deux options, demandé par valeur plutôt que par ses deux boutons. */
function BoolPill({ value, onChange, onLabel = 'Oui', offLabel = 'Non', disabled = false }){
  return (
    <Segmented size="compact" className={disabled ? 'disabled' : ''}>
      <button type="button" className={value ? 'on' : ''} aria-pressed={value} disabled={disabled} onClick={()=>onChange(true)}>{onLabel}</button>
      <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} disabled={disabled} onClick={()=>onChange(false)}>{offLabel}</button>
    </Segmented>
  );
}
// Barre à icône — the other shared control shape, next to Segmented: one
// full-width bar carrying the main input, and exactly one round icon button
// for the second way of filling it. Two forms, and the difference is meaning,
// not decoration:
//   inset     the button sits INSIDE the bar, sharing its outline — the button
//             is another way to fill the same field (a search bar and its
//             scanner: both end up putting a product in that field).
//   detached  the button sits BESIDE the bar — the bar shows something, the
//             button acts on what it shows (a Aliments/Repas toggle and the
//             star that narrows either one to favourites).
// Sizing and the round button come from `.icon-btn`, like every other lone
// glyph in the app; only the bar shell is new.
/* @atelier molecule — La seule barre à bouton — inset, le bouton remplit le même champ ; detached, il agit sur ce que la barre montre. */
function IconBar({ detached = false, className = '', children, buttons,
                   icon, onIcon, iconLabel, iconTitle, iconOn = false, iconDisabled = false }){
  // Un bouton reste le cas courant, et `icon`/`onIcon`… le disent le plus
  // simplement. Mais une barre `detached` peut légitimement en porter deux —
  // ils agissent tous sur ce qu'elle montre (l'étoile réduit aux favoris, le
  // second montre ou cache les vignettes) — d'où la liste, dont le cas à un
  // bouton n'est que le raccourci.
  const list = buttons || (icon
    ? [{ icon, onClick:onIcon, label:iconLabel, title:iconTitle, on:iconOn, disabled:iconDisabled }]
    : []);
  return (
    <div className={`icon-bar ${detached ? 'detached' : 'inset'} ${className}`}>
      <div className="icon-bar-field">{children}</div>
      {list.map((b, i) => (
        <button key={i} type="button" className={`icon-btn icon-bar-btn ${b.on ? 'on' : ''}`}
                onClick={b.onClick} disabled={b.disabled} aria-pressed={!!b.on}
                aria-label={b.label} title={b.title || b.label}>
          {b.icon}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   Drag-to-reorder — like rearranging apps on a phone home screen.
   ------------------------------------------------------------
   Trackers carry a single global `order`. Any list here only ever shows a
   subset (daily-only, archived-only, the filter rail…), so a reorder inside
   a subset is spliced back into the full order in place — untouched
   trackers elsewhere never move. See mergeSubOrder / useDragReorder below,
   reused by every reorderable list (rail pills, day cards, tracker cards,
   master strips, chart cards).
   ============================================================ */
function mergeSubOrder(fullIds, newSubOrder){
  const subSet = new Set(newSubOrder);
  const rest = [];
  let insertAt = -1;
  fullIds.forEach((id) => {
    if (subSet.has(id)){ if (insertAt === -1) insertAt = rest.length; }
    else rest.push(id);
  });
  if (insertAt === -1) insertAt = rest.length;
  const merged = rest.slice();
  merged.splice(insertAt, 0, ...newSubOrder);
  return merged;
}

// A single highlight bar shared by every reorderable list. It is mounted once
// (<DropIndicatorMount/> in App) and parked, imperatively, in the gap where the
// dragged card would land. Using one fixed-position element keeps positioning in
// viewport coordinates (matches pointer clientX/Y) regardless of scroll/layout.
const dropIndicator = { el: null };
/* @atelier technique — Le trait de dépôt, monté une seule fois et déplacé à la main pendant un glisser. */
function DropIndicatorMount(){
  const ref = useRef(null);
  useEffect(() => {
    dropIndicator.el = ref.current;
    return () => { dropIndicator.el = null; };
  }, []);
  return <div ref={ref} className="drop-indicator" aria-hidden="true" />;
}
function hideDropIndicator(){ if (dropIndicator.el) dropIndicator.el.style.display = 'none'; }
// Two rects sit on the same visual row when they overlap vertically.
function sameRow(a, b){ return a.top < b.bottom && b.top < a.bottom; }

// Pointer-based (mouse + touch) reorder. While dragging, NOTHING in the list
// moves: the picked card simply follows the finger/cursor (imperative transform)
// and a highlight bar marks the target gap. The reorder is committed once, on
// drop. This avoids re-rendering the list on every move — which is what used to
// replay the page-load entrance animation and make the dragged card vanish.
/* @atelier technique — Le glisser-déposer maison, en pointer events : un ordre, un index de dépôt. */
function useDragReorder(ids, onReorder){
  const idsKey = ids.join('|');
  const [order, setOrder] = useState(ids);
  const [dragId, setDragId] = useState(null);
  const nodesRef = useRef({});
  const orderRef = useRef(order);
  const dragIdRef = useRef(null);
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const insRef = useRef(0);
  // Un appui long qui arme le glisser ne doit pas, au relâchement, valider aussi
  // le clic de l'élément (une pastille du rail bascule le filtre au clic).
  const armedRef = useRef(false);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    setOrder(prev => {
      // Ce qu'on avait rangé à la main garde son ordre ; ce qui apparaît reprend
      // la place que la liste d'entrée lui donne. On parcourt donc `ids` et on y
      // reverse les anciens dans leur ordre à eux, les nouveaux tels quels —
      // plutôt que d'empiler les nouveaux à la fin. Sans ça, un onglet masqué
      // puis rallumé revenait en bout de barre au lieu de retrouver son créneau.
      const idsSet = new Set(ids);
      const prevSet = new Set(prev);
      const kept = prev.filter(id => idsSet.has(id));
      let k = 0;
      const next = ids.map(id => prevSet.has(id) ? kept[k++] : id);
      orderRef.current = next;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const setNodeRef = (id) => (el) => {
    if (el) nodesRef.current[id] = el; else delete nodesRef.current[id];
  };

  // Une fois le glisser armé, le doigt pilote la carte : ce blocage annule le
  // défilement que `touch-action:pan-y` autoriserait encore. Non passif, et posé
  // alors que le doigt est encore immobile — le seul moment où preventDefault
  // empêche encore un défilement de démarrer.
  const blockScroll = useRef((e) => { if (e.cancelable) e.preventDefault(); }).current;

  const handleMove = useRef((e) => {
    const id = dragIdRef.current;
    if (id == null) return;
    movedRef.current = true;
    // Le doigt (ou la souris) a bougé : c'est un glisser, et le clic qui suivra
    // le relâchement n'en est pas un. Voir `armedRef` plus haut.
    armedRef.current = true;
    if (e.cancelable) e.preventDefault();
    const px = e.clientX, py = e.clientY;

    // The dragged card tracks the pointer; everything else stays put.
    const dragNode = nodesRef.current[id];
    if (dragNode){
      dragNode.style.transform =
        `translate(${px - startRef.current.x}px, ${py - startRef.current.y}px) scale(1.03)`;
    }

    // Where would it drop? Insertion index in reading order (row by row, L→R).
    const others = orderRef.current
      .filter(x => x !== id)
      .map(x => { const n = nodesRef.current[x]; return { r: n && n.getBoundingClientRect() }; })
      .filter(o => o.r);
    if (!others.length){ insRef.current = 0; hideDropIndicator(); return; }

    let ins = others.length;
    for (let i = 0; i < others.length; i++){
      const r = others[i].r;
      const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      const rowTol = r.height * 0.5;
      if ((py < cy - rowTol) || (Math.abs(py - cy) <= rowTol && px < cx)){ ins = i; break; }
    }
    insRef.current = ins;

    // Park the highlight bar in that gap (viewport coords).
    const el = dropIndicator.el;
    if (!el) return;
    const T = 3, G = 7; // bar thickness, offset at the list ends
    let bar;
    if (ins > 0 && ins < others.length){
      const a = others[ins - 1].r, b = others[ins].r;
      if (sameRow(a, b)){
        const top = Math.min(a.top, b.top), bot = Math.max(a.bottom, b.bottom);
        bar = { left: (a.right + b.left) / 2 - T / 2, top, width: T, height: bot - top };
      } else {
        const left = Math.min(a.left, b.left), right = Math.max(a.right, b.right);
        bar = { left, top: (a.bottom + b.top) / 2 - T / 2, width: right - left, height: T };
      }
    } else if (ins === 0){
      const b = others[0].r;
      const multi = others.some((o, i) => i !== 0 && sameRow(o.r, b) && o.r.left > b.left);
      bar = multi ? { left: b.left - G - T / 2, top: b.top, width: T, height: b.height }
                  : { left: b.left, top: b.top - G - T / 2, width: b.width, height: T };
    } else {
      const a = others[others.length - 1].r;
      const multi = others.some((o, i) => i !== others.length - 1 && sameRow(o.r, a) && o.r.left < a.left);
      bar = multi ? { left: a.right + G - T / 2, top: a.top, width: T, height: a.height }
                  : { left: a.left, top: a.bottom + G - T / 2, width: a.width, height: T };
    }
    el.style.display = 'block';
    el.style.left = bar.left + 'px';
    el.style.top = bar.top + 'px';
    el.style.width = bar.width + 'px';
    el.style.height = bar.height + 'px';
  }).current;

  const handleUp = useRef(() => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleUp);
    window.removeEventListener('touchmove', blockScroll);
    // `armedRef` neutralise le clic qui suit le relâchement ; on le rend au tour
    // d'après plutôt que d'attendre le prochain pointerdown, sinon un clic qui
    // n'en est pas précédé (clavier, appel programmatique) resterait avalé.
    setTimeout(() => { armedRef.current = false; }, 0);
    document.body.classList.remove('dragging-reorder');
    hideDropIndicator();

    const id = dragIdRef.current;
    const dragNode = id != null ? nodesRef.current[id] : null;
    if (dragNode) dragNode.style.transform = '';

    if (id != null && movedRef.current){
      const others = orderRef.current.filter(x => x !== id);
      const ins = Math.max(0, Math.min(insRef.current, others.length));
      const next = others.slice();
      next.splice(ins, 0, id);
      const changed = next.some((x, i) => x !== orderRef.current[i]);
      if (changed){
        // The commit reflows the list; suppress the entrance animation so the
        // reordered cards don't replay the page-load "riseIn".
        document.body.classList.add('reordering');
        setTimeout(() => document.body.classList.remove('reordering'), 400);
        orderRef.current = next;
        setOrder(next);
        onReorderRef.current(next);
      }
    }
    dragIdRef.current = null;
    movedRef.current = false;
    setDragId(null);
  }).current;

  // Au doigt, un glisser ne s'arme qu'après un appui maintenu — sinon le simple
  // fait de faire défiler la page en posant le doigt sur une carte la déplaçait.
  // Pendant l'attente on ne bloque rien : si le doigt part avant la fin, c'est
  // un défilement (ou un tap), et le glisser n'a jamais lieu. À la souris il n'y
  // a pas de défilement à confondre avec un glisser : il reste immédiat.
  const HOLD_MS = 350;
  const HOLD_SLOP = 9;   // px de tolérance : un doigt ne tient jamais parfaitement immobile
  const holdRef = useRef(null);

  const cancelHold = useRef(() => {
    if (holdRef.current?.timer) clearTimeout(holdRef.current.timer);
    if (holdRef.current?.cleanup) holdRef.current.cleanup();
    holdRef.current = null;
  }).current;

  // `armed` = ce geste a déjà consommé le clic à venir. C'est vrai d'un appui
  // long au doigt dès qu'il a tenu (le relâcher ne doit rien déclencher d'autre),
  // mais pas d'un simple clic de souris : à la souris, le glisser s'arme dès le
  // pointerdown, et considérer tout de suite le clic comme avalé rendait muettes
  // les pastilles du rail — cliquer pour filtrer ne faisait plus rien. Le clic ne
  // devient un glisser qu'à partir du moment où ça bouge (voir handleMove).
  const beginDrag = (id, x, y, armed = false) => {
    dragIdRef.current = id;
    movedRef.current = false;
    startRef.current = { x, y };
    insRef.current = Math.max(0, orderRef.current.indexOf(id));
    setDragId(id);
    armedRef.current = armed;
    document.body.classList.add('dragging-reorder');
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    window.addEventListener('touchmove', blockScroll, { passive: false });
  };

  const startDrag = (id) => (e) => {
    if (e.button != null && e.button !== 0) return;
    armedRef.current = false;
    if (e.pointerType !== 'touch'){
      // preventDefault empêche la sélection de texte pendant le glisser.
      if (e.cancelable) e.preventDefault();
      beginDrag(id, e.clientX, e.clientY);
      return;
    }

    // Ni preventDefault ni écouteur bloquant ici : le navigateur doit rester
    // libre de faire défiler tant que l'appui n'a pas tenu.
    cancelHold();
    const x0 = e.clientX, y0 = e.clientY;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - x0) > HOLD_SLOP || Math.abs(ev.clientY - y0) > HOLD_SLOP) cancelHold();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cancelHold);
      window.removeEventListener('pointercancel', cancelHold);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', cancelHold);
    window.addEventListener('pointercancel', cancelHold);
    holdRef.current = {
      cleanup,
      timer: setTimeout(() => {
        cleanup();
        holdRef.current = null;
        // Une petite vibration dit « c'est attrapé » — sans elle, rien ne
        // distingue un appui trop court d'un appui assez long.
        try { navigator.vibrate?.(12); } catch {}
        beginDrag(id, x0, y0, true);
      }, HOLD_MS),
    };
  };

  // Un démontage en pleine attente laisserait le minuteur armer un glisser sur
  // une carte qui n'est plus là.
  useEffect(() => cancelHold, [cancelHold]);

  // Without a reorder handler (the list is under an automatic sort) dragging would
  // fight the sort, so hand back inert controls: `startDrag` yielding null also
  // removes the grip, since cards only draw one when given a handler.
  if (!onReorder) return { order: ids, dragId: null, setNodeRef: () => undefined, startDrag: () => null, wasArmed: () => false };
  return { order, dragId, setNodeRef, startDrag, wasArmed: () => armedRef.current };
}

// Small grip handle that starts a drag. Kept separate from the rest of a
// card so it never steals clicks from buttons/inputs inside it.
/* @atelier atome — La poignée qui arme un glisser, tenue à l’écart des boutons de la carte. */
function DragHandle({ onPointerDown, dragging }){
  return (
    <span className={`drag-handle ${dragging?'dragging':''}`} onPointerDown={onPointerDown} aria-label="Réordonner" title="Maintenir puis glisser pour réordonner">
      <svg width="9" height="15" viewBox="0 0 9 15"><circle cx="2.2" cy="2.2" r="1"/><circle cx="6.8" cy="2.2" r="1"/><circle cx="2.2" cy="7.5" r="1"/><circle cx="6.8" cy="7.5" r="1"/><circle cx="2.2" cy="12.8" r="1"/><circle cx="6.8" cy="12.8" r="1"/></svg>
    </span>
  );
}
// Une pastille de saisie numérique — la même `.pill` que le rail et les
// nuanciers de couleur, pour que la valeur cible et l'échelle ne soient plus
// les seules boîtes à bordure carrée de la page. Le comportement (parsing,
// bornes) reste entièrement à l'appelant : ceci n'habille qu'un input.
/* Le nuancier de l'app : les neutres en tête, puis les quatre paliers de
   luminosité des douze teintes. Un seul composant pour la couleur d'un tracker
   et pour l'accent de l'app — ce sont les mêmes couleurs, choisies de la même
   façon, et deux grilles jumelles auraient dérivé l'une de l'autre.
   `extra` ajoute une pastille au bout (« la couleur de Tracklog » dans les
   paramètres) sans que la grille ait à connaître ce qu'elle veut dire. */
/* @atelier molecule — Le nuancier : les mêmes couleurs pour un tracker et pour l’accent de l’app. */
function SwatchGrid({ value, onChange }){
  const [editing, setEditing] = useState(false);
  const custom = value && !COLORS.includes(value);
  return (
    <div className="swatch-grid">
      <div className="swatch-row">
        {COLORS.map(c => (
          <button key={c} type="button" className={`swatch ${value===c?'on':''}`} style={{background:c}}
                  onClick={()=>{ onChange(c); setEditing(false); }} aria-label={`Couleur ${c}`} />
        ))}
        {/* Le « + » est un rond comme les autres : dix ronds font une ligne, un
            bouton d'une autre forme au bout en ferait neuf et un intrus. */}
        <button type="button" className={`swatch swatch-custom ${editing||custom?'open':''}`}
                onClick={()=>setEditing(v=>!v)} aria-expanded={editing}
                style={custom ? { background:value } : undefined}
                title={custom ? 'Couleur personnalisée' : 'Composer une couleur'}
                aria-label={custom ? 'Couleur personnalisée' : 'Composer une couleur'}>
          {!custom && '+'}
        </button>
      </div>
      {editing && <ColorEditor value={value} onChange={onChange} />}
    </div>
  );
}

/* L'éditeur : trois curseurs pour composer n'importe quelle couleur, plus la
   pipette du système pour en coller une exacte. Les curseurs parlent OKLCH
   comme le reste du nuancier — c'est ce qui fait qu'une teinte déplacée garde
   la même intensité perçue, ce que HSL ne promet pas. La pipette, elle, rend un
   hexadécimal : on le garde tel quel, une couleur reste une chaîne CSS. */
/* @atelier molecule — Trois curseurs OKLCH et la pipette système, pour une couleur hors nuancier. */
function ColorEditor({ value, onChange }){
  const parsed = useMemo(() => {
    const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(value || '');
    return m ? { l:parseFloat(m[1]), c:parseFloat(m[2]), h:parseFloat(m[3]) }
             : { l:COLOR_LIGHT, c:COLOR_CHROMA, h:35 };
  }, [value]);
  const [hsl, setHsl] = useState(parsed);
  // Une pastille cliquée pendant que l'éditeur est ouvert doit y être reprise,
  // sinon le premier mouvement de curseur repartirait de l'ancienne couleur.
  const seen = useRef(value);
  if (seen.current !== value){ seen.current = value; if (parsed.h !== hsl.h || parsed.l !== hsl.l || parsed.c !== hsl.c) setHsl(parsed); }

  const emit = (next) => { setHsl(next); onChange(`oklch(${next.l.toFixed(2)} ${next.c.toFixed(3)} ${Math.round(next.h)})`); };
  const track = (kind) => {
    if (kind === 'h') return 'linear-gradient(to right,' + [0,60,120,180,240,300,360].map(h=>`oklch(${COLOR_LIGHT} ${COLOR_CHROMA} ${h})`).join(',') + ')';
    if (kind === 'c') return `linear-gradient(to right, oklch(${hsl.l} 0 ${hsl.h}), oklch(${hsl.l} 0.37 ${hsl.h}))`;
    return `linear-gradient(to right, oklch(0 0 0), oklch(${hsl.l.toFixed(2)} ${hsl.c} ${hsl.h}), oklch(1 0 0))`;
  };
  const row = (kind, label, min, max, step, val) => (
    <label className="ce-row">
      <span className="ce-lab">{label}</span>
      <input type="range" min={min} max={max} step={step} value={val}
             style={{'--track': track(kind)}}
             onChange={e=>emit({ ...hsl, [kind === 'h' ? 'h' : kind === 'c' ? 'c' : 'l']: parseFloat(e.target.value) })} />
      <span className="ce-val mono">{kind === 'h' ? `${Math.round(val)}°` : Math.round(val * 100) + '%'}</span>
    </label>
  );

  return (
    <div className="color-editor">
      <div className="ce-preview" style={{background:value}} aria-hidden="true"></div>
      <div className="ce-rows">
        {row('h', 'Teinte',     0, 360, 1,    hsl.h)}
        {row('c', 'Saturation', 0, 0.37, 0.005, hsl.c)}
        {row('l', 'Luminosité', 0, 1,   0.01, hsl.l)}
        <label className="ce-row ce-hex">
          <span className="ce-lab">Pipette</span>
          <span className="ce-val">une couleur exacte</span>
          <input type="color" onChange={e=>onChange(e.target.value)} aria-label="Choisir une couleur exacte" />
        </label>
      </div>
    </div>
  );
}
/* @atelier atome — Une pastille qui contient un nombre ; le parsing et les bornes restent à l’appelant. */
function NumPill({ label, value, onChange, unit, placeholder, min, style }){
  return (
    <label className="pill num-pill" style={style}>
      <span className="np-lab">{label}</span>
      <input type="number" step="any" min={min} value={value} placeholder={placeholder} onChange={onChange} />
      {unit && <span className="np-unit">{unit}</span>}
    </label>
  );
}

/* @atelier atome — Le chevron de repli, partagé par tout ce qui se déplie. */
function ChevronDown(){
  return <svg width="9" height="6" viewBox="0 0 9 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1L4.5 5L8 1"/></svg>;
}
