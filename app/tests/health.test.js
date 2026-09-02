'use strict';

const request = require('supertest');

const createApp = require('../src/app');
const { MemoryTaskStore } = require('../src/store');

describe('sondes de santé (probes Kubernetes)', () => {
  let store;
  let app;

  beforeEach(async () => {
    store = new MemoryTaskStore();
    await store.init();
    app = createApp(store);
  });

  it('GET /health renvoie 200 sans dépendre du dépôt', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('instance');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /ready renvoie 200 quand le dépôt répond', async () => {
    const res = await request(app).get('/ready').expect(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /ready renvoie 503 quand le dépôt est injoignable', async () => {
    // Simule une panne PostgreSQL : la readiness doit basculer, ce qui retire
    // le pod du Service sans provoquer de redémarrage (liveness intacte).
    jest.spyOn(store, 'ping').mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/ready').expect(503);
    expect(res.body.status).toBe('not-ready');
    expect(res.body.reason).toBe('connection refused');

    await request(app).get('/health').expect(200);
  });

  it('renvoie 404 JSON sur une route inconnue', async () => {
    const res = await request(app).get('/route-inexistante').expect(404);
    expect(res.body.error).toBe('route introuvable');
  });

  it('renvoie 500 JSON quand le dépôt lève une erreur', async () => {
    jest.spyOn(store, 'list').mockRejectedValue(new Error('panne base'));
    const res = await request(app).get('/api/tasks').expect(500);
    expect(res.body.error).toBe('erreur interne du serveur');
  });
});
