const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
function renderer(file) {
  const c = vm.createContext({
    document: {addEventListener() {}},
    nodeDuration: n => n.frames?.length ? n.frames.reduce((s,f)=>s+f.duration,0) : n.duration,
    usingBoards: n => !!n.frames?.length,
    qteStartTime: (n,d) => n.tailQte ? Math.max(0,d-n.trigger) : n.trigger,
    cinemaRange: (n,d) => ({start:n.cinemaStart||0,end:n.cinemaEnd??d}),
    esc: s => String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    types: {choice:'分支选择',qte:'鼠标手势 QTE',none:'无交互',hotspot:'热点'},
    mouseQteTypes: {hold:'长按',click:'点击',swipeRight:'向右滑动'}
  });
  vm.runInContext(fs.readFileSync(file,'utf8'),c);
  return n => c.timelineMarkup(n);
}
const before=renderer('work/refactor-backup/timeline-editor.js');
const after=renderer('outputs/storyforge/timeline-editor.js');
let count=0;
for(const type of ['choice','qte','none','hotspot'])
 for(const frames of [[],[{id:'a',name:'图 <一>',duration:2},{id:'b',name:'图二',duration:2}]])
  for(const trigger of [0,2,4])
   for(const cinemaMode of [false,true]){
    const n={type,frames,trigger,duration:4,limit:4,video:frames.length?'':'movie',videoName:'1.mp4',qteGesture:'hold',qteHold:1.5,tailQte:type==='qte',cinemaMode,cinemaStart:0,cinemaEnd:3};
    assert.equal(after(n),before(n),JSON.stringify(n));count++;
   }
const placeholder={type:'none',duration:8,trigger:0,limit:4};
assert.equal(after(placeholder),before(placeholder));
console.log(`PASS ${count+1} timeline render cases unchanged against pre-refactor snapshot`);
