// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeDrumSession,nativeDrumCapabilities,nativeDevelopmentCapabilities} from '../docs/native-drum-session.js';
const kits=['procedural','vcsl','guigui-dynamic'];
function fixture(){let now=1000,status={requestId:0,drumKit:'procedural',preparing:false,playing:false};const requests=[];let stops=0;const bridge={play:s=>{requests.push(JSON.parse(s));return true;},stop:()=>stops++,status:()=>JSON.stringify(status)};const session=new NativeDrumSession(bridge,kits,{now:()=>now,timeoutMs:100});return{session,bridge,requests,get stops(){return stops;},setStatus:v=>status=v,time:v=>now=v,ready:(extra={})=>{status={requestId:session.requestId,drumKit:'guigui-dynamic',preparing:false,playing:true,...extra};}};}
test('capabilities require explicit version and complete unique closed kit set',()=>{
 assert.equal(nativeDrumCapabilities({},kits),false);
 for(const c of [null,{}, {schema:'sou1.native-audio.v2',drumKits:kits},{schema:'sou1.native-audio.v1',drumKits:['procedural','vcsl','vcsl']},{schema:'sou1.native-audio.v1',drumKits:[...kits,'remote']}])assert.equal(nativeDrumCapabilities({audioCapabilities:()=>JSON.stringify(c)},kits),false);
 assert.equal(nativeDrumCapabilities({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',drumKits:[...kits].reverse()})},kits),true);
});
test('start waits for exact request acknowledgement and cannot duplicate preparation',()=>{
 const h=fixture(),p={seed:7311,drumKit:'guigui-dynamic'};assert.equal(h.session.start(p),true);assert.equal(h.session.start(p),false);assert.equal(h.requests.length,1);assert.equal(h.session.poll().phase,'preparing');assert.deepEqual(p,{seed:7311,drumKit:'guigui-dynamic'});
 h.setStatus({requestId:1,drumKit:'guigui-dynamic',preparing:false,playing:true});assert.equal(h.session.poll().phase,'preparing');
 h.ready({preparing:true,playing:false});assert.equal(h.session.poll().phase,'preparing');h.ready();assert.equal(h.session.poll().phase,'playing');
});
test('cancel and late ready cannot revive stopped session; retry has new identity',()=>{
 const h=fixture();h.session.start({drumKit:'guigui-dynamic'});const old=h.session.requestId;h.session.cancel();h.setStatus({requestId:old,drumKit:'guigui-dynamic',preparing:false,playing:true});assert.equal(h.session.restore().phase,'idle');assert.equal(h.stops,1);
 h.session.start({drumKit:'guigui-dynamic'});assert.ok(h.session.requestId>old);assert.equal(h.session.poll().phase,'preparing');h.ready();assert.equal(h.session.poll().phase,'playing');
});
test('timeout and unreadable or mismatched status send one STOP rather than pretend playback',()=>{
 const h=fixture();h.session.start({drumKit:'vcsl'});h.bridge.status=()=>{throw Error('bridge unavailable')};assert.equal(h.session.poll().phase,'preparing');h.time(1100);assert.equal(h.session.poll().phase,'error');assert.match(h.session.error,/timed out/);assert.equal(h.stops,1);h.session.poll();assert.equal(h.stops,1);
});
test('native preparation failure remains explicit and retry is permitted',()=>{
 const h=fixture();h.session.start({drumKit:'vcsl'});h.ready({drumKit:'vcsl',playing:false,audioError:'Checksum mismatch'});assert.equal(h.session.poll().phase,'error');assert.equal(h.session.error,'Checksum mismatch');assert.equal(h.session.start({drumKit:'procedural'}),true);
});
test('restored background preparation/playback remains attached to original request',()=>{
 const h=fixture();h.setStatus({requestId:444,drumKit:'vcsl',preparing:true,playing:false});assert.equal(h.session.restore().phase,'preparing');assert.equal(h.session.requestId,444);h.ready({drumKit:'vcsl'});assert.equal(h.session.poll().phase,'playing');h.ready({drumKit:'vcsl',playing:false});assert.equal(h.session.poll().phase,'idle');
});
test('rejected bridge request and unknown kit cannot create fake playback',()=>{
 const h=fixture();assert.throws(()=>h.session.start({drumKit:'../remote'}),/Unknown/);assert.equal(h.requests.length,0);h.bridge.play=()=>false;assert.throws(()=>h.session.start({drumKit:'vcsl'}),/rejected/);assert.equal(h.session.phase,'error');assert.equal(h.session.requestId,null);
});

test('background completion wins over UI deadline; retired identities never revive',()=>{
 const h=fixture();h.session.start({drumKit:'guigui-dynamic'});h.ready();h.time(1200);assert.equal(h.session.restore().phase,'playing');assert.equal(h.stops,0);
 const a=h.session.requestId;h.session.cancel();h.session.start({drumKit:'guigui-dynamic'});const b=h.session.requestId;h.session.cancel();
 for(const requestId of [a,b,a,b]){h.setStatus({requestId,drumKit:'guigui-dynamic',preparing:false,playing:false});h.session.restore();h.setStatus({requestId,drumKit:'guigui-dynamic',preparing:false,playing:true});assert.equal(h.session.restore().phase,'idle');}
});
test('matching request cannot silently substitute a different known bank',()=>{
 const h=fixture();h.session.start({drumKit:'vcsl'});h.ready({drumKit:'procedural'});assert.equal(h.session.poll().phase,'error');assert.match(h.session.error,/selection mismatch/);assert.equal(h.stops,1);
});

test('regressive preparing snapshots cannot replace confirmed playing data',()=>{
 const h=fixture();h.session.start({drumKit:'guigui-dynamic'});h.ready();h.session.poll();const data=h.session.data;
 h.ready({preparing:true,playing:false});assert.equal(h.session.restore().phase,'playing');assert.equal(h.session.data,data);assert.equal(h.session.data.playing,true);
});
test('throwing STOP retains acknowledgement identity and actual state until resolved',()=>{
 const h=fixture();h.session.start({drumKit:'guigui-dynamic'});h.ready();h.session.poll();const id=h.session.requestId;
 h.bridge.stop=()=>{throw Error('service unavailable')};assert.throws(()=>h.session.cancel());assert.equal(h.session.stopFailed,true);assert.equal(h.session.requestId,id);assert.equal(h.session.poll().phase,'error');assert.equal(h.session.uncertainPhase,'playing');assert.equal(h.session.start({drumKit:'vcsl'}),false);
 h.ready({playing:false});assert.equal(h.session.poll().phase,'idle');assert.equal(h.session.requestId,null);assert.equal(h.session.stopFailed,false);
});
test('timed out preparation with throwing STOP remains cancellable and observable',()=>{
 const h=fixture();h.session.start({drumKit:'vcsl'});const id=h.session.requestId;h.bridge.stop=()=>{throw Error('service unavailable')};h.time(1200);
 assert.equal(h.session.poll().phase,'error');assert.equal(h.session.stopFailed,true);assert.equal(h.session.uncertainPhase,'preparing');assert.equal(h.session.requestId,id);
 h.bridge.stop=()=>{};h.session.cancel();assert.equal(h.session.phase,'idle');assert.equal(h.session.requestId,null);
});


test('development selection requires explicit capability and matching native acknowledgement',()=>{
 assert.equal(nativeDevelopmentCapabilities({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',scoreModes:['original','developing']})}),true);
 for(const scoreModes of [undefined,[],['original'],['original','developing','other'],['developing','developing']])assert.equal(nativeDevelopmentCapabilities({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',scoreModes})}),false);
 const f=fixture();assert.throws(()=>f.session.start({drumKit:'guigui-dynamic',scoreMode:'other'}));assert.equal(f.requests.length,0);
 f.session.start({drumKit:'guigui-dynamic',scoreMode:'developing'});f.ready({scoreMode:'developing'});assert.equal(f.session.poll().phase,'playing');assert.equal(f.requests[0].scoreMode,'developing');
 const mismatch=fixture();mismatch.session.start({drumKit:'guigui-dynamic',scoreMode:'developing'});mismatch.ready();assert.equal(mismatch.session.poll().phase,'error');assert.equal(mismatch.stops,1);assert.match(mismatch.session.error,/selection mismatch/);
 const restored=fixture();restored.setStatus({requestId:123,drumKit:'vcsl',scoreMode:'developing',preparing:false,playing:true});assert.equal(restored.session.restore().phase,'playing');assert.equal(restored.session.expectedScoreMode,'developing');
});
