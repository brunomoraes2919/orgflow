/* OrgFlow — printable report (full-screen overlay with A4 "paper" pages) */
(function () {
  const OG = (window.OG = window.OG || {});
  const PREF_KEY = 'orgflow.report.prefs';
  const MM = 96 / 25.4; // px per mm
  const CHART_MAX_H = { portrait: 222, landscape: 148 }; // mm available for the chart on its page

  const SECTIONS = [
    { id: 'cover', label: 'Capa/Resumo' },
    { id: 'kpis', label: 'Indicadores' },
    { id: 'chart', label: 'Organograma' },
    { id: 'dept', label: 'Por departamento' },
    { id: 'level', label: 'Por nível' },
    { id: 'leaders', label: 'Lideranças e equipes' },
    { id: 'table', label: 'Quadro de funções' },
    { id: 'insights', label: 'Análise e alertas' },
    { id: 'compare', label: 'Comparação de versões' },
  ];

  const state = { sections: {}, orientation: 'portrait', compareId: '' };
  SECTIONS.forEach((s) => (state.sections[s.id] = true));

  let root = null;
  let renderTimer = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const escBr = (s) => esc(s).replace(/\n/g, '<br>');
  function safeColor(c) {
    c = String(c || '').trim();
    return /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%]+\)|[a-z]{3,20})$/i.test(c) ? c : '#94a3b8';
  }
  const ic = (name, size) => (typeof OG.icon === 'function' ? OG.icon(name, size || 16, 'rp-ic') : '');
  const nf = (n, d) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const pct = (n) => nf(n, 1) + '%';
  const plural = (n, s, p) => nf(n) + ' ' + (n === 1 ? s : p);
  const roleOf = (n) => (n && String(n.role || '').trim()) || 'Função sem nome';
  function longDate(d) {
    try {
      return new Date(d || Date.now()).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
      return new Date(d || Date.now()).toLocaleDateString();
    }
  }
  function shortDateTime(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return new Date(d).toLocaleString();
    }
  }
  function slug(s) {
    return (
      String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'organograma'
    );
  }

  function levelOf(node) {
    if (OG.Store && OG.Store.levelOf) return OG.Store.levelOf(node);
    return { name: node.level || '—', color: '#94a3b8' };
  }
  const deptColor = (name) => safeColor(OG.Store && OG.Store.deptColor ? OG.Store.deptColor(name) : '#94a3b8');

  function occupantHTML(n) {
    if (n.vacant === true) return '<span class="rp-vacant">Vaga em aberto</span>';
    const nm = String(n.name || '').trim();
    return nm ? esc(nm) : '<span class="rp-muted">Não informado</span>';
  }
  function occupantText(n) {
    if (n.vacant === true) return 'Vaga em aberto';
    return String(n.name || '').trim() || 'Não informado';
  }
  function levelChip(node) {
    const l = levelOf(node);
    return `<span class="rp-chip"><i class="rp-dot" style="background:${safeColor(l.color)}"></i>${esc(l.name)}</span>`;
  }
  function levelChipById(id, levels) {
    const l = levels.find((x) => x.id === id) || levels[levels.length - 1] || { name: '—', color: '#94a3b8' };
    return `<span class="rp-chip"><i class="rp-dot" style="background:${safeColor(l.color)}"></i>${esc(l.name)}</span>`;
  }
  function deptChip(name) {
    if (!String(name || '').trim()) return '<span class="rp-muted">Sem departamento</span>';
    return `<span class="rp-chip"><i class="rp-dot" style="background:${deptColor(name)}"></i>${esc(name)}</span>`;
  }

  /* ---------- prefs ---------- */
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (p && typeof p === 'object') {
        if (p.sections) SECTIONS.forEach((s) => typeof p.sections[s.id] === 'boolean' && (state.sections[s.id] = p.sections[s.id]));
        if (p.orientation === 'portrait' || p.orientation === 'landscape') state.orientation = p.orientation;
      }
    } catch (e) {
      /* ignore */
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ sections: state.sections, orientation: state.orientation }));
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- context ---------- */
  function otherVersions() {
    const p = OG.Store.project;
    return p.versions.filter((v) => v.id !== OG.Store.version.id);
  }

  function buildCtx() {
    const A = OG.Analytics;
    const project = OG.Store.project;
    const version = OG.Store.version;
    const nodes = OG.Store.nodes || [];
    const levels = OG.Store.levels || [];
    const ctx = {
      project,
      version,
      nodes,
      levels,
      today: longDate(),
      stats: A.stats(nodes, levels),
      tree: A.tree(nodes),
      insights: A.insights(nodes, levels),
      baseVersion: null,
      cmp: null,
    };
    const base = state.compareId && project.versions.find((v) => v.id === state.compareId && v.id !== version.id);
    if (base) {
      ctx.baseVersion = base;
      ctx.cmp = A.compare(base.nodes || [], nodes, levels);
    }
    return ctx;
  }

  /* ---------- toolbar ---------- */
  function toolbarHTML() {
    const others = otherVersions();
    const project = OG.Store.project;
    const chips = SECTIONS.map((s) => {
      const isCmp = s.id === 'compare';
      if (isCmp && !others.length) return '';
      const disabled = isCmp && !state.compareId;
      return `<label class="rp-tchip${disabled ? ' rp-disabled' : ''}" ${disabled ? 'title="Escolha uma versão em “Comparar com”"' : ''}>
        <input type="checkbox" data-sec="${s.id}" ${state.sections[s.id] ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="rp-tchip-box">${ic('check', 12)}</span><span>${esc(s.label)}</span></label>`;
    }).join('');
    const cmpSelect = others.length
      ? `<label class="rp-field"><span class="rp-field-label">Comparar com:</span>
          <select class="rp-input rp-select" data-ctl="compare">
            <option value="">— nenhuma —</option>
            ${others.map((v) => `<option value="${esc(v.id)}" ${v.id === state.compareId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
          </select></label>`
      : '';
    return `
      <div class="rp-toolbar">
        <div class="rp-tb-main">
          <div class="rp-tb-title">
            <span class="rp-tb-logo">${ic('clipboard', 18)}</span>
            <div><strong>Relatório do organograma</strong><small>${esc(project.name)} · ${esc(OG.Store.version.name)}</small></div>
          </div>
          <div class="rp-tb-actions">
            <button type="button" class="rp-btn rp-btn-primary" data-act="print">${ic('printer', 16)}<span>Imprimir / Salvar PDF</span></button>
            <button type="button" class="rp-btn" data-act="csv">${ic('download', 16)}<span>Exportar CSV</span></button>
            <button type="button" class="rp-btn rp-btn-ghost" data-act="close" title="Fechar (Esc)">${ic('x', 16)}<span>Fechar</span></button>
          </div>
        </div>
        <div class="rp-tb-row">
          <span class="rp-field-label">Seções:</span>
          <div class="rp-tchips">${chips}</div>
        </div>
        <div class="rp-tb-row rp-tb-opts">
          ${cmpSelect}
          <div class="rp-field"><span class="rp-field-label">Orientação:</span>
            <div class="rp-seg" role="group">
              <button type="button" data-orient="portrait" class="${state.orientation === 'portrait' ? 'rp-on' : ''}">Retrato</button>
              <button type="button" data-orient="landscape" class="${state.orientation === 'landscape' ? 'rp-on' : ''}">Paisagem</button>
            </div>
          </div>
          <label class="rp-field"><span class="rp-field-label">Elaborado por</span>
            <input type="text" class="rp-input" data-ctl="author" placeholder="Nome do responsável"></label>
          <label class="rp-field rp-field-grow"><span class="rp-field-label">Observações</span>
            <textarea class="rp-input rp-textarea" data-ctl="notes" rows="1" placeholder="Opcional — exibidas na capa"></textarea></label>
        </div>
      </div>`;
  }

  function refreshToolbar() {
    const tb = root && root.querySelector('.rp-toolbar');
    if (!tb) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = toolbarHTML();
    tb.replaceWith(tmp.firstElementChild);
    fillInputs();
  }

  function fillInputs() {
    const a = root.querySelector('[data-ctl="author"]');
    const n = root.querySelector('[data-ctl="notes"]');
    if (a) a.value = OG.Store.project.author || '';
    if (n) {
      n.value = OG.Store.project.reportNotes || '';
      autoGrow(n);
    }
  }
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 120) + 'px';
  }

  function applyOrientation() {
    let st = document.getElementById('og-page-style');
    if (!st) {
      st = document.createElement('style');
      st.id = 'og-page-style';
      document.head.appendChild(st);
    }
    st.textContent = `@page { size: A4 ${state.orientation}; margin: 12mm; }`;
    if (root) {
      root.classList.toggle('rp-landscape', state.orientation === 'landscape');
      root.classList.toggle('rp-portrait', state.orientation !== 'landscape');
      root.querySelectorAll('[data-orient]').forEach((b) => b.classList.toggle('rp-on', b.getAttribute('data-orient') === state.orientation));
    }
  }

  /* ---------- sections ---------- */
  function sectionHead(no, title, desc) {
    return `<header class="rp-sec-head">
      <span class="rp-sec-num">${String(no).padStart(2, '0')}</span>
      <div><h2 class="rp-h2">${esc(title)}</h2>${desc ? `<p class="rp-sec-desc">${esc(desc)}</p>` : ''}</div>
    </header>`;
  }

  function execSummary(ctx, withInsightsRef) {
    const st = ctx.stats;
    if (!st.total) return 'A versão atual ainda não possui posições cadastradas.';
    const parts = [];
    let s1 = `A estrutura possui ${plural(st.total, 'posição', 'posições')} ${st.total === 1 ? 'distribuída' : 'distribuídas'} em `;
    s1 += st.deptCount ? plural(st.deptCount, 'departamento', 'departamentos') : 'nenhum departamento definido';
    s1 += ` e ${plural(st.depth, 'nível hierárquico', 'níveis hierárquicos')}`;
    if (st.vacant) s1 += `, com ${plural(st.filled, 'posição ocupada', 'posições ocupadas')} e ${plural(st.vacant, 'vaga em aberto', 'vagas em aberto')} (${pct((st.vacant / st.total) * 100)} do quadro).`;
    else s1 += ', sem vagas em aberto.';
    parts.push(s1);
    if (st.leaders) {
      parts.push(
        `Há ${plural(st.leaders, 'liderança', 'lideranças')}, com amplitude média de controle de ${nf(st.avgSpan, 1)} ${st.avgSpan === 1 ? 'subordinado direto' : 'subordinados diretos'}; ` +
          `a maior equipe direta é a de ${roleOf(st.maxSpan.node)} (${plural(st.maxSpan.count, 'subordinado', 'subordinados')}).`
      );
    } else {
      parts.push('Não há relações de liderança definidas na estrutura.');
    }
    const topDept = st.byDept.find((d) => d.name !== OG.Analytics.NO_DEPT);
    if (topDept && st.deptCount > 1) parts.push(`O departamento com maior número de posições é ${topDept.name} (${nf(topDept.count)}, ${pct(topDept.pct)}).`);
    const warns = ctx.insights.filter((i) => i.type === 'warn').length;
    if (warns) parts.push(`A análise estrutural identificou ${plural(warns, 'ponto de atenção', 'pontos de atenção')}${withInsightsRef ? ', detalhados na seção “Análise e alertas”' : ''}.`);
    else parts.push('A análise estrutural não identificou pontos de atenção relevantes.');
    return parts.join(' ');
  }

  function coverHTML(ctx, toc) {
    const p = ctx.project;
    const notes = String(p.reportNotes || '').trim();
    return `<div class="rp-cover">
      <div class="rp-cover-band"></div>
      <div class="rp-eyebrow">${ic('sitemap', 14)} Relatório organizacional</div>
      <h1 class="rp-h1">${esc(p.name)}</h1>
      <div class="rp-cover-version">${esc(ctx.version.name)}</div>
      <div class="rp-meta">
        <div><span>Data</span><strong>${esc(ctx.today)}</strong></div>
        <div><span>Elaborado por</span><strong>${esc(String(p.author || '').trim() || '—')}</strong></div>
        <div><span>Versão</span><strong>${esc(ctx.version.name)}</strong></div>
        <div><span>Última atualização</span><strong>${esc(shortDateTime(ctx.version.updatedAt))}</strong></div>
      </div>
      <div class="rp-summary">
        <h3 class="rp-h3">Sumário executivo</h3>
        <p>${esc(execSummary(ctx, state.sections.insights))}</p>
      </div>
      ${notes ? `<div class="rp-notes"><h3 class="rp-h3">Observações</h3><p>${escBr(notes)}</p></div>` : ''}
      ${toc.length ? `<div class="rp-toc"><h3 class="rp-h3">Conteúdo</h3><ol>${toc.map((t) => `<li><span>${String(t.no).padStart(2, '0')}</span>${esc(t.label)}</li>`).join('')}</ol></div>` : ''}
    </div>`;
  }

  function kpi(icon, label, value, sub, tone) {
    return `<div class="rp-kpi${tone ? ' rp-kpi-' + tone : ''}">
      <div class="rp-kpi-top"><span class="rp-kpi-ic">${ic(icon, 15)}</span><span class="rp-kpi-label">${esc(label)}</span></div>
      <div class="rp-kpi-value">${value}</div>
      ${sub ? `<div class="rp-kpi-sub">${sub}</div>` : ''}
    </div>`;
  }

  function kpisHTML(ctx, no) {
    const st = ctx.stats;
    const fPct = st.total ? (st.filled / st.total) * 100 : 0;
    const vPct = st.total ? (st.vacant / st.total) * 100 : 0;
    return `<section class="rp-section">
      ${sectionHead(no, 'Indicadores', 'Principais números da estrutura organizacional.')}
      <div class="rp-kpis">
        ${kpi('users', 'Total de posições', nf(st.total), plural(st.roots.length, 'posição de topo', 'posições de topo'))}
        ${kpi('userCheck', 'Ocupadas', nf(st.filled), pct(fPct) + ' do quadro', 'ok')}
        ${kpi('userPlus', 'Vagas em aberto', nf(st.vacant), pct(vPct) + ' do quadro', st.vacant ? 'warn' : '')}
        ${kpi('briefcase', 'Lideranças', nf(st.leaders), st.total ? pct((st.leaders / st.total) * 100) + ' das posições' : '')}
        ${kpi('layers', 'Níveis hierárquicos', nf(st.depth), plural(st.levelsUsed, 'nível de cargo em uso', 'níveis de cargo em uso'))}
        ${kpi('sitemap', 'Amplitude média de controle', nf(st.avgSpan, 1), 'subordinados diretos por líder')}
        ${kpi('target', 'Maior amplitude', nf(st.maxSpan.count), st.maxSpan.node ? esc(roleOf(st.maxSpan.node)) : '—')}
        ${kpi('building', 'Departamentos', nf(st.deptCount), st.byDept.some((d) => d.name === OG.Analytics.NO_DEPT) ? 'há posições sem departamento' : 'todas as posições classificadas')}
      </div>
      ${
        st.total
          ? `<div class="rp-compo">
        <div class="rp-compo-head"><strong>Composição do quadro</strong>
          <span><i class="rp-dot rp-dot-fill"></i>Ocupadas ${nf(st.filled)} (${pct(fPct)})</span>
          <span><i class="rp-dot rp-dot-vac"></i>Vagas ${nf(st.vacant)} (${pct(vPct)})</span></div>
        <div class="rp-compo-bar"><div class="rp-compo-fill" style="width:${fPct.toFixed(2)}%"></div><div class="rp-compo-vac" style="width:${vPct.toFixed(2)}%"></div></div>
      </div>`
          : ''
      }
    </section>`;
  }

  function chartLegend(ctx) {
    const ui = OG.Store.ui || {};
    if (ui.colorBy === 'dept') {
      const items = ctx.stats.byDept.map((d) => `<span class="rp-chip"><i class="rp-dot" style="background:${d.name === OG.Analytics.NO_DEPT ? '#94a3b8' : deptColor(d.name)}"></i>${esc(d.name)}</span>`);
      return items.length ? `<div class="rp-legend"><span class="rp-legend-title">Departamentos:</span>${items.join('')}</div>` : '';
    }
    if (ui.colorBy === 'none') return '';
    const items = ctx.stats.byLevel.filter((l) => l.count).map((l) => `<span class="rp-chip"><i class="rp-dot" style="background:${safeColor(l.level.color)}"></i>${esc(l.level.name)}</span>`);
    return items.length ? `<div class="rp-legend"><span class="rp-legend-title">Níveis:</span>${items.join('')}</div>` : '';
  }

  function chartHTML(ctx, no) {
    return `<section class="rp-section">
      ${sectionHead(no, 'Organograma', 'Visão completa da estrutura, com todos os níveis expandidos.')}
      ${ctx.nodes.length ? '<div class="rp-chart"></div>' : '<p class="rp-empty">Sem posições para exibir.</p>'}
      ${chartLegend(ctx)}
    </section>`;
  }

  function barsHTML(rows) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    return `<div class="rp-bars">${rows
      .map((r) => {
        const w = (r.count / max) * 100;
        const vw = r.count ? (r.vacant / r.count) * 100 : 0;
        return `<div class="rp-bar-row">
          <div class="rp-bar-label"><i class="rp-dot" style="background:${r.color}"></i><span>${esc(r.label)}</span></div>
          <div class="rp-bar-track"><div class="rp-bar-fill" style="width:${w.toFixed(2)}%;background:${r.color}">${r.vacant ? `<span class="rp-bar-vac" style="width:${vw.toFixed(2)}%"></span>` : ''}</div></div>
          <div class="rp-bar-val"><strong>${nf(r.count)}</strong><span>${pct(r.pct)}</span>${r.vacant ? `<em>${plural(r.vacant, 'vaga', 'vagas')}</em>` : '<em class="rp-em-empty"></em>'}</div>
        </div>`;
      })
      .join('')}</div>
      <div class="rp-bars-legend"><span><i class="rp-swatch"></i>Ocupadas</span><span><i class="rp-swatch rp-swatch-vac"></i>Vagas em aberto</span><span class="rp-muted">Percentuais sobre o total de posições.</span></div>`;
  }

  function deptHTML(ctx, no) {
    const st = ctx.stats;
    const rows = st.byDept.map((d) => ({ label: d.name, color: d.name === OG.Analytics.NO_DEPT ? '#94a3b8' : deptColor(d.name), count: d.count, vacant: d.vacant, pct: d.pct }));
    return `<section class="rp-section">
      ${sectionHead(no, 'Distribuição por departamento', `${plural(st.deptCount, 'departamento', 'departamentos')} · ${plural(st.total, 'posição', 'posições')}`)}
      ${rows.length ? barsHTML(rows) : '<p class="rp-empty">Sem dados.</p>'}
    </section>`;
  }

  function levelHTML(ctx, no) {
    const st = ctx.stats;
    const rows = st.byLevel.map((l) => ({ label: l.level.name, color: safeColor(l.level.color), count: l.count, vacant: l.vacant, pct: l.pct }));
    return `<section class="rp-section">
      ${sectionHead(no, 'Distribuição por nível', `${plural(st.levelsUsed, 'nível de cargo em uso', 'níveis de cargo em uso')} de ${nf(ctx.levels.length)} cadastrados`)}
      ${rows.length ? barsHTML(rows) : '<p class="rp-empty">Nenhum nível cadastrado.</p>'}
    </section>`;
  }

  function leadersHTML(ctx, no) {
    const t = ctx.tree;
    const leaders = t.order.filter((n) => t.children(n.id).length);
    const cards = leaders
      .map((n) => {
        const kids = t.children(n.id);
        return `<div class="rp-leader">
          <div class="rp-leader-head">
            <span class="rp-num">${esc(t.numbering[n.id])}</span>
            <div class="rp-leader-title"><strong>${esc(roleOf(n))}</strong><span>${occupantHTML(n)}</span></div>
            <div class="rp-leader-tags">${deptChip(n.dept)}${levelChip(n)}</div>
          </div>
          <div class="rp-leader-stats"><span><b>${nf(kids.length)}</b> ${kids.length === 1 ? 'direto' : 'diretos'}</span><span><b>${nf(t.descendantsCount(n.id))}</b> na equipe total</span></div>
          <ul class="rp-reports">${kids.map((k) => `<li><span class="rp-r-role">${esc(roleOf(k))}</span><span class="rp-r-sep">—</span>${occupantHTML(k)}</li>`).join('')}</ul>
        </div>`;
      })
      .join('');
    return `<section class="rp-section">
      ${sectionHead(no, 'Lideranças e equipes', `${plural(leaders.length, 'liderança', 'lideranças')} em ordem hierárquica, com subordinados diretos e tamanho total da equipe.`)}
      ${leaders.length ? `<div class="rp-leaders">${cards}</div>` : '<p class="rp-empty">Nenhuma posição possui subordinados.</p>'}
    </section>`;
  }

  function tableHTML(ctx, no) {
    const t = ctx.tree;
    const rows = t.order
      .map((n) => {
        const d = t.depthOf[n.id] || 0;
        const parent = t.parentOf(n);
        const kids = t.children(n.id).length;
        return `<tr>
          <td class="rp-td-num">${esc(t.numbering[n.id])}</td>
          <td><div class="rp-role" style="padding-left:${Math.min(d, 10) * 12}px">${d ? '<span class="rp-branch">└</span>' : ''}<strong>${esc(roleOf(n))}</strong></div></td>
          <td>${occupantHTML(n)}</td>
          <td>${deptChip(n.dept)}</td>
          <td>${levelChip(n)}</td>
          <td>${parent ? esc(roleOf(parent)) : '<span class="rp-muted">—</span>'}</td>
          <td class="rp-td-c">${kids ? nf(kids) : '<span class="rp-muted">—</span>'}</td>
        </tr>`;
      })
      .join('');
    return `<section class="rp-section">
      ${sectionHead(no, 'Quadro de funções', `Relação completa das ${plural(ctx.nodes.length, 'posição', 'posições')} em ordem hierárquica.`)}
      ${
        ctx.nodes.length
          ? `<table class="rp-table">
        <thead><tr><th class="rp-td-num">Nº</th><th>Função</th><th>Ocupante</th><th>Departamento</th><th>Nível</th><th>Superior imediato</th><th class="rp-td-c">Subord. diretos</th></tr></thead>
        <tbody>${rows}</tbody></table>`
          : '<p class="rp-empty">Sem posições.</p>'
      }
    </section>`;
  }

  function insightsHTML(ctx, no) {
    const ins = ctx.insights;
    const warns = ins.filter((i) => i.type === 'warn').length;
    const infos = ins.filter((i) => i.type === 'info').length;
    const iconFor = { warn: 'alert', info: 'info', ok: 'check' };
    return `<section class="rp-section">
      ${sectionHead(no, 'Análise e alertas', warns || infos ? `${plural(warns, 'ponto de atenção', 'pontos de atenção')} · ${plural(infos, 'observação', 'observações')}` : 'Verificação automática de consistência da estrutura.')}
      <div class="rp-callouts">${ins
        .map(
          (i) => `<div class="rp-callout rp-callout-${i.type}">
          <div class="rp-callout-ic">${ic(iconFor[i.type] || 'info', 18)}</div>
          <div class="rp-callout-body"><h4>${esc(i.title)}</h4><p>${esc(i.text)}</p></div>
        </div>`
        )
        .join('')}</div>
      <p class="rp-note">Critérios: amplitude elevada acima de ${OG.Analytics.HIGH_SPAN} subordinados diretos; cadeia longa acima de ${OG.Analytics.MAX_DEPTH} níveis; inversão quando o superior está em nível de cargo inferior ao do subordinado.</p>
    </section>`;
  }

  function compareHTML(ctx, no) {
    const c = ctx.cmp;
    const s = c.summary;
    const base = ctx.baseVersion;
    const levels = ctx.levels;
    const baseMap = {};
    (base.nodes || []).forEach((n) => (baseMap[n.id] = n));
    const curT = ctx.tree;
    const parentRole = (n, map) => (n.parentId && map[n.parentId] && n.parentId !== n.id ? esc(roleOf(map[n.parentId])) : '<span class="rp-muted">—</span>');
    const delta = s.delta > 0 ? '+' + nf(s.delta) : s.delta < 0 ? '−' + nf(-s.delta) : '0';
    const empty = (txt) => `<p class="rp-empty">${esc(txt)}</p>`;
    const nodeRows = (list, map) =>
      list
        .map(
          (n) => `<tr><td><strong>${esc(roleOf(n))}</strong></td><td>${occupantHTML(n)}</td><td>${deptChip(n.dept)}</td><td>${levelChipById(n.level, levels)}</td><td>${parentRole(n, map)}</td></tr>`
        )
        .join('');
    const nodeTable = (list, map) =>
      `<table class="rp-table rp-table-sm"><thead><tr><th>Função</th><th>Ocupante</th><th>Departamento</th><th>Nível</th><th>Superior imediato</th></tr></thead><tbody>${nodeRows(list, map)}</tbody></table>`;

    const changedRows = c.changed
      .map((ch) =>
        ch.changes
          .map(
            (x, i) => `<tr>${i === 0 ? `<td rowspan="${ch.changes.length}"><strong>${esc(roleOf(ch.node))}</strong><div class="rp-muted rp-small">${esc(occupantText(ch.node))}</div></td>` : ''}
            <td>${esc(x.label)}</td><td class="rp-from">${esc(x.from)}</td><td class="rp-to">${esc(x.to)}</td></tr>`
          )
          .join('')
      )
      .join('');
    const movedRows = c.moved
      .map((m) => `<tr><td><strong>${esc(roleOf(m.node))}</strong></td><td>${occupantHTML(m.node)}</td><td class="rp-from">${esc(m.fromParent)}</td><td class="rp-to">${esc(m.toParent)}</td></tr>`)
      .join('');

    return `<section class="rp-section">
      ${sectionHead(no, 'Comparação de versões', '')}
      <div class="rp-cmp-versions">
        <div><span>Base</span><strong>${esc(base.name)}</strong><small>${esc(shortDateTime(base.updatedAt))}</small></div>
        <div class="rp-cmp-arrow">→</div>
        <div><span>Atual</span><strong>${esc(ctx.version.name)}</strong><small>${esc(shortDateTime(ctx.version.updatedAt))}</small></div>
      </div>
      <div class="rp-cmp-counters">
        <div class="rp-cmp-c rp-c-add"><b>${nf(s.added)}</b><span>${s.added === 1 ? 'adicionada' : 'adicionadas'}</span></div>
        <div class="rp-cmp-c rp-c-rem"><b>${nf(s.removed)}</b><span>${s.removed === 1 ? 'removida' : 'removidas'}</span></div>
        <div class="rp-cmp-c rp-c-chg"><b>${nf(s.changed)}</b><span>${s.changed === 1 ? 'alterada' : 'alteradas'}</span></div>
        <div class="rp-cmp-c rp-c-mov"><b>${nf(s.moved)}</b><span>${s.moved === 1 ? 'movida' : 'movidas'}</span></div>
        <div class="rp-cmp-c rp-c-tot"><b>${nf(s.totalA)} → ${nf(s.totalB)}</b><span>total de posições (${delta})</span></div>
      </div>
      <h3 class="rp-h3 rp-cmp-h">Posições adicionadas <span class="rp-count">${nf(s.added)}</span></h3>
      ${c.added.length ? nodeTable(c.added, curT.byId) : empty('Nenhuma posição adicionada.')}
      <h3 class="rp-h3 rp-cmp-h">Posições removidas <span class="rp-count">${nf(s.removed)}</span></h3>
      ${c.removed.length ? nodeTable(c.removed, baseMap) : empty('Nenhuma posição removida.')}
      <h3 class="rp-h3 rp-cmp-h">Posições alteradas <span class="rp-count">${nf(s.changed)}</span></h3>
      ${
        c.changed.length
          ? `<table class="rp-table rp-table-sm"><thead><tr><th>Posição</th><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${changedRows}</tbody></table>`
          : empty('Nenhuma posição alterada.')
      }
      <h3 class="rp-h3 rp-cmp-h">Posições movidas <span class="rp-count">${nf(s.moved)}</span></h3>
      ${
        c.moved.length
          ? `<table class="rp-table rp-table-sm"><thead><tr><th>Função</th><th>Ocupante</th><th>Superior anterior</th><th>Novo superior</th></tr></thead><tbody>${movedRows}</tbody></table>`
          : empty('Nenhuma posição mudou de superior.')
      }
    </section>`;
  }

  /* ---------- page assembly ---------- */
  function pageHTML(ctx, inner, opts) {
    opts = opts || {};
    return `<div class="rp-page${opts.cls ? ' ' + opts.cls : ''}">
      ${opts.runHead === false ? '' : `<div class="rp-run-head"><span>${esc(ctx.project.name)}</span><span>Relatório organizacional · ${esc(ctx.version.name)}</span></div>`}
      <div class="rp-page-body">${inner}</div>
      <footer class="rp-footer"><span>${esc(ctx.project.name)} · ${esc(ctx.version.name)}</span><span>Gerado por OrgFlow em ${esc(ctx.today)}</span></footer>
    </div>`;
  }

  function render() {
    clearTimeout(renderTimer);
    renderTimer = null;
    if (!root) return;
    const host = root.querySelector('.rp-pages');
    if (!host) return;
    let ctx;
    try {
      ctx = buildCtx();
    } catch (e) {
      console.error(e);
      host.innerHTML = '<div class="rp-page"><p class="rp-empty">Não foi possível gerar o relatório.</p></div>';
      return;
    }
    const on = (id) => !!state.sections[id];
    const hasCmp = !!ctx.cmp && on('compare');

    // numbering + table of contents
    const order = ['kpis', 'chart', 'dept', 'level', 'leaders', 'table', 'insights', 'compare'];
    const nums = {};
    const toc = [];
    let k = 0;
    order.forEach((id) => {
      if (!on(id) || (id === 'compare' && !hasCmp)) return;
      nums[id] = ++k;
      toc.push({ no: k, label: SECTIONS.find((s) => s.id === id).label });
    });

    const pages = [];
    if (on('cover') || on('kpis')) {
      pages.push(pageHTML(ctx, (on('cover') ? coverHTML(ctx, toc) : '') + (on('kpis') ? kpisHTML(ctx, nums.kpis) : ''), { cls: on('cover') ? 'rp-page-cover' : '', runHead: !on('cover') }));
    }
    if (on('chart')) pages.push(pageHTML(ctx, chartHTML(ctx, nums.chart), { cls: 'rp-page-chart' }));
    if (on('dept') || on('level')) pages.push(pageHTML(ctx, (on('dept') ? deptHTML(ctx, nums.dept) : '') + (on('level') ? levelHTML(ctx, nums.level) : '')));
    if (on('leaders')) pages.push(pageHTML(ctx, leadersHTML(ctx, nums.leaders)));
    if (on('table')) pages.push(pageHTML(ctx, tableHTML(ctx, nums.table)));
    if (on('insights')) pages.push(pageHTML(ctx, insightsHTML(ctx, nums.insights)));
    if (hasCmp) pages.push(pageHTML(ctx, compareHTML(ctx, nums.compare)));

    host.innerHTML = pages.length
      ? pages.join('')
      : `<div class="rp-page rp-page-empty"><div class="rp-empty-state">${ic('eye', 28)}<p>Nenhuma seção selecionada.</p><small>Marque ao menos uma seção na barra superior.</small></div></div>`;

    if (on('chart') && ctx.nodes.length) renderChart(host.querySelector('.rp-chart'), ctx);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 300);
  }

  /* ---------- organogram ---------- */
  function renderChart(el, ctx) {
    if (!el) return;
    const nodes = ctx.nodes.map((n) => Object.assign({}, n, { collapsed: false }));
    const opts = Object.assign({}, OG.Store.ui || {}, { expandAll: true, theme: 'light' });
    const maxHmm = CHART_MAX_H[state.orientation] || CHART_MAX_H.portrait;
    let done = false;

    if (OG.Exporter && typeof OG.Exporter.buildSVG === 'function') {
      try {
        let svgStr = OG.Exporter.buildSVG(nodes, opts);
        if (svgStr) {
          svgStr = String(svgStr).replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/<!DOCTYPE[^>]*>/i, '');
          el.innerHTML = svgStr;
          const svg = el.querySelector('svg');
          if (svg) {
            const w = parseFloat(svg.getAttribute('width'));
            const h = parseFloat(svg.getAttribute('height'));
            if (!svg.getAttribute('viewBox') && w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
            svg.classList.add('rp-chart-svg');
            svg.style.width = '100%';
            svg.style.height = 'auto';
            svg.style.maxHeight = maxHmm + 'mm';
            if (vb.length === 4 && vb[2] > 0) svg.style.maxWidth = Math.round(vb[2] * 1.15) + 'px'; // avoid blowing up tiny charts
            done = true;
          }
        }
      } catch (e) {
        console.warn('OrgFlow relatório: falha no Exporter.buildSVG', e);
      }
    }

    if (!done && OG.Chart && typeof OG.Chart.render === 'function') {
      try {
        el.innerHTML = '<div class="rp-chart-inner"></div>';
        const inner = el.firstElementChild;
        const size = OG.Chart.render(inner, nodes, Object.assign({}, opts, { interactive: false })) || {};
        const w = size.width || inner.scrollWidth || 1;
        const h = size.height || inner.scrollHeight || 1;
        const availW = el.clientWidth || 690;
        const availH = maxHmm * MM;
        const s = Math.min(1, availW / w, availH / h);
        inner.style.width = w + 'px';
        inner.style.height = h + 'px';
        inner.style.transformOrigin = 'top left';
        inner.style.transform = `scale(${s})`;
        inner.style.marginLeft = Math.max(0, (availW - w * s) / 2) + 'px';
        el.style.height = Math.ceil(h * s) + 'px';
        done = true;
      } catch (e) {
        console.warn('OrgFlow relatório: falha no Chart.render', e);
      }
    }

    if (!done) el.innerHTML = '<p class="rp-empty">Não foi possível gerar a imagem do organograma.</p>';
  }

  // hosted viewers cannot print: save the report as an HTML file that prints on its own
  async function saveStandalone() {
    const css = await fetch('css/report.css').then((r) => r.text());
    const page = `@page { size: A4 ${state.orientation}; margin: 12mm; }`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(OG.Store.project.name)}</title><style>${css}${page}</style></head>
      <body class="og-report-open" onload="setTimeout(function(){print()},300)"><div id="og-report" class="${root.className}">${root.querySelector('.rp-pages').outerHTML}</div></body></html>`;
    OG.Exporter.download(html, `relatorio-${slug(OG.Store.project.name)}.html`, 'text/html');
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.getAttribute('data-act');
      if (a === 'close') close();
      else if (a === 'print') {
        if (renderTimer) render();
        if (window.claude && window.claude.use) saveStandalone();
        else window.print();
      } else if (a === 'csv') {
        if (OG.Exporter && typeof OG.Exporter.exportCSV === 'function') {
          OG.Exporter.exportCSV(OG.Store.nodes, `${slug(OG.Store.project.name)}-${slug(OG.Store.version.name)}.csv`);
        } else {
          alert('A exportação CSV não está disponível nesta versão do aplicativo.');
        }
      }
      return;
    }
    const ob = e.target.closest('[data-orient]');
    if (ob) {
      const o = ob.getAttribute('data-orient');
      if (o !== state.orientation) {
        state.orientation = o;
        savePrefs();
        applyOrientation();
        render();
      }
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches('[data-sec]')) {
      state.sections[t.getAttribute('data-sec')] = t.checked;
      savePrefs();
      render();
    } else if (t.matches('[data-ctl="compare"]')) {
      state.compareId = t.value;
      if (state.compareId) state.sections.compare = true;
      savePrefs();
      refreshToolbar();
      render();
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-ctl="author"]')) {
      OG.Store.project.author = t.value;
      OG.Store.scheduleSave();
      scheduleRender();
    } else if (t.matches('[data-ctl="notes"]')) {
      OG.Store.project.reportNotes = t.value;
      OG.Store.scheduleSave();
      autoGrow(t);
      scheduleRender();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    // keep app shortcuts (delete, undo, arrows...) from acting behind the overlay
    e.stopPropagation();
  }
  // fallback when focus ended up outside the overlay
  function onDocKey(e) {
    if (root && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /* ---------- public ---------- */
  // opts (optional): { compareWith: versionId }
  function open(opts) {
    opts = opts || {};
    if (!OG.Store || !OG.Store.project) return;
    if (!OG.Analytics) {
      alert('Módulo de análise não carregado.');
      return;
    }
    close();
    loadPrefs();
    if (opts.compareWith) {
      state.compareId = opts.compareWith;
      state.sections.compare = true;
    }
    if (state.compareId && !otherVersions().some((v) => v.id === state.compareId)) state.compareId = '';

    root = document.createElement('div');
    root.id = 'og-report';
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Relatório do organograma');
    root.innerHTML = toolbarHTML() + '<div class="rp-pages"></div>';
    document.body.appendChild(root);
    document.body.classList.add('og-report-open');

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onDocKey, true);

    fillInputs();
    applyOrientation();
    render();
    try {
      root.focus({ preventScroll: true });
    } catch (e) {
      root.focus();
    }
  }

  function close() {
    clearTimeout(renderTimer);
    renderTimer = null;
    const el = document.getElementById('og-report');
    if (el) el.remove();
    root = null;
    document.removeEventListener('keydown', onDocKey, true);
    document.body.classList.remove('og-report-open');
    const st = document.getElementById('og-page-style');
    if (st) st.remove();
  }

  OG.Report = { open, close, isOpen: () => !!root, render };
})();
