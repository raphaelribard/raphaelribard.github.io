import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
import append_history as h

COLS = ['boat', 'racestatus', 'dtf', 'heading', 'speed', 'track']


def feed(*boats):
    """boats: (id, status, t, lat, lon, dtf, speed, heading)"""
    return {'reports': {'columns': COLS, 'history': [{'date': '2026-11-10T16:00:00Z', 'lines': [
        [b, st, dtf, hd, sp, [[t, la, lo, dtf]]] for b, st, t, la, lo, dtf, sp, hd in boats]}]}}


class Dense(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.live, self.out = os.path.join(d, 'live.json'), os.path.join(d, 'dense.json')

    def write(self, obj):
        json.dump(obj, open(self.live, 'w'))

    def test_first_snapshot_creates_the_file(self):
        self.write(feed(('5', 'RAC', 1000, 16.2, -61.5, 250.0, 21.5, 240), ('9', 'RET', 1000, 47.1, -3.3, 0, 0, 0)))
        out = h.append(self.live, self.out)
        self.assertEqual(out['tracks']['5'], [[1000, 16.2, -61.5, 250.0, 21.5, 240.0, 'R']])
        self.assertEqual(out['tracks']['9'][0][6], 'T')
        self.assertEqual(json.load(open(self.out))['upd'], 1000)

    def test_idempotent_and_sorted(self):
        self.write(feed(('5', 'RAC', 2000, 16.0, -61.0, 240.0, 20.0, 250)))
        h.append(self.live, self.out)
        h.append(self.live, self.out)                                   # the same snapshot again adds nothing
        self.write(feed(('5', 'RAC', 1000, 16.5, -61.8, 260.0, 19.0, 245)))   # an older report arrives later
        out = h.append(self.live, self.out)
        self.assertEqual([r[0] for r in out['tracks']['5']], [1000, 2000])

    def test_an_unreadable_feed_leaves_the_history_alone(self):
        self.write(feed(('5', 'RAC', 1000, 16.2, -61.5, 250.0, 21.5, 240)))
        h.append(self.live, self.out)
        before = open(self.out).read()
        open(self.live, 'w').write('<html>not json</html>')
        self.assertIsNone(h.append(self.live, self.out))
        self.assertEqual(open(self.out).read(), before)

    def test_boats_without_a_position_are_skipped(self):
        f = feed(('5', 'RAC', 1000, 16.2, -61.5, 250.0, 21.5, 240))
        f['reports']['history'][0]['lines'].append(['7', 'RAC', 0, 0, 0, []])
        self.write(f)
        self.assertEqual(sorted(h.append(self.live, self.out)['tracks']), ['5'])


if __name__ == '__main__':
    unittest.main()
