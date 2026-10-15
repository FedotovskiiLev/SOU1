# SPDX-License-Identifier: AGPL-3.0-only
"""Run before publishing changed web assets. No network or dependencies."""
from pathlib import Path
import hashlib,re
root=Path(__file__).resolve().parents[1]/'docs'
h=hashlib.sha256()
for p in sorted(root.rglob('*')):
    if p.is_file() and p.name!='sw.js' and 'downloads' not in p.parts:
        h.update(str(p.relative_to(root)).encode());h.update(p.read_bytes())
p=root/'sw.js'
p.write_text(re.sub(r"const CACHE='[^']+'", "const CACHE='sou1-"+h.hexdigest()[:16]+"'", p.read_text()))
print('Service worker asset revision:',h.hexdigest()[:16])
