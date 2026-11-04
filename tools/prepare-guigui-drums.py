# SPDX-License-Identifier: AGPL-3.0-only
"""Repack exact verified Guigui PCM into canonical WAVs. No downloads/install."""
import argparse,hashlib,json,pathlib,wave
REV='df6f17e4625b0451fa2af8accf2e1e641c7ad458'
NAMES={'bass_soft':'kick-soft','bass_hard':'kick-hard','snare_soft':'snare-soft','snare_hard':'snare-hard','tom_hi_soft':'tom-high-soft','tom_hi_hard':'tom-high-hard','tom_mid_soft':'tom-mid-soft','tom_mid_hard':'tom-mid-hard','tom_lo_soft':'tom-low-soft','tom_lo_hard':'tom-low-hard','cymbal_closed':'closed-hat','cymbal_open':'open-hat','cymbal_pedal':'half-cymbal','cymbal_soft':'ride-soft','cymbal_hard':'ride-hard','splash_soft':'splash-soft','splash_hard':'splash-hard'}

def build(source,dest):
 base=pathlib.Path(__file__).resolve().parent.parent/'assets/guigui-drums';meta=json.loads((base/'upstream.json').read_text());qc=json.loads((base/'source-qc.json').read_text());checks={x['sourceFile']:x for x in qc['files']}
 if meta['sourceCommit']!=REV or meta['license']!='CC0-1.0' or len(meta['audio'])!=17:raise ValueError('Pinned source metadata mismatch')
 dest.mkdir(parents=True,exist_ok=True);samples=[]
 for m in meta['audio']:
  raw=(source/m['localFile']).read_bytes();q=checks[m['localFile']]
  if hashlib.sha256(raw).hexdigest()!=m['sha256'] or hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=m['gitBlobSha']:raise ValueError('FLAC source hash mismatch')
  with wave.open(str(source/q['wavFile']),'rb') as w:
   if (w.getnchannels(),w.getsampwidth(),w.getframerate(),w.getnframes())!=(1,2,44100,m['flacStreamInfo']['frames']):raise ValueError('Decoded PCM format mismatch')
   pcm=w.readframes(w.getnframes())
  if hashlib.md5(pcm).hexdigest()!=m['flacStreamInfo']['declaredDecodedPcmMd5']:raise ValueError('Decoded PCM MD5 mismatch')
  id=NAMES[m['localFile'][5:-5]];target=dest/(id+'.wav')
  with wave.open(str(target),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(44100);w.writeframes(pcm)
  out=target.read_bytes();frames=len(pcm)//2
  samples.append({'id':id,'file':target.name,'license':'CC0-1.0','author':'menegass','sourceRepository':meta['repository'],'sourceCommit':REV,'sourcePath':m['sourcePath'],'sourceUrl':m['sourceUrl'],'originalSourceUrl':m['originalSourceUrl'],'originalLicenseIndependentlyConfirmed':m['originalLicenseIndependentlyConfirmed'],'licenseEvidence':m['licenseEvidence'],'sourceGitBlobSha1':m['gitBlobSha'],'sourceSha256':m['sha256'],'sourceBytes':len(raw),'sourcePcmMd5':m['flacStreamInfo']['declaredDecodedPcmMd5'],'sha256':hashlib.sha256(out).hexdigest(),'bytes':len(out),'sampleRate':44100,'channels':1,'frames':frames,'decodedBytes':frames*4,'rootNote':60,'transforms':{'decode':'Lossless FLAC to PCM16 mono 44100; PCM MD5 verified','repack':'Canonical WAV header; audio PCM unchanged','normalization':False,'dcFilter':False,'trim':False,'resample':False,'fade':False},'sourceQc':{'fullScaleSampleCount':q['fullScaleSampleCount'],'maximumConsecutivePositiveFullScaleSamples':q['maximumConsecutivePositiveFullScaleSamples'],'maximumConsecutiveNegativeFullScaleSamples':q['maximumConsecutiveNegativeFullScaleSamples']},'peakDbfs':q['peakDbFS']})
 def gain(id):return .55 if id.startswith('kick') else .35 if id.startswith(('snare','tom')) else .22
 def zones(soft,hard=None,keyLow=0,keyHigh=127):
  z={'sample':soft,'keyLow':keyLow,'keyHigh':keyHigh,'pitched':False}
  if not hard:return [z]
  return [{**z,'velocityLow':0,'velocityHigh':.6},{**z,'sample':hard,'velocityLow':.6000000000000001,'velocityHigh':1}]
 for dynamic in [False,True]:
  mode='dynamic' if dynamic else 'soft';instruments=[]
  for s in samples:
   d={'id':s['id'],'gain':gain(s['id']),'oneShot':True,'zones':zones(s['id'])}
   if s['id'] in ['closed-hat','open-hat']:d['chokeGroup']='hat'
   instruments.append(d)
  for id in ['kick','snare','tom-high','tom-mid','tom-low','ride','splash']:
   instruments.append({'id':id,'gain':gain(id),'oneShot':True,'zones':zones(id+'-soft',id+'-hard' if dynamic else None)})
  instruments.append({'id':'toms','gain':.35,'oneShot':True,'zones':[z for id,k in [('tom-low',45),('tom-mid',47),('tom-high',49)] for z in zones(id+'-soft',id+'-hard' if dynamic else None,k,k)]})
  instruments.append({'id':'short-clash','gain':.22,'oneShot':True,'zones':zones('splash-soft','splash-hard' if dynamic else None)})
  manifest={'schema':'sou1.cc0-bank.v1','id':'guigui-'+mode+'-v1','license':'CC0-1.0','licenseUrl':meta['sampleLicenseSectionUrl'],'sourceCommit':REV,'samples':samples,'instruments':instruments,'scoreCymbal':'splash','mode':mode,'velocitySplit':.6 if dynamic else None,'notes':['17 source PCM waveforms are losslessly preserved, not repaired or normalized.','Five hard drum sources touch digital rails in runs of 1-2 samples; not proof of sustained clipping or listening approval.','Ride is not crash. Half Cymbal retains the author label without a pedal/chick claim.','Dynamic mode uses soft/hard samples at a fixed velocity threshold, not calibrated continuous dynamics or round robin. Soft mode selects soft samples through aliases; all original articulations remain explicitly addressable.']}
  (dest/f'manifest-{mode}.json').write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=pathlib.Path);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();build(a.source,a.destination)
