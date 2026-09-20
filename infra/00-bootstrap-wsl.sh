#!/usr/bin/env bash
#
# 00-bootstrap-wsl.sh — Prepare the WSL2 Ubuntu host that plays the role of
# hypervisor / cloud provider for this project.
#
# Installs: Docker CE (engine + buildx + compose), Terraform, Ansible, kubectl.
# Generates the SSH key pair Ansible uses to reach the provisioned nodes.
#
# Run once, from inside WSL:
#   bash infra/00-bootstrap-wsl.sh
#
set -euo pipefail

SSH_KEY="${HOME}/.ssh/devops_id_ed25519"
LOG_PREFIX="[bootstrap]"

log()  { echo "${LOG_PREFIX} $*"; }
fail() { echo "${LOG_PREFIX} ERREUR: $*" >&2; exit 1; }

[ -f /proc/version ] && grep -qi microsoft /proc/version || fail "à exécuter dans WSL2, pas sur Windows."
[ "$(id -u)" -ne 0 ] || fail "à exécuter en tant qu'utilisateur normal (le script appelle sudo lui-même)."

log "élévation sudo (le mot de passe est demandé une seule fois)"
sudo -v

# ---------------------------------------------------------------- paquets base
log "mise à jour de l'index apt"
sudo apt-get update -qq
log "installation des prérequis"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release apt-transport-https \
  software-properties-common jq unzip git make >/dev/null

sudo install -m 0755 -d /etc/apt/keyrings

# -------------------------------------------------------------------- Docker CE
if ! command -v docker >/dev/null 2>&1; then
  log "ajout du dépôt Docker officiel"
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  log "installation de Docker CE"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
else
  log "Docker déjà présent — $(docker --version)"
fi

# Les nœuds du projet font tourner systemd comme PID 1, avec un démon Docker
# imbriqué et minikube par-dessus. Sous WSL2 en cgroup v2, le pilote de cgroup
# « systemd » de Docker échoue par intermittence sur cet empilement :
#
#   unable to apply cgroup configuration: error creating systemd unit
#   `docker-<id>.scope`: got `failed`
#
# Les conteneurs sortent alors en code 128 et bouclent en redémarrage. Le
# pilote « cgroupfs » crée les cgroups directement, sans solliciter systemd.
log "configuration du pilote de cgroup Docker (cgroupfs)"
sudo install -m 0755 -d /etc/docker
printf '%s\n' \
  '{' \
  '  "exec-opts": ["native.cgroupdriver=cgroupfs"],' \
  '  "log-driver": "json-file",' \
  '  "log-opts": { "max-size": "10m", "max-file": "3" }' \
  '}' | sudo tee /etc/docker/daemon.json >/dev/null

log "activation du service Docker"
sudo systemctl enable --now docker
sudo systemctl restart docker
sudo usermod -aG docker "$USER"

# -------------------------------------------------------------------- Terraform
if ! command -v terraform >/dev/null 2>&1; then
  log "ajout du dépôt HashiCorp"
  curl -fsSL https://apt.releases.hashicorp.com/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/hashicorp.gpg
  sudo chmod a+r /etc/apt/keyrings/hashicorp.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/hashicorp.gpg] \
https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
    | sudo tee /etc/apt/sources.list.d/hashicorp.list >/dev/null
  sudo apt-get update -qq
  log "installation de Terraform"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq terraform >/dev/null
else
  log "Terraform déjà présent — $(terraform version | head -1)"
fi

# ---------------------------------------------------------------------- Ansible
if ! command -v ansible >/dev/null 2>&1; then
  log "installation d'Ansible"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ansible >/dev/null
else
  log "Ansible déjà présent — $(ansible --version | head -1)"
fi

# ---------------------------------------------------------------------- kubectl
if ! command -v kubectl >/dev/null 2>&1; then
  log "installation de kubectl (dépôt pkgs.k8s.io)"
  curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key \
    | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes.gpg
  sudo chmod a+r /etc/apt/keyrings/kubernetes.gpg
  echo "deb [signed-by=/etc/apt/keyrings/kubernetes.gpg] \
https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /" \
    | sudo tee /etc/apt/sources.list.d/kubernetes.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq kubectl >/dev/null
else
  log "kubectl déjà présent — $(kubectl version --client -o yaml 2>/dev/null | grep gitVersion | head -1)"
fi

# ------------------------------------------------------------------- clé SSH
# La clé privée reste dans WSL (~/.ssh, permissions 600) et n'est JAMAIS
# committée. Terraform injecte la clé publique dans les nœuds provisionnés.
if [ ! -f "$SSH_KEY" ]; then
  log "génération de la paire de clés SSH ${SSH_KEY}"
  mkdir -p "${HOME}/.ssh" && chmod 700 "${HOME}/.ssh"
  ssh-keygen -t ed25519 -N "" -C "ansible@devops-todo" -f "$SSH_KEY" >/dev/null
else
  log "clé SSH déjà présente — ${SSH_KEY}"
fi
chmod 600 "$SSH_KEY"

# ------------------------------------------------------------------ récapitulatif
echo
log "=================== installation terminée ==================="
printf '  %-12s %s\n' docker    "$(docker --version 2>/dev/null || echo '??')"
printf '  %-12s %s\n' terraform "$(terraform version 2>/dev/null | head -1 || echo '??')"
printf '  %-12s %s\n' ansible   "$(ansible --version 2>/dev/null | head -1 || echo '??')"
printf '  %-12s %s\n' kubectl   "$(kubectl version --client 2>/dev/null | head -1 || echo '??')"
printf '  %-12s %s\n' 'clé SSH' "$SSH_KEY"
echo
log "IMPORTANT : ferme cette session WSL puis relance-la (ou exécute"
log "'wsl --shutdown' depuis PowerShell) pour que l'appartenance au"
log "groupe 'docker' prenne effet. Vérifie ensuite avec : docker info"
