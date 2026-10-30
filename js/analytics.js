/* OrgFlow — analytics: pure functions over a nodes array (any version) */
(function () {
  const OG = (window.OG = window.OG || {});
  const NO_DEPT = 'Sem departamento';
  const HIGH_SPAN = 8;
  const MAX_DEPTH = 6;

  const round1 = (n) => Math.round(n * 10) / 10;
  const pctOf = (n, total) => (total ? round1((n / total) * 100) : 0);
  const roleOf = (n) => (n && String(n.role || '').trim()) || 'Função sem nome';
  const nf1 = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

  function levelIndex(node, levels) {
    const i = levels.findIndex((l) => l.id === node.level);
    return i < 0 ? levels.length - 1 : i;
  }

  // "A, B, C e mais 3"
  function listText(items, max) {
    max = max || 6;
    if (items.length <= max) {
      if (items.length <= 1) return items.join('');
      return items.slice(0, -1).join('; ') + ' e ' + items[items.length - 1];
    }
    return items.slice(0, max).join('; ') + ' e mais ' + (items.length - max);
  }

  /* ---------- tree helpers ---------- */
  function tree(nodes) {
    nodes = nodes || [];
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    const childrenMap = { _: [] };
    nodes.forEach((n) => (childrenMap[n.id] = childrenMap[n.id] || []));
    nodes.forEach((n) => {
      const k = n.parentId && n.parentId !== n.id && byId[n.parentId] ? n.parentId : '_';
      childrenMap[k].push(n);
    });

    const roots = childrenMap._.slice();
    const order = [];
    const numbering = {};
    const depthOf = {};
    const seen = new Set();

    function walk(list, prefix, depth, start) {
      let i = start || 0;
      for (const n of list) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        i++;
        const num = prefix ? prefix + '.' + i : String(i);
        numbering[n.id] = num;
        depthOf[n.id] = depth;
        order.push(n);
        walk(childrenMap[n.id] || [], num, depth + 1, 0);
      }
      return i;
    }
    let rootCount = walk(roots, '', 0, 0);
    // nodes trapped in parent cycles: promote them to roots so nothing is lost
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      roots.push(n);
      rootCount = walk([n], '', 0, rootCount);
    }

    const descMemo = {};
    function descendantsCount(id) {
      if (descMemo[id] != null) return descMemo[id];
      let count = 0;
      const stack = (childrenMap[id] || []).slice();
      const visited = new Set([id]);
      while (stack.length) {
        const c = stack.pop();
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        count++;
        (childrenMap[c.id] || []).forEach((k) => stack.push(k));
      }
      descMemo[id] = count;
      return count;
    }

    return {
      byId,
      childrenMap,
      roots,
      order,
      numbering,
      depthOf,
      children: (id) => childrenMap[id || '_'] || [],
      parentOf: (node) => (node && node.parentId && node.parentId !== node.id ? byId[node.parentId] || null : null),
      descendantsCount,
    };
  }

  /* ---------- stats ---------- */
  function stats(nodes, levels) {
    nodes = nodes || [];
    levels = levels || [];
    const t = tree(nodes);
    const total = nodes.length;
    const vacant = nodes.filter((n) => n.vacant === true).length;
    const unnamed = nodes.filter((n) => n.vacant !== true && !String(n.name || '').trim()).length;
    const leaderNodes = t.order.filter((n) => t.children(n.id).length > 0);
    const spanSum = leaderNodes.reduce((s, n) => s + t.children(n.id).length, 0);

    let maxSpan = { node: null, count: 0 };
    leaderNodes.forEach((n) => {
      const c = t.children(n.id).length;
      if (c > maxSpan.count) maxSpan = { node: n, count: c };
    });

    let depth = 0;
    for (const id in t.depthOf) depth = Math.max(depth, t.depthOf[id] + 1);

    const deptMap = new Map();
    nodes.forEach((n) => {
      const name = String(n.dept || '').trim() || NO_DEPT;
      const d = deptMap.get(name) || { name, count: 0, vacant: 0, pct: 0 };
      d.count++;
      if (n.vacant === true) d.vacant++;
      deptMap.set(name, d);
    });
    const byDept = Array.from(deptMap.values())
      .map((d) => ({ ...d, pct: pctOf(d.count, total) }))
      .sort((a, b) => b.count - a.count || (a.name === NO_DEPT) - (b.name === NO_DEPT) || a.name.localeCompare(b.name, 'pt-BR'));

    const lvCount = levels.map(() => ({ count: 0, vacant: 0 }));
    if (levels.length) {
      nodes.forEach((n) => {
        const i = levelIndex(n, levels);
        lvCount[i].count++;
        if (n.vacant === true) lvCount[i].vacant++;
      });
    }
    const byLevel = levels.map((l, i) => ({ level: l, count: lvCount[i].count, vacant: lvCount[i].vacant, pct: pctOf(lvCount[i].count, total) }));

    return {
      total,
      filled: total - vacant,
      vacant,
      unnamed,
      leaders: leaderNodes.length,
      leaderNodes,
      depth,
      avgSpan: leaderNodes.length ? round1(spanSum / leaderNodes.length) : 0,
      maxSpan,
      byDept,
      deptCount: byDept.filter((d) => d.name !== NO_DEPT).length,
      byLevel,
      levelsUsed: byLevel.filter((l) => l.count > 0).length,
      roots: t.roots,
    };
  }

  /* ---------- insights ---------- */
  function insights(nodes, levels) {
    nodes = nodes || [];
    levels = levels || [];
    const t = tree(nodes);
    const warn = [];
    const info = [];
    if (!nodes.length) return [{ type: 'info', title: 'Estrutura vazia', text: 'A versão não possui posições cadastradas.', nodeIds: [] }];

    const leaders = t.order.filter((n) => t.children(n.id).length > 0);

    // high span of control
    const high = leaders.filter((n) => t.children(n.id).length > HIGH_SPAN).sort((a, b) => t.children(b.id).length - t.children(a.id).length);
    if (high.length) {
      warn.push({
        type: 'warn',
        title: 'Amplitude de controle elevada',
        text:
          (high.length === 1 ? '1 liderança possui' : high.length + ' lideranças possuem') +
          ' mais de ' + HIGH_SPAN + ' subordinados diretos: ' +
          listText(high.map((n) => roleOf(n) + ' (' + t.children(n.id).length + ')')) +
          '. Avalie criar níveis intermediários de coordenação ou redistribuir as equipes.',
        nodeIds: high.map((n) => n.id),
      });
    }

    // span of one
    const single = leaders.filter((n) => t.children(n.id).length === 1);
    if (single.length) {
      info.push({
        type: 'info',
        title: 'Lideranças com apenas um subordinado',
        text:
          (single.length === 1 ? '1 liderança possui' : single.length + ' lideranças possuem') +
          ' um único subordinado direto, o que pode indicar uma camada hierárquica redundante: ' +
          listText(single.map((n) => roleOf(n) + ' → ' + roleOf(t.children(n.id)[0]))) + '.',
        nodeIds: single.map((n) => n.id),
      });
    }

    // vacancies
    const vac = t.order.filter((n) => n.vacant === true);
    if (vac.length) {
      warn.push({
        type: 'warn',
        title: 'Vagas em aberto',
        text:
          (vac.length === 1 ? '1 posição está em aberto' : vac.length + ' posições estão em aberto') +
          ' (' + nf1(pctOf(vac.length, nodes.length)) + '% do quadro): ' +
          listText(vac.map((n) => roleOf(n) + (n.dept ? ' — ' + n.dept : '')), 8) + '.',
        nodeIds: vac.map((n) => n.id),
      });
    }

    // without department
    const noDept = t.order.filter((n) => !String(n.dept || '').trim());
    if (noDept.length) {
      warn.push({
        type: 'warn',
        title: 'Posições sem departamento',
        text:
          (noDept.length === 1 ? '1 posição não possui' : noDept.length + ' posições não possuem') +
          ' departamento definido: ' + listText(noDept.map(roleOf)) + '.',
        nodeIds: noDept.map((n) => n.id),
      });
    }

    // level inversions (index: lower = higher rank)
    if (levels.length) {
      const inv = [];
      const same = [];
      const invIds = new Set();
      const sameIds = new Set();
      leaders.forEach((p) => {
        const pi = levelIndex(p, levels);
        t.children(p.id).forEach((c) => {
          const ci = levelIndex(c, levels);
          if (pi > ci) {
            inv.push(roleOf(p) + ' (' + levels[pi].name + ') → ' + roleOf(c) + ' (' + levels[ci].name + ')');
            invIds.add(p.id).add(c.id);
          } else if (pi === ci) {
            same.push(roleOf(p) + ' → ' + roleOf(c));
            sameIds.add(p.id).add(c.id);
          }
        });
      });
      if (inv.length) {
        warn.push({
          type: 'warn',
          title: 'Inversão de nível hierárquico',
          text: 'Há superiores com nível hierárquico inferior ao de um subordinado direto: ' + listText(inv) + '. Revise a classificação de níveis.',
          nodeIds: Array.from(invIds),
        });
      }
      if (same.length) {
        info.push({
          type: 'info',
          title: 'Superior e subordinado no mesmo nível',
          text: (same.length === 1 ? '1 relação' : same.length + ' relações') + ' de subordinação ocorrem entre posições do mesmo nível hierárquico: ' + listText(same) + '.',
          nodeIds: Array.from(sameIds),
        });
      }
    }

    // very deep chains
    let depth = 0;
    for (const id in t.depthOf) depth = Math.max(depth, t.depthOf[id] + 1);
    if (depth > MAX_DEPTH) {
      const deep = t.order.filter((n) => t.depthOf[n.id] >= MAX_DEPTH);
      const deepest = t.order.filter((n) => t.depthOf[n.id] + 1 === depth);
      warn.push({
        type: 'warn',
        title: 'Cadeia hierárquica muito longa',
        text:
          'A estrutura possui ' + depth + ' níveis hierárquicos (recomendado até ' + MAX_DEPTH + '). Cadeias longas tornam a comunicação e a tomada de decisão mais lentas. Posições mais profundas: ' +
          listText(deepest.map(roleOf)) + '.',
        nodeIds: deep.map((n) => n.id),
      });
    }

    // duplicated occupants
    const byName = new Map();
    t.order.forEach((n) => {
      if (n.vacant === true) return;
      const nm = String(n.name || '').trim();
      if (!nm) return;
      const k = nm.toLocaleLowerCase('pt-BR');
      if (!byName.has(k)) byName.set(k, { name: nm, nodes: [] });
      byName.get(k).nodes.push(n);
    });
    const dups = Array.from(byName.values()).filter((d) => d.nodes.length > 1);
    if (dups.length) {
      info.push({
        type: 'info',
        title: 'Ocupante em mais de uma posição',
        text:
          (dups.length === 1 ? '1 pessoa aparece' : dups.length + ' pessoas aparecem') +
          ' em mais de uma posição (acúmulo de funções ou cadastro duplicado): ' +
          listText(dups.map((d) => d.name + ' (' + d.nodes.map(roleOf).join(', ') + ')')) + '.',
        nodeIds: [].concat(...dups.map((d) => d.nodes.map((n) => n.id))),
      });
    }

    // occupant not informed
    const unnamed = t.order.filter((n) => n.vacant !== true && !String(n.name || '').trim());
    if (unnamed.length) {
      info.push({
        type: 'info',
        title: 'Ocupantes não informados',
        text:
          (unnamed.length === nodes.length
            ? 'Nenhuma posição possui ocupante informado'
            : (unnamed.length === 1 ? '1 posição não possui' : unnamed.length + ' posições não possuem') + ' ocupante informado') +
          ' (e não estão marcadas como vaga em aberto).',
        nodeIds: unnamed.map((n) => n.id),
      });
    }

    const out = warn.concat(info);
    if (!out.length) {
      out.push({
        type: 'ok',
        title: 'Estrutura consistente',
        text: 'Nenhum ponto de atenção foi identificado: amplitudes de controle adequadas, níveis coerentes, todas as posições ocupadas e com departamento definido.',
        nodeIds: [],
      });
    }
    return out;
  }

  /* ---------- version comparison (A = base/older, B = current) ---------- */
  const FIELDS = [
    { field: 'role', label: 'Função' },
    { field: 'name', label: 'Ocupante' },
    { field: 'dept', label: 'Departamento' },
    { field: 'level', label: 'Nível' },
    { field: 'vacant', label: 'Situação' },
  ];

  function compare(nodesA, nodesB, levels) {
    nodesA = nodesA || [];
    nodesB = nodesB || [];
    levels = levels || (OG.Store && OG.Store.project && OG.Store.project.levels) || [];
    const levelName = (id) => {
      const l = levels.find((x) => x.id === id);
      return l ? l.name : id || '—';
    };
    const tA = tree(nodesA);
    const tB = tree(nodesB);
    const A = tA.byId;
    const B = tB.byId;
    const parentIn = (map, n) => (n.parentId && n.parentId !== n.id && map[n.parentId] ? n.parentId : null);
    const txt = (v) => String(v == null ? '' : v).trim();
    const display = (field, v) => {
      if (field === 'vacant') return v ? 'Vaga em aberto' : 'Ocupada';
      if (field === 'level') return levelName(v);
      return txt(v) || '—';
    };

    const added = tB.order.filter((n) => !A[n.id]);
    const removed = tA.order.filter((n) => !B[n.id]);
    const changed = [];
    const moved = [];

    tB.order.forEach((b) => {
      const a = A[b.id];
      if (!a) return;
      const changes = [];
      FIELDS.forEach(({ field, label }) => {
        const differs = field === 'vacant' ? !!a.vacant !== !!b.vacant : txt(a[field]) !== txt(b[field]);
        if (differs) changes.push({ field, label, from: display(field, a[field]), to: display(field, b[field]) });
      });
      if (changes.length) changed.push({ node: b, changes });
      const pa = parentIn(A, a);
      const pb = parentIn(B, b);
      if (pa !== pb) {
        moved.push({
          node: b,
          fromParent: pa ? roleOf(A[pa]) : 'Topo (sem superior)',
          toParent: pb ? roleOf(B[pb]) : 'Topo (sem superior)',
          fromParentId: pa,
          toParentId: pb,
        });
      }
    });

    const vacantA = nodesA.filter((n) => n.vacant === true).length;
    const vacantB = nodesB.filter((n) => n.vacant === true).length;
    return {
      added,
      removed,
      changed,
      moved,
      summary: {
        added: added.length,
        removed: removed.length,
        changed: changed.length,
        moved: moved.length,
        unchanged: nodesB.filter((n) => A[n.id]).length - new Set(changed.map((c) => c.node.id).concat(moved.map((m) => m.node.id))).size,
        totalA: nodesA.length,
        totalB: nodesB.length,
        delta: nodesB.length - nodesA.length,
        vacantA,
        vacantB,
      },
    };
  }

  OG.Analytics = { stats, tree, insights, compare, levelIndex, NO_DEPT, HIGH_SPAN, MAX_DEPTH };
})();
