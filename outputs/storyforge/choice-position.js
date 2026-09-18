// Offsets are stored in canvas-width units so editor and player scale identically.
function choicePosition(o){const p=o.uiOffset;return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?`style="translate:${p.x}cqw ${p.y}cqw"`:''}
function choicePositionFields(o,i){const p=o.uiOffset||{x:0,y:0};return `<div class="row choice-position-fields">${choicePositionField('横向偏移 %',i,'x',p.x)}${choicePositionField('纵向偏移 %',i,'y',p.y)}</div>`}
function choicePositionField(label,i,axis,value){return `<label class="field">${label}<input type="number" min="-100" max="100" step="0.1" value="${Number(value).toFixed(1)}" data-option-position="${axis}" data-option="${i}"></label>`}
function syncChoicePositionInputs(i,o){const p=o.uiOffset||{x:0,y:0};document.querySelectorAll(`[data-option="${i}"][data-option-position]`).forEach(input=>{if(input!==document.activeElement)input.value=Number(p[input.dataset.optionPosition]||0).toFixed(1)})}
function updateChoicePosition(i,axis,value){const o=current().options[i];if(!o||!['x','y'].includes(axis)||!Number.isFinite(value))return;const p=o.uiOffset||{x:0,y:0};o.uiOffset={x:p.x,y:p.y,[axis]:+Math.max(-100,Math.min(100,value)).toFixed(3)};if(o.uiOffset.x===0&&o.uiOffset.y===0)delete o.uiOffset;save();renderArea()}
function bindChoicePositions(){
 if(page!=='story'||graph||current().type!=='choice')return;
 const stage=document.querySelector('#editorArea .stage');if(!stage)return;
 stage.querySelectorAll('.choices button').forEach((button,i)=>{
  const n=current(),o=n.options[i];if(!o)return;
  button.classList.add('choice-draggable');button.tabIndex=0;button.title='拖动调整此选项的位置；方向键微调；双击恢复默认位置';
  function paint(){const p=o.uiOffset||{x:0,y:0};button.style.translate=`${p.x}cqw ${p.y}cqw`;syncChoicePositionInputs(i,o)}
  function shift(x,y){const s=stage.getBoundingClientRect(),b=button.getBoundingClientRect(),old=o.uiOffset||{x:0,y:0};const dx=Math.max(s.left-b.left,Math.min(s.right-b.right,x));const dy=Math.max(s.top-b.top,Math.min(s.bottom-b.bottom,y));o.uiOffset={x:+(old.x+dx/s.width*100).toFixed(3),y:+(old.y+dy/s.width*100).toFixed(3)};paint()}
  button.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();button.focus({preventScroll:true});const before=o.uiOffset?{...o.uiOffset}:null;let x=e.clientX,y=e.clientY;button.setPointerCapture(e.pointerId);button.classList.add('is-positioning');
   function move(ev){if(ev.pointerId!==e.pointerId)return;shift(ev.clientX-x,ev.clientY-y);x=ev.clientX;y=ev.clientY}
   function end(ev){if(ev.pointerId!==e.pointerId)return;if(ev.type==='pointercancel'){if(before)o.uiOffset=before;else delete o.uiOffset;paint()}button.classList.remove('is-positioning');button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);save()}
   button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
  });
  button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation()});
  button.addEventListener('dblclick',()=>{delete o.uiOffset;paint();save();notify('此选项已恢复默认位置')});
  button.addEventListener('keydown',e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?10:1;shift(d[0]*step,d[1]*step);save()});
 });
}

function syncEditorChoices(time){if(page!=='story'||current().type!=='choice')return;const el=document.querySelector('#editorArea .choices');if(el)el.hidden=time<qteStartTime(current(),nodeDuration(current()))}
document.addEventListener('click',e=>{if(!e.target.closest('.choice-time-marker'))return;const seek=document.querySelector('#seek');if(seek){seek.value=qteStartTime(current(),nodeDuration(current()));seek.dispatchEvent(new Event('input',{bubbles:true}))}});
