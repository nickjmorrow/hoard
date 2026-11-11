// Hoard icon ideas. Run: node ideas.mjs  -> writes ideas.js for the gallery page.
import fs from 'node:fs';
import os from 'node:os';
// The icon-design skill's generator, from the local Claude skills folder.
const {icon} = await import(`${os.homedir()}/.claude/skills/icon-design/references/glass.mjs`);
const W='#fff', K='#000';
const rnd=w=>`stroke="#fff" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const rk=w=>`stroke="#000" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const GOLD=['#FFE68A','#FFB300'];
const spark=(cx,cy,r,f=W)=>{const k=r/24,s=f===W?rnd(Math.max(3,5*k)):rk(Math.max(3,5*k));return `<path d="M${cx} ${cy-r}c${3*k} ${15*k} ${8*k} ${20*k} ${22*k} ${24*k}-${14*k} ${4*k}-${19*k} ${9*k}-${22*k} ${24*k}-${3*k}-${15*k}-${8*k}-${20*k}-${22*k}-${24*k} ${14*k}-${4*k} ${19*k}-${9*k} ${22*k}-${24*k}z" fill="${f}" ${s}/>`;};
const star5=(cx,cy,R,r,f)=>{let p=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r:R;p.push(`${(cx+q*Math.cos(a)).toFixed(1)} ${(cy+q*Math.sin(a)).toFixed(1)}`);}return `<path d="M${p.join('L')}Z" fill="${f}" ${f===K?rk(6):rnd(6)}/>`;};
const poly=(cx,cy,R,n,rot)=>Array.from({length:n},(_,i)=>{const a=rot+i*2*Math.PI/n;return `${(cx+R*Math.cos(a)).toFixed(1)} ${(cy+R*Math.sin(a)).toFixed(1)}`;}).join('L');

export const ideas=[
 {id:'gem',name:'Jewel',idea:'The one cut gem at the top of the hoard. Two tones of white make the facets, nothing else.',
  tile:['#FF73B4','#F0287E'],layers:[
  {kind:'white',alpha:.5,y:[60,212],mask:`<path d="M90 66H166L208 112L128 208L48 112Z" fill="${W}" ${rnd(12)}/>`},
  {kind:'white',y:[60,212],mask:`<path d="M108 66H148L168 112L128 208L88 112Z" fill="${W}" ${rnd(6)}/>`}]},
 {id:'playgem',name:'Play gem',idea:'A play button cut like a jewel: media and treasure in one shape.',
  tile:['#7B7BFF','#3A2FC4'],layers:[
  {kind:'white',alpha:.45,y:[50,206],mask:`<path d="M84 54V202L206 128Z" fill="${W}" ${rnd(24)}/>`},
  {kind:'white',alpha:.75,y:[50,206],mask:`<path d="M84 54L126 128L84 202Z" fill="${W}" ${rnd(6)}/>`},
  {kind:'white',y:[50,206],mask:`<path d="M84 54L206 128H126Z" fill="${W}" ${rnd(6)}/>`}]},
 {id:'eye',name:"Dragon's eye",idea:'Dragons are the original hoarders. A gold eye watching over your collection.',
  tile:['#3C3C42','#18181B'],layers:[
  {kind:'color',c:GOLD,y:[70,186],mask:`<path d="M34 128C78 60 178 60 222 128C178 196 78 196 34 128Z" fill="${W}" ${rnd(8)}/><path d="M128 66C148 102 148 154 128 190C108 154 108 102 128 66Z" fill="${K}"/>`},
  {kind:'white',y:[88,112],mask:`<circle cx="158" cy="100" r="11" fill="${W}"/>`}]},
 {id:'acorn',name:'Acorn',idea:'Squirrels hoard for winter; so do you, a backlog of things to watch. Friendly, not fantasy.',
  tile:['#FFB340','#FF6A00'],layers:[
  {kind:'white',alpha:.7,y:[126,216],mask:`<path d="M70 128H186C186 174 162 204 128 214C94 204 70 174 70 128Z" fill="${W}" ${rnd(8)}/>`},
  {kind:'white',y:[36,122],mask:`<path d="M48 118C48 76 86 60 128 60S208 76 208 118Z" fill="${W}" ${rnd(10)}/><path d="M128 62C128 50 132 42 144 36" fill="none" ${rnd(14)}/>`}]},
 {id:'coin',name:'Play coin',idea:'A gold coin stamped with a play mark: currency of the hoard.',
  tile:['#C77DFF','#7B2FD6'],layers:[
  {kind:'color',c:GOLD,y:[44,212],mask:`<circle cx="128" cy="128" r="84" fill="${W}"/><circle cx="128" cy="128" r="66" fill="none" stroke="${K}" stroke-width="8"/><path d="M112 96V160L164 128Z" fill="${K}" ${rk(10)}/>`}]},
 {id:'ticket',name:'Ticket',idea:'Every movie, show and game is an admission. A ticket stub with a star cut out.',
  tile:['#FFD43F','#FF9F00'],layers:[
  {kind:'white',y:[60,196],mask:`<g transform="rotate(-12 128 128)"><rect x="40" y="74" width="176" height="108" rx="20" fill="${W}"/><circle cx="40" cy="128" r="17" fill="${K}"/><circle cx="216" cy="128" r="17" fill="${K}"/>${[94,116,140,162].map(y=>`<circle cx="166" cy="${y}" r="5" fill="${K}"/>`).join('')}${star5(106,130,30,13,K)}</g>`}]},
 {id:'crown',name:'Crown',idea:'Your collection, your kingdom. A bold gold crown, the easy read of "the best stuff".',
  tile:['#4C8DFF','#1E3FD1'],layers:[
  {kind:'color',c:GOLD,y:[50,192],mask:`<path d="M50 98L90 138L128 70L166 138L206 98L190 188H66Z" fill="${W}" ${rnd(16)}/><circle cx="50" cy="88" r="13" fill="${W}"/><circle cx="128" cy="58" r="13" fill="${W}"/><circle cx="206" cy="88" r="13" fill="${W}"/><rect x="58" y="160" width="140" height="9" fill="${K}"/>`}]},
 {id:'cards',name:'Collection',idea:'A fanned stack of posters, the front one playable. Closest to the Wallet look you picked.',
  tile:['#45E0C8','#00A898'],layers:[
  {kind:'white',alpha:.45,y:[50,206],mask:`<rect x="73" y="54" width="110" height="150" rx="22" fill="${W}" transform="rotate(-15 128 200)"/>`},
  {kind:'white',alpha:.6,y:[50,206],mask:`<rect x="73" y="54" width="110" height="150" rx="22" fill="${W}" transform="rotate(15 128 200)"/>`},
  {kind:'white',y:[50,206],mask:`<rect x="73" y="52" width="110" height="152" rx="22" fill="${W}"/><path d="M114 104V152L154 128Z" fill="${K}" ${rk(8)}/>`}]},
 {id:'reel',name:'Film reel',idea:'The classic movie reel: one disc, five holes. Instantly media.',
  tile:['#FF6B6B','#E0243B'],layers:[
  {kind:'white',y:[42,214],mask:`<circle cx="128" cy="128" r="86" fill="${W}"/>${[0,1,2,3,4].map(i=>{const a=-Math.PI/2+i*2*Math.PI/5;return `<circle cx="${(128+48*Math.cos(a)).toFixed(1)}" cy="${(128+48*Math.sin(a)).toFixed(1)}" r="20" fill="${K}"/>`;}).join('')}<circle cx="128" cy="128" r="9" fill="${K}"/>`}]},
 {id:'key',name:'Key',idea:'The key to the vault. One bold diagonal key, nothing else.',
  tile:['#2DD4BF','#0B7F73'],layers:[
  {kind:'white',y:[40,216],mask:`<g transform="rotate(45 128 128)"><circle cx="128" cy="72" r="38" fill="${W}"/><circle cx="128" cy="72" r="15" fill="${K}"/><rect x="117" y="100" width="22" height="116" rx="11" fill="${W}"/><rect x="128" y="168" width="34" height="16" rx="7" fill="${W}"/><rect x="128" y="194" width="26" height="16" rx="7" fill="${W}"/></g>`}]},
 {id:'potion',name:'Potion',idea:'A flask of something glowing: the stories you have bottled up. Magic without the clutter.',
  tile:['#8B7CFF','#4B2FD6'],layers:[
  {kind:'white',alpha:.5,y:[52,218],mask:`<circle cx="128" cy="150" r="66" fill="${W}"/><rect x="108" y="56" width="40" height="60" rx="8" fill="${W}"/>`},
  {kind:'color',c:['#FF9AD5','#FF3D9A'],y:[140,216],mask:`<path d="M62 150Q95 132 128 150T194 150A66 66 0 0 1 62 150Z" fill="${W}"/><circle cx="110" cy="178" r="7" fill="${K}"/><circle cx="142" cy="166" r="5" fill="${K}"/>`},
  {kind:'white',y:[38,64],mask:`<rect x="102" y="38" width="52" height="26" rx="11" fill="${W}"/>`}]},
 {id:'sparkle',name:'Shine',idea:'Just the glint. Hoards are made of shiny things; one big sparkle and a small one.',
  tile:['#F472FF','#B517D9'],layers:[
  {kind:'white',alpha:.6,y:[34,92],mask:spark(194,62,28)},
  {kind:'white',y:[50,220],mask:spark(116,138,86)}]},
 {id:'d20',name:'D20',idea:'A twenty-sided die: games, chance and a nod to fantasy, as a clean two-tone hexagon.',
  tile:['#FF8A4C','#EE3B1E'],layers:[
  {kind:'white',alpha:.5,y:[40,216],mask:`<path d="M${poly(128,128,90,6,-Math.PI/2)}Z" fill="${W}" ${rnd(14)}/>`},
  {kind:'white',y:[40,216],mask:`<path d="M128 72L178 160H78Z" fill="${W}" ${rnd(12)}/>`}]},
 {id:'orb',name:'Crystal ball',idea:'See what to watch next. A glass orb on a stand with a gold star inside.',
  tile:['#5B8CFF','#2B3FD9'],layers:[
  {kind:'white',alpha:.5,y:[42,182],mask:`<circle cx="128" cy="112" r="72" fill="${W}"/>`},
  {kind:'color',c:GOLD,y:[78,140],mask:spark(128,110,32)},
  {kind:'white',y:[166,210],mask:`<path d="M74 196Q78 170 100 168H156Q178 170 182 196Q182 210 168 210H88Q74 210 74 196Z" fill="${W}"/>`}]},
];


// Multicolour jewel variants (the chosen direction): coloured facets on a dark tile.
const F={cl:'M90 66H108L88 112H48Z',tb:'M108 66H148L168 112H88Z',cr:'M148 66H166L208 112H168Z',
  pl:'M48 112H88L128 208Z',pc:'M88 112H168L128 208Z',pr:'M168 112H208L128 208Z'};
const facet=(k,c,y)=>({kind:'color',c,y,mask:`<path d="${F[k]}" fill="${W}" ${rnd(10)}/>`});
const C={pink:['#FF8AC8','#F0287E'],pinkL:['#FFC6E4','#FF8AC8'],purple:['#C59BFF','#8B3DF0'],purpleL:['#E6D2FF','#C59BFF'],
  yellow:['#FFE680','#FFB020'],yellowL:['#FFF4BF','#FFE07A'],purpleD:['#A66BFF','#6A1FD0']};
const GRAPHITE=['#3C3C42','#18181B'], BLACK=['#26262A','#050506'];
const jewel=(id,name,idea,tile,m)=>({id,name,idea,tile,layers:[
  facet('cl',m.cl,[66,112]),facet('cr',m.cr,[66,112]),facet('pl',m.pl,[112,208]),facet('pr',m.pr,[112,208]),
  facet('tb',m.tb,[66,112]),facet('pc',m.pc,[112,208])]});
// One stone, shaded by lightness (light from the top left), not split into colour columns.
const P=pts=>'M'+pts.map(p=>p.join(' ')).join('L')+'Z';
const G=[[92,66],[128,66],[164,66]], R=[[48,112],[88,112],[128,112],[168,112],[208,112]], CU=[128,208];
const cut9={c1:[G[0],R[0],R[1]],c2:[G[0],G[1],R[1]],c3:[G[1],R[1],R[3]],c4:[G[1],G[2],R[3]],c5:[G[2],R[3],R[4]],
  p1:[R[0],R[1],CU],p2:[R[1],R[2],CU],p3:[R[2],R[3],CU],p4:[R[3],R[4],CU]};
const stone=(id,name,idea,tile,cut,tones,extra=[])=>({id,name,idea,tile,layers:[
  ...Object.keys(cut).map(k=>({kind:'color',c:tones[k],y:k[0]==='c'?[66,112]:[112,208],mask:`<path d="${P(cut[k])}" fill="${W}" ${rnd(6)}/>`})),...extra]});
const sh=(a,b)=>[a,b];
const amethyst={c1:sh('#C9A2FF','#B184FF'),c2:sh('#E2CCFF','#D2B2FF'),c3:sh('#F4EBFF','#DCC4FF'),c4:sh('#C9A2FF','#B98EFF'),c5:sh('#A472F7','#8F58EE'),
  p1:sh('#A673FA','#8447EC'),p2:sh('#8A4FF0','#6A2EDB'),p3:sh('#7136E0','#5420C2'),p4:sh('#5A24C4','#3F1597')};
const twilight={c1:sh('#B9B4FF','#9F98FF'),c2:sh('#D6E4FF','#BCD0FF'),c3:sh('#EEF4FF','#CFDCFF'),c4:sh('#B9B4FF','#A39CFF'),c5:sh('#8F7DF7','#7A63EE'),
  p1:sh('#8F7DFA','#6F55EC'),p2:sh('#7457F0','#5636DB'),p3:sh('#5B3BE0','#4424C2'),p4:sh('#4826C4','#311597')};
const simple={c1:sh('#C9A2FF','#B184FF'),c3:sh('#F0E4FF','#D6BBFF'),c5:sh('#A472F7','#8F58EE'),p1:sh('#A673FA','#8447EC'),p3:sh('#7E43E8','#5E28CF'),p4:sh('#5A24C4','#3F1597')};
const cut6={c1:[G[0],[108,66],R[1],R[0]],c3:[[108,66],[148,66],R[3],R[1]],c5:[[148,66],G[2],R[4],R[3]],p1:[R[0],R[1],CU],p3:[R[1],R[3],CU],p4:[R[3],R[4],CU]};
cut6.c1=[G[0],[108,66],R[1],R[0]];
const glint={kind:'white',y:[40,90],mask:spark(84,58,20)};
// Crown re-cut as alternating triangles (no pale block at the top centre).
const T=[[92,66],[128,66],[164,66]], Q=[[48,112],[110,112],[128,112],[146,112],[208,112]];
const cutStar={u0:[T[0],Q[0],Q[1]],d1:[T[0],T[1],Q[1]],um:[T[1],Q[1],Q[3]],d2:[T[1],T[2],Q[3]],u2:[T[2],Q[3],Q[4]],
  p1:[Q[0],Q[1],CU],p2:[Q[1],Q[2],CU],p3:[Q[2],Q[3],CU],p4:[Q[3],Q[4],CU]};
const bvStar={u0:sh('#B9B4FF','#A39CFF'),d1:sh('#EEF4FF','#D3E1FF'),um:sh('#C4D6FF','#A9B8FF'),d2:sh('#D2D4FF','#B5B2FF'),u2:sh('#8F7DF7','#7A63EE'),
  p1:sh('#8F7DFA','#6F55EC'),p2:sh('#7457F0','#5636DB'),p3:sh('#5B3BE0','#4424C2'),p4:sh('#4826C4','#311597')};
// Original cut (the preferred bottom); only the crown tones change so the centre stops glowing.
const bvSoft={...twilight,c1:sh('#C4C6FF','#ABAEFF'),c2:sh('#D8E2FF','#BCCBFF'),c3:sh('#AEB8FF','#949CFF'),c4:sh('#B9B4FF','#A39CFF'),c5:sh('#8F7DF7','#7A63EE')};
const bvDim={...twilight,c1:sh('#C4C6FF','#ABAEFF'),c2:sh('#D2DCFF','#B4C2FF'),c3:sh('#9C9CFF','#8580F8'),c4:sh('#B0A8FF','#9A8FFF'),c5:sh('#8F7DF7','#7A63EE')};
// Minimalist pass on "darker top": fewer facets and/or flat fills.
const flat=t=>Object.fromEntries(Object.entries(t).map(([k,[a,b]])=>[k,[a,a]]));
const cut7={c1:cut9.c1,cm:[G[0],G[2],R[3],R[1]],c5:cut9.c5,p1:cut9.p1,p2:cut9.p2,p3:cut9.p3,p4:cut9.p4};
const bv7={c1:bvDim.c1,cm:sh('#B4B8FF','#9C9CFF'),c5:bvDim.c5,p1:bvDim.p1,p2:bvDim.p2,p3:bvDim.p3,p4:bvDim.p4};
const cut5={c1:cut9.c1,cm:cut7.cm,c5:cut9.c5,pl:[R[0],R[2],CU],pr:[R[2],R[4],CU]};
const bv5={c1:bvDim.c1,cm:bv7.cm,c5:bvDim.c5,pl:sh('#8A76F8','#6145E4'),pr:sh('#5638D8','#36189E')};
// The white two-tone Jewel on purple tiles.
const whiteJewel=(id,name,idea,tile)=>({id,name,idea,tile,layers:[
  {kind:'white',alpha:.5,y:[60,212],mask:`<path d="M90 66H166L208 112L128 208L48 112Z" fill="${W}" ${rnd(12)}/>`},
  {kind:'white',y:[60,212],mask:`<path d="M108 66H148L168 112L128 208L88 112Z" fill="${W}" ${rnd(6)}/>`}]});
export const purpleJewels=[
 whiteJewel('jewel-violet','Jewel · Violet','The white two-tone jewel on a bright violet tile.',['#C77DFF','#7B2FD6']),
 whiteJewel('jewel-blueviolet','Jewel · Blue-violet','On a blue-violet tile, matching the stone you liked.',['#8B7CFF','#4B2FD6']),
 whiteJewel('jewel-deep','Jewel · Deep purple','On a deeper, darker purple, closer to the graphite mood.',['#7A4FE0','#3A1690']),
];
export const jewels=[
 stone('bv-dim','Darker top (your pick)','Nine facets with soft shading, as you chose it.',GRAPHITE,cut9,bvDim),
 stone('bv-dim-flat','Darker top, flat fills','Same nine facets, each a single solid colour. No shading inside a facet.',GRAPHITE,cut9,flat(bvDim)),
 stone('bv-7','Seven facets','The three middle top facets merged into one band; your bottom kept as is.',GRAPHITE,cut7,bv7),
 stone('bv-5','Five facets','Three top facets and a bottom split once, lit half and shadow half. The most minimal.',GRAPHITE,cut5,bv5),
];

// Landscape tvOS-style tile (400x240) using the same layers, flat.
function tv(spec){
  const dx=72,dy=-8,u=spec.id+'-tv';
  let defs=`<linearGradient id="${u}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${spec.tile[0]}"/><stop offset="1" stop-color="${spec.tile[1]}"/></linearGradient>`;
  let body=`<rect width="400" height="240" rx="22" fill="url(#${u}t)"/>`;
  spec.layers.forEach((L,i)=>{
    const [y0,y1]=L.y, top=L.kind==='white'?'#fff':L.c[0], bot=L.kind==='white'?'#fff':L.c[1];
    defs+=`<mask id="${u}m${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="400" height="240"><g transform="translate(${dx} ${dy})">${L.mask}</g></mask><linearGradient id="${u}g${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${y0+dy}" x2="0" y2="${y1+dy}"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bot}"/></linearGradient>`;
    body+=`<g opacity="${L.alpha??1}"><rect width="400" height="240" fill="url(#${u}g${i})" mask="url(#${u}m${i})"/></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><defs>${defs}</defs>${body}</svg>`;
}
const out=[...purpleJewels,...jewels,...ideas].map(s=>({id:s.id,name:s.name,idea:s.idea,svg:icon(s,'flat'),tv:tv(s)}));
fs.mkdirSync(new URL('./svg/',import.meta.url),{recursive:true});
for(const o of out) fs.writeFileSync(new URL(`./svg/${o.id}.svg`,import.meta.url),o.svg);
fs.writeFileSync(new URL('./ideas.js',import.meta.url),'window.IDEAS='+JSON.stringify(out)+';\n');
console.log(out.length,'ideas');

// Self-contained page: inline the ideas and the local Apple reference icons.
let html=fs.readFileSync(new URL('./template.html',import.meta.url),'utf8');
html=html.replace('<script src="ideas.js"></script>',()=>'<script>window.IDEAS='+JSON.stringify(out)+';</script>');
for(const r of ['ref-tv.png','ref-music.png','ref-podcasts.png']){
  const p=new URL('./'+r,import.meta.url);
  if(fs.existsSync(p)) html=html.replace(`'${r}'`,`'data:image/png;base64,${fs.readFileSync(p).toString('base64')}'`);
}
fs.writeFileSync(new URL('./index.html',import.meta.url),html);
