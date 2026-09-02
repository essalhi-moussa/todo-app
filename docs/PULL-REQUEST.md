# Flux de branches et revue de code

Livrable 4 du sujet : *« utilisation de branches (main, dev) »* et *« une pull
request simulée avec validation »*.

Ce document décrit le flux retenu, la procédure exacte pour produire la pull
request demandée, et la grille de revue utilisée.

---

## 1. Stratégie retenue : Gitflow simplifié

```
main  ──●──────────────────────────────●─────────────  production
         \                            /
          \                    PR #1 (revue + validation)
           \                        /
dev         ●────●────●────●───────●───────────────────  intégration
                  \        /
                   \  PR #2
                    \    /
feature/filtrage     ●──●                                fonctionnalité
```

| Branche | Rôle | Règles |
|---|---|---|
| `main` | version déployée en production | aucun push direct ; pull request obligatoire ; le pipeline y déclenche le déploiement Kubernetes |
| `dev` | intégration continue | cible des branches de fonctionnalité ; le pipeline y construit et publie l'image, sans déployer |
| `feature/*` | nouvelle fonctionnalité | issue de `dev`, fusionnée dans `dev`, supprimée ensuite |
| `fix/*` | correction de bug | même flux que `feature/*` |
| `hotfix/*` | correction urgente en production | issue de `main`, fusionnée dans `main` **et** `dev` |

### Pourquoi ce choix

Le cours *Gestion de Configuration* présente deux stratégies : **Gitflow**
(hiérarchique, adaptée aux grands projets) et **GitHub Flow** (simplifiée,
adaptée aux petites équipes agiles).

GitHub Flow pur — une seule branche longue — ne permettrait pas de distinguer
« intégré » de « déployé », alors que le pipeline a précisément besoin de cette
distinction : `dev` publie l'image, `main` déclenche le déploiement. Gitflow
complet (avec `release/*` et `support/*`) serait disproportionné pour un projet
sans versions maintenues en parallèle.

D'où **deux branches longues** (`main`, `dev`) et des branches de travail
éphémères : le minimum qui rende la condition
`when { branch 'main' }` du [`Jenkinsfile`](../Jenkinsfile) significative.

---

## 2. Cycle de contribution

### 2.1 Préparer la branche

```bash
git checkout dev
git pull origin dev

git checkout -b feature/filtrage-taches
```

Nommer la branche d'après son objet, jamais d'après son auteur ni d'après un
numéro seul : `feature/filtrage-taches` se lit, `feature/moussa-2` non.

### 2.2 Travailler par petits commits

```bash
# … modifications …
git add app/src/routes/tasks.js app/tests/tasks.api.test.js
git commit -m "feat(app): filtrer les taches par etat via ?done="
```

Le hook `commit-msg` refuse tout message hors convention. Le hook `pre-commit`
bloque secrets, fichiers volumineux, marqueurs de conflit, Terraform mal
formaté et YAML invalide.

Le cours CI rappelle deux règles appliquées ici : *« commiter le code
régulièrement »* et *« commiter du code bon »*.

### 2.3 Pousser

```bash
git push -u origin feature/filtrage-taches
```

Le hook `pre-push` exécute la suite de tests. Un échec bloque le push : le
build Jenkins de la branche partagée ne sera pas cassé par cette erreur.

### 2.4 Ouvrir la pull request

Sur GitHub : **Compare & pull request** → base `dev` ← comparaison
`feature/filtrage-taches`.

Modèle de description :

```markdown
## Objet
Permettre de filtrer la liste des tâches par état d'achèvement.

## Modifications
- `GET /api/tasks?done=true|false` filtre côté base (pas en mémoire)
- validation du paramètre : toute autre valeur renvoie 400
- 4 tests ajoutés (filtre vrai, faux, absent, invalide)

## Vérifications
- [x] `npm test` — 44 tests au vert
- [x] `npm run test:ci` — couverture stable (81 %)
- [x] hooks `pre-commit` et `pre-push` passés
- [x] aucune modification d'infrastructure

## Comment vérifier
```bash
curl 'http://localhost:8081/api/tasks?done=false'
curl -i 'http://localhost:8081/api/tasks?done=peut-etre'   # attendu : 400
```

## Points d'attention pour la revue
Le filtre est appliqué en SQL et non côté application : à confirmer que
l'index `idx_tasks_done` est bien utilisé (`EXPLAIN`).
```

### 2.5 Revue, correction, fusion

Le relecteur applique la [grille §4](#4-grille-de-revue). Les corrections se
font par de nouveaux commits sur la même branche — la pull request se met à
jour automatiquement.

Fusion en **squash merge** : une fonctionnalité = un commit sur `dev`,
l'historique reste lisible.

```bash
git checkout dev
git pull origin dev
git branch -d feature/filtrage-taches
git push origin --delete feature/filtrage-taches
```

### 2.6 Promouvoir en production

```bash
git checkout main
git pull origin main
git merge --no-ff dev -m "release: promotion de dev vers main"
git tag -a v1.1.0 -m "Filtrage des taches par etat"
git push origin main --tags
```

`--no-ff` force un commit de fusion : la trace de la promotion reste visible
dans `git log --graph`, ce qu'un *fast-forward* effacerait.

Le pipeline Jenkins déclenché sur `main` construit, publie **et déploie**.

---

## 3. Reproduire la pull request demandée

Séquence complète et vérifiable, à rejouer telle quelle. Elle produit une vraie
pull request sur GitHub — le sujet parle de PR « simulée » au sens de
« réalisée dans un cadre de projet », pas de PR fictive.

### 3.1 Prérequis

```bash
cd /mnt/c/Users/essalhi/Downloads/DevOps/todo-devops
bash scripts/install-hooks.sh

# main et dev existent et sont poussées (voir RUNBOOK §3)
git branch -a
```

### 3.2 Créer une modification démonstrative

```bash
git checkout dev
git pull origin dev
git checkout -b feature/compteur-taches
```

Ajouter un point d'entrée de statistiques dans
[`app/src/routes/tasks.js`](../app/src/routes/tasks.js), avant
`router.get('/:id', …)` — l'ordre compte, sinon Express interpréterait `stats`
comme un identifiant :

```javascript
  // GET /api/tasks/stats — compteurs pour le tableau de bord.
  // Doit être déclaré AVANT la route /:id, sinon Express traiterait
  // « stats » comme un identifiant de tâche.
  router.get('/stats', async (req, res, next) => {
    try {
      const tasks = await store.list();
      const done = tasks.filter((t) => t.done).length;
      res.json({
        total: tasks.length,
        done,
        pending: tasks.length - done,
      });
    } catch (err) {
      next(err);
    }
  });
```

Et le test correspondant dans
[`app/tests/tasks.api.test.js`](../app/tests/tasks.api.test.js) :

```javascript
  describe('GET /api/tasks/stats', () => {
    it('renvoie des compteurs cohérents', async () => {
      await store.create({ title: 'a' });
      const b = await store.create({ title: 'b' });
      await store.update(b.id, { done: true });

      const res = await request(app).get('/api/tasks/stats').expect(200);
      expect(res.body).toEqual({ total: 2, done: 1, pending: 1 });
    });

    it('renvoie des compteurs nuls sans aucune tâche', async () => {
      const res = await request(app).get('/api/tasks/stats').expect(200);
      expect(res.body).toEqual({ total: 0, done: 0, pending: 0 });
    });
  });
```

### 3.3 Valider localement, puis pousser

```bash
cd app && npm test && cd ..
git add app/src/routes/tasks.js app/tests/tasks.api.test.js
git commit -m "feat(app): exposer les compteurs de taches sur /api/tasks/stats"
git push -u origin feature/compteur-taches
```

### 3.4 Ouvrir et valider la pull request

Deux voies.

**Avec l'interface GitHub** — suivre le lien affiché par `git push`, choisir
`dev` comme base, coller le modèle de description du §2.4, demander une revue,
puis *Squash and merge*.

**Avec le client `gh`** :

```bash
gh pr create --base dev --head feature/compteur-taches \
  --title "feat(app): compteurs de taches" \
  --body-file - <<'MD'
## Objet
Exposer des compteurs (total / terminées / en cours) pour le tableau de bord.

## Modifications
- `GET /api/tasks/stats`, déclaré avant `/:id` pour éviter la collision de route
- 2 tests ajoutés

## Vérifications
- [x] `npm test` au vert
- [x] hooks pre-commit et pre-push passés
MD

gh pr view --web
gh pr review --approve --body "Route bien placée avant /:id, tests couvrant le cas vide. Validé."
gh pr merge --squash --delete-branch
```

### 3.5 Captures à conserver pour le rendu

| Capture | Ce qu'elle prouve |
|---|---|
| Onglet *Files changed* de la PR | la revue a porté sur un diff réel |
| Onglet *Conversation* avec l'approbation | la validation a eu lieu |
| Résultat du hook `pre-push` en console | les hooks fonctionnent |
| Build Jenkins de la branche | le pipeline s'exécute sur la contribution |
| `git log --graph --oneline --all` après fusion | la topologie des branches |

```bash
git log --graph --oneline --all --decorate | head -30
```

---

## 4. Grille de revue

Utilisée pour chaque pull request de ce projet.

### Fonctionnel

- [ ] Le comportement décrit est bien celui du code.
- [ ] Les cas limites sont traités : entrée vide, valeur absente, identifiant inexistant.
- [ ] Les erreurs sont renvoyées avec le bon code HTTP (400 / 404 / 500).
- [ ] Aucune régression sur l'existant.

### Tests

- [ ] Chaque comportement ajouté a son test.
- [ ] Les cas d'échec sont testés, pas seulement le chemin heureux.
- [ ] `npm test` passe intégralement.
- [ ] La couverture ne baisse pas.

### Qualité

- [ ] Nommage explicite, cohérent avec le code alentour.
- [ ] Les commentaires expliquent le *pourquoi*, jamais le *quoi*.
- [ ] Pas de duplication évitable.
- [ ] Pas de code mort ni de `console.log` oublié.

### Sécurité

- [ ] Aucun secret, jeton ni mot de passe dans le diff.
- [ ] Les entrées utilisateur sont validées.
- [ ] Les requêtes SQL sont paramétrées (jamais de concaténation).
- [ ] Aucune donnée sensible dans les journaux.

### Infrastructure — si le diff touche `infra/` ou `k8s/`

- [ ] `terraform fmt -check` et `terraform validate` passent.
- [ ] Le playbook Ansible reste idempotent (`--check --diff` sans écart).
- [ ] Les manifestes Kubernetes conservent sondes et limites de ressources.
- [ ] Aucune valeur codée en dur qui devrait être une variable.

### Documentation

- [ ] Le README reflète le nouveau comportement, s'il change l'usage.
- [ ] Un choix technique non évident est justifié quelque part.

---

## 5. Résolution d'un conflit de fusion

Situation courante quand `dev` a avancé pendant la revue.

```bash
git checkout feature/compteur-taches
git fetch origin
git rebase origin/dev
```

En cas de conflit :

```bash
git status                     # fichiers en conflit
# éditer : retirer <<<<<<<, =======, >>>>>>> en conservant le bon contenu
git add app/src/routes/tasks.js
git rebase --continue

cd app && npm test && cd ..    # revérifier APRÈS résolution
git push --force-with-lease
```

`--force-with-lease` et non `--force` : la publication est refusée si quelqu'un
d'autre a poussé entre-temps, ce qui évite d'écraser son travail.

Le cours *Gestion de Configuration* insiste : *« résoudre les conflits
rapidement »*. Un rebase quotidien sur `dev` rend les conflits triviaux ; une
branche laissée une semaine devient coûteuse à réintégrer.

---

## 6. Récapitulatif des commandes

| Besoin | Commande |
|---|---|
| Nouvelle fonctionnalité | `git checkout dev && git pull && git checkout -b feature/xxx` |
| Voir ses modifications | `git status && git diff` |
| Indexer partiellement | `git add -p` |
| Corriger le dernier commit | `git commit --amend` |
| Mettre de côté | `git stash` / `git stash pop` |
| Se resynchroniser sur `dev` | `git fetch origin && git rebase origin/dev` |
| Visualiser les branches | `git log --graph --oneline --all --decorate` |
| Récupérer un commit isolé | `git cherry-pick <sha>` |
| Annuler un commit publié | `git revert <sha>` |
| Promouvoir en production | `git checkout main && git merge --no-ff dev` |
| Étiqueter une version | `git tag -a v1.0.0 -m "…" && git push --tags` |
