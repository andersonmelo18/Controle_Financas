// js/cartoes.js
// VERSÃO 6.2 (Corrigido: Lógica de carregamento de dados anuais para faturas)

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
    "Serviços": "⚙️", "Outros": "📦", "Fatura": "💳"
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
const btnReverterConfirm = document.getElementById('modal-reverter-btn-confirm');
const btnReverterCancel = document.getElementById('modal-reverter-btn-cancel');

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

function listenToPath(path, callback) {
    const dataRef = ref(db, path);
    const listenerCallback = onValue(dataRef, callback);
    activeListeners.push({ ref: dataRef, callback: listenerCallback, eventType: 'value' });
}
// ===============================================================
// FASE 2A: GERENCIADOR DE CARTÕES (v6.1 - Caminho atualizado)
// ===============================================================
function loadGerenciadorCartoes() {
    limparListeners();

    // v6.1: Caminho atualizado
    const configPath = `usuarios/${userId}/cartoes/config`;
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
        tbodyMeusCartoes.innerHTML = '<tr><td colspan="6">Nenhum cartão cadastrado.</td></tr>';
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

        const limiteTotal = cartao.limiteTotal || 0;
        const faturaTotal = estadoFaturas[cartao.id]?.total || 0;
        const limiteDisponivel = limiteTotal - faturaTotal;
        const limiteDisponivelCor = limiteDisponivel < 0 ? 'var(--danger-color)' : 'var(--text-color)';

        tr.innerHTML = `
            <td>${cartao.icone} ${cartao.nome}</td>
            <td>${formatCurrency(limiteTotal)}</td>
            <td style="color: ${limiteDisponivelCor}; font-weight: 500;">${formatCurrency(limiteDisponivel)}</td>
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

// v6.1: Caminho atualizado
async function handleSalvarCartao(e) {
    e.preventDefault();
    const nome = cartaoNomeInput.value;

    const nomeExistente = Object.values(meusCartoes).some(c => c.nome.toLowerCase() === nome.toLowerCase());
    if (nomeExistente) {
        alert(`❌ Erro: Já existe um cartão com o nome "${nome}".`);
        return;
    }

    const newRef = push(ref(db, `usuarios/${userId}/cartoes/config`));
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

// v6.1: Caminho atualizado
async function handleSalvarEditCartao(e) {
    e.preventDefault();
    const id = formEdit.dataset.id;
    const path = `usuarios/${userId}/cartoes/config/${id}`;

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

// v6.1: Caminho atualizado
function handleDeleteCartaoClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const cartao = meusCartoes[id];
    if (!cartao) return;

    modalMessage.textContent = `Tem certeza que quer excluir o cartão "${cartao.nome}"? Isso não afeta os lançamentos já feitos.`;

    const deleteFn = async () => {
        try {
            await remove(ref(db, `usuarios/${userId}/cartoes/config/${id}`));
            hideModal('modal-confirm');
        } catch (error) {
            console.error("Erro ao excluir cartão:", error);
            alert("Não foi possível excluir o cartão.");
        }
    };

    showModal('modal-confirm', deleteFn);
}

// v6.1: Caminho atualizado
async function handleBlockToggleClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const cartao = meusCartoes[id];
    if (!cartao) return;

    const novoStatus = !(cartao.bloqueado || false);
    const path = `usuarios/${userId}/cartoes/config/${id}/bloqueado`;

    try {
        await set(ref(db, path), novoStatus);
    } catch (error) {
        console.error("Erro ao alterar status do cartão:", error);
        alert("Não foi possível alterar o status do cartão.");
    }
}

// ===============================================================
// FASE 3A: LÓGICA DE FATURAS (v6.2 - CAMINHOS CORRIGIDOS)
// ===============================================================

async function loadGastosAgregados() {
    estadoFaturas = {};

    // v6.2: CORREÇÃO: Carrega TODOS os dados, não apenas os de 2 meses.
    // Isto é essencial para a lógica de "avanço de fatura" (parcelamento).
    const paths = {
        despesas: `usuarios/${userId}/despesas`,
        fixos: `usuarios/${userId}/fixos`,
        specs: `usuarios/${userId}/cartoes_specs`,
        pendencias: `usuarios/${userId}/pendencias`
    };

    const promises = Object.keys(paths).map(key => get(ref(db, paths[key])));

    try {
        const results = await Promise.all(promises);

        // v6.2: Mapeia os resultados para o estado
        const estadoGastos = {
            despesas: results[0].val() || {},
            fixos: results[1].val() || {},
            specs: results[2].val() || {},
            pendencias: results[3].val() || {}
        };

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
                    <small>Vencimento: Dia ${cartao.diaVencimento} (Fechamento: Dia ${cartao.diaFechamento})</small>
                    <small id="limite-disponivel-${cartao.id}" style="font-weight: 500; display: block; margin-top: 4px;">
                        Limite Disponível: Calculando...
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

        tabContent.querySelector(`#btn-pagar-${cartao.id}`).addEventListener('click', (e) => {
            const total = parseFloat(e.currentTarget.dataset.totalValor || 0);
            handlePagarFaturaClick(cartao, total);
        });

        tabContent.querySelector(`#btn-reverter-pagamento-${cartao.id}`).addEventListener('click', (e) => {
            const total = parseFloat(e.currentTarget.dataset.totalValor || 0);
            handleReverterPagamentoClick(cartao, total);
        });

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
 * Função MESTRA de cálculo (v6.2 - Lógica de 'estadoGastos' corrigida)
 */
function renderizarFaturas(estadoGastos) {
    if (Object.keys(meusCartoes).length === 0) return;

    const dataFatura = new Date(currentYear, currentMonth - 1, 1);
    const dataFaturaAnterior = new Date(dataFatura);
    dataFaturaAnterior.setMonth(dataFaturaAnterior.getMonth() - 1);

    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataFaturaAnterior.getFullYear()}-${(dataFaturaAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    // v6.2: Extrai os dados dos meses relevantes dos dados GLOBAIS
    const despesasMesAtual = estadoGastos.despesas[mesAtualPath] || {};
    const despesasMesAnt = estadoGastos.despesas[mesAnteriorPath] || {};
    const fixosMesAtual = estadoGastos.fixos[mesAtualPath] || {};
    const fixosMesAnt = estadoGastos.fixos[mesAnteriorPath] || {};
    const pendenciasMesAtual = estadoGastos.pendencias[mesAtualPath] || {};
    const pendenciasMesAnt = estadoGastos.pendencias[mesAnteriorPath] || {};

    const statusPagamentoAtual = {};
    const statusPagamentoAnterior = {};

    Object.values(meusCartoes).forEach(cartao => {
        const nomeFatura = `Pagamento Fatura ${cartao.nome}`;

        const pagoEmDespesas = Object.values(despesasMesAtual).some(p =>
            p.descricao === nomeFatura && p.categoria === 'Fatura'
        );
        const pagoEmPendencias = Object.values(pendenciasMesAtual).some(p =>
            p.descricao === nomeFatura && p.status === 'pago'
        );
        statusPagamentoAtual[cartao.id] = pagoEmDespesas || pagoEmPendencias;

        statusPagamentoAnterior[cartao.id] = Object.values(pendenciasMesAnt).some(p =>
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

    // v6.2: Usa os dados dos meses relevantes
    const fontesGastos = [
        ...Object.values(despesasMesAnt),
        ...Object.values(despesasMesAtual),
        ...Object.values(fixosMesAnt),
        ...Object.values(fixosMesAtual)
    ];

    fontesGastos.forEach(gasto => {
        if (gasto.categoria === 'Fatura') return;

        if (!gasto.data && !gasto.vencimento) return;
        const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === gasto.formaPagamento);
        if (!cartaoConfig) return;

        const dataGasto = new Date((gasto.data || gasto.vencimento) + 'T12:00:00');
        
        // 1. Calcula o mês ORIGINAL do gasto
        let mesOriginalFatura = calcularMesFatura(dataGasto, cartaoConfig.diaFechamento);
        const isFaturaAtualOriginal = (mesOriginalFatura.getFullYear() === dataFatura.getFullYear() &&
                                      mesOriginalFatura.getMonth() === dataFatura.getMonth());

        // 2. Se for deste mês, SEMPRE adiciona no Histórico (HTML)
        if (isFaturaAtualOriginal) {
            estadoFaturas[cartaoConfig.id].html += renderLinhaGasto(gasto);
        }

        // 3. Agora, calcula o mês ALVO (com roll-over) para o TOTAL
        
        // !! ESTA É A LINHA QUE EU CORRIGI !!
        // Precisamos criar uma CÓPIA da data, senão alteramos a original
        let mesFaturaAlvo = new Date(mesOriginalFatura.getTime()); 

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

        // 4. Se o mês ALVO (pós roll-over) ainda for o atual, soma no Total
        if (mesFaturaAlvo.getFullYear() === dataFatura.getFullYear() &&
            mesFaturaAlvo.getMonth() === dataFatura.getMonth()) {

            estadoFaturas[cartaoConfig.id].total += gasto.valor;
        }
    });

    // v6.2: Agora esta lógica funciona, pois 'estadoGastos.pendencias' e 'estadoGastos.despesas'
    // contêm TODOS os meses, permitindo que o 'while (true)' funcione corretamente.
    Object.values(estadoGastos.specs).forEach(compra => {
        const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === compra.cartao);
        if (!cartaoConfig) return;

        if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
            console.warn('Compra parcelada ignorada (dataInicio inválida):', compra.descricao);
            return;
        }

        // início REAL da compra (não avança mais nada!)
        const [anoInicioOriginal, mesInicioOriginal] = compra.dataInicio.split('-').map(Number);
        const dataInicioVirtual = new Date(anoInicioOriginal, mesInicioOriginal - 1, 1);

        // cálculo correto da parcela do mês
        const startYear = dataInicioVirtual.getFullYear();
        const startMonth = dataInicioVirtual.getMonth() + 1;

        const mesesDiff =
            (dataFatura.getFullYear() - startYear) * 12 +
            ((dataFatura.getMonth() + 1) - startMonth);

        const parcelaAtualLabel = mesesDiff + 1;

        // Exibe a parcela correspondente ao mês atual
        if (parcelaAtualLabel >= 1 && parcelaAtualLabel <= compra.parcelas) {

            const status = compra.status || 'ativo';
            const valorParcelaOriginal = compra.valorTotal / compra.parcelas;

            let valorParaTotal = 0;
            let isStrikethrough = false;
            let parcelaLabel = `(${parcelaAtualLabel}/${compra.parcelas})`;

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

            // 1. SEMPRE adiciona no Histórico (HTML),
            // mostrando o valor original da parcela (com/sem 'strikethrough')
            estadoFaturas[cartaoConfig.id].html += renderLinhaGasto({
                data: `${currentYear}-${currentMonth}-01`, // Data simbólica para ordenação
                descricao: `${compra.descricao} ${parcelaLabel}`,
                valor: valorParcelaOriginal,
                categoria: 'Parcela',
                tipo: 'spec',
                isStrikethrough: isStrikethrough // Aplica o 'riscado' se for adiantamento
            });

            // 2. SÓ adiciona ao Total a pagar (valorParaTotal)
            // se a fatura atual NÃO estiver paga.
            const isPaga = statusPagamentoAtual[cartaoConfig.id];
            if (!isPaga) {
                estadoFaturas[cartaoConfig.id].total += valorParaTotal;
            }
        }
    });



    Object.values(meusCartoes).forEach(cartao => {
        const fatura = estadoFaturas[cartao.id];
        const totalAbaEl = document.getElementById(`total-aba-${cartao.id}`);
        const totalEl = document.getElementById(`total-fatura-${cartao.id}`);
        const tbodyEl = document.getElementById(`tbody-fatura-${cartao.id}`);
        const btnPagarEl = document.getElementById(`btn-pagar-${cartao.id}`);
        const btnReverterEl = document.getElementById(`btn-reverter-pagamento-${cartao.id}`);
        const limiteDisponivelEl = document.getElementById(`limite-disponivel-${cartao.id}`);

        if (!totalEl || !tbodyEl || !btnPagarEl || !btnReverterEl || !totalAbaEl || !limiteDisponivelEl) return;

        const limiteTotal = cartao.limiteTotal || 0;
        const limiteDisponivel = limiteTotal - fatura.total;
        const limiteCor = limiteDisponivel < 0 ? 'var(--danger-color)' : 'var(--text-color)';

        limiteDisponivelEl.textContent = `Limite Disponível: ${formatCurrency(limiteDisponivel)}`;
        limiteDisponivelEl.style.color = limiteCor;

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
// FASE 3B: LÓGICA DE PAGAMENTO (v6.1 - Caminhos atualizados)
// ===============================================================
async function handlePagarFaturaClick(cartao, valor) {
    if (valor <= 0) {
        alert("Esta fatura não tem valor a ser pago.");
        return;
    }

    // verificarSaldoSuficiente() já usa 'usuarios/' (via main.js v4.1)
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

// v6.1: Caminhos atualizados
async function handleReverterPagamentoClick(cartao, valor) {
    if (valor <= 0) {
        console.warn("Tentativa de reverter fatura com valor zero. Buscando valor no DB...");
    }

    modalReverterMessage.textContent = `Tem certeza que quer reverter o pagamento da fatura ${cartao.nome} (${formatCurrency(valor)})? O valor será devolvido ao seu Saldo em Caixa.`;

    const reverterFn = async () => {
        // v6.1: Caminhos atualizados
        const despesasPath = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;
        const pendenciasPath = `usuarios/${userId}/pendencias/${currentYear}-${currentMonth}`;

        let valorAReverter = valor;

        try {
            let pagamentoId = null;
            let localPagamento = null;

            // 1. Procura em 'despesas'
            const despesasSnap = await get(ref(db, despesasPath));
            if (despesasSnap.exists()) {
                despesasSnap.forEach(child => {
                    const despesa = child.val();
                    if (despesa.descricao === `Pagamento Fatura ${cartao.nome}` && despesa.categoria === 'Fatura') {
                        pagamentoId = despesa.id;
                        valorAReverter = despesa.valor;
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
                            valorAReverter = pendencia.valor;
                            localPagamento = 'pendencias';
                        }
                    });
                }
            }

            if (!pagamentoId || !localPagamento) {
                throw new Error("Registo de pagamento não encontrado.");
            }

            if (valorAReverter <= 0) {
                throw new Error("Valor do pagamento é zero. Não é possível reverter.");
            }

            const pathToRemover = (localPagamento === 'despesas') ? despesasPath : pendenciasPath;
            await remove(ref(db, `${pathToRemover}/${pagamentoId}`));

            await updateSaldoGlobal(valorAReverter);

            hideModal('modal-reverter-confirm');
            loadGastosAgregados();

        } catch (error) {
            console.error("Erro ao reverter pagamento:", error);
            alert(`Não foi possível reverter o pagamento. ${error.message}`);
            hideModal('modal-reverter-confirm');
        }
    };

    const btnConfirm = document.getElementById('modal-reverter-btn-confirm');
    const btnCancel = document.getElementById('modal-reverter-btn-cancel');

    if (!btnConfirm || !btnCancel) {
        console.error("Botões do modal 'modal-reverter-confirm' não encontrados.");
        return;
    }

    // (v6.1) Garante que os listeners são sempre novos
    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    newBtnConfirm.onclick = reverterFn;

    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    newBtnCancel.onclick = () => hideModal('modal-reverter-confirm');

    modalReverter.style.display = 'flex';
}

// v6.1: Caminho atualizado
async function updateSaldoGlobal(ajuste) {
    if (ajuste === 0) return;
    const saldoRef = ref(db, `usuarios/${userId}/saldo/global`);
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

// v6.1: Caminho atualizado
async function registrarPagamentoComoDespesa(cartao, valor) {
    const path = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;

    const dataPagamentoObj = new Date();
    dataPagamentoObj.setMinutes(dataPagamentoObj.getMinutes() - dataPagamentoObj.getTimezoneOffset());
    const dataPagamento = dataPagamentoObj.toISOString().split('T')[0];

    const despesaFatura = {
        data: dataPagamento,
        categoria: "Fatura",
        descricao: `Pagamento Fatura ${cartao.nome}`,
        formaPagamento: 'Saldo em Caixa',
        valor: valor,
        comprovante: null
    };

    try {
        const newRef = push(ref(db, path));
        await set(newRef, { ...despesaFatura, id: newRef.key });
    } catch (error) {
        console.error("Erro ao registrar pagamento como despesa:", error);
        await updateSaldoGlobal(valor);
        throw error;
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

    // (v6.1) Clona para remover listeners antigos
    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    newBtnConfirm.onclick = confirmFn;

    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    newBtnCancel.onclick = () => hideModal(modalId);
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}