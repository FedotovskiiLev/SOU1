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
export const NOTE_COLORS=['#a6d6ff','#ffc482','#d3afff','#a5d7ab','#ff9eae','#e4ce88','#d99776','#9bd9d5','#baa5df','#ddd5c9'];
export const ROW=18, TOP=24, LEFT=44, PX_SECOND=32;
export function scoreBounds(score) {
  const rate=score.rate||48000,now=score.frame/rate;
  const start=score.events.length?Math.max(0,Math.floor(Math.min(...score.events.map(e=>e[0]/rate)))):0;
  const end=Math.max(start+60,now+5,...score.events.map(e=>(e[0]+e[3])/rate));
  return {start,end,now};
}
// Draw only the visible viewport. A large scroll range never allocates a large bitmap.
export function drawPianoRoll(canvas, snapshot, view={}) {
  const w=view.width||canvas.clientWidth||600,h=view.height||340;
  const c=canvas.getContext('2d'),ratio=Math.min(2,globalThis.devicePixelRatio||1);
  if(canvas.width!==Math.round(w*ratio))canvas.width=Math.round(w*ratio);
  if(canvas.height!==Math.round(h*ratio))canvas.height=Math.round(h*ratio);
  if(canvas.style){canvas.style.width=w+'px';canvas.style.height=h+'px';}
  c.setTransform?.(ratio,0,0,ratio,0,0);
  c.clearRect(0,0,w,h);c.fillStyle='#080808';c.fillRect(0,0,w,h);
  const {start}=scoreBounds(snapshot),seconds=view.seconds??start,scrollY=view.scrollY??(127-84)*ROW;
  const rate=snapshot.rate||48000,visible=view.visible||new Set(NOTE_COLORS.map((_,i)=>i));
  c.font='10px monospace';c.textBaseline='top';
  for(let pitch=0;pitch<128;pitch++){
    const y=TOP+(127-pitch)*ROW-scrollY;if(y<TOP||y>=h)continue;
    c.strokeStyle=pitch%12===0?'#444':'#202020';c.beginPath();c.moveTo(LEFT,y);c.lineTo(w,y);c.stroke();
  }
  for(const [frame,instrument,pitch,duration,velocity] of snapshot.events||[]){
    if(!visible.has(instrument)||pitch<0||pitch>127)continue;
    const y=TOP+(127-pitch)*ROW-scrollY+2;if(y<TOP||y>=h)continue;
    const a=Math.max(LEFT,LEFT+(frame/rate-seconds)*PX_SECOND),b=Math.min(w,LEFT+((frame+duration)/rate-seconds)*PX_SECOND);
    if(b<=a)continue;
    c.fillStyle=NOTE_COLORS[instrument]||'#fff';c.globalAlpha=.55+.45*velocity;
    c.fillRect(a,y+(instrument%3)*2,b-a,Math.min(10,h-y));c.globalAlpha=1;
  }
  const cursor=LEFT+(snapshot.frame/rate-seconds)*PX_SECOND;
  if(cursor>=LEFT&&cursor<w){c.fillStyle='#fff';c.fillRect(cursor,TOP,1,h-TOP);}
  c.fillStyle='#111';c.fillRect(0,0,LEFT,h);c.fillRect(0,0,w,TOP);
  c.fillStyle='#aaa';
  for(let pitch=0;pitch<128;pitch++){
    const y=TOP+(127-pitch)*ROW-scrollY;if(y<TOP||y>=h)continue;
    const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
    c.fillText(names[pitch%12]+(Math.floor(pitch/12)-1),3,y+2);
  }
  for(let sec=Math.ceil(seconds/5)*5;sec<seconds+(w-LEFT)/PX_SECOND;sec+=5){
    const x=LEFT+(sec-seconds)*PX_SECOND;c.fillText(Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'),x,5);
  }
}
export function createPianoRoll({viewport,canvas,spacer,followButton,filters}) {
  let score={frame:0,rate:48000,events:[]},following=true,origin=0,initialized=false,expectedX=null;
  const visible=new Set(NOTE_COLORS.map((_,i)=>i));
  const followState=()=>followButton.setAttribute('aria-pressed',String(following));
  function draw(){
    if(!viewport.clientWidth)return;
    drawPianoRoll(canvas,score,{width:viewport.clientWidth,height:viewport.clientHeight,seconds:origin+viewport.scrollLeft/PX_SECOND,scrollY:viewport.scrollTop,visible});
  }
  function update(next){
    const reset=next.frame<score.frame||(next.frame===0&&!next.events.length&&score.events.length>0)||(next.seed!==undefined&&score.seed!==undefined&&next.seed!==score.seed);
    const oldSeconds=origin+viewport.scrollLeft/PX_SECOND;score=next;
    const bounds=scoreBounds(score);origin=bounds.start;
    spacer.style.width=Math.ceil(Math.max(viewport.clientWidth,LEFT+(bounds.end-origin)*PX_SECOND))+'px';
    spacer.style.height=(TOP+128*ROW)+'px';
    if(reset){following=true;initialized=false;}
    if(viewport.clientWidth){
      if(!initialized){viewport.scrollTop=(127-84)*ROW;initialized=true;}
      const x=following?Math.max(0,(bounds.now-origin)*PX_SECOND-(viewport.clientWidth-LEFT)*.75):Math.max(0,(oldSeconds-origin)*PX_SECOND);
      viewport.scrollLeft=x;expectedX=viewport.scrollLeft;
    }
    followState();draw();
  }
  viewport.addEventListener('scroll',()=>{
    if(expectedX===null||Math.abs(viewport.scrollLeft-expectedX)>.5){following=false;followState();}
    expectedX=viewport.scrollLeft;draw();
  });
  followButton.addEventListener('click',()=>{following=true;update(score);});
  for(const button of filters){
    const instrument=Number(button.dataset.instrument);button.style.setProperty('--note-color',NOTE_COLORS[instrument]);
    button.addEventListener('click',()=>{if(visible.has(instrument))visible.delete(instrument);else visible.add(instrument);button.setAttribute('aria-pressed',String(visible.has(instrument)));draw();});
  }
  return {update,refresh:()=>update(score)};
}
