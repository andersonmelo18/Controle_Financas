// js/login.js
// Controla a lógica da página de login

import { 
    auth, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup 
} from './firebase-config.js';

const btnLoginGoogle = document.getElementById('btn-login-google');
const loginError = document.getElementById('login-error');

// 1. Verifica se o usuário JÁ está logado
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Se já está logado, redireciona para o painel principal
        window.location.href = 'index.html';
    }
    // Se for nulo, permanece na página de login
});

// 2. Adiciona o listener para o clique no botão
btnLoginGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    
    try {
        // 3. Mostra o Pop-up de login do Google
        await signInWithPopup(auth, provider);
        
        // 4. Sucesso! O onAuthStateChanged acima vai detetar
        // e redirecionar para o index.html
        
    } catch (error) {
        // 5. Trata erros
        console.error("Erro ao fazer login com Google:", error);
        loginError.textContent = `Erro ao fazer login: ${error.message}`;
        loginError.style.display = 'block';
    }
});