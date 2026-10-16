// SPDX-License-Identifier: AGPL-3.0-only
import java.util.*;
import org.sou1.audio.AmbientEngine;
import org.sou1.audio.AmbientEngine.Parameters;
public class CompositionEngineTest {
 static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
 static Parameters p(int mode,int bpm,int cap,boolean melody,boolean drums){return new Parameters(.8,.65,.5,.6,.2,.2,.6,.3,.65,.55,.35,.2,.15,.5,0,0,0,0,mode,bpm,cap,melody,drums,.65,.4,.3,.35,.2);}
 static Parameters weights(Parameters p,double a,double c,double r,double arp,double density,double complexity,double swing){
  return new Parameters(p.intensity,p.brightness,p.motion,p.timbre,p.warmth,p.strength,p.width,p.wash,
   p.pad,p.pluck,p.bell,p.texture,p.pulse,p.evolution,p.rainType,p.rain,p.thunder,p.wind,
   p.composition,p.bpm,p.polyphony,p.melodyEnabled,p.drumsEnabled,p.kick,p.snare,p.hihat,p.toms,p.cymbal,
   a,c,r,arp,density,complexity,swing);
 }
 static long[] signature(Parameters p,long seed){
  long[] x={0,1,0};new AmbientEngine.EventScore(8000,seed).advanceTo(8000*120-1,p,(at,k,n,d,v,pan)->{
   x[0]++;x[1]=x[1]*31+at;x[1]=x[1]*31+k;x[1]=x[1]*31+n;x[1]=x[1]*31+d;x[1]=x[1]*31+Double.doubleToLongBits(v);x[2]|=1<<k;
  });return x;
 }
 static void knobs(){
  Parameters base=p(3,120,32,true,false);
  Parameters clamped=weights(base,Double.NaN,-1,2,Double.POSITIVE_INFINITY,-1,2,Double.NaN);
  check(clamped.ambient==1&&clamped.counterpoint==0&&clamped.rhythmic==1&&clamped.arpeggio==0
   &&clamped.density==0&&clamped.complexity==1&&clamped.swing==0,"new knob finite bounds/defaults");
  Parameters zero=weights(base,0,0,0,0,.5,.5,0);
  check(signature(zero,91)[0]==0,"zero musical style weights emit no notes despite legacy composition");
  Parameters drumsOnly=weights(p(2,120,32,true,true),0,0,0,0,1,1,0);
  check(signature(drumsOnly,91)[2]==(31<<5),"drums remain independent of zero music weights");
  Parameters explicit=weights(base,1,0,0,0,.5,.5,0);
  check(Arrays.equals(signature(explicit,91),signature(weights(p(0,120,32,true,false),1,0,0,0,.5,.5,0),91)),"explicit weights override enum");
  check(base.arpeggio==1&&base.ambient==0,"old constructor migrates legacy mode");
  Parameters sparse=weights(base,0,1,1,1,0,.5,0),dense=weights(base,0,1,1,1,1,.5,0);
  check(signature(dense,91)[0]>signature(sparse,91)[0],"density changes musical event count");
  check(signature(weights(base,.4,.6,.3,.8,.7,0,0),91)[1]!=signature(weights(base,.4,.6,.3,.8,.7,1,0),91)[1],"complexity changes phrasing");
  check(signature(weights(base,0,1,0,0,1,.5,0),91)[1]!=signature(weights(base,0,1,0,0,1,.5,1),91)[1],"swing changes timing");
  check(signature(weights(base,.4,.6,.3,.8,.7,.8,.4),91)[1]!=signature(weights(base,0,0,0,1,.7,.8,.4),91)[1],"weighted mix differs from preset");
  AmbientEngine mixed=new AmbientEngine(8000,91);mixed.setParameters(weights(base,1,1,1,1,1,1,1));mixed.start();float[] out=new float[256];
  for(int i=0;i<8000*20/128;i++){mixed.render(out,0,128);check(mixed.getActiveVoiceCount()<=32,"mixed voices bounded");for(float v:out)check(Float.isFinite(v)&&Math.abs(v)<.85,"mixed knobs finite PCM");}
 }
 public static void main(String[] args)throws Exception{
  // CSV trace for the cross-runtime score parity test: frame,instrument,pitch,gate,velocity,pan.
  if(args.length>0 && "trace".equals(args[0])) {
   int mode=Integer.parseInt(args[1]),bpm=Integer.parseInt(args[3]);long seed=Long.parseLong(args[2]);
   Parameters d=Parameters.DEFAULT;
   Parameters q=new Parameters(d.intensity,d.brightness,d.motion,d.timbre,d.warmth,d.strength,d.width,d.wash,
    d.pad,d.pluck,d.bell,d.texture,d.pulse,d.evolution,d.rainType,d.rain,d.thunder,d.wind,
    mode,bpm,16,true,true,d.kick,d.snare,d.hihat,d.toms,d.cymbal);
   if(args.length>=11)q=weights(q,Double.parseDouble(args[4]),Double.parseDouble(args[5]),Double.parseDouble(args[6]),Double.parseDouble(args[7]),Double.parseDouble(args[8]),Double.parseDouble(args[9]),Double.parseDouble(args[10]));
   new AmbientEngine.EventScore(8000,seed).advanceTo(8000*120-1,q,
    (at,k,pitch,gate,velocity,pan)->System.out.println(at+","+k+","+pitch+","+gate+","+velocity+","+pan));
   return;
  }
  knobs();
  AmbientEngine.EventScore s=new AmbientEngine.EventScore(8000,91);s.advanceTo(8000L*10800-1,Parameters.DEFAULT,(a,b,c,d,e,f)->{});check(s.chordChanges==2,"long form slow endpoint");
  for(int mode=0;mode<4;mode++){
   long[] a={0,1,0},b={0,1,0};AmbientEngine.NoteSink sink=(f,k,n,d,v,pan)->{a[0]++;a[1]=a[1]*31+f;a[1]=a[1]*31+k;a[1]=a[1]*31+n;a[1]=a[1]*31+d;a[2]|=1<<k;};
   AmbientEngine.NoteSink other=(f,k,n,d,v,pan)->{b[0]++;b[1]=b[1]*31+f;b[1]=b[1]*31+k;b[1]=b[1]*31+n;b[1]=b[1]*31+d;b[2]|=1<<k;};
   Parameters params=p(mode,137,16,true,true);s=new AmbientEngine.EventScore(8000,91);s.advanceTo(8000*120-1,params,sink);AmbientEngine.EventScore t=new AmbientEngine.EventScore(8000,91);for(int at=0;at<8000*120;at+=117)t.advanceTo(at,params,other);t.advanceTo(8000*120-1,params,other);check(Arrays.equals(a,b),"score chunk parity");check(a[2]==1023,"all layers and drums");
   for(int cap:new int[]{8,16,24,32}){
    AmbientEngine e=new AmbientEngine(8000,91);e.setParameters(p(mode,180,cap,true,true));e.start();float[] out=new float[256];double peak=0,delta=0,last=0;
    for(int i=0;i<8000*20/128;i++){e.render(out,0,128);check(e.getActiveVoiceCount()<=cap,"melodic cap");check(e.getActiveDrumVoiceCount()<=12,"drum cap");for(int j=0;j<out.length;j+=2){double v=out[j];check(Float.isFinite(out[j])&&Math.abs(v)<.85,"finite safe PCM");peak=Math.max(peak,Math.abs(v));delta=Math.max(delta,Math.abs(v-last));last=v;}}
    check(peak>.005,"audible");check(delta<.15,"bounded delta");Parameters saved=e.getParameters();e.reseed(123);for(int i=0;i<20;i++)e.render(out,0,128);check(e.getScore().seed==123&&e.getParameters()==saved&&e.isPlayingRequested(),"live reseed");
    e.setParameters(p(mode,120,8,false,false));for(int i=0;i<20;i++)e.render(out,0,128);check(e.getActiveVoiceCount()<=8&&e.getActiveDrumVoiceCount()==0,"downshift/mute");
    java.lang.reflect.Field vf=AmbientEngine.class.getDeclaredField("voices");vf.setAccessible(true);for(Object voice:(Object[])vf.get(e)){java.lang.reflect.Field af=voice.getClass().getDeclaredField("active"),ki=voice.getClass().getDeclaredField("instrument");af.setAccessible(true);ki.setAccessible(true);check(!af.getBoolean(voice)||(ki.getInt(voice)!=1&&ki.getInt(voice)!=2),"melody tails cleared");}
    e.stop();for(int i=0;i<130;i++)e.render(out,0,128);check(e.isSilent(),"stopped");e.reseed(999);e.render(out,0,128);check(e.getScore().seed==999&&e.isSilent(),"silent reseed");for(float v:out)check(v==0,"silent PCM");e.start();e.render(out,0,128);check(e.isPlayingRequested(),"resume after reseed");
    System.out.printf("mode%d cap%d peak%.4f delta%.4f%n",mode,cap,peak,delta);
   }
  }
  System.out.println("PASS native composition, all instrument groups, score block independence, 3-hour endpoint, caps, mute, transport/reseed");
 }
}
