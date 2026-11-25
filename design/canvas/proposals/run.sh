#!/usr/bin/env bash
# Regenerates the Proposal-Redesign-* boards from design/redesign/prototype/index.html and lays out the
# Proposals page. Needs python3 and the e2e package's Playwright (pnpm install at the repo root).
set -euo pipefail
cd "$(dirname "$0")"
python3 -c "
import json,sys
from states import BOARDS
L=[{k:s[k] for k in ['id','preset','theme','ww','actions','wait','h']} for b in BOARDS for s in b['states']]
json.dump(L,open('states.json','w'))"
if [[ "$(cat states.json)" != "[]" ]]; then
  node capture.cjs states.json frags.json
fi
python3 build.py
SPEC=../project/Proposal-Redesign-Spec.dc.html
H=$(node measure.cjs "$SPEC")
python3 - "$SPEC" "$H" <<'PY'
import sys,re
p,h=sys.argv[1],sys.argv[2]
s=open(p).read()
s=re.sub(r'"\$preview":\{"width":1360,"height":\d+\}','"$preview":{"width":1360,"height":%s}'%h,s)
open(p,'w').write(s)
PY
python3 layout.py "$H"
node ../../tools/check.mjs
