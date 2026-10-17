// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {NoteHistory,drawPianoRoll,createPianoRoll,NOTE_COLORS,scoreBounds,ROW,PX_SECOND} from '../docs/note-history.js';
import {drawAsciiGrid} from '../docs/ascii-grid.js';
const h=new NoteHistory(3);for(let i=0;i<5;i++)h.add(i,0,60,12,.5);
assert.deepEqual(h.snapshot(5,48000).events.map(e=>e[0]),[2,3,4]);
const copy=h.snapshot(5,48000);copy.events[0][0]=99;assert.equal(h.snapshot(5,48000).events[0][0],2);h.clear();assert.equal(h.snapshot(0,48000).events.length,0);
const glyphs=[],rects=[];const context={clearRect(){},fillRect(...a){rects.push({a,color:this.fillStyle})},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(...a){glyphs.push(a)}};
const canvas={style:{},width:600,height:600,getContext:()=>context};
drawAsciiGrid(canvas,Array(34).fill('*'.repeat(100)).join('\n'),100,34,'white');assert.equal(glyphs.length,3400);for(const [,x,y,maxWidth] of glyphs){assert(x>0&&x<600&&y>0&&y<600);assert.equal(maxWidth,6);}
const score={seed:7,frame:60*48000,rate:48000,events:NOTE_COLORS.map((_,i)=>[59*48000,i,60,5*48000,.8])};
for(let instrument=0;instrument<10;instrument++){
 rects.length=0;drawPianoRoll(canvas,score,{seconds:58,scrollY:(127-66)*ROW,visible:new Set([instrument])});
 const notes=rects.filter(r=>NOTE_COLORS.includes(r.color));assert.equal(notes.length,1);assert.equal(notes[0].color,NOTE_COLORS[instrument]);assert(notes[0].a[0]+notes[0].a[2]<=600);
}
for(const pitch of [0,127]){rects.length=0;drawPianoRoll(canvas,{frame:100,rate:100,events:[[0,0,pitch,100,.7]]},{seconds:0,scrollY:Math.max(0,(127-pitch)*ROW-100)});assert(rects.some(r=>r.color===NOTE_COLORS[0]));}
rects.length=0;drawPianoRoll(canvas,score,{seconds:1000});assert(!rects.some(r=>NOTE_COLORS.includes(r.color)));
globalThis.devicePixelRatio=3;canvas.clientWidth=0;for(let i=0;i<10;i++)drawPianoRoll(canvas,score);assert.equal(canvas.width,1200);assert.equal(canvas.height,680);delete globalThis.devicePixelRatio;
const el=()=>({style:{setProperty(){}},dataset:{},listeners:{},attrs:{},addEventListener(k,f){this.listeners[k]=f},setAttribute(k,v){this.attrs[k]=v}});
const viewport={...el(),clientWidth:600,clientHeight:340,scrollLeft:0,scrollTop:0},spacer=el(),follow=el(),filters=NOTE_COLORS.map((_,i)=>({...el(),dataset:{instrument:String(i)}}));
const viewer=createPianoRoll({viewport,canvas,spacer,followButton:follow,filters});
viewer.update({...score,events:[[0,0,60,48000,.8]]});viewport.listeners.scroll();assert.equal(follow.attrs['aria-pressed'],'true');
viewport.scrollTop=400;viewport.listeners.scroll();assert.equal(follow.attrs['aria-pressed'],'true');viewer.update({...score,frame:61*48000,events:[[0,0,60,48000,.8]]});assert.equal(viewport.scrollTop,400);
viewport.scrollLeft=10*PX_SECOND;viewport.listeners.scroll();assert.equal(follow.attrs['aria-pressed'],'false');
viewer.update({...score,frame:62*48000,events:[[5*48000,0,60,48000,.8]]});assert.equal(viewport.scrollLeft,5*PX_SECOND);assert.equal(follow.attrs['aria-pressed'],'false');
follow.listeners.click();viewport.listeners.scroll();assert.equal(follow.attrs['aria-pressed'],'true');
filters[0].listeners.click();assert.equal(filters[0].attrs['aria-pressed'],'false');filters[0].listeners.click();assert.equal(filters[0].attrs['aria-pressed'],'true');
viewer.update({seed:8,frame:0,rate:48000,events:[]});assert.equal(viewport.scrollLeft,0);assert.equal(viewport.scrollTop,(127-84)*ROW);assert.equal(follow.attrs['aria-pressed'],'true');
viewport.clientWidth=0;viewer.refresh();viewport.clientWidth=393;viewer.refresh();assert.equal(canvas.width,393);assert.equal(canvas.height,340);
assert(scoreBounds(score).end>=64);
console.log('PASS bounded history; 10 instrument colors and isolation; pitch0/127; clipping; bounded DPR; horizontal/vertical pan; follow; trimmed-domain anchoring; seed reset; hidden/mobile redraw');

viewport.scrollLeft=100;viewport.scrollTop=100;viewport.listeners.scroll();viewer.update({seed:9,frame:0,rate:48000,events:[]});assert.equal(viewport.scrollLeft,0);assert.equal(viewport.scrollTop,(127-84)*ROW);assert.equal(follow.attrs['aria-pressed'],'true');console.log('PASS empty-to-empty seed reset');
