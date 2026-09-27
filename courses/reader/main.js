import { state, onStateChange, notifyChange, setPosition, setMode, setRecording, currentLine } from "./state.js";
import { createMove, resolvePath } from "./Course.js";
import { rebuildToIndex } from "./lineNav.js";
import { autoAdvanceSkipBlock, cancelAutoAdvance, stopPreview } from "./studyPlayback.js";
import { switchTab } from "../../reader/ui/tabs.js";
import { playMoveSound, playSound } from "../../reader/sound.js";
import { initFileTab } from "./ui/fileTab.js";
import { initSectionsPanel } from "./ui/sectionsPanel.js";
import { initEditTab } from "./ui/editTab.js";
import { initAnalysisTab, handleBoardMove } from "./ui/analysisTab.js";

// Stesso identico setup del reader principale (vedi /reader/main.js): la
// board (Chessboard.js) e il motore di validazione (chess.js) sono la stessa
// libreria globale, caricata una volta sola da index.html.
const Chessboard = window.Chessboard;

const myImages = {
    pieces: {
        wk: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
        wq: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
        wr: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
        wb: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
        wn: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
        wp: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
        bk: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
        bq: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
        br: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
        bb: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
        bn: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
        bp: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
    },
    squares: { light: '', dark: '', highlight: '' },
};

const board = new Chessboard('#board-container', {
    images: myImages,
    showSuggestions: true,
    colors: {
        selected: 'rgba(255, 214, 112, 0.6)',
        lastMove: 'rgba(255, 214, 112, 0.4)',
        suggestion: 'rgba(20, 20, 20, 0.25)',
    },
});

/**
 * Salta a `index` mosse dentro la Line puntata da `path`, ricostruendo la
 * board da zero (stessa tecnica di /reader/navigation.js). Con
 * `autoSkip: true` (ingresso in una linea, o un passo avanti) controlla
 * subito se da lì parte un blocco di mosse skippabili e, in STUDY, le fa
 * scorrere da sole.
 *
 * @param {number[]} path
 * @param {number} index
 * @param {{autoSkip?: boolean}} [opts]
 */
function navigate(path, index, opts = {}) {
    cancelAutoAdvance();
    stopPreview();

    const line = resolvePath(state.course, path);
    if (!line || line.type !== 'line') return;
    if (!rebuildToIndex(board, line, state.course.meta.startingFen, index)) return;

    setPosition(path, index);
    handleBoardMove();

    if (opts.autoSkip && state.mode === 'STUDY') {
        autoAdvanceSkipBlock(board, line, index, (newIndex) => {
            setPosition(path, newIndex);
            handleBoardMove();
        });
    }
}

function goForward() {
    const line = currentLine();
    if (!line || state.currentIndex >= line.moves.length) return;
    navigate(state.currentPath, state.currentIndex + 1, { autoSkip: true });
}

function goBack() {
    if (state.currentIndex <= 0) return;
    // Niente autoSkip andando indietro: altrimenti un blocco skippabile
    // subito prima della posizione attuale rilancerebbe l'utente in avanti
    // nello stesso istante in cui preme "indietro".
    navigate(state.currentPath, state.currentIndex - 1);
}

function stopRecording() {
    setRecording(null);
    const line = currentLine();
    if (line) rebuildToIndex(board, line, state.course.meta.startingFen, state.currentIndex);
}

/**
 * Orienta la board in base a meta.side ('white' = bianco in basso, 'black' =
 * nero in basso — utile per un corso di repertorio col Nero, es. la
 * Caro-Kann). flipBoard() è un TOGGLE (vedi Chessboard.js), quindi lo si
 * richiama solo se l'orientamento attuale non corrisponde già a quello
 * voluto — mai in automatico ad ogni notifyChange, altrimenti un flip
 * manuale fatto solo per dare un'occhiata verrebbe subito annullato dal
 * primo tasto premuto altrove.
 */
function applyCourseOrientation() {
    const wantFlipped = state.course.meta.side === 'black';
    if (board.isFlipped !== wantFlipped) board.flipBoard();
}

// --- Routing delle mosse giocate sulla board ---
//
// Tre destinazioni possibili per una mossa "vera" (drag&drop), a seconda
// dello stato corrente:
// 1. STUDY: le mosse manuali non fanno parte del flusso (si naviga con i
//    bottoni/l'outline) — vengono semplicemente annullate.
// 2. EDIT + recording attivo: la mossa finisce nell'array della preview in
//    corso di registrazione, MAI nella linea principale.
// 3. EDIT normale: se corrisponde alla mossa già presente in quella
//    posizione, è solo navigazione; se la linea finisce lì, viene aggiunta;
//    altrimenti è un tentativo di ramificare una linea (non permesso in
//    questo formato) e viene rifiutata con una spiegazione.
board.setOnMoveCallback((move) => {
    if (!move || !move.san) return; // step indietro nativo: non usato qui

    if (state.mode === 'STUDY') {
        board.undoSilently();
        return;
    }

    if (state.recording) {
        const line = currentLine();
        const holderMove = line.moves[state.recording.moveIndex];
        const preview = holderMove.previews[state.recording.id];
        preview.moves.push(createMove(move.san));
        playMoveSound(move);
        board.setNag(null);
        notifyChange();
        return;
    }

    const line = currentLine();
    if (!line) {
        board.undoSilently();
        return;
    }

    if (state.currentIndex < line.moves.length) {
        const expected = line.moves[state.currentIndex];
        if (move.san === expected.move) {
            setPosition(state.currentPath, state.currentIndex + 1);
            playMoveSound(move);
            handleBoardMove();
        } else {
            board.undoSilently();
            board.flashSquareError(move.to);
            playSound('error');
            alert('This line has no branches. To show an alternative here, use a line preview instead (Edit tab).');
        }
        return;
    }

    line.moves.push(createMove(move.san));
    setPosition(state.currentPath, state.currentIndex + 1);
    playMoveSound(move);
    handleBoardMove();
});

// --- Wiring UI ---

['file-tab', 'analysis-tab', 'edit-tab'].forEach(tabId => {
    const contentId = tabId.replace(/-tab$/, '');
    document.getElementById(tabId).addEventListener('click', () => switchTab(tabId, contentId));
});

initFileTab(applyCourseOrientation);
initSectionsPanel((path, index) => navigate(path, index, { autoSkip: true }));
initEditTab(board, currentLine, stopRecording);
initAnalysisTab(board, () => { /* la posizione è già stata ricostruita da analysisTab stesso */ });

document.getElementById('btn-nav-back').addEventListener('click', goBack);
document.getElementById('btn-nav-forward').addEventListener('click', goForward);
document.getElementById('btn-flip').addEventListener('click', () => {
    board.flipBoard();
    handleBoardMove();
});

applyCourseOrientation();

document.getElementById('mode-toggle-btn').addEventListener('click', () => {
    if (!state.course.meta.editable) return;
    setMode(state.mode === 'EDIT' ? 'STUDY' : 'EDIT');
});

let lastMode = null;

function applyStateEffects() {
    document.body.className = 'mode-' + state.mode.toLowerCase();
    const modeBtn = document.getElementById('mode-toggle-btn');
    modeBtn.textContent = state.mode === 'EDIT' ? '👁 Preview as student' : '✎ Resume editing';
    modeBtn.hidden = !state.course.meta.editable;

    // L'Edit tab è nascosto in STUDY (via CSS, vedi index.css) — se era
    // quella la tab selezionata, forza ANALYSIS. Controllato solo al
    // CAMBIO di modalità (non ad ogni notifyChange), altrimenti digitare
    // nel campo testo dell'Edit tab in EDIT mode ci farebbe uscire dal tab
    // ad ogni tasto premuto.
    if (state.mode !== lastMode) {
        lastMode = state.mode;
        if (state.mode === 'STUDY') switchTab('analysis-tab', 'analysis');
    }
}

onStateChange(applyStateEffects);
applyStateEffects();

window.PAGE_GLOBALS = state;
