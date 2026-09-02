'use strict';

const API = '/api/tasks';

const els = {
  form: document.getElementById('new-task'),
  title: document.getElementById('title'),
  error: document.getElementById('error'),
  meta: document.getElementById('meta'),
  todo: document.getElementById('list-todo'),
  done: document.getElementById('list-done'),
  countTodo: document.getElementById('count-todo'),
  countDone: document.getElementById('count-done'),
};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.details ? body.details.join(', ') : body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = task.done ? 'done' : '';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.title = task.done ? 'Marquer à faire' : 'Marquer terminée';
  checkbox.addEventListener('change', () => toggle(task, checkbox.checked));

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = task.title;

  const del = document.createElement('button');
  del.type = 'button';
  del.textContent = '×';
  del.title = 'Supprimer';
  del.addEventListener('click', () => remove(task));

  li.append(checkbox, label, del);
  return li;
}

function renderColumn(ul, tasks, emptyLabel) {
  ul.replaceChildren();
  if (tasks.length === 0) {
    const p = document.createElement('li');
    p.className = 'empty';
    p.textContent = emptyLabel;
    ul.append(p);
    return;
  }
  tasks.forEach((task) => ul.append(renderTask(task)));
}

async function refresh() {
  try {
    const tasks = await api(API);
    const todo = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);

    renderColumn(els.todo, todo, 'Aucune tâche en cours.');
    renderColumn(els.done, done, 'Aucune tâche terminée.');
    els.countTodo.textContent = todo.length;
    els.countDone.textContent = done.length;
    showError('');
  } catch (err) {
    showError(`Impossible de charger les tâches : ${err.message}`);
  }
}

async function toggle(task, done) {
  try {
    await api(`${API}/${task.id}`, { method: 'PATCH', body: JSON.stringify({ done }) });
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

async function remove(task) {
  try {
    await api(`${API}/${task.id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    showError(err.message);
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = els.title.value.trim();
  if (!title) return;
  try {
    await api(API, { method: 'POST', body: JSON.stringify({ title }) });
    els.title.value = '';
    await refresh();
  } catch (err) {
    showError(err.message);
  }
});

/** Affiche la version et le pod qui répond : rend visible le scaling K8s. */
async function loadMeta() {
  try {
    const health = await api('/health');
    els.meta.textContent = `version ${health.version} — servi par ${health.instance}`;
  } catch {
    els.meta.textContent = 'métadonnées indisponibles';
  }
}

loadMeta();
refresh();
setInterval(loadMeta, 15000);
