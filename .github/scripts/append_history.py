"""Keep every hourly snapshot of the official feed in a growing file, dense.json, on the data branch.

The history the page inherits has positions 3 to 11 hours apart. The feed itself is published hourly, so keeping each
snapshot gives the densest track the source can offer, from the day this runs onwards.

dense.json: {"v": 1, "upd": <epoch of the newest snapshot>, "cols": [...], "tracks": {"<boat>": [[t, lat, lon, dtf, speed, heading, status], ...]}}
t is the time of the position (epoch seconds), status is R (racing), A (arrived) or T (retired). Rows are deduplicated by
boat and time, and kept sorted. The script is idempotent and never touches the file if the feed cannot be read.

Usage: python3 .github/scripts/append_history.py out/live.json out/dense.json"""
import json, os, sys, time

COLS = ['t', 'lat', 'lon', 'dtf', 'speed', 'heading', 'status']
STATUS = {'RAC': 'R', 'ARV': 'A', 'ARR': 'A', 'RET': 'T'}


def num(x):
    try:
        return round(float(x), 1)
    except (TypeError, ValueError):
        return None


def rows(live):
    """(boat, row) for every boat in every snapshot of the feed."""
    rep = live['reports']
    ix = {c: i for i, c in enumerate(rep['columns'])}
    for snap in rep['history']:
        for line in snap['lines']:
            tr = line[ix['track']]
            if not tr:
                continue
            st = STATUS.get(str(line[ix['racestatus']]), '?')
            for p in tr:                      # [t, lat, lon, dtf]: the boat's own report, with its own time
                if len(p) < 3 or p[0] is None or p[1] is None or p[2] is None:
                    continue
                yield str(line[ix['boat']]), [int(p[0]), round(float(p[1]), 5), round(float(p[2]), 5),
                                              num(p[3]) if len(p) > 3 else None,
                                              num(line[ix['speed']]), num(line[ix['heading']]), st]


def append(live_path, out_path, now=None):
    try:
        live = json.load(open(live_path))
        new = list(rows(live))
    except Exception as e:                    # an unreadable feed must not damage what we already have
        print('feed unreadable, history unchanged:', e, file=sys.stderr)
        return None
    try:
        old = json.load(open(out_path))
        assert old.get('v') == 1 and old.get('cols') == COLS
    except Exception:
        old = {'v': 1, 'cols': COLS, 'tracks': {}}
    tracks = old['tracks']
    added = 0
    for boat, row in new:
        T = tracks.setdefault(boat, [])
        if not any(r[0] == row[0] for r in T[-48:]):          # a report is new unless its time is already among the latest rows
            T.append(row)
            added += 1
    for T in tracks.values():
        T.sort(key=lambda r: r[0])
    old['upd'] = max([r[0] for T in tracks.values() for r in T] or [0])
    tmp = out_path + '.tmp'
    json.dump(old, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, out_path)
    print('history: %d boats, %d new rows, %d rows in all' % (len(tracks), added, sum(len(T) for T in tracks.values())))
    return old


if __name__ == '__main__':
    append(sys.argv[1], sys.argv[2])
