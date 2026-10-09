export const defaults={rate:3.2,laneRate:200,laser:'external',driverChannels:4,tiaChannels:4,picChannels:8,fauCapacity:8,cwFanout:4,elsShare:2,rotators:1,fauLens:true,interposer:false,pricingMode:'allocation'};
export function normalize(input={}) {
  const c={...defaults,...input};
  c.rate=[3.2,6.4].includes(+c.rate)?+c.rate:3.2;
  c.laneRate=[100,200,400].includes(+c.laneRate)?+c.laneRate:200;
  for(const k of ['driverChannels','tiaChannels','picChannels','fauCapacity']) c[k]=[4,8,16].includes(+c[k])?+c[k]:defaults[k];
  c.cwFanout=[1,2,4,8].includes(+c.cwFanout)?+c.cwFanout:4;
  c.elsShare=[1,2,4].includes(+c.elsShare)?+c.elsShare:2;
  c.rotators=[1,2].includes(+c.rotators)?+c.rotators:1;
  c.fauLens=c.fauLens===true||c.fauLens==='true';c.interposer=c.interposer===true||c.interposer==='true';
  c.laser=c.laser==='board'?'board':'external';
  c.pricingMode=c.pricingMode==='cost'?'cost':'allocation';
  c.lanes=Math.round(c.rate*1000/c.laneRate);
  // 400G direct-drive is deliberately a research scenario with a matching electrical lane rate.
  c.electricalLaneRate=c.laneRate;c.electricalLanes=c.lanes;
  return c;
}
export function quantityContext(input) {
  const c=normalize(input), lanes=c.lanes, cw=Math.ceil(lanes/c.cwFanout);
  const share=8/cw;
  return {config:c,one:1,lanes,pic:Math.ceil(lanes/c.picChannels),driver:Math.ceil(lanes/c.driverChannels),tia:Math.ceil(lanes/c.tiaChannels),fau:2*Math.ceil(lanes/c.fauCapacity),fibers:2*lanes,fauLens:c.fauLens?2*Math.ceil(lanes/c.fauCapacity):0,cw,els:cw/8,isolator:cw,faraday:cw*c.rotators,collimator:cw*2,interposer:c.interposer?1:0,share};
}
export function quantities(input,nodes) {const ctx=quantityContext(input);return Object.fromEntries(nodes.map(n=>[n.id,ctx[n.qtyRule]??1]));}
export function pathTo(id,nodes) {const map=Object.fromEntries(nodes.map(n=>[n.id,n]));const path=[];const seen=new Set();while(map[id]&&!seen.has(id)){seen.add(id);path.unshift(map[id]);id=map[id].parent;}return path;}
function computeAllocationBOM(input,db,overrides={}) {
  const ctx=quantityContext(input),c=ctx.config,q=quantities(c,db.components);
  const anchor=db.priceAnchor;
  if(!anchor?.groups) throw new Error('数据库缺少priceAnchor价格基准');
  const nodes=Object.fromEntries(db.components.map(n=>[n.id,n]));
  const children=id=>db.components.filter(n=>n.parent===id);
  const money=v=>`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:4})}`;
  const number=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
  const percent=v=>`${number(v*100)}%`;
  const unique=ids=>[...new Set(ids||[])];
  const values={},traces={},applied={},estimated={},warnings=[],invalid=new Set();
  const common='上级参考预算来自公开研究测算，未计高速器件、良率和封装差异；不代表当前厂商报价';
  const groups=Object.keys(anchor.groups),baseline=anchor.baseline;
  for(const [id,g] of Object.entries(anchor.groups)) {
    const factor=g.scaling==='bandwidth'?c.rate/baseline.rate:g.scaling==='lanes'?c.lanes/baseline.lanes:g.scaling==='laserAllocation'?q.els:1;
    values[id]=g.amount*factor;
    const calculation=g.scaling==='bandwidth'?`${money(g.amount)} × ${number(c.rate)}T ÷ ${number(baseline.rate)}T`:g.scaling==='lanes'?`${money(g.amount)} × ${c.lanes}通道 ÷ ${baseline.lanes}通道`:g.scaling==='laserAllocation'?`${money(g.amount)}/参考盒 × ${q.cw}路CW ÷ 8路/盒`:`${money(g.amount)} × 1`;
    traces[id]={kind:'source_scenario',label:'资料基准测算',formula:`${calculation} = ${money(values[id])}`,explanation:'按原始组合预算及当前配置缩放；来源本身为作者测算，不是供应商报价',assumptions:[common,anchor.description],sourceIds:[anchor.sourceId],parameters:[{name:'来源组合基准',value:g.amount,kind:'source',sourceIds:[anchor.sourceId],note:'美元，作者测算值，并非厂商报价'},{name:'当前缩放系数',value:factor,kind:'assumption',sourceIds:[],note:`${g.scaling}机械缩放，不含规格溢价`}]};
  }
  // Explicit local unit prices replace a budget allocation; they never add to its parent.
  for(const [id,val] of Object.entries(overrides)) {
    if(!nodes[id]||['npo','engine'].includes(id)||val===null||val===''||!Number.isFinite(+val)||+val<0||!(q[id]>0))continue;
    values[id]=+val*q[id];applied[id]=+val;
    traces[id]={kind:'override',label:'本地单价假设',formula:`${money(+val)}/${nodes[id].unit} × ${number(q[id])}${nodes[id].unit} = ${money(values[id])}`,explanation:'用户输入的单价假设，替代本节点默认分配值；子件不会再次叠加到父级或整体BOM',assumptions:['如本节点属于一级预算，整体预算随其修改；更低层节点只在父级预算内分配'],sourceIds:[anchor.sourceId],parameters:[{name:'本地输入单价',value:+val,kind:'override',sourceIds:[],note:`美元/${nodes[id].unit}，仅适用于绑定规格`},{name:'当前用量',value:q[id],kind:'quantity',sourceIds:[],note:nodes[id].unit}]};
  }
  values.engine=['pic','eic','fau','substrate','other'].reduce((s,id)=>s+values[id],0);
  values.npo=values.engine+values.els;
  traces.engine={kind:'aggregate',label:'汇总测算',formula:['pic','eic','fau','substrate','other'].map(id=>`${nodes[id].name}${money(values[id])}`).join(' + ')+` = ${money(values.engine)}`,explanation:'光引擎由五个一级预算池汇总，内部子件只是拆分，不重复计价',assumptions:[common],sourceIds:[anchor.sourceId]};
  traces.npo={kind:'aggregate',label:'汇总测算',formula:`光引擎${money(values.engine)} + 分摊光源${money(values.els)} = ${money(values.npo)}`,explanation:'一套NPO光互连单元及分摊光源的参考预算；ASIC、主板、机箱不计入',assumptions:[common,anchor.description],sourceIds:[anchor.sourceId]};
  const visit=parentId=>{
    const parent=nodes[parentId],kids=children(parentId),rule=db.valuationModel?.rules?.[parentId];
    if(!kids.length)return;
    // Fixed unit estimates, such as a monitor PD, are deducted before allocating the remainder.
    for(const n of kids){
      const e=n.estimate;
      if(values[n.id]!=null||!(q[n.id]>0)||e?.currency!=='USD'||e.unit!==n.unit||!Number.isFinite(e.base)||e.base<0)continue;
      values[n.id]=e.base*q[n.id];estimated[n.id]=e;
      traces[n.id]={kind:'unit_estimate',label:'数量级估算',formula:`${money(e.base)}/${n.unit} × ${number(q[n.id])}${n.unit} = ${money(values[n.id])}`,explanation:e.scope||'工程单价假设，在上级预算内分配',assumptions:[e.basis||'尚无同规格公开报价',e.displayNote||'数量级假设'],sourceIds:unique([...(traces[parentId]?.sourceIds||[]),...(e.sourceIds||[])]),parameters:[{name:'工程单价假设',value:e.base,kind:'assumption',sourceIds:e.sourceIds||[],note:e.basis||'来源未验证此单价'},{name:'当前用量',value:q[n.id],kind:'quantity',sourceIds:[],note:n.unit}]};
    }
    if(rule&&Number.isFinite(values[parentId])) {
      const fixed=kids.filter(n=>q[n.id]>0&&Number.isFinite(values[n.id]));
      const fixedTotal=fixed.reduce((s,n)=>s+values[n.id],0);
      const remaining=Math.max(0,values[parentId]-fixedTotal);
      // An inactive node keeps its weight in the denominator; its amount remains unallocated.
      const weighted=kids.filter(n=>!fixed.some(f=>f.id===n.id));
      const denominator=(rule.reserveWeight||0)+weighted.reduce((s,n)=>s+(rule.weights[n.id]||0),0);
      for(const n of weighted){
        const weight=rule.weights[n.id];
        if(!(q[n.id]>0)||!(weight>0)||!(denominator>0))continue;
        values[n.id]=remaining*weight/denominator;
        const deductions=fixed.length?fixed.map(f=>`${f.name}${money(values[f.id])}`).join(' + '):'无';
        traces[n.id]={kind:'allocation_estimate',label:'上级预算分配',formula:`max(0, ${parent.name}${money(values[parentId])} − 已单列${money(fixedTotal)}) × 权重${number(weight)} ÷ 总权重${number(denominator)} = ${money(values[n.id])}`,explanation:'公开资料仅支持原始上游组合预算；本节点价格按当前上级金额和工程假设分配，未获独立报价验证',assumptions:[rule.basis,`已单列项目：${deductions}`,...fixed.map(f=>`${f.name}采用${traces[f.id]?.label||'已单列预算'}，来源的具体适用范围见下方记录`),rule.weightNotes?.[n.id]||`本节点权重${number(weight)}为工程假设；不是公开披露的成本比例`,'未配置节点及保留权重对应的预算留在上级未拆分余额，不分配给其他部件'],sourceIds:unique([...(traces[parentId]?.sourceIds||[anchor.sourceId]),...fixed.flatMap(f=>traces[f.id]?.sourceIds||[])]),parameters:[{name:'上级预算',value:values[parentId],kind:'allocation',sourceIds:traces[parentId]?.sourceIds||[],note:parent.name},{name:'已单列金额',value:fixedTotal,kind:'allocation',sourceIds:[],note:deductions},{name:'本节点权重',value:weight,kind:'assumption',sourceIds:[],note:rule.weightNotes?.[n.id]||rule.basis},{name:'分配总权重',value:denominator,kind:'allocation',sourceIds:[],note:'含保留及未配置节点权重'}]};
      }
    }
    for(const n of kids){
      if(traces[n.id]?.kind==='override')traces[n.id].sourceIds=unique([...(traces[parentId]?.sourceIds||[]),...traces[n.id].sourceIds]);
      if(q[n.id]>0&&Number.isFinite(values[n.id]))visit(n.id);
    }
    if(Number.isFinite(values[parentId])) {
      const active=kids.filter(n=>q[n.id]>0&&Number.isFinite(values[n.id]));
      const assigned=active.reduce((sum,n)=>sum+values[n.id],0);
      if(assigned>values[parentId]+1e-9*Math.max(1,Math.abs(values[parentId]))){
        active.forEach(n=>invalid.add(n.id));
        warnings.push(`${parent.name}子件已分配值超过父级预算，请调整单价`);
      }
      for(const n of active)if(values[n.id]>values[parentId]+1e-9*Math.max(1,Math.abs(values[parentId]))){invalid.add(n.id);warnings.push(`${n.name}超过${parent.name}预算`);}
      if(traces[parentId])traces[parentId].budgetBreakdown={total:values[parentId],assigned,residual:Math.max(0,values[parentId]-assigned)};
    }
  };
  visit('npo');
  const total=values.npo;
  const priceFor=id=>{
    const n=nodes[id],parent=n?.parent,value=values[id],parentValue=values[parent],active=q[id]>0;
    let blocked=invalid.has(id),ancestor=parent;while(ancestor){if(invalid.has(ancestor))blocked=true;ancestor=nodes[ancestor]?.parent;}
    const valid=!blocked,priced=active&&Number.isFinite(value),unit=priced?value/q[id]:null;
    const parentShare=priced&&valid&&parentValue>0?value/parentValue:null;
    let trace=traces[id]?{...traces[id],assumptions:[...traces[id].assumptions]}:{kind:'inactive',label:'当前未配置',formula:'当前数量为0，不分配价值',explanation:'未配置节点的权重保留在上级未拆分预算内',assumptions:[],sourceIds:[anchor.sourceId]};
    if(!active)trace={...trace,kind:'inactive',label:'当前未配置',formula:'当前数量为0，不分配价值'};
    const localAncestors=[];let localParent=parent;
    while(localParent){if(applied[localParent]!=null)localAncestors.push(`${nodes[localParent].name}${money(values[localParent])}`);localParent=nodes[localParent]?.parent;}
    if(localAncestors.length)trace.assumptions.push(`当前上级预算包含本地单价覆盖：${localAncestors.join('、')}；公开来源仅支持原始锚点，不验证这些覆盖金额`);
    if(['npo','engine'].includes(id)){
      const changed=groups.filter(g=>applied[g]!=null&&(id==='npo'||g!=='els'));
      if(changed.length)trace.assumptions.push(`当前汇总采用本地覆盖：${changed.map(g=>`${nodes[g].name}${money(values[g])}`).join('、')}；这些金额不是原始来源数值`);
    }
    trace.unitFormula=priced?`${money(value)} ÷ ${number(q[id])}${n.unit} = ${money(unit)}/${n.unit}`:'当前数量为0，不计算单价';
    trace.shareFormula=!parent?'根节点不计算占上级比例':parentShare!=null?`${money(value)} ÷ ${nodes[parent].name}${money(parentValue)} × 100% = ${percent(parentShare)}`:blocked?'分配超过父级预算，比例暂不展示':'上级预算为0或当前未配置，不计算比例';
    trace.parameters=trace.parameters||children(id).filter(k=>Number.isFinite(values[k.id])).map(k=>({name:k.name,value:values[k.id],kind:'allocation',sourceIds:traces[k.id]?.sourceIds||[],note:'汇总金额，子项不重复计入'}));
    if(!active)trace.parameters=[{name:'当前用量',value:0,kind:'quantity',sourceIds:[],note:'当前未配置'}];
    if(trace.budgetBreakdown)trace.assumptions.push(`本层已分配${money(trace.budgetBreakdown.assigned)}，未拆分余额${money(trace.budgetBreakdown.residual)}；余额不代表已核实的某一成本项`);
    const estimate=active&&applied[id]==null?estimated[id]||null:null;
    return {total:priced?value:null,unit,share:priced&&valid&&total>0?value/total:null,parentShare,parentId:parent,includedIn:active&&!priced?parent:null,note:trace.explanation,isOverride:applied[id]!=null,isEstimate:active&&['allocation_estimate','unit_estimate'].includes(trace.kind),estimate,pricingTrace:trace,invalid:!valid,active};
  };
  return {config:c,quantities:q,context:ctx,total,base:values,priceFor,warnings,method:'参考情景：一级预算依原始测算缩放，子件依显式工程假设分配；父子包含，不重复相加',basisSource:anchor.sourceId};
}

// Unit-price records describe a component specification, not an entire saved scenario.
// A bandwidth change keeps quotes for identical repeated parts; a package/spec change does not.
const picParts=new Set(['pic','modulator','photodiode','waveguide','coupler','splitter','phase']);
const fauParts=new Set(['fau','vgroove','fiber','lens','adhesive','cover_plate']);
const laserParts=new Set(['els','cw','laser_die','laser_submount','inp_substrate','isolator','faraday','garnet','coating','polarizer','analyzer','magnet','collimator','isolator_housing','pm_fiber','laser_driver','monitor_pd','tec','pm_fau','els_optics','tec_controller']);
export function priceSpecKey(id,input={}) {
  const c=normalize(input);
  const keys=id==='driver'?['laneRate','driverChannels']:id==='tia'?['laneRate','tiaChannels']:id==='eic'?['rate','laneRate','driverChannels','tiaChannels']:picParts.has(id)?['laneRate','picChannels']:fauParts.has(id)?['laneRate','fauCapacity','fauLens']:laserParts.has(id)?['laneRate','laser','cwFanout',...(['els','isolator'].includes(id)?['rotators']:[])]:['rate','laneRate','interposer'];
  return `v1:${id}:${keys.map(k=>`${k}=${c[k]}`).join('|')}`;
}
export function makePriceOverride(id,unit,input={}) {
  if(unit===null||unit===''||!Number.isFinite(+unit)||+unit<0)throw new Error('单价必须为有限非负数');
  return {unit:+unit,specKey:priceSpecKey(id,input),specVersion:1};
}
function resolveOverrides(input,db,overrides={}) {
  const nodes=new Set(db.components.map(n=>n.id)),active={},staleOverrides=[];
  for(const [id,record] of Object.entries(overrides||{})) {
    if(!nodes.has(id)||['npo','engine'].includes(id))continue;
    const object=record!==null&&typeof record==='object',value=object?record.unit:record,currentSpecKey=priceSpecKey(id,input);
    if(object&&record.specKey!==currentSpecKey){staleOverrides.push({id,storedSpecKey:record.specKey||null,currentSpecKey,reason:'当前器件规格与保存单价的适用规格不一致，已停用该覆盖'});continue;}
    if(value===null||value===''||!Number.isFinite(+value)||+value<0)continue;
    active[id]=+value;
  }
  return {active,staleOverrides};
}
// Fixed engineering reference. It intentionally does not follow the current 200G/400G selection.
export const costReferenceConfig=Object.freeze(normalize({...defaults,pricingMode:'allocation'}));
const fmtMoney=v=>`$${Number(v).toLocaleString('en-US',{maximumFractionDigits:4})}`;
const fmtNumber=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
const sourceUnion=(...lists)=>[...new Set(lists.flat().filter(Boolean))];
function computeCostBOM(input,db,overrides={}) {
  const ctx=quantityContext(input),c=ctx.config,q=quantities(c,db.components),nodes=Object.fromEntries(db.components.map(n=>[n.id,n]));
  const children=id=>db.components.filter(n=>n.parent===id),anchorId=db.priceAnchor.sourceId;
  const reference=computeAllocationBOM(costReferenceConfig,db);
  // An optional part needs a hypothetical reference unit even when default quantity is zero.
  const optionalReference=computeAllocationBOM({...costReferenceConfig,interposer:true,fauLens:true},db);
  const values={},natural={},traces={},applied={},invalid=new Set(),warnings=[],referenceUnits={},residualUnits={};
  const common='固定参考配置为3.2T、16×200G、每颗Driver/TIA 4通道、每颗PIC 8通道、FAU 8芯、CW扇出4、每只隔离器1片旋片；参考单价来自预算反算，均为工程假设';
  const comparisonLimit='跨速率、集成度或供光扇出沿用参考单价仅为受控假设，尚未计规格溢价、功率损耗与良率；400G计算结果不能作为真实降本证据';
  for(const n of db.components){
    const p=reference.priceFor(n.id),fallback=optionalReference.priceFor(n.id);
    referenceUnits[n.id]=p.unit??fallback.unit??0;
    // Keep the default unidentified balance as an explicit baseline assumption.
    // Optional parts add cost when enabled; their historical reserve is not silently consumed.
    residualUnits[n.id]=children(n.id).length&&p.active?(p.pricingTrace.budgetBreakdown?.residual||0)/reference.quantities[n.id]:0;
  }
  const calculate=id=>{
    const n=nodes[id],kids=children(id),rp=reference.priceFor(id),sources=sourceUnion(rp.pricingTrace.sourceIds,[anchorId]);
    for(const child of kids)calculate(child.id);
    if(!(q[id]>0)){natural[id]=0;return;}
    const residual=residualUnits[id]*q[id],subtotal=kids.reduce((sum,k)=>sum+natural[k.id],0);
    const own=Object.hasOwn(overrides,id);
    if(own)applied[id]=overrides[id];
    const amount=own?overrides[id]*q[id]:kids.length?subtotal+residual:referenceUnits[id]*q[id];
    natural[id]=amount;
    const params=[{name:'当前用量',value:q[id],kind:'quantity',sourceIds:[],note:n.unit}];
    if(own)params.unshift({name:kids.length?'本地包价单价':'本地单价',value:overrides[id],kind:'override',sourceIds:[],note:`美元/${n.unit}，仅适用于绑定规格`});
    else if(!kids.length)params.unshift({name:'固定参考等效单价',value:referenceUnits[id],kind:'assumption',sourceIds:sources,note:`美元/${n.unit}，由固定参考配置预算反算，未获独立报价验证`});
    else {
      params.push(...kids.filter(k=>q[k.id]>0).map(k=>({name:k.name,value:natural[k.id],kind:'allocation',sourceIds:traces[k.id]?.sourceIds||[],note:'当前数量与固定参考单价形成的金额'})));
      params.push({name:'固定参考未拆分余额单价',value:residualUnits[id],kind:'assumption',sourceIds:sources,note:`美元/${n.unit}，余额不是已识别或核实的某一成本项`});
    }
    const formula=own?`${fmtMoney(overrides[id])}/${n.unit} × ${fmtNumber(q[id])}${n.unit} = ${fmtMoney(amount)}`:kids.length?`${kids.filter(k=>q[k.id]>0).map(k=>`${k.name}${fmtMoney(natural[k.id])}`).join(' + ')||'0'} + 未拆分余额${fmtMoney(residualUnits[id])}/${n.unit} × ${fmtNumber(q[id])}${n.unit} = ${fmtMoney(amount)}`:`参考等效单价${fmtMoney(referenceUnits[id])}/${n.unit} × ${fmtNumber(q[id])}${n.unit} = ${fmtMoney(amount)}`;
    traces[id]={kind:own?'override':'engineering_estimate',label:own?(kids.length?'本地包价假设':'本地单价假设'):'固定单价成本情景',formula,explanation:own&&kids.length?'本节点包价确定本子树计入上级的金额，下级仅作包价内部拆分，不再次累加':own?'本地单价乘当前数量后计入上级，其他独立子件单价保持不变':kids.length?'子件按当前数量与固定参考单价计算，再加本层未拆分余额逐层汇总':'沿用固定3.2T 200G参考配置的等效单价，当前数量变化直接改变成本',assumptions:[common,comparisonLimit,...(id==='substrate'?['默认未配置中介层对应的未拆分余额在本模式中保留为基准成本假设；启用中介层另行增加其参考成本，未声称识别了余额实际构成']:[]),...(own?['输入金额属于本地假设，公开资料不验证此覆盖单价']:[])],sourceIds:sources,parameters:params,referenceUnit:referenceUnits[id],referenceResidualUnit:residualUnits[id]};
  };
  calculate('npo');
  // Reserve explicit descendant prices through every intermediate parent. An explicit
  // package is itself a boundary upstream; its internal feasibility is checked below.
  const minimumRequired={};
  const reserveMinimum=id=>{
    const descendantTotal=children(id).reduce((sum,child)=>sum+reserveMinimum(child.id),0);
    return minimumRequired[id]=!(q[id]>0)?0:Object.hasOwn(applied,id)?natural[id]:descendantTotal;
  };
  reserveMinimum('npo');
  // A package-price boundary fixes its contribution to its parent. Descendants explain that
  // package and are allocated inside it; explicitly entered descendant prices remain fixed.
  const display=(id,imposed=null,boundaryId=null)=>{
    const n=nodes[id],kids=children(id);
    if(!(q[id]>0)){values[id]=null;for(const child of kids)display(child.id);return;}
    values[id]=imposed??natural[id];
    const own=Object.hasOwn(applied,id),within=boundaryId!==null;
    if(within&&!own){
      traces[id]={...traces[id],boundaryId,kind:'allocation_estimate',label:'包价内工程分配',formula:`按${nodes[boundaryId].name}包价内部权重分配 = ${fmtMoney(values[id])}`,explanation:'当前金额属于上级包价的解释性分配，不是本节点独立采购价，也不重复增加整体成本',assumptions:[...traces[id].assumptions,`包价边界为${nodes[boundaryId].name}；未覆盖细件依其参考成本权重分配`],parameters:[{name:'当前包价内部金额',value:values[id],kind:'allocation',sourceIds:[],note:nodes[boundaryId].name},{name:'当前用量',value:q[id],kind:'quantity',sourceIds:[],note:n.unit}]};
    }
    if(!kids.length)return;
    const enclosed=own||within,boundary=own?id:boundaryId;
    if(!enclosed){
      for(const child of kids)display(child.id);
    }else{
      const active=kids.filter(k=>q[k.id]>0);
      const minimumTotal=active.reduce((sum,k)=>sum+minimumRequired[k.id],0),remaining=Math.max(0,values[id]-minimumTotal);
      const freeWeight=childId=>Math.max(0,natural[childId]-minimumRequired[childId]);
      const residualBasis=residualUnits[id]*q[id],denominator=active.reduce((sum,k)=>sum+freeWeight(k.id),0)+residualBasis;
      for(const child of kids){
        const minimum=minimumRequired[child.id],weight=freeWeight(child.id);
        const freeAmount=denominator>0?remaining*weight/denominator:0,part=minimum+freeAmount;
        display(child.id,q[child.id]>0?part:null,boundary);
        if(q[child.id]>0&&!Object.hasOwn(applied,child.id)){
          traces[child.id].boundaryId=boundary;
          traces[child.id].formula=denominator>0?`后代显式价格最低保留${fmtMoney(minimum)} + max(0, ${n.name}${own?'包价':'分配金额'}${fmtMoney(values[id])} − 最低保留合计${fmtMoney(minimumTotal)}) × 自由参考权重${fmtMoney(weight)} ÷ 自由总权重${fmtMoney(denominator)} = ${fmtMoney(values[child.id])}`:`后代显式价格最低保留${fmtMoney(minimum)} + 自由分配${fmtMoney(0)} = ${fmtMoney(values[child.id])}`;
          traces[child.id].parameters=[{name:own?'上级包价':'上级分配金额',value:values[id],kind:own?'override':'allocation',sourceIds:[],note:own?n.name:`${n.name}的分配值，真实包价边界为${nodes[boundary].name}`},{name:'本子树显式价格最低保留',value:minimum,kind:'allocation',sourceIds:[],note:'汇总后代显式单价或包价边界，未把该合计当成本节点输入报价'},{name:'上级各子树最低保留合计',value:minimumTotal,kind:'allocation',sourceIds:[],note:'先锁定已输入价格，再分配自由余额'},{name:'本件自由参考权重',value:weight,kind:'assumption',sourceIds:traces[child.id].sourceIds,note:'自然参考成本减后代最低保留金额'},{name:'自由分配总权重',value:denominator,kind:'allocation',sourceIds:[],note:'含本层未拆分余额'}];
        }
      }
    }
    const active=kids.filter(k=>q[k.id]>0),assigned=active.reduce((sum,k)=>sum+(values[k.id]||0),0);
    if(assigned>values[id]+1e-9*Math.max(1,Math.abs(values[id]))){active.forEach(k=>invalid.add(k.id));warnings.push(`${n.name}子树显式价格最低金额超过包价，请调整包价或子件单价`);}
    traces[id].budgetBreakdown={total:values[id],assigned,residual:Math.max(0,values[id]-assigned)};
  };
  display('npo');
  const priceFor=id=>{
    const n=nodes[id],parent=n?.parent,active=q[id]>0,priced=active&&Number.isFinite(values[id]),value=priced?values[id]:null;
    let blocked=invalid.has(id),ancestor=parent;while(ancestor){if(invalid.has(ancestor))blocked=true;ancestor=nodes[ancestor]?.parent;}
    const unit=priced?value/q[id]:null,parentShare=priced&&!blocked&&values[parent]>0?value/values[parent]:null;
    const trace=traces[id]?{...traces[id],assumptions:[...traces[id].assumptions],parameters:[...traces[id].parameters]}:{kind:'inactive',label:'当前未配置',formula:'当前数量为0，不计入成本',explanation:'固定单价成本情景仅计入当前已配置组件',assumptions:[common,comparisonLimit],sourceIds:[anchorId],parameters:[{name:'当前用量',value:0,kind:'quantity',sourceIds:[],note:'未配置'}]};
    trace.unitFormula=priced?`${fmtMoney(value)} ÷ ${fmtNumber(q[id])}${n.unit} = ${fmtMoney(unit)}/${n.unit}`:'当前数量为0，不计算单价';
    trace.shareFormula=!parent?'根节点不计算占上级比例':parentShare!=null?`${fmtMoney(value)} ÷ ${nodes[parent].name}${fmtMoney(values[parent])} × 100% = ${fmtNumber(parentShare*100)}%`:blocked?'已输入子件超出包价，比例暂不展示':'上级金额为0或当前未配置，不计算比例';
    if(trace.budgetBreakdown)trace.assumptions.push(`本层子件${fmtMoney(trace.budgetBreakdown.assigned)}，未拆分余额${fmtMoney(trace.budgetBreakdown.residual)}；子件与父级不重复相加`);
    const estimate=!Object.hasOwn(applied,id)&&trace.kind==='engineering_estimate'&&!children(id).length?n.estimate||null:null;
    return {total:value,unit,share:priced&&!blocked&&values.npo>0?value/values.npo:null,parentShare,parentId:parent,includedIn:null,note:trace.explanation,isOverride:Object.hasOwn(applied,id),isEstimate:active&&!Object.hasOwn(applied,id),estimate,pricingTrace:trace,invalid:blocked,active};
  };
  return {config:c,quantities:q,context:ctx,total:values.npo,base:values,priceFor,warnings,method:'固定参考单价成本情景：数量乘工程单价，逐层汇总并保留明确的未拆分余额；包价子树只计一次',basisSource:anchorId,costReferenceConfig,referenceUnits,residualUnits};
}
export function computeBOM(input,db,overrides={}) {
  const config=normalize(input),resolved=resolveOverrides(config,db,overrides);
  const result=config.pricingMode==='cost'?computeCostBOM(config,db,resolved.active):computeAllocationBOM(config,db,resolved.active);
  return {...result,staleOverrides:resolved.staleOverrides,activeOverrides:resolved.active};
}
// Ordered counterfactual decomposition. Totals always reconcile; contributions are path dependent.
export function compareBOM(configA,overridesA,configB,overridesB,db) {
  const a=normalize(configA),b=normalize(configB),before=computeBOM(a,db,overridesA),after=computeBOM(b,db,overridesB);
  const frozenOverrides=before.activeOverrides;
  const quantityConfig={...b,pricingMode:a.pricingMode,laser:a.laser,cwFanout:a.cwFanout,elsShare:a.elsShare};
  const quantityStage=computeBOM(quantityConfig,db,frozenOverrides);
  const allocationStage=computeBOM({...b,pricingMode:a.pricingMode},db,frozenOverrides);
  const quantity=quantityStage.total-before.total,allocation=allocationStage.total-quantityStage.total,unitAssumption=after.total-allocationStage.total;
  const nodeNames=Object.fromEntries(db.components.map(n=>[n.id,n.name]));
  const notices=sourceUnion(before.staleOverrides.map(item=>`A配置：${nodeNames[item.id]||item.id}的保存单价因规格不匹配已暂停，起点采用当前模型假设`),after.staleOverrides.map(item=>`B配置：${nodeNames[item.id]||item.id}的保存单价因规格不匹配已暂停，停用差额计入单价假设与估值模式项`));
  return {before,after,delta:after.total-before.total,contributions:{quantity,unitAssumption,allocation},steps:[{kind:'quantity',label:'数量与集成参数',amount:quantity,fromTotal:before.total,toTotal:quantityStage.total},{kind:'allocation',label:'供光与分摊参数',amount:allocation,fromTotal:quantityStage.total,toTotal:allocationStage.total},{kind:'unitAssumption',label:'单价假设与估值模式',amount:unitAssumption,fromTotal:allocationStage.total,toTotal:after.total}],warnings:sourceUnion(before.warnings,after.warnings,quantityStage.warnings,allocationStage.warnings),notices,method:'按数量与集成参数、供光与分摊参数、单价假设与估值模式的固定顺序比较；中间阶段保留A有效单价，规格失配导致的覆盖停用计入最后一步。贡献受比较顺序影响，不能作为因果或真实降本结论'};
}
