"""Finer wind for the best-route calculation: a 3 degree grid (17 x 25 = 425 points, hourly) from the race start
to a week ahead, written as wind3.json on the data branch. Integers in tenths of a knot, like sea.json, so it
compresses well. The page's worker downloads it only when a route is asked for.

Run from the data-branch checkout's parent: python3 .github/scripts/fetch_wind3.py"""
import json, math, os, sys, time, urllib.parse, urllib.request

LA = list(range(8, 57, 3))
LO = list(range(-68, 5, 3))
PTS = [(a, b) for a in LA for b in LO]
OUT = os.environ.get('WIND3_OUT', 'out/wind3.json')
START = 1793404800          # 2026-10-31T00:00:00Z: a day before the race start, the router never needs earlier
FUTURE_DAYS = 7
SLEEP = 12                  # stay well under the free limit of 600 calls a minute
CHUNK = 100


def fetch(chunk, past, fut):
    q = {'latitude': ','.join(str(p[0]) for p in chunk), 'longitude': ','.join(str(p[1]) for p in chunk),
         'hourly': 'wind_speed_10m,wind_direction_10m', 'wind_speed_unit': 'kn', 'timeformat': 'unixtime',
         'past_days': past, 'forecast_days': fut}
    url = 'https://api.open-meteo.com/v1/forecast?' + urllib.parse.urlencode(q, safe=',')
    for k in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                j = json.load(r)
            return j if isinstance(j, list) else [j]
        except Exception as e:
            print('retry', k, e, file=sys.stderr)
            time.sleep(20 * (k + 1))
    raise SystemExit('wind fetch failed')


def components(speed, direction):
    """u, v in tenths of a knot, the way the page reads wind: the vector the wind blows towards."""
    if speed is None or direction is None:
        return 0, 0
    a = math.radians(direction)
    return int(round(-speed * math.sin(a) * 10)), int(round(-speed * math.cos(a) * 10))


def load_old():
    try:
        o = json.load(open(OUT))
        if o.get('la') == LA and o.get('lo') == LO and o.get('dt') == 3600:
            return o
    except Exception:
        pass
    return None


def main(fetch=fetch, now=None, force=None):
    now = now or time.time()
    force = os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' if force is None else force
    old = load_old()
    if old and not force and now - old.get('upd', 0) < 5 * 3600:
        print('fine wind is recent, skipping')
        return None
    past = min(92, max(3, math.ceil((now - START) / 86400) + 1))
    U = [dict() for _ in PTS]
    V = [dict() for _ in PTS]
    for s in range(0, len(PTS), CHUNK):
        chunk = PTS[s:s + CHUNK]
        res = fetch(chunk, past, FUTURE_DAYS)
        assert len(res) == len(chunk), 'unexpected answer'
        for i, L in enumerate(res):
            h = L['hourly']
            for t, sp, di in zip(h['time'], h['wind_speed_10m'], h['wind_direction_10m']):
                if t >= START:
                    U[s + i][t], V[s + i][t] = components(sp, di)
        time.sleep(SLEEP if s + CHUNK < len(PTS) else 0)
    t0 = min(t for d in U for t in d)
    t1 = max(t for d in U for t in d)
    n = (t1 - t0) // 3600 + 1
    out = {'t0': t0, 'dt': 3600, 'n': n, 'la': LA, 'lo': LO, 'upd': int(now),
           'u': [[d.get(t0 + 3600 * k, 0) for k in range(n)] for d in U],
           'v': [[d.get(t0 + 3600 * k, 0) for k in range(n)] for d in V]}
    tmp = OUT + '.tmp'
    json.dump(out, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, OUT)
    print('wind3', len(PTS), 'points', n, 'hours')
    return out


if __name__ == '__main__':
    main()
