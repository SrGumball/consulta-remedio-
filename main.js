import { invoke } from '@tauri-apps/api/core';

// ── Elementos ──
const dbOverlay    = document.getElementById('dbOverlay');
const techOverlay  = document.getElementById('techOverlay');
const connectBtn   = document.getElementById('connectBtn');
const techLoginBtn = document.getElementById('techLoginBtn');
const techCancelBtn= document.getElementById('techCancelBtn');
const serverBtn    = document.getElementById('serverStatusBtn');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const dbError      = document.getElementById('dbError');
const techError    = document.getElementById('techError');
const searchInput  = document.getElementById('searchInput');
const searchBtn    = document.getElementById('searchBtn');
const medTableBody = document.getElementById('medTableBody');

// ESC fecha overlay técnico (sem alterar nada)
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (!techOverlay.classList.contains('hidden')) closeTechOverlay();
        else if (!dbOverlay.classList.contains('hidden') && isConnected) closeDbOverlay();
    }
});

function closeDbOverlay() {
    dbOverlay.classList.add('hidden');
    dbError.textContent = '';
}

function closeTechOverlay() {
    techOverlay.classList.add('hidden');
    techError.textContent = '';
    document.getElementById('techUser').value = '';
    document.getElementById('techPass').value = '';
}

// ── Estado da conexão ──
let conn = { host: '', dbName: '', pass: '' };
let isConnected = false;

// ── Credenciais técnicas fixas ──
const TECH_USER = 'root';
const TECH_PASS = 'admin123';

// ── Funções de status ──
function setOnline(dbName) {
    isConnected = true;
    statusDot.className = 'dot on';
    statusText.textContent = `Servidor ON · ${dbName}`;
    serverBtn.classList.add('online');
}
function setOffline() {
    isConnected = false;
    statusDot.className = 'dot off';
    statusText.textContent = 'Servidor OFF';
    serverBtn.classList.remove('online');
}

// ── Conexão DB ──
async function connectDB() {
    const host   = document.getElementById('dbHost').value.trim();
    const dbName = document.getElementById('dbName').value.trim();
    const pass   = document.getElementById('dbPass').value.trim();

    if (!host || !dbName || !pass) {
        dbError.textContent = 'Preencha todos os campos.';
        return;
    }

    connectBtn.textContent = 'Conectando...';
    connectBtn.style.opacity = '0.7';
    dbError.textContent = '';

    try {
        await invoke('test_postgres_connection', { ip: host, dbName, password: pass });
        conn = { host, dbName, pass };
        
        // Salva para as próximas sessões
        localStorage.setItem("consulta_pg_ip", host);
        localStorage.setItem("consulta_pg_db", dbName);
        localStorage.setItem("consulta_pg_pass", pass);
        
        dbOverlay.classList.add('hidden');
        setOnline(dbName);
        loadMedicamentos('');
    } catch (e) {
        dbError.textContent = 'Falha: ' + e;
    } finally {
        connectBtn.textContent = 'Conectar';
        connectBtn.style.opacity = '1';
    }
}

// ── Carregar medicamentos ──
async function loadMedicamentos(search) {
    if (!isConnected) return;

    medTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Buscando...</td></tr>`;

    // Colunas reais da tabela "Medicamento" no banco axion
    let query = `SELECT id, codigo, nome, dosagem, apresentacao, categoria, estoque_atual FROM "Medicamento"`;
    if (search.trim()) {
        const keywords = search.trim().split(/\s+/);
        const conditions = keywords.map(kw => `(nome ILIKE '%${kw}%' OR categoria ILIKE '%${kw}%' OR apresentacao ILIKE '%${kw}%' OR codigo ILIKE '%${kw}%')`);
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY nome ASC LIMIT 100`;

    try {
        const raw = await invoke('query_postgres', {
            ip: conn.host, dbName: conn.dbName, password: conn.pass, query
        });
        renderTable(JSON.parse(raw));
    } catch (e) {
        medTableBody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color:#ef4444;">Erro: ${e}</td></tr>`;
    }
}

// ── Parser de Apresentação (igual ao AXION Hospitalar) ──
const APRES_MAP = {
    'COMP':   'Comprimido',
    'CAP':    'Cápsula',
    'CAPS':   'Cápsula',
    'SUSP':   'Suspensão',
    'SOL':    'Solução',
    'INJ':    'Injetável',
    'AMP':    'Ampola',
    'ENV':    'Envelope',
    'TUBO':   'Bisnaga',
    'GEL':    'Gel',
    'CRE':    'Creme',
    'CREME':  'Creme',
    'POM':    'Pomada',
    'PUMP':   'Frasco pump',
    'FR':     'Frasco',
    'SAC':    'Sachê',
    'AERP':   'Aerossol',
    'DRG':    'Drágea',
    'COMP EF':'Comprimido Efervescente',
    'COMP REV':'Comprimido Revestido',
    'COMP LIB PROL':'Comprimido Lib. Prol.',
    'COMP SUB':'Comprimido Sublingual',
};

function parseApresentacao(raw) {
    if (!raw || raw === '-') return { forma: '-', dosagem: '-' };
    const str = raw.trim().toUpperCase();
    // Tenta encontrar a sigla no início
    let forma = '-', dosagem = '-';
    for (const sigla of Object.keys(APRES_MAP).sort((a,b) => b.length - a.length)) {
        if (str.startsWith(sigla)) {
            forma = APRES_MAP[sigla];
            dosagem = str.slice(sigla.length).trim() || '-';
            return { forma, dosagem };
        }
    }
    // Se não achou sigla, retorna o campo inteiro como apresentação
    return { forma: raw, dosagem: '-' };
}

function renderTable(rows) {
    if (!rows || rows.length === 0) {
        medTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">Nenhum medicamento encontrado.</td></tr>`;
        return;
    }
    medTableBody.innerHTML = rows.map(r => `
        <tr>
            <td style="color:var(--muted);font-size:12px">${r.codigo ?? '-'}</td>
            <td style="font-weight:600">${r.nome ?? '-'}</td>
            <td>${r.dosagem ?? '-'}</td>
            <td>${r.apresentacao ?? '-'}</td>
            <td>${r.categoria ?? '-'}</td>
            <td style="font-weight:600;color:${(r.estoque_atual ?? 0) > 0 ? 'var(--text)' : 'var(--danger)'}">
                ${r.estoque_atual ?? 0}
            </td>
        </tr>`).join('');
}

// ── Login técnico ──
function techLogin() {
    const user = document.getElementById('techUser').value.trim();
    const pass = document.getElementById('techPass').value;
    if (user === TECH_USER && pass === TECH_PASS) {
        techOverlay.classList.add('hidden');
        techError.textContent = '';
        document.getElementById('techUser').value = '';
        document.getElementById('techPass').value = '';
        // Abre tela de conexão para alterar servidor
        document.getElementById('dbHost').value = '';
        document.getElementById('dbName').value = '';
        document.getElementById('dbPass').value = '';
        dbError.textContent = '';
        dbOverlay.classList.remove('hidden');
    } else {
        techError.textContent = 'Usuário ou senha incorretos.';
    }
}

// ── Eventos ──
connectBtn.addEventListener('click', connectDB);

document.getElementById('dbHost').addEventListener('keypress', e => { if (e.key === 'Enter') connectDB(); });
document.getElementById('dbName').addEventListener('keypress', e => { if (e.key === 'Enter') connectDB(); });
document.getElementById('dbPass').addEventListener('keypress', e => { if (e.key === 'Enter') connectDB(); });

techLoginBtn.addEventListener('click', techLogin);
document.getElementById('techPass').addEventListener('keypress', e => { if (e.key === 'Enter') techLogin(); });

techCancelBtn.addEventListener('click', closeTechOverlay);
document.getElementById('dbCancelBtn').addEventListener('click', () => {
    // Só fecha se já estiver conectado (veio do fluxo técnico)
    // Se ainda não conectou, não deixa fechar (precisa conectar primeiro)
    if (isConnected) closeDbOverlay();
});

// Clique no status abre login técnico (se já conectado) ou DB direto
serverBtn.addEventListener('click', () => {
    if (isConnected) {
        techError.textContent = '';
        techOverlay.classList.remove('hidden');
    } else {
        dbOverlay.classList.remove('hidden');
    }
});

searchBtn.addEventListener('click', () => loadMedicamentos(searchInput.value));
searchInput.addEventListener('keypress', e => { if (e.key === 'Enter') loadMedicamentos(searchInput.value); });

// ── Inicialização ──
window.addEventListener('DOMContentLoaded', async () => {
    const savedHost = localStorage.getItem("consulta_pg_ip");
    const savedDb = localStorage.getItem("consulta_pg_db");
    const savedPass = localStorage.getItem("consulta_pg_pass");

    if (savedHost && savedDb && savedPass) {
        document.getElementById('dbHost').value = savedHost;
        document.getElementById('dbName').value = savedDb;
        document.getElementById('dbPass').value = savedPass;
        
        connectBtn.textContent = 'Verificando...';
        connectBtn.style.opacity = '0.7';
        
        try {
            await invoke('test_postgres_connection', { ip: savedHost, dbName: savedDb, password: savedPass });
            conn = { host: savedHost, dbName: savedDb, pass: savedPass };
            dbOverlay.classList.add('hidden');
            setOnline(savedDb);
            loadMedicamentos('');
        } catch (e) {
            dbError.textContent = 'Sessão anterior falhou: ' + e;
        } finally {
            connectBtn.textContent = 'Conectar';
            connectBtn.style.opacity = '1';
        }
    }
});
