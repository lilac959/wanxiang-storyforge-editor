import test from 'node:test';
import assert from 'node:assert/strict';
import { Projects } from '../outputs/cloudflare/projects.mjs';
import { newProject, validate } from '../outputs/storyforge/studio/model.mjs';
import { deletionPlan } from '../outputs/storyforge/studio/asset-library.mjs';
import { worldPoint, zoomCamera } from '../outputs/storyforge/studio/graph-camera.mjs';

test('graph camera pans past content bounds and anchored zoom preserves the world point', () => {
  const camera = { x: 2500, y: -1800, scale: .74 };
  const before = worldPoint(camera, 350, 210);
  const after = zoomCamera(camera, 1.5, 350, 210);
  const point = worldPoint(after, 350, 210);
  assert(Math.abs(point.x-before.x)<1e-8 && Math.abs(point.y-before.y)<1e-8);
  const p = newProject(); p.editor.positions[p.entryId] = { x:-2000, y:-1000 };
  assert(!validate(p).some(x=>x.message==='剧情地图位置无效'));
});
test('batch deletion excludes templates and material referenced in opening, overlays and audio', () => {
  const p = newProject(), scene = p.scenes[0];
  p.assets = Object.fromEntries(['unused','opening','overlay','audio'].map(id=>[id,{id}]));
  scene.opening = { image:'opening' }; scene.overlays = [{assetId:'overlay'}]; scene.audio=[{assetId:'audio'}];
  assert.deepEqual(deletionPlan(p,['unused','unused','opening','overlay','audio','builtin']), {unused:['unused'], used:['opening','overlay','audio']});
});
test('recycle purge rejects active work atomically, keeps releases and prevents stale saves resurrecting drafts', async () => {
  const map = new Map(), storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k)};
  const service = new Projects(storage,async()=>true);
  const call=(path,body,token='test')=>service.fetch(new Request('https://test/api/v2'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)}),{token:'test'});
  const p=newProject();
  map.set('projects',JSON.stringify([{id:p.id,deleted:true},{id:'active',deleted:false}]));
  map.set('draft/'+p.id,JSON.stringify({project:p,revision:'r'})); map.set('release/kept','{}');
  assert.equal((await call('/purge',{ids:[p.id]},'wrong')).status,401);
  assert.equal((await call('/purge',{ids:[p.id,'active']})).status,409);
  assert(map.has('draft/'+p.id));
  assert.equal((await call('/draft',{project:p})).status,409);
  assert.equal((await call('/purge',{ids:[p.id]})).status,200);
  assert(!map.has('draft/'+p.id)); assert(map.has('release/kept'));
  assert.equal((await call('/draft',{project:p})).status,409);
  assert.equal((await call('/purge',{ids:[p.id]})).status,200);
});
