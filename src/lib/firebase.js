// src/lib/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
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

// Single auth instance for the whole app
export const auth = getAuth(app);

// Try to set browser persistence; fallback to inMemory if fails
(async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    console.log('Auth persistence: browserLocalPersistence');
  } catch (err) {
    console.warn('setPersistence(browserLocalPersistence) failed, falling back to inMemoryPersistence', err);
    try {
      await setPersistence(auth, inMemoryPersistence);
      console.log('Auth persistence: inMemoryPersistence (fallback)');
    } catch (err2) {
      console.error('Both persistence attempts failed', err2);
      // still export auth (will work without persistence)
    }
  }
})();

export default app;

// debug helper (xóa khi production)
if (typeof window !== 'undefined') {
  window.__MYNOTES_FB = { app, auth, db, provider };
  console.log('DEBUG: window.__MYNOTES_FB available');
}
