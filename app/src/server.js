'use strict';

const config = require('./config');
const createApp = require('./app');
const { createStore } = require('./store');

const RETRY_DELAY_MS = 3000;
const MAX_INIT_ATTEMPTS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Initialise le schéma avec des tentatives répétées : au démarrage d'un
 * Deployment Kubernetes, le pod applicatif peut être prêt avant PostgreSQL.
 */
async function initStoreWithRetry(store) {
  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt += 1) {
    try {
      await store.init();
      console.log(`[server] dépôt "${config.storeDriver}" initialisé`);
      return;
    } catch (err) {
      console.warn(
        `[server] base indisponible (tentative ${attempt}/${MAX_INIT_ATTEMPTS}): ${err.message}`
      );
      if (attempt === MAX_INIT_ATTEMPTS) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function main() {
  const store = createStore();
  await initStoreWithRetry(store);

  const app = createApp(store);
  const server = app.listen(config.port, () => {
    console.log(
      `[server] todo-devops v${config.appVersion} à l'écoute sur :${config.port} ` +
        `(env=${config.env}, instance=${config.instance})`
    );
  });

  // Arrêt propre : Kubernetes envoie SIGTERM avant de supprimer un pod. On
  // laisse les requêtes en cours se terminer puis on ferme le pool.
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} reçu, arrêt en cours…`);
    server.close(async () => {
      await store.close().catch(() => {});
      console.log('[server] arrêt terminé');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] démarrage impossible:', err.message);
  process.exit(1);
});
