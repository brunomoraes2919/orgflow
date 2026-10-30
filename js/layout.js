/* OrgFlow — layout engine: computes card sizes, positions and connector paths */
(function () {
  const OG = (window.OG = window.OG || {});

  // w = card width; h = minimum height (cards grow with their text)
  const SIZES = {
    classico: { w: 260, h: 84 },
    moderno: { w: 196, h: 164 },
    minimal: { w: 214, h: 60 },
    compacto: { w: 190, h: 44 },
  };

  const PAD = 48;
  const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

  /* ---------- text measuring ---------- */
  let ctx = null;
  let ctxTried = false;
  const wrapCache = new Map();

  function textWidth(text, size, weight) {
    if (!ctxTried) {
      ctxTried = true;
      try {
        if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
      } catch (e) {
        ctx = null;
      }
    }
    if (!ctx) return text.length * size * 0.56 * (weight >= 600 ? 1.06 : 1);
    ctx.font = weight + ' ' + size + 'px ' + FONT;
    return ctx.measureText(text).width;
  }

  function wrapText(text, size, weight, maxW) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const key = [text, size, weight, maxW].join('\u0001');
    if (wrapCache.has(key)) return wrapCache.get(key);
    const lines = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const test = cur ? cur + ' ' + word : word;
      if (textWidth(test, size, weight) <= maxW) {
        cur = test;
        continue;
      }
      if (cur) lines.push(cur);
      cur = '';
      // a single word wider than the card is broken by characters
      for (const ch of word) {
        if (cur && textWidth(cur + ch, size, weight) > maxW) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      }
    }
    if (cur) lines.push(cur);
    wrapCache.set(key, lines);
    return lines;
  }

  /* text width available and vertical metrics per card style */
  const STYLE = {
    classico: { pad: 97, roleSize: 13.5, roleLH: 16.5, nameSize: 12.5, nameLH: 15.5, deptLH: 14, vpad: 22 },
    moderno: { pad: 26, roleSize: 13.5, roleLH: 16.5, nameSize: 12.5, nameLH: 15.5, deptLH: 20, vpad: 92 },
    minimal: { pad: 66, roleSize: 13, roleLH: 16, nameSize: 12, nameLH: 15, deptLH: 0, vpad: 20 },
    compacto: { pad: 78, roleSize: 12.5, roleLH: 15.5, nameSize: 0, nameLH: 0, deptLH: 0, vpad: 18 },
  };

  function metrics(n, style, width, opts) {
    const s = STYLE[style] || STYLE.classico;
    const maxW = width - s.pad;
    const role = wrapText(n.role || 'Função', s.roleSize, 600, maxW);
    let name = [];
    if (s.nameSize) {
      const t = n.vacant ? 'Vaga em aberto' : opts.showName !== false ? n.name : '';
      name = wrapText(t, s.nameSize, 400, maxW);
    }
    let dept = [];
    if (s.deptLH && opts.showDept !== false && n.dept) dept = style === 'moderno' ? [n.dept] : wrapText(n.dept, 11, 600, maxW - 11);
    const h = s.vpad + role.length * s.roleLH + name.length * s.nameLH + dept.length * s.deptLH + 4;
    return { role, name, dept, h, style: s };
  }

  /**
   * compute(nodes, opts)
   * opts: { layout: 'vertical'|'horizontal'|'compacto'|'lista', cardStyle, showName, showDept }
   * returns { pos: {id:{x,y,w,h,m}}, edges, coEdges, width, height, order, toggles }
   */
  function compute(nodes, opts) {
    opts = opts || {};
    const layout = opts.layout || 'vertical';
    const styleName = SIZES[opts.cardStyle] ? opts.cardStyle : 'classico';
    const size = SIZES[styleName];
    const W = size.w;

    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    const kidsAll = {};
    const roots = [];
    nodes.forEach((n) => {
      if (n.parentId && byId[n.parentId]) (kidsAll[n.parentId] = kidsAll[n.parentId] || []).push(n);
      else roots.push(n);
    });
    const kids = (n) => (n.collapsed ? [] : kidsAll[n.id] || []);

    const cardW = layout === 'lista' ? W + 60 : W;
    const met = {};
    const M = (n) => (met[n.id] = met[n.id] || metrics(n, styleName, cardW, opts));
    const H = (n) => Math.max(size.h, Math.ceil(M(n).h));

    const pos = {};
    const edges = [];
    const toggles = {};
    const order = [];

    if (layout === 'lista') {
      const IND = 40;
      let y = 0;
      const walk = (n, d, parent) => {
        const h = H(n);
        const p = { x: d * IND, y, w: cardW, h, m: M(n) };
        pos[n.id] = p;
        order.push(n.id);
        y += h + 12;
        if (parent) {
          const pp = pos[parent.id];
          const tx = pp.x + 18;
          const my = p.y + h / 2;
          edges.push({ from: parent.id, to: n.id, d: `M${tx},${pp.y + pp.h} V${my - 6} Q${tx},${my} ${tx + 6},${my} H${p.x}` });
        }
        if ((kidsAll[n.id] || []).length) toggles[n.id] = { x: p.x + p.w + 14, y: p.y + h / 2, side: 'right' };
        kids(n).forEach((k) => walk(k, d + 1, n));
      };
      roots.forEach((r) => walk(r, 0, null));
      return finish(pos, edges, toggles, order, nodes);
    }

    const horiz = layout === 'horizontal';
    const compact = layout === 'compacto';
    const GB = horiz ? 16 : 26; // gap between siblings
    const GD = horiz ? 64 : 62; // gap between levels
    const SG = 22; // stack gutter (compact mode)
    const SROW = 12; // stack row gap
    const B = (n) => (horiz ? H(n) : W); // breadth of a card (cross axis)

    const info = {};
    const rowH = [];
    function measure(n, d) {
      const ks = kids(n);
      const inf = (info[n.id] = { mode: 'leaf', w: B(n) });
      rowH[d] = Math.max(rowH[d] || 0, H(n));
      if (!ks.length) return inf;
      if (compact && ks.length >= 2 && ks.every((k) => !kids(k).length)) {
        inf.mode = 'stack';
        inf.w = Math.max(B(n), 2 * W + 2 * SG);
        return inf;
      }
      ks.forEach((k) => measure(k, d + 1));
      const sum = ks.reduce((s, k) => s + info[k.id].w, 0) + GB * (ks.length - 1);
      inf.mode = 'tree';
      inf.sum = sum;
      inf.w = Math.max(B(n), sum);
      return inf;
    }

    function place(n, start, d, dpos) {
      const inf = info[n.id];
      const b = start + (inf.w - B(n)) / 2;
      const h = H(n);
      pos[n.id] = horiz ? { x: dpos[d], y: b, w: W, h, m: M(n) } : { x: b, y: dpos[d], w: W, h, m: M(n) };
      order.push(n.id);
      const p = pos[n.id];
      if ((kidsAll[n.id] || []).length) {
        toggles[n.id] = horiz ? { x: p.x + W, y: p.y + h / 2, side: 'right' } : { x: p.x + W / 2, y: p.y + h, side: 'bottom' };
      }
      const ks = kids(n);
      if (!ks.length) return;

      if (inf.mode === 'stack') {
        const cx = p.x + W / 2;
        let top = p.y + h + GD * 0.55;
        for (let i = 0; i < ks.length; i += 2) {
          const pair = ks.slice(i, i + 2);
          const rowHeight = Math.max(...pair.map(H));
          pair.forEach((k, j) => {
            const left = j === 0;
            const kh = H(k);
            const kx = left ? cx - SG - W : cx + SG;
            pos[k.id] = { x: kx, y: top, w: W, h: kh, m: M(k) };
            order.push(k.id);
            if ((kidsAll[k.id] || []).length) toggles[k.id] = { x: kx + W / 2, y: top + kh, side: 'bottom' };
            const ex = left ? kx + W : kx;
            const my = top + kh / 2;
            const r = 6;
            edges.push({ from: n.id, to: k.id, d: `M${cx},${p.y + h} V${my - r} Q${cx},${my} ${left ? cx - r : cx + r},${my} H${ex}` });
          });
          top += rowHeight + SROW;
        }
        return;
      }

      let s = start + (inf.w - inf.sum) / 2;
      ks.forEach((k) => {
        place(k, s, d + 1, dpos);
        s += info[k.id].w + GB;
        edges.push({ from: n.id, to: k.id, d: elbow(p, pos[k.id], horiz, GD) });
      });
    }

    roots.forEach((r) => measure(r, 0));
    const dpos = [0];
    rowH.forEach((rh, d) => (dpos[d + 1] = dpos[d] + (horiz ? W : rh) + GD));
    let cursor = 0;
    roots.forEach((r) => {
      place(r, cursor, 0, dpos);
      cursor += info[r.id].w + GB * 3;
    });
    return finish(pos, edges, toggles, order, nodes);
  }

  function elbow(p, c, horiz, gd) {
    const r = 8;
    if (horiz) {
      const x1 = p.x + p.w;
      const y1 = p.y + p.h / 2;
      const x2 = c.x;
      const y2 = c.y + c.h / 2;
      const mx = x1 + gd / 2;
      if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`;
      const dir = y2 > y1 ? 1 : -1;
      const rr = Math.min(r, Math.abs(y2 - y1) / 2);
      return `M${x1},${y1} H${mx - rr} Q${mx},${y1} ${mx},${y1 + dir * rr} V${y2 - dir * rr} Q${mx},${y2} ${mx + rr},${y2} H${x2}`;
    }
    const x1 = p.x + p.w / 2;
    const y1 = p.y + p.h;
    const x2 = c.x + c.w / 2;
    const y2 = c.y;
    const my = y2 - gd / 2; // cards in a row can differ in height: bend just above the children
    if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} V${y2}`;
    const dir = x2 > x1 ? 1 : -1;
    const rr = Math.min(r, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} V${my - rr} Q${x1},${my} ${x1 + dir * rr},${my} H${x2 - dir * rr} Q${x2},${my} ${x2},${my + rr} V${y2}`;
  }

  /* ---------- dashed coparticipation links ----------
     Orthogonal routing: a grid is built from the lanes around the cards and each
     link takes the cheapest path through it, so lines never cross a card. It runs
     on every layout pass, so routes follow any change in the chart. */
  const LANE = 8; // clearance between a line and a card
  const BEND = 40; // cost of a corner
  const TRUNK = 2; // cost multiplier along card center lines (hierarchy trunks, toggles)
  const SHARED = 3; // cost multiplier on lanes already used by another link
  const TOP_BOTTOM = 30; // leaving through top/bottom competes with the hierarchy lines
  const MAX_GRID = 300000;

  function buildGrid(cards) {
    const xset = new Set();
    const yset = new Set();
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const c of cards) {
      [c.x - LANE, c.x + c.w / 2, c.x + c.w + LANE].forEach((v) => xset.add(v));
      [c.y - LANE, c.y + c.h / 2, c.y + c.h + LANE].forEach((v) => yset.add(v));
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x + c.w);
      y1 = Math.max(y1, c.y + c.h);
    }
    [x0 - 28, x1 + 28].forEach((v) => xset.add(v));
    [y0 - 28, y1 + 28].forEach((v) => yset.add(v));
    const xs = [...xset].sort((a, b) => a - b);
    const ys = [...yset].sort((a, b) => a - b);
    const nx = xs.length;
    const ny = ys.length;
    if (nx * ny > MAX_GRID) return null;
    const blocked = new Uint8Array(nx * ny);
    const trunkX = new Set(cards.map((c) => c.x + c.w / 2));
    for (const c of cards) {
      for (let j = 0; j < ny; j++) {
        if (ys[j] <= c.y - LANE || ys[j] >= c.y + c.h + LANE) continue;
        for (let i = 0; i < nx; i++) if (xs[i] > c.x - LANE && xs[i] < c.x + c.w + LANE) blocked[i + j * nx] = 1;
      }
    }
    return { xs, ys, nx, ny, blocked, trunkX, xi: new Map(xs.map((v, i) => [v, i])), yi: new Map(ys.map((v, i) => [v, i])), used: new Set() };
  }

  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  // exits of a card: [grid x, grid y, edge x, edge y, outward direction, extra cost]
  function ports(c) {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    return [
      [c.x + c.w + LANE, cy, c.x + c.w, cy, 0, 0],
      [c.x - LANE, cy, c.x, cy, 1, 0],
      [cx, c.y + c.h + LANE, cx, c.y + c.h, 2, TOP_BOTTOM],
      [cx, c.y - LANE, cx, c.y, 3, TOP_BOTTOM],
    ];
  }

  function route(a, b, g) {
    const { xs, ys, nx, ny, blocked } = g;
    const size = nx * ny * 4;
    const dist = new Float64Array(size).fill(Infinity);
    const prev = new Int32Array(size).fill(-1);
    const heap = []; // binary heap of [cost, state]
    const push = (cost, st) => {
      heap.push([cost, st]);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up][0] <= heap[i][0]) break;
        [heap[up], heap[i]] = [heap[i], heap[up]];
        i = up;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const cell = (x, y) => g.xi.get(x) + g.yi.get(y) * nx;
    const starts = {};
    for (const p of ports(a)) {
      const k = cell(p[0], p[1]);
      if (blocked[k]) continue;
      const st = k * 4 + p[4];
      dist[st] = p[5];
      starts[st] = p;
      push(p[5], st);
    }
    const goals = new Map();
    for (const p of ports(b)) {
      const k = cell(p[0], p[1]);
      if (!blocked[k]) goals.set(k, p);
    }
    let best = Infinity;
    let bestSt = -1;
    while (heap.length) {
      const [cost, st] = pop();
      if (cost > dist[st]) continue;
      if (cost >= best) break;
      const k = st >> 2;
      const d = st & 3;
      if (goals.has(k) && cost + goals.get(k)[5] < best) {
        best = cost + goals.get(k)[5];
        bestSt = st;
      }
      const i = k % nx;
      const j = (k - i) / nx;
      for (let nd = 0; nd < 4; nd++) {
        if ((nd ^ 1) === d) continue; // no U-turns
        const ni = i + DIRS[nd][0];
        const nj = j + DIRS[nd][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const nk = ni + nj * nx;
        if (blocked[nk]) continue;
        const horiz = nd < 2;
        let len = horiz ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j]);
        if (!horiz && g.trunkX.has(xs[i])) len *= TRUNK;
        const seg = Math.min(k, nk) + (horiz ? 'h' : 'v');
        if (g.used.has(seg)) len *= SHARED;
        const nc = cost + len + (nd === d ? 0 : BEND);
        const ns = nk * 4 + nd;
        if (nc < dist[ns]) {
          dist[ns] = nc;
          prev[ns] = st;
          push(nc, ns);
        }
      }
    }
    if (bestSt < 0) return null;

    const pts = [];
    let st = bestSt;
    const endPort = goals.get(st >> 2);
    pts.push([endPort[2], endPort[3]]);
    let first = st;
    while (st >= 0) {
      const k = st >> 2;
      const i = k % nx;
      pts.push([xs[i], ys[(k - i) / nx]]);
      const pv = prev[st];
      if (pv >= 0) {
        const a2 = pv >> 2;
        g.used.add(Math.min(k, a2) + ((st & 3) < 2 ? 'h' : 'v'));
      }
      first = st;
      st = pv;
    }
    const sp = starts[first];
    pts.push([sp[2], sp[3]]);
    return pts.reverse();
  }

  // drop collinear points, then round the corners
  function polyPath(raw) {
    const pts = raw.filter((p, i) => {
      const a = raw[i - 1];
      const b = raw[i + 1];
      if (!a || !b) return true;
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      const [nx, ny] = pts[i + 1];
      const r = Math.min(7, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
      const ux = Math.sign(x - px);
      const uy = Math.sign(y - py);
      const vx = Math.sign(nx - x);
      const vy = Math.sign(ny - y);
      d += ` L${x - ux * r},${y - uy * r} Q${x},${y} ${x + vx * r},${y + vy * r}`;
    }
    const e = pts[pts.length - 1];
    return { d: d + ` L${e[0]},${e[1]}`, pts };
  }

  function coEdges(pos, nodes) {
    const links = [];
    nodes.forEach((n) => (n.coLinks || []).forEach((l) => pos[n.id] && pos[l.to] && l.to !== n.id && links.push({ from: n.id, to: l.to, label: l.label || '' })));
    if (!links.length) return [];
    const g = buildGrid(Object.values(pos));
    return links.map((l) => {
      const a = pos[l.from];
      const b = pos[l.to];
      const raw = g && route(a, b, g);
      const { d, pts } = polyPath(raw || [[a.x + a.w, a.y + a.h / 2], [b.x, b.y + b.h / 2]]);
      // the label sits on the longest stretch
      let lx = pts[0][0];
      let ly = pts[0][1];
      let longest = -1;
      for (let i = 1; i < pts.length; i++) {
        const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (len > longest) {
          longest = len;
          lx = (pts[i][0] + pts[i - 1][0]) / 2;
          ly = (pts[i][1] + pts[i - 1][1]) / 2;
        }
      }
      return { from: l.from, to: l.to, d, pts, label: l.label, lx, ly: ly - 6 };
    });
  }

  function finish(pos, edges, toggles, order, nodes) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id in pos) {
      const p = pos[id];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    if (minX === Infinity) return { pos, edges, coEdges: [], toggles, order, width: 400, height: 300, offsetX: 0, offsetY: 0 };
    const dx = PAD - minX;
    const dy = PAD - minY;
    // translate everything so the drawing starts at (PAD, PAD)
    for (const id in pos) {
      pos[id].x += dx;
      pos[id].y += dy;
    }
    for (const id in toggles) {
      toggles[id].x += dx;
      toggles[id].y += dy;
    }
    edges.forEach((e) => (e.d = translatePath(e.d, dx, dy)));
    return { pos, edges, coEdges: coEdges(pos, nodes), toggles, order, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 + 20 };
  }

  // shift absolute path commands (M, H, V, Q only — the ones produced above)
  function translatePath(d, dx, dy) {
    return d.replace(/([MHVQ])([^MHVQ]*)/g, (m, cmd, args) => {
      const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      let out;
      if (cmd === 'H') out = nums.map((n) => n + dx);
      else if (cmd === 'V') out = nums.map((n) => n + dy);
      else out = nums.map((n, i) => (i % 2 === 0 ? n + dx : n + dy));
      if (cmd === 'H' || cmd === 'V') return cmd + out.join(' ') + ' ';
      const pairs = [];
      for (let i = 0; i < out.length; i += 2) pairs.push(out[i] + ',' + out[i + 1]);
      return cmd + pairs.join(' ') + ' ';
    });
  }

  OG.Layout = { compute, SIZES, wrapText, clearCache: () => wrapCache.clear() };
})();
