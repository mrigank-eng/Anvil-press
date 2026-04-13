// api/cron.js
// Processes due posts SEQUENTIALLY to prevent race conditions
export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const APP_URL    = process.env.APP_URL || 'https://anvil-press.vercel.app';
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req) {
  // Auth check
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = new Date().toISOString();

  // Fetch all posts due now that are still pending
  // Only pick up posts where scheduled_at <= now AND status is strictly 'pending'
  const { data: duePosts, error } = await db
    .from('anvil_posts')
    .select('id, scheduled_at, status')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return new Response(JSON.stringify({ fired: 0, message: 'No posts due' }), { status: 200 });
  }

  const results = [];

  // ── SEQUENTIAL processing ──
  // Process one post at a time. Each post is marked 'rendering' before
  // the API call so concurrent cron runs cannot pick up the same post.
  for (const post of duePosts) {

    // Atomically claim the post by updating status to 'rendering'
    // Only succeeds if status is still 'pending' — prevents double-posting
    const { data: claimed, error: claimErr } = await db
      .from('anvil_posts')
      .update({ status: 'rendering' })
      .eq('id', post.id)
      .eq('status', 'pending')  // guard: only update if still pending
      .select('id')
      .single();

    if (claimErr || !claimed) {
      // Another cron instance already claimed this post — skip it
      results.push({ id: post.id, skipped: true, reason: 'already claimed' });
      continue;
    }

    // Now fire the post
    try {
      const res = await fetch(`${APP_URL}/api/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({ post_id: post.id }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok && json.success) {
        results.push({ id: post.id, success: true, instagram_post_id: json.instagram_post_id });
      } else {
        results.push({ id: post.id, success: false, error: json.error || 'Unknown error' });
      }
    } catch (err) {
      // Network or fetch error — mark as failed
      await db.from('anvil_posts').update({
        status: 'failed',
        error_message: 'Cron fetch error: ' + err.message,
      }).eq('id', post.id);
      results.push({ id: post.id, success: false, error: err.message });
    }

    // Small delay between posts to avoid Instagram rate limits
    await new Promise(r => setTimeout(r, 1000));
  }

  return new Response(JSON.stringify({
    fired: results.filter(r => r.success).length,
    total: duePosts.length,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
