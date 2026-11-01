/* OrgFlow — application controller (UI, interactions, panel, modals) */
(function () {
  const OG = window.OG;
  const S = OG.Store;
  const esc = OG.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const state = {
    selectedId: null,
    view: { x: 0, y: 0, k: 1 },
    query: '',
    matchSet: new Set(),
    matchList: [],
    matchIdx: -1,
    legendFilter: null,
    panelTab: 'node',
    editing: false,
    iconGridOpen: false,
    lastLayout: null,
  };

  const els = {};

  /* ======================= helpers ======================= */
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  function hydrateIcons(root) {
    $$('[data-icon]', root).forEach((el) => {
      if (el.dataset.iconDone) return;
      el.insertAdjacentHTML('afterbegin', OG.icon(el.dataset.icon, el.classList.contains('brand-logo') ? 18 : 17));
      el.dataset.iconDone = '1';
    });
  }

  function toast(msg, opts) {
    opts = opts || {};
    const t = document.createElement('div');
    t.className = 'toast' + (opts.error ? ' err' : '');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (opts.action) {
      const b = document.createElement('button');
      b.textContent = opts.action.label;
      b.onclick = () => {
        opts.action.run();
        t.remove();
      };
      t.appendChild(b);
    }
    els.toasts.appendChild(t);
    setTimeout(() => t.remove(), opts.duration || 3200);
  }

  /* ======================= modal ======================= */
  function modal({ title, body, actions, size, onOpen, onClose }) {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal ${size || ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close title="Fechar">${OG.icon('x', 18)}</button></div>
      <div class="modal-body">${body || ''}</div>
      ${actions && actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;
    const m = bd.querySelector('.modal');
    const foot = bd.querySelector('.modal-foot');
    const close = () => {
      bd.remove();
      document.removeEventListener('keydown', onKey, true);
      onClose && onClose();
    };
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.innerHTML = (a.icon ? OG.icon(a.icon, 16) : '') + esc(a.label);
      b.onclick = () => a.onClick && a.onClick(close, m) !== false && a.autoClose !== false && close();
      if (a.left) {
        let l = foot.querySelector('.left');
        if (!l) {
          l = document.createElement('div');
          l.className = 'left';
          foot.prepend(l);
        }
        l.appendChild(b);
      } else foot.appendChild(b);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') {
        const prim = foot && foot.querySelector('.btn.primary');
        if (prim) {
          e.preventDefault();
          prim.click();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    bd.addEventListener('mousedown', (e) => e.target === bd && close());
    bd.querySelector('[data-close]').onclick = close;
    els.modalRoot.appendChild(bd);
    onOpen && onOpen(m, close);
    return { el: m, close };
  }

  function promptModal(title, label, value) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title,
        body: `<div class="field"><label>${esc(label)}</label><input type="text" id="pm-input" value="${esc(value || '')}"></div>`,
        actions: [
          { label: 'Cancelar', onClick: () => {} },
          {
            label: 'Confirmar',
            primary: true,
            onClick: (c, m) => {
              done = true;
              resolve($('#pm-input', m).value.trim() || null);
            },
          },
        ],
        onOpen: (m) => setTimeout(() => $('#pm-input', m).select(), 30),
        onClose: () => !done && resolve(null),
      });
    });
  }

  function confirmModal(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let done = false;
      modal({
        title,
        body: `<p>${text}</p>`,
        actions: [
          { label: 'Cancelar', onClick: () => {} },
          {
            label: okLabel || 'Confirmar',
            primary: !danger,
            danger: !!danger,
            onClick: () => {
              done = true;
              resolve(true);
            },
          },
        ],
        onClose: () => !done && resolve(false),
      });
    });
  }

  /* ======================= menus ======================= */
  let openMenu = null;
  function toggleMenu(btn, id) {
    const menu = document.getElementById(id);
    if (openMenu && openMenu !== menu) openMenu.hidden = true;
    if (!menu.hidden) {
      menu.hidden = true;
      openMenu = null;
      return;
    }
    syncMenus();
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    let left = Math.min(r.left, window.innerWidth - mw - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = r.bottom + 6 + 'px';
    openMenu = menu;
  }
  function closeMenus() {
    if (openMenu) openMenu.hidden = true;
    openMenu = null;
  }
  function syncMenus() {
    const ui = S.ui;
    $$('#style-grid button').forEach((b) => b.classList.toggle('active', b.dataset.style === ui.cardStyle));
    $$('#color-seg button').forEach((b) => b.classList.toggle('active', b.dataset.color === ui.colorBy));
    $$('#view-menu [data-ui]').forEach((c) => (c.checked = ui[c.dataset.ui] !== false));
    const del = $('[data-cmd="version-delete"]');
    if (del) del.disabled = S.project.versions.length <= 1;
  }

  /* ======================= view (pan / zoom) ======================= */
  function applyView() {
    const v = state.view;
    els.viewport.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    els.zoomLabel.textContent = Math.round(v.k * 100) + '%';
  }
  function zoomAt(factor, cx, cy) {
    const v = state.view;
    const k = Math.min(2.5, Math.max(0.1, v.k * factor));
    const r = els.canvas.getBoundingClientRect();
    if (cx == null) {
      cx = r.width / 2;
      cy = r.height / 2;
    }
    v.x = cx - ((cx - v.x) * k) / v.k;
    v.y = cy - ((cy - v.y) * k) / v.k;
    v.k = k;
    applyView();
  }
  function fit() {
    const L = state.lastLayout;
    if (!L) return;
    const r = els.canvas.getBoundingClientRect();
    const k = Math.min(1.1, Math.max(0.1, Math.min((r.width - 40) / L.width, (r.height - 90) / L.height)));
    state.view.k = k;
    state.view.x = (r.width - L.width * k) / 2;
    state.view.y = Math.max(20, (r.height - L.height * k) / 2 - 10);
    els.viewport.style.transition = 'transform .4s cubic-bezier(.22,1,.36,1)';
    applyView();
    setTimeout(() => (els.viewport.style.transition = ''), 420);
  }
  function ensureVisible(id) {
    const card = els.chart.querySelector(`.og-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const cr = card.getBoundingClientRect();
    const r = els.canvas.getBoundingClientRect();
    const m = 60;
    let dx = 0,
      dy = 0;
    if (cr.left < r.left + m) dx = r.left + m - cr.left;
    else if (cr.right > r.right - m) dx = r.right - m - cr.right;
    if (cr.top < r.top + m) dy = r.top + m - cr.top;
    else if (cr.bottom > r.bottom - 70) dy = r.bottom - 70 - cr.bottom;
    if (dx || dy) {
      state.view.x += dx;
      state.view.y += dy;
      els.viewport.style.transition = 'transform .25s ease';
      applyView();
      setTimeout(() => (els.viewport.style.transition = ''), 260);
    }
  }
  function centerOn(id) {
    const L = state.lastLayout;
    if (!L || !L.pos[id]) return;
    const p = L.pos[id];
    const r = els.canvas.getBoundingClientRect();
    const v = state.view;
    v.x = r.width / 2 - (p.x + p.w / 2) * v.k;
    v.y = r.height / 2 - (p.y + p.h / 2) * v.k;
    els.viewport.style.transition = 'transform .3s ease';
    applyView();
    setTimeout(() => (els.viewport.style.transition = ''), 320);
  }

  /* ======================= rendering ======================= */
  function renderChart() {
    const ui = S.ui;
    const matchSet = state.matchSet.size ? state.matchSet : legendMatches();
    queueAnimation();
    const diff = diffInfo();
    state.diffSummary = diff && diff.summary;
    const res = OG.Chart.render(els.chart, diff ? diff.nodes : S.nodes, {
      ...ui,
      diff: diff && diff.map,
      interactive: true,
      selectedId: state.selectedId,
      matchIds: matchSet,
    });
    state.lastLayout = res.layout;
    els.chart.className = 'chart ' + (ui.layout === 'horizontal' || ui.layout === 'lista' ? 'axis-y' : 'axis-x');
    els.empty.hidden = S.nodes.length > 0;
    renderLegend();
  }

  /* Change animations: several renders in one tick count as one change, so the
     "before" state is captured once and the motion plays on the final DOM. */
  const MOTION = { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' };
  const calmMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate;

  function queueAnimation() {
    if (state.pendingAnim || !state.lastLayout || calmMotion()) return;
    const oldCards = {};
    $$('.og-card', els.chart).forEach((c) => (oldCards[c.dataset.id] = c));
    state.pendingAnim = { prev: state.lastLayout.pos, oldCards };
    Promise.resolve().then(playAnimation); // after the current handler, before the next paint
  }

  function playAnimation() {
    const { prev, oldCards } = state.pendingAnim;
    state.pendingAnim = null;
    if (state.editing) return; // typing must not make the chart swim
    const pos = state.lastLayout.pos;
    const world = $('.og-world', els.chart);
    if (!world) return;
    const parentOf = (id) => {
      const n = S.get(id);
      return n && n.parentId;
    };
    let changed = false;
    $$('.og-card', world).forEach((c) => {
      const id = c.dataset.id;
      const now = pos[id];
      const was = prev[id];
      if (was) {
        const dx = was.x - now.x;
        const dy = was.y - now.y;
        if (dx || dy) {
          changed = true;
          c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], MOTION);
        }
        if (was.h !== now.h) changed = true;
        return;
      }
      // new card: grows out of its leader when the leader was already there
      changed = true;
      const from = prev[parentOf(id)];
      const start = from ? `translate(${from.x - now.x}px, ${from.y - now.y}px) scale(.8)` : 'scale(.8)';
      c.animate([{ opacity: 0, transform: start }, { transform: 'none' }], MOTION);
    });
    Object.keys(oldCards).forEach((id) => {
      if (pos[id]) return;
      changed = true;
      const c = oldCards[id];
      const was = prev[id];
      const to = pos[(was && parentOf(id)) || ''];
      c.classList.remove('selected');
      c.style.pointerEvents = 'none';
      world.appendChild(c);
      c.animate([{ transform: 'none' }, { opacity: 0, transform: to && was ? `translate(${to.x - was.x}px, ${to.y - was.y}px) scale(.8)` : 'scale(.8)' }], { ...MOTION, duration: 280 });
      setTimeout(() => c.remove(), 300); // a timer, because hidden tabs never finish animations
    });
    if (changed) {
      // connectors are redrawn at their final place, so they appear as the cards land
      $$('.og-edges, .og-co-tag, .og-toggle', world).forEach((el) => el.animate([{ opacity: 0 }, {}], { duration: 260, delay: 200, fill: 'backwards' }));
    }
  }

  /* Atual / Futuro: a future version remembers the version it came from */
  function scenario() {
    const cur = S.version;
    const vs = S.project.versions;
    const base = cur.baseVersionId ? vs.find((v) => v.id === cur.baseVersionId) : null;
    if (base) return { base, future: cur };
    return { base: cur, future: vs.find((v) => v.baseVersionId === cur.id) || null };
  }

  function diffInfo() {
    const { base, future } = scenario();
    if (!S.ui.showDiff || !future || future !== S.version || !OG.Analytics) return null;
    const d = OG.Analytics.compare(base.nodes, future.nodes, S.levels);
    const map = {};
    d.changed.forEach((c) => (map[c.node.id] = 'changed'));
    d.moved.forEach((m) => (map[m.node.id] = 'moved'));
    d.added.forEach((n) => (map[n.id] = 'added'));
    d.removed.forEach((n) => (map[n.id] = 'removed'));
    const known = new Set([...future.nodes, ...d.removed].map((n) => n.id));
    const ghosts = d.removed.map((n) => ({ ...n, collapsed: false, coLinks: [], parentId: known.has(n.parentId) ? n.parentId : null }));
    return { nodes: [...future.nodes, ...ghosts], map, summary: d.summary };
  }

  function legendMatches() {
    const f = state.legendFilter;
    if (!f) return new Set();
    return new Set(S.nodes.filter((n) => (f.type === 'level' ? n.level === f.value : (n.dept || '') === f.value)).map((n) => n.id));
  }

  function renderLegend() {
    const ui = S.ui;
    let html = '';
    if (ui.colorBy === 'level') {
      const used = new Set(S.nodes.map((n) => n.level));
      html = '<div class="legend-title">Níveis</div>' + S.levels.filter((l) => used.has(l.id)).map((l) => `<span class="legend-item ${state.legendFilter && state.legendFilter.value === l.id ? 'active' : ''}" data-type="level" data-value="${l.id}"><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join('');
    } else if (ui.colorBy === 'dept') {
      const depts = [...new Set(S.nodes.map((n) => n.dept || ''))];
      html = '<div class="legend-title">Departamentos</div>' + depts.map((d) => `<span class="legend-item ${state.legendFilter && state.legendFilter.value === d ? 'active' : ''}" data-type="dept" data-value="${esc(d)}"><i style="background:${S.deptColor(d)}"></i>${esc(d || 'Sem departamento')}</span>`).join('');
    }
    const ds = state.diffSummary;
    if (ds) html += `<div class="legend-title">Atual → Futuro</div><span class="legend-diff added">${ds.added} novas</span><span class="legend-diff removed">${ds.removed} removidas</span><span class="legend-diff changed">${ds.changed} alteradas</span><span class="legend-diff moved">${ds.moved} movidas</span>`;
    if (S.nodes.some((n) => (n.coLinks || []).length)) html += '<span class="legend-co"><i></i>Coparticipação</span>';
    els.legend.innerHTML = S.nodes.length ? html : '';
  }

  function renderStats() {
    const nodes = S.nodes;
    const total = nodes.length;
    const vac = nodes.filter((n) => n.vacant).length;
    const leaders = nodes.filter((n) => S.children(n.id).length).length;
    let depth = 0;
    nodes.forEach((n) => (depth = Math.max(depth, S.depth(n.id) + 1)));
    const depts = new Set(nodes.map((n) => n.dept).filter(Boolean)).size;
    els.stats.innerHTML = `<span><b>${total}</b> posições</span><span><b>${total - vac}</b> ocupadas</span><span><b>${vac}</b> vagas</span><span><b>${leaders}</b> lideranças</span><span><b>${depth}</b> níveis</span><span><b>${depts}</b> áreas</span>`;
  }

  function renderToolbar() {
    const ui = S.ui;
    els.projectName.value = S.project.name;
    document.title = S.project.name + ' — OrgFlow';
    els.versionSelect.innerHTML = S.project.versions.map((v) => `<option value="${v.id}" ${v.id === S.version.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    $$('#layout-seg button').forEach((b) => b.classList.toggle('active', b.dataset.layout === ui.layout));
    const sc = scenario();
    const inFuture = !!sc.future && sc.future === S.version;
    $$('#time-seg button').forEach((b) => b.classList.toggle('active', (b.dataset.time === 'future') === inFuture));
    const dt = $('#diff-toggle');
    dt.checked = ui.showDiff !== false;
    dt.disabled = !inFuture;
    dt.closest('label').classList.toggle('off', !inFuture);
    els.undo.disabled = !S.canUndo();
    els.redo.disabled = !S.canRedo();
    document.documentElement.dataset.theme = ui.theme;
    els.themeBtn.innerHTML = OG.icon(ui.theme === 'dark' ? 'sun' : 'moon', 17);
    els.panel.classList.toggle('closed', ui.panelOpen === false);
    syncMenus();
  }

  function renderAll() {
    renderToolbar();
    renderChart();
    renderPanel();
    renderStats();
  }

  /* ======================= selection ======================= */
  function select(id, opts) {
    opts = opts || {};
    if (id && !S.get(id)) id = null;
    const changed = state.selectedId !== id;
    state.selectedId = id;
    state.iconGridOpen = false;
    if (id) state.panelTab = 'node';
    if (id && S.ui.panelOpen === false && opts.openPanel) S.setUI({ panelOpen: true });
    // expand collapsed ancestors so the node is visible
    if (id) {
      const anc = S.ancestors(id).filter((a) => a.collapsed);
      if (anc.length) {
        anc.forEach((a) => (a.collapsed = false));
        S.changed('view');
      }
    }
    if (changed || opts.force) {
      renderChart();
      renderPanel();
    }
    if (id && opts.reveal !== false) requestAnimationFrame(() => ensureVisible(id));
    if (id && opts.focus) {
      requestAnimationFrame(() => {
        const f = $('#f-role');
        if (f) {
          f.focus();
          f.select();
        }
      });
    }
  }

  /* ======================= node actions ======================= */
  function addChild(parentId) {
    const n = S.addChild(parentId);
    select(n.id, { focus: true, openPanel: true });
    return n;
  }
  function addSibling(id) {
    const n = S.addSibling(id);
    select(n.id, { focus: true, openPanel: true });
    return n;
  }
  async function removeNode(id) {
    const n = S.get(id);
    if (!n) return;
    const kids = S.children(id).length;
    const desc = S.descendants(id).length;
    if (desc > 0) {
      let choice = null;
      await new Promise((resolve) => {
        modal({
          title: 'Excluir posição',
          body: `<p>A posição <b>${esc(n.role)}</b> possui <b>${kids}</b> subordinado(s) direto(s) e <b>${desc}</b> no total. O que deseja fazer?</p>`,
          actions: [
            { label: 'Cancelar', onClick: () => {} },
            { label: 'Excluir só a posição (subordinados sobem)', onClick: () => (choice = 'keep') },
            { label: 'Excluir com todo o ramo', danger: true, onClick: () => (choice = 'all') },
          ],
          onClose: resolve,
        });
      });
      if (!choice) return;
      S.remove(id, choice === 'keep');
    } else S.remove(id);
    const parent = n.parentId && S.get(n.parentId);
    select(parent ? parent.id : null);
    toast('Posição excluída', { action: { label: 'Desfazer', run: () => S.undo() } });
  }
  function duplicateNode(id) {
    const c = S.duplicate(id);
    if (c) {
      select(c.id);
      toast('Ramo duplicado');
    }
  }

  /* ======================= panel ======================= */
  function renderPanel() {
    if (state.editing) {
      S.endEdit();
      state.editing = false;
    }
    $$('.panel-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.panelTab));
    if (state.panelTab === 'structure') return renderStructurePanel();
    const n = state.selectedId && S.get(state.selectedId);
    if (!n) {
      els.panelBody.innerHTML = `<div class="panel-empty">${OG.icon('sitemap', 36)}
        <b>Nenhuma posição selecionada</b>
        <p>Clique em um cartão para editar a função, o ocupante, a foto, o ícone e a hierarquia.</p>
        <button class="btn primary block" data-pact="add-root">${OG.icon('plus', 16)}Adicionar posição no topo</button>
        <div class="p-section" style="text-align:left;margin-top:22px">
          <div class="p-section-title">${OG.icon('keyboard', 15)}Montagem rápida pelo teclado</div>
          ${shortcutsHTML()}
        </div></div>`;
      return;
    }
    const color = S.colorFor(n);
    const kids = S.children(n.id);
    const desc = S.descendants(n.id).length;
    const depth = S.depth(n.id) + 1;
    const lvl = S.levelOf(n);
    const parent = n.parentId ? S.get(n.parentId) : null;
    const forbidden = new Set([n.id, ...S.descendants(n.id).map((d) => d.id)]);
    const parentOpts = [];
    const walk = (pid, d) =>
      S.children(pid).forEach((c) => {
        if (forbidden.has(c.id)) return;
        parentOpts.push(`<option value="${c.id}" ${c.id === n.parentId ? 'selected' : ''}>${' '.repeat(d)}${esc(c.role)}${c.name ? ' — ' + esc(c.name) : ''}</option>`);
        walk(c.id, d + 1);
      });
    walk(null, 0);
    const roles = new Set();
    const depts = S.allDepts();
    S.project.versions.forEach((v) => v.nodes.forEach((x) => x.role && roles.add(x.role)));
    const autoIcon = S.iconFor({ ...n, icon: null });
    const curIcon = S.iconFor(n);

    const iconGrid = state.iconGridOpen
      ? `<div class="icon-grid">
          <div class="grp">Automático</div>
          <button data-icon-pick="" class="${!n.icon ? 'active' : ''}" title="Automático (pela função/área)">${OG.icon(autoIcon, 18)}</button>
          ${OG.ICON_GROUPS.map((g) => `<div class="grp">${esc(g.label)}</div>` + g.icons.map((ic) => `<button data-icon-pick="${ic}" class="${n.icon === ic ? 'active' : ''}" title="${ic}">${OG.icon(ic, 18)}</button>`).join('')).join('')}
        </div>`
      : '';

    const palette = ['#7c3aed', '#4f46e5', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#ea580c', '#dc2626', '#db2777', '#475569'];

    els.panelBody.innerHTML = `
      <div class="p-head">
        <button class="p-avatar" style="--c:${n.vacant ? '#cbd5e1' : color}" data-pact="photo" title="${n.photo ? 'Trocar foto' : 'Adicionar foto'} (ou arraste uma imagem sobre o cartão)">
          ${n.photo ? `<img src="${esc(n.photo)}" alt="">` : OG.icon(n.vacant ? 'userPlus' : curIcon, 30)}
          <span class="cam">${OG.icon('camera', 14)}</span>
        </button>
        <div class="p-head-txt">
          <div class="t" id="ph-role">${esc(n.role) || 'Sem função'}</div>
          <div class="s">${esc(lvl ? lvl.name : '')} · ${depth}º nível</div>
          <div class="links">${n.photo ? `<button data-pact="photo">Trocar foto</button><button class="danger" data-pact="photo-remove">Remover foto</button>` : `<button data-pact="photo">Adicionar foto</button>`}</div>
        </div>
      </div>

      <div class="field"><label for="f-role">Função / cargo</label>
        <input class="input" id="f-role" data-field="role" value="${esc(n.role)}" list="dl-roles" autocomplete="off" placeholder="Ex.: Gerente Financeiro"></div>
      <div class="field"><label for="f-name">Ocupante</label>
        <input class="input" id="f-name" data-field="name" value="${esc(n.name)}" autocomplete="off" placeholder="${n.vacant ? 'Vaga em aberto' : 'Nome do colaborador'}" ${n.vacant ? 'disabled' : ''}>
        <label class="check" style="margin-top:6px"><input type="checkbox" data-field="vacant" ${n.vacant ? 'checked' : ''}> Vaga em aberto (a contratar)</label></div>
      <div class="row">
        <div class="field"><label for="f-dept">Departamento</label>
          <input class="input" id="f-dept" data-field="dept" value="${esc(n.dept)}" list="dl-depts" autocomplete="off" placeholder="Ex.: Financeiro"></div>
        <div class="field"><label for="f-level">Nível</label>
          <select id="f-level" data-field="level">${S.levels.map((l) => `<option value="${l.id}" ${l.id === n.level ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="f-parent">Superior imediato</label>
        <select id="f-parent" data-field="parentId"><option value="">— Nenhum (topo da hierarquia) —</option>${parentOpts.join('')}</select></div>

      <div class="metrics">
        <div class="metric"><b>${kids.length}</b><span>diretos</span></div>
        <div class="metric"><b>${desc}</b><span>equipe total</span></div>
        <div class="metric"><b>${depth}º</b><span>nível hierárq.</span></div>
      </div>

      <div class="p-actions">
        <button class="btn small" data-pact="add-child" title="Tab">${OG.icon('plus', 15)}Subordinado</button>
        <button class="btn small" data-pact="add-sibling" title="Enter">${OG.icon('users', 15)}Par (mesmo nível)</button>
        <button class="btn small" data-pact="duplicate">${OG.icon('copy', 15)}Duplicar ramo</button>
        <button class="btn small danger" data-pact="delete" title="Delete">${OG.icon('trash', 15)}Excluir</button>
      </div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('users', 15)}Coparticipação com outras áreas</div>
        ${(n.coLinks || [])
          .map((l, i) => {
            const t = S.get(l.to);
            return t
              ? `<div class="co-row"><b>${esc(t.role)}${t.dept ? ' · ' + esc(t.dept) : ''}</b>
                  <button class="icon-btn" data-co-del="${i}" title="Remover coparticipação">${OG.icon('x', 14)}</button>
                  <input class="input" data-co-label="${i}" value="${esc(l.label)}" placeholder="Descrição (opcional)"></div>`
              : '';
          })
          .join('')}
        <select id="f-co-add" aria-label="Adicionar coparticipação"><option value="">+ Ligar com outra posição…</option>${S.nodes
          .filter((x) => x.id !== n.id && !(n.coLinks || []).some((l) => l.to === x.id))
          .map((x) => `<option value="${esc(x.id)}">${esc(x.role)}${x.dept ? ' — ' + esc(x.dept) : ''}</option>`)
          .join('')}</select>
      </div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('palette', 15)}Aparência</div>
        <div class="field"><span class="field-label">Ícone</span>
          <div class="icon-pick" style="--c:${color}">
            <span class="icon-current">${OG.icon(curIcon, 20)}</span>
            <button class="btn small" data-pact="icon-grid">${state.iconGridOpen ? 'Fechar ícones' : 'Escolher ícone'}</button>
            <span style="font-size:12px;color:var(--muted)">${n.icon ? 'Personalizado' : 'Automático'}</span>
          </div>
          ${iconGrid}
        </div>
        <div class="field"><span class="field-label">Cor do cartão</span>
          <div class="swatches">
            <button class="swatch none ${!n.color ? 'active' : ''}" data-color-pick="" title="Padrão (pelo nível/departamento)"></button>
            ${palette.map((c) => `<button class="swatch ${n.color === c ? 'active' : ''}" style="background:${c}" data-color-pick="${c}" title="${c}"></button>`).join('')}
            <label class="swatch-custom" title="Cor personalizada"><input type="color" data-field="color" value="${n.color || color}"></label>
          </div>
        </div>
      </div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('clipboard', 15)}Detalhes</div>
        <div class="row">
          <div class="field"><label for="f-email">E-mail</label><input class="input" id="f-email" data-field="email" value="${esc(n.email)}" placeholder="nome@empresa.com"></div>
          <div class="field"><label for="f-phone">Telefone</label><input class="input" id="f-phone" data-field="phone" value="${esc(n.phone)}" placeholder="(00) 00000-0000"></div>
        </div>
        <div class="field"><label for="f-notes">Responsabilidades / observações</label>
          <textarea id="f-notes" data-field="notes" rows="4" placeholder="Principais atribuições da função…">${esc(n.notes)}</textarea></div>
      </div>
      <datalist id="dl-roles">${[...roles].map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <datalist id="dl-depts">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
    `;
  }

  function shortcutsHTML() {
    return `<div class="kbd-list">
      <kbd>Tab</kbd><span>Novo subordinado da posição selecionada</span>
      <kbd>Enter</kbd><span>Nova posição no mesmo nível (par)</span>
      <kbd>F2</kbd><span>Editar a função selecionada</span>
      <kbd>Del</kbd><span>Excluir posição</span>
      <kbd>Ctrl+D</kbd><span>Duplicar ramo</span>
      <kbd>← ↑ → ↓</kbd><span>Navegar entre posições</span>
      <kbd>Espaço</kbd><span>Recolher / expandir equipe</span>
      <kbd>Ctrl+Z / Ctrl+Y</kbd><span>Desfazer / refazer</span>
      <kbd>Ctrl+F</kbd><span>Buscar</span>
      <kbd>+ / − / 0</kbd><span>Zoom e ajustar à tela</span>
      <kbd>Arrastar</kbd><span>Solte no centro de um cartão para subordinar, ou na lateral para posicionar como par</span>
    </div>`;
  }

  function renderStructurePanel() {
    const counts = {};
    S.nodes.forEach((n) => (counts[n.level] = (counts[n.level] || 0) + 1));
    const dcount = {};
    S.nodes.forEach((n) => n.dept && (dcount[n.dept] = (dcount[n.dept] || 0) + 1));
    const depts = S.allDepts().filter((d) => dcount[d]);
    els.panelBody.innerHTML = `
      <div class="p-section-title">${OG.icon('building', 15)}Projeto</div>
      <div class="field"><label>Nome da empresa / projeto</label><input class="input" data-proj="name" value="${esc(S.project.name)}"></div>
      <div class="field"><label>Elaborado por</label><input class="input" data-proj="author" value="${esc(S.project.author || '')}" placeholder="Seu nome / área"></div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('layers', 15)}Níveis hierárquicos</div>
        <p style="font-size:12px;color:var(--muted);margin:-4px 0 10px">Defina as camadas de liderança. A cor é usada quando o organograma é colorido por nível.</p>
        ${S.levels
          .map(
            (l, i) => `<div class="lv-row" data-level="${l.id}">
            <span class="num">${i + 1}</span>
            <input type="color" class="color" data-lv="color" value="${l.color}">
            <input class="input" data-lv="name" value="${esc(l.name)}">
            <span class="cnt" title="Posições neste nível">${counts[l.id] || 0}</span>
            <button class="icon-btn" data-lvact="up" title="Subir" ${i === 0 ? 'disabled' : ''}>${OG.icon('chevronUp', 15)}</button>
            <button class="icon-btn" data-lvact="down" title="Descer" ${i === S.levels.length - 1 ? 'disabled' : ''}>${OG.icon('chevronDown', 15)}</button>
            <button class="icon-btn" data-lvact="del" title="Remover" ${S.levels.length <= 1 ? 'disabled' : ''}>${OG.icon('trash', 15)}</button>
          </div>`
          )
          .join('')}
        <button class="btn small" data-lvact="add">${OG.icon('plus', 15)}Adicionar nível</button>
      </div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('briefcase', 15)}Departamentos / áreas</div>
        ${
          depts.length
            ? depts
                .map(
                  (d) => `<div class="lv-row" data-dept="${esc(d)}">
            <input type="color" class="color" data-dp="color" value="${S.deptColor(d)}">
            <input class="input" data-dp="name" value="${esc(d)}">
            <span class="cnt" title="Posições">${dcount[d]}</span>
            <button class="icon-btn" data-dpact="filter" title="Destacar no organograma">${OG.icon('eye', 15)}</button>
          </div>`
                )
                .join('')
            : '<p style="font-size:12px;color:var(--muted)">Nenhum departamento ainda. Informe o departamento ao editar uma posição.</p>'
        }
      </div>

      <div class="p-section">
        <div class="p-section-title">${OG.icon('keyboard', 15)}Atalhos</div>
        ${shortcutsHTML()}
      </div>`;
  }

  let panelPointerDown = false;
  function bindPanel() {
    const body = els.panelBody;
    body.addEventListener('pointerdown', () => (panelPointerDown = true));
    window.addEventListener('pointerup', () => setTimeout(() => (panelPointerDown = false), 0), true);
    body.addEventListener('focusin', (e) => {
      const t = e.target;
      if ((t.matches('input.input, textarea') && t.dataset.field) || t.dataset.lv === 'name' || t.dataset.proj) {
        state.editing = true;
        if (t.dataset.field) S.beginEdit();
      }
    });
    body.addEventListener('focusout', (e) => {
      const t = e.target;
      if (t.dataset.field && (t.matches('input.input') || t.tagName === 'TEXTAREA')) {
        S.endEdit();
        state.editing = false;
        renderToolbar();
        // refresh the header/role text without losing focus elsewhere
        // (skipped while the pointer is down inside the panel, so the pending click isn't lost)
        setTimeout(() => {
          if (panelPointerDown) return;
          if (!body.contains(document.activeElement) || !document.activeElement.matches('input,textarea,select')) renderPanel();
        }, 0);
      } else if (t.dataset.lv === 'name' || t.dataset.proj) {
        state.editing = false;
      }
    });
    body.addEventListener('input', (e) => {
      const t = e.target;
      const id = state.selectedId;
      if (t.dataset.field && (t.matches('input.input') || t.tagName === 'TEXTAREA') && id) {
        state.editing = true;
        S.liveUpdate(id, { [t.dataset.field]: t.value });
        if (t.dataset.field === 'role') {
          const h = $('#ph-role');
          if (h) h.textContent = t.value || 'Sem função';
        }
      } else if (t.dataset.lv === 'name') {
        const l = S.levels.find((x) => x.id === t.closest('[data-level]').dataset.level);
        l.name = t.value;
        S.changed('levels');
      } else if (t.dataset.lv === 'color') {
        const l = S.levels.find((x) => x.id === t.closest('[data-level]').dataset.level);
        l.color = t.value;
        state.editing = true;
        S.changed('levels');
        state.editing = false;
      } else if (t.dataset.dp === 'color') {
        state.editing = true;
        S.setDeptColor(t.closest('[data-dept]').dataset.dept, t.value);
        state.editing = false;
      } else if (t.dataset.proj === 'name') {
        S.setProjectName(t.value);
        els.projectName.value = S.project.name;
      } else if (t.dataset.proj === 'author') {
        S.project.author = t.value;
        S.scheduleSave();
      }
    });
    body.addEventListener('change', (e) => {
      const t = e.target;
      const id = state.selectedId;
      if (t.dataset.field === 'vacant' && id) {
        S.update(id, { vacant: t.checked });
        renderPanel();
      } else if (t.dataset.field === 'level' && id) {
        S.update(id, { level: t.value });
        renderPanel();
      } else if (t.dataset.field === 'parentId' && id) {
        if (!S.move(id, t.value || null)) toast('Não é possível mover para essa posição', { error: true });
        renderPanel();
        requestAnimationFrame(() => ensureVisible(id));
      } else if (t.dataset.field === 'color' && t.type === 'color' && id) {
        S.update(id, { color: t.value });
        renderPanel();
      } else if (t.id === 'f-co-add' && t.value && id) {
        S.update(id, { coLinks: [...(S.get(id).coLinks || []), { to: t.value, label: '' }] });
        renderPanel();
      } else if (t.dataset.coLabel !== undefined && id) {
        S.update(id, { coLinks: S.get(id).coLinks.map((l, i) => (i === +t.dataset.coLabel ? { ...l, label: t.value } : l)) });
      } else if (t.dataset.dp === 'name') {
        const old = t.closest('[data-dept]').dataset.dept;
        S.renameDept(old, t.value.trim());
        renderPanel();
      }
    });
    body.addEventListener('keydown', (e) => {
      const t = e.target;
      if (e.key === 'Enter' && t.id === 'f-role') {
        e.preventDefault();
        const nm = $('#f-name');
        if (nm && !nm.disabled) {
          nm.focus();
          nm.select();
        } else {
          t.blur();
          els.canvas.focus();
        }
      } else if (e.key === 'Enter' && (t.id === 'f-name' || t.id === 'f-dept' || t.id === 'f-email' || t.id === 'f-phone')) {
        e.preventDefault();
        t.blur();
        els.canvas.focus();
      } else if (e.key === 'Escape' && t.matches('input,textarea,select')) {
        t.blur();
        els.canvas.focus();
      } else if (e.key === 'Tab' && t.id === 'f-name' && !e.shiftKey && e.ctrlKey) {
        // Ctrl+Tab from name: quickly add a subordinate
        e.preventDefault();
        t.blur();
        addChild(state.selectedId);
      }
    });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact],[data-icon-pick],[data-color-pick],[data-lvact],[data-dpact],[data-co-del]');
      if (!b) return;
      const id = state.selectedId;
      if (b.dataset.coDel !== undefined) {
        S.update(id, { coLinks: S.get(id).coLinks.filter((l, i) => i !== +b.dataset.coDel) });
        renderPanel();
        return;
      }
      if (b.dataset.iconPick !== undefined) {
        S.update(id, { icon: b.dataset.iconPick || null });
        renderPanel();
        return;
      }
      if (b.dataset.colorPick !== undefined) {
        S.update(id, { color: b.dataset.colorPick || null });
        renderPanel();
        return;
      }
      if (b.dataset.lvact) return levelAction(b.dataset.lvact, b.closest('[data-level]'));
      if (b.dataset.dpact === 'filter') {
        const d = b.closest('[data-dept]').dataset.dept;
        state.legendFilter = state.legendFilter && state.legendFilter.value === d ? null : { type: 'dept', value: d };
        renderChart();
        return;
      }
      switch (b.dataset.pact) {
        case 'add-root':
          addChild(null);
          break;
        case 'add-child':
          addChild(id);
          break;
        case 'add-sibling':
          addSibling(id);
          break;
        case 'duplicate':
          duplicateNode(id);
          break;
        case 'delete':
          removeNode(id);
          break;
        case 'photo':
          pickPhoto(id);
          break;
        case 'photo-remove':
          S.update(id, { photo: null });
          renderPanel();
          break;
        case 'icon-grid':
          state.iconGridOpen = !state.iconGridOpen;
          renderPanel();
          break;
      }
    });
  }

  async function levelAction(act, row) {
    const levels = S.levels.slice();
    if (act === 'add') {
      const palette = ['#9333ea', '#0d9488', '#ea580c', '#be185d', '#15803d', '#4f46e5'];
      levels.push({ id: 'l' + OG.uid(), name: 'Novo nível', color: palette[levels.length % palette.length] });
      S.setLevels(levels);
      renderPanel();
      return;
    }
    const i = levels.findIndex((l) => l.id === row.dataset.level);
    if (act === 'up' && i > 0) [levels[i - 1], levels[i]] = [levels[i], levels[i - 1]];
    if (act === 'down' && i < levels.length - 1) [levels[i + 1], levels[i]] = [levels[i], levels[i + 1]];
    if (act === 'del') {
      const used = S.project.versions.some((v) => v.nodes.some((n) => n.level === levels[i].id));
      const target = levels[i + 1] || levels[i - 1];
      if (used) {
        const ok = await confirmModal('Remover nível', `Há posições no nível <b>${esc(levels[i].name)}</b>. Elas serão movidas para <b>${esc(target.name)}</b>. Continuar?`, 'Remover nível', true);
        if (!ok) return;
        S.project.versions.forEach((v) => v.nodes.forEach((n) => n.level === levels[i].id && (n.level = target.id)));
      }
      levels.splice(i, 1);
    }
    S.setLevels(levels);
    renderPanel();
  }

  /* ======================= photos ======================= */
  function resizeImage(file, size) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Selecione um arquivo de imagem'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Não foi possível ler a imagem'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida'));
        img.onload = () => {
          const s = Math.min(img.width, img.height);
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  let photoTarget = null;
  function pickPhoto(id) {
    photoTarget = id;
    els.filePhoto.value = '';
    els.filePhoto.click();
  }
  async function setPhoto(id, file) {
    try {
      const data = await resizeImage(file, 240);
      S.update(id, { photo: data });
      if (!S.ui.showPhotos) S.setUI({ showPhotos: true });
      renderPanel();
      toast('Foto atualizada');
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  /* ======================= canvas interactions ======================= */
  function bindCanvas() {
    const cv = els.canvas;
    let pan = null;
    let drag = null;

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      closeMenus();
      const btn = e.target.closest('button');
      let card = e.target.closest('.og-card');
      if (card && card.classList.contains('diff-removed')) card = null; // removed positions are read-only
      if (btn && (btn.dataset.act || btn.closest('.float-bar'))) return; // handled by click
      if (e.target.closest('.float-bar, .legend, .empty')) return;
      if (card && e.button === 0) {
        drag = { id: card.dataset.id, sx: e.clientX, sy: e.clientY, started: false, card };
        cv.setPointerCapture(e.pointerId);
        return;
      }
      pan = { sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
      cv.setPointerCapture(e.pointerId);
      cv.classList.add('panning');
    });

    cv.addEventListener('pointermove', (e) => {
      if (pan) {
        const dx = e.clientX - pan.sx,
          dy = e.clientY - pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        state.view.x = pan.vx + dx;
        state.view.y = pan.vy + dy;
        applyView();
        return;
      }
      if (!drag) return;
      const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
      if (!drag.started && dist > 6) startDrag(drag, e);
      if (drag.started) moveDrag(drag, e);
    });

    const end = (e) => {
      if (pan) {
        cv.classList.remove('panning');
        if (!pan.moved && e.type === 'pointerup') {
          state.legendFilter = null;
          select(null);
          renderChart();
        }
        pan = null;
      }
      if (drag) {
        if (drag.started) finishDrag(drag, e.type === 'pointerup');
        else if (e.type === 'pointerup') {
          select(drag.id);
          cv.focus({ preventScroll: true });
        }
        drag = null;
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          if (!e.ctrlKey && e.shiftKey) {
            state.view.x -= e.deltaY;
            applyView();
            return;
          }
          const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
          zoomAt(f, e.clientX - r.left, e.clientY - r.top);
        } else {
          state.view.x -= e.deltaX;
          applyView();
        }
      },
      { passive: false }
    );

    cv.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      const id = b.dataset.id || (b.closest('.og-card') && b.closest('.og-card').dataset.id);
      switch (b.dataset.act) {
        case 'toggle':
          if (S.get(id)) S.setCollapsed(id, !S.get(id).collapsed);
          break;
        case 'add-child':
          addChild(id);
          break;
        case 'add-sibling':
          addSibling(id);
          break;
        case 'duplicate':
          duplicateNode(id);
          break;
        case 'delete':
          removeNode(id);
          break;
      }
    });

    cv.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.og-card');
      if (card && !e.target.closest('button')) {
        select(card.dataset.id, { focus: true, openPanel: true });
      } else if (!card && !e.target.closest('.float-bar,.legend,.empty')) {
        fit();
      }
    });

    // drop image files on cards to set photos
    cv.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      $$('.og-card.photo-drop', els.chart).forEach((c) => c.classList.remove('photo-drop'));
      const card = e.target.closest('.og-card');
      if (card) card.classList.add('photo-drop');
    });
    cv.addEventListener('dragleave', (e) => {
      if (!cv.contains(e.relatedTarget)) $$('.og-card.photo-drop', els.chart).forEach((c) => c.classList.remove('photo-drop'));
    });
    cv.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (!file) return;
      e.preventDefault();
      $$('.og-card.photo-drop', els.chart).forEach((c) => c.classList.remove('photo-drop'));
      const card = e.target.closest('.og-card');
      if (card && /^image\//.test(file.type)) {
        select(card.dataset.id);
        setPhoto(card.dataset.id, file);
      } else if (/\.json$/i.test(file.name)) openProjectFile(file);
      else if (/\.(csv|txt)$/i.test(file.name)) importCSVFile(file);
      else if (/^image\//.test(file.type)) toast('Solte a imagem sobre um cartão para definir a foto');
    });
  }

  function startDrag(drag, e) {
    drag.started = true;
    els.canvas.classList.add('is-dragging');
    const card = drag.card;
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('og-ghost');
    ghost.classList.remove('selected', 'match', 'dim');
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.ox = e.clientX - r.left;
    drag.oy = e.clientY - r.top;
    card.classList.add('dragging');
    drag.forbidden = new Set([drag.id, ...S.descendants(drag.id).map((d) => d.id)]);
  }

  function clearDropMarks() {
    $$('.drop-child,.drop-before,.drop-after,.drop-invalid', els.chart).forEach((c) => c.classList.remove('drop-child', 'drop-before', 'drop-after', 'drop-invalid'));
  }

  function moveDrag(drag, e) {
    drag.ghost.style.left = e.clientX - drag.ox + 'px';
    drag.ghost.style.top = e.clientY - drag.oy + 'px';
    clearDropMarks();
    drag.target = null;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const card = el && el.closest('.og-card:not(.og-ghost)');
    if (!card || card.dataset.id === drag.id) return;
    const tid = card.dataset.id;
    if (drag.forbidden.has(tid)) {
      card.classList.add('drop-invalid');
      return;
    }
    const r = card.getBoundingClientRect();
    const axisX = els.chart.classList.contains('axis-x');
    const rel = axisX ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    let zone = 'child';
    const tnode = S.get(tid);
    if (rel < 0.22) zone = 'before';
    else if (rel > 0.78) zone = 'after';
    card.classList.add('drop-' + zone);
    drag.target = { id: tid, zone, parentId: tnode.parentId };
  }

  function finishDrag(drag, commit) {
    drag.ghost.remove();
    els.canvas.classList.remove('is-dragging');
    drag.card.classList.remove('dragging');
    clearDropMarks();
    const t = drag.target;
    if (!commit || !t) return renderChart();
    let ok;
    const moved = S.get(drag.id);
    const oldParent = moved.parentId;
    if (t.zone === 'child') ok = S.move(drag.id, t.id);
    else ok = S.move(drag.id, t.parentId, t.zone === 'before' ? { beforeId: t.id } : { afterId: t.id });
    if (ok) {
      select(drag.id, { force: true });
      const np = S.get(S.get(drag.id).parentId);
      if (oldParent !== S.get(drag.id).parentId) toast(`Agora subordinado a: ${np ? np.role : 'topo da hierarquia'}`, { action: { label: 'Desfazer', run: () => S.undo() } });
    } else {
      renderChart();
    }
  }

  /* ======================= keyboard ======================= */
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (document.querySelector('.modal-backdrop') || document.body.classList.contains('og-report-open')) return;
      const inField = e.target.matches('input, textarea, select, [contenteditable]');
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault();
        e.shiftKey ? S.redo() : S.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y' && !inField) {
        e.preventDefault();
        S.redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        S.saveNow();
        if (S.lastSaveError) toast('Não foi possível salvar no navegador (armazenamento cheio). Use Arquivo → Salvar projeto.', { error: true, duration: 6000 });
        else toast('Salvo no navegador. Use Arquivo → Salvar projeto para gerar um arquivo.');
        return;
      }
      if (inField) return;
      if (e.target.closest('button, a, [role="button"], .menu') && ['Enter', ' ', 'Tab'].includes(e.key)) return;
      const id = state.selectedId;
      const n = id && S.get(id);
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          if (n) addChild(id);
          else if (!S.nodes.length) addChild(null);
          else select(S.roots()[0].id);
          break;
        case 'Enter':
          e.preventDefault();
          if (n) addSibling(id);
          else if (!S.nodes.length) addChild(null);
          break;
        case 'F2':
          e.preventDefault();
          if (n) select(id, { focus: true, openPanel: true, force: true });
          break;
        case 'Delete':
        case 'Backspace':
          if (n) {
            e.preventDefault();
            removeNode(id);
          }
          break;
        case ' ':
          if (n && S.children(id).length) {
            e.preventDefault();
            S.setCollapsed(id, !n.collapsed);
          }
          break;
        case 'Escape':
          if (state.query) clearSearch();
          state.legendFilter = null;
          select(null);
          renderChart();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          navigate(e.key);
          break;
        case '+':
        case '=':
          zoomAt(1.2);
          break;
        case '-':
          zoomAt(1 / 1.2);
          break;
        case '0':
          fit();
          break;
        default:
          if (ctrl && e.key.toLowerCase() === 'd' && n) {
            e.preventDefault();
            duplicateNode(id);
          }
      }
    });
  }

  function navigate(key) {
    const id = state.selectedId;
    if (!id) {
      const r = S.roots()[0];
      if (r) select(r.id);
      return;
    }
    const L = state.lastLayout;
    const p = L && L.pos[id];
    if (!p) return;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const [dx, dy] = dirs[key];
    const cx = p.x + p.w / 2,
      cy = p.y + p.h / 2;
    let best = null,
      bestScore = Infinity;
    for (const oid in L.pos) {
      if (oid === id || !S.get(oid)) continue;
      const q = L.pos[oid];
      const ox = q.x + q.w / 2 - cx,
        oy = q.y + q.h / 2 - cy;
      const along = ox * dx + oy * dy;
      if (along <= 1) continue;
      const across = Math.abs(ox * dy) + Math.abs(oy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = oid;
      }
    }
    if (best) select(best);
  }

  /* ======================= search ======================= */
  function runSearch(q) {
    state.query = q;
    const nq = norm(q.trim());
    state.matchSet = new Set();
    state.matchList = [];
    state.matchIdx = -1;
    if (nq) {
      S.nodes.forEach((n) => {
        if (norm([n.role, n.name, n.dept, n.email, n.notes].join(' ')).includes(nq)) {
          state.matchSet.add(n.id);
          state.matchList.push(n.id);
        }
      });
      // expand to reveal matches
      let expanded = false;
      state.matchList.forEach((id) =>
        S.ancestors(id).forEach((a) => {
          if (a.collapsed) {
            a.collapsed = false;
            expanded = true;
          }
        })
      );
      if (expanded) S.changed('view');
      els.searchCount.textContent = state.matchList.length ? `${state.matchList.length} encontrado(s)` : 'nenhum';
    } else els.searchCount.textContent = '';
    renderChart();
  }
  function nextMatch(back) {
    if (!state.matchList.length) return;
    state.matchIdx = (state.matchIdx + (back ? -1 : 1) + state.matchList.length) % state.matchList.length;
    const id = state.matchList[state.matchIdx];
    select(id, { reveal: false, force: true });
    centerOn(id);
    els.searchCount.textContent = `${state.matchIdx + 1} de ${state.matchList.length}`;
  }
  function clearSearch() {
    els.search.value = '';
    runSearch('');
  }

  /* ======================= templates / quick import ======================= */
  function openTemplates() {
    let chosen = OG.TEMPLATES[0].id;
    const icons = { exemplo: 'building', pequena: 'home', tech: 'code', industria: 'factory', varejo: 'cart', branco: 'plus' };
    modal({
      title: 'Modelos prontos',
      size: 'wide',
      body: `<p>Escolha um ponto de partida. Depois é só editar, arrastar e completar.</p>
        <div class="tpl-grid">${OG.TEMPLATES.map((t) => {
          const count = OG.parseOutline(t.text).length;
          return `<button class="tpl ${t.id === chosen ? 'active' : ''}" data-tpl="${t.id}"><span class="tpl-ic">${OG.icon(icons[t.id] || 'sitemap', 18)}</span><b>${esc(t.name)}</b><span>${esc(t.desc)}</span><span>${count} posiç${count > 1 ? 'ões' : 'ão'}</span></button>`;
        }).join('')}</div>
        <div class="radio-row">
          <label class="radio-card"><input type="radio" name="tpl-mode" value="version" checked><span><b>Criar como nova versão</b>Mantém a versão atual intacta</span></label>
          <label class="radio-card"><input type="radio" name="tpl-mode" value="replace"><span><b>Substituir a versão atual</b>Pode ser desfeito com Ctrl+Z</span></label>
        </div>`,
      actions: [
        { label: 'Cancelar', onClick: () => {} },
        {
          label: 'Usar modelo',
          primary: true,
          icon: 'check',
          onClick: (close, m) => {
            const t = OG.TEMPLATES.find((x) => x.id === chosen);
            const nodes = OG.parseOutline(t.text, S.levels);
            const mode = $('input[name="tpl-mode"]:checked', m).value;
            if (mode === 'version' || !S.nodes.length) {
              if (S.nodes.length) S.createVersion(t.name, 'copy', nodes);
              else S.replaceNodes(nodes);
            } else S.replaceNodes(nodes);
            state.selectedId = null;
            renderAll();
            fit();
            toast(`Modelo "${t.name}" aplicado`);
          },
        },
      ],
      onOpen: (m) => {
        m.addEventListener('click', (e) => {
          const b = e.target.closest('[data-tpl]');
          if (!b) return;
          chosen = b.dataset.tpl;
          $$('.tpl', m).forEach((x) => x.classList.toggle('active', x === b));
        });
        m.addEventListener('dblclick', (e) => e.target.closest('[data-tpl]') && $('.modal-foot .btn.primary', m).click());
      },
    });
  }

  function openQuickImport() {
    const sel = state.selectedId && S.get(state.selectedId);
    const example = `Diretor Geral | Ana Souza | Diretoria
  Gerente Financeiro | Carlos Lima | Financeiro
    Analista Financeiro | Júlia Rocha
    Assistente Financeiro | Vaga
  Gerente Comercial | Marcos Dias | Comercial
    Vendedor | Paula Reis
    Vendedor | Rafael Costa`;
    modal({
      title: 'Montagem rápida',
      size: 'xwide',
      body: `<div class="quick-help">Digite ou cole uma linha por função. <b>A indentação (espaços ou Tab) define a hierarquia.</b>
        Colunas opcionais separadas por <code>|</code>: <code>Função | Ocupante | Departamento | Nível (1-${S.levels.length})</code>.
        Use <code>Vaga</code> no ocupante para vagas em aberto. Também aceita listas com marcadores (<code>-</code>, <code>•</code>) e numeração (<code>1.</code>, <code>1.1</code>) — ótimo para colar do Word/Excel.</div>
        <div class="quick-grid">
          <div><textarea id="qi-text" spellcheck="false" placeholder="${esc(example)}"></textarea></div>
          <div><div class="quick-preview" id="qi-prev"></div></div>
        </div>
        <div class="radio-row">
          <label class="radio-card"><input type="radio" name="qi-mode" value="version" checked><span><b>Nova versão</b>Cria uma versão com esta estrutura</span></label>
          <label class="radio-card"><input type="radio" name="qi-mode" value="replace"><span><b>Substituir versão atual</b>Troca toda a estrutura (Ctrl+Z desfaz)</span></label>
          <label class="radio-card"><input type="radio" name="qi-mode" value="append" ${sel ? '' : 'disabled'}><span><b>Adicionar abaixo da seleção</b>${sel ? esc(sel.role) : 'Selecione uma posição antes'}</span></label>
        </div>`,
      actions: [
        { label: 'Usar exemplo', left: true, autoClose: false, onClick: (c, m) => ($('#qi-text', m).value = example, $('#qi-text', m).dispatchEvent(new Event('input')), false) },
        { label: 'Carregar estrutura atual', left: true, autoClose: false, onClick: (c, m) => ($('#qi-text', m).value = OG.toOutline(S.nodes, S.levels), $('#qi-text', m).dispatchEvent(new Event('input')), false) },
        { label: 'Importar CSV…', left: true, onClick: () => ((els.fileCsv.value = ''), els.fileCsv.click()) },
        { label: 'Cancelar', onClick: () => {} },
        {
          label: 'Montar organograma',
          primary: true,
          icon: 'check',
          onClick: (close, m) => {
            const nodes = OG.parseOutline($('#qi-text', m).value, S.levels);
            if (!nodes.length) {
              toast('Digite ao menos uma função', { error: true });
              return false;
            }
            const mode = $('input[name="qi-mode"]:checked', m).value;
            if (mode === 'append' && sel) S.appendNodes(nodes, sel.id);
            else {
              if (mode === 'version') S.createVersion('Montagem rápida ' + new Date().toLocaleDateString('pt-BR'), 'copy', nodes);
              else S.replaceNodes(nodes);
            }
            state.selectedId = null;
            renderAll();
            fit();
            toast(`${nodes.length} posições criadas`);
          },
        },
      ],
      onOpen: (m) => {
        const ta = $('#qi-text', m);
        const prev = $('#qi-prev', m);
        const update = () => {
          const nodes = OG.parseOutline(ta.value, S.levels);
          if (!nodes.length) {
            prev.innerHTML = '<div style="color:var(--muted)">A pré-visualização aparece aqui…</div>';
            return;
          }
          const depth = {};
          nodes.forEach((n) => (depth[n.id] = n.parentId ? depth[n.parentId] + 1 : 0));
          const lv = (id) => S.levels.find((l) => l.id === id) || S.levels[0];
          prev.innerHTML = `<div style="font-weight:600;margin-bottom:6px">${nodes.length} posições</div>` + nodes.map((n) => `<div class="qp" style="padding-left:${depth[n.id] * 18}px"><i style="background:${lv(n.level).color}"></i>${esc(n.role)} ${n.vacant ? '<em>· vaga</em>' : n.name ? `<em>· ${esc(n.name)}</em>` : ''}${n.dept ? ` <em>[${esc(n.dept)}]</em>` : ''}</div>`).join('');
        };
        ta.addEventListener('input', update);
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const s = ta.selectionStart,
              en = ta.selectionEnd;
            const v = ta.value;
            if (s === en && !e.shiftKey) {
              ta.value = v.slice(0, s) + '  ' + v.slice(en);
              ta.selectionStart = ta.selectionEnd = s + 2;
            } else {
              // indent / outdent selected lines
              const ls = v.lastIndexOf('\n', s - 1) + 1;
              const block = v.slice(ls, en);
              const nb = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
              ta.value = v.slice(0, ls) + nb + v.slice(en);
              ta.selectionStart = ls;
              ta.selectionEnd = ls + nb.length;
            }
            update();
          }
        });
        update();
        setTimeout(() => ta.focus(), 50);
      },
    });
  }

  /* ======================= versions ======================= */
  async function versionCmd(cmd) {
    const v = S.version;
    if (cmd === 'version-new') {
      const name = await promptModal('Nova versão', 'Nome da nova versão (cópia da atual)', `Versão ${S.project.versions.length + 1}`);
      if (name) {
        S.createVersion(name, 'copy');
        toast(`Versão "${name}" criada a partir de "${v.name}"`);
      }
    } else if (cmd === 'version-blank') {
      const name = await promptModal('Nova versão em branco', 'Nome da versão', `Versão ${S.project.versions.length + 1}`);
      if (name) {
        S.createVersion(name, 'blank');
        toast(`Versão "${name}" criada`);
      }
    } else if (cmd === 'version-rename') {
      const name = await promptModal('Renomear versão', 'Nome', v.name);
      if (name) S.renameVersion(v.id, name);
    } else if (cmd === 'version-delete') {
      if (S.project.versions.length <= 1) return toast('O projeto precisa de ao menos uma versão', { error: true });
      const ok = await confirmModal('Excluir versão', `Excluir a versão <b>${esc(v.name)}</b> com ${v.nodes.length} posições? Esta ação não pode ser desfeita.`, 'Excluir', true);
      if (ok) {
        S.deleteVersion(v.id);
        toast('Versão excluída');
      }
    } else if (cmd === 'version-compare') openCompare();
  }

  function openCompare() {
    const vs = S.project.versions;
    if (vs.length < 2) return toast('Crie outra versão para comparar (menu de versões → Nova versão)');
    if (!OG.Analytics || !OG.Analytics.compare) return toast('Módulo de comparação indisponível', { error: true });
    const cur = S.version;
    const other = vs.find((v) => v.id !== cur.id);
    const opt = (sel) => vs.map((v) => `<option value="${v.id}" ${v.id === sel ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    modal({
      title: 'Comparar versões',
      size: 'wide',
      body: `<div class="row" style="margin-bottom:14px"><div class="field"><label>Versão base (antes)</label><select id="cmp-a">${opt(other.id)}</select></div>
        <div class="field"><label>Comparar com (depois)</label><select id="cmp-b">${opt(cur.id)}</select></div></div><div id="cmp-out"></div>`,
      actions: [{ label: 'Fechar', onClick: () => {} }],
      onOpen: (m) => {
        const run = () => {
          const a = vs.find((v) => v.id === $('#cmp-a', m).value);
          const b = vs.find((v) => v.id === $('#cmp-b', m).value);
          const d = OG.Analytics.compare(a.nodes, b.nodes, S.levels);
          const lv = (x) => esc(x == null ? '—' : String(x));
          const li = (arr, f) => (arr.length ? `<ul>${arr.map(f).join('')}</ul>` : '<p style="color:var(--muted)">Nenhuma.</p>');
          $('#cmp-out', m).innerHTML = `<div class="diff-sum">
              <div><b>${d.added.length}</b><span>adicionadas</span></div>
              <div><b>${d.removed.length}</b><span>removidas</span></div>
              <div><b>${d.changed.length}</b><span>alteradas</span></div>
              <div><b>${d.moved.length}</b><span>mudaram de superior</span></div></div>
            <div class="diff-list">
              <p>Total de posições: <b>${a.nodes.length}</b> → <b>${b.nodes.length}</b></p>
              <h4><span class="tag add">+</span> Adicionadas</h4>${li(d.added, (n) => `<li>${esc(n.role)}${n.name ? ' — ' + esc(n.name) : ''}</li>`)}
              <h4><span class="tag del">−</span> Removidas</h4>${li(d.removed, (n) => `<li>${esc(n.role)}${n.name ? ' — ' + esc(n.name) : ''}</li>`)}
              <h4><span class="tag chg">≠</span> Alteradas</h4>${li(d.changed, (c) => `<li><b>${esc(c.node.role)}</b>: ${c.changes.map((x) => `${esc(x.label || x.field)} <s>${lv(x.from)}</s> → ${lv(x.to)}`).join('; ')}</li>`)}
              <h4><span class="tag mov">↳</span> Mudaram de superior</h4>${li(d.moved, (x) => `<li><b>${esc(x.node.role)}</b>: ${lv(x.fromParent && (x.fromParent.role || x.fromParent))} → ${lv(x.toParent && (x.toParent.role || x.toParent))}</li>`)}
            </div>`;
        };
        $('#cmp-a', m).onchange = run;
        $('#cmp-b', m).onchange = run;
        run();
      },
    });
  }

  /* ======================= files ======================= */
  async function fileCmd(cmd) {
    const X = OG.Exporter;
    const need = () => {
      if (!X) toast('Módulo de exportação indisponível', { error: true });
      return !!X;
    };
    try {
      switch (cmd) {
        case 'project-new': {
          const ok = await confirmModal('Novo projeto', 'Criar um novo projeto em branco? O projeto atual fica salvo apenas se você exportá-lo (Arquivo → Salvar projeto).', 'Criar novo');
          if (!ok) return;
          const name = (await promptModal('Novo projeto', 'Nome da empresa / projeto', 'Novo Organograma')) || 'Novo Organograma';
          if (OG.Cloud) OG.Cloud.detach();
          S.newProject(name, []);
          state.selectedId = null;
          renderAll();
          break;
        }
        case 'project-open':
          els.fileJson.value = '';
          els.fileJson.click();
          break;
        case 'project-save':
          if (need()) X.exportJSON();
          break;
        case 'import-csv':
          els.fileCsv.value = '';
          els.fileCsv.click();
          break;
        case 'export-png':
          if (need()) {
            toast('Gerando imagem…', { duration: 1500 });
            await X.exportPNG({ scale: 2 });
          }
          break;
        case 'export-png-clear':
          if (need()) {
            toast('Gerando imagem…', { duration: 1500 });
            await X.exportPNG({ scale: 2, background: 'transparent', title: '' });
          }
          break;
        case 'export-pptx':
          toast('Gerando PowerPoint…', { duration: 2000 });
          await OG.Pptx.export();
          break;
        case 'export-svg':
          if (need()) X.exportSVG();
          break;
        case 'export-csv':
          if (need()) X.exportCSV();
          break;
        case 'report':
          openReport();
          break;
      }
    } catch (e) {
      console.error(e);
      toast(e.message || 'Falha na operação', { error: true });
    }
  }

  async function openProjectFile(file) {
    if (!OG.Exporter) return toast('Módulo de importação indisponível', { error: true });
    try {
      const p = await OG.Exporter.importJSONFile(file);
      if (OG.Cloud) OG.Cloud.detach(); // an opened file becomes a new organogram in the profile
      S.loadProject(p);
      state.selectedId = null;
      renderAll();
      fit();
      toast(`Projeto "${S.project.name}" aberto`);
    } catch (e) {
      toast(e.message || 'Arquivo inválido', { error: true });
    }
  }

  async function importCSVFile(file) {
    if (!OG.Exporter) return toast('Módulo de importação indisponível', { error: true });
    try {
      const nodes = await OG.Exporter.importCSVFile(file, S.levels);
      if (!nodes.length) throw new Error('Nenhuma linha encontrada no CSV');
      $$('.modal-backdrop').forEach((b) => b.remove());
      const ok = await confirmModal('Importar planilha', `Foram encontradas <b>${nodes.length}</b> posições em <b>${esc(file.name)}</b>. Criar uma nova versão com elas?`, 'Importar como nova versão');
      if (!ok) return;
      S.createVersion(file.name.replace(/\.[^.]+$/, ''), 'copy', nodes);
      state.selectedId = null;
      renderAll();
      fit();
      toast(`${nodes.length} posições importadas`);
    } catch (e) {
      toast(e.message || 'Falha ao importar CSV', { error: true });
    }
  }

  function openReport() {
    if (!OG.Report) return toast('Módulo de relatório indisponível', { error: true });
    closeMenus();
    OG.Report.open();
  }

  /* ======================= store events ======================= */
  function onStoreChange(type) {
    if (type === 'save-error') {
      els.saveStatus.className = 'save-status err';
      els.saveStatus.innerHTML = `${OG.icon('alert', 13)}Armazenamento cheio — salve o projeto em arquivo`;
      return;
    }
    if (type === 'saved') {
      els.saveStatus.className = 'save-status';
      els.saveStatus.innerHTML = `${OG.icon('check', 13)}Salvo automaticamente`;
      return;
    }
    if (!S.lastSaveError) {
      els.saveStatus.className = 'save-status';
      els.saveStatus.textContent = 'Salvando…';
    }
    if (type === 'project' || type === 'version') {
      state.selectedId = null;
      state.legendFilter = null;
      if (state.query) {
        els.search.value = '';
        state.query = '';
        els.searchCount.textContent = '';
      }
      state.matchSet = new Set();
      state.matchList = [];
      state.matchIdx = -1;
      renderAll();
      requestAnimationFrame(fit);
      return;
    }
    if (type === 'project-meta') {
      document.title = S.project.name + ' — OrgFlow';
      return;
    }
    if (state.selectedId && !S.get(state.selectedId)) state.selectedId = null;
    if (state.query.trim()) {
      // keep search highlights consistent with edits
      const nq = norm(state.query.trim());
      state.matchList = S.nodes.filter((n) => norm([n.role, n.name, n.dept, n.email, n.notes].join(' ')).includes(nq)).map((n) => n.id);
      state.matchSet = new Set(state.matchList);
      if (state.matchIdx >= state.matchList.length) state.matchIdx = -1;
    }
    renderChart();
    renderToolbar();
    renderStats();
    if (!state.editing && (type === 'nodes' || type === 'levels')) renderPanel();
  }

  /* ======================= bootstrap ======================= */
  function bindToolbar() {
    els.projectName.addEventListener('change', () => S.setProjectName(els.projectName.value.trim()));
    els.projectName.addEventListener('keydown', (e) => e.key === 'Enter' && els.projectName.blur());
    els.versionSelect.addEventListener('change', () => S.switchVersion(els.versionSelect.value));
    els.undo.onclick = () => S.undo();
    els.redo.onclick = () => S.redo();
    $('#layout-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-layout]');
      if (!b) return;
      S.setUI({ layout: b.dataset.layout });
      requestAnimationFrame(fit);
    });
    els.themeBtn.onclick = () => S.setUI({ theme: S.ui.theme === 'dark' ? 'light' : 'dark' });
    $('#time-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-time]');
      if (!b) return;
      const { base, future } = scenario();
      if (b.dataset.time === 'now') return S.switchVersion(base.id);
      if (future) return S.switchVersion(future.id);
      S.createFuture(base.id);
      S.setUI({ showDiff: true });
      toast('Versão futura criada. Edite à vontade: o organograma atual não muda.', { duration: 5000 });
    });
    $('#diff-toggle').addEventListener('change', (e) => S.setUI({ showDiff: e.target.checked }));
    $('#btn-panel').onclick = () => S.setUI({ panelOpen: S.ui.panelOpen === false });
    $('#btn-templates').onclick = openTemplates;
    $('#btn-quick').onclick = openQuickImport;
    $('#btn-report').onclick = openReport;
    $('#btn-shortcuts').onclick = () => modal({ title: 'Atalhos de teclado', body: shortcutsHTML(), actions: [{ label: 'Ok', primary: true, onClick: () => {} }] });
    $('#empty-add').onclick = () => addChild(null);
    $('#empty-template').onclick = openTemplates;
    $('#empty-quick').onclick = openQuickImport;
    $('#zoom-in').onclick = () => zoomAt(1.2);
    $('#zoom-out').onclick = () => zoomAt(1 / 1.2);
    $('#zoom-fit').onclick = fit;
    els.zoomLabel.onclick = () => zoomAt(1 / state.view.k);
    $('#expand-all').onclick = () => S.setAllCollapsed(false);
    $('#collapse-all').onclick = () => {
      S.setAllCollapsed(true, 1);
      requestAnimationFrame(fit);
    };
    $('#add-root').onclick = () => addChild(null);

    document.addEventListener('click', (e) => {
      const mb = e.target.closest('[data-menu]');
      if (mb) {
        e.stopPropagation();
        toggleMenu(mb, mb.dataset.menu);
        return;
      }
      if (openMenu && !openMenu.contains(e.target)) closeMenus();
    });
    $('#version-menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b || b.disabled) return;
      closeMenus();
      versionCmd(b.dataset.cmd);
    });
    $('#file-menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      closeMenus();
      fileCmd(b.dataset.cmd);
    });
    $('#view-menu').addEventListener('click', (e) => {
      const st = e.target.closest('[data-style]');
      const co = e.target.closest('[data-color]');
      if (st) S.setUI({ cardStyle: st.dataset.style });
      if (co) {
        state.legendFilter = null;
        S.setUI({ colorBy: co.dataset.color });
      }
      if (st || co) syncMenus();
      if (st) requestAnimationFrame(fit);
    });
    $('#view-menu').addEventListener('change', (e) => {
      const c = e.target.closest('[data-ui]');
      if (c) S.setUI({ [c.dataset.ui]: c.checked });
    });
    $$('.panel-tabs button').forEach(
      (b) =>
        (b.onclick = () => {
          state.panelTab = b.dataset.tab;
          state.iconGridOpen = false;
          renderPanel();
        })
    );
    els.legend.addEventListener('click', (e) => {
      const it = e.target.closest('.legend-item');
      if (!it) return;
      const f = { type: it.dataset.type, value: it.dataset.value };
      state.legendFilter = state.legendFilter && state.legendFilter.value === f.value ? null : f;
      renderChart();
    });

    els.search.addEventListener('input', () => runSearch(els.search.value));
    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nextMatch(e.shiftKey);
      } else if (e.key === 'Escape') {
        clearSearch();
        els.search.blur();
        els.canvas.focus();
      }
    });

    els.fileJson.addEventListener('change', () => els.fileJson.files[0] && openProjectFile(els.fileJson.files[0]));
    els.fileCsv.addEventListener('change', () => els.fileCsv.files[0] && importCSVFile(els.fileCsv.files[0]));
    els.filePhoto.addEventListener('change', () => els.filePhoto.files[0] && photoTarget && setPhoto(photoTarget, els.filePhoto.files[0]));

    window.addEventListener('resize', () => closeMenus());
    // fade the hint after a while
    setTimeout(() => els.hint.classList.add('hide'), 9000);
  }

  function init() {
    S.init();
    Object.assign(els, {
      canvas: $('#canvas'),
      viewport: $('#viewport'),
      chart: $('#chart'),
      empty: $('#empty'),
      legend: $('#legend'),
      hint: $('#hint'),
      panel: $('#panel'),
      panelBody: $('#panel-body'),
      stats: $('#stats'),
      saveStatus: $('#save-status'),
      projectName: $('#project-name'),
      versionSelect: $('#version-select'),
      undo: $('#btn-undo'),
      redo: $('#btn-redo'),
      themeBtn: $('#btn-theme'),
      zoomLabel: $('#zoom-label'),
      search: $('#search'),
      searchCount: $('#search-count'),
      modalRoot: $('#modal-root'),
      toasts: $('#toast-root'),
      fileJson: $('#file-json'),
      fileCsv: $('#file-csv'),
      filePhoto: $('#file-photo'),
    });
    hydrateIcons(document);
    bindToolbar();
    bindCanvas();
    bindPanel();
    bindKeyboard();
    S.on(onStoreChange);
    renderAll();
    els.saveStatus.innerHTML = `${OG.icon('check', 13)}Salvo automaticamente`;
    requestAnimationFrame(fit);
    // card heights depend on the web font: remeasure once it has loaded
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        OG.Layout.clearCache();
        renderChart();
        fit();
      });
    }
    // expose for debugging / other modules
    OG.App = { select, fit, toast, renderAll, state, modal, confirmModal, versionCmd };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
