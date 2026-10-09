import fs from 'node:fs';
import {catalog} from '../web/catalog.js';
const c=JSON.parse(fs.readFileSync('research/cost-suppliers.json','utf8'));
const a=JSON.parse(fs.readFileSync('research/architecture.json','utf8'));
const searchAliases=JSON.parse(fs.readFileSync('research/search-aliases.json','utf8'));
const extra=[
 ['pm_fau','els','保偏供光FAU','PM Fiber Array','els','组','定位供光端的保偏光纤阵列','供光FAU与信号Tx/Rx FAU分别统计；按8路保偏阵列与ELS等比例分摊，不能把保偏光纤根数当成FAU组件数。'],
 ['els_optics','els','光源整形与滤光','Laser Shaping & Filter','els','组','整形、准直并筛选供光光谱','来源仅披露组合预算，不等同于隔离器本身的采购成本。'],
 ['tec_controller','els','温控电路','TEC Controller','els','组','根据监测反馈调节光源温度','温控电路按工程假设作为光源预算内核算项，实物数量与独立报价尚未确认。'],
 ['ferrule','connector','插芯','Optical Ferrule','one','组','精密定位连接器光纤端面','数量为接口集合的功能组，具体连接器端口数仍需型号资料。'],
 ['cover_plate','fau','FAU盖板','Fiber Array Cover Plate','fau','片','约束并保护V槽中的光纤','每FAU一片是装配示意假设。'],
 ['inp_substrate','laser_die','InP衬底','InP Substrate','cw','份','提供激光外延结构的半导体衬底','衬底属于芯片内部材料，不将晶圆采购价当成单颗芯片材料价。'],
 ['solder','substrate','焊料与键合','Solder & Bonding','one','组','建立芯片及基板间的电与热连接','计为本单元装配材料，不按焊点任意估单价。']
].map(([id,parent,name,en,qtyRule,unit,role,detail])=>({id,parent,name,en,qtyRule,unit,role,detail,category:'材料与配套'}));
const map={phase:'heater',other:'other_engine',eic:'driver'};
const components=[...catalog,...extra].map(n=>{
 const raw=c.components[n.id]||c.components[map[n.id]]||{};
 const metadata=c.component_metadata?.[n.id]||{};
 const vendorLinks=(raw.vendors||[]).map(v=>({...c.vendors[v.vendor_id],...v}));
 const sourceIds=[...new Set([...(raw.price?.source_ids||[]),...vendorLinks.flatMap(v=>v.source_ids||[])])];
 return {...n,...metadata,aliases:[...new Set([...(raw.aliases||[]),...(searchAliases[n.id]||[])])],estimate:raw.estimate||null,sourceIds:[...new Set([...sourceIds,...(raw.estimate?.sourceIds||[])])],vendorLinks,priceEvidence:raw.price||null,benchmark_prices:raw.benchmark_prices||[],quantityEvidence:raw.quantity_basis||null,checkedAt:c.as_of||'2026-10-08'};
});
const ref=c.reference_bom;
if(ref.npo_bom_base!==650||ref.optical_lanes_per_direction!==32)throw Error('Price anchor changed; review scaling before build');
const amounts=Object.fromEntries(ref.engine_line_items.map(x=>[x.id,x.base]));
const groups={pic:{amount:amounts.pic,scaling:'bandwidth'},eic:{amount:amounts.driver_tia_32x100,scaling:'lanes'},fau:{amount:amounts.fau,scaling:'lanes'},substrate:{amount:amounts.substrate,scaling:'bandwidth'},other:{amount:amounts.other_engine,scaling:'bandwidth'},els:{amount:ref.els_bom_base,scaling:'laserAllocation'}};
const sources=[...Object.entries(c.sources).map(([id,s])=>({id,...s})),...a.sources];
const architectures=a.architectures;
const db={schemaVersion:1,version:'1.2.0',revision:c.data_revision||'2026-10-09',asOf:'2026-10-08',name:'NPO结构与器件数据库',scope:'一套标称单向3.2T或6.4T的NPO光互连单元及分摊光源，排除ASIC、系统主板及机箱；结构示意非厂商拆机',components,valuationModel:c.valuation_model,historicalEvidence:c.historical_component_evidence||{},parameterDefinitions:a.parameterDefinitions||{},alternativeArchitectures:a.alternativeArchitectures||[],vendors:c.vendors,definitions:a.definitions,quantityRules:a.quantityRules,architectures,vendorRoutes:a.vendorRoutes,sources,referenceBOM:ref,pricePools:c.price_pools,priceAnchor:{sourceId:ref.source_ids[0],baseline:{rate:3.2,lanes:32,laneRate:100,fauCapacity:8,cwFanout:8},groups,description:ref.rounding_note},researchStatus:c.research_status||'公开资料及归档材料的核验快照；具体范围见来源记录',updatePolicy:'公开资料核验快照截至2026-10-08；2026-10-09调整模型及元数据，不表示新增核验。研究源文件修改后先运行scripts/assemble-database.mjs重建database.json，再执行npm run build更新HTML与SQLite。直接编辑database.json的内容会被再次组装覆盖。没有设置定期自动更新。',researchAssumptions:{...(c.research_assumptions||{}),pricing:'默认预算分配模式依原始参考预算及显式工程权重分配；成本测算模式按固定工程参考单价与当前数量汇总，并保留未拆分项。未取得同规格采购报价，未计400G溢价、良率及功耗差异',quantities:'区分实物总成、功能通道、预算分类、材料核算份数与光源分摊等效数量；示意数量不等于已确认产品BOM',arch400G:'电光同速400G前瞻情景，未绑定到具体NPO产品；200G电侧转换路线仅保存在独立备选记录'},provenance:{costSourceFile:'research/cost-suppliers.json',architectureSourceFile:'research/architecture.json',componentMetadataSource:'research/cost-suppliers.json#component_metadata',parameterDefinitionsSource:'research/architecture.json#parameterDefinitions'}};
const ids=new Set(components.map(n=>n.id));for(const n of components){if(n.parent&&!ids.has(n.parent))throw Error('Missing parent '+n.id)}
fs.writeFileSync('database.json',JSON.stringify(db,null,2)+'\n');
console.log(JSON.stringify({components:components.length,sources:sources.length,vendors:Object.keys(c.vendors).length,links:components.reduce((s,n)=>s+n.vendorLinks.length,0)}));
