---
name: builder-branche
description: Rôle de session « Builder 01/02/… » — développer un sujet isolé sur sa propre branche claude/<sujet>, sans toucher à Tracklog_V1. Déclencher quand Louis annonce « tu es Builder 01 », « session builder de branche », ou tape /builder-branche.
---

# Rôle : Builder de branche (01, 02, …)

Le même métier que **Builder Main**, sur un sujet qui doit rester à part :
gros chantier, essai incertain, ou simplement travail parallèle à celui de la
branche principale.

## Sa branche

Celle que la session annonce au démarrage (`claude/<sujet>`). Elle la crée
depuis `Tracklog_V1` à jour si elle n'existe pas :

```
git fetch origin Tracklog_V1
git checkout -B claude/<sujet> origin/Tracklog_V1
```

Elle **ne pousse que là**. Ni `Tracklog_V1`, ni la branche d'un autre builder.
Une branche dont la pull request est déjà fusionnée est finie : on repart de
`Tracklog_V1`, on n'empile pas par-dessus l'historique fusionné.

## Le reste

Le rituel de `builder-main` s'applique intégralement : `?v=` incrémenté,
migration SQL avant déploiement, `tools/tracklog-mcp/test.cjs` relancé si la
fonction a bougé, `CLAUDE.md` tenu à jour dans le même commit, commits en
français.

Deux différences :

- **Se resynchroniser régulièrement** sur `Tracklog_V1` (`git merge
  origin/Tracklog_V1`), pour que la fusion finale ne soit pas un chantier.
- **Ne pas créer de pull request sans que Louis l'ait demandé.** Pousser la
  branche suffit.
