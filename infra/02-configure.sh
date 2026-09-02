#!/usr/bin/env bash
#
# Etape 2 du flux — configuration des noeuds avec Ansible.
# A executer depuis WSL, apres 01-provision.sh.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${repo_root}/infra/ansible"

# Ansible ignore un ansible.cfg situe dans un repertoire accessible en ecriture
# par tous — ce qui est le cas de /mnt/c vu depuis WSL. On impose donc le
# chemin explicitement, seule facon fiable de faire respecter la configuration.
export ANSIBLE_CONFIG="${PWD}/ansible.cfg"
export ANSIBLE_HOST_KEY_CHECKING=False

inventory="inventory/hosts.ini"
if [ ! -f "$inventory" ]; then
  echo "[configure] $inventory absent : lancer d'abord infra/01-provision.sh" >&2
  exit 1
fi

echo "[configure] collections Ansible requises"
ansible-galaxy collection install -r requirements.yml 2>/dev/null \
  || echo "[configure] collections deja presentes ou hors ligne, on continue"

echo "[configure] test de connectivite"
ansible -i "$inventory" nodes -m ping

echo "[configure] execution du playbook (compter 10 a 20 minutes au premier passage)"
ansible-playbook -i "$inventory" site.yml "$@"

echo
echo "[configure] etape suivante : deployer l'application"
echo "            kubectl apply -k k8s/    (ou lancer le pipeline Jenkins)"
