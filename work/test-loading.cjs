const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
let xhr;class Request{constructor(){xhr=this}open(){}send(){}abort(){this.onabort?.()}}
const ctx=vm.createContext({XMLHttpRequest:Request,DOMException,AbortController,setTimeout,clearTimeout,console});vm.runInContext(fs.readFileSync('work/loading-runtime.txt','utf8'),ctx);
(async()=>{
 const controller=new AbortController(),steps=[];ctx.signal=controller.signal;ctx.report=(a,b)=>steps.push([a,b]);
 const done=vm.runInContext("downloadResource('test',signal,report)",ctx);
 xhr.onprogress({loaded:20,total:100,lengthComputable:true});assert.deepEqual(steps,[[20,100]]);
 // Waiting without network events does not change the reported progress.
 await new Promise(r=>setTimeout(r,30));assert.equal(steps.length,1);
 xhr.onprogress({loaded:70,total:100,lengthComputable:true});assert.equal(steps[1][0],70);
 xhr.status=200;xhr.response={size:100};xhr.onload();await done;
 assert.equal(vm.runInContext('progressValue([{loaded:100,total:100,ready:false}])',ctx),99);
 assert.equal(vm.runInContext('progressValue([{loaded:100,total:100,ready:true}])',ctx),100);
 assert.equal(vm.runInContext('progressValue([{loaded:50,total:100,ready:false},{loaded:0,total:0,ready:false}])',ctx),25);
 assert.equal(vm.runInContext('progressValue([{loaded:900,total:0,ready:false}])',ctx),0);
 const aborter=new AbortController();ctx.signal=aborter.signal;const cancelled=vm.runInContext("downloadResource('test',signal,report)",ctx);aborter.abort();await assert.rejects(cancelled,e=>e.name==='AbortError');
 ctx.signal=new AbortController().signal;const failed=vm.runInContext("downloadResource('test',signal,report)",ctx);xhr.status=404;xhr.onload();await assert.rejects(failed,/404/);
 console.log('PASS: progress follows bytes, no timer-generated advancement, decode gates 100%, unknown sizes, cancellation and HTTP failure');
})().catch(e=>{console.error(e);process.exitCode=1});
