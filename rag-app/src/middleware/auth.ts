import { Request, Response, NextFunction } from 'express';
import { getAdminAuth } from '../db/firestore.js';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Express middleware that verifies a Firebase ID token from the Authorization header.
 * Attaches `req.user` with uid, email, and name if valid.
 * Returns 401 if the token is missing or invalid.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error.message);
    res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
  }
}
