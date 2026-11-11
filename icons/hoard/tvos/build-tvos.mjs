// tvOS layered icon (Back = tile gradient, Front = white gem) from the final Hoard icon. 400x240 base.
import fs from 'node:fs';
const [t0,t1]=['#8B7CFF','#4B2FD6'];
const gem=(s)=>`<g transform="translate(200 120) scale(${s}) translate(-128 -137)">
<path d="M90 66H166L208 112L128 208L48 112Z" fill="#fff" fill-opacity=".5" stroke="#fff" stroke-opacity=".5" stroke-width="12" stroke-linejoin="round"/>
<path d="M108 66H148L168 112L128 208L88 112Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></g>`;
const back=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t0}"/><stop offset="1" stop-color="${t1}"/></linearGradient></defs><rect width="400" height="240" fill="url(#g)"/></svg>`;
// back layer outer gem is translucent: draw as a group so overlapping fill+stroke don't double up
const front=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">${gem(.95).replace('fill-opacity=".5" stroke="#fff" stroke-opacity=".5"','stroke="#fff"').replace('<path d="M90','<g opacity=".5"><path d="M90').replace('round"/>\n<path d="M108','round"/></g>\n<path d="M108')}</svg>`;
fs.writeFileSync('back.svg',back); fs.writeFileSync('front.svg',front);
