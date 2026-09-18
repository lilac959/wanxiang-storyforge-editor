const fs=require('fs'),path=require('path'),crypto=require('crypto');
const source=path.resolve(__dirname,'../storyforge'),dest=path.join(__dirname,'public'),manifest={},downloads={};
fs.mkdirSync(dest,{recursive:true});
function copy(dir,relative=''){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const rel=path.posix.join(relative,entry.name),src=path.join(dir,entry.name),out=path.join(dest,rel);
  if(entry.isDirectory()){copy(src,rel);continue}
  const size=fs.statSync(src).size;fs.mkdirSync(path.dirname(out),{recursive:true});
  if(rel.endsWith('.mp4')&&size>2*1024*1024){
   const bytes=fs.readFileSync(src),hash=crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16),parts=[];
   for(let offset=0,index=0;offset<size;offset+=2*1024*1024,index++){
    const chunk=bytes.subarray(offset,offset+2*1024*1024),url='/download-parts/'+hash+'-'+index+'.bin';
    fs.mkdirSync(path.dirname(path.join(dest,url)),{recursive:true});fs.writeFileSync(path.join(dest,url),chunk);parts.push({url,size:chunk.length});
   }
   downloads['/'+rel]={size,type:'video/mp4',parts};
  }
  if(size<=25*1024*1024){fs.copyFileSync(src,out);continue}
  const data=fs.readFileSync(src),hash=crypto.createHash('sha256').update(data).digest('hex').slice(0,16),parts=[];
  for(let offset=0,index=0;offset<size;offset+=16*1024*1024,index++){
   const part=data.subarray(offset,offset+16*1024*1024),url='/media-parts/'+hash+'-'+index+'.bin';
   fs.mkdirSync(path.dirname(path.join(dest,url)),{recursive:true});fs.writeFileSync(path.join(dest,url),part);parts.push({url,size:part.length});
  }
  manifest['/'+rel]={size,type:rel.endsWith('.mp4')?'video/mp4':'application/octet-stream',parts,etag:'"'+hash+'"'};
 }
}
copy(source);fs.writeFileSync(path.join(dest,'media-downloads.json'),JSON.stringify(downloads));fs.writeFileSync(path.join(__dirname,'media-manifest.json'),JSON.stringify(manifest,null,2));
console.log('Built editor; chunked '+Object.keys(manifest).length+' large media file(s), original bytes preserved.');

const game=fs.readFileSync(path.join(source,'index.html'),'utf8')
 .replace('<html lang=', '<html data-mode="game" lang=')
 .replace('</head>','<link rel="stylesheet" href="game.css"></head>')
 .replace('<dialog id="player">','<dialog id="player"><button id="gameUpdate" hidden>作品已更新 · 点击重新开始</button>');
fs.writeFileSync(path.join(dest,'game.html'),game);
