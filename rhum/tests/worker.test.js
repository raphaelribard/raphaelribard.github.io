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
  const OFFL = constVal('OFFL'), last = r.pts[r.pts.length - 1], end = OFFL[OFFL.length - 1];
  assert.ok(Math.abs(last.lat - end[0]) < 0.01 && Math.abs(last.lon - end[1]) < 0.01, 'the route must end on the official finish line');
  // the last stretch follows the official course line
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

test('the official course line is consistent', () => {
  const OFFL = constVal('OFFL');
  assert.ok(OFFL.length > 20);
  const nm = (a, b) => Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(a[0] * Math.PI / 180));
  let len = 0; for (let i = 0; i < OFFL.length - 1; i++) { const d = nm(OFFL[i], OFFL[i + 1]); assert.ok(d > 0.2 && d < 4, 'uneven spacing at ' + i); len += d; }
  assert.ok(len > 55 && len < 75, 'the line round Basse-Terre is about 63 nm, got ' + len);
});

