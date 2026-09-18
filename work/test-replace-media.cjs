const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');
const el={addEventListener(){}};const ctx=vm.createContext({window:{addEventListener(){}},document:{querySelector:()=>el,addEventListener(){}},indexedDB:{open(){return {}}},structuredClone,console,Map,Set,Promise,crypto:require('crypto').webcrypto});
vm.runInContext(fs.readFileSync('outputs/storyforge/app.js','utf8').replace('render()}init();','render()}'),ctx);
vm.runInContext(`configureChapterOne(project);page='loading';save=()=>true;render=()=>{};notify=()=>{};putAsset=async()=>{};globalThis.createImageBitmap=async()=>({close(){}});globalThis.node=project.nodes[0];globalThis.target={node,frameId:node.frames[1].id};globalThis.before=JSON.stringify(node);`,ctx);
(async()=>{
 const file={name:'replacement.png',type:'image/png'};ctx.file=file;
 assert(await vm.runInContext('replaceBoardImage(file,target)',ctx));
 const node=JSON.parse(vm.runInContext('JSON.stringify(node)',ctx)),before=JSON.parse(ctx.before);
 assert.equal(node.frames.length,4);assert.equal(node.frames[1].id,before.frames[1].id);assert.equal(node.frames[1].duration,3);assert.equal(node.frames[1].name,file.name);assert.notEqual(node.frames[1].image,before.frames[1].image);assert.deepEqual(node.options,before.options);assert.equal(node.trigger,before.trigger);
 vm.runInContext('globalThis.createImageBitmap=async()=>{throw Error("invalid")}',ctx);
 assert.equal(await vm.runInContext('replaceBoardImage(file,target)',ctx),false);assert.equal(vm.runInContext('node.frames[1].image',ctx),node.frames[1].image);
 vm.runInContext('node.frames.splice(1,1)',ctx);assert.equal(await vm.runInContext('replaceBoardImage(file,target)',ctx),false);
 console.log('PASS targeted replacement retains order/duration/options; corrupt file and removed target preserve existing media');
})().catch(e=>{console.error(e);process.exitCode=1});
