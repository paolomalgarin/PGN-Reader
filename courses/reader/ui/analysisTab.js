import { state, onStateChange, currentLine, currentMove } from "../state.js";
import { renderMoveText } from "../courseText.js";
import { startPreview, stopPreview } from "../studyPlayback.js";
import { rebuildToIndex } from "../lineNav.js";

let board = null;
let els = {};
let onBackToLine = null; // iniettata da main.js: ricostruisce la board sulla posizione reale
let isAnalyzing = false;
let lastEvalData = { score: 0, type: 'cp' };

export function initAnalysisTab(chessboard, backToLineFn) {
    board = chessboard;
    onBackToLine = backToLineFn;

    els = {
        text: document.getElementById('move-text'),
        lineTitle: document.getElementById('current-line-title'),
        previewBanner: document.getElementById('preview-banner'),
        previewLabel: document.getElementById('preview-banner-label'),
        btnBackToLine: document.getElementById('btn-back-to-line'),
        btnAnalysis: document.getElementById('btn-analysis'),
        engineInfo: document.getElementById('engine-info'),
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
        board.startCalculating(handleEngineUpdate);
    } else if (board.game && board.game.game_over()) {
        let result = '1/2-1/2';
        if (board.game.in_checkmate()) {
            result = board.game.turn() === 'w' ? '0-1' : '1-0';
        }
        lastEvalData = { gameOver: true, result };
        updateEvalBar(lastEvalData);
        els.engineInfo.innerText = board.game.in_checkmate()
            ? `Checkmate! ${result}`
            : 'Game over: draw';
    } else {
        lastEvalData = { score: 0, type: 'cp' };
        updateEvalBar(lastEvalData);
        els.engineInfo.innerText = 'Engine off';
    }
}

function toggleAnalysis() {
    if (isAnalyzing) {
        board.stopCalculating();
        isAnalyzing = false;
        els.btnAnalysis.innerText = 'Start Analysis';
        els.btnAnalysis.classList.remove('danger');
        els.engineInfo.innerText = 'Engine off';
    } else {
        board.startCalculating(handleEngineUpdate);
        isAnalyzing = true;
        els.btnAnalysis.innerText = 'Stop Analysis';
        els.btnAnalysis.classList.add('danger');
    }
}

function handleEngineUpdate(evalData) {
    lastEvalData = evalData;
    updateEvalBar(evalData);

    if (evalData.gameOver) {
        els.engineInfo.innerText = evalData.result === '1/2-1/2'
            ? 'Game over: draw'
            : `Checkmate! Result: ${evalData.result}`;
        return;
    }
    if (!evalData.lines || evalData.lines.length === 0) {
        els.engineInfo.innerText = `Depth: ${evalData.depth}`;
        return;
    }
    const rows = evalData.lines.map((line, i) => {
        const scoreStr = line.type === 'mate'
            ? `Mate in M${Math.abs(line.score)}`
            : `${line.score > 0 ? '+' : ''}${line.score.toFixed(2)}`;
        const lineText = line.sanLine || line.bestMove || '...';
        return `${i + 1}. (${scoreStr}) ${lineText}`;
    });
    els.engineInfo.innerHTML = `Depth: ${evalData.depth}<br>` + rows.join('<br>');
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

function render() {
    const line = currentLine();
    els.lineTitle.textContent = line ? line.title : '';

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
            ? '<div class="move-text-empty">Start of the line — play through it to see the notes.</div>'
            : '<div class="move-text-empty">Pick a line from the outline on the right to begin.</div>';
        return;
    }

    els.text.innerHTML = renderMoveText(move.text) || '<div class="move-text-empty">No notes on this move.</div>';
}
