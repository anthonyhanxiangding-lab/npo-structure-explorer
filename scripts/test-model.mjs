import fs from 'node:fs';
import assert from 'node:assert/strict';
import {computeBOM,normalize,quantities,pathTo,priceSpecKey,makePriceOverride,compareBOM,costReferenceConfig} from '../web/model.js';
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
    ok(Array.isArray(trace.parameters)&&trace.parameters.length>0,`${tag}: structured formula parameters are present`);
    for(const parameter of trace.parameters)ok(typeof parameter.name==='string'&&Number.isFinite(parameter.value)&&['source','assumption','override','quantity','allocation'].includes(parameter.kind)&&Array.isArray(parameter.sourceIds),`${tag}: parameter is typed, finite and traceable`);
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

// Cost mode holds engineering unit assumptions fixed; quantities propagate to the total.
const costConfig={pricingMode:'cost'},costBase=computeBOM(costConfig,db);
ok(costBase.total===530&&costBase.config.pricingMode==='cost','cost reference calibrates to the default allocation total');
ok(costReferenceConfig.rate===3.2&&costReferenceConfig.laneRate===200&&Object.isFrozen(costReferenceConfig),'cost reference is explicit and immutable');
auditPricing(costBase,'cost default');
for(const rate of [3.2,6.4])for(const laneRate of [200,400])for(const rotators of [1,2]){
 const m=computeBOM({pricingMode:'cost',rate,laneRate,rotators,interposer:rotators===2},db);
 auditPricing(m,`cost/${rate}T/${laneRate}G/rotators${rotators}`);
 ok(m.priceFor('driver').pricingTrace.assumptions.some(s=>s.includes('400G')&&s.includes('不能')), 'cost scenario discloses that equal unit assumptions do not prove 400G savings');
}
const costRotators=computeBOM({...costConfig,rotators:2},db);
ok(close(costRotators.priceFor('faraday').unit,costBase.priceFor('faraday').unit),'extra rotators keep the reference unit value');
ok(close(costRotators.priceFor('faraday').total,2*costBase.priceFor('faraday').total),'extra rotators double their subtree cost');
ok(close(costRotators.total-costBase.total,costBase.priceFor('faraday').total),'extra rotator cost propagates to NPO exactly once');
const costDriver=computeBOM(costConfig,db,{driver:makePriceOverride('driver',5,costConfig)});
ok(costDriver.priceFor('driver').total===20&&costDriver.priceFor('tia').total===40,'driver unit change leaves TIA cost unchanged');
ok(costDriver.total===510,'driver unit change updates total by the exact component delta');
const allocationDriver=computeBOM({},db,{driver:makePriceOverride('driver',5,{})});
ok(allocationDriver.total===530&&allocationDriver.priceFor('tia').total===60,'allocation mode retains its deliberate fixed-budget redistribution');
const costInterposer=computeBOM({...costConfig,interposer:true},db),costNoLens=computeBOM({...costConfig,fauLens:false},db);
ok(close(costInterposer.total-costBase.total,costInterposer.priceFor('interposer').total)&&costInterposer.total===544,'optional interposer adds explicit reference cost without consuming unidentified baseline balance');
ok(close(costBase.total-costNoLens.total,costBase.priceFor('lens').total),'removing a configured lens removes only its cost');
for(const id of ['vgroove','fiber','adhesive','cover_plate'])ok(close(costNoLens.priceFor(id).total,costBase.priceFor(id).total),`${id}: removing lens does not change independent sibling cost`);
// Parent package prices are boundaries, while descendants only explain the package.
const packageOverrides={isolator:makePriceOverride('isolator',5,costConfig)},costPackage=computeBOM(costConfig,db,packageOverrides);
ok(costPackage.total===541&&costPackage.priceFor('isolator').total===20,'package price replaces its subtree once');
ok(costPackage.priceFor('faraday').pricingTrace.kind==='allocation_estimate','unquoted descendant inside package is labeled internal allocation');
const costELSOnly=computeBOM(costConfig,db,{els:makePriceOverride('els',250,costConfig)});
const directPackageTrace=costELSOnly.priceFor('cw').pricingTrace,indirectPackageTrace=costELSOnly.priceFor('laser_die').pricingTrace;
ok(close(costELSOnly.priceFor('cw').total,56.666666666666664),'ELS-only package has the expected CW internal allocation');
ok(directPackageTrace.parameters[0].kind==='override'&&directPackageTrace.parameters[0].name==='上级包价','direct child correctly attributes actual ELS package input');
ok(indirectPackageTrace.parameters[0].kind==='allocation'&&indirectPackageTrace.parameters[0].name==='上级分配金额','grandchild identifies intermediate CW amount as an allocation, not local input');
ok(indirectPackageTrace.boundaryId==='els'&&indirectPackageTrace.parameters[0].note.includes('光源组件'),'grandchild retains the actual ELS package boundary');
ok(indirectPackageTrace.formula.includes('CW激光器分配金额')&&!indirectPackageTrace.formula.includes('CW激光器包价'),'grandchild formula does not invent a CW package quote');
ok(indirectPackageTrace.parameters.every(parameter=>parameter.kind!=='override'),'no local child input is fabricated for an ELS-only package');

const costNestedPackage=computeBOM(costConfig,db,{...packageOverrides,faraday:makePriceOverride('faraday',1,costConfig)});
ok(costNestedPackage.total===costPackage.total&&costNestedPackage.priceFor('faraday').total===4,'nested known price stays inside its package boundary');
const deepPackage=computeBOM(costConfig,db,{els:150,laser_die:10});
ok(deepPackage.total===455&&deepPackage.priceFor('els').total===75&&deepPackage.priceFor('laser_die').total===40,'deep explicit die price stays inside the ELS package without double counting');
ok(!deepPackage.warnings.length&&deepPackage.priceFor('cw').total>=40,'CW reserves the descendant die price before free budget allocation');
const deeperPackage=computeBOM(costConfig,db,{els:150,inp_substrate:8}),multiBranchPackage=computeBOM(costConfig,db,{els:150,laser_die:10,faraday:1});
ok(!deeperPackage.warnings.length&&deeperPackage.priceFor('inp_substrate').total===32&&deeperPackage.priceFor('laser_die').total>=32&&deeperPackage.priceFor('cw').total>=32,'material quote is reserved across multiple intermediate parents');
ok(!multiBranchPackage.warnings.length&&multiBranchPackage.priceFor('laser_die').total===40&&multiBranchPackage.priceFor('faraday').total===4,'independent descendant quotes reserve costs across sibling branches');
for(const [label,m] of [['deep',deepPackage],['deeper',deeperPackage],['multi-branch',multiBranchPackage]]){
 for(const n of db.components){
  const p=m.priceFor(n.id),breakdown=p.pricingTrace.budgetBreakdown;
  if(!p.active||!breakdown)continue;
  const childTotal=db.components.filter(k=>k.parent===n.id).reduce((sum,k)=>sum+(m.priceFor(k.id).total||0),0);
  ok(close(childTotal,breakdown.assigned)&&close(p.total,breakdown.assigned+breakdown.residual),`${label}/${n.id}: reserved descendant costs, free allocation and residual close`);
  ok(childTotal<=p.total+1e-9,`${label}/${n.id}: children remain within the available package`);
 }
}
const conflictingNestedPackage=computeBOM(costConfig,db,{els:150,cw:5,laser_die:10});
ok(conflictingNestedPackage.warnings.some(message=>message.includes('CW激光器'))&&conflictingNestedPackage.priceFor('cw').total===20,'direct CW package remains its own boundary even when the outer ELS package has room');
ok(conflictingNestedPackage.priceFor('laser_die').parentShare===null,'explicit die price above its direct package is correctly rejected');
const conflictingOuterPackage=computeBOM(costConfig,db,{els:50,laser_die:10});
ok(conflictingOuterPackage.warnings.length>0&&conflictingOuterPackage.priceFor('laser_die').parentShare===null,'true descendant minimum above the outer package still fails');

ok(!costNestedPackage.warnings.length&&close(costNestedPackage.priceFor('faraday').parentShare,.2),'nested price uses the actual package denominator');
const costOversized=computeBOM(costConfig,db,{isolator:1,faraday:2});
ok(costOversized.warnings.length>0&&costOversized.priceFor('faraday').parentShare===null&&costOversized.priceFor('garnet').parentShare===null,'overfilled package suppresses descendant proportions and reports conflict');
const costZeroPackage=computeBOM(costConfig,db,{isolator:0});
ok(costZeroPackage.total===521&&!costZeroPackage.warnings.length,'zero package eliminates its contribution without NaN');
for(const id of ['isolator','faraday','garnet','coating'])ok(costZeroPackage.priceFor(id).total===0,`${id}: zero package creates zero displayed allocation`);
// Bound unit records survive repeated identical parts, but not different specifications.
const bound=makePriceOverride('driver',7,{});
ok(bound.unit===7&&bound.specKey===priceSpecKey('driver',{})&&bound.specVersion===1,'unit factory records the component specification');
const matched=computeBOM({},db,{driver:bound}),stale=computeBOM({driverChannels:16},db,{driver:bound});
ok(matched.priceFor('driver').isOverride&&matched.staleOverrides.length===0,'matching specification uses the saved unit record');
ok(!stale.priceFor('driver').isOverride&&stale.staleOverrides.length===1&&stale.staleOverrides[0].id==='driver','changed integration degree disables saved quote');
ok(stale.staleOverrides[0].storedSpecKey===bound.specKey&&stale.staleOverrides[0].currentSpecKey===priceSpecKey('driver',{driverChannels:16}),'stale record reports both specifications');
ok(computeBOM({rate:6.4},db,{driver:bound}).priceFor('driver').isOverride,'more identical driver packages preserve a unit quote');
const boundEIC=makePriceOverride('eic',80,{});
ok(!computeBOM({rate:6.4},db,{eic:boundEIC}).priceFor('eic').isOverride,'whole-EIC package quote is tied to bandwidth as its internal chip count changes');
ok(computeBOM({rate:6.4},db,{els:makePriceOverride('els',300,{})}).priceFor('els').isOverride,'ELS full-box unit quote survives changed allocated box quantity');
ok(!computeBOM({laneRate:400},db,{driver:bound}).priceFor('driver').isOverride,'different line rate invalidates saved driver quote');
ok(computeBOM({fauCapacity:16},db,{driver:bound}).priceFor('driver').isOverride,'unrelated FAU parameter does not invalidate driver quote');
ok(computeBOM({driverChannels:16},db,{driver:7}).priceFor('driver').isOverride,'legacy numeric programmatic input applies to the caller current specification');
ok(!computeBOM({},db,{driver:{unit:7}}).priceFor('driver').isOverride,'unbound object is never silently accepted as a quote');
let rejectedUnit=false;try{makePriceOverride('driver',Infinity,{})}catch{rejectedUnit=true}ok(rejectedUnit,'unit factory rejects nonfinite data');
// Sequential counterfactual comparison reconciles exactly and exposes the attribution order.
for(const [a,oa,b,ob] of [[costConfig,{}, {...costConfig,rotators:2},{}],[costConfig,{},costConfig,{driver:5}],[costConfig,{}, {...costConfig,cwFanout:8},{}],[{}, {}, {...costConfig,rate:6.4,laneRate:400,interposer:true},{}],[costConfig,{driver:bound},{...costConfig,driverChannels:16},{driver:bound}]]){
 const comparison=compareBOM(a,oa,b,ob,db),contributions=comparison.contributions;
 ok(close(comparison.delta,comparison.after.total-comparison.before.total),'comparison returns actual endpoint delta');
 ok(close(contributions.quantity+contributions.unitAssumption+contributions.allocation,comparison.delta),'quantity, assumption and allocation contributions reconcile');
 ok(comparison.steps.length===3&&close(comparison.steps[0].fromTotal,comparison.before.total)&&close(comparison.steps[2].toTotal,comparison.after.total),'comparison documents all intermediate totals');
 ok(comparison.method.includes('顺序')&&comparison.method.includes('规格失配'),'comparison discloses path dependence and stale-price treatment');
}
const compareRotators=compareBOM(costConfig,{}, {...costConfig,rotators:2},{},db);
ok(close(compareRotators.contributions.quantity,3.6)&&compareRotators.contributions.unitAssumption===0&&compareRotators.contributions.allocation===0,'rotator increase is assigned solely to quantity');
const compareUnit=compareBOM(costConfig,{},costConfig,{driver:5},db);
ok(compareUnit.contributions.unitAssumption===-20&&compareUnit.contributions.quantity===0&&compareUnit.contributions.allocation===0,'standalone unit change is assigned solely to unit assumptions');
const compareFanout=compareBOM(costConfig,{}, {...costConfig,cwFanout:8},{},db);
ok(compareFanout.contributions.allocation===-75&&compareFanout.contributions.quantity===0,'supply fanout change is isolated as the allocation assumption');
const compareStaleAfter=compareBOM(costConfig,{driver:bound},{...costConfig,driverChannels:16},{driver:bound},db);
ok(compareStaleAfter.notices.length===1&&compareStaleAfter.notices[0].includes('B配置')&&compareStaleAfter.notices[0].includes('单价假设'),'comparison separately explains stale target price and contribution treatment');
const compareStaleBefore=compareBOM({...costConfig,driverChannels:16},{driver:bound},costConfig,{},db);
ok(compareStaleBefore.notices.length===1&&compareStaleBefore.notices[0].includes('A配置'),'comparison also reports paused starting-price records');
ok(compareStaleAfter.warnings.length===0&&compareStaleBefore.warnings.length===0,'stale notices are separate from budget-conflict warnings');
ok(compareRotators.notices.length===0,'valid comparisons do not produce stale-price notices');

ok(!db.components.some(n=>/asic/i.test(n.id)),'ASIC excluded');ok(ids.size===db.components.length,'unique nodes');ok(sourceids.size===db.sources.length,'unique sources');
for(const sourceId of estimate.sourceIds)ok(sourceids.has(sourceId),'monitor estimate source exists in database');
for(const n of db.components){ok(pathTo(n.id,db.components)[0].id==='npo','acyclic rooted tree');for(const s of n.sourceIds)ok(sourceids.has(s),'component source exists');for(const v of n.vendorLinks){ok(!!db.vendors[v.vendor_id],'vendor exists');for(const s of v.source_ids)ok(sourceids.has(s),'supplier source exists')}}
ok(!fs.readFileSync('index.html','utf8').match(/<script[^>]+src=/),'all scripts embedded');ok(fs.readFileSync('index.html','utf8')===fs.readFileSync('NPO结构探索器.html','utf8'),'delivery and GitHub entry identical');
console.log(JSON.stringify({passed:tests,pricingScenarios,components:db.components.length,sources:db.sources.length}));
