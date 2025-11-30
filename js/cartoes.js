// js/cartoes.js
// VERSÃO 6.2+ (consolidado) — inclui: Pagamento Individual, Pagamento Parcial, Pagar Agora

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

const pagarAgoraContainer = document.getElementById('pagar-agora-container');
const pagarAgoraBtn = document.getElementById('btn-pagar-agora');

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

const modalPagarIndividual = document.getElementById('modal-pagar-individual');
const pagarIndividualDescricao = document.getElementById('pagar-individual-descricao');
const pagarIndividualValor = document.getElementById('pagar-individual-valor');
const pagarIndividualConfirm = document.getElementById('pagar-individual-confirm');
const pagarIndividualCancel = document.getElementById('pagar-individual-cancel');

const modalParcial = document.getElementById('modal-pagamento-parcial');
const parcialDescricao = document.getElementById('pag-parcial-descricao');
const parcialInput = document.getElementById('pag-parcial-input');
const parcialConfirm = document.getElementById('pag-parcial-confirm');
const parcialCancel = document.getElementById('pag-parcial-cancel');

const modalPagarAgora = document.getElementById('modal-pagar-agora');
const pagarAgoraDescricao = document.getElementById('pagar-agora-descricao');
const pagarAgoraTotalEl = document.getElementById('pagar-agora-total');
const pagarAgoraConfirm = document.getElementById('pagar-agora-confirm');
const pagarAgoraCancel = document.getElementById('pagar-agora-cancel');

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

    // listeners dos modais extras
    if (pagarIndividualCancel) pagarIndividualCancel.addEventListener('click', () => modalPagarIndividual.style.display = 'none');
    if (parcialCancel) parcialCancel.addEventListener('click', () => modalParcial.style.display = 'none');
    if (pagarAgoraCancel) pagarAgoraCancel.addEventListener('click', () => modalPagarAgora.style.display = 'none');

    if (pagarAgoraBtn) {
        pagarAgoraBtn.addEventListener('click', () => {
            openPagarAgoraModal();
        });
    }

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
// GERENCIADOR DE CARTÕES
// ===============================================================
function loadGerenciadorCartoes() {
    limparListeners();

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

// salvar/editar/excluir/bloco de cartões (mantido igual)
async function handleSalvarCartao(e) {
    e.preventDefault();
    const nome = cartaoNomeInput.value.trim();
    if (!nome) return;

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

async function handleSalvarEditCartao(e) {
    e.preventDefault();
    const id = formEdit.dataset.id;
    if (!id) return;
    const path = `usuarios/${userId}/cartoes/config/${id}`;

    const nomeEditado = editCartaoNomeInput.value.trim();
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
            await remove(ref(db, `usuarios/${userId}/cartoes/config/${id}`));
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
    const path = `usuarios/${userId}/cartoes/config/${id}/bloqueado`;

    try {
        await set(ref(db, path), novoStatus);
    } catch (error) {
        console.error("Erro ao alterar status do cartão:", error);
        alert("Não foi possível alterar o status do cartão.");
    }
}

// ===============================================================
// LÓGICA DE FATURAS
// ===============================================================
async function loadGastosAgregados() {
    estadoFaturas = {};

    const paths = {
        despesas: `usuarios/${userId}/despesas`,
        fixos: `usuarios/${userId}/fixos`,
        specs: `usuarios/${userId}/cartoes_specs`,
        pendencias: `usuarios/${userId}/pendencias`
    };

    const promises = Object.keys(paths).map(key => get(ref(db, paths[key])));

    try {
        const results = await Promise.all(promises);

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

        // Adiciona botão de pagamento parcial e manter o pagar/reverter padrão
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
                    <button class="btn-secondary" id="btn-parcial-${cartao.id}" style="display:none;">Pagamento Parcial</button>
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

        // Delegar listeners depois de renderizar as abas (em renderizarFaturas)
        faturasTabContent.appendChild(tabContent);
    });
}

function handleTabClick(e) {
    const targetId = e.target.closest('.tab-btn').dataset.cartaoId;
    faturasTabNav.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    faturasTabContent.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    const btn = faturasTabNav.querySelector(`.tab-btn[data-cartao-id="${targetId}"]`);
    if (btn) btn.classList.add('active');
    const content = faturasTabContent.querySelector(`.tab-content[data-cartao-id="${targetId}"]`);
    if (content) content.style.display = 'block';
}

function ativarPrimeiraAba() {
    const firstTabBtn = faturasTabNav.querySelector('.tab-btn');
    if (firstTabBtn) firstTabBtn.click();
}

/**
 * renderizarFaturas agora:
 * - adiciona botões por linha para pagar compra individual
 * - liga botões de pagamento parcial e pagar agora
 */
function renderizarFaturas(estadoGastos) {
    if (Object.keys(meusCartoes).length === 0) return;

    const dataFatura = new Date(currentYear, currentMonth - 1, 1);
    const dataFaturaAnterior = new Date(dataFatura);
    dataFaturaAnterior.setMonth(dataFaturaAnterior.getMonth() - 1);

    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataFaturaAnterior.getFullYear()}-${(dataFaturaAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

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

    const fontesGastos = [
        ...Object.values(despesasMesAnt),
        ...Object.values(despesasMesAtual),
        ...Object.values(fixosMesAnt),
        ...Object.values(fixosMesAtual)
    ];

    // Processa gastos variáveis/fixos (adiciona botão pagar por linha quando aplicável)
    fontesGastos.forEach(gasto => {
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

            // passa cartaoId para o renderer para poder criar botão por linha
            estadoFaturas[cartaoConfig.id].total += gasto.valor;
            estadoFaturas[cartaoConfig.id].html += renderLinhaGasto(gasto, cartaoConfig.id);
        }
    });

    // >>> SUBSTITUIR AQUI: tratamento das "specs" (parcelas)
Object.values(estadoGastos.specs).forEach(compra => {
    const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === (compra.cartao || compra.cartao));
    if (!cartaoConfig) return;

    // somente masters (tem dataInicio) — se for nó mensal, ele aparece como objeto sem dataInicio e será ignorado aqui
    if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
        // Se for um nó mensal (ex: { '2025': { '11': { 'id_1': {...} }}}), ignoramos nesta iteração
        // Isso mantém compatibilidade com sua estrutura atual.
        if (!compra.id) {
            // nó inválido para master — pular
            return;
        }
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

    if (parcelaAtualLabel < 1 || parcelaAtualLabel > compra.parcelas) {
        return;
    }

    // verifica se existe uma parcela mensal marcada como 'pago' no nó mensal:
    const anoNode = estadoGastos.specs[dataFatura.getFullYear()] || {};
    const mesNode = anoNode[(dataFatura.getMonth() + 1).toString().padStart(2, '0')] || {};
    const parcelaKey = `${compra.id}_${parcelaAtualLabel}`;
    const parcelaMensal = mesNode[parcelaKey];

    let status = compra.status || 'ativo';
    let valorParcelaOriginal = compra.valorTotal / compra.parcelas;
    let valorParaTotal = 0;
    let isStrikethrough = false;
    let parcelaLabel = `(${parcelaAtualLabel}/${compra.parcelas})`;

    // Se a parcela mensal existe e está com status 'pago', não somamos o valor
    if (parcelaMensal && parcelaMensal.status === 'pago') {
        valorParaTotal = 0;
        isStrikethrough = true;
        parcelaLabel = `(Pago)`;
    } else {
        // aplicar regras do master (quitado, estornado, quitado_pagamento, ativo)
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
});


    // Preenche UI para cada cartão e liga eventos
    Object.values(meusCartoes).forEach(cartao => {
        const fatura = estadoFaturas[cartao.id];
        const totalAbaEl = document.getElementById(`total-aba-${cartao.id}`);
        const totalEl = document.getElementById(`total-fatura-${cartao.id}`);
        const tbodyEl = document.getElementById(`tbody-fatura-${cartao.id}`);
        const btnPagarEl = document.getElementById(`btn-pagar-${cartao.id}`);
        const btnReverterEl = document.getElementById(`btn-reverter-pagamento-${cartao.id}`);
        const btnParcialEl = document.getElementById(`btn-parcial-${cartao.id}`);
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

        // botão de pagar agora (por cartão)
        btnPagarEl.className = 'btn-primary';
        btnReverterEl.className = 'btn-secondary danger';
        btnReverterEl.innerHTML = '<span class="material-icons-sharp">undo</span> Reverter Pagamento';

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const vencimentoDate = new Date(currentYear, currentMonth - 1, cartao.diaVencimento);
        vencimentoDate.setHours(0, 0, 0, 0);
        const isVencida = vencimentoDate < today;

        // mostra / oculta botões
        if (fatura.pago) {
            btnPagarEl.style.display = 'none';
            btnReverterEl.style.display = 'flex';
            btnReverterEl.classList.add('success');
            btnReverterEl.innerHTML = '<span class="material-icons-sharp">check_circle</span> Fatura Paga';
            totalEl.style.color = 'var(--success-color)';
            totalAbaEl.style.color = 'var(--success-color)';
            if (btnParcialEl) btnParcialEl.style.display = 'none';
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

            if (btnParcialEl) {
                btnParcialEl.style.display = 'inline-block';
                btnParcialEl.onclick = () => openParcialModal(cartao, fatura.total);
            }
        } else {
            btnPagarEl.style.display = 'flex';
            btnPagarEl.textContent = 'Sem Fatura';
            btnPagarEl.disabled = true;
            btnReverterEl.style.display = 'none';
            totalEl.style.color = 'var(--success-color)';
            totalAbaEl.style.color = 'var(--success-color)';
            if (btnParcialEl) btnParcialEl.style.display = 'none';
        }

        // ligar pagar/reverter (sempre rebind para não duplicar listeners)
        btnPagarEl.onclick = () => handlePagarFaturaClick(cartao, fatura.total);
        btnReverterEl.onclick = () => handleReverterPagamentoClick(cartao, fatura.total);

        // ligar pagamentos individuais (botões por linha)
        attachRowListeners(cartao.id);
    });

    // mostrar botão global Pagar Agora se houver faturas a pagar
    const somaTotal = Object.values(estadoFaturas).reduce((s, f) => s + (f.total || 0), 0);
    if (pagarAgoraContainer) {
        pagarAgoraContainer.style.display = somaTotal > 0 ? 'block' : 'none';
    }
}

function renderTotalGastosCartoes() {
    let totalMes = 0;
    for (const id in estadoFaturas) {
        totalMes += estadoFaturas[id].total;
    }
    totalGastosCartoesEl.textContent = formatCurrency(totalMes);
}

/**
 * renderLinhaGasto agora aceita cartaoId opcional para adicionar botão pagar por linha.
 * gasto: {data, descricao, valor, categoria, tipo, isStrikethrough}
 */
function renderLinhaGasto(gasto, cartaoId = '') {
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

    // só criar botão de pagar compra individual para gastos que não sejam 'Fatura' ou 'spec' (parcelas)
    let botaoPagarHTML = '';
    if (!isStrikethrough && gasto.categoria !== 'Fatura' && gasto.tipo !== 'spec' && cartaoId) {
        const valorAttr = gasto.valor != null ? gasto.valor : 0;
        const descricaoEsc = (gasto.descricao || '').replace(/"/g, '&quot;');
        botaoPagarHTML = `<button class="btn-small btn-pagar-compra" data-cartao-id="${cartaoId}" data-descricao="${descricaoEsc}" data-valor="${valorAttr}" style="margin-left:8px;">Pagar</button>`;
    }

    return `<tr>
                <td>${openTag}${dataFormatada}${closeTag}</td>
                <td>${openTag}${icone} ${gasto.descricao} ${botaoPagarHTML}${closeTag}</td>
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
// LÓGICA DE PAGAMENTO
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
            await registrarPagamentoComoDespesa(cartao, valor);

            hideModal('modal-confirm');
            loadGastosAgregados();
        } catch (error) {
            console.error("Erro ao pagar fatura:", error);
            alert("Não foi possível processar o pagamento.");
            loadGastosAgregados();
        } finally {
            document.querySelectorAll('.fatura-header button').forEach(btn => btn.disabled = false);
        }
    };

    modalMessage.textContent = mensagem;
    showModal('modal-confirm', pagarFn);
}

async function handleReverterPagamentoClick(cartao, valor) {
    if (valor <= 0) {
        console.warn("Tentativa de reverter fatura com valor zero. Buscando valor no DB...");
    }

    modalReverterMessage.textContent = `Tem certeza que quer reverter o pagamento da fatura ${cartao.nome} (${formatCurrency(valor)})? O valor será devolvido ao seu Saldo em Caixa.`;

    const reverterFn = async () => {
        const despesasPath = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;
        const pendenciasPath = `usuarios/${userId}/pendencias/${currentYear}-${currentMonth}`;

        let valorAReverter = valor;

        try {
            let pagamentoId = null;
            let localPagamento = null;

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

    const newBtnConfirm = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    newBtnConfirm.onclick = reverterFn;

    const newBtnCancel = btnCancel.cloneNode(true);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
    newBtnCancel.onclick = () => hideModal('modal-reverter-confirm');

    modalReverter.style.display = 'flex';
}

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
// NOVAS FUNCIONALIDADES: Pagamento Individual, Parcial, Pagar Agora
// ===============================================================

/**
 * Anexa listeners nos botões "Pagar" que foram renderizados dentro das linhas.
 * Usa seletor por cartaoId para evitar selecionar botões de outros cartões.
 */
function attachRowListeners(cartaoId) {
    const selector = `.btn-pagar-compra[data-cartao-id="${cartaoId}"]`;
    const buttons = Array.from(document.querySelectorAll(selector));
    buttons.forEach(btn => {
        // evita rebind se já tiver handler
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            const descricao = btn.dataset.descricao || '';
            const valor = parseFloat(btn.dataset.valor || 0);
            openPagarIndividualModal(cartaoId, descricao, valor, btn);
        });
    });
}

function openPagarIndividualModal(cartaoId, descricao, valor, originatingButton = null) {
    const cartao = meusCartoes[cartaoId];
    if (!cartao) return;
    pagarIndividualDescricao.textContent = `${cartao.icone} ${cartao.nome} — ${descricao}`;
    pagarIndividualValor.textContent = formatCurrency(valor);

    // linkar confirm dinamicamente (clona para evitar multiplos listeners)
    if (!pagarIndividualConfirm) return;
    const newConfirm = pagarIndividualConfirm.cloneNode(true);
    pagarIndividualConfirm.parentNode.replaceChild(newConfirm, pagarIndividualConfirm);

    newConfirm.addEventListener('click', async () => {
        newConfirm.disabled = true;
        try {
            // evita pagar a mesma compra mais de uma vez: checar se já existe despesa com essa descricao e valor
            const despesasPath = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;
            const despesasSnap = await get(ref(db, despesasPath));
            let jaPago = false;
            if (despesasSnap.exists()) {
                despesasSnap.forEach(child => {
                    const d = child.val();
                    if (d.descricao === `Pagamento Compra ${descricao}` && d.valor === valor) {
                        jaPago = true;
                    }
                });
            }
            if (jaPago) {
                alert('Esta compra já foi paga (registro encontrado).');
                modalPagarIndividual.style.display = 'none';
                return;
            }

            const temSaldo = await verificarSaldoSuficiente(valor);
            if (!temSaldo) {
                alert("❌ Saldo em Caixa insuficiente para pagar esta compra!");
                return;
            }

            await updateSaldoGlobal(-valor);

            // criar despesa de pagamento da compra para registro e evitar pagamentos duplicados
            const dataPagamentoObj = new Date();
            dataPagamentoObj.setMinutes(dataPagamentoObj.getMinutes() - dataPagamentoObj.getTimezoneOffset());
            const dataPagamento = dataPagamentoObj.toISOString().split('T')[0];

            const despesa = {
                data: dataPagamento,
                categoria: "Fatura",
                descricao: `Pagamento Compra ${descricao}`,
                formaPagamento: 'Saldo em Caixa',
                valor: valor,
                comprovante: null
            };

            const newRef = push(ref(db, despesasPath));
            await set(newRef, { ...despesa, id: newRef.key });

            // feedback visual: desabilitar botão de origem (se fornecido)
            if (originatingButton) {
                originatingButton.disabled = true;
                originatingButton.textContent = 'Pago';
            }

            modalPagarIndividual.style.display = 'none';
            loadGastosAgregados();
        } catch (error) {
            console.error('Erro ao pagar compra individual:', error);
            alert('Não foi possível processar o pagamento.');
        } finally {
            newConfirm.disabled = false;
        }
    });

    modalPagarIndividual.style.display = 'flex';
}

/**
 * Pagamento Parcial: abre modal onde usuário digita valor parcial e confirma.
 */
function openParcialModal(cartao, totalFatura) {
    parcialDescricao.textContent = `${cartao.icone} ${cartao.nome} — Total: ${formatCurrency(totalFatura)}`;
    parcialInput.value = formatCurrency(0);

    // clona botão para remover listeners antigos
    if (!parcialConfirm) return;
    const newConfirm = parcialConfirm.cloneNode(true);
    parcialConfirm.parentNode.replaceChild(newConfirm, parcialConfirm);

    newConfirm.addEventListener('click', async () => {
        const raw = (parcialInput.value || '').toString();
        const valor = parseCurrency(raw) || 0;
        if (valor <= 0) {
            alert('Digite um valor válido maior que zero.');
            return;
        }
        if (valor > totalFatura) {
            if (!confirm('Valor maior que o total da fatura. Deseja prosseguir e pagar o total?')) return;
        }

        const temSaldo = await verificarSaldoSuficiente(valor);
        if (!temSaldo) {
            alert("❌ Saldo em Caixa insuficiente para esse pagamento!");
            return;
        }

        try {
            await updateSaldoGlobal(-valor);

            // registra como despesa com descrição indicando pagamento parcial
            const path = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;
            const dataPagamentoObj = new Date();
            dataPagamentoObj.setMinutes(dataPagamentoObj.getMinutes() - dataPagamentoObj.getTimezoneOffset());
            const dataPagamento = dataPagamentoObj.toISOString().split('T')[0];

            const despesa = {
                data: dataPagamento,
                categoria: "Fatura",
                descricao: `Pagamento Parcial Fatura ${cartao.nome}`,
                formaPagamento: 'Saldo em Caixa',
                valor: valor,
                comprovante: null
            };

            const newRef = push(ref(db, path));
            await set(newRef, { ...despesa, id: newRef.key });

            modalParcial.style.display = 'none';
            loadGastosAgregados();
        } catch (error) {
            console.error('Erro no pagamento parcial:', error);
            alert('Não foi possível processar o pagamento parcial.');
        }
    });

    modalParcial.style.display = 'flex';
}

/**
 * Pagar Agora (global): soma todas as faturas e, se houver saldo, registra pagamentos por cartão.
 */
function openPagarAgoraModal() {
    const cartoes = Object.values(meusCartoes);
    const faturasAPagar = cartoes.map(c => ({ id: c.id, nome: c.nome, total: estadoFaturas[c.id]?.total || 0 }))
        .filter(f => f.total > 0);

    const totalAll = faturasAPagar.reduce((s, f) => s + f.total, 0);
    pagarAgoraTotalEl.textContent = formatCurrency(totalAll);

    pagarAgoraDescricao.textContent = faturasAPagar.map(f => `${f.nome}: ${formatCurrency(f.total)}`).join(' — ') || 'Nenhuma fatura';

    if (!pagarAgoraConfirm) return;
    const newConfirm = pagarAgoraConfirm.cloneNode(true);
    pagarAgoraConfirm.parentNode.replaceChild(newConfirm, pagarAgoraConfirm);

    newConfirm.addEventListener('click', async () => {
        if (totalAll <= 0) {
            alert('Não há faturas a pagar agora.');
            modalPagarAgora.style.display = 'none';
            return;
        }

        const temSaldo = await verificarSaldoSuficiente(totalAll);
        if (!temSaldo) {
            alert('Saldo insuficiente para pagar todas as faturas de uma vez.');
            return;
        }

        newConfirm.disabled = true;
        try {
            // executa pagamentos sequenciais; se falhar em algum ponto, interrompe e mostra erro
            for (const f of faturasAPagar) {
                const cartao = Object.values(meusCartoes).find(c => c.nome === f.nome || c.id === f.id);
                if (!cartao) continue;

                await updateSaldoGlobal(-f.total);
                await registrarPagamentoComoDespesa(cartao, f.total);
            }

            modalPagarAgora.style.display = 'none';
            loadGastosAgregados();
        } catch (error) {
            console.error('Erro ao pagar agora:', error);
            alert('Falha ao processar pagamentos. Verifique o console.');
            loadGastosAgregados();
        } finally {
            newConfirm.disabled = false;
        }
    });

    modalPagarAgora.style.display = 'flex';
}

// ===============================================================
// HELPERS: evitar listeners múltiplos nos modais (showModal/hideModal mantidos)
// ===============================================================
function showModal(modalId, confirmFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'flex';

    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');

    if (!btnConfirm || !btnCancel) return;

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
