// api/post.js
// Simplified pipeline — image already uploaded, just post to Instagram
export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const IG_ID    = process.env.INSTAGRAM_ACCOUNT_ID;
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

async function waitForContainer(containerId) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res  = await fetch(`https://graph.facebook.com/v25.0/${containerId}?fields=status_code&access_token=${IG_TOKEN}`);
    const data = await res.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') throw new Error('Instagram container failed to process');
  }
  throw new Error('Instagram container timed out');
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

  // Step 2: Wait for processing
  await waitForContainer(container.id);

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

  // Fetch post
  const { data: post, error: fetchErr } = await db
    .from('anvil_posts').select('*').eq('id', post_id).single();

  if (fetchErr || !post) return new Response(JSON.stringify({ error: 'Post not found' }), {
    status: 404, headers: { 'Content-Type': 'application/json' }
  });

  if (post.status !== 'pending') return new Response(JSON.stringify({ error: `Post is ${post.status}` }), {
    status: 400, headers: { 'Content-Type': 'application/json' }
  });

  if (!post.image_url) return new Response(JSON.stringify({ error: 'No image URL on this post' }), {
    status: 400, headers: { 'Content-Type': 'application/json' }
  });

  // Mark as rendering
  await db.from('anvil_posts').update({ status: 'rendering' }).eq('id', post_id);

  try {
    const igPostId = await postToInstagram(post.image_url, post.caption || post.quote || '');

    await db.from('anvil_posts').update({
      status: 'posted',
      instagram_post_id: igPostId,
      posted_at: new Date().toISOString(),
    }).eq('id', post_id);

    return new Response(JSON.stringify({ success: true, instagram_post_id: igPostId }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    await db.from('anvil_posts').update({
      status: 'failed',
      error_message: err.message,
    }).eq('id', post_id);

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
