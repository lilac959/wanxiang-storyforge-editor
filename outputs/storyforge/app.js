const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial={version:1,name:'万象环轨',loading:{video:'asset-loading-video-v1',videoName:'cgt-20260911164747-ct8t8.mp4',videoRevision:1,title:'万象环轨',titleLayout:'square',titleRevision:1,subtitle:'',text:'正在加载资源',color:'#e5d6b1',image:'asset-loading-cover-v1',duration:2,coverRevision:1},splash:{title:'',subtitle:'',duration:3,skip:false,effect:'fade',video:'asset-opening-v1',videoName:'cgt-20260911152112-z8h9n.mp4',openingRevision:1,waitForStart:true},nodes:[{id:'n1',name:'初入山境',subtitle:'雾色深处，两条路通向不同的命运。',duration:12,trigger:8,type:'choice',limit:8,video:'',options:[{text:'循着笛声前行',target:'n2'},{text:'走向山间古寺',target:'n3'}],failure:'n3',x:65,y:50},{id:'n2',name:'林间来客',subtitle:'脚步声突然靠近，你必须立刻作出反应。',duration:10,trigger:5,type:'qte',limit:5,video:'',options:[{text:'点击闪避',target:'n4'}],failure:'n3',x:65,y:50},{id:'n3',name:'古寺寻踪',subtitle:'寻找隐于雾色中的线索。',duration:10,trigger:4,type:'hotspot',limit:10,video:'',options:[{text:'查看线索',target:'n4'}],failure:'n4',x:65,y:50},{id:'n4',name:'山海回响',subtitle:'你终于听见，山海给出的回答。',duration:8,trigger:6,type:'none',limit:8,video:'',options:[],failure:'',x:65,y:50}]};
let project=structuredClone(initial),page='story',selected='n1',graph=false,media=new Map(),timer=null,runToken=0,activeRun=false,liveVideo=null,liveActions=null,actionDone=false,toastTimer;
const types={choice:'分支选择',qte:'鼠标手势 QTE',hotspot:'画面热点',none:'无交互 / 自动衔接'};
const dbReady=new Promise(resolve=>{try{let r=indexedDB.open('storyforge-local',1);r.onupgradeneeded=()=>r.result.createObjectStore('assets');r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null)}catch{resolve(null)}});
let pendingAssetWrites=0;
async function putAsset(id,file){pendingAssetWrites++;try{const db=await dbReady;if(!db)throw Error('浏览器无法保存素材');await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});media.set(id,URL.createObjectURL(file))}finally{pendingAssetWrites--}}
async function getBlob(id){const db=await dbReady;if(!db)return null;return new Promise(resolve=>{const r=db.transaction('assets').objectStore('assets').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null)})}
function asset(id){return media.get(id)||(/^asset-tail-video-[1-9]$/.test(id)?'assets/chapter01-branch-'+id.split('-').pop()+'.mp4':'')||(/^asset-chapter01-0[1-4]$/.test(id)?'assets/'+id.slice(6)+'.png':'')||(id==='asset-loading-video-v1'?'assets/loading-background.mp4':'')||(id==='asset-opening-v1'?'assets/opening.mp4':'')||(id==='asset-loading-cover-v1'?'assets/loading-cover.png':'')||(/^https?:\/\//i.test(id)?id:'')}
function current(){return project.nodes.find(n=>n.id===selected)||project.nodes[0]}
function notify(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2500)}
function save(){try{localStorage.setItem('storyforge-project',JSON.stringify(project));$('#saved').textContent='● 已保存到本机';if(typeof markEditorDraft==='function')markEditorDraft();return true}catch{$('#saved').textContent='保存失败，请导出项目';notify('本机存储不足，请导出项目');return false}}
function repairTiming(p){
 if(!Array.isArray(p?.nodes))return;
 for(const n of p.nodes){
  if(!n||!Number.isFinite(n.duration)||n.duration<=0)continue;
  if(n.previewSource==='boards'&&(!Array.isArray(n.frames)||!n.frames.every(f=>f&&Number.isFinite(f.duration)&&f.duration>0)))continue;
  const duration=nodeDuration(n);
  if(n.qteTriggerMode==='linked-tail'&&n.type==='qte'){syncTailTiming(n,'trigger');continue}
  if(n.qteTriggerMode==='time'&&n.type==='qte')continue;
  if(n.tailQte&&n.type==='qte'&&!usingBoards(n)&&Number.isFinite(n.qteTail))n.trigger=Math.max(0,duration-n.qteTail);
  else if(Number.isFinite(n.trigger))n.trigger=Math.max(0,Math.min(n.trigger,duration));
 }
}
function saveConfiguration(publish=false){
 if(importBusy||pendingAssetWrites){notify('素材正在导入，请完成后再保存配置');return false}
 project.name=$('#projectName').value.trim()||'未命名作品';
 repairTiming(project);
 if(!valid(project)){notify('配置仍有无效项，请检查节点选项、跳转目标及加载页设置');return false}
 if(!save())return false;
 if(activeRun){stop();$('#player').close()}
 render();
 $('#saved').textContent='● 全部配置已保存';
 notify('全部配置已保存并更新，试玩将使用最新内容');
 if(publish&&typeof publishProject==='function')publishProject(structuredClone(project));
 return true;
}
function field(label,key,value,type='text',extra=''){return `<label class="field">${label}<input type="${type}" data-key="${key}" value="${esc(value)}" ${extra}></label>`}
function select(label,key,value,options){return `<label class="field">${label}<select data-key="${key}">${Object.entries(options).map(([k,v])=>`<option value="${esc(k)}" ${k===value?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`}
function targets(exclude){return {'':'结束作品',...Object.fromEntries(project.nodes.filter(n=>n.id!==exclude).map(n=>[n.id,n.name]))}}
function scenery(){return '<div class="landscape"><div class="mist"></div></div>'}
function videoMarkup(src){return src?`<video src="${esc(src)}" playsinline preload="metadata"></video>`:scenery()}
function stage(n,actions=true){if(n.deathScreen)return deathMarkup(n,actions);return `<div class="stage ${n.cleanPresentation?'cinematic':''}" id="sceneStage">${nodeMarkup(n)}<span class="sample">${usingBoards(n)?'分镜图片预览':n.video?'视频素材':'示例场景 · 可替换视频'}</span><span class="aspect">16 : 9</span><div class="sceneoverlay"><span class="chapter">CHAPTER ${String(project.nodes.indexOf(n)+1).padStart(2,'0')} / 山海之间</span><h2>${esc(n.name)}</h2><p>${esc(n.subtitle)}</p>${actions&&n.type==='qte'?mechanicalQteMarkup(n):actions?`<div class="choices" ${n.type==='choice'&&qteStartTime(n,nodeDuration(n))>0?'hidden':''}>${n.type==='none'?'':n.options.slice(0,n.type==='choice'?10:1).map(o=>`<button tabindex="-1" ${choicePosition(o)}>${esc(o.text)}</button>`).join('')}</div>`:''}</div>${actions&&n.type==='hotspot'?`<button class="hotspot" style="left:${n.x}%;top:${n.y}%" title="在画面中点击定位热点">＋</button>`:''}</div>`}
function render(){document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#projectName').value=project.name;$('#nodeCount').textContent=String(project.nodes.length).padStart(2,'0');$('#nodeList').innerHTML=project.nodes.map((n,i)=>`<div class="nodeitem ${selected===n.id?'selected':''}" role="button" tabindex="0" data-node="${n.id}" draggable="true" data-sort-kind="node" data-sort-id="${n.id}" title="拖拽调整剧情节点顺序"><div class="nodethumb">${i===0?'▷':i===3?'✧':'◇'}</div><div class="nodetext">${esc(n.name)}<small>${types[n.type].split(' /')[0]} · ${nodeDuration(n)}s</small></div><em>${String(i+1).padStart(2,'0')}</em></div>`).join('');$('#mainTitle').textContent={story:'剧情编排',loading:'加载页面',splash:'开屏动画'}[page];$('#sceneView').classList.toggle('active',!graph);$('#graphView').classList.toggle('active',graph);renderArea();renderProperties()}
function renderArea(){clearInterval(boardTimer);boardTimer=null;let n=current(),html='';if(page==='story'){if(graph){html=`<div class="canvaslabel"><strong>故事地图</strong><span>${project.nodes.length} 个节点 · 点击节点编辑</span></div><div class="graph"><div class="arrow">加载页面 → 开屏动画 → ${esc(project.nodes[0].name)}</div>${project.nodes.map(a=>`<div class="graphnode" data-node="${a.id}">▷ ${esc(a.name)} <span class="badge">${types[a.type]}</span><small>${a.type==='none'?`播放结束 → ${esc(targets()[a.next||''])}`:a.options.map(o=>`${esc(o.text)} → ${esc(targets()[o.target]||'结束作品')}`).join('<br>')}${a.type==='qte'||a.type==='hotspot'?`<br>超时 → ${esc(targets()[a.failure]||'结束作品')}`:''}</small></div>`).join('')}</div>`}else html=`<div class="canvaslabel"><strong>${esc(n.name)} <span class="subtle"> / 场景预览</span></strong><span>● ${types[n.type]}</span></div>${stage(n)}${boardStrip(n)}<div class="transport"><button id="miniPlay" aria-label="播放当前画面">▷</button><span id="timeLabel">00:00</span><input id="seek" aria-label="画面进度" type="range" min="0" max="${nodeDuration(n)}" step="0.1" value="0"><span>${format(nodeDuration(n))}</span><span>⛶</span></div>${timelineMarkup(n)}<div class="hintbar"><b>✦</b><span>${n.type==='hotspot'?'直接点击预览画面，设置热点位置。':'画面中展示交互样式；点击「预览当前」体验真实的触发与跳转。'}</span></div>`}else{const c=project[page];html=`<div class="canvaslabel"><strong>${page==='loading'?'第一眼，就进入故事':'故事开始前的仪式感'}</strong><span>实时样式预览</span></div><div class="stage settingsstage">${page==='loading'&&asset(c.image)?`<img class="backimage" src="${esc(asset(c.image))}">`:page==='splash'?videoMarkup(asset(c.video)):scenery()}<div class="loadcontent ${page==='splash'?'introtitle':''}"><h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p>${page==='loading'?`<div class="progress"><i style="background:${c.color}"></i></div><div class="loadbottom"><span>${esc(c.text)}</span><span>68%</span></div>`:'<span class="eyebrow">AN INTERACTIVE STORY</span>'}</div></div><div class="hintbar"><b>✦</b><span>${page==='loading'?'可自定义封面、作品标题和进度条颜色。试玩会加载已配置视频的元数据。':'支持文字动画或视频开屏。可设置展示时长，以及是否允许玩家跳过。'}</span></div>`}if(page==='splash')html='<div class="canvaslabel"><strong>开屏动画</strong><span>循环播放 · 随时按任意键开始</span></div>'+splashMarkup(project.splash,true);if(page==='loading')html='<div class="canvaslabel"><strong>加载页面</strong><span>点击「预览当前」查看真实资源加载</span></div>'+loadingMarkup(project.loading);$('#editorArea').innerHTML=html;markDropZones();bindScene();bindEditorCanvas();bindChoicePositions();bindCinemaEditor()}
function renderProperties(){let n=current(),html='';if(page==='story'){html=`<div class="section"><h3><span>01</span> 基础信息</h3>${field('节点名称','name',n.name)}${field('剧情提示','subtitle',n.subtitle)}</div><div class="section"><h3><span>02</span> 视频素材</h3><button class="upload full" id="uploadVideo"><strong>＋</strong>${n.video?'替换视频':'选择本地视频'}${n.videoName?'<small>'+esc(n.videoName)+'</small>':''}<small>拖入视频或点击选择 · MP4 / WebM</small></button>${field('或输入视频直链','video',/^https?:/.test(n.video)?n.video:'','url','placeholder="https://…/scene.mp4"')}${field('示例时长 / 视频时长（秒）','duration',n.duration,'number','min="1" max="7200" step="0.1"')}</div>${boardProperties(n)}<div class="section"><h3><span>03</span> 交互方式</h3>${select('交互类型','type',n.type,types)}${n.type!=='none'?field(n.qteTriggerMode==='linked-tail'?'触发时机（结束前秒数）':'触发时间（秒）','trigger',n.trigger,'number',`min="0" max="${n.qteTriggerMode==='linked-tail'?120:n.qteTriggerMode==='time'?7200:nodeDuration(n)}" step="0.1"`):select('播放结束后','next',n.next||'',targets(n.id))}${['qte','hotspot'].includes(n.type)?field('响应时限（秒）','limit',n.limit,'number','min="1" max="120"'):''}${['hotspot','qte'].includes(n.type)?`<div class="row">${field('横向位置 %','x',n.x,'number','min="5" max="95"')}${field('纵向位置 %','y',n.y,'number','min="5" max="95"')}</div>`:''}</div>${n.type!=='none'?`<div class="section"><h3><span>04</span> ${n.type==='choice'?'分支选项':'成功 / 失败'}</h3>${n.options.slice(0,n.type==='choice'?10:1).map((o,i)=>`<div class="optioncard"><div class="optionhead">${n.type==='choice'?'选项 '+String.fromCharCode(65+i):'成功操作'}${n.type==='choice'&&n.options.length>1?`<button data-delete-option="${i}" aria-label="删除选项">×</button>`:''}</div><input aria-label="选项 ${i+1} 文案" data-option="${i}" data-prop="text" value="${esc(o.text)}"><select aria-label="选项 ${i+1} 跳转" data-option="${i}" data-prop="target">${Object.entries(targets(n.id)).map(([k,v])=>`<option value="${k}" ${o.target===k?'selected':''}>→ ${esc(v)}</option>`).join('')}</select>${n.type==='choice'?choicePositionFields(o,i):''}</div>`).join('')}${n.type==='choice'?'<button class="full" id="addOption">＋ 添加选项</button>':select('超时后跳转','failure',n.failure,targets(n.id))}</div>`:''}<button class="danger" id="deleteNode">删除当前节点</button>`}else if(page==='loading'){const c=project.loading;html=`<div class="section"><h3><span>01</span> 加载页内容</h3>${field('作品标题','title',c.title)}${field('副标题','subtitle',c.subtitle)}${field('加载提示','text',c.text)}<button class="upload full" id="uploadVideo"><strong>＋</strong>${c.video?'替换加载背景视频':'添加加载背景视频'}${c.videoName?'<small>'+esc(c.videoName)+'</small>':''}<small>拖入视频或点击选择 · 加载时循环播放</small></button><button class="upload full" id="uploadImage"><strong>＋</strong>${c.image?'替换背景图片':'添加背景图片'}<small>拖入背景图片或点击选择 · 推荐 1920 × 1080</small></button>${c.image?'<button class="full" id="removeImage">恢复示例背景</button>':''}</div><div class="section"><h3><span>02</span> 进度样式</h3>${field('进度条颜色','color',c.color,'color')}<p class="subtle">按实际资源下载和解码推进。每项资源按已下载字节计算，全部就绪后进入开屏；未知大小的资源完成后计入进度。</p></div>`}else{const c=project.splash;html=`<div class="section"><h3><span>01</span> 开屏内容</h3>${field('开屏标题','title',c.title)}${field('副标题','subtitle',c.subtitle)}<button class="upload full" id="uploadVideo"><strong>＋</strong>${c.video?'替换开屏视频':'添加开屏视频'}${c.videoName?'<small>'+esc(c.videoName)+'</small>':''}<small>拖入开屏视频或点击选择</small></button>${field('或输入开屏视频直链','video',/^https?:/.test(c.video)?c.video:'','url')}${c.video?'<button class="full" id="removeVideo">使用文字开屏</button>':''}</div><div class="section"><h3><span>02</span> 播放设置</h3><p class="subtle">开屏视频持续循环播放，提示从开始即显示。随时按任意键或点击画面进入剧情。</p>${select('文字入场动画','effect',c.effect,{fade:'淡入上浮',zoom:'缓慢放大',none:'直接显示'})}</div>`}if(page==='story'){html+=tailQteProperties(n)+cinemaProperties(n);if(n.type==='qte'&&!n.tailQte)html+='<div class="section"><h3>鼠标 QTE</h3>'+mouseQteProperties(n)+'</div>'}$('#properties').innerHTML=html;markDropZones();editorInspector()}
function format(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t%60)).padStart(2,'0')}
function bindScene(){bindBoards();const v=$('#sceneStage video'),sceneNode=current();if(v){v.onloadedmetadata=()=>{if(Number.isFinite(v.duration)&&v.duration>0){sceneNode.duration=v.duration;repairTiming(project);save();if(current()===sceneNode){if($('#seek'))$('#seek').max=v.duration;for(const key of ['duration','trigger','qteTail']){const input=document.querySelector(`#properties [data-key="${key}"]`);if(input&&input!==document.activeElement)input.value=sceneNode[key]??''}}}};v.ontimeupdate=()=>{$('#seek').value=v.currentTime;$('#timeLabel').textContent=format(v.currentTime);syncEditorChoices(v.currentTime)}}$('#miniPlay')?.addEventListener('click',()=>{if(usingBoards(current())){toggleBoards();return}if(!v){start(false);return}v.paused?v.play().catch(()=>notify('视频无法播放，请检查格式或链接')):v.pause()});$('#seek')?.addEventListener('input',e=>{if(v)v.currentTime=+e.target.value;if(usingBoards(current())){clearInterval(boardTimer);boardTimer=null;$('#miniPlay').textContent='▷'}if(usingBoards(current()))paintBoard($('#editorArea'),current(),+e.target.value);$('#timeLabel').textContent=format(+e.target.value);syncEditorChoices(+e.target.value)});$('#sceneStage')?.addEventListener('click',e=>{if(current().type!=='hotspot')return;const r=e.currentTarget.getBoundingClientRect();current().x=Math.round(Math.max(5,Math.min(95,(e.clientX-r.left)/r.width*100)));current().y=Math.round(Math.max(5,Math.min(95,(e.clientY-r.top)/r.height*100)));save();renderArea();renderProperties()})}
document.addEventListener('change',e=>{const el=e.target;if(el.dataset.key){let obj=page==='story'?current():project[page],k=el.dataset.key;let v=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;if(el.type==='number'){v=Number.isFinite(v)?v:Number(el.min)||0;if(el.min)v=Math.max(+el.min,v);if(el.max)v=Math.min(+el.max,v)}if(k==='video'&&v&&!/^https?:\/\//i.test(v)){notify('请输入 http 或 https 视频地址');return}if(k==='cinemaMode')v=v==='on';obj[k]=v;if(k==='qteGesture'&&obj.options?.[0])obj.options[0].text=mouseQteTypes[v];syncTailTiming(obj,k);if(k==='type'&&v!=='none'&&!obj.options.length)obj.options=[{text:v==='choice'?'继续前行':'点击互动',target:''}];if(page==='story'&&!['time','linked-tail'].includes(obj.qteTriggerMode))obj.trigger=Math.min(obj.trigger,nodeDuration(obj));save();render()}else if(el.dataset.optionPosition){updateChoicePosition(+el.dataset.option,el.dataset.optionPosition,+el.value)}else if(el.dataset.option!==undefined){current().options[+el.dataset.option][el.dataset.prop]=el.value;save();renderArea()} });
document.addEventListener('click',e=>{const b=e.target.closest('button,[data-node]');if(!b)return;if(b.dataset.page){page=b.dataset.page;graph=false;render()}if(b.dataset.node){selected=b.dataset.node;page='story';graph=false;render()}if(b.dataset.deleteOption!==undefined){current().options.splice(+b.dataset.deleteOption,1);save();render()}switch(b.id){case'saveConfig':saveConfiguration(false);break;case'deployProject':saveConfiguration(true);break;case'restoreDraft':restoreEditorDraft();break;case'addNode':{let n=structuredClone(initial.nodes[0]);n.id='n'+Date.now();n.name='新的剧情 '+(project.nodes.length+1);n.options=[{text:'继续前行',target:''}];project.nodes.push(n);selected=n.id;page='story';save();render();break}case'addOption':if(current().options.length<6){current().options.push({text:'新的选择',target:''});save();render()}else notify('最多支持 6 个分支选项');break;case'deleteNode':if(project.nodes.length===1){notify('至少保留一个剧情节点');break}const id=current().id;project.nodes=project.nodes.filter(n=>n.id!==id);project.nodes.forEach(n=>{n.options.forEach(o=>{if(o.target===id)o.target=''});if(n.failure===id)n.failure='';if(n.next===id)n.next=''});selected=project.nodes[0].id;save();render();notify('节点已删除，相关跳转已改为结束作品');break;case'sceneView':graph=false;renderArea();render();break;case'graphView':page='story';graph=true;render();break;case'uploadVideo':videoUploadTarget=page==='story'?current():project[page];$('#mediaFile').click();break;case'uploadImage':$('#imageFile').click();break;case'removeImage':project.loading.image='';save();render();break;case'removeVideo':project.splash.video='';project.splash.videoName='';save();render();break;case'playAll':start(true);break;case'previewCurrent':page==='story'?start(false):start(true,page);break;case'closePlayer':stop();$('#player').close();break;case'restartPlayer':typeof cloudPlayer!=='undefined'&&cloudPlayer?startPublishedGame():start(true);break;case'exportProject':exportProject();break;case'importProject':$('#projectFile').click();break}});
document.addEventListener('input',e=>{if(e.isComposing||e.target.dataset.composing==='true')return;const el=e.target;if(el.dataset.key&&el.tagName==='INPUT'&&el.type!=='checkbox'){const obj=page==='story'?current():project[page],k=el.dataset.key;let value=el.value;if(el.type==='number'){if(value===''||!Number.isFinite(+value))return;value=+value;if(el.min)value=Math.max(+el.min,value);if(el.max)value=Math.min(+el.max,value)}if(k==='video'&&value&&!/^https?:\/\//i.test(value))return;obj[k]=value;syncTailTiming(obj,k);if(obj.qteTriggerMode==='linked-tail'){document.querySelectorAll('[data-key="trigger"],[data-key="qteTail"]').forEach(input=>{if(input!==el)input.value=obj[input.dataset.key]})}if(page==='story'&&!['time','linked-tail'].includes(obj.qteTriggerMode))obj.trigger=Math.min(obj.trigger,nodeDuration(obj));save();renderArea()}else if(el.dataset.optionPosition){if(el.value!==''&&Number.isFinite(+el.value))updateChoicePosition(+el.dataset.option,el.dataset.optionPosition,+el.value)}else if(el.dataset.option!==undefined){current().options[+el.dataset.option][el.dataset.prop]=el.value;save();renderArea()}});
document.addEventListener('keydown',e=>{if(e.target.matches('[data-node]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.target.click()}});
$('#projectName').addEventListener('change',e=>{project.name=e.target.value.trim()||'未命名作品';save()});
async function upload(file,kind,dest=kind==='image'?project.loading:page==='splash'?project.splash:page==='loading'?project.loading:current()){if(!file)return;if(fileKind(file)!==kind){notify('素材格式不匹配');return}const id='asset-'+crypto.randomUUID();try{await putAsset(id,file);dest[kind==='image'?'image':'video']=id;if(kind==='image'&&dest===project.loading)dest.video='';if(kind!=='image'){dest.videoName=file.name;if(project.nodes.includes(dest))dest.previewSource='video'}save();render();notify('素材已导入并保存在本机');return true}catch{notify('素材保存失败，可能超出浏览器空间')}}
let videoUploadTarget=null;$('#mediaFile').onchange=async e=>{const file=e.target.files[0],dest=videoUploadTarget;e.target.value='';videoUploadTarget=null;if(dest&&(project.nodes.includes(dest)||dest===project.loading||dest===project.splash))await upload(file,'video',dest)};$('#imageFile').onchange=async e=>{await upload(e.target.files[0],'image');e.target.value=''};
function stop(){clearTailQte();clearGenericMouse();clearSplashInput();loadingAbort?.abort();loadingAbort=null;clearInterval(boardTimer);runToken++;activeRun=false;clearInterval(timer);$('#playerScreen').querySelectorAll('video').forEach(v=>v.pause());liveVideo=null;liveActions=null}
const COVER_ID='asset-loading-cover-v1';
let loadingAbort=null;
function loadingMarkup(c){return `<div class="stage loading-stage">${asset(c.video)?`<video class="loading-background-video" src="${esc(asset(c.video))}" poster="${esc(asset(c.image))}" autoplay muted loop playsinline preload="auto" aria-label="加载页循环背景"></video>`:asset(c.image)?`<img class="backimage" src="${esc(asset(c.image))}" alt="加载页面封面">`:scenery()}${c.title||c.subtitle?`<div class="loading-title ${c.titleLayout==='square'?'title-square':''}"><h2>${c.titleLayout==='square'?Array.from(c.title).map(char=>`<span>${esc(char)}</span>`).join(''):esc(c.title)}</h2>${c.subtitle?`<p>${esc(c.subtitle)}</p>`:''}</div>`:''}<div class="loading-hud" style="--loading-color:${c.color}"><div class="loadbottom"><span id="loadMessage">${esc(c.text)}</span><span id="loadPercent">0%</span></div><div class="progress" role="progressbar" aria-label="资源加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="loadBar" style="width:0%"></i></div><div id="loadDetail" class="load-detail"></div></div></div>`}
function loadingEntries(p){const list=[];if(p.loading.video)list.push({id:p.loading.video,kind:'video'});else if(p.loading.image)list.push({id:p.loading.image,kind:'image'});if(p.splash.video)list.push({id:p.splash.video,kind:'video'});for(const n of p.nodes){if(usingBoards(n))list.push(...n.frames.map(f=>({id:f.image,kind:'image'})));else if(n.video)list.push({id:n.video,kind:'video'})}return [...new Map(list.map(x=>[x.id,x])).values()]}
function progressValue(tasks){return tasks.length?Math.floor(tasks.reduce((sum,t)=>sum+(t.ready?1:Math.min(.99,t.total>0?t.loaded/t.total:0)),0)/tasks.length*100):100}
function formatBytes(bytes){return bytes>1048576?(bytes/1048576).toFixed(1)+' MB':Math.round(bytes/1024)+' KB'}
function downloadSingleResource(url,signal,progress){return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();let settled=false;let stall;
  const abort=()=>{xhr.abort();finish(new DOMException('已取消加载','AbortError'))};
  const finish=(error,blob)=>{if(settled)return;settled=true;clearTimeout(stall);signal.removeEventListener('abort',abort);error?reject(error):resolve(blob)};
  const touch=()=>{clearTimeout(stall);stall=setTimeout(()=>{finish(Error('资源长时间无响应，请检查网络后重试'));xhr.abort()},45000)};
  if(signal.aborted){reject(new DOMException('已取消加载','AbortError'));return}
  signal.addEventListener('abort',abort,{once:true});xhr.open('GET',url);xhr.responseType='blob';
  xhr.onprogress=e=>{touch();progress(e.loaded,e.lengthComputable?e.total:0)};
  xhr.onload=()=>{if((xhr.status>=200&&xhr.status<300)||(xhr.status===0&&xhr.response?.size)){const blob=xhr.response;progress(blob.size,blob.size);finish(null,blob)}else finish(Error('资源请求失败（'+xhr.status+'）'))};
  xhr.onerror=()=>finish(Error('网络连接中断或资源无法访问'));
  xhr.onabort=()=>finish(new DOMException('已取消加载','AbortError'));
  touch();xhr.send();
})}
function decodeResource(url,kind,signal){return new Promise((resolve,reject)=>{
  const el=document.createElement(kind==='image'?'img':'video');let settled=false;
  const abort=()=>finish(new DOMException('已取消加载','AbortError'));
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);el.onload=null;el.onloadeddata=null;el.onerror=null;el.removeAttribute('src');if(kind==='video')el.load();error?reject(error):resolve()};
  const timeout=setTimeout(()=>finish(Error('素材解码超时，请检查文件格式')),20000);
  if(signal.aborted){abort();return}signal.addEventListener('abort',abort,{once:true});
  el.onload=()=>finish();el.onloadeddata=()=>finish();el.onerror=()=>finish(Error('素材无法解码，请替换图片或视频'));if(kind==='video'){el.preload='auto';el.muted=true}el.src=url;
})}
function resourceLabel(id){
 for(const n of project.nodes){if(n.video===id)return n.name+' / '+(n.videoName||'视频');const f=n.frames?.find(f=>f.image===id);if(f)return n.name+' / '+f.name}
 if(project.loading.video===id||project.loading.image===id)return '加载背景';if(project.splash.video===id)return '开屏动画';return id;
}
function waitResourceRetry(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted){reject(new DOMException('已取消加载','AbortError'));return}const abort=()=>{clearTimeout(timeout);reject(new DOMException('已取消加载','AbortError'))};const timeout=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true})})}
let mediaDownloadManifest;
async function downloadResource(url,signal,progress){
 const absolute=new URL(url,location.href);
 if(absolute.origin!==location.origin||!absolute.pathname.startsWith('/assets/'))return downloadSingleResource(url,signal,progress);
 mediaDownloadManifest??=fetch('media-downloads.json').then(r=>r.ok?r.json():{}).catch(()=>({}));
 const entry=(await mediaDownloadManifest)[absolute.pathname];
 if(!entry)return downloadSingleResource(url,signal,progress);
 const blobs=[];let completed=0;
 for(const part of entry.parts){
  let blob;
  for(let attempt=0;attempt<4;attempt++){
   try{blob=await downloadSingleResource(part.url,signal,loaded=>progress(completed+loaded,entry.size));if(blob.size!==part.size)throw Error('视频分片不完整');break}
   catch(error){if(signal.aborted||error.name==='AbortError'||attempt===3)throw error;await waitResourceRetry(1000*(attempt+1),signal)}
  }
  blobs.push(blob);completed+=blob.size;progress(completed,entry.size);
 }
 return new Blob(blobs,{type:entry.type});
}
async function prepareResource(task,signal,update){
 let url=asset(task.id);
 try{
  if(!media.has(task.id)&&task.id?.startsWith('asset-')){const stored=await getBlob(task.id);if(stored){url=URL.createObjectURL(stored);media.set(task.id,url)}}
  if(!url)throw Error('本机没有这份素材，请在该节点重新上传，或导入包含素材的项目 ZIP');
  if(!media.has(task.id)){
   let blob;
   for(let attempt=0;attempt<3;attempt++){
    try{blob=await downloadResource(url,signal,(loaded,total)=>{task.loaded=loaded;task.total=total;update()});break}
    catch(error){if(error.name==='AbortError'||signal.aborted)throw error;if(attempt===2)throw error;task.retry=attempt+1;update();await waitResourceRetry(750*(attempt+1),signal)}
   }
   const loadedUrl=URL.createObjectURL(blob);
   try{await decodeResource(loadedUrl,task.kind,signal)}catch(error){URL.revokeObjectURL(loadedUrl);throw error}
   if(signal.aborted){URL.revokeObjectURL(loadedUrl);throw new DOMException('已取消加载','AbortError')}
   media.set(task.id,loadedUrl);
   if(task.id.startsWith('asset-tail-video-')){try{await putAsset(task.id,blob)}catch{}}
  }else await decodeResource(url,task.kind,signal);
  task.ready=true;task.retry=0;update();
 }catch(error){if(signal.aborted||error.name==='AbortError')throw error;throw Error(resourceLabel(task.id)+'：'+error.message)}
}
async function start(full,only){
 qteAudio.unlock();
  stop();activeRun=true;const token=runToken;if(!$('#player').open)$('#player').showModal();
  if(!full){playNode(selected);return}if(only==='splash'){playSplash(token);return}
  const controller=new AbortController();loadingAbort=controller;setPlayerPhase('loading');
  $('#playerStatus').textContent='1 / 3 · 加载页面 · 正在加载实际资源';$('#playerScreen').innerHTML=loadingMarkup(project.loading);
  const loadingStarted=performance.now();
  const tasks=loadingEntries(project).map(t=>({...t,loaded:0,total:0,ready:false}));let shown=0;
  const update=()=>{
    if(token!==runToken||controller.signal.aborted)return;
    const raw=progressValue(tasks);shown=Math.max(shown,raw);
    const screen=$('#playerScreen'),bar=screen.querySelector('#loadBar'),progress=screen.querySelector('[role="progressbar"]');
    if(!bar)return;bar.style.width=shown+'%';progress.setAttribute('aria-valuenow',shown);screen.querySelector('#loadPercent').textContent=shown+'%';
    const ready=tasks.filter(t=>t.ready).length,bytes=tasks.reduce((sum,t)=>sum+t.loaded,0);
    screen.querySelector('#loadDetail').textContent=`${ready} / ${tasks.length} 项资源就绪${bytes?' · 已读取 '+formatBytes(bytes):''}${tasks.some(t=>t.retry&&!t.ready)?' · 网络重试中':''}`;
  };
  update();let cursor=0;
  try{
    await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];await prepareResource(task,controller.signal,update)}}));
    if(token!==runToken||controller.signal.aborted)return;update();loadingAbort=null;
    $('#playerScreen #loadMessage').textContent='资源加载完成';
    timer=setTimeout(()=>{
      if(token!==runToken||!activeRun)return;
      if(only==='loading'){$('#playerScreen video')?.pause();$('#playerStatus').textContent='加载页预览完成 · 所有资源已就绪';return}
      playSplash(token);
    },Math.max(0,3000-(performance.now()-loadingStarted)));
  }catch(error){
    if(token!==runToken||error.name==='AbortError')return;controller.abort();loadingAbort=null;
    $('#playerStatus').textContent='资源加载失败';$('#playerScreen #loadMessage').textContent='加载暂停';
    const detail=$('#playerScreen #loadDetail');detail.textContent=error.message;
    const retry=document.createElement('button');retry.textContent='重试加载';retry.onclick=()=>start(true,only);detail.append(retry);
  }
}

function setPlayerPhase(phase){$('#player').dataset.phase=phase}
let splashInputCleanup=null;
function clearSplashInput(){splashInputCleanup?.();splashInputCleanup=null}
function splashMarkup(c,editor=false){return `<div class="stage splash-stage">${asset(c.video)?`<video src="${esc(asset(c.video))}" playsinline loop preload="auto" ${editor?'controls':''}></video>`:scenery()}${c.title||c.subtitle?`<div class="loadcontent introtitle"><h2>${esc(c.title)}</h2><p>${esc(c.subtitle)}</p></div>`:''}<span class="start-prompt">按任意键开始</span></div>`}
function playSplash(token){
  if(token!==runToken||!activeRun)return;clearTimeout(timer);clearSplashInput();$('#playerScreen video')?.pause();setPlayerPhase('splash');
  const c=project.splash;$('#playerStatus').textContent='2 / 3 · 开屏动画 · 按任意键开始';$('#playerScreen').innerHTML=splashMarkup(c);
  let advanced=false;const v=$('#playerScreen video'),screen=$('#playerScreen .splash-stage');
  const next=()=>{if(advanced||token!==runToken||!activeRun)return;advanced=true;v?.pause();clearSplashInput();playNode(project.nodes[0].id)};
  const key=e=>{e.preventDefault();e.stopImmediatePropagation();next()};
  screen.addEventListener('click',next);document.addEventListener('keydown',key,true);
  splashInputCleanup=()=>{screen.removeEventListener('click',next);document.removeEventListener('keydown',key,true)};
  if(v){v.loop=true;v.onerror=showMediaError;v.play().catch(()=>{if(token!==runToken||advanced)return;v.muted=true;v.play().catch(()=>{if(token===runToken&&!advanced)showMediaError()})})}
}

function showPlayButton(v){const b=document.createElement('button');b.textContent='点击播放视频';b.style='position:absolute;top:20%;left:40%;z-index:15';$('#playerScreen .stage').append(b);b.onclick=()=>v.play().then(()=>b.remove()).catch(showMediaError)}
function showMediaError(){clearInterval(timer);$('#playerStatus').textContent='视频无法播放，请检查素材格式或视频链接';const box=document.createElement('div');box.className='hintbar';box.textContent='视频加载失败，请关闭试玩后替换素材。';$('#playerScreen').append(box)}
function playNode(id){clearTailQte();clearGenericMouse();clearSplashInput();setPlayerPhase('story');clearInterval(timer);$('#playerScreen video')?.pause();const n=project.nodes.find(n=>n.id===id);if(!n){finish();return}$('#playerStatus').textContent=`3 / 3 · 剧情编排 · ${n.name} · ${types[n.type]}`;$('#playerScreen').innerHTML=stage(n,false);bindCinemaPlayback(n);if(n.tailQte&&n.type==='qte'&&!usingBoards(n)){playTailQte(n);return}const overlay=$('#playerScreen .sceneoverlay');let actions=document.createElement('div');actions.className='choices';overlay.append(actions);if(n.pending&&!n.video&&!n.frames?.length){actions.innerHTML='<button>返回 Chapter 01</button>';actions.querySelector('button').onclick=()=>playNode(project.nodes[0].id);return}let time=0,shown=false,left=n.limit,continuation=null;actionDone=false;liveVideo=$('#playerScreen video');const v=liveVideo;function choose(target,success=false){if(actionDone)return;actionDone=true;if(n.type==='qte'&&shown&&success){continuation=target||'';mechanicalQteResult(overlay,true);genericResultTimer=setTimeout(()=>{overlay.querySelector('.mechanical-qte-host')?.remove();qteAudio.stop();if(v?.ended||(!v&&time>=nodeDuration(n)))playNode(continuation)},260);if(v){v.playbackRate=1;if(!v.ended)v.play().catch(()=>showPlayButton(v))}return}clearInterval(timer);v?.pause();if(n.type==='qte'&&shown){mechanicalQteResult(overlay,false);genericResultTimer=setTimeout(()=>playNode(target),260)}else playNode(target)}function show(){if(shown)return;shown=true;v?.pause();if(n.type==='none'){choose(n.next);return}if(n.type==='choice'){actions.innerHTML=n.options.map((o,i)=>`<button data-go="${i}" ${choicePosition(o)}>${esc(o.text)}</button>`).join('');actions.querySelectorAll('button').forEach(b=>b.onclick=()=>{if(actions.dataset.confirming)return;actions.dataset.confirming='true';b.classList.add('choice-confirmed');actions.querySelectorAll('button').forEach(x=>x.disabled=true);const target=n.options[+b.dataset.go].target;genericResultTimer=setTimeout(()=>{if(activeRun&&actions.isConnected)choose(target)},250)})}else{let countdown=document.createElement('div');countdown.className='countdown';countdown.id='countdown';overlay.insertBefore(countdown,actions);const b=document.createElement('button');b.textContent=n.options[0]?.text||'点击';if(n.type==='hotspot'){b.className='hotspot';b.textContent='＋';b.title=n.options[0]?.text||'点击热点';b.style.left=n.x+'%';b.style.top=n.y+'%';$('#playerScreen .stage').append(b)}else {b.hidden=true;const hint=document.createElement('div');hint.className='mechanical-qte-host';hint.innerHTML=mechanicalQteMarkup(n);qteAudio.start(n);countdown.hidden=true;overlay.append(hint);genericMouseCleanup=bindMouseQte(n,$('#playerScreen .stage'),()=>shown&&!actionDone,()=>choose(n.options[0]?.target||'',true),(text,ratio)=>updateMechanicalQte(hint,text,ratio))}b.onclick=()=>choose(n.options[0]?.target||'');$('#countdown').textContent=`剩余 ${left.toFixed(1)} 秒`}}if(v){v.onended=()=>{if(continuation!==null)playNode(continuation);else if(n.type==='none')choose(n.next);else show()};v.onerror=showMediaError;v.play().catch(()=>showPlayButton(v))}timer=setInterval(()=>{if(!activeRun)return;if(continuation!==null){if(!v){time+=.1;syncCinema($('#playerScreen .stage'),n,time,nodeDuration(n));if(usingBoards(n))paintBoard($('#playerScreen'),n,time);if(time>=nodeDuration(n))playNode(continuation)}return}if(!shown){time=v?v.currentTime:time+.1;syncCinema($('#playerScreen .stage'),n,time,nodeDuration(n));if(usingBoards(n))paintBoard($('#playerScreen'),n,time);if(n.type==='none'){if(time>=nodeDuration(n))choose(n.next)}else if(time>=qteStartTime(n,nodeDuration(n)))show()}else if(n.type==='qte'||n.type==='hotspot'){left-=.1;const c=$('#countdown');if(c)c.textContent=`剩余 ${Math.max(0,left).toFixed(1)} 秒`;updateMechanicalQte(overlay,undefined,undefined,left,n.limit);if(left<=0)choose(n.failure)}},100)}
function finish(){setPlayerPhase('complete');clearInterval(timer);$('#playerStatus').textContent='作品试玩完成';$('#playerScreen').innerHTML=`<div class="stage settingsstage">${scenery()}<div class="loadcontent introtitle"><p>THE END</p><h2>山海有归，故事未尽</h2><p>${esc(project.name)}</p><button id="again">再走一条不同的路 →</button></div></div>`;$('#again').onclick=()=>typeof cloudPlayer!=='undefined'&&cloudPlayer?startPublishedGame():start(true)}
$('#player').addEventListener('cancel',stop);
let exportingProject=false;
async function exportProject(){
 if(exportingProject)return;
 if(!saveConfiguration())return;
 exportingProject=true;const button=$('#exportProject');button.disabled=true;button.textContent='正在打包…';
 try{
  const copy=structuredClone(project),files=[],manifest={};
  const sources=[...new Set(projectAssets(copy).filter(Boolean))];
  for(let i=0;i<sources.length;i++){
   const source=sources[i];notify('正在打包素材 '+(i+1)+' / '+sources.length);
   let blob=source.startsWith('asset-')?await getBlob(source):null;
   if(!blob){const response=await fetch(asset(source)||source,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('素材读取失败：'+source);blob=await response.blob()}
   const id=source.startsWith('asset-')?source:'asset-'+crypto.randomUUID();
   const name=projectAssetName(copy,source,blob),path='assets/'+String(i+1).padStart(3,'0')+'_'+name;
   const ext=(name.match(/\.([a-z0-9]+)$/i)||source.match(/\.([a-z0-9]+)(?:[?#]|$)/i)||[])[1]?.toLowerCase();
   const type=/^(image|video)\//.test(blob.type)?blob.type:({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/mp4',ogg:'video/ogg',ogv:'video/ogg'})[ext];
   if(!type)throw Error('无法识别素材格式：'+name);
   manifest[id]={path,name,type};files.push({name:path,blob});remapProjectSource(copy,source,id);
  }
  files.unshift({name:'project.storyforge.json',blob:new Blob([JSON.stringify(copy,null,2)],{type:'application/json'})},{name:'assets.json',blob:new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'})},{name:'使用说明.txt',blob:new Blob(['project.storyforge.json：完整配置。\nassets/：原始图片与视频，未转码、未压缩。\nassets.json：配置素材 ID 与文件路径对照。\n恢复项目：在编辑器中点击“导入项目”，直接选择本 ZIP 文件。\n配置和素材需要一起保留。'])});
  const zip=await createProjectZip(files),url=URL.createObjectURL(zip),link=document.createElement('a');link.href=url;link.download=copy.name.replace(/[<>:"/\\|?*]/g,'_')+'.storyforge.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notify('已导出 ZIP：完整配置与 '+sources.length+' 份原始素材');
 }catch(error){notify('导出失败：'+(error.message||'请检查素材和可用空间'))}finally{exportingProject=false;button.disabled=false;button.textContent='导出项目 ↗'}
}
function valid(p){if(!p||p.version!==1||typeof p.name!=='string'||!Array.isArray(p.nodes)||!p.nodes.length||p.nodes.length>100||!p.loading||!p.splash)return false;const str=x=>typeof x==='string',num=(x,a,b)=>Number.isFinite(x)&&x>=a&&x<=b,source=x=>str(x)&&(!x||/^asset-[\w-]+$/.test(x)||/^https?:\/\//.test(x));if(![p.loading.title,p.loading.subtitle,p.loading.text,p.splash.title,p.splash.subtitle].every(str)||!/^#[0-9a-f]{6}$/i.test(p.loading.color)||!num(p.loading.duration,.5,30)||!num(p.splash.duration,1,120)||!['fade','zoom','none'].includes(p.splash.effect)||!source(p.loading.image)||(p.loading.video!==undefined&&!source(p.loading.video))||!source(p.splash.video))return false;const ids=new Set(p.nodes.map(n=>n.id));return ids.size===p.nodes.length&&p.nodes.every(n=>/^n[\w-]+$/.test(n.id)&&str(n.name)&&str(n.subtitle)&&source(n.video)&&num(n.duration,.001,7200)&&num(n.trigger,0,['time','linked-tail'].includes(n.qteTriggerMode)&&n.type==='qte'?7200:nodeDuration(n))&&validBoards(n)&&num(n.limit,1,120)&&num(n.x,5,95)&&num(n.y,5,95)&&Object.hasOwn(types,n.type)&&Array.isArray(n.options)&&n.options.length<=6&&(n.type==='none'||n.options.length>0)&&n.options.every(o=>str(o.text)&&(o.target===''||ids.has(o.target)))&&(!n.failure||ids.has(n.failure))&&(!n.next||ids.has(n.next)))}
$('#projectFile').onchange=async e=>{
 let importing=false;
 try{
  const f=e.target.files[0];if(!f)return;if(importBusy||pendingAssetWrites)throw Error('请等待当前素材导入完成');
  importBusy=true;importing=true;
  let p,assets=[];
  if(/\.zip$/i.test(f.name)){
   const entries=await readProjectZip(f);p=JSON.parse(await entries.get('project.storyforge.json').text());
   const manifest=JSON.parse(await entries.get('assets.json').text());
   repairTiming(p);if(!valid(p))throw Error('项目配置无效');
   for(const id of new Set(projectAssets(p).filter(x=>x?.startsWith('asset-')))){
    const item=manifest[id],blob=item&&entries.get(item.path);if(!blob)throw Error('项目包缺少素材：'+id);
    if(!/^(image|video)\//.test(item.type))throw Error('素材类型无效');
    assets.push([id,new File([blob],item.name||item.path.split('/').pop(),{type:item.type})]);
   }
  }else{
   p=JSON.parse(await f.text());repairTiming(p);if(!valid(p))throw Error('项目格式不正确或存在无效节点');
   for(const [id,data] of Object.entries(p.assets||{})){
    if(!/^asset-[\w-]+$/.test(id)||typeof data!=='string'||!/^data:(video|image)\//.test(data))throw Error('素材格式无效');
    const [meta,b64]=data.split(','),bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));assets.push([id,new Blob([bytes],{type:meta.split(':')[1].split(';')[0]})]);
   }
   delete p.assets;
  }
  // Use fresh asset IDs so an interrupted import cannot overwrite the current project.
  for(const [id,blob] of assets){const fresh='asset-'+crypto.randomUUID();await putAsset(fresh,blob);remapProjectSource(p,id,fresh)}
  if(activeRun){stop();$('#player').close()}project=p;selected=p.nodes[0].id;page='story';save();render();notify('项目配置和素材已导入');
 }catch(err){notify(err.message||'导入失败')}finally{if(importing)importBusy=false;e.target.value=''}
};
let boardTimer=null,boardUploadTarget=null;
function usingBoards(n){return n.previewSource==='boards'&&!!n.frames?.length}
function nodeDuration(n){return usingBoards(n)?Math.round(n.frames.reduce((t,f)=>t+f.duration,0)*10)/10:n.duration}
function projectAssets(p){return [p.loading.image,p.loading.video,p.splash.video,...p.nodes.flatMap(n=>[n.video,...(n.frames||[]).map(f=>f.image)])]}
function validBoards(n){return (n.previewSource===undefined||['video','boards'].includes(n.previewSource))&&(n.frames===undefined||(Array.isArray(n.frames)&&n.frames.length<=100&&n.frames.every(f=>f&&typeof f.id==='string'&&/^f[\w-]+$/.test(f.id)&&typeof f.name==='string'&&typeof f.image==='string'&&/^asset-[\w-]+$/.test(f.image)&&Number.isFinite(f.duration)&&f.duration>=.5&&f.duration<=600)&&new Set(n.frames.map(f=>f.id)).size===n.frames.length))}
function boardAt(n,time){let end=0;for(let i=0;i<n.frames.length;i++){end+=n.frames[i].duration;if(time<end-0.00001)return i}return n.frames.length-1}
function nodeMarkup(n){return usingBoards(n)?`<img class="backimage boardimage" src="${esc(asset(n.frames[0].image))}" alt="${esc(n.frames[0].name)}"><span class="boardcounter">分镜 1 / ${n.frames.length}</span>`:videoMarkup(asset(n.video)).replace('<video ',n.grayscale?'<video class="grayscale-video" ':'<video ')}
function boardStrip(n){if(!n.frames?.length)return '';let time=0;return `<div class="boardstrip" aria-label="分镜时间轴">${n.frames.map((f,i)=>{let start=time;time+=f.duration;return `<button class="boardtile ${usingBoards(n)&&i===0?'selected':''}" draggable="true" data-sort-kind="frame" data-sort-node="${n.id}" data-sort-id="${esc(f.id)}" data-board-seek="${start}" title="${esc(f.name)}"><img draggable="false" src="${esc(asset(f.image))}" alt="${esc(f.name)}"><span>${String(i+1).padStart(2,'0')} · ${f.duration}s</span></button>`}).join('')}</div>`}
function boardProperties(n){return `<div class="section"><h3><span>02B</span> 分镜图片 <small class="subtle">${n.frames?.length||0} 张</small></h3><p class="subtle">同一视频节点可添加多张图片，按顺序拼接预览。</p><button class="upload full" id="uploadBoards"><strong>＋</strong>批量上传分镜图片<small>拖入多张图片或点击选择 · 每张默认 3 秒</small></button>${n.frames?.length?`${select('预览素材','previewSource',n.previewSource||'video',{video:'原视频',boards:'分镜图片序列'})}<p class="subtle">分镜总时长 ${n.frames.reduce((t,f)=>t+f.duration,0).toFixed(1)} 秒 · 交互仍按触发时间生效</p><div class="boardlist">${n.frames.map((f,i)=>`<div class="boardcard" draggable="true" data-sort-kind="frame" data-sort-node="${n.id}" data-sort-id="${esc(f.id)}" title="拖拽调整分镜顺序"><img src="${esc(asset(f.image))}" alt="${esc(f.name)}"><div><strong>${i+1}. ${esc(f.name)}</strong><label class="field">展示时长（秒）<input aria-label="分镜 ${i+1} 时长" type="number" min="0.5" max="600" step="0.5" value="${f.duration}" data-frame-duration="${i}"></label><div class="boardtools"><button data-frame-replace="${esc(f.id)}" aria-label="替换分镜 ${i+1} 图片">替换图片</button><button data-frame-move="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移分镜 ${i+1}">↑</button><button data-frame-move="${i}" data-direction="1" ${i===n.frames.length-1?'disabled':''} aria-label="下移分镜 ${i+1}">↓</button><button data-frame-remove="${i}" aria-label="移除分镜 ${i+1}">移除</button></div></div></div>`).join('')}</div>`:''}</div>`}
function paintBoard(root,n,time){const img=root.querySelector('.boardimage');if(!img||!usingBoards(n))return;const i=boardAt(n,time),f=n.frames[i];if(root.id==='editorArea'&&n.type==='choice'){const choices=root.querySelector('.choices');if(choices)choices.hidden=time<qteStartTime(n,nodeDuration(n))}if(img.dataset.frame!==f.id){img.src=asset(f.image);img.alt=f.name;img.dataset.frame=f.id}const count=root.querySelector('.boardcounter');if(count)count.textContent=`分镜 ${i+1} / ${n.frames.length}`;root.querySelectorAll('.boardtile').forEach((b,j)=>b.classList.toggle('selected',j===i))}
function toggleBoards(){if(boardTimer){clearInterval(boardTimer);boardTimer=null;$('#miniPlay').textContent='▷';return}const n=current(),seek=$('#seek');if(+seek.value>=nodeDuration(n))seek.value=0;$('#miniPlay').textContent='Ⅱ';let last=performance.now(),playhead=+seek.value;boardTimer=setInterval(()=>{const now=performance.now(),time=Math.min(nodeDuration(n),playhead+(now-last)/1000);last=now;playhead=time;seek.value=time;paintBoard($('#editorArea'),n,time);$('#timeLabel').textContent=format(time);if(time>=nodeDuration(n)){clearInterval(boardTimer);boardTimer=null;$('#miniPlay').textContent='▷'}},50)}
function showEditorBoard(node,id){
 const index=node.frames.findIndex(f=>f.id===id);
 const time=node.frames.slice(0,index).reduce((sum,f)=>sum+f.duration,0);
 paintBoard($('#editorArea'),node,time);
 $('#seek').value=time;$('#timeLabel').textContent=format(time);
}
function bindBoards(){document.querySelectorAll('[data-board-seek]').forEach(b=>b.onclick=()=>{if(!usingBoards(current())){current().previewSource='boards';current().trigger=Math.min(current().trigger,nodeDuration(current()));save();render()}const time=+b.dataset.boardSeek;$('#seek').value=time;$('#timeLabel').textContent=format(time);paintBoard($('#editorArea'),current(),time)});$('#editorArea .boardimage')?.addEventListener('error',()=>notify('分镜图片不可用，请重新上传该图片'))}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='uploadBoards'){boardUploadTarget=current().id;$('#boardFiles').click()}if(b.dataset.frameMove!==undefined){const n=current(),i=+b.dataset.frameMove,j=i+(+b.dataset.direction);if(j<0||j>=n.frames.length)return;[n.frames[i],n.frames[j]]=[n.frames[j],n.frames[i]];save();render()}if(b.dataset.frameRemove!==undefined){const n=current();n.frames.splice(+b.dataset.frameRemove,1);if(!n.frames.length)n.previewSource='video';n.trigger=Math.min(n.trigger,nodeDuration(n));save();render();notify('已移除该分镜')}});
function changeFrameDuration(e){const el=e.target;if(el.dataset.frameDuration===undefined||el.value==='')return;const n=current(),value=Number(el.value);if(!Number.isFinite(value))return;n.frames[+el.dataset.frameDuration].duration=Math.round(Math.max(.5,Math.min(600,value))*10)/10;n.trigger=Math.min(n.trigger,nodeDuration(n));save();renderArea();if(e.type==='change')renderProperties()}
document.addEventListener('input',changeFrameDuration);document.addEventListener('change',changeFrameDuration);
async function importBoards(files,n){if(!n||!files.length)return;if(files.length+(n.frames?.length||0)>100){notify('每个节点最多支持 100 张分镜图片');return}if(files.some(f=>fileKind(f)!=='image')){notify('请选择 PNG、JPG、WebP 或 GIF 图片');return}notify('正在保存分镜图片…');let added=0;try{for(const file of files){const bitmap=await createImageBitmap(file);bitmap.close();const key=crypto.randomUUID();const id='asset-'+key;await putAsset(id,file);(n.frames??=[]).push({id:'f'+key,image:id,name:file.name,duration:3});added++}}catch{notify('部分图片无法读取或保存，请检查图片和存储空间')}if(added){n.previewSource='boards';n.trigger=Math.min(n.trigger,nodeDuration(n));save();render();notify(`已添加 ${added} 张分镜，共 ${n.frames.length} 张`)} return added; }
$('#boardFiles').onchange=async e=>{const files=Array.from(e.target.files),n=project.nodes.find(n=>n.id===boardUploadTarget);e.target.value='';await importBoards(files,n)};
// Share the same import path between file pickers and operating-system drops.
function fileKind(file){
  if(/^image\/(png|jpeg|webp|gif)$/i.test(file.type))return 'image';
  if(/^video\//i.test(file.type))return 'video';
  if(!file.type){if(/\.(png|jpe?g|webp|gif)$/i.test(file.name))return 'image';if(/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name))return 'video'}
  return '';
}
function planDrop(files,zone,activePage){
  if(!files.length)return {error:'请拖入图片或视频文件，不支持文件夹或网页链接'};
  if(files.some(f=>!fileKind(f)))return {error:'包含不支持的文件，请使用 PNG、JPG、WebP、GIF 图片或视频'};
  const images=files.filter(f=>fileKind(f)==='image'),videos=files.filter(f=>fileKind(f)==='video');
  if(zone==='video'||activePage==='splash'){if(images.length||videos.length!==1)return {error:'视频区域每次只能导入一个视频，请将图片拖入分镜区域'};return {kind:'video',videos,images:[]}}
  if(activePage==='loading'&&zone==='canvas'&&videos.length===1&&!images.length)return {kind:'video',videos,images:[]};
  if(zone==='image'||activePage==='loading'){if(videos.length||images.length!==1)return {error:'加载页背景请拖入一张图片'};return {kind:'image',images,videos:[]}}
  if(zone==='boards'&&videos.length)return {error:'分镜区域仅支持图片，请将视频拖入视频区域或画布'};
  if(videos.length>1)return {error:'一个节点只能配置一个视频，请分次拖入不同节点'};
  return {kind:'story',images,videos};
}
function markDropZones(){
  for(const [selector,kind,hint] of [['#uploadVideo','video','松开导入视频'],['#uploadImage','image','松开设置背景图片'],['#uploadBoards','boards','松开添加分镜图片'],['#editorArea','canvas',page==='story'?'松开导入视频或分镜图片':page==='loading'?'松开设置加载背景图片或视频':'松开导入开屏视频']]){
    const el=$(selector);if(el){el.dataset.dropZone=kind;el.dataset.dropHint=hint}
  }
}
let importBusy=false;
let replacementTarget=null;
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-frame-replace]');if(!button)return;
 replacementTarget={node:current(),frameId:button.dataset.frameReplace};
 $('#replaceBoardFile').click();
});
async function replaceBoardImage(file,target){
 if(!file||!target)return false;
 if(importBusy){notify('素材正在导入，请稍候');return false}
 if(fileKind(file)!=='image'){notify('请选择 PNG、JPG、WebP 或 GIF 图片');return false}
 const {node,frameId}=target;
 if(!project.nodes.includes(node)||!node.frames?.some(f=>f.id===frameId)){notify('原分镜已移除，请重新选择');return false}
 importBusy=true;
 try{
  const bitmap=await createImageBitmap(file);bitmap.close();
  const id='asset-'+crypto.randomUUID();await putAsset(id,file);
  const frame=node.frames?.find(f=>f.id===frameId);
  if(!project.nodes.includes(node)||!frame){notify('原分镜已移除，未替换其他分镜');return false}
  frame.image=id;frame.name=file.name;
  save();render();
  if(page==='story'&&current()===node&&usingBoards(node)){
   const time=node.frames.slice(0,node.frames.indexOf(frame)).reduce((sum,f)=>sum+f.duration,0);
   paintBoard($('#editorArea'),node,time);
   if($('#seek'))$('#seek').value=time;if($('#timeLabel'))$('#timeLabel').textContent=format(time);
  }
  notify('分镜图片已替换，顺序、时长和交互保持不变');return true;
 }catch{notify('图片替换失败，原分镜已保留');return false}finally{importBusy=false}
}
$('#replaceBoardFile').onchange=async e=>{
 const file=e.target.files[0],target=replacementTarget;replacementTarget=null;e.target.value='';
 await replaceBoardImage(file,target);
};
function clearDropHighlight(){document.querySelectorAll('.drop-active').forEach(el=>el.classList.remove('drop-active'))}
function isFileDrag(e){return Array.from(e.dataTransfer?.types||[]).includes('Files')}
function dropZone(e){return e.target instanceof Element?e.target.closest('[data-drop-zone]'):null}
document.addEventListener('dragover',e=>{
  if(!isFileDrag(e))return;e.preventDefault();const zone=dropZone(e);clearDropHighlight();
  const enabled=zone&&!importBusy&&!$('#player').open;
  e.dataTransfer.dropEffect=enabled?'copy':'none';if(enabled)zone.classList.add('drop-active');
});
document.addEventListener('dragleave',e=>{const zone=dropZone(e);if(zone&&!zone.contains(e.relatedTarget))zone.classList.remove('drop-active');if(!e.relatedTarget)clearDropHighlight()});
document.addEventListener('dragend',clearDropHighlight);
window.addEventListener('blur',clearDropHighlight);
document.addEventListener('drop',async e=>{
  if(!isFileDrag(e)&&!e.dataTransfer?.files?.length)return;
  e.preventDefault();clearDropHighlight();const zone=dropZone(e);
  if($('#player').open){notify('请先关闭试玩，再拖入素材');return}
  if(!zone){notify('请将文件拖到画布或对应的上传区域');return}
  if(importBusy){notify('素材正在导入，请稍候');return}
  const files=Array.from(e.dataTransfer.files),activePage=page;
  const plan=planDrop(files,zone.dataset.dropZone,activePage);
  if(plan.error){notify(plan.error);return}
  const dest=activePage==='story'?current():project[activePage];
  if((dest.frames?.length||0)+plan.images.length>100&&plan.kind==='story'){notify('每个节点最多支持 100 张分镜图片');return}
  importBusy=true;
  try{
    if(plan.kind==='image')await upload(plan.images[0],'image',dest);
    else if(plan.kind==='video')await upload(plan.videos[0],'video',dest);
    else{
      let videoAdded=false;
      if(plan.videos.length)videoAdded=await upload(plan.videos[0],'video',dest);
      const imageCount=plan.images.length?await importBoards(plan.images,dest):0;
      if(videoAdded&&imageCount)notify(`视频与 ${imageCount} 张分镜已导入，当前预览分镜`);
    }
  }catch{notify('导入失败，请检查素材后重试')}finally{importBusy=false;clearDropHighlight()}
});



function configureChapterOne(p){
 if(p.chapter01Revision)return false;
 const chapter=p.nodes[0];
 const branches=[1,2].map(i=>{let id='n-chapter01-branch'+i;while(p.nodes.some(n=>n.id===id))id+='x';return {id,name:'分支'+(i===1?'一':'二')+'（待配置）',subtitle:'该分支的剧情尚未配置，可在编辑器中添加图片或视频。',duration:8,trigger:8,type:'none',limit:8,video:'',options:[],failure:'',next:'',x:50,y:50,pending:true}});
 Object.assign(chapter,{name:'Chapter 01',subtitle:'',duration:12,trigger:12,type:'choice',previewSource:'boards',cleanPresentation:true,frames:[1,2,3,4].map(i=>({id:'f-chapter01-'+i,image:'asset-chapter01-0'+i,name:'Chapter 01 · 分镜 0'+i,duration:3})),options:branches.map((n,i)=>({text:i===0?'选项一':'选项二',target:n.id}))});
 p.nodes.push(...branches);p.chapter01Revision=1;return true;
}

async function init(){if(typeof cloudPlayer!=='undefined'&&cloudPlayer){await bootPublishedGame();return}try{if(await loadEditorDeployment()){watchEditorDeployment();return}}catch(error){notify('云端读取失败：'+error.message+'；当前仅打开本机草稿')}try{const p=JSON.parse(localStorage.getItem('storyforge-project'));repairTiming(p);if(valid(p))project=p}catch{}if(project.name==='雾隐 · 山海之间'){project.name='万象环轨';save()}if(configureChapterOne(project))save();if(installNineVideos(project))save();if(applyQteTimingDefaults(project))save();if(installDeathNode(project))save();if(installLinkedTailTiming(project))save();if(installMouseQte(project))save();if(installTailUx(project))save();if(installCinema(project))save();if(migrateCinemaTimeline(project))save();if(installCinemaWidthB(project))save();if(installBranchGrayscale(project))save();selected=project.nodes[0].id;page='loading';render();if(!project.loading.coverRevision){Object.assign(project.loading,{image:COVER_ID,title:'',subtitle:'',text:'正在加载资源',color:'#e5d6b1',coverRevision:1});save()}if(!project.loading.titleRevision){Object.assign(project.loading,{title:'万象环轨',titleLayout:'square',titleRevision:1});save()}try{const cover=await getBlob(COVER_ID);if(!cover){const response=await fetch('assets/loading-cover.png');if(response.ok)await putAsset(COVER_ID,new Blob([await response.blob()],{type:'image/png'}))}else if(cover.type!=='image/png')await putAsset(COVER_ID,new Blob([cover],{type:'image/png'}))}catch{}if(!project.splash.openingRevision){Object.assign(project.splash,{title:'',subtitle:'',video:'asset-opening-v1',videoName:'cgt-20260911152112-z8h9n.mp4',openingRevision:1,waitForStart:true,skip:false});save()}try{if(!await getBlob('asset-opening-v1')){const response=await fetch('assets/opening.mp4');if(response.ok)await putAsset('asset-opening-v1',new Blob([await response.blob()],{type:'video/mp4'}))}}catch{}if(!project.loading.videoRevision){Object.assign(project.loading,{video:'asset-loading-video-v1',videoName:'cgt-20260911164747-ct8t8.mp4',videoRevision:1});save()}try{if(!await getBlob('asset-loading-video-v1')){const response=await fetch('assets/loading-background.mp4');if(response.ok)await putAsset('asset-loading-video-v1',new Blob([await response.blob()],{type:'video/mp4'}))}}catch{}for(let i=1;i<=4;i++){const id='asset-chapter01-0'+i;try{if(!await getBlob(id)){const response=await fetch('assets/chapter01-0'+i+'.png');if(response.ok)await putAsset(id,new Blob([await response.blob()],{type:'image/png'}))}}catch{}}for(const id of new Set(projectAssets(project).filter(x=>x?.startsWith('asset-')))){const b=await getBlob(id);if(b)media.set(id,URL.createObjectURL(b))}render();watchEditorDeployment()}init();

// Keep IME composition intact; commit only the completed text.
document.addEventListener('compositionstart',e=>{if(e.target.matches('input,textarea'))e.target.dataset.composing='true'});
document.addEventListener('compositionend',e=>{if(e.target.matches('input,textarea')){delete e.target.dataset.composing;e.target.dispatchEvent(new Event('input',{bubbles:true}))}});

function installBranchGrayscale(p){if(p.branchGrayscaleRevision===1)return false;for(const n of p.nodes)if(/^asset-tail-video-[1-9]$/.test(n.video||'')||/^n-tail-video-[1-9]x*$/.test(n.id)||/^[1-9]\.mp4$/i.test(n.videoName||''))n.grayscale=true;p.branchGrayscaleRevision=1;return true}



