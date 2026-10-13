import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import DB from '../database.json' with {type:'json'};

// Exercise actual Three geometries and scene state without a GPU or browser.
// Only the renderer, environment map, controls and DOM surfaces are replaced.
let renderedScene, renderedCamera, renderedControls, renderedCanvas, nextFrame, enteredId;
let clockMs=0, renderCount=0, reducedMotion=false;
const mediaListeners=new Set();
Object.defineProperty(globalThis,'performance',{value:{now:()=>clockMs},configurable:true});
function advance(ms=0) { clockMs+=ms; nextFrame?.(clockMs); }
function settle() { for(let i=0;i<50;i++)advance(50); }
function element() {
  return {
    style: {}, dataset: {}, children: [], clientWidth: 1100, clientHeight: 850,
    appendChild(child) { this.children.push(child); child.parentElement=this; },
    setAttribute(name,value) { this[name]=String(value); },
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this); },
    classList:{add(){},remove(){},toggle(){}},
    listeners:new Map(),
    addEventListener(type,callback) { if(!this.listeners.has(type))this.listeners.set(type,new Set()); this.listeners.get(type).add(callback); },
    removeEventListener(type,callback) { this.listeners.get(type)?.delete(callback); },
    dispatchEvent(event) { for(const callback of this.listeners.get(event.type)||[])callback(event); },
    getBoundingClientRect() { return {left:0, top:0, width:1100, height:850}; },
    toDataURL() { return 'data:image/png;base64,test'; },
  };
}
class Renderer {
  constructor() { this.domElement=element(); renderedCanvas=this.domElement; this.shadowMap={}; }
  setPixelRatio() {} setSize() {} dispose() {}
  render(scene,camera) { renderedScene=scene; renderedCamera=camera; renderCount++; scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }
}
class Controls {
  constructor(camera) { this.target=new THREE.Vector3(); this.camera=camera; renderedControls=this; }
  update() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(true); } addEventListener() {} dispose() {}
}
class Environment { dispose() {} }
class PMREM {
  fromScene() { return {texture:null,dispose(){}}; }
  dispose() {}
}
globalThis.__sceneTestThree={...THREE,WebGLRenderer:Renderer,PMREMGenerator:PMREM};
globalThis.__sceneTestControls=Controls;
globalThis.__sceneTestEnvironment=Environment;
globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},matchMedia:()=>({
  get matches(){return reducedMotion;},
  addEventListener(type,listener){mediaListeners.add(listener);},
  removeEventListener(type,listener){mediaListeners.delete(listener);},
})};
globalThis.document={createElement:element};
globalThis.getComputedStyle=()=>({position:'relative'});
globalThis.ResizeObserver=class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame=callback=>{nextFrame=callback;return 1;};
globalThis.cancelAnimationFrame=()=>{};
let source=await fs.readFile(new URL('../web/scene.js',import.meta.url),'utf8');
source=source
  .replace("import * as THREE from 'three';",'const THREE=globalThis.__sceneTestThree;')
  .replace("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';",'const OrbitControls=globalThis.__sceneTestControls;')
  .replace("import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';",'const RoomEnvironment=globalThis.__sceneTestEnvironment;');
const {createScene,picChannelLayout,normalizeSignalPath,signalModesForComponent}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const container=element();
const api=createScene(container,{onEnter:id=>{enteredId=id;api.setState({viewId:id,selectedId:id});}});
const nodes=Object.fromEntries(DB.components.map(n=>[n.id,n]));
function current(view,config={},quantities={}) {
  api.setState({viewId:view,selectedId:view,nodes,config:{lanes:16,picChannels:8,laser:'external',...config},quantities});
  settle();
  const roots=renderedScene.children.filter(n=>n.userData.viewId===view);
  return roots.at(-1);
}
function objects(root,predicate) { const result=[];root.traverse(o=>{if(predicate(o))result.push(o);});return result; }
function routeModes(root) { return objects(root,o=>o.userData.signalRoute).filter(o=>o.visible).map(o=>o.userData.signalRoute).sort(); }
let checks=0;
for (const count of [1,4,8,16,32,64]) {
  const rows=picChannelLayout(count);
  assert.equal(rows.length,count);
  assert.ok(rows.every(r=>r.txZ+r.pitch*.3<0 && r.rxZ-r.pitch*.3>0),'Tx/Rx lanes must stay in separate bands');
  assert.equal(new Set(rows.map(r=>r.txZ)).size,count);
  assert.equal(new Set(rows.map(r=>r.rxZ)).size,count);
  checks+=4;
}
const previews=(root,id)=>objects(root,o=>o.userData.previewPattern===id);
const pathMeshes=root=>objects(root,o=>o.geometry?.type==='TubeGeometry');
const pathPoints=mesh=>mesh.geometry.parameters.path.getPoints(100).map(p=>p.add(mesh.position));
const patternSignature=root=>objects(root,o=>o.isMesh).map(o=>({
  type:o.geometry.type,
  material:o.material.userData.baseColor?.getHexString(),
  branches:o.geometry.parameters.path?.points?.length,
}));
function assertMzmReadable(pattern) {
  const paths=pathMeshes(pattern);
  assert.equal(paths.length,2,'MZM contains two optical arms, rather than only a colored slab');
  const points=paths.map(pathPoints),length=Math.max(...points.flat().map(p=>p.x))-Math.min(...points.flat().map(p=>p.x));
  const centers=points.map(points=>points.filter(p=>Math.abs(p.x)<length*.1));
  assert.ok(centers.every(points=>points.length>0),'Both arms run through the central modulation region');
  const negative=centers.find(points=>points.every(p=>p.z<0));
  const positive=centers.find(points=>points.every(p=>p.z>0));
  assert.ok(negative&&positive,'The two arms occupy opposite sides of the centerline');
  const radius=Math.max(...paths.map(path=>path.geometry.parameters.radius));
  const lower=Math.max(...negative.map(p=>p.z)),upper=Math.min(...positive.map(p=>p.z));
  assert.ok(upper-lower>radius*4,'Optical arm surfaces leave a visible central gap');
  for(const path of paths) {
    const controlPoints=path.geometry.parameters.path.points;
    assert.ok(Math.abs(controlPoints[0].z)<1e-8&&Math.abs(controlPoints.at(-1).z)<1e-8,'Each arm branches from and returns to the optical centerline');
  }
  const electrodes=objects(pattern,o=>o.geometry?.type==='BoxGeometry'&&o.geometry.parameters.width>length*.3);
  assert.ok(electrodes.some(o=>o.position.z<0)&&electrodes.some(o=>o.position.z>0),'Two separate electrodes flank the arms');
  for(const electrode of electrodes) {
    const side=Math.sign(electrode.position.z);
    const inner=Math.abs(electrode.position.z)-electrode.geometry.parameters.depth/2;
    const armOuter=Math.max(...centers.flat().filter(p=>Math.sign(p.z)===side).map(p=>Math.abs(p.z)))+radius;
    assert.ok(inner>armOuter,`Electrode edges do not cover the optical arms: inner=${inner}, armOuter=${armOuter}`);
  }
  checks+=8;
}
function assertIntegratedDetector(pattern) {
  const paths=pathMeshes(pattern);
  assert.equal(paths.length,1,'Integrated PD has one terminating optical input');
  const points=pathPoints(paths[0]);
  assert.ok(points.every(p=>Math.abs(p.y-points[0].y)<1e-8),'Integrated PD has no raised package bond-wire loop');
  assert.ok(objects(pattern,o=>o.isMesh).every(o=>o.material.userData.baseColor?.getHexString()!=='e2ddd1'),'Integrated PD does not introduce a separate ceramic package');
  const regions=objects(pattern,o=>o.geometry?.type==='BoxGeometry');
  const absorber=regions.find(o=>o.material.userData.baseColor?.getHexString()==='94576b');
  assert.ok(absorber,'Integrated PD has a distinct absorbing region');
  const termination=points.at(-1);
  assert.ok(Math.abs(termination.x-absorber.position.x)<absorber.geometry.parameters.width/2,'Receive waveguide ends within the detector region');
  assert.ok(regions.some(o=>o.material.userData.baseColor?.getHexString()==='263852'),'Integrated PD has a visible active surface');
  checks+=6;
}
function assertPassivePattern(pattern,id) {
  const paths=pathMeshes(pattern);
  if(id==='splitter') {
    assert.equal(paths.length,2,'A splitter preview contains two distinct output paths');
    const ends=paths.map(path=>path.geometry.parameters.path.points.at(-1));
    assert.ok(ends[0].z*ends[1].z<0,'Splitter outputs branch to opposite sides');
    const radius=Math.max(...paths.map(path=>path.geometry.parameters.radius));
    assert.ok(Math.abs(ends[0].z-ends[1].z)>radius*4,'Splitter output surfaces are visibly separated');
    checks+=3;
  } else if(id==='coupler') {
    const ribs=objects(pattern,o=>o.geometry?.type==='BoxGeometry');
    assert.ok(ribs.length>=5,'Coupler preview has a recognizable repeated optical interface pattern');
    assert.equal(paths.length,1,'Coupler preview includes its incoming waveguide');
    assert.ok(new Set(ribs.map(o=>o.position.x)).size===ribs.length,'Coupling ribs are distributed along the optical path');
    checks+=3;
  } else if(id==='phase') {
    assert.equal(paths.length,1,'Phase tuning has a single optical path');
    const points=pathPoints(paths[0]);
    assert.ok(points.every(p=>Math.abs(p.z-points[0].z)<1e-8),'Phase tuning is distinct from a bifurcated MZM');
    assert.ok(objects(pattern,o=>o.geometry?.type==='BoxGeometry').some(o=>Math.abs(o.position.z-points[0].z)>paths[0].geometry.parameters.radius),'A separate tuning strip sits beside the waveguide');
    checks+=3;
  }
}
for (const channels of [4,8,16]) {
  const root=current('pic',{picChannels:channels,lanes:32});
  const modulators=previews(root,'modulator'),detectors=previews(root,'photodiode');
  assert.equal(detectors.length,channels,'One semantic Rx detector instance per displayed Rx channel');
  assert.equal(modulators.length,channels,'One semantic MZM instance per displayed Tx channel');
  for(const [id,count] of [['coupler',channels*2],['splitter',channels],['phase',channels]]) {
    assert.equal(previews(root,id).length,count,`${id} keeps its per-channel preview instances`);
  }
  assert.ok(modulators.every(o=>new THREE.Box3().setFromObject(o).max.z<0),'MZM lies only in Tx band');
  assert.ok(detectors.every(o=>new THREE.Box3().setFromObject(o).min.z>0),'PD lies only in Rx band');
  assert.equal(objects(root,o=>o.geometry?.type==='TorusGeometry').length,0,'MZM view must not contain microrings');
  assertMzmReadable(modulators[0]);assertIntegratedDetector(detectors[0]);
  for(const id of ['coupler','splitter','phase'])assertPassivePattern(previews(root,id)[0],id);
  const signatures=Object.fromEntries(['modulator','photodiode','coupler','splitter','phase'].map(id=>[id,patternSignature(previews(root,id)[0])]));
  for(const id of Object.keys(signatures)) {
    const detail=previews(current(id),id);
    assert.equal(detail.length,1,`${id} detail contains one enlarged physical pattern`);
    assert.deepEqual(patternSignature(detail[0]),signatures[id],`${id} keeps the same recognizable geometry and materials inside PIC and in detail`);
    if(id==='modulator')assertMzmReadable(detail[0]);
    else if(id==='photodiode')assertIntegratedDetector(detail[0]);
    else assertPassivePattern(detail[0],id);
    checks+=2;
  }
  checks+=8;
}
for(const id of ['phase','waveguide']) {
  const pattern=previews(current(id),id)[0];
  assert.ok(pattern,`${id} has its own preview pattern`);
  assert.equal(pathMeshes(pattern).length,1,`${id} must not reuse the two-arm MZM geometry`);
  if(id==='phase')assert.ok(objects(pattern,o=>o.geometry?.type==='BoxGeometry').length>0,'Phase tuning includes a separate tuning strip');
  checks+=id==='phase'?3:2;
}
const cwDetector=previews(current('cw'),'monitor_pd')[0];
const monitorSignature=patternSignature(cwDetector);
const monitorDetail=previews(current('monitor_pd'),'monitor_pd')[0];
assert.deepEqual(patternSignature(monitorDetail),monitorSignature,'Monitor PD retains its detector structure when enlarged from the CW package');
assert.ok(pathMeshes(monitorDetail).length>0,'Monitor PD retains electrical connections instead of a generic IC block');
checks+=2;

// The carrier preview needs exposed contacts, not vias buried inside its top
// dielectric. Test the actual surfaces and camera ray intersections.
for(const view of ['substrate','interposer']) {
  const root=current(view,{interposer:true},{interposer:1});
  const carrier=objects(root,o=>o.userData.navigationAnchor==='interposer')[0];
  assert.ok(carrier,'An enabled interposer has a physical preview');
  const dielectric=objects(carrier,o=>o.geometry?.type==='BoxGeometry'&&o.material.userData.baseColor?.getHexString()==='235965')[0];
  const top=new THREE.Box3().setFromObject(dielectric).max.y;
  const contacts=objects(carrier,o=>o.geometry?.type==='BoxGeometry'&&o.material.userData.baseColor?.getHexString()==='c9983c');
  const routes=pathMeshes(carrier);
  assert.ok(contacts.length>0&&routes.length>0,'Surface pads and connecting traces are present');
  assert.ok([...contacts,...routes].every(o=>new THREE.Box3().setFromObject(o).min.y>top),'Surface contacts and traces lie above the dielectric rather than being buried');
  const ray=new THREE.Raycaster();
  const visible=contacts.some(mesh=>{
    const bounds=new THREE.Box3().setFromObject(mesh),point=bounds.getCenter(new THREE.Vector3());
    point.y=bounds.max.y;
    const projected=point.project(renderedCamera);
    if(Math.abs(projected.x)>=1||Math.abs(projected.y)>=1)return false;
    ray.setFromCamera(new THREE.Vector2(projected.x,projected.y),renderedCamera);
    const first=ray.intersectObject(root,true).find(hit=>hit.object.isMesh&&hit.object.material?.opacity>=.1);
    return first?.object===mesh;
  });
  assert.ok(visible,`At least one real ${view} surface contact is visible and ray-accessible from the default camera`);
  checks+=4;
}

// Ferrule openings stay flush with the end face even as its body thickness and
// channel density change. An extruded marker must not turn into a visible stud.
for(const view of ['connector','ferrule'])for(const channelCount of [4,16,64]) {
  const root=current(view,{lanes:channelCount});
  const core=previews(root,'ferrule')[0];
  const body=objects(core,o=>o.geometry?.type==='BoxGeometry')[0];
  const front=new THREE.Box3().setFromObject(body).max.x;
  const markers=objects(core,o=>o.geometry?.type==='CylinderGeometry');
  const openings=markers.filter(o=>o.material.userData.baseColor?.getHexString()==='152633');
  assert.equal(openings.length,channelCount*2,'Ferrule openings retain the configured Tx and Rx fiber count');
  assert.ok(markers.every(o=>{
    const protrusion=new THREE.Box3().setFromObject(o).max.x-front;
    return protrusion>0&&protrusion<=o.geometry.parameters.radiusTop*.6;
  }),'Opening markers remain shallow relative to their radius, independently of body thickness');
  checks+=2;
}

for(const view of ['fau','fiber','connector']) {
  const root=current(view);
  const strands=objects(root,o=>o.geometry?.type==='TubeGeometry'&&o.userData.id==='fiber');
  assert.ok(strands.length>=32,`${view} retains every configured signal strand`);
  assert.ok(strands.every(o=>o.material.opacity>=.85&&!o.material.transparent),'Signal strands stay opaque enough to read against the pale scene background');
  checks+=2;
}
for (const view of ['npo','engine','pic']) {
  const root=current(view);
  for (const mode of ['tx','rx','cw','all']) {
    api.setState({signalPath:mode});
    assert.deepEqual(routeModes(root),mode==='all'?['cw','rx','tx']:[mode]);
    const routeMeshes=objects(root,o=>o.isMesh&&o.userData.excludeFromFit);
    assert.ok(routeMeshes.length>=6,'Each mode has a directional line and arrowhead');
    for(const route of objects(root,o=>o.userData.signalRoute)) assert.equal(route.userData.decorative,true,'Direction overlays must not hijack clicks');
    checks+=3;
  }
}
const els=current('els');
assert.equal(objects(els,o=>o.isGroup&&o.userData.id==='monitor_pd').length,1,'The single-lane ELS illustration must contain one monitor PD');
assert.equal(objects(els,o=>o.isGroup&&o.userData.id==='tec').length,1,'Only one illustrative TEC stack is present');
checks+=2;
assert.deepEqual(signalModesForComponent('driver'),['tx']);
assert.deepEqual(signalModesForComponent('tia'),['rx']);
assert.deepEqual(signalModesForComponent('monitor_pd'),['cw']);
assert.equal(normalizeSignalPath('invalid'),'all');
checks+=4;
current('photodiode');
const oldPosition=renderedCamera.position.clone();
api.focusSelected();
settle();
assert.ok(oldPosition.distanceTo(renderedCamera.position)>0.1,'Focus action visibly moves the camera in the selected leaf view');
api.setExplode(.85);
settle();
checks++;

// Hierarchy navigation must change actual 3D positions and scale relationships.
// UI text or a transition-kind enum alone cannot satisfy these assertions.
const sceneRoots=()=>renderedScene.children.filter(o=>o.userData.viewId);
const rootFor=id=>sceneRoots().find(o=>o.userData.viewId===id);
const rootBox=root=>new THREE.Box3().setFromObject(root);
const rootSize=root=>rootBox(root).getSize(new THREE.Vector3());
function semanticBox(root,id){
  const result=new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh||o.userData.excludeFromFit)return;
    let cursor=o,match=false;
    while(cursor&&cursor!==root){if(cursor.userData.id===id){match=true;break;}cursor=cursor.parent;}
    if(match)result.union(new THREE.Box3().setFromObject(o));
  });
  return result;
}
function navigate(id){api.setState({viewId:id,selectedId:id});}
function onlyRoot(id){assert.deepEqual(sceneRoots().map(o=>o.userData.viewId),[id],'Completed/cancelled transitions leave only the requested view');}
function pickSemantic(object,root){
  let cursor=object;
  while(cursor&&cursor!==root.parent){
    if(cursor.userData.decorative)return null;
    if(cursor.userData.id)return cursor.userData.id;
    cursor=cursor.parent;
  }
  return null;
}
function clickInstance(root,instance,id){
  const ray=new THREE.Raycaster();
  let point=null;
  const isInside=object=>{for(let cursor=object;cursor;cursor=cursor.parent)if(cursor===instance)return true;return false;};
  root.updateMatrixWorld(true);
  for(const mesh of objects(instance,o=>o.isMesh)){
    if(point)break;
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const box=mesh.geometry.boundingBox,center=box.getCenter(new THREE.Vector3());
    for(const local of [center,new THREE.Vector3(center.x,box.max.y,center.z),new THREE.Vector3(center.x,center.y,box.max.z)]){
      const projected=local.clone().applyMatrix4(mesh.matrixWorld).project(renderedCamera);
      if(Math.abs(projected.x)>=1||Math.abs(projected.y)>=1)continue;
      ray.setFromCamera(new THREE.Vector2(projected.x,projected.y),renderedCamera);
      const hit=ray.intersectObject(root,true).find(h=>h.object.isMesh&&h.object.material?.opacity>=.1&&pickSemantic(h.object,root));
      if(hit&&pickSemantic(hit.object,root)===id&&isInside(hit.object)){point=projected;break;}
    }
  }
  assert.ok(point,`A real visible ${id} mesh can be clicked in the requested instance`);
  const event={pointerId:1,button:0,isPrimary:true,clientX:(point.x+1)*550,clientY:(1-point.y)*425};
  enteredId=null;
  renderedCanvas.dispatchEvent({...event,type:'pointerdown'});
  renderedCanvas.dispatchEvent({...event,type:'pointerup'});
  assert.equal(enteredId,id,'Actual pointer hit testing enters the requested component');
}
function assertCanonical(root){
  assert.ok(root.position.length()<1e-8,'Settled root uses canonical position');
  assert.ok(root.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-8,'Settled root uses canonical scale');
}
const picRoot=current('pic');
const modulatorBounds=semanticBox(picRoot,'modulator');
const parentScale=picRoot.scale.clone(),parentPosition=picRoot.position.clone();
const parentCamera=renderedCamera.position.clone();
let disposedParentGeometries=0;
objects(picRoot,o=>!!o.geometry).forEach(o=>o.geometry.addEventListener('dispose',()=>disposedParentGeometries++));
navigate('modulator');
let navigation=api.getNavigationState();
assert.equal(navigation.kind,'in');
assert.equal(navigation.representative,true,'Repeated PIC channels must use a representative physical instance');
assert.equal(navigation.instanceCount,8);
const anchor=new THREE.Vector3(...navigation.anchorCenter);
assert.ok(modulatorBounds.containsPoint(anchor),'Zoom target lies on real modulator geometry inside PIC');
assert.ok(rootFor('modulator').scale.x<1,'Detail initially occupies the embedded component scale');
advance(250);
assert.equal(rootFor('pic'),picRoot,'Original parent geometry remains in the scene during approach');
assert.equal(picRoot.userData.opacity,1,'Parent must not fade while the camera establishes containment');
assert.equal(rootFor('modulator').userData.opacity,0,'A detail swap may not precede the spatial approach');
assert.ok(picRoot.position.distanceTo(parentPosition)<1e-8&&picRoot.scale.distanceTo(parentScale)<1e-8);
assert.ok(renderedCamera.position.distanceTo(anchor)<parentCamera.distanceTo(anchor)*.9,'Camera visibly approaches the real embedded modulator');
assert.equal(disposedParentGeometries,0,'Parent geometry stays alive throughout approach');
advance(450);
assert.ok(rootFor('modulator').userData.opacity>0&&picRoot.userData.opacity>0,'Detail handoff overlaps within the same parent coordinates');
assert.ok(rootFor('modulator').scale.x<1,'Child is spatially aligned before its canonical rebase');
advance(499);
const beforeFinish=rootBox(rootFor('modulator')).getCenter(new THREE.Vector3()).project(renderedCamera);
advance(2);
const afterFinish=rootBox(rootFor('modulator')).getCenter(new THREE.Vector3()).project(renderedCamera);
assert.ok(Math.hypot(afterFinish.x-beforeFinish.x,afterFinish.y-beforeFinish.y)<.005,'Final coordinate normalization must not cause a visible screen-space jump');
onlyRoot('modulator');assertCanonical(rootFor('modulator'));
assert.ok(disposedParentGeometries>0,'Parent geometries are disposed after the handoff');
checks+=17;

const detailRoot=rootFor('modulator');
const detailSizeBefore=rootSize(detailRoot);
navigate('pic');
navigation=api.getNavigationState();
assert.equal(navigation.kind,'out');
assert.ok(rootFor('pic').scale.x>1,'Returning parent starts enlarged around the current child');
assert.ok(rootSize(rootFor('pic')).length()>detailSizeBefore.length(),'Parent context surrounds the already visible child');
const reverseCamera=renderedCamera.position.clone(),reverseTarget=renderedControls.target.clone();
advance(650);
assert.ok(rootFor('pic').userData.opacity>0,'Parent context becomes visible during reverse navigation');
assert.ok(renderedCamera.position.distanceTo(reverseTarget)>reverseCamera.distanceTo(reverseTarget),'Reverse transition pulls away from the existing detail');
settle();onlyRoot('pic');assertCanonical(rootFor('pic'));
checks+=7;

// The app changes explode=.15 for a leaf and .48 for an integrated parent.
// Those target layouts must already be settled when the hierarchy animation ends.
current('pic');api.setExplode(.48);settle();
api.setState({viewId:'modulator',selectedId:'modulator',explode:.15});settle();
api.setState({viewId:'pic',selectedId:'pic',explode:.48});advance(1200);
onlyRoot('pic');assert.equal(api.getNavigationState().active,false);
const returnBoundsAtFinish=rootBox(rootFor('pic')).clone();
const returnCameraAtFinish=renderedCamera.position.clone();
for(let i=0;i<30;i++)advance(50);
assert.ok(returnBoundsAtFinish.min.distanceTo(rootBox(rootFor('pic')).min)<1e-8&&returnBoundsAtFinish.max.distanceTo(rootBox(rootFor('pic')).max)<1e-8,'Returning to parent must not drift as its explosion amount catches up after the animation');
assert.ok(returnCameraAtFinish.distanceTo(renderedCamera.position)<1e-8,'Parent camera stays still after the transition endpoint');
checks+=4;

// Clicking a repeated instance must preserve its spatial identity on return.
// Newly detailed embedded parts must be reachable through actual visible meshes,
// not only via a tree label or a programmatic selection.
for(const [parent,child,index] of [
  ['pic','photodiode',3],['pic','coupler',4],['pic','splitter',3],['pic','phase',3],
  ['connector','ferrule',0],['laser_die','inp_substrate',0],
]) {
  const root=current(parent);
  const instances=objects(root,o=>o.userData.navigationAnchor===child);
  assert.ok(instances.length>index,`${parent} contains a real spatial anchor for ${child}`);
  const center=new THREE.Box3().setFromObject(instances[index]).getCenter(new THREE.Vector3());
  clickInstance(root,instances[index],child);
  const inward=api.getNavigationState();
  assert.equal(inward.kind,'in',`Clicking ${child} in ${parent} starts a containment zoom`);
  assert.ok(new THREE.Vector3(...inward.anchorCenter).distanceTo(center)<.05,'Zoom target matches the physical feature that was clicked');
  settle();onlyRoot(child);navigate(parent);
  const outward=api.getNavigationState();
  assert.equal(outward.kind,'out',`Returning from ${child} restores its enclosing component`);
  assert.ok(new THREE.Vector3(...outward.anchorCenter).distanceTo(new THREE.Vector3(...inward.anchorCenter))<1e-7,'Returning uses the same embedded instance');
  settle();onlyRoot(parent);
  checks+=8;
}
for(const [parent,child,index,quantities] of [['engine','pic',1,{pic:2}],['pic','modulator',5,{}]]){
  const root=current(parent,{},quantities);
  const instances=objects(root,o=>o.userData.navigationAnchor===child);
  assert.ok(instances.length>index);
  // For a root anchored directly as the component, collect its actual mesh bounds.
  const realCenter=new THREE.Box3().setFromObject(instances[index]).getCenter(new THREE.Vector3());
  clickInstance(root,instances[index],child);
  const inbound=api.getNavigationState();
  assert.ok(new THREE.Vector3(...inbound.anchorCenter).distanceTo(realCenter)<.05,`${parent} → ${child} uses the clicked non-first instance`);
  settle();navigate(parent);
  const outbound=api.getNavigationState();
  assert.ok(new THREE.Vector3(...outbound.anchorCenter).distanceTo(new THREE.Vector3(...inbound.anchorCenter))<1e-7,'Returning to an unchanged parent targets the original clicked instance');
  settle();onlyRoot(parent);
  checks+=6;
}
// A deeper visit must not overwrite the identity of the enclosing repeated PIC.
const nestedEngine=current('engine',{}, {pic:2});
clickInstance(nestedEngine,objects(nestedEngine,o=>o.userData.navigationAnchor==='pic')[1],'pic');
const nestedPicAnchor=api.getNavigationState().anchorCenter;settle();
clickInstance(rootFor('pic'),objects(rootFor('pic'),o=>o.userData.navigationAnchor==='modulator')[5],'modulator');
const nestedModulatorAnchor=api.getNavigationState().anchorCenter;settle();navigate('pic');
assert.ok(new THREE.Vector3(...api.getNavigationState().anchorCenter).distanceTo(new THREE.Vector3(...nestedModulatorAnchor))<1e-7);
settle();navigate('engine');
assert.ok(new THREE.Vector3(...api.getNavigationState().anchorCenter).distanceTo(new THREE.Vector3(...nestedPicAnchor))<1e-7,'Nested traversal returns through the original second PIC');
settle();checks+=6;

// An instance ordinal saved under one configuration must not migrate to another.
let instanceParent=current('pic',{picChannels:8});
let instanceList=objects(instanceParent,o=>o.userData.navigationAnchor==='modulator');
clickInstance(instanceParent,instanceList[5],'modulator');settle();
api.setState({config:{picChannels:16}});settle();navigate('pic');
let firstAfterChange=objects(rootFor('pic'),o=>o.userData.navigationAnchor==='modulator')[0];
assert.ok(new THREE.Vector3(...api.getNavigationState().anchorCenter).distanceTo(rootFor('pic').worldToLocal(new THREE.Box3().setFromObject(firstAfterChange).getCenter(new THREE.Vector3())))<.05,'Changing channel configuration clears the saved instance and selects a valid representative');
settle();checks+=3;

// A peer change remains a simple crossfade and never pretends to contain a sibling.
current('modulator');navigate('photodiode');
assert.equal(api.getNavigationState().kind,'crossfade');
assertCanonical(rootFor('modulator'));assertCanonical(rootFor('photodiode'));
advance(300);
assert.ok(rootFor('modulator').userData.opacity<1&&rootFor('photodiode').userData.opacity>0);
settle();onlyRoot('photodiode');checks+=6;

// Exercise other levels, physical-vs-budget parents, and missing geometry fallback.
for(const [parent,child] of [['engine','pic'],['isolator','faraday'],['cw','laser_die'],['cw','monitor_pd']]){
  const original=current(parent);navigate(child);
  assert.equal(api.getNavigationState().kind,'in',`${parent} → ${child} follows physical containment`);
  assert.ok(semanticBox(original,child).containsPoint(new THREE.Vector3(...api.getNavigationState().anchorCenter)));
  advance(250);assert.equal(original.userData.opacity,1);
  settle();onlyRoot(child);navigate(parent);
  assert.equal(api.getNavigationState().kind,'out');settle();onlyRoot(parent);
  checks+=6;
}
const customNodes={...nodes,photodiode:{...nodes.photodiode,parent:'isolator',physicalParent:'isolator'}};
current('isolator');api.setState({nodes:customNodes});navigate('photodiode');
assert.equal(api.getNavigationState().kind,'crossfade','An ancestry claim without matching parent geometry must not invent a spatial anchor');
settle();onlyRoot('photodiode');api.setState({nodes});checks+=2;

// Interruptions must not leave stale parent roots, delayed rebases or active tweens.
for(const [name,interrupt] of [
  ['rapid selection',()=>navigate('photodiode')],
  ['configuration',()=>api.setState({config:{picChannels:16,lanes:32}})],
  ['reset',()=>api.reset()],['focus',()=>api.focusSelected()],
  ['zoom',()=>api.zoom(-1)],['explode',()=>api.setExplode(.7)],
]){
  current('pic');navigate('modulator');advance(240);interrupt();settle();
  const expected=name==='rapid selection'?'photodiode':'modulator';
  onlyRoot(expected);assertCanonical(rootFor(expected));
  assert.equal(api.getNavigationState().active,false,`${name} cancels the hierarchy tween`);
  const stableCamera=renderedCamera.position.clone();advance(800);
  assert.ok(stableCamera.distanceTo(renderedCamera.position)<1e-8,`${name} leaves no delayed camera motion`);
  checks+=5;
}
current('pic');navigate('modulator');advance(180);
reducedMotion=true;for(const listener of mediaListeners)listener({matches:true});advance(0);
assert.equal(api.getNavigationState().active,false,'Changing the system preference stops an active motion');
onlyRoot('modulator');assertCanonical(rootFor('modulator'));
navigate('pic');advance(0);
assert.equal(api.getNavigationState().active,false,'Reduced-motion navigation completes without a spatial animation');
onlyRoot('pic');assertCanonical(rootFor('pic'));
reducedMotion=false;for(const listener of mediaListeners)listener({matches:false});
checks+=8;

// Disposing in-flight animation releases both roots and all geometry resources.
navigate('modulator');advance(180);
let released=0;
for(const root of sceneRoots())objects(root,o=>!!o.geometry).forEach(o=>o.geometry.addEventListener('dispose',()=>released++));
const renderCountBeforeDispose=renderCount;
api.dispose();advance(1000);
assert.equal(sceneRoots().length,0);assert.ok(released>0);assert.equal(renderCount,renderCountBeforeDispose);
assert.equal(mediaListeners.size,0,'Reduced-motion listener is removed on disposal');
checks+=4;
api.dispose();
console.log(`Scene geometry and interaction contract: ${checks} checks passed`);
