'use strict';

const express = require('express');

const MAX_TITLE_LENGTH = 200;

/** Valide et normalise le corps d'une création/modification de tâche. */
function validateTaskPayload(body, { partial = false } = {}) {
  const errors = [];
  const payload = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      errors.push('title doit être une chaîne de caractères');
    } else if (body.title.trim().length === 0) {
      errors.push('title ne peut pas être vide');
    } else if (body.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push(`title ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères`);
    } else {
      payload.title = body.title.trim();
    }
  } else if (!partial) {
    errors.push('title est obligatoire');
  }

  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      errors.push('description doit être une chaîne de caractères');
    } else {
      payload.description = body.description.trim();
    }
  }

  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') {
      errors.push('done doit être un booléen');
    } else {
      payload.done = body.done;
    }
  }

  if (partial && Object.keys(payload).length === 0 && errors.length === 0) {
    errors.push('au moins un champ parmi title, description, done est requis');
  }

  return { errors, payload };
}

/** Rejette les identifiants non entiers avant d'atteindre la base. */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Construit le routeur REST /api/tasks au-dessus d'un dépôt injecté.
 * L'injection de dépendance permet de tester les routes avec le dépôt
 * en mémoire, sans PostgreSQL.
 */
function createTasksRouter(store) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      res.json(await store.list());
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'identifiant invalide' });
    }
    try {
      const task = await store.get(id);
      if (!task) return res.status(404).json({ error: 'tâche introuvable' });
      return res.json(task);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    const { errors, payload } = validateTaskPayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({ error: 'requête invalide', details: errors });
    }
    try {
      const task = await store.create(payload);
      return res.status(201).location(`/api/tasks/${task.id}`).json(task);
    } catch (err) {
      return next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'identifiant invalide' });
    }
    const { errors, payload } = validateTaskPayload(req.body || {}, { partial: true });
    if (errors.length) {
      return res.status(400).json({ error: 'requête invalide', details: errors });
    }
    try {
      const task = await store.update(id, payload);
      if (!task) return res.status(404).json({ error: 'tâche introuvable' });
      return res.json(task);
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'identifiant invalide' });
    }
    try {
      const deleted = await store.remove(id);
      if (!deleted) return res.status(404).json({ error: 'tâche introuvable' });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { createTasksRouter, validateTaskPayload, parseId, MAX_TITLE_LENGTH };
