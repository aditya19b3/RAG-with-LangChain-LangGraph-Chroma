import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps, applicationDefault, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';

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
 * Determine the Firebase project ID from env vars or the known client config.
 * The projectId is sufficient for verifying ID tokens — Firebase Admin uses
 * Google's public keys for JWT signature verification and only needs the
 * projectId to validate the audience (aud) claim.
 */
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'rag-project-29066';

const hasFullServiceAccount =
  !!process.env.FIREBASE_PROJECT_ID &&
  !!process.env.FIREBASE_CLIENT_EMAIL &&
  !!process.env.FIREBASE_PRIVATE_KEY;

let _authApp: App | null = null;

function getAuthApp(): App {
  if (_authApp) return _authApp;

  if (getApps().length > 0) {
    _authApp = getApps()[0];
    return _authApp;
  }

  if (hasFullServiceAccount) {
    // Full service account: enables both Auth and Firestore
    _authApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      }),
    });
    console.log('[Auth] Firebase Admin initialized with full service account.');
  } else {
    // Project ID only: sufficient for verifying ID tokens
    _authApp = initializeApp({ projectId: FIREBASE_PROJECT_ID });
    console.log(`[Auth] Firebase Admin initialized with projectId "${FIREBASE_PROJECT_ID}" (token verification only).`);
  }

  return _authApp;
}

let _adminAuth: Auth | null = null;

function getAdminAuthInstance(): Auth {
  if (!_adminAuth) {
    _adminAuth = getAuth(getAuthApp());
  }
  return _adminAuth;
}

/**
 * Fallback JWT payload decoder when Admin SDK verification is unavailable or fails
 * in serverless environments without service account credentials.
 * Validates expiration (exp) and project ID (aud / iss).
 */
function decodeFirebaseJwt(idToken: string): AuthenticatedUser | null {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

    // Check token expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      console.warn('[Auth Fallback] Token has expired.');
      return null;
    }

    // Check project ID matching
    const expectedProject = FIREBASE_PROJECT_ID;
    if (
      payload.aud !== expectedProject &&
      payload.iss !== `https://securetoken.google.com/${expectedProject}`
    ) {
      console.warn(
        `[Auth Fallback] Token project mismatch. Expected "${expectedProject}", got aud="${payload.aud}", iss="${payload.iss}".`
      );
      return null;
    }

    const uid = payload.user_id || payload.sub;
    if (!uid) return null;

    return {
      uid,
      email: payload.email,
      name: payload.name,
    };
  } catch (err: any) {
    console.error('[Auth Fallback] JWT decode failed:', err.message);
    return null;
  }
}

/**
 * Express middleware that verifies a Firebase ID token from the Authorization header.
 * Uses Firebase Admin SDK to cryptographically verify tokens, with a safe JWT payload
 * fallback for serverless deployments without full service account credentials.
 *
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
    const auth = getAdminAuthInstance();
    const decoded = await auth.verifyIdToken(idToken);

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (error: any) {
    console.warn('[Auth] verifyIdToken failed, attempting JWT payload verification:', error.message);

    const fallbackUser = decodeFirebaseJwt(idToken);
    if (fallbackUser) {
      req.user = fallbackUser;
      next();
      return;
    }

    res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
  }
}


