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
function buildWorker() {
  const code = 'var R=3440.065,D2R=Math.PI/180,TWSG,TWAG,WIND=null,WLA,WLO,WST6,LAND,LBB=null,LM=null,START_PT,FIN,CORR,GW,WPC=null;\n'
    + names.map(fn).join('\n') + '\n(' + fn('rwMain') + ')();';
  const out = [], self = { postMessage: m => out.push(m) };
  new Function('self', code)(self); // a plain function scope: much faster than a vm context, where every global lookup is slow
  return { self, out };
}

test('the worker function list covers everything the router needs', () => {
  assert.ok(names.includes('wifRunG') && names.includes('windAt') && names.includes('inLand'));
  const { self, out } = buildWorker();
  const land = constVal('LAND'), ls = new Int32Array(land.length), pts = []; let tot = 0;
  land.forEach((r, i) => { ls[i] = tot; tot += r.length; r.forEach(p => pts.push(p[0], p[1])); });
  self.onmessage({ data: { cfg: { TWSG: constVal('TWSG'), TWAG: constVal('TWAG'), WLA: constVal('WLA'), WLO: constVal('WLO'), WST6: constVal('WST6'),
    START_PT: constVal('START_PT'), FIN: constVal('FIN'), CORR: constVal('CORR'), GW: constVal('GW'), ls, lp: new Float64Array(pts) } } });
  const T0 = Date.UTC(2026, 10, 1, 12, 2), n = 900, nPts = constVal('WLA').length * constVal('WLO').length;
  const mk = v => Array.from({ length: nPts }, () => new Float32Array(n).fill(v));
  self.onmessage({ data: { wind: { t0: T0 / 1000 - 3600, n, U: mk(-15), V: mk(0) } } }); // a steady 15 kn easterly
  const g = Array.from({ length: 10 }, (_, i) => Array.from({ length: 13 }, () => 3 + 2 * i)); // 9 kn at 15 kn of wind, any angle
  self.onmessage({ data: { run: 1, job: 7, id: 'T', cls: 'ULT', fac: 1, g, T0 } });
  assert.equal(out.length, 1, out[0] && out[0].err); assert.equal(out[0].job, 7);
  const r = out[0].res; assert.ok(r, 'the worker found no route (a function is probably missing from the list)');
  const hrs = (r.fin - r.t0) / 36e5; assert.ok(hrs > 100 && hrs < 800, 'implausible time ' + hrs);
  const last = r.pts[r.pts.length - 1], FIN = constVal('FIN'); assert.ok(Math.abs(last.lat - FIN.lat) < 0.5 && Math.abs(last.lon - FIN.lon) < 0.5);
  // faster speeds give a faster route
  const g2 = g.map(row => row.map(v => v * 1.2)); self.onmessage({ data: { run: 1, job: 8, id: 'T', cls: 'ULT', fac: 1, g: g2, T0 } });
  assert.ok((out[1].res.fin - out[1].res.t0) < (r.fin - r.t0));
});
