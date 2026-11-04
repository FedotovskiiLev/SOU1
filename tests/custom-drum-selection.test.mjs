// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {CUSTOM_DRUM_ROLES,CUSTOM_DRUM_KITS,deterministicRandomDrumOverrides as random,customDrumSelectionKey,parseCustomDrumSelection} from '../docs/custom-drum-selection.js';
test('independent role randomization has fixed uint32 seed vectors',()=>{
 const vectors=[
  [0,['vcsl','fsa-distkit','fsa-synthkit','fsa-synthkit','fsa-sdbkit']],
  [1,['fsa-distkit','fsa-distkit','fsa-distkit','fsa-distkit','fsa-synthkit']],
  [7311,['guigui-dynamic','fsa-x0xproc1','vcsl','guigui-soft','fsa-x0xproc1']],
  [4294967295,['fsa-x0xproc2','vcsl','guigui-soft','vcsl','guigui-dynamic']],
 ];
 for(const [seed,expected] of vectors){const result=random(seed,'vcsl');assert.deepEqual(Object.values(result),expected);assert.ok(Object.isFrozen(result));assert.deepEqual(Object.keys(result),CUSTOM_DRUM_ROLES);assert.deepEqual(random(seed,'guigui-soft'),result);}
});
test('all lock combinations preserve raw values and do not reroll unlocked roles',()=>{
 const seed=7311,base='vcsl',input={kick:'vcsl',snare:'inherit',hihat:'guigui-soft',cymbal:'fsa-distkit'},before=structuredClone(input),draw=random(seed,base);
 for(let mask=0;mask<32;mask++){
  const locks=Object.fromEntries([...CUSTOM_DRUM_ROLES].reverse().map(role=>[role,Boolean(mask&(1<<CUSTOM_DRUM_ROLES.indexOf(role)))])),saved=structuredClone(locks),actual=random(seed,base,input,locks);
  for(let i=0;i<5;i++){const role=CUSTOM_DRUM_ROLES[i];assert.equal(actual[role],mask&(1<<i)?input[role]??'inherit':draw[role]);}
  assert.deepEqual(input,before);assert.deepEqual(locks,saved);
 }
 const locked=random(seed,base,input,{kick:true,snare:true,toms:true});assert.equal(locked.kick,'vcsl');assert.equal(locked.snare,'inherit');assert.equal(locked.toms,'inherit');
});
test('random raw UI states canonicalize safely but remain separate from inherited state',()=>{
 const overrides=random(0,'vcsl',{},{});assert.equal(overrides.kick,'vcsl');const parsed=parseCustomDrumSelection(customDrumSelectionKey('vcsl',overrides));assert.equal(parsed.overrides.kick,'inherit');assert.equal(overrides.kick,'vcsl');
 const nullProto=Object.create(null);nullProto.kick='vcsl';const locks=Object.create(null);locks.kick=true;assert.equal(random(4,'vcsl',nullProto,locks).kick,'vcsl');
});
test('invalid seeds, role values and lock keys/types reject without coercion or accessors',()=>{
 for(const seed of [-1,4294967296,1.1,NaN,Infinity,'1',null,undefined,{},1n])assert.throws(()=>random(seed,'vcsl'));
 for(const base of ['procedural','unknown',null])assert.throws(()=>random(0,base));
 for(const overrides of [null,[],{kick:'procedural'},{bad:'vcsl'},{kick:undefined},{get kick(){throw Error('getter ran');}}])assert.throws(()=>random(0,'vcsl',overrides));
 for(const locks of [null,[],true,'kick',Object.create({kick:true}),{unknown:true},{kick:1},{kick:'true'},{kick:undefined},{kick:null},{[Symbol('kick')]:true}])assert.throws(()=>random(0,'vcsl',{},locks));
 let accessed=0;assert.throws(()=>random(0,'vcsl',{},{get kick(){accessed++;return true;}}));assert.equal(accessed,0);
});
test('seed sweep explores independent combinations outside whole-kit presets',()=>{
 const seen=new Set(),choices=CUSTOM_DRUM_ROLES.map(()=>new Set());
 for(let seed=0;seed<2048;seed++){
  const result=random(seed,'vcsl');seen.add(Object.values(result).join('|'));
  CUSTOM_DRUM_ROLES.forEach((role,i)=>{assert.ok(CUSTOM_DRUM_KITS.includes(result[role]));choices[i].add(result[role]);});
  assert.deepEqual(random(seed,'vcsl',result),result);
 }
 assert.ok(seen.size>1900);for(const set of choices)assert.equal(set.size,9);
});
