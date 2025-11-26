// js/cartoes.js
// VERSÃO 5.4 (Corrigido: Bug de agregação, bugs do modal 'Reverter' e Pagamento salvo em 'despesas')

import { 
    db, 
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    child,
    update,
    off 
} from './firebase-config.js';
import { 
    getUserId, 
    formatCurrency, 
    parseCurrency,
    verificarSaldoSuficiente 
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');

let meusCartoes = {}; 
let activeListeners = []; 
let estadoFaturas = {};

// ---- Mapas de Ícones ----
const categoriaIcones = {
    "Casa": "🏠", "Alimentação": "🛒", "Restaurante": "🍽️", "Transporte": "🚗",
    "Lazer": "🍿", "Saúde": "🩺", "Educação": "🎓", "Compras": "🛍️",
    "Serviços": "⚙️", "Outros": "📦", "Fatura": "💳" // Categoria para o pagamento
};
const categoriaFixosIcones = {
    "Moradia": "🏠", "Contas": "💡", "Internet": "📺", "Transporte": "🚗",
    "Saude": "❤️", "Educacao": "🎓", "Seguros": "🛡️", "Outros": "📦"
};

// ---- Elementos DOM (Gerenciador) ----
const formAddCartao = document.getElementById('form-add-cartao');
const cartaoNomeInput = document.getElementById('cartao-nome');
const cartaoIconeSelect = document.getElementById('cartao-icone');
const cartaoFechamentoInput = document.getElementById('cartao-fechamento');
const cartaoVencimentoInput = document.getElementById('cartao-vencimento');
const cartaoLimiteInput = document.getElementById('cartao-limite'); 
const tbodyMeusCartoes = document.getElementById('tbody-meus-cartoes');

// ---- Elementos DOM (Faturas) ----
const faturasTabNav = document.getElementById('faturas-tab-nav');
const faturasTabContent = document.getElementById('faturas-tab-content');
const totalGastosCartoesEl = document.getElementById('total-gastos-cartoes-mes'); 

// ---- Elementos DOM (Modais) ----
const modalConfirm = document.getElementById('modal-confirm');
const modalMessage = document.getElementById('modal-message');
const modalEdit = document.getElementById('modal-edit-cartao');
const formEdit = document.getElementById('form-edit-cartao');
const editCartaoNomeInput = document.getElementById('edit-cartao-nome');
const editCartaoIconeSelect = document.getElementById('edit-cartao-icone');
const editCartaoFechamentoInput = document.getElementById('edit-cartao-fechamento');
const editCartaoVencimentoInput = document.getElementById('edit-cartao-vencimento');
const editCartaoLimiteInput = document.getElementById('edit-cartao-limite'); 
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');

const modalReverter = document.getElementById('modal-reverter-confirm');
const modalReverterMessage = document.getElementById('modal-reverter-message');

// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', (e) => {
    userId = e.detail.userId;
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        loadGerenciadorCartoes(); 
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    formAddCartao.addEventListener('submit', handleSalvarCartao);
    formEdit.addEventListener('submit', handleSalvarEditCartao);
    btnCancelEdit.addEventListener('click', () => modalEdit.style.display = 'none');

    loadGerenciadorCartoes();
});

function limparListeners() {
    activeListeners.forEach(l => off(l.ref, l.eventType, l.callback));
    activeListeners = [];
}

// ===============================================================
// FASE 2A: GERENCIADOR DE CARTÕES
// ===============================================================
function loadGerenciadorCartoes() {
    limparListeners(); 
    
    const configPath = `dados/${userId}/cartoes/config`;
    const configRef = ref(db, configPath);

    const configCallback = onValue(configRef, (snapshot) => {
        meusCartoes = snapshot.val() || {};
        loadGastosAgregados();
    });
    
    activeListeners.push({ ref: configRef, callback: configCallback, eventType: 'value' });
}

function atualizarTabelaCartoesSalvos() {
    tbodyMeusCartoes.innerHTML = '';
    const cartoes = Object.values(meusCartoes);

    if (cartoes.length === 0) {
        tbodyMeusCartoes.innerHTML = '<tr><td colspan="5">Nenhum cartão cadastrado.</td></tr>';
        return;
    }

    cartoes.forEach(cartao => {
        const tr = document.createElement('tr');
        tr.dataset.id = cartao.id;
        
        const isBloqueado = cartao.bloqueado || false;
        const statusClass = isBloqueado ? 'danger' : 'success';
        const statusIcon = isBloqueado ? 'lock' : 'lock_open';
        const statusText = isBloqueado ? 'Bloqueado' : 'Ativo';
        const toggleText = isBloqueado ? 'Desbloquear' : 'Bloquear';
        const toggleIcon = isBloqueado ? 'lock_open' : 'lock';

        tr.innerHTML = `
            <td>${cartao.icone} ${cartao.nome}</td>
            <td>${formatCurrency(cartao.limiteTotal || 0)}</td>
            <td><span class="tag ${statusClass}">${statusIcon} ${statusText}</span></td>
            <td>Dia ${cartao.diaVencimento}</td>
            <td class="actions">
                <button class="btn-icon ${isBloqueado ? 'success' : 'danger'} btn-block-cartao" title="${toggleText}">
                    <span class="material-icons-sharp">${toggleIcon}</span>
                </button>
                <button class="btn-icon warning btn-edit-cartao" title="Editar">
                    <span class="material-icons-sharp">edit</span>
                </button>
                <button class="btn-icon danger btn-delete-cartao" title="Excluir">
                    <span class="material-icons-sharp">delete</span>
                </button>
            </td>
        `;
        tr.querySelector('.btn-edit-cartao').addEventListener('click', handleEditCartaoClick);
        tr.querySelector('.btn-delete-cartao').addEventListener('click', handleDeleteCartaoClick);
        tr.querySelector('.btn-block-cartao').addEventListener('click', handleBlockToggleClick); 
        
        tbodyMeusCartoes.appendChild(tr);
    });
}

async function handleSalvarCartao(e) {
    e.preventDefault();
    const nome = cartaoNomeInput.value;
    
    const nomeExistente = Object.values(meusCartoes).some(c => c.nome.toLowerCase() === nome.toLowerCase());
    if (nomeExistente) {
        alert(`❌ Erro: Já existe um cartão com o nome "${nome}".`);
        return;
    }

    const newRef = push(ref(db, `dados/${userId}/cartoes/config`));
    const cartaoData = {
        id: newRef.key,
        nome: nome,
        icone: cartaoIconeSelect.value,
        diaFechamento: parseInt(cartaoFechamentoInput.value),
        diaVencimento: parseInt(cartaoVencimentoInput.value),
        limiteTotal: parseCurrency(cartaoLimiteInput.value) || 0,
        bloqueado: false 
    };

    try {
        await set(newRef, cartaoData);
        formAddCartao.reset();
    } catch (error) {
        console.error("Erro ao salvar cartão:", error);
        alert("Não foi possível salvar o cartão.");
    }
}

function handleEditCartaoClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return; 
    
    const id = tr.dataset.id;
    const cartao = meusCartoes[id];
    if (!cartao) return;

    formEdit.dataset.id = id;
    editCartaoNomeInput.value = cartao.nome;
    editCartaoIconeSelect.value = cartao.icone;
    editCartaoFechamentoInput.value = cartao.diaFechamento;
    editCartaoVencimentoInput.value = cartao.diaVencimento;
    editCartaoLimiteInput.value = formatCurrency(cartao.limiteTotal || 0); 

    modalEdit.style.display = 'flex';
}

async function handleSalvarEditCartao(e) {
    e.preventDefault();
    const id = formEdit.dataset.id;
    const path = `dados/${userId}/cartoes/config/${id}`;

    const nomeEditado = editCartaoNomeInput.value;
    const idDoNome = Object.keys(meusCartoes).find(key => meusCartoes[key].nome.toLowerCase() === nomeEditado.toLowerCase());
    
    if (idDoNome && idDoNome !== id) {
        alert(`❌ Erro: Já existe outro cartão com o nome "${nomeEditado}".`);
        return;
    }

    const cartaoAntigo = meusCartoes[id] || {};

    const cartaoData = {
        ...cartaoAntigo, 
        id: id,
        nome: nomeEditado,
        icone: editCartaoIconeSelect.value,
        diaFechamento: parseInt(editCartaoFechamentoInput.value),
        diaVencimento: parseInt(editCartaoVencimentoInput.value),
        limiteTotal: parseCurrency(editCartaoLimiteInput.value) || 0 
    };

    try {
        await update(ref(db, path), cartaoData); 
        modalEdit.style.display = 'none';
    } catch (error) {
        console.error("Erro ao atualizar cartão:", error);
        alert("Não foi possível atualizar o cartão.");
    }
}

function handleDeleteCartaoClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    
    const id = tr.dataset.id;
    const cartao = meusCartoes[id];
    if (!cartao) return;

    modalMessage.textContent = `Tem certeza que quer excluir o cartão "${cartao.nome}"? Isso não afeta os lançamentos já feitos.`;
    
    const deleteFn = async () => {
        try {
            await remove(ref(db, `dados/${userId}/cartoes/config/${id}`));
            hideModal('modal-confirm');
        } catch (error) {
            console.error("Erro ao excluir cartão:", error);
            alert("Não foi possível excluir o cartão.");
        }
    };
    
    showModal('modal-confirm', deleteFn);
}

async function handleBlockToggleClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const cartao = meusCartoes[id];
    if (!cartao) return;

    const novoStatus = !(cartao.bloqueado || false); 
    const path = `dados/${userId}/cartoes/config/${id}/bloqueado`;

    try {
        await set(ref(db, path), novoStatus);
    } catch (error) {
        console.error("Erro ao alterar status do cartão:", error);
        alert("Não foi possível alterar o status do cartão.");
    }
}

// ===============================================================
// FASE 3A: LÓGICA DE FATURAS (v5.2)
// ===============================================================

async function loadGastosAgregados() {
    estadoFaturas = {}; 

    const dataAtual = new Date(currentYear, currentMonth - 1, 1);
    const dataAnterior = new Date(dataAtual);
    dataAnterior.setMonth(dataAnterior.getMonth() - 1);
    
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataAnterior.getFullYear()}-${(dataAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    const paths = {
        despesasAtual: `dados/${userId}/despesas/${mesAtualPath}`,
        despesasAnt: `dados/${userId}/despesas/${mesAnteriorPath}`,
        fixosAtual: `dados/${userId}/fixos/${mesAtualPath}`,
        fixosAnt: `dados/${userId}/fixos/${mesAnteriorPath}`,
        specs: `dados/${userId}/cartoes_specs`,
        pendencias: `dados/${userId}/pendencias` // Busca TUDO
    };

    const promises = Object.keys(paths).map(key => get(ref(db, paths[key])));

    try {
        const results = await Promise.all(promises);
        
        const estadoGastos = {
            despesas: {
                [mesAtualPath]: results[0].val() || {},
                [mesAnteriorPath]: results[1].val() || {}
            },
            fixos: {
                [mesAtualPath]: results[2].val() || {},
                [mesAnteriorPath]: results[3].val() || {}
            },
            specs: results[4].val() || {},
            pendencias: results[5].val() || {}
        };
        
        // (v5.2) ORDEM CORRIGIDA:
        atualizarAbasFatura(); 
        renderizarFaturas(estadoGastos); 
        atualizarTabelaCartoesSalvos(); 
        ativarPrimeiraAba(); 
        renderTotalGastosCartoes();

    } catch (error) {
        console.error("Erro fatal ao carregar dados agregados:", error);
        faturasTabNav.innerHTML = '<p style="padding: 1rem; color: var(--danger-color);">Erro ao carregar dados. Tente recarregar a página.</p>';
    }
}

function atualizarAbasFatura() {
    faturasTabNav.innerHTML = '';
    faturasTabContent.innerHTML = '';
    
    const cartoes = Object.values(meusCartoes);

    if (cartoes.length === 0) {
        faturasTabNav.innerHTML = '<p style="padding: 1rem; color: var(--text-light);">Cadastre um cartão acima para ver as faturas.</p>';
        return;
    }

    cartoes.forEach(cartao => {
        const tabBtn = document.createElement('button');
        tabBtn.className = 'tab-btn';
        tabBtn.dataset.cartaoId = cartao.id;
        
        let melhorDia = (cartao.diaFechamento || 0) + 1;
        if (melhorDia > 31) melhorDia = 1; 
        
        const faturaAtual = 0; 
        
        tabBtn.innerHTML = `
            <div>${cartao.icone} ${cartao.nome}</div>
            <small id="total-aba-${cartao.id}" style="color: var(--success-color);">
                ${formatCurrency(faturaAtual)}
            </small>
        `;
        
        tabBtn.addEventListener('click', handleTabClick);
        faturasTabNav.appendChild(tabBtn);

        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.dataset.cartaoId = cartao.id;
        tabContent.style.display = 'none'; 
        
        tabContent.innerHTML = `
            <div class="fatura-header">
                <div>
                    <h2 id="total-fatura-${cartao.id}">R$ 0,00</h2>
                    <small>Fechamento: Dia ${cartao.diaFechamento} / Vencimento: Dia ${cartao.diaVencimento}</small>
                    <small style="color: var(--success-color); font-weight: 500; display: block; margin-top: 4px;">
                        Melhor dia de compra: Dia ${melhorDia}
                    </small>
                </div>
                <div class="fatura-actions">
                    <button class="btn-primary" id="btn-pagar-${cartao.id}" style="display: none;">Pagar Fatura</button>
                    <button class="btn-secondary danger" id="btn-reverter-pagamento-${cartao.id}" style="display: none;">
                        <span class="material-icons-sharp">undo</span> Reverter Pagamento
                    </button>
                </div>
            </div>
            <div class="table-container">
                <table id="table-fatura-${cartao.id}">
                    <thead> <tr> <th>Data</th> <th>Descrição</th> <th>Valor</th> </tr> </thead>
                    <tbody id="tbody-fatura-${cartao.id}">
                        <tr><td colspan="3">Nenhum gasto este mês.</td></tr>
                    </tbody>
                </table>
            </div>
        `;
        
        // ===============================================================
        // CORREÇÃO (v5.3): Usa e.currentTarget
        // ===============================================================
        tabContent.querySelector(`#btn-pagar-${cartao.id}`).addEventListener('click', (e) => {
            const total = parseFloat(e.currentTarget.dataset.totalValor || 0);
            handlePagarFaturaClick(cartao, total); 
        });
        
        tabContent.querySelector(`#btn-reverter-pagamento-${cartao.id}`).addEventListener('click', (e) => {
            const total = parseFloat(e.currentTarget.dataset.totalValor || 0);
            handleReverterPagamentoClick(cartao, total); 
        });
        // ===============================================================

        faturasTabContent.appendChild(tabContent);
    });
}

function handleTabClick(e) {
    const targetId = e.target.closest('.tab-btn').dataset.cartaoId;
    faturasTabNav.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    faturasTabContent.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    faturasTabNav.querySelector(`.tab-btn[data-cartao-id="${targetId}"]`).classList.add('active');
    faturasTabContent.querySelector(`.tab-content[data-cartao-id="${targetId}"]`).style.display = 'block';
}

function ativarPrimeiraAba() {
    const firstTabBtn = faturasTabNav.querySelector('.tab-btn');
    if (firstTabBtn) firstTabBtn.click();
}

/**
 * Função MESTRA de cálculo (v5.2)
 */
function renderizarFaturas(estadoGastos) {
    if (Object.keys(meusCartoes).length === 0) return; 

    const dataFatura = new Date(currentYear, currentMonth - 1, 1);
    const dataFaturaAnterior = new Date(dataFatura);
    dataFaturaAnterior.setMonth(dataFaturaAnterior.getMonth() - 1);
    
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataFaturaAnterior.getFullYear()}-${(dataFaturaAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    const statusPagamentoAtual = {};
    const statusPagamentoAnterior = {}; 

    Object.values(meusCartoes).forEach(cartao => {
        const nomeFatura = `Pagamento Fatura ${cartao.nome}`;
        
        // ===============================================================
        // MUDANÇA (v5.4): Verifica 'despesas' E 'pendencias' para pagamento
        // ===============================================================
        const pagoEmDespesas = Object.values(estadoGastos.despesas[mesAtualPath] || {}).some(p => 
            p.descricao === nomeFatura && p.categoria === 'Fatura'
        );
        const pagoEmPendencias = Object.values(estadoGastos.pendencias[mesAtualPath] || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
        statusPagamentoAtual[cartao.id] = pagoEmDespesas || pagoEmPendencias;
        
        // Verifica o mês anterior (apenas em pendências, pois o sistema antigo só salvava lá)
        statusPagamentoAnterior[cartao.id] = Object.values(estadoGastos.pendencias[mesAnteriorPath] || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
    });

    estadoFaturas = {}; 
    Object.values(meusCartoes).forEach(cartao => {
        estadoFaturas[cartao.id] = { 
            nome: cartao.nome,
            total: 0, 
            html: '',
            pago: statusPagamentoAtual[cartao.id] 
        };
    });

    const fontesGastos = [
        ...Object.values(estadoGastos.despesas[mesAnteriorPath] || {}),
        ...Object.values(estadoGastos.despesas[mesAtualPath] || {}),
        ...Object.values(estadoGastos.fixos[mesAnteriorPath] || {}),
        ...Object.values(estadoGastos.fixos[mesAtualPath] || {})
    ];
    
    fontesGastos.forEach(gasto => {
        // v5.4: Ignora o próprio pagamento da fatura
        if (gasto.categoria === 'Fatura') return; 

        if (!gasto.data && !gasto.vencimento) return;
        const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === gasto.formaPagamento);
        if (!cartaoConfig) return; 

        const dataGasto = new Date((gasto.data || gasto.vencimento) + 'T12:00:00');
        let mesFaturaAlvo = calcularMesFatura(dataGasto, cartaoConfig.diaFechamento);

        const isFaturaAnterior = (mesFaturaAlvo.getFullYear() === dataFaturaAnterior.getFullYear() &&
                                    mesFaturaAlvo.getMonth() === dataFaturaAnterior.getMonth());
        
        if (isFaturaAnterior && statusPagamentoAnterior[cartaoConfig.id]) {
            mesFaturaAlvo.setMonth(mesFaturaAlvo.getMonth() + 1);
        }
        const isFaturaAtual = (mesFaturaAlvo.getFullYear() === dataFatura.getFullYear() && 
                                mesFaturaAlvo.getMonth() === dataFatura.getMonth());

        if (isFaturaAtual && statusPagamentoAtual[cartaoConfig.id]) {
            mesFaturaAlvo.setMonth(mesFaturaAlvo.getMonth() + 1);
        }
        if (mesFaturaAlvo.getFullYear() === dataFatura.getFullYear() && 
            mesFaturaAlvo.getMonth() === dataFatura.getMonth()) {
            
            estadoFaturas[cartaoConfig.id].total += gasto.valor;
            estadoFaturas[cartaoConfig.id].html += renderLinhaGasto(gasto);
        }
    });

    Object.values(estadoGastos.specs).forEach(compra => {
        const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === compra.cartao);
        if (!cartaoConfig) return;

        if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
             console.warn('Compra parcelada ignorada (dataInicio inválida):', compra.descricao);
             return;
        }

        const [anoCompra, mesCompra] = compra.dataInicio.split('-');
        let dataInicioVirtual = new Date(anoCompra, mesCompra - 1, 1);
        
        while (true) {
            const path = `${dataInicioVirtual.getFullYear()}-${(dataInicioVirtual.getMonth() + 1).toString().padStart(2, '0')}`;
            const pendenciasDesseMes = estadoGastos.pendencias[path] || {};
            
            // v5.4: Verifica 'despesas' E 'pendencias'
            const despesasDesseMes = estadoGastos.despesas[path] || {};
            const faturaPagaEmPendencias = Object.values(pendenciasDesseMes).some(p => 
                p.descricao === `Pagamento Fatura ${cartaoConfig.nome}` && p.status === 'pago'
            );
            const faturaPagaEmDespesas = Object.values(despesasDesseMes).some(p =>
                p.descricao === `Pagamento Fatura ${cartaoConfig.nome}` && p.categoria === 'Fatura'
            );
            
            if (faturaPagaEmPendencias || faturaPagaEmDespesas) {
                dataInicioVirtual.setMonth(dataInicioVirtual.getMonth() + 1);
            } else {
                break;
            }
        }
        
        const [startYear, startMonth] = [dataInicioVirtual.getFullYear(), dataInicioVirtual.getMonth() + 1];
        const currentYearFatura = dataFatura.getFullYear();
        const currentMonthFatura = dataFatura.getMonth() + 1; 

        let mesesDiff = (currentYearFatura - startYear) * 12 + (currentMonthFatura - startMonth);
        let parcelaAtual = mesesDiff + 1; 
        
        if (parcelaAtual >= 1 && parcelaAtual <= compra.parcelas) {
            
            if (statusPagamentoAtual[cartaoConfig.id]) { 
                return; 
            }

            const status = compra.status || 'ativo'; 
            const valorParcelaOriginal = compra.valorTotal / compra.parcelas;
            
            let valorParaTotal = 0;
            let isStrikethrough = false;
            let parcelaLabel = `(${parcelaAtual}/${compra.parcelas})`;

            if (status === 'estornado') {
                isStrikethrough = true;
                valorParaTotal = 0; 
                parcelaLabel = `(Estornado)`;
            } else if (status === 'quitado') {
                isStrikethrough = true;
                valorParaTotal = 0; 
                parcelaLabel = `(Quitado)`;
            } else if (status === 'quitado_pagamento') {
                isStrikethrough = false;
                valorParaTotal = valorParcelaOriginal; 
                parcelaLabel = `(Pagamento Quitação)`;
            } else {
                isStrikethrough = false;
                valorParaTotal = valorParcelaOriginal;
            }
            
            estadoFaturas[cartaoConfig.id].total += valorParaTotal;
            estadoFaturas[cartaoConfig.id].html += renderLinhaGasto({
                data: `${currentYear}-${currentMonth}-01`, 
                descricao: `${compra.descricao} ${parcelaLabel}`,
                valor: valorParcelaOriginal, 
                categoria: 'Parcela',
                tipo: 'spec',
                isStrikethrough: isStrikethrough 
            });
        }
    });

    Object.values(meusCartoes).forEach(cartao => {
        const fatura = estadoFaturas[cartao.id];
        const totalAbaEl = document.getElementById(`total-aba-${cartao.id}`); 
        const totalEl = document.getElementById(`total-fatura-${cartao.id}`);
        const tbodyEl = document.getElementById(`tbody-fatura-${cartao.id}`);
        const btnPagarEl = document.getElementById(`btn-pagar-${cartao.id}`);
        const btnReverterEl = document.getElementById(`btn-reverter-pagamento-${cartao.id}`); 

        if (!totalEl || !tbodyEl || !btnPagarEl || !btnReverterEl || !totalAbaEl) return;

        totalEl.textContent = formatCurrency(fatura.total);
        totalAbaEl.textContent = formatCurrency(fatura.total); 
        tbodyEl.innerHTML = fatura.html || '<tr><td colspan="3">Nenhum gasto este mês.</td></tr>';
        
        btnPagarEl.dataset.totalValor = fatura.total;
        btnReverterEl.dataset.totalValor = fatura.total;

        btnPagarEl.className = 'btn-primary'; 
        btnReverterEl.className = 'btn-secondary danger'; 
        btnReverterEl.innerHTML = '<span class="material-icons-sharp">undo</span> Reverter Pagamento';

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const vencimentoDate = new Date(currentYear, currentMonth - 1, cartao.diaVencimento); 
        vencimentoDate.setHours(0, 0, 0, 0);
        const isVencida = vencimentoDate < today;

        if (fatura.pago) {
            btnPagarEl.style.display = 'none'; 
            btnReverterEl.style.display = 'flex'; 
            btnReverterEl.classList.add('success'); 
            btnReverterEl.innerHTML = '<span class="material-icons-sharp">check_circle</span> Fatura Paga';
            totalEl.style.color = 'var(--success-color)';
            totalAbaEl.style.color = 'var(--success-color)';
        } else if (fatura.total > 0) {
            btnPagarEl.style.display = 'flex'; 
            btnReverterEl.style.display = 'none'; 
            btnPagarEl.disabled = false;
            totalEl.style.color = 'var(--danger-color)';
            totalAbaEl.style.color = 'var(--danger-color)';
            
            if (isVencida) {
                btnPagarEl.classList.add('danger'); 
                btnPagarEl.textContent = 'Pagar (Vencida)';
            } else {
                btnPagarEl.textContent = 'Pagar Fatura'; 
            }
        } else {
            btnPagarEl.style.display = 'flex'; 
            btnPagarEl.textContent = 'Sem Fatura';
            btnPagarEl.disabled = true;
            btnReverterEl.style.display = 'none'; 
            totalEl.style.color = 'var(--success-color)';
            totalAbaEl.style.color = 'var(--success-color)';
        }
    });
}

function renderTotalGastosCartoes() {
    let totalMes = 0;
    for (const id in estadoFaturas) {
        totalMes += estadoFaturas[id].total;
    }
    totalGastosCartoesEl.textContent = formatCurrency(totalMes);
}

function renderLinhaGasto(gasto) {
    const data = gasto.data || gasto.vencimento;
    if (!data || data.split('-').length < 3) {
        console.warn("Gasto inválido (sem data) foi pulado:", gasto);
        return '';
    }
    const [y, m, d] = data.split('-');
    const dataFormatada = `${d}/${m}/${y}`;
    
    let icone = "💳";
    // v5.4: Adiciona ícone de Fatura
    if (gasto.tipo === 'variavel') icone = categoriaIcones[gasto.categoria] || "📦";
    else if (gasto.tipo === 'fixo') icone = categoriaFixosIcones[gasto.categoria] || "📦";
    else if (gasto.tipo === 'spec') icone = "🔄";
    else if (gasto.categoria === 'Fatura') icone = categoriaIcones[gasto.categoria] || "💳";


    const isStrikethrough = gasto.isStrikethrough || false;
    const openTag = isStrikethrough ? '<del style="color: var(--text-light);">' : ''; 
    const closeTag = isStrikethrough ? '</del>' : '';

    return `<tr>
                <td>${openTag}${dataFormatada}${closeTag}</td>
                <td>${openTag}${icone} ${gasto.descricao}${closeTag}</td>
                <td>${openTag}${formatCurrency(gasto.valor)}${closeTag}</td>
            </tr>`;
}

function calcularMesFatura(dataGasto, diaFechamento) {
    const dia = dataGasto.getDate();
    const mes = dataGasto.getMonth(); 
    const ano = dataGasto.getFullYear();

    if (dia >= diaFechamento) {
        return new Date(ano, mes + 1, 1);
    } else {
        return new Date(ano, mes, 1);
    }
}

// ===============================================================
// FASE 3B: LÓGICA DE PAGAMENTO (v5.4 - Mudança de Destino)
// ===============================================================
async function handlePagarFaturaClick(cartao, valor) {
    if (valor <= 0) {
        alert("Esta fatura não tem valor a ser pago.");
        return;
    }

    const temSaldo = await verificarSaldoSuficiente(valor);
    if (!temSaldo) {
        alert("❌ Saldo em Caixa insuficiente para pagar esta fatura!");
        return; 
    }
    
    const valorFormatado = formatCurrency(valor);
    
    const today = new Date();
    const diaFechamento = cartao.diaFechamento || 1; 
    let mensagem = `Confirmar pagamento de ${valorFormatado} da fatura ${cartao.nome}? O valor sairá do seu Saldo em Caixa.`;

    if (today.getDate() < diaFechamento) {
        mensagem = `⚠️ ALERTA: A fatura ainda não fechou (fecha dia ${diaFechamento})!\n\nNovas compras feitas antes dessa data ainda podem entrar nesta fatura.\n\nTem certeza que quer pagar ${valorFormatado} agora?`;
    }
    
    const pagarFn = async () => {
        document.querySelectorAll('.fatura-header button').forEach(btn => btn.disabled = true);

        try {
            await updateSaldoGlobal(-valor);
            
            // ===============================================================
            // MUDANÇA (v5.4): Chama a nova função 'registrarPagamentoComoDespesa'
            // ===============================================================
            await registrarPagamentoComoDespesa(cartao, valor);
            
            hideModal('modal-confirm');
            loadGastosAgregados(); 
        } catch (error) {
            console.error("Erro ao pagar fatura:", error);
            alert("Não foi possível processar o pagamento.");
            loadGastosAgregados(); 
        }
    };
    
    modalMessage.textContent = mensagem; 
    showModal('modal-confirm', pagarFn);
}

// ===============================================================
// ATUALIZADO (v5.4): Lógica de Reversão
// ===============================================================
async function handleReverterPagamentoClick(cartao, valor) {
    if (valor <= 0) {
        console.warn("Tentativa de reverter fatura com valor zero.");
        return;
    }
    
    modalReverterMessage.textContent = `Tem certeza que quer reverter o pagamento da fatura ${cartao.nome} (${formatCurrency(valor)})? O valor será devolvido ao seu Saldo em Caixa.`;

    const reverterFn = async () => {
        // v5.4: Procura o pagamento em 'despesas' PRIMEIRO
        const despesasPath = `dados/${userId}/despesas/${currentYear}-${currentMonth}`;
        const pendenciasPath = `dados/${userId}/pendencias/${currentYear}-${currentMonth}`;
        
        try {
            let pagamentoId = null;
            let localPagamento = null; // 'despesas' ou 'pendencias'

            // 1. Procura em 'despesas'
            const despesasSnap = await get(ref(db, despesasPath));
            if (despesasSnap.exists()) {
                despesasSnap.forEach(child => {
                    const despesa = child.val();
                    if (despesa.descricao === `Pagamento Fatura ${cartao.nome}` && despesa.categoria === 'Fatura') {
                        pagamentoId = despesa.id;
                        localPagamento = 'despesas';
                    }
                });
            }

            // 2. Se não achou, procura em 'pendencias' (sistema antigo)
            if (!pagamentoId) {
                const pendenciasSnap = await get(ref(db, pendenciasPath));
                if (pendenciasSnap.exists()) {
                    pendenciasSnap.forEach(child => {
                        const pendencia = child.val();
                        if (pendencia.descricao === `Pagamento Fatura ${cartao.nome}` && pendencia.status === 'pago') {
                            pagamentoId = pendencia.id;
                            localPagamento = 'pendencias';
                        }
                    });
                }
            }

            if (!pagamentoId || !localPagamento) {
                 throw new Error("Registo de pagamento não encontrado.");
            }

            // 3. Remove o registo de pagamento do local correto
            const pathToRemover = (localPagamento === 'despesas') ? despesasPath : pendenciasPath;
            await remove(ref(db, `${pathToRemover}/${pagamentoId}`));
            
            // 4. Devolve o dinheiro ao saldo
            await updateSaldoGlobal(valor);
            
            hideModal('modal-reverter-confirm');
            loadGastosAgregados(); 

        } catch (error) {
            console.error("Erro ao reverter pagamento:", error);
            alert(`Não foi possível reverter o pagamento. ${error.message}`);
            hideModal('modal-reverter-confirm');
        }
    };

    // --- CORREÇÃO (v5.3): Busca os botões do DOM pelo ID ---
    const currentConfirmBtn = document.getElementById('modal-reverter-btn-confirm');
    const currentCancelBtn = document.getElementById('modal-reverter-btn-cancel');

    if (!currentConfirmBtn || !currentCancelBtn) {
        console.error("Botões do modal 'modal-reverter-confirm' não encontrados.");
        return;
    }

    // (v5.4) Simplifica a lógica: apenas atribui o onclick, sem clonar.
    currentConfirmBtn.onclick = reverterFn;
    currentCancelBtn.onclick = () => hideModal('modal-reverter-confirm');
    
    modalReverter.style.display = 'flex';
}

async function updateSaldoGlobal(ajuste) {
    if (ajuste === 0) return; 
    const saldoRef = ref(db, `dados/${userId}/saldo/global`);
    try {
        const snapshot = await get(saldoRef);
        let saldoAcumulado = snapshot.val()?.saldoAcumulado || 0;
        saldoAcumulado += ajuste;
        await set(saldoRef, { saldoAcumulado: saldoAcumulado });
    } catch (error) {
        console.error("Erro ao atualizar saldo global:", error);
        throw error;
    }
}

// ===============================================================
// NOVA FUNÇÃO (v5.4): Registra o pagamento em 'despesas'
// ===============================================================
async function registrarPagamentoComoDespesa(cartao, valor) {
    const path = `dados/${userId}/despesas/${currentYear}-${currentMonth}`;
    
    const dataPagamentoObj = new Date();
    dataPagamentoObj.setMinutes(dataPagamentoObj.getMinutes() - dataPagamentoObj.getTimezoneOffset());
    const dataPagamento = dataPagamentoObj.toISOString().split('T')[0];
    
    const despesaFatura = {
        data: dataPagamento,
        categoria: "Fatura", // Categoria especial
        descricao: `Pagamento Fatura ${cartao.nome}`, 
        formaPagamento: 'Saldo em Caixa', // Sempre sai do saldo
        valor: valor,
        comprovante: null // Pagamento de fatura não tem comprovante
    };
    
    try {
        const newRef = push(ref(db, path));
        await set(newRef, { ...despesaFatura, id: newRef.key });
    } catch (error) {
        console.error("Erro ao registrar pagamento como despesa:", error);
        // Tenta reverter o saldo se o registro falhar
        await updateSaldoGlobal(valor); // Devolve o dinheiro
        throw error; // Propaga o erro para o 'handlePagarFaturaClick'
    }
}


// ===============================================================
// FUNÇÕES DE MODAL (COMPLETAS)
// ===============================================================
function showModal(modalId, confirmFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    modal.style.display = 'flex';

    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');

    // (v5.4) Apenas atribui, não clona (mais seguro)
    btnConfirm.onclick = confirmFn;
    btnCancel.onclick = () => hideModal(modalId);
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.style.display = 'none';
    }
}