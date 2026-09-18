# Tracklog — répertoire du projet

Application web (PWA) de suivi personnel : trackers configurables + suivi
nutritionnel, données synchronisées sur Supabase. Un seul utilisateur par
compte, pensé pour PC et téléphone (installable en PWA).

Ce fichier est **l'index** : le vocabulaire, les fichiers, l'architecture, les
rôles de session. Le détail vit dans `.claude/notes/` et se lit à la demande —
un fait n'est écrit qu'à un seul endroit, l'index dit lequel.

@.claude/preferences.md

## Notes détaillées

| Fichier | À ouvrir quand |
|---|---|
| `.claude/notes/pieges.md` | **Avant d'écrire du code**, quel que soit le rôle. Les invariants qu'un code neuf peut encore casser. |
| `.claude/notes/ui.md` | Avant de dessiner un contrôle, une carte, une rangée de réglage. Les briques partagées, leur forme et la raison de cette forme. |
| `.claude/notes/ecrans.md` | Avant de toucher à la navigation, d'ajouter un écran, de déplacer un contrôle d'une page à l'autre. |
| `.claude/notes/fonctionnalites.md` | Avant de proposer une fonctionnalité (elle existe peut-être déjà sous un autre nom) ou d'en modifier une (pour retrouver la raison de sa forme). |

## Rôles de session

Le travail se fait dans plusieurs sessions Claude Code en parallèle, chacune
avec un rôle annoncé par Louis au démarrage (« tu es le Reviewer », ou la
commande `/reviewer`). **Tant qu'aucun rôle n'est annoncé, aucun n'est pris** —
ne pas en deviner un d'après la question posée.

| Rôle | Ce qu'il fait | Écrit du code ? | Fiche |
|---|---|---|---|
| **Assistant** | Décisions, questions, explications, specs. Recommande au lieu de cataloguer. | non | `/assistant` |
| **Builder Main** | Développe et pousse sur `Tracklog_V1`, la branche publiée. Une seule session à la fois. | oui | `/builder-main` |
| **Builder 01, 02…** | Le même métier sur un sujet isolé, branche `claude/<sujet>`. Ne touche jamais `Tracklog_V1`. | oui | `/builder-branche` |
| **Reviewer & security** | Cherche les bugs et les failles, rapporte par constat (où · scénario qui casse · correctif). | non, sauf demande explicite | `/reviewer` |
| **Atelier** | Cartographie l'UI/UX, maquette les variantes hors dépôt, découpe les couches. | non dans l'app | `/atelier` |

Fiches complètes dans `.claude/skills/<rôle>/SKILL.md`, récapitulées dans
`.claude/roles.md`.

- **Un rôle dit ce qu'une session a le droit de faire**, pas seulement ce
  qu'elle fait bien : la séparation ne sert à rien si une session qui devait
  lire écrit quand même.
- **Une seule session écrit sur une branche donnée.**
- **Un rôle ne se déborde pas en silence** : si le travail demandé appartient à
  un autre, le dire et proposer la session qui convient.
- Seuls les Builders modifient `CLAUDE.md` et `.claude/notes/`, dans le commit
  qui introduit ce qu'ils y écrivent. Les autres rôles le **proposent**.
- **Un fait s'écrit à un seul endroit.** L'index dit où ; il ne le répète pas.

## Fichiers

| Fichier | Rôle |
|---|---|
| `Tracklog.html` | Page unique. Charge `styles.css`, puis les `<script>` qui chargent React/Supabase/Babel depuis un CDN et les six `.jsx` en JSX brut — transformé dans le navigateur par Babel standalone, pas de build. |
| `styles.css` | Tout le CSS (thème « Aristide » et les autres styles). Chargé par un `<link>` posé avant `<body>`, au même endroit que l'ancien `<style>` inline — le script de tête qui pose `data-theme` et l'accent s'exécute avant, la feuille se charge donc sans jamais faire flasher le mauvais thème. |
| `app.core.jsx` | **Le socle, chargé en premier** : modèle trackers/entries, registres (types, agrégats, styles, onglets, courbes, granularités, services extérieurs, tris/groupements), client Supabase et appel aux fonctions Edge, mappers de lignes, helpers de calcul et de format, préférences de compte. Règle d'entrée : **ça ne rend rien**. ~570 lignes. |
| `app.ui.jsx` | **Les briques d'interface partagées** — celles que `ui.md` décrit (`Segmented`, `BoolPill`, `IconBar`, `GearIcon`, `InfoBubble`, `SwatchGrid`, `ColorEditor`) plus celles que l'atelier montre au même titre (`NumPill`, `ChevronDown`, `DragHandle`, `useDragReorder`). ~580 lignes. |
| `app.charts.jsx` | **Ce qui dessine les données** : `ChartCard` et son infobulle, échelles d'axe, formes de tracé, granularité, normalisation et tendance, masters (`MasterStrip`, `MasterTrackerCard`), calendrier heatmap, grille. ~1270 lignes. |
| `app.jsx` | L'app elle-même : `App` et son état, les écrans (Jour, Historique, Chrono, Vues, Paramètres), les modales d'entrée et de tracker, la connexion, `Root`/`mountTracklog`. ~3400 lignes. |
| `app.food.jsx` | Page Food : bibliothèque d'aliments, scanner de code-barres, journal de repas, objectifs. ~4900 lignes. |
| `app.atelier.jsx` | **L'atelier**, page `#atelier` : chaque composant, chaque jeton, chaque classe, rangés par famille, rendus pour de vrai sous n'importe lequel des thèmes. Son inventaire n'est pas écrit — il **relit les cinq `.jsx` et `styles.css` à l'exécution** (`fetch`), y lit les annotations `@atelier`, et affiche en tête ce qui n'en a pas. Pas un onglet — une page pour celui qui fabrique l'app. ~1150 lignes. |
| `index.html` | Redirige vers `Tracklog.html`. |
| `foods-ref.json` | Table Ciqual 2025 (ANSES) compactée en colonnes — 3341 aliments crus/cuits avec micronutriments, servie en statique pour la recherche d'aliments sans étiquette. |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | PWA — installable sur téléphone. |
| `tools/ciqual/` | Source Excel d'origine de la table Ciqual (génère `foods-ref.json`). |
| `supabase/functions/etsy/` | La passerelle vers Etsy — l'API d'Etsy ne répond pas aux navigateurs, et un jeton Etsy ne doit jamais descendre dans la page. Déployée `--no-verify-jwt` (Etsy y renvoie le navigateur sans session Supabase), elle vérifie donc la session elle-même sur toutes ses routes sauf `/callback`. Secret : `ETSY_CLIENT_ID`. |
| `supabase/functions/analyse-repas/` | Appelle Claude pour décomposer un repas décrit en texte ou en photo. Existe pour que la clé API reste côté serveur. `verify_jwt` actif. Secret : `ANTHROPIC_API_KEY`. |
| `supabase/functions/tracklog-mcp/` | **Le carnet, ouvert à Claude.** Serveur MCP branché en connecteur personnalisé : « rentre ça dans Tracklog » écrit la ligne dans le journal. Deux outils — `tracklog_ajout_rapide` (écrire), `tracklog_journee` (lire). `--no-verify-jwt`. Secrets : `TRACKLOG_MCP_TOKEN`, `TRACKLOG_MCP_USER_ID`. |
| `tools/tracklog-mcp/` | Son banc d'essai (doublures de Deno et PostgREST). Le seul test automatisé du projet, parce que c'est le seul code qu'on ne peut pas essayer dans un navigateur. |
| `.claude/` | Hors produit : les rôles (`skills/<rôle>/SKILL.md`), les préférences de Louis, les notes détaillées. |

Pas de bundler, pas de `package.json`. Les CDN (unpkg React/Babel, jsdelivr)
sont épinglés par version + intégrité SRI dans `Tracklog.html`.

## Lexique

Une ligne = une définition. Le *pourquoi* d'une fonctionnalité est dans
`fonctionnalites.md`, celui d'un contrôle dans `ui.md`.

### Trackers

| Terme | Définition |
|---|---|
| **Tracker** | Une chose qu'on suit dans le temps (Caféine, Humeur, Sport). A un `type`, un nom, une couleur, une fréquence. Se remplit d'**entries**. |
| **Entry** | Une valeur enregistrée pour un tracker à un instant `ts` : `{ id, trackerId, value, note, ts }`. |
| **Type** | `number` (nombre + unité) · `scale` (échelle) · `boolean` · `duration` (minutes) · `choice` (options, simple ou multiple) · `text` · `master` (calculé). |
| **Master** | Tracker `type:'master'` qui ne se remplit jamais lui-même : sa valeur du jour est la moyenne normalisée (0–100) de ses **membres**. Un indice composite (« Forme », « Discipline »). |
| **Membre** | Tracker de données rattaché à un master (`master.members: string[]`). |
| **Quotidien** (`daily`) | Une seule entrée par jour ; ré-enregistrer remplace. `daily:false` = autant d'entrées que voulu, combinées par l'**agrégat**. |
| **Agrégat** (`aggregate`) | Comment combiner plusieurs entrées du même jour (`number`/`duration` non quotidien) : `avg` (défaut) · `sum` · `min` · `max`. |
| **Échelle personnalisée** (`scaleMin`/`scaleMax`/`scaleStep`) | Un `scale` définit son intervalle et son incrément propres ; 1–5 par pas de 1 pour les trackers déjà créés. |
| **Sens de l'amélioration** (`goodDirection`/`targetValue`) | `up` (défaut) · `down` (temps d'écran) · `target` (se rapprocher de `targetValue`). Dit aux vues composites de quel côté est le progrès — sans ça, un tracker « moins c'est mieux » ferait chuter la moyenne en s'améliorant. |
| **Joker** | Marqueur posé sur une journée (`value:'__joker__'`) qui **exclut** ce jour de tous les calculs — pas un zéro. Option par tracker (`jokerEnabled`), sans effet sur un quotidien. |
| **Fenêtre d'activité** (`windowEnabled`, `startDate`/`endDate`) | Hors de ces bornes, un tracker n'influence ni les graphes ni les moyennes. `startDate` = date de création par défaut, `endDate` posé à l'archivage. |
| **Archiver** | Masque un tracker du Jour et le range dans Paramètres → Archives, sans supprimer ses entrées. Réversible depuis le même `TrackerModal`. |
| **Source extérieure** (`externalSource`) | Un tracker `number` rempli par un service du dehors. Seule la **saisie** change : les valeurs arrivent en `entries` ordinaires, graphes et masters ne savent pas d'où vient le chiffre. Registre unique `EXTERNAL_SERVICES` (app.core.jsx) — un service = une fonction Edge du même nom exposant `/start` `/status` `/disconnect` `/sync`, plus une ligne du tableau. Rien d'autre dans l'app ne connaît le mot « Etsy ». |
| **Donnée récupérée** (`externalMetric`) | Ce qu'on va chercher. Etsy : `net` (bénéfice — ventes moins frais Etsy, **avant** coût d'impression) · `revenue` (ventes) · `orders`. En changer remet `externalLastSync` à zéro. |
| **Chrono** | Chronomètre synchronisé par compte (table `chronos` + Realtime) : seul l'horodatage de départ voyage, le décompte reste calculé localement. Réordonnable, liable à un tracker `duration`. **Solo** = démarrer met les autres en pause ; **Multi** = ils tournent en parallèle. |

### Vues et affichage

| Terme | Définition |
|---|---|
| **Rail** | Le panneau de pastilles (un tracker = une pastille) qui filtre les vues, et les trois boutons au-dessus — **Filtres**, **Tri** (Manuel/A→Z/Récents/Type), **Grouper** — chacun son panneau et son état. Tout survit au rechargement, par appareil (`tracklog.filter.<userId>`). |
| **Grouper** | Comment le Jour range ses trackers en **sections** : `type` (Quotidiens / Plusieurs par jour / Alimentation / Masters) · `couleur` · `fait` (un joker compte comme fait). Le tri décide l'ordre *dans* une section, grouper décide *en combien* de sections. |
| **Section** | Un bloc du Jour, réordonnable au même titre qu'une carte (`DragHandle`). Un ordre par mode de groupement (`sectionOrders`), recalé sur les sections présentes à chaque rendu (`mergeSectionOrder`). |
| **Cartes par ligne** (`perRow`) | Le curseur « − / + » : 1 à 4 cartes de graphe par ligne. Chaque cran retire du détail (statistiques, graduations) jusqu'à la sparkline. Remplace l'ancien couple Liste / Grille. |
| **Granularité** (`chartGrain`) | `day` (défaut) · `week` (lundi→dimanche) · `month` — ce qu'un point couvre. Les jours d'une période sont ramenés à leur moyenne (un cumulatif prend la valeur de fin). |
| **Forme de courbe** (`curveStyle`) | `line` (défaut) · `smooth` (Catmull-Rom passant par chaque point) · `bars`. Purement visuel. |
| **Graphe cumulatif** (`cumulative`) | Nombre/durée : le graphe trace la somme depuis le début — une courbe qui ne peut que monter. |
| **Master Strip** | La carte d'un master : une jauge 0–100 de sa valeur du jour, en tête du Jour et de l'Historique. |
| **Appui maintenu** | Au doigt, réordonner (~350 ms) et lire un graphe (~260 ms) ne s'arment qu'après un appui immobile ; partir avant fait simplement défiler. À la souris, tout est immédiat. |

### Food

| Terme | Définition |
|---|---|
| **Item** | Tout ce qu'on peut verser dans une journée et qui reste à soi : un aliment (`foods`) ou un repas enregistré (`meals`). Une ligne de journal n'en est pas un. |
| **Aliment** | Une fiche nutritionnelle « pour 100 g/ml », et l'un des deux types d'item. |
| **Origine** (`source`) | D'où vient un item, en quatre valeurs : `ref` (aliment simple, Ciqual) · `off` (produit à code-barres, Open Food Facts) · `ai` (sorti d'une analyse) · `custom` (créé à la main). Registre `ITEM_ORIGINS`, lu par `itemOrigin()`, persisté sur `foods` **et** `meals`. |
| **Sous-catégorie** (`itemSub`) | Le second niveau : groupe Ciqual, marque, ou « analyse ». Un aliment simple entré en bibliothèque perd son groupe mais garde son code `ciqual:…`, que `itemSub` retrouve via `refByBarcode`. |
| **Favori** (`favorite`) | Un item mis de côté. La même étoile pour un aliment et pour un repas — deux items, elle ne peut pas vouloir dire deux choses. |
| **Food log** | Une portion mangée à un jour/repas donné. Garde un **snapshot** figé des valeurs : corriger une fiche plus tard ne réécrit pas l'historique. |
| **Repas** | Une des 4 catégories fixes du jour : `matin` · `midi` · `soir` · `collation`. |
| **Repas enregistré** (`meals`) | Un **preset** : une liste d'ingrédients qu'on ajoute d'un coup, plus une recette facultative. C'est un item (origine + favori). À ne pas confondre avec la catégorie ci-dessus. |
| **Ingrédient** | La monnaie commune entre l'analyse IA et les repas : `{ id, name, grams, per100, foodId?, note? }`. Valeurs **pour 100 g**, poids à part — corriger un poids recalcule sans rien redemander. Pas un item : un composant, qui ne vit que dans sa liste. |
| **Étape** (`steps`) | Une ligne de recette : `{ id, text, done, mins }` (`mins` = minuteur facultatif). Le numéro n'est **jamais stocké**, il se lit de l'ordre affiché. `stepsFromRows` relit les anciennes chaînes. |
| **Portions** (`meals.portions`) | Ce qu'une recette **produit** (« ce plat fait 4 parts »), à ne pas confondre avec ce qu'on en **prend** (`MealPortionModal`). Les ingrédients pèsent toujours la recette entière. |
| **Ensemble** (`group_id`, `group_name`, `group_qty`) | Les lignes d'un repas versé dans une journée, prises comme un tout : repliables, supprimables d'un coup, re-dosables — mais chacune reste une ligne ordinaire avec son instantané. Identifiant **neuf à chaque versement**. Le re-dosage applique un **rapport** aux lignes telles qu'elles sont, jamais en repartant de la recette. |
| **Mode sélection** | Un mode, pas une case sur chaque ligne. Allumé : taper coche au lieu d'ouvrir, un en-tête de repas coche son ensemble, le glisser-supprimer se met en retrait. Trois actions — **Copier** (autre jour / autre repas), **En faire un repas** (les lignes deviennent des ingrédients, reconvertis « pour 100 g »), **Supprimer**. |
| **Macro** | Les 4 compteurs de tête : kcal, protéines, glucides, lipides — seuls à avoir un objectif et un graphe. |
| **Objectifs** (`nutrition_goals`) | Cibles quotidiennes kcal/protéines/glucides/lipides. Kcal toujours en dur ; chaque macro a son **mode** (`{macro}Mode`) — `grams` · `percent` (% des kcal, 4/4/9 kcal/g) · `perkg` (g par kg de `weightKg`). La source de vérité est le mode + son **ratio** ; les grammes produits, recalculés à l'enregistrement, sont ce que tout le reste lit. |
| **Consigne datée** (`fromDay`) | Un objectif vaut **à partir d'un jour**, pas globalement : clé `(user_id, from_day)`, le jour J lit la dernière consigne dont `from_day <= J` (`goalsAt`, `effectiveGoalsAt`, `goalsSetAt`). La prise d'effet est le jour qu'on regardait en ouvrant la fenêtre. |
| **Créer** | Le quatrième onglet de l'ajout, en trois sous-modes : *Ajout rapide* (kcal + macros versées dans la journée — un correctif, **pas un item**) · *Aliment* (les mêmes + poids mangé et code-barres facultatif : un item à soi) · *Repas* (ouvre l'éditeur). |
| **Approfondi** | La bascule Simple / Approfondi, partagée par l'onglet Créer et l'analyse IA. Côté Créer, les micronutriments s'ajoutent aux macros dans les mêmes `NumField` et suivent le même état (mise à l'échelle comprise) — le seul chemin pour qu'un aliment porte des micros sans étiquette. Côté analyse (`mode`) : `normal` estime de tête, `advanced` ajoute la recherche web et les micros, et renvoie les URL consultées dans `sources`. |
| **Analyse IA** | Décrire un repas en texte, en photo ou les deux, et récupérer sa décomposition en ingrédients pesés. Passe par l'Edge Function `analyse-repas`. Ce qui en sort **peut** devenir un item (`source:'ai'`) — la page le demande, elle ne le décide pas. |
| **Tri des items** (`ITEM_SORTS`, `sortItems`) | Récents (défaut) · A→Z · Z→A · kcal ↓ · kcal ↑. Un registre unique appliqué aux aliments **et** aux repas (kcal d'une portion). |
| **Tracker virtuel de Food** (`useFoodCharts`) | Un nutriment vu comme un tracker : même objet, même `ChartCard`, mêmes réglages. Absent de la table `trackers` — ses réglages vivent dans `prefs.foodCharts`, ses entrées sont fabriquées à la volée depuis `logsByDay` (`foodEntries`). |
| **Réglages d'affichage seuls** (`TrackerModal scope="display"`) | La page de réglages d'un tracker réduite à ce qui a un sens pour un tracker qu'on ne remplit pas soi-même : nom, courbe, granularité, cumul, couleur. Genre, type, fréquence, période et suppression disparaissent — ils n'ont rien à proposer. |
| **Écriture optimiste** | Toute écriture de Food pose l'état local d'abord et envoie derrière. En échec, elle **défait** ce qu'elle a affiché et le dit (`writeFailed`) — un échec muet serait pire que l'attente. |

### Compte et apparence

| Terme | Définition |
|---|---|
| **Préférences de compte** (`user_settings`) | Un blob `jsonb` par compte, référence pour tout réglage : `prefs.tabs`, `tabOrder`, `theme`, `accent`, `help`, `showWeek`, `cameraOn`, `foodCharts`. Un réglage posé sur téléphone doit se retrouver sur PC ; `localStorage` n'en est qu'un miroir. |
| **Réglage synchronisé** (`useSyncedPref`) | Le miroir `localStorage` s'affiche tant que la base n'a pas répondu, puis le compte gagne et corrige l'appareil. |
| **Thème** (`THEMES`, `data-theme`) | Un jeu de variables CSS sous `[data-theme="<id>"]` — accroché à l'attribut et non à `:root`, donc posable sur **n'importe quel élément** : c'est ce qui permet à l'atelier de montrer une carte sous cinq thèmes côte à côte. Il choisit le fond et l'encre, et peut aussi déplacer la **police** (`--font-sans/serif/mono`, `--font-serif-style`, `--font-size-adjust`), les **coins** (`--radius`, `--radius-pill`, `--radius-round`), la **lueur** (`--shadow-card`, `--text-glow`) et l'**interlettrage** (`--tracking-body`). Le `:root{}` de base porte les valeurs d'« Aristide » ; un thème ne redéclare que ce qui diffère chez lui — Sombre et Clair ne changent que la couleur. |
| **Accent** (`prefs.accent`) | La couleur de ce qui ressort : boutons pleins, liens, état actif. Même nuancier qu'un tracker. Chaîne vide = celle de Tracklog. Ne touche pas aux couleurs des macros. |
| **Nuancier** (`SwatchGrid`, `COLORS`) | Dix ronds sur une ligne : sept teintes nommables d'un mot, un gris, l'**encre** (`var(--foreground)`), et le « + » qui ouvre l'**éditeur** (`ColorEditor` : teinte/saturation/luminosité + pipette système). |
| **Atelier** (`#atelier`) | La page qui rend tout le vocabulaire côte à côte, rangé en familles Atomic Design (jetons · atomes · molécules · organismes · modales · pages · technique · classes). Une **adresse**, pas un onglet : ni compte ni données. Sert à voir ce qu'un changement de thème déplace, et à regarder ce qui existe avant d'inventer un contrôle de plus. `#sink`, son ancienne adresse, y mène toujours. |
| **Retour** (`feedback`) | Un message envoyé depuis les paramètres : `kind` (bug · feature · avis · autre), le texte, et un `context` capté automatiquement (style, écran, navigateur). |

Les briques d'interface elles-mêmes — `Segmented`, `IconBar`, `NumField`,
`GearIcon`, `.icon-btn`, la convention des cartes — sont dans `ui.md`.

## Architecture technique

- **Aucun build.** JSX transformé dans le navigateur par `@babel/standalone` : toute modif d'un `.jsx` est visible au rechargement.
- **Cache-busting manuel** — le `?v=N` s'incrémente à la main dans `Tracklog.html`, pour **sept** fichiers : les six `.jsx` et `styles.css`. Un oubli laisse des utilisateurs sur l'ancienne version sans rien signaler.
- **Un seul espace de noms, et l'ordre de chargement EST l'ordre des dépendances.** `app.core.jsx` → `app.ui.jsx` → `app.charts.jsx` → `app.jsx` → `app.food.jsx` → `app.atelier.jsx`, montés ensemble par `mountTracklog()`. C'est `app.core.jsx` qui pose le scope global (React, `supabase`, `dayKey`, `uid`, `startOfDay`…) ; chaque fichier ne voit que ce que les précédents ont déclaré. Seuls les **initialiseurs** s'exécutent au chargement — un corps de fonction peut appeler un nom déclaré plus loin. Un seul jeu d'aides Babel pour tout le monde (voir `pieges.md`).
- **Persistance : Supabase** (Postgres + auth). Tables : `trackers`, `entries`, `chronos`, `foods`, `food_logs`, `nutrition_goals` (clé `(user_id, from_day)`), `meals`, `user_settings`, `feedback`, `service_connections` + `oauth_pending`. Clé anonyme publique dans `app.core.jsx` — protégée par RLS, pas un secret.
- **`service_connections` : RLS activée sans aucune policy.** La clé anon ne peut ni lire ni écrire les jetons OAuth, même pour leur propriétaire ; seule la fonction Edge, en clé de service, y touche. `oauth_pending` est son pendant éphémère (vérifieur PKCE + `state`).
- **Ajouter un réglage de tracker = une migration SQL.** `trackerToRow` envoie des colonnes nommées : toute propriété persistée demande un `alter table trackers add column …` **avant** déploiement, sinon tout enregistrement de tracker échoue — y compris la simple modification d'un tracker existant. Les colonnes doivent accepter `null`, le mapper applique le défaut à la lecture.
- **Les migrations s'appliquent directement.** Le connecteur Supabase (MCP) donne accès au projet `drrmqrhsfgermgblndzz` : `apply_migration` (DDL), `execute_sql` (inspection), `deploy_edge_function`. Le faire directement évite l'écart entre « le code est poussé » et « la base suit », qui a déjà cassé l'enregistrement des trackers. Exception : les **secrets** se posent à la main.
- **Le compte fait autorité, `localStorage` n'est qu'un miroir** (`useSyncedPref`). Reste vraiment local ce qui est un **état de travail** sur cet appareil : mode Solo/Multi des chronos, état et mode du rail. `AccountPrefsContext` (app.core.jsx) porte `{ prefs, savePrefs }` jusqu'aux composants trop loin dans l'arbre — au premier chef le scanner de Food.
- **Tout composant porte sa ligne `@atelier`, juste au-dessus de lui.** C'est la seule chose à faire pour qu'il entre dans l'atelier, et elle est **obligatoire** :

  ```js
  /* @atelier <famille> — <une phrase, ce qu'il est et pourquoi> */
  function MonComposant({ … }){
  ```

  Familles : `atome` · `molecule` · `organisme` · `modale` · `page` · `technique` (hooks, contextes, montages impératifs — tout ce qui n'a pas de forme). Ce qui doit en porter une : toute `function <Majuscule>()`, tout `function use<Majuscule>()`, tout `const <Majuscule> = (` ou `React.createContext` des cinq `.jsx` de l'app. Les constantes tout en capitales (`COLORS`, `FOOD_CHART_ID`) n'en portent pas — l'atelier les ignore.

  La description vit **dans le fichier du composant** et nulle part ailleurs : écrite dans l'atelier, ce serait une copie à tenir à jour, et c'est toujours la copie qui pourrit. L'oubli ne se punit pas, il **se voit** — un composant sans annotation s'affiche en tête de l'atelier, dans « Non déclarés », avec son fichier et sa ligne. Un spécimen (`atelierSpecimens`, app.atelier.jsx) est en plus, jamais à la place : sans lui la fiche s'affiche quand même, en disant qu'elle n'en a pas.
- **Drag & drop maison** (`useDragReorder`, app.ui.jsx) — pointer events, pas de librairie ; un ordre global par tracker, chaque vue réordonne un sous-ensemble reconstitué dans l'ordre complet.
- **Aucun framework CSS** — tout le style est dans `styles.css`, chargé par un `<link>` (pas d'inline dans `Tracklog.html`), thème « Aristide » (variables `--background`, `--foreground`, `--primary`…, au format shadcn, clair/sombre via `data-theme`). Les thèmes s'accrochent à **`[data-theme]`, pas `:root[data-theme]`** : posé sur n'importe quel élément, un thème repeint cet élément et sa descendance — dans l'app seul `<html>` le porte, l'atelier s'en sert pour montrer cinq thèmes sur une page. Les jetons partagés entre les deux thèmes (`--primary`, `--primary-hover`, `--primary-foreground`, `--secondary`, `--input`, `--ring`…) vivent en alias dans le `:root{}` de base, pas redits par thème — un thème shadcn/tweakcn externe n'a qu'à redéfinir `--background`/`--foreground`/`--card`/`--border`/`--muted`/`--destructive` pour que tout le reste suive.
