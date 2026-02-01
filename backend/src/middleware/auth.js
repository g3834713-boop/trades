import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Use Supabase's built-in JWT verification
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.error('Supabase auth error:', error?.message);
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.user = { id: user.id, email: user.email };
    return next();
  } catch (err) {
    console.error('Auth verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireAdmin(req, res, next) {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!req.user || !admins.includes(req.user.email)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}
