-- Schéma initial de l'application TODO.
-- Appliqué automatiquement au démarrage par src/store/postgres.js (init()),
-- et disponible ici pour une application manuelle ou par le rôle Ansible
-- postgresql sur le nœud de base de données.

CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  done        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Le tableau de bord filtre en permanence sur « done » : l'index évite un
-- balayage complet de la table dès que le volume de tâches augmente.
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks (done);
