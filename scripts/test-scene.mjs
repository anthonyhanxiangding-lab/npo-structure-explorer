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
for (const channels of [4,8,16]) {
  const root=current('pic',{picChannels:channels,lanes:32});
  const modulators=objects(root,o=>o.isMesh&&o.userData.id==='modulator');
  const detectors=objects(root,o=>o.isMesh&&o.userData.id==='photodiode');
  assert.equal(detectors.length,channels,'One Rx detector per displayed Rx channel');
  assert.equal(modulators.length,channels*4,'Each Tx channel has only the two-arm MZM geometry and electrodes');
  assert.ok(modulators.every(o=>new THREE.Box3().setFromObject(o).max.z<0),'MZM lies only in Tx band');
  assert.ok(detectors.every(o=>new THREE.Box3().setFromObject(o).min.z>0),'PD lies only in Rx band');
  assert.equal(objects(root,o=>o.geometry?.type==='TorusGeometry').length,0,'MZM view must not contain microrings');
  checks+=5;
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
