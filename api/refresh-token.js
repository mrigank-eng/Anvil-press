// api/refresh-token.js
// Call this monthly to refresh the long-lived token before it expires
// Can be triggered manually or via a monthly cron

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const response = await fetch(
    `https://graph.facebook.com/v25.0/oauth/access_token` +
    `?grant_type=ig_refresh_token` +
    `&access_token=${process.env.INSTAGRAM_ACCESS_TOKEN}`
  );

  const data = await response.json();

  if (data.error) {
    return res.status(500).json({ error: data.error.message });
  }

  // Log the new token — you'll need to update your env var manually
  // In a future version this can auto-update via Vercel API
  console.log('New token:', data.access_token);
  console.log('Expires in:', data.expires_in, 'seconds');

  return res.status(200).json({
    message: 'Token refreshed — update INSTAGRAM_ACCESS_TOKEN in Vercel env vars',
    expires_in_days: Math.floor(data.expires_in / 86400),
    new_token: data.access_token,
  });
}
