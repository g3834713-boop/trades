import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
    req.user = { id: decoded.sub, email: decoded.email };
    return next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    console.error('Token (first 20 chars):', token.substring(0, 20));
    console.error('Secret exists:', !!process.env.SUPABASE_JWT_SECRET);
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
