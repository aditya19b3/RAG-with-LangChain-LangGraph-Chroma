// Firebase Auth Configuration & Utilities
// Replace these values with your Firebase project config from the Firebase Console.

// IMPORTANT
// No matter which approach you use,
// the Firebase config will always be visible to the end user —
// it has to be, because the browser needs it to talk to Firebase.
// Moving it to env vars only hides it from your git repo, not from the browser.

const firebaseConfig = {
  apiKey: "AIzaSyCLEpfTJiPlDGWjTaHnLiY6uhzm4cQ_IqI",
  authDomain: "rag-project-29066.firebaseapp.com",
  projectId: "rag-project-29066",
  storageBucket: "rag-project-29066.firebasestorage.app",
  messagingSenderId: "128922456116",
  appId: "1:128922456116:web:922d11258f1f9f97947a61"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// ========================
//  LocalStorage Auth Session
// ========================
const AUTH_STORAGE_KEY = 'rag_auth_user';

/**
 * Saves user info to localStorage after successful sign-in.
 * This enables synchronous auth checks on page load without
 * waiting for Firebase SDK to restore the session from IndexedDB.
 */
function saveAuthSession(user) {
  if (!user) return;
  const session = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    photoURL: user.photoURL || '',
    lastLogin: Date.now(),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

/**
 * Clears the stored auth session from localStorage.
 */
function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Returns the stored user session, or null if not logged in.
 * This is a synchronous check — no async Firebase calls needed.
 */
function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Expire sessions older than 7 days (Firebase tokens refresh, but this
    // ensures stale localStorage entries don't keep users "logged in" forever)
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.lastLogin > SEVEN_DAYS) {
      clearAuthSession();
      return null;
    }
    return session;
  } catch {
    clearAuthSession();
    return null;
  }
}

/**
 * Returns true if user has an active auth session in localStorage.
 */
function isLoggedIn() {
  return getStoredUser() !== null;
}

// ========================
//  Firebase Auth State Listener
// ========================
// Keep localStorage in sync with Firebase auth state.
// When Firebase confirms the user, update the session.
// When Firebase loses the user (sign-out/expired), clear it.
auth.onAuthStateChanged((user) => {
  if (user) {
    saveAuthSession(user);
  } else {
    // Only clear if Firebase has actually initialized and determined no user.
    // On cold page loads, the first callback may fire with null before
    // restoring the session — but we keep localStorage intact so the
    // synchronous isLoggedIn() check works during that window.
    // The subsequent callback with the real user will update it.
    // We rely on explicit signOut() to clear the session (see below).
  }
});

// ========================
//  Auth API Functions
// ========================

/**
 * Returns the current user's ID token for API calls, or null if not signed in.
 */
async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(/* forceRefresh */ false);
  } catch {
    return null;
  }
}

/**
 * Returns auth headers for API fetch requests.
 */
async function getAuthHeaders() {
  const token = await getIdToken();
  if (!token) return {};
  return { 'Authorization': `Bearer ${token}` };
}

/**
 * Sign in with Google popup. Saves session to localStorage on success.
 */
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  const result = await auth.signInWithPopup(provider);
  // Save immediately so redirect on login page works without waiting for onAuthStateChanged
  if (result.user) {
    saveAuthSession(result.user);
  }
  return result;
}

/**
 * Sign out the current user and clear the localStorage session.
 */
async function signOut() {
  clearAuthSession();
  return auth.signOut();
}
