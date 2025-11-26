// js/fixos.js
// VERSÃO 3.1 (Com Gráfico Anual de Comparação)

import { 
    db, 
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    child,
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
let annualChartInstance = null; // Instância do Gráfico

const PAGAMENTO_AFETA_SALDO = ['Saldo em Caixa', 'Pix', 'Dinheiro', 'Débito Automático'];

// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-add-fixo');
const vencimentoInput = document.getElementById('fixo-vencimento');
const categoriaSelect = document.getElementById('fixo-categoria');
const descricaoInput = document.getElementById('fixo-descricao');
const formaPagamentoSelect = document.getElementById('fixo-forma-pagamento'); 
const valorInput = document.getElementById('fixo-valor');
const recorrenciaSelect = document.getElementById('fixo-recorrencia');
const parcelasGroup = document.getElementById('group-num-parcelas');
const parcelasInput = document.getElementById('fixo-num-parcelas');
const avisoMesEl = document.getElementById('mes-aviso');
const tbody = document.getElementById('tbody-despesas-fixas');
const totalPagoEl = document.getElementById('total-fixo-pago');
const totalPendenteEl = document.getElementById('total-fixo-pendente');

// Elemento DOM do Gráfico (NOVO)
const annualChartEl = document.getElementById('grafico-anual-fixos');

// Modal de Edição
const modalEdit = document.getElementById('modal-edit-fixo');
const formEdit = document.getElementById('form-edit-fixo');
const editVencimentoInput = document.getElementById('edit-fixo-vencimento');
const editCategoriaSelect = document.getElementById('edit-fixo-categoria');
const editDescricaoInput = document.getElementById('edit-fixo-descricao');
const editFormaPagamentoSelect = document.getElementById('edit-fixo-forma-pagamento'); 
const editValorInput = document.getElementById('edit-fixo-valor');
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');


// ---- MAPAS DE ÍCONES (Movido para o topo para melhor escopo) ----
const categoriaIcones = {
    "Moradia": "🏠", "Contas": "💡", "Internet": "📺", "Transporte": "🚗",
    "Saude": "❤️", "Educacao": "🎓", "Seguros": "🛡️", "Outros": "📦"
};

const pagamentoIcones = {
    "Débito Automático": "🔄", 
    "Saldo em Caixa": "🏦", 
    "Pix": "📱", 
    "Dinheiro": "💵"
    // Os ícones de cartão são adicionados em loadDynamicCardData()
};


// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', (e) => {
    userId = e.detail.userId;
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        updateAvisoMes();
        loadDespesasFixas();
        loadAnnualHistory(); // CHAMA O CARREGAMENTO DO HISTÓRICO ANUAL
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
        updateAvisoMes();
    }
    
    loadDynamicCardData(); 
    loadDespesasFixas();
    loadAnnualHistory(); // CHAMA O CARREGAMENTO INICIAL DO GRÁFICO

    // Listeners do Modal de Edição
    if (formEdit) {
        formEdit.addEventListener('submit', handleSaveEdit);
    }
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            modalEdit.style.display = 'none';
        });
    }
});

// ===============================================================
// FUNÇÕES DO GRÁFICO ANUAL (NOVAS)
// ===============================================================

/**
 * 1. Gera uma cor HSL distinta baseada no índice.
 */
function generateHslColor(index) {
    // Usa a fórmula de golden ratio conjugado para espalhar as cores (melhor distinção)
    const hue = (index * 137.508) % 360; 
    return `hsl(${hue}, 70%, 50%)`;
}

/**
 * 2. Busca os dados de todos os meses do ano atual.
 */
async function loadAnnualHistory() {
    if (!userId || !annualChartEl) return;
    
    const months = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
    const fetchPromises = months.map(month => {
        const path = `dados/${userId}/fixos/${currentYear}-${month}`;
        return get(ref(db, path));
    });

    try {
        const snapshots = await Promise.all(fetchPromises);
        const annualData = processAnnualData(snapshots);
        renderAnnualChart(annualData);
    } catch (error) {
        console.error("Erro ao carregar histórico anual:", error);
    }
}

/**
 * 3. Processa os snapshots do Firebase para o formato do Chart.js.
 */
function processAnnualData(snapshots) {
    const expensesHistory = {};
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    let uniqueExpenseIndex = 0;

    snapshots.forEach((snapshot, monthIndex) => {
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const despesa = child.val();
                // Normaliza a descrição para garantir que "Energia " e "Energia" sejam o mesmo
                const key = despesa.descricao.trim(); 
                
                // Inicializa o array se a despesa for nova
                if (!expensesHistory[key]) {
                    expensesHistory[key] = {
                        data: new Array(12).fill(0),
                        index: uniqueExpenseIndex++
                    }; 
                }
                
                // Adiciona o valor ao mês correto
                expensesHistory[key].data[monthIndex] += despesa.valor;
            });
        }
    });

    // Converte o objeto de histórico para o formato de dataset do Chart.js
    const datasets = Object.keys(expensesHistory).map((description) => {
        const item = expensesHistory[description];
        const color = generateHslColor(item.index); 
        return {
            label: description,
            data: item.data,
            borderColor: color,
            backgroundColor: color + '33', // Cor com transparência
            fill: false,
            tension: 0.2 // Curvatura da linha
        };
    });
    
    return {
        labels: months,
        datasets: datasets
    };
}

/**
 * 4. Renderiza o gráfico anual.
 */
function renderAnnualChart(data) {
    if (!annualChartEl || typeof Chart === 'undefined') {
        console.warn("Elemento do gráfico ou biblioteca Chart.js não encontrado.");
        return;
    }

    // Destrói a instância anterior, se existir, para evitar vazamento de memória
    if (annualChartInstance) {
        annualChartInstance.destroy();
    }

    annualChartInstance = new Chart(annualChartEl.getContext('2d'), {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Comparação Anual de Despesas Fixas (${currentYear})`,
                    font: { size: 16, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatCurrency(context.parsed.y);
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Valor (R$)'
                    },
                    beginAtZero: true
                }
            }
        }
    });
}
// ===============================================================


// ===============================================================
// 3. NOVA FUNÇÃO PARA CARREGAR OS CARTÕES (MANTIDA)
// ===============================================================
/**
 * Carrega os cartões dinâmicos do Firebase e os insere nos selects
 * e no mapa de ícones.
 */
async function loadDynamicCardData() {
    if (!userId) return;

    // 1. Busca os <option> dos cartões (Ex: "<option value='NuBank'>🟣 NuBank</option>")
    const cartoesHtml = await getCartoesHtmlOptions();

    // 2. Insere as opções nos dois selects da página
    if (formaPagamentoSelect) {
        formaPagamentoSelect.innerHTML += cartoesHtml;
    }
    if (editFormaPagamentoSelect) {
        editFormaPagamentoSelect.innerHTML += cartoesHtml;
    }

    // 3. Atualiza o mapa de ÍCONES para a tabela (busca a config)
    const configRef = ref(db, `dados/${userId}/cartoes/config`);
    try {
        const snapshot = await get(configRef);
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const cartao = child.val();
                // Adiciona ao mapa de ícones: "NuBank": "🟣"
                if (cartao.nome && cartao.icone) {
                    pagamentoIcones[cartao.nome] = cartao.icone;
                }
            });
        }
    } catch (error) {
        console.error("Erro ao carregar ícones dos cartões:", error);
    }
}
// ===============================================================

function updateAvisoMes() {
    if (!avisoMesEl) return;
    const displayEl = document.getElementById('current-month-display');
    avisoMesEl.textContent = displayEl ? displayEl.textContent : `${currentMonth}/${currentYear}`;
    
    vencimentoInput.value = `${currentYear}-${currentMonth}-10`;
}

// ---- LÓGICA DO FORMULÁRIO (CRIAR) ----
recorrenciaSelect.addEventListener('change', () => {
    parcelasGroup.style.display = (recorrenciaSelect.value === 'parcelada') ? 'flex' : 'none';
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!userId) return;

    if (!vencimentoInput.value) {
        alert("Por favor, selecione uma data de vencimento.");
        return;
    }

    const data = {
        vencimento: vencimentoInput.value,
        categoria: categoriaSelect.value, 
        descricao: descricaoInput.value,
        formaPagamento: formaPagamentoSelect.value,
        valor: parseCurrency(valorInput.value),
        recorrencia: recorrenciaSelect.value,
        numParcelas: (recorrenciaSelect.value === 'parcelada') ? parseInt(parcelasInput.value) : (recorrenciaSelect.value === 'unica' ? 1 : 'mensal'),
        grupoId: push(child(ref(db), 'grupos')).key
    };

    if (data.valor <= 0) return alert("O valor deve ser maior que zero.");
    
    const [startYear, startMonth, startDay] = data.vencimento.split('-').map(Number);
    
    if (data.recorrencia === 'mensal') {
        const regraRef = ref(db, `dados/${userId}/fixos/regras/${data.grupoId}`);
        await set(regraRef, data);
        await salvarInstanciaFixo(data, startYear, startMonth.toString().padStart(2, '0'), startDay, 1, 'mensal');
        
    } else {
        const totalParcelas = data.numParcelas;
        for (let i = 1; i <= totalParcelas; i++) {
            const parcelaDate = new Date(startYear, startMonth - 1, startDay);
            parcelaDate.setMonth(parcelaDate.getMonth() + (i - 1));
            
            const pYear = parcelaDate.getFullYear();
            const pMonth = (parcelaDate.getMonth() + 1).toString().padStart(2, '0');
            const pDay = parcelaDate.getDate();
            
            await salvarInstanciaFixo(data, pYear, pMonth, pDay, i, totalParcelas);
        }
    }
    
    form.reset();
    parcelasGroup.style.display = 'none';
    vencimentoInput.value = `${currentYear}-${currentMonth}-10`;
});

async function salvarInstanciaFixo(data, pYear, pMonth, pDay, parcelaAtual, parcelaTotal) {
    const path = `dados/${userId}/fixos/${pYear}-${pMonth}`;
    const newRef = push(ref(db, path));
    
    const diaString = pDay.toString().padStart(2, '0');
    
    const instanciaData = {
        ...data,
        id: newRef.key,
        vencimento: `${pYear}-${pMonth}-${diaString}`,
        parcelaInfo: {
            grupoId: data.grupoId,
            atual: parcelaAtual,
            total: parcelaTotal
        },
        status: 'pendente'
    };
    
    await set(newRef, instanciaData);
}


// ---- CARREGAR DESPESAS DO MÊS ----
async function loadDespesasFixas() {
    if (!userId) return;

    if (activeListener) {
        off(activeListener.ref, 'value', activeListener.callback);
    }
    
    try {
        await aplicarRegrasMensais();
    } catch (error) {
        console.error("Erro ao aplicar regras mensais:", error);
    }
    
    const path = `dados/${userId}/fixos/${currentYear}-${currentMonth}`;
    const dataRef = ref(db, path);
    
    const callback = (snapshot) => {
        tbody.innerHTML = '';
        let totalPago = 0;
        let totalPendente = 0;
        
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const despesa = child.val();
                renderRow(despesa);
                
                if (despesa.status === 'pago') {
                    totalPago += despesa.valor;
                } else {
                    totalPendente += despesa.valor;
                }
            });
        }
        totalPagoEl.textContent = formatCurrency(totalPago);
        totalPendenteEl.textContent = formatCurrency(totalPendente);

        // Chama a atualização do histórico anual após renderizar a tabela
        loadAnnualHistory(); 
    };
    
    onValue(dataRef, callback);
    activeListener = { ref: dataRef, callback: callback };
}

async function aplicarRegrasMensais() {
    const regrasRef = ref(db, `dados/${userId}/fixos/regras`);
    const regrasSnapshot = await get(regrasRef);
    if (!regrasSnapshot.exists()) return;
    
    const mesAtualPath = `dados/${userId}/fixos/${currentYear}-${currentMonth}`;
    const mesAtualSnapshot = await get(ref(db, mesAtualPath));
    const despesasMesAtual = mesAtualSnapshot.val() || {};

    const promessasDeAplicacao = [];

    regrasSnapshot.forEach((regraChild) => {
        const regra = regraChild.val();
        if (!regra) return; 

        const existeNoMes = Object.values(despesasMesAtual).some(d => d.grupoId === regra.grupoId);
        const excecaoPath = `dados/${userId}/fixos/regras/${regra.grupoId}/excecoes/${currentYear}-${currentMonth}`;
        
        if (!existeNoMes) {
            promessasDeAplicacao.push(
                get(ref(db, excecaoPath)).then(excecaoSnapshot => {
                    if (!excecaoSnapshot.exists()) {
                        if (!regra.vencimento) {
                            console.error("Regra Mestra corrompida ou sem vencimento. Pulando:", regraChild.key, regra);
                            return null;
                        }
                        const [regraY, regraM, regraD] = regra.vencimento.split('-').map(Number);
                        const mesesDiff = (currentYear - regraY) * 12 + (parseInt(currentMonth) - regraM);
                        if (mesesDiff < 0) return null; 
                        const parcelaAtual = mesesDiff + 1;
                        const ultimoDiaDoMes = new Date(currentYear, parseInt(currentMonth), 0).getDate();
                        const diaDoVencimento = Math.min(regraD, ultimoDiaDoMes);
                        return salvarInstanciaFixo(regra, currentYear, currentMonth, diaDoVencimento, parcelaAtual, 'mensal');
                    }
                    return null;
                })
            );
        }
    });
    
    await Promise.all(promessasDeAplicacao);
}

// ---- RENDERROW ----
function renderRow(despesa) {
    if (!despesa || !despesa.vencimento) return; 

    const parcelaInfo = despesa.parcelaInfo || { 
        grupoId: null, 
        atual: 1, 
        total: 1 
    };

    const tr = document.createElement('tr');
    tr.dataset.id = despesa.id;
    tr.dataset.grupoId = despesa.grupoId;
    tr.dataset.recorrencia = despesa.recorrencia;
    tr.dataset.valor = despesa.valor;
    tr.dataset.status = despesa.status;
    tr.dataset.formaPagamento = despesa.formaPagamento;
    tr.dataset.vencimento = despesa.vencimento;
    tr.dataset.categoria = despesa.categoria; 
    tr.dataset.descricao = despesa.descricao; 
    tr.dataset.parcelaTotal = parcelaInfo.total; 
    
    const [y, m, d] = despesa.vencimento.split('-');
    const vencimentoFormatado = `${d}/${m}/${y}`;
    const isPago = despesa.status === 'pago';
    
    let parcelaLabel = '';
    if (parcelaInfo.total === 'mensal') {
        parcelaLabel = `(Mês ${parcelaInfo.atual})`;
    }
    else if (typeof parcelaInfo.total === 'number' && parcelaInfo.total > 1) {
        parcelaLabel = `(${parcelaInfo.atual}/${parcelaInfo.total})`;
    }
    
    const categoriaNome = despesa.categoria;
    const catIcone = categoriaIcones[categoriaNome] || "📦"; 

    const pagamentoNome = despesa.formaPagamento;
    const pagIcone = pagamentoIcones[pagamentoNome] || "💳"; // Padrão

    tr.innerHTML = `
        <td>${vencimentoFormatado}</td>
        <td><span class="tag info">${catIcone} ${categoriaNome}</span></td>
        <td>${despesa.descricao}</td>
        <td>${parcelaLabel}</td>
        <td>${pagIcone} ${pagamentoNome}</td>
        <td>${formatCurrency(despesa.valor)}</td>
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
    
    tbody.appendChild(tr);

    tr.querySelector('.status-checkbox').addEventListener('change', handleCheckboxChange);
    tr.querySelector('.btn-delete').addEventListener('click', handleDeleteClick);
    tr.querySelector('.btn-edit').addEventListener('click', handleEditClick);
}

// ---- FUNÇÕES DE AÇÃO ----

async function handleCheckboxChange(e) {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const valor = parseFloat(tr.dataset.valor);
    const formaPagamento = tr.dataset.formaPagamento;
    const newStatus = e.target.checked ? 'pago' : 'pendente';
    const vencimento = tr.dataset.vencimento; 
    
    if (newStatus === 'pago' && PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
        const temSaldo = await verificarSaldoSuficiente(valor);
        if (!temSaldo) {
            alert("❌ Saldo em Caixa insuficiente para pagar esta conta!");
            e.target.checked = false; 
            return; 
        }
    }

    try {
        const [entryYear, entryMonth] = vencimento.split('-');
        const path = `dados/${userId}/fixos/${entryYear}-${entryMonth}/${id}`;
        
        await update(ref(db, path), { status: newStatus }); 
        tr.dataset.status = newStatus;
        
        if (PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
            const ajuste = newStatus === 'pago' ? -valor : valor;
            await updateSaldoGlobal(ajuste); 
        }
    } catch (error) {
        console.error("Erro ao atualizar status:", error);
        alert("Não foi possível atualizar o status.");
        e.target.checked = !e.target.checked; 
    }
}

function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    const id = tr.dataset.id;
    const grupoId = tr.dataset.grupoId;
    const recorrencia = tr.dataset.recorrencia;
    const valor = parseFloat(tr.dataset.valor);
    const status = tr.dataset.status;
    const formaPagamento = tr.dataset.formaPagamento;
    const vencimento = tr.dataset.vencimento; 
    
    const [entryYear, entryMonth] = vencimento.split('-');
    const itemPath = `dados/${userId}/fixos/${entryYear}-${entryMonth}/${id}`;

    const deleteFn = async () => {
        const btnApenasEsta = document.getElementById('modal-parcela-btn-apenas-esta');
        btnApenasEsta.disabled = true;
        btnApenasEsta.textContent = "Excluindo...";
        
        if (status === 'pago' && PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
            await updateSaldoGlobal(valor); 
        }
        await remove(ref(db, itemPath));
        
        if(recorrencia === 'mensal') {
            const excecaoPath = `dados/${userId}/fixos/regras/${grupoId}/excecoes/${entryYear}-${entryMonth}`;
            await set(ref(db, excecaoPath), true);
        }
        
        hideModal('modal-parcela-confirm');
    };

    const deleteAllFn = async () => {
        const btnTodas = document.getElementById('modal-parcela-btn-todas');
        btnTodas.disabled = true;
        btnTodas.textContent = "Excluindo...";
        
        try {
            if (status === 'pago' && PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
                await updateSaldoGlobal(valor); 
            }
            await remove(ref(db, itemPath)); 

            if (recorrencia === 'mensal') {
                await remove(ref(db, `dados/${userId}/fixos/regras/${grupoId}`));
            }
            
            const [startYear, startMonth] = vencimento.split('-').map(Number);
            
            for (let i = 1; i <= 120; i++) { 
                const dataBase = new Date(startYear, startMonth - 1, 1);
                dataBase.setMonth(dataBase.getMonth() + i);
                
                const futuraYear = dataBase.getFullYear();
                const futuraMonth = (dataBase.getMonth() + 1).toString().padStart(2, '0');
                
                const pathBusca = `dados/${userId}/fixos/${futuraYear}-${futuraMonth}`;
                
                const snapshot = await get(ref(db, pathBusca));
                if (snapshot.exists()) {
                    const deletePromises = [];
                    
                    snapshot.forEach((child) => {
                        const despesa = child.val();
                        if (despesa.grupoId === grupoId) {
                            if (despesa.status === 'pago' && PAGAMENTO_AFETA_SALDO.includes(despesa.formaPagamento)) {
                                deletePromises.push(updateSaldoGlobal(despesa.valor));
                            }
                            deletePromises.push(remove(child.ref));
                        }
                    });
                    
                    await Promise.all(deletePromises);
                }
            }
        } catch (error) {
            console.error("Erro ao excluir todas as futuras:", error);
        } finally {
            hideModal('modal-parcela-confirm');
        }
    };
    
    if (recorrencia === 'unica' || recorrencia === undefined) {
        // Usa o modal 'modal-confirm' para exclusão simples 
        if(confirm("Tem certeza que deseja excluir esta despesa?")) {
            (async () => {
                if (status === 'pago' && PAGAMENTO_AFETA_SALDO.includes(formaPagamento)) {
                    await updateSaldoGlobal(valor); 
                }
                await remove(ref(db, itemPath));
            })();
        }
    } else {
        showModal('modal-parcela-confirm', deleteFn, deleteAllFn);
    }
}

// ---- FUNÇÕES DE EDIÇÃO ----
function handleEditClick(e) {
    const tr = e.target.closest('tr');
    
    const id = tr.dataset.id;
    const vencimento = tr.dataset.vencimento;
    const categoria = tr.dataset.categoria;
    const descricao = tr.dataset.descricao;
    const formaPagamento = tr.dataset.formaPagamento;
    const valor = parseFloat(tr.dataset.valor);
    const status = tr.dataset.status;

    const [entryYear, entryMonth] = vencimento.split('-');
    formEdit.dataset.id = id;
    formEdit.dataset.entryPath = `dados/${userId}/fixos/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = valor;
    formEdit.dataset.formaPagamentoAntiga = formaPagamento;
    formEdit.dataset.statusAntigo = status;
    
    editVencimentoInput.value = vencimento;
    editCategoriaSelect.value = categoria;
    editDescricaoInput.value = descricao;
    editFormaPagamentoSelect.value = formaPagamento; 
    editValorInput.value = formatCurrency(valor);
    
    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;

    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath;
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const formaPagamentoAntiga = formEdit.dataset.formaPagamentoAntiga;
    const statusAntigo = formEdit.dataset.statusAntigo; 
    
    const novosDados = {
        categoria: editCategoriaSelect.value,
        descricao: editDescricaoInput.value,
        formaPagamento: editFormaPagamentoSelect.value, 
        valor: parseCurrency(editValorInput.value)
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
            novosDados.formaPagamento,
            statusAntigo 
        );

        if (ajusteSaldo < 0) { 
            const temSaldo = await verificarSaldoSuficiente(Math.abs(ajusteSaldo));
            if (!temSaldo) {
                alert("❌ Saldo em Caixa insuficiente para esta alteração!");
                return; 
            }
        }

        // Atualiza os dados no mesmo nó
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

async function calcularAjusteSaldo(valorAntigo, valorNovo, formaAntiga, formaNova, statusAntigo) {
    if (statusAntigo === 'pendente') {
        return 0;
    }

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

// ---- FUNÇÃO DO MODAL (Exclusão) ----
function showModal(modalId, confirmFn, deleteAllFn) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'flex';

    const oldBtnApenasEsta = document.getElementById('modal-parcela-btn-apenas-esta');
    const oldBtnTodas = document.getElementById('modal-parcela-btn-todas');
    const oldBtnCancel = document.getElementById('modal-parcela-btn-cancel');

    // Clonar para remover listeners antigos
    const newBtnApenasEsta = oldBtnApenasEsta.cloneNode(true);
    const newBtnTodas = oldBtnTodas.cloneNode(true);
    const newBtnCancel = oldBtnCancel.cloneNode(true);

    newBtnApenasEsta.disabled = false;
    newBtnApenasEsta.textContent = "Excluir Apenas Este Mês";
    newBtnTodas.disabled = false;
    newBtnTodas.textContent = "Excluir Todas as Futuras";

    newBtnApenasEsta.addEventListener('click', confirmFn);
    newBtnTodas.addEventListener('click', deleteAllFn);
    newBtnCancel.addEventListener('click', () => hideModal(modalId));

    oldBtnApenasEsta.replaceWith(newBtnApenasEsta);
    oldBtnTodas.replaceWith(newBtnTodas);
    oldBtnCancel.replaceWith(newBtnCancel);
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}