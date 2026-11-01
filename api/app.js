/* OrgFlow — accounts and organogram storage (Vercel function, one POST route per action) */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const ADMIN = 'bruno.moraes';
const DEFAULT_PASSWORD = '123';
const COOKIE = 'orgflow_session';
const SESSION_DAYS = 7;
const MAX_FAILS = 8;
const MAX_PROJECT = 900 * 1024; // Upstash free plan: 1 MB per request
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,39}$/;

const dbUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const dbToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const r = await fetch(dbUrl(), { method: 'POST', headers: { Authorization: `Bearer ${dbToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const out = await r.json();
  if (out.error) throw new Error(out.error);
  return out.result;
}
const getJson = async (key) => {
  const v = await redis('GET', key);
  return v ? JSON.parse(v) : null;
};
const setJson = (key, value) => redis('SET', key, JSON.stringify(value));

class Fail extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------- passwords and sessions ---------- */
async function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}
async function checkPassword(password, user) {
  const { hash } = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
const tokenKey = (token) => 'sess:' + crypto.createHash('sha256').update(token).digest('hex');

function setCookie(res, token, maxAge) {
  const secure = process.env.ORGFLOW_INSECURE ? '' : ' Secure;';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`);
}
function readToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([a-f0-9]+)`));
  return m && m[1];
}
async function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const username = await redis('GET', tokenKey(token));
  return username ? getJson('user:' + username) : null;
}
const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange });

async function newUser(username, name, role) {
  const pw = await hashPassword(DEFAULT_PASSWORD);
  const user = { username, name: name || username, role, mustChange: true, createdAt: Date.now(), ...pw };
  // NX: an existing account is never overwritten
  if (!(await redis('SET', 'user:' + username, JSON.stringify(user), 'NX'))) return null;
  await redis('SADD', 'users', username);
  return user;
}

/* ---------- permissions ---------- */
function permission(meta, user) {
  if (meta.owner === user.username) return 'owner';
  if (meta.sharedWith[user.username]) return meta.sharedWith[user.username];
  return user.role === 'admin' ? 'admin' : null;
}
const canWrite = (p) => p === 'owner' || p === 'edit' || p === 'admin';
async function chartFor(id, user) {
  const meta = typeof id === 'string' ? await getJson('chart:' + id + ':meta') : null;
  const perm = meta && permission(meta, user);
  if (!perm) throw new Fail(404, 'not_found', 'Organograma não encontrado.');
  return { meta, perm };
}
const metaView = (meta, user) => ({ ...meta, perm: permission(meta, user) });
async function metas(setKey, user) {
  const ids = (await redis('SMEMBERS', setKey)) || [];
  const all = await Promise.all(ids.map((id) => getJson('chart:' + id + ':meta')));
  return all.filter(Boolean).map((m) => metaView(m, user)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ---------- actions ---------- */
const publicActions = {
  async login(body, req, res) {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const failKey = 'fail:' + username;
    if (Number(await redis('GET', failKey)) >= MAX_FAILS) throw new Fail(429, 'locked', 'Muitas tentativas. Aguarde 15 minutos ou peça ao administrador para redefinir a senha.');
    let user = USERNAME.test(username) ? await getJson('user:' + username) : null;
    // the administrator account is created by its first login
    if (!user && username === ADMIN) user = (await newUser(ADMIN, 'Bruno Moraes', 'admin')) || (await getJson('user:' + ADMIN));
    const ok = user ? await checkPassword(password, user) : (await hashPassword(password), false);
    if (!ok) {
      await redis('INCR', failKey);
      await redis('EXPIRE', failKey, 900);
      throw new Fail(401, 'bad_login', 'Usuário ou senha incorretos.');
    }
    await redis('DEL', failKey);
    const token = crypto.randomBytes(32).toString('hex');
    await redis('SET', tokenKey(token), user.username, 'EX', SESSION_DAYS * 86400);
    setCookie(res, token, SESSION_DAYS * 86400);
    return { user: publicUser(user) };
  },
  async logout(body, req, res) {
    const token = readToken(req);
    if (token) await redis('DEL', tokenKey(token));
    setCookie(res, '', 0);
    return {};
  },
};

// allowed while the default password is still in use
const passwordActions = {
  async me(body, req, res, user) {
    return { user: publicUser(user) };
  },
  async changePassword(body, req, res, user) {
    const next = String(body.next || '');
    if (!(await checkPassword(String(body.current || ''), user))) throw new Fail(400, 'bad_password', 'A senha atual está incorreta.');
    if (next.length < 6 || next === DEFAULT_PASSWORD) throw new Fail(400, 'weak_password', 'Use uma senha nova com pelo menos 6 caracteres.');
    await setJson('user:' + user.username, { ...user, ...(await hashPassword(next)), mustChange: false });
    return { user: publicUser({ ...user, mustChange: false }) };
  },
};

const actions = {
  async listCharts(body, req, res, user) {
    return {
      own: await metas('charts:owner:' + user.username, user),
      shared: await metas('charts:shared:' + user.username, user),
      all: user.role === 'admin' ? await metas('charts', user) : [],
    };
  },
  async getChart(body, req, res, user) {
    const { meta, perm } = await chartFor(body.id, user);
    return { meta: { ...meta, perm }, project: await redis('GET', 'chart:' + meta.id + ':data') };
  },
  async saveChart(body, req, res, user) {
    const project = String(body.project || '');
    if (!project) throw new Fail(400, 'empty', 'Nada para salvar.');
    if (Buffer.byteLength(project) > MAX_PROJECT) throw new Fail(413, 'too_large', 'O organograma ficou grande demais para salvar. Remova algumas fotos.');
    const name = String(body.name || 'Organograma').slice(0, 120);
    let meta;
    if (body.id) {
      const found = await chartFor(body.id, user);
      if (!canWrite(found.perm)) throw new Fail(403, 'read_only', 'Você só tem permissão para ver este organograma.');
      if (found.meta.rev !== body.rev) throw new Fail(409, 'conflict', 'Outra pessoa alterou este organograma.');
      meta = { ...found.meta, name, rev: found.meta.rev + 1, updatedAt: Date.now(), updatedBy: user.username };
    } else {
      meta = { id: crypto.randomUUID(), name, owner: user.username, ownerName: user.name, sharedWith: {}, rev: 1, updatedAt: Date.now(), updatedBy: user.username };
      await redis('SADD', 'charts', meta.id);
      await redis('SADD', 'charts:owner:' + user.username, meta.id);
    }
    await redis('SET', 'chart:' + meta.id + ':data', project);
    await setJson('chart:' + meta.id + ':meta', meta);
    return { meta: metaView(meta, user) };
  },
  async deleteChart(body, req, res, user) {
    const { meta, perm } = await chartFor(body.id, user);
    if (perm !== 'owner' && perm !== 'admin') throw new Fail(403, 'forbidden', 'Só o dono pode excluir este organograma.');
    await redis('DEL', 'chart:' + meta.id + ':meta', 'chart:' + meta.id + ':data');
    await redis('SREM', 'charts', meta.id);
    await redis('SREM', 'charts:owner:' + meta.owner, meta.id);
    await Promise.all(Object.keys(meta.sharedWith).map((u) => redis('SREM', 'charts:shared:' + u, meta.id)));
    return {};
  },
  async shareChart(body, req, res, user) {
    const { meta, perm } = await chartFor(body.id, user);
    if (perm !== 'owner' && perm !== 'admin') throw new Fail(403, 'forbidden', 'Só o dono pode compartilhar este organograma.');
    const target = String(body.username || '');
    if (target === meta.owner) throw new Fail(400, 'owner', 'Esta pessoa já é dona do organograma.');
    if (!(await getJson('user:' + target))) throw new Fail(404, 'no_user', 'Perfil não encontrado.');
    if (body.perm === 'view' || body.perm === 'edit') {
      meta.sharedWith[target] = body.perm;
      await redis('SADD', 'charts:shared:' + target, meta.id);
    } else {
      delete meta.sharedWith[target];
      await redis('SREM', 'charts:shared:' + target, meta.id);
    }
    await setJson('chart:' + meta.id + ':meta', meta);
    return { meta: metaView(meta, user) };
  },
  async listProfiles() {
    const names = (await redis('SMEMBERS', 'users')) || [];
    const users = await Promise.all(names.map((n) => getJson('user:' + n)));
    return { users: users.filter(Boolean).map(({ username, name }) => ({ username, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
  },
};

const adminActions = {
  async listUsers() {
    const names = (await redis('SMEMBERS', 'users')) || [];
    const users = await Promise.all(names.map((n) => getJson('user:' + n)));
    return { users: users.filter(Boolean).map(publicUser).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
  },
  async createUser(body) {
    const username = String(body.username || '').trim().toLowerCase();
    if (!USERNAME.test(username)) throw new Fail(400, 'bad_username', 'Use de 3 a 40 letras minúsculas, números, ponto, hífen ou sublinhado, como joao.silva.');
    const user = await newUser(username, String(body.name || '').trim().slice(0, 80), 'user');
    if (!user) throw new Fail(409, 'exists', 'Este usuário já existe.');
    return { user: publicUser(user) };
  },
  async resetPassword(body) {
    const user = await getJson('user:' + String(body.username || ''));
    if (!user) throw new Fail(404, 'no_user', 'Perfil não encontrado.');
    await setJson('user:' + user.username, { ...user, ...(await hashPassword(DEFAULT_PASSWORD)), mustChange: true });
    await redis('DEL', 'fail:' + user.username);
    return {};
  },
  async deleteUser(body, req, res, admin) {
    const username = String(body.username || '');
    if (username === admin.username) throw new Fail(400, 'self', 'Você não pode remover o próprio perfil.');
    await redis('DEL', 'user:' + username);
    await redis('SREM', 'users', username);
    return {}; // the person's organograms stay available to the administrator
  },
};

module.exports = async function handler(req, res) {
  const send = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  if (!dbUrl() || !dbToken()) return send(503, { code: 'no_database', error: 'Banco de dados não configurado.' });
  if (req.method !== 'POST' || !/application\/json/.test(req.headers['content-type'] || '')) return send(405, { code: 'method', error: 'Método não permitido.' });
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '');
    const own = (group) => Object.prototype.hasOwnProperty.call(group, action);
    if (own(publicActions)) return send(200, await publicActions[action](body, req, res));
    const user = await currentUser(req);
    if (!user) throw new Fail(401, 'login', 'Entre para continuar.');
    if (own(passwordActions)) return send(200, await passwordActions[action](body, req, res, user));
    if (user.mustChange) throw new Fail(403, 'must_change', 'Troque a senha para continuar.');
    if (own(actions)) return send(200, await actions[action](body, req, res, user));
    if (own(adminActions)) {
      if (user.role !== 'admin') throw new Fail(403, 'forbidden', 'Apenas o administrador pode fazer isso.');
      return send(200, await adminActions[action](body, req, res, user));
    }
    throw new Fail(404, 'unknown', 'Ação desconhecida.');
  } catch (e) {
    if (e instanceof Fail) return send(e.status, { code: e.code, error: e.message });
    console.error(e);
    return send(500, { code: 'server', error: 'Erro no servidor. Tente de novo em instantes.' });
  }
};
