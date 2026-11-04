# SPDX-License-Identifier: AGPL-3.0-only
"""Rebuild the small CC0 bank from pinned original WAVs. No downloads or installs."""
import argparse, hashlib, json, math, pathlib, struct, wave

REV = 'dbfd6ec52d4ed53b60bdbea5fc6adf295127c027'
PINS = {
 'x0xproc1-kick.wav': ('kick', 'debd64498f2912701f9d7b1948a00840a5ca3ee424111945d2be5601c7cf735e', .60),
 'x0xproc1-snare.wav': ('snare', '5c5b35d9565e53500a6bc5524ab1d4f249fe3d91878b1d1c103d95c87acdfe6b', .38),
 'x0xproc1-hatclsd.wav': ('closed-hat', 'a43d2df5a21845c5256fb09ff3f1b97105514ef18b2a57bbc33d80c8892efc11', .25),
 'x0xproc1-hatopen.wav': ('open-hat', 'c6a17e715380911a708f6a2ce9b15dea5eac78a3a2ffc89404dfd04aef9e1c05', .25),
 'x0xproc1-clap.wav': ('clap', 'dcd9ccb8d2f860deadd57f82206f9621d24ce1d0db8020842f609a889e236965', .38),
}

def build(source, destination):
 meta=json.loads((pathlib.Path(__file__).resolve().parent.parent/'assets/fsa-electronic/upstream.json').read_text())
 if meta['sourceCommit']!=REV or meta['license']!='CC0-1.0': raise ValueError('Unexpected provenance')
 sources={s['localFile']:s for s in meta['audio']}; samples=[]; instruments=[]
 destination.mkdir(parents=True, exist_ok=True)
 for name,(id,digest,gain) in PINS.items():
  path=source/name; b=path.read_bytes(); m=sources[name]
  if hashlib.sha256(b).hexdigest()!=digest or hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()!=m['gitBlobSha']: raise ValueError('Source hash mismatch: '+name)
  with wave.open(str(path),'rb') as w:
   if (w.getnchannels(),w.getsampwidth(),w.getframerate())!=(2,3,44100): raise ValueError('Expected PCM24 stereo 44100')
   frames=w.getnframes(); raw=w.readframes(frames)
  if frames!=m['pcm']['frames']: raise ValueError('Frame count mismatch')
  pcm=bytearray(); previous=0.; output=0.; pole=math.exp(-2*math.pi*15/44100); peak=0.
  for frame in range(frames):
   at=frame*6; left=int.from_bytes(raw[at:at+3],'little',signed=True); right=int.from_bytes(raw[at+3:at+6],'little',signed=True)
   x=(left+right)/2; output=x-previous+pole*output; previous=x
   # Remove DC without normalizing every hit; fade only the final 2ms to zero.
   y=output*min(1,(frames-frame-1)/88); peak=max(peak,abs(y)/8388608)
   value=round(y)
   if not -8388608<=value<=8388607: raise ValueError('Conversion would clip')
   pcm+=value.to_bytes(3,'little',signed=True)
  target=destination/(id+'.wav')
  with wave.open(str(target),'wb') as w: w.setnchannels(1); w.setsampwidth(3); w.setframerate(44100); w.writeframes(pcm)
  out=target.read_bytes()
  # Python wave does not append the RIFF pad byte for an odd-sized PCM24 payload.
  if len(pcm)%2:
   out=out+b'\0';out=out[:4]+struct.pack('<I',len(out)-8)+out[8:];target.write_bytes(out)
  samples.append({'id':id,'file':target.name,'license':'CC0-1.0','author':meta['author'],'sourceRepository':meta['repository'],'sourceCommit':REV,'sourcePath':m['sourcePath'],'sourceUrl':m['sourceUrl'],'sourceGitBlobSha1':m['gitBlobSha'],'sourceSha256':digest,'sourceBytes':len(b),'sha256':hashlib.sha256(out).hexdigest(),'bytes':len(out),'sampleRate':44100,'channels':1,'frames':frames,'decodedBytes':frames*4,'rootNote':60,'transforms':{'downmix':'(L+R)/2','dcBlocker':'y[n]=x[n]-x[n-1]+exp(-2*pi*15/44100)*y[n-1]; zero state','endFadeFrames':88,'quantization':'PCM24 ties-to-even; no dither','gainDb':0,'trim':False,'resample':False},'peakDbfs':20*math.log10(peak)})
  d={'id':id,'gain':gain,'oneShot':True,'zones':[{'sample':id,'keyLow':0,'keyHigh':127,'pitched':False}]}
  if id.endswith('hat'): d['chokeGroup']='hat'
  instruments.append(d)
 manifest={'schema':'sou1.cc0-bank.v1','id':'fsa-x0xproc1-v1','license':'CC0-1.0','licenseUrl':meta['licenseUrl'],'sourceCommit':REV,'samples':samples,'instruments':instruments}
 (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();build(a.source,a.destination)
