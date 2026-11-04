// SPDX-License-Identifier: AGPL-3.0-only
// Exact event parity of normalized native Parameters, not Android-device QA.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]);
const sourcePath=process.argv[3]??new URL('../docs/development-score.js',import.meta.url);
let source=await readFile(sourcePath,'utf8');
if(source.includes("'./development-config.js'")){
  const sourceURL=sourcePath instanceof URL?sourcePath:pathToFileURL(resolve(sourcePath));
  const config=await readFile(new URL('./development-config.js',sourceURL),'utf8');
  source=source.replace("'./development-config.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(config).toString('base64')}`));
}
const {DevelopmentScore}=await import(`data:text/javascript;base64,${Buffer.from(source+'\n//# sourceURL=development-score.js').toString('base64')}`);
const frozenSource=await readFile(new URL('./fixtures/development-score-v1.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozenSource).digest('hex'),'9f42469d8b18d5d7e358722d83fd92290956a184a68f9af8c19046e651ed9edb','immutable v1 comparator');
const {DevelopmentScore:FrozenScore}=await import(`data:text/javascript;base64,${Buffer.from(frozenSource+'\n//# sourceURL=development-score-v1.js').toString('base64')}`);
const specs=(await readFile(resolve(root,'cases.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
let events=0,cases=0,longForms=0;const modes=new Set(),meters=new Set(),arps=new Set(),roots=new Set(),families=new Set();
for(const spec of specs){
  const buffer=await readFile(resolve(root,`${spec.name}.bin`));
  for(const Class of [DevelopmentScore,FrozenScore]){
  const s=new Class(spec.rate,spec.seed);s.beatNext+=spec.shift;
  let cursor=0;
  const sink={noteOn(at,k,n,d,v,pan){
    assert.ok(cursor+40<=buffer.length,`${spec.name}: extra JS event ${cursor/40}`);
    const native=[Number(buffer.readBigInt64BE(cursor)),buffer.readInt32BE(cursor+8),buffer.readInt32BE(cursor+12),Number(buffer.readBigInt64BE(cursor+16)),buffer.readDoubleBE(cursor+24),buffer.readDoubleBE(cursor+32)];
    const actual=[at,k,n,d,v,pan];
    for(let field=0;field<6;field++)assert.equal(actual[field],native[field],`${spec.name} event ${cursor/40} field ${field}: JS ${actual[field]}, JVM ${native[field]}`);
    cursor+=40;if(Class===DevelopmentScore)events++;
  }};
  for(let i=0;i<spec.phases.length;i++){
    const {at,p}=spec.phases[i],begin=spec.shift+at,end=spec.shift+(i+1<spec.phases.length?spec.phases[i+1].at:spec.duration)-1;
    if(spec.chunk>0)for(let frame=begin;frame<end;frame+=spec.chunk)s.advanceTo(frame,p,sink);
    s.advanceTo(end,p,sink);
  }
  assert.equal(cursor,buffer.length,`${spec.name}: missing JS events`);
  assert.equal(cursor/40,spec.result.count,`${spec.name}: count`);
  for(const key of ['tick','next','beatNext','elapsedFrames','chordChanges','suppressedEvents','root','mode','meterTicks','phraseBars','motifLength','arpStrategy','family'])
    assert.equal(s[key],spec.result[key],`${spec.name}: ${key}`);
  modes.add(s.mode);meters.add(s.meterTicks);arps.add(s.arpStrategy);roots.add(s.root);families.add(s.family);
  }
  if(spec.duration/spec.rate>=10800)longForms++;
  cases++;
}
assert.equal(modes.size,7);assert.equal(meters.size,6);assert.equal(arps.size,8);assert.equal(roots.size,12);assert.equal(families.size,8);
assert.equal(longForms,5);
console.log(`PASS exact JS/JVM development parity: ${cases} cases, ${events} events, all six event fields exactly equal against new JS AND pinned frozen v1 (zero tolerance)`);
console.log('PASS rates 8/44.1/48/96/192 kHz; 7 modes, 6 meters, 8 arpeggios, 12 roots; four styles and mixed weights; density/complexity/swing/evolution thresholds, budgets/mutes, live controls, chunking, unsigned seeds, 4×3h + 8h score-only and >32-bit frame offset');
console.log('Scope: Parameters-normalized integer BPM 30..180. Direct-JS fractional BPM is not a native API feature. No Android-device or audible-output claim.');
