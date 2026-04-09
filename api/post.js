// api/post.js — Anvil Press posting pipeline
// Vercel serverless function
// Renders card → uploads to Instagram → posts

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const IG_ID    = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { post_id } = req.body;
  if (!post_id) return res.status(400).json({ error: 'post_id required' });

  // 1. Fetch post from Supabase
  const { data: post, error: fetchErr } = await db
    .from('anvil_posts')
    .select('*')
    .eq('id', post_id)
    .single();

  if (fetchErr || !post) return res.status(404).json({ error: 'Post not found' });
  if (post.status !== 'pending') return res.status(400).json({ error: `Post is ${post.status}` });

  // Mark as rendering
  await db.from('anvil_posts').update({ status: 'rendering' }).eq('id', post_id);

  try {
    // 2. Render card to image
    const imageUrl = await renderCard(post);

    // 3. Post to Instagram
    const igPostId = await postToInstagram(post, imageUrl);

    // 4. Mark as posted
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

// ── Render card using Puppeteer ──────────────────────────────────────────────
async function renderCard(post) {
  const html = buildCardHtml(post);
  const { w, h } = getDimensions(post.dimension);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: w, height: h },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.waitForTimeout(800); // let fonts render

  const screenshot = await page.screenshot({ type: 'png', encoding: 'base64' });
  await browser.close();

  // Upload to a public URL via Supabase Storage
  const fileName = `cards/${post.id}.png`;
  const buffer = Buffer.from(screenshot, 'base64');

  const { error: uploadErr } = await db.storage
    .from('anvil-cards')
    .upload(fileName, buffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = db.storage
    .from('anvil-cards')
    .getPublicUrl(fileName);

  return publicUrl;
}

// ── Post to Instagram Graph API ──────────────────────────────────────────────
async function postToInstagram(post, imageUrl) {
  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v25.0/${IG_ID}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: post.caption || '',
        access_token: IG_TOKEN,
      }),
    }
  );

  const container = await containerRes.json();
  if (container.error) throw new Error(`Container error: ${container.error.message}`);

  // Step 2: Poll until container is ready
  await waitForContainer(container.id);

  // Step 3: Publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v25.0/${IG_ID}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: IG_TOKEN,
      }),
    }
  );

  const published = await publishRes.json();
  if (published.error) throw new Error(`Publish error: ${published.error.message}`);

  return published.id;
}

async function waitForContainer(containerId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(
      `https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${IG_TOKEN}`
    );
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Container processing failed');
  }
  throw new Error('Container timed out');
}

// ── Build card HTML ──────────────────────────────────────────────────────────
function buildCardHtml(post) {
  const {
    quote, bg_color, border_color, ink_color,
    font_quote, font_header, font_meta,
    font_size_quote, font_size_header, font_size_meta,
    post_number, scheduled_at, dimension,
  } = post;

  const { w, h } = getDimensions(dimension);
  const date = new Date(scheduled_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  const num = String(post_number || 1).padStart(3, '0');

  const gFont = encodeURIComponent(font_quote || 'Courier Prime');
  const gFont2 = encodeURIComponent(font_header || 'Cormorant Garamond');

  const muted = blendHex(ink_color, bg_color, 0.45);
  const pad = Math.round(w * 0.07);
  const bord = Math.round(w * 0.035);
  const tick = Math.round(bord * 0.7);
  const markSize = Math.round(w * 0.115);
  const quotePad = Math.round(markSize * 1.1);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=${gFont}:ital,wght@0,300;0,400;1,300;1,400&family=${gFont2}:ital,wght@0,300;0,400;1,300;1,400&display=swap" rel="stylesheet"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${w}px; height:${h}px; overflow:hidden; }
  .card {
    width:${w}px; height:${h}px;
    background: radial-gradient(ellipse at 28% 22%, ${lighten(bg_color,0.12)} 0%, transparent 52%),
                radial-gradient(ellipse at 72% 78%, ${darken(bg_color,0.08)} 0%, transparent 52%),
                ${bg_color};
    position:relative; overflow:hidden;
  }
  .noise {
    position:absolute; inset:0; opacity:0.13;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='turbulence' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0.1'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 300px;
  }
  .vignette {
    position:absolute; inset:0;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.22) 100%);
  }
  .border-svg { position:absolute; inset:0; width:100%; height:100%; }
  .content {
    position:absolute; inset:0;
    padding:${pad}px;
    display:flex; flex-direction:column;
    z-index:4;
  }
  .header { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:${Math.round(pad*0.3)}px; }
  .from-margins {
    font-family:'${font_header || 'Cormorant Garamond'}', Georgia, serif;
    font-size:${font_size_header || 11}px; font-weight:300; font-style:italic;
    letter-spacing:0.08em; color:${muted};
  }
  .quote-no {
    font-family:'${font_meta || 'Cormorant Garamond'}', Georgia, serif;
    font-size:${font_size_meta || 10}px; font-weight:300;
    letter-spacing:0.45em; color:${muted};
  }
  .rule { width:100%; height:0.6px; background:${border_color}; opacity:0.4; }
  .quote-area { flex:1; display:flex; align-items:center; justify-content:center; }
  .quote-wrap { width:100%; position:relative; }
  .quote-text {
    font-family:'${font_quote || 'Courier Prime'}', 'Courier New', monospace;
    font-size:${font_size_quote || 16}px; font-style:italic;
    line-height:1.78; letter-spacing:0.01em;
    color:${ink_color}; text-align:left;
    padding:${quotePad}px 0;
  }
  .open-mark, .close-mark {
    position:absolute;
    font-family:'${font_header || 'Cormorant Garamond'}', Georgia, serif;
    font-size:${markSize}px; font-weight:300; line-height:1;
    color:${ink_color}; opacity:0.2;
  }
  .open-mark { top:0; left:-${Math.round(markSize*0.12)}px; transform:translateY(-${Math.round(markSize*0.35)}px); }
  .close-mark { bottom:0; right:-${Math.round(markSize*0.08)}px; transform:translateY(${Math.round(markSize*0.35)}px); }
  .footer { display:flex; align-items:flex-end; justify-content:space-between; padding-top:${Math.round(pad*0.4)}px; }
  .date-rule { width:${Math.round(w*0.055)}px; height:0.6px; background:${border_color}; opacity:0.55; margin-bottom:${Math.round(w*0.008)}px; }
  .date-text {
    font-family:'${font_meta || 'Cormorant Garamond'}', Georgia, serif;
    font-size:${Math.round((font_size_meta||10) * (w/340))}px; font-weight:300;
    letter-spacing:0.2em; color:${muted};
  }
  .watermark {
    font-family:'${font_meta || 'Cormorant Garamond'}', Georgia, serif;
    font-size:${Math.round((font_size_meta||10) * (w/340) * 1.08)}px;
    font-style:italic; font-weight:300;
    letter-spacing:0.12em; color:${ink_color}; opacity:0.2;
  }
</style>
</head>
<body>
<div class="card">
  <div class="noise"></div>
  <div class="vignette"></div>

  <svg class="border-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bord}" y="${bord}" width="${w-bord*2}" height="${h-bord*2}"
      stroke="${border_color}" stroke-width="1" fill="none" opacity="0.5"/>
    <line x1="${bord}" y1="${bord+tick}" x2="${bord}" y2="${bord}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <line x1="${bord}" y1="${bord}" x2="${bord+tick}" y2="${bord}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <circle cx="${bord}" cy="${bord}" r="2.5" fill="${border_color}" opacity="0.65"/>
    <line x1="${w-bord}" y1="${bord}" x2="${w-bord-tick}" y2="${bord}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <line x1="${w-bord}" y1="${bord}" x2="${w-bord}" y2="${bord+tick}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <circle cx="${w-bord}" cy="${bord}" r="2.5" fill="${border_color}" opacity="0.65"/>
    <line x1="${bord}" y1="${h-bord}" x2="${bord+tick}" y2="${h-bord}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <line x1="${bord}" y1="${h-bord}" x2="${bord}" y2="${h-bord-tick}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <circle cx="${bord}" cy="${h-bord}" r="2.5" fill="${border_color}" opacity="0.65"/>
    <line x1="${w-bord}" y1="${h-bord}" x2="${w-bord-tick}" y2="${h-bord}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <line x1="${w-bord}" y1="${h-bord}" x2="${w-bord}" y2="${h-bord-tick}" stroke="${border_color}" stroke-width="1.2" opacity="0.9"/>
    <circle cx="${w-bord}" cy="${h-bord}" r="2.5" fill="${border_color}" opacity="0.65"/>
  </svg>

  <div class="content">
    <div class="header">
      <span class="from-margins">From the Margins</span>
      <span class="quote-no">${num}</span>
    </div>
    <div class="rule"></div>
    <div class="quote-area">
      <div class="quote-wrap">
        <span class="open-mark">\u201C</span>
        <p class="quote-text">${escapeHtml(quote)}</p>
        <span class="close-mark">\u201D</span>
      </div>
    </div>
    <div class="footer">
      <div>
        <div class="date-rule"></div>
        <span class="date-text">${date}</span>
      </div>
      <span class="watermark">The Anvil Speaks</span>
    </div>
  </div>
</div>
</body>
</html>`;
}

function getDimensions(dim) {
  const map = {
    '1:1':  { w:1080, h:1080 },
    '4:5':  { w:1080, h:1350 },
    '9:16': { w:1080, h:1920 },
    '16:9': { w:1920, h:1080 },
  };
  return map[dim] || { w:1080, h:1080 };
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r,g,b];
}
function rgbToHex(r,g,b) {
  return '#'+[r,g,b].map(v=>Math.min(255,Math.max(0,Math.round(v))).toString(16).padStart(2,'0')).join('');
}
function lighten(hex,amt) { const [r,g,b]=hexToRgb(hex); return rgbToHex(r+255*amt,g+255*amt,b+255*amt); }
function darken(hex,amt)  { const [r,g,b]=hexToRgb(hex); return rgbToHex(r-255*amt,g-255*amt,b-255*amt); }
function blendHex(h1,h2,t) {
  const [r1,g1,b1]=hexToRgb(h1); const [r2,g2,b2]=hexToRgb(h2);
  return rgbToHex(r1*(1-t)+r2*t, g1*(1-t)+g2*t, b1*(1-t)+b2*t);
}
