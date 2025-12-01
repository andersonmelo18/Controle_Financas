// js/firebase-config.js
// VERSÃO 2.1 (com Auth Completo e Storage)

// Importa as funções do SDK v9 modular (usando URLs)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { 
    getDatabase, 
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    child, 
    off,
    query,
    orderByChild,
    limitToLast,
    update // Realtime Database functions
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";
import { 
    getAuth, 
    onAuthStateChanged,
    // v2.1: Funções necessárias para o login com Google e validação
    GoogleAuthProvider, 
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { // Firebase Storage Functions
    getStorage,
    ref as storageRef, // Renomeado para evitar conflito com 'ref' do Database
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-storage.js";

// Sua configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBXCMMXEM-e_BNftJNcm6XeEGZ7KYPUiAY",
    authDomain: "controle-financeiro-b7880.firebaseapp.com",
    databaseURL: "https://controle-financeiro-b7880-default-rtdb.firebaseio.com",
    projectId: "controle-financeiro-b7880",
    storageBucket: "controle-financeiro-b7880.firebasestorage.app",
    messagingSenderId: "149823899793",
    appId: "1:149823899793:web:0fcdcd8ece6748697e9730",
    measurementId: "G-SVDY4LSXDK"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);

// Obtém as instâncias dos serviços
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app); // Inicializa o Storage

// Exporta as funções e instâncias para serem usadas em outros scripts
export { 
    db, 
    auth, 
    storage, // Exportando Storage
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    child,
    off,
    query,
    orderByChild,
    limitToLast,
    update, 
    onAuthStateChanged,
    
    // v2.1: Exporta as funções corretas do Auth
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    
    // Exportando funções do Storage
    storageRef, 
    uploadBytes, 
    getDownloadURL,
    deleteObject
};