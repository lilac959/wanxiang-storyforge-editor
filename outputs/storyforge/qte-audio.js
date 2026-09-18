// Locally synthesized cues: no remote downloads or copyrighted samples.
const qteAudio=(()=>{
 let context=null,bus=null,heartbeat=null,current=null,voices=new Set(),lastProgress=0;
 function unlock(){try{if(!context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;context=new Audio();bus=context.createGain();bus.connect(context.destination)}if(context.state!=='running')return context.resume().catch(()=>{});return Promise.resolve()}catch{}}
 function tone(frequency,end,duration,volume=.2,delay=0,type='sine'){
  if(!context||context.state!=='running'||!current)return;
  const osc=context.createOscillator(),gain=context.createGain(),at=context.currentTime+delay;
  osc.type=type;osc.frequency.setValueAtTime(frequency,at);osc.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);
  gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume),at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
  osc.connect(gain);gain.connect(bus);voices.add(osc);osc.onended=()=>{voices.delete(osc);osc.disconnect();gain.disconnect()};osc.start(at);osc.stop(at+duration+.02);
 }
 function stop(){clearTimeout(heartbeat);heartbeat=null;for(const osc of voices){try{osc.stop()}catch{}}voices.clear();current=null}
 function start(n){stop();if(n.qteSound==='off')return;unlock();current={began:performance.now(),limit:Number(n.limit)||4};lastProgress=0;if(bus)bus.gain.value=Math.max(0,Math.min(1,Number(n.qteVolume??.35)));
  function beat(){if(!current)return;const urgency=Math.min(1,(performance.now()-current.began)/(current.limit*1000));tone(110,55,.2,.6);tone(180,85,.14,.22,0,'triangle');tone(90,48,.16,.42,.2);tone(150,75,.12,.15,.2,'triangle');heartbeat=setTimeout(beat,900-urgency*440)}beat();
 }
 function input(kind){if(kind==='hold')tone(150,260,.18,.09);else tone(600,180,.06,.11,0,'triangle')}
 function progress(value){if(value>=lastProgress+.25){lastProgress=value;tone(260+value*120,300+value*120,.07,.055)}if(value===0)lastProgress=0}
 function result(ok){clearTimeout(heartbeat);heartbeat=null;if(ok){tone(420,620,.13,.14,0,'triangle');tone(720,900,.17,.1,.08)}else tone(150,36,.24,.2)}
 if(typeof document!=='undefined'){for(const event of ['pointerdown','pointerup','click','keydown'])document.addEventListener(event,unlock,{capture:true});}
 return {start,stop,input,progress,result,unlock};
})();
function installTailUx(p){
 if(p.tailUxRevision===1)return false;
 const presets=[['right','向右闪避',68,46],['up','向上跃起',67,43],['down','下滑避开横扫',70,48],['left','向左侧身闪避',32,47],['right','向右避开重击',70,48],['up','向上脱离攻击',33,43],['hold','长按稳住身形',72,48],['multi','连续点击 · 拉拽脱险',68,52],['hold','长按撑地起身',70,42]];
 for(const n of p.nodes){const match=/^asset-tail-video-(\d+)$/.exec(n.video||'')||/chapter01-branch-(\d+)\.mp4/.exec(n.video||'');if(!match||n.type!=='qte'||!n.tailQte)continue;const config=presets[Number(match[1])-1];if(!config)continue;const [mode,hint,x,y]=config;Object.assign(n,{qteGesture:mode,qteHint:hint,x,y,qteClicks:5,qteHold:1.5,qteDistance:80,qteSound:'heartbeat',qteVolume:.35});if(n.options[0])n.options[0].text=mouseQteTypes[mode]}
 p.tailUxRevision=1;return true;
}
