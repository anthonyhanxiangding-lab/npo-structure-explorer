import fs from 'node:fs';
import {catalog} from '../web/catalog.js';
const c=JSON.parse(fs.readFileSync('research/cost-suppliers.json','utf8'));
const a=JSON.parse(fs.readFileSync('research/architecture.json','utf8'));
const searchAliases=JSON.parse(fs.readFileSync('research/search-aliases.json','utf8'));
const extra=[
 ['pm_fau','els','保偏供光FAU','PM Fiber Array','els','组','定位供光端的保偏光纤阵列','供光FAU与信号Tx/Rx FAU分别统计；按8路保偏阵列与ELS等比例分摊，不能把保偏光纤根数当成FAU组件数。'],
 ['els_optics','els','光源整形与滤光','Laser Shaping & Filter','els','组','整形、准直并筛选供光光谱','来源仅披露组合预算，不等同于隔离器本身的采购成本。'],
 ['tec_controller','els','温控电路','TEC Controller','els','组','根据监测反馈调节光源温度','TEC制冷片、温控电路和陶瓷壳体组合价格不强行拆分。'],
 ['ferrule','connector','插芯','Optical Ferrule','one','组','精密定位连接器光纤端面','数量为接口集合的功能组，具体连接器端口数仍需型号资料。'],
 ['cover_plate','fau','FAU盖板','Fiber Array Cover Plate','fau','片','约束并保护V槽中的光纤','每FAU一片是装配示意假设。'],
 ['inp_substrate','laser_die','InP衬底','InP Substrate','cw','份','提供激光外延结构的半导体衬底','衬底属于芯片内部材料，不将晶圆采购价当成单颗芯片材料价。'],
 ['solder','substrate','焊料与键合','Solder & Bonding','one','组','建立芯片及基板间的电与热连接','计为本单元装配材料，不按焊点任意估单价。']
].map(([id,parent,name,en,qtyRule,unit,role,detail])=>({id,parent,name,en,qtyRule,unit,role,detail,category:'材料与配套'}));
const map={phase:'heater',other:'other_engine',eic:'driver'};
const components=[...catalog,...extra].map(n=>{
 const raw=c.components[n.id]||c.components[map[n.id]]||{};
 const vendorLinks=(raw.vendors||[]).map(v=>({...c.vendors[v.vendor_id],...v}));
 const sourceIds=[...new Set([...(raw.price?.source_ids||[]),...vendorLinks.flatMap(v=>v.source_ids||[])])];
 return {...n,aliases:[...new Set([...(raw.aliases||[]),...(searchAliases[n.id]||[])])],estimate:raw.estimate||null,sourceIds:[...new Set([...sourceIds,...(raw.estimate?.sourceIds||[])])],vendorLinks,priceEvidence:raw.price||null,benchmark_prices:raw.benchmark_prices||[],quantityEvidence:raw.quantity_basis||null,checkedAt:c.as_of||'2026-10-08'};
});
const ref=c.reference_bom;
if(ref.npo_bom_base!==650||ref.optical_lanes_per_direction!==32)throw Error('Price anchor changed; review scaling before build');
const amounts=Object.fromEntries(ref.engine_line_items.map(x=>[x.id,x.base]));
const groups={pic:{amount:amounts.pic,scaling:'bandwidth'},eic:{amount:amounts.driver_tia_32x100,scaling:'lanes'},fau:{amount:amounts.fau,scaling:'lanes'},substrate:{amount:amounts.substrate,scaling:'bandwidth'},other:{amount:amounts.other_engine,scaling:'bandwidth'},els:{amount:ref.els_bom_base,scaling:'laserAllocation'}};
const sources=[...Object.entries(c.sources).map(([id,s])=>({id,...s})),...a.sources];
const architectures=a.architectures.map(x=>x.opticalLaneGbps===400?{...x,electricalLaneGbps:400,electricalTxLanes:x.opticalTxLanes,electricalRxLanes:x.opticalRxLanes,signalMode:'future_matched_rate',displayStatus:'400G光、电通道同速的前瞻研究情景',defaultQuantities:{...x.defaultQuantities,gearbox1p6TEquivalentPackages:0},limitations:[...x.limitations,'本应用采用400G电侧同步升级的研究假设，取消200G电侧2:1转换路径；不对应Taurus具体产品。']}:x);
const db={schemaVersion:1,version:'1.1.0',asOf:'2026-10-08',name:'NPO结构与器件数据库',scope:'一套标称单向3.2T或6.4T的NPO光互连单元及分摊光源，排除ASIC、系统主板及机箱；结构示意非厂商拆机',components,valuationModel:c.valuation_model,vendors:c.vendors,definitions:a.definitions,quantityRules:a.quantityRules,architectures,vendorRoutes:a.vendorRoutes,sources,referenceBOM:ref,pricePools:c.price_pools,priceAnchor:{sourceId:ref.source_ids[0],baseline:{rate:3.2,lanes:32,laneRate:100,fauCapacity:8,cwFanout:8},groups,description:ref.rounding_note},researchStatus:'研报下载：0/0，复用1份高盛原表；公众号文章下载：0/0，复用并阅读1篇微信原文；复读2份公司披露。指定浏览器访问限制阻止本轮新增搜狗微信检索。',updatePolicy:'本次核验快照。修改database.json后执行npm run build，重新生成内嵌数据HTML与SQLite。没有设置定期自动更新。',researchAssumptions:{pricing:'一级预算依现有参考测算缩放，细项按显式工程权重或单价假设分配；不计高速及良率溢价，不代表当前厂商报价',quantities:'芯片和FAU集成度、供光扇出、隔离级数均为可调整假设',arch400G:'电光同速400G前瞻情景，未绑定到具体NPO产品'},provenance:{costSourceFile:'research/cost-suppliers.json',architectureSourceFile:'research/architecture.json'}};
const ids=new Set(components.map(n=>n.id));for(const n of components){if(n.parent&&!ids.has(n.parent))throw Error('Missing parent '+n.id)}
fs.writeFileSync('database.json',JSON.stringify(db,null,2)+'\n');
console.log(JSON.stringify({components:components.length,sources:sources.length,vendors:Object.keys(c.vendors).length,links:components.reduce((s,n)=>s+n.vendorLinks.length,0)}));
