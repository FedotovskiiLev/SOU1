# SPDX-License-Identifier: AGPL-3.0-only
"""Prepare compact offline media from explicitly accepted CC0 lossy previews.
No network. Raw inputs stay in a caller-supplied directory outside docs/.
Usage: python3 tools/prepare-weather-assets.py ../evidence/weather-sources
"""
from pathlib import Path
import array,hashlib,json,math,struct,subprocess,sys,wave
ROOT=Path(__file__).resolve().parents[1]
RATE=24000
SOURCES=[
 dict(role='rain',author='Snoopy20111',title='Rain_Loop.wav',page='https://freesound.org/people/Snoopy20111/sounds/399072/',download='https://cdn.freesound.org/previews/399/399072_3710957-hq.mp3',sha256='4e85962f845a2de42ac99271799d67243d95607d7374df7fac0c7d515046faa5',bytes=7529184,licenseEvidence='Individual sound page links Creative Commons 0.',filter='highpass=f=100,lowpass=f=6500',start=104,seconds=14,targetRms=.04,peakCeiling=.20,loop=True),
 dict(role='wind',author='Nox_Sound',title='Ambiance_Wind_Forest_Trees_Loop_01.wav',page='https://freesound.org/people/Nox_Sound/sounds/530908/',download='https://cdn.freesound.org/previews/530/530908_9250976-hq.mp3',sha256='b8962b2e82563d6a864c3215147e975633af5f27205f07cd2d3639584d6e715b',bytes=945984,licenseEvidence='Individual sound page links Creative Commons 0.',filter='highpass=f=35,lowpass=f=1600',start=3,seconds=14,targetRms=.035,peakCeiling=.20,loop=True),
 dict(role='thunder',author='Joseph SARDIN & Axeline T.',title='Thunder #4',page='https://bigsoundbank.com/thunder-4-s3115.html',download='https://bigsoundbank.com/UPLOAD/mp3/3115.mp3?v=d',sha256='96d47d6d94d1e2cb8455a662e0e36af9084a5b33a100acc8e05dc3f58be64eab',bytes=690508,licenseEvidence='Individual sound page explicitly labels the recording CC0 (public domain).',filter='highpass=f=25,lowpass=f=6500',start=0,seconds=16,targetRms=.04,peakCeiling=.28,loop=False)
]
def rms(a):return math.sqrt(sum(x*x for x in a)/len(a))
def peak(a):return max(abs(x) for x in a)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def prepare(directory):
 dst=ROOT/'docs/weather-assets';dst.mkdir(exist_ok=True)
 ffmpegVersion=subprocess.run(['ffmpeg','-version'],capture_output=True,text=True,check=True).stdout.splitlines()[0]
 entries=[]
 for spec in SOURCES:
  role=spec['role'];p=directory/(role+'-public-preview.mp3');raw=p.read_bytes()
  if len(raw)!=spec['bytes'] or digest(raw)!=spec['sha256']:raise ValueError('Unapproved input: '+role)
  filters=('pan=mono|c0=0.5*c0+0.5*c1,' if role!='thunder' else '')+spec['filter']
  args=['ffmpeg','-v','error','-i',str(p),'-af',filters,'-ar',str(RATE),'-ac','1','-f','f32le','-']
  decoded=subprocess.run(args,capture_output=True,check=True).stdout
  values=array.array('f');values.frombytes(decoded)
  if sys.byteorder!='little':values.byteswap()
  if not all(math.isfinite(v) for v in values):raise ValueError('Nonfinite decode')
  decoded_peak=peak(values);overshoots=sum(abs(v)>1 for v in values)
  start=spec['start']*RATE;end=start+spec['seconds']*RATE
  if end>len(values):raise ValueError('Source too short')
  a=list(values[start:end]);overlap=2*RATE if spec['loop'] else 0
  if overlap:
   # End first follows original PCM; final blend then rejoins original PCM at
   # x[overlap]. sin/cos weights keep uncorrelated noise energy through overlap.
   cross=[]
   for i in range(overlap):
    t=i/(overlap-1);w=.5-.5*math.cos(math.pi*t)
    cross.append(a[-overlap+i]*math.sqrt(1-w)+a[i]*math.sqrt(w))
   a=a[overlap:-overlap]+cross
  else:
   fadeIn=round(.03*RATE);fadeOut=RATE
   for i in range(fadeIn):a[i]*=.5-.5*math.cos(math.pi*i/(fadeIn-1))
   for i in range(fadeOut):a[-fadeOut+i]*=.5+.5*math.cos(math.pi*i/(fadeOut-1))
  prePeak=peak(a);preRms=rms(a);gain=min(spec['targetRms']/preRms,spec['peakCeiling']/prePeak)
  pcm=[round(x*gain*32767) for x in a]
  if any(abs(x)>=32767 for x in pcm):raise ValueError('Clipped derivative')
  data=b''.join(struct.pack('<h',x) for x in pcm);file=role+'.wav';out=dst/file
  with wave.open(str(out),'wb') as w:w.setparams((1,2,RATE,0,'NONE','not compressed'));w.writeframes(data)
  b=out.read_bytes()
  if len(b)!=44+len(pcm)*2 or b[36:40]!=b'data':raise ValueError('Expected canonical RIFF')
  v=[x/32768 for x in pcm];steps=sorted(abs(v[i]-v[i-1]) for i in range(1,len(v)))
  seam=abs(v[0]-v[-1]);edge=round(RATE*.2)
  analysis=dict(peak=peak(v),rms=rms(v),clippedSamples=0,nonfiniteSamples=0,dc=sum(v)/len(v),maxAdjacentStep=steps[-1],p99AdjacentStep=steps[int(len(steps)*.99)],wrapStep=seam if overlap else None,first200msRms=rms(v[:edge]),last200msRms=rms(v[-edge:]),filteredSourcePeak=decoded_peak,filteredSourceSamplesAboveUnity=overshoots,listeningReview='Pending human review; no speech-isolation or subjective seamlessness claim.')
  source={k:spec[k] for k in ['author','title','page','download','sha256','bytes','licenseEvidence']}
  source.update(format='lossy public MP3 preview, not original WAV',license='CC0-1.0',licenseUrl='https://creativecommons.org/publicdomain/zero/1.0/',licenseVerifiedDate='2026-11-04')
  transforms=dict(selectedStartSeconds=spec['start'],selectedSourceSeconds=spec['seconds'],ffmpegFilters=filters,downmix='Explicit 0.5L+0.5R for stereo rain/wind; thunder already mono',resample='ffmpeg default resampler to 24000Hz',gainLinear=gain,gainDb=20*math.log10(gain),normalization='One fixed offline gain for the derivative: target RMS constrained by peak ceiling; no runtime normalization/compression',quantization='PCM16 round ties-to-even, no dither',loopOverlapSeconds=2 if overlap else 0,loopMethod='Baked cyclic 2s raised-cosine equal-power overlap; runtime wraps full prepared file' if overlap else 'Finite event, 30ms raised-cosine fade in, 1s raised-cosine fade out; never loop',ffmpegVersion=ffmpegVersion)
  entries.append(dict(role=role,file=file,sha256=digest(b),bytes=len(b),sampleRate=RATE,channels=1,frames=len(pcm),loop=spec['loop'],license='CC0-1.0',source=source,transforms=transforms,analysis=analysis))
 manifest=dict(schema='sou1.weather-bank.v1',id='cc0-weather-preview-v1',license='CC0-1.0',sampleRate=RATE,encodedBytes=sum(s['bytes']for s in entries),decodedBytes=sum(s['frames']*4 for s in entries),samples=entries,limitations=['All media were processed from lossy public MP3 previews; PCM packaging cannot restore discarded source detail.','Rain and wind are natural ambient recordings, not isolated clean-room sound components. Wind source is tagged birds.','Thunder #4 is described by its author as without rain; no independent isolation guarantee.','Short loops repeat; cyclic overlap and conservative levels are numerically checked, not a guarantee of inaudible repetition.','Code remains AGPL-3.0-only. CC0 applies to listed media, not the complete SOU1 application.'])
 (dst/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({s['role']:{'bytes':s['bytes'],'frames':s['frames'],'sha256':s['sha256'],'peak':s['analysis']['peak'],'rms':s['analysis']['rms'],'wrapStep':s['analysis']['wrapStep']}for s in entries},indent=2))
if __name__=='__main__':
 if len(sys.argv)!=2:raise SystemExit(__doc__)
 prepare(Path(sys.argv[1]))
