#!/usr/bin/env bash
#
# Installe la clé publique déposée par Terraform et applique les permissions
# exigées par OpenSSH (sans quoi sshd refuse silencieusement la clé).
set -euo pipefail

SRC=/etc/devops/authorized_keys
DST=/root/.ssh/authorized_keys

install -d -m 0700 /root/.ssh

if [ -s "$SRC" ]; then
    install -m 0600 "$SRC" "$DST"
    echo "[bootstrap-ssh] clé publique installée depuis $SRC"
else
    echo "[bootstrap-ssh] AVERTISSEMENT: $SRC absent ou vide," \
         "la connexion Ansible par clé échouera." >&2
fi

# Les clés d'hôte ne sont pas dans l'image : elles sont générées au premier
# démarrage pour que chaque nœud ait sa propre identité.
ssh-keygen -A
