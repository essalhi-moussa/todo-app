'use strict';

const { Pool } = require('pg');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  done        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
`;

/**
 * Implémentation PostgreSQL du dépôt de tâches.
 * Les données vivent dans le volume persistant Kubernetes (PV/PVC), elles
 * survivent donc à la suppression des pods.
 */
class PostgresTaskStore {
  constructor(dbConfig) {
    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      max: dbConfig.maxPoolSize,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
    });

    // Sans ce garde-fou, une coupure réseau côté PostgreSQL ferait remonter
    // une exception non capturée qui tuerait le process Node.
    this.pool.on('error', (err) => {
      console.error('[store] erreur inattendue du pool PostgreSQL:', err.message);
    });
  }

  /** Crée le schéma s'il n'existe pas (migration idempotente). */
  async init() {
    await this.pool.query(SCHEMA);
    return this;
  }

  async ping() {
    const { rows } = await this.pool.query('SELECT 1 AS ok');
    return rows[0].ok === 1;
  }

  async list() {
    const { rows } = await this.pool.query(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks ORDER BY id'
    );
    return rows;
  }

  async get(id) {
    const { rows } = await this.pool.query(
      'SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  }

  async create({ title, description = '' }) {
    const { rows } = await this.pool.query(
      `INSERT INTO tasks (title, description)
       VALUES ($1, $2)
       RETURNING id, title, description, done, created_at, updated_at`,
      [title, description]
    );
    return rows[0];
  }

  async update(id, patch) {
    // COALESCE permet une mise à jour partielle : les champs absents du corps
    // de la requête conservent leur valeur actuelle.
    const { rows } = await this.pool.query(
      `UPDATE tasks
          SET title       = COALESCE($2, title),
              description = COALESCE($3, description),
              done        = COALESCE($4, done),
              updated_at  = NOW()
        WHERE id = $1
      RETURNING id, title, description, done, created_at, updated_at`,
      [
        id,
        patch.title !== undefined ? patch.title : null,
        patch.description !== undefined ? patch.description : null,
        patch.done !== undefined ? patch.done : null,
      ]
    );
    return rows[0] || null;
  }

  async remove(id) {
    const { rowCount } = await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = PostgresTaskStore;
