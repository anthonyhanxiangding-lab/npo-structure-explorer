// Search-only vocabulary never replaces the displayed component name.
const plurals={photodiodes:'photodiode',photodetectors:'photodetector',detectors:'detector',lasers:'laser',drivers:'driver',amplifiers:'amplifier',fibers:'fiber',arrays:'array',couplers:'coupler',splitters:'splitter',lenses:'lens',controllers:'controller',chips:'chip',circuits:'circuit',substrates:'substrate',connectors:'connector',magnets:'magnet',rotators:'rotator',isolators:'isolator',waveguides:'waveguide',heatsinks:'heatsink',ferrules:'ferrule',materials:'material',components:'component',plates:'plate',pics:'pic',eics:'eic',pds:'pd',faus:'fau'};

export function normalizeSearchText(value){
  return String(value||'').normalize('NFKC').toLowerCase()
    .replace(/\bfibres?\b/g,m=>m==='fibres'?'fibers':'fiber')
    .replace(/polarisation/g,'polarization')
    .replace(/polariser/g,'polarizer').replace(/analyser/g,'analyzer')
    .replace(/([a-z0-9])([\u3400-\u9fff])/g,'$1 $2')
    .replace(/([\u3400-\u9fff])([a-z0-9])/g,'$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .replace(/\b[a-z]+\b/g,word=>plurals[word]||word)
    .trim().replace(/\s+/g,' ');
}
export const searchKey=value=>normalizeSearchText(value).replace(/\s+/g,'');

export function createComponentSearch(nodes){
  const index=nodes.map((n,order)=>{
    const text=[n.name,n.en,n.id,...(n.aliases||[])].map(normalizeSearchText).filter(Boolean);
    return {id:n.id,order,fields:[...new Set(text.map(s=>s.replace(/\s+/g,'')))]};
  });
  return value=>{
    const text=normalizeSearchText(value),query=text.replace(/\s+/g,'');
    if(!query)return [];
    const terms=[...new Set(text.split(' '))];
    return index.map(n=>{
      let score=Math.min(...n.fields.map(field=>field===query?0:field.startsWith(query)?1:field.includes(query)?2:Infinity));
      // Qualifiers may be in a different order, or split across Chinese and English aliases.
      if(!Number.isFinite(score)&&terms.length>1&&terms.every(term=>n.fields.some(field=>field.includes(term))))score=3;
      return {id:n.id,score,order:n.order};
    }).filter(n=>Number.isFinite(n.score)).sort((a,b)=>a.score-b.score||a.order-b.order).map(({id,score})=>({id,score}));
  };
}
