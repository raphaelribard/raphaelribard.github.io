// Loads single functions and constants out of app.js (which is one big closure) so they can be tested.
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function fn(name) {
  const start = src.search(new RegExp('^function\\*? ' + name + '\\(', 'm'));
  if (start < 0) throw new Error('function not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced: ' + name);
}
function load(names, extra) {
  const code = (extra || '') + '\n' + names.map(fn).join('\n') + '\nthis.api={' + names.join(',') + '};';
  const ctx = {}; vm.runInNewContext(code, ctx); return ctx.api;
}
// the value of `name=<literal>` in app.js (arrays and objects)
function constVal(name) {
  const i = src.search(new RegExp('[,; \\n]' + name + '=[\\[{0-9]')) + 1, start = i + name.length + 1, open = src[start], close = open === '[' ? ']' : '}';
  if (open !== '[' && open !== '{') return vm.runInNewContext(src.slice(start).match(/^[-\d.]+/)[0]);
  let d = 0, j = start; for (; j < src.length; j++) { if (src[j] === open) d++; else if (src[j] === close && --d === 0) break; }
  return vm.runInNewContext('(' + src.slice(start, j + 1) + ')');
}
module.exports = { src, fn, load, constVal };
