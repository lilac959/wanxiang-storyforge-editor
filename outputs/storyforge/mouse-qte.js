const mouseQteTypes={click:'单击画面',multi:'连续点击',up:'向上滑动',down:'向下滑动',left:'向左滑动',right:'向右滑动',hold:'长按'};
function installMouseQte(p){if(p.mouseQteRevision)return false;for(const n of p.nodes)if(n.type==='qte'){n.qteGesture='click';n.qteClicks=5;n.qteHold=1.5;n.qteDistance=80;if(n.options[0])n.options[0].text='单击画面'}p.mouseQteRevision=1;return true}
function mouseQteProperties(n){return `${field('UI 大小（%）','qteScale',n.qteScale||100,'number','min="40" max="180" step="5"')}${field('动作提示','qteHint',n.qteHint||'')}${select('QTE 音效','qteSound',n.qteSound||'heartbeat',{heartbeat:'心跳 + 机械反馈',off:'关闭'})}${field('音效音量（0–1）','qteVolume',n.qteVolume??.35,'number','min="0" max="1" step="0.05"')}${select('鼠标交互','qteGesture',n.qteGesture||'click',mouseQteTypes)}${n.qteGesture==='multi'?field('连续点击次数','qteClicks',n.qteClicks||5,'number','min="2" max="30" step="1"'):''}${n.qteGesture==='hold'?field('长按时长（秒）','qteHold',n.qteHold||1.5,'number','min="0.2" max="4" step="0.1"'):''}${['up','down','left','right'].includes(n.qteGesture)?field('滑动距离（像素）','qteDistance',n.qteDistance||80,'number','min="20" max="400" step="10"'):''}`}
function bindMouseQte(n,root,active,success,progress){
 const mode=n.qteGesture||'click';let pointer=null,count=0,holdTimer=null,started=0;
 const clear=()=>{clearInterval(holdTimer);holdTimer=null;pointer=null};
 function down(e){if(!active()||e.button!==0||pointer!==null||e.target.closest('button'))return;e.preventDefault();pointer={id:e.pointerId,x:e.clientX,y:e.clientY};root.setPointerCapture?.(e.pointerId);started=performance.now();if(typeof qteAudio!=='undefined')qteAudio.input(mode);
  if(mode==='hold')holdTimer=setInterval(()=>{if(!active()){clear();return}const elapsed=(performance.now()-started)/1000;progress('长按 '+Math.min(elapsed,n.qteHold||1.5).toFixed(1)+' / '+(n.qteHold||1.5)+' 秒',elapsed/(n.qteHold||1.5));if(elapsed>=(n.qteHold||1.5)){clear();success()}},30);
 }
 function up(e){if(!pointer||pointer.id!==e.pointerId)return;const p=pointer;clear();if(!active())return;e.preventDefault();
  const dx=e.clientX-p.x,dy=e.clientY-p.y,dist=Math.hypot(dx,dy);
  if(mode==='click'&&dist<20)success();
  else if(mode==='multi'&&dist<20){count++;progress('点击 '+count+' / '+(n.qteClicks||5),count/(n.qteClicks||5));if(count>=(n.qteClicks||5))success()}
  else if(mode==='hold')progress('松开已重置，请持续长按',0);
  else {const limit=n.qteDistance||80;const valid=(mode==='up'&&-dy>=limit&&Math.abs(dy)>Math.abs(dx))||(mode==='down'&&dy>=limit&&Math.abs(dy)>Math.abs(dx))||(mode==='left'&&-dx>=limit&&Math.abs(dx)>Math.abs(dy))||(mode==='right'&&dx>=limit&&Math.abs(dx)>Math.abs(dy));if(valid)success()}
 }
 function move(e){if(!pointer||pointer.id!==e.pointerId||!active()||!['up','down','left','right'].includes(mode))return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;const d={up:-dy,down:dy,left:-dx,right:dx}[mode];progress('按住并沿箭头滑动',Math.max(0,Math.min(1,d/(n.qteDistance||80))))}root.addEventListener('pointermove',move);root.addEventListener('pointerdown',down);root.addEventListener('pointerup',up);function cancel(){clear();if(active()&&mode==='hold')progress('松开已重置，请持续长按',0)}root.addEventListener('pointercancel',cancel);root.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
 return ()=>{clear();root.removeEventListener('pointermove',move);root.removeEventListener('pointerdown',down);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',cancel);root.removeEventListener('lostpointercapture',cancel);window.removeEventListener('blur',cancel)};
}

let genericMouseCleanup=null,genericResultTimer=null;function clearGenericMouse(){clearTimeout(genericResultTimer);if(typeof qteAudio!=='undefined')qteAudio.stop();if(genericMouseCleanup)genericMouseCleanup();genericMouseCleanup=null}

// Shared mechanical HUD for the editor, video QTE and storyboard QTE.
function mechanicalQteMarkup(n){
 const mode=n.qteGesture||'click',paths={right:'M50 50 H79 M70 41 L79 50 L70 59',left:'M50 50 H21 M30 41 L21 50 L30 59',up:'M50 50 V21 M41 30 L50 21 L59 30',down:'M50 50 V79 M41 70 L50 79 L59 70',multi:'M43 50 H57 M50 43 V57',click:'M43 50 H57 M50 43 V57',hold:'M44 55 V43 Q44 38 48 40 V33 Q48 28 52 31 V43 Q57 37 59 43 L60 56 Q57 65 49 64 L39 53 Q36 47 41 48 Z'};
 return `<div class="mechanical-qte psd-qte" data-mode="${mode}" style="--ui-scale:${(Number(n.qteScale)||100)/100};left:${Number(n.x)||65}%;top:${Number(n.y)||50}%" role="group" aria-label="${mouseQteTypes[mode]||'点击'}"><div class="psd-qte-surface">${n.qteHint?`<span class="qte-action-hint">${esc(n.qteHint)}</span>`:''}<div class="psd-qte-tile"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="psd-ring" cx="50" cy="50" r="34"/><circle class="psd-progress" cx="50" cy="50" r="34" pathLength="100"/><path class="psd-glyph" d="${paths[mode]||paths.click}"/></svg>${mode==='multi'?'<div class="qte-segments">'+Array.from({length:Math.min(30,n.qteClicks||5)},()=>'<i></i>').join('')+'</div>':''}</div></div><span class="gesture-progress sr-only">${mouseQteTypes[mode]}</span><small class="qte-time-label sr-only">${Number(n.limit)||4} 秒</small></div>`;
}
function updateMechanicalQte(root,text,ratio,remaining,total){
 const hud=root.matches?.('.mechanical-qte')?root:root.querySelector('.mechanical-qte');if(!hud)return;
 if(text!==undefined)hud.querySelector('.gesture-progress').textContent=text;
 if(ratio!==undefined){if(typeof qteAudio!=='undefined'&&hud.dataset.mode==='hold')qteAudio.progress(ratio);ratio=Math.max(0,Math.min(1,ratio));hud.style.setProperty('--qte-progress',ratio*100);const bars=hud.querySelectorAll('.qte-segments i');bars.forEach((b,i)=>b.classList.toggle('filled',i<Math.round(ratio*bars.length)))}
 if(remaining!==undefined){hud.style.setProperty('--qte-time',Math.max(0,remaining/total)*100);hud.querySelector('.qte-time-label').textContent=Math.max(0,remaining).toFixed(1)+' 秒';hud.classList.toggle('urgent',remaining<=1)}
}
function mechanicalQteResult(root,ok){if(typeof qteAudio!=='undefined')qteAudio.result(ok);const hud=root.querySelector('.mechanical-qte');if(hud){hud.classList.add(ok?'qte-success':'qte-failed');updateMechanicalQte(hud,ok?'锁定成功':'操作超时',ok?1:0)}}
