// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;
/** Prepared bundled recordings; single render owner, no render allocations or I/O. */
public final class RecordedWeather {
 public static final class Bank {
  final int rate;final float[][] samples;
  /** Background-only ownership copy/validation. */
  public Bank(int rate,float[][] input){if(rate<8000||rate>192000||input==null||input.length!=3)throw new IllegalArgumentException("Weather bank");this.rate=rate;samples=new float[3][];for(int i=0;i<3;i++){if(input[i]==null||input[i].length<rate||input[i].length>rate*17)throw new IllegalArgumentException("Weather size");samples[i]=input[i].clone();for(float v:samples[i])if(!Float.isFinite(v)||Math.abs(v)>1)throw new IllegalArgumentException("Weather PCM");}}
 }
 private final Bank bank;private final int rate,rainOffset,windOffset;private final double smoothing,rainPole;private long seed,randomState;private boolean playing;private EnvironmentAudio.Parameters parameters=new EnvironmentAudio.Parameters(0,0,0,0);
 private double rain,wind,thunder,rainL,rainR;private int rainAt,windAt,thunderAt,countdown;private long thunderEvents;public double outputL,outputR;
 public RecordedWeather(int rate,long seed,Bank bank){if(bank==null||bank.rate!=rate)throw new IllegalArgumentException("Weather rate");this.rate=rate;this.seed=seed&0xffffffffL;this.bank=bank;smoothing=1-StrictMath.exp(-1/(rate*.12));rainPole=1-StrictMath.exp(-2*StrictMath.PI*Math.min(3500,rate*.4)/rate);rainOffset=(int)Math.round(rate*.031);windOffset=(int)Math.round(rate*.047);reset();}
 public void setParameters(EnvironmentAudio.Parameters p){parameters=p;}public void start(){playing=true;}public void stop(){playing=false;}public boolean isSilent(){return rain==0&&wind==0&&thunder==0;}public long getThunderEvents(){return thunderEvents;}
 private static double smooth(double v,double t,double c){return Math.abs(v-t)<1e-7?t:v+c*(t-v);}private double random(){randomState=(randomState*1664525+1013904223)&0xffffffffL;return randomState/4294967296.0;}
 public void reset(){playing=false;randomState=(seed^0x02e5be93)&0xffffffffL;rain=wind=thunder=0;rainAt=(int)StrictMath.floor(random()*bank.samples[0].length);windAt=(int)StrictMath.floor(random()*bank.samples[1].length);thunderAt=-1;countdown=(int)Math.round(rate*(6+6*random()));thunderEvents=0;rainL=rainR=outputL=outputR=0;}
 public void reseed(long value){seed=value&0xffffffffL;reset();}
 public void next(){EnvironmentAudio.Parameters p=parameters;double c=smoothing;boolean on=playing;int type=p.rainType==0?1:p.rainType;rain=smooth(rain,on&&p.rainType>0?p.rain*(type==1?.18:type==2?.29:.40):0,c);wind=smooth(wind,on?p.wind:0,c);thunder=smooth(thunder,on?p.thunder:0,c);if(!on&&isSilent()){outputL=outputR=0;thunderAt=-1;return;}float[] r=bank.samples[0],w=bank.samples[1],t=bank.samples[2];rainL+=rainPole*(r[rainAt]-rainL);rainR+=rainPole*(r[(rainAt+rainOffset)%r.length]-rainR);double rainGain=rain,windGain=wind*.35;double left=rainL*rainGain+w[windAt]*windGain,right=rainR*rainGain+w[(windAt+windOffset)%w.length]*windGain;rainAt=(rainAt+1)%r.length;windAt=(windAt+1)%w.length;if(on&&p.thunder>0&&thunderAt<0&&--countdown<=0){thunderAt=0;thunderEvents++;countdown=(int)Math.round(rate*(25+35*random())/(.35+.65*p.thunder));}if(thunderAt>=0){double x=t[thunderAt++]*thunder*.45;left+=x;right+=x;if(thunderAt>=t.length)thunderAt=-1;}outputL=left;outputR=right;}
}
