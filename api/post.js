// api/post.js
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const IG_ID    = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

function getDimensions(dim) {
  return ({ '1:1':{w:1080,h:1080}, '4:5':{w:1080,h:1350}, '9:16':{w:1080,h:1920}, '16:9':{w:1920,h:1080} })[dim] || {w:1080,h:1080};
}

function escapeHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function hexToRgb(hex) {
  const h=(hex||'#000000').replace('#','').padEnd(6,'0');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}
function rgbToHex(r,g,b) {
  return '#'+[r,g,b].map(v=>Math.min(255,Math.max(0,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function lighten(hex,a) { const [r,g,b]=hexToRgb(hex); return rgbToHex(r+255*a,g+255*a,b+255*a); }
function darken(hex,a)  { const [r,g,b]=hexToRgb(hex); return rgbToHex(r-255*a,g-255*a,b-255*a); }
function blendHex(h1,h2,t) {
  const [r1,g1,b1]=hexToRgb(h1),[r2,g2,b2]=hexToRgb(h2);
  return rgbToHex(r1*(1-t)+r2*t,g1*(1-t)+g2*t,b1*(1-t)+b2*t);
}

function buildCardHtml(post) {
  const {
    quote, bg_color, border_color, ink_color,
    font_quote, font_header, font_meta,
    font_size_quote, font_size_header, font_size_meta,
    post_number, scheduled_at, dimension
  } = post;

  const { w, h } = getDimensions(dimension);
  const date  = new Date(scheduled_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const num   = String(post_number || 1).padStart(3, '0');
  const pad   = Math.round(w * 0.07);
  const bord  = Math.round(w * 0.035);
  const tick  = Math.round(bord * 0.7);
  const mSize = Math.round(w * 0.115);
  const qPad  = Math.round(mSize * 1.1);
  const bg    = bg_color || '#2e4a6a';
  const bc    = border_color || '#8aacbf';
  const ink   = ink_color || '#e8e4dc';
  const fq    = font_quote || 'Courier Prime';
  const fh    = font_header || 'Cormorant Garamond';
  const fm    = font_meta || 'Cormorant Garamond';
  const sq    = (font_size_quote  || 16) * (w / 340);
  const sh    = (font_size_header || 11) * (w / 340);
  const sm    = (font_size_meta   || 10) * (w / 340);
  const muted = blendHex(ink, bg, 0.45);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(fq)}:ital,wght@0,300;0,400;1,300;1,400&family=${encodeURIComponent(fh)}:ital,wght@0,300;0,400;1,300;1,400&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${w}px;height:${h}px;overflow:hidden;}
.card{width:${w}px;height:${h}px;background:radial-gradient(ellipse at 28% 22%,${lighten(bg,0.12)} 0%,transparent 52%),radial-gradient(ellipse at 72% 78%,${darken(bg,0.08)} 0%,transparent 52%),${bg};position:relative;overflow:hidden;}
.noise{position:absolute;inset:0;opacity:0.13;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0.1'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");background-size:300px;}
.vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,0.22) 100%);}
.bsvg{position:absolute;inset:0;width:100%;height:100%;}
.ct{position:absolute;inset:0;padding:${pad}px;display:flex;flex-direction:column;z-index:4;}
.hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:${Math.round(pad*0.3)}px;}
.fm{font-family:'${fh}',Georgia,serif;font-size:${sh}px;font-weight:300;font-style:italic;letter-spacing:0.08em;color:${muted};}
.qn{font-family:'${fm}',Georgia,serif;font-size:${sm}px;font-weight:300;letter-spacing:0.45em;color:${muted};}
.rl{width:100%;height:${Math.max(1,Math.round(w*0.001))}px;background:${bc};opacity:0.4;}
.qa{flex:1;display:flex;align-items:center;justify-content:center;}
.qw{width:100%;position:relative;}
.qt{font-family:'${fq}','Courier New',monospace;font-size:${sq}px;font-style:italic;line-height:1.78;letter-spacing:0.01em;color:${ink};text-align:left;padding:${qPad}px 0;}
.om{position:absolute;top:0;left:-${Math.round(mSize*0.12)}px;transform:translateY(-${Math.round(mSize*0.35)}px);font-family:'${fh}',Georgia,serif;font-size:${mSize}px;font-weight:300;line-height:1;color:${ink};opacity:0.2;}
.cm{position:absolute;bottom:0;right:-${Math.round(mSize*0.08)}px;transform:translateY(${Math.round(mSize*0.35)}px);font-family:'${fh}',Georgia,serif;font-size:${mSize}px;font-weight:300;line-height:1;color:${ink};opacity:0.2;}
.ft{display:flex;align-items:flex-end;justify-content:space-between;padding-top:${Math.round(pad*0.4)}px;}
.dr{width:${Math.round(w*0.055)}px;height:${Math.max(1,Math.round(w*0.001))}px;background:${bc};opacity:0.55;margin-bottom:${Math.round(w*0.008)}px;}
.dt{font-family:'${fm}',Georgia,serif;font-size:${sm}px;font-weight:300;letter-spacing:0.2em;color:${muted};}
.wm{font-family:'${fm}',Georgia,serif;font-size:${sm*1.08}px;font-style:italic;font-weight:300;letter-spacing:0.12em;color:${ink};opacity:0.2;}
</style></head><body>
<div class="card">
  <div class="noise"></div><div class="vig"></div>
  <svg class="bsvg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bord}" y="${bord}" width="${w-bord*2}" height="${h-bord*2}" stroke="${bc}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <line x1="${bord}" y1="${bord+tick}" x2="${bord}" y2="${bord}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <line x1="${bord}" y1="${bord}" x2="${bord+tick}" y2="${bord}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <circle cx="${bord}" cy="${bord}" r="3" fill="${bc}" opacity="0.65"/>
    <line x1="${w-bord}" y1="${bord}" x2="${w-bord-tick}" y2="${bord}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <line x1="${w-bord}" y1="${bord}" x2="${w-bord}" y2="${bord+tick}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <circle cx="${w-bord}" cy="${bord}" r="3" fill="${bc}" opacity="0.65"/>
    <line x1="${bord}" y1="${h-bord}" x2="${bord+tick}" y2="${h-bord}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <line x1="${bord}" y1="${h-bord}" x2="${bord}" y2="${h-bord-tick}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <circle cx="${bord}" cy="${h-bord}" r="3" fill="${bc}" opacity="0.65"/>
    <line x1="${w-bord}" y1="${h-bord}" x2="${w-bord-tick}" y2="${h-bord}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <line x1="${w-bord}" y1="${h-bord}" x2="${w-bord}" y2="${h-bord-tick}" stroke="${bc}" stroke-width="2" opacity="0.9"/>
    <circle cx="${w-bord}" cy="${h-bord}" r="3" fill="${bc}" opacity="0.65"/>
  </svg>
  <div class="ct">
    <div class="hd"><span class="fm">From the Margins</span><span class="qn">${num}</span></div>
    <div class="rl"></div>
    <div class="qa"><div class="qw">
      <span class="om">\u201C</span>
      <p class="qt">${escapeHtml(quote)}</p>
      <span class="cm">\u201D</span>
    </div></div>
    <div class="ft">
      <div><div class="dr"></div><span class="dt">${date}</span></div>
      <span class="wm">The Anvil Speaks</span>
    </div>
  </div>
</div>
</body></html>`;
}

async function waitForContainer(containerId) {
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res  = await fetch(`https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${IG_TOKEN}`);
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Container processing failed');
  }
  throw new Error('Container timed out');
}

async function postToInstagram(post, imageUrl) {
  const containerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption: post.caption || '', access_token: IG_TOKEN }),
  });
  const container = await containerRes.json();
  if (container.error) throw new Error(`Container error: ${container.error.message}`);
  await waitForContainer(container.id);

  const publishRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: IG_TOKEN }),
  });
  const published = await publishRes.json();
  if (published.error) throw new Error(`Publish error: ${published.error.message}`);
  return published.id;
}

async function renderCard(post) {
  const { default: puppeteer } = await import('puppeteer-core');
  const { default: chromium }  = await import('@sparticuz/chromium');
  const { w, h } = getDimensions(post.dimension);

  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: w, height: h },
    executablePath: await chromium.executablePath('/tmp/chromium'),
    headless: 'shell',
  });
  // rest stays the same

  const page = await browser.newPage();
  await page.setContent(buildCardHtml(post), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000));
  const screenshot = await page.screenshot({ type: 'png', encoding: 'base64' });
  await browser.close();

  const fileName = `cards/${post.id}.png`;
  const buffer   = Buffer.from(screenshot, 'base64');

  const { error: uploadErr } = await db.storage
    .from('anvil-cards')
    .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = db.storage.from('anvil-cards').getPublicUrl(fileName);
  return publicUrl;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { post_id } = req.body;
  if (!post_id) return res.status(400).json({ error: 'post_id required' });

  const { data: post, error: fetchErr } = await db
    .from('anvil_posts').select('*').eq('id', post_id).single();

  if (fetchErr || !post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'pending') return res.status(400).json({ error: `Post is ${post.status}` });

  await db.from('anvil_posts').update({ status: 'rendering' }).eq('id', post_id);

  try {
    const imageUrl = await renderCard(post);
    const igPostId = await postToInstagram(post, imageUrl);
    await db.from('anvil_posts').update({
      status: 'posted',
      instagram_post_id: igPostId,
      posted_at: new Date().toISOString(),
    }).eq('id', post_id);
    return res.status(200).json({ success: true, instagram_post_id: igPostId });
  } catch (err) {
    await db.from('anvil_posts').update({
      status: 'failed',
      error_message: err.message,
    }).eq('id', post_id);
    return res.status(500).json({ error: err.message });
  }
}
