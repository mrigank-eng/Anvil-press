// api/post.js
export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const IG_ID    = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

// Poll max 6 times x 3s = 18s — stays under Vercel 25s edge limit
async function waitForContainer(containerId) {
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res  = await fetch(
      `https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${IG_TOKEN}`
    );
    const data = await res.json();
    if (data.status_code === 'FINISHED') return true;
    if (data.status_code === 'ERROR') throw new Error('Instagram container failed: ' + JSON.stringify(data));
  }
  // Did not finish in time — return false instead of throwing
  // The post stays in rendering and cron will retry it
  return false;
}

async function postToInstagram(imageUrl, caption) {
  // Step 1: Create media container
  const containerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption || '',
      access_token: IG_TOKEN,
    }),
  });
  const container = await containerRes.json();
  if (container.error) throw new Error(`Container error: ${container.error.message}`);
  if (!container.id) throw new Error(`No container ID returned: ${JSON.stringify(container)}`);

  // Step 2: Wait for Instagram to process
  const finished = await waitForContainer(container.id);
  if (!finished) {
    // Store container ID so next retry can publish directly without re-uploading
    throw new Error(`CONTAINER_PENDING:${container.id}`);
  }

  // Step 3: Publish
  const publishRes = await fetch(`https://graph.facebook.com/v25.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: container.id,
      access_token: IG_TOKEN,
    }),
  });
  const published = await publishRes.json();
  if (published.error) throw new Error(`Publish error: ${published.error.message}`);
  if (!published.id) throw new Error(`No post ID returned: ${JSON.stringify(published)}`);
  return published.id;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  let post_id;
  try {
    const body = await req.json();
    post_id = body.post_id;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!post_id) return new Response(JSON.stringify({ error: 'post_id required' }), {
    status: 400, headers: { 'Content-Type': 'application/json' }
  });

  const { data: post, error: fetchErr } = await db
    .from('anvil_posts').select('*').eq('id', post_id).single();

  if (fetchErr || !post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Accept pending or rendering
  if (post.status !== 'pending' && post.status !== 'rendering') {
    return new Response(JSON.stringify({ error: `Post is ${post.status} — skipping` }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!post.image_url) {
    await db.from('anvil_posts').update({
      status: 'failed',
      error_message: 'No image URL on this post',
    }).eq('id', post_id);
    return new Response(JSON.stringify({ error: 'No image URL' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Mark rendering
  await db.from('anvil_posts').update({ status: 'rendering' }).eq('id', post_id);

  try {
    const igPostId = await postToInstagram(
      post.image_url,
      post.caption || post.quote || ''
    );

    await db.from('anvil_posts').update({
      status: 'posted',
      instagram_post_id: igPostId,
      posted_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', post_id);

    return new Response(JSON.stringify({ success: true, instagram_post_id: igPostId }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    const msg = err.message || '';

    // CONTAINER_PENDING means Instagram is still processing — leave in rendering
    // Cron will retry after 10 min
    if (msg.startsWith('CONTAINER_PENDING:')) {
      const containerId = msg.split(':')[1];
      await db.from('anvil_posts').update({
        error_message: `Container still processing (${containerId}) — will retry`,
      }).eq('id', post_id);
      return new Response(JSON.stringify({ retry: true, containerId }), {
        status: 202, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Real failure — mark as failed
    await db.from('anvil_posts').update({
      status: 'failed',
      error_message: msg,
    }).eq('id', post_id);

    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
