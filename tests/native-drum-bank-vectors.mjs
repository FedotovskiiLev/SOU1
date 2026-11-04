// SPDX-License-Identifier: AGPL-3.0-only
// Full Float32 PCM oracle from the canonical JS preparer, using local assets only.
import {readFile, open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareDrumBank, WEB_DRUM_KITS} from '../docs/drum-bank.js';
const output = process.argv[2];
if (!output) throw Error('Usage: node tests/native-drum-bank-vectors.mjs OUTPUT');
const base = new URL('https://sou1.invalid/audio-kit/');
const assets = new URL('../docs/audio-kit/', import.meta.url);
const fetcher = async url => {
  const actual = new URL(url);
  if (!actual.href.startsWith(base.href) || actual.search || actual.hash) throw Error('Closed local fixture paths');
  const relative = actual.href.slice(base.href.length);
  if (relative.split('/').some(p => p === '..' || !p)) throw Error('Fixture path');
  return new Response(await readFile(new URL(relative, assets)));
};
const cases = WEB_DRUM_KITS.filter(k => k !== 'procedural').flatMap(k => [44100, 48000].map(r => [k, r]));
cases.push(['vcsl', 8000], ['vcsl', 192000]);
const file = await open(output, 'w'); let chunks = [];
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); chunks.push(b); };
const f64 = n => { const b = Buffer.alloc(8); b.writeDoubleBE(n); chunks.push(b); };
const str = value => { const b = Buffer.from(value, 'utf8'); i32(b.length); chunks.push(b); };
try {
 str('sou1.native-drum-vectors.v1'); i32(cases.length);
 for (const [kit, rate] of cases) {
  const {wireBank:b, report:r} = await prepareDrumBank(kit, rate, {assetBaseUrl:base, fetcher});
  str(kit); i32(rate); i32(r.encodedBytes); i32(r.sourceDecodedBytes); i32(r.sourceMappedBytes);
  i32(r.preparedBytes); f64(r.preparedPeak); i32(r.banks.length);
  for (const source of r.banks) for (const key of ['id', 'manifest', 'sha256', 'sourceCommit']) str(source[key]);
  for (const inst of b.instruments) str(r.instrumentBanks[inst.id]);
  i32(b.samples.length);
  for (let n = 0; n < b.samples.length; n++) {
   const sample = b.samples[n], converted = r.converted[n];
   i32(sample.length); i32(converted.sourceRate); i32(converted.pitch ?? -1); f64(converted.step); f64(converted.peak);
   str(converted.pcmSha256);
   const pcm = Buffer.alloc(sample.length * 4);
   for (let j = 0; j < sample.length; j++) pcm.writeFloatBE(sample[j], j * 4);
   chunks.push(pcm);
  }
  i32(b.instruments.length);
  for (const inst of b.instruments) {
   str(inst.id); f64(inst.gain); str(inst.chokeGroup ?? ''); i32(inst.zones.length);
   for (const z of inst.zones) { i32(z.sampleIndex); i32(z.keyLow); i32(z.keyHigh); f64(z.velocityLow); f64(z.velocityHigh); }
  }
  await file.write(Buffer.concat(chunks)); chunks = [];
  console.log(`JS oracle: ${kit} ${rate} Hz, ${b.samples.length} samples, ${r.preparedBytes} prepared bytes`);
 }
} finally { await file.close(); }
console.log('Oracle SHA-256: ' + createHash('sha256').update(await readFile(output)).digest('hex'));
