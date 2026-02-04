import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
