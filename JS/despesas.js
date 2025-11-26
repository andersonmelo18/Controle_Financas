// js/despesas.js
// VERSÃO 4.2 (Adicionado: Comprovante de Despesa)

import {
    db,
    ref,
    set,
    get,
    push,
    remove,
    onValue,
    off,
    update
} from './firebase-config.js';
import {
    getUserId,
    formatCurrency,
    parseCurrency,
    verificarSaldoSuficiente,
    getCartoesHtmlOptions
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
let activeListener = null;

let allDespesasDoMes = [];
let currentFilters = {
    categoria: 'todas',
    pagamento: 'todos',
    busca: ''
};

const PAGAMENTO_AFETA_SALDO = ['Saldo em Caixa', 'Pix', 'Dinheiro'];

// ---- Mapas de Ícones (para a tabela) ----
const categoriaIcones = {
    "Casa": "🏠", "Alimentação": "🛒", "Restaurante": "🍽️", "Transporte": "🚗",
    "Lazer": "🍿", "Saúde": "🩺", "Educação": "🎓", "Compras": "🛍️",
    "Serviços": "⚙️", "Outros": "📦"
};
const pagamentoIcones = {
    "Saldo em Caixa": "🏦",
    "Pix": "📱",
    "Dinheiro": "💵"
    // Cartões são adicionados dinamicamente
};

// ===============================================================
// 1. HELPER DE DATA (CORREÇÃO DE FUSO)
// ===============================================================
/**
 * Retorna a data local atual no formato 'YYYY-MM-DD'
 */
function getLocalDateISO() {
    const dataLocal = new Date();
    // Ajusta para o fuso horário local antes de converter para ISO string
    dataLocal.setMinutes(dataLocal.getMinutes() - dataLocal.getTimezoneOffset());
    return dataLocal.toISOString().split('T')[0];
}
// ===============================================================


// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-add-despesa');
const dataInput = document.getElementById('despesa-data');
const categoriaSelect = document.getElementById('despesa-categoria');
const descricaoInput = document.getElementById('despesa-descricao');
const formaPagamentoSelect = document.getElementById('despesa-forma-pagamento');
const valorInput = document.getElementById('despesa-valor');
// NOVO: Comprovante (Formulário Adição)
const comprovanteInput = document.getElementById('despesa-comprovante'); // ADICIONADO

// ---- Elementos DOM (Tabela e Totais) ----
const tbody = document.getElementById('tbody-despesas-variaveis');
const totalVariavelEl = document.getElementById('total-variavel'); // Total do MÊS
const totalFiltradoEl = document.getElementById('total-filtrado'); // NOVO: Total do que está visível

// ---- Elementos DOM (Filtros) ----
const filtroCategoria = document.getElementById('filtro-categoria');
const filtroFormaPagamento = document.getElementById('filtro-forma-pagamento');
const filtroBusca = document.getElementById('filtro-busca');
const btnLimparFiltros = document.getElementById('btn-limpar-filtros');

// ---- Modais ----
const modalConfirm = document.getElementById('modal-confirm');
const modalMessage = document.getElementById('modal-message');
const modalEdit = document.getElementById('modal-edit-despesa');
const formEdit = document.getElementById('form-edit-despesa');
const editDataInput = document.getElementById('edit-despesa-data');
const editCategoriaSelect = document.getElementById('edit-despesa-categoria');
const editDescricaoInput = document.getElementById('edit-despesa-descricao');
const editFormaPagamentoSelect = document.getElementById('edit-despesa-forma-pagamento');
const editValorInput = document.getElementById('edit-despesa-valor');
// NOVO: Comprovante (Formulário Edição)
const editComprovanteDisplay = document.getElementById('edit-comprovante-display'); // ADICIONADO
// Nota: O input de arquivo de edição deve ter o ID 'edit-despesa-comprovante' no HTML
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');


// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', async (e) => {
    userId = e.detail.userId;
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        updateDataInput();
        loadDespesas();
    });

    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    // 1. Popula os selects de filtro e formulário
    await loadDynamicCardData();
    populateFilterCategorias();

    // 2. Configura os listeners dos filtros
    filtroCategoria.addEventListener('change', (e) => {
        currentFilters.categoria = e.target.value;
        renderTabela();
    });
    filtroFormaPagamento.addEventListener('change', (e) => {
        currentFilters.pagamento = e.target.value;
        renderTabela();
    });
    filtroBusca.addEventListener('input', (e) => {
        currentFilters.busca = e.target.value.toLowerCase();
        renderTabela();
    });
    btnLimparFiltros.addEventListener('click', resetFilters);

    // 3. Carrega os dados
    updateDataInput();
    loadDespesas();

    // 4. Listeners dos Modais
    form.addEventListener('submit', handleFormSubmit); // Listener do form principal
    if (formEdit) {
        formEdit.addEventListener('submit', handleSaveEdit);
    }
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            modalEdit.style.display = 'none';
        });
    }
});

/**
 * Popula o dropdown de filtro de categorias
 */
function populateFilterCategorias() {
    filtroCategoria.innerHTML = '<option value="todas">Todas as Categorias</option>';
    for (const categoria in categoriaIcones) {
        const option = document.createElement('option');
        option.value = categoria;
        option.textContent = `${categoriaIcones[categoria]} ${categoria}`;
        filtroCategoria.appendChild(option);
    }
}

/**
 * Carrega os cartões e popula TODOS os selects de forma de pagamento
 */
async function loadDynamicCardData() {
    if (!userId) return;

    const cartoesHtml = await getCartoesHtmlOptions();

    // 1. Popula os selects de formulário
    if (formaPagamentoSelect) {
        formaPagamentoSelect.innerHTML += cartoesHtml;
    }
    if (editFormaPagamentoSelect) {
        editFormaPagamentoSelect.innerHTML += cartoesHtml;
    }

    // 2. Popula o select de FILTRO
    if (filtroFormaPagamento) {
        filtroFormaPagamento.innerHTML += cartoesHtml;
    }

    // 3. Atualiza o mapa de ÍCONES
    const configRef = ref(db, `dados/${userId}/cartoes/config`);
    try {
        const snapshot = await get(configRef);
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const cartao = child.val();
                if (cartao.nome && cartao.icone) {
                    pagamentoIcones[cartao.nome] = cartao.icone;
                }
            });
        }
    } catch (error) {
        console.error("Erro ao carregar ícones dos cartões:", error);
    }
}

function updateDataInput() {
    const today = new Date();
    // Ajusta para o fuso local
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const todayISO = today.toISOString().split('T')[0];

    const dataReferencia = new Date(currentYear, currentMonth - 1, 1);
    dataReferencia.setMinutes(dataReferencia.getMinutes() - dataReferencia.getTimezoneOffset());
    const inicioMesISO = dataReferencia.toISOString().split('T')[0];

    const todayYear = today.getFullYear();
    const todayMonth = (today.getMonth() + 1).toString().padStart(2, '0');

    if (todayYear == currentYear && todayMonth == currentMonth) {
        dataInput.value = todayISO;
    } else {
        dataInput.value = inicioMesISO;
    }
}

// ---- LÓGICA DO FORMULÁRIO (CRIAR) ----
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    // NOVO: Captura o nome do arquivo, se houver
    let comprovanteNome = null;
    if (comprovanteInput && comprovanteInput.files.length > 0) {
        // Por enquanto, apenas o nome do arquivo. A lógica de upload real seria aqui.
        comprovanteNome = comprovanteInput.files[0].name;
    }

    const data = {
        data: dataInput.value,
        categoria: categoriaSelect.value,
        descricao: descricaoInput.value,
        formaPagamento: formaPagamentoSelect.value,
        valor: parseCurrency(valorInput.value),
        comprovante: comprovanteNome // NOVO CAMPO
    };

    if (data.valor <= 0) {
        alert("O valor da despesa deve ser maior que zero.");
        return;
    }

    if (PAGAMENTO_AFETA_SALDO.includes(data.formaPagamento)) {
        const temSaldo = await verificarSaldoSuficiente(data.valor);
        if (!temSaldo) {
            alert("❌ Saldo em Caixa insuficiente para registrar esta despesa!");
            return;
        }
    }

    const [entryYear, entryMonth] = data.data.split('-');

    try {
        const path = `dados/${userId}/despesas/${entryYear}-${entryMonth}`;
        const newRef = push(ref(db, path));
        await set(newRef, { ...data, id: newRef.key });

        if (PAGAMENTO_AFETA_SALDO.includes(data.formaPagamento)) {
            await updateSaldoGlobal(-data.valor);
        }

        form.reset();
        updateDataInput();
        // Zera o input de arquivo (se houver)
        if (comprovanteInput) comprovanteInput.value = '';

    } catch (error) {
        console.error("Erro ao salvar despesa:", error);
        alert("Não foi possível salvar a despesa.");
    }
}

// ---- CARREGAR E RENDERIZAR DADOS ----

/**
 * 1. Carrega dados do Firebase e armazena em 'allDespesasDoMes'
 */
function loadDespesas() {
    if (!userId) return;

    if (activeListener) {
        off(activeListener.ref, 'value', activeListener.callback);
    }

    const path = `dados/${userId}/despesas/${currentYear}-${currentMonth}`;
    const dataRef = ref(db, path);

    const callback = (snapshot) => {
        allDespesasDoMes = []; // Limpa o array
        let totalMes = 0;

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const despesa = child.val();
                // O campo 'comprovante' está implícito no val() se existir
                allDespesasDoMes.push(despesa); // Adiciona ao array
                totalMes += despesa.valor;
            });
        }

        // Atualiza o total do MÊS (sempre visível)
        totalVariavelEl.textContent = formatCurrency(totalMes);

        // Agora, renderiza a tabela com os filtros atuais
        renderTabela();
    };

    onValue(dataRef, callback);
    activeListener = { ref: dataRef, callback: callback };
}

/**
 * 2. Aplica filtros, agrupa por dia e renderiza a tabela
 */
function renderTabela() {
    tbody.innerHTML = '';

    // 1. Aplicar Filtros
    const filtros = currentFilters;
    const despesasFiltradas = allDespesasDoMes.filter(despesa => {
        const matchCategoria = filtros.categoria === 'todas' || despesa.categoria === filtros.categoria;
        const matchPagamento = filtros.pagamento === 'todos' || despesa.formaPagamento === filtros.pagamento;
        const matchBusca = filtros.busca === '' || despesa.descricao.toLowerCase().includes(filtros.busca);
        return matchCategoria && matchPagamento && matchBusca;
    });

    // 2. Calcular Total Filtrado
    const totalFiltrado = despesasFiltradas.reduce((sum, d) => sum + d.valor, 0);
    totalFiltradoEl.textContent = formatCurrency(totalFiltrado);

    if (despesasFiltradas.length === 0) {
        // COLSPAN ajustado para 7 colunas (original era 6, agora com Comprovante é 7)
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma despesa encontrada para este mês ou filtro.</td></tr>';
        return;
    }

    // 3. Ordenar por data (mais nova primeiro)
    despesasFiltradas.sort((a, b) => b.data.localeCompare(a.data));

    // 4. Agrupar por Dia
    const despesasPorDia = {};
    for (const despesa of despesasFiltradas) {
        if (!despesasPorDia[despesa.data]) {
            despesasPorDia[despesa.data] = [];
        }
        despesasPorDia[despesa.data].push(despesa);
    }

    // 5. Renderizar Linhas Agrupadas
    for (const data in despesasPorDia) {
        const despesasDoDia = despesasPorDia[data];
        const totalDia = despesasDoDia.reduce((sum, d) => sum + d.valor, 0);

        // Renderiza o Cabeçalho do Dia (com Total Dia)
        const [y, m, d] = data.split('-');
        const dataFormatada = `${d}/${m}/${y}`;
        const trHeader = document.createElement('tr');
        trHeader.className = 'day-header';
        // NOVO CÓDIGO (Substitua o trecho anterior no seu js/despesas.js)
        // Garante 100% de largura
        trHeader.innerHTML = `
    <td colspan="7">
        <strong>${dataFormatada}</strong>
        <strong style="float: right;">${formatCurrency(totalDia)}</strong>
    </td>
`;
        tbody.appendChild(trHeader);

        // Renderiza as despesas daquele dia
        for (const despesa of despesasDoDia) {
            renderRow(despesa);
        }
    }
}

/**
 * 3. Renderiza UMA linha de despesa (AGORA COM CAMPO COMPROVANTE)
 */
function renderRow(despesa) {
    if (!despesa || !despesa.data) return;

    const tr = document.createElement('tr');
    tr.dataset.id = despesa.id;
    tr.dataset.valor = despesa.valor;
    tr.dataset.formaPagamento = despesa.formaPagamento;
    tr.dataset.data = despesa.data;
    tr.dataset.categoria = despesa.categoria;
    tr.dataset.descricao = despesa.descricao;
    tr.dataset.comprovante = despesa.comprovante || ''; // NOVO DATASET

    const [y, m, d] = despesa.data.split('-');
    const dataFormatada = `${d}/${m}/${y}`;

    const categoriaNome = despesa.categoria;
    const catIcone = categoriaIcones[categoriaNome] || "📦";

    const pagamentoNome = despesa.formaPagamento;
    const pagIcone = pagamentoIcones[pagamentoNome] || "💳";

    // NOVO: Lógica do Comprovante
    let comprovanteHtml = '-';
    if (despesa.comprovante && despesa.comprovante.trim() !== '') {
        comprovanteHtml = `
            <button class="btn-icon-small" onclick="alert('Visualizar arquivo: ${despesa.comprovante}')" title="Ver Comprovante">
             📎
            </button>
         `;
    }

    tr.innerHTML = `
    <td>${dataFormatada}</td>
    <td><span class="tag info">${catIcone} ${categoriaNome}</span></td>
    <td>${despesa.descricao}</td>

    <td class="text-center">${comprovanteHtml}</td> 
    
    <td>${pagIcone} ${pagamentoNome}</td>

    <td>${formatCurrency(despesa.valor)}</td>
    <td class="actions">
        <button class="btn-icon info btn-duplicate" title="Duplicar">
            <span class="material-icons-sharp">content_copy</span>
        </button>
        <button class="btn-icon warning btn-edit" title="Editar">
            <span class="material-icons-sharp">edit</span>
        </button>
        <button class="btn-icon danger btn-delete" title="Excluir">
            <span class="material-icons-sharp">delete</span>
        </button>
    </td>
`;

    tbody.appendChild(tr);

    // --- AQUI ESTÁ A CORREÇÃO DE SEGURANÇA ---
    // Verifica se o botão existe antes de tentar adicionar o evento
    const btnDuplicate = tr.querySelector('.btn-duplicate');
    const btnEdit = tr.querySelector('.btn-edit');
    const btnDelete = tr.querySelector('.btn-delete');

    if (btnDuplicate) btnDuplicate.addEventListener('click', handleDuplicateClick);
    if (btnEdit) btnEdit.addEventListener('click', handleEditClick);
    if (btnDelete) btnDelete.addEventListener('click', handleDeleteClick);
}

/**
 * 4. Limpa os filtros e re-renderiza a tabela
 */
function resetFilters() {
    currentFilters = { categoria: 'todas', pagamento: 'todos', busca: '' };

    filtroCategoria.value = 'todas';
    filtroFormaPagamento.value = 'todos';
    filtroBusca.value = '';

    renderTabela();
}

// ---- LÓGICA DE AÇÕES (DUPLICAR, DELETE, EDIT) ----

/**
 * Pré-preenche o formulário com os dados da linha clicada
 */
function handleDuplicateClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    // Pega os dados da linha
    const categoria = tr.dataset.categoria;
    const descricao = tr.dataset.descricao;
    const formaPagamento = tr.dataset.formaPagamento;
    const valor = parseFloat(tr.dataset.valor);
    // Não duplica o comprovante, pois um novo arquivo deve ser anexado.

    // Preenche o formulário no topo da página
    dataInput.value = getLocalDateISO();
    categoriaSelect.value = categoria;
    descricaoInput.value = descricao;
    formaPagamentoSelect.value = formaPagamento;
    valorInput.value = formatCurrency(valor);
    if (comprovanteInput) comprovanteInput.value = ''; // Limpa o campo de arquivo

    // Foca no formulário para o usuário
    descricaoInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Substitua a função handleDeleteClick por esta:
function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const valor = parseFloat(tr.dataset.valor);
    const formaPagamento = tr.dataset.formaPagamento;
    const data = tr.dataset.data;
    // NOTA: A exclusão do comprovante no Firebase Storage (se implementado) deveria vir aqui.

    if (!id || !data) {
        console.error("Erro: ID ou Data não encontrados na linha.");
        return;
    }

    const [entryYear, entryMonth] = data.split('-');
    const itemPath = `dados/${userId}/despesas/${entryYear}-${entryMonth}/${id}`;

    const deleteFn = async () => {
        try {
            if (PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
                await updateSaldoGlobal(valor);
            }
            await remove(ref(db, itemPath));
            hideModal('modal-confirm');
        } catch (error) {
            console.error("Erro ao excluir despesa:", error);
            alert("Não foi possível excluir a despesa.");
        }
    };

    modalMessage.textContent = 'Tem certeza que deseja excluir esta despesa?';
    showModal('modal-confirm', deleteFn);
}

// Substitua a função handleEditClick por esta (com suporte a Comprovante):
function handleEditClick(e) {
    console.log("--- Iniciando Edição ---");

    // 1. Tenta achar a linha da tabela (TR)
    const tr = e.target.closest('tr');

    if (!tr) {
        console.error("ERRO: Não foi possível encontrar a linha (TR).");
        return;
    }

    if (!formEdit) {
        console.error("ERRO CRÍTICO: O elemento HTML com id 'form-edit-despesa' NÃO FOI ENCONTRADO.");
        alert("Erro: O formulário de edição não existe no HTML. Verifique os IDs.");
        return;
    }

    const id = tr.dataset.id;
    const data = tr.dataset.data;
    const categoria = tr.dataset.categoria;
    const descricao = tr.dataset.descricao;
    const formaPagamento = tr.dataset.formaPagamento;
    const comprovante = tr.dataset.comprovante; // NOVO: Captura o comprovante antigo

    let valor = 0;
    if (tr.dataset.valor) {
        valor = parseFloat(tr.dataset.valor.replace(',', '.'));
    }

    if (!data || !data.includes('-')) {
        alert("Erro: Data inválida neste registro.");
        return;
    }

    const [entryYear, entryMonth] = data.split('-');

    // Armazena dados no formulário de edição
    formEdit.dataset.id = id;
    formEdit.dataset.entryPath = `dados/${userId}/despesas/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = valor;
    formEdit.dataset.formaPagamentoAntiga = formaPagamento;
    formEdit.dataset.comprovanteAntigo = comprovante; // NOVO: Guarda o comprovante antigo

    // Preenche os campos visuais
    if (editDataInput) editDataInput.value = data;
    if (editCategoriaSelect) editCategoriaSelect.value = categoria;
    if (editDescricaoInput) editDescricaoInput.value = descricao;

    // Tenta setar o select de pagamento
    if (editFormaPagamentoSelect) {
        let optionExists = Array.from(editFormaPagamentoSelect.options).some(opt => opt.value === formaPagamento);
        if (!optionExists && formaPagamento) {
            const tempOption = document.createElement('option');
            tempOption.value = formaPagamento;
            tempOption.text = formaPagamento + " (Antigo)";
            editFormaPagamentoSelect.add(tempOption);
        }
        editFormaPagamentoSelect.value = formaPagamento;
    }

    if (editValorInput) editValorInput.value = formatCurrency(valor);

    // NOVO: Exibir o comprovante existente
    if (editComprovanteDisplay) {
        editComprovanteDisplay.textContent = comprovante ? `Arquivo atual: ${comprovante}` : '';
        editComprovanteDisplay.style.display = comprovante ? 'block' : 'none';
    }
    const editFile = document.getElementById('edit-despesa-comprovante');
    if (editFile) editFile.value = ''; // Limpa o input de arquivo

    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;

    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath;
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const formaPagamentoAntiga = formEdit.dataset.formaPagamentoAntiga;
    const comprovanteAntigo = formEdit.dataset.comprovanteAntigo; // NOVO: Comprovante anterior

    // NOVO: Verifica se um novo arquivo foi selecionado
    let comprovanteNome = comprovanteAntigo;
    const editFile = document.getElementById('edit-despesa-comprovante');
    if (editFile && editFile.files.length > 0) {
        comprovanteNome = editFile.files[0].name;
    }

    const novosDados = {
        id: id,
        data: editDataInput.value,
        categoria: editCategoriaSelect.value,
        descricao: editDescricaoInput.value,
        formaPagamento: editFormaPagamentoSelect.value,
        valor: parseCurrency(editValorInput.value),
        comprovante: comprovanteNome // NOVO CAMPO
    };

    if (novosDados.valor <= 0) {
        alert("O valor deve ser maior que zero.");
        return;
    }

    try {
        const ajusteSaldo = await calcularAjusteSaldo(
            valorAntigo,
            novosDados.valor,
            formaPagamentoAntiga,
            novosDados.formaPagamento
        );

        if (ajusteSaldo < 0) {
            const temSaldo = await verificarSaldoSuficiente(Math.abs(ajusteSaldo));
            if (!temSaldo) {
                alert("❌ Saldo em Caixa insuficiente para esta alteração!");
                return;
            }
        }

        // Remove do mês antigo
        await remove(ref(db, path));

        // Adiciona ao mês novo (pode ser o mesmo ou um diferente)
        const [newYear, newMonth] = novosDados.data.split('-');
        const newPath = `dados/${userId}/despesas/${newYear}-${newMonth}/${id}`;
        await set(ref(db, newPath), novosDados);

        if (ajusteSaldo !== 0) {
            await updateSaldoGlobal(ajusteSaldo);
        }

        modalEdit.style.display = 'none';

    } catch (error) {
        console.error("Erro ao salvar edição:", error);
        alert("Não foi possível salvar as alterações.");
    }
}

async function calcularAjusteSaldo(valorAntigo, valorNovo, formaAntiga, formaNova) {
    const antigoAfeta = PAGAMENTO_AFETA_SALDO.includes(formaAntiga);
    const novoAfeta = PAGAMENTO_AFETA_SALDO.includes(formaNova);

    let ajuste = 0;

    if (antigoAfeta && novoAfeta) {
        ajuste = valorAntigo - valorNovo;
    }
    else if (antigoAfeta && !novoAfeta) {
        ajuste = valorAntigo;
    }
    else if (!antigoAfeta && novoAfeta) {
        ajuste = -valorNovo;
    }
    // else (!antigoAfeta && !novoAfeta) -> Ajuste = 0

    return ajuste;
}

// ---- Funções Utilitárias ----
async function updateSaldoGlobal(valor) {
    if (valor === 0) return;
    const saldoRef = ref(db, `dados/${userId}/saldo/global`);
    try {
        const snapshot = await get(saldoRef);
        let saldoAcumulado = snapshot.val()?.saldoAcumulado || 0;
        saldoAcumulado += valor;
        await set(saldoRef, { saldoAcumulado: saldoAcumulado });
    } catch (error) {
        console.error("Erro ao atualizar saldo global:", error);
    }
}

function showModal(modalId, confirmFn) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex';
    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');
    btnConfirm.replaceWith(btnConfirm.cloneNode(true));
    btnCancel.replaceWith(btnCancel.cloneNode(true));
    document.getElementById('modal-btn-confirm').onclick = confirmFn;
    document.getElementById('modal-btn-cancel').onclick = () => hideModal(modalId);
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}