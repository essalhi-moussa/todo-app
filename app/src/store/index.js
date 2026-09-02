'use strict';

const config = require('../config');
const MemoryTaskStore = require('./memory');
const PostgresTaskStore = require('./postgres');

/**
 * Fabrique le dépôt de tâches correspondant à STORE_DRIVER.
 * L'API HTTP ne connaît que le contrat (list/get/create/update/remove/ping),
 * ce qui rend les tests unitaires exécutables sans base de données.
 */
function createStore(driver = config.storeDriver) {
  switch (driver) {
    case 'memory':
      return new MemoryTaskStore();
    case 'postgres':
      return new PostgresTaskStore(config.db);
    default:
      throw new Error(`STORE_DRIVER inconnu: "${driver}" (attendu: postgres | memory)`);
  }
}

module.exports = { createStore, MemoryTaskStore, PostgresTaskStore };
