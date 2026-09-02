'use strict';

/**
 * Implémentation en mémoire du dépôt de tâches.
 * Utilisée par les tests unitaires (aucune dépendance externe requise) et
 * par le mode STORE_DRIVER=memory pour une démo rapide.
 */
class MemoryTaskStore {
  constructor() {
    this.tasks = new Map();
    this.nextId = 1;
  }

  async init() {
    return this;
  }

  async ping() {
    return true;
  }

  async list() {
    return [...this.tasks.values()].sort((a, b) => a.id - b.id);
  }

  async get(id) {
    return this.tasks.get(Number(id)) || null;
  }

  async create({ title, description = '' }) {
    const now = new Date().toISOString();
    const task = {
      id: this.nextId++,
      title,
      description,
      done: false,
      created_at: now,
      updated_at: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async update(id, patch) {
    const task = this.tasks.get(Number(id));
    if (!task) return null;

    const updated = {
      ...task,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.done !== undefined ? { done: patch.done } : {}),
      updated_at: new Date().toISOString(),
    };
    this.tasks.set(updated.id, updated);
    return updated;
  }

  async remove(id) {
    return this.tasks.delete(Number(id));
  }

  async close() {
    this.tasks.clear();
  }
}

module.exports = MemoryTaskStore;
