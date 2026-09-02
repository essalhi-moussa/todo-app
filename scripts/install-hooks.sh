#!/usr/bin/env bash
#
# Installe les hooks Git du projet.
#
# Les hooks vivent dans .git/hooks/, qui n'est PAS versionne. Les versionner
# dans scripts/git-hooks/ puis pointer core.hooksPath dessus permet de les
# partager avec toute l'equipe et de les faire evoluer comme du code.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
hooks_dir="${repo_root}/scripts/git-hooks"

[ -d "$hooks_dir" ] || { echo "Repertoire introuvable : $hooks_dir" >&2; exit 1; }

# core.hooksPath (Git >= 2.9) evite de copier les fichiers : Git lit
# directement le repertoire versionne, donc un git pull met les hooks a jour.
git -C "$repo_root" config core.hooksPath scripts/git-hooks
chmod +x "${hooks_dir}"/* 2>/dev/null || true

echo "Hooks Git actives (core.hooksPath = scripts/git-hooks) :"
for hook in "${hooks_dir}"/*; do
  [ -f "$hook" ] || continue
  printf '  %-12s %s\n' "$(basename "$hook")" \
    "$(sed -n '3s/^# *//p' "$hook")"
done
echo
echo "Desactivation : git config --unset core.hooksPath"
