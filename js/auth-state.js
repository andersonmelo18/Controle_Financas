/* js/auth-state.js */

document.addEventListener("DOMContentLoaded", () => {
    // Verifica se o Firebase carregou (segurança para redes lentas)
    const checkFirebase = setInterval(() => {
        if (typeof firebase !== 'undefined' && firebase.auth) {
            clearInterval(checkFirebase);
            iniciarAuth();
        }
    }, 100);

    function iniciarAuth() {
        const auth = firebase.auth();
        const botaoMenu = document.getElementById('logout-button');

        // Monitora o estado da autenticação em tempo real
        auth.onAuthStateChanged((user) => {
            if (user) {
                // --- USUÁRIO LOGADO (Cenário: SAIR) ---
                console.log("Usuário logado:", user.email);

                if (botaoMenu) {
                    // Muda o texto e ícone para SAIR
                    botaoMenu.innerHTML = '<span class="material-icons-sharp">logout</span>Sair';
                    botaoMenu.href = "#"; // Evita link normal
                    
                    // Adiciona evento de Logout
                    botaoMenu.onclick = (e) => {
                        e.preventDefault();
                        auth.signOut().then(() => {
                            // Após sair, o onAuthStateChanged vai rodar de novo e cair no 'else' abaixo
                            window.location.href = "login.html";
                        }).catch(err => console.error("Erro ao sair", err));
                    };
                }

            } else {
                // --- SEM USUÁRIO (Cenário: LOGIN) ---
                console.log("Nenhum usuário logado.");

                if (botaoMenu) {
                    // Muda o texto e ícone para LOGIN
                    botaoMenu.innerHTML = '<span class="material-icons-sharp">login</span>Login';
                    botaoMenu.href = "login.html"; // Vira um link normal para a tela de login
                    botaoMenu.onclick = null; // Remove o evento de logout
                }

                // SEGURANÇA: Se estivermos no Painel (index.html), forçamos a ida ao login
                // (Comente a linha abaixo se quiser permitir visitar o painel deslogado)
                if (window.location.pathname.includes('index.html') || window.location.pathname === '/' ) {
                    window.location.href = "login.html";
                }
            }
        });
    }
});