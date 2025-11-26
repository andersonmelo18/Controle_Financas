// js/entradas.js
// VERSÃO 5.0 (Gráfico Semanal tipo Uber, Visualização de Comprovantes e Gráficos Melhorados)

import { 
    db, ref, set, get, push, remove, onValue, off, update
} from './firebase-config.js';
import { 
    getUserId, formatCurrency, parseCurrency, verificarSaldoSuficiente 
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
let activeListener = null;

let allEntradasDoMes = [];
let currentFilters = { origem: 'todas', busca: '' };

// Instâncias dos Gráficos
let graficoEntradas = null; // Evolução
let graficoSemanal = null;  // Torres (Uber)
let semanaSelecionadaIndex = 0; // 0 = Primeira semana do mês

// ---- Mapas de Ícones ----
const origemIcones = {
    "Salário": "💰", "Uber": "🚗", "99": "🚗", "Indrive": "🚗",
    "Shopee": "📦", "iFood": "🍔", "Gorjetas": "💵",
    "Vendas Online": "💻", "Outros": "🧩"
};

// ---- Elementos DOM (Formulário) ----
const form = document.getElementById('form-add-entrada');
const dataInput = document.getElementById('entrada-data');
const origemSelect = document.getElementById('entrada-plataforma');
const descricaoInput = document.getElementById('entrada-descricao');
const valorInput = document.getElementById('entrada-valor');
const kmInput = document.getElementById('entrada-km');
const horasInput = document.getElementById('entrada-horas');
const comprovanteInput = document.getElementById('entrada-comprovante');

// ---- Elementos DOM (Tabela e Totais) ----
const tbody = document.getElementById('tbody-entradas');
const totalEntradasEl = document.getElementById('total-mes-entradas');
const totalKmEl = document.getElementById('total-mes-km');
const totalHorasEl = document.getElementById('total-mes-horas');
const totalFiltradoEl = document.getElementById('total-filtrado');

// ---- Elementos DOM (Filtros e Gráficos) ----
const filtroOrigem = document.getElementById('filtro-origem');
const filtroBusca = document.getElementById('filtro-busca');
const btnLimparFiltros = document.getElementById('btn-limpar-filtros');

// NOVO: Elementos do Gráfico Semanal
const filtroSemana = document.getElementById('filtro-semana'); // Select da semana
const canvasGraficoSemanal = document.getElementById('grafico-semanal'); // Canvas do gráfico de barras

// ---- Modais ----
const modalConfirm = document.getElementById('modal-confirm');
const modalMessage = document.getElementById('modal-message');
const modalEdit = document.getElementById('modal-edit-entrada');
const formEdit = document.getElementById('form-edit-entrada');
// Inputs do Edit (mesmos IDs do seu código original)
const editDataInput = document.getElementById('edit-entrada-data');
const editOrigemSelect = document.getElementById('edit-entrada-plataforma');
const editDescricaoInput = document.getElementById('edit-entrada-descricao');
const editValorInput = document.getElementById('edit-entrada-valor');
const editKmInput = document.getElementById('edit-entrada-km');
const editHorasInput = document.getElementById('edit-entrada-horas');
const editComprovanteDisplay = document.getElementById('edit-comprovante-display');
const btnCancelEdit = document.getElementById('modal-edit-btn-cancel');

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
    
    document.addEventListener('monthChanged', (e) => {
        currentYear = e.detail.year;
        currentMonth = e.detail.month;
        updateDataInput();
        // Recalcula as semanas disponíveis para o novo mês
        populateSemanaFilter();
        loadEntradas();
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    populateFilterOrigens();
    populateSemanaFilter(); // Inicializa as semanas

    // Listeners Filtros
    filtroOrigem.addEventListener('change', (e) => {
        currentFilters.origem = e.target.value;
        renderTabela();
    });
    filtroBusca.addEventListener('input', (e) => {
        currentFilters.busca = e.target.value.toLowerCase();
        renderTabela();
    });
    btnLimparFiltros.addEventListener('click', resetFilters);

    // Listener Filtro Semana (Gráfico)
    if(filtroSemana) {
        filtroSemana.addEventListener('change', (e) => {
            semanaSelecionadaIndex = parseInt(e.target.value);
            renderGraficoSemanal(); // Atualiza apenas o gráfico semanal
        });
    }
    
    updateDataInput();
    loadEntradas();

    // Listeners Form
    form.addEventListener('submit', handleFormSubmit);
    if (formEdit) formEdit.addEventListener('submit', handleSaveEdit);
    if (btnCancelEdit) btnCancelEdit.addEventListener('click', () => modalEdit.style.display = 'none');
});

function populateFilterOrigens() {
    filtroOrigem.innerHTML = '<option value="todas">Todas as Origens</option>';
    for (const origem in origemIcones) {
        const option = document.createElement('option');
        option.value = origem;
        option.textContent = `${origemIcones[origem]} ${origem}`;
        filtroOrigem.appendChild(option);
    }
}

/**
 * Calcula as semanas do mês atual e preenche o select
 */
function populateSemanaFilter() {
    if(!filtroSemana) return;
    filtroSemana.innerHTML = '';
    
    // Total de dias no mês
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const weeks = [];
    
    // Lógica simples: Quebra em blocos de 7 dias (pode ser ajustado para calendário real Seg-Dom)
    // Para estilo "Uber", vamos fazer blocos sequenciais para facilitar a visualização
    let startDay = 1;
    let weekCount = 1;
    
    while(startDay <= daysInMonth) {
        let endDay = startDay + 6;
        if(endDay > daysInMonth) endDay = daysInMonth;
        
        weeks.push({
            label: `Semana ${weekCount} (${startDay.toString().padStart(2,'0')}/${currentMonth} a ${endDay.toString().padStart(2,'0')}/${currentMonth})`,
            start: startDay,
            end: endDay,
            index: weekCount - 1
        });
        
        startDay = endDay + 1;
        weekCount++;
    }

    weeks.forEach(week => {
        const option = document.createElement('option');
        option.value = week.index;
        option.textContent = week.label;
        filtroSemana.appendChild(option);
    });

    // Seleciona a semana atual baseada no dia de hoje (se estivermos no mês atual)
    const hoje = new Date();
    const isCurrentMonth = (hoje.getFullYear() == currentYear && (hoje.getMonth() + 1) == currentMonth);
    
    if(isCurrentMonth) {
        const diaHoje = hoje.getDate();
        const semanaAtual = weeks.find(w => diaHoje >= w.start && diaHoje <= w.end);
        if(semanaAtual) semanaSelecionadaIndex = semanaAtual.index;
    } else {
        semanaSelecionadaIndex = 0; // Default para primeira semana
    }
    
    filtroSemana.value = semanaSelecionadaIndex;
}

function updateDataInput() {
    const todayISO = getLocalDateISO();
    const [todayYear, todayMonth] = todayISO.split('-');
    const inicioMesISO = `${currentYear}-${currentMonth}-01`;
    
    if (todayYear == currentYear && todayMonth == currentMonth) {
        dataInput.value = todayISO;
    } else {
        dataInput.value = inicioMesISO;
    }
}

// ===============================================================
// LÓGICA DE DADOS (Load & Render)
// ===============================================================

function loadEntradas() {
    if (!userId) return;

    if (activeListener) {
        off(activeListener.ref, 'value', activeListener.callback);
    }
    
    const path = `dados/${userId}/entradas/${currentYear}-${currentMonth}`;
    const dataRef = ref(db, path);
    
    const callback = (snapshot) => {
        allEntradasDoMes = [];
        let totalMes = 0;
        let totalKm = 0;
        let totalMinutos = 0; 
        
        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const entrada = child.val();
                allEntradasDoMes.push(entrada);
                totalMes += entrada.valor;
                totalKm += entrada.km || 0;
                totalMinutos += entrada.horas || 0;
            });
        }
        
        totalEntradasEl.textContent = formatCurrency(totalMes);
        totalKmEl.textContent = `${totalKm.toFixed(1)} km`;
        totalHorasEl.textContent = formatHoras(totalMinutos);
        
        renderTabela();
        renderGraficoSemanal(); // Renderiza o novo gráfico
    };
    
    onValue(dataRef, callback);
    activeListener = { ref: dataRef, callback: callback };
}

function renderTabela() {
    tbody.innerHTML = '';
    
    const filtros = currentFilters;
    const entradasFiltradas = allEntradasDoMes.filter(entrada => {
        const matchOrigem = filtros.origem === 'todas' || entrada.origem === filtros.origem;
        const matchBusca = filtros.busca === '' || entrada.descricao.toLowerCase().includes(filtros.busca);
        return matchOrigem && matchBusca;
    });

    const totalFiltrado = entradasFiltradas.reduce((sum, d) => sum + d.valor, 0);
    totalFiltradoEl.textContent = formatCurrency(totalFiltrado);

    if (entradasFiltradas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhuma entrada encontrada.</td></tr>';
        renderGraficoEntradas({});
        return;
    }

    entradasFiltradas.sort((a, b) => b.data.localeCompare(a.data));

    const entradasPorDia = {};
    for (const entrada of entradasFiltradas) {
        if (!entradasPorDia[entrada.data]) entradasPorDia[entrada.data] = [];
        entradasPorDia[entrada.data].push(entrada);
    }

    for (const data in entradasPorDia) {
        const entradasDoDia = entradasPorDia[data];
        const totalValorDia = entradasDoDia.reduce((sum, d) => sum + d.valor, 0);
        const totalKmDia = entradasDoDia.reduce((sum, d) => sum + (d.km || 0), 0);
        const totalHorasDia = entradasDoDia.reduce((sum, d) => sum + (d.horas || 0), 0);
        
        const [y, m, d] = data.split('-');
        const dataFormatada = `${d}/${m}/${y}`;
        
        // Header do dia com colspan ajustado para 7 colunas
        const trHeader = document.createElement('tr');
        trHeader.className = 'day-header';
        trHeader.innerHTML = `
            <td colspan="2"><strong>${dataFormatada}</strong></td>
            <td><strong>${formatCurrency(totalValorDia)}</strong></td>
            <td></td> <td><strong>${totalKmDia.toFixed(1)}</strong></td>
            <td><strong>${formatHoras(totalHorasDia)}</strong></td>
            <td></td>
        `;
        tbody.appendChild(trHeader);

        for (const entrada of entradasDoDia) {
            renderRow(entrada);
        }
    }

    renderGraficoEntradas(entradasPorDia);
}

/**
 * Renderiza a linha (TR) com a nova coluna de arquivo
 */
function renderRow(entrada) {
    if (!entrada.data) return;

    const tr = document.createElement('tr');
    tr.dataset.id = entrada.id;
    // ... (datasets mantidos para lógica de edit/duplicate)
    tr.dataset.valor = entrada.valor;
    tr.dataset.data = entrada.data;
    tr.dataset.origem = entrada.origem;
    tr.dataset.descricao = entrada.descricao || '';
    tr.dataset.km = entrada.km || 0;
    tr.dataset.horas = entrada.horas || 0;
    tr.dataset.comprovante = entrada.comprovante || '';

    const [y, m, d] = entrada.data.split('-');
    const dataFormatada = `${d}/${m}/${y}`;
    const icone = origemIcones[entrada.origem] || "🧩"; 
    
    // Lógica do Comprovante
    let comprovanteHtml = '-';
    if (entrada.comprovante && entrada.comprovante.trim() !== '') {
        // Se houver arquivo, mostra ícone clicável. 
        // Nota: Como ainda não temos URL real, usaremos o nome no alert
        comprovanteHtml = `
            <button class="btn-icon-small" onclick="alert('Visualizar arquivo: ${entrada.comprovante}')" title="Ver Comprovante">
                📎
            </button>
        `;
    }

    tr.innerHTML = `
        <td>${dataFormatada}</td>
        <td>${icone} ${entrada.origem}</td>
        <td>${formatCurrency(entrada.valor)}</td>
        <td class="text-center">${comprovanteHtml}</td> <td>${(entrada.km || 0).toFixed(1)}</td>
        <td>${formatHoras(entrada.horas || 0)}</td>
        <td class="actions">
            <button class="btn-icon info btn-duplicate" title="Duplicar"><span class="material-icons-sharp">content_copy</span></button>
            <button class="btn-icon warning btn-edit" title="Editar"><span class="material-icons-sharp">edit</span></button>
            <button class="btn-icon danger btn-delete" title="Excluir"><span class="material-icons-sharp">delete</span></button>
        </td>
    `;
    
    tbody.appendChild(tr);

    // Reatribui listeners
    tr.querySelector('.btn-delete').addEventListener('click', handleDeleteClick);
    tr.querySelector('.btn-edit').addEventListener('click', handleEditClick);
    tr.querySelector('.btn-duplicate').addEventListener('click', handleDuplicateClick);
}

// ===============================================================
// GRÁFICOS
// ===============================================================

/**
 * NOVO: Gráfico de Torres Semanal (Estilo Uber)
 */
function renderGraficoSemanal() {
    if (!filtroSemana || !canvasGraficoSemanal) return;
    
    const ctx = canvasGraficoSemanal.getContext('2d');
    
    // Obter dados da semana selecionada
    const weekIndex = parseInt(filtroSemana.value);
    const options = filtroSemana.options;
    if(options.length === 0) return;
    
    // Recriar lógica para pegar start e end day do texto ou do índice
    // Para simplificar, recalculamos aqui baseados no índice selecionado
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const startDay = (weekIndex * 7) + 1;
    let endDay = startDay + 6;
    if(endDay > daysInMonth) endDay = daysInMonth;

    // Prepara os dados: Um array para cada dia da semana (Seg-Dom ou Dia 1-7 da range)
    const labels = [];
    const dataValues = [];
    
    // Agrupa dados DO MÊS INTEIRO (allEntradasDoMes) filtrando pela data
    for (let day = startDay; day <= endDay; day++) {
        const diaFormatado = day.toString().padStart(2, '0');
        const dataCompletaISO = `${currentYear}-${currentMonth}-${diaFormatado}`;
        
        // Pega dia da semana (Dom, Seg, Ter...)
        const dateObj = new Date(currentYear, currentMonth - 1, day);
        const diaSemanaNome = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
        
        labels.push(`${diaSemanaNome} (${diaFormatado})`);
        
        // Soma valores deste dia
        const entradasDia = allEntradasDoMes.filter(e => e.data === dataCompletaISO);
        const totalDia = entradasDia.reduce((sum, e) => sum + e.valor, 0);
        dataValues.push(totalDia);
    }

    if (graficoSemanal) graficoSemanal.destroy();

    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    const corBarras = '#000000'; // Preto Uber (ou mude para sua cor)

    graficoSemanal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ganhos do Dia',
                data: dataValues,
                backgroundColor: corBarras,
                borderRadius: 4, // Bordas arredondadas tipo Uber
                barThickness: 25, // Largura da barra
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: (c) => formatCurrency(c.raw) }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: corTexto, callback: (v) => formatCurrency(v) },
                    grid: { display: true, borderDash: [5, 5] }
                },
                x: {
                    ticks: { color: corTexto },
                    grid: { display: false }
                }
            }
        }
    });
}

/**
 * Gráfico de Evolução (Melhorado com Gradiente e Design)
 */
function renderGraficoEntradas(entradasPorDia) {
    const ctx = document.getElementById('grafico-entradas-mes').getContext('2d');
    const placeholder = document.getElementById('grafico-placeholder');
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    
    // Cria Gradiente
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(118, 193, 107, 0.5)'); // Verde topo
    gradient.addColorStop(1, 'rgba(118, 193, 107, 0.0)'); // Transparente base

    if (graficoEntradas) graficoEntradas.destroy();

    const labels = Object.keys(entradasPorDia).sort();
    
    if (labels.length === 0) {
        if(placeholder) placeholder.style.display = 'block';
        return;
    }
    if(placeholder) placeholder.style.display = 'none';

    const dataValores = [];
    const labelsFormatados = [];
    let totalAcumulado = 0;

    labels.forEach(data => {
        const [y, m, d] = data.split('-');
        labelsFormatados.push(`${d}/${m}`);
        const totalDia = entradasPorDia[data].reduce((sum, e) => sum + e.valor, 0);
        totalAcumulado += totalDia;
        dataValores.push(totalAcumulado);
    });

    graficoEntradas = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labelsFormatados,
            datasets: [{
                label: 'Evolução Acumulada',
                data: dataValores,
                borderColor: '#76c16b', // Verde Principal
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#76c16b',
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.3 // Curva suave
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 10,
                    callbacks: { label: (c) => `Acumulado: ${formatCurrency(c.raw)}` }
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

// ===============================================================
// FUNÇÕES DE AÇÃO E UTILITÁRIAS (Mantidas praticamente iguais)
// ===============================================================

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;
    const totalMinutos = parseInputParaMinutos(horasInput.value);
    
    let comprovanteNome = null;
    if (comprovanteInput.files.length > 0) comprovanteNome = comprovanteInput.files[0].name;

    const data = {
        data: dataInput.value,
        origem: origemSelect.value,
        descricao: descricaoInput.value,
        valor: parseCurrency(valorInput.value),
        km: parseFloat(kmInput.value) || 0,
        horas: totalMinutos,
        comprovante: comprovanteNome
    };

    if (data.valor <= 0) { alert("Valor deve ser maior que zero."); return; }
    
    const [entryYear, entryMonth] = data.data.split('-');
    try {
        const newRef = push(ref(db, `dados/${userId}/entradas/${entryYear}-${entryMonth}`));
        await set(newRef, { ...data, id: newRef.key });
        await updateSaldoGlobal(data.valor); 
        form.reset();
        updateDataInput();
    } catch (error) { console.error(error); alert("Erro ao salvar."); }
}

function handleDuplicateClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    dataInput.value = getLocalDateISO();
    origemSelect.value = tr.dataset.origem;
    descricaoInput.value = tr.dataset.descricao;
    valorInput.value = formatCurrency(parseFloat(tr.dataset.valor));
    kmInput.value = tr.dataset.km;
    horasInput.value = (parseInt(tr.dataset.horas)/60).toFixed(2);
    descricaoInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const valor = parseFloat(tr.dataset.valor);
    const data = tr.dataset.data;
    const [entryYear, entryMonth] = data.split('-');
    
    modalMessage.textContent = 'Excluir esta entrada?';
    showModal('modal-confirm', async () => {
        try {
            await updateSaldoGlobal(-valor);
            await remove(ref(db, `dados/${userId}/entradas/${entryYear}-${entryMonth}/${id}`));
            hideModal('modal-confirm');
        } catch (error) { console.error(error); }
    });
}

function handleEditClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const data = tr.dataset.data;
    const [entryYear, entryMonth] = data.split('-');
    
    formEdit.dataset.id = id;
    formEdit.dataset.entryPath = `dados/${userId}/entradas/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = tr.dataset.valor;
    formEdit.dataset.comprovanteAntigo = tr.dataset.comprovante;

    editDataInput.value = data;
    editOrigemSelect.value = tr.dataset.origem;
    editDescricaoInput.value = tr.dataset.descricao;
    editValorInput.value = formatCurrency(parseFloat(tr.dataset.valor));
    editKmInput.value = tr.dataset.km;
    editHorasInput.value = (parseInt(tr.dataset.horas)/60).toFixed(2);
    
    const comp = tr.dataset.comprovante;
    editComprovanteDisplay.textContent = comp ? `Arquivo atual: ${comp}` : '';
    editComprovanteDisplay.style.display = comp ? 'block' : 'none';
    
    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;
    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath;
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const comprovanteAntigo = formEdit.dataset.comprovanteAntigo;
    
    let comprovanteNome = comprovanteAntigo;
    const editFile = document.getElementById('edit-entrada-comprovante');
    if (editFile && editFile.files.length > 0) comprovanteNome = editFile.files[0].name;

    const novosDados = {
        id: id,
        data: editDataInput.value,
        origem: editOrigemSelect.value,
        descricao: editDescricaoInput.value,
        valor: parseCurrency(editValorInput.value),
        km: parseFloat(editKmInput.value) || 0,
        horas: parseInputParaMinutos(editHorasInput.value),
        comprovante: comprovanteNome
    };

    const ajuste = novosDados.valor - valorAntigo;
    if (ajuste < 0) {
        if (!(await verificarSaldoSuficiente(Math.abs(ajuste)))) {
            alert("Saldo insuficiente para esta alteração!"); return;
        }
    }

    try {
        await remove(ref(db, path));
        const [ny, nm] = novosDados.data.split('-');
        await set(ref(db, `dados/${userId}/entradas/${ny}-${nm}/${id}`), novosDados);
        if (ajuste !== 0) await updateSaldoGlobal(ajuste);
        modalEdit.style.display = 'none';
    } catch (error) { console.error(error); alert("Erro ao editar."); }
}

function parseInputParaMinutos(str) {
    if (!str) return 0;
    if (str.includes(':')) {
        const [h, m] = str.split(':');
        return (parseInt(h)||0)*60 + (parseInt(m)||0);
    }
    return Math.round((parseFloat(str)||0)*60);
}

function formatHoras(min) {
    const h = Math.floor(min/60);
    const m = min % 60;
    return `${h}h ${m.toString().padStart(2,'0')}m`;
}

async function updateSaldoGlobal(valor) {
    if (valor === 0) return;
    const sRef = ref(db, `dados/${userId}/saldo/global`);
    const snap = await get(sRef);
    let atual = snap.val()?.saldoAcumulado || 0;
    await set(sRef, { saldoAcumulado: atual + valor });
}

function showModal(id, fn) {
    const m = document.getElementById(id);
    m.style.display = 'flex';
    const ok = document.getElementById('modal-btn-confirm');
    const cancel = document.getElementById('modal-btn-cancel');
    const newOk = ok.cloneNode(true);
    const newCancel = cancel.cloneNode(true);
    ok.parentNode.replaceChild(newOk, ok);
    cancel.parentNode.replaceChild(newCancel, cancel);
    newOk.onclick = fn;
    newCancel.onclick = () => hideModal(id);
}
function hideModal(id) { document.getElementById(id).style.display = 'none'; }
function resetFilters() {
    currentFilters = { origem: 'todas', busca: '' };
    filtroOrigem.value = 'todas';
    filtroBusca.value = '';
    renderTabela();
}