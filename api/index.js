// TheFlow Capital — API única. Todas las rutas entran por /api?r=<ruta>.
// Público: catalogo, me, estado, login, logout. Todo lo demás exige la sesión del panel.
import { neon } from '@neondatabase/serverless';
import { put, del } from '@vercel/blob';
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = PASSWORD + '|' + (process.env.SESSION_SECRET || 'theflow');
const COOKIE = 'tf_s';
const DIAS = 30;
const CONTACTO = ['direccion', 'telefono', 'email', 'instagram', 'facebook', 'tiktok'];
const PUB_KEYS = ['precio', 'moneda', 'version', 'condicion', 'tipo', 'combustible', 'transmision', 'traccion', 'motor', 'cilindros', 'uso', 'unidad', 'exterior', 'interior', 'puertas', 'pasajeros', 'obs'];

let sql = null;
let listo = null;
function db() {
  if (!DB_URL) throw Object.assign(new Error('Falta la base de datos (DATABASE_URL).'), { code: 'config' });
  if (!sql) sql = neon(DB_URL);
  if (!listo) {
    listo = sql`CREATE TABLE IF NOT EXISTS tf_docs (id text PRIMARY KEY, data text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
      .catch((e) => { listo = null; throw e; });
  }
  return listo.then(() => sql);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
const firma = (texto) => createHmac('sha256', SECRET).update(texto).digest('hex');
function igual(a, b) {
  const x = Buffer.from(firma('c:' + a)), y = Buffer.from(firma('c:' + b));
  return x.length === y.length && timingSafeEqual(x, y);
}
const ROLES = ['completo', 'catalogo'];
const clave = (password, sal) => scryptSync(String(password), sal, 32).toString('hex');
async function usuarios() {
  const q = await db();
  const filas = await q`SELECT data FROM tf_docs WHERE id = ${'usuarios'}`;
  const d = filas[0] ? leer(filas[0].data) : null;
  return d && Array.isArray(d.lista) ? d.lista : [];
}
async function guardarUsuarios(lista) {
  const q = await db();
  const texto = JSON.stringify({ lista });
  await q`INSERT INTO tf_docs (id, data) VALUES (${'usuarios'}, ${texto}) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}
async function enlace() {
  const q = await db();
  const filas = await q`SELECT data FROM tf_docs WHERE id = ${'enlace'}`;
  const d = filas[0] ? leer(filas[0].data) : null;
  return d && typeof d.token === 'string' ? d.token : '';
}
// Devuelve null, el dueño ({rol:'dueno'}) o un perfil creado por el dueño.
async function sesion(request) {
  if (!PASSWORD) return null;
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [quien, exp, sig] = decodeURIComponent(m[1]).split('|');
  if (!quien || !exp || !sig || Number(exp) < Date.now()) return null;
  if (quien === 'd') return igual(sig, firma('d|' + exp)) ? { rol: 'dueno', nombre: 'Dueño' } : null;
  const u = (await usuarios()).find((x) => x.id === quien);
  if (!u || !igual(sig, firma(quien + '|' + exp + '|' + u.sal))) return null;
  return { id: u.id, rol: ROLES.includes(u.rol) ? u.rol : 'catalogo', nombre: u.nombre };
}
function entrar(quien, sal) {
  const exp = String(Date.now() + DIAS * 86400000);
  return cookie(quien + '|' + exp + '|' + firma(quien + '|' + exp + (sal ? '|' + sal : '')), DIAS * 86400);
}
function cookie(valor, segundos) {
  return `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${segundos}`;
}
const lleno = (v) => v != null && String(v).trim() !== '';
const esFoto = (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(u);
function leer(texto) { try { return JSON.parse(texto); } catch { return null; } }

async function todos() {
  const q = await db();
  const filas = await q`SELECT id, data FROM tf_docs`;
  const out = { cfg: { socio: 'Ronny Arias', pct: 30, whatsapp: '' }, veh: {} };
  for (const f of filas) {
    const d = leer(f.data);
    if (!d) continue;
    if (f.id === 'usuarios' || f.id === 'enlace') continue;
    if (f.id === 'cfg') out.cfg = { ...out.cfg, ...d };
    else out.veh[f.id] = d;
  }
  return out;
}

// Lo único que sale al público: nunca gastos, venta interna, VIN ni socio.
function catalogo({ cfg, veh }) {
  const autos = Object.entries(veh)
    .filter(([, v]) => v && v.pub && v.pub.on)
    .sort((a, b) => (a[1].creado || 0) - (b[1].creado || 0))
    .map(([id, v]) => {
      const a = { id, marca: v.marca || '', modelo: v.modelo || '', anio: v.anio || '', vendido: v.estado === 'Vendido', fotos: (v.fotos || []).filter(esFoto) };
      for (const k of PUB_KEYS) if (lleno(v.pub[k])) a[k] = String(v.pub[k]);
      a.acc = Array.isArray(v.pub.acc) ? v.pub.acc.map(String) : [];
      return a;
    });
  const contacto = {};
  for (const k of CONTACTO) if (lleno(cfg[k])) contacto[k] = String(cfg[k]).slice(0, 200);
  return { whatsapp: String(cfg.whatsapp || '').replace(/\D/g, ''), contacto, autos };
}

async function cuerpo(request) {
  const t = await request.text();
  if (t.length > 400000) throw Object.assign(new Error('Demasiado grande.'), { code: 'grande' });
  return leer(t) || {};
}

async function manejar(request, ses) {
  const url = new URL(request.url);
  const r = url.searchParams.get('r') || '';
  const metodo = request.method;

  if (r === 'estado') return json({ baseDeDatos: !!DB_URL, fotos: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID), clave: !!PASSWORD });
  if (r === 'me') return json({ admin: !!ses, configurado: !!PASSWORD });
  if (r === 'catalogo' && metodo === 'GET') return json(catalogo(await todos()));

  // Reporte de solo lectura para el socio: se abre con un enlace secreto que crea el dueño.
  if (r === 'socio' && metodo === 'POST') {
    const { t } = await cuerpo(request);
    const actual = await enlace();
    if (typeof t !== 'string' || !actual || !igual(t, actual)) {
      await new Promise((ok) => setTimeout(ok, 500));
      return json({ error: 'enlace' }, 404);
    }
    const { cfg, veh } = await todos();
    const lista = Object.entries(veh).sort((a, b) => (a[1].creado || 0) - (b[1].creado || 0)).map(([id, v]) => ({
      id, marca: v.marca || '', modelo: v.modelo || '', anio: v.anio || '', vin: v.vin || '', estado: v.estado || '', fecha: v.fecha || '', venta: v.venta || '',
      foto: (v.fotos || []).filter(esFoto)[0] || '',
      gastos: (Array.isArray(v.gastos) ? v.gastos : []).map((g) => ({ concepto: String(g.concepto || ''), detalle: String(g.detalle || ''), fecha: String(g.fecha || ''), monto: g.monto == null ? '' : String(g.monto) })),
    }));
    return json({ socio: cfg.socio || '', pct: cfg.pct, veh: lista });
  }

  if (r === 'login' && metodo === 'POST') {
    if (!PASSWORD) return json({ error: 'config' }, 503);
    const { password, usuario } = await cuerpo(request);
    const nombre = String(usuario || '').trim().toLowerCase();
    let galleta = null;
    if (typeof password === 'string' && password) {
      if (!nombre) { if (igual(password, PASSWORD)) galleta = entrar('d'); }
      else {
        const u = (await usuarios()).find((x) => x.usuario === nombre);
        if (u && igual(clave(password, u.sal), u.hash)) galleta = entrar(u.id, u.sal);
      }
    }
    if (!galleta) {
      await new Promise((ok) => setTimeout(ok, 700));
      return json({ error: 'clave' }, 401);
    }
    return json({ admin: true }, 200, { 'Set-Cookie': galleta });
  }
  if (r === 'logout' && metodo === 'POST') return json({ admin: false }, 200, { 'Set-Cookie': cookie('', 0) });

  if (!ses) return json({ error: 'sesion' }, 401);
  const dueno = ses.rol === 'dueno';
  const limitado = ses.rol === 'catalogo';

  if (r === 'data' && metodo === 'GET') {
    const t = await todos();
    if (limitado) {
      const c = { whatsapp: t.cfg.whatsapp || '' };
      for (const k of CONTACTO) if (lleno(t.cfg[k])) c[k] = t.cfg[k];
      t.cfg = c;
      for (const v of Object.values(t.veh)) { delete v.gastos; delete v.venta; }
    }
    return json({ ...t, rol: ses.rol, nombre: ses.nombre });
  }

  // ----- enlace del socio (solo el dueño) -----
  if (r === 'enlace') {
    if (!dueno) return json({ error: 'permiso' }, 403);
    if (metodo === 'POST') {
      const { accion } = await cuerpo(request);
      const token = accion === 'crear' ? randomBytes(24).toString('hex') : '';
      const q = await db();
      const texto = JSON.stringify({ token });
      await q`INSERT INTO tf_docs (id, data) VALUES (${'enlace'}, ${texto}) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      return json({ token });
    }
    return json({ token: await enlace() });
  }

  // ----- perfiles de acceso (solo el dueño) -----
  if (r === 'usuarios' && metodo === 'GET') {
    if (!dueno) return json({ error: 'permiso' }, 403);
    return json({ lista: (await usuarios()).map(({ id, nombre, usuario, rol }) => ({ id, nombre, usuario, rol })) });
  }
  if (r === 'usuario' && metodo === 'POST') {
    if (!dueno) return json({ error: 'permiso' }, 403);
    const b = await cuerpo(request);
    const lista = await usuarios();
    if (b.borrar) { await guardarUsuarios(lista.filter((x) => x.id !== b.id)); return json({ ok: true }); }
    const pass = typeof b.password === 'string' ? b.password : '';
    if (b.id) {
      const u = lista.find((x) => x.id === b.id);
      if (!u) return json({ error: 'datos' }, 400);
      if (pass) { if (pass.length < 8) return json({ error: 'corta' }, 400); u.sal = randomBytes(16).toString('hex'); u.hash = clave(pass, u.sal); }
      if (ROLES.includes(b.rol)) u.rol = b.rol;
      await guardarUsuarios(lista);
      return json({ ok: true });
    }
    const nombre = String(b.nombre || '').trim().slice(0, 60);
    const usuario = String(b.usuario || '').trim().toLowerCase();
    if (!nombre || !/^[a-z0-9._-]{3,30}$/.test(usuario)) return json({ error: 'usuario' }, 400);
    if (pass.length < 8) return json({ error: 'corta' }, 400);
    if (lista.some((x) => x.usuario === usuario)) return json({ error: 'repetido' }, 409);
    if (lista.length >= 30) return json({ error: 'limite' }, 400);
    const sal = randomBytes(16).toString('hex');
    lista.push({ id: 'u' + randomBytes(6).toString('hex'), nombre, usuario, rol: ROLES.includes(b.rol) ? b.rol : 'catalogo', sal, hash: clave(pass, sal), creado: Date.now() });
    await guardarUsuarios(lista);
    return json({ ok: true });
  }

  if (r === 'save' && metodo === 'POST') {
    const { id, data } = await cuerpo(request);
    if (!(id === 'cfg' || /^v-[a-z0-9]{6,40}$/.test(id || '')) || !data || typeof data !== 'object' || Array.isArray(data)) return json({ error: 'datos' }, 400);
    if (id !== 'cfg') { data.fotos = (Array.isArray(data.fotos) ? data.fotos : []).filter(esFoto).slice(0, 30); delete data.foto; delete data.id; }
    const q = await db();
    if (limitado) {
      // Un perfil de catálogo no puede tocar la configuración ni la contabilidad.
      if (id === 'cfg') return json({ error: 'permiso' }, 403);
      const previas = await q`SELECT data FROM tf_docs WHERE id = ${id}`;
      const antes = previas[0] ? leer(previas[0].data) || {} : {};
      data.gastos = Array.isArray(antes.gastos) ? antes.gastos : [];
      data.venta = antes.venta || '';
    }
    const texto = JSON.stringify(data);
    await q`INSERT INTO tf_docs (id, data) VALUES (${id}, ${texto}) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
    return json({ ok: true });
  }

  if (r === 'borrar' && metodo === 'POST') {
    if (limitado) return json({ error: 'permiso' }, 403);
    const { id } = await cuerpo(request);
    if (!/^v-[a-z0-9]{6,40}$/.test(id || '')) return json({ error: 'datos' }, 400);
    const q = await db();
    const filas = await q`SELECT data FROM tf_docs WHERE id = ${id}`;
    const fotos = filas[0] ? ((leer(filas[0].data) || {}).fotos || []).filter(esFoto) : [];
    await q`DELETE FROM tf_docs WHERE id = ${id}`;
    if (fotos.length) await del(fotos).catch(() => {});
    return json({ ok: true });
  }

  if (r === 'foto' && metodo === 'POST') {
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 3000000) return json({ error: 'grande' }, 413);
    const blob = await put('vehiculos/foto.jpg', bytes, { access: 'public', addRandomSuffix: true, contentType: 'image/jpeg' });
    return json({ url: blob.url });
  }

  if (r === 'fotoborrar' && metodo === 'POST') {
    const { url: u } = await cuerpo(request);
    if (!esFoto(u)) return json({ error: 'datos' }, 400);
    await del(u).catch(() => {});
    return json({ ok: true });
  }

  return json({ error: 'ruta' }, 404);
}

export default {
  async fetch(request) {
    let ses = null;
    try {
      ses = await sesion(request);
      return await manejar(request, ses);
    } catch (e) {
      console.error(e);
      if (!ses && new URL(request.url).searchParams.get('r') === 'me') return json({ admin: false, configurado: !!PASSWORD });
      return json({ error: e.code === 'config' ? 'config' : e.code === 'grande' ? 'grande' : 'servidor', detalle: ses ? String(e.message || e) : undefined }, e.code === 'grande' ? 413 : 500);
    }
  },
};
