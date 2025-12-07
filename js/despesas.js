// js/despesas.js
// VERSÃO 5.1 (Atualizado para Autenticação Google e caminho 'usuarios/')

import {
    db, 
    storage, // IMPORTA O STORAGE
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    off, 
    update,
    storageRef,     // IMPORTA AS FUNÇÕES DO STORAGE
    uploadBytes,
    getDownloadURL,
    deleteObject
} from './firebase-config.js';
import {
    getUserId, 
    formatCurrency, 
    parseCurrency, 
    verificarSaldoSuficiente, 
    getCartoesHtmlOptions,
    showToast 
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
    "Serviços": "⚙️", "Outros": "📦", "Fatura": "💳" 
};
const pagamentoIcones = {
    "Saldo em Caixa": "🏦",
    "Pix": "📱",
    "Dinheiro": "💵"
};

// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-add-despesa');
const dataInput = document.getElementById('despesa-data');
const categoriaSelect = document.getElementById('despesa-categoria');
const descricaoInput = document.getElementById('despesa-descricao');
const formaPagamentoSelect = document.getElementById('despesa-forma-pagamento');
const valorInput = document.getElementById('despesa-valor');
const comprovanteInput = document.getElementById('despesa-comprovante'); 
const btnSubmitForm = form.querySelector('button[type="submit"]'); 

// ---- Elementos DOM (Tabela e Totais) ----
const tbody = document.getElementById('tbody-despesas-variaveis');
const totalVariavelEl = document.getElementById('total-variavel'); 
const totalFiltradoEl = document.getElementById('total-filtrado'); 

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
const editComprovanteDisplay = document.getElementById('edit-comprovante-display'); 
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');


// (Funções de inicialização e helpers de data/filtros - Sem mudanças)

// ===============================================================
// INICIALIZAÇÃO (v4.2 - Sem mudanças)
// ===============================================================
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

    await loadDynamicCardData();
    populateFilterCategorias();

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

    updateDataInput();
    loadDespesas();

    form.addEventListener('submit', handleFormSubmit); 
    if (formEdit) {
        formEdit.addEventListener('submit', handleSaveEdit);
    }
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            modalEdit.style.display = 'none';
        });
    }
});

function getLocalDateISO() {
    const dataLocal = new Date();
    dataLocal.setMinutes(dataLocal.getMinutes() - dataLocal.getTimezoneOffset());
    return dataLocal.toISOString().split('T')[0];
}

function populateFilterCategorias() {
    filtroCategoria.innerHTML = '<option value="todas">Todas as Categorias</option>';
    for (const categoria in categoriaIcones) {
        // v5.0: Não adiciona 'Fatura' aos filtros
        if (categoria === 'Fatura') continue;
        const option = document.createElement('option');
        option.value = categoria;
        option.textContent = `${categoriaIcones[categoria]} ${categoria}`;
        filtroCategoria.appendChild(option);
    }
}

// v5.1: Caminho atualizado
async function loadDynamicCardData() {
    if (!userId) return;
    // getCartoesHtmlOptions() já busca de 'usuarios/' (via main.js v4.1)
    const cartoesHtml = await getCartoesHtmlOptions();

    if (formaPagamentoSelect) formaPagamentoSelect.innerHTML += cartoesHtml;
    if (editFormaPagamentoSelect) editFormaPagamentoSelect.innerHTML += cartoesHtml;
    if (filtroFormaPagamento) filtroFormaPagamento.innerHTML += cartoesHtml;

    // v5.1: Caminho atualizado
    const configRef = ref(db, `usuarios/${userId}/cartoes/config`);
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

// ===============================================================
// 2. NOVAS FUNÇÕES DE UPLOAD (v5.1 - Caminho atualizado)
// ===============================================================

async function uploadFile(file) {
    if (!userId) throw new Error("Usuário não autenticado.");
    
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}-${file.name}`;
    // v5.1: Caminho atualizado
    const storagePath = `usuarios/${userId}/comprovantes/${uniqueFileName}`;
    
    const fileRef = storageRef(storage, storagePath);

    await uploadBytes(fileRef, file);
    
    const downloadURL = await getDownloadURL(fileRef);
    
    return {
        url: downloadURL,
        path: storagePath 
    };
}

async function deleteFile(path) {
    if (!path) return;
    
    const fileRef = storageRef(storage, path);
    try {
        await deleteObject(fileRef);
    } catch (error) {
        if (error.code !== 'storage/object-not-found') {
            console.error("Erro ao excluir arquivo do Storage:", error);
        }
    }
}


// ===============================================================
// 3. LÓGICA DO FORMULÁRIO (CRIAR) - (v5.1 - Caminho atualizado)
// ===============================================================
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    btnSubmitForm.disabled = true;
    btnSubmitForm.textContent = 'Salvando...';

    let comprovanteData = null;

    try {
        if (comprovanteInput && comprovanteInput.files.length > 0) {
            const file = comprovanteInput.files[0];
            comprovanteData = await uploadFile(file); // uploadFile já usa 'usuarios/'
        }

        const data = {
            data: dataInput.value,
            categoria: categoriaSelect.value,
            descricao: descricaoInput.value,
            formaPagamento: formaPagamentoSelect.value,
            valor: parseCurrency(valorInput.value),
            comprovante: comprovanteData 
        };

        if (data.valor <= 0) {
            throw new Error("O valor da despesa deve ser maior que zero.");
        }

        if (PAGAMENTO_AFETA_SALDO.includes(data.formaPagamento)) {
             // verificarSaldoSuficiente() já usa 'usuarios/' (via main.js v4.1)
            const temSaldo = await verificarSaldoSuficiente(data.valor);
            if (!temSaldo) {
                throw new Error("Saldo em Caixa insuficiente para registrar esta despesa!");
            }
        }

        const [entryYear, entryMonth] = data.data.split('-');
        
        // v5.1: Caminho atualizado
        const path = `usuarios/${userId}/despesas/${entryYear}-${entryMonth}`;
        const newRef = push(ref(db, path));
        await set(newRef, { ...data, id: newRef.key });

        if (PAGAMENTO_AFETA_SALDO.includes(data.formaPagamento)) {
            await updateSaldoGlobal(-data.valor);
        }

        form.reset();
        updateDataInput();
        if (comprovanteInput) comprovanteInput.value = '';

        // [MUDANÇA] Notificação de Sucesso adicionada aqui
        showToast("Despesa salva com sucesso!", "success");

    } catch (error) {
        console.error("Erro ao salvar despesa:", error);
        
        // [MUDANÇA] Alert substituído por Toast de Erro
        showToast(`Erro ao salvar: ${error.message}`, "error");
        
        if (comprovanteData && comprovanteData.path) {
            console.warn("Revertendo upload do arquivo órfão...");
            await deleteFile(comprovanteData.path);
        }
    } finally {
        btnSubmitForm.disabled = false;
        btnSubmitForm.textContent = 'Adicionar Despesa';
    }
}

// ===============================================================
// 4. LÓGICA DE RENDERIZAÇÃO (v5.1 - Caminho atualizado)
// ===============================================================
function loadDespesas() {
    if (!userId) return;
    if (activeListener) off(activeListener.ref, 'value', activeListener.callback);

    // v5.1: Caminho atualizado
    const path = `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`;
    const dataRef = ref(db, path);

    const callback = (snapshot) => {
        allDespesasDoMes = []; 
        let totalMes = 0;

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const despesa = child.val();
                allDespesasDoMes.push(despesa); 
                totalMes += despesa.valor;
            });
        }
        totalVariavelEl.textContent = formatCurrency(totalMes);
        renderTabela();
    };

    onValue(dataRef, callback);
    activeListener = { ref: dataRef, callback: callback };
}

function renderTabela() {
    tbody.innerHTML = '';

    const filtros = currentFilters;
    const despesasFiltradas = allDespesasDoMes.filter(despesa => {
        const matchCategoria = filtros.categoria === 'todas' || despesa.categoria === filtros.categoria;
        const matchPagamento = filtros.pagamento === 'todos' || despesa.formaPagamento === filtros.pagamento;
        const matchBusca = filtros.busca === '' || despesa.descricao.toLowerCase().includes(filtros.busca);
        return matchCategoria && matchPagamento && matchBusca;
    });

    const totalFiltrado = despesasFiltradas.reduce((sum, d) => sum + d.valor, 0);
    totalFiltradoEl.textContent = formatCurrency(totalFiltrado);

    if (despesasFiltradas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma despesa encontrada para este mês ou filtro.</td></tr>';
        return;
    }

    despesasFiltradas.sort((a, b) => b.data.localeCompare(a.data));

    const despesasPorDia = {};
    for (const despesa of despesasFiltradas) {
        if (!despesasPorDia[despesa.data]) {
            despesasPorDia[despesa.data] = [];
        }
        despesasPorDia[despesa.data].push(despesa);
    }

    for (const data in despesasPorDia) {
        const despesasDoDia = despesasPorDia[data];
        const totalDia = despesasDoDia.reduce((sum, d) => sum + d.valor, 0);

        const [y, m, d] = data.split('-');
        const dataFormatada = `${d}/${m}/${y}`;
        const trHeader = document.createElement('tr');
        trHeader.className = 'day-header';
        trHeader.innerHTML = `
            <td colspan="7">
                <strong>${dataFormatada}</strong>
                <strong style="float: right;">${formatCurrency(totalDia)}</strong>
            </td>
        `;
        tbody.appendChild(trHeader);

        for (const despesa of despesasDoDia) {
            renderRow(despesa);
        }
    }
}

/**
 * Renderiza UMA linha de despesa (v5.0 - Lógica mantida)
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
    
    const comp = despesa.comprovante; // { url: "...", path: "..." }
    tr.dataset.comprovanteUrl = comp ? comp.url : '';
    tr.dataset.comprovantePath = comp ? comp.path : ''; 

    const [y, m, d] = despesa.data.split('-');
    const dataFormatada = `${d}/${m}/${y}`;

    const categoriaNome = despesa.categoria;
    const catIcone = categoriaIcones[categoriaNome] || "📦";

    const pagamentoNome = despesa.formaPagamento;
    const pagIcone = pagamentoIcones[pagamentoNome] || "💳";

    let comprovanteHtml = '-';
    if (comp && comp.url) {
        comprovanteHtml = `
            <a href="${comp.url}" target="_blank" class="btn-icon-small" title="Ver Comprovante">
              📎
            </a>
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

    const btnDuplicate = tr.querySelector('.btn-duplicate');
    const btnEdit = tr.querySelector('.btn-edit');
    const btnDelete = tr.querySelector('.btn-delete');

    if (btnDuplicate) btnDuplicate.addEventListener('click', handleDuplicateClick);
    if (btnEdit) btnEdit.addEventListener('click', handleEditClick);
    if (btnDelete) btnDelete.addEventListener('click', handleDeleteClick);
}

function resetFilters() {
    currentFilters = { categoria: 'todas', pagamento: 'todos', busca: '' };
    filtroCategoria.value = 'todas';
    filtroFormaPagamento.value = 'todos';
    filtroBusca.value = '';
    renderTabela();
}

// ===============================================================
// 5. LÓGICA DE AÇÕES (v5.1 - Caminhos atualizados)
// ===============================================================

function handleDuplicateClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    dataInput.value = getLocalDateISO();
    categoriaSelect.value = tr.dataset.categoria;
    descricaoInput.value = tr.dataset.descricao;
    formaPagamentoSelect.value = tr.dataset.formaPagamento;
    valorInput.value = formatCurrency(parseFloat(tr.dataset.valor));
    if (comprovanteInput) comprovanteInput.value = ''; 
    descricaoInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// v5.1: Caminho atualizado
function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const valor = parseFloat(tr.dataset.valor);
    const formaPagamento = tr.dataset.formaPagamento;
    const data = tr.dataset.data;
    const comprovantePath = tr.dataset.comprovantePath; 

    if (!id || !data) {
        console.error("Erro: ID ou Data não encontrados na linha.");
        return;
    }

    const [entryYear, entryMonth] = data.split('-');
    // v5.1: Caminho atualizado
    const itemPath = `usuarios/${userId}/despesas/${entryYear}-${entryMonth}/${id}`;

    const deleteFn = async () => {
        try {
            if (PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
                await updateSaldoGlobal(valor);
            }
            
            if (comprovantePath) {
                await deleteFile(comprovantePath); // deleteFile já usa 'usuarios/'
            }
            
            await remove(ref(db, itemPath));
            
            hideModal('modal-confirm');

            // [MUDANÇA] Sucesso: Notificação verde
            showToast("Despesa excluída com sucesso.", "success");

        } catch (error) {
            console.error("Erro ao excluir despesa:", error);
            
            // [MUDANÇA] Erro: Notificação vermelha em vez de alert
            showToast("Não foi possível excluir a despesa.", "error");
            
            loadDespesas();
        }
    };

    modalMessage.textContent = 'Tem certeza que deseja excluir esta despesa?';
    showModal('modal-confirm', deleteFn);
}

// v5.1: Caminho atualizado
function handleEditClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;

    const id = tr.dataset.id;
    const data = tr.dataset.data;
    const [entryYear, entryMonth] = data.split('-');
    
    const comprovanteUrl = tr.dataset.comprovanteUrl;
    const comprovantePath = tr.dataset.comprovantePath;
    
    formEdit.dataset.id = id;
    // v5.1: Caminho atualizado
    formEdit.dataset.entryPath = `usuarios/${userId}/despesas/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = tr.dataset.valor;
    formEdit.dataset.formaPagamentoAntiga = tr.dataset.formaPagamento;
    
    formEdit.dataset.comprovanteAntigoUrl = comprovanteUrl;
    formEdit.dataset.comprovanteAntigoPath = comprovantePath;

    editDataInput.value = data;
    editCategoriaSelect.value = tr.dataset.categoria;
    editDescricaoInput.value = tr.dataset.descricao;
    editValorInput.value = formatCurrency(parseFloat(tr.dataset.valor));

    const formaPagamento = tr.dataset.formaPagamento;
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

    if (editComprovanteDisplay) {
        const fileName = comprovantePath ? comprovantePath.split('-').slice(1).join('-') : '';
        editComprovanteDisplay.textContent = fileName ? `Arquivo atual: ${fileName}` : '';
        editComprovanteDisplay.style.display = fileName ? 'block' : 'none';
    }
    
    const editFile = document.getElementById('edit-despesa-comprovante');
    if (editFile) editFile.value = ''; 

    modalEdit.style.display = 'flex';
}

// v5.1: Caminho atualizado
async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;

    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath; // Já contém 'usuarios/'
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const formaPagamentoAntiga = formEdit.dataset.formaPagamentoAntiga;
    
    const comprovanteAntigoUrl = formEdit.dataset.comprovanteAntigoUrl;
    const comprovanteAntigoPath = formEdit.dataset.comprovanteAntigoPath;
    
    let comprovanteData = (comprovanteAntigoUrl && comprovanteAntigoPath) 
        ? { url: comprovanteAntigoUrl, path: comprovanteAntigoPath } 
        : null;

    const editFile = document.getElementById('edit-despesa-comprovante');
    let novoArquivoSelecionado = false;

    try {
        if (editFile && editFile.files.length > 0) {
            novoArquivoSelecionado = true;
            const file = editFile.files[0];
            comprovanteData = await uploadFile(file); // uploadFile já usa 'usuarios/'
        }

        const novosDados = {
            id: id,
            data: editDataInput.value,
            categoria: editCategoriaSelect.value,
            descricao: editDescricaoInput.value,
            formaPagamento: editFormaPagamentoSelect.value,
            valor: parseCurrency(editValorInput.value),
            comprovante: comprovanteData 
        };

        if (novosDados.valor <= 0) throw new Error("O valor deve ser maior que zero.");

        const ajusteSaldo = await calcularAjusteSaldo(
            valorAntigo,
            novosDados.valor,
            formaPagamentoAntiga,
            novosDados.formaPagamento
        );

        if (ajusteSaldo < 0) {
            // verificarSaldoSuficiente() já usa 'usuarios/' (via main.js v4.1)
            const temSaldo = await verificarSaldoSuficiente(Math.abs(ajusteSaldo));
            if (!temSaldo) throw new Error("Saldo em Caixa insuficiente para esta alteração!");
        }

        await remove(ref(db, path));
        
        const [newYear, newMonth] = novosDados.data.split('-');
        // v5.1: Caminho atualizado
        const newPath = `usuarios/${userId}/despesas/${newYear}-${newMonth}/${id}`;
        await set(ref(db, newPath), novosDados);

        if (ajusteSaldo !== 0) {
            await updateSaldoGlobal(ajusteSaldo);
        }
        
        if (novoArquivoSelecionado && comprovanteAntigoPath) {
            await deleteFile(comprovanteAntigoPath); // deleteFile já usa 'usuarios/'
        }

        modalEdit.style.display = 'none';

        // [MUDANÇA] Sucesso: Notificação verde
        showToast("Alterações salvas com sucesso!", "success");

    } catch (error) {
        console.error("Erro ao salvar edição:", error);
        
        // [MUDANÇA] Erro: Notificação vermelha em vez de alert
        showToast(`Erro ao editar: ${error.message}`, "error");
        
        if (novoArquivoSelecionado && comprovanteData) {
            await deleteFile(comprovanteData.path);
        }
    }
}

// (Funções de cálculo de saldo, update de saldo e modais - Sem mudanças)
async function calcularAjusteSaldo(valorAntigo, valorNovo, formaAntiga, formaNova) {
    const antigoAfeta = PAGAMENTO_AFETA_SALDO.includes(formaAntiga);
    const novoAfeta = PAGAMENTO_AFETA_SALDO.includes(formaNova);
    let ajuste = 0;

    if (antigoAfeta && novoAfeta) {
        ajuste = valorAntigo - valorNovo;
    } else if (antigoAfeta && !novoAfeta) {
        ajuste = valorAntigo;
    } else if (!antigoAfeta && novoAfeta) {
        ajuste = -valorNovo;
    }
    return ajuste;
}

// v5.1: Caminho atualizado
async function updateSaldoGlobal(valor) {
    if (valor === 0) return;
    // v5.1: Caminho atualizado
    const saldoRef = ref(db, `usuarios/${userId}/saldo/global`);
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
    
    const newBtnConfirm = btnConfirm.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    
    newBtnConfirm.onclick = confirmFn;
    newBtnCancel.onclick = () => hideModal(modalId);

    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}