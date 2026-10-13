// Render only the generated local artifact. No signed-in browser or network is used.
const {chromium}=require(process.env.NPO_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..');
const artifact=path.join(root,'NPO结构探索器.html');
const qa=path.resolve(process.env.NPO_QA_DIR||path.join(root,'qa'));
const imageDir=path.join(qa,'previews');
fs.mkdirSync(imageDir,{recursive:true});
const checks=[],errors=[],externalRequests=[],screenshots=[],componentViews=[],picLayouts=[];
let browser,page,artifactSha256;
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const mark=name=>checks.push(name);
async function settled(id){
  await page.waitForFunction(id=>NPO.getState().view===id&&!NPO.scene.getNavigationState().active,id);
  // Label positioning and mesh highlights update in requestAnimationFrame.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function select(id){await page.evaluate(id=>NPO.select(id),id);await settled(id);}
async function capture(name,{fullPage=false}={}){
  const relative=path.join('previews',name);
  if(fullPage)await page.screenshot({path:path.join(qa,relative),fullPage:true});
  else await page.locator('#viewport').screenshot({path:path.join(qa,relative)});
  screenshots.push(relative);
}
async function labels(){
  return page.locator('#viewport .scene-label').evaluateAll(elements=>elements.flatMap(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.9||!r.width||!r.height)return [];
    return [{id:el.dataset.component,text:el.textContent,x:r.x,y:r.y,width:r.width,height:r.height}];
  }));
}
function noOverlap(items,context){
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j];
    const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
    const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    assert(!(overlapX>.5&&overlapY>.5),`${context}: labels overlap: ${a.text} / ${b.text}`);
  }
}
async function clearOfFixedUi(items,context){
  const fixed=await page.locator('.stage-top-note,.stage-controls,.stage-legend').evaluateAll(elements=>elements.flatMap(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    if(s.display==='none'||s.visibility==='hidden'||!r.width||!r.height)return [];
    return [{name:el.className,x:r.x,y:r.y,width:r.width,height:r.height}];
  }));
  for(const a of items)for(const b of fixed){
    const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
    const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
    assert(!(overlapX>.5&&overlapY>.5),`${context}: ${a.text} overlaps ${b.name}`);
  }
}
async function imageEvidence(){
  // Inspect the actual WebGL output rather than DOM presence alone. Low-contrast
  // optical glass may be subtle, but a usable part must still differ from the sky.
  return page.evaluate(async()=>{
    const image=new Image();image.src=NPO.scene.capture();await image.decode();
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=180;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),background=[...data.slice(0,3)];
    let changed=0;const colors=new Set();
    for(let i=0;i<data.length;i+=4){
      if(Math.max(...background.map((v,k)=>Math.abs(v-data[i+k])))>14)changed++;
      colors.add(`${data[i]>>3},${data[i+1]>>3},${data[i+2]>>3}`);
    }
    return {changedPixels:changed,totalPixels:canvas.width*canvas.height,quantizedColors:colors.size};
  });
}
async function assertScene(id){
  const state=await page.evaluate(()=>NPO.scene.getNavigationState());
  assert.equal(state.roots.length,1,`${id}: one settled scene root`);
  assert.equal(state.roots[0].viewId,id,`${id}: matching scene root`);
  assert.equal(state.roots[0].opacity,1,`${id}: opaque scene root`);
  const {min,max}=state.roots[0].bounds;
  assert([...min,...max].every(Number.isFinite),`${id}: finite model bounds`);
  assert(max.every((value,i)=>value>min[i]),`${id}: nonempty 3D geometry`);
  const visible=await labels();assert(visible.length,`${id}: at least one visible scene label`);
  noOverlap(visible,id);
  await clearOfFixedUi(visible,id);
  const pixels=await imageEvidence();
  assert(pixels.changedPixels>130,`${id}: render must not be an empty sky`);
  assert(pixels.quantizedColors>8,`${id}: render must contain visible shaded geometry`);
  return {id,labels:visible.map(l=>({id:l.id,text:l.text})),...pixels};
}
async function labelRoundTrip(id,name){
  const label=page.locator(`#viewport .scene-label[data-component="${id}"]:visible`).first();
  assert(await label.count(),`PIC: ${name} label is visible before navigation`);
  await label.hover();
  await page.waitForFunction(name=>{
    const tooltip=document.querySelector('#scene-tooltip');
    return getComputedStyle(tooltip).display!=='none'&&tooltip.textContent.startsWith(`${name} · `);
  },name);
  await label.click();await settled(id);
  assert.equal(await page.locator('#inspector h2').innerText(),name,`${id}: click focuses the matching inspector`);
  await assertScene(id);
  await page.locator('#breadcrumbs [data-enter="pic"]').click();await settled('pic');
  assert((await labels()).some(l=>l.id===id),`${id}: returned PIC retains the selectable preview`);
  await page.mouse.move(1,1);
}
function receipt(passed,extra={}){
  return {passed,checkedAt:new Date().toISOString(),artifact:path.basename(artifact),artifactSha256,
    checks,errors,externalRequests,picLayouts,componentViews,screenshots,...extra};
}
(async()=>{
  assert(fs.existsSync(artifact),'Run npm run build before preview QA');
  artifactSha256=sha();
  const options={headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
  if(process.env.NPO_CHROMIUM_EXECUTABLE)options.executablePath=process.env.NPO_CHROMIUM_EXECUTABLE;
  browser=await chromium.launch(options);
  page=await browser.newPage({viewport:{width:1600,height:1050},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route(/^https?:/,route=>{externalRequests.push(route.request().url());return route.abort()});
  await page.addInitScript(()=>{try{localStorage.removeItem('npo-explorer-v1')}catch{}});
  await page.goto(pathToFileURL(artifact).href);
  await page.waitForFunction(()=>window.NPO?.scene?.getNavigationState);
  await settled('npo');
  const components=await page.evaluate(()=>NPO.database.components.map(n=>({id:n.id,name:n.name})));
  assert.equal(new Set(components.map(n=>n.id)).size,components.length,'Unique component IDs');
  const names=Object.fromEntries(components.map(n=>[n.id,n.name]));
  // Spatial animation itself is covered in test-navigation.cjs. Keep normal
  // motion for real pointer round trips, then accelerate the complete view audit.
  for(const viewport of [{width:1600,height:1050},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    for(const channels of [4,8,16]){
      await page.evaluate(picChannels=>NPO.setConfig({rate:3.2,laneRate:200,picChannels}),channels);
      await select('pic');
      await page.locator('#viewport').scrollIntoViewIfNeeded();
      await settled('pic');
      const visible=await labels();
      for(const id of ['modulator','photodiode'])assert(visible.some(l=>l.id===id),`${viewport.width}px / ${channels}ch: ${id} is labeled`);
      const caption=await page.locator('#viewport .scene-label[data-component="pic"]').allTextContents();
      assert(caption.some(text=>text.includes(`${channels}Tx＋${channels}Rx`)),`${channels}ch: PIC caption reflects the selected integration`);
      // Short mobile canvases may suppress the long summary caption to keep
      // the actual component labels and fixed controls legible and clickable.
      if(viewport.width>=700)assert(visible.some(l=>l.text.includes(`${channels}Tx＋${channels}Rx`)),`${channels}ch: desktop integration caption is visible`);
      noOverlap(visible,`${viewport.width}px / ${channels}ch PIC`);
      await clearOfFixedUi(visible,`${viewport.width}px / ${channels}ch PIC`);
      const frame=await page.locator('#viewport').boundingBox();
      for(const label of visible){
        assert(label.x>=frame.x-1&&label.x+label.width<=frame.x+frame.width+1,`${label.text}: not horizontally clipped`);
        assert(label.y>=frame.y-1&&label.y+label.height<=frame.y+frame.height+1,`${label.text}: not vertically clipped`);
      }
      await capture(`pic-${channels}ch-${viewport.width}.png`);
      picLayouts.push({viewport,channels,labels:visible.map(l=>({id:l.id,text:l.text}))});
      await labelRoundTrip('modulator',names.modulator);
      await labelRoundTrip('photodiode',names.photodiode);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'No horizontal page overflow');
      mark(`${viewport.width}×${viewport.height}, ${channels}ch PIC: visible nonoverlapping labels, modulator/PD hover, click and return`);
    }
  }
  await page.setViewportSize({width:1600,height:1050});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>NPO.setConfig({rate:3.2,laneRate:200,picChannels:8}));
  for(const component of components){
    await select(component.id);
    await page.locator('#viewport').scrollIntoViewIfNeeded();
    await settled(component.id);
    try{componentViews.push(await assertScene(component.id));}
    catch(error){
      // Complete the visual sweep so one weak preview does not hide a second.
      errors.push(String(error));componentViews.push({id:component.id,error:String(error)});
    }
    await capture(`component-${component.id}.png`);
  }
  if(!componentViews.some(view=>view.error))mark(`All ${components.length} component views have matching nonempty scene geometry, visible nonoverlapping labels and nonblank WebGL output`);
  await select('pic');
  await page.evaluate(()=>scrollTo(0,0));
  await capture('pic-desktop-full.png',{fullPage:true});
  assert.equal(artifactSha256,sha(),'Generated artifact must not change during preview QA');
  assert.deepEqual(errors,[],'No preview audit or browser errors');
  assert.deepEqual(externalRequests,[],'Offline artifact must not request external resources');
  mark('All screenshots and assertions belong to the current artifact SHA; no browser errors or external requests');
  fs.writeFileSync(path.join(qa,'preview-results.json'),JSON.stringify(receipt(true),null,2));
  console.log(JSON.stringify({passed:true,checks,components:componentViews.length,screenshots:screenshots.length,artifactSha256}));
})().catch(async error=>{
  errors.push(String(error));
  if(page)await page.screenshot({path:path.join(qa,'preview-error.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(qa,'preview-results.json'),JSON.stringify(receipt(false),null,2));
  console.error(error);process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close()});
