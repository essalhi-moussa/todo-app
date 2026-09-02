#!/usr/bin/env bash
#
# Etape 1 du flux — provisionnement de l'infrastructure avec Terraform.
# A executer depuis WSL, apres 00-bootstrap-wsl.sh.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${repo_root}/infra/terraform"

echo "[provision] initialisation de Terraform"
terraform init -input=false

echo "[provision] validation de la configuration"
terraform fmt -check -recursive || {
  echo "[provision] formatage a corriger : terraform fmt -recursive"
}
terraform validate

echo "[provision] plan d'execution"
terraform plan -input=false -out=tfplan

echo
read -r -p "[provision] appliquer ce plan ? [o/N] " reply
case "$reply" in
  o|O|y|Y) ;;
  *) echo "[provision] annule."; exit 0 ;;
esac

echo "[provision] application"
terraform apply -input=false tfplan
rm -f tfplan

echo
echo "[provision] infrastructure en place :"
terraform output

echo
echo "[provision] etape suivante : bash infra/02-configure.sh"
