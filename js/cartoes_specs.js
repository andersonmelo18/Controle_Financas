// js/cartoes_specs.js
// VERSÃO 4.2 (Atualizado para Autenticação Google e caminho 'usuarios/')

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
    getCartoesHtmlOptions
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');

let cartaoConfigMap = {};
let cartaoIcones = {};
let allSpecs = {};
let allPendencias = {};
let activeListeners = [];

// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-add-parcela');
const dataCompraInput = document.getElementById('cartao-data-compra');
const cartaoSelect = document.getElementById('cartao-utilizado');
const descricaoInput = document.getElementById('cartao-descricao');
const valorTotalInput = document.getElementById('cartao-valor-total');
const numParcelasInput = document.getElementById('cartao-num-parcelas');

// ---- Elementos DOM (Novas Tabelas e KPIs) ----
const mesDisplayFaturaEl = document.getElementById('mes-display-fatura');
const tbodyParcelasDoMes = document.getElementById('tbody-parcelas-do-mes');
const totalParcelasMesEl = document.getElementById('total-parcelas-mes');
const tbodyMasterList = document.getElementById('tbody-master-list');

// ---- Modais (Padrão) ----
const modalConfirm = document.getElementById('modal-confirm');
const modalMessage = document.getElementById('modal-message');

// ---- Modais (Edição) ----
const modalEdit = document.getElementById('modal-edit-parcela');
const formEdit = document.getElementById('form-edit-parcela');
const editCartaoSelect = document.getElementById('edit-cartao-utilizado');
const editDescricaoInput = document.getElementById('edit-cartao-descricao');
const editValorTotalInput = document.getElementById('edit-cartao-valor-total');
const editNumParcelasInput = document.getElementById('edit-cartao-num-parcelas');
const editDataInicioInput = document.getElementById('edit-cartao-data-inicio');
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');

// ---- Modais (Novas Ações) ----
const modalQuitar = document.getElementById('modal-quitar-confirm');
const modalQuitarMessage = document.getElementById('modal-quitar-message');
const btnQuitarConfirm = document.getElementById('modal-quitar-btn-confirm');
const btnQuitarCancel = document.getElementById('modal-quitar-btn-cancel');

const modalEstorno = document.getElementById('modal-estorno-confirm');
const modalEstornoMessage = document.getElementById('modal-estorno-message');
const btnEstornoConfirm = document.getElementById('modal-estorno-btn-confirm');
const btnEstornoCancel = document.getElementById('modal-estorno-btn-cancel');


// ===============================================================
// 1. INICIALIZAÇÃO (v4.1 - Lógica mantida)
// ===============================================================
document.addEventListener('authReady', async (e) => {
    userId = e.detail.userId;

    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        updateDataInput();
        renderUI();
    });

    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    updateDataInput();
    await loadDynamicCardData(); // Espera os cartões carregarem
    loadAllData(); // Começa a ouvir os dados

    form.addEventListener('submit', handleFormSubmit);
    formEdit.addEventListener('submit', handleSaveEdit);
    btnCancelEdit.addEventListener('click', () => modalEdit.style.display = 'none');
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
// 2. CARREGAMENTO DE DADOS (v4.2 - Caminhos atualizados)
// ===============================================================

function loadAllData() {
    limparListeners();
    if (!userId) return;

    // v4.2: Caminhos atualizados
    listenToPath(`usuarios/${userId}/cartoes_specs`, (snapshot) => {
        allSpecs = snapshot.val() || {};
        renderUI();
    });

    listenToPath(`usuarios/${userId}/pendencias`, (snapshot) => {
        allPendencias = snapshot.val() || {};
        renderUI();
    });
}

// v4.2: Caminho atualizado
async function loadDynamicCardData() {
    if (!userId) return;

    // getCartoesHtmlOptions() já busca de 'usuarios/' (via main.js v4.1)
    const cartoesHtml = await getCartoesHtmlOptions();

    if (cartaoSelect) cartaoSelect.innerHTML = cartoesHtml;
    if (editCartaoSelect) editCartaoSelect.innerHTML = cartoesHtml;

    // v4.2: Caminho atualizado
    const configRef = ref(db, `usuarios/${userId}/cartoes/config`);
    try {
        const snapshot = await get(configRef);
        cartaoConfigMap = {};
        cartaoIcones = {};
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const cartao = child.val();
                if (cartao.nome && cartao.icone) {
                    cartaoIcones[cartao.nome] = cartao.icone;
                    cartaoConfigMap[cartao.nome] = cartao;
                }
            });
        }
    } catch (error) {
        console.error("Erro ao carregar ícones/config dos cartões:", error);
    }
}

// ===============================================================
// 3. RENDERIZAÇÃO DA UI (v4.0 - Lógica atualizada)
// ===============================================================
function renderUI() {
    if (!userId) return;

    const displayEl = document.getElementById('current-month-display');
    if (mesDisplayFaturaEl && displayEl) {
        mesDisplayFaturaEl.textContent = displayEl.textContent;
    }

    renderParcelasDoMes();
    renderMasterList();
}

function renderParcelasDoMes() {
    tbodyParcelasDoMes.innerHTML = '';
    let totalMes = 0;

    const dataFaturaAtual = new Date(currentYear, currentMonth - 1, 1);

    Object.values(allSpecs).forEach(compra => {

        if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
            console.warn('Compra parcelada ignorada (dataInicio inválida):', compra.descricao);
            return;
        }

        const dataInicioVirtual = calcularDataInicioVirtual(compra);
        const startYear = dataInicioVirtual.getFullYear();
        const startMonth = dataInicioVirtual.getMonth() + 1;

        // cálculo da parcela correspondente ao mês atual
        const mesesDiffParaFatura =
            (dataFaturaAtual.getFullYear() - startYear) * 12 +
            ((dataFaturaAtual.getMonth() + 1) - startMonth);

        const parcelaDoMes = mesesDiffParaFatura + 1;

        const valorParcela = compra.valorTotal / compra.parcelas;

        // Loop: mostrar TODAS as parcelas, independente do mês
        for (let i = 1; i <= compra.parcelas; i++) {

            const tr = document.createElement('tr');
            const icone = cartaoIcones[compra.cartao] || "💳";
            const [y, m, d] = (compra.dataCompra || "---").split('-');

            // status visual opcional (mostra se a compra foi estornada/quitada)
            let statusTag = '';
            if (compra.status === 'quitado') {
                statusTag = '<span class="tag success">Quitada</span>';
            } else if (compra.status === 'estornado') {
                statusTag = '<span class="tag danger">Estornada</span>';
            } else if (compra.status === 'quitado_pagamento') {
                statusTag = '<span class="tag info">Quitado (lançamento)</span>';
            } else {
                statusTag = '<span class="tag neutral">Pendente</span>';
            }

            tr.innerHTML = `
                <td>${icone} ${compra.cartao}</td>
                <td>${compra.descricao}</td>
                <td>${(compra.dataCompra) ? `${d}/${m}/${y}` : 'N/A'}</td>
                <td>${i} / ${compra.parcelas}</td>
                <td>${formatCurrency(valorParcela)}</td>
                <td>${statusTag}</td>
            `;

            tbodyParcelasDoMes.appendChild(tr);

            // Somar AO TOTAL apenas a parcela que pertence ao mês selecionado
            if (i === parcelaDoMes && parcelaDoMes >= 1 && parcelaDoMes <= compra.parcelas) {
                totalMes += valorParcela;
            }
        }
    });

    totalParcelasMesEl.textContent = formatCurrency(totalMes);
}


function renderMasterList() {
    tbodyMasterList.innerHTML = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const compras = Object.values(allSpecs).sort((a, b) => (b.dataCompra || '').localeCompare(a.dataCompra || ''));

    compras.forEach(compra => {
        // Não pular 'quitado_pagamento' — mostrar histórico completo
        if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
            console.warn('Compra parcelada ignorada (dataInicio inválida):', compra.descricao);
            return;
        }

        const tr = document.createElement('tr');
        tr.dataset.id = compra.id;
        tr.dataset.cartao = compra.cartao;
        tr.dataset.descricao = compra.descricao;
        tr.dataset.valorTotal = compra.valorTotal;
        tr.dataset.numParcelas = compra.parcelas;
        tr.dataset.dataInicio = compra.dataInicio;
        tr.dataset.dataCompra = compra.dataCompra || '';

        const dataInicioVirtual = calcularDataInicioVirtual(compra);
        const [startYear, startMonth] = [dataInicioVirtual.getFullYear(), dataInicioVirtual.getMonth() + 1];

        const currentYearGlobal = today.getFullYear();
        const currentMonthGlobal = today.getMonth() + 1;

        let mesesDiff = (currentYearGlobal - startYear) * 12 + (currentMonthGlobal - startMonth);
        let parcelaAtual = mesesDiff + 1;
        let progressoLabel, statusLabel;

        if (compra.status === 'quitado') {
            progressoLabel = `Quitada`;
            statusLabel = `<span class="tag success">Quitada</span>`;
        } else if (compra.status === 'estornado') {
            progressoLabel = `Estornada`;
            statusLabel = `<span class="tag danger">Estornada</span>`;
        } else if (parcelaAtual > compra.parcelas) {
            progressoLabel = `Finalizado (${compra.parcelas}/${compra.parcelas})`;
            statusLabel = `<span class="tag success">Quitada</span>`;
        } else if (parcelaAtual < 1) {
            progressoLabel = `A iniciar (${compra.parcelas}x)`;
            statusLabel = `<span class="tag warning">Ativa</span>`;
        } else {
            progressoLabel = `${parcelaAtual}/${compra.parcelas}`;
            statusLabel = `<span class="tag warning">Ativa</span>`;
        }

        const [yC, mC, dC] = (compra.dataCompra || "---").split('-');
        const dataCompraFmt = (compra.dataCompra) ? `${dC}/${mC}/${yC}` : 'N/A';
        const [yI, mI] = compra.dataInicio.split('-');
        const dataInicioFmt = `${mI}/${yI}`;

        const icone = cartaoIcones[compra.cartao] || "💳";

        const isAtiva = (compra.status !== 'estornado' && parcelaAtual <= compra.parcelas);

        tr.innerHTML = `
            <td>${dataCompraFmt}</td>
            <td>${dataInicioFmt}</td>
            <td>${icone} ${compra.cartao}</td>
            <td>${compra.descricao}</td>
            <td>${formatCurrency(compra.valorTotal)}</td>
            <td>${progressoLabel}</td>
            <td>${statusLabel}</td>
            <td class="actions">
                <button class="btn-icon success btn-quitar" title="Quitar Antecipadamente" ${!isAtiva ? 'disabled' : ''}>
                    <span class="material-icons-sharp">done_all</span>
                </button>
                <button class="btn-icon danger btn-estornar" title="Estornar Compra" ${!isAtiva ? 'disabled' : ''}>
                    <span class="material-icons-sharp">remove_shopping_cart</span>
                </button>
                <button class="btn-icon warning btn-edit" title="Editar">
                    <span class="material-icons-sharp">edit</span>
                </button>
                <button class="btn-icon danger btn-delete-parcela" title="Excluir Registro">
                    <span class="material-icons-sharp">delete</span>
                </button>
            </td>
        `;

        tr.querySelector('.btn-delete-parcela').addEventListener('click', handleDeleteClick);
        tr.querySelector('.btn-edit').addEventListener('click', handleEditClick);
        tr.querySelector('.btn-quitar').addEventListener('click', handleQuitarClick);
        tr.querySelector('.btn-estornar').addEventListener('click', handleEstornoClick);

        tbodyMasterList.appendChild(tr);
    });
}

// ===============================================================
// 4. LÓGICA DO FORMULÁRIO (CRIAR) (v4.2 - Caminho atualizado)
// ===============================================================

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    const dataCompra = dataCompraInput.value;
    const cartaoNome = cartaoSelect.value;
    const descricao = descricaoInput.value;
    const valorTotal = parseCurrency(valorTotalInput.value);
    const numParcelas = parseInt(numParcelasInput.value);

    if (valorTotal <= 0 || numParcelas <= 0) {
        alert("Valor total e número de parcelas devem ser maiores que zero.");
        return;
    }
    if (!cartaoNome) {
        alert("Por favor, selecione um cartão.");
        return;
    }
    if (!dataCompra) {
        alert("Por favor, selecione a data da compra.");
        return;
    }

    const cartaoConfig = cartaoConfigMap[cartaoNome];
    if (!cartaoConfig) {
        alert("Erro: Configuração do cartão não encontrada. Tente recarregar a página.");
        return;
    }

    const diaFechamento = cartaoConfig.diaFechamento;
    const dataCompraObj = new Date(dataCompra + 'T12:00:00'); // Evita fuso

    const mesPrimeiraParcela = calcularMesFatura(dataCompraObj, diaFechamento);
    const dataInicioString = `${mesPrimeiraParcela.getFullYear()}-${(mesPrimeiraParcela.getMonth() + 1).toString().padStart(2, '0')}`;

    // v4.2: Caminho atualizado
    const path = `usuarios/${userId}/cartoes_specs`;
    const newCompraRef = push(ref(db, path));

    await set(newCompraRef, {
        id: newCompraRef.key,
        cartao: cartaoNome,
        descricao: descricao,
        valorTotal: valorTotal,
        parcelas: numParcelas,
        dataCompra: dataCompra,
        dataInicio: dataInicioString,
        status: 'ativo'
    });

    alert("Compra parcelada registrada com sucesso!");
    form.reset();
    updateDataInput(); // Reseta a data
}

// ===============================================================
// 5. HELPER (Funções de Cálculo) (v4.0 - Lógica mantida)
// ===============================================================
function calcularMesFatura(dataGasto, diaFechamento) {
    const dia = dataGasto.getDate();
    const mes = dataGasto.getMonth(); // 0 = Jan, 11 = Dez
    const ano = dataGasto.getFullYear();

    if (dia >= diaFechamento) {
        return new Date(ano, mes + 1, 1);
    } else {
        return new Date(ano, mes, 1);
    }
}

function calcularDataInicioVirtual(compra) {
    if (!compra || !compra.dataInicio) return new Date();

    const [anoCompra, mesCompra] = compra.dataInicio.split('-');
    if (!anoCompra || !mesCompra) return new Date();

    let dataInicioVirtual = new Date(anoCompra, mesCompra - 1, 1);

    const cartaoConfig = cartaoConfigMap[compra.cartao];
    if (!cartaoConfig) return dataInicioVirtual;

    const nomeFatura = `Pagamento Fatura ${compra.cartao}`;

    // avança enquanto existir confirmação de pagamento na pendências
    while (true) {
        const path = `${dataInicioVirtual.getFullYear()}-${(dataInicioVirtual.getMonth() + 1).toString().padStart(2, '0')}`;
        const pendenciasDesseMes = allPendencias[path] || {};
        const faturaPaga = Object.values(pendenciasDesseMes).some(p =>
            p.descricao === nomeFatura && p.status === 'pago'
        );

        if (faturaPaga) {
            dataInicioVirtual.setMonth(dataInicioVirtual.getMonth() + 1);
        } else {
            break;
        }
    }
    return dataInicioVirtual;
}

function calcularValorRestante(compra) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dataInicioVirtual = calcularDataInicioVirtual(compra);
    const [startYear, startMonth] = [dataInicioVirtual.getFullYear(), dataInicioVirtual.getMonth() + 1];

    const currentYearGlobal = today.getFullYear();
    const currentMonthGlobal = today.getMonth() + 1;

    let mesesDiff = (currentYearGlobal - startYear) * 12 + (currentMonthGlobal - startMonth);
    let parcelaAtual = mesesDiff + 1;

    if (parcelaAtual < 1) parcelaAtual = 1;
    if (parcelaAtual > compra.parcelas) return 0;

    const parcelasRestantes = (compra.parcelas - parcelaAtual) + 1;
    const valorParcela = compra.valorTotal / compra.parcelas;

    return valorParcela * parcelasRestantes;
}

// ===============================================================
// 6. AÇÕES DA TABELA (v4.2 - Caminhos atualizados)
// ===============================================================

// v4.2: Caminho atualizado
function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    const masterId = tr.dataset.id;

    const deleteFn = async () => {
        // v4.2: Caminho atualizado
        await remove(ref(db, `usuarios/${userId}/cartoes_specs/${masterId}`));
        hideModal('modal-confirm');
    };

    modalMessage.textContent = "Excluir esta compra? Todas as parcelas (pagas e futuras) serão removidas das faturas.";
    showModal('modal-confirm', deleteFn);
}

// v4.2: Caminho atualizado
function handleEditClick(e) {
    const tr = e.target.closest('tr');

    const id = tr.dataset.id;
    const cartao = tr.dataset.cartao;
    const descricao = tr.dataset.descricao;
    const valorTotal = parseFloat(tr.dataset.valorTotal);
    const numParcelas = tr.dataset.numParcelas;
    const dataInicio = tr.dataset.dataInicio;

    formEdit.dataset.id = id;
    // v4.2: Caminho atualizado
    formEdit.dataset.path = `usuarios/${userId}/cartoes_specs/${id}`;

    editCartaoSelect.value = cartao;
    editDescricaoInput.value = descricao;
    editValorTotalInput.value = formatCurrency(valorTotal);
    editNumParcelasInput.value = numParcelas;
    editDataInicioInput.value = dataInicio;

    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;

    const id = formEdit.dataset.id;
    const path = formEdit.dataset.path; // Já contém 'usuarios/'

    const novosDados = {
        cartao: editCartaoSelect.value,
        descricao: editDescricaoInput.value,
        valorTotal: parseCurrency(editValorTotalInput.value),
    };

    if (novosDados.valorTotal <= 0) {
        alert("O valor deve ser maior que zero.");
        return;
    }

    try {
        await update(ref(db, path), novosDados);
        modalEdit.style.display = 'none';
    } catch (error) {
        console.error("Erro ao salvar edição:", error);
        alert("Não foi possível salvar as alterações.");
    }
}

function handleQuitarClick(e) {
    const id = e.target.closest('tr').dataset.id;
    const compra = allSpecs[id];
    if (!compra) return;

    const valorRestante = calcularValorRestante(compra);

    modalQuitarMessage.innerHTML = `Quitar <strong>${compra.descricao}</strong>? <br>
        O valor restante de <strong>${formatCurrency(valorRestante)}</strong> 
        será lançado na sua fatura do mês atual.`;

    const newBtnConfirm = btnQuitarConfirm.cloneNode(true);
    btnQuitarConfirm.parentNode.replaceChild(newBtnConfirm, btnQuitarConfirm);

    newBtnConfirm.onclick = () => executarQuitacao(compra, valorRestante);
    btnQuitarCancel.onclick = () => hideModal('modal-quitar-confirm');

    modalQuitar.style.display = 'flex';
}

// v4.2: Caminhos atualizados
async function executarQuitacao(compra, valorRestante) {
    // NÃO marcamos a compra original como 'quitado' automaticamente,
    // para que ela continue visível no histórico. Em vez disso registramos
    // o lançamento (lançamento de pagamento) como um novo registro,
    // preservando o histórico original.

    const cartaoConfig = cartaoConfigMap[compra.cartao];
    if (!cartaoConfig) {
        alert("Erro: Configuração do cartão não encontrada.");
        return;
    }

    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const dataCompra = today.toISOString().split('T')[0];

    const mesPrimeiraParcela = calcularMesFatura(today, cartaoConfig.diaFechamento);
    const dataInicioString = `${mesPrimeiraParcela.getFullYear()}-${(mesPrimeiraParcela.getMonth() + 1).toString().padStart(2, '0')}`;

    // v4.2: Caminho atualizado - cria o registro de quitação (lançamento)
    const path = `usuarios/${userId}/cartoes_specs`;
    const newCompraRef = push(ref(db, path));

    await set(newCompraRef, {
        id: newCompraRef.key,
        cartao: compra.cartao,
        descricao: `(Quitação) ${compra.descricao}`,
        valorTotal: valorRestante,
        parcelas: 1,
        dataCompra: dataCompra,
        dataInicio: dataInicioString,
        status: 'quitado_pagamento'
    });

    // Para que o sistema trate essa quitação como pagamento da fatura e avance
    // a "dataInicioVirtual" quando apropriado, podemos também criar uma pendência
    // de pagamento com a descrição que o calcularDataInicioVirtual busca:
    const pendPath = `usuarios/${userId}/pendencias`;
    const pendRef = push(ref(db, pendPath));
    const nomeFatura = `Pagamento Fatura ${compra.cartao}`;
    await set(pendRef, {
        id: pendRef.key,
        descricao: nomeFatura,
        valor: valorRestante,
        status: 'pago',
        data: dataCompra
    });

    hideModal('modal-quitar-confirm');
}

function handleEstornoClick(e) {
    const id = e.target.closest('tr').dataset.id;
    const compra = allSpecs[id];
    if (!compra) return;

    modalEstornoMessage.innerHTML = `Estornar <strong>${compra.descricao}</strong>? <br>
        Todas as parcelas futuras serão zeradas e não aparecerão nas faturas.`;

    const newBtnConfirm = btnEstornoConfirm.cloneNode(true);
    btnEstornoConfirm.parentNode.replaceChild(newBtnConfirm, btnEstornoConfirm);

    newBtnConfirm.onclick = () => executarEstorno(compra);
    btnEstornoCancel.onclick = () => hideModal('modal-estorno-confirm');

    modalEstorno.style.display = 'flex';
}

// v4.2: Caminho atualizado
async function executarEstorno(compra) {
    const pathCompra = `usuarios/${userId}/cartoes_specs/${compra.id}`;
    await update(ref(db, pathCompra), { status: 'estornado' });
    hideModal('modal-estorno-confirm');
}

// ===============================================================
// 7. Funções Utilitárias de Data e Modal (v4.0 - Lógica mantida)
// ===============================================================
function updateDataInput() {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayISO = today.toISOString().split('T')[0];

    const dataReferencia = new Date(currentYear, currentMonth - 1, 1);
    dataReferencia.setMinutes(dataReferencia.getMinutes() - dataReferencia.getTimezoneOffset());
    const inicioMesISO = dataReferencia.toISOString().split('T')[0];

    const todayYear = today.getFullYear();
    const todayMonth = (today.getMonth() + 1).toString().padStart(2, '0');

    if (todayYear == currentYear && todayMonth == currentMonth) {
        dataCompraInput.value = todayISO;
    } else {
        dataCompraInput.value = inicioMesISO;
    }
}

function showModal(modalId, confirmFn) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.style.display = 'flex';

    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');

    const newBtnConfirm = btnConfirm.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);

    newBtnConfirm.onclick = confirmFn;
    newBtnCancel.onclick = () => hideModal(modalId);

    btnConfirm.replaceWith(newBtnConfirm);
    btnCancel.replaceWith(newBtnCancel);
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}
