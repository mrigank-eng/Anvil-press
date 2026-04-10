// api/post.js
import { createClient } from '@supabase/supabase-js';
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const IG_ID    = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

function getDimensions(dim) {
  return ({ '1:1':{w:1080,h:1080}, '4:5':{w:1080,h:1350}, '9:16':{w:1080,h:1920}, '16:9':{w:1920,h:1080} })[dim] || {w:1080,h:1080};
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

async function renderCard(post) {
  const {
    quote, bg_color, border_color, ink_color,
    font_size_quote, post_number, scheduled_at, dimension
  } = post;

  const { w, h } = getDimensions(dimension);
  const date  = new Date(scheduled_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const num   = String(post_number || 1).padStart(3, '0');
  const pad   = Math.round(w * 0.07);
  const bord  = Math.round(w * 0.035);
  const tick  = Math.round(bord * 0.7);
  const mSize = Math.round(w * 0.115);
  const qPad  = Math.round(mSize * 0.8);
  const bg    = bg_color || '#2e4a6a';
  const bc    = border_color || '#8aacbf';
  const ink   = ink_color || '#e8e4dc';
  const sq    = Math.round((font_size_quote || 16) * (w / 340));
  const sh    = Math.round(11 * (w / 340));
  const sm    = Math.round(10 * (w / 340));
  const muted = blendHex(ink, bg, 0.45);

  // Fetch fonts
  const [cormorantItalic, courierItalic] = await Promise.all([
    fetch('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&display=swap')
      .then(r => r.text())
      .then(css => css.match(/src: url\((.+?)\) format/)?.[1])
      .then(url => fetch(url).then(r => r.arrayBuffer())),
    fetch('https://fonts.googleapis.com/css2?family=Courier+Prime:ital@1&display=swap')
      .then(r => r.text())
      .then(css => css.match(/src: url\((.+?)\) format/)?.[1])
      .then(url => fetch(url).then(r => r.arrayBuffer())),
  ]);

  const imageResponse = new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: w, height: h,
          display: 'flex',
          flexDirection: 'column',
          background: `radial-gradient(ellipse at 28% 22%, ${lighten(bg,0.12)} 0%, transparent 52%), radial-gradient(ellipse at 72% 78%, ${darken(bg,0.08)} 0%, transparent 52%), ${bg}`,
          padding: `${pad}px`,
          position: 'relative',
        },
        children: [
          // Border corners
          { type:'div', props:{ style:{ position:'absolute', top:bord, left:bord, width:tick, height:2, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', top:bord, left:bord, width:2, height:tick, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', top:bord, right:bord, width:tick, height:2, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', top:bord, right:bord, width:2, height:tick, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', bottom:bord, left:bord, width:tick, height:2, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', bottom:bord, left:bord, width:2, height:tick, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', bottom:bord, right:bord, width:tick, height:2, background:bc } } },
          { type:'div', props:{ style:{ position:'absolute', bottom:bord, right:bord, width:2, height:tick, background:bc } } },
          // Border rect
          { type:'div', props:{ style:{ position:'absolute', top:bord, left:bord, right:bord, bottom:bord, border:`1px solid ${bc}`, opacity:0.5 } } },

          // Header
          {
            type: 'div',
            props: {
              style: { display:'flex', flexDirection:'row', justifyContent:'space-between', alignItems:'baseline', marginBottom: Math.round(pad*0.3) },
              children: [
                { type:'span', props:{ style:{ fontFamily:'Cormorant', fontSize:sh, fontStyle:'italic', color:muted, letterSpacing:'0.08em' }, children:'From the Margins' } },
                { type:'span', props:{ style:{ fontFamily:'Cormorant', fontSize:sm, color:muted, letterSpacing:'0.4em' }, children:num } },
              ]
            }
          },

          // Rule
          { type:'div', props:{ style:{ width:'100%', height:1, background:bc, opacity:0.4 } } },

          // Quote area
          {
            type: 'div',
            props: {
              style: { flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'flex-start' },
              children: [
                { type:'div', props:{ style:{ fontFamily:'Cormorant', fontSize:mSize, color:ink, opacity:0.2, marginBottom: Math.round(qPad*0.3), marginLeft:-Math.round(mSize*0.08) }, children:'\u201C' } },
                { type:'div', props:{ style:{ fontFamily:'Courier', fontSize:sq, fontStyle:'italic', lineHeight:1.78, color:ink, textAlign:'left', width:'100%' }, children: quote } },
                { type:'div', props:{ style:{ fontFamily:'Cormorant', fontSize:mSize, color:ink, opacity:0.2, marginTop: Math.round(qPad*0.3), alignSelf:'flex-end', marginRight:-Math.round(mSize*0.08) }, children:'\u201D' } },
              ]
            }
          },

          // Footer
          {
            type: 'div',
            props: {
              style: { display:'flex', flexDirection:'row', justifyContent:'space-between', alignItems:'flex-end', paddingTop: Math.round(pad*0.4) },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { display:'flex', flexDirection:'column' },
                    children: [
                      { type:'div', props:{ style:{ width: Math.round(w*0.055), height:1, background:bc, opacity:0.55, marginBottom: Math.round(w*0.008) } } },
                      { type:'span', props:{ style:{ fontFamily:'Cormorant', fontSize:sm, color:muted, letterSpacing:'0.2em' }, children: date } },
                    ]
                  }
                },
                { type:'span', props:{ style:{ fontFamily:'Cormorant', fontSize: Math.round(sm*1.08), fontStyle:'italic', color:ink, opacity:0.2, letterSpacing:'0.12em' }, children:'The Anvil Speaks' } },
              ]
            }
          },
        ]
      }
    },
    {
      width: w,
      height: h,
      fonts: [
        { name:'Cormorant', data: cormorantItalic, weight:300, style:'italic' },
        { name:'Courier',   data: courierItalic,   weight:400, style:'italic' },
      ],
    }
  );

  const buffer = Buffer.from(await imageResponse.arrayBuffer());

  // Upload to Supabase Storage
  const fileName = `cards/${post.id}.png`;
  const { error: uploadErr } = await db.storage
    .from('anvil-cards')
    .upload(fileName, buffer, { contentType: 'image/png', upsert: true });
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { data: { publicUrl } } = db.storage.from('anvil-cards').getPublicUrl(fileName);
  return publicUrl;
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

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const { post_id } = await req.json();
  if (!post_id) return new Response(JSON.stringify({ error: 'post_id required' }), { status: 400 });

  const { data: post, error: fetchErr } = await db
    .from('anvil_posts').select('*').eq('id', post_id).single();

  if (fetchErr || !post) return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404 });
  if (post.status !== 'pending') return new Response(JSON.stringify({ error: `Post is ${post.status}` }), { status: 400 });

  await db.from('anvil_posts').update({ status: 'rendering' }).eq('id', post_id);

  try {
    const imageUrl = await renderCard(post);
    const igPostId = await postToInstagram(post, imageUrl);
    await db.from('anvil_posts').update({
      status: 'posted',
      instagram_post_id: igPostId,
      posted_at: new Date().toISOString(),
    }).eq('id', post_id);
    return new Response(JSON.stringify({ success: true, instagram_post_id: igPostId }), { status: 200 });
  } catch (err) {
    await db.from('anvil_posts').update({
      status: 'failed',
      error_message: err.message,
    }).eq('id', post_id);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
