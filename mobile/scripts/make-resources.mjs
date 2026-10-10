// Renders the app icon and splash sources (mobile/resources/*.png) from frontend/assets/logo.svg.
// @capacitor/assets then turns them into every Android density.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'resources');
mkdirSync(OUT, { recursive: true });
const logo = readFileSync(join(here, '..', '..', 'frontend', 'assets', 'logo.svg'));
const render = (size) => sharp(logo, { density: 1200 }).resize(size, size).png().toBuffer();
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const canvas = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 4, background: bg } });

// Legacy square icon: logo on white with a margin.
await canvas(1024, 1024, WHITE).composite([{ input: await render(720), gravity: 'center' }]).png().toFile(join(OUT, 'icon-only.png'));
// Adaptive icon: transparent foreground inside the 66 % safe zone + white background layer.
await canvas(1024, 1024, { r: 0, g: 0, b: 0, alpha: 0 }).composite([{ input: await render(560), gravity: 'center' }]).png().toFile(join(OUT, 'icon-foreground.png'));
await canvas(1024, 1024, WHITE).png().toFile(join(OUT, 'icon-background.png'));

// Splash: logo + wordmark on the app's light background.
const word = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="220">
  <text x="600" y="150" text-anchor="middle" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="140" font-weight="800">
    <tspan fill="#172B4D">Civic</tspan><tspan fill="#2D63D8">Mind</tspan></text></svg>`);
const tag = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="90">
  <text x="800" y="60" text-anchor="middle" font-family="Segoe UI, Roboto, Arial, sans-serif" font-size="54" fill="#5E6C84">Report · Track · Resolved</text></svg>`);
for (const [name, bg] of [['splash.png', { r: 245, g: 248, b: 252, alpha: 1 }], ['splash-dark.png', { r: 245, g: 248, b: 252, alpha: 1 }]]) {
  await canvas(2732, 2732, bg).composite([
    { input: await render(600), top: 820, left: 1066 },
    { input: word, top: 1450, left: 766 },
    { input: tag, top: 1690, left: 566 },
  ]).png().toFile(join(OUT, name));
}
console.log('resources written to', OUT);
