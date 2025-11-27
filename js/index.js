// js/index.js
// VERSÃO 5.1 (Corrigido: Bug no Gráfico de Categoria e Tabela)

import { 
    db, 
    ref, 
    onValue, 
    set, 
    get, 
    off 
} from './firebase-config.js';
import { 
    getUserId, 
    formatCurrency, 
    parseCurrency 
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
let activeListeners = [];

// Estado global do dashboard
let dashboardState = {
    totalEntradas: 0,
    totalDespesas: 0, // Apenas o que saiu do Saldo em Caixa
    lucroLiquido: 0,
    saldoAcumulado: 0,
    saldoMesAnterior: 0,
    kmTotal: 0,
    horasTotal: 0, // em minutos
    metaEntrada: 0,
    metaGasto: 0, // NOVO
    detalheVariaveis: 0, // Pago c/ Saldo
    detalheFixas: 0,     // Pago c/ Saldo
    detalheDividas: 0,    // Pago c/ Saldo
    totalFaturasMes: 0,  // NOVO
    totalLimitesCartoes: 0, // NOVO
    // Categorias agora inclui TODOS os gastos (Cartão + Saldo)
    categoriasGastos: {} 
};

/** Armazena a config dos cartões */
let meusCartoes = {};
/** Armazena todos os dados de gastos para cálculo das faturas */
let estadoGastos = {
    despesas: {},
    fixos: {},
    specs: {},
    pendencias: {}
};

/** Lista de pagamentos que afetam o Saldo em Caixa */
const PAGAMENTO_AFETA_SALDO = ['Saldo em Caixa', 'Pix', 'Dinheiro'];

// ---- Instâncias dos Gráficos ----
let chartEntradasDespesas = null;
let chartDespesasCategoria = null;
let chartEvolucaoSaldo = null;

// ---- Cores dos Gráficos (v5.1) ----
// (Movido para o topo para ser usado por MÚLTIPLAS funções)
const CHART_COLORS = {
    "Casa": "rgba(118, 193, 107, 0.7)", // Verde
    "Alimentação": "rgba(75, 137, 218, 0.7)", // Azul
    "Restaurante": "rgba(235, 100, 64, 0.7)", // Laranja
    "Transporte": "rgba(168, 113, 221, 0.7)", // Roxo
    "Lazer": "rgba(240, 185, 11, 0.7)", // Amarelo
    "Saúde": "rgba(216, 75, 75, 0.7)", // Vermelho
    "Educação": "rgba(107, 213, 201, 0.7)", // Ciano
    "Compras": "rgba(255, 133, 172, 0.7)", // Rosa
    "Serviços": "rgba(80, 80, 80, 0.7)", // Cinza
    "Pag. Dívidas": "rgba(150, 100, 50, 0.7)", // Marrom
    "Outros": "rgba(150, 150, 150, 0.7)"
};

// ---- Elementos DOM (KPIs) ----
const totalEntradasEl = document.getElementById('total-entradas');
const totalDespesasEl = document.getElementById('total-despesas');
const lucroLiquidoEl = document.getElementById('lucro-liquido');
const saldoCaixaEl = document.getElementById('saldo-caixa');
const saldoAcumuladoEl = document.getElementById('saldo-acumulado');
const kmTotalEl = document.getElementById('km-total');
const horasTotalEl = document.getElementById('horas-total');

// ---- Elementos DOM (Metas) ----
const metaValorEl = document.getElementById('meta-valor'); // Meta de Entrada
const btnEditMeta = document.getElementById('btn-edit-meta');
const metaProgressEl = document.getElementById('meta-progress');
const metaFaltanteEl = document.getElementById('meta-faltante');
const metaPercentualEl = document.getElementById('meta-percentual');

// NOVO (Meta de Gasto)
const metaGastoValorEl = document.getElementById('meta-gasto-valor');
const metaGastoProgressEl = document.getElementById('meta-gasto-progress');
const metaGastoGastoEl = document.getElementById('meta-gasto-gasto');
const metaGastoRestanteEl = document.getElementById('meta-gasto-restante');
const btnEditMetaGasto = document.getElementById('btn-edit-meta-gasto');

// ---- Elementos DOM (Detalhes) ----
const detalheVariaveisEl = document.getElementById('detalhe-variaveis');
const detalheFixasEl = document.getElementById('detalhe-fixas');
const detalheDividasEl = document.getElementById('detalhe-dividas');
const detalheTotalDespesasEl = document.getElementById('detalhe-total-despesas');
const detalheFaturasEl = document.getElementById('detalhe-faturas'); 
const detalheTotalGeralEl = document.getElementById('detalhe-total-geral'); 
const totalLimitesCartoesEl = document.getElementById('total-limites-cartoes'); 
const totalFaturasAbertoEl = document.getElementById('total-faturas-aberto'); 

// ---- Elementos DOM (Gráficos) ----
const chartEntradasDespesasCtx = document.getElementById('chart-entradas-despesas')?.getContext('2d');
const chartDespesasCategoriaCtx = document.getElementById('chart-despesas-categoria')?.getContext('2d');
const chartEvolucaoSaldoCtx = document.getElementById('chart-evolucao-saldo')?.getContext('2d');
const catTableBodyEl = document.getElementById('gastos-categoria-table')?.querySelector('tbody');


// ---- Elementos DOM (Resumo Anual) ----
const tbodyResumoAnual = document.getElementById('tbody-resumo-anual');


// ---- INICIALIZAÇÃO ----
document.addEventListener('authReady', async (e) => {
    userId = e.detail.userId;
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        loadDashboardData();
        // Recarrega dados anuais se o ano mudar
        const yearDisplay = document.getElementById('current-month-display').dataset.year;
        if (yearDisplay != currentYear) { // Simples checagem se o ano mudou
            loadAnnualSummary();
        }
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }
    
    // Inicia os gráficos
    initCharts();
    
    // Carrega todos os dados
    loadDashboardData();
    loadAnnualSummary(); // Carrega o resumo anual 1x
    
    // Listeners dos Modais de Meta
    btnEditMeta?.addEventListener('click', handleEditMetaEntrada);
    btnEditMetaGasto?.addEventListener('click', handleEditMetaGasto);
});

function loadDashboardData() {
    if (!userId) return;
    
    limparListeners();
    
    // Reseta o estado do mês
    dashboardState = {
        ...dashboardState, // Mantém saldoAcumulado e metas
        totalEntradas: 0,
        totalDespesas: 0,
        lucroLiquido: 0,
        saldoMesAnterior: 0,
        kmTotal: 0,
        horasTotal: 0,
        detalheVariaveis: 0,
        detalheFixas: 0,
        detalheDividas: 0,
        totalFaturasMes: 0,
        categoriasGastos: {} // Resetado para o mês
    };

    // Estado dos gastos para cálculo de faturas
    estadoGastos = { despesas: {}, fixos: {}, specs: {}, pendencias: {} };
    
    // Inicia todos os listeners
    listenToPath(`entradas/${currentYear}-${currentMonth}`, handleEntradas);
    listenToPath(`despesas/${currentYear}-${currentMonth}`, handleDespesasVariaveis);
    listenToPath(`fixos/${currentYear}-${currentMonth}`, handleFixos);
    listenToPath(`pendencias/${currentYear}-${currentMonth}`, handlePendencias);
    listenToPath(`metas/${currentYear}-${currentMonth}`, handleMetaEntrada);
    listenToPath(`metas_gasto/${currentYear}-${currentMonth}`, handleMetaGasto);
    listenToPath('saldo/global', handleSaldoGlobal);
    
    // Carrega dados de cartões (para limites e faturas)
    loadCardDataAndAllExpenses();
    // Carrega dados para o gráfico de saldo diário
    loadDailyBalanceData();
}

function limparListeners() {
    activeListeners.forEach(l => off(l.ref, 'value', l.callback));
    activeListeners = [];
}

function listenToPath(path, callback) {
    const dataRef = ref(db, `dados/${userId}/${path}`);
    const listener = onValue(dataRef, callback, () => {}); // Adiciona callback de erro vazio
    activeListeners.push({ ref: dataRef, callback: listener, eventType: 'value' });
}

// ---- HANDLERS (Ouvintes do Firebase) ----

function handleEntradas(snapshot) {
    let total = 0, km = 0, minutos = 0;
    if (snapshot.exists()) {
        snapshot.forEach(child => {
            const entrada = child.val();
            total += entrada.valor;
            km += entrada.km || 0;
            minutos += entrada.horas || 0; 
        });
    }
    dashboardState.totalEntradas = total;
    dashboardState.kmTotal = km;
    dashboardState.horasTotal = minutos;
    updateUI();
}

function handleDespesasVariaveis(snapshot) {
    let totalPago = 0;
    let categorias = {};
    if (snapshot.exists()) {
        snapshot.forEach(child => {
            const despesa = child.val();
            const cat = despesa.categoria;
            
            // 1. Adiciona à Categoria (sempre)
            categorias[cat] = (categorias[cat] || 0) + despesa.valor;
            
            // 2. Adiciona ao Total Pago (só se saiu do Saldo)
            if (PAGAMENTO_AFETA_SALDO.includes(despesa.formaPagamento)) {
                totalPago += despesa.valor;
            }
        });
    }
    dashboardState.detalheVariaveis = totalPago;
    // v5.1 - Reseta categorias antes de mesclar
    dashboardState.categoriasGastos = { 
        ...dashboardState.categoriasGastos, 
        ...categorias 
    };
    updateUI();
}

function handleFixos(snapshot) {
    let totalPago = 0;
    let categorias = {};
    if (snapshot.exists()) {
        snapshot.forEach(child => {
            const despesa = child.val();
            if (despesa.status === 'pago') {
                const cat = despesa.categoria;
                categorias[cat] = (categorias[cat] || 0) + despesa.valor;
                
                if (PAGAMENTO_AFETA_SALDO.includes(despesa.formaPagamento)) {
                    totalPago += despesa.valor;
                }
            }
        });
    }
    dashboardState.detalheFixas = totalPago;
    dashboardState.categoriasGastos = { ...dashboardState.categoriasGastos, ...categorias };
    updateUI();
}

function handlePendencias(snapshot) {
    let totalPago = 0;
    let categorias = {}; 
    
    if (snapshot.exists()) {
        snapshot.forEach(child => {
            const pendencia = child.val();
            if (pendencia.tipo === 'euDevo' && pendencia.status === 'pago') {
                
                if (pendencia.descricao.startsWith('Pagamento Fatura')) {
                    // Não faz nada, este valor já foi contado
                } else {
                    const cat = "Dívidas/Empréstimos";
                    categorias[cat] = (categorias[cat] || 0) + pendencia.valor;
                    
                    if (PAGAMENTO_AFETA_SALDO.includes(pendencia.formaPagamento)) {
                         totalPago += pendencia.valor;
                    }
                }
            }
        });
    }
    dashboardState.detalheDividas = totalPago;
    dashboardState.categoriasGastos = { ...dashboardState.categoriasGastos, ...categorias };
    updateUI();
}

function handleMetaEntrada(snapshot) {
    dashboardState.metaEntrada = snapshot.val()?.valor || 0;
    updateUI();
}

function handleMetaGasto(snapshot) { 
    dashboardState.metaGasto = snapshot.val()?.valor || 0;
    updateUI();
}

function handleSaldoGlobal(snapshot) {
    dashboardState.saldoAcumulado = snapshot.val()?.saldoAcumulado || 0;
    updateUI();
}

// ---- FUNÇÃO MESTRA DE ATUALIZAÇÃO DA UI (v5.0) ----
// (Sem mudanças, v5.0 já está correta)
function updateUI() {
    const state = dashboardState;
    
    // Total Despesas = Apenas o que saiu do Saldo em Caixa
    state.totalDespesas = state.detalheVariaveis + state.detalheFixas + state.detalheDividas;
    state.lucroLiquido = state.totalEntradas - state.totalDespesas;
    state.saldoMesAnterior = state.saldoAcumulado - state.lucroLiquido;
    
    // Total Geral de Gastos (Caixa + Faturas)
    const totalGeralGastos = state.totalDespesas + state.totalFaturasMes;

    // --- KPIs Principais ---
    totalEntradasEl.textContent = formatCurrency(state.totalEntradas);
    totalDespesasEl.textContent = formatCurrency(state.totalDespesas);
    lucroLiquidoEl.textContent = formatCurrency(state.lucroLiquido);
    saldoCaixaEl.textContent = formatCurrency(state.saldoAcumulado);
    saldoAcumuladoEl.textContent = `Saldo anterior: ${formatCurrency(state.saldoMesAnterior)}`;
    kmTotalEl.textContent = `${state.kmTotal.toFixed(1)} km`;
    horasTotalEl.textContent = formatHoras(state.horasTotal); 
    
    // --- Detalhes de Despesas ---
    detalheVariaveisEl.textContent = formatCurrency(state.detalheVariaveis);
    detalheFixasEl.textContent = formatCurrency(state.detalheFixas);
    detalheDividasEl.textContent = formatCurrency(state.detalheDividas);
    detalheTotalDespesasEl.textContent = formatCurrency(state.totalDespesas); // Total (Saldo)
    detalheFaturasEl.textContent = formatCurrency(state.totalFaturasMes); // Total (Cartões)
    detalheTotalGeralEl.textContent = formatCurrency(totalGeralGastos); // Total (Geral)

    // --- Limites de Cartão ---
    totalLimitesCartoesEl.textContent = formatCurrency(state.totalLimitesCartoes);
    totalFaturasAbertoEl.textContent = formatCurrency(state.totalFaturasMes);
    const percLimiteUsado = state.totalLimitesCartoes > 0 ? (state.totalFaturasMes / state.totalLimitesCartoes) * 100 : 0;
    document.getElementById('limite-cartao-progress').style.width = `${Math.min(100, percLimiteUsado)}%`;

    // --- Meta de Entradas ---
    const metaE = state.metaEntrada;
    const entradas = state.totalEntradas;
    const faltanteE = Math.max(0, metaE - entradas);
    const percentualE = metaE > 0 ? Math.min(100, (entradas / metaE) * 100) : 0;
    
    metaValorEl.textContent = formatCurrency(metaE);
    metaFaltanteEl.textContent = formatCurrency(faltanteE);
    metaPercentualEl.textContent = `${percentualE.toFixed(0)}%`;
    metaProgressEl.style.width = `${percentualE}%`;
    
    // --- Meta de Gastos (NOVO) ---
    const metaG = state.metaGasto;
    const restanteG = Math.max(0, metaG - totalGeralGastos);
    const percentualG = metaG > 0 ? Math.min(100, (totalGeralGastos / metaG) * 100) : 0;

    metaGastoValorEl.textContent = formatCurrency(metaG);
    metaGastoGastoEl.textContent = formatCurrency(totalGeralGastos);
    metaGastoRestanteEl.textContent = formatCurrency(restanteG);
    metaGastoProgressEl.style.width = `${percentualG}%`;
    if (percentualG >= 100) {
        metaGastoProgressEl.style.backgroundColor = 'var(--danger-color)';
    } else if (percentualG >= 85) {
        metaGastoProgressEl.style.backgroundColor = 'var(--warning-color)';
    } else {
        metaGastoProgressEl.style.backgroundColor = 'var(--primary-color)';
    }

    // --- Atualiza Gráficos e Tabelas ---
    updateEntradasDespesasChart(state.totalEntradas, totalGeralGastos); // Usa o Total GERAL de gastos
    updateDespesasCategoriaChart(state.categoriasGastos);
    updateCategoryTable(state.categoriasGastos, totalGeralGastos);
}

// ---- LÓGICA DAS METAS (v5.0 - Sem mudanças) ----
async function handleEditMetaEntrada() {
    const metaAtualFormatada = formatCurrency(dashboardState.metaEntrada).replace("R$", "").trim();
    const novaMetaStr = prompt("Qual o valor da sua meta de ENTRADA mensal?", metaAtualFormatada);
    
    if (novaMetaStr === null) return;
    const novaMeta = parseCurrency(novaMetaStr);
    
    if (isNaN(novaMeta) || novaMeta < 0) {
        alert("Valor inválido.");
        return;
    }
    
    const path = `dados/${userId}/metas/${currentYear}-${currentMonth}`;
    await set(ref(db, path), { valor: novaMeta });
}

async function handleEditMetaGasto() { 
    const metaAtualFormatada = formatCurrency(dashboardState.metaGasto).replace("R$", "").trim();
    const novaMetaStr = prompt("Qual o seu LIMITE DE GASTO mensal? (Inclui faturas de cartão)", metaAtualFormatada);
    
    if (novaMetaStr === null) return;
    const novaMeta = parseCurrency(novaMetaStr);
    
    if (isNaN(novaMeta) || novaMeta < 0) {
        alert("Valor inválido.");
        return;
    }
    
    const path = `dados/${userId}/metas_gasto/${currentYear}-${currentMonth}`;
    await set(ref(db, path), { valor: novaMeta });
}

// ===============================================================
// LÓGICA DE CÁLCULO DE FATURAS (v5.0 - Sem mudanças)
// ===============================================================
function loadCardDataAndAllExpenses() {
    const configPath = `dados/${userId}/cartoes/config`;
    
    listenToPath(configPath, (snapshot) => {
        meusCartoes = snapshot.val() || {};
        dashboardState.totalLimitesCartoes = Object.values(meusCartoes)
            .reduce((sum, c) => sum + (c.limiteTotal || 0), 0);
        
        loadGastosAgregados();
    }, 'value');
}

function loadGastosAgregados() {
    limparListeners(); 
    estadoGastos = { despesas: {}, fixos: {}, specs: {}, pendencias: {} };
    
    const loadState = {
        despesasAtual: false, despesasAnt: false,
        fixosAtual: false, fixosAnt: false,
        specs: false, pendencias: false 
    };

    const checkAndCalculateFaturas = () => {
        if (Object.values(loadState).some(status => status === false)) return; 
        calcularTotaisFaturas(); 
    };

    const dataAtual = new Date(currentYear, currentMonth - 1, 1);
    const dataAnterior = new Date(dataAtual);
    dataAnterior.setMonth(dataAnterior.getMonth() - 1);
    
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataAnterior.getFullYear()}-${(dataAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    listenToPath(`dados/${userId}/despesas/${mesAtualPath}`, (s) => { estadoGastos.despesas[mesAtualPath] = s.val() || {}; loadState.despesasAtual = true; checkAndCalculateFaturas(); }, 'value');
    listenToPath(`dados/${userId}/despesas/${mesAnteriorPath}`, (s) => { estadoGastos.despesas[mesAnteriorPath] = s.val() || {}; loadState.despesasAnt = true; checkAndCalculateFaturas(); }, 'value');
    listenToPath(`dados/${userId}/fixos/${mesAtualPath}`, (s) => { estadoGastos.fixos[mesAtualPath] = s.val() || {}; loadState.fixosAtual = true; checkAndCalculateFaturas(); }, 'value');
    listenToPath(`dados/${userId}/fixos/${mesAnteriorPath}`, (s) => { estadoGastos.fixos[mesAnteriorPath] = s.val() || {}; loadState.fixosAnt = true; checkAndCalculateFaturas(); }, 'value');
    listenToPath(`dados/${userId}/cartoes_specs`, (s) => { estadoGastos.specs = s.val() || {}; loadState.specs = true; checkAndCalculateFaturas(); }, 'value');
    listenToPath(`dados/${userId}/pendencias`, (s) => { estadoGastos.pendencias = s.val() || {}; loadState.pendencias = true; checkAndCalculateFaturas(); }, 'value');
}

function calcularTotaisFaturas() {
    if (Object.keys(meusCartoes).length === 0) {
        updateUI();
        return;
    }

    const dataFatura = new Date(currentYear, currentMonth - 1, 1);
    const dataFaturaAnterior = new Date(dataFatura);
    dataFaturaAnterior.setMonth(dataFaturaAnterior.getMonth() - 1);
    
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataFaturaAnterior.getFullYear()}-${(dataFaturaAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    // 1. Obter o status de pagamento de CADA fatura (atual e anterior)
    const statusPagamentoAtual = {};
    const statusPagamentoAnterior = {}; 

    Object.values(meusCartoes).forEach(cartao => {
        const nomeFatura = `Pagamento Fatura ${cartao.nome}`;
        statusPagamentoAtual[cartao.id] = Object.values(estadoGastos.pendencias[mesAtualPath] || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
        statusPagamentoAnterior[cartao.id] = Object.values(estadoGastos.pendencias[mesAnteriorPath] || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
    });

    // 2. Preparar objeto para armazenar totais
    let faturas = {};
    Object.values(meusCartoes).forEach(cartao => {
        faturas[cartao.id] = { total: 0 };
    });

    // 3. Processar Despesas e Fixos
    const fontesGastos = [
        ...Object.values(estadoGastos.despesas[mesAnteriorPath] || {}),
        ...Object.values(estadoGastos.despesas[mesAtualPath] || {}),
        ...Object.values(estadoGastos.fixos[mesAnteriorPath] || {}),
        ...Object.values(estadoGastos.fixos[mesAtualPath] || {})
    ];
    
    fontesGastos.forEach(gasto => {
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
            faturas[cartaoConfig.id].total += gasto.valor;
        }
    });

    // 4. Processar Compras Parceladas (cartoes_specs)
    Object.values(estadoGastos.specs).forEach(compra => {
        const cartaoConfig = Object.values(meusCartoes).find(c => c.nome === compra.cartao);
        if (!cartaoConfig) return;

        const [anoCompra, mesCompra] = compra.dataInicio.split('-');
        let dataInicioVirtual = new Date(anoCompra, mesCompra - 1, 1);
        
        while (true) {
            const path = `${dataInicioVirtual.getFullYear()}-${(dataInicioVirtual.getMonth() + 1).toString().padStart(2, '0')}`;
            const pendenciasDesseMes = estadoGastos.pendencias[path] || {};
            const faturaPaga = Object.values(pendenciasDesseMes).some(p => 
                p.descricao === `Pagamento Fatura ${cartaoConfig.nome}` && p.status === 'pago'
            );
            if (faturaPaga) {
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
            if (statusPagamentoAtual[cartaoConfig.id]) return; 

            const status = compra.status || 'ativo'; 
            const valorParcelaOriginal = compra.valorTotal / compra.parcelas;
            
            let valorParaTotal = 0;
            if (status === 'estornado' || status === 'quitado') {
                valorParaTotal = 0; 
            } else {
                valorParaTotal = valorParcelaOriginal;
            }
            
            faturas[cartaoConfig.id].total += valorParaTotal;
        }
    });

    // 5. Salva o total no dashboardState
    dashboardState.totalFaturasMes = Object.values(faturas).reduce((sum, f) => sum + f.total, 0);
    
    // 6. Atualiza a UI (agora com o total das faturas)
    updateUI();
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
// LÓGICA DOS GRÁFICOS (v5.1 - Corrigida)
// ===============================================================

function initCharts() {
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    const corGrid = estiloComputado.getPropertyValue('--text-light') || '#ccc';

    // Gráfico 1: Entradas vs Despesas (Barra)
    if (chartEntradasDespesasCtx) {
        chartEntradasDespesas = new Chart(chartEntradasDespesasCtx, {
            type: 'bar',
            data: {
                labels: ['Entradas', 'Despesas (Geral)'], // Rótulo atualizado
                datasets: [{
                    label: 'Valor',
                    data: [0, 0],
                    backgroundColor: ['rgba(118, 193, 107, 0.7)', 'rgba(216, 75, 75, 0.7)'],
                    borderColor: ['rgb(118, 193, 107)', 'rgb(216, 75, 75)'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        ticks: { color: corTexto, callback: (val) => formatCurrency(val) },
                        grid: { color: corGrid }
                    },
                    x: { ticks: { color: corTexto }, grid: { display: false } }
                }
            }
        });
    }
    
    // Gráfico 2: Despesas por Categoria (Pizza)
    if (chartDespesasCategoriaCtx) {
        chartDespesasCategoria = new Chart(chartDespesasCategoriaCtx, {
            type: 'doughnut',
            data: {
                labels: ['Nenhuma despesa'],
                datasets: [{
                    data: [], // v5.1 - Corrigido: Inicia vazio
                    backgroundColor: ['var(--background-dark)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: corTexto } }
                }
            }
        });
    }

    // Gráfico 3: Evolução do Saldo (Linha)
    if (chartEvolucaoSaldoCtx) {
        chartEvolucaoSaldo = new Chart(chartEvolucaoSaldoCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Saldo em Caixa',
                    data: [],
                    borderColor: 'rgb(75, 137, 218)',
                    backgroundColor: 'rgba(75, 137, 218, 0.7)',
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `Saldo: ${formatCurrency(ctx.parsed.y)}` } }
                },
                scales: {
                    y: {
                        ticks: { color: corTexto, callback: (val) => formatCurrency(val) },
                        grid: { color: corGrid }
                    },
                    x: { ticks: { color: corTexto }, grid: { display: false } }
                }
            }
        });
    }
}

function updateEntradasDespesasChart(receitas, despesas) {
    if (!chartEntradasDespesas) return;
    chartEntradasDespesas.data.datasets[0].data = [receitas, despesas];
    chartEntradasDespesas.update();
}

// ===============================================================
// ATUALIZADO (v5.1 - Lógica de Placeholder)
// ===============================================================
function updateDespesasCategoriaChart(categorias) {
    if (!chartDespesasCategoria) return;
    
    // Pega o placeholder (deve estar no HTML)
    const placeholder = document.getElementById('chart-despesas-placeholder');
    const canvas = chartDespesasCategoria.canvas;

    const sortedCategories = Object.entries(categorias)
        .filter(([, valor]) => valor > 0)
        .sort(([, a], [, b]) => b - a);
        
    if (sortedCategories.length === 0) {
        // BUG CORRIGIDO: Esconde o gráfico, mostra o placeholder
        if (placeholder) placeholder.style.display = 'block';
        if (canvas) canvas.style.display = 'none';
        chartDespesasCategoria.data.labels = [];
        chartDespesasCategoria.data.datasets[0].data = [];
    } else {
        // Mostra o gráfico, esconde o placeholder
        if (placeholder) placeholder.style.display = 'none';
        if (canvas) canvas.style.display = 'block';
        
        chartDespesasCategoria.data.labels = sortedCategories.map(([nome]) => nome);
        chartDespesasCategoria.data.datasets[0].data = sortedCategories.map(([, valor]) => valor);
        chartDespesasCategoria.data.datasets[0].backgroundColor = sortedCategories.map(([nome]) => CHART_COLORS[nome] || CHART_COLORS['Outros']);
    }
    chartDespesasCategoria.update();
}

// ===============================================================
// ATUALIZADO (v5.1 - Bug de Variável)
// ===============================================================
function updateCategoryTable(categorias, totalDespesas) {
    if (!catTableBodyEl) return;
    catTableBodyEl.innerHTML = '';
    
    // BUG CORRIGIDO: Usava 'dashboardState.categorias' (antigo)
    // Agora usa 'categorias' (o parâmetro)
    const sortedCategories = Object.entries(categorias)
        .filter(([, valor]) => valor > 0)
        .sort(([, a], [, b]) => b - a);
        
    if (sortedCategories.length === 0) {
        catTableBodyEl.innerHTML = '<tr><td colspan="3">Nenhuma despesa registrada.</td></tr>';
        return;
    }

    for (const [nome, valor] of sortedCategories) {
        const percentual = totalDespesas > 0 ? (valor / totalDespesas) * 100 : 0;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${nome}</td>
            <td>${formatCurrency(valor)}</td>
            <td>${percentual.toFixed(1)}%</td>
        `;
        catTableBodyEl.appendChild(tr);
    }
}

// (Função v5.0 - Sem mudanças)
async function loadDailyBalanceData() {
    if (!chartEvolucaoSaldo) return;
    
    const placeholder = document.getElementById('chart-evolucao-placeholder');
    const canvas = chartEvolucaoSaldo.canvas;

    // 1. Pega todas as transações do mês que afetam o saldo
    const pathEntradas = `dados/${userId}/entradas/${currentYear}-${currentMonth}`;
    const pathDespesas = `dados/${userId}/despesas/${currentYear}-${currentMonth}`;
    const pathFixos = `dados/${userId}/fixos/${currentYear}-${currentMonth}`;
    const pathPendencias = `dados/${userId}/pendencias/${currentYear}-${currentMonth}`;

    try {
        const [snapEntradas, snapDespesas, snapFixos, snapPendencias] = await Promise.all([
            get(ref(db, pathEntradas)),
            get(ref(db, pathDespesas)),
            get(ref(db, pathFixos)),
            get(ref(db, pathPendencias))
        ]);

        let dailyChanges = {};
        const diasNoMes = new Date(currentYear, currentMonth, 0).getDate();
        for (let i = 1; i <= diasNoMes; i++) {
            dailyChanges[i] = 0;
        }

        // 2. Processa Entradas
        snapEntradas.forEach(child => {
            const entrada = child.val();
            const dia = parseInt(entrada.data.split('-')[2]);
            dailyChanges[dia] += entrada.valor;
        });
        
        // 3. Processa Despesas (só as pagas com Saldo)
        snapDespesas.forEach(child => {
            const despesa = child.val();
            if (PAGAMENTO_AFETA_SALDO.includes(despesa.formaPagamento)) {
                const dia = parseInt(despesa.data.split('-')[2]);
                dailyChanges[dia] -= despesa.valor;
            }
        });
        
        // 4. Processa Fixos (só os pagos com Saldo)
        snapFixos.forEach(child => {
            const fixo = child.val();
            // v5.1 - Adiciona verificação de 'dataPagamento'
            if (fixo.status === 'pago' && fixo.dataPagamento && PAGAMENTO_AFETA_SALDO.includes(fixo.formaPagamento)) {
                const dia = parseInt(fixo.dataPagamento.split('-')[2]);
                dailyChanges[dia] -= fixo.valor;
            }
        });

        // 5. Processa Pendências (pagas E recebidas)
        snapPendencias.forEach(child => {
            const pend = child.val();
            if (pend.status === 'pago' && pend.vencimento && PAGAMENTO_AFETA_SALDO.includes(pend.formaPagamento)) {
                const dia = parseInt(pend.vencimento.split('-')[2]); // Usa 'vencimento' como data de referência
                if (pend.tipo === 'euDevo' && !pend.descricao.startsWith('Pagamento Fatura')) {
                    dailyChanges[dia] -= pend.valor;
                } else if (pend.tipo === 'meDeve') {
                    dailyChanges[dia] += pend.valor;
                }
            }
        });

        // 6. Calcula o Saldo Acumulado
        const labels = [];
        const data = [];
        let runningBalance = dashboardState.saldoMesAnterior; // Começa com o saldo anterior
        let hasTransactions = false;
        
        for (let i = 1; i <= diasNoMes; i++) {
            labels.push(i); // Label é só o dia (1, 2, 3...)
            runningBalance += dailyChanges[i];
            data.push(runningBalance);
            if (dailyChanges[i] !== 0) hasTransactions = true;
        }

        // 7. Renderiza o gráfico
        if (!hasTransactions && dashboardState.totalEntradas === 0) {
             if (placeholder) placeholder.style.display = 'block';
             if (canvas) canvas.style.display = 'none';
        } else {
             if (placeholder) placeholder.style.display = 'none';
             if (canvas) canvas.style.display = 'block';
        }
        
        chartEvolucaoSaldo.data.labels = labels;
        chartEvolucaoSaldo.data.datasets[0].data = data;
        chartEvolucaoSaldo.update();

    } catch (error) {
        console.error("Erro ao carregar dados do saldo diário:", error);
    }
}

// ===============================================================
// LÓGICA DO RESUMO ANUAL (v5.0)
// ===============================================================

async function loadAnnualSummary() {
    if (!userId || !tbodyResumoAnual) return;
    
    tbodyResumoAnual.innerHTML = '<tr><td colspan="4">Carregando dados anuais...</td></tr>';
    
    let annualData = [];
    let totalEntradasAno = 0;
    let totalDespesasAno = 0;

    const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    
    for (let i = 0; i < 12; i++) {
        const mesNum = (i + 1).toString().padStart(2, '0');
        const mesNome = meses[i];
        
        let totalEntradasMes = 0;
        let totalDespesasMes = 0; // (Caixa/Pix)
        
        const pathEntradas = `dados/${userId}/entradas/${currentYear}-${mesNum}`;
        const pathDespesas = `dados/${userId}/despesas/${currentYear}-${mesNum}`;
        const pathFixos = `dados/${userId}/fixos/${currentYear}-${mesNum}`;
        const pathPendencias = `dados/${userId}/pendencias/${currentYear}-${mesNum}`;
        
        try {
            const [snapEnt, snapDesp, snapFix, snapPend] = await Promise.all([
                get(ref(db, pathEntradas)),
                get(ref(db, pathDespesas)),
                get(ref(db, pathFixos)),
                get(ref(db, pathPendencias))
            ]);

            // 1. Total Entradas
            snapEnt.forEach(child => { totalEntradasMes += child.val().valor; });

            // 2. Total Despesas (pago com Saldo)
            snapDesp.forEach(child => {
                if (PAGAMENTO_AFETA_SALDO.includes(child.val().formaPagamento)) {
                    totalDespesasMes += child.val().valor;
                }
            });
            snapFix.forEach(child => {
                const fixo = child.val();
                if (fixo.status === 'pago' && PAGAMENTO_AFETA_SALDO.includes(fixo.formaPagamento)) {
                    totalDespesasMes += fixo.valor;
                }
            });
            snapPend.forEach(child => {
                const pend = child.val();
                if (pend.status === 'pago' && pend.tipo === 'euDevo' && 
                    !pend.descricao.startsWith('Pagamento Fatura') && 
                    PAGAMENTO_AFETA_SALDO.includes(pend.formaPagamento)) {
                    totalDespesasMes += pend.valor;
                }
            });
            
            const lucroMes = totalEntradasMes - totalDespesasMes;
            totalEntradasAno += totalEntradasMes;
            totalDespesasAno += totalDespesasMes;

            annualData.push({
                mes: mesNome,
                entradas: totalEntradasMes,
                despesas: totalDespesasMes,
                lucro: lucroMes
            });

        } catch (error) {
            console.error(`Erro ao carregar dados do mês ${mesNum}:`, error);
        }
    }
    
    renderAnnualSummary(annualData, totalEntradasAno, totalDespesasAno);
}

function renderAnnualSummary(data, totalEntradas, totalDespesas) {
    tbodyResumoAnual.innerHTML = '';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        const lucroClass = item.lucro < 0 ? 'text-danger' : 'text-success';
        tr.innerHTML = `
            <td>${item.mes}</td>
            <td>${formatCurrency(item.entradas)}</td>
            <td>${formatCurrency(item.despesas)}</td>
            <td class="${lucroClass}">${formatCurrency(item.lucro)}</td>
        `;
        tbodyResumoAnual.appendChild(tr);
    });

    // Linha de Total
    const trTotal = document.createElement('tr');
    trTotal.className = 'total-row'; // (Precisa de CSS)
    const lucroTotal = totalEntradas - totalDespesas;
    const lucroTotalClass = lucroTotal < 0 ? 'text-danger' : 'text-success';
    trTotal.innerHTML = `
        <td><strong>Total Ano</strong></td>
        <td><strong>${formatCurrency(totalEntradas)}</strong></td>
        <td><strong>${formatCurrency(totalDespesas)}</strong></td>
        <td class="<strong>${lucroTotalClass}</strong>"><strong>${formatCurrency(lucroTotal)}</strong></td>
    `;
    tbodyResumoAnual.appendChild(trTotal);
}


// ---- Funções Utilitárias (Horas e Modais) ----
function formatHoras(totalMinutos) {
    const h = Math.floor(totalMinutos / 60);
    const m = totalMinutos % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
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
    if(modal) {
        modal.style.display = 'none';
    }
}