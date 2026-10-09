import DB from '../database.json';
import {createScene} from './scene.js';
import {defaults,normalize,quantities,computeBOM,pathTo,makePriceOverride,priceSpecKey,compareBOM} from './model.js';
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
let overrides=Object.fromEntries(Object.entries(saved.overrides||{}).filter(([id,v])=>byId[id]&&v!=null).map(([id,v])=>[id,typeof v==='number'?makePriceOverride(id,v,config):v])), comparison=saved.comparison?.config?saved.comparison:null, signalPath='all', bom, tab='structure', filter='', expanded=new Set(['npo','engine','eic','els']), explode=.32, scene=null, toastTimer, searchTimer, searchComposing=false;
pathTo(selected,DB.components).forEach(n=>expanded.add(n.id));
const icons={npo:'⬡',engine:'▦',pic:'▧',eic:'▥',driver:'▥',tia:'▥',fau:'▤',els:'◈',cw:'◉',isolator:'⊙',faraday:'◇',substrate:'▱',other:'⊞',thermal:'≋',connector:'⊡',control:'▣'};
function save(){try{localStorage.setItem('npo-explorer-v1',JSON.stringify({config,selected,view,overrides,comparison}))}catch{}}
function toast(text){$('#change-toast').textContent=text;$('#change-toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#change-toast').classList.remove('show'),4100)}
function architecture(){return DB.architectures.find(a=>a.capacityGbps===config.rate*1000&&a.opticalLaneGbps===config.laneRate)}
function routes(){const a=architecture();return DB.vendorRoutes.filter(r=>r.architectureIds?.includes(a?.id))}
function quantityLabel(id){const q=bom.quantities[id],n=byId[id];if(id==='els')return config.laser==='external'?`${Math.ceil(q)}盒·分摊${num(q)}套`:`${bom.quantities.cw}路CW·分摊${num(q)}套`;return n.qtyRule==='els'?`分摊${num(q)}${n.unit}`:`×${num(q)}${n.unit}`}
function qtyDetail(id){const c=config,q=bom.quantities;
  if(id==='npo')return `${c.lanes}Tx＋${c.lanes}Rx，标称单向${c.rate}T。ASIC不计入本单元。`;
  if(id==='driver'||id==='tia')return `${id==='driver'?'Tx':'Rx'}共${c.lanes}个功能通道，每颗${c[id==='driver'?'driverChannels':'tiaChannels']}通道，向上取整得到${q[id]}颗。`;
  if(id==='fau')return `${c.lanes}根Tx＋${c.lanes}根Rx，共${q.fiber}根信号纤；Tx/Rx分体，每组最多${c.fauCapacity}芯，合计${q.fau}组。`;
  if(id==='fiber')return `信号光纤为${c.lanes}Tx＋${c.lanes}Rx；不含${q.pm_fiber}根保偏供光纤。`;
  if(id==='pic')return `${c.lanes}路双向光通道÷每颗${c.picChannels}通道，向上取整为${q.pic}颗等效PIC。`;
  if(id==='els')return c.laser==='board'?`板载配置${q.cw}路CW，预算折合${num(q.els)}套8路参考光源；未假设独立板载封装节省。`:`参考盒容量8路CW，本NPO使用${q.cw}路，分摊${num(q.els)}盒；模型按${Math.ceil(q.els)}盒配置；成本分摊假设余下光源路由其他光引擎共用，实际共享条件尚未验证。`;
  if(['cw','isolator','pm_fiber'].includes(id))return `${c.lanes}条Tx通道，每路CW供${c.cwFanout}条，需${q.cw}路CW；每路一只隔离器为可视化假设，实际须满足功率预算。`;
  if(id==='faraday')return `${q.isolator}只隔离器×每只${c.rotators}片＝${q.faraday}片。不同级数或偏振结构会改变用量。`;
  if(id==='monitor_pd')return `按每路CW配置一个低速功率监测点，${q.cw}路CW对应${q.monitor_pd}路监测PD；可集成在激光器封装内，不等于${q.monitor_pd}颗独立封装器件。`;
  if(id!=='els'&&byId[id].qtyRule==='els')return `本NPO分摊${num(q[id])}组8路参考光源的配套预算；实际器件数量尚未确认，不将分摊系数当作实物数量。${nDetail(id)}`;
  if(q[id]===0)return '当前结构未配置该组件，仍可查看功能与厂商资料。';
  return nDetail(id);
}
function nDetail(id){return byId[id]?.detail||''}

const modeName=()=>config.pricingMode==='cost'?'成本测算':'预算拆分';
const signedMoney=v=>`${v>0?'+':v<0?'−':''}${money(Math.abs(v))}`;
function autoSignal(id){
  if(['driver','modulator'].includes(id))return 'tx';
  if(['tia','photodiode'].includes(id))return 'rx';
  if(pathTo(id,DB.components).some(n=>n.id==='els'))return 'cw';
  return 'all';
}
const signalRoutes={
  tx:{label:'Tx发射',nodes:[['ASIC',null],['Driver','driver'],['调制器','modulator'],['信号FAU','fau'],['发射光纤','fiber']],note:'电信号驱动调制器，将数据加载到CW供光后输出；不经过本地接收PD'},
  rx:{label:'Rx接收',nodes:[['接收光纤','fiber'],['信号FAU','fau'],['接收PD','photodiode'],['TIA','tia'],['ASIC',null]],note:'接收光在PD转换为电信号，经TIA放大后送入ASIC'},
  cw:{label:'CW供光',nodes:[['CW激光器','cw'],['光隔离器','isolator'],['保偏光纤','pm_fiber'],['供光耦合','coupler'],['调制器','modulator']],note:'连续光供给发射端；监测PD用于功率反馈，TEC用于温控，均属于侧支路'}
};
function renderSignals(){
  $('#signal-controls').innerHTML=[['all','全部路径'],...Object.entries(signalRoutes).map(([k,r])=>[k,r.label])].map(([k,label])=>`<button data-signal="${k}" aria-pressed="${signalPath===k}" class="${signalPath===k?'active':''}">${label}</button>`).join('');
  const shown=signalPath==='all'?Object.entries(signalRoutes):[[signalPath,signalRoutes[signalPath]]];
  $('#signal-route').innerHTML=shown.map(([k,r])=>`<div class="signal-chain ${k}"><strong>${r.label}</strong>${r.nodes.map(([label,id],i)=>`${i?'<span class="arrow">→</span>':''}${id?`<button data-select="${id}">${label}</button>`:`<span>${label}</span>`}`).join('')}</div>`).join('')+(signalPath!=='all'?`<p>${signalRoutes[signalPath].note}</p>`:'');
}
function renderPricing(){
  $$('#pricing-control button').forEach(b=>b.classList.toggle('active',b.dataset.pricing===config.pricingMode));
  $('#pricing-total').textContent=money(bom.total);
  $('#pricing-note').textContent=config.pricingMode==='cost'?'数量×工程单价逐层汇总；未验证高速溢价、功率与良率':'固定父级预算内分配；子件单价改变可能重分配同级金额';
  const stale=bom.staleOverrides||[];
  $('#pricing-alert').hidden=!stale.length&&!bom.warnings.length;
  $('#pricing-alert').textContent=[...stale.map(x=>`${byId[x.id]?.name||x.id}单价因规格变化暂停使用`),...bom.warnings].join('；');
  $('#compare-config').disabled=!comparison;
  $('#compare-config').textContent=comparison?'与已固定配置比较':'先固定一个配置';
  $('#pin-config').textContent=comparison?'重新固定当前配置':'固定当前配置';
}
function quantitySummary(n){
  const q=bom.quantities[n.id];
  if(n.id==='els')return `<div class="qty-summary"><span>${config.laser==='external'?'模型光源盒配置':'模型CW供光路数'}</span><strong>${config.laser==='external'?Math.ceil(q):bom.quantities.cw}<small>${config.laser==='external'?'盒':'路'}</small></strong></div><div class="allocated-quantity">本NPO分摊：${num(q)}套8路参考光源预算</div>`;
  if(n.qtyRule==='els')return `<div class="qty-summary"><span>实物数量</span><strong class="quantity-unknown">待确认</strong></div><div class="allocated-quantity">本NPO分摊：${num(q)}组参考配套预算</div>`;
  return `<div class="qty-summary"><span>${({functional_channel:'功能通道数',integrated_feature:'集成功能用量',budget_group:'预算分组',functional_group:'功能分组',material_allocation:'材料核算份数'}[n.quantityKind]||'模型用量')}</span><strong>${num(q)}<small>${esc(n.unit)}</small></strong></div>`;
}
function budgetDetails(id){
  const p=bom.priceFor(id),b=p.pricingTrace?.budgetBreakdown;if(!b||!childNodes(id).length)return '';
  return `<section class="budget-detail"><h3>本层价值构成</h3>${childNodes(id).filter(n=>bom.priceFor(n.id).active).map(n=>{const c=bom.priceFor(n.id);return `<div><button data-price="${n.id}">${esc(n.name)}</button><span>${money(c.total)} · ${pct(c.parentShare)}</span></div>`}).join('')}<div class="residual-row"><span>未拆分余额</span><span>${money(b.residual)} · ${b.total>0?pct(b.residual/b.total):'不适用'}</span></div><p>余额是尚未拆开的预算，不代表已确认的某一实物部件</p></section>`;
}
function parameterDetails(trace){
  const kinds={source:'资料参数',assumption:'工程假设',override:'本地输入',quantity:'数量规则',allocation:'分配假设'};
  return trace.parameters?.length?`<section class="price-section"><h3>每个参数从哪里来</h3><div class="parameter-list">${trace.parameters.map(p=>`<article><div><strong>${esc(p.name)}</strong><span class="tag ${p.kind==='source'?'teal':'amber'}">${esc(kinds[p.kind]||p.kind)}</span></div><b>${esc(p.value)}</b><p>${esc(p.note||'')}</p>${(p.sourceIds||[]).filter(id=>sources[id]).map(id=>`<a href="${esc(safeURL(sources[id].url))}" target="_blank" rel="noopener noreferrer">${esc(sources[id].title)} ↗</a>`).join('')}</article>`).join('')}</div></section>`:'';
}
function showComparison(){
  if(!comparison)return;
  const result=compareBOM(comparison.config,comparison.overrides||{},config,overrides,DB);
  const before=computeBOM(comparison.config,DB,comparison.overrides||{}),after=bom;
  const paused=[['已固定配置',before],['当前配置',after]].flatMap(([label,m])=>(m.staleOverrides||[]).map(x=>`${label}：${byId[x.id]?.name||x.id}的已存单价不适用此规格，已暂停并回到工程参考值。`));
  const label=c=>`${c.rate}T · ${c.lanes}×${c.laneRate}G · ${c.pricingMode==='cost'?'成本测算':'预算拆分'}`;
  const fields=[['rate','带宽'],['laneRate','通道速率'],['driverChannels','Driver集成通道'],['tiaChannels','TIA集成通道'],['picChannels','PIC集成通道'],['fauCapacity','FAU容量'],['cwFanout','CW供光扇出'],['rotators','每只隔离器旋片'],['laser','光源位置'],['fauLens','FAU透镜'],['interposer','中介层']];
  showDetail('固定配置与当前配置比较',`<div class="compare-cards"><article><small>已固定配置</small><strong>${money(before.total)}</strong><p>${label(before.config)}</p></article><article><small>当前配置</small><strong>${money(after.total)}</strong><p>${label(after.config)}</p></article><article><small>总价值变化</small><strong>${signedMoney(result.delta)}</strong><p>当前减去已固定配置</p></article></div>${paused.length?`<div class="warning-box">${paused.map(esc).join('<br>')}规格变化导致报价暂停的金额影响计入单价假设与估值模式项，不代表新的采购报价</div>`:''}<h3 class="section-title">差异由什么构成</h3><div class="comparison-steps">${result.steps.map(step=>`<div data-contribution="${step.kind}"><span>${esc(step.label)}</span><strong>${signedMoney(step.amount)}</strong></div>`).join('')}</div><p class="inline-note">按数量与集成参数、供光与分摊参数、单价假设与估值模式依次替换计算，三项合计等于总差额；不同替换顺序会改变各项归因。结果用于解释模型变化，不证明实际采购成本或技术可行性</p>${result.warnings?.length?`<div class="warning-box">${result.warnings.map(esc).join('<br>')}</div>`:''}<div class="table-overflow"><table class="data-table"><thead><tr><th>参数</th><th>已固定</th><th>当前</th></tr></thead><tbody>${fields.filter(([k])=>before.config[k]!==after.config[k]).map(([k,name])=>`<tr><td>${name}</td><td>${esc(before.config[k])}</td><td>${esc(after.config[k])}</td></tr>`).join('')||'<tr><td colspan="3">结构参数相同，可比较单价输入或测算模式变化</td></tr>'}</tbody></table></div><h3 class="section-title">主要组件</h3><div class="table-overflow"><table class="data-table"><thead><tr><th>组件</th><th>已固定</th><th>当前</th><th>差额</th></tr></thead><tbody>${Object.keys(DB.priceAnchor.groups).map(id=>`<tr><td>${esc(byId[id].name)}</td><td>${money(before.base[id])}</td><td>${money(after.base[id])}</td><td>${signedMoney(after.base[id]-before.base[id])}</td></tr>`).join('')}</tbody></table></div><button id="clear-comparison" class="text-link">清除固定配置</button>`);
}

function setupControls(){
  $$('#rate-control button').forEach(b=>b.classList.toggle('active',+b.dataset.rate===config.rate));
  $('#lane-control').innerHTML=[200,400].map(r=>`<button data-lane="${r}" class="${r===config.laneRate?'active':''}">${Math.round(config.rate*1000/r)}×${r}G${r===400?'<small>前瞻情景</small>':''}</button>`).join('')+(config.laneRate===100?`<button class="active" data-lane="100">${config.lanes}×100G<small>100G参考</small></button>`:'');
  $$('#laser-control button').forEach(b=>b.classList.toggle('active',b.dataset.laser===config.laser));
  const r=routes();
  $('#route-title').textContent=`${config.lanes}Tx＋${config.lanes}Rx · 电侧${config.electricalLanes}×${config.electricalLaneRate}G`;
  $('#route-note').textContent=config.laneRate===400?'前瞻情景 · 技术参考：Broadcom / Marvell，非完整NPO产品':config.laneRate===100?`${config.rate}T研究BOM参考结构`:r.filter(x=>x.binding==='exact_lane_architecture').map(x=>x.vendor).join(' / ')||'路线参考：易飞扬 / NVIDIA CPO · 内部集成按模型调整';
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
function priceTone(p){return ['source_scenario','aggregate'].includes(priceTrace(p).kind)?'teal':'amber'}
function priceAmount(id,p,cls=''){return `<button class="price-link ${cls}" data-price="${id}" aria-label="查看${esc(byId[id].name)}的价格依据与公式">${p.total!=null&&!p.isOverride&&p.active!==false?'约':''}${money(p.total)}</button>`}
function card(label,val,parentId){return `<div class="share-card" data-parent="${esc(parentId)}"><span>${esc(label)}</span><strong class="${val==null?'unknown':''}">${pct(val)}</strong><div class="bar"><i style="width:${val==null?0:Math.max(0,Math.min(100,100*val))}%"></i></div></div>`}
function renderInspector(){
  const n=byId[selected],p=bom.priceFor(selected),children=childNodes(selected),parent=byId[p.parentId||n.parent],trace=priceTrace(p);
  const priceCaption=trace.kind==='inactive'?'当前配置未使用此组件':trace.kind==='allocation_estimate'?'按上级预算分配，分配比例为工程假设':trace.kind==='unit_estimate'?'数量级估算，非厂商报价':trace.kind==='override'?'本地单价假设':trace.kind==='aggregate'?'各项预算汇总，子组件不重复相加':config.pricingMode==='cost'?'固定工程单价与数量逐层汇总，非厂商报价':'资料基准测算，非当前规格确认报价';
  const sourcePrices=n.benchmark_prices||[];
  $('#inspector').innerHTML=`<span class="eyebrow">当前选中 / SELECTED COMPONENT</span><h2>${esc(n.name)}</h2><div class="part-en">${esc(n.en)}</div><div class="tag-row"><span class="tag">${esc(n.category)}</span>${parent?`<span class="tag">预算归属：${esc(parent.name)}</span>`:''}<span class="tag ${priceTone(p)}">${esc(trace.label)}</span></div><p class="part-role">${esc(n.role)}</p>${n.physicalParent?`<p class="inline-note">位置参考：${esc(byId[n.physicalParent]?.name||n.physicalParent)}。${esc(n.physicalParentNote||'物理形态为示意，预算归属另列')}</p>`:''}${quantitySummary(n)}<p class="qty-explain">${esc(qtyDetail(selected))}${n.quantityNote?`<br>${esc(n.quantityNote)}`:''}</p><div class="price-top"><span>${selected==='npo'?'整体NPO参考BOM':'本NPO内合计价值'}</span>${priceAmount(selected,p,`price-value ${p.total==null?'unknown':''}`)}</div><div class="price-caption">${esc(priceCaption)}${p.unit!=null&&selected!=='npo'?`<button class="unit-price-link" data-price="${selected}">等效${money(p.unit)}/${esc(n.unit)}</button>`:''}</div><button class="price-basis-link" data-price="${selected}">价格依据与公式 <span>↗</span></button>${p.isEstimate&&p.estimate?.low!=null&&p.estimate?.high!=null?`<p class="inline-note estimate-range">估算区间${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(n.unit)} · ${esc(p.estimate.displayNote||'')}</p>`:''}${parent?`<div class="share-grid">${card(`占上一级${parent.name}的价值`,p.parentShare,parent.id)}</div>`:''}<p class="value-notice">${p.invalid?'分配超过已知预算，比例暂不展示':parent?`占比以${esc(parent.name)}为分母，子组件价值已包含在上级预算中`: '各一级组件汇总为本NPO预算，展开的子组件不重复相加'}</p>${children.length?`<button class="primary enter-btn" data-expand="${selected}">展开${selected==='npo'?'整体':'内部'}结构 <span>↗</span></button>`:`<button class="enter-btn" data-focus="${selected}">放大器件 <span>↗</span></button>`}${budgetDetails(selected)}${sourcePrices.length?`<section class="inspect-section"><h3>其他价格样本</h3>${sourcePrices.map((a,i)=>`<button class="text-link" data-benchmark="${i}" data-component="${n.id}">${esc(benchmarkLabel(a))} ↗</button>`).join('<br>')}<p class="inline-note">不同产品与采购层级的价格不直接拼入NPO BOM</p></section>`:''}${n.vendorLinks?.length?`<section class="inspect-section"><h3>${selected==='isolator'?'隔离器集成厂商':'主要厂商'}</h3><div class="supplier-grid"><div class="supplier-col"><span>国内</span>${vendorList(n,'国内')}</div><div class="supplier-col"><span>海外／中国台湾</span>${vendorList(n,'海外')}</div></div><p class="inline-note">展示产品或材料能力；具体NPO供货以对应资料为准</p></section>`:''}${children.length?`<section class="inspect-section"><h3>内部部件</h3>${children.map(c=>`<div class="details-row"><button data-select="${c.id}">${esc(c.name)} <span>›</span></button><span>${quantityLabel(c.id)}</span></div>`).join('')}</section>`:''}<section class="inspect-section"><h3>作用与结构</h3><p class="inline-note">${esc(n.detail)}</p><div class="text-links"><button class="text-link" data-method="${n.id}">数量与价值口径 ↗</button><button class="text-link" data-evidence="${n.id}">资料与来源 ↗</button>${!['npo','engine'].includes(n.id)?`<button class="text-link" data-assume="${n.id}">补充单价假设</button>`:''}</div></section>`;
}
function renderStage(){
  renderSignals();
  const n=byId[view],path=pathTo(view,DB.components);
  $('#breadcrumbs').innerHTML=path.map((c,i)=>`${i?'<span>/</span>':''}<button data-enter="${c.id}">${esc(c.name)}</button>`).join('');
  $('#back').hidden=view==='npo';$('#view-title').textContent=view==='npo'?'整体结构':n.name;$('#view-kicker').textContent=n.en.toUpperCase();
  $('#view-subtitle').textContent=view==='npo'?`ASIC仅作外部参照 · ${config.lanes}条Tx＋${config.lanes}条Rx`:`${quantityLabel(view)} · ${n.category}${bom.quantities[view]===0?' · 当前未配置':''}`;
  const children=childNodes(view),siblings=children.length?children:childNodes(n.parent).filter(c=>c.id!==view);
  $('#child-strip').innerHTML=`<div class="strip-title"><span>${children.length?'继续探索内部器件':'同级器件'}</span><span>${children.length?'点击进入，顶部选项始终可调':'当前位置已是细部结构'}</span></div><div class="strip-items">${siblings.map(c=>`<button class="child-card" data-enter="${c.id}"><span class="mini-part">${icons[c.id]||'◇'}</span><span><strong>${esc(c.name)}</strong><small>${quantityLabel(c.id)}</small></span><span>›</span></button>`).join('')||'<span class="empty">通过左侧组件树继续浏览</span>'}</div>`;
  if(scene)scene.setState({selectedId:selected,viewId:view,config,quantities:bom.quantities,nodes:byId,explode,signalPath});
}
function renderAll(){bom=computeBOM(config,DB,overrides);config=bom.config;setupControls();renderPricing();renderTree();renderInspector();renderStage();if(tab!=='structure')renderData();$('#status-left').textContent=`${DB.components.length-1}项器件 · ${DB.sources.length}条资料 · 当前${config.rate}T / ${config.lanes}×${config.laneRate}G`;save();}
function setConfig(patch){const old=bom,oldQty=bom.quantities[selected];config=normalize({...config,...patch});renderAll();const nq=bom.quantities[selected];let text=`保持查看${byId[selected].name} · ${config.lanes}×${config.laneRate}G`;if(oldQty!==nq)text+=` · 用量${num(oldQty)} → ${num(nq)}${byId[selected].unit}`;else if(selected==='fau')text+=` · ${bom.quantities.fau}组 / ${bom.quantities.fiber}根信号纤`;toast(text);}
function select(id,enter=true){if(!byId[id])return;clearTimeout(searchTimer);clearTimeout(toastTimer);$('#change-toast').classList.remove('show');$('#scene-tooltip').style.display='none';selected=id;signalPath=autoSignal(id);pathTo(id,DB.components).forEach(n=>expanded.add(n.id));if(enter&&view!==id){view=id;explode=childNodes(id).length?.48:.15;$('#explode').value=explode;}if(tab!=='structure'){tab='structure';setTab(tab);}renderAll();}
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
  $('#price-content').innerHTML=`<div class="price-trail" aria-label="价格归属路径">${trail}</div><div class="price-trace-heading"><span class="tag ${priceTone(p)}">${esc(trace.label)}</span><span>${config.rate}T · ${config.lanes}×${config.laneRate}G</span></div><div class="price-metrics"><div><span>本NPO内合计价值</span><strong>${money(p.total)}</strong></div>${id!=='npo'?`<div><span>等效单价</span><strong>${p.unit==null?'暂无拆分':`${money(p.unit)}<small>/${esc(n.unit)}</small>`}</strong></div>`:''}${parent?`<div><span>占${esc(parent.name)}</span><strong>${pct(p.parentShare)}</strong></div>`:''}</div>${trace.explanation?`<p class="detail-paragraph">${esc(trace.explanation)}</p>`:''}<section class="price-section"><h3>当前配置的计算过程</h3>${formula('合计价值',trace.formula,'total')}${formula('等效单价',trace.unitFormula,'unit')}${parent?formula(`占上一级${parent.name}`,trace.shareFormula,'share'):''}${!trace.formula?'<p class="inline-note">当前记录尚未提供计算公式</p>':''}${p.isEstimate&&p.estimate?.low!=null&&p.estimate?.high!=null?`<p class="inline-note">单价估算区间为${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(n.unit)}，表内采用中心值</p>`:''}</section>${parameterDetails(trace)}${budgetDetails(id)}${assumptions.length?`<section class="price-section"><h3>采用的假设</h3><ul class="price-assumptions">${assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></section>`:''}<section class="price-section"><h3>来源与适用范围</h3><p class="inline-note">资料保留各自适用范围；预算分配或数量级估算不代表厂商报价</p>${sourceIds.some(sid=>sources[sid])?sourceLinks(sourceIds):'<p class="empty">此项没有独立公开报价，采用本页所列的本地假设或上级预算分配</p>'}</section>${parent?`<button class="price-parent-link" data-price="${parent.id}"><span>继续查看上一级${esc(parent.name)}</span><strong>${money(bom.priceFor(parent.id).total)} <span>↗</span></strong></button>`:''}`;
  const dialog=$('#price-dialog');if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
}

function showRoutes(){const a=architecture(),r=routes();showDetail('当前架构与厂商路线',`<p class="detail-paragraph"><strong>${config.rate}T · ${config.lanes}×${config.laneRate}G光通道</strong><br>${config.laneRate===400?'本页面为400G光、电接口同速的前瞻情景。下列400G相关产品仅验证技术方向，不等于本模型的NPO产品或具体供货关系。':a?.displayStatus||'100G参考架构，基准BOM来自独立研究估计'}</p>${r.map(x=>`<p class="detail-paragraph"><strong>${esc(x.vendor)} · ${esc(x.product)}</strong><br>${esc(x.display)}<br>${esc(x.caveat)}</p>${sourceLinks(x.sourceIds)}`).join('')}${config.laneRate===400?'<div class="warning-box">若电侧保持200G而光侧采用400G，需增加速率转换路径，本模型没有把这一路线与400G直连情景混在一起</div>':''}`)}
function showMethod(id){const p=bom.priceFor(id);showDetail(`${byId[id].name} · 数量与价值`, `<p class="detail-paragraph"><strong>数量</strong><br>${esc(qtyDetail(id))}</p><p class="detail-paragraph"><strong>价值归属</strong><br>${esc(p.note)}<br>${esc(bom.method)}<br>ASIC不计入BOM，父子价值已包含，不能跨层重复相加。</p><p class="detail-paragraph"><strong>配置变化如何影响参考预算</strong><br>${config.pricingMode==='cost'?'当前为成本测算：以固定3.2T 200G配置反算的工程单价为参考，数量变化逐层改变成本；未拆分余额单列。包价覆盖形成内部计价边界，子件不重复增加包价。':'当前为预算拆分：PIC和基板按带宽比例外推；Driver＋TIA与信号FAU按通道数外推；光源按8路CW盒的占用份额分摊。子件单价占用固定父级预算，会重新分配同级金额。'}</p><div class="warning-box">模型用于解释数量和假设的影响，未计高速溢价、功率约束与良率，不能证明400G路线更便宜。真实BOM仍需对应规格报价。</div>${p.isEstimate&&p.estimate?`<p class="detail-paragraph"><strong>数量级估算</strong><br>中心${money(p.estimate.base)}/${esc(byId[id].unit)}，范围${money(p.estimate.low)}至${money(p.estimate.high)}/${esc(byId[id].unit)}<br>${esc(p.estimate.basis||p.estimate.scope)}</p>${sourceLinks(p.estimate.sourceIds)}`:''}${sourceLinks([DB.priceAnchor.sourceId])}`);}
function showAssume(id){
  const p=bom.priceFor(id),n=byId[id],stored=overrides[id],matches=stored&&stored.specKey===priceSpecKey(id,config);
  const value=matches?stored.unit:'';
  const packageParent=config.pricingMode==='cost'?pathTo(id,DB.components).slice(0,-1).reverse().find(n=>bom.activeOverrides?.[n.id]!=null):null;
  showDetail(`${n.name} · 本地单价假设`,`<p class="detail-paragraph">为当前${esc(n.unit)}输入美元单价，绑定当前速率、集成与封装配置。规格变化后暂停使用，切回匹配规格可以继续使用；输入保存在这台设备并随数据导出。</p><div class="note-box">${config.pricingMode==='cost'?(packageParent?`此节点位于${esc(packageParent.name)}包价内，输入金额会占用该包价，其他未覆盖子件按权重重新分配；总额保持包价边界，超额会拒绝保存。`:'成本测算：此单价改变会向上更新成本，同级器件单价不受挤占。若输入组件包价，该包价封住内部汇总，内部明细只作解释性拆分。'):'预算拆分：末级单价占用固定父级预算，其余子件按权重分配余额；一级预算单价会改变总额。超过父级预算时拒绝保存。'}</div>${stored&&!matches?'<div class="warning-box">已存单价不适用当前规格，现已暂停。保存会替换该器件原有单价记录</div>':''}<div class="assumption-form"><input id="assumption-price" type="number" min="0" step="0.01" placeholder="美元/${esc(n.unit)}" value="${esc(value)}"><button class="primary" id="save-assumption" data-id="${id}">保存</button><button id="clear-assumption" data-id="${id}">清除</button></div><p class="inline-note">当前${config.lanes}×${config.laneRate}G，${quantityLabel(id)}。单价仍为用户假设，资料库原始值不会被修改</p><div id="assumption-error" class="warning-box" hidden></div>`);
}
function renderData(){
  const root=$('#data-view');
  if(tab==='bom'){
    const ids=Object.keys(DB.priceAnchor.groups);
    const parentCell=(n,p)=>{const parent=byId[p.parentId||n.parent];return `<strong>${pct(p.parentShare)}</strong><small>占${esc(parent?.name||'上一级组件')}</small><div class="inline-bar"><i style="width:${Math.max(0,Math.min(100,(p.parentShare||0)*100))}%"></i></div>`};
    const priceCell=(n,p)=>`${priceAmount(n.id,p)}<small>${esc(priceTrace(p).label)}</small><button class="table-price-basis" data-price="${n.id}">依据与公式 ↗</button>`;
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">VALUE STRUCTURE</span><h2>整体NPO的BOM</h2><p>按当前配置计算各组件价值，逐项显示其占直接上一级的比例。点击价格可查看资料、代入数字的公式和工程假设；ASIC不计入预算</p></div><div class="total-card"><small>${modeName()} · 工程参考情景</small>${priceAmount('npo',bom.priceFor('npo'))}<small>${config.rate}T · ${config.lanes}×${config.laneRate}G</small><button class="text-link" data-price="npo">价格依据与公式 ↗</button></div></div><div class="table-overflow"><table class="data-table"><thead><tr><th>主要预算项目</th><th>本NPO用量</th><th>本NPO内合计价值</th><th>占直接上一级</th><th>测算说明</th></tr></thead><tbody>${ids.map(id=>{const n=byId[id],p=bom.priceFor(id);return `<tr><td><button data-enter="${id}">${esc(n.name)} ↗</button><small>${esc(n.en)}</small></td><td>${quantityLabel(id)}</td><td class="amount-cell">${priceCell(n,p)}</td><td class="amount-cell parent-share-cell">${parentCell(n,p)}</td><td><small>${esc(priceTrace(p).explanation||p.note)}</small></td></tr>`}).join('')}</tbody></table></div><div class="note-box"><strong>读数边界</strong><br>主要预算以已归档的3.2T 32×100G研究BOM为资料基准，${config.pricingMode==='cost'?'当前成本模式把默认3.2T 200G配置反算的单价固定，按数量逐层汇总，并单列未拆分余额。':'当前预算模式把各级金额按工程权重拆分，子件单价会占用父级固定预算。'}父子金额已包含，不能跨层相加。高速溢价、良率和具体采购条件尚未纳入<br><button class="text-link" id="baseline">切换到3.2T 32×100G预算参考结构 ↗</button>　<button class="text-link" data-method="npo">查看模型口径 ↗</button></div>${bom.warnings.length?`<div class="warning-box">${bom.warnings.map(esc).join('<br>')}</div>`:''}<div class="data-heading value-detail-heading"><div><h2>逐级价值归属</h2><p>占比仅以各组件的直接上一级为分母。例如法拉第旋片占光隔离器，TIA占EIC，接收PD占PIC</p></div></div><div class="table-overflow"><table class="data-table"><thead><tr><th>器件</th><th>本NPO用量</th><th>等效单价</th><th>本NPO内合计价值</th><th>占直接上一级</th></tr></thead><tbody>${DB.components.filter(n=>n.id!=='npo').map(n=>{const p=bom.priceFor(n.id);return `<tr><td><button data-enter="${n.id}">${esc(n.name)} ↗</button><small>${esc(n.en)}</small></td><td>${quantityLabel(n.id)}</td><td class="amount-cell"><button class="unit-price-link" data-price="${n.id}">${p.unit==null?'暂无拆分':`${money(p.unit)}/${esc(n.unit)}`}</button></td><td class="amount-cell">${priceCell(n,p)}</td><td class="amount-cell parent-share-cell">${parentCell(n,p)}</td></tr>`}).join('')}</tbody></table></div>`;
  }else if(tab==='vendors'){
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">SUPPLY CHAIN</span><h2>从组件到厂商</h2><p>区分材料、元件、器件集成及产品能力，保留国内外厂商。点击器件返回3D结构，点击厂商查看关联资料。</p></div></div><div class="table-filters"><input id="vendor-search" placeholder="搜索厂商、器件、材料" aria-label="搜索厂商"><span>${DB.components.reduce((s,n)=>s+(n.vendorLinks||[]).length,0)}条器件与厂商关系</span></div><div class="table-overflow"><table class="data-table"><thead><tr><th>器件</th><th>厂商</th><th>地区</th><th>产品或材料角色</th><th>信息边界</th></tr></thead><tbody id="vendor-rows">${DB.components.flatMap(n=>(n.vendorLinks||[]).map(v=>`<tr data-vendor-row="${esc(`${n.name} ${v.name} ${v.role}`.toLowerCase())}"><td><button data-enter="${n.id}">${esc(n.name)} ↗</button></td><td><button data-vendor="${esc(v.vendor_id)}" data-component="${n.id}">${esc(v.name)} ↗</button></td><td>${esc(v.region)}</td><td>${esc(v.role)}</td><td><small>${esc(v.note||v.status||'对应产品能力，非确认NPO供货')}</small></td></tr>`)).join('')}</tbody></table></div>`;
  }else{
    root.innerHTML=`<div class="data-heading"><div><span class="eyebrow">RESEARCH DATABASE</span><h2>资料库与更新记录</h2><p>组件、厂商、架构和参考价格存储在同一数据库。当前核验截至${DB.asOf}；不会在打开网页时自动联网更新，保留来源日期便于后续维护。</p></div><button class="icon-btn" id="export-library">导出完整数据库 ↗</button></div><div class="table-filters"><input id="source-search" placeholder="搜索来源、关键词" aria-label="搜索来源"><span>${DB.sources.length}条来源</span></div><div class="source-list">${DB.sources.map(s=>`<article class="source-card" data-source-row="${esc(`${s.title} ${s.id} ${s.supports}`.toLowerCase())}"><span class="source-id">${esc(s.id)} · ${esc(s.date||'日期未标明')}</span><h3><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></h3><p>${esc(Array.isArray(s.supports)?s.supports.join('；'):s.supports||'')}</p><p>${esc(s.scope||s.limitation||'')}</p><p style="margin-top:10px">最近核验 ${esc(s.accessed||DB.asOf)}</p></article>`).join('')}</div><div class="note-box">${esc(DB.researchStatus||'一手公开资料与已归档材料交叉使用')}<br>结构层级、架构数量假设及来源均包含在导出数据库中。网页仅使用内嵌数据，无账号、无访问限制、无需联网加载模型。</div>`;
  }
}
function parameterDefinition(key){
 const d=DB.parameterDefinitions?.[key];if(!d)return '';
 return `<details class="parameter-definition"><summary>参数依据与限制</summary><p>${esc(d.assumption)}</p><p>${esc(d.effect)}</p><p>${esc(d.sourceBoundary)}</p>${(d.sourceIds||[]).filter(id=>sources[id]).map(id=>`<a href="${esc(safeURL(sources[id].url))}" target="_blank" rel="noopener noreferrer">${esc(sources[id].title)} ↗</a>`).join('')||'<p>暂无独立来源验证，采用工程假设</p>'}</details>`;
}
function settings(){
 const specs=[['driverChannels','每颗Driver通道数',[4,8,16],'改变芯片颗数，保留总Tx功能通道'],['tiaChannels','每颗TIA通道数',[4,8,16],'改变芯片颗数，保留总Rx功能通道'],['picChannels','每颗PIC的双向通道数',[4,8,16],'等效芯片集成假设，非产品实测颗数'],['fauCapacity','每组FAU纤芯容量',[4,8,16],'Tx与Rx分体排纤，分别向上取整'],['cwFanout','每路CW供光通道数',[1,2,4,8],'需另行满足激光功率与链路损耗预算'],['rotators','每只隔离器旋片数',[1,2],'单级或双级等效用量'],['fauLens','FAU透镜耦合',['true','false'],'直接耦合情景可关闭透镜阵列'],['interposer','使用中介层',['false','true'],'显示可选的精密互连层']];
 $('#settings-content').innerHTML=specs.map(([key,label,vals,note])=>`<label class="settings-field"><span>${label}</span><select data-setting="${key}">${vals.map(v=>`<option value="${v}" ${String(config[key])===String(v)?'selected':''}>${v==='true'?'启用':v==='false'?'关闭':v}</option>`).join('')}</select><small>${note}；参数属于结构假设</small>${parameterDefinition(key)}</label>`).join('')+['rate','laneRate','laser','pricingMode'].map(key=>`<div class="settings-field"><span>${esc(DB.parameterDefinitions?.[key]?.label||key)}</span>${parameterDefinition(key)}</div>`).join('');$('#settings-dialog').showModal();
}
function download(name,content,type='application/json'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportDB(){download(`NPO数据库_${DB.asOf}.json`,JSON.stringify({...DB,session:{config,selected,view,priceOverrides:overrides,comparison,exportedAt:new Date().toISOString()}},null,2))}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.pricing){setConfig({pricingMode:b.dataset.pricing});return}
  if(b.dataset.signal){signalPath=b.dataset.signal;renderStage();return}
  if(b.dataset.expand){explode=explode>.75?.3:.9;$('#explode').value=explode;scene?.setExplode(explode);return}
  if(b.dataset.focus){scene?.focusSelected();return}
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
  if(id==='pin-config'){comparison=structuredClone({config,overrides});save();renderPricing();toast('当前配置与单价假设已固定，可切换参数后比较')}
  if(id==='compare-config')showComparison();
  if(id==='clear-comparison'){comparison=null;save();renderPricing();$('#detail-dialog').close()}
  if(id==='back'){select(byId[view].parent||'npo',true)}
  if(id==='home-view')select('npo',true);
  if(id==='settings')settings();
  if(id==='reset-settings'){config=normalize({...defaults,rate:config.rate,laneRate:config.laneRate,laser:config.laser,pricingMode:config.pricingMode});renderAll();$('#settings-dialog').close();settings()}
  if(id==='route-detail')showRoutes();
  if(id==='reset-camera')scene?.reset();
  if(id==='zoom-in')scene?.zoom(-1);
  if(id==='zoom-out')scene?.zoom(1);
  if(id==='close-detail')$('#detail-dialog').close();
  if(id==='close-price')$('#price-dialog').close();
  if(['export','export-library'].includes(id))exportDB();
  if(id==='baseline'){setConfig({...defaults,rate:3.2,laneRate:100,cwFanout:8,fauCapacity:8,pricingMode:'allocation'});toast('已切换到32×100G预算参考结构；匹配规格的本地单价仍参与计算')}
  if(id==='capture'){try{const a=document.createElement('a');a.download=`NPO_${byId[view].name}_${config.rate}T.png`;a.href=scene.capture();a.click()}catch{toast('当前环境无法保存模型截图')}}
  if(id==='save-assumption'){const value=$('#assumption-price').value.trim(),target=b.dataset.id;if(value===''||!Number.isFinite(+value)||+value<0){$('#assumption-error').hidden=false;$('#assumption-error').textContent='请输入非负的有效单价';return}const test=computeBOM(config,DB,{...overrides,[target]:makePriceOverride(target,+value,config)});if(test.warnings.length){$('#assumption-error').hidden=false;$('#assumption-error').textContent=test.warnings.join('；');return}overrides[target]=makePriceOverride(target,+value,config);$('#detail-dialog').close();renderAll();toast('已保存本地单价假设，资料库原始值未改写')}
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
window.NPO={getState:()=>({config,selected,view,tab,quantities:bom.quantities,total:bom.total,warnings:bom.warnings,overrides,staleOverrides:bom.staleOverrides,signalPath,comparison}),select,setConfig,setTab,database:DB,computeBOM,compareBOM,scene};
