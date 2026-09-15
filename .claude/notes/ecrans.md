# Écrans de Tracklog

Le détail des écrans, des sous-onglets et des pages plein écran. Ouvrir ce
fichier avant de **toucher à la navigation, d'ajouter un écran ou de déplacer
un contrôle d'une page à l'autre** — la carte du projet (`CLAUDE.md`) n'en
garde que la liste des onglets.

## Écrans


Navigation par onglets en haut (`tab`), certains avec sous-onglets (`Sub`).

| Onglet | Sous-onglet | Composant | Description |
|---|---|---|---|
| **Log** | Jour | `TodayView` → `DayGrid`/`DayCard` | Remplir aujourd'hui : une carte éditable par tracker actif, regroupées Quotidiens / Plusieurs par jour. Bouton « + Nouveau tracker » en tête. Bouton "Tout ajouter" groupé. Affiche les Master Strips et le résumé Food du jour. |
| | Historique | `HistoryView` → `MonthCalendar` + `DayGrid` | Calendrier mensuel (points = jours avec entrées) ; cliquer un jour ouvre son éditeur en dessous (identique au "Jour" mais sur une date passée). Reçoit aussi les sauts directs depuis le tooltip d'un graphe (`jumpTo`). |
| | Chrono | `ChronoView` → `ChronoCard` | Chronomètres, liés ou non à un tracker durée. Fenêtre flottante (Picture-in-Picture navigateur) pour garder les chronos visibles pendant qu'on fait autre chose. |
| **Food** | Jour | `FoodDayView` | Repas du jour par catégorie, barres de progression vers les objectifs (**ce qu'il reste**, pas ce qu'on a mangé), panneau détail/micronutriments dépliable, navigation jour précédent/suivant. |
| | Vues | `FoodVuesView` | Trois sous-onglets — **Macros** (les quatre `ChartCard`, une par macro) · **Répartition** (`MacroSplitCard`) · **Micros** (une carte par micronutriment, filtrables par `MicroPicker`). Mêmes cartes, même curseur de densité et mêmes échelles de période que l'onglet Vues. |
| **Vues** | Graphes / Tendance / Calendrier / Grille | `VuesView` → `ChartCard`/`MasterTrackerCard`/`TrendChart`/`CalendarCard`/`GridSummary` | Visualisation multi-tracker sur une période choisie (7/30/90/365j, YTD, tout, personnalisé) : une carte par tracker (densité au curseur), moyenne normalisée lissée, heatmap calendrier, grille de KPI. **Quatre vues à plat** — la barre « Affichage » qui vivait sous « Graphes » a disparu : ce n'étaient pas des réglages de Graphes mais des vues à part entière, et deux niveaux de bascule l'un sous l'autre demandaient de retenir dans quel sous-onglet on se trouvait. L'overlay **Master** (`MasterChart`) est parti avec elle : un master a déjà sa carte parmi les cartes. |
| **Training** | — | `TrainingView` | Réservé — le suivi d'entraînement viendra ici. Masquable tant qu'il est vide. |
| **AI analyst** | — | `AnalystView` | Réservé — Claude y lira les trackers ensemble (corrélations, régularités, ce qu'un master doit à un seul membre). L'onglet existe, le contenu viendra. |
| **Paramètres** | — | `SettingsView` | Compte · Style (thème **et** couleur d'accent, au même nuancier que les trackers) · Onglets (`TabsSettingsCard` : afficher/masquer **et** réordonner, Log compris) · Affichage (bulles infos, numéro de semaine) · **Archives** (trackers archivés, seul point d'accès pour les désarchiver) · Un retour ? (`FeedbackCard`). Chaque réglage porte sa bulle « i » ; les lignes sont en `.field.spread` — intitulé à gauche, contrôle collé au bord droit, pour que la colonne des bascules s'aligne au lieu d'onduler avec la longueur des noms. |
| *(hors onglets)* | — | `SignIn` | Connexion / création de compte / lien magique / mot de passe oublié. |
| *(hors onglets)* | — | `SinkView` | L'**atelier**, à l'adresse `#sink` (app.sink.jsx) : le vocabulaire visuel au complet, hors de la barre d'onglets et hors de l'authentification. |

Pas d'onglet « Trackers » séparé : chaque carte du Log et chaque Master Strip
porte son propre engrenage vers `TrackerModal`, et « + Nouveau tracker » est en
tête du Log — le rail de filtre garde aussi son propre bouton d'ajout. Un
tracker archivé n'a plus de carte nulle part pour porter un engrenage ; la
liste **Archives** des paramètres est donc son seul chemin de retour.

`MealEditModal` est, comme la page d'ajout et malgré son nom, une **page
entière** (`.fd-add-page`) — trois cadres : le titre, les ingrédients, la
recette. « ＋ Ajouter un ingrédient » y rouvre `AddFoodModal` en **mode
choisir** : une recette se compose donc d'un produit scanné, d'un aliment
Ciqual, d'une analyse IA ou d'un autre repas entier, par les mêmes quatre
onglets que l'ajout d'une journée — aucun de ces chemins n'est réécrit pour
l'occasion.

`TrackerModal` (créer/éditer un tracker ou master) est, malgré son nom et
comme `AddFoodModal`/`MealEditModal`, une **page entière** (`.fd-add-page`) —
cinq cadres en cartes (Cœur, Paramètres, Source, Vues, Couleur — Source n'apparaît que pour un tracker de type nombre) plutôt qu'une boîte
étroite au-dessus du Log : les champs à choix (genre, fréquence, courbe,
granularité) y sont des pastilles pleine largeur (`Segmented size="compact"`),
pas des chips à leur contour. Les champs à saisir suivent le même principe :
`NumPill` habille min/max/incrément d'une échelle et la valeur cible dans une
`.pill` comme celles du rail, et la période d'activité (Début/Fin) est deux
`.pill` qui ouvrent le `MonthCalendar` de l'Historique en pastille plutôt que
d'inventer un second sélecteur de date — aucune boîte à bordure carrée ne
reste sur la page.

Modales transverses restantes : `EntryModal` (éditer une entrée existante),
`ChronoModal`, `AddFoodModal`, `FoodEditModal`, `MealEditModal`, `GoalsModal`,
`PasswordModal`.

`AddFoodModal` est **la page d'ajout** : le bouton principal de Food n'ouvre
plus un scanner mais elle, et le scan n'y est plus qu'une façon d'arriver parmi
quatre. Malgré son nom (gardé pour ne pas casser tous les appels), ce n'est
plus une modale mais une page plein écran (`.fd-add-page`) — quatre onglets ont
besoin de place pour respirer, pas d'un couloir centré avec sa propre limite de
hauteur. Titre et onglets (`.fd-add-head`, `.fd-add-tabs`) restent fixes en
haut, seul `.fd-add-body` défile. Une seule rangée de quatre onglets, qui sont
quatre gestes distincts :

| Onglet | Ce qu'on y fait | Composant |
|---|---|---|
| Recherche | Chercher dehors — Ciqual, Open Food Facts — dans **une** barre à icône `inset` qui accepte aussi bien un nom qu'un code-barres ; son bouton rond sort la caméra sous elle. Les trois provenances tombent dans **une seule liste**, triée : nom exact d'abord, puis favoris, puis déjà enregistré. | recherche OFF/Ciqual + `FoodScanner` |
| Mes items | Reprendre ce qui est déjà à soi : **la même** barre de recherche qu'à côté (une saisie unique, partagée), puis une barre à icône `detached` qui porte la bascule Aliments/Repas et quatre ronds — « + » (vers Créer, avec ce qu'on cherchait), tri, étoile (favoris), vignettes. | liste filtrée · `MealsTab` |
| IA | Décrire, photographier, ou les deux. Deux rectangles pleine largeur : la photo (un « + » au centre), puis le texte, puis la bascule Normal / Approfondi. | `AiAnalyseTab` |
| Créer | Poser les chiffres soi-même : un correctif de journée, un aliment à soi, ou un repas entier (voir **Créer** au lexique). | `QuickAddTab` |

Les sept onglets d'avant, répartis sur deux rangées, mélangeaient « où je
cherche » et « quoi je cherche » — le scan était un onglet à lui seul alors que
c'est une façon de remplir la recherche, et « à la main » ne disait pas ce
qu'il fabriquait. Rien n'a disparu : ils sont devenus les sous-bascules de ces
quatre.
