/* OrgFlow — accounts and organograms on Supabase. Access rules live in supabase/schema.sql. */
(function () {
  const OG = window.OG;
  const cfg = window.ORGFLOW_SUPABASE || {};
  const DOMAIN = '@orgflow.local';
  const authPassword = (p) => 'of-' + p; // see the note at the top of schema.sql

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  const MESSAGES = {
    bad_password: 'A senha atual está incorreta.',
    weak_password: 'Use uma senha nova com pelo menos 6 caracteres.',
    exists: 'Este usuário já existe.',
    bad_username: 'Use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado, como joao.silva.',
    no_user: 'Perfil não encontrado.',
    self: 'Você não pode remover o próprio perfil.',
    forbidden: 'Apenas o administrador pode fazer isso.',
  };
  const check = ({ data, error }) => {
    if (!error) return data;
    const code = Object.keys(MESSAGES).find((k) => (error.message || '').includes(k));
    if (code) throw new ApiError(400, code, MESSAGES[code]);
    if (/JWT|session/i.test(error.message || '')) throw new ApiError(401, 'login', 'Entre para continuar.');
    throw new ApiError(500, 'server', 'Falha ao falar com o servidor. Tente de novo.');
  };

  let sb = null;
  let me = null; // profiles row of the signed-in person
  const client = () => {
    if (!cfg.url || !cfg.anonKey || !window.supabase) throw new ApiError(0, 'offline', 'Sem servidor.');
    if (!sb) sb = window.supabase.createClient(cfg.url, cfg.anonKey);
    return sb;
  };
  const publicUser = (p) => ({ username: p.username, name: p.name, role: p.role, mustChange: p.must_change });

  async function loadMe() {
    const { data } = await client().auth.getSession();
    if (!data.session) throw new ApiError(401, 'login', 'Entre para continuar.');
    me = check(await client().from('profiles').select('*').eq('id', data.session.user.id).single());
    return me;
  }

  async function shareRows() {
    return check(await client().from('chart_shares').select('chart_id, user_id, perm'));
  }
  async function profileRows() {
    return check(await client().from('profiles').select('id, username, name, role, must_change').order('name'));
  }
  const META = 'id, name, owner, owner_name, rev, updated_at';

  function toMeta(c, shares, profiles) {
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const sharedWith = {};
    shares.filter((s) => s.chart_id === c.id && byId[s.user_id]).forEach((s) => (sharedWith[byId[s.user_id].username] = s.perm));
    const mine = shares.find((s) => s.chart_id === c.id && s.user_id === me.id);
    const perm = c.owner === me.id ? 'owner' : mine ? mine.perm : 'admin';
    return { id: c.id, name: c.name, owner: byId[c.owner] ? byId[c.owner].username : '', ownerName: c.owner_name, rev: c.rev, updatedAt: new Date(c.updated_at).getTime(), sharedWith, perm };
  }
  async function metaOf(id) {
    const c = check(await client().from('charts').select(META).eq('id', id).single());
    return toMeta(c, await shareRows(), await profileRows());
  }

  const actions = {
    async me() {
      return { user: publicUser(await loadMe()) };
    },
    async login({ username, password }) {
      const email = String(username || '').trim().toLowerCase() + DOMAIN;
      const { error } = await client().auth.signInWithPassword({ email, password: authPassword(password) });
      if (error) throw new ApiError(401, 'bad_login', /rate|many/i.test(error.message) ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Usuário ou senha incorretos.');
      return { user: publicUser(await loadMe()) };
    },
    async logout() {
      await client().auth.signOut();
      return {};
    },
    async changePassword({ current, next }) {
      if (String(next).length < 6 || next === '123') throw new ApiError(400, 'weak_password', MESSAGES.weak_password);
      check(await client().rpc('change_password', { p_current: authPassword(current), p_next: authPassword(next) }));
      return { user: publicUser(await loadMe()) };
    },
    async listCharts() {
      const rows = check(await client().from('charts').select(META).order('updated_at', { ascending: false }));
      const shares = await shareRows();
      const profiles = await profileRows();
      const list = rows.map((c) => toMeta(c, shares, profiles));
      return { own: list.filter((m) => m.perm === 'owner'), shared: list.filter((m) => m.perm === 'view' || m.perm === 'edit'), all: me.role === 'admin' ? list : [] };
    },
    async getChart({ id }) {
      const row = check(await client().from('charts').select('project').eq('id', id).single());
      return { meta: await metaOf(id), project: row.project };
    },
    async saveChart({ id, rev, name, project }) {
      const fields = { name: String(name || 'Organograma').slice(0, 120), project, updated_at: new Date().toISOString(), updated_by: me.id };
      if (!id) {
        const row = check(await client().from('charts').insert({ ...fields, owner: me.id, owner_name: me.name }).select('id').single());
        return { meta: await metaOf(row.id) };
      }
      const rows = check(await client().from('charts').update({ ...fields, rev: rev + 1 }).eq('id', id).eq('rev', rev).select('id'));
      if (rows.length) return { meta: await metaOf(id) };
      const now = await metaOf(id);
      if (now.perm === 'view') throw new ApiError(403, 'read_only', 'Você só tem permissão para ver este organograma.');
      throw new ApiError(409, 'conflict', 'Outra pessoa alterou este organograma.');
    },
    async deleteChart({ id }) {
      check(await client().from('charts').delete().eq('id', id));
      return {};
    },
    async shareChart({ id, username, perm }) {
      const target = (await profileRows()).find((p) => p.username === username);
      if (!target) throw new ApiError(404, 'no_user', MESSAGES.no_user);
      const table = client().from('chart_shares');
      if (perm) check(await table.upsert({ chart_id: id, user_id: target.id, perm }));
      else check(await table.delete().eq('chart_id', id).eq('user_id', target.id));
      return { meta: await metaOf(id) };
    },
    async listProfiles() {
      return { users: (await profileRows()).map(({ username, name }) => ({ username, name })) };
    },
    async listUsers() {
      return { users: (await profileRows()).map(publicUser) };
    },
    async createUser({ username, name }) {
      check(await client().rpc('admin_create_user', { p_username: String(username || '').trim().toLowerCase(), p_name: name || '' }));
      return {};
    },
    async resetPassword({ username }) {
      check(await client().rpc('admin_reset_password', { p_username: username }));
      return {};
    },
    async deleteUser({ username }) {
      check(await client().rpc('admin_delete_user', { p_username: username }));
      return {};
    },
  };

  OG.Backend = { call: (action, data) => actions[action](data || {}), ApiError };
})();
