import fs from 'node:fs';
import assert from 'node:assert/strict';
import {computeBOM,normalize,quantities,pathTo} from '../web/model.js';
const db=JSON.parse(fs.readFileSync('database.json','utf8'));
let tests=0,pricingScenarios=0;
const ok=(condition,label)=>{assert.ok(condition,label);tests++};
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const ids=new Set(db.components.map(n=>n.id));
const sourceids=new Set(db.sources.map(s=>s.id));
const anchorIds=new Set(['npo','engine',...Object.keys(db.priceAnchor.groups)]);
function auditPricing(m,label){
  pricingScenarios++;
  const prices=Object.fromEntries(db.components.map(n=>[n.id,m.priceFor(n.id)]));
  for(const n of db.components){
    const p=prices[n.id],tag=`${label}/${n.id}`;
    if(!p.active){
      ok(p.total===null&&p.unit===null&&p.parentShare===null,`${tag}: inactive component has no displayed price or share`);
      continue;
    }
    ok(Number.isFinite(p.total)&&p.total>=0&&Number.isFinite(p.unit)&&p.unit>=0,`${tag}: active component has finite allocated total and unit value`);
    ok(close(p.total,p.unit*m.quantities[n.id]),`${tag}: total equals quantity times unit`);
    if(n.parent){
      ok(p.parentId===n.parent,`${tag}: share points to direct parent`);
      ok(close(p.parentShare,p.total/prices[n.parent].total),`${tag}: share equals child allocation over immediate parent budget`);
    }
    const trace=p.pricingTrace;
    ok(!!trace&&typeof trace.kind==='string'&&trace.kind.length>0,`${tag}: price trace identifies evidence type`);
    ok(typeof trace.formula==='string'&&trace.formula.trim().length>5,`${tag}: trace contains concrete total formula`);
    ok(/\d/.test(trace.formula),`${tag}: total formula substitutes numeric inputs`);
    if(n.parent){
      ok(typeof trace.unitFormula==='string'&&/\d/.test(trace.unitFormula),`${tag}: unit formula substitutes current quantity`);
      ok(typeof trace.shareFormula==='string'&&/\d/.test(trace.shareFormula),`${tag}: direct-parent share formula substitutes current values`);
    }
    ok(typeof trace.explanation==='string'&&trace.explanation.trim().length>5,`${tag}: trace explains evidence boundaries`);
    ok(Array.isArray(trace.sourceIds)&&trace.sourceIds.length>0&&trace.sourceIds.every(id=>sourceids.has(id)),`${tag}: trace links to existing sources`);
    ok(!['quote','vendor_quote','confirmed_quote'].includes(trace.kind),`${tag}: allocations are not presented as vendor quotes`);
    if(!anchorIds.has(n.id))ok(p.isEstimate&&['allocation_estimate','engineering_estimate','unit_estimate'].includes(trace.kind),`${tag}: newly priced detail is explicitly an estimate`);
    if(trace.kind==='allocation_estimate')ok(Array.isArray(trace.assumptions)&&trace.assumptions.length>0,`${tag}: allocated price discloses engineering assumptions`);
  }
  for(const parent of db.components){
    if(!prices[parent.id].active)continue;
    const children=db.components.filter(n=>n.parent===parent.id),sum=children.reduce((total,n)=>total+(prices[n.id].active?prices[n.id].total:0),0);
    ok(sum<=prices[parent.id].total+1e-8,`${label}/${parent.id}: direct children never exceed parent allocation`);
  }
  ok(close(m.total,prices.engine.total+prices.els.total),`${label}: total sums top-level budgets only`);
  ok(!m.warnings.length,`${label}: default engineering allocations fit budgets`);
}
const base=computeBOM({},db);
ok(base.total===530,'default reference scenario');
ok(base.quantities.fau===4&&base.quantities.fiber===32,'FAU groups differ from fiber count');
ok(base.quantities.driver===4&&base.quantities.tia===4,'4 channel EIC packages');
auditPricing(base,'default');
const ref=computeBOM({laneRate:100,cwFanout:8},db);
ok(ref.total===650,'original 32x100 anchor reproduced');ok(ref.priceFor('engine').total===500,'engine includes fau substrate other');
auditPricing(ref,'32x100 reference');
for(const rate of [3.2,6.4])for(const laneRate of [200,400])for(const fauCapacity of [4,8,16])for(const channels of [4,8,16]){
 const m=computeBOM({rate,laneRate,fauCapacity,driverChannels:channels,tiaChannels:channels},db);
 ok(m.config.lanes*laneRate===rate*1000,'bandwidth conservation');ok(m.quantities.driver===Math.ceil(m.config.lanes/channels),'driver integrated count');ok(m.quantities.tia===Math.ceil(m.config.lanes/channels),'tia integrated count');ok(m.quantities.fau===2*Math.ceil(m.config.lanes/fauCapacity),'FAU rounded separately');ok(m.quantities.fiber===2*m.config.lanes,'Rx and Tx fibers');ok(!m.warnings.length,'budget no double count');ok(Number.isFinite(m.total)&&m.total>0,'finite positive BOM');
 // Audit all integration combinations, not just aggregate arithmetic.
 auditPricing(m,`${rate}T/${laneRate}G/fau${fauCapacity}/eic${channels}`);
}
const highcap=computeBOM({fauCapacity:16},db);
ok(highcap.quantities.fau===2,'integrated FAU halves assemblies');ok(highcap.priceFor('fau').total===base.priceFor('fau').total,'capacity does not fabricate unit price saving');
for(const id of ['driver','tia','faraday']){
 const p=base.priceFor(id);ok(p.total>0&&p.isEstimate&&p.pricingTrace.kind==='allocation_estimate',`${id}: unquoted component is explicitly allocated within parent budget`);
}
const over=computeBOM({},db,{faraday:1000});ok(over.warnings.length>0&&over.priceFor('faraday').parentShare===null,'budget over-allocation blocked');
const badParent=computeBOM({},db,{isolator:100,faraday:1});ok(badParent.priceFor('faraday').parentShare===null,'invalid budget propagated to descendant');
const assign=computeBOM({},db,{isolator:5,faraday:1});ok(assign.total===base.total,'leaf not added twice');ok(close(assign.priceFor('faraday').parentShare,.2),'leaf share uses overridden immediate parent');
ok(!computeBOM({},db,{engine:1000}).priceFor('engine').isOverride,'derived parent override ignored');ok(!computeBOM({},db,{faraday:''}).priceFor('faraday').isOverride,'empty override ignored');
const off=computeBOM({fauLens:'false',interposer:'false'},db);ok(off.quantities.lens===0&&off.quantities.interposer===0,'string bool normalized');ok(!off.priceFor('lens').active,'inactive price absent');
for(const id of ['lens','interposer']){const p=off.priceFor(id);ok(p.total===null&&p.unit===null&&p.parentShare===null,`${id}: inactive values all hidden`)}
for(const id of ['vgroove','fiber','adhesive','cover_plate'])ok(close(off.priceFor(id).total,base.priceFor(id).total),`${id}: inactive lens budget remains unallocated rather than inflating siblings`);
auditPricing(off,'optional parts disabled');
const on=computeBOM({interposer:true,rotators:2},db);auditPricing(on,'interposer and dual rotators enabled');
const zeroParent=computeBOM({},db,{isolator:0});
for(const n of db.components.filter(n=>pathTo(n.id,db.components).some(p=>p.id==='isolator'))){
 const p=zeroParent.priceFor(n.id);ok(p.total===0&&p.unit===0,`${n.id}: zero-priced parent creates zero-priced subtree`);
 ok(p.parentShare===null||Number.isFinite(p.parentShare),`${n.id}: zero budget cannot produce NaN or Infinity`);
}
const newdb=structuredClone(db);newdb.priceAnchor.groups.pic.amount=180;ok(computeBOM({},newdb).total===base.total+30,'database price update actually applied');
const monitor=db.components.find(n=>n.id==='monitor_pd'),estimate=monitor?.estimate;
ok(!!estimate,'monitor PD has an explicit estimate');
ok(estimate.currency==='USD'&&estimate.unit===monitor.unit,'monitor estimate uses component units and USD');
ok([estimate.low,estimate.base,estimate.high].every(Number.isFinite)&&estimate.low>0&&estimate.low<=estimate.base&&estimate.base<=estimate.high,'monitor estimate range is ordered and positive');
ok(Array.isArray(estimate.sourceIds)&&estimate.sourceIds.length>0,'monitor estimate has traceable basis sources');
const noMonitorEstimate=structuredClone(db);delete noMonitorEstimate.components.find(n=>n.id==='monitor_pd').estimate;
for(const rate of [3.2,6.4])for(const laneRate of [100,200,400])for(const cwFanout of [1,2,4,8]){
 const config={rate,laneRate,cwFanout},m=computeBOM(config,db),without=computeBOM(config,noMonitorEstimate),p=m.priceFor('monitor_pd');
 ok(p.isEstimate&&!p.isOverride,'monitor PD is marked estimate rather than override');
 ok(close(p.unit,estimate.base)&&close(p.total,estimate.base*m.quantities.monitor_pd),'monitor estimate scales with monitor count');
 ok(m.quantities.monitor_pd===m.quantities.cw,'monitor count follows modeled CW monitoring points');
 ok(m.total===without.total,'fixed monitor estimate and fallback allocation both stay inside overall BOM');
 ok(p.parentId==='els'&&close(p.parentShare,p.total/m.priceFor('els').total),'monitor share uses existing ELS parent budget');
 ok(!p.invalid,'monitor fixed estimate fits parent across configurations');
 auditPricing(m,`monitor/${rate}T/${laneRate}G/fanout${cwFanout}`);
}
const pdOverride=computeBOM({},db,{monitor_pd:estimate.base*1.1}),pdOverridePrice=pdOverride.priceFor('monitor_pd');
ok(pdOverridePrice.isOverride&&!pdOverridePrice.isEstimate,'local monitor override replaces estimate display');
ok(close(pdOverridePrice.unit,estimate.base*1.1)&&pdOverride.total===base.total,'local monitor override does not double count');
const pdOverBudget=computeBOM({},db,{monitor_pd:base.priceFor('els').total/base.quantities.monitor_pd+1});
ok(pdOverBudget.priceFor('monitor_pd').invalid&&pdOverBudget.priceFor('monitor_pd').parentShare===null,'monitor over-allocation blocks percentages');
ok(!db.components.some(n=>/asic/i.test(n.id)),'ASIC excluded');ok(ids.size===db.components.length,'unique nodes');ok(sourceids.size===db.sources.length,'unique sources');
for(const sourceId of estimate.sourceIds)ok(sourceids.has(sourceId),'monitor estimate source exists in database');
for(const n of db.components){ok(pathTo(n.id,db.components)[0].id==='npo','acyclic rooted tree');for(const s of n.sourceIds)ok(sourceids.has(s),'component source exists');for(const v of n.vendorLinks){ok(!!db.vendors[v.vendor_id],'vendor exists');for(const s of v.source_ids)ok(sourceids.has(s),'supplier source exists')}}
ok(!fs.readFileSync('index.html','utf8').match(/<script[^>]+src=/),'all scripts embedded');ok(fs.readFileSync('index.html','utf8')===fs.readFileSync('NPO结构探索器.html','utf8'),'delivery and GitHub entry identical');
console.log(JSON.stringify({passed:tests,pricingScenarios,components:db.components.length,sources:db.sources.length}));
