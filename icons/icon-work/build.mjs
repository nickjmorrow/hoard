// Hoard icon concepts, built with the icon-design generator (flat mode).
import fs from 'node:fs';
import os from 'node:os';
// The icon-design skill's generator, from the local Claude skills folder.
const {icon} = await import(`${os.homedir()}/.claude/skills/icon-design/references/glass.mjs`);
const W='#fff', K='#000', out=process.argv[2]??'.';
const rnd=w=>`stroke="#fff" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const GOLD=['#FFE68A','#FFB300'], VIOLET=['#C77DFF','#7B2FD6'];
const star=(cx,cy,r)=>{const k=r/24;return `<path d="M${cx} ${cy-r}c${3*k} ${15*k} ${8*k} ${20*k} ${22*k} ${24*k}-${14*k} ${4*k}-${19*k} ${9*k}-${22*k} ${24*k}-${3*k}-${15*k}-${8*k}-${20*k}-${22*k}-${24*k} ${14*k}-${4*k} ${19*k}-${9*k} ${22*k}-${24*k}z" fill="${W}" ${rnd(Math.max(3,5*k))}/>`;};
const sparkles=star(204,46,24)+star(60,38,13);
// closed chest: domed lid, seam, lock gap
const closedChest=`<path d="M44 118V102A84 46 0 0 1 212 102V118Z" fill="${W}" ${rnd(8)}/><rect x="40" y="128" width="176" height="80" rx="18" fill="${W}"/><rect x="102" y="96" width="52" height="60" rx="16" fill="${K}"/><rect x="72" y="40" width="9" height="180" fill="${K}"/><rect x="175" y="40" width="9" height="180" fill="${K}"/>`;
const lock=`<rect x="110" y="104" width="36" height="44" rx="10" fill="${W}"/><circle cx="128" cy="121" r="7" fill="${K}"/><rect x="124.5" y="122" width="7" height="15" rx="3.5" fill="${K}"/>`;
const specs=[
 {id:'hoard-a',name:'Closed',tile:VIOLET,layers:[
   {kind:'white',y:[56,208],mask:closedChest},
   {kind:'color',c:GOLD,y:[22,150],mask:lock+sparkles}]},
 {id:'hoard-b',name:'Open',tile:VIOLET,layers:[
   {kind:'white',alpha:.5,y:[44,120],mask:`<path d="M50 114L62 44Q128 32 194 44L206 114Z" fill="${W}" ${rnd(12)}/>`},
   {kind:'color',c:GOLD,y:[22,140],mask:`<circle cx="90" cy="122" r="28" fill="${W}"/><circle cx="128" cy="108" r="32" fill="${W}"/><circle cx="166" cy="122" r="28" fill="${W}"/>`+star(206,40,22)},
   {kind:'white',y:[122,208],mask:`<rect x="36" y="120" width="184" height="92" rx="22" fill="${W}"/><rect x="72" y="110" width="9" height="110" fill="${K}"/><rect x="175" y="110" width="9" height="110" fill="${K}"/><rect x="104" y="136" width="48" height="44" rx="14" fill="${K}"/>`},
   {kind:'color',c:GOLD,y:[140,176],mask:`<rect x="110" y="142" width="36" height="32" rx="9" fill="${W}"/><circle cx="128" cy="155" r="6" fill="${K}"/><rect x="125" y="156" width="6" height="11" rx="3" fill="${K}"/>`}]},
 {id:'hoard-c',name:'Graphite',tile:['#3C3C42','#18181B'],layers:[
   {kind:'color',c:GOLD,y:[56,208],mask:closedChest},
   {kind:'white',y:[22,150],mask:lock+sparkles}]},
];
for(const s of specs) fs.writeFileSync(`${out}/${s.id}.svg`, icon(s,'flat'));
