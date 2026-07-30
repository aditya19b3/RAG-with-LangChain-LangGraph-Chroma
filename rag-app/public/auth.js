// Firebase Auth Configuration & Utilities
// Replace these values with your Firebase project config from the Firebase Console.

const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

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
 * Sign in with Google popup.
 */
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  return auth.signInWithPopup(provider);
}

/**
 * Sign out the current user.
 */
async function signOut() {
  return auth.signOut();
}

/**
 * Redirects to login page if no user is authenticated.
 * Call this on pages that require authentication.
 */
function requireLogin() {
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = '/public/login.html';
    }
  });
}
