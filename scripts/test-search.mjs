import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createComponentSearch} from '../web/search.js';
const db=JSON.parse(fs.readFileSync('database.json','utf8'));
const aliases=JSON.parse(fs.readFileSync('research/search-aliases.json','utf8'));
const search=createComponentSearch(db.components);
let checks=0;
const expect=(query,id)=>{assert.equal(search(query)[0]?.id,id,`${query} must select ${id}`);checks++};
for(const n of db.components){
  assert(aliases[n.id]?.some(a=>/[\u3400-\u9fff]/.test(a)),`${n.id} has Chinese vocabulary`);
  assert(aliases[n.id]?.some(a=>/[a-z]/i.test(a)),`${n.id} has English vocabulary`);
  for(const query of [n.id,n.name,n.en,...n.aliases]){
    expect(query,n.id);
    expect(query.toUpperCase(),n.id);
  }
}
const cases={
 'Driver':'driver','驱动器':'driver','laser driver':'laser_driver','激光驱动':'laser_driver',
 'PD':'photodiode','光电二极管':'photodiode','monitor PD':'monitor_pd','监测PD':'monitor_pd',
 'FAU':'fau','光纤阵列':'fau','PM FAU':'pm_fau','保偏光纤阵列':'pm_fau',
 'substrate':'substrate','基板':'substrate','InP substrate':'inp_substrate','磷化铟衬底':'inp_substrate',
 'heat sink':'heatsink','散热器':'heatsink','submount':'laser_submount','激光热沉':'laser_submount',
 'control':'control','控制与供电':'control','TEC controller':'tec_controller','温控电路':'tec_controller',
 'TEC':'tec','热电制冷器':'tec','Faraday rotator':'faraday','Faraday isolator':'isolator',
 'isolator housing':'isolator_housing','mechanical housing':'housing','EIC':'eic','电子集成电路':'eic',
 'ＭＯＮＩＴＯＲ　ＰＤ':'monitor_pd','Monitor-PD':'monitor_pd','pd monitor':'monitor_pd',
 'ＰＭ－ＦＡＵ':'pm_fau','SUBSTRATE InP':'inp_substrate','TEC_Controller':'tec_controller',
 '光纤 阵列 保偏':'pm_fau','PD光电二极管':'photodiode','调制器 driver':'driver',
 'FIBRE ARRAYS':'fau','laser drivers':'laser_driver','Receiver Photodiodes':'photodiode',
 'optical isolators':'isolator','Micro-lens Array':'lens','DC/DC':'pmic',
 'polarisation-maintaining fibres':'pm_fiber','Input Polariser':'polarizer','Analyser':'analyzer'
};
for(const [query,id] of Object.entries(cases))expect(query,id);
assert.deepEqual(search(''),[]);assert.deepEqual(search('   /_- '),[]);assert.deepEqual(search('不存在的部件zz987'),[]);
console.log(JSON.stringify({bilingualSearchPassed:checks+3,nodes:db.components.length,aliases:db.components.reduce((sum,n)=>sum+n.aliases.length,0)}));
