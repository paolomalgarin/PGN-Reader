import { state, onStateChange } from "../state.js";
import { renderCommentHTML } from "../commentFormat.js";
import { setHumanColor, maybePlayComputerMove } from "../drill.js";

let board = null;
let isAnalyzing = false;
let lastEvalData = { score: 0, type: 'cp' };
let els = {};

/**
 * @param {Chessboard} chessboard
 */
export function initAnalysisTab(chessboard) {
    board = chessboard;

    els = {
        btnAnalysis: document.getElementById('btn-analysis'),
        btnFlip: document.getElementById('btn-flip'),
        engineInfo: document.getElementById('engine-info'),
        comment: document.getElementById('move-comment'),
        evalBar: document.getElementById('eval-bar'),
        evalFill: document.getElementById('eval-fill'),
        evalTextTop: document.getElementById('eval-text-top'),
        evalTextBottom: document.getElementById('eval-text-bottom'),
    };

    els.btnAnalysis.addEventListener('click', toggleAnalysis);
    els.btnFlip.addEventListener('click', flipBoard);

    onStateChange(renderComment);

    renderComment();
    updateEvalBar(lastEvalData);
}

function toggleAnalysis() {
    if (isAnalyzing) {
        board.stopCalculating();
        isAnalyzing = false;
        setAnalysisButtonState(false);
        els.engineInfo.innerText = "Engine off";
    } else {
        board.startCalculating(handleEngineUpdate);
        isAnalyzing = true;
        setAnalysisButtonState(true);
    }
}

function setAnalysisButtonState(active) {
    els.btnAnalysis.innerText = active ? "Stop Analysis" : "Start Analysis";
    els.btnAnalysis.classList.toggle('danger', active);
}

/**
 * Flippa la board e aggiorna l'eval bar di conseguenza. Esportata perché
 * viene richiamata sia dal bottone "Flip board" dentro il tab analysis, sia
 * dal bottone equivalente sempre visibile usato in modalità drill (dove il
 * pannello dei tab è nascosto — vedi index.html/#btn-flip-drill).
 *
 * In modalità drill, flippare significa anche "scegli di giocare l'altro
 * colore": se a quel punto tocca al pc, gioca subito la sua mossa.
 */
export function flipBoard() {
    board.flipBoard();
    updateEvalBar(lastEvalData);

    if (state.mode === 'DRILL') {
        setHumanColor(!board.isFlipped);
        maybePlayComputerMove(board);
    }
}

/**
 * Da richiamare (da main.js) ad ogni mossa/undo/salto sulla board: aggiorna
 * motore ed eval bar. Le frecce/evidenziazioni sono già gestite da
 * boardSync.syncBoardToCurrentNode PRIMA che questa funzione venga chiamata,
 * quindi qui non tocchiamo più arrows/highlights.
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

function handleEngineUpdate(evalData) {
    lastEvalData = evalData;

    if (evalData.gameOver) {
        updateEvalBar(evalData);
        els.engineInfo.innerText = evalData.result === '1/2-1/2'
            ? 'Game over: draw'
            : `Checkmate! Result: ${evalData.result}`;
        return;
    }

    // Un aggiornamento del motore può arrivare "in due tempi": prima solo la
    // profondità raggiunta, poi (un attimo dopo) le linee con il punteggio
    // vero. Aggiornare la eval bar anche sul primo tipo di messaggio (senza
    // un punteggio numerico) la lasciava bloccata sull'ultimo valore buono
    // mostrato — spesso completamente bianca, se la posizione precedente era
    // fortemente a favore del bianco — finché non arrivava un punteggio reale.
    if (!evalData.lines || evalData.lines.length === 0 || typeof evalData.score !== 'number') {
        els.engineInfo.innerText = `Depth: ${evalData.depth}`;
        return;
    }

    updateEvalBar(evalData);

    const rows = evalData.lines.map((line, i) => {
        const scoreStr = line.type === 'mate'
            ? `Mate in M${Math.abs(line.score)}`
            : `${line.score > 0 ? '+' : ''}${line.score.toFixed(2)}`;
        const lineText = line.sanLine || line.bestMove || '...';
        return `${i + 1}. (${scoreStr}) ${lineText}`;
    });

    els.engineInfo.innerHTML = `Depth: ${evalData.depth}<br>` + rows.join('<br>');
}

// Calcola SEMPRE dal punto di vista non-flippato (bianco in basso): il flip
// visivo (posizione + colori) è delegato interamente al CSS (classe
// "flipped" sul contenitore), qui basta leggere board.isFlipped.
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
    if (typeof score !== 'number' || !Number.isFinite(score)) score = 0;
    let percentage = 50;
    let displayScore = "0.0";

    if (evalData.type === 'mate') {
        percentage = score > 0 ? 100 : (score < 0 ? 0 : 50);
        displayScore = "M" + Math.abs(score);
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

let lastRenderedNode = null;

function renderComment() {
    els.comment.innerHTML = renderCommentHTML(state.tree.current.comment, getSanPath(state.tree.current))
        || '<div class="cb-comment-empty">No comment on this move.</div>';

    // Solo quando la mossa corrente è CAMBIATA davvero (non per qualsiasi
    // altro notifyChange, es. un NAG cliccato o un commento modificato sulla
    // stessa mossa): il nuovo appunto deve sempre iniziare visibile dall'alto,
    // mai restare scrollato a metà per via del commento precedente più lungo.
    if (state.tree.current !== lastRenderedNode) {
        lastRenderedNode = state.tree.current;
        const panel = document.getElementById('analysis');
        if (panel) panel.scrollTop = 0;
    }
}

/**
 * @param {MoveNode} node
 * @returns {String[]} mosse SAN dalla radice fino a `node` (radice esclusa)
 */
function getSanPath(node) {
    const path = [];
    let n = node;
    while (n && n.parent) {
        path.unshift(n.move);
        n = n.parent;
    }
    return path;
}
