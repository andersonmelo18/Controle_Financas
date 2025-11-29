// js/index.js
// VERSÃO 6.0 (Atualizado para 'usuarios/' e Otimizado o Carregamento Anual)

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
    totalDespesas: 0, 
    lucroLiquido: 0,
    saldoAcumulado: 0, 
    saldoMesAnterior: 0,
    kmTotal: 0,
    horasTotal: 0, 
    metaEntrada: 0,
    metaGasto: 0, 
    detalheVariaveis: 0, 
    detalheFixas: 0,     
    detalheDividas: 0,    
    totalFaturasMes: 0,  
    totalLimites: 0,
    dadosGraficoCat: {},
    dadosGraficoLinha: {},
    // v6.0: Otimizado - Guarda os dados anuais aqui
    dadosResumoAnual: {
        entradasAno: {},
        despesasAno: {},
        fixosAno: {},
        pendenciasAno: {}
    } 
};

// Instâncias dos Gráficos
let graficoCategorias = null;
let graficoEvolucao = null;
let graficoEntradasDespesas = null; // (v5.1)

// ===============================================================
// DOM (IDs do v5.1)
// ===============================================================
const kpiEntradasEl = document.getElementById('kpi-total-entradas');
const kpiDespesasEl = document.getElementById('kpi-total-despesas');
const kpiLucroEl = document.getElementById('kpi-lucro-liquido');
const kpiSaldoAcumuladoEl = document.getElementById('kpi-saldo-acumulado'); 
const kpiSaldoMesAnteriorEl = document.getElementById('saldo-mes-anterior');
const kpiHorasEl = document.getElementById('kpi-total-horas');
const kpiKmEl = document.getElementById('kpi-total-km');

const metaEntradaProgress = document.getElementById('meta-entrada-progress');
const metaEntradaPercent = document.getElementById('meta-entrada-percent');
const metaEntradaValor = document.getElementById('meta-entrada-valor');
const metaEntradaRestante = document.getElementById('meta-entrada-restante');
const metaGastoProgress = document.getElementById('meta-gasto-progress');
const metaGastoPercent = document.getElementById('meta-gasto-percent');
const metaGastoValor = document.getElementById('meta-gasto-valor');
const metaGastoRestante = document.getElementById('meta-gasto-restante');
const metaGastoGastoEl = document.getElementById('meta-gasto-gasto'); // (Faltava no v5.1)

const tbodyResumoDespesas = document.getElementById('tbody-resumo-despesas');
const tbodyGastosCategoria = document.getElementById('tbody-gastos-categoria');
const tbodyResumoCartoes = document.getElementById('tbody-resumo-cartoes');
const tbodyResumoAnual = document.getElementById('tbody-resumo-anual');
const listaContasPagar = document.getElementById('lancamentos-futuros-list');

const modalMetaEntrada = document.getElementById('modal-meta-entrada');
const formMetaEntrada = document.getElementById('form-meta-entrada');
const inputMetaEntrada = document.getElementById('input-meta-entrada');
const modalMetaGasto = document.getElementById('modal-meta-gasto');
const formMetaGasto = document.getElementById('form-meta-gasto');
const inputMetaGasto = document.getElementById('input-meta-gasto');
// ===============================================================


// ===============================================================
// INICIALIZAÇÃO SEGURA (CORREÇÃO ERRO 1)
// ===============================================================

document.addEventListener('authReady', (e) => {
    userId = e.detail.userId; 
    
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        limparListeners();
        loadAllDashboardData(e.yearChanged || false); 
    });

    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    loadAllDashboardData(true); 

    // --- CORREÇÃO: Verificação de segurança para os Modais ---
    const btnDefinirMeta = document.getElementById('btn-definir-meta');
    if (btnDefinirMeta) {
        btnDefinirMeta.addEventListener('click', () => {
            inputMetaEntrada.value = formatCurrency(dashboardState.metaEntrada).replace('R$', '').trim();
            modalMetaEntrada.style.display = 'flex';
        });
    }

    const btnDefinirMetaGasto = document.getElementById('btn-definir-meta-gasto');
    if (btnDefinirMetaGasto) {
        btnDefinirMetaGasto.addEventListener('click', () => {
            inputMetaGasto.value = formatCurrency(dashboardState.metaGasto).replace('R$', '').trim();
            modalMetaGasto.style.display = 'flex';
        });
    }

    // Fechar modais (verifica se existem antes)
    if (modalMetaEntrada) {
        const btnCancel = modalMetaEntrada.querySelector('.btn-cancel');
        if (btnCancel) btnCancel.addEventListener('click', () => modalMetaEntrada.style.display = 'none');
    }
    
    if (modalMetaGasto) {
        const btnCancel = modalMetaGasto.querySelector('.btn-cancel');
        if (btnCancel) btnCancel.addEventListener('click', () => modalMetaGasto.style.display = 'none');
    }
    
    // Salvar modais
    if (formMetaEntrada) formMetaEntrada.addEventListener('submit', handleSalvarMeta);
    if (formMetaGasto) formMetaGasto.addEventListener('submit', handleSalvarMetaGasto);

    // --- CORREÇÃO: Botões de Exportação ---
    const btnExportPdf = document.getElementById('btn-export-pdf');
    if (btnExportPdf) btnExportPdf.addEventListener('click', exportarPDF);

    const btnExportCsv = document.getElementById('btn-export-csv');
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportarCSV);
});

function limparListeners() {
    activeListeners.forEach(l => off(l.ref, 'value', l.callback));
    activeListeners = [];
}

// ===============================================================
// 1. CARREGAMENTO GERAL (CORREÇÃO ERRO 2)
// ===============================================================

async function loadAllDashboardData(yearChanged = false) {
    if (!userId) return;

    const paths = {
        saldoGlobal: `usuarios/${userId}/saldo/global`,
        metas: `usuarios/${userId}/metas`,
        metasGasto: `usuarios/${userId}/metas_gasto`,
        cartoesConfig: `usuarios/${userId}/cartoes/config`,
        cartoesSpecs: `usuarios/${userId}/cartoes_specs`,
        despesasMes: `usuarios/${userId}/despesas/${currentYear}-${currentMonth}`,
        fixosMes: `usuarios/${userId}/fixos/${currentYear}-${currentMonth}`,
        pendenciasMes: `usuarios/${userId}/pendencias/${currentYear}-${currentMonth}`,
        entradasMes: `usuarios/${userId}/entradas/${currentYear}-${currentMonth}`,
    };

    if (yearChanged) {
        paths.despesasAno = `usuarios/${userId}/despesas`;
        paths.entradasAno = `usuarios/${userId}/entradas`;
        paths.fixosAno = `usuarios/${userId}/fixos`; 
        paths.pendenciasAno = `usuarios/${userId}/pendencias`;
    }

    const dataPromises = Object.keys(paths).map(key => get(ref(db, paths[key])));

    try {
        const results = await Promise.all(dataPromises);
        
        const dataMap = {};
        Object.keys(paths).forEach((key, index) => {
            // Garante que é um objeto vazio se vier null
            dataMap[key] = results[index].val() || {};
        });

        // Lógica de Segurança para dados Anuais
        if (!yearChanged) {
            // Se não mudou o ano, pega do estado, MAS garante que não seja undefined
            dataMap.despesasAno = dashboardState.dadosResumoAnual.despesasAno || {};
            dataMap.entradasAno = dashboardState.dadosResumoAnual.entradasAno || {};
            dataMap.fixosAno = dashboardState.dadosResumoAnual.fixosAno || {};
            dataMap.pendenciasAno = dashboardState.dadosResumoAnual.pendenciasAno || {};
        } else {
            // Se mudou o ano (buscou do banco), garante que não seja undefined
            dataMap.despesasAno = dataMap.despesasAno || {};
            dataMap.entradasAno = dataMap.entradasAno || {};
            dataMap.fixosAno = dataMap.fixosAno || {};
            dataMap.pendenciasAno = dataMap.pendenciasAno || {};
        }

        processarDadosDashboard(dataMap);

    } catch (error) {
        console.error("Erro ao carregar dados do dashboard:", error);
    }
}

function processarDadosDashboard(dataMap) {
    // Zera o estado para recálculo
    dashboardState = {
        ...dashboardState,
        totalEntradas: 0, totalDespesas: 0, lucroLiquido: 0,
        kmTotal: 0, horasTotal: 0,
        detalheVariaveis: 0, detalheFixas: 0, detalheDividas: 0,
        totalFaturasMes: 0, totalLimites: 0,
        dadosGraficoCat: {}, dadosGraficoLinha: {},
        // v6.0: Atualiza o 'state' com os dados anuais (novos ou os antigos)
        dadosResumoAnual: {
            despesasAno: dataMap.despesasAno,
            entradasAno: dataMap.entradasAno,
            fixosAno: dataMap.fixosAno,
            pendenciasAno: dataMap.pendenciasAno
        }
    };

    // 1. Saldo e Metas
    dashboardState.saldoAcumulado = dataMap.saldoGlobal.saldoAcumulado || 0;
    dashboardState.metaEntrada = dataMap.metas.valor || 0;
    dashboardState.metaGasto = dataMap.metasGasto.valor || 0;
    
    // 2. Processa Entradas do Mês
    const entradasArray = Object.values(dataMap.entradasMes);
    dashboardState.totalEntradas = entradasArray.reduce((sum, e) => sum + e.valor, 0);
    dashboardState.kmTotal = entradasArray.reduce((sum, e) => sum + (e.km || 0), 0);
    dashboardState.horasTotal = entradasArray.reduce((sum, e) => sum + (e.horas || 0), 0);
    
    // 3. Processa Despesas (que afetam o saldo)
    const pagamentosQueAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro', 'Débito Automático'];
    
    // 3a. Despesas Variáveis
    Object.values(dataMap.despesasMes).forEach(d => {
        if (d.categoria === 'Fatura') return; 
        if (pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dashboardState.detalheVariaveis += d.valor;
        }
    });

    // 3b. Despesas Fixas (Apenas pagas)
    Object.values(dataMap.fixosMes).forEach(d => {
        if (d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dashboardState.detalheFixas += d.valor;
        }
    });

    // 3c. Pendências (Apenas 'euDevo' pagas)
    Object.values(dataMap.pendenciasMes).forEach(d => {
        if (d.tipo === 'euDevo' && d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dashboardState.detalheDividas += d.valor;
        }
    });

    dashboardState.totalDespesas = dashboardState.detalheVariaveis + dashboardState.detalheFixas + dashboardState.detalheDividas;
    dashboardState.lucroLiquido = dashboardState.totalEntradas - dashboardState.totalDespesas;

    // 4. Processa Cartões (Lógica de 'cartoes.js' v6.0 replicada)
    dashboardState.totalLimites = Object.values(dataMap.cartoesConfig).reduce((sum, c) => sum + (c.limiteTotal || 0), 0);
    const { totalFaturas } = calcularTotaisFaturas(dataMap);
    dashboardState.totalFaturasMes = totalFaturas;
    
    // 5. Prepara dados para os gráficos e resumos
    const dadosGeraisDespesas = {
        ...dataMap.despesasMes,
        ...dataMap.fixosMes,
        ...dataMap.pendenciasMes
    };
    dashboardState.dadosGraficoCat = prepararDadosGraficoCategorias(dadosGeraisDespesas);
    dashboardState.dadosGraficoLinha = prepararDadosGraficoLinha(dataMap.entradasMes, dataMap.despesasMes, dataMap.fixosMes, dataMap.pendenciasMes);
    
    // 6. Renderiza todos os componentes
    renderKPIs();
    renderMetas();
    renderResumoDespesas(dataMap.fixosMes, dataMap.pendenciasMes); 
    renderResumoCartoes(dataMap.cartoesConfig);
    renderGastosCategoriaTabela();
    renderGraficoCategorias();
    renderGraficoEvolucao();
    renderGraficoEntradasDespesas();
    renderResumoAnual(); // v6.0: Agora é síncrono
}

// ===============================================================
// 2. RENDERIZAÇÃO DOS COMPONENTES (v5.1 - Lógica mantida)
// ===============================================================

function renderKPIs() {
    kpiEntradasEl.textContent = formatCurrency(dashboardState.totalEntradas);
    kpiDespesasEl.textContent = formatCurrency(dashboardState.totalDespesas);
    kpiLucroEl.textContent = formatCurrency(dashboardState.lucroLiquido);
    kpiSaldoAcumuladoEl.textContent = formatCurrency(dashboardState.saldoAcumulado); 
    
    dashboardState.saldoMesAnterior = dashboardState.saldoAcumulado - dashboardState.lucroLiquido;
    kpiSaldoMesAnteriorEl.textContent = formatCurrency(dashboardState.saldoMesAnterior); 

    kpiHorasEl.textContent = formatHoras(dashboardState.horasTotal);
    kpiKmEl.textContent = `${dashboardState.kmTotal.toFixed(1)} km`;

    kpiLucroEl.className = dashboardState.lucroLiquido < 0 ? 'text-danger' : 'text-success';
    kpiSaldoAcumuladoEl.className = dashboardState.saldoAcumulado < 0 ? 'text-danger' : 'text-success';
}

function renderMetas() {
    // Meta de Entrada
    const percEntrada = (dashboardState.metaEntrada > 0) ? (dashboardState.totalEntradas / dashboardState.metaEntrada) * 100 : 0;
    const restanteEntrada = dashboardState.metaEntrada - dashboardState.totalEntradas;
    metaEntradaProgress.style.width = `${Math.min(percEntrada, 100)}%`;
    metaEntradaPercent.textContent = `${percEntrada.toFixed(1)}%`;
    metaEntradaValor.textContent = formatCurrency(dashboardState.metaEntrada);
    metaEntradaRestante.textContent = (restanteEntrada > 0) ? `${formatCurrency(restanteEntrada)} restantes` : `${formatCurrency(Math.abs(restanteEntrada))} acima`;
    
    // Meta de Gasto
    const percGasto = (dashboardState.metaGasto > 0) ? (dashboardState.totalDespesas / dashboardState.metaGasto) * 100 : 0;
    const restanteGasto = dashboardState.metaGasto - dashboardState.totalDespesas;
    metaGastoProgress.style.width = `${Math.min(percGasto, 100)}%`;
    metaGastoPercent.textContent = `${percGasto.toFixed(1)}%`;
    metaGastoValor.textContent = formatCurrency(dashboardState.metaGasto);
    metaGastoRestante.textContent = formatCurrency(restanteGasto);
    if(metaGastoGastoEl) metaGastoGastoEl.textContent = formatCurrency(dashboardState.totalDespesas);
    
    metaGastoProgress.style.backgroundColor = (percGasto > 100) ? 'var(--danger-color)' : 'var(--success-color)';
}

// v6.0: Caminhos atualizados
async function handleSalvarMeta(e) {
    e.preventDefault();
    const valor = parseCurrency(inputMetaEntrada.value);
    const metaRef = ref(db, `usuarios/${userId}/metas`);
    try {
        await set(metaRef, { valor: valor });
        dashboardState.metaEntrada = valor;
        renderMetas();
        modalMetaEntrada.style.display = 'none';
    } catch (error) {
        console.error("Erro ao salvar meta:", error);
    }
}

// v6.0: Caminhos atualizados
async function handleSalvarMetaGasto(e) {
    e.preventDefault();
    const valor = parseCurrency(inputMetaGasto.value);
    const metaGastoRef = ref(db, `usuarios/${userId}/metas_gasto`);
    try {
        await set(metaGastoRef, { valor: valor });
        dashboardState.metaGasto = valor;
        renderMetas();
        modalMetaGasto.style.display = 'none';
    } catch (error) {
        console.error("Erro ao salvar meta de gasto:", error);
    }
}

// ===============================================================
// 3. LÓGICA DOS GRÁFICOS E RESUMOS (v5.1 - Lógica mantida)
// ===============================================================

// (v5.1 - Corrigido bug de categoria 'Fatura')
function prepararDadosGraficoCategorias(despesasGerais) {
    const dadosGraficoCat = {};

    Object.values(despesasGerais).forEach(d => {
        if (!d || d.categoria === 'Fatura') return; // Ignora pagamentos de fatura
        
        const cat = (d.tipo === 'euDevo') ? "Dívidas" : (d.categoria || 'Outros');
        dadosGraficoCat[cat] = (dadosGraficoCat[cat] || 0) + d.valor;
    });

    return dadosGraficoCat;
}

function renderGraficoCategorias() {
    const data = dashboardState.dadosGraficoCat;
    const ctx = document.getElementById('chart-despesas-categoria').getContext('2d');
    const placeholder = document.getElementById('chart-despesas-placeholder');

    if (graficoCategorias) graficoCategorias.destroy();

    const labels = Object.keys(data);
    const valores = Object.values(data);

    if (labels.length === 0) {
        if(placeholder) placeholder.style.display = 'block';
        return;
    }
    if(placeholder) placeholder.style.display = 'none';
    
    const cores = [
        '#4A90E2', '#50E3C2', '#F5A623', '#D0021B', '#BD10E0', 
        '#9013FE', '#B8E986', '#7ED321', '#417505', '#F8E71C'
    ];

    graficoCategorias = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: valores,
                backgroundColor: cores,
                borderColor: 'rgba(0,0,0,0)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.body).getPropertyValue('--text-color'),
                        boxWidth: 20,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) label += ': ';
                            label += formatCurrency(context.raw);
                            
                            const total = valores.reduce((a, b) => a + b, 0);
                            const percent = ((context.raw / total) * 100).toFixed(1);
                            label += ` (${percent}%)`;
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function renderGastosCategoriaTabela() {
    const data = dashboardState.dadosGraficoCat;
    tbodyGastosCategoria.innerHTML = ''; 
    
    const totalGastos = Object.values(data).reduce((sum, v) => sum + v, 0);
    
    const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);

    if (sortedData.length === 0) {
        tbodyGastosCategoria.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-light);">Nenhum gasto no mês.</td></tr>';
        return;
    }

    sortedData.forEach(([categoria, valor]) => {
        const percent = (totalGastos > 0) ? (valor / totalGastos) * 100 : 0;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${categoria}</td>
            <td>${formatCurrency(valor)}</td>
            <td>${percent.toFixed(1)}%</td>
        `;
        tbodyGastosCategoria.appendChild(tr);
    });
}


function renderResumoDespesas(fixosMes, pendenciasMes) {
    let fixasPendente = 0;
    Object.values(fixosMes).forEach(d => {
        if (d.status === 'pendente') fixasPendente += d.valor;
    });

    let pendenciasPendente = 0;
    Object.values(pendenciasMes).forEach(d => {
        if (d.tipo === 'euDevo' && d.status === 'pendente') pendenciasPendente += d.valor;
    });

    const totalGeral = dashboardState.totalDespesas + dashboardState.totalFaturasMes;

    tbodyResumoDespesas.innerHTML = `
        <li>
            <span>Variáveis (do Saldo)</span>
            <strong id="detalhe-variaveis">${formatCurrency(dashboardState.detalheVariaveis)}</strong>
        </li>
        <li>
            <span>Fixas (do Saldo)</span>
            <strong id="detalhe-fixas">${formatCurrency(dashboardState.detalheFixas)}</strong>
        </li>
        <li>
            <span>Dívidas (do Saldo)</span>
            <strong id="detalhe-dividas">${formatCurrency(dashboardState.detalheDividas)}</strong>
        </li>
        <li class="total">
            <span>Total (Pago c/ Saldo)</span>
            <strong id="detalhe-total-despesas">${formatCurrency(dashboardState.totalDespesas)}</strong>
        </li>
        <hr>
        <li>
            <span>Total Faturas (Cartões)</span>
            <strong id="detalhe-faturas" class="text-danger">${formatCurrency(dashboardState.totalFaturasMes)}</strong>
        </li>
        <li class="total-geral">
            <span>GASTO TOTAL GERAL</span>
            <strong id="detalhe-total-geral">${formatCurrency(totalGeral)}</strong>
        </li>
    `;

    listaContasPagar.innerHTML = `
        <li>
            <span>Fixas (A Pagar)</span>
            <strong id="futuro-fixas" class="${fixasPendente > 0 ? 'text-danger' : ''}">${formatCurrency(fixasPendente)}</strong>
        </li>
        <li>
            <span>Pendências (A Pagar)</span>
            <strong id="futuro-pendencias" class="${pendenciasPendente > 0 ? 'text-danger' : ''}">${formatCurrency(pendenciasPendente)}</strong>
        </li>
    `;
}

function renderResumoCartoes(cartoesConfig) {
    const totalFaturas = dashboardState.totalFaturasMes;
    const totalLimites = dashboardState.totalLimites;

    const percConsumido = (totalLimites > 0) ? (totalFaturas / totalLimites) * 100 : 0;

    tbodyResumoCartoes.innerHTML = `
        <div class="goal-header">
            <span>Limite Total (Soma)</span>
            <strong id="total-limites-cartoes">${formatCurrency(totalLimites)}</strong>
        </div>
        <div class="goal-header">
            <span>Faturas Abertas (Mês)</span>
            <strong id="total-faturas-aberto" class="text-danger">${formatCurrency(totalFaturas)}</strong>
        </div>
        <div class="progress-bar" style="margin-top: 1rem;">
            <div class="progress" id="limite-cartao-progress" style="width: ${Math.min(percConsumido, 100)}%; background-color: var(--danger-color);"></div>
        </div>
        <small style="text-align: center; display: block; margin-top: 0.5rem;">${percConsumido.toFixed(1)}% do limite total consumido</small>
    `;
}


function prepararDadosGraficoLinha(entradasMes, despesasMes, fixosMes, pendenciasMes) {
    const dados = {}; 
    const diasNoMes = new Date(currentYear, currentMonth, 0).getDate();
    
    for (let i = 1; i <= diasNoMes; i++) {
        const dataKey = `${currentYear}-${currentMonth}-${i.toString().padStart(2, '0')}`;
        dados[dataKey] = { entradas: 0, despesas: 0 };
    }

    Object.values(entradasMes).forEach(e => {
        if (dados[e.data]) {
            dados[e.data].entradas += e.valor;
        }
    });

    const pagamentosQueAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro', 'Débito Automático'];
    
    Object.values(despesasMes).forEach(d => {
        if (d.data && dados[d.data] && pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dados[d.data].despesas += d.valor;
        }
    });
    Object.values(fixosMes).forEach(d => {
        if (d.vencimento && dados[d.vencimento] && d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dados[d.vencimento].despesas += d.valor;
        }
    });
    Object.values(pendenciasMes).forEach(d => {
        if (d.vencimento && dados[d.vencimento] && d.tipo === 'euDevo' && d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)) {
            dados[d.vencimento].despesas += d.valor;
        }
    });

    return dados;
}

function renderGraficoEvolucao() {
    const dados = dashboardState.dadosGraficoLinha;
    const ctx = document.getElementById('chart-evolucao-saldo').getContext('2d');
    const placeholder = document.getElementById('chart-evolucao-placeholder');

    if (graficoEvolucao) graficoEvolucao.destroy();

    const sortedKeys = Object.keys(dados).sort();
    let saldoAcumulado = dashboardState.saldoMesAnterior;
    
    const labels = [];
    const dataSaldo = [];

    sortedKeys.forEach(dataKey => {
        const dia = dataKey.split('-')[2];
        const movimento = dados[dataKey];
        saldoAcumulado += (movimento.entradas - movimento.despesas);
        
        labels.push(dia);
        dataSaldo.push(saldoAcumulado);
    });

    if (labels.length === 0 || (dashboardState.totalEntradas === 0 && dashboardState.totalDespesas === 0)) {
        if(placeholder) placeholder.style.display = 'block';
        return;
    }
    if(placeholder) placeholder.style.display = 'none';

    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    
    graficoEvolucao = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Saldo em Caixa Acumulado',
                data: dataSaldo,
                borderColor: 'rgb(75, 137, 218)',
                backgroundColor: 'rgba(75, 137, 218, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => `Saldo em ${c.label}/${currentMonth}: ${formatCurrency(c.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    ticks: { color: corTexto, callback: (v) => formatCurrency(v) },
                    grid: { color: 'rgba(200, 200, 200, 0.1)' }
                },
                x: {
                    ticks: { color: corTexto },
                    grid: { display: false }
                }
            }
        }
    });
}

function renderGraficoEntradasDespesas() {
    const dados = dashboardState.dadosGraficoLinha;
    const ctx = document.getElementById('chart-entradas-despesas').getContext('2d');
    if (!ctx) return;

    if (graficoEntradasDespesas) graficoEntradasDespesas.destroy();

    const sortedKeys = Object.keys(dados).sort();
    
    const labels = [];
    const dataEntradas = [];
    const dataDespesas = [];

    sortedKeys.forEach(dataKey => {
        const dia = dataKey.split('-')[2];
        const movimento = dados[dataKey];
        
        labels.push(dia);
        dataEntradas.push(movimento.entradas);
        dataDespesas.push(movimento.despesas);
    });

    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';

    graficoEntradasDespesas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Entradas',
                    data: dataEntradas,
                    backgroundColor: 'rgba(118, 193, 107, 0.8)', // Verde
                    borderRadius: 4
                },
                {
                    label: 'Despesas (do Saldo)',
                    data: dataDespesas,
                    backgroundColor: 'rgba(219, 80, 74, 0.8)', // Vermelho
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { color: corTexto } 
                },
                tooltip: {
                    callbacks: { label: (c) => `${c.dataset.label}: ${formatCurrency(c.raw)}` }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: corTexto, callback: (v) => formatCurrency(v) },
                    grid: { color: 'rgba(200, 200, 200, 0.1)' }
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
// 4. LÓGICA DE CÁLCULO DE FATURAS (v5.1 - Lógica mantida)
// ===============================================================

function calcularTotaisFaturas(dataMap) {
    let totalFaturas = 0;
    const dataFatura = new Date(currentYear, currentMonth - 1, 1);
    
    const dataFaturaAnterior = new Date(dataFatura);
    dataFaturaAnterior.setMonth(dataFaturaAnterior.getMonth() - 1);
    const mesAtualPath = `${currentYear}-${currentMonth}`;
    const mesAnteriorPath = `${dataFaturaAnterior.getFullYear()}-${(dataFaturaAnterior.getMonth() + 1).toString().padStart(2, '0')}`;

    const statusPagamentoAtual = {};
    const statusPagamentoAnterior = {}; 

    Object.values(dataMap.cartoesConfig).forEach(cartao => {
        const nomeFatura = `Pagamento Fatura ${cartao.nome}`;
        
        const pagoEmDespesas = Object.values(dataMap.despesasMes || {}).some(p => 
            p.descricao === nomeFatura && p.categoria === 'Fatura'
        );
        const pagoEmPendencias = Object.values(dataMap.pendenciasMes || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
        statusPagamentoAtual[cartao.id] = pagoEmDespesas || pagoEmPendencias;
        
        statusPagamentoAnterior[cartao.id] = Object.values(dataMap.pendencias[mesAnteriorPath] || {}).some(p => 
            p.descricao === nomeFatura && p.status === 'pago'
        );
    });

    // Agrega todas as fontes de gastos (v6.0 - usa os dados já carregados)
    const fontesGastos = [
        ...Object.values(dataMap.despesasAno[mesAnteriorPath] || {}),
        ...Object.values(dataMap.despesasMes || {}),
        ...Object.values(dataMap.fixosAno[mesAnteriorPath] || {}),
        ...Object.values(dataMap.fixosMes || {})
    ];

    fontesGastos.forEach(gasto => {
        if (gasto.categoria === 'Fatura') return; 

        if (!gasto.data && !gasto.vencimento) return;
        const cartaoConfig = Object.values(dataMap.cartoesConfig).find(c => c.nome === gasto.formaPagamento);
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
            
            totalFaturas += gasto.valor;
        }
    });

    Object.values(dataMap.cartoesSpecs).forEach(compra => {
        // v6.0: Corrigido - Busca a config pelo nome, não pelo ID
        const cartaoConfig = Object.values(dataMap.cartoesConfig).find(c => c.nome === compra.cartao);
        if (!cartaoConfig) return;

        if (!compra.dataInicio || compra.dataInicio.split('-').length < 2) {
             console.warn('Compra parcelada ignorada (dataInicio inválida):', compra.descricao);
             return;
        }

        const [anoInicioOriginal, mesInicioOriginal] = compra.dataInicio.split('-').map(Number);
        let dataInicioVirtual = new Date(anoInicioOriginal, mesInicioOriginal - 1, 1);
        
        while (true) {
            const path = `${dataInicioVirtual.getFullYear()}-${(dataInicioVirtual.getMonth() + 1).toString().padStart(2, '0')}`;
            // v6.0: Usa os dados anuais já carregados
            const pendenciasDesseMes = dataMap.pendenciasAno[path] || {};
            const despesasDesseMes = dataMap.despesasAno[path] || {};

            const faturaPagaEmPendencias = Object.values(pendenciasDesseMes).some(p => 
                p.descricao === `Pagamento Fatura ${cartaoConfig.nome}` && p.status === 'pago'
            );
            const faturaPagaEmDespesas = Object.values(despesasDesseMes).some(p =>
                p.descricao === `Pagamento Fatura ${cartaoConfig.nome}` && p.categoria === 'Fatura'
            );
            
            if (faturaPagaEmPendencias || faturaPagaEmDespesas) {
                dataInicioVirtual.setMonth(dataInicioVirtual.getMonth() + 1);
            } else {
                break;
            }
        }
        
        const isFaturaAtual = (dataInicioVirtual.getFullYear() === dataFatura.getFullYear() &&
                               dataInicioVirtual.getMonth() === dataFatura.getMonth());

        let mesesDiffLabel = (dataFatura.getFullYear() - anoInicioOriginal) * 12 + (dataFatura.getMonth() + 1 - mesInicioOriginal);
        let parcelaAtualLabel = mesesDiffLabel + 1;

        if (isFaturaAtual && parcelaAtualLabel >= 1 && parcelaAtualLabel <= compra.parcelas) {
            
            if (statusPagamentoAtual[cartaoConfig.id]) { 
                return; 
            }

            const status = compra.status || 'ativo'; 
            const valorParcelaOriginal = compra.valorTotal / compra.parcelas;
            
            if (status === 'ativo' || status === 'quitado_pagamento') {
                totalFaturas += valorParcelaOriginal;
            }
        }
    });

    return { totalFaturas };
}

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


// ===============================================================
// 5. RESUMO ANUAL (v6.0 - Otimizado e Corrigido)
// ===============================================================
/**
 * v6.0: Esta função agora é SÍNCRONA. Ela usa os dados já carregados
 * no 'dashboardState' em vez de buscar no Firebase novamente.
 */
function renderResumoAnual() {
    const dataEntradas = dashboardState.dadosResumoAnual.entradasAno;
    const dataDespesas = dashboardState.dadosResumoAnual.despesasAno;
    const dataFixos = dashboardState.dadosResumoAnual.fixosAno;
    const dataPendencias = dashboardState.dadosResumoAnual.pendenciasAno;
    
    tbodyResumoAnual.innerHTML = '';
    
    let totalEntradas = 0;
    let totalDespesas = 0;

    const meses = Array.from({length: 12}, (_, i) => `${currentYear}-${(i + 1).toString().padStart(2, '0')}`);
    const pagamentosQueAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro', 'Débito Automático'];

    meses.forEach(mesKey => {
        const [ano, mes] = mesKey.split('-');
        const mesNome = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'short' });
        
        const entradasMes = Object.values(dataEntradas[mesKey] || {}).reduce((sum, e) => sum + e.valor, 0);
        
        const despesasVarMes = Object.values(dataDespesas[mesKey] || {})
            .filter(d => d.categoria !== 'Fatura' && pagamentosQueAfetamSaldo.includes(d.formaPagamento))
            .reduce((sum, d) => sum + d.valor, 0);

        const despesasFixasMes = Object.values(dataFixos[mesKey] || {})
            .filter(d => d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento))
            .reduce((sum, d) => sum + d.valor, 0);
            
        const despesasPendenciasMes = Object.values(dataPendencias[mesKey] || {})
            .filter(d => d.tipo === 'euDevo' && d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento))
            .reduce((sum, d) => sum + d.valor, 0);

        const despesasMesTotal = despesasVarMes + despesasFixasMes + despesasPendenciasMes;

        totalEntradas += entradasMes;
        totalDespesas += despesasMesTotal;
        
        const lucro = entradasMes - despesasMesTotal;
        const lucroClass = lucro < 0 ? 'text-danger' : 'text-success';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${mesNome.toUpperCase()}./${ano}</td>
            <td class="text-success">${formatCurrency(entradasMes)}</td>
            <td class="text-danger">${formatCurrency(despesasMesTotal)}</td>
            <td class="${lucroClass}">${formatCurrency(lucro)}</td>
        `;
        tbodyResumoAnual.appendChild(tr);
    });

    const trTotal = document.createElement('tr');
    trTotal.className = 'total-row'; 
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
    
    btnConfirm.parentNode.replaceChild(newBtnConfirm, btnConfirm);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if(modal) {
        modal.style.display = 'none';
    }
}


// ===============================================================
// 6. EXPORTAÇÃO (v5.1 - Lógica mantida)
// ===============================================================
function exportarPDF() {
    // Implementação da exportação PDF (mantida do seu v5.1)
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.text(`Relatório Financeiro - ${currentMonth}/${currentYear}`, 14, 16);
    
    // AutoTable
    doc.autoTable({
        startY: 25,
        head: [['Resumo do Mês', 'Valor']],
        body: [
            ['Total Entradas', formatCurrency(dashboardState.totalEntradas)],
            ['Despesas (do Saldo)', formatCurrency(dashboardState.totalDespesas)],
            ['Lucro Líquido (do Saldo)', formatCurrency(dashboardState.lucroLiquido)],
            ['Saldo Início do Mês', formatCurrency(dashboardState.saldoMesAnterior)],
            ['Saldo Atual (Global)', formatCurrency(dashboardState.saldoAcumulado)],
            ['Total Faturas (Cartões)', formatCurrency(dashboardState.totalFaturasMes)],
            ['Gasto Total (Saldo + Faturas)', formatCurrency(dashboardState.totalDespesas + dashboardState.totalFaturasMes)],
        ]
    });
    
    doc.save(`Relatorio_FinanControl_${currentYear}_${currentMonth}.pdf`);
}

function exportarCSV() {
    // Implementação da exportação CSV (mantida do seu v5.1)
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Relatório Financeiro\r\n";
    csvContent += `Mês/Ano;,${currentMonth}/${currentYear}\r\n\r\n`;
    
    csvContent += "Resumo do Mês;Valor\r\n";
    csvContent += `Total Entradas;${formatCurrency(dashboardState.totalEntradas)}\r\n`;
    csvContent += `Despesas (do Saldo);${formatCurrency(dashboardState.totalDespesas)}\r\n`;
    csvContent += `Lucro Líquido (do Saldo);${formatCurrency(dashboardState.lucroLiquido)}\r\n`;
    csvContent += `Saldo Início do Mês;${formatCurrency(dashboardState.saldoMesAnterior)}\r\n`;
    csvContent += `Saldo Atual (Global);${formatCurrency(dashboardState.saldoAcumulado)}\r\n`;
    csvContent += `Total Faturas (Cartões);${formatCurrency(dashboardState.totalFaturasMes)}\r\n`;
    csvContent += `Gasto Total (Saldo + Faturas);${formatCurrency(dashboardState.totalDespesas + dashboardState.totalFaturasMes)}\r\n`;
    
    csvContent += "\r\nResumo Anual (Despesas do Saldo)\r\n";
    csvContent += "Mês;Entradas;Despesas;Lucro/Prejuízo\r\n";
    
    const dataAnual = dashboardState.dadosResumoAnual;
    const meses = Array.from({length: 12}, (_, i) => `${currentYear}-${(i + 1).toString().padStart(2, '0')}`);
    const pagamentosQueAfetamSaldo = ['Saldo em Caixa', 'Pix', 'Dinheiro', 'Débito Automático'];

    meses.forEach(mesKey => {
        const [ano, mes] = mesKey.split('-');
        const mesNome = new Date(ano, mes - 1, 1).toLocaleString('pt-BR', { month: 'short' });
        
        const entradasMes = Object.values(dataAnual.entradasAno[mesKey] || {}).reduce((sum, e) => sum + e.valor, 0);
        const despesasVarMes = Object.values(dataAnual.despesasAno[mesKey] || {}).filter(d => d.categoria !== 'Fatura' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)).reduce((sum, d) => sum + d.valor, 0);
        const despesasFixasMes = Object.values(dataAnual.fixosAno[mesKey] || {}).filter(d => d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)).reduce((sum, d) => sum + d.valor, 0);
        const despesasPendenciasMes = Object.values(dataAnual.pendenciasAno[mesKey] || {}).filter(d => d.tipo === 'euDevo' && d.status === 'pago' && pagamentosQueAfetamSaldo.includes(d.formaPagamento)).reduce((sum, d) => sum + d.valor, 0);
        const despesasMesTotal = despesasVarMes + despesasFixasMes + despesasPendenciasMes;
        const lucro = entradasMes - despesasMesTotal;

        csvContent += `${mesNome.toUpperCase()}./${ano};${formatCurrency(entradasMes)};${formatCurrency(despesasMesTotal)};${formatCurrency(lucro)}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Relatorio_FinanControl_${currentYear}_${currentMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}