// httpbin-compatible test server for the React Native Harness E2E suite.
//
// The public httpbin.org service flaps with 503s under CI load, which made the
// harness suites flaky. This is a tiny local stand-in that implements only the
// endpoints the harness actually exercises, with httpbin-shaped JSON responses.
//
// Reachable from the emulators/simulators that CI boots on the same host:
//   - Android emulator -> http://10.0.2.2:9876
//   - iOS simulator    -> http://127.0.0.1:9876
import { randomUUID } from 'node:crypto';
import express from 'express';
import multer from 'multer';

const PORT = Number(process.env.PORT) || 9876;
const upload = multer({ storage: multer.memoryStorage() });
const app = express();

// 1x1 transparent PNG (starts with the canonical PNG signature).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
// Minimal JPEG (starts with FF D8 FF). Only used as a remote upload source.
const JPEG_1x1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64'
);

const fullUrl = (req) => `${req.protocol}://${req.get('host')}${req.originalUrl}`;

// httpbin reports request headers in canonical Title-Case (e.g. X-Test-Header).
const titleCaseHeader = (key) =>
  key
    .split('-')
    .map((seg) => (seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg))
    .join('-');

const headerDict = (req) => {
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[titleCaseHeader(key)] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
};

const baseInfo = (req) => ({
  args: { ...req.query },
  headers: headerDict(req),
  origin: req.ip,
  url: fullUrl(req),
  method: req.method,
});

// Captures the raw request body for non-multipart requests so we can echo it
// back as `data`. multipart bodies are consumed by multer instead.
const rawBody = (req, _res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return next();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};

const echoBody = (req, res) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  const out = { ...baseInfo(req), data: '', json: null, form: {}, files: {} };
  if (ct.includes('multipart/form-data')) {
    for (const [k, v] of Object.entries(req.body || {})) out.form[k] = v;
    for (const f of req.files || []) {
      out.files[f.fieldname] =
        `data:${f.mimetype || 'application/octet-stream'};base64,${f.buffer.toString('base64')}`;
    }
  } else {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    if (ct.includes('application/x-www-form-urlencoded')) {
      out.form = Object.fromEntries(new URLSearchParams(raw));
    } else {
      out.data = raw;
      if (ct.includes('application/json') && raw) {
        try {
          out.json = JSON.parse(raw);
        } catch {
          // leave json as null, mirroring httpbin
        }
      }
    }
  }
  res.json(out);
};

app.get('/', (_req, res) => res.json({ ok: true, service: 'nitro-fetch-test-server' }));
app.get('/get', (req, res) => res.json(baseInfo(req)));
app.get('/uuid', (_req, res) => res.json({ uuid: randomUUID() }));
app.get('/ip', (req, res) => res.json({ origin: req.ip }));
app.get('/user-agent', (req, res) =>
  res.json({ 'user-agent': req.headers['user-agent'] || '' })
);
app.get('/headers', (req, res) => res.json({ headers: headerDict(req) }));

app.all(
  ['/post', '/put', '/patch', '/delete', '/anything', '/anything/*'],
  upload.any(),
  rawBody,
  echoBody
);

app.all('/status/:code', (req, res) => {
  const code = parseInt(req.params.code, 10);
  res.status(Number.isFinite(code) ? code : 200).end();
});

app.all('/redirect/:n', (req, res) => {
  const n = parseInt(req.params.n, 10) || 1;
  res.status(302).set('Location', n > 1 ? `/redirect/${n - 1}` : '/get').end();
});

app.get('/image/png', (_req, res) => {
  res.set('Content-Type', 'image/png').send(PNG_1x1);
});
app.get('/image/jpeg', (_req, res) => {
  res.set('Content-Type', 'image/jpeg').send(JPEG_1x1);
});

app.get('/bytes/:n', (req, res) => {
  const n = Math.max(0, parseInt(req.params.n, 10) || 0);
  const buf = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) buf[i] = i % 256;
  res.set('Content-Type', 'application/octet-stream').send(buf);
});

app.get('/stream/:n', (req, res) => {
  const n = Math.max(0, parseInt(req.params.n, 10) || 0);
  res.set('Content-Type', 'application/json');
  let i = 0;
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const tick = () => {
    if (closed) return;
    if (i >= n) return res.end();
    res.write(JSON.stringify({ id: i, url: fullUrl(req) }) + '\n');
    i++;
    setTimeout(tick, 10);
  };
  tick();
});

app.get('/drip', (req, res) => {
  const duration = parseFloat(req.query.duration ?? '2');
  const numbytes = Math.max(0, parseInt(req.query.numbytes ?? '10', 10));
  const delay = parseFloat(req.query.delay ?? '0');
  res.set('Content-Type', 'application/octet-stream');
  const interval = numbytes > 0 ? Math.max(1, (duration * 1000) / numbytes) : 0;
  let sent = 0;
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const drip = () => {
    if (closed) return;
    if (sent >= numbytes) return res.end();
    res.write(Buffer.from([0x2a]));
    sent++;
    setTimeout(drip, interval);
  };
  setTimeout(drip, delay * 1000);
});

app.all('/delay/:n', (req, res) => {
  const n = Math.min(60, Math.max(0, parseInt(req.params.n, 10) || 0));
  const timer = setTimeout(() => res.json(baseInfo(req)), n * 1000);
  res.on('close', () => clearTimeout(timer));
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`nitro-fetch-test-server listening on http://0.0.0.0:${PORT}`);
});
