/* OrgFlow — layout engine: computes card positions and connector paths */
(function () {
  const OG = (window.OG = window.OG || {});

  const SIZES = {
    classico: { w: 236, h: 84 },
    moderno: { w: 196, h: 164 },
    minimal: { w: 204, h: 60 },
    compacto: { w: 172, h: 44 },
  };

  const PAD = 48;

  /**
   * compute(nodes, opts)
   * opts: { layout: 'vertical'|'horizontal'|'compacto'|'lista', cardStyle }
   * returns { pos: {id:{x,y,w,h}}, edges: [{from,to,d}], width, height, order: [ids], toggles: {id:{x,y}} }
   */
  function compute(nodes, opts) {
    opts = opts || {};
    const layout = opts.layout || 'vertical';
    const size = SIZES[opts.cardStyle] || SIZES.classico;
    const W = size.w;
    const H = size.h;

    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    const kidsAll = {};
    const roots = [];
    nodes.forEach((n) => {
      if (n.parentId && byId[n.parentId]) (kidsAll[n.parentId] = kidsAll[n.parentId] || []).push(n);
      else roots.push(n);
    });
    const kids = (n) => (n.collapsed ? [] : kidsAll[n.id] || []);

    const pos = {};
    const edges = [];
    const toggles = {};
    const order = [];

    if (layout === 'lista') {
      const IND = 40;
      const ROW = H + 12;
      let row = 0;
      const walk = (n, d, parent) => {
        const p = { x: d * IND, y: row * ROW, w: W + 60, h: H };
        pos[n.id] = p;
        order.push(n.id);
        row++;
        if (parent) {
          const pp = pos[parent.id];
          const tx = pp.x + 18;
          edges.push({ from: parent.id, to: n.id, d: `M${tx},${pp.y + pp.h} V${p.y + H / 2 - 6} Q${tx},${p.y + H / 2} ${tx + 6},${p.y + H / 2} H${p.x}` });
        }
        if ((kidsAll[n.id] || []).length) toggles[n.id] = { x: p.x + p.w + 14, y: p.y + H / 2, side: 'right' };
        kids(n).forEach((k) => walk(k, d + 1, n));
      };
      roots.forEach((r) => walk(r, 0, null));
      return finish(pos, edges, toggles, order);
    }

    const horiz = layout === 'horizontal';
    const compact = layout === 'compacto';
    const B = horiz ? H : W; // breadth of a card (cross axis)
    const D = horiz ? W : H; // depth of a card (main axis)
    const GB = horiz ? 16 : 26; // gap between siblings
    const GD = horiz ? 64 : 62; // gap between levels
    const SG = 22; // stack gutter (compact mode)
    const SROW = 12; // stack row gap

    const info = {};
    function measure(n) {
      const ks = kids(n);
      const inf = (info[n.id] = { mode: 'leaf', w: B });
      if (!ks.length) return inf;
      if (compact && ks.length >= 2 && ks.every((k) => !kids(k).length)) {
        inf.mode = 'stack';
        inf.w = Math.max(B, 2 * W + 2 * SG);
        return inf;
      }
      ks.forEach(measure);
      const sum = ks.reduce((s, k) => s + info[k.id].w, 0) + GB * (ks.length - 1);
      inf.mode = 'tree';
      inf.sum = sum;
      inf.w = Math.max(B, sum);
      return inf;
    }

    function setPos(n, b, d) {
      pos[n.id] = horiz ? { x: d, y: b, w: W, h: H } : { x: b, y: d, w: W, h: H };
    }

    function place(n, start, depth) {
      const inf = info[n.id];
      const b = start + (inf.w - B) / 2;
      setPos(n, b, depth);
      order.push(n.id);
      const p = pos[n.id];
      if ((kidsAll[n.id] || []).length) {
        toggles[n.id] = horiz ? { x: p.x + W, y: p.y + H / 2, side: 'right' } : { x: p.x + W / 2, y: p.y + H, side: 'bottom' };
      }
      const ks = kids(n);
      if (!ks.length) return;

      if (inf.mode === 'stack') {
        const cx = p.x + W / 2;
        const top = p.y + H + GD * 0.55;
        ks.forEach((k, i) => {
          const row = Math.floor(i / 2);
          const left = i % 2 === 0;
          const ky = top + row * (H + SROW);
          const kx = left ? cx - SG - W : cx + SG;
          pos[k.id] = { x: kx, y: ky, w: W, h: H };
          order.push(k.id);
          if ((kidsAll[k.id] || []).length) toggles[k.id] = { x: kx + W / 2, y: ky + H, side: 'bottom' };
          const ex = left ? kx + W : kx;
          const my = ky + H / 2;
          const r = 6;
          edges.push({
            from: n.id,
            to: k.id,
            d: `M${cx},${p.y + H} V${my - r} Q${cx},${my} ${left ? cx - r : cx + r},${my} H${ex}`,
          });
        });
        // single trunk drawn once extra for a clean look under the last row
        return;
      }

      let s = start + (inf.w - inf.sum) / 2;
      const nd = depth + D + GD;
      ks.forEach((k) => {
        place(k, s, nd);
        s += info[k.id].w + GB;
        const c = pos[k.id];
        edges.push({ from: n.id, to: k.id, d: elbow(p, c, horiz, GD) });
      });
    }

    let cursor = 0;
    roots.forEach((r) => {
      measure(r);
      place(r, cursor, 0);
      cursor += info[r.id].w + GB * 3;
    });
    return finish(pos, edges, toggles, order);
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
    const my = y1 + gd / 2;
    if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} V${y2}`;
    const dir = x2 > x1 ? 1 : -1;
    const rr = Math.min(r, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} V${my - rr} Q${x1},${my} ${x1 + dir * rr},${my} H${x2 - dir * rr} Q${x2},${my} ${x2},${my + rr} V${y2}`;
  }

  function finish(pos, edges, toggles, order) {
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
    if (minX === Infinity) return { pos, edges, toggles, order, width: 400, height: 300, offsetX: 0, offsetY: 0 };
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
    return { pos, edges, toggles, order, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 + 20 };
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

  OG.Layout = { compute, SIZES };
})();
