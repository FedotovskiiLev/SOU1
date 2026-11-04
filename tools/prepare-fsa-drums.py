# SPDX-License-Identifier: AGPL-3.0-only
"""Rebuild all 58 pinned FSA CC0 drum one-shots. Local files only, no downloads."""
import argparse, hashlib, json, math, pathlib, struct, wave
REV='dbfd6ec52d4ed53b60bdbea5fc6adf295127c027'
KITS={'distkit':13,'sdbkit':10,'synthkit':11,'x0xproc1':11,'x0xproc2':13}
IDS={'hatclsd':'closed-hat','hatopen':'open-hat','hitom':'tom-high','midtom':'tom-mid','lotom':'tom-low'}
GAINS={'kick':.6,'snare':.38,'clap':.38,'closed-hat':.25,'open-hat':.25,'crash':.18,'ride':.18,'cymbal':.18,'sub-a':.35}

def build(source,destination):
 meta=json.loads((pathlib.Path(__file__).resolve().parent.parent/'assets/fsa-drums/upstream.json').read_text())
 if meta['sourceCommit']!=REV or meta['license']!='CC0-1.0' or len(meta['audio'])!=58:raise ValueError('Pinned provenance mismatch')
 expected={m['localFile'] for m in meta['audio']}
 actual={str(p.relative_to(source)) for p in source.rglob('*.wav')}
 if expected!=actual:raise ValueError('Source WAV inventory mismatch')
 catalog=[]
 for kit,count in KITS.items():
  selected=[m for m in meta['audio'] if m['kit']==kit]
  if len(selected)!=count:raise ValueError('Kit inventory mismatch')
  dest=destination/kit;dest.mkdir(parents=True,exist_ok=True);samples=[];instruments=[]
  for m in selected:
   b=(source/m['localFile']).read_bytes()
   if len(b)!=m['bytes'] or hashlib.sha256(b).hexdigest()!=m['sha256'] or hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()!=m['gitBlobSha']:raise ValueError('Source hash mismatch: '+m['localFile'])
   with wave.open(str(source/m['localFile']),'rb') as w:
    if (w.getnchannels(),w.getsampwidth(),w.getframerate())!=(2,3,44100):raise ValueError('Expected PCM24 stereo 44100')
    frames=w.getnframes();raw=w.readframes(frames)
   if frames!=m['pcm']['frames']:raise ValueError('Frame count mismatch')
   pcm=bytearray();previous=0.;output=0.;pole=math.exp(-2*math.pi*15/44100);peak=0.
   for frame in range(frames):
    at=frame*6;left=int.from_bytes(raw[at:at+3],'little',signed=True);right=int.from_bytes(raw[at+3:at+6],'little',signed=True)
    x=(left+right)/2;output=x-previous+pole*output;previous=x
    y=output*min(1,(frames-frame-1)/88);peak=max(peak,abs(y)/8388608);value=round(y)
    if not -8388608<=value<=8388607:raise ValueError('Conversion would clip: '+m['localFile'])
    pcm+=value.to_bytes(3,'little',signed=True)
   id=IDS.get(m['articulation'],m['articulation']);target=dest/(id+'.wav')
   with wave.open(str(target),'wb') as w:w.setnchannels(1);w.setsampwidth(3);w.setframerate(44100);w.writeframes(pcm)
   out=target.read_bytes()
   if len(pcm)%2:
    out+=b'\0';out=out[:4]+struct.pack('<I',len(out)-8)+out[8:];target.write_bytes(out)
   samples.append({'id':id,'file':target.name,'license':'CC0-1.0','author':meta['author'],'sourceRepository':meta['repository'],'sourceCommit':REV,'sourcePath':m['sourcePath'],'sourceUrl':m['sourceUrl'],'sourceGitBlobSha1':m['gitBlobSha'],'sourceSha256':m['sha256'],'sourceBytes':len(b),'sha256':hashlib.sha256(out).hexdigest(),'bytes':len(out),'sampleRate':44100,'channels':1,'frames':frames,'decodedBytes':frames*4,'rootNote':60,'transforms':{'downmix':'(L+R)/2','dcBlocker':'y[n]=x[n]-x[n-1]+exp(-2*pi*15/44100)*y[n-1]; zero state','endFadeFrames':88,'quantization':'PCM24 ties-to-even; no dither','gainDb':0,'trim':False,'resample':False},'peakDbfs':20*math.log10(peak)})
   instrument={'id':id,'gain':GAINS.get(id,.30),'oneShot':True,'zones':[{'sample':id,'keyLow':0,'keyHigh':127,'pitched':False}]}
   if id.endswith('hat'):instrument['chokeGroup']='hat'
   instruments.append(instrument)
  instruments.append({'id':'toms','gain':.30,'oneShot':True,'zones':[{'sample':name,'keyLow':key,'keyHigh':key,'pitched':False} for name,key in [('tom-low',45),('tom-mid',47),('tom-high',49)]]})
  cymbal=next((id for id in ['crash','cymbal'] if any(s['id']==id for s in samples)),None)
  if cymbal:instruments.append({'id':'short-clash','gain':GAINS[cymbal],'oneShot':True,'zones':[{'sample':cymbal,'keyLow':0,'keyHigh':127,'pitched':False}]})
  manifest={'schema':'sou1.cc0-bank.v1','id':'fsa-'+kit+'-full-v1','license':'CC0-1.0','licenseUrl':meta['licenseUrl'],'sourceCommit':REV,'samples':samples,'instruments':instruments,'scoreCymbal':cymbal,'scope':'Every drum one-shot in this FSA kit at the pinned revision; no velocity layers or round robin.'}
  (dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
  catalog.append({'id':'fsa-'+kit,'bankId':manifest['id'],'manifest':kit+'/manifest.json','sampleCount':count,'articulations':[s['id'] for s in samples],'sourceBytes':sum(s['sourceBytes'] for s in samples),'encodedBytes':sum(s['bytes'] for s in samples),'decodedBytes':sum(s['decodedBytes'] for s in samples),'scoreCymbal':cymbal,'missing':['cymbal'] if not cymbal else []})
 (destination/'catalog.json').write_text(json.dumps({'schema':'sou1.drum-catalog.v1','license':'CC0-1.0','sourceCommit':REV,'sampleCount':sum(k['sampleCount'] for k in catalog),'kits':catalog},indent=2)+'\n')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();build(a.source,a.destination)
