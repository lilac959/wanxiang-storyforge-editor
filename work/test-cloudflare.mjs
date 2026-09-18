import worker from '../outputs/cloudflare/worker.mjs';
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const env={ASSETS:{async fetch(req){const data=await fs.readFile(new URL('../outputs/cloudflare/public'+new URL(req.url).pathname,import.meta.url));const range=req.headers.get('Range');if(range){const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(range);return new Response(data.subarray(+a,+b+1),{status:206})}return new Response(data)}}};
const original=await fs.readFile(new URL('../outputs/storyforge/assets/chapter01-branch-7.mp4',import.meta.url));
for(const range of [null,'bytes=0-1023','bytes=16777000-16778000','bytes=-4096']){
 const r=await worker.fetch(new Request('https://example.com/assets/chapter01-branch-7.mp4',{headers:range?{Range:range}:{}}),env);const bytes=Buffer.from(await r.arrayBuffer());
 const expected=range==='bytes=0-1023'?original.subarray(0,1024):range==='bytes=16777000-16778000'?original.subarray(16777000,16778001):range==='bytes=-4096'?original.subarray(-4096):original;
 assert.deepEqual(bytes,expected);assert.equal(+r.headers.get('Content-Length'),bytes.length);
}
assert.equal((await worker.fetch(new Request('https://example.com/assets/chapter01-branch-7.mp4',{headers:{Range:'bytes=999999999-'}}),env)).status,416);
console.log('PASS full original video, byte ranges across chunks, suffix range, invalid range');
