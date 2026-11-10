// The route search runs in a Web Worker built from the page's own functions. This test builds the worker the same way,
// runs it with synthetic wind and the real land/course data, and fails if a function the router needs was left out.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('vm'), { src, fn } = require('./helpers');

const names = src.match(/var RWFN=\[([^\]]+)\]/)[1].split(',');
function constVal(name) { // value of `name=<literal>` in app.js
  const i = src.search(new RegExp('[,; \\n]' + name + '=[\\[{0-9]')) + 1, start = i + name.length + 1, open = src[start], close = open === '[' ? ']' : '}';
  if (open !== '[' && open !== '{') return vm.runInNewContext(src.slice(start).match(/^[-\d.]+/)[0]);
  let d = 0, j = start; for (; j < src.length; j++) { if (src[j] === open) d++; else if (src[j] === close && --d === 0) break; }
  return vm.runInNewContext('(' + src.slice(start, j + 1) + ')');
}
function buildWorker(fakeFetch) {
  const code = src.match(/var RWVARS='([^']*)'/)[1] + '\n'
    + names.map(fn).join('\n') + '\n(' + fn('rwMain') + ')();';
  const out = [], self = { postMessage: m => out.push(m) };
  new Function('self', 'fetch', 'caches', code)(self, fakeFetch || (() => Promise.reject(new Error('no network in tests'))), undefined); // a plain function scope: much faster than a vm context, where every global lookup is slow
  return { self, out };
}

test('the worker function list covers everything the router needs', () => {
  assert.ok(names.includes('wifRunG') && names.includes('windAt') && names.includes('inLand'));
  const { self, out } = buildWorker();
  const land = constVal('LAND'), ls = new Int32Array(land.length), pts = []; let tot = 0;
  land.forEach((r, i) => { ls[i] = tot; tot += r.length; r.forEach(p => pts.push(p[0], p[1])); });
  self.onmessage({ data: { cfg: { TWSG: constVal('TWSG'), TWAG: constVal('TWAG'), WLA: constVal('WLA'), WLO: constVal('WLO'), WST6: constVal('WST6'),
    START_PT: constVal('START_PT'), FIN: constVal('FIN'), CORR: constVal('CORR'), GW: constVal('GW'), OFFL: constVal('OFFL'), ls, lp: new Float64Array(pts) } } });
  const T0 = Date.UTC(2026, 10, 1, 12, 2), n = 900, nPts = constVal('WLA').length * constVal('WLO').length;
  const mk = v => Array.from({ length: nPts }, () => new Float32Array(n).fill(v));
  self.onmessage({ data: { wind: { t0: T0 / 1000 - 3600, n, U: mk(-15), V: mk(0) } } }); // a steady 15 kn easterly
  const g = Array.from({ length: 10 }, (_, i) => Array.from({ length: 13 }, () => 3 + 2 * i)); // 9 kn at 15 kn of wind, any angle
  self.onmessage({ data: { run: 1, job: 7, id: 'T', cls: 'ULT', fac: 1, g, T0 } });
  assert.equal(out.length, 1, out[0] && out[0].err); assert.equal(out[0].job, 7);
  const r = out[0].res; assert.ok(r, 'the worker found no route (a function is probably missing from the list)');
  const hrs = (r.fin - r.t0) / 36e5; assert.ok(hrs > 100 && hrs < 800, 'implausible time ' + hrs);
  const OFFL = constVal('OFFL'), ZONES = constVal('ZONES'), last = r.pts[r.pts.length - 1], end = OFFL[OFFL.length - 1];
  assert.ok(Math.abs(last.lat - end[0]) < 0.01 && Math.abs(last.lon - end[1]) < 0.01, 'the route must end on the official finish line');
  // the last stretch follows the official course line, and nothing the route does is inside an exclusion zone
  const inside = (p, z) => { let ins = false; for (let i = 0, j = z.length - 1; i < z.length; j = i++) { const [yi, xi] = z[i], [yj, xj] = z[j]; if ((yi > p.lat) !== (yj > p.lat) && p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
  assert.ok(r.pts.every(p => ZONES.every(z => !inside(p, z))), 'a route point is inside an exclusion zone');
  OFFL.slice(1).forEach((p, i) => { const q = r.pts[r.pts.length - OFFL.length + 1 + i]; assert.ok(q && Math.abs(q.lat - p[0]) < 1e-9 && Math.abs(q.lon - p[1]) < 1e-9, 'the tail should be the official line'); });
  // big waves slow a route down (a multihull loses speed in a heavy sea above 12 kn of wind)
  const nLa = constVal('WLA').length * constVal('WLO').length, la = constVal('WLA'), lo = constVal('WLO'), nWaves = 40;
  const wave = h => ({ t0: T0 / 1000 - 3600, dt: 21600, la, lo, st: 6, n: nWaves, H: Array.from({ length: nLa }, () => new Float32Array(nWaves).fill(h)) });
  self.onmessage({ data: { wind: { t0: T0 / 1000 - 3600, n, U: mk(-18), V: mk(0) } } }); // 18 kn
  self.onmessage({ data: { wave: wave(0.5) } }); self.onmessage({ data: { run: 1, job: 20, id: 'T', cls: 'ULT', fac: 1, g, T0, wb: 0.06 } });
  self.onmessage({ data: { wave: wave(4.5) } }); self.onmessage({ data: { run: 1, job: 21, id: 'T', cls: 'ULT', fac: 1, g, T0, wb: 0.06 } });
  const calm = out.find(o => o.job === 20).res, rough = out.find(o => o.job === 21).res;
  assert.ok(calm && rough && (rough.fin - rough.t0) > (calm.fin - calm.t0) * 1.05, 'waves should slow the route by more than 5 %');
  // faster speeds give a faster route
  const g2 = g.map(row => row.map(v => v * 1.2)); self.onmessage({ data: { run: 1, job: 8, id: 'T', cls: 'ULT', fac: 1, g: g2, T0 } });
  assert.ok((out[1].res.fin - out[1].res.t0) < (r.fin - r.t0));
});

const { load } = require('./helpers');
test('wave penalty: none in light wind or small seas, grows with height, capped', () => {
  const { wavePen } = load(['wavePen']);
  assert.equal(wavePen(null, 20, 0.06), 1); assert.equal(wavePen(4, 6, 0.06), 1); assert.equal(wavePen(1, 20, 0.06), 1);
  assert.ok(wavePen(3, 20, 0.06) < 1 && wavePen(4, 20, 0.06) < wavePen(3, 20, 0.06));
  assert.ok(wavePen(3, 10, 0.06) > wavePen(3, 20, 0.06), 'ramps in between 8 and 12 kn');
  assert.equal(wavePen(9, 30, 0.09), Math.max(0.75, 1 - 0.09 * 4)); assert.ok(wavePen(9, 30, 0.5) >= 0.75);
});

test('the official course line and the exclusion zones are consistent', () => {
  const OFFL = constVal('OFFL'), ZONES = constVal('ZONES');
  assert.ok(OFFL.length > 20 && ZONES.length === 2);
  const nm = (a, b) => Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(a[0] * Math.PI / 180));
  let len = 0; for (let i = 0; i < OFFL.length - 1; i++) { const d = nm(OFFL[i], OFFL[i + 1]); assert.ok(d > 0.2 && d < 4, 'uneven spacing at ' + i); len += d; }
  assert.ok(len > 55 && len < 75, 'the line round Basse-Terre is about 63 nm, got ' + len);
  const inside = (p, z) => { let ins = false; for (let i = 0, j = z.length - 1; i < z.length; j = i++) { const [yi, xi] = z[i], [yj, xj] = z[j]; if ((yi > p[0]) !== (yj > p[0]) && p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
  assert.ok(OFFL.every(p => ZONES.every(z => !inside(p, z))), 'the official line must not enter a zone');
  const sh = (p, z) => Math.min(...z.map(q => nm(p, q))); // the line stays out of the zones by a margin
  assert.ok(Math.min(...OFFL.map(p => Math.min(...ZONES.map(z => sh(p, z))))) > 0.3);
});

// ---- the whole plan in the worker: speed table, boat levels and routes learned from tracks with the worker's own wind
function setup(fakeFetch, mirror) {
  const { self, out } = buildWorker(fakeFetch);
  const land = constVal('LAND'), ls = new Int32Array(land.length), pts = []; let tot = 0;
  land.forEach((r, i) => { ls[i] = tot; tot += r.length; r.forEach(p => pts.push(p[0], p[1])); });
  self.onmessage({ data: { cfg: { TWSG: constVal('TWSG'), TWAG: constVal('TWAG'), WLA: constVal('WLA'), WLO: constVal('WLO'), WST6: constVal('WST6'),
    START_PT: constVal('START_PT'), FIN: constVal('FIN'), CORR: constVal('CORR'), GW: constVal('GW'), OFFL: constVal('OFFL'), mirror, ls, lp: new Float64Array(pts) } } });
  const T0 = Date.UTC(2026, 10, 1, 12, 2), nPts = constVal('WLA').length * constVal('WLO').length;
  self.onmessage({ data: { wind: { t0: T0 / 1000 - 3600, n: 900, U: Array.from({ length: nPts }, () => new Float32Array(900).fill(-18)), V: Array.from({ length: nPts }, () => new Float32Array(900)) } } });
  // three boats on the same track, the third sailing faster than the others (more distance in the same time)
  const A = constVal('START_PT'), B = constVal('OFFL')[0];
  const boat = (id, speedup) => { const H = new Float64Array(70 * 3); for (let i = 0; i < 70; i++) { const f = Math.min(1, i / 69 * speedup); H[3 * i] = T0 + i * 3 * 3600e3; H[3 * i + 1] = A.lat + (B[0] - A.lat) * f; H[3 * i + 2] = A.lon + (B[1] - A.lon) * f; } return { id, name: 'Boat ' + id, color: '#fff', H }; };
  const boats = [boat('a', 1.0), boat('b', 1.0), boat('c', 1.25)];
  const wait = async (pred) => { for (let i = 0; i < 600 && !pred(); i++) await new Promise(r => setTimeout(r, 100)); };
  return { self, out, T0, boats, wait };
}
const finePayload = (T0, t0shift) => JSON.stringify({ t0: T0 / 1000 - 3600 * 5 + (t0shift || 0), dt: 3600, n: 900, la: Array.from({ length: 17 }, (_, i) => 8 + 3 * i), lo: Array.from({ length: 25 }, (_, i) => -68 + 3 * i),
  u: Array.from({ length: 425 }, () => new Array(900).fill(-180)), v: Array.from({ length: 425 }, () => new Array(900).fill(0)) });

test('plan: the worker learns the table and the levels, finds the fastest boat and routes it, then each boat on request', async () => {
  const { self, out, T0, boats, wait } = setup(null, '');
  self.onmessage({ data: { plan: 1, job: 1, cls: 'ULT', route: true, own: ['a'], T0, wb: 0.06, boats } });
  await wait(() => out.some(o => o.kind === 'done' || o.kind === 'nodata'));
  const ref = out.find(o => o.kind === 'ref'); assert.ok(ref, JSON.stringify(out.map(o => o.kind + (o.err || ''))));
  assert.equal(ref.ref.id, 'c', 'the boat that covered the most ground in the same time is the fastest'); assert.equal(ref.grid, 'coarse'); assert.equal(ref.more, true);
  assert.ok(ref.res && (ref.res.fin - ref.res.t0) / 36e5 > 100);
  const own = out.find(o => o.kind === 'own'); assert.ok(own && own.id === 'a' && own.ideal > 0 && own.fac < ref.ref.fac, 'a slower boat gets a lower level and a slower ideal route');
  assert.ok(own.ideal > ref.res.fin - ref.res.t0, 'at a lower level the ideal route takes longer');
  assert.equal(out[out.length - 1].kind, 'done');
});

test('plan: with too little data the worker says so', async () => {
  const { self, out, T0, boats, wait } = setup(null, '');
  self.onmessage({ data: { plan: 1, job: 2, cls: 'ULT', route: true, own: [], T0, wb: 0.06, boats: [{ ...boats[0], H: boats[0].H.slice(0, 15) }] } });
  await wait(() => out.length > 0); assert.equal(out[0].kind, 'nodata');
});

test('plan: the finer wind is downloaded and read by the worker, and a stale or broken file falls back to the coarse grid', async () => {
  let calls = 0; const T0 = Date.UTC(2026, 10, 1, 12, 2);
  const ok = setup(() => { calls++; return Promise.resolve({ ok: true, text: () => Promise.resolve(finePayload(T0)) }); }, 'http://x/');
  ok.self.onmessage({ data: { plan: 1, job: 3, cls: 'ULT', route: true, own: [], T0, wb: 0.06, boats: ok.boats } });
  await ok.wait(() => ok.out.some(o => o.kind === 'ref' || o.kind === 'nodata'));
  const r1 = ok.out.find(o => o.kind === 'ref'); assert.ok(r1 && r1.grid === 'fine', 'the finer grid should be used'); assert.equal(calls, 1);
  ok.self.onmessage({ data: { plan: 1, job: 4, cls: 'ULT', route: true, own: [], T0, wb: 0.06, boats: ok.boats } });   // second plan: no second download
  await ok.wait(() => ok.out.filter(o => o.kind === 'ref').length === 2); assert.equal(calls, 1);
  const late = setup(() => Promise.resolve({ ok: true, text: () => Promise.resolve(finePayload(T0, 3600 * 40)) }), 'http://x/');   // starts 35 h after the race start
  late.self.onmessage({ data: { plan: 1, job: 5, cls: 'ULT', route: true, own: [], T0, wb: 0.06, boats: late.boats } });
  await late.wait(() => late.out.some(o => o.kind === 'ref' || o.kind === 'nodata')); assert.equal(late.out.find(o => o.kind === 'ref').grid, 'coarse');
  const down = setup(() => Promise.reject(new Error('offline')), 'http://x/');
  down.self.onmessage({ data: { plan: 1, job: 6, cls: 'ULT', route: true, own: [], T0, wb: 0.06, boats: down.boats } });
  await down.wait(() => down.out.some(o => o.kind === 'ref' || o.kind === 'nodata')); assert.equal(down.out.find(o => o.kind === 'ref').grid, 'coarse');
});
