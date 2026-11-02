
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCD2Qk5SfI544QCeP5hZaLblSr_glfDacU",
  authDomain: "usargrup.firebaseapp.com",
  projectId: "usargrup",
  storageBucket: "usargrup.firebasestorage.app",
  messagingSenderId: "908879180287",
  appId: "1:908879180287:web:e3b1e357f88be654c077ca"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
