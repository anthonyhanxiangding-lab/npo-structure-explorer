import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import DB from '../database.json' with {type:'json'};

// Exercise actual Three geometries and scene state without a GPU or browser.
// Only the renderer, environment map, controls and DOM surfaces are replaced.
let renderedScene, renderedCamera, nextFrame;
function element() {
  return {
    style: {}, dataset: {}, children: [], clientWidth: 1100, clientHeight: 850,
    appendChild(child) { this.children.push(child); }, remove() {},
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return {left:0, top:0, width:1100, height:850}; },
    toDataURL() { return 'data:image/png;base64,test'; },
  };
}
class Renderer {
  constructor() { this.domElement=element(); this.shadowMap={}; }
  setPixelRatio() {} setSize() {} dispose() {}
  render(scene,camera) { renderedScene=scene; renderedCamera=camera; }
}
class Controls {
  constructor() { this.target=new THREE.Vector3(); }
  update() {} addEventListener() {} dispose() {}
}
class Environment { dispose() {} }
class PMREM {
  fromScene() { return {texture:null,dispose(){}}; }
  dispose() {}
}
globalThis.__sceneTestThree={...THREE,WebGLRenderer:Renderer,PMREMGenerator:PMREM};
globalThis.__sceneTestControls=Controls;
globalThis.__sceneTestEnvironment=Environment;
globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
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
const api=createScene(container);
const nodes=Object.fromEntries(DB.components.map(n=>[n.id,n]));
function current(view,config={},quantities={}) {
  api.setState({viewId:view,selectedId:view,nodes,config:{lanes:16,picChannels:8,laser:'external',...config},quantities});
  nextFrame(performance.now()+1100);
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
nextFrame(performance.now()+1100);
assert.ok(oldPosition.distanceTo(renderedCamera.position)>0.1,'Focus action visibly moves the camera in the selected leaf view');
api.setExplode(.85);
nextFrame(performance.now()+1100);
api.dispose();
checks++;
console.log(`Scene geometry and interaction contract: ${checks} checks passed`);
