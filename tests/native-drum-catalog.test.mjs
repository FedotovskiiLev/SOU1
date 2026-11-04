// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, rm, mkdir, readFile, writeFile, symlink, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec = promisify(execFile), source = fileURLToPath(new URL('../', import.meta.url));
const hash = b => createHash('sha256').update(b).digest('hex');
test('native catalog generation rejects drift, unsafe paths, unbounded files and ambiguous manifests', async t => {
 const root = await mkdtemp(join(tmpdir(), 'sou1-native-catalog-'));
 try {
  for (const relative of ['LICENSE', 'tools/generate-native-drum-catalog.mjs', 'tools/instruments', 'experiments/rack-browser', 'assets', 'docs/audio-kit', 'app/src/main/java/org/sou1/audio/NativeDrumCatalog.java']) {
   await mkdir(join(root, relative, '..'), {recursive:true}); await cp(join(source, relative), join(root, relative), {recursive:true});
  }
  const run = () => exec(process.execPath, [join(root, 'tools/generate-native-drum-catalog.mjs'), '--check']);
  await run();
  const lockPath = join(root,'docs/audio-kit/SOURCE_LOCK.json'), originalLock = await readFile(lockPath);
  const relative = 'assets/cc0-mini/manifest.json', manifestPath = join(root,'docs/audio-kit',relative), rootPath = join(root,relative);
  const manifest = await readFile(manifestPath);
  async function lockedManifest(bytes) {
   const lock = JSON.parse(originalLock); const entry = lock.files.find(f=>f.path===relative);
   entry.bytes=bytes.length; entry.sha256=hash(bytes);
   await writeFile(manifestPath,bytes); await writeFile(rootPath,bytes); await writeFile(lockPath,JSON.stringify(lock));
  }
  async function restore() {await writeFile(manifestPath,manifest);await writeFile(rootPath,manifest);await writeFile(lockPath,originalLock);}
  await t.test('byte-identical reproducibility rejects stale generated Java', async()=>{
   const file=join(root,'app/src/main/java/org/sou1/audio/NativeDrumCatalog.java'), original=await readFile(file);
   await writeFile(file,Buffer.concat([original,Buffer.from('\n')])); await assert.rejects(run,/Native catalog stale/); await writeFile(file,original);
  });
  await t.test('manifest corruption and source/package disagreement',async()=>{
   const changed=Buffer.from(manifest);changed[10]^=1;
   await writeFile(manifestPath,changed); await assert.rejects(run,/Locked asset changed/);await restore();
   await writeFile(rootPath,changed); await assert.rejects(run,/Packaged source differs/);await restore();
  });
  await t.test('duplicate decoded JSON keys even with matching updated locks',async()=>{
   const changed=Buffer.from(manifest.toString().replace('{','{"schema":"sou1.cc0-bank.v1",'));
   await lockedManifest(changed);await assert.rejects(run,/Duplicate JSON key/);await restore();
   await lockedManifest(Buffer.from(manifest.toString().replace('{','{"\\u0073chema":"sou1.cc0-bank.v1",')));
   await assert.rejects(run,/Duplicate JSON key/);await restore();
  });
  await t.test('invalid UTF-8, deep JSON and non-finite numbers',async()=>{
   await lockedManifest(Buffer.concat([Buffer.from([255]),manifest]));await assert.rejects(run,/encoded data/);await restore();
   const original=JSON.parse(manifest);original.extra=JSON.parse('['.repeat(33)+'0'+']'.repeat(33));
   await lockedManifest(Buffer.from(JSON.stringify(original)));await assert.rejects(run,/JSON structure budget/);await restore();
   await lockedManifest(Buffer.from(manifest.toString().replace('{','{"unused":1e999,')));await assert.rejects(run,/Non-finite JSON number/);await restore();
  });
  await t.test('sample paths and metadata remain strictly validated after relocking',async()=>{
   let changed=JSON.parse(manifest);changed.samples[0].file='../kick.wav';await lockedManifest(Buffer.from(JSON.stringify(changed)));await assert.rejects(run,/Invalid sample provenance/);await restore();
   changed=JSON.parse(manifest);changed.samples[0].frames++;await lockedManifest(Buffer.from(JSON.stringify(changed)));await assert.rejects(run,/Sample size metadata/);await restore();
  });
  await t.test('source lock traversal, duplicate entry and oversize reject',async()=>{
   for (const mutation of [lock=>{lock.files[0].path='../outside';},lock=>{lock.files.push(lock.files[0]);},lock=>{lock.files[0].bytes=5*1024*1024;}]) {
    const lock=JSON.parse(originalLock);mutation(lock);await writeFile(lockPath,JSON.stringify(lock));await assert.rejects(run,/Package lock entry/);await restore();
   }
   await writeFile(manifestPath,Buffer.alloc(129*1024));await assert.rejects(run,/Package asset size/);await restore();
  });
  await t.test('symlink files and directories are not packaged',async()=>{
   await rm(manifestPath);await symlink(rootPath,manifestPath);await assert.rejects(run,/Symlink package path/);await rm(manifestPath);await restore();
   const dir=join(root,'docs/audio-kit/assets/cc0-mini'), moved=dir+'-saved';await rename(dir,moved);await symlink(moved,dir);
   try {await assert.rejects(run,/Symlink package path/);} finally {await rm(dir);await rename(moved,dir);}
  });
  await run();
 } finally {await rm(root,{recursive:true,force:true});}
});
