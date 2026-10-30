/* OrgFlow — store: data model, versions, undo/redo, persistence, outline parser */
(function () {
  const OG = (window.OG = window.OG || {});
  const KEY = 'orgflow.project.v1';

  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  OG.uid = uid;

  const DEFAULT_LEVELS = [
    { id: 'l1', name: 'Presidência / Diretoria', color: '#7c3aed' },
    { id: 'l2', name: 'Gerência', color: '#2563eb' },
    { id: 'l3', name: 'Coordenação', color: '#0891b2' },
    { id: 'l4', name: 'Supervisão / Liderança', color: '#059669' },
    { id: 'l5', name: 'Operacional / Técnico', color: '#64748b' },
  ];
  const DEPT_PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#9333ea', '#0d9488', '#ea580c', '#4f46e5', '#be185d', '#15803d'];
  OG.DEPT_PALETTE = DEPT_PALETTE;

  const DEFAULT_UI = {
    layout: 'compacto', // vertical | horizontal | compacto | lista
    cardStyle: 'classico', // classico | moderno | minimal | compacto
    colorBy: 'level', // level | dept | none
    showPhotos: true,
    showDept: true,
    showCount: true,
    showName: true,
    showDiff: true,
    theme: 'light',
    panelOpen: true,
  };

  /* ---------- icon guessing by keywords ---------- */
  const ICON_RULES = [
    [/\b(ceo|presiden|diretor[a]? geral|fundador|s[oó]ci[oa]|conselho|owner)/i, 'crown'],
    [/financ|tesour|fiscal|cobran|faturamento/i, 'dollar'],
    [/cont[aá]b|contador|custos|controladoria/i, 'calculator'],
    [/\bti\b|tecnolog|desenvolv|program|software|sistemas|dev\b|infra/i, 'code'],
    [/dados|data|bi\b|analytics|banco de dados/i, 'database'],
    [/\brh\b|recursos humanos|pessoas|gente|talent|dp\b|departamento pessoal|recrut/i, 'users'],
    [/comercial|vendas|vendedor|venda|neg[oó]cios|key account|representante/i, 'trending'],
    [/marketing|comunica|m[ií]dia|social|publicidade/i, 'megaphone'],
    [/log[ií]stic|transporte|frota|expedi|motorista|entrega/i, 'truck'],
    [/estoque|almoxarif|armaz[eé]m|invent/i, 'package'],
    [/produ[cç][aã]o|f[aá]brica|industri|opera[cç][aã]o|operador|montag/i, 'factory'],
    [/qualidade|auditor|certifica|melhoria/i, 'award'],
    [/jur[ií]dic|legal|advoga|compliance|contrat/i, 'scale'],
    [/compras|suprimento|procurement|comprador/i, 'cart'],
    [/atendimento|suporte|sac\b|call|relacionamento|cliente|recep/i, 'headset'],
    [/manuten[cç]|mec[aâ]nic|eletric|t[eé]cnico de/i, 'wrench'],
    [/seguran[cç]a do trabalho|sesmt|ehs|sst/i, 'hardhat'],
    [/seguran[cç]a|vigil|portaria|patrim/i, 'shield'],
    [/engenh|projetista|automa/i, 'cpu'],
    [/sa[uú]de|enferm|m[eé]dic|cl[ií]nic/i, 'stethoscope'],
    [/design|criativ|arte|ux|ui\b/i, 'palette'],
    [/p&d|pesquisa|laborat|inova/i, 'flask'],
    [/treinamento|educa|ensino|professor|universidade/i, 'graduation'],
    [/projeto|pmo|planejamento|estrat/i, 'target'],
    [/administra|secret[aá]ri|assistente|auxiliar adm|escrit/i, 'clipboard'],
    [/cozinha|restaurante|alimenta|refei/i, 'utensils'],
    [/sustentab|ambient/i, 'leaf'],
    [/limpeza|servi[cç]os gerais|facilities|predial/i, 'home'],
    [/ger[eê]n|coorden|supervis|l[ií]der|chefe|head/i, 'briefcase'],
    [/diretor/i, 'star'],
  ];
  OG.guessIcon = function (text) {
    text = text || '';
    for (const [re, icon] of ICON_RULES) if (re.test(text)) return icon;
    return 'user';
  };

  function newVersion(name, nodes) {
    const now = Date.now();
    return { id: uid(), name, createdAt: now, updatedAt: now, nodes: nodes || [] };
  }

  function newProject(name, nodes) {
    const v = newVersion('Versão 1', nodes || []);
    return {
      app: 'orgflow',
      schema: 1,
      id: uid(),
      name: name || 'Meu Organograma',
      versions: [v],
      currentVersionId: v.id,
      levels: JSON.parse(JSON.stringify(DEFAULT_LEVELS)),
      depts: {},
      ui: { ...DEFAULT_UI },
      author: '',
    };
  }

  // ids, colors and photos end up inside HTML attributes — only accept safe shapes
  const safeId = (v) => (v == null || v === '' ? '' : String(v).replace(/[^\w-]/g, '_'));
  const safeColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
  const safePhoto = (v) => (typeof v === 'string' && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(v) ? v : null);
  OG.safeId = safeId;
  OG.safeColor = safeColor;

  function normalizeNode(n) {
    return {
      id: safeId(n.id) || uid(),
      parentId: safeId(n.parentId) || null,
      role: String(n.role || ''),
      name: String(n.name || ''),
      dept: String(n.dept || ''),
      level: safeId(n.level) || 'l5',
      icon: n.icon && OG.ICONS && OG.ICONS[n.icon] ? n.icon : null,
      photo: safePhoto(n.photo),
      color: safeColor(n.color),
      vacant: !!n.vacant,
      email: n.email || '',
      phone: n.phone || '',
      notes: n.notes || '',
      collapsed: !!n.collapsed,
      // dashed links to positions in other areas
      coLinks: (Array.isArray(n.coLinks) ? n.coLinks : []).map((l) => ({ to: safeId(l && l.to), label: String((l && l.label) || '') })).filter((l) => l.to),
    };
  }
  OG.normalizeNode = normalizeNode;

  // make parent links acyclic: any node whose ancestor chain loops back becomes a root
  function breakCycles(nodes) {
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    for (const n of nodes) {
      const seen = new Set([n.id]);
      let p = n.parentId && byId[n.parentId];
      while (p) {
        if (seen.has(p.id)) {
          n.parentId = null;
          break;
        }
        seen.add(p.id);
        p = p.parentId && byId[p.parentId];
      }
    }
    return nodes;
  }
  OG.breakCycles = breakCycles;

  /* ---------- outline (indented text) parser ---------- */
  // Each line: "Função | Nome | Departamento | Nível | Ícone" — indentation defines hierarchy.
  OG.parseOutline = function (text, levels) {
    levels = levels || DEFAULT_LEVELS;
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    const stack = []; // {indent, id}
    for (let raw of lines) {
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const expanded = raw.replace(/\t/g, '    ');
      let indent = expanded.match(/^\s*/)[0].length;
      let body = expanded.trim();
      // markdown-ish bullets add depth info too (e.g. "- ", "* ", "• ", "1.2 ")
      const bullet = body.match(/^((?:[-*•>]+)|(?:\d+(?:\.\d+)*\.?))\s+/);
      if (bullet) {
        if (/^\d/.test(bullet[1])) indent += (bullet[1].replace(/\.$/, '').split('.').length - 1) * 4;
        body = body.slice(bullet[0].length);
      }
      let parts;
      if (body.includes('|')) parts = body.split('|');
      else if (body.includes(';')) parts = body.split(';');
      else if (/\s[-–—]\s/.test(body)) parts = body.split(/\s[-–—]\s/);
      else parts = [body];
      parts = parts.map((s) => s.trim());
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parentId = stack.length ? stack[stack.length - 1].id : null;
      const depth = stack.length;
      let [role, name, dept, lvl, icon] = parts;
      let vacant = false;
      if (name && /^\(?\s*(vaga|vago|a contratar|em aberto|tbd)\s*\)?$/i.test(name)) {
        vacant = true;
        name = '';
      }
      let level = null;
      if (lvl) {
        const num = parseInt(lvl, 10);
        if (!isNaN(num) && levels[num - 1]) level = levels[num - 1].id;
        else {
          const f = levels.find((l) => l.name.toLowerCase().includes(lvl.toLowerCase()) || l.id === lvl);
          if (f) level = f.id;
        }
      }
      if (!level) level = levels[Math.min(depth, levels.length - 1)].id;
      const node = normalizeNode({ parentId, role: role || 'Função', name: name || '', dept: dept || '', level, icon: icon || null, vacant });
      out.push(node);
      stack.push({ indent, id: node.id });
    }
    // inherit department from parent when empty (except the root level)
    const map = Object.fromEntries(out.map((n) => [n.id, n]));
    for (const n of out) {
      if (!n.dept && n.parentId && map[n.parentId] && map[n.parentId].parentId) n.dept = map[n.parentId].dept;
    }
    return out;
  };

  OG.toOutline = function (nodes, levels) {
    levels = levels || DEFAULT_LEVELS;
    const kids = {};
    nodes.forEach((n) => (kids[n.parentId || '_'] = kids[n.parentId || '_'] || []).push(n));
    const lines = [];
    const walk = (pid, d) =>
      (kids[pid] || []).forEach((n) => {
        const li = levels.findIndex((l) => l.id === n.level) + 1;
        const cols = [n.role, n.vacant ? 'Vaga' : n.name, n.dept, li || ''];
        while (cols.length && !cols[cols.length - 1]) cols.pop();
        lines.push('  '.repeat(d) + cols.join(' | '));
        walk(n.id, d + 1);
      });
    walk('_', 0);
    return lines.join('\n');
  };

  /* ---------- templates ---------- */
  OG.TEMPLATES = [
    {
      id: 'exemplo',
      name: 'Empresa exemplo (completa)',
      desc: 'Diretoria, gerências, coordenações e equipes',
      text: `Diretor Presidente | Ana Ribeiro | Diretoria | 1
  Assistente Executiva | Carla Mendes | Diretoria | 5
  Diretor Administrativo-Financeiro | Paulo Souza | Financeiro | 1
    Gerente Financeiro | Marina Costa | Financeiro | 2
      Analista Financeiro | Lucas Prado | Financeiro | 5
      Analista Financeiro | Vaga | Financeiro | 5
      Assistente de Contas a Pagar | Bianca Lopes | Financeiro | 5
    Coordenador de Contabilidade | Renato Alves | Contabilidade | 3
      Contador | Fernanda Dias | Contabilidade | 5
      Auxiliar Contábil | Diego Rocha | Contabilidade | 5
    Gerente de RH | Juliana Martins | RH | 2
      Analista de Recrutamento | Patrícia Gomes | RH | 5
      Analista de Departamento Pessoal | Vaga | RH | 5
  Diretor de Operações | Ricardo Lima | Operações | 1
    Gerente de Produção | Eduardo Nunes | Produção | 2
      Supervisor de Produção | Tiago Ferreira | Produção | 4
        Operador de Máquinas | Bruno Santos | Produção | 5
        Operador de Máquinas | André Melo | Produção | 5
        Auxiliar de Produção | Vaga | Produção | 5
      Coordenador de Qualidade | Sônia Barros | Qualidade | 3
        Inspetor de Qualidade | Rafael Pinto | Qualidade | 5
    Gerente de Logística | Camila Araújo | Logística | 2
      Supervisor de Expedição | Márcio Teixeira | Logística | 4
        Conferente | Gustavo Reis | Logística | 5
        Motorista | Leandro Cruz | Logística | 5
      Almoxarife | Vinícius Cardoso | Logística | 5
  Diretor Comercial | Beatriz Fontes | Comercial | 1
    Gerente de Vendas | Felipe Moura | Comercial | 2
      Executivo de Contas | Larissa Vieira | Comercial | 5
      Executivo de Contas | Henrique Castro | Comercial | 5
    Coordenador de Marketing | Aline Rocha | Marketing | 3
      Analista de Marketing Digital | Igor Batista | Marketing | 5
      Designer | Vaga | Marketing | 5
    Coordenador de Atendimento | Débora Freitas | Atendimento | 3
      Atendente | Natália Campos | Atendimento | 5
      Atendente | Otávio Ramos | Atendimento | 5`,
    },
    {
      id: 'pequena',
      name: 'Pequena empresa',
      desc: 'Estrutura enxuta com sócios e 3 áreas',
      text: `Sócio-Diretor | | Diretoria | 1
  Gerente Administrativo | | Administrativo | 2
    Assistente Administrativo | | Administrativo | 5
    Auxiliar Financeiro | | Financeiro | 5
  Gerente Comercial | | Comercial | 2
    Vendedor | | Comercial | 5
    Vendedor | | Comercial | 5
  Coordenador de Operações | | Operações | 3
    Técnico | | Operações | 5
    Técnico | | Operações | 5`,
    },
    {
      id: 'tech',
      name: 'Empresa de tecnologia',
      desc: 'CEO, CTO, produto, engenharia e growth',
      text: `CEO | | Diretoria | 1
  CTO | | Tecnologia | 1
    Head de Engenharia | | Tecnologia | 2
      Tech Lead Backend | | Tecnologia | 4
        Desenvolvedor Backend | | Tecnologia | 5
        Desenvolvedor Backend | | Tecnologia | 5
      Tech Lead Frontend | | Tecnologia | 4
        Desenvolvedor Frontend | | Tecnologia | 5
        Desenvolvedor Mobile | | Tecnologia | 5
      Engenheiro DevOps / Infra | | Tecnologia | 5
    Head de Dados | | Dados | 2
      Cientista de Dados | | Dados | 5
      Engenheiro de Dados | | Dados | 5
  CPO | | Produto | 1
    Product Manager | | Produto | 3
    Product Designer (UX/UI) | | Design | 5
  COO | | Operações | 1
    Head de Pessoas | | RH | 2
    Head Financeiro | | Financeiro | 2
    Customer Success | | Atendimento | 3
  CMO | | Marketing | 1
    Growth Marketing | | Marketing | 4
    Vendas B2B | | Comercial | 4`,
    },
    {
      id: 'industria',
      name: 'Indústria',
      desc: 'Diretoria industrial, produção, manutenção, qualidade, SST',
      text: `Diretor Industrial | | Diretoria | 1
  Gerente de Produção | | Produção | 2
    Supervisor de Produção - Turno A | | Produção | 4
      Líder de Linha | | Produção | 4
        Operador de Produção | | Produção | 5
        Operador de Produção | | Produção | 5
    Supervisor de Produção - Turno B | | Produção | 4
      Líder de Linha | | Produção | 4
        Operador de Produção | | Produção | 5
  Gerente de Manutenção | | Manutenção | 2
    Técnico de Manutenção Mecânica | | Manutenção | 5
    Técnico de Manutenção Elétrica | | Manutenção | 5
  Coordenador da Qualidade | | Qualidade | 3
    Inspetor da Qualidade | | Qualidade | 5
    Analista de Laboratório | | Qualidade | 5
  Coordenador de PCP | | Planejamento | 3
    Analista de PCP | | Planejamento | 5
  Técnico de Segurança do Trabalho | | SESMT | 5
  Engenheiro de Processos | | Engenharia | 3`,
    },
    {
      id: 'varejo',
      name: 'Varejo / Loja',
      desc: 'Gerência de loja, caixas, estoque e vendas',
      text: `Gerente Geral da Loja | | Gerência | 2
  Subgerente | | Gerência | 3
    Fiscal de Caixa | | Frente de Caixa | 4
      Operador de Caixa | | Frente de Caixa | 5
      Operador de Caixa | | Frente de Caixa | 5
      Operador de Caixa | | Frente de Caixa | 5
    Líder de Vendas | | Vendas | 4
      Vendedor | | Vendas | 5
      Vendedor | | Vendas | 5
  Encarregado de Estoque | | Estoque | 4
    Repositor | | Estoque | 5
    Conferente | | Estoque | 5
  Assistente Administrativo | | Administrativo | 5`,
    },
    {
      id: 'branco',
      name: 'Em branco',
      desc: 'Começar do zero com uma única posição',
      text: `Diretor(a) Geral | | Diretoria | 1`,
    },
  ];

  /* ---------- store ---------- */
  const listeners = [];
  let saveTimer = null;
  let cache = null;

  const Store = {
    project: null,
    undoStacks: {},
    redoStacks: {},
    _edit: null,
    lastSaveError: null,

    init() {
      let p = null;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) p = JSON.parse(raw);
      } catch (e) {
        console.warn('Falha ao carregar projeto salvo', e);
      }
      if (!p || !p.versions || !p.versions.length) {
        p = newProject('Organograma Exemplo', OG.parseOutline(OG.TEMPLATES[0].text));
      }
      this.project = this.sanitize(p);
      return this;
    },

    sanitize(p) {
      p.levels = Array.isArray(p.levels) && p.levels.length ? p.levels : JSON.parse(JSON.stringify(DEFAULT_LEVELS));
      p.levels = p.levels.map((l, i) => ({ id: safeId(l.id) || 'l' + uid(), name: String(l.name || 'Nível ' + (i + 1)), color: safeColor(l.color) || DEPT_PALETTE[i % DEPT_PALETTE.length] }));
      const depts = {};
      Object.entries(p.depts || {}).forEach(([k, c]) => safeColor(c) && (depts[k] = c));
      p.depts = depts;
      p.ui = { ...DEFAULT_UI, ...(p.ui || {}) };
      p.versions = p.versions.map((v) => ({ ...newVersion(String(v.name || 'Versão')), ...v, id: safeId(v.id) || uid(), name: String(v.name || 'Versão'), nodes: breakCycles((v.nodes || []).map(normalizeNode)) }));
      if (!p.versions.find((v) => v.id === p.currentVersionId)) p.currentVersionId = p.versions[0].id;
      p.name = p.name || 'Meu Organograma';
      p.author = p.author || '';
      return p;
    },

    newProject(name, nodes) {
      this.project = newProject(name, nodes);
      this.undoStacks = {};
      this.redoStacks = {};
      this.changed('project');
    },

    loadProject(p) {
      if (!p || !p.versions) throw new Error('Arquivo inválido');
      this.project = this.sanitize(p);
      this.undoStacks = {};
      this.redoStacks = {};
      this.changed('project');
    },

    /* events */
    on(fn) {
      listeners.push(fn);
    },
    changed(type) {
      cache = null;
      const v = this.version;
      if (v && type !== 'ui') v.updatedAt = Date.now();
      if (!this._edit) this.assignDeptColors();
      listeners.forEach((fn) => fn(type || 'change'));
      this.scheduleSave();
    },
    scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => this.saveNow(), 250);
    },
    saveNow() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.project));
        this.lastSaveError = null;
        listeners.forEach((fn) => fn('saved'));
      } catch (e) {
        this.lastSaveError = e;
        listeners.forEach((fn) => fn('save-error'));
      }
    },

    /* accessors */
    get version() {
      const p = this.project;
      return p.versions.find((v) => v.id === p.currentVersionId) || p.versions[0];
    },
    get nodes() {
      return this.version.nodes;
    },
    get ui() {
      return this.project.ui;
    },
    get levels() {
      return this.project.levels;
    },
    index() {
      if (cache && cache.nodes === this.nodes && cache.len === this.nodes.length) return cache;
      const byId = {};
      const kids = { _: [] };
      for (const n of this.nodes) {
        byId[n.id] = n;
        kids[n.id] = kids[n.id] || [];
      }
      for (const n of this.nodes) {
        const k = n.parentId && n.parentId !== n.id && byId[n.parentId] ? n.parentId : '_';
        (kids[k] = kids[k] || []).push(n);
      }
      cache = { nodes: this.nodes, len: this.nodes.length, byId, kids };
      return cache;
    },
    get(id) {
      return this.index().byId[id];
    },
    children(id) {
      return this.index().kids[id || '_'] || [];
    },
    roots() {
      return this.children(null);
    },
    descendants(id) {
      const out = [];
      const seen = new Set([id]);
      const walk = (pid) =>
        this.children(pid).forEach((c) => {
          if (seen.has(c.id)) return;
          seen.add(c.id);
          out.push(c);
          walk(c.id);
        });
      walk(id);
      return out;
    },
    ancestors(id) {
      const out = [];
      let n = this.get(id);
      const seen = new Set();
      while (n && n.parentId && !seen.has(n.parentId)) {
        seen.add(n.parentId);
        n = this.get(n.parentId);
        if (n) out.push(n);
      }
      return out;
    },
    depth(id) {
      return this.ancestors(id).length;
    },
    isDescendant(id, ofId) {
      return this.ancestors(id).some((a) => a.id === ofId);
    },
    levelOf(node) {
      return this.levels.find((l) => l.id === node.level) || this.levels[this.levels.length - 1];
    },
    deptColor(name) {
      if (!name) return '#94a3b8';
      const d = this.project.depts;
      if (d[name]) return d[name];
      // not assigned yet (e.g. while typing): stable hash-based color
      let h = 0;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return DEPT_PALETTE[h % DEPT_PALETTE.length];
    },
    // give every department in use a persistent color, preferring unused palette entries
    assignDeptColors() {
      const d = this.project.depts;
      let added = false;
      for (const name of this.allDepts()) {
        if (d[name]) continue;
        const used = new Set(Object.values(d));
        d[name] = DEPT_PALETTE.find((c) => !used.has(c)) || this.deptColor(name);
        added = true;
      }
      return added;
    },
    allDepts() {
      const set = [];
      for (const v of this.project.versions) for (const n of v.nodes) if (n.dept && !set.includes(n.dept)) set.push(n.dept);
      Object.keys(this.project.depts).forEach((k) => !set.includes(k) && set.push(k));
      return set;
    },
    colorFor(node, colorBy) {
      if (node.color) return node.color;
      colorBy = colorBy || this.ui.colorBy;
      if (colorBy === 'dept') return this.deptColor(node.dept);
      if (colorBy === 'none') return '#4f46e5';
      return this.levelOf(node).color;
    },
    iconFor(node) {
      if (node.icon) return node.icon;
      // the role decides first; the department is only a fallback
      const byRole = OG.guessIcon(node.role);
      return byRole !== 'user' ? byRole : OG.guessIcon(node.dept);
    },

    /* history */
    _snapshot() {
      return JSON.stringify(this.nodes);
    },
    _push(snap) {
      const vid = this.version.id;
      const u = (this.undoStacks[vid] = this.undoStacks[vid] || []);
      u.push(snap);
      if (u.length > 100) u.shift();
      this.redoStacks[vid] = [];
    },
    commit(fn) {
      if (this._edit) this.endEdit(); // close an open typing session first so history stays ordered
      const snap = this._snapshot();
      const r = fn();
      if (this._snapshot() !== snap) {
        this._push(snap);
        this.changed('nodes');
      }
      return r;
    },
    canUndo() {
      return (this.undoStacks[this.version.id] || []).length > 0;
    },
    canRedo() {
      return (this.redoStacks[this.version.id] || []).length > 0;
    },
    undo() {
      if (this._edit) this.endEdit();
      const vid = this.version.id;
      const u = this.undoStacks[vid] || [];
      if (!u.length) return false;
      (this.redoStacks[vid] = this.redoStacks[vid] || []).push(this._snapshot());
      this.version.nodes = JSON.parse(u.pop());
      this.changed('nodes');
      return true;
    },
    redo() {
      if (this._edit) this.endEdit();
      const vid = this.version.id;
      const r = this.redoStacks[vid] || [];
      if (!r.length) return false;
      (this.undoStacks[vid] = this.undoStacks[vid] || []).push(this._snapshot());
      this.version.nodes = JSON.parse(r.pop());
      this.changed('nodes');
      return true;
    },
    /* live editing (typing): one undo step per focus session */
    beginEdit() {
      this._edit = { snap: this._snapshot(), vid: this.version.id };
    },
    liveUpdate(id, patch) {
      const n = this.get(id);
      if (!n) return;
      if (!this._edit) this.beginEdit();
      Object.assign(n, patch);
      this.changed('nodes');
    },
    endEdit() {
      const e = this._edit;
      this._edit = null;
      if (e && e.vid === this.version.id && e.snap !== this._snapshot()) this._push(e.snap);
      if (this.assignDeptColors()) this.scheduleSave();
    },

    /* node mutations (all undoable) */
    _insertAt(node, afterId) {
      const arr = this.nodes;
      if (afterId) {
        // insert after the last descendant-free position of the sibling (array order defines sibling order)
        const i = arr.findIndex((n) => n.id === afterId);
        if (i >= 0) {
          arr.splice(i + 1, 0, node);
          return;
        }
      }
      arr.push(node);
    },
    defaultLevelBelow(parent) {
      if (!parent) return this.levels[0].id;
      const i = this.levels.findIndex((l) => l.id === parent.level);
      return this.levels[Math.min(i + 1, this.levels.length - 1)].id;
    },
    addChild(parentId, data) {
      return this.commit(() => {
        const parent = this.get(parentId);
        const node = normalizeNode({
          role: 'Nova função',
          dept: parent && parent.parentId ? parent.dept : '',
          level: this.defaultLevelBelow(parent),
          ...data,
          parentId: parent ? parent.id : null,
        });
        const sibs = this.children(parent ? parent.id : null);
        this._insertAt(node, sibs.length ? sibs[sibs.length - 1].id : null);
        if (parent) parent.collapsed = false;
        return node;
      });
    },
    addSibling(id, data) {
      const ref = this.get(id);
      if (!ref) return this.addChild(null, data);
      return this.commit(() => {
        const node = normalizeNode({ role: 'Nova função', dept: ref.dept, level: ref.level, ...data, parentId: ref.parentId });
        this._insertAt(node, ref.id);
        return node;
      });
    },
    update(id, patch) {
      return this.commit(() => {
        const n = this.get(id);
        if (n) Object.assign(n, patch);
      });
    },
    updateMany(ids, patch) {
      return this.commit(() => ids.forEach((id) => this.get(id) && Object.assign(this.get(id), patch)));
    },
    remove(id, keepChildren) {
      return this.commit(() => {
        const n = this.get(id);
        if (!n) return;
        let kill;
        if (keepChildren) {
          kill = new Set([id]);
          this.children(id).forEach((c) => (c.parentId = n.parentId));
        } else {
          kill = new Set([id, ...this.descendants(id).map((d) => d.id)]);
        }
        this.version.nodes = this.nodes.filter((x) => !kill.has(x.id));
        this.nodes.forEach((x) => (x.coLinks = (x.coLinks || []).filter((l) => !kill.has(l.to))));
      });
    },
    /* move node under newParentId; position: {beforeId} | {afterId} | undefined (last) */
    move(id, newParentId, position) {
      if (id === newParentId) return false;
      if (newParentId && this.isDescendant(newParentId, id)) return false;
      return this.commit(() => {
        const arr = this.nodes;
        const i = arr.findIndex((n) => n.id === id);
        if (i < 0) return;
        const [n] = arr.splice(i, 1);
        n.parentId = newParentId || null;
        cache = null;
        let at = -1;
        if (position && position.beforeId) at = arr.findIndex((x) => x.id === position.beforeId);
        else if (position && position.afterId) {
          at = arr.findIndex((x) => x.id === position.afterId);
          if (at >= 0) at += 1;
        }
        if (at < 0) arr.push(n);
        else arr.splice(at, 0, n);
        const p = this.get(newParentId);
        if (p) p.collapsed = false;
        cache = null;
        return true;
      });
    },
    duplicate(id) {
      return this.commit(() => {
        const n = this.get(id);
        if (!n) return;
        const branch = [n, ...this.descendants(id)];
        const map = {};
        branch.forEach((b) => (map[b.id] = uid()));
        const copies = branch.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: map[b.id], parentId: b.id === id ? b.parentId : map[b.parentId] }));
        // place copies after original's last node in array
        const lastIdx = Math.max(...branch.map((b) => this.nodes.indexOf(b)));
        this.nodes.splice(lastIdx + 1, 0, ...copies);
        return copies[0];
      });
    },
    setCollapsed(id, collapsed) {
      const n = this.get(id);
      if (!n) return;
      n.collapsed = collapsed;
      this.changed('view');
    },
    setAllCollapsed(collapsed, minDepth) {
      for (const n of this.nodes) {
        if (!this.children(n.id).length) continue;
        n.collapsed = collapsed && this.depth(n.id) >= (minDepth || 0);
      }
      this.changed('view');
    },
    replaceNodes(nodes) {
      return this.commit(() => {
        this.version.nodes = breakCycles(nodes.map(normalizeNode));
      });
    },
    appendNodes(nodes, underId) {
      return this.commit(() => {
        const ids = new Set(nodes.map((n) => n.id));
        nodes.forEach((n) => {
          if (!n.parentId || !ids.has(n.parentId)) n.parentId = underId || null;
        });
        this.version.nodes.push(...nodes.map(normalizeNode));
        breakCycles(this.version.nodes);
      });
    },

    /* versions */
    switchVersion(id) {
      if (this.project.versions.find((v) => v.id === id)) {
        this.project.currentVersionId = id;
        this.changed('version');
      }
    },
    createVersion(name, mode, initialNodes) {
      // mode: 'copy' (copy current) | 'blank'; initialNodes (array) overrides both
      const nodes = Array.isArray(initialNodes) ? breakCycles(initialNodes.map(normalizeNode)) : mode === 'blank' ? [normalizeNode({ role: 'Diretor(a) Geral', level: this.levels[0].id, dept: 'Diretoria' })] : JSON.parse(JSON.stringify(this.nodes));
      const v = newVersion(name || 'Versão ' + (this.project.versions.length + 1), nodes);
      this.project.versions.push(v);
      this.project.currentVersionId = v.id;
      this.changed('version');
      return v;
    },
    // the future scenario starts as a copy of its base, so node ids match for comparison
    createFuture(baseId) {
      const base = this.project.versions.find((v) => v.id === baseId);
      this.switchVersion(baseId);
      const v = this.createVersion(base.name + ' — Futuro', 'copy');
      v.baseVersionId = baseId;
      this.scheduleSave();
      return v;
    },
    renameVersion(id, name) {
      const v = this.project.versions.find((x) => x.id === id);
      if (v && name) {
        v.name = name;
        this.changed('version');
      }
    },
    deleteVersion(id) {
      const p = this.project;
      if (p.versions.length <= 1) return false;
      p.versions = p.versions.filter((v) => v.id !== id);
      if (p.currentVersionId === id) p.currentVersionId = p.versions[p.versions.length - 1].id;
      delete this.undoStacks[id];
      delete this.redoStacks[id];
      this.changed('version');
      return true;
    },

    /* project settings */
    setUI(patch) {
      Object.assign(this.project.ui, patch);
      this.changed('ui');
    },
    setProjectName(name) {
      this.project.name = name || 'Meu Organograma';
      this.changed('project-meta');
    },
    setLevels(levels) {
      this.project.levels = levels;
      this.changed('levels');
    },
    setDeptColor(name, color) {
      this.project.depts[name] = color;
      this.changed('levels');
    },
    renameDept(oldName, newName) {
      if (!newName || oldName === newName) return;
      this.commit(() => this.nodes.forEach((n) => n.dept === oldName && (n.dept = newName)));
      if (this.project.depts[oldName]) {
        this.project.depts[newName] = this.project.depts[oldName];
        delete this.project.depts[oldName];
      }
      this.changed('levels');
    },
  };

  OG.Store = Store;
})();
