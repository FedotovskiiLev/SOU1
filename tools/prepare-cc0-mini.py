# SPDX-License-Identifier: AGPL-3.0-only
"""Offline deterministic converter. Input sample0..6.wav plus provenance JSON;
never downloads anything. Original files must match pinned SHA256 and git blobs. Shipped upstream.json
provides immutable metadata; original WAV files are not bundled.
"""
import argparse, hashlib, json, math, pathlib, struct, wave
REV='c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'
PINNED=[('kick','a2d8829e8b2b59e8afb12fa396b01758827059339c2a84ad066d17b36c82d1ff'),('snare','6ec8445cb207df8f1178d8c3894f47969fd53fb2b81c404317e466de4598dc3e'),('hat-rr1','e1fb54c9a030800038abcebbed1c056fb74bdeec627315f3cd5fd893c6e6b031'),('hat-rr2','72830eafed387f4b4b5904d4d6f1da23e13b48986fa1bc09d7c5771eafbb3a1a'),('marimba-c','3e88c006eef05e8f7891f8f6027042006199a4ec3b53a0ad7308f9782a52d4df'),('marimba-g','278e738d8214cdc192e63c3350b1e464a72c86dc135ddf0c5ce035569be66c71'),('shaker-double','0df7c271e1dba4de7304f7df81886390dd9ae698bfdd6df570026af4f2223574')]
def main(src,dst):
 dst.mkdir(parents=True,exist_ok=True);entries=[];sources=json.loads((pathlib.Path(__file__).resolve().parent.parent/'assets/cc0-mini/upstream.json').read_text())
 for i,(name,digest) in enumerate(PINNED):
  path=src/f'sample{i}.wav';b=path.read_bytes();meta=sources[i];
  if hashlib.sha256(b).hexdigest()!=digest or hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()!=meta['sha']:raise ValueError('Upstream file hash mismatch: '+str(path))
  with wave.open(str(path),'rb') as w:
   width=w.getsampwidth();channels=w.getnchannels();rate=w.getframerate();frames=w.getnframes();raw=w.readframes(frames);
  if width not in (2,3) or channels!=2 or rate!=44100:raise ValueError('Unexpected upstream PCM format')
  pcm=bytearray()
  for n in range(frames):
   offset=n*width*2;l=int.from_bytes(raw[offset:offset+width],'little',signed=True);r=int.from_bytes(raw[offset+width:offset+2*width],'little',signed=True)
   # Equal-weight mono, round ties-to-even, no gain, no trim or resampling.
   value=round((l+r)/(2*(2**(8*(width-2)))));pcm+=struct.pack('<h',max(-32768,min(32767,value)))
  target=dst/f'{name}.wav'
  with wave.open(str(target),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(pcm)
  out=target.read_bytes();entries.append({'id':name,'file':target.name,'license':'CC0-1.0','author':'VCSL / Versilian Studios LLC','sourceRepository':'sgossner/VCSL','sourceCommit':REV,'sourcePath':meta['path'],'sourceUrl':f'https://github.com/sgossner/VCSL/blob/{REV}/'+meta['path'].replace(' ','%20').replace('#','%23'),'sourceGitBlobSha1':meta['sha'],'sourceSha256':digest,'sourceBytes':len(b),'sha256':hashlib.sha256(out).hexdigest(),'bytes':len(out),'sampleRate':rate,'channels':1,'frames':frames,'decodedBytes':frames*4,'transforms':{'downmix':'(L+R)/2','quantization':'PCM16 round ties-to-even; no dither','gainDb':0,'trim':False,'resample':False},'rootNote':72 if i==4 else 79 if i==5 else 60})
 manifest={'schema':'sou1.cc0-bank.v1','id':'vcsl-mini-v1','license':'CC0-1.0','licenseUrl':f'https://github.com/sgossner/VCSL/blob/{REV}/LICENSE','sourceCommit':REV,'samples':entries,'instruments':[{'id':'kick','zones':[{'sample':'kick','keyLow':0,'keyHigh':127,'pitched':False}],'gain':0.6,'oneShot':True},{'id':'snare','zones':[{'sample':'snare','keyLow':0,'keyHigh':127,'pitched':False}],'gain':0.38,'oneShot':True},{'id':'closed-hat','zones':[{'sample':'hat-rr1','keyLow':0,'keyHigh':127,'pitched':False},{'sample':'hat-rr2','keyLow':0,'keyHigh':127,'pitched':False}],'gain':0.25,'oneShot':True,'chokeGroup':'hat'},{'id':'marimba','zones':[{'sample':'marimba-c','keyLow':60,'keyHigh':75,'pitched':True},{'sample':'marimba-g','keyLow':76,'keyHigh':91,'pitched':True}],'gain':0.65,'oneShot':False},{'id':'shaker-double','zones':[{'sample':'shaker-double','keyLow':0,'keyHigh':127,'pitched':False}],'gain':0.3,'oneShot':True}]}
 (dst/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();main(a.source,a.destination)
