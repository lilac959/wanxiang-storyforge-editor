const vm=require('vm'),fs=require('fs'),assert=require('node:assert/strict');
const element={addEventListener(){}};
const ctx=vm.createContext({window:{addEventListener(){}},document:{querySelector:()=>element,addEventListener(){}},indexedDB:{open(){return {}}},structuredClone,console,Map,Set,Promise});
vm.runInContext(fs.readFileSync('outputs/storyforge/app.js','utf8').replace('render()}init();','render()}'),ctx);
vm.runInContext(`
const sample=structuredClone(initial);const sampleNode=sample.nodes[0];
sampleNode.frames=[{id:'f1',image:'asset-a',name:'一.png',duration:2},{id:'f2',image:'asset-b',name:'二.png',duration:3}];
sampleNode.previewSource='boards';sampleNode.trigger=5;
globalThis.results={legacy:valid(initial),length:nodeDuration(sampleNode),first:boardAt(sampleNode,1.99),boundary:boardAt(sampleNode,2),end:boardAt(sampleNode,5),valid:valid(sample),assets:projectAssets(sample),roundtrip:valid(JSON.parse(JSON.stringify(sample)))};
sampleNode.frames[0].duration=-1;results.rejectDuration=!valid(sample);sampleNode.frames[0].duration=2;sampleNode.previewSource='video';results.videoLength=nodeDuration(sampleNode);
`,ctx);
const r=ctx.results;assert(r.legacy);assert.equal(r.length,5);assert.equal(r.first,0);assert.equal(r.boundary,1);assert.equal(r.end,1);assert(r.valid&&r.roundtrip&&r.rejectDuration);assert.equal(r.videoLength,12);assert(r.assets.includes('asset-a')&&r.assets.includes('asset-b'));console.log('PASS: legacy projects, storyboard timing and boundaries, source switching, asset collection, JSON roundtrip, invalid duration rejection');
