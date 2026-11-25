# Places the redesign boards on the Proposals page of project/canvas.json after build.py has written them.
# Reading order: the spec on the left; today's window, then one board per area, on the right. Only Proposals frames and notes move; every other page is left as it is.
#   python3 layout.py <spec board height>
import json, os, sys
from states import BOARDS
HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(os.path.dirname(HERE), 'project', 'canvas.json')
d = json.load(open(INDEX)); P = 'proposals'
sizes = json.load(open(os.path.join(HERE, 'sizes.json')))
spec_h = int(sys.argv[1])
X0, GAP = 1460, 160
d['boards']['Proposal-Redesign-Spec.dc.html'].update(x=0, y=960, w=1360, h=spec_h, page=P)
y = 960 + 900 + GAP
added = []
for b in BOARDS:
    k = b['file'] + '.dc.html'; w, h, t = sizes[b['file']]
    entry = d['boards'].get(k, {'page': P})
    entry.update(x=X0, y=y, w=w, h=h, title=t, page=P); d['boards'][k] = entry
    if k not in d['order']: added.append(k)
    y += h + GAP
for k in added:  # a new board goes after the one before it in BOARDS
    prev = BOARDS[[b['file'] + '.dc.html' for b in BOARDS].index(k) - 1]['file'] + '.dc.html'
    d['order'].insert(d['order'].index(prev) + 1, k)
assert set(d['order']) == set(d['boards'])
with open(INDEX, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('proposals laid out; new boards', added)
