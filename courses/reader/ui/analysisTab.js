import { state, onStateChange, currentLine, currentMove } from "../state.js";
import { renderMoveText } from "../courseText.js";
import { startPreview, stopPreview } from "../studyPlayback.js";
import { rebuildToIndex } from "../lineNav.js";
import { resolvePath } from "../Course.js";

let board = null;
let els = {};
let onBackToLine = null; // iniettata da main.js: ricostruisce la board sulla posizione reale
let isAnalyzing = false;
const ENGINE_LINES = 1;
let lastEvalData = { score: 0, type: 'cp' };

export function initAnalysisTab(chessboard, backToLineFn) {
    board = chessboard;
    onBackToLine = backToLineFn;

    els = {
        text: document.getElementById('move-text'),
        heading: document.getElementById('line-heading'),
        previewBanner: document.getElementById('preview-banner'),
        previewLabel: document.getElementById('preview-banner-label'),
        btnBackToLine: document.getElementById('btn-back-to-line'),
        btnAnalysis: document.getElementById('btn-analysis'),
        evalBar: document.getElementById('eval-bar'),
        evalFill: document.getElementById('eval-fill'),
        evalTextTop: document.getElementById('eval-text-top'),
        evalTextBottom: document.getElementById('eval-text-bottom'),
    };

    els.text.addEventListener('click', onTextClick);
    els.btnBackToLine.addEventListener('click', onBackToLineClick);
    els.btnAnalysis.addEventListener('click', toggleAnalysis);

    onStateChange(render);
    render();
    updateEvalBar(lastEvalData);
}

/**
 * Da richiamare (da main.js) dopo ogni mossa/navigazione: se il motore è
 * acceso lo si rilancia sulla nuova posizione, altrimenti si azzera la
 * eval bar — stessa logica di /reader/ui/analysisTab.js:handleBoardMove.
 */
export function handleBoardMove() {
    if (isAnalyzing) {
        board.startCalculating(handleEngineUpdate, ENGINE_LINES);
    } else if (board.game && board.game.game_over()) {
        let result = '1/2-1/2';
        if (board.game.in_checkmate()) {
            result = board.game.turn() === 'w' ? '0-1' : '1-0';
        }
        lastEvalData = { gameOver: true, result };
        updateEvalBar(lastEvalData);
    } else {
        lastEvalData = { score: 0, type: 'cp' };
        updateEvalBar(lastEvalData);
    }
}

function toggleAnalysis() {
    if (isAnalyzing) {
        board.stopCalculating();
        isAnalyzing = false;
        els.btnAnalysis.innerText = 'Show evaluation';
        els.btnAnalysis.classList.remove('danger');
        lastEvalData = { score: 0, type: 'cp' };
        updateEvalBar(lastEvalData);
    } else {
        board.startCalculating(handleEngineUpdate, ENGINE_LINES);
        isAnalyzing = true;
        els.btnAnalysis.innerText = 'Hide evaluation';
        els.btnAnalysis.classList.add('danger');
    }
}

// Del motore interessa solo il numero per la eval bar, non le linee migliori:
// una sola variante (MultiPV 1) è anche molto meno pesante da calcolare.
function handleEngineUpdate(evalData) {
    lastEvalData = evalData;
    updateEvalBar(evalData);
}

// Calcola SEMPRE dal punto di vista non-flippato: il flip visivo è delegato
// al CSS (classe "flipped"), qui basta leggere board.isFlipped.
function updateEvalBar(evalData) {
    els.evalBar.classList.toggle('flipped', !!board.isFlipped);

    if (evalData.gameOver) {
        if (evalData.result === '1-0') {
            els.evalFill.style.height = '100%';
            els.evalTextBottom.innerText = '1-0';
            els.evalTextTop.innerText = '';
        } else if (evalData.result === '0-1') {
            els.evalFill.style.height = '0%';
            els.evalTextTop.innerText = '0-1';
            els.evalTextBottom.innerText = '';
        } else {
            els.evalFill.style.height = '50%';
            els.evalTextBottom.innerText = '½-½';
            els.evalTextTop.innerText = '';
        }
        return;
    }

    let score = evalData.score;
    let percentage = 50;
    let displayScore = '0.0';

    if (evalData.type === 'mate') {
        percentage = score > 0 ? 100 : (score < 0 ? 0 : 50);
        displayScore = 'M' + Math.abs(score);
    } else {
        const visualScore = Math.max(-10, Math.min(10, score));
        percentage = 50 + (visualScore * 5);
        displayScore = Math.abs(score).toFixed(1);
    }

    els.evalFill.style.height = percentage + '%';
    if (score < 0) {
        els.evalTextTop.innerText = displayScore;
        els.evalTextBottom.innerText = '';
    } else {
        els.evalTextBottom.innerText = displayScore;
        els.evalTextTop.innerText = '';
    }
}

// --- Preview (digressioni temporanee dai bottoni nel testo) ---

function onTextClick(e) {
    const btn = e.target.closest('.preview-btn');
    if (!btn) return;

    const move = currentMove();
    if (!move) return;
    const previewDef = move.previews[btn.dataset.previewId];
    if (!previewDef) return;

    startPreview(board, previewDef);
}

function onBackToLineClick() {
    stopPreview();
    const line = currentLine();
    if (line) rebuildToIndex(board, line, state.course.meta.startingFen, state.currentIndex);
    if (onBackToLine) onBackToLine();
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Stessa gerarchia visiva dei commenti del reader principale (classi
 * cb-comment-*): il titolo della sezione che contiene la linea come
 * "apertura", il titolo della linea come "variante". Se la linea sta
 * direttamente alla radice del corso, come titolo principale si usa il nome
 * del corso.
 */
function renderHeading(line) {
    if (!line) return '';
    const parent = state.currentPath.length > 1
        ? resolvePath(state.course, state.currentPath.slice(0, -1))
        : null;
    const top = parent && parent.title ? parent.title : (state.course.meta.title || '');
    const lineTitle = line.title || 'Untitled line';

    let html = '';
    if (top && top !== lineTitle) html += `<div class="cb-comment-opening">${escapeHTML(top)}</div>`;
    html += `<div class="cb-comment-variation">${escapeHTML(lineTitle)}</div>`;
    return html;
}

function render() {
    const line = currentLine();
    els.heading.innerHTML = renderHeading(line);

    if (state.preview) {
        els.previewBanner.hidden = false;
        els.previewLabel.textContent = state.preview.label + (state.preview.playing ? ' …' : '');
        els.text.innerHTML = '';
        return;
    }
    els.previewBanner.hidden = true;

    const move = currentMove();
    if (!move) {
        els.text.innerHTML = line
            ? '<div class="cb-comment-empty">Start of the line — step forward to see the notes.</div>'
            : '<div class="cb-comment-empty">Pick a line from the outline to begin.</div>';
        return;
    }

    els.text.innerHTML = move.text && move.text.trim()
        ? `<div class="cb-comment-content">${renderMoveText(move.text)}</div>`
        : '<div class="cb-comment-empty">No notes on this move.</div>';
}
