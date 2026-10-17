// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {NoteHistory,drawPianoRoll} from '../docs/note-history.js';
import {drawAsciiGrid} from '../docs/ascii-grid.js';
const h=new NoteHistory(3);for(let i=0;i<5;i++)h.add(i,0,60,12,.5);
assert.deepEqual(h.snapshot(5,48000).events.map(e=>e[0]),[2,3,4]);
const copy=h.snapshot(5,48000);copy.events[0][0]=99;assert.equal(h.snapshot(5,48000).events[0][0],2);
h.clear();assert.equal(h.snapshot(0,48000).events.length,0);
const glyphs=[],rects=[];const context={clearRect(){},fillRect(...a){rects.push(a)},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(...a){glyphs.push(a)}};
const canvas={width:600,height:600,getContext:()=>context};
drawAsciiGrid(canvas,Array(34).fill('*'.repeat(100)).join('\n'),100,34,'white');
assert.equal(glyphs.length,3400);
for(const [,x,y,maxWidth] of glyphs){assert(x>0&&x<600&&y>0&&y<600);assert.equal(maxWidth,6);}
assert.equal(glyphs[0][1]+glyphs[99][1],600);
assert(Math.abs(glyphs[0][2]+glyphs.at(-1)[2]-600)<1e-9);
drawPianoRoll(canvas,{frame:48000*60,rate:48000,events:[[48000*59,0,60,48000*5,.8],[0,0,60,10,.5]]});
assert.equal(rects.length,2);assert(rects[1][0]+rects[1][2]<=600.00001);
console.log('PASS: bounded detached note history, reset, fixed glyph placement, piano-roll time clipping');

globalThis.devicePixelRatio=3;canvas.clientWidth=0;for(let i=0;i<10;i++)drawPianoRoll(canvas,{frame:0,rate:48000,events:[]});assert.equal(canvas.width,1800);delete globalThis.devicePixelRatio;
console.log('PASS hidden high-DPR redraw remains bounded');
