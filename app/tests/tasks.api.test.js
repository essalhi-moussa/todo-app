'use strict';

const request = require('supertest');

const createApp = require('../src/app');
const { MemoryTaskStore } = require('../src/store');

describe('API REST /api/tasks', () => {
  let app;
  let store;

  beforeEach(async () => {
    store = new MemoryTaskStore();
    await store.init();
    app = createApp(store);
  });

  afterEach(async () => {
    await store.close();
  });

  describe('POST /api/tasks', () => {
    it('crée une tâche et renvoie 201 avec l’en-tête Location', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'Écrire le Jenkinsfile' })
        .expect(201);

      expect(res.body).toMatchObject({
        id: 1,
        title: 'Écrire le Jenkinsfile',
        description: '',
        done: false,
      });
      expect(res.headers.location).toBe('/api/tasks/1');
    });

    it('supprime les espaces superflus du titre', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: '   Provisionner le cluster   ' })
        .expect(201);

      expect(res.body.title).toBe('Provisionner le cluster');
    });

    it('rejette un titre absent avec 400', async () => {
      const res = await request(app).post('/api/tasks').send({}).expect(400);
      expect(res.body.details).toContain('title est obligatoire');
    });

    it('rejette un titre vide avec 400', async () => {
      const res = await request(app).post('/api/tasks').send({ title: '   ' }).expect(400);
      expect(res.body.details).toContain('title ne peut pas être vide');
    });

    it('rejette un titre de plus de 200 caractères avec 400', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .send({ title: 'x'.repeat(201) })
        .expect(400);
      expect(res.body.details.join(' ')).toMatch(/200 caractères/);
    });

    it('rejette un titre non textuel avec 400', async () => {
      const res = await request(app).post('/api/tasks').send({ title: 42 }).expect(400);
      expect(res.body.details).toContain('title doit être une chaîne de caractères');
    });
  });

  describe('GET /api/tasks', () => {
    it('renvoie un tableau vide quand aucune tâche n’existe', async () => {
      const res = await request(app).get('/api/tasks').expect(200);
      expect(res.body).toEqual([]);
    });

    it('renvoie les tâches triées par identifiant', async () => {
      await store.create({ title: 'première' });
      await store.create({ title: 'deuxième' });

      const res = await request(app).get('/api/tasks').expect(200);
      expect(res.body.map((t) => t.title)).toEqual(['première', 'deuxième']);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('renvoie la tâche demandée', async () => {
      const created = await store.create({ title: 'déployer sur K8s' });
      const res = await request(app).get(`/api/tasks/${created.id}`).expect(200);
      expect(res.body.title).toBe('déployer sur K8s');
    });

    it('renvoie 404 pour un identifiant inexistant', async () => {
      await request(app).get('/api/tasks/999').expect(404);
    });

    it('renvoie 400 pour un identifiant non numérique', async () => {
      const res = await request(app).get('/api/tasks/abc').expect(400);
      expect(res.body.error).toBe('identifiant invalide');
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('bascule le champ done', async () => {
      const created = await store.create({ title: 'configurer Ansible' });

      const res = await request(app)
        .patch(`/api/tasks/${created.id}`)
        .send({ done: true })
        .expect(200);

      expect(res.body.done).toBe(true);
      expect(res.body.title).toBe('configurer Ansible');
    });

    it('conserve les champs non fournis (mise à jour partielle)', async () => {
      const created = await store.create({ title: 'ancien titre', description: 'contexte' });

      const res = await request(app)
        .patch(`/api/tasks/${created.id}`)
        .send({ title: 'nouveau titre' })
        .expect(200);

      expect(res.body.title).toBe('nouveau titre');
      expect(res.body.description).toBe('contexte');
    });

    it('rejette un corps vide avec 400', async () => {
      const created = await store.create({ title: 'tâche' });
      const res = await request(app).patch(`/api/tasks/${created.id}`).send({}).expect(400);
      expect(res.body.details.join(' ')).toMatch(/au moins un champ/);
    });

    it('rejette un done non booléen avec 400', async () => {
      const created = await store.create({ title: 'tâche' });
      const res = await request(app)
        .patch(`/api/tasks/${created.id}`)
        .send({ done: 'oui' })
        .expect(400);
      expect(res.body.details).toContain('done doit être un booléen');
    });

    it('renvoie 404 pour un identifiant inexistant', async () => {
      await request(app).patch('/api/tasks/999').send({ done: true }).expect(404);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('supprime la tâche et renvoie 204', async () => {
      const created = await store.create({ title: 'à supprimer' });

      await request(app).delete(`/api/tasks/${created.id}`).expect(204);
      await request(app).get(`/api/tasks/${created.id}`).expect(404);
    });

    it('renvoie 404 pour un identifiant inexistant', async () => {
      await request(app).delete('/api/tasks/999').expect(404);
    });
  });

  describe('cycle de vie complet', () => {
    it('enchaîne création, lecture, modification et suppression', async () => {
      const created = await request(app)
        .post('/api/tasks')
        .send({ title: 'pipeline CI/CD', description: 'Jenkins + K8s' })
        .expect(201);

      const id = created.body.id;

      await request(app).patch(`/api/tasks/${id}`).send({ done: true }).expect(200);

      const list = await request(app).get('/api/tasks').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].done).toBe(true);

      await request(app).delete(`/api/tasks/${id}`).expect(204);

      const empty = await request(app).get('/api/tasks').expect(200);
      expect(empty.body).toEqual([]);
    });
  });
});
