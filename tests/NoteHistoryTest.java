// SPDX-License-Identifier: AGPL-3.0-only
import org.sou1.audio.AmbientEngine;
public class NoteHistoryTest {
 public static void main(String[] args){
  AmbientEngine e=new AmbientEngine(8000,7);float[] data=new float[512];e.start();
  for(int i=0;i<8000*5/256;i++)e.render(data,0,256);
  String a=e.getScoreSnapshot();if(!a.contains("\"seed\":7,")||a.contains("\"events\":[]"))throw new AssertionError(a);
  e.reset();if(!e.getScoreSnapshot().contains("\"events\":[]"))throw new AssertionError("reset");
  e.reseed(9);if(!e.getScoreSnapshot().contains("\"seed\":9,"))throw new AssertionError("reseed");
  System.out.println("PASS native generated-note snapshot, transport reset and reseed identity");
 }
}
