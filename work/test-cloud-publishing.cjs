const {chromium}=require('C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const assert=require('assert/strict');
const editor='http://127.0.0.1:4176',game='http://127.0.0.1:4175',token='local-test-publish-key';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(editor);await p.waitForSelector('.nodeitem');await p.waitForFunction(()=>pendingAssetWrites===0&&document.querySelector('#mainTitle').textContent.includes('加载'));
  await p.evaluate(async token=>{
   localStorage.setItem('storyforge-publish-token',token);
   const blob=new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'});
   await putAsset('asset-cloud-test',blob);
   project=structuredClone(initial);project.name='同步测试一';project.loading.image='';project.loading.video='';project.loading.duration=.5;project.splash.video='';project.splash.duration=1;project.splash.waitForStart=false;
   project.nodes=[{...project.nodes[0],type:'choice',video:'',frames:[{id:'f-test',name:'测试.png',image:'asset-cloud-test',duration:2}],previewSource:'boards',duration:2,trigger:0,options:[{text:'结束',target:''}],failure:''}];selected=project.nodes[0].id;render();
  },token);
  await p.locator('#saveConfig').click();await p.waitForFunction(()=>!cloudSaving);
  assert.match(await p.locator('#saved').textContent(),/已同步/,await p.locator('#toast').textContent());
  let r=await fetch(editor+'/api/project');const etag=r.headers.get('etag'),first=await r.json();assert.equal(first.project.name,'同步测试一');
  const id=first.project.nodes[0].frames[0].image;assert.match(id,/^asset-cloud-[a-f0-9]{64}$/);
  const media='/api/media/'+id.slice(12);r=await fetch(editor+media,{headers:{Range:'bytes=0-7'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,8);
  assert.equal((await fetch(editor+'/api/publish',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(game+'/api/publish',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'})).status,401);
  const bad=structuredClone(first.project);bad.nodes[0].frames[0].image='asset-cloud-'+'a'.repeat(64);
  assert.equal((await fetch(editor+'/api/publish',{method:'POST',headers:{Authorization:'Bearer '+token,'If-Match':etag},body:JSON.stringify(bad)})).status,400);
  assert.equal((await (await fetch(editor+'/api/project')).json()).version,first.version);
  const player=await browser.newPage();await player.addInitScript(()=>{const original=window.setInterval;window.setInterval=(fn,ms,...args)=>original(fn,ms===30000?200:ms,...args)});player.on('pageerror',e=>errors.push(e.message));await player.goto(editor+'/game');await player.waitForSelector('#player[open]');assert.equal(await player.evaluate(()=>project.name),'同步测试一');assert.equal(await player.locator('.app').isVisible(),false);assert.equal(await player.locator('.playerfooter').evaluate(e=>getComputedStyle(e).display),'none');
  await p.locator('#projectName').fill('同步测试二');await p.locator('#saveConfig').click();await p.waitForFunction(()=>!cloudSaving);assert.match(await p.locator('#saved').textContent(),/已同步/,await p.locator('#toast').textContent());
  assert.equal((await fetch(editor+'/api/publish',{method:'POST',headers:{Authorization:'Bearer '+token,'If-Match':etag},body:JSON.stringify(first.project)})).status,409);
  await player.locator('#gameUpdate').waitFor({state:'visible'});await player.locator('#gameUpdate').click();await player.waitForFunction(()=>project.name==='同步测试二');assert(await player.locator('#player').isVisible());
  await player.locator('.start-prompt').waitFor({state:'visible',timeout:15000});await player.keyboard.press('Space');await player.waitForSelector('#playerScreen .choices button',{state:'visible',timeout:15000}).catch(async e=>{console.log(await player.locator('#playerScreen').innerText());throw e});assert.equal(await player.locator('#playerScreen .choices button').textContent(),'结束');await p.evaluate(()=>localStorage.setItem('storyforge-publish-token','invalid-test-key'));await p.locator('#projectName').fill('同步测试三');await p.locator('#saveConfig').click();await p.waitForFunction(()=>!cloudSaving);assert.match(await p.locator('#saved').textContent(),/同步失败/);assert.equal((await (await fetch(editor+'/api/project')).json()).project.name,'同步测试二');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('storyforge-project')).name),'同步测试三');
  await p.evaluate(token=>localStorage.setItem('storyforge-publish-token',token),token);await p.locator('#saveConfig').click();await p.waitForFunction(()=>!cloudSaving);await player.locator('#gameUpdate').waitFor({state:'visible'});assert.equal(await player.evaluate(()=>project.name),'同步测试二');await player.locator('#gameUpdate').click();await player.waitForFunction(()=>project.name==='同步测试三');
  await p.evaluate(()=>{project.name='自动同步测试';save()});await p.waitForFunction(()=>document.querySelector('#saved').textContent.includes('等待云端同步'));await p.waitForFunction(()=>document.querySelector('#saved').textContent.includes('已同步'),null,{timeout:30000});assert.equal((await (await fetch(editor+'/api/project')).json()).project.name,'自动同步测试');assert.deepEqual(errors,[]);
  console.log('PASS asset upload, automatic queued publishing, independent player, byte ranges, authorization, atomic failure, stale version conflict, real playback');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});




