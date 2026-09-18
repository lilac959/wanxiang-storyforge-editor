const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict');
const handlers={},element={addEventListener(){}};
const ctx=vm.createContext({window:{addEventListener(){}},document:{querySelector:()=>element,querySelectorAll:()=>[],addEventListener(type,fn){(handlers[type]??=[]).push(fn)}},indexedDB:{open(){return {}}},structuredClone,console,Map,Set,Promise,Element:class{},crypto:require('crypto').webcrypto});
vm.runInContext(fs.readFileSync('outputs/storyforge/app.js','utf8').replace('render()}init();','render()}'),ctx);
vm.runInContext(`
const png={name:'frame.png',type:'image/png'},jpeg={name:'frame.jpg',type:''},video={name:'scene.mp4',type:'video/mp4'},bad={name:'readme.txt',type:'text/plain'};
globalThis.results={multiple:planDrop([png,jpeg],'canvas','story'),mixed:planDrop([video,png],'canvas','story'),video:planDrop([video],'video','story'),background:planDrop([png],'canvas','loading'),splash:planDrop([video],'canvas','splash'),rejectMany:planDrop([video,video],'canvas','story'),rejectBad:planDrop([png,bad],'canvas','story'),rejectWrong:planDrop([video],'boards','story'),rejectLoading:planDrop([png,jpeg],'canvas','loading')};
globalThis.notes=[];notify=text=>notes.push(text);render=()=>{};save=()=>{};clearDropHighlight=()=>{};
globalThis.imported=[];putAsset=async(id,file)=>{imported.push(file.name)};createImageBitmap=async()=>({close(){}});
`,ctx);
const r=ctx.results;assert.equal(r.multiple.images.length,2);assert.equal(r.mixed.videos.length,1);assert.equal(r.mixed.images.length,1);assert.equal(r.video.kind,'video');assert.equal(r.background.kind,'image');assert.equal(r.splash.kind,'video');for(const k of ['rejectMany','rejectBad','rejectWrong','rejectLoading'])assert(r[k].error);
(async()=>{
  await vm.runInContext(`(async()=>{const n=project.nodes[0];await importBoards([png,jpeg],n);await upload(video,'video',n);globalThis.actual={frames:n.frames.length,source:n.previewSource,name:n.videoName,saved:imported.length}})()`,ctx);
  assert.equal(ctx.actual.frames,2);assert.equal(ctx.actual.source,'video');assert.equal(ctx.actual.name,'scene.mp4');assert.equal(ctx.actual.saved,3);
  // Dispatch the actual registered drop handler and switch selected node during import.
  await vm.runInContext(`(async()=>{const owner=project.nodes[0];globalThis.owner=owner;globalThis.zone={dataset:{dropZone:'canvas'},classList:{remove(){}}};dropZone=()=>zone;putAsset=async(id,file)=>{selected='n2';imported.push(file.name)};globalThis.event={preventDefault(){this.prevented=true},dataTransfer:{types:['Files'],files:[png,video]}}})()`,ctx);
  await handlers.drop[0](ctx.event);
  assert(ctx.event.prevented);assert.equal(ctx.owner.frames.length,3);assert.equal(ctx.owner.previewSource,'boards');
  assert.equal(vm.runInContext('project.nodes[1].frames',ctx),undefined);
  console.log('PASS: multi-image and mixed drops, typed drop zones, unsupported/multiple-video rejection, shared asset import, prevent browser navigation, destination retained during async import');
})().catch(e=>{console.error(e);process.exitCode=1});
