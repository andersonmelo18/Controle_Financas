// js/investimentos.js
// VERSÃO 3.4 (Com Gráfico de Evolução e Alertas de Vencimento)

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
    verificarSaldoSuficiente 
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let cdiBaseRate = 0.1125; // Padrão 11.25%
const DAY_IN_MS = 1000 * 60 * 60 * 24;

// ===============================================================
// 1. VARIÁVEIS DO GRÁFICO
// ===============================================================
let graficoDivisao = null; // Armazena a instância do gráfico de pizza
let graficoEvolucao = null; // Armazena a instância do gráfico de linha

// ---- Mapas de Ícones e Cores ----
const bankIcons = {
    'Nubank': '🏦', 'Inter': '🏦', 'XP': '📈', 'Rico': '📈',
    'BTG': '📈', 'Binance': '🪙', 'Outro': '🏛️'
};
const tipoIcons = {
    'Renda Fixa': '💰', 'Renda Variável': '📊', 'Cripto': '🪙', 'Fundos': '👥'
};

const CHART_COLORS = {
    'Renda Fixa': 'rgba(118, 193, 107, 0.7)', // Verde
    'Renda Variável': 'rgba(75, 137, 218, 0.7)', // Azul
    'Cripto': 'rgba(240, 185, 11, 0.7)', // Amarelo
    'Fundos': 'rgba(168, 113, 221, 0.7)' // Roxo
};
const CHART_BORDER_COLORS = {
    'Renda Fixa': 'rgb(118, 193, 107)',
    'Renda Variável': 'rgb(75, 137, 218)',
    'Cripto': 'rgb(240, 185, 11)',
    'Fundos': 'rgb(168, 113, 221)'
};
// ===============================================================


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

// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', async (e) => {
    userId = e.detail.userId;
    await loadConfigCdi();
    loadPosicaoConsolidada();
    loadHistoricos();
    
    // Define datas padrão (Corrigido com getLocalDateISO)
    dataInput.value = getLocalDateISO();
    resgateDataInput.value = getLocalDateISO();

    // Listeners dos formulários
    form.addEventListener('submit', handleFormSubmit);
    formResgateRapido.addEventListener('submit', handleResgateRapidoSubmit);
    formUpdateManual.addEventListener('submit', handleUpdateManualSubmit);
    
    // Listeners dos Modais
    document.getElementById('modal-resgate-btn-cancel').addEventListener('click', () => hideModal('modal-resgate-rapido'));
    document.getElementById('modal-update-btn-cancel').addEventListener('click', () => hideModal('modal-update-manual'));

    // Listeners dos selects (lógica de UI)
    bancoSelect.addEventListener('change', () => {
        bancoOutroGroup.style.display = (bancoSelect.value === 'Outro') ? 'block' : 'none';
    });
    tipoGeralSelect.addEventListener('change', toggleCamposRendaFixa);
    toggleCamposRendaFixa(); // Roda na inicialização
});

// ---- LÓGICA DE UI DOS FORMULÁRIOS ----
function toggleCamposRendaFixa() {
    const isRendaFixa = tipoGeralSelect.value === 'Renda Fixa';
    cdiPercentGroup.style.display = isRendaFixa ? 'block' : 'none';
    vencimentoGroup.style.display = isRendaFixa ? 'block' : 'none';
}

// ---- LÓGICA DE CONFIG ----
btnSaveCdiBase.addEventListener('click', async () => {
    if (!userId) return;
    const newRate = parseFloat(cdiBaseInput.value) / 100;
    if (isNaN(newRate)) return alert("Taxa inválida.");
    
    const configRef = ref(db, `dados/${userId}/investimentos/config`);
    await set(configRef, { cdiBase: newRate });
    cdiBaseRate = newRate;
    alert("Taxa CDI Base salva!");
    
    // Força recálculo
    const posRef = ref(db, `dados/${userId}/investimentos/posicao`);
    const snapshot = await get(posRef);
    loadPosicaoConsolidadaCallback(snapshot);
});

async function loadConfigCdi() {
    if (!userId) return;
    const configRef = ref(db, `dados/${userId}/investimentos/config`);
    const snapshot = await get(configRef);
    if (snapshot.exists()) {
        cdiBaseRate = snapshot.val().cdiBase || 0.1125;
    }
    cdiBaseInput.value = (cdiBaseRate * 100).toFixed(2);
}

// ===============================================================
// 2. LÓGICA DE FORMULÁRIO (Refatorada)
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

    if (data.valor <= 0) return alert("O valor deve ser positivo.");
    if (!data.banco || !data.tipoNome) return alert("Preencha Corretora e Nome do Ativo.");

    try {
        if (data.tipoMov === 'Aporte') {
            await handleAporte(data);
        } else {
            await handleResgate(data);
        }
        form.reset();
        dataInput.value = getLocalDateISO(); // Corrigido
        toggleCamposRendaFixa();
    } catch (error) {
        console.error("Erro na movimentação:", error);
        alert(`Erro: ${error.message}`);
    }
}

// ===============================================================
// 3. LÓGICA DE APORTE E RESGATE (Refatorada para RF/RV/Cripto)
// ===============================================================
async function handleAporte(data) {
    
    // **A VERIFICAÇÃO DE SALDO VEM ANTES DE TUDO**
    const temSaldo = await verificarSaldoSuficiente(data.valor);
    if (!temSaldo) {
        throw new Error("Saldo em Caixa insuficiente para fazer este aporte!");
    }

    const posicaoRef = ref(db, `dados/${userId}/investimentos/posicao`);
    const snapshot = await get(posicaoRef);
    let existingPosicao = null;
    let posicaoId = null;

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const pos = child.val();
            
            // VERIFICAÇÃO DE SEGURANÇA (v3.2)
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
        // --- JÁ EXISTE UMA POSIÇÃO ---
        const { novoValor: valorCalculado } = await calcularRendimento(existingPosicao);
        
        const valorFinal = valorCalculado + data.valor;
        const novoValorInvestido = (existingPosicao.valorInvestido || 0) + data.valor; // Garante que valorInvestido exista

        await set(child(posicaoRef, posicaoId), {
            ...existingPosicao,
            valorAtual: valorFinal,
            valorInvestido: novoValorInvestido, // Adiciona ao "custo"
            dataUltimoUpdate: new Date().toISOString()
        });
        
    } else {
        // --- É UMA NOVA POSIÇÃO ---
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
            valorInvestido: data.valor, // Custo inicial
            dataUltimoUpdate: new Date().toISOString()
        });
    }
    
    await push(ref(db, `dados/${userId}/investimentos/historico`), data);
    await updateSaldoGlobal(-data.valor); // Subtrai do saldo
    alert("Aporte realizado com sucesso!");
}

async function handleResgate(data) {
    const posicaoRef = ref(db, `dados/${userId}/investimentos/posicao`);
    const snapshot = await get(posicaoRef);
    let existingPosicao = null;
    let posicaoId = null;

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const pos = child.val();
            
            // VERIFICAÇÃO DE SEGURANÇA (v3.2)
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
    
    // Proporção do resgate
    const proporcaoResgate = (valorCalculado > 0) ? (data.valor / valorCalculado) : 1; // Evita divisão por zero
    const reducaoValorInvestido = (existingPosicao.valorInvestido || 0) * proporcaoResgate;
    const novoValorInvestido = (existingPosicao.valorInvestido || 0) - reducaoValorInvestido;

    await set(child(posicaoRef, posicaoId), {
        ...existingPosicao,
        valorAtual: valorFinal,
        valorInvestido: novoValorInvestido, // Reduz o "custo" proporcionalmente
        dataUltimoUpdate: new Date().toISOString()
    });

    await push(ref(db, `dados/${userId}/investimentos/historico`), data);
    await updateSaldoGlobal(data.valor); // Adiciona ao saldo
    alert("Resgate realizado com sucesso!");
}

// ---- LÓGICA DE CÁLCULO DE RENDIMENTO ----
async function calcularRendimento(posicao) {
    // Garante que valorInvestido exista, para cálculos de rendimento
    const valorInvestido = posicao.valorInvestido || 0;

    // SÓ calcula rendimento se for Renda Fixa
    if (posicao.tipoGeral !== 'Renda Fixa') {
        return { novoValor: posicao.valorAtual, rendimento: (posicao.valorAtual - valorInvestido) };
    }
    
    // Se for Renda Fixa, faz o cálculo CDI
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
    
    const posicaoRef = ref(db, `dados/${userId}/investimentos/posicao/${posicao.id}`);
    // Atualiza apenas os campos calculados
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
    const posRef = ref(db, `dados/${userId}/investimentos/posicao`);
    
    onValue(posRef, loadPosicaoConsolidadaCallback);
}

// ===============================================================
// 2. FUNÇÃO ATUALIZADA (Com correção de bug do Total Investido)
// ===============================================================
async function loadPosicaoConsolidadaCallback(snapshot) {
    tbodyPosicao.innerHTML = '';
    let acumuladoTotal = 0;
    let investidoTotal = 0; // <<-- BUG CORRIGIDO (movido para dentro do 'if')
    
    // Objeto para agregar os dados do gráfico
    let dadosGrafico = {
        'Renda Fixa': 0,
        'Renda Variável': 0,
        'Cripto': 0,
        'Fundos': 0
    };
    
    if (snapshot.exists()) {
        const promises = [];
        const posicoes = [];
        
        snapshot.forEach((child) => {
            const posicao = child.val();
            // Garante que a posição tenha os dados mínimos (v3.2)
            if (posicao && posicao.banco && posicao.tipoGeral && posicao.tipoNome) { 
                posicoes.push(posicao);
                promises.push(calcularRendimento(posicao)); // Recalcula tudo
            }
        });

        const resultados = await Promise.all(promises);

        resultados.forEach((resultado, index) => {
            const { novoValor, rendimento } = resultado;
            const posicao = posicoes[index];

            // BUG CORRIGIDO: O 'valorInvestido' (custo) só deve ser somado
            // se a posição for válida e não estiver zerada.
            const valorInvestidoNum = posicao.valorInvestido || 0;

            if (novoValor < 0.01 && valorInvestidoNum < 0.01) {
                // Se está zerado, remove
                remove(ref(db, `dados/${userId}/investimentos/posicao/${posicao.id}`));
                return;
            }

            acumuladoTotal += novoValor;
            investidoTotal += valorInvestidoNum; // <<-- BUG CORRIGIDO
            
            // Agrega para o gráfico
            if(dadosGrafico.hasOwnProperty(posicao.tipoGeral)) {
                dadosGrafico[posicao.tipoGeral] += novoValor;
            }

            renderPosicaoRow(posicao, novoValor, rendimento);
        });
    }
    
    // Atualiza os KPIs
    kpiTotalAcumuladoEl.textContent = formatCurrency(acumuladoTotal);
    kpiTotalInvestidoEl.textContent = formatCurrency(investidoTotal);
    const lucroPrejuizo = acumuladoTotal - investidoTotal;
    kpiLucroPrejuizoEl.textContent = formatCurrency(lucroPrejuizo);
    
    if (lucroPrejuizo < 0) {
        kpiLucroPrejuizoEl.style.color = 'var(--danger-color)';
    } else {
        kpiLucroPrejuizoEl.style.color = 'var(--success-color)';
    }

    // Renderiza o gráfico de pizza
    renderizarGraficoDivisao(dadosGrafico);
}

// ===============================================================
// 3. FUNÇÃO ATUALIZADA (Com Alertas de Vencimento)
// ===============================================================
// Renderiza uma linha na tabela de Posição
function renderPosicaoRow(posicao, valorAtualizado, rendimento) {
    const tr = document.createElement('tr');
    tr.dataset.id = posicao.id;
    
    const iconBank = bankIcons[posicao.banco] || bankIcons['Outro'];
    const iconTipo = tipoIcons[posicao.tipoGeral] || '🪙';
    const rendimentoTxt = (posicao.tipoGeral === 'Renda Fixa') ? `${posicao.cdiPercent}% CDI` : 'Manual';
    
    const lucroPrejCor = rendimento < 0 ? 'var(--danger-color)' : 'var(--text-color)';
    
    // --- LÓGICA DE ALERTA DE VENCIMENTO ---
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    if (posicao.tipoGeral === 'Renda Fixa' && posicao.vencimento) {
        const vencimentoDate = new Date(posicao.vencimento + 'T12:00:00');
        vencimentoDate.setHours(0, 0, 0, 0);
        
        const diffTime = vencimentoDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / DAY_IN_MS);

        if (diffDays < 0) {
            tr.classList.add('vencido'); // Vencido (vermelho)
        } else if (diffDays <= 30) {
            tr.classList.add('proximo'); // Próximo (amarelo)
        }
    }
    // --- FIM DA LÓGICA ---

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
    
    // Listeners dos botões da linha
    tr.querySelector('.btn-resgatar').addEventListener('click', () => {
        showModalResgate(posicao, valorAtualizado);
    });
    
    // Adiciona listener se o botão existir
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
    
    tbodyPosicao.appendChild(tr);
}

// ===============================================================
// 4. FUNÇÃO ATUALIZADA (Para alimentar o Gráfico de Evolução)
// ===============================================================
// Carrega Histórico Geral
function loadHistoricos() {
    if (!userId) return;
    
    const histRef = ref(db, `dados/${userId}/investimentos/historico`);
    const queryGeral = query(histRef, orderByChild('data'));
    
    onValue(queryGeral, (snapshot) => {
        tbodyGeral.innerHTML = '';
        let items = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => items.push(child.val()));
        }
        
        // Renderiza a tabela (ordem reversa, mais novo primeiro)
        items.slice().reverse().forEach(renderHistoricoGeralRow);
        
        // Renderiza o gráfico de evolução (ordem cronológica)
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
    tbodyGeral.appendChild(tr);
}

// ===============================================================
// 5. NOVA LÓGICA DE GRÁFICOS (Chart.js)
// ===============================================================
function renderizarGraficoDivisao(dados) {
    const ctx = document.getElementById('graficoDivisao').getContext('2d');
    
    const labels = Object.keys(dados);
    const dataValues = Object.values(dados);
    
    // Remove dados zerados para não poluir o gráfico
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

    // Pega a cor do texto do CSS para o gráfico (tema dark/light)
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';

    // Se já existe um gráfico, destrói antes de criar um novo
    if (graficoDivisao) {
        graficoDivisao.destroy();
    }
    
    // Se não há dados, mostra mensagem
    if(dataFiltrada.length === 0) {
        document.getElementById('chart-divisao-container').innerHTML = 
            '<p style="text-align: center; padding: 2rem; color: var(--text-light);">Sem dados para o gráfico de divisão.</p>';
        return;
    }

    graficoDivisao = new Chart(ctx, {
        type: 'doughnut', // Tipo "pizza"
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
                    labels: {
                        color: corTexto // Cor da legenda
                    }
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

/**
 * NOVO (v3.4): Renderiza o gráfico de evolução do *Valor Investido*
 */
function renderizarGraficoEvolucao(items) {
    const ctx = document.getElementById('graficoEvolucao').getContext('2d');
    const placeholder = document.getElementById('evolucao-placeholder');
    
    // Pega a cor do texto do CSS
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    const corGrid = estiloComputado.getPropertyValue('--text-light') || '#ccc';

    if (graficoEvolucao) {
        graficoEvolucao.destroy();
    }

    if (items.length === 0) {
        placeholder.style.display = 'block';
        return;
    }
    
    placeholder.style.display = 'none';

    // Processa os dados: (items já vêm ordenados por data)
    let runningTotal = 0;
    const labels = [];
    const data = [];

    items.forEach(item => {
        if (item.tipoMov === 'Aporte') {
            runningTotal += item.valor;
        } else {
            runningTotal -= item.valor;
        }
        
        // Formata data (DD/MM/YYYY)
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
                legend: {
                    labels: { color: corTexto }
                },
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
// ===============================================================
// FIM DA LÓGICA DE GRÁFICOS
// ===============================================================


// ---- Funções dos Modais ---- (Sem mudanças)

function showModalEditRentabilidade(posicao) {
    modalEditRentabilidade.style.display = 'flex';
    modalCdiInput.value = posicao.cdiPercent;

    const btnConfirm = document.getElementById('modal-cdi-btn-confirm');
    const btnCancel = document.getElementById('modal-cdi-btn-cancel');

    const confirmHandler = async () => {
        const newPercent = parseFloat(modalCdiInput.value);
        if (isNaN(newPercent) || newPercent < 0) return alert("Valor inválido.");
        
        const posRef = ref(db, `dados/${userId}/investimentos/posicao/${posicao.id}/cdiPercent`);
        await set(posRef, newPercent);
        
        hideModal('modal-edit-rentabilidade');
        
        // Força recálculo
        const posSnapshot = await get(ref(db, `dados/${userId}/investimentos/posicao`));
        loadPosicaoConsolidadaCallback(posSnapshot);
    };

    // Remove listeners antigos
    btnConfirm.replaceWith(btnConfirm.cloneNode(true));
    btnCancel.replaceWith(btnCancel.cloneNode(true));
    
    // Adiciona novos
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
    
    const posRef = ref(db, `dados/${userId}/investimentos/posicao/${id}`);
    const snapshot = await get(posRef);
    if (!snapshot.exists()) {
        alert("Erro: Posição não encontrada.");
        return;
    }
    const posicao = snapshot.val();
    
    // Prepara os dados para a função 'handleResgate'
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
        alert(`Erro: ${error.message}`);
    }
}

function showModalUpdateManual(posicao) {
    formUpdateManual.dataset.posicaoId = posicao.id;
    updateInfoEl.textContent = `${posicao.banco} - ${posicao.tipoNome}`;
    updateValorInvestidoEl.textContent = formatCurrency(posicao.valorInvestido || 0); // Garante que não mostre 'undefined'
    updateValorAtualInput.value = formatCurrency(posicao.valorAtual); // Preenche com o valor atual
    modalUpdateManual.style.display = 'flex';
}

async function handleUpdateManualSubmit(e) {
    e.preventDefault();
    const id = formUpdateManual.dataset.posicaoId;
    const novoValor = parseCurrency(updateValorAtualInput.value);

    if (novoValor < 0) return alert("O valor não pode ser negativo.");

    const posRef = ref(db, `dados/${userId}/investimentos/posicao/${id}`);
    
    try {
        // Atualiza apenas o valorAtual e a data
        await update(posRef, {
            valorAtual: novoValor,
            dataUltimoUpdate: new Date().toISOString()
        });
        hideModal('modal-update-manual');
    } catch (error) {
        console.error("Erro ao atualizar valor manual:", error);
        alert("Erro ao atualizar valor.");
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