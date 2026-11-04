// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Bounded CC0 sampler; preparation allocates, rendering/control does not.
 * Single audio-thread ownership. No native plug-in/SFZ host. Each immutable Bank
 * owns PCM and resampling tables and may be shared by independent voice pools.
 * Source data is never exposed. Stop and Melody mute cannot resurrect tails.
 */
public final class LiveMelodicPool {
    private static final int PHASES=128,TAPS=16,MAX_BYTES=32*1024*1024;
    private static boolean unit(double n){return Double.isFinite(n)&&n>=0&&n<=1;}
    private static double clip(double n){return Double.isFinite(n)?Math.max(0,Math.min(1,n)):0;}
    private static void require(boolean b){if(!b)throw new IllegalArgumentException("Invalid melodic bank/event metadata");}
    public static final class Sample {
        private final float[] pcm;
        public final int sampleRate,rootNote,loopStart,loopEnd,crossfade;
        /** A descriptor only; Bank validates/copies the array before rendering. */
        public Sample(float[] pcm,int rate,int root,int start,int end,int fade){this.pcm=pcm;sampleRate=rate;rootNote=root;loopStart=start;loopEnd=end;crossfade=fade;}
    }
    public static final class Zone {
        public final int sampleIndex,keyLow,keyHigh,velocityLow,velocityHigh;
        public final double gain;
        public Zone(int sample,int low,int high,int vl,int vh,double gain){sampleIndex=sample;keyLow=low;keyHigh=high;velocityLow=vl;velocityHigh=vh;this.gain=gain;}
    }
    public static final class Instrument {
        public final int layer;
        public final double gain,attack,release;
        private final Zone[] zones;
        public Instrument(int layer,double gain,double attack,double release,Zone[] zones){this.layer=layer;this.gain=gain;this.attack=attack;this.release=release;this.zones=zones==null?null:zones.clone();}
    }
    private static final class Entry {
        final Sample sample;final double step,gain;final double[] table;
        Entry(Sample s,double step,double gain,double[] table){sample=s;this.step=step;this.gain=gain;this.table=table;}
    }
    private static final class Compiled {
        final double gain;final int attack,release;final char[] lookup;final Entry[][] groups;
        Compiled(double gain,int attack,int release,char[] lookup,Entry[][] groups){this.gain=gain;this.attack=attack;this.release=release;this.lookup=lookup;this.groups=groups;}
    }
    public static final class Bank {
        public final int sampleRate,preparedBytes,kernelBytes;
        private final Compiled[] instruments;
        public Bank(int rate,Sample[] input,Instrument[] definitions){
            require(rate>=8000&&rate<=192000&&input!=null&&input.length>=1&&input.length<=96&&definitions!=null&&definitions.length==5);
            long bytes=0;
            for(Sample s:input){require(s!=null&&s.pcm!=null&&s.sampleRate>=8000&&s.sampleRate<=96000&&s.pcm.length>=2&&s.pcm.length<=(long)s.sampleRate*12&&s.rootNote>=0&&s.rootNote<=127&&s.loopStart>=0&&s.loopStart<s.pcm.length&&s.loopEnd>=0&&s.loopEnd<=s.pcm.length&&s.crossfade>=0&&s.crossfade<=s.pcm.length&&((s.loopEnd==0&&s.loopStart==0&&s.crossfade==0)||(s.loopEnd>s.loopStart&&s.crossfade>=16&&s.loopEnd-s.loopStart>2*s.crossfade)));bytes+=(long)s.pcm.length*4;require(bytes<=MAX_BYTES);}
            Sample[] samples=new Sample[input.length];
            for(int i=0;i<input.length;i++){Sample s=input[i];float[] pcm=s.pcm.clone();for(float v:pcm)require(Float.isFinite(v)&&Math.abs(v)<=2);samples[i]=new Sample(pcm,s.sampleRate,s.rootNote,s.loopStart,s.loopEnd,s.crossfade);}
            Map<Double,double[]> kernels=new HashMap<>();instruments=new Compiled[5];
            for(Instrument d:definitions){
                require(d!=null&&d.layer>=0&&d.layer<5&&instruments[d.layer]==null&&unit(d.gain)&&Double.isFinite(d.attack)&&d.attack>=.001&&d.attack<=4&&Double.isFinite(d.release)&&d.release>=.005&&d.release<=4&&d.zones!=null&&d.zones.length>=1&&d.zones.length<=192);
                for(Zone z:d.zones)require(z!=null&&z.sampleIndex>=0&&z.sampleIndex<samples.length&&z.keyLow>=0&&z.keyLow<=z.keyHigh&&z.keyHigh<=127&&z.velocityLow>=0&&z.velocityLow<=z.velocityHigh&&z.velocityHigh<=127&&Double.isFinite(z.gain)&&z.gain>=0&&z.gain<=32);
                char[] lookup=new char[128*128];Arrays.fill(lookup,(char)65535);List<Entry[]> groups=new ArrayList<>();Map<String,Integer> ids=new HashMap<>();
                for(int key=0;key<128;key++)for(int vel=0;vel<128;vel++){
                    List<Zone> matches=new ArrayList<>();StringBuilder signature=new StringBuilder().append(key).append(':');
                    for(int j=0;j<d.zones.length;j++){Zone z=d.zones[j];if(key>=z.keyLow&&key<=z.keyHigh&&vel>=z.velocityLow&&vel<=z.velocityHigh){matches.add(z);signature.append(j).append(',');}}
                    if(matches.isEmpty())continue;String sig=signature.toString();Integer id=ids.get(sig);
                    if(id==null){id=groups.size();ids.put(sig,id);Entry[] entries=new Entry[matches.size()];
                        for(int j=0;j<entries.length;j++){Zone z=matches.get(j);Sample s=samples[z.sampleIndex];double step=(double)s.sampleRate/rate*Math.pow(2,(key-s.rootNote)/12.0);require(step>=.125&&step<=8);double[] table=kernels.get(step);if(table==null){require(kernels.size()<128);table=kernel(step);kernels.put(step,table);}entries[j]=new Entry(s,step,z.gain,table);}groups.add(entries);}
                    lookup[key*128+vel]=(char)(int)id;
                }
                instruments[d.layer]=new Compiled(d.gain,Math.max(1,(int)Math.round(d.attack*rate)),Math.max(2,(int)Math.round(d.release*rate)),lookup,groups.toArray(new Entry[0][]));
            }
            sampleRate=rate;preparedBytes=(int)bytes;kernelBytes=kernels.size()*(PHASES+1)*TAPS*8;
        }
    }
    private static double[] kernel(double step){
        double[] table=new double[(PHASES+1)*TAPS];double cut=.90*Math.min(1,1/step);
        for(int p=0;p<=PHASES;p++){double sum=0,frac=(double)p/PHASES;
            for(int t=0;t<TAPS;t++){double x=frac-(t-7),w=Math.abs(x)<8?.5+.5*Math.cos(Math.PI*x/8):0,y=x*cut,v=cut*(Math.abs(y)<1e-12?1:Math.sin(Math.PI*y)/(Math.PI*y))*w;table[p*TAPS+t]=v;sum+=v;}
            for(int t=0;t<TAPS;t++)table[p*TAPS+t]/=sum;
        }return table;
    }
    private static final class Voice {boolean active;Sample sample;double[] table;int layer,pitch,age,gate,attack,release,releaseLeft;double position,step,releaseGain,releaseStep,attackAtRelease,level,panL,panR,colourL1,colourL2,colourH1,colourH2,air,colourPhase,colourFrequency,colourEnergy,colourMean;}
    private final Bank bank;private final Voice[] voices;private final int[][] cursors;private final int stopFrames;
    private int active,voiceLimit;private boolean enabled=true,melody=true;
    private final double[] lowBand,highBand;private final double airPole,morphSmooth,energyPole,meanPole;private double depth;
    private static double[] colourBand(int rate,double frequency,double q){double w=2*StrictMath.PI*frequency/rate,a=StrictMath.sin(w)/(2*q),d=1+a;return new double[]{a/d,-2*StrictMath.cos(w)/d,(1-a)/d};}
    public double outputL,outputR;public long accepted,dropped,unmapped;
    public LiveMelodicPool(Bank bank){this(bank,16);}
    public LiveMelodicPool(Bank bank,int polyphony){require(bank!=null&&polyphony>=1&&polyphony<=32);this.bank=bank;voiceLimit=polyphony;voices=new Voice[32];for(int i=0;i<voices.length;i++)voices[i]=new Voice();cursors=new int[5][];for(int i=0;i<5;i++)cursors[i]=new int[bank.instruments[i].groups.length];stopFrames=Math.max(2,(int)Math.round(.05*bank.sampleRate));lowBand=colourBand(bank.sampleRate,700,.8);highBand=colourBand(bank.sampleRate,Math.min(2600,bank.sampleRate*.3),.8);airPole=1-StrictMath.exp(-2*StrictMath.PI*Math.min(3200,bank.sampleRate*.35)/bank.sampleRate);morphSmooth=1-StrictMath.exp(-1/(bank.sampleRate*.12));energyPole=1-StrictMath.exp(-1/(bank.sampleRate*.03));meanPole=1-StrictMath.exp(-2*StrictMath.PI*20/bank.sampleRate);}
    public int getActiveVoices(){return active;}public int getSampleRate(){return bank.sampleRate;}public int getPolyphony(){return voiceLimit;}public int getCapacity(){return voices.length;}public boolean isEnabled(){return enabled;}
    public double getTimbreDepth(){return depth;}
    public void setVoiceLimit(int limit){require(limit>=1&&limit<=32);voiceLimit=limit;int excess=active-limit;for(int i=voices.length-1;i>=0&&excess>0;i--){Voice v=voices[i];if(v.active){fade(v,stopFrames);excess--;}}}
    public void setEnabled(boolean next){if(enabled&&!next)stop();enabled=next;}
    public void setMelodyEnabled(boolean next){if(melody&&!next)for(Voice v:voices)if(v.active&&(v.layer==1||v.layer==2))fade(v,stopFrames);melody=next;}
    public boolean trigger(int layer,int pitch,double duration,double velocity,double pan){
        if(layer<0||layer>4||pitch<0||pitch>127||!Double.isFinite(duration)||duration<=0||duration>120||!unit(velocity)||!unit(pan)||!enabled||(!melody&&(layer==1||layer==2))){dropped++;return false;}
        Compiled d=bank.instruments[layer];int id=d.lookup[pitch*128+(int)Math.round(velocity*127)];if(id==65535){unmapped++;return false;}
        if(active>=voiceLimit){dropped++;return false;}
        Voice v=null;for(Voice candidate:voices)if(!candidate.active){v=candidate;break;}if(v==null){dropped++;return false;}
        Entry[] group=d.groups[id];Entry e=group[cursors[layer][id]];cursors[layer][id]=(cursors[layer][id]+1)%group.length;
        v.pitch=pitch;v.colourFrequency=440*StrictMath.pow(2,(pitch-69)/12.0);v.colourPhase=v.colourEnergy=v.colourMean=0;v.colourL1=v.colourL2=v.colourH1=v.colourH2=v.air=0;v.active=true;v.sample=e.sample;v.table=e.table;v.position=0;v.step=e.step;v.layer=layer;v.age=0;v.gate=Math.max(1,(int)Math.round(duration*bank.sampleRate));v.attack=d.attack;v.release=d.release;v.releaseLeft=0;v.releaseGain=1;v.releaseStep=0;v.attackAtRelease=1;v.level=velocity*d.gain*e.gain;v.panL=Math.sqrt(1-pan);v.panR=Math.sqrt(pan);active++;accepted++;return true;
    }
    private static void fade(Voice v,int frames){if(v.releaseLeft>0&&v.releaseLeft<=frames)return;if(v.releaseLeft==0)v.attackAtRelease=Math.min(1,(double)Math.max(0,v.age-1)/v.attack);v.releaseLeft=frames;v.releaseStep=v.releaseGain/(frames-1);}
    public void stop(){for(Voice v:voices)if(v.active)fade(v,stopFrames);}public void release(){stop();}
    private static double read(Voice v,double position){int base=(int)Math.floor(position);double phase=(position-base)*PHASES;int p=(int)Math.floor(phase),offset=p*TAPS;double f=phase-p,out=0;float[] pcm=v.sample.pcm;double[] table=v.table;
        for(int j=0;j<TAPS;j++){int at=base+j-7;if(at>=0&&at<pcm.length){double w=table[offset+j]+f*(table[offset+TAPS+j]-table[offset+j]);out+=pcm[at]*w;}}return out;}
    public void next(double[] gains,boolean playing){next(gains,playing,0,0,1);}
    public void next(double[] gains,boolean playing,double timbreDepth,long frame,long seed){setEnabled(playing);double target=clip(timbreDepth);depth+=morphSmooth*(target-depth);if(Math.abs(depth-target)<1e-9)depth=target;double clock=Math.max(0,frame)/(double)bank.sampleRate,phase=((seed&0xffffffffL)%1021)/1021.0;boolean valid=gains!=null&&gains.length==5;double left=0,right=0;
        for(Voice v:voices){if(!v.active)continue;if(v.age>=v.gate&&v.releaseLeft==0)fade(v,v.release);Sample s=v.sample;double sample=read(v,v.position);
            if(s.loopEnd>0&&v.position>=s.loopEnd-s.crossfade){double x=(v.position-(s.loopEnd-s.crossfade))/s.crossfade;sample=sample*(1-x)+read(v,s.loopStart+v.position-(s.loopEnd-s.crossfade))*x;}
            double body=lowBand[0]*sample+v.colourL1;v.colourL1=v.colourL2-lowBand[1]*body;v.colourL2=-lowBand[0]*sample-lowBand[2]*body;
            double detail=highBand[0]*sample+v.colourH1;v.colourH1=v.colourH2-highBand[1]*detail;v.colourH2=-highBand[0]*sample-highBand[2]*detail;
            v.air+=airPole*(sample-v.air);v.colourMean+=meanPole*(sample-v.colourMean);double ac=sample-v.colourMean;v.colourEnergy+=energyPole*(ac*ac-v.colourEnergy);
            if(depth>0){double offset=phase+v.pitch*.013+v.layer*.17,a=.5+.5*StrictMath.sin(2*StrictMath.PI*(clock/9+offset)),b=.5+.5*StrictMath.sin(2*StrictMath.PI*(clock/17+offset*.31));double h2=v.colourFrequency*2<bank.sampleRate*.45?StrictMath.sin(4*StrictMath.PI*v.colourPhase):0,h3=v.colourFrequency*3<bank.sampleRate*.45?StrictMath.sin(6*StrictMath.PI*v.colourPhase):0;double colour=.40*sample+.60*((1-a)*body+a*detail)+.12*(2*b-1)*(sample-v.air)+StrictMath.sqrt(Math.max(0,v.colourEnergy))*(.45*a*h2+.30*b*h3);sample+=depth*(colour-sample);}
            v.colourPhase+=v.colourFrequency/bank.sampleRate;v.colourPhase-=StrictMath.floor(v.colourPhase);
            double env=v.releaseLeft>0?v.attackAtRelease*(v.releaseLeft==1?0:v.releaseGain):Math.min(1,(double)v.age/v.attack);
            if(s.loopEnd==0)env*=Math.min(1,Math.max(0,(s.pcm.length-1-v.position)/(s.sampleRate*.01)));
            double out=sample*env*v.level*(valid?clip(gains[v.layer]):0);left+=out*v.panL;right+=out*v.panR;
            v.age++;v.position+=v.step;if(s.loopEnd>0&&v.position>=s.loopEnd)v.position=s.loopStart+s.crossfade+(v.position-s.loopEnd);
            if(v.releaseLeft>0){v.releaseLeft--;v.releaseGain=Math.max(0,v.releaseGain-v.releaseStep);if(v.releaseLeft==0){v.active=false;v.sample=null;v.table=null;active--;}}
            if(v.active&&s.loopEnd==0&&v.position>=s.pcm.length-1){v.active=false;v.sample=null;v.table=null;active--;}
        }outputL=left;outputR=right;
    }
    public void reset(){for(Voice v:voices){v.active=false;v.sample=null;v.table=null;}for(int[] c:cursors)Arrays.fill(c,0);active=0;depth=0;outputL=0;outputR=0;accepted=0;dropped=0;unmapped=0;}
}
