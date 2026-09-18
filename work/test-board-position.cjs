const {chromium}=require('C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright');
const assert=require('assert/strict');
(async()=>{
 const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
 const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/');await p.waitForSelector('.nodeitem');
 await p.evaluate(()=>{page='story';selected=project.nodes.find(n=>n.frames?.length>1).id;render()});
 const result=await p.evaluate(()=>{
  const n=current(),first=n.frames[0],count=n.frames.length;
  duplicateBoard(n,first.id);
  const copied=n.frames[1].id;
  const inserted=n.frames.length===count+1&&Number(document.querySelector('#seek').value)===first.duration&&document.querySelector('#editorArea .boardimage').dataset.frame===copied;
  deleteBoard(n,copied);
  const removed=n.frames.length===count&&document.querySelector('#editorArea .boardimage').dataset.frame===n.frames[1].id;
  const cards=document.querySelectorAll('#editorArea .boardtile'),source=cards[0],target=cards[1],rect=target.getBoundingClientRect(),transfer=new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
  target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer,clientX:rect.right-1,clientY:rect.top+5}));
  return {inserted,removed,sorted:n.frames[1].id===first.id,shown:document.querySelector('#editorArea .boardimage').dataset.frame===first.id,seek:Number(document.querySelector('#seek').value),expected:n.frames[0].duration};
 });
 assert(result.inserted&&result.removed&&result.sorted&&result.shown);assert.equal(result.seek,result.expected);assert.deepEqual(errors,[]);
 console.log('PASS copy/delete/reorder preserve selected frame, seek position and browser execution');
 } finally {await b.close()}
})().catch(e=>{console.error(e);process.exit(1)});
