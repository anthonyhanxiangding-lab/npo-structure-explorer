export const defaults={rate:3.2,laneRate:200,laser:'external',driverChannels:4,tiaChannels:4,picChannels:8,fauCapacity:8,cwFanout:4,elsShare:2,rotators:1,fauLens:true,interposer:false};
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
export function computeBOM(input,db,overrides={}) {
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
    traces[id]={kind:'source_scenario',label:'资料基准测算',formula:`${calculation} = ${money(values[id])}`,explanation:'按原始组合预算及当前配置缩放；来源本身为作者测算，不是供应商报价',assumptions:[common,anchor.description],sourceIds:[anchor.sourceId]};
  }
  // Explicit local unit prices replace a budget allocation; they never add to its parent.
  for(const [id,val] of Object.entries(overrides)) {
    if(!nodes[id]||['npo','engine'].includes(id)||val===null||val===''||!Number.isFinite(+val)||+val<0||!(q[id]>0))continue;
    values[id]=+val*q[id];applied[id]=+val;
    traces[id]={kind:'override',label:'本地单价假设',formula:`${money(+val)}/${nodes[id].unit} × ${number(q[id])}${nodes[id].unit} = ${money(values[id])}`,explanation:'用户输入的单价假设，替代本节点默认分配值；子件不会再次叠加到父级或整体BOM',assumptions:['如本节点属于一级预算，整体预算随其修改；更低层节点只在父级预算内分配'],sourceIds:[anchor.sourceId]};
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
      traces[n.id]={kind:'unit_estimate',label:'数量级估算',formula:`${money(e.base)}/${n.unit} × ${number(q[n.id])}${n.unit} = ${money(values[n.id])}`,explanation:e.scope||'工程单价假设，在上级预算内分配',assumptions:[e.basis||'尚无同规格公开报价',e.displayNote||'数量级假设'],sourceIds:unique([...(traces[parentId]?.sourceIds||[]),...(e.sourceIds||[])])};
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
        traces[n.id]={kind:'allocation_estimate',label:'上级预算分配',formula:`(${parent.name}${money(values[parentId])} − 已单列${money(fixedTotal)}) × 权重${number(weight)} ÷ 总权重${number(denominator)} = ${money(values[n.id])}`,explanation:'公开资料仅支持原始上游组合预算；本节点价格按当前上级金额和工程假设分配，未获独立报价验证',assumptions:[rule.basis,`已单列项目：${deductions}`,...fixed.map(f=>`${f.name}采用${traces[f.id]?.label||'已单列预算'}，来源的具体适用范围见下方记录`),rule.weightNotes?.[n.id]||`本节点权重${number(weight)}为工程假设；不是公开披露的成本比例`,'未配置节点及保留权重对应的预算留在上级未拆分余额，不分配给其他部件'],sourceIds:unique([...(traces[parentId]?.sourceIds||[anchor.sourceId]),...fixed.flatMap(f=>traces[f.id]?.sourceIds||[])])};
      }
    }
    for(const n of kids){
      if(traces[n.id]?.kind==='override')traces[n.id].sourceIds=unique([...(traces[parentId]?.sourceIds||[]),...traces[n.id].sourceIds]);
      if(q[n.id]>0&&Number.isFinite(values[n.id]))visit(n.id);
    }
    if(Number.isFinite(values[parentId])) {
      const active=kids.filter(n=>q[n.id]>0&&Number.isFinite(values[n.id]));
      const assigned=active.reduce((sum,n)=>sum+values[n.id],0);
      if(assigned>values[parentId]+.01){
        active.forEach(n=>invalid.add(n.id));
        warnings.push(`${parent.name}子件已分配值超过父级预算，请调整单价`);
      }
      for(const n of active)if(values[n.id]>values[parentId]+.01){invalid.add(n.id);warnings.push(`${n.name}超过${parent.name}预算`);}
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
    if(trace.budgetBreakdown)trace.assumptions.push(`本层已分配${money(trace.budgetBreakdown.assigned)}，未拆分余额${money(trace.budgetBreakdown.residual)}；余额不代表已核实的某一成本项`);
    const estimate=active&&applied[id]==null?estimated[id]||null:null;
    return {total:priced?value:null,unit,share:priced&&valid&&total>0?value/total:null,parentShare,parentId:parent,includedIn:active&&!priced?parent:null,note:trace.explanation,isOverride:applied[id]!=null,isEstimate:active&&['allocation_estimate','unit_estimate'].includes(trace.kind),estimate,pricingTrace:trace,invalid:!valid,active};
  };
  return {config:c,quantities:q,context:ctx,total,base:values,priceFor,warnings,method:'参考情景：一级预算依原始测算缩放，子件依显式工程假设分配；父子包含，不重复相加',basisSource:anchor.sourceId};
}
