// ZIP STORE preserves original media bytes without recompression.
function archiveCRC(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
async function createProjectZip(files){
 const parts=[],central=[];let offset=0,centralSize=0;
 for(const file of files){
  const name=new TextEncoder().encode(file.name),bytes=new Uint8Array(await file.blob.arrayBuffer());
  if(offset+bytes.length>0xffffffff)throw Error('项目超过 ZIP 的 4GB 限制，请拆分项目');
  const crc=archiveCRC(bytes),head=new Uint8Array(30),h=new DataView(head.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);
  parts.push(head,name,file.blob);
  const record=new Uint8Array(46),r=new DataView(record.buffer);
  r.setUint32(0,0x02014b50,true);r.setUint16(4,20,true);r.setUint16(6,20,true);r.setUint16(8,0x800,true);r.setUint16(14,33,true);r.setUint32(16,crc,true);r.setUint32(20,bytes.length,true);r.setUint32(24,bytes.length,true);r.setUint16(28,name.length,true);r.setUint32(42,offset,true);
  central.push(record,name);centralSize+=46+name.length;offset+=30+name.length+bytes.length;
 }
 if(files.length>65535||offset+centralSize>0xffffffff)throw Error('项目超出 ZIP 容量限制');
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
async function readProjectZip(file){
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer),entries=new Map();let pos=0;
 while(pos+4<=bytes.length&&view.getUint32(pos,true)===0x04034b50){
  if(pos+30>bytes.length)throw Error('项目包已损坏');
  const flags=view.getUint16(pos+6,true),method=view.getUint16(pos+8,true),size=view.getUint32(pos+18,true),nameSize=view.getUint16(pos+26,true),extra=view.getUint16(pos+28,true),start=pos+30+nameSize+extra,end=start+size;
  if(method!==0||(flags&9))throw Error('请导入编辑器直接导出的 ZIP 项目包');
  if(end>bytes.length)throw Error('项目包不完整');
  const name=new TextDecoder().decode(bytes.subarray(pos+30,pos+30+nameSize)),data=bytes.subarray(start,end);
  if(name.split('/').some(p=>p==='..')||name.startsWith('/')||entries.has(name)||archiveCRC(data)!==view.getUint32(pos+14,true))throw Error('项目包路径或校验无效');
  entries.set(name,new Blob([data]));pos=end;
 }
 if(!entries.has('project.storyforge.json')||!entries.has('assets.json'))throw Error('未找到项目配置或素材清单');
 return entries;
}
function projectAssetName(p,source,blob){
 let name=blob.name;
 if(!name&&p.loading.video===source)name=p.loading.videoName;
 if(!name&&p.splash.video===source)name=p.splash.videoName;
 for(const n of p.nodes){if(!name&&n.video===source)name=n.videoName;for(const f of n.frames||[])if(!name&&f.image===source)name=f.name}
 name=(name||source.split('/').pop()||'素材').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,150);
 if(!/\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|ogg|ogv)$/i.test(name)){const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov'}[blob.type];name+=ext||'.bin'}
 return name;
}
function remapProjectSource(p,from,to){
 if(p.loading.image===from)p.loading.image=to;if(p.loading.video===from)p.loading.video=to;if(p.splash.video===from)p.splash.video=to;
 for(const n of p.nodes){if(n.video===from)n.video=to;for(const f of n.frames||[])if(f.image===from)f.image=to}
}
