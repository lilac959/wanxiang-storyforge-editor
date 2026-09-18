function syncTailTiming(n,key){if(!n.tailQte||n.type!=='qte')return;if(n.qteTriggerMode!=='linked-tail')return;const value=Number(key==='qteTail'?n.qteTail:n.trigger);if(!Number.isFinite(value))return;n.trigger=n.qteTail=Math.max(.1,Math.min(120,value))}
function installLinkedTailTiming(p){if(p.linkedTailRevision===1)return false;for(const n of p.nodes)if(n.tailQte&&n.type==='qte'){n.qteTriggerMode='linked-tail';n.trigger=2;n.qteTail=2}p.linkedTailRevision=1;return true}
function qteStartTime(n,duration){return n.qteTriggerMode==='linked-tail'?Math.max(0,duration-n.trigger):n.trigger}
function installDeathNode(p){
 if(p.deathNodeRevision===1)return false;
 let id='n-death';while(p.nodes.some(n=>n.id===id))id+='x';
 p.nodes.push({id,name:'死亡',subtitle:'挑战失败。你的旅程在此刻终止。',duration:8,trigger:0,type:'choice',limit:4,video:'',options:[{text:'重新开始',target:p.nodes[0].id}],failure:'',x:50,y:50,deathScreen:true});
 for(const n of p.nodes)if(n.type==='qte'){n.failure=id;n.qteFailure='branch'}
 p.deathNodeRevision=1;return true;
}
function deathMarkup(n,actions){return `<div class="stage death-stage" id="sceneStage">${nodeMarkup(n)}<div class="sceneoverlay"><span class="death-emblem">◇</span><span class="chapter">万象环轨</span><h2>${esc(n.name)}</h2><p>${esc(n.subtitle)}</p>${actions?'<div class="choices">'+n.options.map(o=>'<button tabindex="-1">'+esc(o.text)+'</button>').join('')+'</div>':''}</div></div>`}
function applyQteTimingDefaults(p){if(p.qteTimingRevision===1)return false;for(const n of p.nodes){if(n.type==='qte'){n.trigger=2;n.limit=4;n.qteTriggerMode='time'}}p.qteTimingRevision=1;return true}
let tailCleanup=null;
function clearTailQte(){if(tailCleanup){tailCleanup();tailCleanup=null}}
function installNineVideos(p){
 if(p.nineVideosRevision)return false;
 const lengths=[1.37,7.338,3.669,1.951,5.271,6.014,25.635,14.745,14.513];
 const ids=lengths.map((_,i)=>{let id='n-tail-video-'+(i+1);while(p.nodes.some(n=>n.id===id))id+='x';return id});
 const nodes=lengths.map((duration,i)=>({id:ids[i],name:'Chapter 01 · 分支剧情 '+(i+1),subtitle:'',duration,trigger:Math.max(0,duration-2),type:'qte',limit:8,video:'asset-tail-video-'+(i+1),videoName:(i+1)+'.mp4',previewSource:'video',cleanPresentation:true,options:[{text:'按空格',target:ids[i+1]||''}],failure:'',x:50,y:50,tailQte:true,qteKey:'Space',qteTail:Math.min(2,duration),qteRate:.25,qteFailure:'retry'}));
 const entry=p.nodes[0];if(!entry.options?.length)return false;
 entry.options[0].target=ids[0];p.nodes.push(...nodes);p.nineVideosRevision=1;return true;
}
function tailQteProperties(n){if(!n.tailQte||n.type!=='qte')return '';return `<div class="section"><h3>片尾慢放 QTE</h3>${mouseQteProperties(n)}${field('末尾慢放范围（原视频秒数）','qteTail',n.qteTail,'number','min="0.1" max="120" step="0.1"')}${field('慢放倍速','qteRate',n.qteRate,'number','min="0.0625" max="1" step="0.05"')}${select('超时处理','qteFailure',n.qteFailure,{branch:'跳转到下方超时目标'})}<p class="subtle">触发时机与末尾慢放范围联动：进入最后指定秒数时，同步慢放并显示 QTE。短片从开头触发；响应时限独立计时。</p></div>`}
function playTailQte(n){
 const video=$('#playerScreen video'),overlay=$('#playerScreen .sceneoverlay');
 if(!video)return;
 const panel=document.createElement('div');panel.className='mechanical-qte-host';panel.hidden=true;overlay.append(panel);
 const label=mouseQteTypes[n.qteGesture||'click'];
 let phase='normal',remaining=Number(n.limit)||8,last=performance.now(),frame=0,resultTimer=null;
 const slowStart=()=>Math.max(0,video.duration-Math.max(.1,Number(n.qteTail)||2));
 const tail=()=>n.qteTriggerMode==='linked-tail'?qteStartTime(n,video.duration):n.qteTriggerMode==='time'?Math.min(video.duration,Math.max(0,Number(n.trigger)||0)):slowStart();
 function enter(){if(phase!=='normal')return;phase='qte';qteAudio.start(n);remaining=Number(n.limit)||8;last=performance.now();video.playbackRate=Math.max(.0625,Math.min(1,Number(n.qteRate)||.25));panel.hidden=false;panel.innerHTML=mechanicalQteMarkup(n)}
 function advance(){if(phase!=='resolved')return;phase='done';playNode(n.options[0]?.target||'')}
 function succeed(){if(phase!=='qte')return;phase='resolved';cancelAnimationFrame(frame);video.playbackRate=1;mechanicalQteResult(panel,true);resultTimer=setTimeout(()=>{panel.hidden=true;qteAudio.stop();if(video.ended)advance()},260);if(!video.ended)video.play().catch(()=>showPlayButton(video))}
 function fail(){phase='done';video.pause();mechanicalQteResult(panel,false);resultTimer=setTimeout(()=>playNode(n.failure||''),260)}
 function tick(now){
  syncCinema($('#playerScreen .stage'),n,video.currentTime,Number.isFinite(video.duration)?video.duration:nodeDuration(n));
  if(phase==='normal'&&Number.isFinite(video.duration)){if(video.currentTime>=slowStart())video.playbackRate=Math.max(.0625,Math.min(1,Number(n.qteRate)||.25));if(video.currentTime>=tail())enter()}
  if(phase==='qte'){
   remaining-=(now-last)/1000;
   updateMechanicalQte(panel,undefined,undefined,remaining,Number(n.limit)||8);
   if(remaining<=0){fail();if(phase==='done')return}
  }
  last=now;if(phase==='normal'||phase==='qte')frame=requestAnimationFrame(tick);
 }
 const unbindMouse=bindMouseQte(n,$('#playerScreen .stage'),()=>phase==='qte',succeed,(text,ratio)=>updateMechanicalQte(panel,text,ratio));
 video.onended=()=>{if(phase==='resolved')advance();else if(phase==='normal')enter()};video.onerror=showMediaError;
 video.onloadedmetadata=()=>{if(tail()===0)enter()};
 tailCleanup=()=>{qteAudio.stop();phase='done';clearTimeout(resultTimer);cancelAnimationFrame(frame);unbindMouse();video.pause();video.playbackRate=1};
 video.play().catch(()=>showPlayButton(video));frame=requestAnimationFrame(tick);
}
