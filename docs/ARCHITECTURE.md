# Architecture et décisions techniques

Ce document explique **pourquoi** l'infrastructure a cette forme. Le
[README](../README.md) explique comment la déployer.

---

## 1. Vue d'ensemble en couches

| Couche | Outil | Nature | Responsabilité |
|---|---|---|---|
| Hôte | WSL2 Ubuntu 24.04 | — | joue le rôle d'hyperviseur / fournisseur |
| Provisionnement | **Terraform** | déclaratif, *agentless*, *push* | crée réseau, image, nœuds, volumes |
| Configuration | **Ansible** | impératif, *agentless*, *push* | installe et paramètre le logiciel |
| Intégration | **Jenkins** | — | teste, construit, publie, déploie |
| Orchestration | **Kubernetes** (minikube) | déclaratif | maintient l'état souhaité des charges |
| Exécution | **Docker** | — | isole l'application et ses dépendances |

Cette répartition reprend la classification du cours *Infrastructure as Code* :
Terraform comme *provisioning / orchestration tool*, Ansible comme
*configuration management / deployment tool*.

---

## 2. Chaîne d'exécution complète

```
 développeur
     │  git push (hook pre-push : tests locaux)
     ▼
 GitHub  (main / dev, pull request)
     │  déclencheur
     ▼
 Jenkins sur node-jenkins
     │  1. checkout        git clone + tag <build>-<sha>
     │  2. npm ci          installation reproductible
     │  3. npm run test:ci 40 tests → JUnit + couverture
     │  4. npm audit       vulnérabilités (informatif)
     │  5. docker build    image multi-étapes, non-root
     │  6. docker run      démarre l'image, interroge /health
     │  7. docker push ─────────────────────────► DockerHub
     │  8. kubectl apply -k k8s/ ───────┐
     │     kubectl set image            │
     │     kubectl rollout status       │  échec ⇒ rollout undo
     │  9. curl /health                 │
     ▼                                  ▼
                              cluster minikube sur node-k8s
                                 ├── Deployment todo-app ×2
                                 ├── Service NodePort 30080
                                 ├── Deployment todo-postgres
                                 └── PV / PVC 2 Gi (Retain)
                                          ▲
 utilisateur ── localhost:8081 ── NGINX ──┘
```

---

## 3. Décisions et alternatives écartées

### 3.1 Nœuds conteneurisés plutôt que VM VirtualBox

**Contexte.** Le sujet demande deux VM ; l'énoncé autorise un environnement
« local ou sur une plateforme cloud publique ». La machine de développement
disposait de 23 Go de disque libres et 8 Go de RAM utilisables.

| Option | Disque | RAM | Fiabilité | Retenue |
|---|---|---|---|---|
| 2 VM VirtualBox via `terra-farm/virtualbox` | 15–20 Go | ~6 Go | provider communautaire peu maintenu | non |
| 2 instances EC2 (AWS) | 0 | 0 | exige un compte facturé, `t3.micro` insuffisant pour minikube | non |
| **2 nœuds conteneurisés (systemd + SSH)** | **8–10 Go** | **~4 Go** | provider `kreuzwerker/docker` maintenu | **oui** |

**Ce qui rend l'équivalence défendable.** Les nœuds ne sont pas de simples
conteneurs applicatifs : l'image [`node-base`](../infra/terraform/images/node-base/Dockerfile)
démarre **systemd comme PID 1** et un serveur **OpenSSH**. Conséquences
concrètes :

- Ansible se connecte **par SSH**, avec un inventaire `hosts.ini` — exactement
  le flux du TP1 ;
- les rôles utilisent `ansible.builtin.apt` et `ansible.builtin.systemd`
  (`enabled`, `started`, handlers de redémarrage) — le code serait identique
  sur une VM ;
- chaque nœud a son `/etc/hosts`, son fuseau horaire, ses services.

**Coût de la bascule vers de vraies VM.** Remplacer les ressources
`docker_container` par des `virtualbox_vm` (ou `aws_instance`) dans
[`main.tf`](../infra/terraform/main.tf). **Aucun rôle Ansible, aucun manifeste
Kubernetes et aucune étape du pipeline ne change** : c'est précisément la
propriété que l'on attend d'une infrastructure décrite en code.

### 3.2 Terraform *et* Ansible

Le sujet écrit « Ansible **ou** Terraform ». Les deux sont utilisés, car ils ne
font pas le même travail :

| | Terraform | Ansible |
|---|---|---|
| Question posée | *quoi* (état final) | *comment* (suite d'opérations) |
| Approche | déclarative | impérative |
| Cycle de vie | crée / détruit des ressources | fait converger un système existant |
| Ici | réseau, image, nœuds, volumes | paquets, services, fichiers de configuration |

Le point de jonction est **l'inventaire Ansible généré par Terraform**
([`templates/hosts.ini.tftpl`](../infra/terraform/templates/hosts.ini.tftpl)).
L'inventaire est produit depuis l'état réel : il lui est structurellement
impossible de décrire une machine qui n'existe pas. Un `hosts.ini` écrit à la
main dérive dès la première modification d'adresse.

### 3.3 minikube dans un Docker imbriqué

`node-k8s` tourne en mode **privilégié** avec son propre démon Docker ; minikube
y utilise son driver `docker` et crée son nœud comme conteneur imbriqué.

Trois options sont indispensables au démarrage
([rôle kubernetes](../infra/ansible/roles/kubernetes/tasks/main.yml)) :

| Option | Sans elle |
|---|---|
| `--force` | minikube refuse de démarrer en tant que `root` |
| `--listen-address=0.0.0.0` | l'API server n'écoute que sur la boucle locale du nœud : `node-jenkins` ne peut pas l'atteindre |
| `--apiserver-ips=172.28.0.11` | l'IP du nœud est absente des SAN du certificat, et `kubectl` distant échoue sur la vérification TLS |

`/var/lib/docker` est monté sur un **volume Docker dédié**
(`todo-devops-k8s-docker-lib`) : sans cela, le démon imbriqué tenterait
d'empiler overlayfs sur overlayfs et refuserait de démarrer.

### 3.4 Comment Jenkins atteint le cluster

Deux voies étaient possibles :

| Voie | Avantage | Inconvénient |
|---|---|---|
| `ssh node-k8s 'kubectl apply …'` | aucune plomberie réseau | le déploiement n'est plus piloté par Jenkins mais par un script distant ; pas de `kubeconfig` en identifiant Jenkins |
| **kubeconfig distant + `kubectl` local** | le pipeline exécute réellement `kubectl` ; conforme au sujet (« déploie via kubectl ») | exige des SAN corrects et un port publié |

La seconde voie est retenue. Le rôle `kubernetes` produit
`/etc/devops/kubeconfig-remote` — copie *aplatie* (`kubectl config view --raw
--flatten`, certificats embarqués en base64) dont l'adresse du serveur est
réécrite vers `https://172.28.0.11:8443`. L'étape 4 de
[`site.yml`](../infra/ansible/site.yml) le rapatrie sur le contrôleur, le dépose
dans `/var/lib/jenkins/.kube/config` et **vérifie l'accès** avec
`kubectl get nodes`.

### 3.5 Deux instances PostgreSQL

Ce n'est pas une redondance mais **deux environnements** :

| | Base d'intégration | Base de production |
|---|---|---|
| Où | sur le nœud `node-k8s` | dans le cluster Kubernetes |
| Créée par | rôle Ansible `postgresql` | `k8s/32-postgres-deployment.yaml` |
| Stockage | volume Docker `k8s-pgdata` | `PersistentVolume` / `PVC` 2 Gi |
| Identifiants | `group_vars/all.yml` | `Secret` `todo-db-credentials` |
| Sert à | livrable 1 (« configure une base de données »), tests d'intégration | livrable 5 (« volume persistant pour la base ») |
| Exposition | port 5432 du nœud, pour inspection | `ClusterIP` — jamais hors du cluster |

### 3.6 NGINX en point d'entrée

Le sujet demande « un serveur web ». Servir des fichiers statiques ferait
doublon avec `express.static`. NGINX est donc placé en **reverse proxy** devant
le NodePort, ce qui apporte trois choses :

1. une **URL stable** (`localhost:8081`) même si le Service est recréé ;
2. la plage `30000-32767` de Kubernetes n'est pas exposée à l'extérieur ;
3. une **page d'attente** lisible au lieu d'un `502` brut tant que rien n'est
   déployé (`proxy_intercept_errors` +
   [`maintenance.html.j2`](../infra/ansible/roles/nginx/templates/maintenance.html.j2)).

`/nginx-health` permet de distinguer une panne du serveur web d'une panne de
l'application — diagnostic impossible avec un simple `502`.

### 3.7 NodePort plutôt que LoadBalancer

minikube ne fournit pas de contrôleur de LoadBalancer. Un `Service` de type
`LoadBalancer` resterait indéfiniment `<pending>` sans `minikube tunnel`, un
processus au premier plan qu'il faudrait maintenir vivant. `nodePort: 30080` est
**fixé** et non aléatoire, car la configuration NGINX générée par Ansible pointe
dessus.

---

## 4. Plan d'adressage

| Élément | Adresse | Fixée par |
|---|---|---|
| Réseau privé | `172.28.0.0/24` | `var.network_subnet` |
| Passerelle | `172.28.0.1` | `var.network_gateway` |
| `node-jenkins` | `172.28.0.10` | `var.jenkins_node.ip` |
| `node-k8s` | `172.28.0.11` | `var.k8s_node.ip` |
| Nœud minikube | `192.168.49.2` (interne) | minikube |

### Ports publiés vers Windows

| Windows | Nœud | Service |
|---|---|---|
| `8080` | `node-jenkins:8080` | interface Jenkins |
| `2222` | `node-jenkins:22` | SSH |
| `50000` | `node-jenkins:50000` | agents Jenkins (JNLP) |
| `8081` | `node-k8s:80` | NGINX → application |
| `2223` | `node-k8s:22` | SSH |
| `5432` | `node-k8s:5432` | PostgreSQL d'intégration |
| `8443` | `node-k8s:8443` | API server Kubernetes |

L'adressage statique est un choix : il rend l'inventaire Ansible, la
configuration NGINX et le kubeconfig **déterministes**. Avec DHCP, chaque
redémarrage exigerait de régénérer les trois.

---

## 5. Consommation de ressources

| Composant | Disque | RAM |
|---|---|---|
| Image `node-base` | ~450 Mo | — |
| `node-jenkins` (Java, Jenkins, Node.js, kubectl) | ~1,5 Go | 2 Go |
| `node-k8s` — Docker imbriqué + kicbase + images du plan de contrôle | ~4,5 Go | 6 Go (dont 3 Go minikube) |
| PostgreSQL (deux instances) | ~250 Mo | ~400 Mo |
| Images applicatives (≈ 5 builds conservés) | ~800 Mo | — |
| **Total** | **≈ 8–10 Go** | **≈ 8 Go** |

Sur une machine plus contrainte : réduire `minikube_memory_mb` à `2600` dans
[`group_vars/all.yml`](../infra/ansible/group_vars/all.yml) et `memory` à
`4096` dans `terraform.tfvars`.

---

## 6. Ce qu'il faudrait ajouter pour un usage réel

Hors périmètre du sujet, mais logique suite du travail :

| Manque | Réponse habituelle |
|---|---|
| Supervision et métriques | Prometheus + Grafana (recommandé par le cours CD) |
| Journalisation centralisée | Loki ou la pile ELK |
| Secrets réellement protégés | HashiCorp Vault, Sealed Secrets, External Secrets Operator |
| Analyse des images | Trivy dans le pipeline (cité par le cours CD) |
| État Terraform partagé | backend S3 / Azure / GCS avec verrouillage |
| Déploiement bleu-vert ou canari | Argo Rollouts, Flagger, ou deux Services basculés par label |
| Haute disponibilité de la base | opérateur PostgreSQL (CloudNativePG), réplication |
| TLS | cert-manager + Ingress, plutôt qu'un NodePort en clair |
| Tests de charge | Gatling ou k6 en étape de pipeline |
