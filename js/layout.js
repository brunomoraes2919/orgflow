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

  /* dashed coparticipation links: side-to-side curves between visible cards */
  function coEdges(pos, nodes) {
    const out = [];
    for (const n of nodes) {
      const a = pos[n.id];
      if (!a) continue;
      for (const link of n.coLinks || []) {
        const b = pos[link.to];
        if (!b) continue;
        const acx = a.x + a.w / 2;
        const bcx = b.x + b.w / 2;
        const ay = a.y + a.h / 2;
        const by = b.y + b.h / 2;
        let x1, x2, c1, c2;
        if (a.x + a.w < b.x) [x1, x2, c1, c2] = [a.x + a.w, b.x, 1, -1];
        else if (b.x + b.w < a.x) [x1, x2, c1, c2] = [a.x, b.x + b.w, -1, 1];
        else [x1, x2, c1, c2] = [a.x + a.w, b.x + b.w, 1, 1]; // same column: bulge to the right
        const bend = Math.max(40, Math.abs(x2 - x1) / 2);
        const d = `M${x1},${ay} C${x1 + c1 * bend},${ay} ${x2 + c2 * bend},${by} ${x2},${by}`;
        const same = c1 === c2;
        const lx = same ? Math.max(x1, x2) + bend * 0.75 : (x1 + x2) / 2;
        out.push({ from: n.id, to: link.to, d, label: link.label || '', lx, ly: (ay + by) / 2 - 6, cx: (acx + bcx) / 2 });
      }
    }
    return out;
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
