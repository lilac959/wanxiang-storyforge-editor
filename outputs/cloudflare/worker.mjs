import media from './media-manifest.json' with {type:'json'};
export default {
 async fetch(request,env){
  const url=new URL(request.url),entry=media[url.pathname];
  if(!entry)return env.ASSETS.fetch(request);
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  let start=0,end=entry.size-1,status=200;
  const range=request.headers.get('Range');
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+entry.size}});
   if(!match[1])start=Math.max(0,entry.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]))}
   if(start>end||start>=entry.size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+entry.size}});status=206;
  }
  const headers={'Content-Type':entry.type,'Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600',ETag:entry.etag};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${entry.size}`;
  if(request.method==='HEAD')return new Response(null,{status,headers});
  let offset=0;const pieces=[];
  for(const part of entry.parts){if(offset<=end&&offset+part.size>start)pieces.push({...part,from:Math.max(0,start-offset),to:Math.min(part.size-1,end-offset)});offset+=part.size}
  let index=0,reader;
  const body=new ReadableStream({
   async pull(controller){
    try{
     while(true){
      if(!reader){if(index>=pieces.length){controller.close();return}const p=pieces[index++];const r=await env.ASSETS.fetch(new Request(new URL(p.url,url),{headers:{Range:`bytes=${p.from}-${p.to}`}}));
       if(!r.ok||!r.body)throw Error('Missing video part');
       if(r.status===200&&(p.from!==0||p.to!==p.size-1)){const b=await r.arrayBuffer();controller.enqueue(new Uint8Array(b,p.from,p.to-p.from+1));return}
       reader=r.body.getReader();
      }
      const result=await reader.read();if(result.done){reader=null;continue}controller.enqueue(result.value);return;
     }
    }catch(error){controller.error(error)}
   },async cancel(){if(reader)await reader.cancel()}
  });
  return new Response(body,{status,headers});
 }
};
