// SPDX-License-Identifier: AGPL-3.0-only
import {mkdir,open,unlink,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readJson} from './bounded-json.mjs';
import {composeVarietyPlan} from './composition/variety-score.mjs';
import {composeExpressivePlan} from './composition/expressive-score.mjs';
import {exportScoreMidi} from './composition/score-midi.mjs';
import {FSA_KITS} from './instruments/drum-kits.mjs';
export async function main(args=process.argv.slice(2)){
  const expressive=args[0]==='--expressive';if(expressive)args=args.slice(1);
  if(args.length!==2||!args[1].toLowerCase().endsWith('.mid'))throw new Error('Usage: node tools/export-score-midi.mjs [--expressive] options.json output.mid');
  const input=await readJson(args[0],64*1024);if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('MIDI options object');
  const {drumKit='vcsl',...recipe}=input;if(!['vcsl',...FSA_KITS].includes(drumKit))throw new RangeError('Unknown drumKit');
  const plan=(expressive?composeExpressivePlan:composeVarietyPlan)(recipe),midi=exportScoreMidi(plan);
  const files=['tools/export-score-midi.mjs','tools/bounded-json.mjs','tools/instruments/drum-kits.mjs','tools/composition/variety-score.mjs','tools/composition/expressive-score.mjs','tools/composition/score-midi.mjs'],sourceHashes={};
  for(const f of files)sourceHashes[f]=createHash('sha256').update(await readFile(new URL('../'+f,import.meta.url))).digest('hex');
  const sha256=createHash('sha256').update(midi.bytes).digest('hex'),report={...midi.report,sha256,composerVersion:plan.schema,options:plan.options,...(plan.expression?{expression:plan.expression}:{}),requestedDrumKit:drumKit,sourceHashes,limitations:[...midi.report.limitations,'The requested drum kit is metadata only; MIDI embeds no samples and does not load the selected bank into the host.']};
  const json=JSON.stringify(report,null,2)+'\n',out=resolve(args[1]),paths=[out,out+'.json'],handles=[];
  await mkdir(dirname(out),{recursive:true});
  try{
    for(const p of paths)handles.push(await open(p,'wx'));
    await handles[0].writeFile(midi.bytes);await handles[1].writeFile(json);for(const h of handles)await h.close();
  }catch(error){for(const h of handles)try{await h.close();}catch{}for(let i=0;i<handles.length;i++)try{await unlink(paths[i]);}catch{}throw error;}
  console.log(JSON.stringify({midi:out,receipt:out+'.json',sha256,exportedNotes:report.exportedNotes,shortenedOverlaps:report.shortenedOverlaps,coalescedSameTick:report.coalescedSameTick}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write('SOU1 MIDI: '+e.message+'\n');process.exitCode=1;});
