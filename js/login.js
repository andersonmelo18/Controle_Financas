// js/login.js
// VERSÃO 2.0 (com Verificação de Permissão)

import { 
    auth, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup,
    signOut // v2.0: Importa o signOut
} from './firebase-config.js';

// v2.0: Importa funções da Base de Dados
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-database.js";

const btnLoginGoogle = document.getElementById('btn-login-google');
const loginError = document.getElementById('login-error');
// v2.0: Presume que existe um elemento de loading no seu login.html
const loginLoading = document.getElementById('login-loading') || { style: {} }; // Fallback

// 1. Verifica se o usuário JÁ está logado (o onAuthStateChanged do main.js fará o redirect)
onAuthStateChanged(auth, (user) => {
    if (user) {
        // Não redireciona daqui, o main.js (v5.0) vai tratar disso
        // após verificar a permissão.
        showLoading('A verificar permissão...');
        btnLoginGoogle.disabled = true;
    }
    // Se for nulo, permanece na página de login
});

// 2. Adiciona o listener para o clique no botão
btnLoginGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    
    showLoading('Abrindo pop-up de login...');
    hideError();

    try {
        // 3. Mostra o Pop-up de login do Google
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        if (user) {
            // 4. v2.0: VERIFICA A PERMISSÃO
            await verificarPermissao(user);
        }
        
    } catch (error) {
        // 5. Trata erros
        hideLoading();
        if (error.code === 'auth/popup-closed-by-user') {
            showError('Você fechou a janela de login. Tente novamente.');
        } else if (error.code === 'auth/cancelled-popup-request') {
             // Não mostra erro
        } else {
            console.error("Erro ao fazer login com Google:", error);
            showError(`Erro ao logar: ${error.message}`);
        }
    }
});

/**
 * v2.0: Nova função que verifica a permissão na base de dados
 */
async function verificarPermissao(user) {
    const db = getDatabase();
    const userRef = ref(db, `autorizacoes/${user.uid}`);
    
    try {
        const snapshot = await get(userRef);

        if (snapshot.exists()) {
            // --- UTILIZADOR JÁ EXISTE NA LISTA ---
            const data = snapshot.val();
            
            if (data.status === 'aprovado') {
                // APROVADO: Redireciona para o painel
                showLoading('Permissão concedida. A aceder...');
                window.location.href = 'index.html';
                
            } else if (data.status === 'bloqueado') {
                // BLOQUEADO: Desloga e mostra erro
                await signOut(auth);
                showError('A sua conta foi bloqueada. Fale com o administrador.');
                hideLoading();
                
            } else {
                // PENDENTE: Desloga e mostra aviso
                await signOut(auth);
                showError('A sua conta ainda está pendente de aprovação. Por favor, aguarde.');
                hideLoading();
            }

        } else {
            // --- PRIMEIRO LOGIN DO UTILIZADOR ---
            // Regista-o como "pendente" para o admin poder aprovar
            await set(userRef, {
                email: user.email,
                nome: user.displayName,
                status: "pendente",
                dataRegisto: new Date().toISOString() // Adiciona data de registo
            });
            
            // Desloga e avisa
            await signOut(auth);
            showError('Conta registada! A sua conta precisa de ser aprovada pelo administrador antes de poder aceder.');
            hideLoading();
        }

    } catch (dbError) {
        // Erro ao ler a base de dados
        console.error("Erro ao verificar permissão:", dbError);
        await signOut(auth); // Desloga por segurança
        showError('Erro ao verificar a sua permissão. Tente novamente.');
        hideLoading();
    }
}


// Funções de UI
function showLoading(message) {
    loginLoading.textContent = message;
    loginLoading.style.display = 'block';
    btnLoginGoogle.style.display = 'none';
    hideError();
}

function hideLoading() {
    loginLoading.style.display = 'none';
    btnLoginGoogle.style.display = 'block'; // Mostra o botão de login
}

function showError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
}

function hideError() {
    loginError.style.display = 'none';
}