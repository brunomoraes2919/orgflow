/* OrgFlow — PowerPoint export with native, editable shapes */
(function () {
  const OG = window.OG;
  const S = OG.Store;
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;
  const MIN_FONT = 8; // below this the overview is too small to read: add one slide per area
  const FONT = 'Segoe UI';

  const hex = (c) => String(c || '#64748b').replace('#', '').slice(0, 6).toUpperCase();

  function loadLibrary() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/pptxgen.bundle.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Não foi possível carregar o gerador de PowerPoint. Verifique a conexão e tente de novo.'));
      document.head.appendChild(s);
    });
  }

  // PowerPoint has no stroke icons: rasterize the white icon once per name
  const iconCache = {};
  function iconPng(name) {
    if (iconCache[name]) return iconCache[name];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${OG.ICONS[name] || OG.ICONS.user}</svg>`;
    iconCache[name] = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    return iconCache[name];
  }

  // orthogonal segments of a connector path (a rounded corner becomes a square one)
  function segments(d) {
    const out = [];
    let x = 0;
    let y = 0;
    const line = (nx, ny) => {
      if (nx !== x || ny !== y) out.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    };
    for (const [, cmd, args] of d.matchAll(/([MHVLQ])([^MHVLQ]*)/g)) {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (cmd === 'M') [x, y] = n;
      else if (cmd === 'H') line(n[0], y);
      else if (cmd === 'V') line(x, n[0]);
      else if (cmd === 'L') line(n[0], n[1]);
      else {
        line(n[0], n[1]);
        line(n[2], n[3]);
      }
    }
    return out;
  }

  async function drawChart(pptx, nodes, title) {
    const ui = S.ui;
    const L = OG.Layout.compute(nodes, { layout: ui.layout, cardStyle: ui.cardStyle, showName: ui.showName, showDept: ui.showDept });
    const slide = pptx.addSlide();
    slide.addText(title, { x: 0.4, y: 0.2, w: SLIDE_W - 0.8, h: 0.45, fontFace: FONT, fontSize: 18, bold: true, color: '0F172A', margin: 0 });

    const top = 0.75;
    const s = Math.min((SLIDE_W - 0.6) / L.width, (SLIDE_H - top - 0.2) / L.height);
    const ox = (SLIDE_W - L.width * s) / 2;
    const X = (v) => ox + v * s;
    const Y = (v) => top + v * s;
    const pt = (px) => Math.max(5, Math.round(px * s * 72 * 10) / 10);

    const drawLine = ([x1, y1, x2, y2], opts) =>
      slide.addShape(pptx.ShapeType.line, { x: X(Math.min(x1, x2)), y: Y(Math.min(y1, y2)), w: Math.abs(x2 - x1) * s, h: Math.abs(y2 - y1) * s, line: opts });
    L.edges.forEach((e) => segments(e.d).forEach((seg) => drawLine(seg, { color: '94A3B8', width: 1 })));
    L.coEdges.forEach((e) => segments(e.d).forEach((seg) => drawLine(seg, { color: 'D97706', width: 1.25, dashType: 'dash' })));

    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    for (const id of L.order) {
      const n = byId[id];
      const p = L.pos[id];
      const color = hex(n.vacant ? '#cbd5e1' : S.colorFor(n, ui.colorBy));
      const av = Math.min(44, p.h - 16);
      const textX = 14 + av + 10;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: X(p.x),
        y: Y(p.y),
        w: p.w * s,
        h: p.h * s,
        rectRadius: 10 * s,
        fill: { color: n.vacant ? 'F8FAFC' : 'FFFFFF' },
        line: n.vacant ? { color: '94A3B8', width: 1, dashType: 'dash' } : { color: 'E2E8F0', width: 0.75 },
      });
      slide.addShape(pptx.ShapeType.rect, { x: X(p.x), y: Y(p.y + 6), w: 5 * s, h: (p.h - 12) * s, fill: { color }, line: { color, width: 0 } });
      const ax = X(p.x + 14);
      const ay = Y(p.y + (p.h - av) / 2);
      if (ui.showPhotos && n.photo && !n.vacant) {
        slide.addImage({ data: n.photo, x: ax, y: ay, w: av * s, h: av * s, rounding: true });
      } else {
        slide.addShape(pptx.ShapeType.ellipse, { x: ax, y: ay, w: av * s, h: av * s, fill: { color }, line: { color, width: 0 } });
        const inset = av * 0.25 * s;
        slide.addImage({ data: await iconPng(n.vacant ? 'userPlus' : S.iconFor(n)), x: ax + inset, y: ay + inset, w: av * 0.5 * s, h: av * 0.5 * s });
      }
      const runs = [{ text: n.role || 'Função', options: { bold: true, color: '0F172A', fontSize: pt(13.5), breakLine: true } }];
      const nameText = n.vacant ? 'Vaga em aberto' : ui.showName !== false ? n.name : '';
      if (nameText) runs.push({ text: nameText, options: { italic: !!n.vacant, color: n.vacant ? '94A3B8' : '475569', fontSize: pt(12.5), breakLine: true } });
      if (ui.showDept !== false && n.dept) runs.push({ text: n.dept, options: { bold: true, color: hex(S.deptColor(n.dept)), fontSize: pt(11) } });
      slide.addText(runs, { x: X(p.x + textX), y: Y(p.y), w: (p.w - textX - 8) * s, h: p.h * s, fontFace: FONT, valign: 'middle', margin: 0 });
    }
    L.coEdges.forEach((e) => {
      if (!e.label) return;
      const w = Math.max(70, e.label.length * 6.5);
      slide.addText(e.label, { x: X(e.lx - w / 2), y: Y(e.ly - 3), w: w * s, h: 18 * s, shape: pptx.ShapeType.roundRect, rectRadius: 8 * s, align: 'center', valign: 'middle', margin: 0, fontFace: FONT, fontSize: pt(10.5), bold: true, color: 'B45309', fill: { color: 'FFFFFF' }, line: { color: 'D97706', width: 0.75, dashType: 'dash' } });
    });
    return pt(13.5);
  }

  function branch(rootId) {
    const nodes = S.nodes;
    const ids = new Set([rootId, ...S.descendants(rootId).map((d) => d.id)]);
    return nodes.filter((n) => ids.has(n.id)).map((n) => ({ ...n, collapsed: false, parentId: n.id === rootId ? null : n.parentId }));
  }

  // returns the pptx object so the file can also be inspected
  async function build() {
    await loadLibrary();
    const pptx = new window.PptxGenJS();
    pptx.defineLayout({ name: 'ORG', width: SLIDE_W, height: SLIDE_H });
    pptx.layout = 'ORG';
    pptx.title = S.project.name;
    const title = `${S.project.name} — ${S.version.name}`;
    const all = S.nodes.map((n) => ({ ...n, collapsed: false }));
    const font = await drawChart(pptx, all, title);
    if (font < MIN_FONT) {
      // detail slides: every leader directly under a top position that has a team
      for (const root of S.roots()) {
        for (const area of S.children(root.id)) {
          if (S.children(area.id).length) await drawChart(pptx, branch(area.id), `${area.role}${area.dept ? ' — ' + area.dept : ''}`);
        }
      }
    }
    return pptx;
  }

  async function exportPptx() {
    const pptx = await build();
    const blob = await pptx.write({ outputType: 'blob' });
    const X = OG.Exporter;
    X.download(blob, `${X.slug(S.project.name)}-${X.slug(S.version.name)}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }

  OG.Pptx = { export: exportPptx, build };
})();
