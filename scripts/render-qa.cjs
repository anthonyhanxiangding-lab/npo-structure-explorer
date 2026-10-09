// Local generated-artifact rendering only; no interactive user browser or external pages.
const playwrightModule=process.env.NPO_PLAYWRIGHT_MODULE||'playwright';
let chromium;
try{({chromium}=require(playwrightModule))}catch(error){
  throw new Error(`Unable to load Playwright from ${playwrightModule}. Install project dependencies with npm ci, or set NPO_PLAYWRIGHT_MODULE to an explicit module path.`,{cause:error});
}
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const {pathToFileURL}=require('url');
const projectRoot=path.resolve(__dirname,'..');
const qaDir=path.resolve(process.env.NPO_QA_DIR||path.join(projectRoot,'qa'));
const artifact=path.join(projectRoot,'NPO结构探索器.html');
const qaPath=name=>path.join(qaDir,name);
const checks=[],errors=[],requests=[];
let browser,page;
const mark=name=>checks.push(name);
const state=()=>page.evaluate(()=>NPO.getState());
async function expectView(id){
  await page.waitForFunction(id=>NPO.getState().view===id&&NPO.getState().selected===id,id);
  assert.equal(await page.locator('#tree [aria-selected="true"]').getAttribute('data-select'),id,'tree selection follows focused view');
  await page.waitForTimeout(1000);
}
async function searchFor(query,id,{enter=false}={}){
  await page.locator('#component-search').fill(query);
  if(enter)await page.locator('#component-search').press('Enter');
  await expectView(id);
}
// Locate a visible mesh through actual mouse hover, then click the canvas itself.
// A label or direct NPO.select call cannot stand in for the model hit test.
async function findMeshPoint(){
  const canvas=page.locator('#viewport canvas');
  const box=await canvas.boundingBox();assert(box,'3D canvas has visible bounds');
  const names=await page.evaluate(()=>NPO.database.components.map(n=>({id:n.id,name:n.name})));
  const current=(await state()).view;
  for(const [cols,rows] of [[12,9],[24,18]]){
    for(let row=2;row<rows-1;row++)for(let col=1;col<cols;col++){
      const x=box.x+box.width*col/cols,y=box.y+box.height*row/rows;
      const onCanvas=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.matches('#viewport canvas'),{x,y});
      if(!onCanvas)continue;
      await page.mouse.move(x,y);
      const tooltip=await page.locator('#scene-tooltip').evaluate(el=>getComputedStyle(el).display==='none'?'':el.textContent);
      const node=names.find(n=>tooltip.startsWith(n.name+' · '));
      if(node&&node.id!==current)return {x,y,id:node.id};
    }
  }
  throw Error('No visible child mesh could be located by real pointer hover');
}
function result(passed,extra={}){
  return {passed,checkedAt:new Date().toISOString(),artifact:path.basename(artifact),artifactSha256:crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),errors,externalRequests:requests,checks,...extra};
}
(async()=>{
  if(!fs.existsSync(artifact))throw new Error(`Generated HTML is missing: ${artifact}. Run npm run build before browser QA.`);
  fs.mkdirSync(qaDir,{recursive:true});
  const launchOptions={headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
  if(process.env.NPO_CHROMIUM_EXECUTABLE)launchOptions.executablePath=process.env.NPO_CHROMIUM_EXECUTABLE;
  browser=await chromium.launch(launchOptions);
  page=await browser.newPage({viewport:{width:1600,height:1050},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.route(/^https?:/,r=>{requests.push(r.request().url());r.abort()});
  await page.addInitScript(()=>{try{localStorage.removeItem('npo-explorer-v1')}catch{}});
  const loadedArtifactHash=crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  await page.goto(pathToFileURL(artifact).href);
  await page.waitForFunction(()=>window.NPO);
  assert(await page.evaluate(()=>!!NPO.scene),'3D scene initialized');
  await page.waitForTimeout(1800);
  assert.equal(errors.length,0,errors.join(' | '));
  await page.screenshot({path:qaPath('01-overview.png')});mark('offline primary HTML loads with WebGL');

  // A single tree click must change both selected and view, without an enter button.
  await page.locator('.tree-item[data-select="fau"] .tree-name').click();await expectView('fau');
  let s=await state();assert.equal(s.quantities.fau,4);mark('tree single click focuses corresponding 3D view');
  await page.locator('[data-lane="400"]').click();await expectView('fau');s=await state();
  assert.equal(s.quantities.fau,2);assert.equal(s.quantities.fiber,16);
  await page.screenshot({path:qaPath('02-fau-live.png')});
  await page.locator('[data-rate="6.4"]').click();await expectView('fau');s=await state();assert.equal(s.quantities.fau,4);
  await page.locator('#settings').click();await page.locator('[data-setting="fauCapacity"]').selectOption('16');await page.locator('#settings-dialog .primary').click();await expectView('fau');s=await state();
  assert.equal(s.quantities.fau,2);assert.equal(s.quantities.fiber,32);mark('lane rate, bandwidth, and capacity changes preserve focused component');

  const monitor=await page.evaluate(()=>NPO.database.components.find(n=>n.id==='monitor_pd'));
  assert(monitor?.estimate,'monitor PD estimate is embedded in primary HTML');
  await searchFor('隔离器','isolator');mark('Chinese search automatically focuses 3D view');
  await searchFor(monitor.en,'monitor_pd',{enter:true});mark('English search with Enter focuses 3D view');
  const pdAlias=(monitor.aliases||[]).find(alias=>/pd/i.test(alias)&&alias.toLowerCase()!=='pd');
  assert(pdAlias,'monitor PD has a searchable PD alias');await searchFor(pdAlias,'monitor_pd');mark('PD alias focuses monitor detector');
  await page.locator('#component-search').fill('PD');await page.waitForTimeout(450);
  s=await state();assert(['monitor_pd','photodiode'].includes(s.view),'ambiguous PD query stays within PD components');
  assert(await page.locator('.tree-item[data-select="monitor_pd"]').count()>0,'PD query includes monitor detector');mark('ambiguous PD query retains relevant detector results');
  const beforeNoMatch=(await state()).view;
  await page.locator('#component-search').fill('no_component_zz987');await page.waitForTimeout(450);
  assert.equal((await state()).view,beforeNoMatch,'no-match query must not navigate');assert(await page.locator('#tree .empty').isVisible());
  await page.locator('#component-search').fill('');assert.equal((await state()).view,beforeNoMatch);mark('no-match and cleared search do not change focused component');

  // Headless Chromium has no system IME, so reproduce the browser composition events.
  await page.locator('#component-search').evaluate(el=>{
    el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
    el.value='PIC';el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'PIC',inputType:'insertCompositionText',isComposing:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:false,keyCode:229}));
  });
  await page.waitForTimeout(450);assert.equal((await state()).view,beforeNoMatch,'unfinished IME composition and composing Enter must not navigate');
  await page.locator('#component-search').evaluate(el=>{
    el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'PIC'}));
    el.dispatchEvent(new InputEvent('input',{bubbles:true,data:'PIC',inputType:'insertText',isComposing:false}));
  });
  await expectView('pic');mark('IME event sequence focuses only after composition is committed');
  await page.locator('#component-search').fill('');

  await page.locator('#home-view').click();await expectView('npo');
  let point=await findMeshPoint();const beforeDrag=(await state()).view;
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  await page.mouse.move(point.x+45,point.y+20,{steps:6});await page.mouse.move(point.x,point.y,{steps:6});await page.mouse.up();
  await page.waitForTimeout(450);assert.equal((await state()).view,beforeDrag,'dragging a mesh must not enter it even if release returns to the initial point');mark('real pointer drag does not trigger navigation');
  await page.locator('#reset-camera').click();await page.waitForTimeout(1100);point=await findMeshPoint();
  await page.mouse.click(point.x,point.y);await expectView(point.id);mark(`real canvas mesh single click enters ${point.id}`);
  await page.screenshot({path:qaPath('07-single-click.png')});

  await page.locator('[data-rate="3.2"]').click();await page.locator('[data-lane="200"]').click();
  await page.locator('#settings').click();await page.locator('[data-setting="fauCapacity"]').selectOption('8');await page.locator('#settings-dialog .primary').click();
  await searchFor(monitor.name,'monitor_pd');
  async function monitorSnapshot(){
    const value=await page.evaluate(()=>{
      const s=NPO.getState(),n=NPO.database.components.find(n=>n.id==='monitor_pd');
      const current=NPO.computeBOM(s.config,NPO.database),without=structuredClone(NPO.database);
      delete without.components.find(n=>n.id==='monitor_pd').estimate;
      return {quantity:s.quantities.monitor_pd,total:s.total,price:current.priceFor('monitor_pd'),estimate:n.estimate,withoutEstimateTotal:NPO.computeBOM(s.config,without).total};
    });
    assert(value.price.isEstimate&&!value.price.isOverride);assert.equal(value.price.total,value.estimate.base*value.quantity);
    assert.equal(value.total,value.withoutEstimateTotal,'monitor estimate allocates existing BOM budget');
    const displayMoney=v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:2});
    assert((await page.locator('#inspector .price-value').innerText()).includes(displayMoney(value.price.total)),'visible price matches monitor allocation');
    assert((await page.locator('#inspector .price-caption').innerText()).includes('估算'),'visible price is labeled estimate');
    const range=await page.locator('#inspector .estimate-range').innerText();
    assert(range.includes(displayMoney(value.estimate.low))&&range.includes(displayMoney(value.estimate.high)),'visible estimate range matches database');
    return value;
  }
  const monitor200=await monitorSnapshot();await page.locator('[data-lane="400"]').click();await expectView('monitor_pd');const monitor400=await monitorSnapshot();
  assert.equal(monitor400.quantity*2,monitor200.quantity);assert.equal(monitor400.price.total*2,monitor200.price.total);
  await page.screenshot({path:qaPath('08-monitor-pd.png')});mark('monitor estimate follows lane quantity without increasing total BOM');

  await page.locator('[data-lane="200"]').click();await searchFor('隔离器','isolator');await page.locator('#component-search').fill('');
  await page.screenshot({path:qaPath('03-isolator.png')});
  await page.locator('[data-enter="faraday"]').first().click();await expectView('faraday');await page.screenshot({path:qaPath('04-faraday.png')});
  await page.locator('[data-method="faraday"]').click();assert(await page.locator('#detail-dialog').isVisible());await page.locator('#close-detail').click();mark('nested detail and method dialog');
  // Retain original view-construction coverage independently of gesture checks above.
  for(const id of ['engine','pic','cw','substrate','control','thermal','connector','garnet','pm_fau','vgroove']){
    await page.evaluate(id=>NPO.select(id,true),id);await expectView(id);
  }
  mark('all original nested view smoke checks');
  // Inspect every price through its UI entry, including root and deeply nested materials.
  const priceNodes=await page.evaluate(()=>NPO.database.components.map(n=>({id:n.id,parent:n.parent})));
  let pricingDialogs=0;
  for(const node of priceNodes){
    await page.evaluate(id=>NPO.select(id,true),node.id);
    await page.waitForFunction(id=>NPO.getState().view===id,node.id);
    const cards=page.locator('#inspector .share-card');
    assert.equal(await cards.count(),node.parent?1:0,`${node.id}: only the immediate-parent share is shown`);
    if(node.parent)assert.equal(await cards.first().getAttribute('data-parent'),node.parent,`${node.id}: share card uses direct parent`);
    const active=await page.evaluate(id=>NPO.getState().quantities[id]>0,node.id);
    if(!active)continue;
    await page.locator(`#inspector button[data-price="${node.id}"]`).first().click();
    assert(await page.locator('#price-dialog').isVisible(),`${node.id}: price opens trace dialog`);
    for(const kind of ['total',...(node.parent?['unit','share']:[])]){
      const formula=page.locator(`#price-content .price-formula[data-formula="${kind}"]`);
      assert(await formula.count()>0,`${node.id}: ${kind} formula exists`);
      assert((await formula.first().innerText()).trim().length>5,`${node.id}: ${kind} formula has concrete content`);
    }
    assert(await page.locator('#price-dialog .detail-source a').count()>0,`${node.id}: trace contains source links`);
    await page.keyboard.press('Escape');
    assert(!await page.locator('#price-dialog').isVisible(),`${node.id}: trace dialog closes`);
    pricingDialogs++;
  }
  mark(`all ${pricingDialogs} active component prices open formulas and sources with direct-parent-only shares`);
  await page.locator('[data-tab="bom"]').click();await page.screenshot({path:qaPath('05-bom.png')});
  await page.locator('[data-tab="vendors"]').click();await page.locator('#vendor-search').fill('森一');assert(await page.locator('#vendor-rows tr:visible').count()>0);mark('BOM and vendor search');
  await page.locator('[data-tab="sources"]').click();assert(await page.locator('.source-card').count()>50);
  await page.locator('[data-tab="structure"]').click();await page.locator('#home-view').click();await expectView('npo');mark('source library');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1000);await page.screenshot({path:qaPath('06-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile overflow');mark('mobile width');
  assert.equal(requests.length,0,'must not request external network');assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(loadedArtifactHash,crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'),'Artifact must remain unchanged during QA');
  fs.writeFileSync(qaPath('browser-results.json'),JSON.stringify(result(true),null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks:checks.length,qaDir,artifact}));
})().catch(async e=>{
  errors.push(e.stack||String(e));
  if(page)try{await page.screenshot({path:qaPath('error.png'),fullPage:true})}catch{}
  try{fs.writeFileSync(qaPath('browser-results.json'),JSON.stringify(result(false),null,2)+'\n')}catch{}
  console.error(e);process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close()});
