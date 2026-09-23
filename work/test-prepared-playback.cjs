const {chromium}=require('C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await page.waitForFunction(()=>typeof editorReady!=='undefined'&&editorReady);
  const result=await page.evaluate(async()=>{
   stop();
   const id='asset-cloud-test-video',url=location.origin+'/assets/chapter01-branch-1.mp4';
   media.set(id,url);
   const task={id,kind:'video',loaded:0,total:0};
   await prepareResource(task,new AbortController().signal,()=>{});
   const prepared=preparedVideos.get(id);
   window.testPrepared=prepared;
   project.nodes=[{...project.nodes[0],id:'n-prepared',type:'none',video:id,previewSource:'video',frames:[],duration:1.37,next:'',options:[]}];
   return {ready:task.ready,bytes:task.loaded,blob:asset(id).startsWith('blob:'),readyState:prepared.readyState};
  });
  assert(result.ready&&result.blob&&result.bytes>1000000&&result.readyState>=2);
  await page.context().setOffline(true);
  await page.evaluate(()=>{activeRun=true;document.querySelector('#player').showModal();playNode('n-prepared')});
  assert(await page.evaluate(()=>document.querySelector('#playerScreen video')===window.testPrepared));
  await page.waitForFunction(()=>document.querySelector('#playerScreen video')?.currentTime>.3);
  await page.evaluate(()=>stop());
  assert.equal(await page.evaluate(()=>preparedVideos.size),0);
  console.log('PASS cloud URL fully downloaded; prepared video reused and plays offline; stop clears pool');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
