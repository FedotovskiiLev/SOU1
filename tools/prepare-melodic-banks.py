# SPDX-License-Identifier: AGPL-3.0-only
"""Build bounded SOU1 CC0 multisample banks from exact, independently pinned WAVs.
No downloads or plug-in code. Requires NumPy 2.3.5, SciPy 1.17.0.
"""
import argparse, hashlib, json, math, pathlib, re, wave
import numpy as np
from scipy.signal import resample_poly
RATE=32000
LOOPS={p["id"]:p for p in json.loads((pathlib.Path(__file__).resolve().parent/"melodic-loop-points.json").read_text())["points"]}

def sha(b): return hashlib.sha256(b).hexdigest()
def regions(path):
    text=re.sub(r'//[^\n]*','',path.read_text())
    glob={};group={};out=[]
    for kind,body in re.findall(r'<(\w+)>([^<]*)',text):
        d=dict((m.group(1),m.group(2).strip()) for m in re.finditer(r'(\w+)\s*=\s*(.*?)(?=\s+\w+\s*=|$)',body,re.S))
        if kind=='global':glob=d
        elif kind=='group':group=d
        elif kind=='region':out.append({**glob,**group,**d})
    return out

def decode(raw):
    import io
    with wave.open(io.BytesIO(raw)) as w:
        n,c,r,b=w.getnframes(),w.getnchannels(),w.getframerate(),w.getsampwidth();pcm=w.readframes(n)
    if b==2:a=np.frombuffer(pcm,dtype='<i2').astype(np.float64)/32768
    elif b==3:
        v=np.frombuffer(pcm,dtype=np.uint8).reshape(-1,3).astype(np.int32);v=v[:,0]|(v[:,1]<<8)|(v[:,2]<<16);v=np.where(v&0x800000,v-0x1000000,v);a=v.astype(np.float64)/8388608
    elif b==4:a=np.frombuffer(pcm,dtype='<i4').astype(np.float64)/2147483648
    else:raise ValueError('Unsupported source WAV')
    return a.reshape(-1,c).mean(axis=1),r,c

def build(root,catalog,dest):
    cat=json.loads(catalog.read_text()); downloads={(d['root'],d['path']):d for d in cat['downloads']};maps={d['bank']:d for d in cat['maps']}
    dest.mkdir(parents=True,exist_ok=True); samples=[]; sample_index={};instruments={}
    # None velocityLimit preserves every original velocity layer and RR. The
    # quiet strings are intentionally a single soft layer (not claimed 2-layer).
    specs=[('cello','vsco-cello-sustain',45,74,62,4.5,True,.14,.8,.20),
           ('violin','vsco-violin-sustain',60,86,62,4.5,True,.3,1.2,.10),
           ('harp','vsco-harp-damped',48,96,None,4.0,False,.002,.6,.30),
           ('pizzicato','vsco-cello-pizzicato-short',33,52,None,1.8,False,.002,.4,.35),
           ('flute','vsco-flute-chamber-soft',60,78,62,5.0,False,.025,.7,.15),
           ('piano','vcsl-steinway-b',48,96,None,5.0,False,.004,.4,.65)]
    for name,bank,low,high,velLimit,seconds,loop,attack,release,gain in specs:
        m=maps[bank];sfz=root/m['root']/m['path'];mapping=sfz if sfz.exists() else pathlib.Path(__file__).resolve().parent.parent/m['bundled'];rawmap=mapping.read_bytes()
        if sha(rawmap)!=m['sha256']:raise ValueError('Map hash mismatch '+bank)
        zones=[]
        for z in regions(mapping):
            if z.get('trigger','attack')!='attack':continue
            lo,hi=int(z.get('lokey',z['pitch_keycenter'])),int(z.get('hikey',z['pitch_keycenter']));center=int(z['pitch_keycenter']);vl,vh=int(z.get('lovel',0)),int(z.get('hivel',127))
            if hi<low or lo>high or (velLimit is not None and vl>velLimit):continue
            if name=='piano':
                # Selected whole-tone source roots every six semitones. Max
                # shift is three semitones; all three source velocity layers kept.
                if (center-48)%6!=0:continue
                lo=max(low,center-3);hi=min(high,center+2 if center<96 else 96)
            else:
                if name=='pizzicato' and lo==36:lo=33 # Explicit three-semitone low extension of original C2 zone.
                lo=max(lo,low);hi=min(hi,high)
            if velLimit is not None:vl,vh=0,127
            path=(sfz.parent/z['sample'].replace('\\','/')).resolve();rel=path.relative_to((root/m['root']).resolve()).as_posix();meta=downloads[(m['root'],rel)]
            raw=path.read_bytes();blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            if len(raw)!=meta['size'] or sha(raw)!=meta['sha256'] or blob!=meta['git_blob_sha']:raise ValueError('Source hash mismatch '+rel)
            offset=int(z.get('offset',0));key=(m['root'],rel,offset,seconds,loop)
            index=sample_index.get(key)
            if index is None:
                pcm,sr,channels=decode(raw);pcm=pcm[offset:offset+math.ceil(seconds*sr)]
                divisor=math.gcd(sr,RATE);pcm=resample_poly(pcm,RATE//divisor,sr//divisor,window=('kaiser',8.6))
                # Fade only the last 30ms of this explicitly shortened derivative.
                fade=min(len(pcm),round(.03*RATE));pcm[-fade:]*=np.linspace(1,0,fade)
                if not np.isfinite(pcm).all() or abs(pcm).max()>=1:raise ValueError('Unexpected source clipping after mono/resampling')
                out=np.rint(pcm*32768).clip(-32768,32767).astype('<i2');sid=f'{name}-{center}-{vl}-{int(z.get("seq_position",1))}';filename=sid+'.wav'
                with wave.open(str(dest/filename),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE);w.writeframes(out.tobytes())
                encoded=(dest/filename).read_bytes();n=len(out);ls=round(1.5*RATE) if loop else 0;le=min(n-round(.1*RATE),round(4.2*RATE)) if loop else 0;cross=round(.25*RATE) if loop else 0
                if loop:
                    point=LOOPS[sid];ls=round(point['start']*RATE);le=round(point['end']*RATE)
                if loop and le-ls<=cross*2:raise ValueError('Source too short for documented loop')
                index=len(samples);sample_index[key]=index
                samples.append({'id':sid,'file':filename,'bytes':len(encoded),'sha256':sha(encoded),'frames':n,'sampleRate':RATE,'rootNote':center,'loopStart':ls,'loopEnd':le,'crossfade':cross,'license':'CC0-1.0','author':'Versilian Studios / contributors','sourceRepository':'sgossner/'+('VCSL' if m['root']=='vcsl-smodelb' else 'VSCO-2-CE'),'sourceCommit':cat['source_commits']['sgossner/'+('VCSL' if m['root']=='vcsl-smodelb' else 'VSCO-2-CE')],'sourcePath':rel,'sourceUrl':meta['url'],'sourceSha256':meta['sha256'],'sourceGitBlobSha1':blob,'sourceBytes':len(raw),'sourceMap':m['path'],'sourceMapSha256':m['sha256'],'transforms':{'sourceOffsetFrames':offset,'downmix':'arithmetic mean of source channels','sourceChannels':channels,'sourceRate':sr,'resample':'scipy.signal.resample_poly, Kaiser beta=8.6','targetRate':RATE,'maximumSeconds':seconds,'terminalFadeSeconds':.03,'quantization':'PCM16 ties-to-even; no dither','normalization':False,'loop':{'kind':'SOU1 derived 250ms crossfade, not original SFZ loop','startSeconds':ls/RATE,'endSeconds':le/RATE,'endpointSelection':'similar 250ms RMS; see tools/melodic-loop-points.json'} if loop else None}})
            zones.append({'sampleIndex':index,'keyLow':lo,'keyHigh':hi,'velocityLow':vl,'velocityHigh':vh,'gain':10**(float(z.get('volume',0))/20)})
        instruments[name]={'id':name,'gain':gain,'attack':attack,'release':release,'zones':zones,'keyLow':low,'keyHigh':high,'sourceMapSha256':m['sha256']}
    for id,names in [('chamber',['cello','harp','harp','violin','pizzicato']),('chamber-flute',['cello','flute','harp','violin','pizzicato']),('piano-room',['cello','piano','piano','violin','pizzicato'])]:
        selected=sorted({z['sampleIndex'] for name in names for z in instruments[name]['zones']});remap={old:i for i,old in enumerate(selected)};ss=[samples[i] for i in selected];ii=[]
        for layer,name in enumerate(names):
            d={**instruments[name],'layer':layer};d['zones']=[{**z,'sampleIndex':remap[z['sampleIndex']]} for z in d['zones']];ii.append(d)
        total=sum(s['frames']*4 for s in ss)
        if len(ss)>96 or total>32*1024*1024:raise ValueError('Bank source memory budget '+id+': '+str(total))
        manifest={'schema':'sou1.melodic-bank.v1','id':id,'license':'CC0-1.0','samples':ss,'instruments':ii,'encodedBytes':sum(s['bytes'] for s in ss),'decodedBytes':total,'notes':['Compact mono derivative of pinned CC0 source recordings, not a full SFZ player.','Original region gains and MIDI velocity bands are preserved; quiet string/flute presets intentionally expand the selected soft layer across velocities.','Pizzicato extends the lowest original C2 zone by three semitones down to MIDI33; event pitch is retained.','No per-sample normalization. Piano retains three dynamics at selected six-semitone roots; no release-trigger samples or pedal simulation.','Sustained strings use explicitly derived crossfaded loops; all other instruments have finite natural decay with shortened tails.','Key ranges are explicit. Caller must use an explicit diagnostic fallback outside them; do not silently transpose/drop score notes.','Real browser, Android device, listening and full app acceptance remain separate gates.']}
        (dest/(id+'.json')).write_text(json.dumps(manifest,indent=2)+'\n')
    # Source license text supplied as CC0 legal code; original author readmes retained.
    for kind in ('vsco2-ce','vcsl-smodelb'):
        p=root/kind/'LICENSE'
        if p.exists():(dest/(kind+'-LICENSE.txt')).write_bytes(p.read_bytes())
    (dest/'README.txt').write_text('SOU1 compact CC0 melodic banks. Sources: Versilian Studios VSCO 2 CE and VCSL.\nEvery WAV records its exact upstream commit, SHA256, Git blob and transformations in the bank manifests.\nThese recordings are CC0; SOU1 player/builder code remains separately licensed.\n')
    return {'uniqueSamples':len(samples),'totalEncodedBytes':sum(s['bytes'] for s in samples),'presets':{id:json.loads((dest/(id+'.json')).read_text())['decodedBytes'] for id in ['chamber','chamber-flute','piano-room']}}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source_root',type=pathlib.Path);p.add_argument('catalog',type=pathlib.Path);p.add_argument('destination',type=pathlib.Path);a=p.parse_args();print(json.dumps(build(a.source_root,a.catalog,a.destination),indent=2))
