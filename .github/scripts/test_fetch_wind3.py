import json, math, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(__file__))
os.environ['WIND3_OUT'] = os.path.join(tempfile.mkdtemp(), 'wind3.json')
import fetch_wind3 as w
w.SLEEP = 0

NOW = w.START + 5 * 86400 + 3600 * 7


def fake(chunk, past, fut):
    """An Open-Meteo-shaped answer: a 20 kn wind from the east, hourly, covering past_days and forecast_days."""
    t0 = (NOW // 86400 - past) * 86400
    times = list(range(t0, t0 + (past + fut) * 86400, 3600))
    return [{'hourly': {'time': times, 'wind_speed_10m': [20.0] * len(times), 'wind_direction_10m': [90.0] * len(times)}} for _ in chunk]


class Wind3(unittest.TestCase):
    def test_grid_and_encoding(self):
        out = w.main(fetch=fake, now=NOW, force=True)
        self.assertEqual(len(out['u']), 17 * 25)
        self.assertEqual(len(out['u'][0]), out['n'])
        self.assertEqual(out['t0'], w.START)                       # nothing before the start of the window
        self.assertEqual(out['dt'], 3600)
        self.assertAlmostEqual(out['u'][5][10], -200)              # wind from the east blows towards the west: u = -20.0 kn
        self.assertAlmostEqual(out['v'][5][10], 0, delta=1)
        self.assertTrue(all(isinstance(x, int) for x in out['u'][0]))

    def test_matches_the_page_convention(self):
        # the page: u = -speed * sin(dir), v = -speed * cos(dir)
        u, v = w.components(15.0, 225.0)
        self.assertAlmostEqual(u, round(-15 * math.sin(math.radians(225)) * 10))
        self.assertAlmostEqual(v, round(-15 * math.cos(math.radians(225)) * 10))
        self.assertEqual(w.components(None, 10), (0, 0))

    def test_skips_when_recent_but_not_when_forced(self):
        w.main(fetch=fake, now=NOW, force=True)
        calls = []
        def counting(chunk, past, fut):
            calls.append(1); return fake(chunk, past, fut)
        self.assertIsNone(w.main(fetch=counting, now=NOW + 3600, force=False))
        self.assertEqual(calls, [])
        w.main(fetch=counting, now=NOW + 3600, force=True)
        self.assertEqual(len(calls), 5)                            # 425 points in chunks of 100

    def test_window_covers_the_race(self):
        # a week into the race the window must still reach back to the start
        late = w.START + 12 * 86400
        out = w.main(fetch=fake, now=late, force=True)
        self.assertEqual(out['t0'], w.START)


if __name__ == '__main__':
    unittest.main()
