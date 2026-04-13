// api/cron.js
export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const APP_URL     = process.env.APP_URL || 'https://anvil-press.vercel.app';
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now = new Date();
  const nowISO = now.toISOString();

  // ── Step 1: Recover stuck rendering posts ──
  // Any post in 'rendering' for more than 10 minutes is considered abandoned.
  // Reset it to 'pending' so it gets retried this run.
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const { data: stuckPosts } = await db
    .from('anvil_posts')
    .select('id, scheduled_at')
    .eq('status', 'rendering')
    .lt('scheduled_at', stuckCutoff); // scheduled more than 10 min ago

  const recovered = [];
  if (stuckPosts && stuckPosts.length > 0) {
    for (const p of stuckPosts) {
      await db.from('anvil_posts').update({
        status: 'pending',
        error_message: 'Auto-recovered from stuck rendering state',
      }).eq('id', p.id).eq('status', 'rendering');
      recovered.push(p.id);
    }
  }

  // ── Step 2: Fetch all pending posts due now ──
  const { data: duePosts, error } = await db
    .from('anvil_posts')
    .select('id, scheduled_at, status')
    .eq('status', 'pending')
    .lte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ error: error.message, recovered }), { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return new Response(JSON.stringify({
      fired: 0,
      message: 'No posts due',
      recovered,
    }), { status: 200 });
  }

  const results = [];

  // ── Step 3: Process sequentially with atomic claim ──
  for (const post of duePosts) {

    // Claim atomically — only update if still 'pending'
    const { data: claimed, error: claimErr } = await db
      .from('anvil_posts')
      .update({ status: 'rendering' })
      .eq('id', post.id)
      .eq('status', 'pending')
      .select('id')
      .single();

    if (claimErr || !claimed) {
      results.push({ id: post.id, skipped: true, reason: 'already claimed by another run' });
      continue;
    }

    // Fire the post
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
        // post.js handles marking as failed — just record it
        results.push({ id: post.id, success: false, error: json.error || `HTTP ${res.status}` });
      }
    } catch (err) {
      // Network error calling post.js — mark failed ourselves
      await db.from('anvil_posts').update({
        status: 'failed',
        error_message: 'Cron network error: ' + err.message,
      }).eq('id', post.id);
      results.push({ id: post.id, success: false, error: err.message });
    }

    // 1 second gap between posts
    await new Promise(r => setTimeout(r, 1000));
  }

  return new Response(JSON.stringify({
    fired: results.filter(r => r.success).length,
    total: duePosts.length,
    recovered,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
