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
| `app.jsx` | Cœur : modèle de données trackers/entries, auth, tous les écrans sauf Bouffe. ~3780 lignes. |
| `app.food.jsx` | Page Bouffe : bibliothèque d'aliments, scanner de code-barres, journal de repas, objectifs. Second `<script type="text/babel">`, chargé après `app.jsx` — partage son scope global (React, `supabase`, `dayKey`, `uid`…). ~2330 lignes. |
| `index.html` | Redirige vers `Tracklog.html`. |
| `foods-ref.json` | Table Ciqual 2025 (ANSES) compactée en colonnes — 3341 aliments crus/cuits avec micronutriments, servie en statique pour la recherche hors-ligne d'aliments sans étiquette. |
| `manifest.json`, `icon-*.png`, `apple-touch-icon.png` | PWA — installable sur téléphone. |
| `tools/ciqual/` | Source Excel d'origine de la table Ciqual (génère `foods-ref.json`). |

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
| **Joker** | Un marqueur posé sur une journée entière (`value: '__joker__'`) qui **exclut** ce jour de tous les calculs — pas un zéro, une journée hors calcul (repos, écart planifié…). Option par tracker (`jokerEnabled`), sans effet sur un tracker quotidien. |
| **Fenêtre d'activité** (`windowEnabled`, `startDate`/`endDate`) | Bornes de dates hors desquelles un tracker n'influence ni les graphes ni les moyennes. `startDate` par défaut = date de création ; `endDate` posé automatiquement à l'archivage. |
| **Graphe cumulatif** (`cumulative`) | Option d'affichage (nombre/durée uniquement) : le graphe trace la somme cumulée depuis le début plutôt que la valeur du jour — courbe qui ne peut que monter. |
| **Archiver** | Masque un tracker du "Jour" et le range à part (liste des archives), sans supprimer ses entrées. Réversible (désarchiver). |
| **Chrono** | Un chronomètre autonome (état local, `localStorage`, pas synchronisé compte), qu'on peut lier à un tracker `duration` : « Enregistrer » convertit le temps écoulé en entrée. |
| **Mode Solo/Multi** (chronos) | Solo = démarrer un chrono met les autres en pause automatiquement ; Multi = ils tournent en parallèle. |
| **Master Strip** | Bande compacte (jauge 0–100) affichant la valeur du jour d'un master, en haut du "Jour" et de l'"Historique". |
| **Rail** (filtre) | Le panneau de pastilles cliquables (un tracker = une pastille) qui filtre les vues par sélection de trackers, avec tri (Manuel/A→Z/Récents/Type). |
| **Aliment** | Une fiche nutritionnelle "pour 100 g/ml" : `source: 'off'` (Open Food Facts, scanné) · `'custom'` (saisi à la main) · `'ref'` (table Ciqual, aliments sans étiquette). |
| **Food log** (ligne de repas) | Une portion mangée à un jour/repas donné. Garde un **snapshot** figé des valeurs nutritionnelles au moment de la saisie — corriger la fiche d'un aliment plus tard ne réécrit pas l'historique déjà loggé. |
| **Repas** | Une des 4 catégories fixes du jour : `matin` (petit-déjeuner) · `midi` · `soir` · `collation`. |
| **Macro** | Les 4 compteurs "de tête" de la page Bouffe : kcal, protéines, glucides, lipides — seuls à avoir un objectif et un graphe. |
| **Objectifs** (`nutrition_goals`) | Cibles quotidiennes kcal/protéines/glucides/lipides ; valeurs par défaut tant que rien n'est réglé. |

## Écrans

Navigation par onglets en haut (`tab`), certains avec sous-onglets (`Sub`).

| Onglet | Sous-onglet | Composant | Description |
|---|---|---|---|
| **Log** | Jour | `TodayView` → `DayGrid`/`DayCard` | Remplir aujourd'hui : une carte éditable par tracker actif, regroupées Quotidiens / Plusieurs par jour. Bouton "Tout ajouter" groupé. Affiche les Master Strips et le résumé Bouffe du jour. |
| | Historique | `HistoryView` → `MonthCalendar` + `DayGrid` | Calendrier mensuel (points = jours avec entrées) ; cliquer un jour ouvre son éditeur en dessous (identique au "Jour" mais sur une date passée). Reçoit aussi les sauts directs depuis le tooltip d'un graphe (`jumpTo`). |
| | Chrono | `ChronoView` → `ChronoCard` | Chronomètres, liés ou non à un tracker durée. Fenêtre flottante (Picture-in-Picture navigateur) pour garder les chronos visibles pendant qu'on fait autre chose. |
| **Bouffe** | Jour | `FoodDayView` | Repas du jour par catégorie, barres de progression vers les objectifs, panneau détail/micronutriments dépliable, navigation jour précédent/suivant. |
| | Aliments | `FoodLibraryView` | Bibliothèque des aliments enregistrés (scannés + perso), recherche, lien vers la fiche source. |
| | Vues | `FoodVuesView` → `NutritionBars` | Graphe en barres d'une macro sur N jours vs objectif, + répartition calorique P/G/L. |
| **Trackers** | — | `TrackersView` | Gérer les trackers : liste (actifs + archivés), type, fréquence, agrégat, membres si master. Créer/modifier/archiver/supprimer. |
| **Vues** | Graphes / Calendrier / Grille | `VuesView` → `ChartCard`/`MasterChart`/`TrendChart`/`CalendarCard`/`GridSummary` | Visualisation multi-tracker sur une période choisie (7/30/90/365j, YTD, tout, personnalisé) : courbes individuelles, overlay Master normalisé, tendance moyenne lissée, heatmap calendrier, grille de KPI. |
| **Paramètres** | — | `SettingsView` | Compte (email, mot de passe, déconnexion), thème clair/sombre, activer/désactiver les bulles d'aide. |
| *(hors onglets)* | — | `SignIn` | Connexion / création de compte / lien magique / mot de passe oublié. |

Modales transverses : `TrackerModal` (créer/éditer un tracker ou master),
`EntryModal` (éditer une entrée existante), `ChronoModal`, `AddFoodModal`
(scanner / rechercher / bibliothèque / saisie manuelle), `FoodEditModal`,
`GoalsModal`, `PasswordModal`.

## Fonctionnalités

- **Trackers configurables** — 6 types de données + un type calculé (master), fréquence quotidienne ou multi-entrées, agrégat, unité, couleur, fenêtre d'activité, archivage réversible.
- **Case joker** — exclure une journée entière des calculs sans la compter comme un échec.
- **Masters (indices composites)** — moyenne normalisée 0–100 de plusieurs trackers, avec bande de lecture (Master Strip) et carte graphe dédiée.
- **Graphes par tracker** avec axes auto-arrondis (`niceDomain`/`niceStep`), pontage en pointillés des trous de données, mode cumulatif optionnel.
- **Tooltip flottant sur les graphes** — survol souris / toucher tactile affiche la valeur du jour pointé, avec un bouton rond pour ouvrir ce jour dans l'Historique (édition directe) et un bouton rond pour fermer.
- **Vue Master overlay** et **Tendance générale** — comparer plusieurs trackers normalisés sur le même graphe, ou leur moyenne lissée sur 7 jours.
- **Heatmap calendrier** par tracker (`CalendarCard`) et **grille de KPI** (`GridSummary`, avec variation vs période précédente).
- **Historique éditable** — calendrier mensuel, ouvrir/éditer n'importe quel jour passé.
- **Chronos** — plusieurs chronomètres, mode Solo/Multi, fenêtre flottante (Document Picture-in-Picture), conversion directe en entrée sur un tracker durée.
- **Réordonnancement par glisser-déposer** — trackers, cartes du jour, master strips ; un ordre global unique, chaque liste n'affiche/réordonne qu'un sous-ensemble sans perturber le reste (`mergeSubOrder`).
- **Filtre + tri** (rail) — afficher un sous-ensemble de trackers sur Log/Trackers/Vues, trié Manuel/A→Z/Récents/Type.
- **Bulles d'aide "i"** — explications contextuelles activables/désactivables globalement.
- **Thème clair/sombre**, préférence locale par appareil.
- **Bouffe : scanner de code-barres** — caméra (BarcodeDetector natif ou ZXing en repli), plusieurs passes de recadrage/rotation, secours photo native et saisie manuelle du code.
- **Recherche Open Food Facts** — plusieurs moteurs en cascade, cache et limiteur de débit (quota OFF).
- **Table Ciqual embarquée** — recherche instantanée hors-ligne des aliments sans étiquette (légumes, viandes brutes…), avec micronutriments.
- **Snapshot nutritionnel** — chaque ligne de repas figée à sa valeur du moment ; corriger un aliment plus tard ne modifie pas l'historique.
- **Objectifs nutritionnels** journaliers avec barres de progression et alerte dépassement.
- **Détail réglementaire + micronutriments** avec % des repères journaliers (AJR) quand disponibles.
- **PWA installable**, thème système, auth email/mot de passe + lien magique + réinitialisation.

## Architecture technique

- **Aucun build.** JSX transformé en direct dans le navigateur par `@babel/standalone`. Toute modif de `.jsx` est visible après rechargement — pas d'étape de compilation à lancer.
- **Persistance : Supabase** (Postgres + auth). Tables : `trackers`, `entries`, `foods`, `food_logs`, `nutrition_goals`. Clé anonyme publique dans `app.jsx` (protégée par Row Level Security côté Supabase, pas un secret à cacher).
- **État local (`localStorage`, non synchronisé)** : chronos (`tracklog.chronos.<userId>`), préférence Solo/Multi, activation des bulles d'aide, thème.
- **`app.food.jsx` dépend du scope global posé par `app.jsx`** (React, `supabase`, `dayKey`, `uid`, `startOfDay`…) — les deux fichiers sont deux `<script>` distincts mais partagent un seul espace de noms global, chargés dans cet ordre puis montés ensemble (`mountTracklog()`).
- **Drag & drop maison** (`useDragReorder`) — pointer events, pas de librairie ; un ordre global par tracker, chaque vue réordonne un sous-ensemble reconstitué dans l'ordre complet.
- **Cache-busting manuel** — les `<script src="app.jsx?v=N">` portent un numéro de version à incrémenter à la main dans `Tracklog.html` pour forcer le rechargement (pas de hash de build automatique).
- **Aucun framework CSS** — tout le style est dans `<style>` en tête de `Tracklog.html`, thème "Aristide" (variables CSS `--bg`, `--ink`, `--accent`…, clair/sombre via `data-theme`).

## Décisions et pièges connus

- **Joker ≠ zéro.** Un jour joker est *exclu* des agrégats, jamais compté comme 0 — vérifier `isJokerEntry`/`jokerDayKeys` avant toute nouvelle fonction de calcul.
- **Master ne forward-fill jamais.** `computeMasterSeries` laisse les trous en trous (dessinés en pointillés) plutôt que de reporter la dernière valeur connue — un master ne doit jamais paraître à jour alors que ses membres ne le sont plus.
- **Une entrée "quotidienne" remplace, ne s'additionne pas** (`addEntry` dans `App`, logique `tracker.daily`).
- **`app.food.jsx` n'a pas de `const { useState... } = React` à lui** — il compte sur celui déclaré en tête de `app.jsx`. Ne jamais réordonner le chargement des deux scripts dans `Tracklog.html`.
- **OFF (Open Food Facts) a un quota de recherche serré** (~10 req/min) — `takeSearchToken`/cache dans `app.food.jsx` ; ne pas retirer le limiteur sans comprendre pourquoi il existe (429 sinon).
- **Cache-busting manuel** — après une modif de `app.jsx` ou `app.food.jsx`, penser à incrémenter le `?v=` correspondant dans `Tracklog.html`, sinon des utilisateurs peuvent rester sur une version en cache.
- **Pas de tests automatisés, pas de build.** Toute validation passe par relecture + test manuel dans un navigateur (le fichier compile-t-il via Babel, l'app charge-t-elle sans erreur console).
- **Workflow de branche actuel** : développement direct sur `Tracklog_V1` (branche par défaut = celle publiée), pas de branche de feature intermédiaire — voir historique de commits pour le contexte.
