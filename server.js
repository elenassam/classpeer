/**
 * 발표 상호평가 — Node.js 서버 (Render 배포용)
 *
 * 환경 변수
 *   TEACHER_PASSWORD  교사 비밀번호 (필수)
 *   DATABASE_URL      Postgres 연결 주소 (render.yaml로 배포하면 자동으로 들어가요)
 *   MONGODB_URI       DATABASE_URL 대신 MongoDB를 쓸 때 (선택)
 *   둘 다 없으면 data.json에 저장 — Render 무료 서버에서는 잠들거나 재시작할 때 지워져요
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.TEACHER_PASSWORD || '';
const SALT = process.env.TOKEN_SALT || 'peer-review-v1';
const MAX_DOC = 500 * 1024;

/* ---------- storage: everything is kept in memory and written through to MongoDB (or a local file) ---------- */
async function makeStore() {
  const mem = new Map();
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    // Render 내부 주소(dpg-xxxx-a)는 SSL 없이, 외부 주소(...render.com 등)는 SSL로 연결
    const pool = new Pool({ connectionString: url, ssl: /@[^/]*\./.test(url) ? { rejectUnauthorized: false } : false, max: 5 });
    await pool.query('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const { rows } = await pool.query('SELECT path, json FROM docs');
    for (const r of rows) { try { mem.set(r.path, JSON.parse(r.json)); } catch (e) { /* skip broken row */ } }
    console.log(`[store] Postgres 연결됨 · 문서 ${mem.size}개`);
    return {
      kind: 'postgres', mem,
      async put(p, data) {
        await pool.query('INSERT INTO docs (path, json, updated_at) VALUES ($1, $2, now()) ON CONFLICT (path) DO UPDATE SET json = EXCLUDED.json, updated_at = now()', [p, JSON.stringify(data)]);
        mem.set(p, data);
      },
      async del(p) { await pool.query('DELETE FROM docs WHERE path = $1', [p]); mem.delete(p); },
    };
  }
  if (process.env.MONGODB_URI) {
    let MongoClient;
    try { ({ MongoClient } = require('mongodb')); } catch (e) { throw new Error('MONGODB_URI를 쓰려면 package.json dependencies에 "mongodb"를 추가해 주세요.'); }
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const col = client.db(process.env.MONGODB_DB || 'peer_review').collection('docs');
    for (const d of await col.find({}).toArray()) {
      try { mem.set(d._id, JSON.parse(d.json)); } catch (e) { /* skip broken row */ }
    }
    console.log(`[store] MongoDB 연결됨 · 문서 ${mem.size}개`);
    return {
      kind: 'mongodb', mem,
      async put(p, data) { await col.replaceOne({ _id: p }, { _id: p, json: JSON.stringify(data), updatedAt: new Date() }, { upsert: true }); mem.set(p, data); },
      async del(p) { await col.deleteOne({ _id: p }); mem.delete(p); },
    };
  }
  const file = process.env.DATA_FILE || path.join(__dirname, 'data.json');
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) mem.set(k, v); } catch (e) { /* new file */ }
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(mem))); fs.renameSync(file + '.tmp', file); };
  console.warn('[store] DATABASE_URL이 없어 data.json에 저장합니다. Render 무료 서버에서는 잠들거나 재시작하면 데이터가 지워져요!');
  return {
    kind: 'file', mem,
    async put(p, data) { mem.set(p, data); save(); },
    async del(p) { mem.delete(p); save(); },
  };
}

/* ---------- access rules ----------
 * cfg/...        모두 읽기, 교사만 쓰기
 * drafts/...     교사만
 * evals/<기기ID> 교사는 전부, 학생은 자기 기기 문서만
 */
const teacherToken = () => crypto.createHash('sha256').update(SALT + ':' + PASSWORD, 'utf8').digest('hex');
function who(auth) {
  auth = auth || {};
  const device = typeof auth.d === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(auth.d) ? auth.d : null;
  const teacher = !!PASSWORD && typeof auth.t === 'string' && /^[0-9a-f]{64}$/.test(auth.t) &&
    crypto.timingSafeEqual(Buffer.from(auth.t), Buffer.from(teacherToken()));
  return { teacher, device };
}
function validPath(p, even) {
  if (typeof p !== 'string' || p.length > 400) return false;
  const seg = p.split('/');
  if (seg.some(s => !/^[A-Za-z0-9_\-.~:@+]{1,120}$/.test(s) || s === '.' || s === '..')) return false;
  return even ? seg.length % 2 === 0 : seg.length % 2 === 1;
}
function canReadDoc(p, w) {
  const s = p.split('/');
  if (s[0] === 'cfg') return true;
  if (s[0] === 'drafts') return w.teacher;
  if (s[0] === 'evals') return w.teacher || (s.length === 2 && !!w.device && s[1] === w.device);
  return false;
}
function canWriteDoc(p, w) {
  const s = p.split('/');
  if (s[0] === 'cfg' || s[0] === 'drafts') return w.teacher;
  if (s[0] === 'evals') return w.teacher || (s.length === 2 && !!w.device && s[1] === w.device);
  return false;
}
const canList = (col, w) => col.split('/')[0] === 'cfg' || w.teacher;

class ApiError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
function merge(a, b) {
  for (const k of Object.keys(b)) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], v);
    else a[k] = v;
  }
  return a;
}
const newVersion = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function main() {
  const store = await makeStore();
  let version = newVersion();
  let chain = Promise.resolve(); // writes run one at a time
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  function sync(req, w) {
    if (req.ver && req.ver === version) return { ver: version, same: true };
    const out = {};
    for (const q of (req.queries || []).slice(0, 40)) {
      const key = q.type + ':' + q.path;
      if (q.type === 'doc') {
        out[key] = validPath(q.path, true) && canReadDoc(q.path, w) && store.mem.has(q.path) ? store.mem.get(q.path) : null;
      } else if (q.type === 'col') {
        const res = {};
        if (validPath(q.path, false) && canList(q.path, w)) {
          const pre = q.path + '/', depth = q.path.split('/').length + 1;
          for (const [p, v] of store.mem) if (p.startsWith(pre) && p.split('/').length === depth && canReadDoc(p, w)) res[p.slice(pre.length)] = v;
        }
        out[key] = res;
      }
    }
    return { ver: version, data: out };
  }

  async function write(writes, w) {
    if (!Array.isArray(writes) || !writes.length || writes.length > 60) throw new ApiError('invalid_argument');
    for (const x of writes) {
      if (!validPath(x.path, true)) throw new ApiError('invalid_argument');
      if (!canWriteDoc(x.path, w)) throw new ApiError('permission_denied', 403);
      if (x.op !== 'delete' && (!x.data || typeof x.data !== 'object' || Array.isArray(x.data))) throw new ApiError('invalid_argument');
    }
    return serial(async () => {
      for (const x of writes) {
        if (x.op === 'delete') { await store.del(x.path); continue; }
        let doc;
        if (x.op === 'update') {
          if (!store.mem.has(x.path)) throw new ApiError('invalid_argument');
          doc = merge(JSON.parse(JSON.stringify(store.mem.get(x.path))), x.data);
        } else if (x.op === 'set') doc = x.data;
        else throw new ApiError('invalid_argument');
        if (JSON.stringify(doc).length > MAX_DOC) throw new ApiError('too_large', 413);
        await store.put(x.path, doc);
      }
      version = newVersion();
      return { ok: true };
    });
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/healthz', (_q, r) => r.json({ ok: true, store: store.kind }));

  let lastFail = 0;
  app.post('/api', async (req, res) => {
    const b = req.body || {};
    const w = who(b.auth);
    try {
      let result;
      switch (b.op) {
        case 'info': result = { teacher: w.teacher, passwordSet: !!PASSWORD, store: store.kind }; break;
        case 'login': {
          if (!PASSWORD) throw new ApiError('not_configured');
          await new Promise(r => setTimeout(r, Date.now() - lastFail < 2000 ? 1500 : 400));
          if (String(b.password || '') !== PASSWORD) { lastFail = Date.now(); throw new ApiError('wrong_password', 401); }
          result = { token: teacherToken() }; break;
        }
        case 'sync': result = sync(b, w); break;
        case 'set': case 'update': case 'delete': result = await write([{ op: b.op, path: b.path, data: b.data }], w); break;
        case 'batch': result = await write(b.writes, w); break;
        default: throw new ApiError('invalid_argument');
      }
      res.json(result);
    } catch (e) {
      if (!(e instanceof ApiError)) console.error(e);
      res.status(e.status || 500).json({ error: e.code || 'server_error' });
    }
  });

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.get('*', (_q, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

  app.listen(PORT, () => console.log(`발표 상호평가 서버 실행 중 · 포트 ${PORT}${PASSWORD ? '' : ' · 경고: TEACHER_PASSWORD가 없어요'}`));
}

main().catch(e => { console.error('서버를 시작하지 못했어요:', e); process.exit(1); });
