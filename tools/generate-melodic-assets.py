# SPDX-License-Identifier: AGPL-3.0-only
"""Offline melodic asset index, generated from bundled public CC0 material."""
from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[1]/'docs'
paths=['./'+str(p.relative_to(root)) for p in sorted((root/'melodic-assets').rglob('*')) if p.is_file()]
text='// SPDX-License-Identifier: AGPL-3.0-only\n// Generated; recordings retain their documented CC0 licenses.\nself.SOU1_MELODIC_ASSETS='+json.dumps(paths,separators=(',',':'))+';\n'
p=root/'melodic-assets-list.js'
if '--check' in sys.argv:
 if not p.exists() or p.read_text()!=text:raise SystemExit('Melodic asset list is stale')
else:p.write_text(text)
print('Melodic offline assets:',len(paths))
