// tvOS layered icon and top shelf from the Hoard plate (../icon.svg, viewBox 120).
// Back = tile, rings and diagram; Front = the gem, so it floats on parallax. 400x240 base.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../icon.svg', import.meta.url), 'utf8');
const tile = '#0f2321';
const body = src.slice(src.indexOf('>') + 1, src.lastIndexOf('</svg>'));
const cut = body.indexOf('<g fill="none" stroke="#e8dcc0"'); // the gem starts here
const [diagram, gem] = [body.slice(0, cut).replace(/<rect[^>]*\/>/, ''), body.slice(cut)];
// place the 120 plate centred in a w x h canvas, `size` px tall
const place = (inner, w, h, size) => `<g transform="translate(${(w - size) / 2} ${(h - size) / 2}) scale(${size / 120})">${inner.trim()}</g>`;
const svg = (w, h, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>\n`;
const bg = (w, h) => `<rect width="${w}" height="${h}" fill="${tile}"/>`;
fs.writeFileSync('back.svg', svg(400, 240, bg(400, 240) + place(diagram, 400, 240, 224)));
fs.writeFileSync('front.svg', svg(400, 240, place(gem, 400, 240, 224)));
fs.writeFileSync('preview.svg', svg(400, 240, `<clipPath id="c"><rect width="400" height="240" rx="22"/></clipPath><g clip-path="url(#c)">${bg(400, 240)}${place(diagram + gem, 400, 240, 224)}</g>`));
for (const w of [1920, 2320]) fs.writeFileSync(`topshelf-${w}.svg`, svg(w, 720, bg(w, 720) + place(diagram + gem, w, 720, 600)));
