// js/investimentos.js
// VERSÃO 3.6 (Corrigido: Verificações de DOM + Toastify Integrado)

import { 
    db, 
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    child,
    query,
    orderByChild,
    limitToLast,
    update 
} from './firebase-config.js';
import { 
    getUserId, 
    formatCurrency, 
    parseCurrency,
    verificarSaldoSuficiente,
    showToast // IMPORTADO DO MAIN.JS PARA NOTIFICAÇÕES PADRONIZADAS
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let cdiBaseRate = 0.1125; 
const DAY_IN_MS = 1000 * 60 * 60 * 24;

// ---- Variáveis do Gráfico ----
let graficoDivisao = null; 
let graficoEvolucao = null; 

// ---- Mapas de Ícones e Cores ----
const bankIcons = {
    'Nubank': '🏦', 'Inter': '🏦', 'XP': '📈', 'Rico': '📈',
    'BTG': '📈', 'Binance': '🪙', 'Outro': '🏛️'
};
const tipoIcons = {
    'Renda Fixa': '💰', 'Renda Variável': '📊', 'Cripto': '🪙', 'Fundos': '👥'
};
const CHART_COLORS = {
    'Renda Fixa': 'rgba(118, 193, 107, 0.7)', 
    'Renda Variável': 'rgba(75, 137, 218, 0.7)',
    'Cripto': 'rgba(240, 185, 11, 0.7)', 
    'Fundos': 'rgba(168, 113, 221, 0.7)' 
};
const CHART_BORDER_COLORS = {
    'Renda Fixa': 'rgb(118, 193, 107)',
    'Renda Variável': 'rgb(75, 137, 218)',
    'Cripto': 'rgb(240, 185, 11)',
    'Fundos': 'rgb(168, 113, 221)'
};

// ---- Elementos DOM (Formulário Principal) ----
const form = document.getElementById('form-movimentacao');
const tipoMovSelect = document.getElementById('inv-tipo-mov');
const dataInput = document.getElementById('inv-data');
const bancoSelect = document.getElementById('inv-banco');
const bancoOutroGroup = document.getElementById('group-banco-outro');
const bancoOutroInput = document.getElementById('inv-banco-outro');
const tipoGeralSelect = document.getElementById('inv-tipo-geral'); 
const tipoNomeInput = document.getElementById('inv-tipo-nome'); 
const objetivoInput = document.getElementById('inv-objetivo'); 
const vencimentoInput = document.getElementById('inv-vencimento'); 
const cdiPercentGroup = document.getElementById('group-cdi-percent');
const cdiPercentInput = document.getElementById('inv-cdi-percent');
const vencimentoGroup = document.getElementById('group-vencimento'); 
const valorInput = document.getElementById('inv-valor');

// ---- Elementos DOM (Resumo/KPIs) ----
const kpiTotalAcumuladoEl = document.getElementById('kpi-total-acumulado');
const kpiTotalInvestidoEl = document.getElementById('kpi-total-investido');
const kpiLucroPrejuizoEl = document.getElementById('kpi-lucro-prejuizo');

// ---- Elementos DOM (Tabelas) ----
const tbodyPosicao = document.getElementById('table-posicao-consolidada');
const tbodyGeral = document.getElementById('tbody-historico-geral');

// ---- Elementos DOM (Config) ----
const cdiBaseInput = document.getElementById('config-cdi-base');
const btnSaveCdiBase = document.getElementById('btn-save-cdi-base');

// ---- Elementos DOM (Modais) ----
const modalEditRentabilidade = document.getElementById('modal-edit-rentabilidade');
const modalCdiInput = document.getElementById('modal-input-cdi');
const modalResgateRapido = document.getElementById('modal-resgate-rapido');
const formResgateRapido = document.getElementById('form-resgate-rapido');
const resgateInfoEl = document.getElementById('resgate-info');
const resgateValorDisponivelEl = document.getElementById('resgate-valor-disponivel');
const resgateValorInput = document.getElementById('resgate-valor');
const resgateDataInput = document.getElementById('resgate-data');
const modalUpdateManual = document.getElementById('modal-update-manual');
const formUpdateManual = document.getElementById('form-update-manual');
const updateInfoEl = document.getElementById('update-info');
const updateValorInvestidoEl = document.getElementById('update-valor-investido');
const updateValorAtualInput = document.getElementById('update-valor-atual');

// ===============================================================
// HELPER DE DATA
// ===============================================================
function getLocalDateISO() {
    const dataLocal = new Date();
    dataLocal.setMinutes(dataLocal.getMinutes() - dataLocal.getTimezoneOffset());
    return dataLocal.toISOString().split('T')[0];
}

// ===============================================================
// INICIALIZAÇÃO
// ===============================================================
document.addEventListener('authReady', async (e) => {
    userId = e.detail.userId;
    await loadConfigCdi();
    loadPosicaoConsolidada();
    loadHistoricos();
    
    // Verificações de segurança para evitar erro "Cannot set properties of null"
    if (dataInput) dataInput.value = getLocalDateISO();
    if (resgateDataInput) resgateDataInput.value = getLocalDateISO();

    if (form) form.addEventListener('submit', handleFormSubmit);
    if (formResgateRapido) formResgateRapido.addEventListener('submit', handleResgateRapidoSubmit);
    if (formUpdateManual) formUpdateManual.addEventListener('submit', handleUpdateManualSubmit);
    
    const btnCancelResgate = document.getElementById('modal-resgate-btn-cancel');
    if (btnCancelResgate) btnCancelResgate.addEventListener('click', () => hideModal('modal-resgate-rapido'));
    
    const btnCancelUpdate = document.getElementById('modal-update-btn-cancel');
    if (btnCancelUpdate) btnCancelUpdate.addEventListener('click', () => hideModal('modal-update-manual'));

    if (bancoSelect) {
        bancoSelect.addEventListener('change', () => {
            if (bancoOutroGroup) bancoOutroGroup.style.display = (bancoSelect.value === 'Outro') ? 'block' : 'none';
        });
    }
    
    if (tipoGeralSelect) {
        tipoGeralSelect.addEventListener('change', toggleCamposRendaFixa);
        toggleCamposRendaFixa(); 
    }
});

// ---- LÓGICA DE UI DOS FORMULÁRIOS ----
function toggleCamposRendaFixa() {
    if (!tipoGeralSelect || !cdiPercentGroup || !vencimentoGroup) return;
    const isRendaFixa = tipoGeralSelect.value === 'Renda Fixa';
    cdiPercentGroup.style.display = isRendaFixa ? 'block' : 'none';
    vencimentoGroup.style.display = isRendaFixa ? 'block' : 'none';
}

// ---- LÓGICA DE CONFIG (Atualizado com Toastify) ----
if (btnSaveCdiBase) {
    btnSaveCdiBase.addEventListener('click', async () => {
        if (!userId) return;
        const newRate = parseFloat(cdiBaseInput.value) / 100;
        
        if (isNaN(newRate)) {
            showToast("Taxa inválida. Verifique o valor digitado.", "error");
            return;
        }
        
        const configRef = ref(db, `usuarios/${userId}/investimentos/config`);
        await set(configRef, { cdiBase: newRate });
        cdiBaseRate = newRate;
        
        showToast("Taxa CDI Base salva com sucesso!", "success");
        
        const posRef = ref(db, `usuarios/${userId}/investimentos/posicao`);
        const snapshot = await get(posRef);
        loadPosicaoConsolidadaCallback(snapshot);
    });
}

async function loadConfigCdi() {
    if (!userId) return;
    const configRef = ref(db, `usuarios/${userId}/investimentos/config`);
    const snapshot = await get(configRef);
    if (snapshot.exists()) {
        cdiBaseRate = snapshot.val().cdiBase || 0.1125;
    }
    if (cdiBaseInput) cdiBaseInput.value = (cdiBaseRate * 100).toFixed(2);
}

// ===============================================================
// 2. LÓGICA DE FORMULÁRIO (Atualizado com Toastify)
// ===============================================================
async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    const data = {
        tipoMov: tipoMovSelect.value,
        data: dataInput.value,
        banco: (bancoSelect.value === 'Outro') ? bancoOutroInput.value : bancoSelect.value,
        tipoGeral: tipoGeralSelect.value,
        tipoNome: tipoNomeInput.value,
        objetivo: objetivoInput.value || '',
        vencimento: vencimentoInput.value || null,
        cdiPercent: parseFloat(cdiPercentInput.value) || 100,
        valor: parseCurrency(valorInput.value)
    };

    if (data.valor <= 0) {
        showToast("O valor deve ser maior que zero.", "error");
        return;
    }
    if (!data.banco || !data.tipoNome) {
        showToast("Preencha Corretora e Nome do Ativo.", "error");
        return;
    }

    try {
        if (data.tipoMov === 'Aporte') {
            await handleAporte(data);
        } else {
            await handleResgate(data);
        }
        form.reset();
        if (dataInput) dataInput.value = getLocalDateISO(); 
        toggleCamposRendaFixa();
    } catch (error) {
        console.error("Erro na movimentação:", error);
        showToast(error.message, "error");
    }
}

// ===============================================================
// 3. LÓGICA DE APORTE E RESGATE (Atualizado com Toastify)
// ===============================================================
async function handleAporte(data) {
    
    const temSaldo = await verificarSaldoSuficiente(data.valor);
    if (!temSaldo) {
        throw new Error("Saldo em Caixa insuficiente para fazer este aporte!");
    }

    const posicaoRef = ref(db, `usuarios/${userId}/investimentos/posicao`);
    const snapshot = await get(posicaoRef);
    let existingPosicao = null;
    let posicaoId = null;

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const pos = child.val();
            if (pos && pos.banco && pos.tipoGeral && pos.tipoNome) {
                if (pos.banco.toLowerCase() === data.banco.toLowerCase() &&
                    pos.tipoGeral === data.tipoGeral &&
                    pos.tipoNome.toLowerCase() === data.tipoNome.toLowerCase()) {
                    
                    existingPosicao = pos;
                    posicaoId = child.key;
                }
            }
        });
    }

    if (existingPosicao) {
        const { novoValor: valorCalculado } = await calcularRendimento(existingPosicao);
        
        const valorFinal = valorCalculado + data.valor;
        const novoValorInvestido = (existingPosicao.valorInvestido || 0) + data.valor; 

        await set(child(posicaoRef, posicaoId), {
            ...existingPosicao,
            valorAtual: valorFinal,
            valorInvestido: novoValorInvestido, 
            dataUltimoUpdate: new Date().toISOString()
        });
        
    } else {
        const newPosicaoRef = push(posicaoRef);
        await set(newPosicaoRef, {
            id: newPosicaoRef.key,
            banco: data.banco,
            tipoGeral: data.tipoGeral,
            tipoNome: data.tipoNome,
            objetivo: data.objetivo,
            vencimento: data.vencimento,
            cdiPercent: (data.tipoGeral === 'Renda Fixa') ? data.cdiPercent : null,
            valorAtual: data.valor,
            valorInvestido: data.valor, 
            dataUltimoUpdate: new Date().toISOString()
        });
    }
    
    await push(ref(db, `usuarios/${userId}/investimentos/historico`), data);
    await updateSaldoGlobal(-data.valor); 
    
    showToast("Aporte realizado com sucesso!", "success");
}

async function handleResgate(data) {
    const posicaoRef = ref(db, `usuarios/${userId}/investimentos/posicao`);
    const snapshot = await get(posicaoRef);
    let existingPosicao = null;
    let posicaoId = null;

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const pos = child.val();
            if (pos && pos.banco && pos.tipoGeral && pos.tipoNome) {
                if (pos.banco.toLowerCase() === data.banco.toLowerCase() &&
                    pos.tipoGeral === data.tipoGeral &&
                    pos.tipoNome.toLowerCase() === data.tipoNome.toLowerCase()) {
                    
                    existingPosicao = pos;
                    posicaoId = child.key;
                }
            }
        });
    }

    if (!existingPosicao) {
        throw new Error("Investimento não encontrado. Verifique o Banco e o Ativo.");
    }

    const { novoValor: valorCalculado } = await calcularRendimento(existingPosicao);
    
    if (data.valor > valorCalculado) {
        throw new Error(`Saldo insuficiente. Você tem ${formatCurrency(valorCalculado)} neste investimento.`);
    }

    const valorFinal = valorCalculado - data.valor;
    
    const proporcaoResgate = (valorCalculado > 0) ? (data.valor / valorCalculado) : 1; 
    const reducaoValorInvestido = (existingPosicao.valorInvestido || 0) * proporcaoResgate;
    const novoValorInvestido = (existingPosicao.valorInvestido || 0) - reducaoValorInvestido;

    await set(child(posicaoRef, posicaoId), {
        ...existingPosicao,
        valorAtual: valorFinal,
        valorInvestido: novoValorInvestido,
        dataUltimoUpdate: new Date().toISOString()
    });

    await push(ref(db, `usuarios/${userId}/investimentos/historico`), data);
    await updateSaldoGlobal(data.valor); 
    
    showToast("Resgate realizado com sucesso!", "success");
}

// ---- LÓGICA DE CÁLCULO DE RENDIMENTO ----
async function calcularRendimento(posicao) {
    const valorInvestido = posicao.valorInvestido || 0;

    if (posicao.tipoGeral !== 'Renda Fixa') {
        return { novoValor: posicao.valorAtual, rendimento: (posicao.valorAtual - valorInvestido) };
    }
    
    const agora = new Date();
    const ultimoUpdate = new Date(posicao.dataUltimoUpdate);
    
    const diffTime = Math.abs(agora.getTime() - ultimoUpdate.getTime());
    const diffDays = Math.floor(diffTime / DAY_IN_MS);
    
    if (diffDays < 1) {
        return { novoValor: posicao.valorAtual, rendimento: (posicao.valorAtual - valorInvestido) };
    }
    
    const taxaAnualEfetiva = cdiBaseRate * (posicao.cdiPercent / 100);
    const taxaDiaria = Math.pow(1 + taxaAnualEfetiva, 1 / 365) - 1;
    const novoValor = posicao.valorAtual * Math.pow(1 + taxaDiaria, diffDays);
    
    const posicaoRef = ref(db, `usuarios/${userId}/investimentos/posicao/${posicao.id}`);
    await update(posicaoRef, {
        valorAtual: novoValor,
        dataUltimoUpdate: agora.toISOString()
    });
    
    const rendimentoTotal = novoValor - valorInvestido;

    return { novoValor: novoValor, rendimento: rendimentoTotal };
}

// ---- RENDERIZAÇÃO E CARREGAMENTO ----

function loadPosicaoConsolidada() {
    if (!userId) return;
    const posRef = ref(db, `usuarios/${userId}/investimentos/posicao`);
    onValue(posRef, loadPosicaoConsolidadaCallback);
}

async function loadPosicaoConsolidadaCallback(snapshot) {
    if (!tbodyPosicao) return;
    tbodyPosicao.innerHTML = '';
    let acumuladoTotal = 0;
    let investidoTotal = 0; 
    
    let dadosGrafico = {
        'Renda Fixa': 0, 'Renda Variável': 0, 'Cripto': 0, 'Fundos': 0
    };
    
    if (snapshot.exists()) {
        const promises = [];
        const posicoes = [];
        
        snapshot.forEach((child) => {
            const posicao = child.val();
            if (posicao && posicao.banco && posicao.tipoGeral && posicao.tipoNome) { 
                posicoes.push(posicao);
                promises.push(calcularRendimento(posicao)); 
            }
        });

        const resultados = await Promise.all(promises);

        resultados.forEach((resultado, index) => {
            const { novoValor, rendimento } = resultado;
            const posicao = posicoes[index];
            const valorInvestidoNum = posicao.valorInvestido || 0;

            if (novoValor < 0.01 && valorInvestidoNum < 0.01) {
                remove(ref(db, `usuarios/${userId}/investimentos/posicao/${posicao.id}`));
                return;
            }

            acumuladoTotal += novoValor;
            investidoTotal += valorInvestidoNum; 
            
            if(dadosGrafico.hasOwnProperty(posicao.tipoGeral)) {
                dadosGrafico[posicao.tipoGeral] += novoValor;
            }

            renderPosicaoRow(posicao, novoValor, rendimento);
        });
    }
    
    if (kpiTotalAcumuladoEl) kpiTotalAcumuladoEl.textContent = formatCurrency(acumuladoTotal);
    if (kpiTotalInvestidoEl) kpiTotalInvestidoEl.textContent = formatCurrency(investidoTotal);
    
    const lucroPrejuizo = acumuladoTotal - investidoTotal;
    if (kpiLucroPrejuizoEl) {
        kpiLucroPrejuizoEl.textContent = formatCurrency(lucroPrejuizo);
        kpiLucroPrejuizoEl.style.color = (lucroPrejuizo < 0) ? 'var(--danger-color)' : 'var(--success-color)';
    }

    renderizarGraficoDivisao(dadosGrafico);
}

function renderPosicaoRow(posicao, valorAtualizado, rendimento) {
    const tr = document.createElement('tr');
    tr.dataset.id = posicao.id;
    
    const iconBank = bankIcons[posicao.banco] || bankIcons['Outro'];
    const iconTipo = tipoIcons[posicao.tipoGeral] || '🪙';
    const rendimentoTxt = (posicao.tipoGeral === 'Renda Fixa') ? `${posicao.cdiPercent}% CDI` : 'Manual';
    
    const lucroPrejCor = rendimento < 0 ? 'var(--danger-color)' : 'var(--text-color)';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    if (posicao.tipoGeral === 'Renda Fixa' && posicao.vencimento) {
        const vencimentoDate = new Date(posicao.vencimento + 'T12:00:00');
        vencimentoDate.setHours(0, 0, 0, 0);
        
        const diffTime = vencimentoDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / DAY_IN_MS);

        if (diffDays < 0) {
            tr.classList.add('vencido'); 
        } else if (diffDays <= 30) {
            tr.classList.add('proximo'); 
        }
    }

    tr.innerHTML = `
        <td><span title="${posicao.banco}">${iconBank}</span> ${posicao.banco}</td>
        <td><span title="${posicao.tipoGeral}">${iconTipo}</span></td>
        <td>${posicao.tipoNome}</td>
        <td>${rendimentoTxt}</td>
        <td>${formatCurrency(posicao.valorInvestido || 0)}</td>
        <td><strong>${formatCurrency(valorAtualizado)}</strong></td>
        <td style="color: ${lucroPrejCor};">${formatCurrency(rendimento)}</td>
        <td class="actions">
            <button class="btn-icon success btn-resgatar" title="Resgatar">
                <span class="material-icons-sharp">file_download</span>
            </button>
            
            ${posicao.tipoGeral !== 'Renda Fixa' ? `
            <button class="btn-icon primary btn-update-manual" title="Atualizar Valor Manualmente">
                <span class="material-icons-sharp">update</span>
            </button>
            ` : `
            <button class="btn-icon btn-edit-rentabilidade" title="Editar % CDI">
                <span class="material-icons-sharp">edit</span>
            </button>
            `}
        </td>
    `;
    
    tr.querySelector('.btn-resgatar').addEventListener('click', () => {
        showModalResgate(posicao, valorAtualizado);
    });
    
    const btnEditRentabilidade = tr.querySelector('.btn-edit-rentabilidade');
    if (btnEditRentabilidade) {
        btnEditRentabilidade.addEventListener('click', () => {
            showModalEditRentabilidade(posicao);
        });
    }
    
    const btnUpdateManual = tr.querySelector('.btn-update-manual');
    if (btnUpdateManual) {
        btnUpdateManual.addEventListener('click', () => {
            showModalUpdateManual(posicao);
        });
    }
    
    if (tbodyPosicao) tbodyPosicao.appendChild(tr);
}

function loadHistoricos() {
    if (!userId) return;
    const histRef = ref(db, `usuarios/${userId}/investimentos/historico`);
    const queryGeral = query(histRef, orderByChild('data'));
    
    onValue(queryGeral, (snapshot) => {
        if (!tbodyGeral) return;
        tbodyGeral.innerHTML = '';
        let items = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => items.push(child.val()));
        }
        
        items.slice().reverse().forEach(renderHistoricoGeralRow);
        renderizarGraficoEvolucao(items);
    });
}

function renderHistoricoGeralRow(item) {
    const tr = document.createElement('tr');
    const [y, m, d] = item.data.split('-');
    const valorClass = item.tipoMov === 'Aporte' ? 'var(--danger-color)' : 'var(--success-color)';
    const valorSign = item.tipoMov === 'Aporte' ? '-' : '+';
    
    tr.innerHTML = `
        <td>${d}/${m}/${y}</td>
        <td>${item.tipoMov}</td>
        <td>${item.banco}</td>
        <td>${item.tipoNome || item.tipo}</td>
        <td style="color: ${valorClass};">
            ${valorSign} ${formatCurrency(item.valor)}
        </td>
    `;
    if (tbodyGeral) tbodyGeral.appendChild(tr);
}

// ===============================================================
// 5. LÓGICA DE GRÁFICOS
// ===============================================================
function renderizarGraficoDivisao(dados) {
    const canvas = document.getElementById('graficoDivisao');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const labels = Object.keys(dados);
    const dataValues = Object.values(dados);
    
    const labelsFiltrados = [];
    const dataFiltrada = [];
    const colorsFiltrados = [];
    const borderColorsFiltrados = [];

    dataValues.forEach((valor, index) => {
        if (valor > 0) {
            const label = labels[index];
            labelsFiltrados.push(label);
            dataFiltrada.push(valor);
            colorsFiltrados.push(CHART_COLORS[label] || 'rgba(150, 150, 150, 0.7)');
            borderColorsFiltrados.push(CHART_BORDER_COLORS[label] || 'rgb(150, 150, 150)');
        }
    });

    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';

    if (graficoDivisao) {
        graficoDivisao.destroy();
    }
    
    if(dataFiltrada.length === 0) {
        const container = document.getElementById('chart-divisao-container');
        if (container) {
            container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-light);">Sem dados para o gráfico de divisão.</p>';
        }
        return;
    }

    graficoDivisao = new Chart(ctx, {
        type: 'doughnut', 
        data: {
            labels: labelsFiltrados,
            datasets: [{
                label: 'Valor Acumulado',
                data: dataFiltrada,
                backgroundColor: colorsFiltrados,
                borderColor: borderColorsFiltrados,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: corTexto }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const valor = context.parsed || 0;
                            const total = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentual = ((valor / total) * 100).toFixed(1);
                            return `${label}: ${formatCurrency(valor)} (${percentual}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderizarGraficoEvolucao(items) {
    const canvas = document.getElementById('graficoEvolucao');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const placeholder = document.getElementById('evolucao-placeholder');
    
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    const corGrid = estiloComputado.getPropertyValue('--text-light') || '#ccc';

    if (graficoEvolucao) {
        graficoEvolucao.destroy();
    }

    if (items.length === 0) {
        if (placeholder) placeholder.style.display = 'block';
        return;
    }
    
    if (placeholder) placeholder.style.display = 'none';

    let runningTotal = 0;
    const labels = [];
    const data = [];

    items.forEach(item => {
        if (item.tipoMov === 'Aporte') {
            runningTotal += item.valor;
        } else {
            runningTotal -= item.valor;
        }
        
        const [y, m, d] = item.data.split('-');
        labels.push(`${d}/${m}/${y}`);
        data.push(runningTotal);
    });

    graficoEvolucao = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Valor Investido (Custo)',
                data: data,
                borderColor: 'rgb(75, 137, 218)',
                backgroundColor: 'rgba(75, 137, 218, 0.7)',
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: corTexto } },
                tooltip: {
                    callbacks: {
                        label: (context) => `Total Investido: ${formatCurrency(context.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    ticks: { color: corTexto },
                    grid: { color: corGrid }
                },
                x: {
                    ticks: { color: corTexto },
                    grid: { display: false }
                }
            }
        }
    });
}

// ---- Funções dos Modais ---- 

function showModalEditRentabilidade(posicao) {
    modalEditRentabilidade.style.display = 'flex';
    modalCdiInput.value = posicao.cdiPercent;

    const btnConfirm = document.getElementById('modal-cdi-btn-confirm');
    const btnCancel = document.getElementById('modal-cdi-btn-cancel');

    const confirmHandler = async () => {
        const newPercent = parseFloat(modalCdiInput.value);
        if (isNaN(newPercent) || newPercent < 0) {
            showToast("Valor inválido.", "error");
            return;
        }
        
        const posRef = ref(db, `usuarios/${userId}/investimentos/posicao/${posicao.id}/cdiPercent`);
        await set(posRef, newPercent);
        
        hideModal('modal-edit-rentabilidade');
        
        const posSnapshot = await get(ref(db, `usuarios/${userId}/investimentos/posicao`));
        loadPosicaoConsolidadaCallback(posSnapshot);
        showToast("Rentabilidade atualizada.", "success");
    };

    btnConfirm.replaceWith(btnConfirm.cloneNode(true));
    btnCancel.replaceWith(btnCancel.cloneNode(true));
    
    document.getElementById('modal-cdi-btn-confirm').onclick = confirmHandler;
    document.getElementById('modal-cdi-btn-cancel').onclick = () => hideModal('modal-edit-rentabilidade');
}

function showModalResgate(posicao, valorAtualizado) {
    formResgateRapido.dataset.posicaoId = posicao.id;
    resgateInfoEl.textContent = `${posicao.banco} - ${posicao.tipoNome}`;
    resgateValorDisponivelEl.textContent = formatCurrency(valorAtualizado);
    resgateValorInput.value = '';
    modalResgateRapido.style.display = 'flex';
}

async function handleResgateRapidoSubmit(e) {
    e.preventDefault();
    const id = formResgateRapido.dataset.posicaoId;
    const valor = parseCurrency(resgateValorInput.value);
    const data = resgateDataInput.value;
    
    const posRef = ref(db, `usuarios/${userId}/investimentos/posicao/${id}`);
    const snapshot = await get(posRef);
    if (!snapshot.exists()) {
        showToast("Erro: Posição não encontrada.", "error");
        return;
    }
    const posicao = snapshot.val();
    
    const dataResgate = {
        tipoMov: 'Resgate',
        data: data,
        banco: posicao.banco,
        tipoGeral: posicao.tipoGeral,
        tipoNome: posicao.tipoNome,
        valor: valor
    };

    try {
        await handleResgate(dataResgate);
        hideModal('modal-resgate-rapido');
    } catch (error) {
        showToast(`Erro: ${error.message}`, "error");
    }
}

function showModalUpdateManual(posicao) {
    formUpdateManual.dataset.posicaoId = posicao.id;
    updateInfoEl.textContent = `${posicao.banco} - ${posicao.tipoNome}`;
    updateValorInvestidoEl.textContent = formatCurrency(posicao.valorInvestido || 0); 
    updateValorAtualInput.value = formatCurrency(posicao.valorAtual); 
    modalUpdateManual.style.display = 'flex';
}

async function handleUpdateManualSubmit(e) {
    e.preventDefault();
    const id = formUpdateManual.dataset.posicaoId;
    const novoValor = parseCurrency(updateValorAtualInput.value);

    if (novoValor < 0) {
        showToast("O valor não pode ser negativo.", "error");
        return;
    }

    const posRef = ref(db, `usuarios/${userId}/investimentos/posicao/${id}`);
    
    try {
        await update(posRef, {
            valorAtual: novoValor,
            dataUltimoUpdate: new Date().toISOString()
        });
        hideModal('modal-update-manual');
        showToast("Valor atualizado com sucesso!", "success");
        
        // Recarregar a tabela para ver a mudança imediata
        const posSnapshot = await get(ref(db, `usuarios/${userId}/investimentos/posicao`));
        loadPosicaoConsolidadaCallback(posSnapshot);

    } catch (error) {
        console.error("Erro ao atualizar valor manual:", error);
        showToast("Erro ao atualizar valor.", "error");
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

async function updateSaldoGlobal(valor) {
    if (valor === 0) return;
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