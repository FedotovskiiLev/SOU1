# SPDX-License-Identifier: AGPL-3.0-only
"""Check the unsigned APK's bundled licenses and exact offline media. No signing."""
import pathlib,sys,zipfile,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1]
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.read('assets/LICENSE.txt')==(root/'LICENSE').read_bytes(),'AGPL LICENSE missing or changed'
 assert not any(n.startswith('assets/downloads/') for n in z.namelist()),'Nested APK downloads must be excluded'
 for name in ['weather-assets/manifest.json','weather-assets/NOTICE.md','melodic-assets/pulse-marimba.json']:
  assert z.read('assets/'+name)==(root/'docs'/name).read_bytes(),name
 for folder,manifest in [('weather-assets','manifest.json'),('melodic-assets','pulse-marimba.json')]:
  m=json.loads((root/'docs'/folder/manifest).read_bytes())
  for s in m['samples']:
   b=z.read('assets/'+folder+'/'+s['file']);assert len(b)==s['bytes'] and hashlib.sha256(b).hexdigest()==s['sha256'],s['file']
 print('PASS APK contains AGPL LICENSE and exact offline CC0 weather/Pulse media; downloads excluded. Signature is checked separately.')
