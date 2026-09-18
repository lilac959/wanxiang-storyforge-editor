const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');let stored,failed=false,download;
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'测试项目',textContent:'',addEventListener(){},classList:{add(){},remove(){}},click(){},close(){}});return elements.get(id)};
const ctx=vm.createContext({window:{addEventListener(){}},document:{querySelector:el,addEventListener(){},createElement:()=>({click(){download=this.download}})},indexedDB:{open(){return {}}},structuredClone,console,Map,Set,Promise,Blob,TextEncoder,TextDecoder,Uint8Array,DataView,File,crypto:require('crypto').webcrypto,URL:{createObjectURL(blob){ctx.exported=blob;return 'blob:test'},revokeObjectURL(){}},setTimeout(){},clearTimeout(){},localStorage:{setItem(k,v){if(failed)throw Error('quota');stored=v}}});
vm.runInContext(fs.readFileSync('outputs/storyforge/archive.js','utf8'),ctx);vm.runInContext(fs.readFileSync('outputs/storyforge/app.js','utf8').replace('render()}init();','render()}'),ctx);
vm.runInContext('render=()=>{globalThis.renders=(globalThis.renders||0)+1};getBlob=async()=>new Blob([new Uint8Array([1,2,3])],{type:"video/mp4"});',ctx);
(async()=>{
 assert(vm.runInContext('saveConfiguration()',ctx));assert.equal(JSON.parse(stored).name,'测试项目');assert.equal(ctx.renders,1);
 failed=true;assert.equal(vm.runInContext('saveConfiguration()',ctx),false);assert.equal(ctx.renders,1);failed=false;
 await vm.runInContext('exportProject()',ctx);assert.equal(download,'测试项目.storyforge.zip');const entries=await ctx.readProjectZip(ctx.exported);assert(entries.has('project.storyforge.json'));assert(entries.has('assets.json'));const manifest=JSON.parse(await entries.get('assets.json').text());assert.equal(Object.keys(manifest).length,3);for(const item of Object.values(manifest))assert.deepEqual([...new Uint8Array(await entries.get(item.path).arrayBuffer())],[1,2,3]);
 console.log('PASS save success/failure, full exporter ZIP configuration/manifest/original media');
})().catch(e=>{console.error(e);process.exitCode=1});
