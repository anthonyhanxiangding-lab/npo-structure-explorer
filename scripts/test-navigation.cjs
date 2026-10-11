// Render the local, offline artifact only; this does not use a logged-in browser.
const {chromium}=require(process.env.NPO_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..');
const artifact=path.join(root,'NPO结构探索器.html');
const qa=path.resolve(process.env.NPO_QA_DIR||path.join(root,'qa'));
fs.mkdirSync(qa,{recursive:true});
const checks=[],errors=[];
let browser,page,context;
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const nav=()=>page.evaluate(()=>NPO.scene.getNavigationState());
const mark=name=>checks.push(name);
async function settled(id){
  await page.waitForFunction(id=>NPO.getState().view===id&&!NPO.scene.getNavigationState().active,id);
}
async function select(id){await page.evaluate(id=>NPO.select(id),id);await settled(id);}
async function capture(name){await page.screenshot({path:path.join(qa,name)});}
async function recordTransition(action){
  // Sample in the rendering loop itself: locator/screenshot latency must not hide
  // the interval where the original parent remains visible while the camera moves.
  await page.evaluate(()=>{
    window.__navigationFrames=[];
    window.__recordNavigation=true;
    const sample=()=>{
      if(!window.__recordNavigation)return;
      window.__navigationFrames.push({time:performance.now(),...NPO.scene.getNavigationState()});
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await action();
  await page.waitForFunction(()=>!NPO.scene.getNavigationState().active);
  return page.evaluate(()=>{window.__recordNavigation=false;return window.__navigationFrames;});
}
const distance=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]));
(async()=>{
  const launch={headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
  if(process.env.NPO_CHROMIUM_EXECUTABLE)launch.executablePath=process.env.NPO_CHROMIUM_EXECUTABLE;
  browser=await chromium.launch(launch);
  context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:1,recordVideo:{dir:path.join(qa,'navigation-video'),size:{width:1280,height:840}}});
  page=await context.newPage();
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route(/^https?:/,route=>{errors.push('External request: '+route.request().url());route.abort()});
  await page.addInitScript(()=>{try{localStorage.removeItem('npo-explorer-v1')}catch{}});
  const artifactSha256=sha();
  await page.goto(pathToFileURL(artifact).href);
  await page.waitForFunction(()=>window.NPO?.scene?.getNavigationState);
  await settled('npo');
  await select('pic');
  await capture('13-pic-parent.png');
  // Transition checks added below use the public read-only render snapshot.
  const beforeIn=await nav();
  const inward=await recordTransition(async()=>{
    await page.locator('#child-strip [data-enter="modulator"]').click();
    await page.waitForFunction(()=>NPO.scene.getNavigationState().phase>.15);
    await capture('14-pic-zoom-approach.png');
  });
  const approaches=inward.filter(s=>s.active&&s.kind==='in'&&s.phase>.06&&s.phase<.43);
  assert(approaches.length,'Recorded a frame before the parent starts fading');
  const approach=approaches.at(-1),parent=approach.roots.find(r=>r.viewId==='pic');
  assert.equal(parent.opacity,1,'Original PIC remains fully visible during camera approach');
  assert(distance(approach.camera,approach.anchorCenter)<distance(beforeIn.camera,approach.anchorCenter)*.96,'Camera approaches an embedded modulator in actual frames');
  assert(approach.roots.find(r=>r.viewId==='modulator').scale[0]<1,'Detail begins at its embedded scale');
  assert.equal(approach.representative,true);
  assert(inward.some(s=>s.active&&s.roots.some(r=>r.viewId==='modulator'&&r.opacity>0)&&s.roots.some(r=>r.viewId==='pic'&&r.opacity>0)),'Recorded the spatial handoff with both roots present');
  assert.equal(await page.locator('#inspector h2').innerText(),await page.evaluate(()=>NPO.database.components.find(n=>n.id==='modulator').name));
  await settled('modulator');await capture('15-modulator-detail.png');
  mark('PIC → modulator preserves PIC context, approaches real embedded geometry, then reveals the aligned detail');

  const beforeOut=await nav();
  const outward=await recordTransition(async()=>{
    await page.locator('#breadcrumbs [data-enter="pic"]').click();
    await page.waitForFunction(()=>NPO.scene.getNavigationState().phase>.3);
    await capture('16-pic-zoom-return.png');
  });
  assert(outward.some(s=>s.kind==='out'&&s.active&&s.roots.find(r=>r.viewId==='pic')?.scale[0]>1),'Returning PIC context is initially enlarged around the existing detail');
  assert(outward.some(s=>s.kind==='out'&&s.active&&distance(s.camera,beforeOut.target)>distance(beforeOut.camera,beforeOut.target)*1.1),'Reverse animation visibly moves away from the detail');
  await settled('pic');
  const returnEndpoint=await nav();await page.waitForTimeout(900);const returnStable=await nav();
  assert(distance(returnEndpoint.roots[0].bounds.min,returnStable.roots[0].bounds.min)<1e-7&&distance(returnEndpoint.roots[0].bounds.max,returnStable.roots[0].bounds.max)<1e-7,'Parent explosion layout must not drift after navigation completes');
  assert(distance(returnEndpoint.camera,returnStable.camera)<1e-7,'Parent framing stays stable at completion');
  mark('Breadcrumb navigation reverses the spatial relation and returns to PIC without endpoint drift');

  await select('modulator');
  const peers=await recordTransition(()=>page.locator('#child-strip [data-enter="photodiode"]').click());
  assert(peers.some(s=>s.active&&s.kind==='crossfade'));
  assert(peers.filter(s=>s.active&&s.kind==='crossfade').every(s=>s.roots.every(r=>r.scale.every(v=>Math.abs(v-1)<1e-7))),'Peer transition keeps canonical scales');
  await settled('photodiode');mark('Modulator → PD uses peer switching without implying physical containment');

  for(const [name,interrupt,expected] of [
    ['rapid navigation',()=>page.evaluate(()=>NPO.select('photodiode')),'photodiode'],
    ['configuration change',()=>page.evaluate(()=>NPO.setConfig({picChannels:16})),'modulator'],
    ['camera reset',()=>page.locator('#reset-camera').click(),'modulator'],
  ]){
    await select('pic');
    await page.evaluate(()=>NPO.select('modulator'));
    await page.waitForTimeout(150);await interrupt();await settled(expected);
    const final=await nav();assert.equal(final.roots.length,1);assert.equal(final.roots[0].viewId,expected);
    assert(final.roots[0].scale.every(v=>Math.abs(v-1)<1e-7));
    await page.waitForTimeout(900);assert.equal((await nav()).roots.length,1);
  }
  mark('Rapid navigation, configuration changes and reset leave no stale roots or delayed transitions');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>NPO.select('pic'));
  let reduced=await nav();assert.equal(reduced.active,false);assert.equal(reduced.roots.length,1);
  await page.locator('#child-strip [data-enter="modulator"]').click();
  reduced=await nav();assert.equal(reduced.active,false);assert.equal(reduced.roots.length,1);
  assert.equal(reduced.roots[0].viewId,'modulator');
  mark('System reduced-motion preference displays the selected detail immediately');
  await page.emulateMedia({reducedMotion:'no-preference'});

  await page.setViewportSize({width:390,height:844});await select('pic');
  await page.locator('#child-strip [data-enter="modulator"]').click();await settled('modulator');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile page must not overflow horizontally');
  await capture('17-navigation-mobile.png');
  mark('Mobile child navigation and layout remain usable');
  assert.equal(artifactSha256,sha(),'Artifact changed during navigation QA');
  assert.deepEqual(errors,[]);
  const video=page.video();await context.close();context=null;
  await video.saveAs(path.join(qa,'navigation-zoom.webm'));
  fs.writeFileSync(path.join(qa,'navigation-results.json'),JSON.stringify({passed:true,checks,errors,artifactSha256,video:'navigation-zoom.webm',screenshots:['13-pic-parent.png','14-pic-zoom-approach.png','15-modulator-detail.png','16-pic-zoom-return.png','17-navigation-mobile.png']},null,2));
  console.log(JSON.stringify({passed:true,checks}));
})().catch(async error=>{
  if(page)await page.screenshot({path:path.join(qa,'navigation-error.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(qa,'navigation-results.json'),JSON.stringify({passed:false,checks,errors:[...errors,String(error)],artifactSha256:fs.existsSync(artifact)?sha():null},null,2));
  console.error(error);process.exitCode=1;
}).finally(async()=>{if(context)await context.close();if(browser)await browser.close()});
