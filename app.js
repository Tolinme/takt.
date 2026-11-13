/* Такт — universal task tracker. Vanilla JS, zero runtime dependencies. */
(() => {
  'use strict';

  const STORAGE_KEY = 'takt.tasks.v1';
  const STATUS = {
    todo:        { label: 'К выполнению', color: '#8a948d', icon: 'inbox' },
    in_progress: { label: 'В работе',     color: '#3b6ff5', icon: 'clock' },
    review:      { label: 'На проверке',  color: '#f5b544', icon: 'alert' },
    done:        { label: 'Готово',       color: '#2f9e6e', icon: 'done' }
  };
  const PRIORITY = {
    urgent: { label: 'Срочно',  color: '#e5484d', rank: 0 },
    high:   { label: 'Высокий', color: '#ff6b4a', rank: 1 },
    medium: { label: 'Средний', color: '#d98324', rank: 2 },
    low:    { label: 'Низкий',  color: '#3b6ff5', rank: 3 }
  };
  const PROJECT_COLORS = ['#ff6b4a', '#3b6ff5', '#f5b544', '#8b5cf6', '#14b8a6', '#d946ef', '#2f9e6e', '#e5484d'];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const clone = o => JSON.parse(JSON.stringify(o));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const pad = n => String(n).padStart(2, '0');
  const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dateStr(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return dateStr(d); };
  const parseDay = s => new Date(s + 'T00:00:00');
  const fmtDay = s => parseDay(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  const fmtFull = s => parseDay(s).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtTime = iso => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const daysDiff = s => Math.round((parseDay(s) - parseDay(today())) / 86400000);

  let storageOK = true;
  let data = load();
  const ui = {
    view: data.prefs?.view || 'board',
    section: 'all',
    projectId: null,
    savedViewId: null,
    search: '',
    filters: { priority: 'all', due: 'all', tag: 'all' },
    sort: 'manual',
    selected: new Set(),
    drawer: null,
    modal: null,
    filterOpen: false,
    context: null,
    calMonth: today().slice(0, 7),
    sidebarOpen: false
  };
  let undoSnapshot = null;
  let searchTimer = null;
  let lastFocus = null;

  function seed() {
    const t = today();
    const projects = [
      { id: 'p-product', name: 'Продукт', color: '#ff6b4a' },
      { id: 'p-marketing', name: 'Маркетинг', color: '#3b6ff5' },
      { id: 'p-personal', name: 'Личное', color: '#f5b544' },
      { id: 'p-dev', name: 'Разработка', color: '#8b5cf6' }
    ];
    const mk = (id, title, desc, projectId, status, priority, dueOffset, tags, subs = [], order = 0) => ({
      id, title, desc, projectId, status, priority,
      due: dueOffset === null ? '' : addDays(t, dueOffset),
      tags, estimate: 0,
      subtasks: subs.map((s, i) => ({ id: id + '-s' + i, title: s[0], done: s[1] })),
      comments: [],
      createdAt: new Date(Date.now() - (order + 2) * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: status === 'done' ? new Date(Date.now() - order * 3600000).toISOString() : null,
      order,
      activity: [{ id: uid(), text: 'Задача создана', at: new Date(Date.now() - (order + 2) * 86400000).toISOString() }]
    });
    const tasks = [
      mk('t1', 'Согласовать макеты онбординга', 'Проверить три сценария первого запуска и собрать правки от команды.', 'p-product', 'in_progress', 'high', 0, ['дизайн', 'релиз'], [['Экран приветствия', true], ['Шаг выбора цели', true], ['Пустое состояние', false]], 0),
      mk('t2', 'Подготовить релиз 2.4', 'Собрать changelog, прогнать регрессию и обновить документацию.', 'p-dev', 'todo', 'urgent', 1, ['релиз'], [['Changelog', false], ['Регрессия', false], ['Документация', false]], 1),
      mk('t3', 'Запустить рассылку о новых видах', 'Сегментировать базу, сверстать письмо и запланировать отправку.', 'p-marketing', 'review', 'medium', 2, ['email'], [['Текст письма', true], ['Сегменты базы', true], ['A/B тема', false]], 0),
      mk('t4', 'Записаться к стоматологу', 'Позвонить в клинику и выбрать удобное время.', 'p-personal', 'todo', 'low', 3, ['здоровье'], [], 2),
      mk('t5', 'Рефакторинг модуля фильтрации', 'Вынести предикаты в чистые функции и покрыть тестами.', 'p-dev', 'in_progress', 'medium', 4, ['код', 'техдолг'], [['Вынести предикаты', true], ['Тесты', false]], 1),
      mk('t6', 'Собрать метрики недели', 'Обновить дашборд: активация, удержание, конверсия в оплату.', 'p-product', 'todo', 'high', -1, ['аналитика'], [['Выгрузить данные', false], ['Обновить графики', false]], 3),
      mk('t7', 'Оплатить интернет и подписки', '', 'p-personal', 'done', 'low', -2, ['финансы'], [], 0),
      mk('t8', 'Интервью с пятью пользователями', 'Провести созвоны и заполнить карточки инсайтов.', 'p-product', 'in_progress', 'high', 5, ['исследования'], [['Сценарий интервью', true], ['Рекрутинг', true], ['Созвоны', false], ['Инсайты', false]], 2),
      mk('t9', 'Обновить лендинг под новый тариф', 'Заменить блоки с ценами и добавить FAQ.', 'p-marketing', 'todo', 'medium', 6, ['сайт'], [['Блок цен', false], ['FAQ', false]], 4),
      mk('t10', 'Настроить бэкапы базы', 'Ежедневный дамп в объектное хранилище + проверка восстановления.', 'p-dev', 'review', 'urgent', -3, ['инфра'], [['Скрипт дампа', true], ['Cron', true], ['Тест восстановления', false]], 1),
      mk('t11', 'Купить подарок на день рождения', '', 'p-personal', 'todo', 'medium', 8, ['семья'], [], 5),
      mk('t12', 'Написать пост о кейсе клиента', 'История внедрения с цифрами до/после.', 'p-marketing', 'done', 'medium', -4, ['контент'], [['Интервью', true], ['Черновик', true], ['Публикация', true]], 1),
      mk('t13', 'Приоритизировать бэклог спринта', 'Оценить задачи по ICE и согласовать скоуп с командой.', 'p-product', 'done', 'high', -1, ['планирование'], [], 2),
      mk('t14', 'Проверить доступность форм', 'Контраст, фокус, aria-метки и навигация с клавиатуры.', 'p-dev', 'todo', 'high', 0, ['a11y', 'код'], [['Контраст', false], ['Фокус', false], ['ARIA', false]], 6)
    ];
    return { version: 1, theme: 'light', prefs: { view: 'board' }, projects, tasks, savedViews: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.projects)) return seed();
      d.savedViews = Array.isArray(d.savedViews) ? d.savedViews : [];
      d.prefs = d.prefs || { view: 'board' };
      d.theme = d.theme === 'dark' ? 'dark' : 'light';
      d.projects = d.projects.filter(p => p && p.id && p.name).map(p => ({ id: String(p.id), name: String(p.name).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PROJECT_COLORS[0] }));
      d.tasks = d.tasks.filter(t => t && t.title).map((t, i) => ({
        ...t,
        id: String(t.id || uid()), title: String(t.title).slice(0, 160), desc: String(t.desc || ''),
        projectId: String(t.projectId || ''), status: STATUS[t.status] ? t.status : 'todo',
        priority: PRIORITY[t.priority] ? t.priority : 'medium', due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
        tags: Array.isArray(t.tags) ? t.tags.map(String) : [], estimate: Math.max(0, Number(t.estimate) || 0),
        subtasks: Array.isArray(t.subtasks) ? t.subtasks : [], comments: Array.isArray(t.comments) ? t.comments : [],
        activity: Array.isArray(t.activity) ? t.activity : [], order: Number.isFinite(t.order) ? t.order : i,
        createdAt: t.createdAt || new Date().toISOString(), updatedAt: t.updatedAt || new Date().toISOString(),
        completedAt: t.completedAt || null
      }));
      return d;
    } catch { storageOK = false; return seed(); }
  }
  function save() {
    data.prefs = { view: ui.view };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); storageOK = true; }
    catch { storageOK = false; }
    renderStorage();
  }
  function pushUndo(label) { undoSnapshot = { label, data: clone(data) }; }
  function undo() {
    if (!undoSnapshot) return;
    data = undoSnapshot.data; undoSnapshot = null;
    ui.selected.clear(); save(); renderAll();
    toast('Действие отменено', 'success');
  }

  /* ---------- derived ---------- */
  const projectById = id => data.projects.find(p => p.id === id);
  const taskById = id => data.tasks.find(t => t.id === id);
  const allTags = () => [...new Set(data.tasks.flatMap(t => t.tags || []))].sort((a, b) => a.localeCompare(b, 'ru'));
  function baseTasks() {
    let list = data.tasks.slice();
    if (ui.section === 'today') list = list.filter(t => t.due && t.due === today() && t.status !== 'done');
    else if (ui.section === 'upcoming') list = list.filter(t => t.due && t.due > today() && t.status !== 'done');
    else if (ui.section === 'done') list = list.filter(t => t.status === 'done');
    else if (ui.section === 'project' && ui.projectId) list = list.filter(t => t.projectId === ui.projectId);
    return list;
  }
  function filteredTasks() {
    let list = baseTasks();
    const q = ui.search.trim().toLowerCase();
    if (q) list = list.filter(t => {
      const p = projectById(t.projectId);
      return [t.title, t.desc, ...(t.tags || []), p?.name || ''].join(' ').toLowerCase().includes(q);
    });
    if (ui.filters.priority !== 'all') list = list.filter(t => t.priority === ui.filters.priority);
    if (ui.filters.tag !== 'all') list = list.filter(t => (t.tags || []).includes(ui.filters.tag));
    if (ui.filters.due !== 'all') {
      list = list.filter(t => {
        if (ui.filters.due === 'none') return !t.due;
        if (!t.due) return false;
        const d = daysDiff(t.due);
        if (ui.filters.due === 'overdue') return d < 0 && t.status !== 'done';
        if (ui.filters.due === 'today') return d === 0;
        if (ui.filters.due === 'week') return d >= 0 && d <= 7;
        return true;
      });
    }
    const cmp = {
      manual: (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt.localeCompare(b.createdAt),
      due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title, 'ru'),
      priority: (a, b) => (PRIORITY[a.priority]?.rank ?? 9) - (PRIORITY[b.priority]?.rank ?? 9) || (a.due || '9999').localeCompare(b.due || '9999'),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title, 'ru'),
      project: (a, b) => (projectById(a.projectId)?.name || 'я').localeCompare(projectById(b.projectId)?.name || 'я', 'ru') || a.title.localeCompare(b.title, 'ru'),
      status: (a, b) => Object.keys(STATUS).indexOf(a.status) - Object.keys(STATUS).indexOf(b.status) || (a.order ?? 0) - (b.order ?? 0)
    }[ui.sort] || ((a, b) => a.order - b.order);
    return list.sort(cmp);
  }
  function dueMeta(t) {
    if (!t.due) return null;
    const d = daysDiff(t.due);
    let cls = '', label = fmtDay(t.due);
    if (t.status !== 'done') {
      if (d < 0) { cls = 'overdue'; label = `Просрочено · ${fmtDay(t.due)}`; }
      else if (d === 0) { cls = 'today'; label = 'Сегодня'; }
      else if (d === 1) { cls = 'soon'; label = 'Завтра'; }
      else if (d <= 7) cls = 'soon';
    }
    return { cls, label };
  }
  function counts() {
    const open = data.tasks.filter(t => t.status !== 'done');
    return {
      all: data.tasks.length,
      today: open.filter(t => t.due === today()).length,
      upcoming: open.filter(t => t.due && t.due > today()).length,
      done: data.tasks.filter(t => t.status === 'done').length,
      overdue: open.filter(t => t.due && t.due < today()).length,
      progress: open.filter(t => t.status === 'in_progress' || t.status === 'review').length
    };
  }

  /* ---------- render ---------- */
  function renderAll() {
    document.documentElement.dataset.theme = data.theme;
    $('#themeToggle').innerHTML = icon(data.theme === 'dark' ? 'sun' : 'moon');
    $('#appShell').classList.toggle('sidebar-open', ui.sidebarOpen);
    renderSidebar(); renderHead(); renderToolbar(); renderFilters(); renderView(); renderBulk(); renderDrawer(); renderModal(); renderStorage();
    $('#globalSearch').value = ui.search;
    $('#searchClear').hidden = !ui.search;
  }
  function renderStorage() {
    $('#storageNote').innerHTML = storageOK
      ? '<span class="pulse-dot"></span><span>Сохранено в браузере</span>'
      : '<span class="pulse-dot" style="background:var(--amber)"></span><span>Только в памяти</span>';
    $('#storageBanner').innerHTML = storageOK ? '' : `<div class="storage-banner">${icon('alert')}<span>Браузер запретил локальное хранилище. Данные живут до перезагрузки — сделайте экспорт.</span></div>`;
  }
  function renderSidebar() {
    const c = counts();
    const nav = [
      ['all', 'inbox', 'Все задачи', c.all],
      ['today', 'today', 'Сегодня', c.today],
      ['upcoming', 'upcoming', 'Предстоящие', c.upcoming],
      ['done', 'done', 'Выполненные', c.done]
    ];
    $('#mainNav').innerHTML = nav.map(([id, ic, label, n]) =>
      `<button class="nav-item ${ui.section === id && !ui.savedViewId ? 'active' : ''}" data-action="nav" data-section="${id}">${icon(ic)}<span>${label}</span><span class="nav-count">${n}</span></button>`).join('');
    $('#projectList').innerHTML = data.projects.map(p => {
      const n = data.tasks.filter(t => t.projectId === p.id && t.status !== 'done').length;
      return `<div class="project-item ${ui.section === 'project' && ui.projectId === p.id && !ui.savedViewId ? 'active' : ''}" role="button" tabindex="0" data-action="project" data-id="${p.id}">
        <span class="project-dot" style="background:${p.color}"></span><span class="name">${esc(p.name)}</span>
        <span class="nav-count">${n}</span>
        <button class="edit-project" data-action="project-edit" data-id="${p.id}" aria-label="Изменить проект ${esc(p.name)}">${icon('edit')}</button></div>`;
    }).join('') || '<div class="saved-empty">Проектов пока нет</div>';
    $('#savedViewList').innerHTML = data.savedViews.length ? data.savedViews.map(v =>
      `<div class="saved-item ${ui.savedViewId === v.id ? 'active' : ''}" role="button" tabindex="0" data-action="saved-view" data-id="${v.id}">${icon('save')}<span class="name">${esc(v.name)}</span>
       <button class="edit-project" data-action="saved-view-delete" data-id="${v.id}" aria-label="Удалить вид">${icon('close')}</button></div>`).join('')
      : '<div class="saved-empty">Настройте фильтры и сохраните вид</div>';
  }
  function sectionTitle() {
    if (ui.savedViewId) return data.savedViews.find(v => v.id === ui.savedViewId)?.name || 'Сохранённый вид';
    if (ui.section === 'project') return projectById(ui.projectId)?.name || 'Проект';
    return { all: 'Все задачи', today: 'Сегодня', upcoming: 'Предстоящие', done: 'Выполненные' }[ui.section] || 'Все задачи';
  }
  function renderHead() {
    const c = counts();
    const list = filteredTasks();
    $('#pageTitle').textContent = sectionTitle();
    $('#breadcrumb').innerHTML = `Рабочее пространство <span>/</span> <strong>${esc(sectionTitle())}</strong>`;
    const dateLine = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#pageSubtitle').textContent = `${dateLine} · ${list.length} ${plural(list.length, 'задача', 'задачи', 'задач')} в выборке`;
    const pct = c.all ? Math.round(c.done / c.all * 100) : 0;
    $('#headMetrics').innerHTML = `
      <div class="metric" style="--m-color:var(--blue)"><div class="m-val">${c.progress}</div><div class="m-label">В работе</div><div class="m-bar"><i style="width:${c.all ? c.progress / c.all * 100 : 0}%"></i></div></div>
      <div class="metric" style="--m-color:var(--green)"><div class="m-val">${pct}%</div><div class="m-label">Выполнено</div><div class="m-bar"><i style="width:${pct}%"></i></div></div>
      <div class="metric" style="--m-color:var(--red)"><div class="m-val">${c.overdue}</div><div class="m-label">Просрочено</div><div class="m-bar"><i style="width:${c.all ? Math.min(100, c.overdue / c.all * 100) : 0}%"></i></div></div>`;
  }
  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few; return many; }
  function renderToolbar() {
    const f = ui.filters;
    const activeCount = Object.values(f).filter(v => v !== 'all').length + (ui.search ? 1 : 0);
    const views = [['board', 'board', 'Доска'], ['list', 'list', 'Список'], ['calendar', 'calendar', 'Календарь']];
    $('#toolbar').innerHTML = `
      <div class="view-switch" role="tablist" aria-label="Представление">${views.map(([id, ic, label]) =>
        `<button role="tab" aria-selected="${ui.view === id}" class="${ui.view === id ? 'active' : ''}" data-action="view" data-view="${id}">${icon(ic)}<span>${label}</span></button>`).join('')}</div>
      <div style="position:relative">
        <button class="btn btn-ghost btn-sm filter-btn ${ui.filterOpen ? 'active' : ''}" data-action="filter-toggle" aria-expanded="${ui.filterOpen}">${icon('filter')}<span>Фильтры</span>${activeCount ? `<span class="badge">${activeCount}</span>` : ''}</button>
        ${ui.filterOpen ? filterPop() : ''}
      </div>
      <div class="spacer"></div>
      <div class="select-wrap">${icon('sort')}<select id="sortSelect" aria-label="Сортировка">
        ${[['manual', 'Вручную'], ['due', 'По сроку'], ['priority', 'По приоритету'], ['created', 'Сначала новые'], ['title', 'По алфавиту'], ['project', 'По проекту'], ['status', 'По статусу']].map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <button class="btn btn-ghost btn-sm" data-action="save-view">${icon('save')}<span>Сохранить вид</span></button>`;
  }
  function filterPop() {
    const f = ui.filters;
    const opt = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
    return `<div class="filter-pop" role="dialog" aria-label="Фильтры">
      <h3>Фильтры выборки</h3>
      <div class="filter-grid">
        <div class="field"><label for="fPriority">Приоритет</label><select id="fPriority" data-filter="priority">${opt('all', f.priority, 'Любой')}${Object.entries(PRIORITY).map(([k, v]) => opt(k, f.priority, v.label)).join('')}</select></div>
        <div class="field"><label for="fDue">Срок</label><select id="fDue" data-filter="due">${opt('all', f.due, 'Любой')}${opt('overdue', f.due, 'Просроченные')}${opt('today', f.due, 'Сегодня')}${opt('week', f.due, 'Ближайшие 7 дней')}${opt('none', f.due, 'Без срока')}</select></div>
        <div class="field" style="grid-column:1/-1"><label for="fTag">Тег</label><select id="fTag" data-filter="tag">${opt('all', f.tag, 'Любой')}${allTags().map(t => opt(t, f.tag, esc(t))).join('')}</select></div>
      </div>
      <div class="pop-actions"><button class="btn btn-ghost btn-sm" data-action="filter-reset">Сбросить</button><button class="btn btn-primary btn-sm" data-action="filter-toggle">Готово</button></div>
    </div>`;
  }
  function renderFilters() {
    const chips = [];
    if (ui.search) chips.push(['search', `Поиск: «${esc(ui.search)}»`]);
    if (ui.filters.priority !== 'all') chips.push(['priority', `Приоритет: ${PRIORITY[ui.filters.priority]?.label}`]);
    if (ui.filters.due !== 'all') chips.push(['due', 'Срок: ' + ({ overdue: 'просроченные', today: 'сегодня', week: '7 дней', none: 'без срока' }[ui.filters.due])]);
    if (ui.filters.tag !== 'all') chips.push(['tag', `Тег: ${esc(ui.filters.tag)}`]);
    $('#activeFilters').innerHTML = chips.map(([k, l]) => `<span class="chip">${l}<button data-action="chip-remove" data-key="${k}" aria-label="Убрать фильтр">${icon('close')}</button></span>`).join('')
      + (chips.length ? '<button class="chip clear-all" data-action="filter-reset">Сбросить всё</button>' : '');
  }
  function renderView() {
    const list = filteredTasks();
    const root = $('#viewRoot');
    if (!list.length) { root.innerHTML = emptyState(); return; }
    if (ui.view === 'board') root.innerHTML = boardHTML(list);
    else if (ui.view === 'list') root.innerHTML = listHTML(list);
    else root.innerHTML = calendarHTML(list);
  }
  function emptyState() {
    const hasFilter = ui.search || Object.values(ui.filters).some(v => v !== 'all');
    return `<div class="empty-state"><div class="empty-icon">${icon(hasFilter ? 'search' : 'spark')}</div>
      <h3>${hasFilter ? 'Ничего не найдено' : 'Здесь пока пусто'}</h3>
      <p>${hasFilter ? 'Попробуйте смягчить фильтры или изменить запрос.' : 'Добавьте первую задачу — и она появится на доске, в списке и календаре.'}</p>
      ${hasFilter ? '<button class="btn btn-ghost" data-action="filter-reset">Сбросить фильтры</button>' : `<button class="btn btn-primary" data-action="new-task">${icon('plus')}Новая задача</button>`}</div>`;
  }
  function cardHTML(t, i) {
    const p = projectById(t.projectId);
    const due = dueMeta(t);
    const subs = t.subtasks || [];
    const doneSubs = subs.filter(s => s.done).length;
    const pr = PRIORITY[t.priority] || PRIORITY.medium;
    const sel = ui.selected.has(t.id);
    return `<article class="task-card ${t.status === 'done' ? 'done-card' : ''} ${sel ? 'selected' : ''}" draggable="true" data-id="${t.id}" data-action="open-task" style="animation-delay:${Math.min(i * 30, 240)}ms" tabindex="0" aria-label="${esc(t.title)}">
      <div class="card-top">
        <button class="check ${t.status === 'done' ? 'checked' : ''}" data-action="toggle-done" data-id="${t.id}" aria-label="${t.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'}">${icon('check')}</button>
        ${p ? `<span class="project-pill" style="--pc:${p.color}"><i></i><span>${esc(p.name)}</span></span>` : '<span class="project-pill" style="--pc:var(--ink-3)"><i></i><span>Без проекта</span></span>'}
        <button class="more-btn" data-action="task-menu" data-id="${t.id}" aria-label="Действия с задачей">${icon('more')}</button>
      </div>
      <h3 class="card-title">${esc(t.title)}</h3>
      ${t.desc ? `<p class="card-desc">${esc(t.desc)}</p>` : ''}
      ${(t.tags || []).length ? `<div class="card-tags">${t.tags.slice(0, 3).map(tag => `<span class="tag">#${esc(tag)}</span>`).join('')}</div>` : ''}
      <div class="card-foot">
        <span class="priority ${t.priority}">${icon('flag')}<span>${pr.label}</span></span>
        ${due ? `<span class="due ${due.cls}">${icon('calendar')}<span>${due.label}</span></span>` : ''}
        ${subs.length ? `<span class="sub-progress">${icon('subtask')}<span>${doneSubs}/${subs.length}</span><span class="mini-bar"><i style="width:${doneSubs / subs.length * 100}%"></i></span></span>` : ''}
      </div>
      <span class="drag-handle" aria-hidden="true">${icon('drag')}</span>
    </article>`;
  }
  function boardHTML(list) {
    return `<div class="board" role="list" aria-label="Доска задач">${Object.entries(STATUS).map(([key, st]) => {
      const items = list.filter(t => t.status === key);
      return `<section class="column" data-status="${key}" role="listitem" aria-label="${st.label}">
        <div class="column-head"><span class="col-dot" style="--c:${st.color};background:${st.color}"></span><span class="col-title">${st.label}</span><span class="col-count">${items.length}</span>
          <button class="mini-add" data-action="new-task" data-status="${key}" aria-label="Добавить в ${st.label}">${icon('plus')}</button></div>
        <div class="card-list">${items.length ? items.map((t, i) => cardHTML(t, i)).join('') : '<div class="col-empty">Перетащите задачу сюда</div>'}</div>
        <button class="add-card-btn" data-action="new-task" data-status="${key}">${icon('plus')}Добавить задачу</button>
      </section>`;
    }).join('')}</div>`;
  }
  function listHTML(list) {
    const allSel = list.length && list.every(t => ui.selected.has(t.id));
    const sortBtn = (key, label) => `<button data-action="sort" data-sort="${key}">${label}${ui.sort === key ? icon('check') : ''}</button>`;
    return `<div class="list-view"><div class="list-scroll"><div class="list-inner">
      <div class="list-head">
        <span class="row-check"><button class="check ${allSel ? 'checked' : ''}" data-action="select-all" aria-label="Выбрать все">${icon('check')}</button></span>
        ${sortBtn('title', 'Задача')}${sortBtn('project', 'Проект')}${sortBtn('status', 'Статус')}${sortBtn('priority', 'Приоритет')}${sortBtn('due', 'Срок')}<span>Подзадачи</span><span></span>
      </div>
      ${list.map(t => {
        const p = projectById(t.projectId); const due = dueMeta(t); const subs = t.subtasks || []; const ds = subs.filter(s => s.done).length;
        const pr = PRIORITY[t.priority] || PRIORITY.medium; const st = STATUS[t.status];
        return `<div class="list-row ${ui.selected.has(t.id) ? 'selected' : ''} ${t.status === 'done' ? 'done-row' : ''}" draggable="${ui.sort === 'manual'}" data-id="${t.id}" data-action="open-task" tabindex="0">
          <span class="row-check"><button class="check ${ui.selected.has(t.id) ? 'checked' : ''}" data-action="select-task" data-id="${t.id}" aria-label="Выбрать задачу">${icon('check')}</button></span>
          <div class="row-title-wrap"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${(t.tags || []).slice(0, 2).map(x => `<span>#${esc(x)}</span>`).join('')}</div></div>
          <span>${p ? `<span class="project-pill" style="--pc:${p.color}"><i></i><span>${esc(p.name)}</span></span>` : '<span style="color:var(--ink-3)">—</span>'}</span>
          <span><span class="status-badge" style="--c:${st.color}"><i></i>${st.label}</span></span>
          <span class="priority ${t.priority}">${icon('flag')}${pr.label}</span>
          <span>${due ? `<span class="due ${due.cls}">${due.label}</span>` : '<span style="color:var(--ink-3)">—</span>'}</span>
          <span style="font-size:12px;color:var(--ink-3);font-weight:650">${subs.length ? ds + '/' + subs.length : '—'}</span>
          <button class="more-btn" style="opacity:1" data-action="task-menu" data-id="${t.id}" aria-label="Действия">${icon('more')}</button>
        </div>`;
      }).join('')}
    </div></div></div>`;
  }
  function calendarHTML(list) {
    const [y, m] = ui.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startDow = (first.getDay() + 6) % 7;
    const start = new Date(y, m - 1, 1 - startDow);
    const monthName = first.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = dateStr(d);
      const dayTasks = list.filter(t => t.due === ds);
      const other = d.getMonth() !== m - 1;
      cells += `<div class="cal-day ${other ? 'other' : ''} ${ds === today() ? 'today' : ''}" data-date="${ds}">
        <div class="day-num">${d.getDate()}</div>
        <button class="add-day" data-action="new-task" data-date="${ds}" aria-label="Добавить на ${ds}">${icon('plus')}</button>
        ${dayTasks.slice(0, 3).map(t => { const p = projectById(t.projectId); return `<button class="cal-task ${t.status === 'done' ? 'done' : ''}" draggable="true" data-id="${t.id}" data-action="open-task" style="--pc:${p?.color || '#8a948d'}" title="${esc(t.title)}">${esc(t.title)}</button>`; }).join('')}
        ${dayTasks.length > 3 ? `<button class="cal-more" data-action="day-modal" data-date="${ds}">ещё ${dayTasks.length - 3}</button>` : ''}
      </div>`;
    }
    return `<div class="calendar">
      <div class="cal-head"><button class="icon-btn" style="width:32px;height:32px" data-action="cal-prev" aria-label="Предыдущий месяц">${icon('chevron-left')}</button>
        <h3>${monthName}</h3>
        <button class="icon-btn" style="width:32px;height:32px" data-action="cal-next" aria-label="Следующий месяц">${icon('chevron-right')}</button>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-action="cal-today">Сегодня</button></div>
      <div class="cal-grid">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>
    </div>`;
  }
  function renderBulk() {
    const bar = $('#bulkBar');
    const n = ui.selected.size;
    if (!n) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = `<span class="bulk-count">${n} ${plural(n, 'задача', 'задачи', 'задач')}</span>
      <select id="bulkStatus" aria-label="Статус для выбранных"><option value="">Статус…</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      <select id="bulkPriority" aria-label="Приоритет для выбранных"><option value="">Приоритет…</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" data-action="bulk-delete">${icon('trash')}Удалить</button>
      <button class="icon-btn" data-action="bulk-clear" aria-label="Снять выделение">${icon('close')}</button>`;
  }

  /* ---------- drawer ---------- */
  function openDrawer(id, preset = {}) {
    lastFocus = document.activeElement;
    const t = id ? taskById(id) : null;
    ui.drawer = {
      id: t?.id || null,
      draft: t ? clone(t) : {
        id: null, title: '', desc: '', projectId: preset.projectId || ui.projectId || data.projects[0]?.id || '',
        status: preset.status || 'todo', priority: 'medium', due: preset.date || '', tags: [], estimate: 0,
        subtasks: [], comments: [], activity: []
      },
      tagInput: ''
    };
    closeContext(); renderDrawer();
    setTimeout(() => $('#drawerTitle')?.focus(), 60);
  }
  function closeDrawer() { ui.drawer = null; renderDrawer(); lastFocus?.focus?.(); }
  function renderDrawer() {
    const root = $('#drawerRoot');
    if (!ui.drawer) { root.innerHTML = ''; return; }
    const prevScroll = $('.drawer-body')?.scrollTop || 0;
    const prevFocus = document.activeElement?.id || '';
    const d = ui.drawer.draft;
    const isNew = !d.id;
    const subs = d.subtasks || [];
    const doneSubs = subs.filter(s => s.done).length;
    root.innerHTML = `<div class="drawer-scrim" data-action="drawer-close"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="${isNew ? 'Новая задача' : 'Редактирование задачи'}">
        <div class="drawer-head"><span class="drawer-id">${isNew ? 'НОВАЯ ЗАДАЧА' : 'ЗАДАЧА · ' + esc(d.id.slice(0, 6).toUpperCase())}</span><div class="spacer"></div>
          ${!isNew ? `<button class="icon-btn" data-action="drawer-duplicate" aria-label="Дублировать">${icon('copy')}</button><button class="icon-btn" data-action="drawer-delete" aria-label="Удалить">${icon('trash')}</button>` : ''}
          <button class="icon-btn" data-action="drawer-close" aria-label="Закрыть">${icon('close')}</button></div>
        <div class="drawer-body">
          <input id="drawerTitle" class="drawer-title-input" placeholder="Название задачи" value="${esc(d.title)}" data-draft="title" maxlength="160" />
          <div class="drawer-grid">
            <div class="field"><label for="dProject">Проект</label><select id="dProject" data-draft="projectId"><option value="">Без проекта</option>${data.projects.map(p => `<option value="${p.id}" ${d.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="dStatus">Статус</label><select id="dStatus" data-draft="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div class="field"><label for="dPriority">Приоритет</label><select id="dPriority" data-draft="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${d.priority === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
            <div class="field"><label for="dDue">Срок</label><input id="dDue" type="date" data-draft="due" value="${esc(d.due)}" /></div>
            <div class="field"><label for="dEstimate">Оценка, ч</label><input id="dEstimate" type="number" min="0" max="999" step="0.5" data-draft="estimate" value="${d.estimate || 0}" /></div>
            <div class="field"><label>Прогресс</label><div style="padding:8px 0;font-size:13px;font-weight:700;color:var(--green)">${subs.length ? Math.round(doneSubs / subs.length * 100) + '% · ' + doneSubs + '/' + subs.length : 'Без подзадач'}</div></div>
          </div>
          <div class="field"><label for="dDesc">Описание</label><textarea id="dDesc" data-draft="desc" placeholder="Контекст, критерии готовности, ссылки…">${esc(d.desc)}</textarea></div>
          <div class="drawer-section"><h4>${icon('tag')}Теги</h4>
            <div class="tag-input-wrap">${(d.tags || []).map(tag => `<span class="tag">#${esc(tag)}<button data-action="tag-remove" data-tag="${esc(tag)}" aria-label="Убрать тег">${icon('close')}</button></span>`).join('')}
              <input id="tagInput" placeholder="Добавить тег и нажать Enter" value="${esc(ui.drawer.tagInput)}" /></div></div>
          <div class="drawer-section"><h4>${icon('subtask')}Подзадачи ${subs.length ? `· ${doneSubs}/${subs.length}` : ''}</h4>
            <div class="subtask-list">${subs.map(s => `<div class="subtask ${s.done ? 'done' : ''}"><button class="check ${s.done ? 'checked' : ''}" data-action="subtask-toggle" data-id="${s.id}" aria-label="Переключить подзадачу">${icon('check')}</button><span>${esc(s.title)}</span><button class="del-sub" data-action="subtask-delete" data-id="${s.id}" aria-label="Удалить подзадачу">${icon('trash')}</button></div>`).join('')}</div>
            <div class="add-subtask"><input id="subtaskInput" placeholder="Новая подзадача" /><button class="btn btn-ghost btn-sm" data-action="subtask-add">${icon('plus')}Добавить</button></div></div>
          ${!isNew ? `<div class="drawer-section"><h4>${icon('list')}Комментарии</h4>
            ${(d.comments || []).map(c => `<div class="comment"><div class="c-meta">Вы · ${fmtTime(c.at)}</div>${esc(c.text)}</div>`).join('') || '<p style="color:var(--ink-3);font-size:12.5px;margin:0">Комментариев пока нет.</p>'}
            <div class="comment-box"><input id="commentInput" placeholder="Написать комментарий…" /><button class="btn btn-ghost btn-sm" data-action="comment-add">Отправить</button></div></div>
          <div class="drawer-section"><h4>${icon('clock')}Активность</h4><div class="activity">${(d.activity || []).slice(-6).reverse().map(a => `<div class="activity-item"><span class="a-dot"></span><span>${esc(a.text)}</span><span class="a-time">${fmtTime(a.at)}</span></div>`).join('')}</div></div>` : ''}
        </div>
        <div class="drawer-foot"><button class="btn btn-ghost" data-action="drawer-close">Отмена</button><div class="spacer"></div>
          <button class="btn btn-primary" data-action="drawer-save">${icon('check')}${isNew ? 'Создать задачу' : 'Сохранить'}</button></div>
      </aside>`;
    const body = $('.drawer-body');
    if (body) body.scrollTop = prevScroll;
    if (prevFocus) document.getElementById(prevFocus)?.focus();
  }
  function saveDrawer() {
    const d = ui.drawer.draft;
    const title = d.title.trim();
    if (!title) { toast('Введите название задачи', 'error'); $('#drawerTitle')?.focus(); return; }
    d.title = title;
    d.estimate = Math.max(0, Number(d.estimate) || 0);
    const now = new Date().toISOString();
    if (d.id) {
      const idx = data.tasks.findIndex(t => t.id === d.id);
      if (idx < 0) { toast('Задача уже удалена', 'error'); closeDrawer(); renderAll(); return; }
      const old = data.tasks[idx];
      const changes = [];
      if (old.status !== d.status) changes.push(`Статус: ${STATUS[old.status].label} → ${STATUS[d.status].label}`);
      if (old.priority !== d.priority) changes.push(`Приоритет: ${PRIORITY[d.priority].label}`);
      if (old.due !== d.due) changes.push(d.due ? `Срок: ${fmtDay(d.due)}` : 'Срок убран');
      d.updatedAt = now;
      d.completedAt = d.status === 'done' ? (old.completedAt || now) : null;
      d.activity = [...(d.activity || []), ...(changes.length ? [{ id: uid(), text: changes.join('; '), at: now }] : [])].slice(-30);
      data.tasks[idx] = clone(d);
      toast('Задача сохранена', 'success');
    } else {
      const t = { ...clone(d), id: uid(), createdAt: now, updatedAt: now, completedAt: d.status === 'done' ? now : null, order: data.tasks.length, activity: [{ id: uid(), text: 'Задача создана', at: now }] };
      data.tasks.unshift(t);
      toast('Задача создана', 'success');
    }
    save(); closeDrawer(); renderAll();
  }

  /* ---------- modal ---------- */
  function openModal(type, payload = {}) { ui.modal = { type, ...payload }; closeContext(); renderModal(); setTimeout(() => $('.modal input, .modal select, .modal button')?.focus(), 50); }
  function closeModal() { ui.modal = null; renderModal(); }
  function renderModal() {
    const root = $('#modalRoot');
    if (!ui.modal) { root.innerHTML = ''; return; }
    const m = ui.modal;
    let body = '', foot = '', title = '';
    if (m.type === 'project') {
      const p = m.id ? projectById(m.id) : null;
      title = p ? 'Изменить проект' : 'Новый проект';
      body = `<div class="field" style="margin-bottom:14px"><label for="projectName">Название</label><input id="projectName" value="${esc(p?.name || '')}" maxlength="40" placeholder="Например, Ремонт" /></div>
        <div class="field"><label>Цвет</label><div class="color-row">${PROJECT_COLORS.map(c => `<button class="color-swatch ${(p?.color || PROJECT_COLORS[0]) === c ? 'active' : ''}" style="background:${c}" data-action="project-color" data-color="${c}" aria-label="Цвет ${c}"></button>`).join('')}</div></div>`;
      foot = `${p ? `<button class="btn btn-ghost" style="color:var(--red);margin-right:auto" data-action="project-delete" data-id="${p.id}">${icon('trash')}Удалить</button>` : ''}<button class="btn btn-ghost" data-action="modal-close">Отмена</button><button class="btn btn-primary" data-action="project-save">${p ? 'Сохранить' : 'Создать'}</button>`;
      ui.modal.color = p?.color || PROJECT_COLORS[0];
    } else if (m.type === 'save-view') {
      title = 'Сохранить вид';
      body = `<p>Текущие раздел, фильтры, поиск, сортировка и представление будут сохранены как быстрый вид.</p><div class="field"><label for="viewName">Название вида</label><input id="viewName" maxlength="40" placeholder="Например, Срочное на неделю" value="${esc(sectionTitle())}" /></div>`;
      foot = `<button class="btn btn-ghost" data-action="modal-close">Отмена</button><button class="btn btn-primary" data-action="saved-view-save">${icon('save')}Сохранить</button>`;
    } else if (m.type === 'confirm') {
      title = m.title || 'Подтвердите действие';
      body = `<p>${esc(m.text)}</p>`;
      foot = `<button class="btn btn-ghost" data-action="modal-close">Отмена</button><button class="btn btn-danger" data-action="confirm-ok">${m.okLabel || 'Удалить'}</button>`;
    } else if (m.type === 'help') {
      title = 'Как пользоваться Тактом';
      body = `<div class="help-grid">
        <div class="help-row">${icon('board')}<span><b>Доска:</b> перетаскивайте карточки между колонками и внутри колонки. Клик по карточке открывает детали.</span></div>
        <div class="help-row">${icon('list')}<span><b>Список:</b> сортировка по колонкам, множественный выбор и групповые действия.</span></div>
        <div class="help-row">${icon('calendar')}<span><b>Календарь:</b> переносите задачи на другие дни перетаскиванием.</span></div>
        <div class="help-row"><kbd>N</kbd><span>Новая задача</span></div>
        <div class="help-row"><kbd>/</kbd><span>Поиск</span></div>
        <div class="help-row"><kbd>1 / 2 / 3</kbd><span>Доска / Список / Календарь</span></div>
        <div class="help-row"><kbd>Esc</kbd><span>Закрыть панель, меню или фильтры</span></div>
        <div class="help-row">${icon('download')}<span>Данные хранятся в вашем браузере. Экспортируйте JSON для переноса или резервной копии.</span></div>
      </div>`;
      foot = `<button class="btn btn-primary" data-action="modal-close">Понятно</button>`;
    } else if (m.type === 'day') {
      const tasks = filteredTasks().filter(t => t.due === m.date);
      title = fmtFull(m.date);
      body = `<div class="subtask-list">${tasks.map(t => { const p = projectById(t.projectId); return `<button class="subtask" style="width:100%;text-align:left;cursor:pointer" data-action="open-task" data-id="${t.id}"><span class="project-dot" style="background:${p?.color || '#8a948d'}"></span><span style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(t.title)}</span>${icon('chevron-right')}</button>`; }).join('') || '<p style="color:var(--ink-3)">На этот день задач нет.</p>'}</div>`;
      foot = `<button class="btn btn-ghost" data-action="modal-close">Закрыть</button><button class="btn btn-primary" data-action="new-task" data-date="${m.date}">${icon('plus')}Добавить</button>`;
    }
    root.innerHTML = `<div class="modal-scrim" data-action="modal-close"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-stop><div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-action="modal-close" aria-label="Закрыть">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot}</div></div></div>`;
  }

  /* ---------- context menu / toast ---------- */
  function openContext(id, x, y) {
    const t = taskById(id); if (!t) return;
    ui.context = { id, x, y };
    renderContext();
  }
  function closeContext() { if (!ui.context) return; ui.context = null; $('.context-menu')?.remove(); }
  function renderContext() {
    $('.context-menu')?.remove();
    if (!ui.context) return;
    const t = taskById(ui.context.id); if (!t) return;
    const el = document.createElement('div');
    el.className = 'context-menu';
    el.innerHTML = `<button data-action="open-task" data-id="${t.id}">${icon('edit')}Открыть</button>
      <button data-action="duplicate-task" data-id="${t.id}">${icon('copy')}Дублировать</button>
      <div class="menu-label">Переместить</div>
      ${Object.entries(STATUS).map(([k, v]) => `<button data-action="move-task" data-id="${t.id}" data-status="${k}" ${t.status === k ? 'disabled' : ''}><span class="col-dot" style="background:${v.color}"></span>${v.label}</button>`).join('')}
      <hr><button class="danger" data-action="delete-task" data-id="${t.id}">${icon('trash')}Удалить</button>`;
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(ui.context.x, innerWidth - r.width - 10) + 'px';
    el.style.top = Math.min(ui.context.y, innerHeight - r.height - 10) + 'px';
  }
  function toast(msg, type = 'success', action) {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="t-icon">${icon(type === 'error' ? 'alert' : type === 'info' ? 'spark' : 'check')}</span><span>${esc(msg)}</span>${action ? `<button class="t-action" data-toast-action>${esc(action.label)}</button>` : ''}<button class="t-close" aria-label="Закрыть уведомление">${icon('close')}</button>`;
    root.appendChild(el);
    const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
    const timer = setTimeout(kill, action ? 7000 : 3800);
    el.querySelector('.t-close').onclick = () => { clearTimeout(timer); kill(); };
    if (action) el.querySelector('[data-toast-action]').onclick = () => { clearTimeout(timer); kill(); action.fn(); };
    while (root.children.length > 4) root.firstChild.remove();
  }

  /* ---------- mutations ---------- */
  function setStatus(id, status, silent = false) {
    const t = taskById(id); if (!t || t.status === status) return;
    const old = t.status;
    t.status = status; t.updatedAt = new Date().toISOString();
    t.completedAt = status === 'done' ? new Date().toISOString() : null;
    t.activity = [...(t.activity || []), { id: uid(), text: `Статус: ${STATUS[old].label} → ${STATUS[status].label}`, at: t.updatedAt }].slice(-30);
    save(); renderAll();
    if (!silent) toast(status === 'done' ? 'Задача выполнена' : `Перемещено: ${STATUS[status].label}`, 'success', { label: 'Отменить', fn: () => setStatus(id, old, true) });
  }
  function toggleDone(id) { const t = taskById(id); if (t) setStatus(id, t.status === 'done' ? 'todo' : 'done'); }
  function deleteTasks(ids) {
    pushUndo('delete');
    data.tasks = data.tasks.filter(t => !ids.includes(t.id));
    ids.forEach(id => ui.selected.delete(id));
    save(); renderAll();
    toast(`Удалено: ${ids.length}`, 'info', { label: 'Отменить', fn: undo });
  }
  function duplicateTask(id) {
    const t = taskById(id); if (!t) return;
    const now = new Date().toISOString();
    const copy = { ...clone(t), id: uid(), title: t.title + ' (копия)', createdAt: now, updatedAt: now, completedAt: null, status: t.status === 'done' ? 'todo' : t.status, order: data.tasks.length, activity: [{ id: uid(), text: 'Создано дублированием', at: now }] };
    copy.subtasks = copy.subtasks.map(s => ({ ...s, id: uid(), done: false }));
    copy.comments = [];
    data.tasks.unshift(copy); save(); renderAll(); toast('Задача продублирована', 'success');
  }
  function moveTask(id, status) { setStatus(id, status); closeContext(); }
  function reorder(dragId, status, beforeId) {
    const t = taskById(dragId); if (!t) return;
    const oldStatus = t.status;
    const col = data.tasks.filter(x => x.status === status && x.id !== dragId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = beforeId ? col.findIndex(x => x.id === beforeId) : col.length;
    col.splice(idx < 0 ? col.length : idx, 0, t);
    col.forEach((x, i) => x.order = i);
    if (oldStatus !== status) {
      t.status = status; t.completedAt = status === 'done' ? new Date().toISOString() : null; t.updatedAt = new Date().toISOString();
      t.activity = [...(t.activity || []), { id: uid(), text: `Перемещено: ${STATUS[status].label}`, at: t.updatedAt }].slice(-30);
    }
    save(); renderAll();
    if (oldStatus !== status) toast(`Перемещено: ${STATUS[status].label}`, 'success');
  }
  function applyBulk(field, value) {
    if (!value) return;
    pushUndo('bulk');
    const now = new Date().toISOString();
    ui.selected.forEach(id => {
      const t = taskById(id); if (!t) return;
      t[field] = value; t.updatedAt = now;
      if (field === 'status') t.completedAt = value === 'done' ? now : null;
      t.activity = [...(t.activity || []), { id: uid(), text: field === 'status' ? `Групповое действие: ${STATUS[value].label}` : `Приоритет: ${PRIORITY[value].label}`, at: now }].slice(-30);
    });
    save(); renderAll();
    toast(`Обновлено задач: ${ui.selected.size}`, 'success', { label: 'Отменить', fn: undo });
  }

  /* ---------- import/export ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportJSON() { download(`takt-${today()}.json`, JSON.stringify(data, null, 2), 'application/json'); toast('JSON экспортирован', 'success'); }
  function normalizeImport(d) {
    if (!d || !Array.isArray(d.tasks)) throw new Error('Ожидался файл Такта с массивом tasks');
    const projects = Array.isArray(d.projects) ? d.projects.filter(p => p && p.id && p.name).map(p => ({ id: String(p.id), name: String(p.name).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PROJECT_COLORS[0] })) : [];
    const pids = new Set(projects.map(p => p.id));
    const tasks = d.tasks.filter(t => t && t.title).map((t, i) => ({
      id: String(t.id || uid()), title: String(t.title).slice(0, 160), desc: String(t.desc || '').slice(0, 4000),
      projectId: pids.has(t.projectId) ? t.projectId : '', status: STATUS[t.status] ? t.status : 'todo',
      priority: PRIORITY[t.priority] ? t.priority : 'medium', due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '',
      tags: Array.isArray(t.tags) ? t.tags.map(String).slice(0, 12) : [], estimate: Math.max(0, Number(t.estimate) || 0),
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter(s => s && s.title).map(s => ({ id: String(s.id || uid()), title: String(s.title).slice(0, 160), done: !!s.done })) : [],
      comments: Array.isArray(t.comments) ? t.comments.filter(c => c && c.text).map(c => ({ id: String(c.id || uid()), text: String(c.text).slice(0, 1000), at: c.at || new Date().toISOString() })) : [],
      createdAt: t.createdAt || new Date().toISOString(), updatedAt: t.updatedAt || new Date().toISOString(),
      completedAt: t.completedAt || null, order: Number.isFinite(t.order) ? t.order : i,
      activity: Array.isArray(t.activity) ? t.activity.slice(-30) : []
    }));
    const seen = new Set(); const unique = tasks.filter(t => seen.has(t.id) ? false : (seen.add(t.id), true));
    return { version: 1, theme: data.theme, prefs: data.prefs, projects, tasks: unique, savedViews: Array.isArray(d.savedViews) ? d.savedViews : [] };
  }
  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = normalizeImport(JSON.parse(reader.result));
        openModal('confirm', {
          title: 'Импортировать данные?',
          text: `В файле ${incoming.tasks.length} задач и ${incoming.projects.length} проектов. Текущие данные будут заменены (с возможностью отмены).`,
          okLabel: 'Импортировать',
          onOk: () => { pushUndo('import'); data = incoming; ui.selected.clear(); ui.section = 'all'; ui.projectId = null; ui.savedViewId = null; save(); renderAll(); toast('Данные импортированы', 'success', { label: 'Отменить', fn: undo }); }
        });
      } catch (e) { toast('Не удалось импортировать: ' + e.message, 'error'); }
    };
    reader.readAsText(file);
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const stop = e.target.closest('[data-stop]');
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) { if (!e.target.closest('.filter-pop') && !e.target.closest('[data-action="filter-toggle"]')) { if (ui.filterOpen) { ui.filterOpen = false; renderToolbar(); } } if (!e.target.closest('.context-menu')) closeContext(); return; }
    if (stop && !actionEl.closest('[data-stop]')) return;
    const a = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (a !== 'task-menu') closeContext();
    if (a === 'nav') { ui.section = actionEl.dataset.section; ui.projectId = null; ui.savedViewId = null; ui.selected.clear(); ui.sidebarOpen = false; renderAll(); }
    else if (a === 'project') { ui.section = 'project'; ui.projectId = id; ui.savedViewId = null; ui.selected.clear(); ui.sidebarOpen = false; renderAll(); }
    else if (a === 'project-edit') { e.stopPropagation(); openModal('project', { id }); }
    else if (a === 'project-new') openModal('project');
    else if (a === 'project-color') { ui.modal.color = actionEl.dataset.color; $$('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === ui.modal.color)); }
    else if (a === 'project-save') {
      const name = $('#projectName').value.trim();
      if (!name) { toast('Введите название проекта', 'error'); return; }
      if (ui.modal.id) { const p = projectById(ui.modal.id); p.name = name; p.color = ui.modal.color; }
      else data.projects.push({ id: uid(), name, color: ui.modal.color });
      save(); closeModal(); renderAll(); toast('Проект сохранён', 'success');
    }
    else if (a === 'project-delete') {
      const pid = id;
      openModal('confirm', { title: 'Удалить проект?', text: 'Задачи останутся и будут перемещены в «Без проекта».', okLabel: 'Удалить проект', onOk: () => {
        pushUndo('project'); data.projects = data.projects.filter(p => p.id !== pid); data.tasks.forEach(t => { if (t.projectId === pid) t.projectId = ''; });
        if (ui.projectId === pid) { ui.section = 'all'; ui.projectId = null; }
        save(); renderAll(); toast('Проект удалён', 'info', { label: 'Отменить', fn: undo });
      }});
    }
    else if (a === 'saved-view') {
      const v = data.savedViews.find(x => x.id === id); if (!v) return;
      Object.assign(ui, clone(v.state)); ui.savedViewId = id; ui.selected = new Set(); ui.sidebarOpen = false; ui.drawer = null; ui.modal = null; renderAll();
    }
    else if (a === 'saved-view-delete') { e.stopPropagation(); pushUndo('view'); data.savedViews = data.savedViews.filter(v => v.id !== id); if (ui.savedViewId === id) ui.savedViewId = null; save(); renderAll(); toast('Вид удалён', 'info', { label: 'Отменить', fn: undo }); }
    else if (a === 'save-view') openModal('save-view');
    else if (a === 'saved-view-save') {
      const name = $('#viewName').value.trim(); if (!name) { toast('Введите название вида', 'error'); return; }
      const state = { view: ui.view, section: ui.section, projectId: ui.projectId, search: ui.search, filters: clone(ui.filters), sort: ui.sort, calMonth: ui.calMonth };
      data.savedViews.push({ id: uid(), name, state }); save(); closeModal(); renderAll(); toast('Вид сохранён', 'success');
    }
    else if (a === 'view') { ui.view = actionEl.dataset.view; ui.selected.clear(); save(); renderAll(); }
    else if (a === 'sort') { ui.sort = actionEl.dataset.sort; renderAll(); }
    else if (a === 'filter-toggle') { ui.filterOpen = !ui.filterOpen; renderToolbar(); }
    else if (a === 'filter-reset') { ui.filters = { priority: 'all', due: 'all', tag: 'all' }; ui.search = ''; ui.filterOpen = false; renderAll(); }
    else if (a === 'chip-remove') { const k = actionEl.dataset.key; if (k === 'search') ui.search = ''; else ui.filters[k] = 'all'; renderAll(); }
    else if (a === 'new-task') { closeModal(); openDrawer(null, { status: actionEl.dataset.status, date: actionEl.dataset.date, projectId: ui.section === 'project' ? ui.projectId : undefined }); }
    else if (a === 'open-task') { if (ui.modal?.type === 'day') closeModal(); openDrawer(id); }
    else if (a === 'toggle-done') { e.stopPropagation(); toggleDone(id); }
    else if (a === 'select-task') { e.stopPropagation(); ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id); renderView(); renderBulk(); }
    else if (a === 'select-all') { const list = filteredTasks(); const all = list.every(t => ui.selected.has(t.id)); list.forEach(t => all ? ui.selected.delete(t.id) : ui.selected.add(t.id)); renderView(); renderBulk(); }
    else if (a === 'task-menu') { e.stopPropagation(); const r = actionEl.getBoundingClientRect(); openContext(id, r.right - 180, r.bottom + 6); }
    else if (a === 'duplicate-task') duplicateTask(id);
    else if (a === 'move-task') moveTask(id, actionEl.dataset.status);
    else if (a === 'delete-task') { closeContext(); openModal('confirm', { title: 'Удалить задачу?', text: `«${taskById(id)?.title}» будет удалена. Действие можно отменить.`, onOk: () => deleteTasks([id]) }); }
    else if (a === 'drawer-close') closeDrawer();
    else if (a === 'drawer-save') saveDrawer();
    else if (a === 'drawer-delete') { const did = ui.drawer.draft.id; closeDrawer(); openModal('confirm', { title: 'Удалить задачу?', text: 'Задача будет удалена. Действие можно отменить.', onOk: () => deleteTasks([did]) }); }
    else if (a === 'drawer-duplicate') { const did = ui.drawer.draft.id; closeDrawer(); duplicateTask(did); }
    else if (a === 'subtask-toggle') { const s = ui.drawer.draft.subtasks.find(x => x.id === actionEl.dataset.id); if (s) { s.done = !s.done; renderDrawer(); } }
    else if (a === 'subtask-delete') { ui.drawer.draft.subtasks = ui.drawer.draft.subtasks.filter(x => x.id !== actionEl.dataset.id); renderDrawer(); }
    else if (a === 'subtask-add') { const inp = $('#subtaskInput'); const v = inp.value.trim(); if (!v) return; ui.drawer.draft.subtasks.push({ id: uid(), title: v, done: false }); renderDrawer(); setTimeout(() => $('#subtaskInput')?.focus(), 0); }
    else if (a === 'tag-remove') { ui.drawer.draft.tags = ui.drawer.draft.tags.filter(t => t !== actionEl.dataset.tag); renderDrawer(); }
    else if (a === 'comment-add') { const inp = $('#commentInput'); const v = inp.value.trim(); if (!v) return; ui.drawer.draft.comments.push({ id: uid(), text: v, at: new Date().toISOString() }); renderDrawer(); setTimeout(() => $('#commentInput')?.focus(), 0); }
    else if (a === 'bulk-delete') { const ids = [...ui.selected]; openModal('confirm', { title: `Удалить ${ids.length} задач?`, text: 'Выбранные задачи будут удалены. Действие можно отменить.', onOk: () => deleteTasks(ids) }); }
    else if (a === 'bulk-clear') { ui.selected.clear(); renderView(); renderBulk(); }
    else if (a === 'cal-prev') { const [y, m] = ui.calMonth.split('-').map(Number); const d = new Date(y, m - 2, 1); ui.calMonth = dateStr(d).slice(0, 7); renderView(); }
    else if (a === 'cal-next') { const [y, m] = ui.calMonth.split('-').map(Number); const d = new Date(y, m, 1); ui.calMonth = dateStr(d).slice(0, 7); renderView(); }
    else if (a === 'cal-today') { ui.calMonth = today().slice(0, 7); renderView(); }
    else if (a === 'day-modal') openModal('day', { date: actionEl.dataset.date });
    else if (a === 'theme-toggle') { data.theme = data.theme === 'dark' ? 'light' : 'dark'; save(); renderAll(); }
    else if (a === 'export-json') exportJSON();
    else if (a === 'import') $('#importFile').click();
    else if (a === 'help') openModal('help');
    else if (a === 'modal-close') { if (stop && actionEl.classList.contains('modal-scrim') && e.target !== actionEl) return; closeModal(); }
    else if (a === 'confirm-ok') { const fn = ui.modal.onOk; closeModal(); fn?.(); }
    else if (a === 'open-sidebar') { ui.sidebarOpen = true; renderAll(); }
    else if (a === 'close-sidebar') { ui.sidebarOpen = false; renderAll(); }
    else if (a === 'clear-search') { ui.search = ''; renderAll(); $('#globalSearch').focus(); }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'globalSearch') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.search = t.value; ui.savedViewId = null; renderAll(); }, 140); }
    if (t.dataset.draft && ui.drawer) {
      const k = t.dataset.draft;
      ui.drawer.draft[k] = k === 'estimate' ? Number(t.value) : t.value;
    }
    if (t.id === 'tagInput' && ui.drawer) ui.drawer.tagInput = t.value;
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.filter) { ui.filters[t.dataset.filter] = t.value; ui.savedViewId = null; renderAll(); }
    if (t.id === 'sortSelect') { ui.sort = t.value; renderAll(); }
    if (t.id === 'bulkStatus') applyBulk('status', t.value);
    if (t.id === 'bulkPriority') applyBulk('priority', t.value);
    if (t.id === 'importFile' && t.files?.[0]) { handleImportFile(t.files[0]); t.value = ''; }
    if (t.dataset.draft && ui.drawer) ui.drawer.draft[t.dataset.draft] = t.value;
  });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape') {
      if (ui.context) closeContext();
      else if (ui.modal) closeModal();
      else if (ui.drawer) closeDrawer();
      else if (ui.filterOpen) { ui.filterOpen = false; renderToolbar(); }
      else if (ui.sidebarOpen) { ui.sidebarOpen = false; renderAll(); }
      return;
    }
    if (e.key === 'Enter' && !typing) {
      const el = e.target.closest('[data-action="open-task"], [data-action="project"], [data-action="saved-view"]');
      if (el) { e.preventDefault(); el.click(); return; }
    }
    if (e.key === 'Enter' && e.target.id === 'subtaskInput') { e.preventDefault(); $('[data-action="subtask-add"]')?.click(); }
    if (e.key === 'Enter' && e.target.id === 'commentInput') { e.preventDefault(); $('[data-action="comment-add"]')?.click(); }
    if (e.key === 'Enter' && e.target.id === 'tagInput') {
      e.preventDefault();
      const v = e.target.value.trim().replace(/^#/, '').toLowerCase();
      if (v && !ui.drawer.draft.tags.includes(v)) { ui.drawer.draft.tags.push(v.slice(0, 24)); ui.drawer.tagInput = ''; renderDrawer(); setTimeout(() => $('#tagInput')?.focus(), 0); }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#globalSearch').focus(); }
    if (!typing && !ui.modal && !ui.drawer) {
      if (e.key === '/') { e.preventDefault(); $('#globalSearch').focus(); }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); openDrawer(null, { status: 'todo', projectId: ui.section === 'project' ? ui.projectId : undefined }); }
      if (e.key === '1') { ui.view = 'board'; save(); renderAll(); }
      if (e.key === '2') { ui.view = 'list'; save(); renderAll(); }
      if (e.key === '3') { ui.view = 'calendar'; save(); renderAll(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    }
    if (e.key === 'Tab' && (ui.drawer || ui.modal)) trapFocus(e);
  });

  function trapFocus(e) {
    const root = ui.modal ? $('.modal') : $('.drawer');
    if (!root) return;
    const focusables = $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', root).filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* drag & drop */
  let dragId = null, pendingDragId = null;
  document.addEventListener('mousedown', e => {
    const card = e.target.closest('.task-card, .list-row[draggable="true"], .cal-task');
    pendingDragId = card?.dataset.id || null;
  });
  function autoScroll(e) {
    const sc = $('.content');
    if (sc) { const r = sc.getBoundingClientRect(); if (e.clientY < r.top + 70) sc.scrollTop -= 14; else if (e.clientY > r.bottom - 70) sc.scrollTop += 14; }
    const board = $('.board');
    if (board) { const r = board.getBoundingClientRect(); if (e.clientX < r.left + 60) board.scrollLeft -= 14; else if (e.clientX > r.right - 60) board.scrollLeft += 14; }
  }
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.task-card, .list-row[draggable="true"], .cal-task');
    if (!card) return;
    dragId = pendingDragId || card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('dragging');
    closeContext();
  });
  document.addEventListener('dragend', e => {
    $$('.dragging').forEach(el => el.classList.remove('dragging'));
    $$('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dragId = null; pendingDragId = null;
  });
  document.addEventListener('dragover', e => {
    const col = e.target.closest('.column');
    const day = e.target.closest('.cal-day');
    const row = e.target.closest('.list-row[draggable="true"]');
    if (col || day || row) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; autoScroll(e); }
    $$('.drag-over').forEach(el => el.classList.remove('drag-over'));
    (col || day || row)?.classList.add('drag-over');
  });
  document.addEventListener('drop', e => {
    const col = e.target.closest('.column');
    const day = e.target.closest('.cal-day');
    const row = e.target.closest('.list-row[draggable="true"]');
    if (!col && !day && !row) return;
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData('text/plain');
    if (!id) return;
    if (col) {
      const cards = $$('.task-card', col).filter(c => c.dataset.id !== id);
      const before = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      reorder(id, col.dataset.status, before?.dataset.id);
    } else if (day) {
      const t = taskById(id); if (!t) return;
      const old = t.due; t.due = day.dataset.date; t.updatedAt = new Date().toISOString();
      t.activity = [...(t.activity || []), { id: uid(), text: `Срок: ${fmtDay(t.due)}`, at: t.updatedAt }].slice(-30);
      save(); renderAll(); toast('Срок обновлён', 'success', { label: 'Отменить', fn: () => { const x = taskById(id); if (x) { x.due = old; save(); renderAll(); } } });
    } else if (row) {
      const list = filteredTasks();
      const from = list.findIndex(t => t.id === id);
      const to = list.findIndex(t => t.id === row.dataset.id);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      list.forEach((t, i) => t.order = i);
      save(); renderAll();
    }
    dragId = null; pendingDragId = null;
  });

  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try { const d = JSON.parse(e.newValue); if (d?.tasks && d?.projects) { data = d; ui.selected.clear(); renderAll(); } } catch {}
  });
  window.addEventListener('resize', closeContext);

  renderAll();
  save();
})();
