# Briques d'interface de Tracklog

Les contrôles partagés de l'app : leur forme, et la raison de cette forme.
**À ouvrir avant de dessiner un contrôle, une carte ou une rangée de réglage** —
la plupart des questions ont déjà une réponse ici, et `#sink` (l'atelier) les
montre toutes côte à côte.

Règle d'ensemble : **on réutilise la brique, on n'en refait pas une variante.**
Chaque entrée ci-dessous existe parce que trois endroits avaient divergé.

## Bascules — `Segmented`

- **`Segmented` (app.jsx) est le seul mécanisme de bascule de l'app.** Jour/Historique/Chrono, Oui/Non, le type d'un tracker, Graphes/Calendrier/Grille — tout y passe, plutôt qu'un CSS qui swappe un fond en place.
- **Le fond glisse, il ne saute pas.** `.seg-thumb` se déplace jusqu'à l'option portant `.on`, mesuré en JS via `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight` du bouton actif — **pas** `getBoundingClientRect()` : la différence de deux rects inclut la bordure de la piste et décale le thumb d'un pixel.
- **Migrer un ancien `<div className="vue-mode">` est un remplacement de balise à l'identique.** `Segmented` ne réclame aucun changement aux `<button>` qu'il enveloppe : il regarde lequel porte `.on` après chaque rendu. `.on`, **pas** `button.on` — une option peut être un `<label class="seg-opt">` quand elle porte sa propre saisie (la valeur cible de `TrackerModal`, qui s'élargit une fois choisie plutôt que d'ouvrir une ligne de plus).
- **Trois tailles nommées, pas des variantes accidentelles.** Par défaut : des chips à leur propre contour, texte en minuscule — les options d'une modale. `size="compact"` : piste unique en capitales tassées — la nav principale. `size="small"` : la même piste, un cran plus petit — tri du rail, onglets, densité des graphes.
- **`BoolPill` est un `Segmented` à deux options** (`size="compact"`). Ne pas réintroduire d'`<input type="checkbox">` pour un réglage binaire.
- **Deux réponses à « trop d'options pour une ligne », pas une.** `wrap` repasse à la ligne (le rail, un réglage à cocher). `scrollx` garde une ligne et la fait glisser au doigt — pour un choix court et exclusif qui doit rester entièrement à un tap (repas, mode d'ajout, tabs de la page d'ajout) : une deuxième ligne avec un seul bouton dessus a l'air cassée, un menu déroulant cacherait des options qui doivent rester visibles. `scrollx` recentre aussi l'option choisie dans la fenêtre visible (`measure()`), pour qu'un défaut en bout de piste (« Dîner ») ne soit pas hors champ.

## Mise en page d'un réglage

- **Une rangée se replie au plus tard, pas par principe.** L'ordre voulu : intitulé + contrôle + bulle sur une ligne ; sinon contrôle et bulle **ensemble** sur la ligne suivante, pleine largeur. C'est `flex-shrink:0` sur `.ctl-with-info` qui l'obtient — il ne peut pas se comprimer, donc il tient tant qu'il y a la place et bascule sinon. Les rangées du `TrackerModal` portent `spread` pour la même raison : sans ça leur piste glissait au lieu de descendre prendre toute la largeur.
- **Une piste compacte ne passe JAMAIS sur deux lignes.** Son fond glissant n'a aucun sens replié, et une bascule sur deux lignes se lit comme un bug. Trois remèdes, dans cet ordre : (1) rendre au contrôle toute la largeur — une `.field.spread` ne se replie que quand il n'y a plus la place ; (2) `scrollx`, dont les options remplissent la largeur disponible (`flex:1 0 auto`) et qui ne glisse que quand elles la dépassent ; (3) en dernier recours, réécrire les mots. `.seg-track.compact/.small` porte de toute façon `overflow-x:auto` en filet de sécurité. Seules les options par défaut — des chips à leur propre contour, `Segmented wrap` — ont le droit de passer à la ligne.
- **Un formulaire long s'empile en cartes** (`.card.fd-card`) plutôt qu'en un seul bloc à filets : c'est ce que fait chaque sous-mode de l'onglet Créer.

## Barres et boutons

- **`IconBar` (app.jsx) est l'autre forme de contrôle partagée** : une barre pleine largeur et **un** bouton rond. Deux formes, et la différence est un sens, pas une décoration. `inset` — le bouton est **dans** la barre, sous le même contour, parce qu'il ne fait que la remplir autrement (la recherche et son scanner ; le champ code-barres de l'ajout à la main, où le bouton n'ajoute qu'une seconde façon d'écrire le même champ). `detached` — le bouton est **à côté** : la barre montre quelque chose, le bouton agit dessus (la bascule Aliments/Repas et l'étoile qui la filtre). La forme suit le sens, pas l'écran où le composant se trouve.
- Poser un `<input>` et un `.icon-btn` côte à côte à la main referait la même chose en moins bien. En forme `detached`, une saisie nue reçoit le contour de la barre (`.icon-bar.detached>.icon-bar-field>input`) ; un contenu qui a déjà le sien — un `Segmented` — n'en reçoit pas.
- **`.icon-btn` est le seul rond à icône ou glyphe seul.** Engrenage d'une carte, flèche du calendrier, croix de suppression, lien source : la forme (cercle, contour, transition) et la taille viennent de cette classe, ajoutée **à côté** du nom sémantique du bouton (`className="icon-btn chart-edit-btn"`, `"icon-btn cal-nav"`…) qui garde, lui, la couleur et le survol propres à son usage — un survol qui vire au rouge pour une suppression n'a pas à ressembler à un survol neutre. Deux tailles : par défaut (26 px) et `.sm` (20 px — tuile de la Grille, infobulle flottante, bulle d'aide).
- **Deux exceptions volontaires** à cette famille : `.gear-btn` (l'engrenage de la barre du haut, qui pivote au survol) et `.tc-act` (la rangée d'actions d'une carte du Log, où l'engrenage doit rester à la hauteur des boutons texte). Ce sont des interactions à part, pas des rappels d'un même bouton.
- **Les boutons d'accent plein partagent une seule taille.** `.save button.primary`, `.modal-actions .primary`, `.submit-all`, `.chrono-add-big`, `.fd-primary` sont groupés sur une même déclaration de padding/police ; seuls leur survol et leurs états (`:active`, `:disabled`) restent propres à chacun. `.tc-act.primary` (Noter/Ajouter dans une carte du Log) reste à part, délibérément plus compact — il doit rester à la hauteur du reste de sa carte, pas de celle d'un CTA pleine largeur.
- **`NumField` (app.food.jsx) est la seule rangée de champ numérique** : label à gauche, saisie + unité à droite — la même forme que tout `.field` de l'app (`.field-num` en est le corps). Trois formulaires (repas perso, ajout à la main, éditeur d'ingrédient IA) posaient chacun leur variante avant de converger ici ; une future page qui demande des macros repasse par `NumField`, elle n'en invente pas une quatrième.
- **`GearIcon` est l'icône unique de « ouvrir les réglages de cette chose »** — cartes du Log, cartes de graphe, calendrier, tuiles de la Grille, master strips, objectifs de Food. Un seul composant : les SVG recopiés à la main avaient dérivé vers un cercle à rayons qui se lisait comme un soleil.

## Cartes et listes

- **Convention visuelle des cartes** : nom en gras teinté de la couleur du tracker en haut à gauche (jamais de puce `.dot` à côté), engrenage rond (`.chart-edit-btn`) vers `TrackerModal` en haut à droite. Partagée par `DayCard`, `ChartCard`, `CalendarCard` et les tuiles de `GridSummary`.
- **La carte d'un master dans le Log (`MasterStrip`) est une carte comme les autres** — même fond, même contour, mêmes coins — et c'est son **nom cerclé de sa couleur** qui la marque : plus de losange ni de pastille « master » à côté, une seule marque au lieu de trois, et elle nomme la chose au lieu de la catégoriser. Ce qu'elle contient (une jauge sur 100) dit déjà qu'on ne la remplit pas comme un tracker. `MasterTrackerCard` (Vues) garde encore le losange.
- **La pastille d'origine (`OriginTag`) est un contour, pas un aplat** : c'est une provenance, pas un état. Tout item la porte, partout où il se montre — ligne de résultat, carte de bibliothèque, carte de repas.
- **Une liste d'items ne défile pas dans son propre cadre.** `.fd-list` remplissait 46 vh et défilait à l'intérieur d'une page qui défile déjà : deux ascenseurs imbriqués, et un tiers d'écran pour montrer ce qu'on est venu chercher. C'est la page qui défile ; la liste s'étend.

## Couleur

- **Ajouter un style = trois endroits** : un bloc de tokens `:root[data-theme="<id>"]` dans `Tracklog.html`, une entrée dans `STYLES` (app.jsx), et son id dans `STYLE_IDS` (le script en tête de page, qui pose le thème avant le premier rendu).
- **L'accent se dérive, il ne se décline pas à la main.** Une seule valeur est stockée (`prefs.accent`) ; `window.applyAccent` en tire `--primary-hover` et `--primary-soft` en `color-mix`, et la pose avant le premier rendu, comme le style.
- **Les jetons couleur suivent le format shadcn** (`--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--destructive`, `--border`, `--input`, `--ring`…), pour pouvoir déposer un thème shadcn/tweakcn sans réécrire l'app — voir `CLAUDE.md` § Architecture technique. `--primary` est l'orange de marque personnalisable (`prefs.accent`) ; le `--accent` shadcn (une surface de survol discrète) est un alias de `--muted`, à ne pas confondre.
- **Dix pastilles, pas trente-deux.** Sept teintes espacées d'environ 50° et nommables d'un mot (la première à 35°, celle de l'orange de Tracklog), un gris, l'encre, le « + ». Trente-deux demandaient de choisir entre des voisines qu'on ne distingue qu'en les comparant, pour une décision qui n'en vaut pas la peine — une couleur de tracker sert à séparer deux courbes. Qui veut une nuance précise ouvre `ColorEditor`.
