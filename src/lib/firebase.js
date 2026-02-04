// src/lib/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  initializeAuth,
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDTKsCF7EDnQlUfw1i4sMz1YKq30viz-Do",
  authDomain: "my-notes-lahieuphong.firebaseapp.com",
  projectId: "my-notes-lahieuphong",
  storageBucket: "my-notes-lahieuphong.firebasestorage.app",
  messagingSenderId: "714744608587",
  appId: "1:714744608587:web:330b6994a5750272521ace",
  measurementId: "G-SDHCXVXED7"
};

const app = initializeApp(firebaseConfig);

// Try browser persistence first (IndexedDB-backed), fallback to in-memory if init fails.
let auth;
try {
  auth = initializeAuth(app, { persistence: browserLocalPersistence });
  console.log('Firebase Auth: initialized with browserLocalPersistence');
} catch (err) {
  console.warn('Firebase Auth: browserLocalPersistence init failed, falling back to inMemoryPersistence', err);
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    console.log('Firebase Auth: initialized with inMemoryPersistence (fallback)');
  } catch (err2) {
    console.error('Firebase Auth: fallback init also failed — using getAuth()', err2);
    auth = getAuth(app);
  }
}

export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export { auth, app as default };

// Debug helper (remove if you want)
if (typeof window !== 'undefined') {
  window.__MYNOTES_FB = { app, auth, db, provider };
  console.log('DEBUG: window.__MYNOTES_FB available');
}
