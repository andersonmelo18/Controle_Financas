// js/main.js
// VERSÃO 5.1 (Auth Guard, Logout, Caminho 'usuarios/' e Mostra Utilizador)

import { 
    db, 
    auth, 
    ref, 
    set, 
    get, 
    onAuthStateChanged,
    onValue,
    off,
    signOut // IMPORTA O signOut
} from './firebase-config.js';

// v5.1: NÃO importa mais o 'getDatabase' daqui, usa o 'db' do config

let currentUserId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');

// ---- ELEMENTOS DOM GLOBAIS ----
const monthDisplay = document.getElementById('current-month-display');
const prevMonthBtn = document.getElementById('prev-month');
const nextMonthBtn = document.getElementById('next-month');
const themeToggler = document.querySelector('.theme-toggler');
const logoutButton = document.getElementById('logout-button'); 

// ---- ELEMENTOS DE NOTIFICAÇÃO ----
const notificationButton = document.getElementById('notification-button');
const notificationCount = document.getElementById('notification-count');
const notificationDropdown = document.getElementById('notification-dropdown');
const notificationList = document.getElementById('notification-list');
const notificationPlaceholder = document.getElementById('notification-placeholder');

// ---- VARIÁVEIS GLOBAIS (Notificações) ----
let globalAlertListeners = []; 
let globalAlertData = {
    fixos: {},
    pendencias: {},
    cartoes: {},
    pagamentosFatura: [],
    despesasAtual: {} // Adicionado para a correção do v4.0
};


// ===============================================================
// LÓGICA DE AUTENTICAÇÃO (v5.1 - "AUTH GUARD" ATUALIZADO E CORRIGIDO)
// ===============================================================
onAuthStateChanged(auth, async (user) => {
    // Verifica se estamos na página de login para evitar loops
    const isLoginPage = window.location.pathname.endsWith('login.html');

    if (user) {
        // --- 1. Utilizador está logado no Google ---
        
        // Verifica a permissão na base de dados
        const userRef = ref(db, `autorizacoes/${user.uid}`); 
        
        try {
            const snapshot = await get(userRef);

            // Verifica se o user existe na lista e se o status é "aprovado"
            if (snapshot.exists() && snapshot.val().status === 'aprovado') {
                // --- 2. Utilizador aprovado ---
                currentUserId = user.uid;
                
                // Se ele estava na pág de login, redireciona para o index
                if (isLoginPage) {
                    window.location.href = 'index.html';
                    return;
                }

                // --- MOSTRAR NOME + FOTO ---
                const userNameEl = document.getElementById('user-name');
                const userPhotoEl = document.getElementById('user-photo');
                if (userNameEl) userNameEl.textContent = user.displayName;
                if (userPhotoEl) userPhotoEl.src = user.photoURL || 'https://i.ibb.co/t235T11/avatar.png';

                // --- MOSTRAR BOTÃO SAIR (CORREÇÃO) ---
                const logoutButton = document.getElementById("logout-button");
                if (logoutButton) {
                    logoutButton.style.display = "flex";   // sempre visível
                }

                // --- Dispara evento para outros scripts ---
                document.dispatchEvent(new CustomEvent('authReady', {
                    detail: { userId: currentUserId }
                }));
                
                updateMonthDisplay();
                listenToGlobalBalance(currentUserId);
                listenToGlobalAlerts(currentUserId);

            } else {
                // --- 3. Utilizador não aprovado ---
                await signOut(auth);
                console.warn("Permissão negada. A deslogar...");
            }

        } catch (error) {
            console.error("Erro ao ler permissão no main.js:", error);
            await signOut(auth);
        }

    } else {
        // --- 4. Utilizador não está logado ---
        if (isLoginPage) return; // permanece na tela de login
        
        // Redireciona para o login
        console.log("Usuário não está logado. Redirecionando para login.html");
        window.location.href = 'login.html';
    }
});

// garante que o logout-area exista e funcione
(function ensureLogout() {
    const logout = document.getElementById('logout-button'); // sua estrutura usa id aqui
    if (!logout) return;

    // força visibilidade caso alguma regra antiga tenha colocado display:none
    logout.style.display = 'flex';
    logout.style.alignItems = 'center';

    // delega o clique para deslogar — adapta caso você use signOut(auth)
    logout.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof signOut === 'function' && window.auth) {
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            }).catch(err => {
                console.error('Erro ao deslogar:', err);
                // fallback: redireciona mesmo assim
                window.location.href = 'login.html';
            });
        } else {
            // fallback simples se não houver signOut disponível
            window.location.href = 'login.html';
        }
    });
})();

// ===============================================================


// ---- LÓGICA DE MUDANÇA DE MÊS ----
function updateMonthDisplay() {
    if (!monthDisplay) return;
    const date = new Date(currentYear, parseInt(currentMonth) - 1);
    const monthName = date.toLocaleString('pt-BR', { month: 'long' });
    const formattedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    monthDisplay.textContent = `${formattedMonth} ${currentYear}`;
    monthDisplay.dataset.year = currentYear;
    monthDisplay.dataset.month = currentMonth;
}

function changeMonth(offset) {
    const oldYear = currentYear; 
    
    let date = new Date(currentYear, parseInt(currentMonth) - 1);
    date.setMonth(date.getMonth() + offset);
    currentYear = date.getFullYear();
    currentMonth = (date.getMonth() + 1).toString().padStart(2, '0');
    
    updateMonthDisplay();
    
    const yearChanged = (oldYear !== currentYear);
    
    document.dispatchEvent(new CustomEvent('monthChanged', {
        detail: {
            year: currentYear,
            month: currentMonth,
            yearChanged: yearChanged 
        }
    }));

    listenToGlobalAlerts(currentUserId);
}

prevMonthBtn?.addEventListener('click', () => changeMonth(-1));
nextMonthBtn?.addEventListener('click', () => changeMonth(1));

// ---- LÓGICA DO TEMA (DARK/LIGHT) ----
themeToggler?.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    themeToggler.querySelector('span:nth-child(1)').classList.toggle('active');
    themeToggler.querySelector('span:nth-child(2)').classList.toggle('active');
    
    const isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
});

// ---- LÓGICAS QUE RODAM QUANDO A PÁGINA CARREGA ----
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Carrega a preferência de tema
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggler?.querySelector('span:nth-child(1)').classList.remove('active');
        themeToggler?.querySelector('span:nth-child(2)').classList.add('active');
    }

    // 2. LÓGICA DO MENU HAMBURGER (MOBILE)
    const hamburger = document.querySelector('.hamburger-menu');
    const sidebar = document.querySelector('.sidebar');
    
    if (hamburger && sidebar) {
        hamburger.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 800 && 
                !sidebar.contains(e.target) && 
                !hamburger.contains(e.target) && 
                sidebar.classList.contains('active')) 
            {
                sidebar.classList.remove('active');
            }
        });
    }

    // 3. LISTENERS DO DROPDOWN DE NOTIFICAÇÃO
    notificationButton?.addEventListener('click', (e) => {
        e.stopPropagation(); 
        notificationDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (notificationDropdown && notificationDropdown.classList.contains('show')) {
            if (!notificationButton.contains(e.target) && !notificationDropdown.contains(e.target)) {
                notificationDropdown.classList.remove('show');
            }
        }
    });

    // 4. LISTENER DE LOGOUT (ATUALIZADO v4.1 - com Modal)
    if (logoutButton) {
        logoutButton.addEventListener('click', (e) => {
            e.preventDefault(); 
            showLogoutConfirm(); // Mostra o modal em vez de deslogar direto
        });
    }
});

// 5. NOVAS FUNÇÕES DE MODAL DE LOGOUT (v4.1)
function showLogoutConfirm() {
    const modal = document.getElementById('modal-logout-confirm');
    if (!modal) {
        console.error("Modal de logout não encontrado no HTML! Fazendo logout direto.");
        (async () => {
            try { await signOut(auth); } catch (e) { console.error(e); }
        })();
        return;
    }
    
    const btnConfirm = document.getElementById('modal-logout-btn-confirm');
    const btnCancel = document.getElementById('modal-logout-btn-cancel');

    modal.style.display = 'flex';

    // Garante que os listeners sejam atribuídos apenas uma vez (removendo e adicionando)
    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    
    newBtnConfirm.onclick = async () => {
        try {
            await signOut(auth);
            // O onAuthStateChanged (linha 88) fará o redirecionamento
        } catch (error) {
            console.error("Erro ao fazer logout:", error);
        }
    };

    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    
    newBtnCancel.onclick = () => {
        hideLogoutConfirm();
    };
}

function hideLogoutConfirm() {
    const modal = document.getElementById('modal-logout-confirm');
    if (modal) {
        modal.style.display = 'none';
    }
}


// ===============================================================
// 6. LÓGICA DE NOTIFICAÇÕES (v4.1 - Caminhos 'usuarios/' e 'despesas')
// ===============================================================

function limparAlertListeners() {
    globalAlertListeners.forEach(l => off(l.ref, 'value', l.callback));
    globalAlertListeners = [];
}

function listenToGlobalAlerts(userId) {
    if (!userId) return;
    
    limparAlertListeners();
    globalAlertData = { fixos: {}, pendencias: {}, cartoes: {}, pagamentosFatura: [], despesasAtual: {} }; 
    
    const dataAtual = new Date(currentYear, currentMonth - 1, 1);
    const dataSeguinte = new Date(dataAtual);
    dataSeguinte.setMonth(dataSeguinte.getMonth() + 1);
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesSeguintePath = `${dataSeguinte.getFullYear()}-${(dataSeguinte.getMonth() + 1).toString().padStart(2, '0')}`;
    
    // v4.1: Caminhos atualizados para 'usuarios/'
    const pathsToListen = {
        cartoes: `usuarios/${userId}/cartoes/config`,
        fixosAtual: `usuarios/${userId}/fixos/${mesAtualPath}`,
        fixosSeguinte: `usuarios/${userId}/fixos/${mesSeguintePath}`,
        pendenciasAtual: `usuarios/${userId}/pendencias/${mesAtualPath}`,
        pendenciasSeguinte: `usuarios/${userId}/pendencias/${mesSeguintePath}`,
        despesasAtual: `usuarios/${userId}/despesas/${mesAtualPath}` // v4.1: Adicionado
    };

    // v4.1: Função interna para reprocessar pagamentos (evita 'race condition')
    const reprocessarPagamentos = () => {
        const pendencias = globalAlertData.pendencias[mesAtualPath] || {};
        const despesas = globalAlertData.despesasAtual || {}; 

        // Busca pagamentos em 'pendencias' (legado)
        const p1 = Object.values(pendencias).filter(p => 
            p.descricao.startsWith('Pagamento Fatura') && p.status === 'pago'
        );
        // Busca pagamentos em 'despesas' (novo v6.0 de cartoes.js)
        const p2 = Object.values(despesas).filter(p => 
            p.descricao.startsWith('Pagamento Fatura') && p.categoria === 'Fatura'
        );
        
        globalAlertData.pagamentosFatura = [...p1, ...p2];
        processAndRenderAlerts();
    };

    const cartoesRef = ref(db, pathsToListen.cartoes);
    const cartoesCallback = onValue(cartoesRef, (snap) => {
        globalAlertData.cartoes = snap.val() || {};
        processAndRenderAlerts();
    });
    globalAlertListeners.push({ ref: cartoesRef, callback: cartoesCallback, eventType: 'value' });

    const fixosAtualRef = ref(db, pathsToListen.fixosAtual);
    const fixosAtualCallback = onValue(fixosAtualRef, (snap) => {
        globalAlertData.fixos[mesAtualPath] = snap.val() || {};
        processAndRenderAlerts();
    });
    globalAlertListeners.push({ ref: fixosAtualRef, callback: fixosAtualCallback, eventType: 'value' });
    
    const fixosSeguinteRef = ref(db, pathsToListen.fixosSeguinte);
    const fixosSeguinteCallback = onValue(fixosSeguinteRef, (snap) => {
        globalAlertData.fixos[mesSeguintePath] = snap.val() || {};
        processAndRenderAlerts();
    });
    globalAlertListeners.push({ ref: fixosSeguinteRef, callback: fixosSeguinteCallback, eventType: 'value' });

    const pendenciasAtualRef = ref(db, pathsToListen.pendenciasAtual);
    const pendenciasAtualCallback = onValue(pendenciasAtualRef, (snap) => {
        globalAlertData.pendencias[mesAtualPath] = snap.val() || {};
        reprocessarPagamentos(); // Usa a função interna
    });
    globalAlertListeners.push({ ref: pendenciasAtualRef, callback: pendenciasAtualCallback, eventType: 'value' });

    const pendenciasSeguinteRef = ref(db, pathsToListen.pendenciasSeguinte);
    const pendenciasSeguinteCallback = onValue(pendenciasSeguinteRef, (snap) => {
        globalAlertData.pendencias[mesSeguintePath] = snap.val() || {};
        processAndRenderAlerts();
    });
    globalAlertListeners.push({ ref: pendenciasSeguinteRef, callback: pendenciasSeguinteCallback, eventType: 'value' });

    // v4.1: Novo listener para despesas (para pagamentos de fatura)
    const despesasAtualRef = ref(db, pathsToListen.despesasAtual);
    const despesasAtualCallback = onValue(despesasAtualRef, (snap) => {
        globalAlertData.despesasAtual = snap.val() || {};
        reprocessarPagamentos(); // Usa a função interna
    });
    globalAlertListeners.push({ ref: despesasAtualRef, callback: despesasAtualCallback, eventType: 'value' });
}

// (Lógica de processar e renderizar alertas mantida do v3.3)
function processAndRenderAlerts() {
    let allAlerts = [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    Object.values(globalAlertData.fixos).forEach(mes => {
        Object.values(mes).forEach(item => {
            if (item.status === 'pendente') {
                const diff = getDaysDiff(item.vencimento);
                if (diff <= 3) { 
                    allAlerts.push({ diffDays: diff, nome: item.descricao, tipo: 'fixo' });
                }
            }
        });
    });

    Object.values(globalAlertData.pendencias).forEach(mes => {
        Object.values(mes).forEach(item => {
            if (item.status === 'pendente' && item.tipo === 'euDevo') {
                const diff = getDaysDiff(item.vencimento);
                if (diff <= 3) {
                    allAlerts.push({ diffDays: diff, nome: item.descricao, tipo: 'pendencia' });
                }
            }
        });
    });

    Object.values(globalAlertData.cartoes).forEach(cartao => {
        // (v4.1) 'pagamentosFatura' agora é um Array com dados de 'pendencias' E 'despesas'
        const faturaPaga = globalAlertData.pagamentosFatura.some(
            p => p.descricao === `Pagamento Fatura ${cartao.nome}`
        );

        if (!faturaPaga) {
            const vencimentoDate = new Date(currentYear, currentMonth - 1, cartao.diaVencimento);
            const diff = getDaysDiff(vencimentoDate);
            if (diff <= 3) {
                allAlerts.push({
                    diffDays: diff,
                    nome: `Fatura ${cartao.nome}`,
                    tipo: 'fatura'
                });
            }
        }
    });

    renderAlerts(allAlerts);
}

function renderAlerts(allAlerts) {
    if (!notificationButton) return; 

    allAlerts.sort((a, b) => a.diffDays - b.diffDays);

    if (allAlerts.length === 0) {
        notificationCount.style.display = 'none';
        notificationList.innerHTML = '';
        notificationPlaceholder.style.display = 'block';
        notificationButton.classList.remove('has-alerts');
    } else {
        notificationCount.style.display = 'flex';
        notificationCount.textContent = allAlerts.length;
        notificationList.innerHTML = ''; 
        notificationPlaceholder.style.display = 'none';
        notificationButton.classList.add('has-alerts'); 

        allAlerts.forEach(alerta => {
            let className = '';
            let texto = '';
            let icon = 'event_note';

            if (alerta.tipo === 'fatura') icon = 'credit_card';
            if (alerta.tipo === 'pendencia') icon = 'assignment_late';
            
            if (alerta.diffDays < 0) {
                className = 'due-today'; 
                texto = `Vencido há ${Math.abs(alerta.diffDays)} dia(s)`;
            } else if (alerta.diffDays === 0) {
                className = 'due-today'; 
                texto = 'Vence HOJE';
            } else {
                className = 'due-soon'; 
                texto = `Vence em ${alerta.diffDays} dia(s)`;
            }

            const itemEl = document.createElement('div');
            itemEl.className = `notification-item ${className}`;
            itemEl.innerHTML = `
                <span class="material-icons-sharp">${icon}</span>
                <div>
                    <strong>${alerta.nome}</strong>
                    <small>${texto}</small>
                </div>
            `;
            notificationList.appendChild(itemEl);
        });
    }
}

function getDaysDiff(dateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const vencimentoDate = new Date(dateString + 'T12:00:00');
    vencimentoDate.setHours(0, 0, 0, 0);
    
    const diffTime = vencimentoDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// ===============================================================
// 7. FUNÇÕES EXPORTÁVEIS (v4.1 - Caminhos 'usuarios/')
// ===============================================================
export function getUserId() {
    return currentUserId;
}

export function formatCurrency(value) {
    if (isNaN(value)) value = 0;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function parseCurrency(value) {
    if (typeof value !== 'string') return 0;
    return parseFloat(value.replace(/R\$\s?/, '').replace(/\./g, '').replace(',', '.')) || 0;
}

// v4.1: Caminho atualizado
export async function verificarSaldoSuficiente(valorGasto) {
    if (!currentUserId) {
        console.error("ID do usuário não encontrado. Não é possível verificar o saldo.");
        return false; 
    }
    
    const saldoRef = ref(db, `usuarios/${currentUserId}/saldo/global`);
    try {
        const snapshot = await get(saldoRef);
        const saldoAtual = snapshot.val()?.saldoAcumulado || 0;
        return (saldoAtual >= valorGasto);
    } catch (error) {
        console.error("Erro ao ler saldo global:", error);
        return false; 
    }
}

// v4.1: Caminho atualizado
export async function getCartoesHtmlOptions() {
    if (!currentUserId) {
        console.warn("User ID não disponível, não é possível carregar cartões.");
        return ''; 
    }

    const path = `usuarios/${currentUserId}/cartoes/config`;
    const configRef = ref(db, path);
    let htmlOptions = '';

    try {
        const snapshot = await get(configRef);
        if (snapshot.exists()) {
            const cartoes = snapshot.val();
            
            const cartoesArray = Object.values(cartoes)
                .filter(cartao => !cartao.bloqueado) 
                .sort((a, b) => a.nome.localeCompare(b.nome));

            cartoesArray.forEach(cartao => {
                htmlOptions += `<option value="${cartao.nome}">${cartao.icone} ${cartao.nome}</option>`;
            });
        }
        return htmlOptions;
    } catch (error) {
        console.error("Erro ao buscar configurações dos cartões:", error);
        return ''; 
    }
}

// ===============================================================
// 8. OUVINTE DE SALDO GLOBAL (v4.1 - Caminho 'usuarios/')
// ===============================================================
// v4.1: Caminho atualizado
function listenToGlobalBalance(userId) {
    const balanceContainer = document.getElementById('global-balance-container');
    const balanceEl = document.getElementById('global-balance-display');
    
    if (!balanceContainer || !balanceEl) {
        return;
    }

    const saldoRef = ref(db, `usuarios/${userId}/saldo/global`);
    onValue(saldoRef, (snapshot) => {
        let saldoAcumulado = 0;
        if (snapshot.exists()) {
            saldoAcumulado = snapshot.val().saldoAcumulado || 0;
        }
        
        balanceEl.textContent = formatCurrency(saldoAcumulado);
        
        if (saldoAcumulado < 0) {
            balanceEl.style.color = 'var(--danger-color)'; 
        } else {
            balanceEl.style.color = 'var(--success-color)';
        }
        
        balanceContainer.style.display = 'flex';
    });
}