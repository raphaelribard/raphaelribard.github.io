const test = require('node:test'), assert = require('node:assert/strict'), { load, src, constVal } = require('./helpers');
const consts = 'var R=3440.065,D2R=Math.PI/180;var TWSG=[0,4,8,12,16,20,24,28,32,40],TWAG=[0,15,30,45,60,75,90,105,120,135,150,165,180];';
const { hav, brg, my, myInv, angd, polSpd } = load(['hav', 'brg', 'my', 'myInv', 'angd', 'polSpd'], consts);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);

test('hav: one degree of latitude is 60 nautical miles', () => near(hav(0, 0, 1, 0), 60, 0.1));
test('hav: symmetric and zero for the same point', () => { assert.equal(hav(10, 20, 10, 20), 0); near(hav(48, -2, 16, -61), hav(16, -61, 48, -2), 1e-9); });
test('hav: Saint-Malo to Pointe-a-Pitre is about 3,500 nm (the page says 3,542)', () => near(hav(48.65, -2.03, 16.23, -61.53), 3500, 100));
test('brg: cardinal directions', () => {
  near(brg(0, 0, 1, 0), 0, 1e-6); near(brg(0, 0, 0, 1), 90, 1e-6);
  near(brg(1, 0, 0, 0), 180, 1e-6); near(brg(0, 1, 0, 0), 270, 1e-6);
});
test('brg: always within 0..360', () => { for (const [a, b, c, d] of [[48, -2, 16, -61], [16, -61, 48, -2], [0, 0, -5, -5]]) { const x = brg(a, b, c, d); assert.ok(x >= 0 && x < 360); } });
test('mercator: myInv undoes my', () => { for (const l of [-60, -10, 0, 16.2, 48.6, 70]) near(myInv(my(l)), l, 1e-9); });
test('angd: shortest angle between two bearings', () => { assert.equal(angd(10, 350), 20); assert.equal(angd(0, 180), 180); assert.equal(angd(90, 90), 0); assert.equal(angd(270, 10), 100); });
test('polSpd: bilinear interpolation of the polar grid', () => {
  const g = Array.from({ length: 10 }, (_, i) => Array.from({ length: 13 }, (_, j) => i * 2 + j)); // speed = 2*i + j
  near(polSpd(g, 0, 0), 0, 1e-9);        // corner
  near(polSpd(g, 4, 15), 2 + 1, 1e-9);   // exactly on a grid node
  near(polSpd(g, 6, 22.5), 3 + 1.5, 1e-9); // halfway between nodes
  assert.ok(Number.isFinite(polSpd(g, 99, 400))); // clamped, not NaN
});


test('racingPart: a track stops counting once the boat is closest to the finish', () => {
  const consts = 'var R=3440.065,D2R=Math.PI/180,FIN={lat:16.241,lon:-61.534};';
  const { racingPart } = load(['hav', 'racingPart'], consts);
  const pts = (arr) => arr.map(([lat, lon], i) => ({ t: i * 36e5, lat, lon }));
  const racing = pts([[48, -2], [40, -20], [30, -40], [20, -55], [17, -60]]);            // still sailing: everything counts
  assert.equal(racingPart(racing).length, racing.length);
  const finished = pts([[48, -2], [30, -40], [16.30, -61.55], [16.24, -61.53], [16.24, -61.53], [16.24, -61.53]]);   // idling at the dock afterwards
  assert.ok(racingPart(finished).length <= 4 && racingPart(finished).length >= 3);
  const retired = pts([[48, -2], [47, -10], [46.5, -15], [47.5, -12], [48.5, -5], [48.7, -2]]);                       // turned back to port
  assert.deepEqual(racingPart(retired).map(p => p.lat), [48, 47, 46.5]);
  // a finisher's track stops at its finish time, whatever happens near the dock afterwards
  assert.equal(racingPart(finished, 3.5 * 36e5).length, 4);
  assert.equal(racingPart(finished, 99 * 36e5).length, finished.length);
});

test('the official course line (used for the ETA waypoints) is consistent', () => {
  const OFFL = constVal('OFFL');
  assert.ok(OFFL.length > 20);
  const nm = (a, b) => Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos(a[0] * Math.PI / 180));
  let len = 0; for (let i = 0; i < OFFL.length - 1; i++) { const d = nm(OFFL[i], OFFL[i + 1]); assert.ok(d > 0.2 && d < 4, 'uneven spacing at ' + i); len += d; }
  assert.ok(len > 55 && len < 75, 'the line round Basse-Terre is about 63 nm, got ' + len);
});
