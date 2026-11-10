const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sha = f => crypto.createHash('sha1').update(read(f)).digest('hex').slice(0, 8);

test('index.html points at the current app.css / app.js (bump the ?v= hash after editing them)', () => {
  const html = read('index.html');
  for (const f of ['app.css', 'app.js']) {
    const m = html.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\w+)'));
    assert.ok(m, f + ' is not referenced');
    assert.equal(m[1], sha(f), f + ' changed; update its ?v= in index.html to ' + sha(f));
  }
});
test('app.js parses', () => { new (require('vm').Script)(read('app.js')); });
test('sw.js parses and precaches the app files', () => {
  const sw = read('sw.js'); new (require('vm').Script)(sw);
  for (const f of ['index.html', 'app.css', 'app.js']) assert.ok(sw.includes("'" + f + "'"), f);
});
test('manifest is valid and its icons exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
});
test('wind grid: the workflow requests exactly the points the page expects', () => {
  const app = read('app.js'), wf = fs.readFileSync(path.join(root, '..', '.github', 'workflows', 'wind.yml'), 'utf8');
  const arr = n => JSON.parse(app.match(new RegExp(n + '=(\\[[^\\]]*\\])'))[1]);
  const la = arr('WLA'), lo = arr('WLO');
  const q = wf.match(/latitude=([-\d.,]+)&longitude=([-\d.,]+)/);
  const wla = q[1].split(',').map(Number), wlo = q[2].split(',').map(Number);
  assert.equal(wla.length, la.length * lo.length);
  assert.deepEqual(wla, la.flatMap(a => lo.map(() => a)));
  assert.deepEqual(wlo, la.flatMap(() => lo));
});
test('the page does not hard-code the wind grid size', () => assert.ok(!/j\.length!==117/.test(read('app.js'))));

