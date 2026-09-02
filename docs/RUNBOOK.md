# Runbook — procédures d'exploitation

Procédures pas à pas, dans l'ordre où on en a besoin. Toutes les commandes
s'exécutent **depuis WSL**, à la racine du dépôt, sauf mention contraire.

```bash
cd /mnt/c/Users/essalhi/Downloads/DevOps/todo-devops
```

---

## Sommaire

- [1. Installation complète depuis zéro](#1-installation-complète-depuis-zéro)
- [2. Créer le job Jenkins](#2-créer-le-job-jenkins)
- [3. Publier le dépôt sur GitHub](#3-publier-le-dépôt-sur-github)
- [4. Déployer sans Jenkins](#4-déployer-sans-jenkins)
- [5. Exploitation courante](#5-exploitation-courante)
- [6. Scénarios de démonstration](#6-scénarios-de-démonstration)
- [7. Incidents fréquents](#7-incidents-fréquents)
- [8. Remise à zéro](#8-remise-à-zéro)

---

## 1. Installation complète depuis zéro

Durée totale : **20 à 30 minutes**, dont l'essentiel en téléchargements.

### 1.1 Vérifier l'hôte

```bash
# systemd doit être PID 1 (les rôles Ansible pilotent des services)
ps -p 1 -o comm=          # attendu : systemd

# espace disque : 20 Go libres minimum
df -h /mnt/c | tail -1

# mémoire disponible
free -h
```

### 1.2 Bootstrap de l'outillage

```bash
bash infra/00-bootstrap-wsl.sh     # mot de passe sudo demandé une fois
```

Puis **recharger la session** pour que l'appartenance au groupe `docker` soit
prise en compte :

```powershell
# depuis PowerShell
wsl --shutdown
```

Rouvrir WSL et vérifier :

```bash
docker info --format '{{.ServerVersion}}'
terraform version | head -1
ansible --version | head -1
kubectl version --client --output=yaml | grep gitVersion
ls -l ~/.ssh/devops_id_ed25519*
```

### 1.3 Provisionner l'infrastructure

```bash
bash infra/01-provision.sh
```

Le script enchaîne `init`, `fmt -check`, `validate`, `plan`, puis demande
confirmation avant `apply`.

Vérifications :

```bash
docker ps --filter label=project=todo-devops \
          --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

cat infra/ansible/inventory/hosts.ini     # inventaire généré

ssh -i ~/.ssh/devops_id_ed25519 -o StrictHostKeyChecking=no \
    root@172.28.0.10 'hostname && systemctl is-system-running'
```

### 1.4 Configurer les nœuds

```bash
bash infra/02-configure.sh
```

Compter **10 à 20 minutes** au premier passage (Jenkins, greffons, minikube et
son image `kicbase` d'environ 1 Go).

Cibler une partie seulement :

```bash
bash infra/02-configure.sh --tags jenkins
bash infra/02-configure.sh --tags kubernetes
bash infra/02-configure.sh --tags database,web
bash infra/02-configure.sh --check --diff      # simulation, aucune écriture
```

Vérifications :

```bash
curl -sI http://localhost:8080/login | head -1       # Jenkins
curl -s  http://localhost:8081/nginx-health          # NGINX
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11 'kubectl get nodes'
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.10 \
    'sudo -u jenkins kubectl get nodes'             # accès depuis le nœud CI
```

### 1.5 Déployer l'application

```bash
kubectl --kubeconfig=/tmp/todo-devops-kubeconfig apply -k k8s/
kubectl --kubeconfig=/tmp/todo-devops-kubeconfig -n todo-app \
        rollout status deployment/todo-postgres
```

> `deployment/todo-app` restera en attente tant que l'image n'existe pas sur
> DockerHub. C'est le rôle du pipeline Jenkins — ou de la
> [procédure hors ligne](#4-déployer-sans-jenkins).

Pour éviter de répéter l'option, exporter le kubeconfig :

```bash
export KUBECONFIG=/tmp/todo-devops-kubeconfig
echo 'export KUBECONFIG=/tmp/todo-devops-kubeconfig' >> ~/.bashrc
```

---

## 2. Créer le job Jenkins

### 2.1 Se connecter

<http://localhost:8080> — `admin` / `admin123`
(défini dans [`group_vars/all.yml`](../infra/ansible/group_vars/all.yml)).

### 2.2 Enregistrer les identifiants DockerHub

Créer d'abord un **jeton d'accès** sur DockerHub
(*Account Settings → Personal access tokens*), avec la permission
*Read & Write*. Ne jamais utiliser le mot de passe du compte dans un CI.

Dans Jenkins : **Manage Jenkins → Credentials → System → Global credentials →
Add Credentials**

| Champ | Valeur |
|---|---|
| Kind | *Username with password* |
| Username | votre identifiant DockerHub |
| Password | le jeton d'accès |
| ID | **`dockerhub-credentials`** ← doit correspondre exactement |
| Description | `DockerHub — publication de l'image todo-devops` |

L'identifiant est référencé par la variable `DOCKERHUB_CREDENTIALS` du
[`Jenkinsfile`](../Jenkinsfile).

### 2.3 Créer le job

**New Item** → nom `todo-devops-pipeline` → type **Pipeline** → OK.

| Section | Réglage |
|---|---|
| *Build Triggers* | ☑ *GitHub hook trigger for GITScm polling*, ou ☑ *Poll SCM* avec `H/5 * * * *` |
| *Pipeline → Definition* | **Pipeline script from SCM** |
| *SCM* | Git |
| *Repository URL* | `https://github.com/<vous>/todo-devops.git` |
| *Credentials* | à ajouter si le dépôt est privé |
| *Branch Specifier* | `*/main` |
| *Script Path* | `Jenkinsfile` |
| *Lightweight checkout* | ☑ |

Enregistrer.

### 2.4 Premier build

**Build with Parameters** :

| Paramètre | Valeur |
|---|---|
| `DOCKERHUB_USER` | votre identifiant DockerHub |
| `PUSH_IMAGE` | ☑ |
| `DEPLOY_TO_K8S` | ☑ |

Suivre la console. Les neuf étapes doivent passer au vert ; l'étape *Tests
unitaires* publie le rapport JUnit, visible ensuite dans *Test Result Trend*.

### 2.5 Déclencher automatiquement depuis GitHub

L'instance étant locale, GitHub ne peut pas l'atteindre directement. Deux
options :

- **Poll SCM** (`H/5 * * * *`) — Jenkins interroge GitHub toutes les 5 minutes.
  Simple, suffisant pour la démonstration.
- **Webhook via un tunnel** — exposer `localhost:8080` avec `ngrok http 8080`,
  puis déclarer `https://<id>.ngrok.io/github-webhook/` dans
  *Settings → Webhooks* du dépôt. Réaction immédiate.

### 2.6 Construire aussi la branche `dev`

Pour que `main` et `dev` soient bâties automatiquement, préférer un job de type
**Multibranch Pipeline** : Jenkins découvre alors les branches et les pull
requests. Les conditions `when { branch 'main' }` du `Jenkinsfile` prennent
tout leur sens dans ce mode (`env.BRANCH_NAME` est alors renseigné).

---

## 3. Publier le dépôt sur GitHub

```bash
cd /mnt/c/Users/essalhi/Downloads/DevOps/todo-devops

git init
bash scripts/install-hooks.sh          # active les hooks AVANT le premier commit

git config user.name  "Moussa Essalhi"
git config user.email "moussa@neacorpo.com"

git add .
git status                              # vérifier qu'aucun secret n'est indexé
git commit -m "feat(projet): chaine DevOps complete de l'application TODO"

git branch -M main
git remote add origin https://github.com/<vous>/todo-devops.git
git push -u origin main

# branche d'intégration
git checkout -b dev
git push -u origin dev
```

Vérifier que les fichiers sensibles sont bien exclus :

```bash
git ls-files | grep -E 'tfstate|hosts\.ini$|\.env$|id_ed25519|kubeconfig'
# ne doit rien afficher
```

Protéger `main` : *Settings → Branches → Add rule* → `main` →
☑ *Require a pull request before merging*.

Le flux de contribution complet est décrit dans
[`PULL-REQUEST.md`](PULL-REQUEST.md).

---

## 4. Déployer sans Jenkins

Utile pour une démonstration hors ligne, ou avant que le job Jenkins n'existe.
L'image est construite **sur le nœud Kubernetes** et chargée directement dans
minikube : aucun registre requis.

```bash
# 1. copier les sources sur le nœud
tar czf /tmp/app.tgz app k8s
scp -i ~/.ssh/devops_id_ed25519 /tmp/app.tgz root@172.28.0.11:/tmp/

# 2. construire et charger dans minikube
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11 bash -s <<'EOF'
set -e
mkdir -p /opt/todo && cd /opt/todo
tar xzf /tmp/app.tgz

docker build -t todo-devops:local --target final app/
minikube image load todo-devops:local

kubectl apply -k k8s/
kubectl -n todo-app set image deployment/todo-app todo-app=todo-devops:local
# l'image est locale : Always provoquerait un ErrImagePull
kubectl -n todo-app patch deployment todo-app \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"todo-app","imagePullPolicy":"IfNotPresent"}]}}}}'
kubectl -n todo-app rollout status deployment/todo-app --timeout=240s
kubectl -n todo-app get pods -o wide
EOF

# 3. vérifier depuis Windows
curl http://localhost:8081/health
```

---

## 5. Exploitation courante

### État général

```bash
export KUBECONFIG=/tmp/todo-devops-kubeconfig

kubectl -n todo-app get all,pvc,secret,configmap
kubectl -n todo-app get events --sort-by=.lastTimestamp | tail -20
kubectl top pods -n todo-app                    # nécessite metrics-server
```

### Journaux

```bash
kubectl -n todo-app logs -l app.kubernetes.io/component=app -f --tail=100
kubectl -n todo-app logs -l app.kubernetes.io/component=database --tail=50
kubectl -n todo-app logs <pod> -c wait-for-postgres      # initContainer

# journaux des services des nœuds
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.10 'journalctl -u jenkins -n 50 --no-pager'
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11 'journalctl -u nginx -n 30 --no-pager'
```

### Mettre à l'échelle

```bash
kubectl -n todo-app scale deployment/todo-app --replicas=4
kubectl -n todo-app get pods -o wide

# observer la répartition de charge : le nom du pod change entre les appels
for i in $(seq 1 8); do curl -s http://localhost:8081/health | \
  python3 -c 'import sys,json; print(json.load(sys.stdin)["instance"])'; done
```

### Historique et rollback

```bash
kubectl -n todo-app rollout history deployment/todo-app
kubectl -n todo-app rollout undo deployment/todo-app
kubectl -n todo-app rollout undo deployment/todo-app --to-revision=2
kubectl -n todo-app rollout restart deployment/todo-app
```

### Accéder à la base de production

```bash
kubectl -n todo-app exec -it deployment/todo-postgres -- \
  psql -U todo -d tododb -c 'SELECT id, title, done FROM tasks ORDER BY id;'

# ou par redirection de port
kubectl -n todo-app port-forward svc/todo-postgres 15432:5432 &
psql -h localhost -p 15432 -U todo -d tododb
```

### Accéder à la base d'intégration

```bash
PGPASSWORD='integration-only-not-a-secret' \
  psql -h localhost -p 5432 -U todo -d tododb -c '\dt'
```

### Rejouer la configuration

Le playbook est idempotent : le rejouer après modification d'un rôle applique
uniquement les écarts.

```bash
bash infra/02-configure.sh --tags nginx
bash infra/02-configure.sh --check --diff        # voir sans appliquer
```

---

## 6. Scénarios de démonstration

Trois scénarios courts qui prouvent que la chaîne fonctionne réellement.

### 6.1 Persistance des données (PV/PVC)

```bash
curl -X POST http://localhost:8081/api/tasks \
     -H 'Content-Type: application/json' \
     -d '{"title":"cette tache doit survivre"}'

kubectl -n todo-app delete pod -l app.kubernetes.io/component=database
kubectl -n todo-app rollout status deployment/todo-postgres

curl http://localhost:8081/api/tasks       # la tâche est toujours là
```

### 6.2 Mise à jour sans interruption

```bash
# boucle de sollicitation dans un terminal
while true; do curl -s -o /dev/null -w '%{http_code} ' http://localhost:8081/health; sleep 0.3; done
```

Dans un second terminal, lancer un build Jenkins ou :

```bash
kubectl -n todo-app rollout restart deployment/todo-app
```

Seuls des `200` doivent défiler : c'est l'effet de `maxUnavailable: 0` combiné
à la sonde `readinessProbe`.

### 6.3 Rollback automatique sur échec

```bash
# déployer volontairement une image inexistante
kubectl -n todo-app set image deployment/todo-app todo-app=nginx:image-inexistante
kubectl -n todo-app rollout status deployment/todo-app --timeout=60s   # échoue

kubectl -n todo-app rollout undo deployment/todo-app
kubectl -n todo-app rollout status deployment/todo-app
```

C'est exactement la séquence exécutée par le bloc `post { failure }` de l'étape
*Déploiement Kubernetes* du pipeline.

### 6.4 Sondes distinctes

```bash
# arrêter la base : /ready doit échouer, /health rester au vert
kubectl -n todo-app scale deployment/todo-postgres --replicas=0
sleep 20

kubectl -n todo-app get pods          # les pods app sont 0/1 READY mais non redémarrés
kubectl -n todo-app exec deployment/todo-app -- wget -qO- http://127.0.0.1:3000/health
kubectl -n todo-app exec deployment/todo-app -- wget -qO- http://127.0.0.1:3000/ready || echo '503 attendu'

kubectl -n todo-app scale deployment/todo-postgres --replicas=1
```

Aucun `RESTARTS` ne doit s'incrémenter : la liveness ne dépend pas de la base.

---

## 7. Incidents fréquents

| Symptôme | Cause probable | Action |
|---|---|---|
| `docker: permission denied` | groupe `docker` pas encore actif | `wsl --shutdown` puis rouvrir WSL |
| Ansible ignore `ansible.cfg` | dépôt sous `/mnt/c` (répertoire *world-writable*) | `export ANSIBLE_CONFIG="$PWD/ansible.cfg"` |
| `wait_for_connection` en échec | clé publique non injectée | `docker exec node-jenkins cat /root/.ssh/authorized_keys` ; sinon `terraform apply -replace=docker_container.jenkins` |
| `minikube start` très long | téléchargement de `kicbase` (~1 Go) | patienter ; suivre avec `journalctl -f` sur le nœud |
| `minikube start` échoue | mémoire insuffisante ou Docker imbriqué arrêté | `free -m`, `systemctl status docker` sur le nœud, puis `minikube delete --all --purge` |
| `kubectl` : `certificate is valid for …, not 172.28.0.11` | SAN manquant | recréer le cluster avec `--apiserver-ips=172.28.0.11` puis `--tags kubernetes,kubeconfig` |
| Pod `ImagePullBackOff` | image absente de DockerHub | lancer le pipeline, ou [déploiement hors ligne](#4-déployer-sans-jenkins) |
| Pod `CrashLoopBackOff` | base injoignable ou variable manquante | `kubectl logs`, `kubectl describe pod` |
| Pod `Pending` | PVC non lié, ou ressources insuffisantes | `kubectl -n todo-app describe pvc todo-postgres-pvc` |
| Page « application non déployée » sur `:8081` | rien derrière le NodePort | `kubectl -n todo-app get pods` |
| Pipeline : `docker build` refusé | `jenkins` hors du groupe `docker` | `id jenkins` sur le nœud, puis `systemctl restart jenkins` |
| Pipeline : `unauthorized` au push | `DOCKERHUB_USER` ou jeton erroné | vérifier le paramètre et l'identifiant `dockerhub-credentials` |
| Disque saturé | images accumulées | `docker system prune -a --volumes` sur l'hôte **et** sur `node-k8s` |

### Diagnostic guidé

```bash
# 1. les nœuds tournent-ils ?
docker ps --filter label=project=todo-devops

# 2. systemd est-il sain dans les nœuds ?
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11 \
  'systemctl is-system-running; systemctl --failed --no-pager'

# 3. le cluster répond-il ?
ssh -i ~/.ssh/devops_id_ed25519 root@172.28.0.11 \
  'minikube status && kubectl get nodes'

# 4. la chaîne HTTP est-elle complète ?
curl -s http://localhost:8081/nginx-health     # NGINX seul
curl -s http://localhost:8081/health           # traversée complète
```

---

## 8. Remise à zéro

### Redéployer l'application uniquement

```bash
kubectl delete -k k8s/                 # le PersistentVolume survit (Retain)
kubectl apply -k k8s/
```

### Reconstruire un nœud

```bash
cd infra/terraform
terraform apply -replace=docker_container.k8s
cd ../.. && bash infra/02-configure.sh --tags kubernetes,database,web
```

### Détruire l'infrastructure, garder les données

```bash
cd infra/terraform && terraform destroy
docker volume ls --filter name=todo-devops     # les volumes sont conservés
```

### Tout supprimer

```bash
cd infra/terraform && terraform destroy -auto-approve

docker volume rm todo-devops-jenkins-home \
                 todo-devops-k8s-docker-lib \
                 todo-devops-k8s-pgdata
docker image rm todo-devops/node-base:24.04
docker network prune -f
docker system prune -a --volumes

rm -f /tmp/todo-devops-kubeconfig
rm -rf infra/terraform/.terraform infra/terraform/terraform.tfstate*
rm -f infra/ansible/inventory/hosts.ini
```
