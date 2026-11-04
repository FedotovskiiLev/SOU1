// SPDX-License-Identifier: AGPL-3.0-only
// Compile the existing closed, byte-locked web package. No network or dependencies.
import {readFile, writeFile, lstat, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {PREPARED_DRUM_KITS, drumManifestPath} from '../docs/audio-kit/tools/instruments/drum-kits.mjs';
import {loadBrowserBank} from '../docs/audio-kit/experiments/rack-browser/bank.mjs';
const root = new URL('../', import.meta.url), packaged = new URL('docs/audio-kit/', root);
const output = new URL('app/src/main/java/org/sou1/audio/NativeDrumCatalog.java', root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expect = (ok, message) => { if (!ok) throw Error(message); };
const relative = path => typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) &&
  !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..');
// Reject duplicate JSON keys, non-finite numeric literals, and deep structures
// before the canonical JS loader sees the document. Input is already byte-bounded.
function strictJson(bytes) {
  const source = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  let at = 0, nodes = 0;
  const whitespace = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
  function string() {
    expect(source[at] === '"', 'Expected JSON string'); const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '\\') at++;
      else if (c === '"') return JSON.parse(source.slice(start, at));
    }
    throw Error('Unterminated JSON string');
  }
  function value(depth) {
    expect(depth <= 32 && ++nodes <= 20000, 'JSON structure budget'); whitespace();
    if (source[at] === '"') { string(); return; }
    const opening = source[at];
    if (opening === '{' || opening === '[') {
      at++; whitespace(); const closing = opening === '{' ? '}' : ']'; const keys = new Set();
      if (source[at] === closing) { at++; return; }
      while (true) {
        whitespace();
        if (opening === '{') {
          const key = string(); expect(!keys.has(key), 'Duplicate JSON key: ' + key); keys.add(key);
          whitespace(); expect(source[at++] === ':', 'Expected JSON colon');
        }
        value(depth + 1); whitespace(); const separator = source[at++];
        if (separator === closing) return;
        expect(separator === ',', 'Expected JSON comma/end');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at));
    expect(match, 'Invalid JSON value');
    if (!['true','false','null'].includes(match[0])) expect(Number.isFinite(Number(match[0])), 'Non-finite JSON number');
    at += match[0].length;
  }
  value(0); whitespace(); expect(at === source.length, 'Trailing JSON content');
  return JSON.parse(source);
}
async function regular(base, path, limit = 4 * 1024 * 1024) {
  expect(relative(path), 'Invalid package path: ' + path);
  let current = base;
  const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = new URL(parts[i], current); const stat = await lstat(current);
    expect(!stat.isSymbolicLink(), 'Symlink package path: ' + path);
    expect(i === parts.length - 1 ? stat.isFile() : stat.isDirectory(), 'Non-regular package path: ' + path);
    current = new URL(current.href + '/');
  }
  const handle = await open(new URL(path, base), constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat(); expect(stat.isFile() && stat.size <= limit, 'Package asset size: ' + path);
    const chunks = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(8192, limit - size + 1));
      const {bytesRead} = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead; expect(size <= limit, 'Package asset exceeds byte limit: ' + path);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
const lockBytes = await regular(packaged, 'SOURCE_LOCK.json', 128 * 1024);
const lock = strictJson(lockBytes);
expect(lock.schema === 'sou1.web-drum-package.v1' && lock.sampleLicense === 'CC0-1.0' &&
  lock.codeLicense === 'AGPL-3.0-only' && Array.isArray(lock.files) && lock.files.length > 0 &&
  lock.files.length <= 256, 'Package lock schema');
expect(lock.files.reduce((total, entry) => total + (Number.isSafeInteger(entry.bytes) ? entry.bytes : Infinity), 0) <= 32 * 1024 * 1024, 'Package aggregate byte budget');
const files = new Map();
for (const entry of lock.files) {
  expect(relative(entry.path) && !files.has(entry.path) && Number.isSafeInteger(entry.bytes) &&
    entry.bytes > 0 && entry.bytes <= 4 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(entry.sha256), 'Package lock entry');
  const bytes = await regular(packaged, entry.path, entry.bytes);
  expect(bytes.length === entry.bytes && hash(bytes) === entry.sha256, 'Locked asset changed: ' + entry.path);
  expect(bytes.equals(await regular(root, entry.path, entry.bytes)), 'Packaged source differs: ' + entry.path);
  files.set(entry.path, bytes);
}
const fakeBase = new URL('https://sou1.invalid/audio-kit/');
const fetcher = async url => {
  const actual = new URL(url);
  expect(actual.href.startsWith(fakeBase.href) && !actual.search && !actual.hash, 'Asset URL');
  const path = actual.href.slice(fakeBase.href.length);
  expect(files.has(path), 'Asset missing from source lock: ' + path);
  return new Response(files.get(path));
};
const kits = ['vcsl', ...PREPARED_DRUM_KITS];
expect(kits.length === 9 && new Set(kits).size === kits.length, 'Unexpected closed kit registry');
const paths = ['assets/cc0-mini/manifest.json', ...PREPARED_DRUM_KITS.map(drumManifestPath)];
const q = s => JSON.stringify(s), arr = xs => `list(${xs.join(', ')})`;
const sources = [];
for (const path of paths) {
  const bytes = files.get(path);
  expect(bytes && bytes.length <= 128 * 1024, 'Missing/oversized manifest');
  strictJson(bytes);
  const loaded = await loadBrowserBank(new URL(path, fakeBase), {fetcher});
  const m = loaded.manifest;
  expect(/^[a-f0-9]{40}$/.test(m.sourceCommit), 'Manifest source commit');
  const sampleIds = m.samples.map(s => s.id);
  expect(new Set(sampleIds).size === sampleIds.length, 'Duplicate sample');
  const samples = m.samples.map(s => {
    expect(Number.isInteger(s.rootNote) && s.rootNote >= 0 && s.rootNote <= 127, 'Root note');
    expect(s.sourcePath.length > 0 && s.sourcePath.length <= 1024 && !s.sourcePath.includes('\0'), 'Source provenance path');
    return `new SampleSpec(${q(s.id)}, ${q(s.file)}, ${q(s.sha256)}, ${s.bytes}, ${s.frames}, ${s.sampleRate}, ${s.rootNote})`;
  });
  const instruments = m.instruments.map(d => {
    const zones = d.zones.map(z => `new ZoneSpec(${sampleIds.indexOf(z.sample)}, ${z.keyLow}, ${z.keyHigh}, ${z.velocityLow ?? 0}, ${z.velocityHigh ?? 1}, ${z.pitched})`);
    return `new InstrumentSpec(${q(d.id)}, ${d.gain}, ${d.oneShot}, ${d.chokeGroup ? q(d.chokeGroup) : 'null'}, ${arr(zones)})`;
  });
  sources.push(`    private static final SourceSpec BANK_${sources.length} = new SourceSpec(\n        ${q(path)}, ${bytes.length}, ${q(hash(bytes))}, ${q(m.id)}, ${q(m.sourceCommit)},\n        ${arr(samples)},\n        ${arr(instruments)});`);
}
const code = `// SPDX-License-Identifier: AGPL-3.0-only
// GENERATED by tools/generate-native-drum-catalog.mjs. Do not edit by hand.
// Exact manifests/WAVs and provenance remain in docs/audio-kit, byte-for-byte.
package org.sou1.audio;

import java.util.List;
import java.util.Arrays;
import java.util.Collections;
import static org.sou1.audio.NativeDrumBankLoader.*;

final class NativeDrumCatalog {
    private NativeDrumCatalog() { }
    @SafeVarargs
    @SuppressWarnings("varargs")
    private static <T> List<T> list(T... items) {
        return Collections.unmodifiableList(Arrays.asList(items));
    }
    static final int LOCK_BYTES = ${lockBytes.length};
    static final String LOCK_SHA256 = ${q(hash(lockBytes))};
    static final List<String> KITS = ${arr(kits.map(q))};
${sources.join('\n\n')}

    static List<SourceSpec> sources(String kit) {
        if (kit == null) throw new IllegalArgumentException("Unknown recorded drum kit");
        switch (kit) {
${kits.map((kit, i) => `            case ${q(kit)}: return ${i === 0 ? 'list(BANK_0)' : `list(BANK_0, BANK_${i})`};`).join('\n')}
            default: throw new IllegalArgumentException("Unknown recorded drum kit");
        }
    }
}
`;
if (process.argv.slice(2).length && process.argv.slice(2).join(' ') !== '--check') throw Error('Usage: node tools/generate-native-drum-catalog.mjs [--check]');
if (process.argv.includes('--check')) expect((await readFile(output, 'utf8')) === code, 'Native catalog stale; regenerate it');
else await writeFile(output, code);
console.log(`Native catalog ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${kits.length} kits, ${files.size} source-locked package files, ${Buffer.byteLength(code)} Java bytes.`);
