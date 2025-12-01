// js/login.js
// VERSÃO 2.1 (Conexão da Base de Dados Corrigida)

import { 
    auth, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup,
    signOut,
    // v2.1: Importa 'db', 'ref', 'get', 'set' do config
    db, 
    ref, 
    get, 
    set 
} from './firebase-config.js';

// v2.0: 'getDatabase' REMOVIDO daqui

const btnLoginGoogle = document.getElementById('btn-login-google');
const loginError = document.getElementById('login-error');
const loginLoading = document.getElementById('login-loading') || { style: {} };

// 1. Verifica se o usuário JÁ está logado (o onAuthStateChanged do main.js fará o redirect)
onAuthStateChanged(auth, (user) => {
    if (user) {
        showLoading('A verificar permissão...');
        btnLoginGoogle.disabled = true;
    }
});

// 2. Adiciona o listener para o clique no botão
btnLoginGoogle.addEventListener('click', async () => {
    const provider = new GoogleAuthProvider();
    
    showLoading('Abrindo pop-up de login...');
    hideError();

    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;

        if (user) {
            await verificarPermissao(user);
        }
        
    } catch (error) {
        hideLoading();
        if (error.code === 'auth/popup-closed-by-user') {
            showError('Você fechou a janela de login. Tente novamente.');
        } else if (error.code !== 'auth/cancelled-popup-request') {
            console.error("Erro ao fazer login com Google:", error);
            showError(`Erro ao logar: ${error.message}`);
        }
    }
});

/**
 * v2.1: Corrigido para usar o 'db' importado (inicializado)
 */
async function verificarPermissao(user) {
    // const db = getDatabase(); // REMOVIDO (Este era o BUG)
    // 'db' agora vem do 'firebase-config.js'
    const userRef = ref(db, `autorizacoes/${user.uid}`);
    
    try {
        const snapshot = await get(userRef);

        if (snapshot.exists()) {
            const data = snapshot.val();
            
            if (data.status === 'aprovado') {
                showLoading('Permissão concedida. A aceder...');
                window.location.href = 'index.html';
                
            } else if (data.status === 'bloqueado') {
                await signOut(auth);
                showError('A sua conta foi bloqueada. Fale com o administrador.');
                hideLoading();
                
            } else {
                await signOut(auth);
                showError('A sua conta ainda está pendente de aprovação. Por favor, aguarde.');
                hideLoading();
            }

        } else {
            // --- PRIMEIRO LOGIN DO UTILIZADOR ---
            await set(userRef, {
                email: user.email,
                nome: user.displayName,
                status: "pendente",
                dataRegisto: new Date().toISOString() 
            });
            
            await signOut(auth);
            showError('Conta registada! A sua conta precisa de ser aprovada pelo administrador antes de poder aceder.');
            hideLoading();
        }

    } catch (dbError) {
        console.error("Erro ao verificar permissão:", dbError);
        await signOut(auth); 
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
    btnLoginGoogle.style.display = 'block'; 
}

function showError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
}

function hideError() {
    loginError.style.display = 'none';
}