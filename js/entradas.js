// js/entradas.js
// VERSÃO 5.3 (Atualizado para Gráfico Azul Profissional e Total Semanal)

import { 
    db, 
    storage, 
    ref, 
    set, 
    get, 
    push, 
    remove, 
    onValue, 
    off, 
    update,
    storageRef, 
    uploadBytes,
    getDownloadURL,
    deleteObject
} from './firebase-config.js';
import { 
    getUserId, 
    formatCurrency, 
    parseCurrency, 
    verificarSaldoSuficiente,
    showToast
} from './main.js';

// ---- Variáveis Globais ----
let userId = null;
let currentYear = new Date().getFullYear();
let currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
let activeListener = null;

let allEntradasDoMes = [];
let currentFilters = { origem: 'todas', busca: '' };

let graficoEntradas = null; 
let graficoSemanal = null; 
let semanaSelecionadaIndex = 0; 

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
const btnSubmitForm = form.querySelector('button[type="submit"]');

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
const filtroSemana = document.getElementById('filtro-semana');
const canvasGraficoSemanal = document.getElementById('grafico-semanal');
// v5.3: Elemento para exibir o total da semana selecionada
const displayTotalSemanal = document.getElementById('display-total-semanal');

// ---- Modais ----
const modalConfirm = document.getElementById('modal-confirm');
const modalMessage = document.getElementById('modal-message');
const modalEdit = document.getElementById('modal-edit-entrada');
const formEdit = document.getElementById('form-edit-entrada');
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
        populateSemanaFilter();
        loadEntradas();
    });
    
    const initialMonthEl = document.getElementById('current-month-display');
    if (initialMonthEl) {
        currentYear = initialMonthEl.dataset.year;
        currentMonth = initialMonthEl.dataset.month;
    }

    populateFilterOrigens();
    populateSemanaFilter(); 

    filtroOrigem.addEventListener('change', (e) => {
        currentFilters.origem = e.target.value;
        renderTabela();
    });
    filtroBusca.addEventListener('input', (e) => {
        currentFilters.busca = e.target.value.toLowerCase();
        renderTabela();
    });
    btnLimparFiltros.addEventListener('click', resetFilters);

    if(filtroSemana) {
        filtroSemana.addEventListener('change', (e) => {
            semanaSelecionadaIndex = parseInt(e.target.value);
            renderGraficoSemanal(); 
        });
    }
    
    updateDataInput();
    loadEntradas();

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

function populateSemanaFilter() {
    if(!filtroSemana) return;
    filtroSemana.innerHTML = '';
    
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const weeks = [];
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

    const hoje = new Date();
    const isCurrentMonth = (hoje.getFullYear() == currentYear && (hoje.getMonth() + 1) == currentMonth);
    
    if(isCurrentMonth) {
        const diaHoje = hoje.getDate();
        const semanaAtual = weeks.find(w => diaHoje >= w.start && diaHoje <= w.end);
        if(semanaAtual) semanaSelecionadaIndex = semanaAtual.index;
    } else {
        semanaSelecionadaIndex = 0; 
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
// 2. FUNÇÕES DE UPLOAD
// ===============================================================

async function uploadFile(file) {
    if (!userId) throw new Error("Usuário não autenticado.");
    
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}-${file.name}`;
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
// 3. LÓGICA DE DADOS (Load & Render)
// ===============================================================
function loadEntradas() {
    if (!userId) return;
    if (activeListener) off(activeListener.ref, 'value', activeListener.callback);
    
    const path = `usuarios/${userId}/entradas/${currentYear}-${currentMonth}`;
    const dataRef = ref(db, path);
    
    const callback = (snapshot) => {
        allEntradasDoMes = [];
        let totalMes = 0, totalKm = 0, totalMinutos = 0; 
        
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
        renderGraficoSemanal();
    };
    
    onValue(dataRef, callback);
    activeListener = { ref: dataRef, callback: callback };
}

function renderTabela() {
    tbody.innerHTML = '';
    
    const filtros = currentFilters;
    const entradasFiltradas = allEntradasDoMes.filter(entrada => {
        const matchOrigem = filtros.origem === 'todas' || entrada.origem === filtros.origem;
        const matchBusca = filtros.busca === '' || (entrada.descricao && entrada.descricao.toLowerCase().includes(filtros.busca));
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

function renderRow(entrada) {
    if (!entrada.data) return;

    const tr = document.createElement('tr');
    tr.dataset.id = entrada.id;
    tr.dataset.valor = entrada.valor;
    tr.dataset.data = entrada.data;
    tr.dataset.origem = entrada.origem;
    tr.dataset.descricao = entrada.descricao || '';
    tr.dataset.km = entrada.km || 0;
    tr.dataset.horas = entrada.horas || 0;
    
    const comp = entrada.comprovante; 
    tr.dataset.comprovanteUrl = comp ? comp.url : '';
    tr.dataset.comprovantePath = comp ? comp.path : ''; 

    const [y, m, d] = entrada.data.split('-');
    const dataFormatada = `${d}/${m}/${y}`;
    const icone = origemIcones[entrada.origem] || "🧩"; 
    
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
        <td>${icone} ${entrada.origem}</td>
        <td>${formatCurrency(entrada.valor)}</td>
        <td class="text-center">${comprovanteHtml}</td> 
        <td>${(entrada.km || 0).toFixed(1)}</td>
        <td>${formatHoras(entrada.horas || 0)}</td>
        <td class="actions">
            <button class="btn-icon info btn-duplicate" title="Duplicar"><span class="material-icons-sharp">content_copy</span></button>
            <button class="btn-icon warning btn-edit" title="Editar"><span class="material-icons-sharp">edit</span></button>
            <button class="btn-icon danger btn-delete" title="Excluir"><span class="material-icons-sharp">delete</span></button>
        </td>
    `;
    
    tbody.appendChild(tr);

    tr.querySelector('.btn-delete').addEventListener('click', handleDeleteClick);
    tr.querySelector('.btn-edit').addEventListener('click', handleEditClick);
    tr.querySelector('.btn-duplicate').addEventListener('click', handleDuplicateClick);
}

// ===============================================================
// 4. GRÁFICOS (ATUALIZADO v5.3 - Azul e Total Semanal)
// ===============================================================
function renderGraficoSemanal() {
    if (!filtroSemana || !canvasGraficoSemanal) return;
    const ctx = canvasGraficoSemanal.getContext('2d');
    
    const weekIndex = parseInt(filtroSemana.value);
    const options = filtroSemana.options;
    if(options.length === 0) return;
    
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const startDay = (weekIndex * 7) + 1;
    let endDay = startDay + 6;
    if(endDay > daysInMonth) endDay = daysInMonth;

    const labels = [];
    const dataValues = [];
    
    for (let day = startDay; day <= endDay; day++) {
        const diaFormatado = day.toString().padStart(2, '0');
        const dataCompletaISO = `${currentYear}-${currentMonth}-${diaFormatado}`;
        const dateObj = new Date(currentYear, currentMonth - 1, day);
        const diaSemanaNome = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
        
        labels.push(`${diaSemanaNome} (${diaFormatado})`);
        
        const entradasDia = allEntradasDoMes.filter(e => e.data === dataCompletaISO);
        const totalDia = entradasDia.reduce((sum, e) => sum + e.valor, 0);
        dataValues.push(totalDia);
    }

    // v5.3: Calcular e Exibir Total da Semana
    const totalSemana = dataValues.reduce((acc, curr) => acc + curr, 0);
    const displayTotal = document.getElementById('display-total-semanal');
    if (displayTotal) {
        displayTotal.textContent = formatCurrency(totalSemana);
    }

    if (graficoSemanal) graficoSemanal.destroy();

    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    
    // v5.3: Pegar a cor AZUL do tema
    const rootStyles = getComputedStyle(document.documentElement);
    const corAzulPrimary = rootStyles.getPropertyValue('--primary-color').trim() || '#4a90e2';

    graficoSemanal = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ganhos do Dia',
                data: dataValues,
                backgroundColor: corAzulPrimary, // v5.3: Cor Azul do Tema
                borderRadius: 5,  // v5.3: Bordas arredondadas
                borderSkipped: false,
                barPercentage: 0.6, // v5.3: Barras mais finas/elegantes
                categoryPercentage: 0.8
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
                    grid: { display: true, borderDash: [5, 5], color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    ticks: { color: corTexto },
                    grid: { display: false } // v5.3: Sem grade vertical (clean)
                }
            }
        }
    });
}

function renderGraficoEntradas(entradasPorDia) {
    const ctx = document.getElementById('grafico-entradas-mes').getContext('2d');
    const placeholder = document.getElementById('grafico-placeholder');
    const estiloComputado = getComputedStyle(document.body);
    const corTexto = estiloComputado.getPropertyValue('--text-color') || '#000';
    
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(118, 193, 107, 0.5)'); 
    gradient.addColorStop(1, 'rgba(118, 193, 107, 0.0)'); 

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
                borderColor: '#76c16b', 
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#76c16b',
                pointRadius: 4,
                pointHoverRadius: 6,
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
// 5. FUNÇÕES DE AÇÃO
// ===============================================================

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!userId) return;

    btnSubmitForm.disabled = true;
    btnSubmitForm.textContent = 'Salvando...';
    
    let comprovanteData = null;

    try {
        if (comprovanteInput.files.length > 0) {
            const file = comprovanteInput.files[0];
            comprovanteData = await uploadFile(file); 
        }

        const data = {
            data: dataInput.value,
            origem: origemSelect.value,
            descricao: descricaoInput.value,
            valor: parseCurrency(valorInput.value),
            km: parseFloat(kmInput.value) || 0,
            horas: parseInputParaMinutos(horasInput.value),
            comprovante: comprovanteData 
        };

        if (data.valor <= 0) throw new Error("Valor deve ser maior que zero.");
        
        const [entryYear, entryMonth] = data.data.split('-');
        
        const newRef = push(ref(db, `usuarios/${userId}/entradas/${entryYear}-${entryMonth}`));
        await set(newRef, { ...data, id: newRef.key });
        
        await updateSaldoGlobal(data.valor); 
        
        form.reset();
        updateDataInput();

        // [MUDANÇA AQUI] Mensagem de Sucesso (Verde)
        showToast("Entrada registrada com sucesso!", "success");

    } catch (error) { 
        console.error(error); 
        
        // [MUDANÇA AQUI] Mensagem de Erro (Vermelha) em vez de alert
        showToast("Erro ao salvar: " + error.message, "error");
        
        if (comprovanteData && comprovanteData.path) {
            console.warn("Revertendo upload do arquivo órfão...");
            await deleteFile(comprovanteData.path);
        }
    } finally {
        btnSubmitForm.disabled = false;
        btnSubmitForm.textContent = 'Adicionar Entrada';
    }
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
    comprovanteInput.value = ''; 
    descricaoInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleDeleteClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const valor = parseFloat(tr.dataset.valor);
    const data = tr.dataset.data;
    const comprovantePath = tr.dataset.comprovantePath; 
    const [entryYear, entryMonth] = data.split('-');
    
    modalMessage.textContent = 'Excluir esta entrada?';
    
    showModal('modal-confirm', async () => {
        try {
            await updateSaldoGlobal(-valor);
            
            if (comprovantePath) {
                await deleteFile(comprovantePath); 
            }
            
            await remove(ref(db, `usuarios/${userId}/entradas/${entryYear}-${entryMonth}/${id}`));
            
            hideModal('modal-confirm');

            // [NOVO] Notificação de Sucesso
            showToast("Entrada excluída com sucesso.", "success");

        } catch (error) { 
            console.error(error); 
            
            // [NOVO] Notificação de Erro
            showToast("Erro ao excluir entrada.", "error");
            
            loadEntradas(); 
        }
    });
}

function handleEditClick(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    const data = tr.dataset.data;
    const [entryYear, entryMonth] = data.split('-');
    
    const comprovanteUrl = tr.dataset.comprovanteUrl;
    const comprovantePath = tr.dataset.comprovantePath;
    
    formEdit.dataset.id = id;
    formEdit.dataset.entryPath = `usuarios/${userId}/entradas/${entryYear}-${entryMonth}/${id}`;
    formEdit.dataset.valorAntigo = tr.dataset.valor;
    formEdit.dataset.comprovanteAntigoUrl = comprovanteUrl;
    formEdit.dataset.comprovanteAntigoPath = comprovantePath;

    editDataInput.value = data;
    editOrigemSelect.value = tr.dataset.origem;
    editDescricaoInput.value = tr.dataset.descricao;
    editValorInput.value = formatCurrency(parseFloat(tr.dataset.valor));
    editKmInput.value = tr.dataset.km;
    editHorasInput.value = (parseInt(tr.dataset.horas)/60).toFixed(2);
    
    const fileName = comprovantePath ? comprovantePath.split('-').slice(1).join('-') : '';
    editComprovanteDisplay.textContent = fileName ? `Arquivo atual: ${fileName}` : '';
    editComprovanteDisplay.style.display = fileName ? 'block' : 'none';
    
    const editFile = document.getElementById('edit-entrada-comprovante');
    if (editFile) editFile.value = '';
    
    modalEdit.style.display = 'flex';
}

async function handleSaveEdit(e) {
    e.preventDefault();
    if (!userId) return;
    
    const id = formEdit.dataset.id;
    const path = formEdit.dataset.entryPath; 
    const valorAntigo = parseFloat(formEdit.dataset.valorAntigo);
    const comprovanteAntigoUrl = formEdit.dataset.comprovanteAntigoUrl;
    const comprovanteAntigoPath = formEdit.dataset.comprovanteAntigoPath;
    
    let comprovanteData = (comprovanteAntigoUrl && comprovanteAntigoPath) 
        ? { url: comprovanteAntigoUrl, path: comprovanteAntigoPath } 
        : null;

    const editFile = document.getElementById('edit-entrada-comprovante');
    let novoArquivoSelecionado = false;

    try {
        if (editFile && editFile.files.length > 0) {
            novoArquivoSelecionado = true;
            const file = editFile.files[0];
            comprovanteData = await uploadFile(file); 
        }

        const novosDados = {
            id: id,
            data: editDataInput.value,
            origem: editOrigemSelect.value,
            descricao: editDescricaoInput.value,
            valor: parseCurrency(editValorInput.value),
            km: parseFloat(editKmInput.value) || 0,
            horas: parseInputParaMinutos(editHorasInput.value),
            comprovante: comprovanteData
        };

        const ajuste = novosDados.valor - valorAntigo;
        if (ajuste < 0) {
            if (!(await verificarSaldoSuficiente(Math.abs(ajuste)))) {
                throw new Error("Saldo insuficiente para esta alteração!");
            }
        }
        
        await remove(ref(db, path));
        const [ny, nm] = novosDados.data.split('-');
        
        await set(ref(db, `usuarios/${userId}/entradas/${ny}-${nm}/${id}`), novosDados);
        
        if (ajuste !== 0) await updateSaldoGlobal(ajuste);
        
        if (novoArquivoSelecionado && comprovanteAntigoPath) {
            await deleteFile(comprovanteAntigoPath); 
        }
        
        modalEdit.style.display = 'none';

        // [NOVO] Notificação de Sucesso
        showToast("Alterações salvas com sucesso!", "success");

    } catch (error) { 
        console.error(error); 
        
        // [NOVO] Notificação de Erro em vez de Alert
        showToast("Erro ao editar: " + error.message, "error");
        
        if (novoArquivoSelecionado && comprovanteData) {
            await deleteFile(comprovanteData.path);
        }
    }
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
    const sRef = ref(db, `usuarios/${userId}/saldo/global`);
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