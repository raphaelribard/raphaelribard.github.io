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
module.exports = { src, fn, load };
