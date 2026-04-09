// api/cron.js — Anvil Press scheduler
// Runs every 30 minutes via Vercel Cron
// Checks for posts due in the last 30 min and fires them

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Verify this is called by Vercel Cron
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago

  // Find pending posts due in this window
  const { data: duePosts, error } = await db
    .from('anvil_posts')
    .select('id, quote, scheduled_at')
    .eq('status', 'pending')
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('Cron fetch error:', error);
    return res.status(500).json({ error: error.message });
  }

  if (!duePosts?.length) {
    console.log(`Cron: no posts due at ${now.toISOString()}`);
    return res.status(200).json({ fired: 0 });
  }

  console.log(`Cron: firing ${duePosts.length} post(s)`);

  const results = [];
  for (const post of duePosts) {
    try {
      const response = await fetch(`${process.env.APP_URL}/api/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id }),
      });
      const data = await response.json();
      results.push({ id: post.id, ...data });
    } catch (err) {
      results.push({ id: post.id, error: err.message });
    }
  }

  return res.status(200).json({ fired: results.length, results });
}
