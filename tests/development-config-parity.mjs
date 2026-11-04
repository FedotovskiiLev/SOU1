// SPDX-License-Identifier: AGPL-3.0-only
// The random fixture producer uses the real JS UI helper; native only renders its concrete config.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [action,directory,sourceArgument]=process.argv.slice(2),out=resolve(directory);
const sourceURL=sourceArgument?pathToFileURL(resolve(sourceArgument)):new URL('../docs/development-score.js',import.meta.url);
const configSource=await readFile(new URL('./development-config.js',sourceURL),'utf8');
const configURL=`data:text/javascript;base64,${Buffer.from(configSource+'\n//# sourceURL=development-config.js').toString('base64')}`;
const {DEVELOPMENT_CONFIG_DEFAULTS:DEFAULT,normalizeDevelopmentConfig:normalize,deterministicRandomConfig:random}=await import(configURL);
const BASE={ambient:.15,counterpoint:.6,rhythmic:1,arpeggio:.35,bpm:137,density:.85,complexity:.9,swing:.37,evolution:.8,polyphony:32,melodyEnabled:true,drumsEnabled:true};
const rates=[8000,44100,48000,96000,192000],harmonies=['auto','fixed','progression','modulating'];
if(action==='prepare'){
  const lines=[];let n=0;
  function add(config={},p={},seed=91,rate=8000,seconds=120,chunk=0){
    const c=normalize(config),v={...BASE,...p},name=`configured-${String(n++).padStart(4,'0')}`;
    lines.push([name,rate,seed,rate*seconds,chunk,...['tonic','mode','meter','rhythmFamily','arpStrategy','drumPattern'].map(k=>c[k]==='seed'?-1:c[k]),c.harmony,c.drumVariation==='auto'?-1:c.drumVariation,
      ...['ambient','counterpoint','rhythmic','arpeggio','bpm','density','complexity','swing','evolution','polyphony','melodyEnabled','drumsEnabled'].map(k=>v[k])].join('\t'));
  }
  add(); // Explicit all-seeded/default configuration alongside the full legacy matrix.
  // Every concrete tonic/scale/meter tuple, both melodic and percussion pathways.
  for(let tonic=0;tonic<12;tonic++)for(let mode=0;mode<7;mode++)for(let meter=0;meter<6;meter++){
    const j=tonic*42+mode*6+meter;
    add({tonic,mode,meter,harmony:harmonies[j%4]}, {bpm:[30,72,137,180][j%4],complexity:[.2,.5,.8,1][j%4],polyphony:[8,16,24,32][j%4],melodyEnabled:j%11!==0,drumsEnabled:j%3!==0},[0,91,2147483648,4294967295][j%4],rates[j%5],90,j%3===0?919:0);
  }
  // Every combination of three independent manual pattern selectors.
  for(let rhythmFamily=0;rhythmFamily<8;rhythmFamily++)for(let arpStrategy=0;arpStrategy<8;arpStrategy++)for(let drumPattern=0;drumPattern<8;drumPattern++){
    const j=rhythmFamily*64+arpStrategy*8+drumPattern;
    add({rhythmFamily,arpStrategy,drumPattern,drumVariation:[0,.25,.55,1][j%4],meter:j%6},{evolution:1,complexity:1,density:1,swing:j%2?.87:0},91+j,8000,120);
  }
  // Random JS configs, and each locked field kept independently of the others.
  const lockBase=normalize({tonic:11,mode:5,meter:4,rhythmFamily:7,arpStrategy:2,drumPattern:6,harmony:'fixed',drumVariation:0});
  for(let seed=0;seed<128;seed++)add(random(seed),{bpm:173,evolution:1},seed*1664525+1013904223,rates[seed%5],300,seed%2?997:0);
  for(const key of Object.keys(DEFAULT))for(let seed=0;seed<4;seed++)add(random(seed,lockBase,{[key]:true}),{},seed,44100,120);
  // Harmony policies include slow ambient endpoint and several modulation boundaries.
  for(const harmony of harmonies)for(const evolution of [0,.4,1])for(let style=0;style<4;style++){
    const weights={ambient:0,counterpoint:0,rhythmic:0,arpeggio:0};weights[['ambient','counterpoint','rhythmic','arpeggio'][style]]=1;
    add({tonic:11,mode:6,meter:3,harmony}, {...weights,evolution,bpm:180,complexity:1,density:1},0xffffffff,192000,900);
  }
  // Precise drum variation boundaries, automatic and fixed patterns, including tiny finite values.
  for(const drumPattern of ['seed',0,1,2,3,4,5,6,7])for(const drumVariation of ['auto',0,Number.MIN_VALUE,1e-8,.25,.35,.55,.6,1])
    add({drumPattern,drumVariation,meter:0}, {ambient:0,counterpoint:0,rhythmic:0,arpeggio:0,complexity:1,density:1,evolution:1,bpm:120},91,48000,120);
  for(const harmony of harmonies)add({tonic:5,mode:2,meter:5,drumPattern:7,drumVariation:.73,harmony},{evolution:1,complexity:1,density:1},4294967295,192000,10800);
  await writeFile(resolve(out,'configured-input.tsv'),lines.join('\n')+'\n');
  console.log(`Prepared ${n} configured cases from canonical JS schema/randomizer`);
}else if(action==='verify'){
  const source=(await readFile(sourceURL,'utf8')).replace("'./development-config.js'",JSON.stringify(configURL));
  const {DevelopmentScore}=await import(`data:text/javascript;base64,${Buffer.from(source+'\n//# sourceURL=development-score.js').toString('base64')}`);
  const specs=(await readFile(resolve(out,'configured.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  let events=0,modulations=0;const covered={tonic:new Set(),mode:new Set(),meter:new Set(),rhythmFamily:new Set(),arpStrategy:new Set(),drumPattern:new Set(),harmony:new Set()};
  for(const spec of specs){
    assert.deepEqual(normalize(spec.config),spec.config,`${spec.name} native wire fields match JS normalization`);
    for(const key of Object.keys(covered))covered[key].add(spec.config[key]);
    const native=await readFile(resolve(out,spec.name+'.bin')),s=new DevelopmentScore(spec.rate,spec.seed,spec.config);let cursor=0;
    const sink={noteOn(at,k,n,d,v,pan){
      assert.ok(cursor+40<=native.length,`${spec.name}: extra JS event ${cursor/40}`);
      const expected=[Number(native.readBigInt64BE(cursor)),native.readInt32BE(cursor+8),native.readInt32BE(cursor+12),Number(native.readBigInt64BE(cursor+16)),native.readDoubleBE(cursor+24),native.readDoubleBE(cursor+32)],actual=[at,k,n,d,v,pan];
      for(let field=0;field<6;field++)assert.equal(actual[field],expected[field],`${spec.name} event ${cursor/40} field ${field}: JS ${actual[field]}, native ${expected[field]}`);
      cursor+=40;events++;
    }};
    if(spec.chunk>0)for(let at=0;at<spec.duration-1;at+=spec.chunk)s.advanceTo(at,spec.p,sink);s.advanceTo(spec.duration-1,spec.p,sink);
    assert.equal(cursor,native.length,`${spec.name}: missing JS events`);
    for(const key of Object.keys(spec.result))assert.equal(s[key],spec.result[key],`${spec.name}: diagnostic ${key}`);
    modulations+=s.modulationChanges;
  }
  for(const [key,count]of Object.entries({tonic:13,mode:8,meter:7,rhythmFamily:9,arpStrategy:9,drumPattern:9,harmony:4}))assert.equal(covered[key].size,count,`${key} concrete + seed coverage`);
  assert.ok(modulations>100);
  console.log(`PASS configured JS/JVM parity: ${specs.length} cases / ${events} complete events; all six event fields and diagnostics exactly equal, zero tolerance; ${modulations} modulation transitions`);
  console.log('PASS all 504 tonic/scale/meter tuples, all 512 independent rhythm/arp/drum tuples, JS random/locked configs, 4 harmony policies, drum-variation bounds, 8–192kHz, chunking, and 4×3h score-only.');
}else throw new Error('expected prepare or verify');
