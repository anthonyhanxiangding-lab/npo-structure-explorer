import DB from '../database.json';
import {createScene} from './scene.js';
import {defaults,normalize,quantities,computeBOM,pathTo} from './model.js';
import {searchKey,createComponentSearch} from './search.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=s=>/^https?:\/\//i.test(s||'')?s:'#';
const money=v=>v==null?'暂无拆分':`$${v.toLocaleString('en-US',{maximumFractionDigits:2})}`;
const pct=v=>v==null?'暂无拆分':`${(100*v).toFixed(1)}%`;
const num=v=>Number.isInteger(v)?String(v):Number(v).toFixed(2).replace(/0+$/,'').replace(/\.$/,'');
const benchmarkLabel=p=>`${p.period||p.year||'参考'} · ${p.base==null?'区间参考':p.currency==='USD'?`$${num(p.base)}/${(p.unit||'美元/件').split('/').pop()}`:`${num(p.base)}${p.unit||'元'}`}`;
const byId=Object.fromEntries(DB.components.map(n=>[n.id,n]));
const sources=Object.fromEntries(DB.sources.map(s=>[s.id,s]));
const childNodes=id=>DB.components.filter(n=>n.parent===id);
let saved={};try{saved=JSON.parse(localStorage.getItem('npo-explorer-v1')||'{}')}catch{}
let config=normalize(saved.config), selected=byId[saved.selected]?saved.selected:'npo', view=selected;
let overrides=saved.overrides||{}, bom, tab='structure', filter='', expanded=new Set(['npo','engine','eic','els']), explode=.32, scene=null, toastTimer, searchTimer, searchComposing=false;
pathTo(selected,DB.components).forEach(n=>expanded.add(n.id));
const icons={npo:'⬡',engine:'▦',pic:'▧',eic:'▥',driver:'▥',tia:'▥',fau:'▤',els:'◈',cw:'◉',isolator:'⊙',faraday:'◇',substrate:'▱',other:'⊞',thermal:'≋',connector:'⊡',control:'▣'};
function save(){try{localStorage.setItem('npo-explorer-v1',JSON.stringify({config,selected,view,overrides}))}catch{}}
function toast(text){$('#change-toast').textContent=text;$('#change-toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#change-toast').classList.remove('show'),4100)}
function architecture(){return DB.architectures.find(a=>a.capacityGbps===config.rate*1000&&a.opticalLaneGbps===config.laneRate)}
function routes(){const a=architecture();return DB.vendorRoutes.filter(r=>r.architectureIds?.includes(a?.id))}
function quantityLabel(id){const q=bom.quantities[id],n=byId[id];if(id==='els')return config.laser==='external'?`×${Math.ceil(q)}盒`:`×${bom.quantities.cw}路CW`;return `×${num(q)}${n.unit}`}
function qtyDetail(id){const c=config,q=bom.quantities;
  if(id==='npo')return `${c.lanes}Tx＋${c.lanes}Rx，标称单向${c.rate}T。ASIC不计入本单元。`;
  if(id==='driver'||id==='tia')return `${id==='driver'?'Tx':'Rx'}共${c.lanes}个功能通道，每颗${c[id==='driver'?'driverChannels':'tiaChannels']}通道，向上取整得到${q[id]}颗。`;
  if(id==='fau')return `${c.lanes}根Tx＋${c.lanes}根Rx，共${q.fiber}根信号纤；Tx/Rx分体，每组最多${c.fauCapacity}芯，合计${q.fau}组。`;
  if(id==='fiber')return `信号光纤为${c.lanes}Tx＋${c.lanes}Rx；不含${q.pm_fiber}根保偏供光纤。`;
  if(id==='pic')return `${c.lanes}路双向光通道÷每颗${c.picChannels}通道，向上取整为${q.pic}颗等效PIC。`;
  if(id==='els')return c.laser==='board'?`板载配置${q.cw}路CW，预算折合${num(q.els)}套8路参考光源；未假设独立板载封装节省。`:`参考盒容量8路CW，本NPO使用${q.cw}路，分摊${num(q.els)}盒；物理需${Math.ceil(q.els)}盒，余下光源路可由其他光引擎使用。`;
  if(['cw','isolator','pm_fiber'].includes(id))return `${c.lanes}条Tx通道，每路CW供${c.cwFanout}条，需${q.cw}路CW；每路一只隔离器为可视化假设，实际须满足功率预算。`;
  if(id==='faraday')return `${q.isolator}只隔离器×每只${c.rotators}片＝${q.faraday}片。不同级数或偏振结构会改变用量。`;
  if(id==='monitor_pd')return `按每路CW配置一个低速功率监测点，${q.cw}路CW对应${q.monitor_pd}路监测PD；可集成在激光器封装内，不等于${q.monitor_pd}颗独立封装器件。`;
  if(q[id]===0)return '当前结构未配置该组件，仍可查看功能与厂商资料。';
  return nDetail(id);
}
function nDetail(id){return byId[id]?.detail||''}
function setupControls(){
  $$('#rate-control button').forEach(b=>b.classList.toggle('active',+b.dataset.rate===config.rate));
  $('#lane-control').innerHTML=[200,400].map(r=>`<button data-lane="${r}" class="${r===config.laneRate?'active':''}">${Math.round(config.rate*1000/r)}×${r}G${r===400?'<small>前瞻情景</small>':''}</button>`).join('')+(config.laneRate===100?`<button class="active" data-lane="100">${config.lanes}×100G<small>参考锚点</small></button>`:'');
  $$('#laser-control button').forEach(b=>b.classList.toggle('active',b.dataset.laser===config.laser));
  const r=routes();
  $('#route-title').textContent=`${config.lanes}Tx＋${config.lanes}Rx · 电侧${config.electricalLanes}×${config.electricalLaneRate}G`;
  $('#route-note').textContent=config.laneRate===400?'前瞻情景 · 技术参考：Broadcom / Marvell，非完整NPO产品':config.laneRate===100?'3.2T研究BOM参考架构':r.filter(x=>x.binding==='exact_lane_architecture').map(x=>x.vendor).join(' / ')||'路线参考：易飞扬 / NVIDIA CPO · 内部集成按模型调整';
  $('#data-date').textContent=`资料核验 ${DB.asOf}`;
}
const searchResults=createComponentSearch(DB.components);
function focusSearch(){
  clearTimeout(searchTimer);if(searchComposing)return;const results=searchResults(filter);if(!results.length)return;
  const best=results.filter(r=>r.score===results[0].score),target=best.find(r=>r.id===selected)||best[0];
  select(target.id);$('#tree [aria-selected="true"]')?.scrollIntoView({block:'nearest'});
}
function renderTree(){
  const query=searchKey(filter),found=new Set(searchResults(filter).map(r=>r.id)),matches=id=>found.has(id)||childNodes(id).some(c=>matches(c.id));
  function row(n,depth){if(query&&!matches(n.id))return '';const children=childNodes(n.id),open=expanded.has(n.id)||query;
    return `<div role="treeitem" aria-selected="${n.id===selected}" ${children.length?`aria-expanded="${!!open}"`:''} class="tree-item ${n.id===selected?'selected':''} ${bom.quantities[n.id]===0?'inactive':''}" style="--depth:${depth}" data-select="${n.id}" title="${esc(qtyDetail(n.id))}">${children.length?`<button class="tree-toggle" data-toggle="${n.id}" aria-label="${open?'收起':'展开'}${n.name}">${open?'⌄':'›'}</button>`:'<span class="dot"></span>'}<span class="tree-name">${esc(n.name)}</span><span class="qty">${quantityLabel(n.id)}</span></div>${children.length&&open?`<div class="tree-children">${children.map(c=>row(c,depth+1)).join('')}</div>`:''}`;
  }
  $('#tree').innerHTML=row(byId.npo,0)||'<div class="empty">没有匹配器件，试试中文名称或英文缩写</div>';$('#node-count').textContent=query?`${found.size}项匹配`:`${DB.components.length-1}项`;
}
function vendorList(n,region){const list=(n.vendorLinks||[]).filter(v=>(v.region==='中国'||v.region==='国内')===(region==='国内'));return list.length?list.slice(0,5).map(v=>`<button class="vendor-chip" data-vendor="${esc(v.vendor_id)}" data-component="${n.id}">${esc(v.name)}<small>${esc(v.role||'产品能力')}</small></button>`).join(''):'<div class="inline-note">暂无已录入资料</div>'}
function priceTrace(p){
  if(p.pricingTrace)return p.pricingTrace;
  return {kind:p.active===false?'inactive':p.isOverride?'override':p.isEstimate?'unit_estimate':'source_scenario',label:p.active===false?'当前未配置':p.isOverride?'本地单价假设':p.isEstimate?'数量级估算':'资料基准测算',explanation:p.note||'',assumptions:[],sourceIds:p.estimate?.sourceIds||[]};
}
function priceTone(p){return ['allocation_estimate','unit_estimate','override'].includes(priceTrace(p).kind)?'amber':p.total!=null?'teal':''}
function priceAmount(id,p,cls=''){return `<button class="price-link ${cls}" data-price="${id}" aria-label="查看${esc(byId[id].name)}的价格依据与公式">${p.total!=null&&!p.isOverride&&p.active!==false?'约':''}${money(p.total)}</button>`}
function card(label,val,parentId){return `<div class="share-card" data-parent="${esc(parentId)}"><span>${esc(label)}</span><strong class="${val==null?'unknown':''}">${pct(val)}</strong><div class="bar"><i style="width:${val==null?0:Math.max(0,Math.min(100,100*val))}%"></i></div></div>`}
function renderInspector(){
  const n=byId[selected],p=bom.priceFor(selected),children=childNodes(selected),parent=byId[p.parentId||n.parent],trace=priceTrace(p);
  const priceCaption=trace.kind==='inactive'?'当前配置未使用此组件':trace.kind==='allocation_estimate'?'按上级预算分配，分配比例为工程假设':trace.kind==='unit_estimate'?'数量级估算，非厂商报价':trace.kind==='override'?'本地单价假设':trace.kind==='aggregate'?'各项预算汇总，子组件不重复相加':'资料基准测算，非当前规格确认报价';
  const sourcePrices=n.benchmark_prices||[];
  $('#inspector').innerHTML=`<span class="eyebrow">当前选中 / SELECTED COMPONENT</span><h2>${esc(n.name)}</h2><div class="part-en">${esc(n.en)}</div><div class="tag-row"><span class="tag">${esc(n.category)}</span>${parent?`<span class="tag">${esc(parent.name)}内部</span>`:''}<span class="tag ${priceTone(p)}">${esc(trace.label)}</span></div><p class="part-role">${esc(n.role)}</p><div class="qty-summary"><span>本NPO用量</span><strong>${num(bom.quantities[selected])}<small>${esc(n.unit)}${selected==='els'?'等效分摊':''}</small></strong></div><p class="qty-explain">${esc(qtyDetail(selected))}</p><div class="price-top"><span>${selected==='npo'?'整体NPO参考BOM':'本NPO内合计价值'}</span>${priceAmount(selected,p,`price-value ${p.total==null?'unknown':''}`)}</div><div class="price-caption">${esc(priceCaption)}${p.unit!=null&&selected!=='npo'?`<button class="unit-price-link" data-price="${selected}">等效${money(p.unit)}/${esc(n.unit)}</button>`:''}</div><button class="price-basis-link" data-price="${selected}">价格依据与公式 <span>↗</span></button>${p.isEstimate&&p.estimate?.low!=null&&p.estimate?.high!=null?`<p class="inline-note estimate-range">估算区间${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(n.unit)} · ${esc(p.estimate.displayNote||'')}</p>`:''}${parent?`<div class="share-grid">${card(`占上一级${parent.name}的价值`,p.parentShare,parent.id)}</div>`:''}<p class="value-notice">${p.invalid?'分配超过已知预算，比例暂不展示':parent?`占比以${esc(parent.name)}为分母，子组件价值已包含在上级预算中`: '各一级组件汇总为本NPO预算，展开的子组件不重复相加'}</p>${children.length?`<button class="primary enter-btn" data-enter="${selected}">展开${selected==='npo'?'整体':'内部'}结构 <span>↗</span></button>`:`<button class="enter-btn" data-enter="${selected}">放大器件 <span>↗</span></button>`}${sourcePrices.length?`<section class="inspect-section"><h3>其他价格样本</h3>${sourcePrices.map((a,i)=>`<button class="text-link" data-benchmark="${i}" data-component="${n.id}">${esc(benchmarkLabel(a))} ↗</button>`).join('<br>')}<p class="inline-note">不同产品与采购层级的价格不直接拼入NPO BOM</p></section>`:''}${n.vendorLinks?.length?`<section class="inspect-section"><h3>${selected==='isolator'?'隔离器集成厂商':'主要厂商'}</h3><div class="supplier-grid"><div class="supplier-col"><span>国内</span>${vendorList(n,'国内')}</div><div class="supplier-col"><span>海外／中国台湾</span>${vendorList(n,'海外')}</div></div><p class="inline-note">展示产品或材料能力；具体NPO供货以对应资料为准</p></section>`:''}${children.length?`<section class="inspect-section"><h3>内部部件</h3>${children.map(c=>`<div class="details-row"><button data-select="${c.id}">${esc(c.name)} <span>›</span></button><span>${quantityLabel(c.id)}</span></div>`).join('')}</section>`:''}<section class="inspect-section"><h3>作用与结构</h3><p class="inline-note">${esc(n.detail)}</p><div class="text-links"><button class="text-link" data-method="${n.id}">数量与价值口径 ↗</button><button class="text-link" data-evidence="${n.id}">资料与来源 ↗</button>${!['npo','engine'].includes(n.id)?`<button class="text-link" data-assume="${n.id}">补充单价假设</button>`:''}</div></section>`;
}
function renderStage(){
  const n=byId[view],path=pathTo(view,DB.components);
  $('#breadcrumbs').innerHTML=path.map((c,i)=>`${i?'<span>/</span>':''}<button data-enter="${c.id}">${esc(c.name)}</button>`).join('');
  $('#back').hidden=view==='npo';$('#view-title').textContent=view==='npo'?'整体结构':n.name;$('#view-kicker').textContent=n.en.toUpperCase();
  $('#view-subtitle').textContent=view==='npo'?`ASIC仅作外部参照 · ${config.lanes}条Tx＋${config.lanes}条Rx`:`${quantityLabel(view)} · ${n.category}${bom.quantities[view]===0?' · 当前未配置':''}`;
  const children=childNodes(view),siblings=children.length?children:childNodes(n.parent).filter(c=>c.id!==view);
  $('#child-strip').innerHTML=`<div class="strip-title"><span>${children.length?'继续探索内部器件':'同级器件'}</span><span>${children.length?'点击进入，顶部选项始终可调':'当前位置已是细部结构'}</span></div><div class="strip-items">${siblings.map(c=>`<button class="child-card" data-enter="${c.id}"><span class="mini-part">${icons[c.id]||'◇'}</span><span><strong>${esc(c.name)}</strong><small>${quantityLabel(c.id)}</small></span><span>›</span></button>`).join('')||'<span class="empty">通过左侧组件树继续浏览</span>'}</div>`;
  if(scene)scene.setState({selectedId:selected,viewId:view,config,quantities:bom.quantities,nodes:byId,explode});
}
function renderAll(){bom=computeBOM(config,DB,overrides);config=bom.config;setupControls();renderTree();renderInspector();renderStage();if(tab!=='structure')renderData();$('#status-left').textContent=`${DB.components.length-1}项器件 · ${DB.sources.length}条资料 · 当前${config.rate}T / ${config.lanes}×${config.laneRate}G`;save();}
function setConfig(patch){const old=bom,oldQty=bom.quantities[selected];config=normalize({...config,...patch});renderAll();const nq=bom.quantities[selected];let text=`保持查看${byId[selected].name} · ${config.lanes}×${config.laneRate}G`;if(oldQty!==nq)text+=` · 用量${num(oldQty)} → ${num(nq)}${byId[selected].unit}`;else if(selected==='fau')text+=` · ${bom.quantities.fau}组 / ${bom.quantities.fiber}根信号纤`;toast(text);}
function select(id,enter=true){if(!byId[id])return;clearTimeout(searchTimer);clearTimeout(toastTimer);$('#change-toast').classList.remove('show');$('#scene-tooltip').style.display='none';selected=id;pathTo(id,DB.components).forEach(n=>expanded.add(n.id));if(enter&&view!==id){view=id;explode=childNodes(id).length?.48:.15;$('#explode').value=explode;}if(tab!=='structure'){tab='structure';setTab(tab);}renderAll();}
function setTab(t){tab=t;$$('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));$('#structure-view').hidden=t!=='structure';$('#data-view').hidden=t==='structure';if(t!=='structure')renderData();else renderStage();}
const sourceTypes={wechat_estimate:'公众号测算',broker_estimate:'券商测算',official:'官方资料',official_product:'官方产品资料',datasheet:'产品规格书',public_quote:'公开报价',retail_quote:'零售参考报价',distributor_catalog:'分销商目录价',engineering_assumption:'工程假设'};
function sourceLinks(ids){return [...new Set(ids||[])].filter(id=>sources[id]).map(id=>{const s=sources[id];return `<div class="detail-source"><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a><small>${sourceTypes[s.type]?`${esc(sourceTypes[s.type])} · `:''}${esc(s.date||'发布日期未标明')} · 核验${esc(s.accessed||DB.asOf)}</small><p>${esc(Array.isArray(s.supports)?s.supports.join('；'):s.supports||'')}</p><p>${esc(s.scope||s.limitation||'')}</p>${s.locator?`<p>${esc(s.locator)}</p>`:''}</div>`}).join('')||'<p class="empty">该细部暂无独立来源记录，保留上级功能与成本包含关系</p>'}
function showDetail(title,html){$('#detail-title').textContent=title;$('#detail-content').innerHTML=html;$('#detail-dialog').showModal();}
function evidence(id){const n=byId[id];const ids=[...(n.sourceIds||[]),...(n.vendorLinks||[]).flatMap(v=>v.source_ids||[])];showDetail(`${n.name} · 资料`,sourceLinks(ids));}
function showPrice(id){
  const n=byId[id];if(!n)return;
  const p=bom.priceFor(id),trace=priceTrace(p),parent=byId[p.parentId||n.parent],assumptions=Array.isArray(trace.assumptions)?trace.assumptions:[],sourceIds=[...new Set(trace.sourceIds||[])];
  const formula=(label,value,key)=>value?`<div class="price-formula" data-formula="${key}"><span>${esc(label)}</span><div>${esc(value)}</div></div>`:'';
  const trail=pathTo(id,DB.components).map((c,i)=>`${i?'<span>/</span>':''}<button data-price="${c.id}" ${c.id===id?'aria-current="page"':''}>${esc(c.name)}</button>`).join('');
  $('#price-title').textContent=`${n.name} · 价格依据`;
  $('#price-content').innerHTML=`<div class="price-trail" aria-label="价格归属路径">${trail}</div><div class="price-trace-heading"><span class="tag ${priceTone(p)}">${esc(trace.label)}</span><span>${config.rate}T · ${config.lanes}×${config.laneRate}G</span></div><div class="price-metrics"><div><span>本NPO内合计价值</span><strong>${money(p.total)}</strong></div>${id!=='npo'?`<div><span>等效单价</span><strong>${p.unit==null?'暂无拆分':`${money(p.unit)}<small>/${esc(n.unit)}</small>`}</strong></div>`:''}${parent?`<div><span>占${esc(parent.name)}</span><strong>${pct(p.parentShare)}</strong></div>`:''}</div>${trace.explanation?`<p class="detail-paragraph">${esc(trace.explanation)}</p>`:''}<section class="price-section"><h3>当前配置的计算过程</h3>${formula('合计价值',trace.formula,'total')}${formula('等效单价',trace.unitFormula,'unit')}${parent?formula(`占上一级${parent.name}`,trace.shareFormula,'share'):''}${!trace.formula?'<p class="inline-note">当前记录尚未提供计算公式</p>':''}${p.isEstimate&&p.estimate?.low!=null&&p.estimate?.high!=null?`<p class="inline-note">单价估算区间为${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(n.unit)}，表内采用中心值</p>`:''}</section>${assumptions.length?`<section class="price-section"><h3>采用的假设</h3><ul class="price-assumptions">${assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></section>`:''}<section class="price-section"><h3>来源与适用范围</h3><p class="inline-note">资料保留各自适用范围；预算分配或数量级估算不代表厂商报价</p>${sourceIds.some(sid=>sources[sid])?sourceLinks(sourceIds):'<p class="empty">此项没有独立公开报价，采用本页所列的本地假设或上级预算分配</p>'}</section>${parent?`<button class="price-parent-link" data-price="${parent.id}"><span>继续查看上一级${esc(parent.name)}</span><strong>${money(bom.priceFor(parent.id).total)} <span>↗</span></strong></button>`:''}`;
  const dialog=$('#price-dialog');if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
}

function showRoutes(){const a=architecture(),r=routes();showDetail('当前架构与厂商路线',`<p class="detail-paragraph"><strong>${config.rate}T · ${config.lanes}×${config.laneRate}G光通道</strong><br>${config.laneRate===400?'本页面为400G光、电接口同速的前瞻情景。下列400G相关产品仅验证技术方向，不等于本模型的NPO产品或具体供货关系。':a?.displayStatus||'100G参考架构，基准BOM来自独立研究估计'}</p>${r.map(x=>`<p class="detail-paragraph"><strong>${esc(x.vendor)} · ${esc(x.product)}</strong><br>${esc(x.display)}<br>${esc(x.caveat)}</p>${sourceLinks(x.sourceIds)}`).join('')}${config.laneRate===400?'<div class="warning-box">若电侧保持200G而光侧采用400G，需增加速率转换路径，本模型没有把这一路线与400G直连情景混在一起</div>':''}`)}
function showMethod(id){const p=bom.priceFor(id);showDetail(`${byId[id].name} · 数量与价值`, `<p class="detail-paragraph"><strong>数量</strong><br>${esc(qtyDetail(id))}</p><p class="detail-paragraph"><strong>价值归属</strong><br>${esc(p.note)}<br>${esc(bom.method)}<br>ASIC不计入BOM，子件仅作为父级预算内部的分配，不能把父级采购额与子件价值相加。</p><p class="detail-paragraph"><strong>配置变化如何影响参考预算</strong><br>PIC和基板按带宽比例外推；Driver＋TIA与信号FAU按通道／纤芯数外推；光源按8路CW盒的占用份额分摊。封装颗数减少不等于功能预算等比例下降，200G及400G的高速溢价和良率尚未纳入。</p><div class="warning-box">该机械缩放模型用于理解结构与数量，不用于证明400G路线比200G路线更便宜。真实BOM仍需对应规格报价。</div>${p.isEstimate&&p.estimate?`<p class="detail-paragraph"><strong>数量级估算</strong><br>中心${money(p.estimate.base)}/${esc(byId[id].unit)}，范围${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(byId[id].unit)}<br>${esc(p.estimate.basis||p.estimate.scope)}</p>${sourceLinks(p.estimate.sourceIds)}`:''}${sourceLinks([DB.priceAnchor.sourceId])}`);}
function showAssume(id){const p=bom.priceFor(id),n=byId[id];showDetail(`${n.name} · 本地单价假设`,`<p class="detail-paragraph">为当前单个${esc(n.unit)}输入美元单价。输入只保存在这台设备，并随导出数据一并保存。末级价格作为上级预算的内部拆分；若超过父级预算，会拒绝保存。</p><div class="assumption-form"><input id="assumption-price" type="number" min="0" step="0.01" placeholder="美元/${esc(n.unit)}" value="${overrides[id]??''}"><button class="primary" id="save-assumption" data-id="${id}">保存</button><button id="clear-assumption" data-id="${id}">清除</button></div><p class="inline-note">当前用量${num(bom.quantities[id])}${n.unit}，${p.includedIn?`价值归属于${byId[p.includedIn].name}`:'此项属于已定义的参考预算层'}。资料库原始参考值不会被修改。</p><div id="assumption-error" class="warning-box" hidden></div>`);}
function renderData(){
  const root=$('#data-view');
  if(tab==='bom'){
    const ids=Object.keys(DB.priceAnchor.groups);
    const parentCell=(n,p)=>{const parent=byId[p.parentId||n.parent];return `<strong>${pct(p.parentShare)}</strong><small>占${esc(parent?.name||'上一级组件')}</small><div class="inline-bar"><i style="width:${Math.max(0,Math.min(100,(p.parentShare||0)*100))}%"></i></div>`};
    const priceCell=(n,p)=>`${priceAmount(n.id,p)}<small>${esc(priceTrace(p).label)}</small><button class="table-price-basis" data-price="${n.id}">依据与公式 ↗</button>`;
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">VALUE STRUCTURE</span><h2>整体NPO的BOM</h2><p>按当前配置计算各组件价值，逐项显示其占直接上一级的比例。点击价格可查看资料、代入数字的公式和工程假设；ASIC不计入预算</p></div><div class="total-card"><small>当前配置参考情景</small>${priceAmount('npo',bom.priceFor('npo'))}<small>${config.rate}T · ${config.lanes}×${config.laneRate}G</small><button class="text-link" data-price="npo">价格依据与公式 ↗</button></div></div><div class="table-overflow"><table class="data-table"><thead><tr><th>主要预算项目</th><th>本NPO用量</th><th>本NPO内合计价值</th><th>占直接上一级</th><th>测算说明</th></tr></thead><tbody>${ids.map(id=>{const n=byId[id],p=bom.priceFor(id);return `<tr><td><button data-enter="${id}">${esc(n.name)} ↗</button><small>${esc(n.en)}</small></td><td>${quantityLabel(id)}</td><td class="amount-cell">${priceCell(n,p)}</td><td class="amount-cell parent-share-cell">${parentCell(n,p)}</td><td><small>${esc(priceTrace(p).explanation||p.note)}</small></td></tr>`}).join('')}</tbody></table></div><div class="note-box"><strong>读数边界</strong><br>主要预算以已归档的3.2T 32×100G研究BOM为资料基准，未披露的细部采用工程分配或单价估算。各级子组件已计入上级预算，不能跨层相加。高速溢价、良率和具体采购条件尚未纳入<br><button class="text-link" id="baseline">切换到3.2T 32×100G参考锚点 ↗</button>　<button class="text-link" data-method="npo">查看模型口径 ↗</button></div>${bom.warnings.length?`<div class="warning-box">${bom.warnings.map(esc).join('<br>')}</div>`:''}<div class="data-heading value-detail-heading"><div><h2>逐级价值归属</h2><p>占比仅以各组件的直接上一级为分母。例如法拉第旋片占光隔离器，TIA占EIC，接收PD占PIC</p></div></div><div class="table-overflow"><table class="data-table"><thead><tr><th>器件</th><th>本NPO用量</th><th>等效单价</th><th>本NPO内合计价值</th><th>占直接上一级</th></tr></thead><tbody>${DB.components.filter(n=>n.id!=='npo').map(n=>{const p=bom.priceFor(n.id);return `<tr><td><button data-enter="${n.id}">${esc(n.name)} ↗</button><small>${esc(n.en)}</small></td><td>${quantityLabel(n.id)}</td><td class="amount-cell"><button class="unit-price-link" data-price="${n.id}">${p.unit==null?'暂无拆分':`${money(p.unit)}/${esc(n.unit)}`}</button></td><td class="amount-cell">${priceCell(n,p)}</td><td class="amount-cell parent-share-cell">${parentCell(n,p)}</td></tr>`}).join('')}</tbody></table></div>`;
  }else if(tab==='vendors'){
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">SUPPLY CHAIN</span><h2>从组件到厂商</h2><p>区分材料、元件、器件集成及产品能力，保留国内外厂商。点击器件返回3D结构，点击厂商查看关联资料。</p></div></div><div class="table-filters"><input id="vendor-search" placeholder="搜索厂商、器件、材料" aria-label="搜索厂商"><span>${DB.components.reduce((s,n)=>s+(n.vendorLinks||[]).length,0)}条器件与厂商关系</span></div><div class="table-overflow"><table class="data-table"><thead><tr><th>器件</th><th>厂商</th><th>地区</th><th>产品或材料角色</th><th>信息边界</th></tr></thead><tbody id="vendor-rows">${DB.components.flatMap(n=>(n.vendorLinks||[]).map(v=>`<tr data-vendor-row="${esc(`${n.name} ${v.name} ${v.role}`.toLowerCase())}"><td><button data-enter="${n.id}">${esc(n.name)} ↗</button></td><td><button data-vendor="${esc(v.vendor_id)}" data-component="${n.id}">${esc(v.name)} ↗</button></td><td>${esc(v.region)}</td><td>${esc(v.role)}</td><td><small>${esc(v.note||v.status||'对应产品能力，非确认NPO供货')}</small></td></tr>`)).join('')}</tbody></table></div>`;
  }else{
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">RESEARCH DATABASE</span><h2>资料库与更新记录</h2><p>组件、厂商、架构和参考价格存储在同一数据库。当前核验截至${DB.asOf}；不会在打开网页时自动联网更新，保留来源日期便于后续维护。</p></div><button class="icon-btn" id="export-library">导出完整数据库 ↗</button></div><div class="table-filters"><input id="source-search" placeholder="搜索来源、关键词" aria-label="搜索来源"><span>${DB.sources.length}条来源</span></div><div class="source-list">${DB.sources.map(s=>`<article class="source-card" data-source-row="${esc(`${s.title} ${s.id} ${s.supports}`.toLowerCase())}"><span class="source-id">${esc(s.id)} · ${esc(s.date||'日期未标明')}</span><h3><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></h3><p>${esc(Array.isArray(s.supports)?s.supports.join('；'):s.supports||'')}</p><p>${esc(s.scope||s.limitation||'')}</p><p style="margin-top:10px">最近核验 ${esc(s.accessed||DB.asOf)}</p></article>`).join('')}</div><div class="note-box">${esc(DB.researchStatus||'一手公开资料与已归档材料交叉使用')}<br>结构层级、架构数量假设及来源均包含在导出数据库中。网页仅使用内嵌数据，无账号、无访问限制、无需联网加载模型。</div>`;
  }
}
function settings(){
 const specs=[['driverChannels','每颗Driver通道数',[4,8,16],'改变芯片颗数，保留总Tx功能通道'],['tiaChannels','每颗TIA通道数',[4,8,16],'改变芯片颗数，保留总Rx功能通道'],['picChannels','每颗PIC的双向通道数',[4,8,16],'等效芯片集成假设，非产品实测颗数'],['fauCapacity','每组FAU纤芯容量',[4,8,16],'Tx与Rx分体排纤，分别向上取整'],['cwFanout','每路CW供光通道数',[1,2,4,8],'需另行满足激光功率与链路损耗预算'],['rotators','每只隔离器旋片数',[1,2],'单级或双级等效用量'],['fauLens','FAU透镜耦合',['true','false'],'直接耦合情景可关闭透镜阵列'],['interposer','使用中介层',['false','true'],'显示可选的精密互连层']];
 $('#settings-content').innerHTML=specs.map(([key,label,vals,note])=>`<label class="settings-field"><span>${label}</span><select data-setting="${key}">${vals.map(v=>`<option value="${v}" ${String(config[key])===String(v)?'selected':''}>${v==='true'?'启用':v==='false'?'关闭':v}</option>`).join('')}</select><small>${note}</small></label>`).join('');$('#settings-dialog').showModal();
}
function download(name,content,type='application/json'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportDB(){download(`NPO数据库_${DB.asOf}.json`,JSON.stringify({...DB,session:{config,selected,view,priceOverrides:overrides,exportedAt:new Date().toISOString()}},null,2))}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab){setTab(b.dataset.tab);return}
  if(b.dataset.rate){setConfig({rate:+b.dataset.rate});return}
  if(b.dataset.lane){setConfig({laneRate:+b.dataset.lane});return}
  if(b.dataset.laser){setConfig({laser:b.dataset.laser});return}
  if(b.dataset.toggle){const id=b.dataset.toggle;expanded.has(id)?expanded.delete(id):expanded.add(id);renderTree();return}
  if(b.dataset.enter){select(b.dataset.enter,true);return}
  if(b.dataset.select){select(b.dataset.select);return}
  if(b.dataset.price){showPrice(b.dataset.price);return}
  if(b.dataset.method){showMethod(b.dataset.method);return}
  if(b.dataset.evidence){evidence(b.dataset.evidence);return}
  if(b.dataset.assume){showAssume(b.dataset.assume);return}
  if(b.dataset.vendor){const n=byId[b.dataset.component],v=n.vendorLinks.find(v=>v.vendor_id===b.dataset.vendor);showDetail(v.name,`<p class="detail-paragraph"><strong>${esc(n.name)} · ${esc(v.role)}</strong><br>${esc(v.note||'对应产品能力，不代表特定NPO供货关系')}</p>${sourceLinks(v.source_ids)}`);return}
  if(b.dataset.benchmark!=null){const p=byId[b.dataset.component].benchmark_prices[+b.dataset.benchmark];showDetail('其他价格样本',`<p class="detail-paragraph"><strong>${esc(benchmarkLabel(p))}</strong><br>${esc(p.scope||p.description||'其他规格参考，不计入NPO默认BOM')}<br><br>此价格来自其他产品或采购层级，只用于比较量级，未纳入当前BOM及占比</p>${sourceLinks(p.source_ids)}`);return}
  const id=b.id;
  if(id==='back'){select(byId[view].parent||'npo',true)}
  if(id==='home-view')select('npo',true);
  if(id==='settings')settings();
  if(id==='reset-settings'){config=normalize({...defaults,rate:config.rate,laneRate:config.laneRate,laser:config.laser});renderAll();$('#settings-dialog').close();settings()}
  if(id==='route-detail')showRoutes();
  if(id==='reset-camera')scene?.reset();
  if(id==='zoom-in')scene?.zoom(-1);
  if(id==='zoom-out')scene?.zoom(1);
  if(id==='close-detail')$('#detail-dialog').close();
  if(id==='close-price')$('#price-dialog').close();
  if(['export','export-library'].includes(id))exportDB();
  if(id==='baseline'){setConfig({rate:3.2,laneRate:100,cwFanout:8,fauCapacity:8});toast('已切换到参考模型锚点；本地单价假设仍保留')}
  if(id==='capture'){try{const a=document.createElement('a');a.download=`NPO_${byId[view].name}_${config.rate}T.png`;a.href=scene.capture();a.click()}catch{toast('当前环境无法保存模型截图')}}
  if(id==='save-assumption'){const value=$('#assumption-price').value.trim(),target=b.dataset.id;if(value===''||!Number.isFinite(+value)||+value<0){$('#assumption-error').hidden=false;$('#assumption-error').textContent='请输入非负的有效单价';return}const test=computeBOM(config,DB,{...overrides,[target]:+value});if(test.warnings.length){$('#assumption-error').hidden=false;$('#assumption-error').textContent=test.warnings.join('；');return}overrides[target]=+value;$('#detail-dialog').close();renderAll();toast('已保存本地单价假设，资料库原始值未改写')}
  if(id==='clear-assumption'){delete overrides[b.dataset.id];$('#detail-dialog').close();renderAll()}
});
$('#tree').addEventListener('click',e=>{if(e.target.closest('button'))return;const r=e.target.closest('[data-select]');if(r)select(r.dataset.select)});
function updateSearch(event){filter=event.target.value;clearTimeout(searchTimer);renderTree();if(!searchComposing&&!event.isComposing&&searchKey(filter))searchTimer=setTimeout(focusSearch,300);}
document.addEventListener('input',e=>{if(e.target.id==='component-search')updateSearch(e);if(e.target.id==='vendor-search')$$('[data-vendor-row]').forEach(r=>r.hidden=!r.dataset.vendorRow.includes(e.target.value.toLowerCase()));if(e.target.id==='source-search')$$('[data-source-row]').forEach(r=>r.hidden=!r.dataset.sourceRow.includes(e.target.value.toLowerCase()));if(e.target.id==='explode'){explode=+e.target.value;scene?.setExplode(explode)}});
$('#component-search').addEventListener('compositionstart',()=>{searchComposing=true;clearTimeout(searchTimer)});
$('#component-search').addEventListener('compositionend',e=>{searchComposing=false;updateSearch(e)});
$('#component-search').addEventListener('keydown',e=>{if(e.key==='Enter'&&!searchComposing&&!e.isComposing&&e.keyCode!==229){e.preventDefault();focusSearch();}});
document.addEventListener('change',e=>{if(e.target.dataset.setting){const key=e.target.dataset.setting;setConfig({[key]:['fauLens','interposer'].includes(key)?e.target.value==='true':+e.target.value})}});
for(const d of $$('dialog'))d.addEventListener('click',e=>{if(e.target===d)d.close()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$$('dialog[open]').length&&view!=='npo')select(byId[view].parent||'npo',true)});
renderAll();
try{scene=createScene($('#viewport'),{onSelect:id=>select(id),onEnter:id=>select(id,true),onHover:(id,event)=>{const tt=$('#scene-tooltip');if(!id||!byId[id]){tt.style.display='none';return}tt.style.display='block';tt.textContent=`${byId[id].name} · ${quantityLabel(id)} · 单击进入`;const rect=$('.product-stage').getBoundingClientRect();tt.style.left=`${Math.min((event?.clientX||rect.left+80)-rect.left+13,rect.width-220)}px`;tt.style.top=`${Math.max(110,(event?.clientY||rect.top+140)-rect.top-30)}px`;}});$('.scene-loading')?.remove();renderStage();}catch(err){console.error(err);$('#viewport').innerHTML='<div class="webgl-fallback"><h2>3D渲染暂不可用</h2><p>请使用支持WebGL的Chrome或Edge，并开启硬件加速<br>组件树、数量联动、BOM和厂商资料仍可使用</p></div>'}
// Deterministic diagnostics for local artifact QA; not a network service.
window.NPO={getState:()=>({config,selected,view,tab,quantities:bom.quantities,total:bom.total,warnings:bom.warnings}),select,setConfig,setTab,database:DB,computeBOM,scene};
