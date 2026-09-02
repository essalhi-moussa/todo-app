'use strict';

/**
 * Configuration centralisée, lue exclusivement depuis l'environnement.
 * Aucune valeur sensible n'est codée en dur : en production les identifiants
 * proviennent du Secret Kubernetes (voir k8s/secret.yaml).
 */

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: asInt(process.env.PORT, 3000),
  appVersion: process.env.APP_VERSION || 'dev',

  // Nom du nœud/pod qui sert la requête : utile pour démontrer le load
  // balancing entre les réplicas du Deployment Kubernetes.
  instance: process.env.HOSTNAME || 'local',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: asInt(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'todo',
    password: process.env.DB_PASSWORD || 'todo',
    database: process.env.DB_NAME || 'tododb',
    // Laisse l'application démarrer même si PostgreSQL n'est pas encore prêt :
    // la sonde /ready renverra 503 jusqu'à ce que la connexion aboutisse.
    maxPoolSize: asInt(process.env.DB_POOL_MAX, 10),
    connectionTimeoutMillis: asInt(process.env.DB_CONNECT_TIMEOUT_MS, 5000),
  },

  // 'memory' permet de lancer l'application et les tests sans PostgreSQL.
  storeDriver: process.env.STORE_DRIVER || 'postgres',
};

module.exports = config;
