/* OrgFlow — login, profiles and organograms saved on the server.
   Where no server answers (GitHub Pages, opening the file) the app stays in local mode. */
(function () {
  const OG = window.OG;
  const S = OG.Store;
  const esc = OG.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const LAST = 'orgflow.cloud.last';

  const cloud = { active: false, me: null, chart: null, lastJson: null, saving: false, again: false };

  const api = (action, data) => OG.Backend.call(action, data);

  const toast = (m, o) => OG.App.toast(m, o);
  const fail = (e) => {
    if (e.code === 'login') return showLogin();
    toast(e.message || 'Falha de conexão. Tente de novo.', { error: true, duration: 6000 });
  };
  const setStatus = (text) => {
    const el = $('#save-status');
    el.className = 'save-status';
    el.textContent = text;
  };

  /* ---------- login screens ---------- */
  function gate(title, hint, fields, button, onSubmit) {
    let el = $('#auth-gate');
    if (!el) {
      el = document.createElement('div');
      el.id = 'auth-gate';
      document.body.appendChild(el);
    }
    el.innerHTML = `<form class="auth-card">
      <div class="auth-logo">${OG.icon('sitemap', 24)}</div>
      <h1>${esc(title)}</h1><p>${esc(hint)}</p>
      ${fields.map((f) => `<div class="field"><label for="${f.id}">${esc(f.label)}</label><input class="input" id="${f.id}" type="${f.type}" autocomplete="${f.auto}" required></div>`).join('')}
      <div class="auth-error" role="alert" hidden></div>
      <button class="btn primary block" type="submit">${esc(button)}</button>
    </form>`;
    const form = $('form', el);
    const error = $('.auth-error', el);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button', form);
      btn.disabled = true;
      error.hidden = true;
      try {
        await onSubmit((id) => $('#' + id, el).value);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
      btn.disabled = false;
    };
    $('input', form).focus();
  }

  function showLogin() {
    gate('Entrar no OrgFlow', 'Use o usuário criado pelo administrador. No primeiro acesso, a senha é 123.',
      [
        { id: 'au-user', label: 'Usuário', type: 'text', auto: 'username' },
        { id: 'au-pass', label: 'Senha', type: 'password', auto: 'current-password' },
      ],
      'Entrar',
      async (v) => {
        const r = await api('login', { username: v('au-user'), password: v('au-pass') });
        cloud.me = r.user;
        r.user.mustChange ? showChange(v('au-pass')) : enter();
      });
  }

  function showChange(current) {
    gate('Crie sua senha', 'A senha padrão só vale para o primeiro acesso. Escolha uma senha com pelo menos 6 caracteres.',
      [
        { id: 'au-new', label: 'Nova senha', type: 'password', auto: 'new-password' },
        { id: 'au-new2', label: 'Repita a nova senha', type: 'password', auto: 'new-password' },
      ],
      'Salvar senha e entrar',
      async (v) => {
        if (v('au-new') !== v('au-new2')) throw new Error('As duas senhas não são iguais.');
        const r = await api('changePassword', { current, next: v('au-new') });
        cloud.me = r.user;
        enter();
      });
  }

  /* ---------- organograms ---------- */
  function setChart(meta, json) {
    cloud.chart = meta;
    cloud.lastJson = json;
    try {
      localStorage.setItem(LAST, meta.id);
    } catch (e) {
      /* only the convenience of reopening the last chart is lost */
    }
    const readOnly = meta.perm === 'view';
    const foreign = meta.owner !== cloud.me.username;
    const b = $('#cloud-banner');
    b.hidden = !readOnly && !foreign;
    b.textContent = readOnly ? `Somente leitura: organograma de ${meta.ownerName}. Alterações não serão salvas.` : foreign ? `Organograma de ${meta.ownerName}. Suas alterações serão salvas para essa pessoa.` : '';
    setStatus(readOnly ? 'Somente leitura' : 'Salvo no seu perfil');
  }

  async function openChart(id) {
    const r = await api('getChart', { id });
    S.loadProject(JSON.parse(r.project));
    setChart(r.meta, JSON.stringify(S.project));
  }

  async function saveNow() {
    if (!cloud.active || !cloud.me || cloud.me.mustChange) return;
    if (cloud.chart && cloud.chart.perm === 'view') return;
    const project = JSON.stringify(S.project);
    if (project === cloud.lastJson) return;
    if (cloud.saving) {
      cloud.again = true;
      return;
    }
    cloud.saving = true;
    setStatus('Salvando no seu perfil…');
    try {
      const c = cloud.chart;
      const r = await api('saveChart', { id: c && c.id, rev: c && c.rev, name: S.project.name, project });
      setChart(r.meta, project);
    } catch (e) {
      if (e.code === 'conflict') {
        toast('Outra pessoa alterou este organograma.', { error: true, duration: 15000, action: { label: 'Carregar a versão dela', run: () => openChart(cloud.chart.id).catch(fail) } });
        setStatus('Não salvo: há uma versão mais nova');
      } else {
        setStatus('Não salvo');
        fail(e);
      }
    }
    cloud.saving = false;
    if (cloud.again) {
      cloud.again = false;
      saveNow();
    }
  }

  // the next save creates a new organogram (used by Novo projeto and Abrir projeto)
  function detach() {
    cloud.chart = null;
    cloud.lastJson = null;
    $('#cloud-banner').hidden = true;
  }

  const row = (m) => {
    const canManage = m.perm === 'owner' || m.perm === 'admin';
    const shared = Object.keys(m.sharedWith).length;
    return `<div class="fd-row"><span><b>${esc(m.name)}</b><small>${esc(m.ownerName)} · ${esc(new Date(m.updatedAt).toLocaleString('pt-BR'))}${shared ? ` · compartilhado com ${shared}` : ''}${m.perm === 'view' ? ' · só leitura' : ''}</small></span>
      <div class="row-actions">
        <button class="btn small" data-c-open="${esc(m.id)}">Abrir</button>
        ${canManage ? `<button class="btn small" data-c-share="${esc(m.id)}">Compartilhar</button><button class="icon-btn" data-c-del="${esc(m.id)}" title="Excluir">${OG.icon('trash', 15)}</button>` : ''}
      </div></div>`;
  };
  const DAY = 86400000;
  const day = (t) => new Date(t).toLocaleDateString('pt-BR');
  const trashRow = (m) => `<div class="fd-row"><span><b>${esc(m.name)}</b><small>${esc(m.ownerName)} · excluído em ${day(m.deletedAt)} · some de vez em ${day(m.deletedAt + 30 * DAY)}</small></span>
      <div class="row-actions">
        <button class="btn small" data-c-restore="${esc(m.id)}">${OG.icon('undo', 14)}Restaurar</button>
        <button class="icon-btn" data-c-purge="${esc(m.id)}" title="Excluir definitivamente">${OG.icon('trash', 15)}</button>
      </div></div>`;
  const trashSection = (list) => `<h4 class="cl-title">Lixeira</h4>${list.length ? `<p class="cl-empty">Organogramas excluídos ficam aqui por 30 dias.</p><div class="fd-list">${list.map(trashRow).join('')}</div>` : '<p class="cl-empty">A lixeira está vazia. Organogramas excluídos ficam aqui por 30 dias.</p>'}`;
  const section = (title, list, empty) => `<h4 class="cl-title">${esc(title)}</h4>${list.length ? `<div class="fd-list">${list.map(row).join('')}</div>` : `<p class="cl-empty">${esc(empty)}</p>`}`;

  async function showCharts() {
    let lists;
    const render = async (m) => {
      lists = await api('listCharts');
      const seen = new Set([...lists.own, ...lists.shared].map((x) => x.id));
      $('#cl-body', m).innerHTML =
        section('Meus organogramas', lists.own, 'Você ainda não tem organogramas salvos.') +
        section('Compartilhados comigo', lists.shared, 'Nada foi compartilhado com você.') +
        (cloud.me.role === 'admin' ? section('Organogramas dos outros perfis', lists.all.filter((x) => !seen.has(x.id)), 'Nenhum outro perfil salvou organogramas.') : '') +
        (lists.trash ? trashSection(lists.trash) : '');
    };
    const find = (id) => [...lists.own, ...lists.shared, ...lists.all, ...(lists.trash || [])].find((x) => x.id === id);
    await saveNow();
    OG.App.modal({
      title: 'Organogramas',
      size: 'wide',
      body: '<div id="cl-body"><p>Carregando…</p></div>',
      actions: [
        {
          label: 'Novo organograma',
          primary: true,
          icon: 'plus',
          onClick: () => {
            detach();
            S.newProject('Novo Organograma', []);
            toast('Novo organograma criado. Dê um nome a ele na barra superior.');
          },
        },
      ],
      onOpen: (m, close) => {
        render(m).catch(fail);
        m.addEventListener('click', async (e) => {
          const open = e.target.closest('[data-c-open]');
          const share = e.target.closest('[data-c-share]');
          const del = e.target.closest('[data-c-del]');
          const restore = e.target.closest('[data-c-restore]');
          const purge = e.target.closest('[data-c-purge]');
          try {
            if (open) {
              await openChart(open.dataset.cOpen);
              close();
            } else if (share) {
              showShare(find(share.dataset.cShare), () => render(m).catch(fail));
            } else if (del) {
              const c = find(del.dataset.cDel);
              const text = lists.trash
                ? `Mover <b>${esc(c.name)}</b> para a lixeira? Você pode restaurá-lo por 30 dias.`
                : `Excluir <b>${esc(c.name)}</b> de ${esc(c.ownerName)}? Esta ação não pode ser desfeita.`;
              if (!(await OG.App.confirmModal('Excluir organograma', text, lists.trash ? 'Mover para a lixeira' : 'Excluir', true))) return;
              await api('deleteChart', { id: c.id });
              if (cloud.chart && cloud.chart.id === c.id) detach();
              await render(m);
              if (lists.trash) toast(`"${c.name}" foi para a lixeira`, { action: { label: 'Desfazer', run: () => api('restoreChart', { id: c.id }).then(() => render(m), fail) } });
            } else if (restore) {
              const c = find(restore.dataset.cRestore);
              await api('restoreChart', { id: c.id });
              await render(m);
              toast(`"${c.name}" foi restaurado`);
            } else if (purge) {
              const c = find(purge.dataset.cPurge);
              if (!(await OG.App.confirmModal('Excluir definitivamente', `Apagar <b>${esc(c.name)}</b> de vez? Depois disso não será possível recuperá-lo.`, 'Excluir definitivamente', true))) return;
              await api('purgeChart', { id: c.id });
              await render(m);
            }
          } catch (err) {
            fail(err);
          }
        });
      },
    });
  }

  async function showShare(meta, done) {
    const { users } = await api('listProfiles');
    const others = users.filter((u) => u.username !== meta.owner);
    const name = (id) => (users.find((u) => u.username === id) || { name: id }).name;
    OG.App.modal({
      title: `Compartilhar: ${meta.name}`,
      body: `<div class="row"><div class="field"><label for="sh-user">Perfil</label><select id="sh-user">${others.map((u) => `<option value="${esc(u.username)}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select></div>
        <div class="field"><label for="sh-perm">Permissão</label><select id="sh-perm"><option value="view">Pode ver</option><option value="edit">Pode editar</option></select></div></div>
        <div id="sh-list"></div>`,
      actions: [
        {
          label: 'Compartilhar',
          primary: true,
          autoClose: false,
          onClick: (c, m) => {
            const username = $('#sh-user', m).value;
            if (!username) return false;
            api('shareChart', { id: meta.id, username, perm: $('#sh-perm', m).value }).then((r) => {
              meta = r.meta;
              list(m);
              toast(`Compartilhado com ${name(username)}`);
              done();
            }, fail);
            return false;
          },
        },
      ],
      onOpen: (m) => {
        list(m);
        m.addEventListener('click', (e) => {
          const b = e.target.closest('[data-sh-del]');
          if (!b) return;
          api('shareChart', { id: meta.id, username: b.dataset.shDel, perm: null }).then((r) => {
            meta = r.meta;
            list(m);
            done();
          }, fail);
        });
      },
    });
    function list(m) {
      const rows = Object.entries(meta.sharedWith);
      $('#sh-list', m).innerHTML = rows.length
        ? rows.map(([u, p]) => `<div class="fd-row"><span><b>${esc(name(u))}</b><small>${p === 'edit' ? 'Pode editar' : 'Pode ver'}</small></span><button class="btn small" data-sh-del="${esc(u)}">Remover</button></div>`).join('')
        : '<p class="cl-empty">Ainda não compartilhado com ninguém.</p>';
    }
  }

  /* ---------- administrator: profiles ---------- */
  async function showUsers() {
    const render = async (m) => {
      const { users } = await api('listUsers');
      $('#us-list', m).innerHTML = users
        .map(
          (u) => `<div class="fd-row"><span><b>${esc(u.name)}</b><small>${esc(u.username)}${u.role === 'admin' ? ' · administrador' : ''}${u.mustChange ? ' · ainda não trocou a senha' : ''}</small></span>
          ${u.role === 'admin' ? '' : `<div class="row-actions"><button class="btn small" data-us-reset="${esc(u.username)}">Voltar senha para 123</button><button class="icon-btn" data-us-del="${esc(u.username)}" title="Remover perfil">${OG.icon('trash', 15)}</button></div>`}</div>`
        )
        .join('');
    };
    OG.App.modal({
      title: 'Perfis',
      size: 'wide',
      body: `<div class="row"><div class="field"><label for="us-name">Nome</label><input type="text" id="us-name" placeholder="João Silva"></div>
        <div class="field"><label for="us-user">Usuário</label><input type="text" id="us-user" placeholder="joao.silva"></div></div>
        <p class="cl-empty">O perfil começa com a senha 123, que precisa ser trocada no primeiro acesso.</p><div class="fd-list" id="us-list"></div>`,
      actions: [
        {
          label: 'Criar perfil',
          primary: true,
          autoClose: false,
          onClick: (c, m) => {
            api('createUser', { name: $('#us-name', m).value, username: $('#us-user', m).value }).then(() => {
              $('#us-name', m).value = $('#us-user', m).value = '';
              toast('Perfil criado');
              render(m).catch(fail);
            }, fail);
            return false;
          },
        },
      ],
      onOpen: (m) => {
        render(m).catch(fail);
        m.addEventListener('click', async (e) => {
          const reset = e.target.closest('[data-us-reset]');
          const del = e.target.closest('[data-us-del]');
          try {
            if (reset) {
              await api('resetPassword', { username: reset.dataset.usReset });
              toast('Senha redefinida para 123');
              await render(m);
            } else if (del) {
              if (!(await OG.App.confirmModal('Remover perfil', `Remover <b>${esc(del.dataset.usDel)}</b>? Os organogramas continuam disponíveis para você.`, 'Remover', true))) return;
              await api('deleteUser', { username: del.dataset.usDel });
              await render(m);
            }
          } catch (err) {
            fail(err);
          }
        });
      },
    });
  }

  /* ---------- session ---------- */
  async function logout() {
    await saveNow();
    await api('logout').catch(() => {});
    try {
      localStorage.clear(); // the next person on this browser must not see this profile's data
    } catch (e) {
      /* nothing stored */
    }
    S.saveNow = () => {}; // keep a pending save from writing the data back before the reload
    location.reload();
  }

  const isSample = () => {
    const v = S.project.versions;
    return v.length === 1 && v[0].nodes.length === 36 && v[0].nodes[0].role === 'Diretor Presidente';
  };

  async function enter() {
    const g = $('#auth-gate');
    if (g) g.remove();
    const me = cloud.me;
    const bar = $('#cloud-bar');
    bar.hidden = false;
    bar.innerHTML = `<button class="btn" id="btn-charts">${OG.icon('folderOpen', 16)}<span class="lbl-always">Organogramas</span></button>
      ${me.role === 'admin' ? `<button class="btn" id="btn-users">${OG.icon('users', 16)}<span class="lbl-always">Perfis</span></button>` : ''}
      <button class="btn ghost" id="btn-logout" title="Sair de ${esc(me.username)}">${OG.icon('user', 16)}<span class="lbl-always">${esc(me.name)} · Sair</span></button>`;
    $('#btn-charts').onclick = () => showCharts().catch(fail);
    $('#btn-logout').onclick = logout;
    if (me.role === 'admin') $('#btn-users').onclick = () => showUsers().catch(fail);

    const { own, shared, all } = await api('listCharts');
    const list = [...own, ...shared, ...all];
    let last = null;
    try {
      last = localStorage.getItem(LAST);
    } catch (e) {
      /* opens the first organogram instead */
    }
    // this browser never synced and holds real work: keep it as a new organogram, never overwrite it
    if (!last && !isSample()) {
      detach();
      await saveNow();
      toast(`"${S.project.name}" foi salvo no seu perfil a partir deste navegador.`, { duration: 7000 });
      return;
    }
    const pick = list.find((c) => c.id === last) || own[0] || shared[0];
    if (pick) await openChart(pick.id);
    else {
      // first login: what is in this browser becomes the profile's first organogram
      detach();
      await saveNow();
    }
  }

  async function init() {
    let me;
    try {
      me = await api('me');
    } catch (e) {
      if (e.code !== 'login') return; // no server here: local mode
      cloud.active = true;
      S.on(onStore);
      return showLogin();
    }
    cloud.active = true;
    S.on(onStore);
    cloud.me = me.user;
    if (me.user.mustChange) return showLogin(); // the current password is needed again
    enter().catch(fail);
  }

  let timer = null;
  function onStore(type) {
    if (type !== 'saved' || !cloud.me) return;
    clearTimeout(timer);
    timer = setTimeout(saveNow, 800);
  }

  OG.Cloud = { detach, isActive: () => cloud.active };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
