# Tracklog — répertoire du projet

Application web (PWA) de suivi personnel : trackers configurables + suivi
nutritionnel, données synchronisées sur Supabase. Un seul utilisateur par
compte, pensé pour PC et téléphone (installable en PWA).

Ce document est la carte du projet : le vocabulaire (pour que le nom d'un
concept soit toujours le même dans le code, les commits et la conversation),
la liste des écrans, l'inventaire des fonctionnalités, l'architecture
technique, et les pièges connus. Un seul fichier, tenu à jour à la main —
pas de source de vérité parallèle.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Tracklog.html` | Page unique. CSS complet inline (thème « Aristide »), balises `<script>` qui chargent React/Supabase/Babel depuis un CDN puis `app.jsx` et `app.food.jsx` en JSX brut (transformé dans le navigateur par Babel standalone — pas de build). |
| `app.jsx` | Cœur : modèle de données trackers/entries, auth, tous les écrans sauf Food. ~4200 lignes. |
| `app.food.jsx` | Page Food : bibliothèque d'aliments, scanner de code-barres, journal de repas, objectifs. Second `<script type="text/babel">`, chargé après `app.jsx` — partage son scope global (React, `supabase`, `dayKey`, `uid`…). ~3000 lignes. |
| `index.html` | Redirige vers `Tracklog.html`. |
| `foods-ref.json` | Table Ciqual 2025 (ANSES) compactée en colonnes — 3341 aliments crus/cuits avec micronutriments, servie en statique pour la recherche hors-ligne d'aliments sans étiquette. |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | PWA — installable sur téléphone. |
| `tools/ciqual/` | Source Excel d'origine de la table Ciqual (génère `foods-ref.json`). |
| `supabase/functions/analyse-repas/` | **Le seul morceau de serveur.** Edge Function Deno qui appelle Claude pour décomposer un repas décrit en texte. Existe pour que la clé API Anthropic reste côté serveur — contrairement à la clé anon Supabase, elle n'a aucune protection propre. Déployée sur le projet, `verify_jwt` actif ; il lui faut le secret `ANTHROPIC_API_KEY` pour répondre autre chose qu'une erreur de configuration. |

Pas de bundler, pas de `package.json`, pas de tests automatisés. Les CDN
(unpkg React/Babel, jsdelivr) sont épinglés par version + intégrité SRI dans
`Tracklog.html`.

## Lexique

| Terme | Définition |
|---|---|
| **Tracker** | Une chose qu'on suit dans le temps (ex. Caféine, Humeur, Sport). A un `type`, un nom, une couleur, une fréquence. Se remplit avec des **Entries**. |
| **Entry** (entrée) | Une valeur enregistrée pour un tracker à un instant `ts`. `{ id, trackerId, value, note, ts }`. |
| **Type** de tracker | `number` (nombre + unité) · `scale` (échelle 1–N) · `boolean` (oui/non) · `duration` (minutes) · `choice` (options prédéfinies, simple ou multiple) · `text` (note libre) · `master` (calculé, voir ci-dessous). |
| **Master** | Un tracker `type:'master'` qui ne se remplit jamais lui-même : sa valeur du jour est la **moyenne normalisée (0–100)** de ses trackers **membres**. Sert d'indice composite (« Forme », « Discipline »…). |
| **Membre** | Un tracker de données rattaché à un master (`master.members: string[]`). |
| **Quotidien** (`daily`) | Un tracker qui n'accepte qu'une entrée par jour ; ré-enregistrer remplace la valeur du jour. |
| **Plusieurs/jour** | `daily: false` — autant d'entrées que voulu par jour, combinées via l'**agrégat**. |
| **Agrégat** (`aggregate`) | Comment combiner plusieurs entrées du même jour pour un tracker `number`/`duration` non quotidien : `avg` (moyenne, défaut) · `sum` · `min` · `max`. |
| **Échelle personnalisée** (`scaleMin`/`scaleMax`/`scaleStep`) | Un tracker `scale` définit son propre intervalle et son propre incrément (ex. -100 à 100 par pas de 1), pas juste un « 1 à N » — la valeur par défaut reste 1–5 par pas de 1 pour les trackers déjà créés. |
| **Sens de l'amélioration** (`goodDirection`/`targetValue`) | Pour un tracker `number`/`scale`/`duration` : `up` (monter = mieux, défaut) · `down` (descendre = mieux, ex. temps d'écran) · `target` (se rapprocher de `targetValue` = mieux, peu importe de quel côté). Décide, dans les vues composites (Master, Tendance générale, Grille), de quel côté est le progrès — sans ça, un tracker « moins c'est mieux » ferait chuter la moyenne composite quand il s'améliore. |
| **Joker** | Un marqueur posé sur une journée entière (`value: '__joker__'`) qui **exclut** ce jour de tous les calculs — pas un zéro, une journée hors calcul (repos, écart planifié…). Option par tracker (`jokerEnabled`), sans effet sur un tracker quotidien. |
| **Fenêtre d'activité** (`windowEnabled`, `startDate`/`endDate`) | Bornes de dates hors desquelles un tracker n'influence ni les graphes ni les moyennes. `startDate` par défaut = date de création ; `endDate` posé automatiquement à l'archivage. |
| **Graphe cumulatif** (`cumulative`) | Option d'affichage (nombre/durée uniquement) : le graphe trace la somme cumulée depuis le début plutôt que la valeur du jour — courbe qui ne peut que monter. |
| **Forme de courbe** (`curveStyle`) | `line` (polyligne, défaut) ou `smooth` (courbe lissée, Catmull-Rom passant exactement par chaque point). Purement visuel. |
| **Cartes par ligne** (`perRow`) | Le curseur « − / + » de la vue Cartes : de 1 à 4 cartes de graphe par ligne. Ce n'est pas qu'une largeur — chaque cran retire du détail (statistiques, graduations) et rapetisse le graphe, jusqu'à la sparkline. Remplace l'ancien couple d'affichages Liste / Grille, qui n'étaient que deux crans de ce même réglage. |
| **Granularité** (`chartGrain`) | `day` (défaut) · `week` (lundi→dimanche) · `month` — ce qu'un point du graphe couvre. Les jours d'une même période sont ramenés à leur **moyenne** (un tracker cumulatif prend la valeur de fin de période). Réglage indépendant de la forme de courbe. |
| **Archiver** | Masque un tracker du "Jour" et le range dans Paramètres → Archives, sans supprimer ses entrées. Réversible (désarchiver, depuis le même `TrackerModal`). |
| **Chrono** | Un chronomètre autonome (état local, `localStorage`, pas synchronisé compte), qu'on peut lier à un tracker `duration` : « Enregistrer » convertit le temps écoulé en entrée. |
| **Mode Solo/Multi** (chronos) | Solo = démarrer un chrono met les autres en pause automatiquement ; Multi = ils tournent en parallèle. |
| **Master Strip** | Bande compacte (jauge 0–100) affichant la valeur du jour d'un master, en haut du "Jour" et de l'"Historique". |
| **Rail** (filtre) | Le panneau de pastilles cliquables (un tracker = une pastille) qui filtre les vues par sélection de trackers, avec tri (Manuel/A→Z/Récents/Type). La sélection, le tri et l'état ouvert/fermé survivent au rechargement — par appareil (`tracklog.filter.<userId>`), comme les chronos. |
| **Appui maintenu** | Au doigt, un glisser (réordonner) et la lecture d'un graphe ne s'arment qu'après ~350 ms / ~260 ms d'appui immobile. Tant que l'attente court, rien n'est bloqué : partir avant la fin fait simplement défiler la page. À la souris tout reste immédiat — il n'y a pas de défilement à confondre avec l'intention. |
| **Aliment** | Une fiche nutritionnelle "pour 100 g/ml" : `source: 'off'` (Open Food Facts, scanné) · `'custom'` (saisi à la main) · `'ref'` (table Ciqual, aliments sans étiquette). |
| **Food log** (ligne de repas) | Une portion mangée à un jour/repas donné. Garde un **snapshot** figé des valeurs nutritionnelles au moment de la saisie — corriger la fiche d'un aliment plus tard ne réécrit pas l'historique déjà loggé. |
| **Repas** | Une des 4 catégories fixes du jour : `matin` (petit-déjeuner) · `midi` · `soir` · `collation`. |
| **Macro** | Les 4 compteurs "de tête" de la page Food : kcal, protéines, glucides, lipides — seuls à avoir un objectif et un graphe. |
| **Objectifs** (`nutrition_goals`) | Cibles quotidiennes kcal/protéines/glucides/lipides ; valeurs par défaut tant que rien n'est réglé. |
| **Favori** (`food.favorite`) | Un aliment mis de côté, retrouvable via l'onglet « Mes favoris ». |
| **Engrenage** (`GearIcon`) | L'icône unique de « ouvrir les réglages de cette chose » — cartes du Log, cartes de graphe, calendrier, tuiles de la Grille, master strips, objectifs de Food. Un seul composant : les SVG recopiés à la main avaient dérivé vers un cercle à rayons qui se lisait comme un soleil. |
| **Ingrédient** (item) | La monnaie commune entre l'analyse IA et les repas : `{ id, name, grams, per100, foodId?, note? }`. Les valeurs sont **pour 100 g**, le poids est à part — corriger un poids recalcule les macros sans rien redemander. |
| **Repas enregistré** (`meals`) | Un **preset** : une liste d'ingrédients qu'on ajoute d'un coup, plus une recette facultative (`steps`, une simple liste d'étapes). Ne pas confondre avec le **Repas** au sens catégorie du jour ci-dessus. |
| **Analyse IA** | Décrire un repas en texte, récupérer sa décomposition en ingrédients pesés. Passe par l'Edge Function `analyse-repas`, jamais par le navigateur directement. |
| **Style** (`STYLES`, `data-theme`) | Un jeu de variables CSS sous `:root[data-theme="<id>"]`. En ajouter un = un bloc de tokens dans `Tracklog.html`, une entrée dans `STYLES` (app.jsx) et son id dans `STYLE_IDS` (script en tête de page). Préférence **par appareil**. |
| **Préférences de compte** (`user_settings`) | Un blob `jsonb` par compte. Y vit `prefs.tabs` — quels onglets sont affichés. Ce qui décrit la *forme* de l'app suit le compte ; ce qui dépend de l'écran (style, bulles d'aide) reste en `localStorage`. Renommer un onglet ne renomme pas sa clé déjà enregistrée : l'ancien id `bouffe` est relu au chargement et reporté sur `food` (voir « Renommer un onglet » dans les pièges). |
| **Retour** (`feedback`) | Un message envoyé depuis les paramètres : `kind` (bug · feature · avis · autre), le texte, et un `context` capté automatiquement (style, taille d'écran, navigateur). |

## Écrans

Navigation par onglets en haut (`tab`), certains avec sous-onglets (`Sub`).

| Onglet | Sous-onglet | Composant | Description |
|---|---|---|---|
| **Log** | Jour | `TodayView` → `DayGrid`/`DayCard` | Remplir aujourd'hui : une carte éditable par tracker actif, regroupées Quotidiens / Plusieurs par jour. Bouton « + Nouveau tracker » en tête. Bouton "Tout ajouter" groupé. Affiche les Master Strips et le résumé Food du jour. |
| | Historique | `HistoryView` → `MonthCalendar` + `DayGrid` | Calendrier mensuel (points = jours avec entrées) ; cliquer un jour ouvre son éditeur en dessous (identique au "Jour" mais sur une date passée). Reçoit aussi les sauts directs depuis le tooltip d'un graphe (`jumpTo`). |
| | Chrono | `ChronoView` → `ChronoCard` | Chronomètres, liés ou non à un tracker durée. Fenêtre flottante (Picture-in-Picture navigateur) pour garder les chronos visibles pendant qu'on fait autre chose. |
| **Food** | Jour | `FoodDayView` | Repas du jour par catégorie, barres de progression vers les objectifs, panneau détail/micronutriments dépliable, navigation jour précédent/suivant. |
| | Aliments | `FoodLibraryView` | Trois vues sur ce qui est à soi : Mes aliments · Mes favoris · Mes repas. Recherche, étoile favori, lien vers la fiche source, création/édition de repas. |
| | Vues | `FoodVuesView` → `NutritionBars` | Graphe en barres d'une macro sur N jours vs objectif, + répartition calorique P/G/L. |
| **Vues** | Graphes / Calendrier / Grille | `VuesView` → `ChartCard`/`MasterChart`/`TrendChart`/`CalendarCard`/`GridSummary` | Visualisation multi-tracker sur une période choisie (7/30/90/365j, YTD, tout, personnalisé) : courbes individuelles, overlay Master normalisé, tendance moyenne lissée, heatmap calendrier, grille de KPI. Dans Graphes, la barre « Affichage » choisit entre **Cartes** (une carte par tracker, densité au curseur), **Master** et **Tendance**. |
| **Training** | — | `TrainingView` | Réservé — le suivi d'entraînement viendra ici. Masquable tant qu'il est vide. |
| **Paramètres** | — | `SettingsView` | Compte · Style (sélecteur à N styles) · Onglets (afficher/masquer) · Affichage (bulles d'aide, numéro de semaine) · **Archives** (trackers archivés, seul point d'accès pour les désarchiver) · Un retour ? (`FeedbackCard`). |
| *(hors onglets)* | — | `SignIn` | Connexion / création de compte / lien magique / mot de passe oublié. |

Pas d'onglet « Trackers » séparé : chaque carte du Log et chaque Master Strip
porte son propre engrenage vers `TrackerModal`, et « + Nouveau tracker » est en
tête du Log — le rail de filtre garde aussi son propre bouton d'ajout. Un
tracker archivé n'a plus de carte nulle part pour porter un engrenage ; la
liste **Archives** des paramètres est donc son seul chemin de retour.

Modales transverses : `TrackerModal` (créer/éditer un tracker ou master),
`EntryModal` (éditer une entrée existante), `ChronoModal`, `AddFoodModal`,
`FoodEditModal`, `MealEditModal`, `GoalsModal`, `PasswordModal`.

`AddFoodModal` a **deux rangées d'onglets**, parce que ce sont deux gestes
différents — trouver un aliment quelque part, ou reprendre quelque chose qui est
déjà à soi :

| Rangée | Onglets | Composant |
|---|---|---|
| Trouver | Scanner · Rechercher · À la main · IA | `FoodScanner` · recherche OFF/Ciqual · `ManualEntry` · `AiAnalyseTab` |
| À moi | Mes aliments · Mes favoris · Mes repas | liste filtrée · idem filtrée sur `favorite` · `MealsTab` |

## Fonctionnalités

- **Trackers configurables** — 6 types de données + un type calculé (master), fréquence quotidienne ou multi-entrées, agrégat, unité, couleur, fenêtre d'activité, archivage réversible. Chaque carte du Log porte son propre engrenage vers les réglages (`TrackerModal`) — pas d'onglet dédié, voir « Écrans ».
- **Case joker** — exclure une journée entière des calculs sans la compter comme un échec. Sur la carte, active un bouton rond (icône « annuler ») et remplace la ligne de saisie par un tiret « — · ce jour ne compte pas » plutôt que de laisser un champ vide inviter à noter quelque chose.
- **Masters (indices composites)** — moyenne normalisée 0–100 de plusieurs trackers, avec bande de lecture (Master Strip) et carte graphe dédiée.
- **Graphes par tracker** avec axes auto-arrondis (`niceDomain`/`niceStep`), pontage en pointillés des trous de données, mode cumulatif optionnel.
- **Échelle verticale intelligente** — les bornes sont l'arrondi propre le plus proche des valeurs extrêmes (jamais les extrêmes bruts, jamais un zéro forcé), le pas est constant et choisi pour viser ~6 graduations, et le nombre de décimales des étiquettes se déduit du pas — deux graduations ne peuvent plus afficher le même nombre. Recalculé à chaque changement de période.
- **Échelle personnalisable** — un tracker `scale` définit son propre min/max/incrément (`TrackerModal`), plutôt qu'un simple « 1 à N » ; le curseur (Log, Historique, `EntryModal`) et l'axe du graphe (`ChartCard`) suivent.
- **Sens de l'amélioration** — un tracker `number`/`scale`/`duration` déclare si monter, descendre, ou se rapprocher d'une valeur cible est le progrès (`goodDirection`/`targetValue`, `TrackerModal`). `normalizeSeries` en tient compte pour tout composite (Master, Tendance générale) et `GridSummary` colore sa flèche de tendance en conséquence — un temps d'écran qui baisse se lit comme une amélioration, pas une chute.
- **Forme de courbe et granularité par tracker** — polyligne ou courbe lissée, et un point = un jour / une semaine / un mois, réglables indépendamment dans la section « Vues » des paramètres du tracker (masters compris).
- **Tooltip flottant sur les graphes** — survol souris (immédiat) ou appui maintenu au doigt affiche la valeur du jour pointé, avec un bouton rond pour ouvrir ce jour dans l'Historique (édition directe) et un bouton rond pour fermer. Une fois ouvert, le doigt balaie librement la courbe.
- **Densité des cartes de graphe** — un curseur « − / + » règle de 1 à 4 cartes par ligne. Monter d'un cran ne fait pas que rétrécir : la carte se déleste de ses statistiques secondaires puis de ses graduations, et finit en sparkline avec sa seule valeur du jour. Bridé à 2 colonnes sous 880 px et à 1 sur téléphone.
- **Vue Master overlay** et **Tendance générale** — comparer plusieurs trackers normalisés sur le même graphe, ou leur moyenne lissée sur 7 jours.
- **Heatmap calendrier** par tracker (`CalendarCard`) et **grille de KPI** (`GridSummary`, avec variation vs période précédente).
- **Historique éditable** — calendrier mensuel, ouvrir/éditer n'importe quel jour passé.
- **Chronos** — plusieurs chronomètres, mode Solo/Multi, fenêtre flottante (Document Picture-in-Picture), conversion directe en entrée sur un tracker durée.
- **Réordonnancement par glisser-déposer** — trackers, cartes du jour, master strips ; un ordre global unique, chaque liste n'affiche/réordonne qu'un sous-ensemble sans perturber le reste (`mergeSubOrder`). Au doigt il faut maintenir l'appui avant que ça s'attrape, avec une brève vibration pour le dire.
- **Filtre + tri** (rail) — afficher un sous-ensemble de trackers sur Log/Vues, trié Manuel/A→Z/Récents/Type. Retrouvé tel quel au rechargement ; un tracker supprimé ailleurs est purgé de la sélection une fois les trackers chargés.
- **Bulles d'aide "i"** — explications contextuelles activables/désactivables globalement.
- **Styles** — sélecteur à N styles (Sombre et Clair aujourd'hui), chaque choix montrant les couleurs qu'il applique. Préférence par appareil, appliquée avant le premier rendu pour ne jamais faire clignoter les mauvaises couleurs.
- **Onglets activables** — masquer Food, Vues, Training ou l'analyse IA depuis les paramètres. Rien n'est supprimé : l'onglet disparaît de la barre, les données restent. Log et les paramètres ne se masquent pas — l'un est la raison d'être de l'app, l'autre la seule porte pour rallumer le reste. Réglage synchronisé sur le compte.
- **Numéro de semaine** — affiché à côté de la date du Log et de l'Historique, activable/désactivable dans les paramètres (Affichage). Préférence par appareil.
- **Retours intégrés** — bug, idée, avis ou autre, écrits depuis les paramètres et enregistrés en base, avec le contexte technique (style, taille d'écran, navigateur) capté automatiquement.
- **Food : scanner de code-barres** — caméra (BarcodeDetector natif ou ZXing en repli), plusieurs passes de recadrage/rotation, secours photo native et saisie manuelle du code.
- **Recherche Open Food Facts** — plusieurs moteurs en cascade, cache et limiteur de débit (quota OFF).
- **Table Ciqual embarquée** — recherche instantanée hors-ligne des aliments sans étiquette (légumes, viandes brutes…), avec micronutriments.
- **Snapshot nutritionnel** — chaque ligne de repas figée à sa valeur du moment ; corriger un aliment plus tard ne modifie pas l'historique.
- **Interrupteur caméra** — le scanner ne demande aucun flux tant qu'il est éteint ; le choix est retenu par appareil, si bien qu'une fois allumé il démarre seul, autorisation déjà accordée.
- **Favoris** — une étoile range un aliment dans « Mes favoris », pour retrouver en un geste ce qu'on mange tous les jours.
- **Carte d'aliment** — une seule ligne d'actions : favori · modifier · supprimer, puis la source réduite à un bouton rond portant sa flèche (elle sort de l'app, elle ne pèse pas autant que ce qu'on fait dedans). La suppression est là, pas seulement au fond de la fiche d'édition.
- **Compteurs de Food** — les calories prennent toute la largeur, les trois macros se partagent la ligne suivante, et chaque objectif se lit « actuel / cible ». L'engrenage n'est que sur la carte calories : il ouvre les objectifs des quatre.
- **Repas enregistrés (presets)** — un ensemble d'ingrédients ajouté d'un coup, une ligne de journal par ingrédient (chacune reste corrigeable seule), avec une recette facultative en liste d'étapes.
- **Analyse IA d'un repas** — décrire un plat en texte, joindre une photo, ou les deux : envoyés dans la même requête, Claude le décompose en ingrédients pesés avec leurs valeurs pour 100 g, sa marge d'erreur et sa cause. La photo, quand elle est là, prime sur le texte pour la composition visible ; le texte sert à préciser ce qu'elle ne montre pas. Le résultat est entièrement éditable avant d'être versé au journal, et peut être enregistré comme repas.
- **Objectifs nutritionnels** journaliers avec barres de progression et alerte dépassement.
- **Détail réglementaire + micronutriments** avec % des repères journaliers (AJR) quand disponibles.
- **PWA installable**, thème système, auth email/mot de passe + lien magique + réinitialisation.

## Architecture technique

- **Aucun build.** JSX transformé en direct dans le navigateur par `@babel/standalone`. Toute modif de `.jsx` est visible après rechargement — pas d'étape de compilation à lancer.
- **Persistance : Supabase** (Postgres + auth). Tables : `trackers`, `entries`, `foods`, `food_logs`, `nutrition_goals`, `meals`, `user_settings`, `feedback`. Clé anonyme publique dans `app.jsx` (protégée par Row Level Security côté Supabase, pas un secret à cacher).
- **Ajouter un réglage de tracker = une migration SQL.** `trackerToRow` envoie des colonnes nommées : toute nouvelle propriété persistée demande un `alter table trackers add column …` **avant** de déployer, sinon tout enregistrement de tracker échoue — y compris la simple modification d'un tracker existant. Les colonnes doivent accepter `null` pour que les trackers existants continuent de fonctionner (le mapper applique la valeur par défaut à la lecture).
- **Les migrations peuvent être appliquées directement.** Le connecteur Supabase (MCP) donne accès au projet `drrmqrhsfgermgblndzz` : `apply_migration` pour le DDL, `execute_sql` pour l'inspection, `deploy_edge_function` pour les fonctions. Pas besoin de passer par l'éditeur SQL du dashboard — le faire directement évite l'écart entre « le code est poussé » et « la base suit », qui a déjà cassé l'enregistrement des trackers une fois. Les **secrets** restent l'exception : aucun outil ne les pose, `ANTHROPIC_API_KEY` se règle à la main.
- **État local (`localStorage`, non synchronisé)** : chronos (`tracklog.chronos.<userId>`), préférence Solo/Multi, activation des bulles d'aide, style (`tracklog.theme`), interrupteur caméra (`tracklog.cameraOn`). La règle : ce qui dépend de l'écran ou de l'appareil reste local, ce qui décrit la forme de l'app va dans `user_settings`.
- **`app.food.jsx` dépend du scope global posé par `app.jsx`** (React, `supabase`, `dayKey`, `uid`, `startOfDay`…) — les deux fichiers sont deux `<script>` distincts mais partagent un seul espace de noms global, chargés dans cet ordre puis montés ensemble (`mountTracklog()`).
- **Drag & drop maison** (`useDragReorder`) — pointer events, pas de librairie ; un ordre global par tracker, chaque vue réordonne un sous-ensemble reconstitué dans l'ordre complet.
- **Cache-busting manuel** — les `<script src="app.jsx?v=N">` portent un numéro de version à incrémenter à la main dans `Tracklog.html` pour forcer le rechargement (pas de hash de build automatique).
- **Aucun framework CSS** — tout le style est dans `<style>` en tête de `Tracklog.html`, thème "Aristide" (variables CSS `--bg`, `--ink`, `--accent`…, clair/sombre via `data-theme`).
- **`Segmented` (app.jsx) est le seul mécanisme de bascule de l'app.** Jour/Historique/Chrono, Oui/Non, le type d'un tracker, Graphes/Calendrier/Grille — tout passe par ce composant plutôt que par du CSS qui swappe un fond en place. Un fond (`.seg-thumb`) *glisse* jusqu'à l'option portant `.on`, mesuré en JS via `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight` du bouton actif (pas `getBoundingClientRect()` : la différence de deux rects inclut la bordure de la piste et décale le thumb d'un pixel). Migrer un ancien `<div className="vue-mode">…</div>` est volontairement un remplacement de balise à l'identique : `Segmented` ne réclame aucun changement aux `<button>` qu'il enveloppe, il regarde juste lequel porte `.on` après chaque rendu. Trois tailles nommées, pas des variantes accidentelles : par défaut (chips à leur propre contour, texte en minuscule — les options d'une modale), `size="compact"` (piste unique en capitales tassées — la nav principale), `size="small"` (la même piste compacte, un cran plus petit — tri du rail, onglets, densité des graphes). `BoolPill` est un `Segmented` à deux options (`size="compact"`) ; ne pas réintroduire de `<input type="checkbox">` pour un réglage binaire.
- **Convention visuelle des cartes** — nom en gras teinté de la couleur du tracker en haut à gauche (jamais de puce `.dot` à côté), engrenage rond (`.chart-edit-btn`) vers `TrackerModal` en haut à droite : partagée par `DayCard`, `ChartCard`, `CalendarCard` et les tuiles de `GridSummary`. `MasterTrackerCard`/`MasterStrip` gardent leur propre marqueur (`.master-mark`, un losange) plutôt que la puce ronde d'un tracker de données — c'est un langage visuel volontairement distinct pour un composite.
- **`.icon-btn` est le seul rond à icône ou glyphe seul.** Engrenage d'une carte, flèche du calendrier, croix de suppression, lien source — la forme (cercle, contour, transition) et la taille sont partagées par cette classe, ajoutée à côté du nom sémantique de chaque bouton (`className="icon-btn chart-edit-btn"`, `className="icon-btn cal-nav"`…) qui garde lui la couleur et le survol propres à son usage — un survol qui vire au rouge pour une suppression n'a pas à ressembler à un survol neutre. Deux tailles seulement : par défaut (26px) et `.sm` (20px, pour une tuile de la Grille, une infobulle flottante, une bulle d'aide). `.gear-btn` (l'engrenage de la barre du haut, qui pivote au survol) et `.tc-act` (la rangée d'actions d'une carte du Log, où l'icône engrenage doit rester à la même hauteur que les boutons texte à côté) restent volontairement hors de cette famille — ce sont des interactions à part, pas des rappels d'un même bouton.
- **Les boutons d'accent plein (`.btn-primary` et alliés) partagent une seule taille.** `.save button.primary`, `.modal-actions .primary`, `.submit-all`, `.chrono-add-big`, `.fd-primary` sont groupés sur une même déclaration de padding/police ; seuls leur survol et leurs états (`:active`, `:disabled`) restent propres à chacun. `.tc-act.primary` (Noter/Ajouter dans une carte du Log) reste à part, délibérément plus compact — il doit rester à la hauteur du reste de sa carte, pas de celle d'un CTA pleine largeur.

## Décisions et pièges connus

- **Joker ≠ zéro.** Un jour joker est *exclu* des agrégats, jamais compté comme 0 — vérifier `isJokerEntry`/`jokerDayKeys` avant toute nouvelle fonction de calcul.
- **Master ne forward-fill jamais.** `computeMasterSeries` laisse les trous en trous (dessinés en pointillés) plutôt que de reporter la dernière valeur connue — un master ne doit jamais paraître à jour alors que ses membres ne le sont plus.
- **Une entrée "quotidienne" remplace, ne s'additionne pas** (`addEntry` dans `App`, logique `tracker.daily`).
- **`app.food.jsx` n'a pas de `const { useState... } = React` à lui** — il compte sur celui déclaré en tête de `app.jsx`. Ne jamais réordonner le chargement des deux scripts dans `Tracklog.html`.
- **Ajouter un style se fait à trois endroits, pas un.** Le bloc de tokens CSS, l'entrée dans `STYLES` (app.jsx), et l'id dans `STYLE_IDS` du script en tête de `Tracklog.html`. Ce dernier tourne avant tout chargement de script, il ne peut donc pas lire `STYLES` — la duplication est délibérée, et c'est elle qui évite le flash de mauvaises couleurs au chargement.
- **Une table manquante ne doit jamais bloquer l'app.** `user_settings` et `meals` sont lues en tolérant l'erreur : migration pas encore passée = valeurs par défaut, pas d'écran blanc. Garder ce réflexe pour toute nouvelle table.
- **La clé API Anthropic ne doit jamais atteindre le navigateur.** Elle vit en secret d'Edge Function (`supabase secrets set ANTHROPIC_API_KEY=…`). L'analogie avec la clé anon Supabase est trompeuse : celle-ci est inoffensive parce que Row Level Security la borne, la clé Anthropic n'a aucune protection équivalente et se dépense.
- **Un ingrédient porte ses valeurs pour 100 g, jamais ses valeurs absolues.** C'est ce qui permet de changer un poids sans rappeler le modèle ni la base. `itemNutriments()` fait la mise à l'échelle au moment de l'affichage et de l'écriture du journal.
- **Un repas ajouté produit une ligne de journal par ingrédient**, pas une ligne agrégée — chacune reste corrigeable et supprimable seule, et garde son snapshot comme n'importe quel ajout.
- **OFF (Open Food Facts) a un quota de recherche serré** (~10 req/min) — `takeSearchToken`/cache dans `app.food.jsx` ; ne pas retirer le limiteur sans comprendre pourquoi il existe (429 sinon).
- **Le SVG des graphes est étiré (`preserveAspectRatio="none"`), donc son texte l'est aussi.** Une carte deux fois plus étroite comprime ses graduations d'autant : à 250 px elles deviennent des taches. C'est pourquoi `chartDetail()` coupe les étiquettes d'axe (`axisLabels:false`) au cran serré au lieu de simplement réduire la police — rapetisser le texte ne le rendrait pas lisible. Toute nouvelle légende posée dans ces `<svg>` subit la même déformation.
- **Un geste tactile qui s'arme doit d'abord laisser défiler.** Le glisser et la lecture d'un graphe attendent un appui immobile avant de prendre la main, et surtout n'appellent ni `preventDefault` ni écouteur bloquant pendant l'attente : le navigateur doit rester libre de faire défiler si le doigt part. `touch-action` est passé de `none` à `pan-y` sur les poignées et les pastilles pour la même raison. Une fois armé, un écouteur `touchmove` non passif annule le défilement — posé alors que le doigt est encore immobile, seul moment où `preventDefault` peut encore l'empêcher de démarrer.
- **Un appui long ne doit pas valider le clic au relâchement.** Une pastille du rail bascule le filtre au clic ; sans garde-fou, la maintenir pour la réordonner basculait aussi le filtre en la relâchant. `useDragReorder` expose `wasArmed()` pour ça. Le garde-fou de distance qui l'accompagne (6 px) suppose des coordonnées de clic réelles — un `click()` programmatique en (0,0) se fait légitimement avaler, ce qui trompe un test avant de tromper un utilisateur.
- **Renommer un onglet ne renomme pas ce qui est déjà enregistré.** L'onglet « Bouffe » est devenu « Food » (id `bouffe` → `food`), mais les comptes existants portent encore l'ancienne clé dans `prefs.tabs` : sans relecture, un onglet masqué serait réapparu au prochain chargement. `useAccountPrefs` reporte donc l'ancienne valeur sur la nouvelle clé tant que celle-ci n'existe pas. Même réflexe pour tout futur renommage d'id persisté.
- **Un nom long doit se couper, jamais élargir sa carte.** Une case de grille vaut par défaut `min-width:auto` — « au moins la largeur de mon contenu » — donc une carte au nom à rallonge imposait 692 px à une colonne de 354 px. Et `html{overflow-x:hidden}` masquait le débordement au lieu de le signaler : la carte était simplement coupée, hors d'atteinte. D'où la règle `.today-grid>*,.trackers-grid>*,.gridview>*,.chart-grid-layout>*{min-width:0}` : sans elle, aucune troncature interne ne peut entrer en jeu. Corollaire pour tester : `overflow-x:hidden` rend un contrôle de défilement horizontal aveugle — comparer la largeur des cartes à celle de la fenêtre.
- **Cache-busting manuel** — après une modif de `app.jsx` ou `app.food.jsx`, penser à incrémenter le `?v=` correspondant dans `Tracklog.html`, sinon des utilisateurs peuvent rester sur une version en cache.
- **Pas de tests automatisés, pas de build.** Toute validation passe par relecture + test manuel dans un navigateur (le fichier compile-t-il via Babel, l'app charge-t-elle sans erreur console).
- **Workflow de branche actuel** : développement direct sur `Tracklog_V1` (branche par défaut = celle publiée), pas de branche de feature intermédiaire — voir historique de commits pour le contexte.
