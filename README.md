# Déploiement Automatisé d'une Application Web de Gestion des Tâches

> Projet final — **DevOps et Intégration Continue**
> Université Hassan II · Faculté des Sciences Aïn Chock · Département Mathématiques & Informatique

Chaîne DevOps complète et reproductible pour une application web de gestion de tâches
(type Trello minimaliste) : provisionnement de l'infrastructure par **Terraform**,
configuration par **Ansible**, intégration et livraison continues par **Jenkins**,
orchestration par **Kubernetes**.

Toute la chaîne se rejoue de zéro en **quatre commandes**, sur une seule machine,
sans compte cloud payant.

---

## Sommaire

- [Architecture](#architecture)
- [Correspondance avec les livrables attendus](#correspondance-avec-les-livrables-attendus)
- [Prérequis](#prérequis)
- [Démarrage rapide](#démarrage-rapide)
- [Le flux en détail](#le-flux-en-détail)
- [Structure du dépôt](#structure-du-dépôt)
- [Application](#application)
- [Workflow Git](#workflow-git)
- [Pipeline CI/CD](#pipeline-cicd)
- [Kubernetes](#kubernetes)
- [Sécurité et gestion des secrets](#sécurité-et-gestion-des-secrets)
- [Dépannage](#dépannage)
- [Nettoyage](#nettoyage)
- [Choix techniques assumés](#choix-techniques-assumés)

---

## Architecture

L'hôte **WSL2 Ubuntu** joue le rôle d'hyperviseur / fournisseur d'infrastructure.
Terraform y provisionne deux nœuds isolés, qu'Ansible configure ensuite par SSH.

```
┌─ Windows ────────────────────────────────────────────────────────────────────┐
│  Navigateur                                                                  │
│    http://localhost:8080  (Jenkins)     http://localhost:8081  (application) │
└──────────┬────────────────────────────────────────┬──────────────────────────┘
           │                                        │
┌─ WSL2 Ubuntu 24.04 — « hyperviseur » ─────────────┼──────────────────────────┐
│                                                   │                          │
│  Terraform ──── provisionne ────┐                 │                          │
│  Ansible   ──── configure ──────┤  (SSH)          │                          │
│                                 ▼                 ▼                          │
│   ┌─ node-jenkins  172.28.0.10 ─┐   ┌─ node-k8s  172.28.0.11 ─────────────┐ │
│   │                             │   │                                      │ │
│   │  Jenkins LTS  :8080         │   │  NGINX  :80  (reverse proxy)         │ │
│   │  Docker (build + push)      │   │     └──► NodePort 30080              │ │
│   │  kubectl ───────────────────┼──►│  PostgreSQL 16  :5432 (intégration)  │ │
│   │  Node.js 20 (tests)         │   │  minikube  (Docker imbriqué)         │ │
│   │  Git                        │   │   ┌─ cluster Kubernetes ───────────┐ │ │
│   │                             │   │   │ ns todo-app                    │ │ │
│   └─────────────────────────────┘   │   │  Deployment todo-app   ×2      │ │ │
│              │                      │   │  Service NodePort 30080        │ │ │
│              │                      │   │  Deployment todo-postgres      │ │ │
│              │                      │   │  PV / PVC 2 Gi   Secret        │ │ │
│              │                      │   └────────────────────────────────┘ │ │
│              │                      └──────────────────────────────────────┘ │
│              │  réseau privé devops-net  172.28.0.0/24                       │
└──────────────┼───────────────────────────────────────────────────────────────┘
               │
               ▼  docker push / pull
         ┌───────────┐        ┌───────────┐
         │ DockerHub │        │  GitHub   │  main / dev + pull requests
         └───────────┘        └───────────┘
```

**Chemin d'accès de l'utilisateur à l'application :**

```
navigateur → localhost:8081 → port publié du nœud (Terraform)
  → NGINX (Ansible) → NodePort 30080 (Service K8s) → pods todo-app:3000
    → Service todo-postgres:5432 → PostgreSQL → PersistentVolume
```

Une version détaillée des flux et des décisions figure dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Correspondance avec les livrables attendus

| # | Livrable du sujet | Réalisation | Où regarder |
|---|---|---|---|
| 1 | **IaC** : provisionner 2 VM (Jenkins, Kubernetes) | Terraform déclare réseau, image, 2 nœuds, volumes, et génère l'inventaire Ansible | [`infra/terraform/`](infra/terraform/) |
| 1 | Installer Docker, Git, Kubernetes (minikube) | Rôles Ansible `common`, `docker`, `kubernetes` | [`infra/ansible/roles/`](infra/ansible/roles/) |
| 1 | Configurer une base de données + un serveur web | Rôles `postgresql` (PostgreSQL 16) et `nginx` | [`roles/postgresql/`](infra/ansible/roles/postgresql/), [`roles/nginx/`](infra/ansible/roles/nginx/) |
| 2 | **Application web** TODO (Node.js) | API REST Express + PostgreSQL + interface web, 40 tests | [`app/`](app/) |
| 2 | Code source versionné | Dépôt Git, branches `main` / `dev` | ce dépôt |
| 3 | **Pipeline Jenkins** : clone, tests, build, push, déploiement | Pipeline déclaratif à 9 étapes | [`Jenkinsfile`](Jenkinsfile) |
| 4 | **Git** : structure, `.gitignore`, README | Arborescence par domaine, 49 règles d'exclusion | [`.gitignore`](.gitignore) |
| 4 | Branches `main` / `dev`, pull request validée | Flux documenté et rejouable | [`docs/PULL-REQUEST.md`](docs/PULL-REQUEST.md) |
| 4 | Hooks Git | `pre-commit`, `commit-msg`, `pre-push` versionnés | [`scripts/git-hooks/`](scripts/git-hooks/) |
| 5 | **Kubernetes** : déploiement de l'application | `Deployment` 2 réplicas, sondes, limites de ressources | [`k8s/40-app-deployment.yaml`](k8s/40-app-deployment.yaml) |
| 5 | Service d'exposition (NodePort) | `Service` NodePort 30080 | [`k8s/41-app-service.yaml`](k8s/41-app-service.yaml) |
| 5 | Volume persistant pour la base | `PersistentVolume` + `PersistentVolumeClaim` 2 Gi | [`k8s/30-postgres-storage.yaml`](k8s/30-postgres-storage.yaml) |
| 5 | Secret pour la configuration sensible | `Secret` + `ConfigMap` séparés | [`k8s/10-secret.yaml`](k8s/10-secret.yaml) |
| — | Documentation | Ce fichier + 3 documents dédiés | [`docs/`](docs/) |

---

## Prérequis

| Élément | Version testée | Remarque |
|---|---|---|
| Windows 10/11 | 11 Pro 22621 | |
| WSL2 + Ubuntu | 24.04 LTS | **systemd doit être actif** — voir ci-dessous |
| Espace disque libre | ≥ 20 Go | images de base, Jenkins, minikube, images applicatives |
| RAM libre | ≥ 8 Go | 2 Go pour le nœud CI, 6 Go pour le nœud Kubernetes |
| Compte GitHub | — | dépôt distant, branches, pull request |
| Compte DockerHub | — | publication de l'image (jeton d'accès recommandé) |

Docker, Terraform, Ansible et kubectl **n'ont pas besoin d'être installés** : le
script de bootstrap s'en charge.

Vérifier que systemd est actif dans WSL (indispensable : les rôles Ansible
pilotent les services avec le module `systemd`) :

```powershell
wsl -d Ubuntu-24.04 -- ps -p 1 -o comm=
# doit afficher : systemd
```

Si la commande affiche `init` ou `sh`, ajouter dans `/etc/wsl.conf` de la
distribution :

```ini
[boot]
systemd=true
```

puis `wsl --shutdown` depuis PowerShell.

---

## Démarrage rapide

Toutes les commandes s'exécutent **depuis WSL**, à la racine du dépôt.

```bash
# 0. Se placer dans le dépôt (ajuster le chemin)
cd /mnt/c/Users/essalhi/Downloads/DevOps/todo-devops

# 1. Préparer l'hôte : Docker, Terraform, Ansible, kubectl, clé SSH
#    (demande le mot de passe sudo une seule fois)
bash infra/00-bootstrap-wsl.sh

#    Recharger la session pour que le groupe « docker » prenne effet
exit                       # puis, depuis PowerShell : wsl --shutdown
                           # et rouvrir WSL

# 2. Provisionner l'infrastructure (Terraform) — environ 3 minutes
bash infra/01-provision.sh

# 3. Configurer les nœuds (Ansible) — 10 à 20 minutes au premier passage
bash infra/02-configure.sh

# 4. Déployer l'application sur le cluster
kubectl apply -k k8s/
kubectl -n todo-app rollout status deployment/todo-app
```

Puis, depuis Windows :

| Service | URL | Identifiants |
|---|---|---|
| Application | <http://localhost:8081> | — |
| Jenkins | <http://localhost:8080> | `admin` / `admin123` |
| API Kubernetes | <https://172.28.0.11:8443> | kubeconfig du nœud |
| PostgreSQL (intégration) | `localhost:5432` | `todo` / voir `group_vars/all.yml` |

---

## Le flux en détail

### Étape 1 — Bootstrap de l'hôte

[`infra/00-bootstrap-wsl.sh`](infra/00-bootstrap-wsl.sh) installe Docker CE,
Terraform, Ansible et kubectl depuis les dépôts officiels (clés GPG vérifiées),
active le service Docker, ajoute l'utilisateur au groupe `docker` et génère la
paire de clés `~/.ssh/devops_id_ed25519`.

**La clé privée reste dans `~/.ssh` sous WSL et n'est jamais versionnée.**
Terraform n'injecte que la clé publique dans les nœuds.

### Étape 2 — Provisionnement (Terraform)

```bash
cd infra/terraform
terraform init
terraform plan
terraform apply
```

Terraform crée, de façon **déclarative** :

- le réseau privé `devops-net` (`172.28.0.0/24`, adressage statique) ;
- l'image de nœud `todo-devops/node-base:24.04` — Ubuntu 24.04 avec **systemd
  comme PID 1** et un serveur SSH, pour que les nœuds se comportent comme de
  vraies VM Linux ;
- les nœuds `node-jenkins` (2 Go) et `node-k8s` (6 Go, privilégié) ;
- trois volumes persistants (`jenkins-home`, `k8s-docker-lib`, `k8s-pgdata`) ;
- **l'inventaire Ansible**, généré depuis l'état réel de l'infrastructure —
  il ne peut donc pas décrire des machines qui n'existent pas.

```bash
terraform output           # points d'accès, commandes SSH, étape suivante
```

### Étape 3 — Configuration (Ansible)

```bash
cd infra/ansible
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
ansible -i inventory/hosts.ini nodes -m ping
ansible-playbook -i inventory/hosts.ini site.yml
```

Le playbook [`site.yml`](infra/ansible/site.yml) enchaîne cinq étapes :

| Étape | Cible | Rôles | Effet |
|---|---|---|---|
| 0 | les 2 nœuds | — | attente SSH, vérification de systemd |
| 1 | les 2 nœuds | `common`, `docker` | paquets de base, Git, Docker CE |
| 2 | `node-jenkins` | `jenkins` | Java 17, Jenkins LTS, 15 greffons, Node.js 20, kubectl |
| 3 | `node-k8s` | `kubernetes`, `postgresql`, `nginx` | minikube, PostgreSQL 16, NGINX |
| 4 | `node-jenkins` | — | distribution du kubeconfig, test d'accès au cluster |

Exécutions ciblées :

```bash
ansible-playbook -i inventory/hosts.ini site.yml --tags jenkins
ansible-playbook -i inventory/hosts.ini site.yml --tags kubernetes,database
ansible-playbook -i inventory/hosts.ini site.yml --check --diff   # simulation
```

Le playbook est **idempotent** : le rejouer ne produit aucune modification si
rien n'a changé (principe de convergence vers l'état cible du cours IaC).

### Étape 4 — Déploiement

Deux voies, équivalentes :

```bash
# manuellement, depuis WSL
kubectl apply -k k8s/

# ou via le pipeline Jenkins (voie normale) : voir docs/RUNBOOK.md
```

---

## Structure du dépôt

```
todo-devops/
├── README.md                     ce document
├── Jenkinsfile                   pipeline CI/CD déclaratif (9 étapes)
├── .gitignore                    49 règles : rien de généré ni de secret
│
├── app/                          ── APPLICATION ──────────────────────────
│   ├── src/
│   │   ├── server.js             point d'entrée, arrêt propre sur SIGTERM
│   │   ├── app.js                assemblage Express, sondes /health et /ready
│   │   ├── config.js             configuration lue depuis l'environnement
│   │   ├── routes/tasks.js       API REST + validation des entrées
│   │   ├── store/                dépôt de données : postgres | memory
│   │   └── public/               interface web (2 colonnes, type Trello)
│   ├── tests/                    40 tests Jest + Supertest
│   ├── migrations/001_init.sql   schéma — source unique de vérité
│   ├── Dockerfile                build multi-étapes, image finale non-root
│   └── package.json
│
├── infra/                        ── INFRASTRUCTURE AS CODE ───────────────
│   ├── 00-bootstrap-wsl.sh       installe l'outillage sur l'hôte
│   ├── 01-provision.sh           terraform init / validate / plan / apply
│   ├── 02-configure.sh           ansible-playbook site.yml
│   ├── terraform/
│   │   ├── main.tf               réseau, image, 2 nœuds, volumes, inventaire
│   │   ├── variables.tf          tout est paramétrable
│   │   ├── outputs.tf            points d'accès et commandes utiles
│   │   ├── templates/            gabarit de l'inventaire Ansible
│   │   └── images/node-base/     Ubuntu + systemd + SSH
│   └── ansible/
│       ├── ansible.cfg           ControlMaster, pipelining, cache de faits
│       ├── site.yml              playbook principal
│       ├── group_vars/all.yml    source unique des variables
│       ├── inventory/            hosts.ini (généré) + .example
│       └── roles/                common, docker, jenkins, kubernetes,
│                                 postgresql, nginx
│
├── k8s/                          ── ORCHESTRATION ────────────────────────
│   ├── 00-namespace.yaml
│   ├── 10-secret.yaml            identifiants de la base
│   ├── 20-configmap.yaml         configuration non sensible
│   ├── 30-postgres-storage.yaml  PersistentVolume + PersistentVolumeClaim
│   ├── 32-postgres-deployment.yaml
│   ├── 40-app-deployment.yaml    2 réplicas, 3 sondes, initContainer
│   ├── 41-app-service.yaml       Service NodePort 30080
│   └── kustomization.yaml        kubectl apply -k k8s/
│
├── scripts/                      ── OUTILLAGE ────────────────────────────
│   ├── install-hooks.sh          active core.hooksPath
│   └── git-hooks/                pre-commit, commit-msg, pre-push
│
└── docs/                         ── DOCUMENTATION ────────────────────────
    ├── ARCHITECTURE.md           flux, décisions et alternatives écartées
    ├── RUNBOOK.md                procédures d'exploitation pas à pas
    └── PULL-REQUEST.md           flux de branches et revue de code
```

---

## Application

API REST minimale au-dessus de PostgreSQL, avec une interface web à deux
colonnes (« À faire » / « Terminées »).

| Méthode | Route | Effet |
|---|---|---|
| `GET` | `/health` | sonde de vivacité — **n'interroge pas la base** |
| `GET` | `/ready` | sonde de disponibilité — vérifie la base (503 sinon) |
| `GET` | `/api/tasks` | liste les tâches |
| `POST` | `/api/tasks` | crée une tâche (`{ "title": "…" }`) |
| `GET` | `/api/tasks/:id` | lit une tâche |
| `PATCH` | `/api/tasks/:id` | modifie partiellement (`title`, `description`, `done`) |
| `DELETE` | `/api/tasks/:id` | supprime une tâche |

**Lancement local, sans infrastructure :**

```bash
cd app
npm ci
STORE_DRIVER=memory npm start      # http://localhost:3000
```

**Tests :**

```bash
cd app
npm test                           # 40 tests
npm run test:ci                    # + couverture + rapport JUnit exploitable
```

Résultat attendu : `Tests: 40 passed, 40 total`, couverture ≈ 81 % des
instructions. Le rapport `app/reports/junit.xml` est celui que publie Jenkins.

### Deux points de conception qui se voient à l'exécution

**Les sondes ne testent pas la même chose.** `/health` répond toujours si le
process vit ; `/ready` échoue si PostgreSQL est injoignable. Conséquence : une
panne de base **retire** les pods du Service sans les tuer, au lieu de
provoquer une boucle de redémarrages qui masquerait la cause réelle.

**L'abstraction du dépôt de données.** `STORE_DRIVER=memory` fait tourner
l'application et ses 40 tests sans PostgreSQL. Le pipeline exécute donc les
tests unitaires en quelques secondes, sans base à provisionner.

---

## Workflow Git

Le projet suit un **Gitflow simplifié**, adapté à une équipe réduite
(cf. cours *Gestion de Configuration*) :

```
main  ──●────────────────────────●──────────  production, protégée
         \                      /
dev       ●────●────●────●─────●              intégration
               \        /
feature/xxx     ●──●──●                       fonctionnalité
```

| Branche | Rôle | Règle |
|---|---|---|
| `main` | version déployée en production | aucun push direct — pull request obligatoire |
| `dev` | intégration continue | cible des branches de fonctionnalité |
| `feature/*`, `fix/*` | travail en cours | une branche par sujet, durée de vie courte |

### Activer les hooks

```bash
bash scripts/install-hooks.sh
```

Les hooks sont **versionnés** dans `scripts/git-hooks/` et activés via
`core.hooksPath`. Contrairement à une copie dans `.git/hooks/` (non versionné),
ils se propagent à toute l'équipe et évoluent comme du code.

| Hook | Vérifie | Contournement |
|---|---|---|
| `pre-commit` | secrets (clés AWS/GitHub/DockerHub, PEM), fichiers > 512 Ko, marqueurs de conflit, `terraform fmt`, YAML valide | `git commit --no-verify` |
| `commit-msg` | format *Conventional Commits*, sujet ≤ 72 caractères | — |
| `pre-push` | suite de tests au vert, alerte sur push direct vers `main` | `git push --no-verify` |

### Convention de message

```
<type>(<portée>): <description>

Types : build, chore, ci, docs, feat, fix, infra, perf, refactor, revert, style, test
```

Exemples : `feat(app): ajouter le filtrage des tâches terminées`,
`infra(terraform): publier le port de l'API Kubernetes`,
`fix(k8s): corriger le sélecteur du Service NodePort`.

Le flux complet de pull request, avec la liste de contrôle de revue, est décrit
dans [`docs/PULL-REQUEST.md`](docs/PULL-REQUEST.md).

---

## Pipeline CI/CD

[`Jenkinsfile`](Jenkinsfile) — pipeline déclaratif, exécuté sur `node-jenkins`.

| # | Étape | Effet | Condition |
|---|---|---|---|
| 1 | **Checkout** | clone le dépôt, calcule le tag `<build>-<sha>` | toujours |
| 2 | **Dépendances** | `npm ci` (installation reproductible) | toujours |
| 3 | **Tests unitaires** | `npm run test:ci` → rapport JUnit + couverture | toujours |
| 4 | **Analyse des dépendances** | `npm audit` (informatif) | toujours |
| 5 | **Build image Docker** | `docker build` multi-étapes + étiquettes OCI | toujours |
| 6 | **Test de l'image** | démarre le conteneur et interroge `/health` | toujours |
| 7 | **Push DockerHub** | `docker push` du tag immuable et de `latest` | `main` ou `dev` |
| 8 | **Déploiement Kubernetes** | `kubectl apply -k k8s/`, `set image`, `rollout status` | `main` |
| 9 | **Validation post-déploiement** | requête `/health` à travers le Service | `main` |

### Trois garde-fous qui méritent l'attention

**L'étape 6 teste l'image avant de la publier.** Un `docker build` réussi ne
prouve pas que le conteneur démarre : entrypoint cassé, variable manquante,
dépendance native absente de l'image finale. Le pipeline lance donc réellement
l'image et attend une réponse sur `/health` avant tout `docker push`.

**Le rollback est automatique.** `rollout status --timeout` fait échouer l'étape
8 si la nouvelle version ne devient jamais `Ready` ; le bloc `post { failure }`
déclenche alors `kubectl rollout undo` puis affiche l'état des pods. C'est la
mise en œuvre du conseil du cours *Livraison Continue* : « ne pas négliger les
rollbacks ».

**Le tag d'image est immuable.** `<numéro de build>-<sha court>` : le numéro
donne l'ordre chronologique, le SHA permet de retrouver le code exact. Déployer
uniquement `latest` rendrait impossible de savoir quel commit tourne en
production.

### Créer le job dans Jenkins

Procédure complète — identifiants DockerHub, job *Pipeline*, déclencheur sur
push — dans [`docs/RUNBOOK.md`](docs/RUNBOOK.md#créer-le-job-jenkins).

En résumé :

1. **Manage Jenkins → Credentials** → *Username with password*,
   identifiant **`dockerhub-credentials`** (utiliser un jeton d'accès DockerHub,
   pas le mot de passe du compte).
2. **New Item → Pipeline** → *Pipeline script from SCM* → Git → URL du dépôt →
   branche `*/main` → script `Jenkinsfile`.
3. Renseigner le paramètre `DOCKERHUB_USER` (valeur par défaut volontairement
   invalide : `votre-compte-dockerhub`).
4. **Build with Parameters**.

---

## Kubernetes

```bash
kubectl apply -k k8s/                          # déployer
kubectl -n todo-app get all,pvc,secret         # inspecter
kubectl -n todo-app logs -l app.kubernetes.io/component=app -f
kubectl delete -k k8s/                         # retirer (le PV survit)
```

### Ressources créées

| Ressource | Nom | Points notables |
|---|---|---|
| `Namespace` | `todo-app` | isole le projet, permet une suppression en masse |
| `Secret` | `todo-db-credentials` | identifiants de la base, injectés par `secretKeyRef` |
| `ConfigMap` | `todo-app-config` | configuration non sensible, injectée par `envFrom` |
| `PersistentVolume` | `todo-postgres-pv` | 2 Gi, `hostPath` sur `/data`, politique **Retain** |
| `PersistentVolumeClaim` | `todo-postgres-pvc` | liaison **statique** via `volumeName` |
| `Deployment` | `todo-postgres` | 1 réplica, stratégie **Recreate**, sondes `pg_isready` |
| `Service` | `todo-postgres` | **ClusterIP** — la base n'est jamais exposée |
| `Deployment` | `todo-app` | 2 réplicas, `maxUnavailable: 0`, 3 sondes, `initContainer` |
| `Service` | `todo-app` | **NodePort 30080** |

### Quatre détails qui évitent des pannes réelles

**`strategy: Recreate` sur PostgreSQL.** Le volume est `ReadWriteOnce` : avec
une stratégie `RollingUpdate`, Kubernetes tenterait de démarrer le nouveau pod
avant d'arrêter l'ancien, et le montage resterait bloqué indéfiniment.
`Recreate` impose l'ordre arrêt → démarrage.

**`maxUnavailable: 0` sur l'application.** Aucune requête n'est perdue pendant
une mise à jour : le nouveau pod doit être `Ready` avant que l'ancien ne soit
arrêté.

**`volumeName` sur le PVC.** minikube active une StorageClass par défaut ; sans
liaison statique explicite, la réserve serait honorée par un volume
dynamiquement provisionné et notre PersistentVolume resterait inutilisé.

**`PGDATA` dans un sous-répertoire.** L'image officielle PostgreSQL refuse
d'initialiser un cluster dans un répertoire non vide — or un volume `hostPath`
contient souvent un `lost+found`. D'où
`PGDATA=/var/lib/postgresql/data/pgdata`.

### Vérifier la persistance des données

```bash
# créer une tâche, puis détruire le pod de base de données
curl -X POST http://localhost:8081/api/tasks \
     -H 'Content-Type: application/json' \
     -d '{"title":"survit au redémarrage"}'

kubectl -n todo-app delete pod -l app.kubernetes.io/component=database
kubectl -n todo-app rollout status deployment/todo-postgres

# la tâche est toujours là : elle vit dans le PersistentVolume
curl http://localhost:8081/api/tasks
```

---

## Sécurité et gestion des secrets

Ce qui est appliqué dans le projet :

- **Aucune clé privée versionnée.** La clé SSH est générée dans `~/.ssh` sous
  WSL ; seule la clé publique entre dans les nœuds. `.gitignore` bloque
  `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `kubeconfig*`.
- **Le hook `pre-commit` refuse les secrets** correspondant aux motifs connus
  (clés AWS, jetons GitHub/DockerHub/Slack, blocs PEM).
- **`ConfigMap` et `Secret` séparés** : la configuration ordinaire est
  versionnée, les identifiants passent par `secretKeyRef`.
- **`docker login --password-stdin`** dans le pipeline : le jeton n'apparaît ni
  dans la liste des processus ni dans la console.
- **Conteneur applicatif durci** : `runAsNonRoot`, `readOnlyRootFilesystem`,
  `allowPrivilegeEscalation: false`, `capabilities: drop ALL`.
- **`no_log: true`** sur les tâches Ansible manipulant le mot de passe
  PostgreSQL.

### Limites assumées — à corriger hors contexte pédagogique

| Limite | Pourquoi ici | Correction en production |
|---|---|---|
| `k8s/10-secret.yaml` est versionné avec un mot de passe de laboratoire | le projet doit se rejouer en une commande | `kubectl create secret` hors dépôt, ou Sealed Secrets / External Secrets / Vault |
| Mot de passe Jenkins `admin123` dans `group_vars/all.yml` | reproductibilité de la démonstration | Ansible Vault ou variable d'environnement |
| Nœuds en mode privilégié | requis par le Docker imbriqué de minikube | VM réelles, ou cluster managé |
| État Terraform en local | pas de backend distant dans un projet mono-poste | backend S3/Azure/GCS avec verrouillage |
| `Secret` Kubernetes = base64, **pas** chiffré | comportement natif de Kubernetes | chiffrement d'etcd au repos + RBAC strict |

Remplacer le secret de laboratoire :

```bash
kubectl -n todo-app delete secret todo-db-credentials
kubectl -n todo-app create secret generic todo-db-credentials \
  --from-literal=DB_USER=todo \
  --from-literal=DB_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=DB_NAME=tododb
kubectl -n todo-app rollout restart deployment/todo-postgres deployment/todo-app
```

---

## Dépannage

### `docker: permission denied` après le bootstrap

L'appartenance au groupe `docker` n'est lue qu'à l'ouverture de session.

```powershell
wsl --shutdown        # depuis PowerShell, puis rouvrir WSL
```

### Ansible ignore `ansible.cfg`

Attendu lorsque le dépôt est sous `/mnt/c` : Ansible refuse un fichier de
configuration situé dans un répertoire accessible en écriture par tous.

```bash
export ANSIBLE_CONFIG="$PWD/ansible.cfg"      # ce que fait 02-configure.sh
```

### `minikube start` échoue ou n'en finit pas

```bash
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11
minikube delete --all --purge
systemctl status docker            # le Docker imbriqué doit être actif
free -m                            # au moins 3 Go disponibles
minikube start --driver=docker --force --listen-address=0.0.0.0 \
  --apiserver-port=8443 --apiserver-ips=172.28.0.11 --alsologtostderr
```

Sur une machine contrainte, réduire l'empreinte dans
`infra/ansible/group_vars/all.yml` (`minikube_memory_mb: 2600`,
`minikube_cpus: 2`) et dans `infra/terraform/terraform.tfvars`
(`memory = 4096`).

### `kubectl` depuis `node-jenkins` : erreur de certificat

Le certificat de l'API server doit porter l'IP du nœud dans ses SAN.
Recréer le cluster avec `--apiserver-ips=172.28.0.11`, puis rejouer :

```bash
ansible-playbook -i inventory/hosts.ini site.yml --tags kubernetes,kubeconfig
```

### L'application renvoie « non déployée » sur le port 8081

NGINX fonctionne mais rien ne répond derrière le NodePort.

```bash
kubectl -n todo-app get pods
kubectl -n todo-app describe pod -l app.kubernetes.io/component=app
kubectl -n todo-app logs -l app.kubernetes.io/component=app --tail=50
```

Cause fréquente : l'image `docker.io/library/todo-devops:latest` n'existe pas
encore. Lancer le pipeline Jenkins, ou construire et charger l'image à la main :

```bash
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11
cd /tmp && git clone <url-du-dépôt> todo && cd todo
docker build -t todo-devops:latest app/
minikube image load todo-devops:latest
kubectl -n todo-app set image deployment/todo-app todo-app=todo-devops:latest
```

### Le pipeline échoue sur `docker build`

L'utilisateur `jenkins` doit appartenir au groupe `docker` **et** le service
Jenkins doit avoir été redémarré depuis.

```bash
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.10
id jenkins                          # doit lister « docker »
systemctl restart jenkins
```

### Espace disque saturé

```bash
docker system prune -a --volumes    # sur l'hôte WSL
ssh root@172.28.0.11 'docker system prune -a'
```

---

## Nettoyage

```bash
# retirer l'application, conserver l'infrastructure
kubectl delete -k k8s/

# détruire les nœuds — les volumes nommés survivent
cd infra/terraform && terraform destroy

# tout supprimer, volumes compris
terraform destroy
docker volume rm todo-devops-jenkins-home \
                 todo-devops-k8s-docker-lib \
                 todo-devops-k8s-pgdata
docker image rm todo-devops/node-base:24.04
```

---

## Choix techniques assumés

**Nœuds conteneurisés plutôt que VM VirtualBox.** Le sujet autorise un
environnement « local ou sur une plateforme cloud publique ». Deux VM Ubuntu
complètes exigent 15 à 20 Go de disque et 6 Go de RAM ; l'approche retenue
consomme 8 à 10 Go et se reconstruit en trois minutes. Les nœuds tournent avec
**systemd comme PID 1** et un serveur SSH : les rôles Ansible utilisent les
modules `apt` et `systemd` exactement comme sur des VM, et le passage à de
vraies machines ne demanderait que de changer le provider Terraform.

**Terraform *et* Ansible, pas l'un ou l'autre.** Le sujet laisse le choix ; les
combiner respecte la séparation des responsabilités enseignée en cours :
Terraform *provisionne* (déclaratif, orchestration), Ansible *configure*
(impératif, gestion de configuration).

**Deux instances PostgreSQL, volontairement.** Le livrable 1 demande une base
configurée par l'IaC ; le livrable 5 demande un volume persistant dans
Kubernetes. Plutôt que de choisir, le projet expose deux environnements :
PostgreSQL sur le nœud = base d'**intégration** (rôle Ansible) ; PostgreSQL
dans le cluster = base de **production** (PV/PVC/Secret). C'est aussi ce que
l'on trouve dans un vrai projet.

**NGINX en reverse proxy plutôt qu'en serveur de fichiers.** Le sujet demande
« un serveur web ». Servir des fichiers statiques ferait doublon avec
l'application. En point d'entrée unique, NGINX évite d'exposer la plage
30000-32767 de Kubernetes et fournit une URL stable même quand le Service est
recréé.

**NodePort plutôt que LoadBalancer.** minikube n'a pas de contrôleur de
LoadBalancer : un `Service` de type `LoadBalancer` resterait indéfiniment
`<pending>` sans `minikube tunnel`.

---

## Références

Documents du cours ayant servi de base :

- *Infrastructure as Code (IaC)* — approches déclarative / impérative, comparatif des outils
- *Gestion de Configuration* — Git, branches, Gitflow, bonnes pratiques
- *Intégration Continue (CI)* — principes, Jenkins, rapports de tests
- *Livraison Continue (CD)* — Docker, Kubernetes, stratégies de déploiement et rollback
- *TP1* — Terraform + Ansible depuis Windows, inventaire `hosts.ini`
- *TP3* — pipelines Jenkins, `Jenkinsfile`, plugin JUnit
- *TP4* — minikube, `Deployment` / `Service` NodePort / PV / PVC

---

*Projet réalisé dans le cadre du module DevOps et Intégration Continue — 2025/2026.*
