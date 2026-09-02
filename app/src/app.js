'use strict';

const path = require('path');
const express = require('express');

const config = require('./config');
const { createTasksRouter } = require('./routes/tasks');

/**
 * Assemble l'application Express au-dessus d'un dépôt de tâches injecté.
 * Aucun écouteur réseau n'est ouvert ici : c'est src/server.js qui appelle
 * listen(). Cette séparation permet à Supertest de piloter l'app en mémoire.
 */
function createApp(store) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // --- Sondes utilisées par les probes Kubernetes -------------------------
  // liveness : le process répond-il ? (ne doit PAS dépendre de la base, sinon
  // une panne PostgreSQL déclencherait un redémarrage en boucle des pods).
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: config.appVersion,
      instance: config.instance,
      uptime: Math.round(process.uptime()),
    });
  });

  // readiness : l'instance peut-elle servir du trafic ? (base joignable)
  app.get('/ready', async (req, res) => {
    try {
      await store.ping();
      res.json({ status: 'ready', store: config.storeDriver });
    } catch (err) {
      res.status(503).json({ status: 'not-ready', reason: err.message });
    }
  });

  // --- API ---------------------------------------------------------------
  app.use('/api/tasks', createTasksRouter(store));

  // --- Interface web -----------------------------------------------------
  app.use(express.static(path.join(__dirname, 'public')));

  app.use((req, res) => {
    res.status(404).json({ error: 'route introuvable', path: req.originalUrl });
  });

  // Gestionnaire d'erreurs : la signature à 4 arguments est ce qui l'identifie
  // comme error handler auprès d'Express, ne pas retirer `next`.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[app] erreur non gérée:', err.message);
    res.status(500).json({ error: 'erreur interne du serveur' });
  });

  return app;
}

module.exports = createApp;
