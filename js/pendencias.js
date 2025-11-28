// js/pendencias.js
// VERSÃO 3.2 (Atualizado para Autenticação Google e caminho 'usuarios/')

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
    verificarSaldoSuficiente,
    getCartoesHtmlOptions
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
let activeListener = null; 

// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-add-pendencia');
const tipoSelect = document.getElementById('pendencia-tipo');
const pessoaGroup = document.getElementById('group-pendencia-pessoa');
const pessoaInput = document.getElementById('pendencia-pessoa');
const descricaoInput = document.getElementById('pendencia-descricao');
const valorInput = document.getElementById('pendencia-valor');
const vencimentoInput = document.getElementById('pendencia-vencimento');
const formaPagamentoInput = document.getElementById('pendencia-forma-pagamento'); 
const parcelasInput = document.getElementById('pendencia-parcelas');

// ---- Elementos DOM (Tabelas e Totais) ----
const tbodyEuDevo = document.getElementById('tbody-eu-devo');
const tbodyMeDevem = document.getElementById('tbody-me-devem');
const totalEuDevoPendenteEl = document.getElementById('total-eu-devo-pendente');
const totalMeDevemPendenteEl = document.getElementById('total-me-devem-pendente');

// Elementos DOM (Abas)
const btnTabEuDevo = document.getElementById('btn-tab-eu-devo');
const btnTabMeDevem = document.getElementById('btn-tab-me-devem');
const cardEuDevo = document.getElementById('card-eu-devo');
const cardMeDevem = document.getElementById('card-me-devem');

// ---- Modais ----
const modalConfirm = document.getElementById('modal-confirm');
const modalParcela = document.getElementById('modal-parcela-confirm');
const modalMessage = document.getElementById('modal-message');
const modalEdit = document.getElementById('modal-edit-pendencia');
const formEdit = document.getElementById('form-edit-pendencia');
const editTipoInput = document.getElementById('edit-pendencia-tipo');
const editVencimentoInput = document.getElementById('edit-pendencia-vencimento');
const editPessoaGroup = document.getElementById('group-edit-pendencia-pessoa');
const editPessoaInput = document.getElementById('edit-pendencia-pessoa');
const editDescricaoInput = document.getElementById('edit-pendencia-descricao');
const editValorInput = document.getElementById('edit-pendencia-valor');
const editFormaPagamentoSelect = document.getElementById('edit-pendencia-forma-pagamento'); 
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');

// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', (e) => {
    userId = e.detail.userId;
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        loadPendencias();
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    // Listeners das Abas
    if (btnTabEuDevo) {
        btnTabEuDevo.addEventListener('click', () => {
            cardEuDevo.style.display = 'block';
            cardMeDevem.style.display = 'none';
            btnTabEuDevo.classList.add('active');
            btnTabMeDevem.classList.remove('active');
        });
    }
    if (btnTabMeDevem) {
        btnTabMeDevem.addEventListener('click', () => {
            cardEuDevo.style.display = 'none';
            cardMeDevem.style.display = 'block';
            btnTabEuDevo.classList.remove('active');
            btnTabMeDevem.classList.add('active');
        });
    }
    
    // Listeners do Modal de Edição
    if (formEdit) {
        formEdit.addEventListener('submit', handleSaveEdit);
    }
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            modalEdit.style.display = 'none';
        });
    }
    
    loadDynamicCardData(); 
    loadPendencias(); 
});

// ===============================================================
// FUNÇÃO PARA CARREGAR OS CARTÕES (v3.2 - Caminho atualizado)
// ===============================================================
async function loadDynamicCardData() {
    if (!userId) return;
    // getCartoesHtmlOptions() já busca de 'usuarios/' (via main.js v4.0)
    const cartoesHtml = await getCartoesHtmlOptions();

    if (formaPagamentoInput) {
        formaPagamentoInput.innerHTML += cartoesHtml;
    }
    if (editFormaPagamentoSelect) {
        editFormaPagamentoSelect.innerHTML += cartoesHtml;
    }

    // v3.2: Caminho atualizado
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
        console.error("Erro ao carregar ícones dos cartões (pendencias):", error);
    }
}

// ---- LÓGICA DO FORMULÁRIO (CRIAR) ----
tipoSelect.addEventListener('change', () => {
    const isMeDeve = tipoSelect.value === 'meDeve';
    pessoaGroup.style.display = isMeDeve ? 'flex' : 'none';
    pessoaInput.placeholder = isMeDeve ? 'Nome de quem te deve' : 'Para quem você deve';
    if (!isMeDeve) {
        pessoaInput.value = ''; 
    }
});
pessoaGroup.style.display = 'none';
pessoaInput.placeholder = 'Para quem você deve';

// v3.2: Caminho atualizado
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userId) return;

    const tipo = tipoSelect.value;
    const pessoa = pessoaInput.value || (tipo === 'euDevo' ? 'N/A' : 'N/A'); 
    const descricao = descricaoInput.value;
    const valor = parseCurrency(valorInput.value);
    const vencimento = vencimentoInput.value;
    const formaPagamento = formaPagamentoInput.value;
    const totalParcelas = parseInt(parcelasInput.value) || 1;
    
    if (valor <= 0) {
        alert("O valor deve ser maior que zero.");
        return;
    }
    if (!vencimento) {
        alert("Por favor, selecione uma data de vencimento.");
        return;
    }

    const grupoId = totalParcelas > 1 ? push(child(ref(db), 'grupos')).key : null;
    const [startYear, startMonth, startDay] = vencimento.split('-').map(Number);
    
    for (let i = 1; i <= totalParcelas; i++) {
        const parcelaDate = new Date(startYear, startMonth - 1, startDay);
        parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1));
        
        const parcelaYear = parcelaDate.getFullYear();
        const parcelaMonth = (parcelaDate.getMonth() + 1).toString().padStart(2, '0');
        const parcelaDay = parcelaDate.getDate().toString().padStart(2, '0');
        
        // v3.2: Caminho atualizado
        const path = `usuarios/${userId}/pendencias/${parcelaYear}-${parcelaMonth}`;
        const newPendenciaRef = push(ref(db, path));
        
        const pendenciaData = {
            id: newPendenciaRef.key,
            tipo: tipo,
            pessoa: pessoa,
            descricao: descricao,
            valor: valor,
            vencimento: `${parcelaYear}-${parcelaMonth}-${parcelaDay}`,
            formaPagamento: formaPagamento,
            status: "pendente",
            parcelaInfo: {
                grupoId: grupoId,
                atual: i,
                total: totalParcelas
            }
        };

        await set(newPendenciaRef, pendenciaData);
    }

    form.reset();
    pessoaGroup.style.display = 'none';
    pessoaInput.placeholder = 'Para quem você deve';
});

// MAPA DE PAGAMENTO
const pagamentoIcones = {
    "Saldo em Caixa": "🏦", 
    "Pix": "📱", 
    "Dinheiro": "💵",
    "Outro": "🧩"
};


// ===============================================================
// CARREGAR DADOS (v3.2 - Caminho atualizado)
// ===============================================================
function loadPendencias() {
    if (!userId) return;
    
    if (activeListener) {
        off(activeListener.ref, 'value', activeListener.callback);
    }
    
    // v3.2: Caminho atualizado
    const path = `usuarios/${userId}/pendencias/${currentYear}-${currentMonth}`;
    const pendenciasRef = ref(db, path);
    
    const callback = (snapshot) => {
        tbodyEuDevo.innerHTML = '';
        tbodyMeDevem.innerHTML = '';
        
        let totalDevo = 0;
        let totalReceber = 0;
        
        if (snapshot.exists()) {
            snapshot.forEach((childSnapshot) => {
                const pendencia = childSnapshot.val();
                if (!pendencia) return;

                if (pendencia.status === 'pendente') {
                    if (pendencia.tipo === 'euDevo') {
                        totalDevo += pendencia.valor;
                    } else if (pendencia.tipo === 'meDeve') {
                        totalReceber += pendencia.valor;
                    }
                }
                
                renderRow(pendencia);
            });
        }

        if (totalEuDevoPendenteEl) {
            totalEuDevoPendenteEl.textContent = formatCurrency(totalDevo);
        }
        if (totalMeDevemPendenteEl) {
            totalMeDevemPendenteEl.textContent = formatCurrency(totalReceber);
        }
    };
    
    onValue(pendenciasRef, callback);
    activeListener = { ref: pendenciasRef, callback: callback }; 
}

// ===============================================================
// RENDERIZAR LINHA (v3.1 - Lógica mantida)
// ===============================================================
function renderRow(pendencia) {
    if (!pendencia.vencimento) {
        console.warn("Pendência ignorada (sem data de vencimento):", pendencia.descricao);
        return; 
    }

    const parcelaInfo = pendencia.parcelaInfo || { 
        grupoId: null, 
        atual: 1, 
        total: 1 
    };

    const tr = document.createElement('tr');
    tr.dataset.id = pendencia.id;
    tr.dataset.tipo = pendencia.tipo;
    tr.dataset.valor = pendencia.valor;
    tr.dataset.status = pendencia.status;
    tr.dataset.vencimento = pendencia.vencimento; 
    tr.dataset.grupoId = parcelaInfo.grupoId;
    tr.dataset.parcelaAtual = parcelaInfo.atual;
    tr.dataset.parcelaTotal = parcelaInfo.total;
    tr.dataset.pessoa = pendencia.pessoa || '';
    tr.dataset.descricao = pendencia.descricao;
    tr.dataset.formaPagamento = pendencia.formaPagamento;

    const [y, m, d] = pendencia.vencimento.split('-');
    const vencimentoFormatado = `${d}/${m}/${y}`;
    const isPago = pendencia.status === 'pago';
    
    const parcelaLabel = parcelaInfo.total > 1 
        ? `(${parcelaInfo.atual}/${parcelaInfo.total})` 
        : '';
    
    const pessoaLabel = (pendencia.pessoa && pendencia.pessoa !== 'N/A') 
        ? `${pendencia.pessoa}` 
        : 'N/A';

    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    const vencimentoDate = new Date(pendencia.vencimento + 'T12:00:00'); 
    vencimentoDate.setHours(0, 0, 0, 0);

    const diffTime = vencimentoDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (isPago) {
        tr.classList.add('pago');
    } else if (diffDays < 0) {
        tr.classList.add('vencido'); 
    } else if (diffDays <= 3) {
        tr.classList.add('proximo'); 
    }

    const pagIcone = pagamentoIcones[pendencia.formaPagamento] || "💳"; 

    tr.innerHTML = `
        <td>${vencimentoFormatado}</td>
        <td>${pendencia.descricao} (${pessoaLabel}) ${parcelaLabel}</td>
        <td>${formatCurrency(pendencia.valor)}</td>
        <td>${pagIcone} ${pendencia.formaPagamento}</td>
        <td>
            <input type="checkbox" class="status-checkbox" ${isPago ? 'checked' : ''}>
        </td>
        <td class="actions">
            <button class="btn-icon warning btn-edit">
                <span class="material-icons-sharp">edit</span>
            </button>
            <button class="btn-icon danger btn-delete">
                <span class="material-icons-sharp">delete</span>
            </button>
        </td>
    `;
    
    if (pendencia.tipo === 'euDevo') {
        tbodyEuDevo.appendChild(tr);
    } else {
        tbodyMeDevem.appendChild(tr);
    }

    tr.querySelector('.status-checkbox').addEventListener('change', handleCheckboxChange);
    tr.querySelector('.btn-delete').addEventListener('click', handleDeleteClick);
    tr.querySelector('.btn-edit').addEventListener('click', handleEditClick); 
}

// ===============================================================
// AÇÕES (v3.2 - Caminhos atualizados)
// ===============================================================
async function handleCheckboxChange(e) {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const tipo = tr.dataset.tipo;
    const valor = parseFloat(tr.dataset.valor);
    const newStatus = e.target.checked ? 'pago' : 'pendente';
    const vencimento = tr.dataset.vencimento; 

    const pagamentosAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro'];
    const formaPagamento = tr.dataset.formaPagamento;

    if (tipo === 'euDevo' && newStatus === 'pago' && pagamentosAfetamSaldo.includes(formaPagamento)) {
        // verificarSaldoSuficiente() já usa 'usuarios/' (via main.js v4.0)
        const temSaldo = await verificarSaldoSuficiente(valor);
        if (!temSaldo) {
            alert("❌ Saldo em Caixa insuficiente para pagar esta dívida!");
            e.target.checked = false; 
            return; 
        }
    }

    try {
        const [entryYear, entryMonth] = vencimento.split('-');
        // v3.2: Caminho atualizado
        const path = `usuarios/${userId}/pendencias/${entryYear}-${entryMonth}/${id}`;
        
        await update(ref(db, path), { status: newStatus }); 

        let ajuste = 0;
        if (pagamentosAfetamSaldo.includes(formaPagamento)) {
            if (tipo === 'euDevo') {
                ajuste = newStatus === 'pago' ? -valor : valor; 
            } else if (tipo === 'meDeve') {
                ajuste = newStatus === 'pago' ? valor : -valor; 
            }
        }
        
        if (ajuste !== 0) {
            await updateSaldoGlobal(ajuste);
        }
        
        loadPendencias(); // Recarrega tudo para atualizar totais

    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        alert("Não foi possível atualizar o status.");
        e.target.checked = !e.target.checked;
    }
}

async function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const tipo = tr.dataset.tipo;
    const valor = parseFloat(tr.dataset.valor);
    const status = tr.dataset.status;
    const vencimento = tr.dataset.vencimento;
    const grupoId = tr.dataset.grupoId;
    const parcelaAtual = parseInt(tr.dataset.parcelaAtual);
    const parcelaTotal = parseInt(tr.dataset.parcelaTotal);
    const formaPagamento = tr.dataset.formaPagamento; 

    const pagamentosAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro'];
    
    const [entryYear, entryMonth] = vencimento.split('-');
    // v3.2: Caminho atualizado
    const itemPath = `usuarios/${userId}/pendencias/${entryYear}-${entryMonth}/${id}`;

    const deleteFn = async () => {
        try {
            if (status === 'pago' && pagamentosAfetamSaldo.includes(formaPagamento)) {
                const ajuste = (tipo === 'euDevo') ? valor : -valor; 
                await updateSaldoGlobal(ajuste);
            }
            await remove(ref(db, itemPath));
            hideModal('modal-confirm');
            hideModal('modal-parcela-confirm');
        } catch (error) {
            console.error("Erro ao excluir:", error);
            alert("Erro ao excluir.");
        }
    };

    const deleteAllFn = async () => {
        try {
            if (status === 'pago' && pagamentosAfetamSaldo.includes(formaPagamento)) {
                const ajuste = (tipo === 'euDevo') ? valor : -valor;
                await updateSaldoGlobal(ajuste);
            }
            await remove(ref(db, itemPath));

            const [startYear, startMonth, startDay] = vencimento.split('-').map(Number);
            const dataBase = new Date(startYear, startMonth - 1, startDay);
            
            for (let i = parcelaAtual + 1; i <= parcelaTotal; i++) {
                const futuraDate = new Date(dataBase.getFullYear(), dataBase.getMonth(), dataBase.getDate());
                futuraDate.setMonth(futuraDate.getMonth() + (i - parcelaAtual));

                const futuraYear = futuraDate.getFullYear();
                const futuraMonth = (futuraDate.getMonth() + 1).toString().padStart(2, '0');
                
                // v3.2: Caminho atualizado
                const pathBusca = `usuarios/${userId}/pendencias/${futuraYear}-${futuraMonth}`;
                
                const snapshot = await get(ref(db, pathBusca));
                if (snapshot.exists()) {
                    const promises = [];
                    snapshot.forEach((child) => {
                        const pendencia = child.val();
                        if (pendencia.parcelaInfo.grupoId === grupoId && pendencia.parcelaInfo.atual === i) {
                            if (pendencia.status === 'pago' && pagamentosAfetamSaldo.includes(pendencia.formaPagamento)) {
                                const ajuste = (pendencia.tipo === 'euDevo') ? pendencia.valor : -pendencia.valor;
                                promises.push(updateSaldoGlobal(ajuste));
                            }
                            promises.push(remove(child.ref));
                        }
                    });
                    await Promise.all(promises);
                }
            }
        } catch (error) {
            console.error("Erro ao excluir futuras:", error);
            alert("Erro ao excluir futuras.");
        } finally {
            hideModal('modal-parcela-confirm');
        }
    };

    if (parcelaTotal <= 1 || grupoId === 'null' || !grupoId) {
        modalMessage.textContent = 'Tem certeza que deseja excluir esta pendência?';
        showModal('modal-confirm', deleteFn);
    } else {
        showModal('modal-parcela-confirm', deleteFn, deleteAllFn);
    }
}

// v3.2: Caminho atualizado
function handleEditClick(e) {
    const tr = e.target.closest('tr');
    
    const id = tr.dataset.id;
    const tipo = tr.dataset.tipo;
    const vencimento = tr.dataset.vencimento;
    const pessoa = tr.dataset.pessoa;
    const descricao = tr.dataset.descricao;
    const formaPagamento = tr.dataset.formaPagamento;
    const valor = parseFloat(tr.dataset.valor);
    const status = tr.dataset.status;

    const [entryYear, entryMonth] = vencimento.split('-');
    formEdit.dataset.id = id;
    // v3.2: Caminho atualizado
    formEdit.dataset.entryPath = `usuarios/${userId}/pendencias/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = valor;
    formEdit.dataset.statusAntigo = status; 
    formEdit.dataset.tipo = tipo; 
    formEdit.dataset.formaPagamentoAntiga = formaPagamento; 
    
    editTipoInput.value = (tipo === 'euDevo') ? '📤 Eu devo' : '📥 Devem para mim';
    editVencimentoInput.value = vencimento;
    editPessoaInput.value = (pessoa === 'N/A' ? '' : pessoa); 
    editDescricaoInput.value = descricao;
    editFormaPagamentoSelect.value = formaPagamento; 
    editValorInput.value = formatCurrency(valor);

    editPessoaGroup.style.display = (tipo === 'meDeve') ? 'flex' : 'none';
    if(tipo === 'euDevo') {
        editPessoaInput.placeholder = 'Para quem você deve';
    } else {
        editPessoaInput.placeholder = 'Nome de quem te deve';
    }
    
    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;

    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath; // Já contém o caminho 'usuarios/'
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const statusAntigo = formEdit.dataset.statusAntigo; 
    const tipo = formEdit.dataset.tipo; 
    const formaPagamentoAntiga = formEdit.dataset.formaPagamentoAntiga;
    
    const novosDados = {
        pessoa: editPessoaInput.value || (tipo === 'euDevo' ? 'N/A' : 'N/A'),
        descricao: editDescricaoInput.value,
        formaPagamento: editFormaPagamentoSelect.value, 
        valor: parseCurrency(editValorInput.value)
    };

    if (novosDados.valor <= 0) {
        alert("O valor deve ser maior que zero.");
        return;
    }
    
    try {
        const ajusteSaldo = calcularAjusteSaldo(
            valorAntigo, 
            novosDados.valor, 
            statusAntigo,
            tipo,
            formaPagamentoAntiga,
            novosDados.formaPagamento
        );

        if (ajusteSaldo < 0) { 
            // verificarSaldoSuficiente() já usa 'usuarios/' (via main.js v4.0)
            const temSaldo = await verificarSaldoSuficiente(Math.abs(ajusteSaldo));
            if (!temSaldo) {
                alert("❌ Saldo em Caixa insuficiente para esta alteração!");
                return; 
            }
        }

        await update(ref(db, path), novosDados);
        
        if (ajusteSaldo !== 0) {
            await updateSaldoGlobal(ajusteSaldo);
        }
        
        modalEdit.style.display = 'none';
        
    } catch (error) {
        console.error("Erro ao salvar edição:", error);
        alert("Não foi possível salvar as alterações.");
    }
}

function calcularAjusteSaldo(valorAntigo, valorNovo, statusAntigo, tipo, formaAntiga, formaNova) {
    if (statusAntigo === 'pendente') {
        return 0; 
    }

    const pagamentosAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro'];
    const antigoAfeta = pagamentosAfetamSaldo.includes(formaAntiga);
    const novoAfeta = pagamentosAfetamSaldo.includes(formaNova);

    let ajuste = 0;

    if (tipo === 'euDevo') {
        if (antigoAfeta && novoAfeta) {
            ajuste = valorAntigo - valorNovo;
        } else if (antigoAfeta && !novoAfeta) {
            ajuste = valorAntigo;
        } else if (!antigoAfeta && novoAfeta) {
            ajuste = -valorNovo;
        }
    } else if (tipo === 'meDeve') {
        if (antigoAfeta && novoAfeta) {
            ajuste = valorNovo - valorAntigo;
        } else if (antigoAfeta && !novoAfeta) {
            ajuste = -valorAntigo;
        } else if (!antigoAfeta && novoAfeta) {
            ajuste = valorNovo;
        }
    }
    return ajuste;
}

// v3.2: Caminho atualizado
async function updateSaldoGlobal(ajuste) {
    if (ajuste === 0) return; 
    
    // v3.2: Caminho atualizado
    const saldoRef = ref(db, `usuarios/${userId}/saldo/global`);
    try {
        const snapshot = await get(saldoRef);
        let saldoAcumulado = snapshot.val()?.saldoAcumulado || 0;
        
        saldoAcumulado += ajuste;
        
        await set(saldoRef, { saldoAcumulado: saldoAcumulado });
    } catch (error) {
        console.error("Erro ao atualizar saldo global:", error);
    }
}

// (Funções de Modal mantidas da v3.1)
function showModal(modalId, confirmFn, deleteAllFn = null) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';

    if (modalId === 'modal-confirm') {
        const oldBtnConfirm = document.getElementById('modal-btn-confirm');
        const oldBtnCancel = document.getElementById('modal-btn-cancel');

        const newBtnConfirm = oldBtnConfirm.cloneNode(true);
        const newBtnCancel = oldBtnCancel.cloneNode(true);
        
        newBtnConfirm.onclick = confirmFn;
        newBtnCancel.onclick = () => hideModal(modalId);

        oldBtnConfirm.replaceWith(newBtnConfirm);
        oldBtnCancel.replaceWith(newBtnCancel);

    } else if (modalId === 'modal-parcela-confirm') {
        const oldBtnApenasEsta = document.getElementById('modal-parcela-btn-apenas-esta');
        const oldBtnTodas = document.getElementById('modal-parcela-btn-todas');
        const oldBtnCancel = document.getElementById('modal-parcela-btn-cancel');
        
        const newBtnApenasEsta = oldBtnApenasEsta.cloneNode(true);
        const newBtnTodas = oldBtnTodas.cloneNode(true);
        const newBtnCancel = oldBtnCancel.cloneNode(true);
        
        newBtnApenasEsta.disabled = false;
        newBtnApenasEsta.textContent = "Excluir Apenas Este Mês";
        newBtnTodas.disabled = false;
        newBtnTodas.textContent = "Excluir Todas as Futuras";

        newBtnApenasEsta.onclick = confirmFn;
        newBtnTodas.onclick = deleteAllFn;
        newBtnCancel.onclick = () => hideModal(modalId);

        oldBtnApenasEsta.replaceWith(newBtnApenasEsta);
        oldBtnTodas.replaceWith(newBtnTodas);
        oldBtnCancel.replaceWith(newBtnCancel);
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.style.display = 'none';
    }
}