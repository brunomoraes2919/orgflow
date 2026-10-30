/* OrgFlow — "pasta de versões": save and reopen projects in a folder on the computer */
(function () {
  const OG = window.OG;
  const S = OG.Store;
  const esc = OG.esc;
  const DB = 'orgflow.folder';
  const SUFFIX = '.orgflow.json';
  const supported = typeof window.showDirectoryPicker === 'function';

  let dir = null; // FileSystemDirectoryHandle
  let writable = false; // permission confirmed in this session
  let auto = true;
  let timer = null;

  /* the folder handle survives reloads in IndexedDB (localStorage cannot hold it) */
  function idb(mode, fn) {
    return new Promise((resolve) => {
      try {
        const open = indexedDB.open(DB, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const req = fn(open.result.transaction('kv', mode).objectStore('kv'));
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function fileName() {
    const X = OG.Exporter;
    return `${X.slug(S.project.name)}-${X.slug(S.version.name)}${SUFFIX}`;
  }

  function setStatus() {
    const el = document.getElementById('folder-status');
    if (!el) return;
    el.textContent = dir ? `Pasta: ${dir.name}` + (writable ? (auto ? ' (salvando)' : '') : ' (clique para reconectar)') : '';
  }

  async function ensurePermission() {
    if (!dir) return false;
    const opts = { mode: 'readwrite' };
    if ((await dir.queryPermission(opts)) === 'granted' || (await dir.requestPermission(opts)) === 'granted') writable = true;
    setStatus();
    return writable;
  }

  async function saveCurrent() {
    const fh = await dir.getFileHandle(fileName(), { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(S.project, null, 2));
    await w.close();
  }

  async function listFiles() {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      const f = await h.getFile();
      out.push({ name, file: f, date: f.lastModified });
    }
    return out.sort((a, b) => b.date - a.date);
  }

  async function renderList(m) {
    const box = m.querySelector('#fd-body');
    if (!dir) {
      box.innerHTML = '<p>Nenhuma pasta conectada. Escolha uma pasta do computador para guardar as versões.</p>';
      return;
    }
    const ok = await ensurePermission();
    if (!ok) {
      box.innerHTML = `<p>Sem permissão para acessar a pasta <b>${esc(dir.name)}</b>.</p>`;
      return;
    }
    const files = await listFiles();
    box.innerHTML =
      `<p>Pasta conectada: <b>${esc(dir.name)}</b></p>
       <label class="check"><input type="checkbox" id="fd-auto" ${auto ? 'checked' : ''}> Salvar automaticamente nesta pasta</label>` +
      (files.length
        ? `<div class="fd-list">${files
            .map(
              (f, i) => `<div class="fd-row"><span><b>${esc(f.name.replace(SUFFIX, ''))}</b><small>${esc(new Date(f.date).toLocaleString('pt-BR'))}</small></span>
                <button class="btn small" data-fd-open="${i}">Abrir</button></div>`
            )
            .join('')}</div>`
        : '<p>A pasta ainda não tem versões salvas.</p>');
    box._files = files;
  }

  async function connect(m) {
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'orgflow' });
    } catch (e) {
      return; // the picker was cancelled
    }
    await idb('readwrite', (st) => st.put(dir, 'dir'));
    writable = true;
    setStatus();
    await saveCurrent();
    OG.App.toast(`Versão salva na pasta ${dir.name}`);
    renderList(m);
  }

  async function open(file, close) {
    const ok = await OG.App.confirmModal('Abrir projeto', `Abrir <b>${esc(file.name)}</b>? O projeto aberto agora será substituído neste navegador.`, 'Abrir');
    if (!ok) return;
    try {
      S.loadProject(await OG.Exporter.importJSONFile(file));
      close();
      OG.App.toast(`Projeto "${S.project.name}" aberto`);
    } catch (e) {
      OG.App.toast(e.message || 'Arquivo inválido', { error: true });
    }
  }

  function showModal() {
    const actions = supported
      ? [
          { label: 'Escolher pasta', left: true, autoClose: false, onClick: (c, m) => (connect(m), false) },
          {
            label: 'Salvar versão atual',
            primary: true,
            autoClose: false,
            onClick: (c, m) => {
              if (!dir) return connect(m), false;
              ensurePermission().then(async (ok) => {
                if (!ok) return;
                await saveCurrent();
                OG.App.toast(`Salvo em ${dir.name}`);
                renderList(m);
              });
              return false;
            },
          },
        ]
      : [
          { label: 'Abrir arquivo', left: true, onClick: () => document.getElementById('file-json').click() },
          { label: 'Salvar arquivo', primary: true, onClick: () => OG.Exporter.exportJSON() },
        ];
    OG.App.modal({
      title: 'Pasta de versões',
      body: supported
        ? '<div id="fd-body"><p>Carregando…</p></div>'
        : '<div id="fd-body"><p>Este navegador não permite conectar uma pasta. Use Chrome ou Edge no computador, ou salve e abra o arquivo do projeto pelos botões abaixo.</p></div>',
      actions,
      onOpen: (m, close) => {
        if (supported) renderList(m);
        m.addEventListener('click', (e) => {
          const b = e.target.closest('[data-fd-open]');
          if (b) open(m.querySelector('#fd-body')._files[+b.dataset.fdOpen].file, close);
        });
        m.addEventListener('change', (e) => {
          if (e.target.id !== 'fd-auto') return;
          auto = e.target.checked;
          try {
            localStorage.setItem('orgflow.folder.auto', auto ? '1' : '0');
          } catch (err) {
            /* keeps the choice for this session only */
          }
          setStatus();
        });
      },
    });
  }

  async function init() {
    document.getElementById('btn-folder').onclick = showModal;
    document.getElementById('folder-status').onclick = showModal;
    document.getElementById('btn-new-version').onclick = () => OG.App.versionCmd('version-new');
    try {
      auto = localStorage.getItem('orgflow.folder.auto') !== '0';
    } catch (e) {
      auto = true;
    }
    if (supported) {
      dir = await idb('readonly', (st) => st.get('dir'));
      if (dir) writable = (await dir.queryPermission({ mode: 'readwrite' })) === 'granted';
      setStatus();
    }
    // autosave follows the browser save; a failed write only pauses it
    S.on((type) => {
      if (type !== 'saved' || !dir || !writable || !auto) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveCurrent().catch(() => {
          writable = false;
          setStatus();
        });
      }, 1500);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
