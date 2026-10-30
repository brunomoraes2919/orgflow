/* OrgFlow — chart renderer (DOM cards + SVG connectors) */
(function () {
  const OG = (window.OG = window.OG || {});

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  OG.esc = esc;

  const initials = (s) =>
    String(s || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');

  function avatar(n, color, opts) {
    if (n.vacant) return `<div class="og-av og-av-vacant">${OG.icon('userPlus', 20)}</div>`;
    if (opts.showPhotos && n.photo) return `<div class="og-av og-av-photo" style="--c:${color}"><img src="${esc(n.photo)}" alt="" draggable="false"></div>`;
    return `<div class="og-av" style="--c:${color}">${OG.icon(OG.Store.iconFor(n), 20)}</div>`;
  }

  /**
   * render(container, nodes, opts) → { width, height, layout }
   * opts: layout, cardStyle, colorBy, showPhotos, showDept, showCount, showName,
   *       interactive, selectedId, matchIds:Set, dimOthers
   */
  function render(container, nodes, opts) {
    opts = Object.assign({}, OG.Store.ui, opts || {});
    const S = OG.Store;
    const L = OG.Layout.compute(nodes, opts);
    const kidCount = {};
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    nodes.forEach((n) => n.parentId && byId[n.parentId] && (kidCount[n.parentId] = (kidCount[n.parentId] || 0) + 1));
    const kidsOf = {};
    nodes.forEach((n) => n.parentId && byId[n.parentId] && (kidsOf[n.parentId] = kidsOf[n.parentId] || []).push(n.id));
    const descCount = (id) => {
      let c = 0;
      const st = [id];
      const seen = new Set(st);
      while (st.length) {
        for (const k of kidsOf[st.pop()] || []) if (!seen.has(k)) (seen.add(k), c++, st.push(k));
      }
      return c;
    };

    const parts = [];
    parts.push(`<svg class="og-edges" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">`);
    for (const e of L.edges) {
      const hl = opts.selectedId && (e.from === opts.selectedId || e.to === opts.selectedId) ? ' hl' : '';
      parts.push(`<path class="og-edge${hl}" data-from="${e.from}" data-to="${e.to}" d="${e.d}"/>`);
    }
    parts.push('</svg>');

    const style = opts.cardStyle || 'classico';
    for (const id of L.order) {
      const n = byId[id];
      const p = L.pos[id];
      const color = S.colorFor(n, opts.colorBy);
      const dcolor = S.deptColor(n.dept);
      const cls = ['og-card', 'st-' + style];
      if (n.vacant) cls.push('vacant');
      if (opts.selectedId === id) cls.push('selected');
      if (opts.matchIds && opts.matchIds.size) cls.push(opts.matchIds.has(id) ? 'match' : 'dim');
      const kc = kidCount[id] || 0;
      const nameTxt = n.vacant ? 'Vaga em aberto' : n.name;
      const showName = opts.showName !== false && (nameTxt || style === 'moderno');
      const lvl = S.levelOf(n);
      const title = [n.role, n.vacant ? 'Vaga em aberto' : n.name, n.dept, lvl && lvl.name].filter(Boolean).join(' • ');
      let inner = '';
      if (style === 'compacto') {
        inner = `<span class="og-ic" style="color:${color}">${OG.icon(S.iconFor(n), 16)}</span><div class="og-txt"><div class="og-role">${esc(n.role)}</div></div>`;
      } else if (style === 'minimal') {
        const av = opts.showPhotos && n.photo && !n.vacant ? `<div class="og-av og-av-photo sm"><img src="${esc(n.photo)}" alt="" draggable="false"></div>` : `<span class="og-ic" style="color:${n.vacant ? '#94a3b8' : color}">${OG.icon(n.vacant ? 'userPlus' : S.iconFor(n), 18)}</span>`;
        inner = `${av}<div class="og-txt"><div class="og-role">${esc(n.role)}</div>${showName ? `<div class="og-name">${esc(nameTxt) || '&nbsp;'}</div>` : ''}</div>`;
      } else {
        inner = `${style === 'moderno' ? '<div class="og-band"></div>' : '<div class="og-bar"></div>'}
          ${avatar(n, color, opts)}
          <div class="og-txt">
            <div class="og-role">${esc(n.role)}</div>
            ${showName ? `<div class="og-name">${esc(nameTxt) || '&nbsp;'}</div>` : ''}
            ${opts.showDept && n.dept ? `<div class="og-dept" style="--d:${dcolor}"><i></i>${esc(n.dept)}</div>` : ''}
          </div>`;
      }
      const badge = opts.showCount && kc ? `<span class="og-badge" title="${kc} subordinado(s) direto(s)">${OG.icon('users', 11)}${kc}</span>` : '';
      const actions = opts.interactive
        ? `<div class="og-actions">
            <button data-act="add-child" title="Adicionar subordinado (Tab)">${OG.icon('plus', 14)}</button>
            <button data-act="add-sibling" title="Adicionar par (Enter)">${OG.icon('users', 14)}</button>
            <button data-act="duplicate" title="Duplicar ramo">${OG.icon('copy', 14)}</button>
            <button data-act="delete" title="Excluir (Del)" class="danger">${OG.icon('trash', 14)}</button>
          </div>`
        : '';
      parts.push(
        `<div class="${cls.join(' ')}" data-id="${esc(id)}" title="${esc(title)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--c:${color}">${inner}${badge}${actions}</div>`
      );
    }
    for (const id in L.toggles) {
      const t = L.toggles[id];
      const n = byId[id];
      const hidden = n.collapsed ? descCount(id) : 0;
      const label = n.collapsed ? `+${hidden}` : OG.icon('minus', 10);
      parts.push(
        `<button class="og-toggle ${n.collapsed ? 'collapsed' : ''} side-${t.side}" data-act="toggle" data-id="${esc(id)}" style="left:${t.x}px;top:${t.y}px" title="${n.collapsed ? 'Expandir' : 'Recolher'}">${label}</button>`
      );
    }

    container.innerHTML = `<div class="og-world" style="width:${L.width}px;height:${L.height}px">${parts.join('')}</div>`;
    return { width: L.width, height: L.height, layout: L };
  }

  OG.Chart = { render, initials };
})();
