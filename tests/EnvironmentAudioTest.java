// SPDX-License-Identifier: AGPL-3.0-only
import org.sou1.audio.EnvironmentAudio;
public final class EnvironmentAudioTest {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    public static void main(String[] args) {
        EnvironmentAudio a = new EnvironmentAudio(8000, 7), b = new EnvironmentAudio(8000, 7);
        a.start(); for(int i=0;i<8000;i++){a.next();check(a.outputL==0,"silent defaults");}
        a.setParameters(0,1,0,0);for(int i=0;i<8000;i++){a.next();check(a.outputL==0,"off rain");}
        a.setParameters(3,1,1,1); b.setParameters(3,1,1,1);a.reset();a.start();b.start();
        for(int i=0;i<8000*60;i++){a.next();b.next();check(a.outputL==b.outputL&&a.outputR==b.outputR,"deterministic");check(Double.isFinite(a.outputL)&&Math.abs(a.outputL)<.45,"headroom");}
        a.stop();for(int i=0;i<24000;i++)a.next();check(a.isSilent()&&a.outputL==0,"smooth stop");
        a.reset();check(a.outputL==0,"reset");a.next();check(a.outputL==0,"reset stopped");
        a.setParameters(99,-1,Double.NaN,Double.POSITIVE_INFINITY);check(a.getParameters().rainType==3&&a.getParameters().rain==0&&a.getParameters().wind==1,"clamped controls");
        a=new EnvironmentAudio(8000,7);a.setParameters(0,0,1,0);a.start();double energy=0,peak=0;
        for(int i=0;i<8000*60;i++){a.next();energy+=a.outputL*a.outputL;peak=Math.max(peak,Math.abs(a.outputL));}check(energy>1&&peak<.3,"thunder without rain");
        double previous=0;
        for(int type=1;type<=3;type++){a=new EnvironmentAudio(8000,7);a.setParameters(type,1,0,0);a.start();energy=0;for(int i=0;i<8000;i++){a.next();energy+=a.outputL*a.outputL;}check(energy>previous,"rain variants");previous=energy;}
        for(int rate:new int[]{8000,44100,48000,96000,192000}){a=new EnvironmentAudio(rate,0);a.setParameters(0,0,0,1);a.start();energy=0;for(int i=0;i<rate*2;i++){a.next();check(Double.isFinite(a.outputL)&&Math.abs(a.outputL)<.45,"rate finite");energy+=a.outputL*a.outputL;}check(energy>0,"wind alone");a.setParameters(0,0,0,0);for(int i=0;i<rate*3;i++)a.next();check(a.outputL==0,"zero endpoint");}
        a=new EnvironmentAudio(8000,7);b=new EnvironmentAudio(8000,7);a.setParameters(2,1,0,1);b.setParameters(2,1,0,1);a.start();b.start();float[] l=new float[100],r=new float[100];a.render(l,r);for(int i=0;i<100;i++){b.next();check(l[i]==(float)b.outputL&&r[i]==(float)b.outputR,"block API");}
        try{new EnvironmentAudio(7999);throw new AssertionError("invalid rate accepted");}catch(IllegalArgumentException expected){}
        System.out.println("EnvironmentAudio JVM: determinism, blocks, reset, thunder alone, rain variants, rates, endpoints and headroom passed");
    }
}
