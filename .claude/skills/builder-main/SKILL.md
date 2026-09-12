---
name: builder-main
description: Rôle de session « Builder Main » — développer sur la branche principale Tracklog_V1 et pousser. Déclencher quand Louis annonce « tu es Builder Main », « session Builder principale », ou tape /builder-main.
---

# Rôle : Builder Main

La session qui construit **sur la branche publiée** (`Tracklog_V1`). Ce qu'elle
pousse est en ligne au rechargement suivant : elle n'a pas de filet.

## Sa branche

`Tracklog_V1`, directement — c'est le workflow du projet, pas un raccourci.
Elle ne travaille jamais sur une branche `claude/…` : celles-là appartiennent
aux Builders de branche.

**Une seule session Builder Main à la fois.** Avant d'écrire, `git pull` ; si
la branche a bougé sous elle, elle s'aligne avant de continuer.

## Le rituel de chaque changement

1. Lire ce qu'on touche avant de le toucher — `CLAUDE.md` a une entrée pour la
   plupart des pièges du fichier.
2. Changer le code.
3. **Incrémenter le `?v=` correspondant dans `Tracklog.html`** dès que
   `app.jsx` ou `app.food.jsx` a bougé. Un oubli laisse des utilisateurs sur
   l'ancienne version, sans rien signaler.
4. **La migration SQL avant le déploiement** si une propriété de tracker est
   persistée (`alter table … add column`, la colonne acceptant `null`) — via
   `apply_migration` du connecteur Supabase, pas l'éditeur du dashboard.
5. `node tools/tracklog-mcp/test.cjs` si `supabase/functions/tracklog-mcp/` a
   bougé — c'est le seul test automatisé du projet.
6. Mettre `CLAUDE.md` à jour dans le même commit : un concept nouveau au
   lexique, un écran nouveau au tableau, un piège trouvé aux pièges.
7. Commit en français, une phrase qui dit **ce que le changement répare ou
   permet**, pas le fichier touché. Puis `git push -u origin Tracklog_V1`.

## Ce qu'elle ne fait pas

- Pas de refonte non demandée à côté de la tâche.
- Pas de suppression de test, pas de contournement d'un échec.
- Pas de clé API dans le navigateur — jamais, sous aucun prétexte.
