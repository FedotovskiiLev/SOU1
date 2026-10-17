// SPDX-License-Identifier: AGPL-3.0-only
import javax.sound.midi.*;
import java.io.File;
public final class MidiExportReadTest {
 public static void main(String[] args) throws Exception {
  Sequence s=MidiSystem.getSequence(new File(args[0]));
  if(s.getResolution()!=960||s.getDivisionType()!=Sequence.PPQ||s.getTracks().length!=11)throw new AssertionError("Header");
  int ons=0,offs=0,names=0,tempos=0;
  for(Track t:s.getTracks())for(int i=0;i<t.size();i++){
   MidiMessage m=t.get(i).getMessage();
   if(m instanceof ShortMessage){ShortMessage n=(ShortMessage)m;if(n.getCommand()==ShortMessage.NOTE_ON&&n.getData2()>0)ons++;if(n.getCommand()==ShortMessage.NOTE_OFF)offs++;}
   if(m instanceof MetaMessage){int type=((MetaMessage)m).getType();if(type==3)names++;if(type==81)tempos++;}
  }
  if(ons!=10||offs!=10||names!=11||tempos!=1)throw new AssertionError("Events "+ons+"/"+offs+"/"+names+"/"+tempos);
  System.out.println("PASS independent Java MIDI reader: 11 tracks, 10 notes/off pairs, 960 PPQ, tempo metadata");
 }
}
