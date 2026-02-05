// src/lib/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTKsCF7EDnQlUfw1i4sMz1YKq30viz-Do",
  authDomain: "my-notes-lahieuphong.firebaseapp.com",
  projectId: "my-notes-lahieuphong",
  storageBucket: "my-notes-lahieuphong.appspot.com",
  messagingSenderId: "714744608587",
  appId: "1:714744608587:web:330b6994a5750272521ace",
  measurementId: "G-SDHCXVXED7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

// Single auth instance used across the app
export const auth = getAuth(app);

// persistence status for debugging: 'local' | 'session' | 'memory' | 'none'
let _persistenceStatus = 'unknown';

(async () => {
  // Try local first, then session, then in-memory
  try {
    await setPersistence(auth, browserLocalPersistence);
    _persistenceStatus = 'local';
    console.log('Auth persistence: browserLocalPersistence');
  } catch (errLocal) {
    console.warn('setPersistence(browserLocalPersistence) failed:', errLocal);

    try {
      await setPersistence(auth, browserSessionPersistence);
      _persistenceStatus = 'session';
      console.log('Auth persistence: browserSessionPersistence (fallback)');
    } catch (errSession) {
      console.warn('setPersistence(browserSessionPersistence) failed:', errSession);

      try {
        await setPersistence(auth, inMemoryPersistence);
        _persistenceStatus = 'memory';
        console.log('Auth persistence: inMemoryPersistence (final fallback)');
      } catch (errMemory) {
        _persistenceStatus = 'none';
        console.error('All persistence attempts failed', errMemory);
      }
    }
  } finally {
    // expose for debug (remove in production if you want)
    if (typeof window !== 'undefined') {
      window.__MYNOTES_FB = window.__MYNOTES_FB || {};
      window.__MYNOTES_FB.persistence = _persistenceStatus;
      window.__MYNOTES_FB.app = app;
      window.__MYNOTES_FB.auth = auth;
      window.__MYNOTES_FB.db = db;
      window.__MYNOTES_FB.provider = provider;
      console.log('DEBUG: window.__MYNOTES_FB available', window.__MYNOTES_FB.persistence);
    }
  }
})();

export default app;