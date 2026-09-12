# Rôles de session

Plusieurs sessions travaillent sur Tracklog en parallèle, chacune avec un rôle.
Louis l'annonce en début de session (« tu es Reviewer », `/reviewer`…). Tant
qu'aucun rôle n'est annoncé, aucun n'est pris : ne pas deviner.

Un rôle dit **ce que la session a le droit de faire**, pas seulement ce qu'elle
fait bien. La séparation ne sert à rien si une session qui devait lire écrit
quand même.

| Rôle | Écrit du code ? | Où | Fiche |
|---|---|---|---|
| **Assistant** | non | — | `.claude/skills/assistant/SKILL.md` |
| **Builder Main** | oui | `Tracklog_V1` | `.claude/skills/builder-main/SKILL.md` |
| **Builder 01, 02…** | oui | `claude/<sujet>` | `.claude/skills/builder-branche/SKILL.md` |
| **Reviewer & security** | non (sauf `--fix` demandé) | — | `.claude/skills/reviewer/SKILL.md` |
| **Atelier** | non dans l'app | maquettes hors dépôt | `.claude/skills/atelier/SKILL.md` |

Règles communes à tous les rôles :

- **Une seule session écrit sur une branche donnée.** Deux builders sur
  `Tracklog_V1` se marchent dessus ; un builder de branche ne touche jamais
  `Tracklog_V1` ni la branche d'un autre.
- **`CLAUDE.md` est la carte, et elle se tient à jour** — un builder qui ajoute
  un concept, un piège ou un écran l'y écrit dans le même commit. Les autres
  rôles ne l'écrivent pas : ils le proposent à Louis.
- **Le français, partout** — commits, messages, noms dans la conversation.
- **Un rôle ne se déborde pas en silence.** Si le travail demandé appartient à
  un autre rôle, le dire et proposer la session qui convient, plutôt que de le
  faire quand même.
