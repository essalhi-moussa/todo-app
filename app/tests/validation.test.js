'use strict';

const { validateTaskPayload, parseId, MAX_TITLE_LENGTH } = require('../src/routes/tasks');

describe('validateTaskPayload', () => {
  it('accepte une création minimale', () => {
    const { errors, payload } = validateTaskPayload({ title: 'ma tâche' });
    expect(errors).toEqual([]);
    expect(payload).toEqual({ title: 'ma tâche' });
  });

  it('accepte les trois champs à la création', () => {
    const { errors, payload } = validateTaskPayload({
      title: 'titre',
      description: 'détail',
      done: true,
    });
    expect(errors).toEqual([]);
    expect(payload).toEqual({ title: 'titre', description: 'détail', done: true });
  });

  it('exige title hors mode partiel', () => {
    expect(validateTaskPayload({}).errors).toContain('title est obligatoire');
  });

  it('n’exige pas title en mode partiel', () => {
    const { errors, payload } = validateTaskPayload({ done: true }, { partial: true });
    expect(errors).toEqual([]);
    expect(payload).toEqual({ done: true });
  });

  it('refuse un corps partiel entièrement vide', () => {
    const { errors } = validateTaskPayload({}, { partial: true });
    expect(errors.join(' ')).toMatch(/au moins un champ/);
  });

  it(`refuse un titre de plus de ${MAX_TITLE_LENGTH} caractères`, () => {
    const { errors } = validateTaskPayload({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) });
    expect(errors).toHaveLength(1);
  });

  it(`accepte un titre de très exactement ${MAX_TITLE_LENGTH} caractères`, () => {
    const { errors } = validateTaskPayload({ title: 'a'.repeat(MAX_TITLE_LENGTH) });
    expect(errors).toEqual([]);
  });

  it('cumule plusieurs erreurs', () => {
    const { errors } = validateTaskPayload({ title: '', description: 1, done: 'x' });
    expect(errors).toHaveLength(3);
  });
});

describe('parseId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
  ])('accepte %s', (raw, expected) => {
    expect(parseId(raw)).toBe(expected);
  });

  it.each(['0', '-3', 'abc', '1.5', '', undefined])('rejette %s', (raw) => {
    expect(parseId(raw)).toBeNull();
  });
});
