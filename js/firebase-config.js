import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";




const firebaseConfig = {
  apiKey: "AIzaSyCXCk41WyhTq2tq2AgRfxKT-rrpolaGWoA",
  authDomain: "macgyferre-pos.firebaseapp.com",
  databaseURL: "https://macgyferre-pos-default-rtdb.firebaseio.com",
  projectId: "macgyferre-pos",
  storageBucket: "macgyferre-pos.firebasestorage.app",
  messagingSenderId: "995241054253",
  appId: "1:995241054253:web:488a1ca4579e7b2e5428a4",
  measurementId: "G-9NT2WQKSX"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);