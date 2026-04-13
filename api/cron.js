// api/cron.js
export const config = { runtime: 'edge' };

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const APP_URL      = process.env.APP_URL || 'https://anvil-press.vercel.app';
const CRON_SECRET  = process.env.CRON_SECRET;

export default async function handler(req) {
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const now    = new Date();
  const nowISO = now.toISOString();

  // ── Step 1: Recover stuck rendering posts ──
  // A post is "stuck" if it has been in rendering state for more than 10 minutes.
  // We detect this by checking if scheduled_at was more than 10 min ago AND
  // the post is still rendering (meaning post.js timed out or crashed).
  // Note: we reset ALL rendering posts unconditionally because:
  // - if scheduled_at <= now-10min, it definitely started more than 10min ago
  // - if it's still rendering, something went wrong
  const stuckCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  const { data: stuckPosts } = await db
    .from('anvil_posts')
    .select('id')
    .eq('status', 'rendering')
    .lte('scheduled_at', stuckCutoff);

  const recovered = [];
  if (stuckPosts && stuckPosts.length > 0) {
    for (const p of stuckPosts) {
      const { error } = await db
        .from('anvil_posts')
        .update({
          status: 'pending',
          error_message: 'Auto-recovered: was stuck in rendering for >10 min',
        })
        .eq('id', p.id)
        .eq('status', 'rendering'); // guard: only if still rendering
      if (!error) recovered.push(p.id);
    }
  }

  // ── Step 2: Fetch all pending posts due now ──
  const { data: duePosts, error: fetchErr } = await db
    .from('anvil_posts')
    .select('id, scheduled_at')
    .eq('status', 'pending')
    .lte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true });

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message, recovered }), { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return new Response(JSON.stringify({
      fired: 0,
      message: 'No posts due',
      recovered,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const results = [];

  // ── Step 3: Process sequentially with atomic claim ──
  for (const post of duePosts) {

    // Atomically claim: only succeeds if still 'pending'
    // Prevents double-posting if two cron instances run simultaneously
    const { data: claimed, error: claimErr } = await db
      .from('anvil_posts')
      .update({ status: 'rendering' })
      .eq('id', post.id)
      .eq('status', 'pending')
      .select('id')
      .single();

    if (claimErr || !claimed) {
      results.push({ id: post.id, skipped: true, reason: 'already claimed' });
      continue;
    }

    // Call post.js
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
      } else if (res.status === 202 && json.retry) {
        // Instagram container still processing — post stays in rendering, will retry next run
        results.push({ id: post.id, retry: true, reason: 'container still processing' });
      } else {
        // post.js marked it failed already
        results.push({ id: post.id, success: false, error: json.error || `HTTP ${res.status}` });
      }
    } catch (err) {
      // Network error reaching post.js — mark failed
      await db.from('anvil_posts').update({
        status: 'failed',
        error_message: 'Cron could not reach post.js: ' + err.message,
      }).eq('id', post.id);
      results.push({ id: post.id, success: false, error: err.message });
    }

    // 1 second between posts — avoids Instagram rate limits
    if (duePosts.indexOf(post) < duePosts.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return new Response(JSON.stringify({
    fired:     results.filter(r => r.success).length,
    retrying:  results.filter(r => r.retry).length,
    failed:    results.filter(r => !r.success && !r.retry && !r.skipped).length,
    total:     duePosts.length,
    recovered,
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
