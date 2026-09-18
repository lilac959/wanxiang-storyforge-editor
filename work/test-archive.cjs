const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ctx=vm.createContext({Blob,TextEncoder,TextDecoder,Uint8Array,DataView,Map,Error});vm.runInContext(fs.readFileSync('outputs/storyforge/archive.js','utf8'),ctx);
(async()=>{
 const original=fs.readFileSync('outputs/storyforge/assets/chapter01-01.png');
 const files=[{name:'project.storyforge.json',blob:new Blob(['{"version":1}'])},{name:'assets.json',blob:new Blob(['{}'])},{name:'assets/001_中文分镜.png',blob:new Blob([original])}];
 const zip=await ctx.createProjectZip(files);fs.writeFileSync('work/archive-test.zip',Buffer.from(await zip.arrayBuffer()));
 const entries=await ctx.readProjectZip(zip);assert.equal(await entries.get('project.storyforge.json').text(),'{"version":1}');assert.deepEqual(Buffer.from(await entries.get('assets/001_中文分镜.png').arrayBuffer()),original);
 const corrupt=new Uint8Array(await zip.arrayBuffer());corrupt[60]^=1;await assert.rejects(ctx.readProjectZip(new Blob([corrupt])));
 console.log('PASS ZIP: Unicode names, JSON and original image byte-for-byte roundtrip, corruption rejection');
})().catch(e=>{console.error(e);process.exitCode=1});
