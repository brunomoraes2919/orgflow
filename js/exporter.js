/* OrgFlow — exporter: SVG / PNG / JSON / CSV export & import */
(function () {
  'use strict';
  const OG = (window.OG = window.OG || {});

  const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
  const EDGE_COLOR = '#94a3b8';
  const SIZES_FALLBACK = {
    classico: { w: 236, h: 84 },
    moderno: { w: 196, h: 164 },
    minimal: { w: 204, h: 60 },
    compacto: { w: 172, h: 44 },
  };
  const DEFAULT_UI = { layout: 'vertical', cardStyle: 'classico', colorBy: 'level', showPhotos: true, showDept: true, showCount: true, showName: true };
  const FALLBACK_LEVELS = [
    { id: 'l1', name: 'Presidência / Diretoria', color: '#7c3aed' },
    { id: 'l2', name: 'Gerência', color: '#2563eb' },
    { id: 'l3', name: 'Coordenação', color: '#0891b2' },
    { id: 'l4', name: 'Supervisão / Liderança', color: '#059669' },
    { id: 'l5', name: 'Operacional / Técnico', color: '#64748b' },
  ];
  const VACANT_TEXT = 'Vaga em aberto';

  /* ---------------- generic helpers ---------------- */
  const hasProject = () => !!(OG.Store && OG.Store.project);
  const storeUI = () => (hasProject() ? OG.Store.ui : DEFAULT_UI);
  const storeLevels = () => (hasProject() && OG.Store.levels && OG.Store.levels.length ? OG.Store.levels : FALLBACK_LEVELS);
  const storeNodes = () => (hasProject() ? OG.Store.nodes : []);
  const sizes = () => (OG.Layout && OG.Layout.SIZES) || SIZES_FALLBACK;
  const newId = () => (OG.uid ? OG.uid() : Math.random().toString(36).slice(2, 10));

  function defined(obj) {
    const out = {};
    if (obj) for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
  }

  // XML-escape text/attribute content and drop characters that are illegal in XML 1.0
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  }

  // number formatter: max 2 decimals, never NaN/Infinity
  function f(n, dec) {
    const m = Math.pow(10, dec == null ? 2 : dec);
    const v = Math.round(Number(n) * m) / m;
    return Number.isFinite(v) ? String(v) : '0';
  }

  function stripAccents(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  // case/accent-insensitive key for value matching
  function normKey(s) {
    return stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function slug(str) {
    const s = stripAccents(str)
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80)
      .replace(/-+$/, '');
    return s || 'organograma';
  }

  function download(data, filename, mime) {
    if (typeof document === 'undefined') throw new Error('Download disponível apenas no navegador.');
    const blob = typeof Blob !== 'undefined' && data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    filename = filename || 'download';
    // hosted viewers block direct downloads: use the platform's save capability there
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then((d) => {
        if (d) d.save({ filename, data: blob }).catch(() => {});
      });
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.msSaveOrOpenBlob) {
      navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function baseFileName() {
    if (!hasProject()) return 'organograma';
    const p = OG.Store.project;
    const v = OG.Store.version;
    return slug(p.name) + '-' + slug(v && v.name);
  }

  function defaultTitle() {
    if (!hasProject()) return '';
    const v = OG.Store.version;
    return OG.Store.project.name + (v && v.name ? ' — ' + v.name : '');
  }

  /* ---------------- text measuring ---------------- */
  let mctx = null;
  let mctxTried = false;
  const mcache = new Map();

  function getCtx() {
    if (mctxTried) return mctx;
    mctxTried = true;
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        const c = document.createElement('canvas');
        mctx = (c.getContext && c.getContext('2d')) || null;
      } else if (typeof OffscreenCanvas !== 'undefined') {
        mctx = new OffscreenCanvas(1, 1).getContext('2d');
      }
    } catch (e) {
      mctx = null;
    }
    return mctx;
  }

  const fontStr = (size, weight, italic) => (italic ? 'italic ' : '') + (weight || 400) + ' ' + size + 'px ' + FONT;

  // rough per-character estimate (em units) when canvas is unavailable (e.g. node)
  function estimateWidth(text, size, weight) {
    let em = 0;
    for (const ch of text) {
      if (/[il.,:;|!'`1 ]/.test(ch)) em += 0.3;
      else if (/[fjrt()\[\]\-]/.test(ch)) em += 0.38;
      else if (/[mwMW@]/.test(ch)) em += 0.86;
      else if (/[A-Z]/.test(ch)) em += 0.66;
      else em += 0.56;
    }
    return em * size * (weight >= 600 ? 1.06 : 1);
  }

  function measure(text, size, weight, italic) {
    text = String(text);
    const font = fontStr(size, weight, italic);
    const key = font + '\u0001' + text;
    if (mcache.has(key)) return mcache.get(key);
    const c = getCtx();
    let w;
    if (c) {
      c.font = font;
      w = c.measureText(text).width;
    } else w = estimateWidth(text, size, weight);
    if (mcache.size > 5000) mcache.clear();
    mcache.set(key, w);
    return w;
  }

  // truncate text with "…" so it fits in maxW
  function fit(text, size, weight, maxW, italic) {
    text = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (maxW <= 0) return '';
    if (measure(text, size, weight, italic) <= maxW) return text;
    const chars = Array.from(text);
    let lo = 0;
    let hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measure(chars.slice(0, mid).join('').trimEnd() + '…', size, weight, italic) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo ? chars.slice(0, lo).join('').trimEnd() + '…' : '…';
  }

  /* ---------------- SVG primitives ---------------- */
  function textEl(x, y, str, o) {
    if (!str) return '';
    let a = `<text x="${f(x)}" y="${f(y)}" font-size="${o.size}" font-weight="${o.weight || 400}" fill="${esc(o.fill || '#0f172a')}"`;
    if (o.anchor) a += ` text-anchor="${o.anchor}"`;
    if (o.italic) a += ' font-style="italic"';
    return a + '>' + esc(str) + '</text>';
  }

  function iconEl(name, cx, cy, size, stroke) {
    const icons = OG.ICONS || {};
    const body = icons[name] || icons.user || '';
    const s = size / 24;
    return `<g transform="translate(${f(cx - size / 2)} ${f(cy - size / 2)}) scale(${f(s, 4)})" fill="none" stroke="${esc(stroke)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  }

  /* ---------------- SVG rendering ---------------- */
  let seq = 0;

  function render(nodes, opts) {
    nodes = Array.isArray(nodes) ? nodes : [];
    const o = Object.assign({}, DEFAULT_UI, defined(storeUI()), defined(opts));
    const SZ = sizes();
    const cardStyle = SZ[o.cardStyle] ? o.cardStyle : 'classico';
    const layout = o.layout || 'vertical';
    const list = o.expandAll ? nodes.map((n) => Object.assign({}, n, { collapsed: false })) : nodes;
    const L = OG.Layout.compute(list, { layout, cardStyle });

    // index over ALL nodes (counts ignore visibility)
    const byId = {};
    const kids = {};
    list.forEach((n) => (byId[n.id] = n));
    list.forEach((n) => {
      if (n.parentId && n.parentId !== n.id && byId[n.parentId]) (kids[n.parentId] = kids[n.parentId] || []).push(n);
    });
    const countDesc = (id) => {
      let c = 0;
      const seen = new Set([id]);
      const st = (kids[id] || []).slice();
      while (st.length) {
        const k = st.pop();
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        c++;
        (kids[k.id] || []).forEach((x) => st.push(x));
      }
      return c;
    };

    const colorOf = (n) => {
      try {
        return OG.Store.colorFor(n, o.colorBy) || '#4f46e5';
      } catch (e) {
        return n.color || '#4f46e5';
      }
    };
    const deptColorOf = (d) => {
      try {
        return OG.Store.deptColor(d) || '#94a3b8';
      } catch (e) {
        return '#94a3b8';
      }
    };
    const iconOf = (n) => {
      try {
        return OG.Store.iconFor(n);
      } catch (e) {
        return n.icon || (OG.guessIcon ? OG.guessIcon(n.role + ' ' + n.dept) : 'user');
      }
    };

    const pfx = 'og' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
    let idc = 0;
    const defs = [];
    const uidFor = (k) => pfx + k + ++idc;

    const titleH = o.title ? 48 : 0;
    let maxX = L.width;
    let maxY = L.height;
    const grow = (x, y) => {
      maxX = Math.max(maxX, x + 8);
      maxY = Math.max(maxY, y + 8);
    };

    /* ---- shared card pieces ---- */
    const bgFill = (n) => (n.vacant ? '#f8fafc' : '#ffffff');
    const fillRect = (w, h, rx, fill, extra) => `<rect width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${esc(fill)}"${extra || ''}/>`;
    const borderRect = (n, w, h, rx) =>
      n.vacant
        ? `<rect width="${f(w)}" height="${f(h)}" rx="${rx}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4"/>`
        : `<rect width="${f(w)}" height="${f(h)}" rx="${rx}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    const clipCache = {};
    const cardClip = (w, h, rx) => {
      const key = f(w) + 'x' + f(h) + 'r' + rx;
      if (clipCache[key]) return clipCache[key];
      const id = (clipCache[key] = uidFor('c'));
      defs.push(`<clipPath id="${id}"><rect width="${f(w)}" height="${f(h)}" rx="${rx}"/></clipPath>`);
      return id;
    };
    const photoEl = (n, cx, cy, r) => {
      const id = uidFor('a');
      defs.push(`<clipPath id="${id}"><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"/></clipPath>`);
      return (
        `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="#e2e8f0"/>` +
        `<image x="${f(cx - r)}" y="${f(cy - r)}" width="${f(2 * r)}" height="${f(2 * r)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})" xlink:href="${esc(n.photo)}"/>`
      );
    };
    const usePhoto = (n) => !!(o.showPhotos && n.photo && !n.vacant);
    const avatar = (n, c, cx, cy, r, iconSize) => {
      if (usePhoto(n)) return photoEl(n, cx, cy, r);
      const fill = n.vacant ? '#cbd5e1' : c;
      return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${esc(fill)}"/>` + iconEl(n.vacant ? 'userPlus' : iconOf(n), cx, cy, iconSize, '#ffffff');
    };
    const secondLine = (n) => (n.vacant ? { text: VACANT_TEXT, vacant: true } : o.showName && n.name ? { text: n.name } : null);
    const roleText = (n) => n.role || 'Função';

    /* ---- card styles ---- */
    function classico(n, p, c) {
      const w = p.w;
      const h = p.h;
      const out = [];
      const clip = cardClip(w, h, 12);
      out.push(fillRect(w, h, 12, bgFill(n)));
      out.push(`<rect width="5" height="${f(h)}" fill="${esc(c)}" clip-path="url(#${clip})"/>`);
      out.push(borderRect(n, w, h, 12));
      out.push(avatar(n, c, 38, h / 2, 22, 22));
      const tx = 72;
      const maxW = w - tx - 12;
      const lines = [{ kind: 'role' }];
      const sl = secondLine(n);
      if (sl) lines.push({ kind: 'name', sl });
      if (o.showDept && n.dept) lines.push({ kind: 'dept' });
      const ys = lines.length === 1 ? [h / 2 + 4.5] : lines.length === 2 ? [h / 2 - 3.5, h / 2 + 14.5] : [31, 49, 67];
      lines.forEach((ln, i) => {
        const y = ys[i];
        if (ln.kind === 'role') out.push(textEl(tx, y, fit(roleText(n), 13.5, 600, maxW), { size: 13.5, weight: 600, fill: '#0f172a' }));
        else if (ln.kind === 'name') {
          const it = !!ln.sl.vacant;
          out.push(textEl(tx, y, fit(ln.sl.text, 12.5, 400, maxW, it), { size: 12.5, weight: 400, fill: it ? '#94a3b8' : '#475569', italic: it }));
        } else {
          const dc = deptColorOf(n.dept);
          out.push(`<circle cx="${f(tx + 3)}" cy="${f(y - 3.8)}" r="3" fill="${esc(dc)}"/>`);
          out.push(textEl(tx + 10, y, fit(n.dept, 11, 600, maxW - 10), { size: 11, weight: 600, fill: dc }));
        }
      });
      return out.join('');
    }

    function moderno(n, p, c) {
      const w = p.w;
      const h = p.h;
      const cx = w / 2;
      const out = [];
      const clip = cardClip(w, h, 14);
      out.push(fillRect(w, h, 14, bgFill(n)));
      out.push(`<rect width="${f(w)}" height="46" fill="${esc(n.vacant ? '#cbd5e1' : c)}" clip-path="url(#${clip})"/>`);
      out.push(borderRect(n, w, h, 14));
      out.push(`<circle cx="${f(cx)}" cy="46" r="33" fill="#ffffff"/>`);
      out.push(avatar(n, c, cx, 46, 30, 28));
      const maxW = w - 20;
      out.push(textEl(cx, 100, fit(roleText(n), 13.5, 600, maxW), { size: 13.5, weight: 600, fill: '#0f172a', anchor: 'middle' }));
      const sl = secondLine(n);
      if (sl) out.push(textEl(cx, 119, fit(sl.text, 12.5, 400, maxW, sl.vacant), { size: 12.5, weight: 400, fill: sl.vacant ? '#94a3b8' : '#475569', anchor: 'middle', italic: !!sl.vacant }));
      if (o.showDept && n.dept) {
        const dc = deptColorOf(n.dept);
        const t = fit(n.dept, 11, 600, w - 36);
        const pw = measure(t, 11, 600) + 18;
        const cy = sl ? 140 : 124;
        out.push(`<rect x="${f(cx - pw / 2)}" y="${f(cy - 9)}" width="${f(pw)}" height="18" rx="9" fill="${esc(dc)}" fill-opacity="0.12"/>`);
        out.push(textEl(cx, cy + 3.8, t, { size: 11, weight: 600, fill: dc, anchor: 'middle' }));
      }
      return out.join('');
    }

    function minimal(n, p, c) {
      const w = p.w;
      const h = p.h;
      const out = [];
      const clip = cardClip(w, h, 10);
      out.push(fillRect(w, h, 10, bgFill(n)));
      out.push(`<rect width="${f(w)}" height="3" fill="${esc(n.vacant ? '#cbd5e1' : c)}" clip-path="url(#${clip})"/>`);
      out.push(borderRect(n, w, h, 10));
      const midY = (h + 3) / 2;
      let tx = 42;
      if (usePhoto(n)) {
        out.push(photoEl(n, 30, midY, 16));
        tx = 54;
      } else out.push(iconEl(n.vacant ? 'userPlus' : iconOf(n), 23, midY, 18, n.vacant ? '#94a3b8' : c));
      const maxW = w - tx - 10;
      const sl = secondLine(n);
      out.push(textEl(tx, sl ? 27 : midY + 4.5, fit(roleText(n), 13, 600, maxW), { size: 13, weight: 600, fill: '#0f172a' }));
      if (sl) out.push(textEl(tx, 44, fit(sl.text, 12, 400, maxW, sl.vacant), { size: 12, weight: 400, fill: sl.vacant ? '#94a3b8' : '#64748b', italic: !!sl.vacant }));
      return out.join('');
    }

    function compacto(n, p, c) {
      const w = p.w;
      const h = p.h;
      const out = [];
      out.push(fillRect(w, h, 10, '#ffffff'));
      if (n.vacant) {
        out.push(fillRect(w, h, 10, '#f8fafc'));
        out.push(borderRect(n, w, h, 10));
      } else out.push(`<rect width="${f(w)}" height="${f(h)}" rx="10" fill="${esc(c)}" fill-opacity="0.1" stroke="${esc(c)}" stroke-opacity="0.35" stroke-width="1"/>`);
      out.push(iconEl(n.vacant ? 'userPlus' : iconOf(n), 20, h / 2, 16, n.vacant ? '#94a3b8' : c));
      out.push(textEl(36, h / 2 + 4.5, fit(roleText(n), 12.5, 600, w - 36 - 10), { size: 12.5, weight: 600, fill: '#0f172a' }));
      return out.join('');
    }

    const DRAW = { classico, moderno, minimal, compacto };

    function countBadge(w, count, c) {
      const t = String(count);
      const bw = Math.max(20, measure(t, 10.5, 700) + 12);
      const x = w + 6 - bw;
      return (
        `<rect x="${f(x)}" y="-8" width="${f(bw)}" height="18" rx="9" fill="#ffffff" stroke="${esc(c)}" stroke-width="1.5"/>` +
        textEl(x + bw / 2, 4.8, t, { size: 10.5, weight: 700, fill: c, anchor: 'middle' })
      );
    }

    function collapsedPill(n, p, hidden) {
      const t = '+' + hidden;
      const pw = measure(t, 11, 600) + 16;
      const ph = 18;
      const tg = L.toggles && L.toggles[n.id];
      const side = tg && tg.side ? tg.side : layout === 'horizontal' || layout === 'lista' ? 'right' : 'bottom';
      let x;
      let y;
      let line;
      if (side === 'right') {
        x = p.x + p.w + 10;
        y = p.y + p.h / 2 - ph / 2;
        line = `M${f(p.x + p.w)},${f(p.y + p.h / 2)} H${f(x)}`;
      } else {
        x = p.x + p.w / 2 - pw / 2;
        y = p.y + p.h + 10;
        line = `M${f(p.x + p.w / 2)},${f(p.y + p.h)} V${f(y)}`;
      }
      grow(x + pw, y + ph + titleH);
      return (
        `<path d="${line}" fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5"/>` +
        `<rect x="${f(x)}" y="${f(y)}" width="${f(pw)}" height="${ph}" rx="9" fill="#ffffff" stroke="${EDGE_COLOR}" stroke-width="1.2"/>` +
        textEl(x + pw / 2, y + 12.8, t, { size: 11, weight: 600, fill: '#475569', anchor: 'middle' })
      );
    }

    /* ---- assemble ---- */
    const edges = L.edges.map((e) => `<path d="${esc(String(e.d).trim())}"/>`).join('');
    const cards = [];
    const pills = [];
    const draw = DRAW[cardStyle];
    for (const id of L.order) {
      const n = byId[id];
      const p = L.pos[id];
      if (!n || !p) continue;
      const c = colorOf(n);
      let g = `<g transform="translate(${f(p.x)} ${f(p.y)})">`;
      g += `<title>${esc(roleText(n) + (n.vacant ? ' — ' + VACANT_TEXT : n.name ? ' — ' + n.name : ''))}</title>`;
      g += draw(n, p, c);
      const direct = (kids[id] || []).length;
      if (o.showCount && direct) g += countBadge(p.w, direct, n.vacant ? '#94a3b8' : c);
      g += '</g>';
      cards.push(g);
      grow(p.x + p.w + 6, p.y + p.h + titleH);
      if (n.collapsed && !o.expandAll && direct) {
        const hidden = countDesc(id);
        if (hidden) pills.push(collapsedPill(n, p, hidden));
      }
    }

    let titleEl = '';
    let width = maxX;
    if (o.title) {
      const tw = measure(String(o.title), 20, 700);
      width = Math.max(width, Math.min(tw + 96, 1600));
      titleEl = textEl(48, 56, fit(String(o.title), 20, 700, width - 96), { size: 20, weight: 700, fill: '#0f172a' });
    }
    let empty = '';
    if (!L.order.length) {
      empty = textEl(width / 2, (L.height || 300) / 2, 'Organograma vazio', { size: 14, weight: 400, fill: '#94a3b8', anchor: 'middle' });
    }
    width = Math.ceil(width);
    const height = Math.ceil(Math.max(maxY, L.height + titleH));
    const bg = o.background || '#ffffff';
    const docTitle = o.title ? String(o.title) : 'Organograma';

    const svg =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">` +
      `<title>${esc(docTitle)}</title>` +
      (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
      `<rect width="${width}" height="${height}" fill="${esc(bg)}"/>` +
      titleEl +
      `<g transform="translate(0 ${titleH})">` +
      `<g fill="none" stroke="${EDGE_COLOR}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${edges}</g>` +
      cards.join('') +
      pills.join('') +
      empty +
      '</g></svg>';
    return { svg, width, height };
  }

  function buildSVG(nodes, opts) {
    return render(nodes, opts).svg;
  }

  function exportOpts(opts) {
    const o = Object.assign({}, defined(storeUI()), defined(opts));
    if (!opts || !('title' in opts)) o.title = defaultTitle();
    return o;
  }

  function exportSVG(opts) {
    const svg = buildSVG(storeNodes(), exportOpts(opts));
    download(svg, baseFileName() + '.svg', 'image/svg+xml;charset=utf-8');
    return svg;
  }

  function exportPNG(opts) {
    return new Promise((resolve, reject) => {
      const fail = (msg) => reject(new Error(msg));
      try {
        if (typeof document === 'undefined' || typeof Image === 'undefined') return fail('A exportação em PNG só está disponível no navegador.');
        const o = exportOpts(opts);
        o.background = o.background || '#ffffff';
        const r = render(storeNodes(), o);
        const w = r.width;
        const h = r.height;
        let scale = Number(o.scale) || 2;
        if (scale <= 0) scale = 2;
        scale = Math.min(scale, 16000 / w, 16000 / h, Math.sqrt(120e6 / (w * h)));
        const cw = Math.max(1, Math.floor(w * scale));
        const ch = Math.max(1, Math.floor(h * scale));

        const sources = [];
        let blobUrl = null;
        try {
          blobUrl = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml;charset=utf-8' }));
          sources.push(blobUrl);
        } catch (e) {
          /* fall through to data URL */
        }
        sources.push('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg));
        const cleanup = () => blobUrl && URL.revokeObjectURL(blobUrl);

        const finish = (blob) => {
          if (!blob) return fail('Não foi possível gerar o arquivo PNG (a imagem pode ser grande demais para o navegador).');
          try {
            download(blob, baseFileName() + '.png', 'image/png');
          } catch (e) {
            return fail('Não foi possível iniciar o download do PNG.');
          }
          resolve({ width: cw, height: ch, scale });
        };

        const tryLoad = (i) => {
          if (i >= sources.length) {
            cleanup();
            return fail('Não foi possível renderizar o organograma como imagem.');
          }
          const img = new Image();
          img.onload = () => {
            cleanup();
            try {
              const canvas = document.createElement('canvas');
              canvas.width = cw;
              canvas.height = ch;
              const ctx = canvas.getContext('2d');
              if (!ctx) return fail('Seu navegador não suporta a geração de imagens (canvas indisponível).');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, cw, ch);
              ctx.drawImage(img, 0, 0, cw, ch);
              if (canvas.toBlob) canvas.toBlob(finish, 'image/png');
              else {
                const data = canvas.toDataURL('image/png');
                const bin = atob(data.split(',')[1]);
                const arr = new Uint8Array(bin.length);
                for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
                finish(new Blob([arr], { type: 'image/png' }));
              }
            } catch (e) {
              if (e && e.name === 'SecurityError') fail('O navegador bloqueou a geração do PNG por restrições de segurança. Tente exportar em SVG.');
              else fail('Falha ao gerar o PNG: memória insuficiente ou imagem grande demais. Tente uma escala menor.');
            }
          };
          img.onerror = () => tryLoad(i + 1);
          img.src = sources[i];
        };
        tryLoad(0);
      } catch (e) {
        fail('Falha ao preparar a exportação em PNG' + (e && e.message ? ': ' + e.message : '.'));
      }
    });
  }

  /* ---------------- JSON ---------------- */
  function exportJSON() {
    if (!hasProject()) throw new Error('Nenhum projeto carregado para exportar.');
    const p = OG.Store.project;
    const text = JSON.stringify(p, null, 2);
    download(text, slug(p.name) + '.orgflow.json', 'application/json;charset=utf-8');
    return text;
  }

  // read a File/Blob as text; for CSV, falls back to Windows-1252 when the bytes are not valid UTF-8
  function readFileText(file, legacyFallback) {
    return new Promise((resolve, reject) => {
      if (typeof file === 'string') return resolve(file);
      if (!file) return reject(new Error('Nenhum arquivo selecionado.'));
      const decode = (buf) => {
        if (typeof TextDecoder === 'undefined') return null;
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
          if (!legacyFallback) return new TextDecoder('utf-8').decode(buf);
          try {
            return new TextDecoder('windows-1252').decode(buf);
          } catch (e2) {
            return new TextDecoder('utf-8').decode(buf);
          }
        }
      };
      const onBuf = (buf) => {
        const t = decode(buf);
        if (t != null) resolve(t);
        else if (file.text) file.text().then(resolve, () => reject(new Error('Não foi possível ler o arquivo.')));
        else reject(new Error('Não foi possível ler o arquivo.'));
      };
      try {
        if (file.arrayBuffer) file.arrayBuffer().then(onBuf, () => reject(new Error('Não foi possível ler o arquivo.')));
        else if (typeof FileReader !== 'undefined') {
          const fr = new FileReader();
          fr.onload = () => onBuf(fr.result);
          fr.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
          fr.readAsArrayBuffer(file);
        } else reject(new Error('Seu navegador não permite ler arquivos.'));
      } catch (e) {
        reject(new Error('Não foi possível ler o arquivo.'));
      }
    });
  }

  function importJSONFile(file) {
    return readFileText(file, false).then((text) => {
      let data;
      try {
        data = JSON.parse(String(text).replace(/^﻿/, ''));
      } catch (e) {
        throw new Error('O arquivo não é um JSON válido.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Arquivo inválido: não é um projeto do OrgFlow.');
      if (data.app && data.app !== 'orgflow') throw new Error('Arquivo inválido: este JSON não foi gerado pelo OrgFlow.');
      if (!Array.isArray(data.versions)) throw new Error('Arquivo inválido: a lista de versões do organograma não foi encontrada.');
      if (!data.versions.length) throw new Error('Arquivo inválido: o projeto não contém nenhuma versão.');
      for (const v of data.versions) {
        if (!v || typeof v !== 'object' || (v.nodes != null && !Array.isArray(v.nodes))) throw new Error('Arquivo inválido: uma das versões está corrompida.');
      }
      return data;
    });
  }

  /* ---------------- CSV export ---------------- */
  const CSV_HEADER = ['ID', 'ID Superior', 'Função', 'Ocupante', 'Departamento', 'Nível', 'Vaga', 'Superior (função)', 'E-mail', 'Telefone', 'Observações'];

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // neutralise spreadsheet formula injection (stripped again by parseCSV)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[;",\r\n\t]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // hierarchical DFS order (array order = sibling order); orphans/cycles appended at the end
  function dfsOrder(nodes) {
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));
    const kids = { _: [] };
    nodes.forEach((n) => {
      const k = n.parentId && n.parentId !== n.id && byId[n.parentId] ? n.parentId : '_';
      (kids[k] = kids[k] || []).push(n);
    });
    const out = [];
    const seen = new Set();
    const walk = (pid) =>
      (kids[pid] || []).forEach((n) => {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        out.push(n);
        walk(n.id);
      });
    walk('_');
    nodes.forEach((n) => {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        out.push(n);
        walk(n.id);
      }
    });
    return { order: out, byId };
  }

  function toCSV(nodes, levels) {
    nodes = Array.isArray(nodes) ? nodes : storeNodes();
    levels = levels || storeLevels();
    const { order, byId } = dfsOrder(nodes);
    const lines = [CSV_HEADER.map(csvCell).join(';')];
    for (const n of order) {
      const lv = levels.find((l) => l.id === n.level);
      const parent = n.parentId && byId[n.parentId] ? byId[n.parentId] : null;
      lines.push(
        [n.id, parent ? parent.id : '', n.role, n.name, n.dept, lv ? lv.name : '', n.vacant ? 'Sim' : 'Não', parent ? parent.role : '', n.email, n.phone, n.notes]
          .map(csvCell)
          .join(';')
      );
    }
    return lines.join('\r\n') + '\r\n';
  }

  function exportCSV(nodes, filename) {
    const text = '﻿' + toCSV(Array.isArray(nodes) ? nodes : storeNodes());
    download(text, filename || baseFileName() + '.csv', 'text/csv;charset=utf-8');
    return text;
  }

  /* ---------------- CSV import ---------------- */
  function detectSeparator(text) {
    const counts = { ';': 0, '\t': 0, ',': 0 };
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') q = !q;
      else if (!q && (ch === '\n' || ch === '\r')) break;
      else if (!q && ch in counts) counts[ch]++;
    }
    let best = ';';
    for (const s of [';', '\t', ',']) if (counts[s] > counts[best]) best = s;
    return best;
  }

  function parseRows(text, sep) {
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    const n = text.length;
    let i = 0;
    while (i < n) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          q = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }
      if (ch === '"' && field.trim() === '') {
        field = '';
        q = true;
        i++;
        continue;
      }
      if (ch === sep) {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++;
        continue;
      }
      field += ch;
      i++;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  const normHeader = (h) =>
    stripAccents(h)
      .toLowerCase()
      .replace(/[^a-z0-9#]+/g, ' ')
      .trim();

  // [key, exact normalized synonyms, fallback regex]
  const COLS = [
    ['parentId', ['id superior', 'superior id', 'id do superior', 'id gestor', 'id do gestor', 'gestor id', 'parent', 'parent id', 'parentid', 'id pai', 'pai id', 'id chefe', 'manager id', 'reports to id', 'codigo superior', 'cod superior', 'codigo do superior', 'matricula superior', 'matricula do gestor'], /\b(id|cod|codigo|matricula)\b.*\b(superior|gestor|pai|parent|chefe|manager|lider)\b|\b(superior|gestor|parent|manager|chefe|pai)\b.*\b(id|cod|codigo|matricula)\b/],
    ['parentRole', ['superior funcao', 'funcao superior', 'funcao do superior', 'cargo superior', 'cargo do superior', 'superior cargo', 'gestor funcao', 'funcao do gestor', 'cargo do gestor', 'gestor cargo'], /\b(superior|gestor|chefe|lider|manager)\b.*\b(funcao|cargo|role|title)\b|\b(funcao|cargo)\b.*\b(superior|gestor|chefe)\b/],
    ['parentName', ['superior', 'gestor', 'chefe', 'lider', 'manager', 'reports to', 'superior imediato', 'gestor imediato', 'lider imediato', 'nome do superior', 'nome do gestor', 'superior nome', 'gestor nome', 'responde a', 'reporta a', 'gestor direto', 'superior direto'], /\b(superior|gestor|chefe|manager|reports|reporta|responde)\b/],
    ['id', ['id', 'codigo', 'cod', 'code', 'identificador', 'matricula', '#', 'n', 'no', 'num', 'numero'], /^(id|cod|codigo)\b/],
    ['role', ['funcao', 'cargo', 'role', 'posicao', 'position', 'title', 'job title', 'titulo', 'cargo funcao', 'funcao cargo', 'nome da funcao', 'nome do cargo'], /\b(funcao|cargo|role|posicao|position|title)\b/],
    ['name', ['ocupante', 'nome', 'colaborador', 'name', 'funcionario', 'pessoa', 'titular', 'employee', 'nome do colaborador', 'nome do ocupante', 'responsavel', 'full name', 'nome completo'], /\b(ocupante|nome|colaborador|name|funcionario|titular)\b/],
    ['dept', ['departamento', 'area', 'setor', 'dept', 'depto', 'department', 'divisao', 'unidade'], /\b(departamento|depto|area|setor|department|dept)\b/],
    ['level', ['nivel', 'level', 'nivel hierarquico', 'hierarquia', 'grade'], /\b(nivel|level|hierarq)/],
    ['vacant', ['vaga', 'vacant', 'vago', 'vaga em aberto', 'em aberto', 'vacancy', 'aberta'], /\b(vag|vacan)/],
    ['email', ['e mail', 'email', 'mail', 'correio eletronico'], /mail/],
    ['phone', ['telefone', 'fone', 'phone', 'celular', 'tel', 'ramal', 'whatsapp', 'contato'], /\b(telefone|fone|phone|celular|tel|ramal)\b/],
    ['notes', ['observacoes', 'observacao', 'obs', 'notas', 'nota', 'notes', 'comentarios', 'comentario', 'descricao', 'description'], /\b(obs|observ|nota|note|coment|descri)/],
    ['icon', ['icone', 'icon'], null],
    ['color', ['cor', 'color', 'colour'], null],
  ];

  function mapColumns(header) {
    const norm = header.map(normHeader);
    const idx = {};
    const used = new Set();
    // pass 1: exact synonyms
    norm.forEach((h, i) => {
      for (const [key, exact] of COLS) {
        if (idx[key] == null && exact.includes(h)) {
          idx[key] = i;
          used.add(i);
          return;
        }
      }
    });
    // pass 2: fuzzy fallback for remaining headers
    norm.forEach((h, i) => {
      if (used.has(i) || !h) return;
      for (const [key, , re] of COLS) {
        if (re && idx[key] == null && re.test(h)) {
          idx[key] = i;
          used.add(i);
          return;
        }
      }
    });
    return idx;
  }

  function matchLevel(raw, levels) {
    if (!raw) return null;
    const s = normKey(raw);
    const num = s.match(/^(?:nivel|level|n)?\s*(\d+)$/);
    if (num) {
      const l = levels[parseInt(num[1], 10) - 1];
      return l ? l.id : null;
    }
    const f1 = levels.find((l) => normKey(l.name) === s || normKey(l.id) === s) || levels.find((l) => normKey(l.name).includes(s)) || levels.find((l) => s.includes(normKey(l.name)));
    return f1 ? f1.id : null;
  }

  const YES = /^(sim|s|yes|y|x|1|true|verdadeiro|v)$/;
  const VACANT_NAME = /^\(?\s*(vaga|vago|vaga em aberto|a contratar|em aberto|tbd)\s*\)?$/;

  function parseCSV(text, levels) {
    levels = levels || storeLevels();
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    if (!text.trim()) throw new Error('O arquivo CSV está vazio.');
    const sep = detectSeparator(text);
    const rows = parseRows(text, sep).filter((r) => r.some((c) => String(c).trim() !== ''));
    if (!rows.length) throw new Error('O arquivo CSV está vazio.');
    const idx = mapColumns(rows[0]);
    if (idx.role == null) throw new Error('Coluna "Função" não encontrada no CSV. Inclua um cabeçalho como "Função" ou "Cargo".');

    const clean = (v) => {
      let s = v == null ? '' : String(v);
      if (/^'[=+\-@\t\r]/.test(s)) s = s.slice(1);
      return s.trim();
    };
    const get = (row, key) => (idx[key] != null ? clean(row[idx[key]]) : '');

    const recs = [];
    const usedIds = new Set();
    const origMap = new Map();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rec = {
        orig: get(row, 'id'),
        role: get(row, 'role'),
        name: get(row, 'name'),
        dept: get(row, 'dept'),
        levelRaw: get(row, 'level'),
        vacantRaw: get(row, 'vacant'),
        email: get(row, 'email'),
        phone: get(row, 'phone'),
        notes: get(row, 'notes'),
        icon: get(row, 'icon'),
        color: get(row, 'color'),
        pid: get(row, 'parentId'),
        pRole: get(row, 'parentRole'),
        pName: get(row, 'parentName'),
      };
      if (!rec.role && !rec.name) continue;
      let id;
      if (rec.orig && !usedIds.has(rec.orig)) id = rec.orig;
      else
        do id = newId();
        while (usedIds.has(id));
      usedIds.add(id);
      if (rec.orig && !origMap.has(rec.orig)) origMap.set(rec.orig, id);
      rec.id = id;
      rec.vacant = YES.test(normKey(rec.vacantRaw));
      if (VACANT_NAME.test(normKey(rec.name))) {
        rec.vacant = true;
        rec.name = '';
      }
      recs.push(rec);
    }
    if (!recs.length) throw new Error('Nenhuma linha válida encontrada no CSV.');

    const nameMap = new Map();
    const roleMap = new Map();
    const addTo = (m, k, id) => {
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(id);
    };
    recs.forEach((r) => {
      addTo(nameMap, normKey(r.name), r.id);
      addTo(roleMap, normKey(r.role), r.id);
    });
    const lookup = (val, selfId, preferRole) => {
      const k = normKey(val);
      if (!k) return null;
      const maps = preferRole ? [roleMap, nameMap] : [nameMap, roleMap];
      for (const m of maps) {
        const hit = (m.get(k) || []).find((x) => x !== selfId);
        if (hit) return hit;
      }
      return null;
    };

    recs.forEach((r) => {
      let pid = null;
      if (r.pid) {
        const t = origMap.get(r.pid);
        if (t && t !== r.id) pid = t;
      }
      if (!pid && r.pName) pid = lookup(r.pName, r.id, false);
      if (!pid && r.pRole) pid = lookup(r.pRole, r.id, true);
      if (!pid && r.pid) pid = lookup(r.pid, r.id, false);
      r.parentId = pid;
    });

    // break cycles: a node whose ancestor chain returns to itself becomes a root
    const byId = {};
    recs.forEach((r) => (byId[r.id] = r));
    recs.forEach((r) => {
      const seen = new Set([r.id]);
      let cur = r.parentId;
      while (cur) {
        if (cur === r.id) {
          r.parentId = null;
          break;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = byId[cur] ? byId[cur].parentId : null;
      }
    });

    const depthMemo = {};
    const depth = (r) => {
      if (depthMemo[r.id] != null) return depthMemo[r.id];
      let d = 0;
      let cur = r.parentId ? byId[r.parentId] : null;
      const seen = new Set([r.id]);
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        d++;
        cur = cur.parentId ? byId[cur.parentId] : null;
      }
      return (depthMemo[r.id] = d);
    };

    const icons = OG.ICONS || {};
    return recs.map((r) => {
      const level = matchLevel(r.levelRaw, levels) || levels[Math.min(depth(r), levels.length - 1)].id;
      return OG.normalizeNode({
        id: r.id,
        parentId: r.parentId,
        role: r.role || 'Função',
        name: r.name,
        dept: r.dept,
        level,
        icon: r.icon && icons[r.icon] ? r.icon : null,
        color: /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(r.color) ? r.color : null,
        vacant: r.vacant,
        email: r.email,
        phone: r.phone,
        notes: r.notes,
      });
    });
  }

  // convenience: File → Promise<nodes> (handles UTF-8 and Excel's Windows-1252 CSVs)
  function importCSVFile(file, levels) {
    return readFileText(file, true).then((text) => parseCSV(text, levels));
  }

  OG.Exporter = {
    buildSVG,
    exportSVG,
    exportPNG,
    exportJSON,
    importJSONFile,
    toCSV,
    exportCSV,
    parseCSV,
    importCSVFile,
    download,
    slug,
    // internals exposed for testing/reuse
    _fit: fit,
    _measure: measure,
  };
})();
