// SPDX-License-Identifier: AGPL-3.0-only
export class NoteHistory {
  constructor(capacity = 512) { this.capacity = capacity; this.clear(); }
  clear() { this.events = []; }
  add(frame, instrument, pitch, duration, velocity) {
    this.events.push([frame, instrument, pitch, duration, velocity]);
    if (this.events.length > this.capacity) this.events.shift();
  }
  snapshot(frame, rate) { return {frame, rate, events:this.events.map(e=>e.slice())}; }
}
export function drawPianoRoll(canvas, snapshot) {
  const c=canvas.getContext('2d'),w=canvas.clientWidth||600,h=340;
  const ratio=globalThis.devicePixelRatio||1;
  if(canvas.width!==Math.round(w*ratio))canvas.width=Math.round(w*ratio);
  if(canvas.height!==Math.round(h*ratio))canvas.height=Math.round(h*ratio);
  c.setTransform?.(ratio,0,0,ratio,0,0);
  c.clearRect(0,0,w,h);c.fillStyle='#080808';c.fillRect(0,0,w,h);
  const rate=snapshot.rate||48000, end=Math.max(30,snapshot.frame/rate), start=end-30;
  const low=24,high=108,dy=h/(high-low+1);
  c.font='10px monospace';c.textBaseline='top';
  for(let pitch=low;pitch<=high;pitch++){
    const y=(high-pitch)*dy;c.strokeStyle=pitch%12===0?'#444':'#181818';
    c.beginPath();c.moveTo(32,y);c.lineTo(w,y);c.stroke();
    if(pitch%12===0){c.fillStyle='#aaa';c.fillText('C'+(Math.floor(pitch/12)-1),1,y);}
  }
  for(const [frame,instrument,pitch,duration,velocity] of snapshot.events||[]){
    if(pitch<low||pitch>high)continue;
    const a=Math.max(start,frame/rate),b=Math.min(end,(frame+duration)/rate);
    if(b<=a)continue;
    c.fillStyle=`rgba(255,255,255,${.35+.65*velocity})`;
    c.fillRect(32+(a-start)/30*(w-32),(high-pitch)*dy+1,Math.max(1,(b-a)/30*(w-32)),Math.max(1,dy-1));
  }
}
