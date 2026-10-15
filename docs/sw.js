// SPDX-License-Identifier: AGPL-3.0-only
const CACHE='sou1-2aa906922b64b1d8';const CORE=['./','./index.html','./style.css','./app.js','./audio-engine.js','./environment-audio.js','./audio-worklet.js','./manifest.webmanifest','./icons/icon.svg','./version.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE.map(path=>new Request(path,{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(x=>x.startsWith('sou1-')&&x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;if(new URL(event.request.url).pathname.endsWith('/version.json')){event.respondWith(fetch(event.request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone())}return response}).catch(()=>caches.match(event.request)));return}event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});

self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting()});
