import { state, onStateChange, notifyChange, setPosition, setMode, setRecording, currentLine } from "./state.js";
import { createMove, resolvePath } from "./Course.js";
import { rebuildToIndex } from "./lineNav.js";
import { syncBoardToCurrentMove, applyMoveAnnotations } from "./boardSync.js";
import { autoAdvanceSkipBlock, cancelAutoAdvance, stopPreview } from "./studyPlayback.js";
import { switchTab } from "../../reader/ui/tabs.js";
import { playMoveSound, playSound, setMuted, isMuted } from "../../reader/sound.js";
import { initFileTab } from "./ui/fileTab.js";
import { initSectionsPanel } from "./ui/sectionsPanel.js";
import { initEditTab } from "./ui/editTab.js";
import { initAnalysisTab, handleBoardMove } from "./ui/analysisTab.js";

// Stesso setup del reader principale (vedi /reader/main.js): la board
// (Chessboard.js) e il motore di validazione (chess.js) sono le stesse
// librerie globali, caricate una volta sola da index.html.
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
};

const board = new Chessboard('#board-container', {
    images: myImages,
    showSuggestions: true,
    colors: {
        selected: 'rgba(255, 214, 79, 0.65)',
        lastMove: 'rgba(255, 214, 79, 0.45)',
        suggestion: 'rgba(30, 24, 16, 0.35)',
        customHighlight: 'rgba(224, 90, 46, 0.55)',
        arrow: 'rgba(255, 170, 0, 0.85)',
        availableMoveArrow: 'rgba(88, 140, 158, 0.55)',
    },
});

/**
 * Salta a `index` mosse dentro la Line puntata da `path`, ricostruendo la
 * board da zero (stessa tecnica di /reader/navigation.js). Con
 * `autoSkip: true` controlla subito se da lì parte un blocco di mosse
 * skippabili e, in modalità studente, le fa scorrere da sole.
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
    syncBoardToCurrentMove(board);
    handleBoardMove();

    if (opts.autoSkip && state.mode === 'STUDY') {
        autoAdvanceSkipBlock(board, line, index, (newIndex) => {
            setPosition(path, newIndex);
            syncBoardToCurrentMove(board);
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
    // Niente autoSkip andando indietro: un blocco skippabile subito prima
    // della posizione attuale rilancerebbe l'utente in avanti nello stesso
    // istante in cui preme "indietro".
    navigate(state.currentPath, state.currentIndex - 1);
}

function goToStart() {
    if (currentLine()) navigate(state.currentPath, 0);
}

function goToEnd() {
    const line = currentLine();
    if (line) navigate(state.currentPath, line.moves.length);
}

function stopRecording() {
    setRecording(null);
    const line = currentLine();
    if (line) rebuildToIndex(board, line, state.course.meta.startingFen, state.currentIndex);
    syncBoardToCurrentMove(board);
    handleBoardMove();
}

/**
 * Orienta la board in base a meta.side ('black' = nero in basso, per un corso
 * di repertorio col Nero). flipBoard() è un TOGGLE, quindi lo si richiama
 * solo se l'orientamento attuale non corrisponde già — e mai ad ogni
 * notifyChange, altrimenti un flip manuale verrebbe annullato al primo tasto.
 */
function applyCourseOrientation() {
    const wantFlipped = state.course.meta.side === 'black';
    if (board.isFlipped !== wantFlipped) board.flipBoard();
    handleBoardMove(); // l'eval bar segue l'orientamento
}

// --- Routing delle mosse giocate sulla board ---
//
// 1. Modalità studente: le mosse manuali non fanno parte del flusso (si
//    naviga con frecce/outline) — vengono annullate.
// 2. EDIT + registrazione attiva: la mossa finisce nell'array della preview
//    in corso, MAI nella linea principale.
// 3. EDIT normale: se coincide con la mossa già presente è solo navigazione;
//    se la linea finisce lì viene aggiunta; altrimenti è un tentativo di
//    ramificare (non permesso in questo formato) e viene rifiutata.
board.setOnMoveCallback((move) => {
    if (!move || !move.san) return;

    if (state.mode === 'STUDY') {
        board.undoSilently();
        return;
    }

    if (state.recording) {
        const line = currentLine();
        const holderMove = line.moves[state.recording.moveIndex];
        const preview = holderMove.previews[state.recording.id];
        const recorded = createMove(move.san);
        preview.moves.push(recorded);
        playMoveSound(move);
        applyMoveAnnotations(board, recorded); // ripulisce NAG/frecce della mossa precedente
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
            syncBoardToCurrentMove(board);
            playMoveSound(move);
            handleBoardMove();
        } else {
            board.undoSilently();
            board.flashSquareError(move.to);
            playSound('error');
            alert('This line has no branches. To show an alternative here, use a line preview instead (Notes tab).');
        }
        return;
    }

    line.moves.push(createMove(move.san));
    setPosition(state.currentPath, state.currentIndex + 1);
    syncBoardToCurrentMove(board);
    playMoveSound(move);
    handleBoardMove();
});

// Frecce ed evidenziazioni disegnate a mano (tasto destro sulla board) vengono
// salvate come appunti sulla mossa mostrata — o sull'ultima mossa registrata,
// se si sta registrando una preview. Solo in EDIT: quelle disegnate da uno
// studente restano un suo scarabocchio temporaneo e non toccano il corso.
board.setOnAnnotationChange(() => {
    if (state.mode !== 'EDIT') return;

    let target = null;
    const line = currentLine();
    if (state.recording && line) {
        const preview = line.moves[state.recording.moveIndex].previews[state.recording.id];
        target = preview.moves[preview.moves.length - 1] || null;
    } else if (line && state.currentIndex > 0) {
        target = line.moves[state.currentIndex - 1];
    }
    if (!target) return; // nessuna mossa a cui attaccare l'appunto (inizio linea)

    target.arrows = board.getArrows();
    target.highlights = board.getCustomHighlights();
    notifyChange();
});

// --- Wiring UI ---

['analysis-tab', 'edit-tab', 'file-tab'].forEach(tabId => {
    const contentId = tabId.replace(/-tab$/, '');
    document.getElementById(tabId).addEventListener('click', () => switchTab(tabId, contentId));
});

initFileTab(applyCourseOrientation);
initSectionsPanel((path, index) => navigate(path, index, { autoSkip: true }));
initEditTab(board, currentLine, stopRecording);
initAnalysisTab(board, () => {
    // La posizione è già stata ricostruita da analysisTab: qui si ripristinano
    // gli appunti della mossa e si riallinea il motore.
    syncBoardToCurrentMove(board);
    handleBoardMove();
});

document.getElementById('btn-nav-first').addEventListener('click', goToStart);
document.getElementById('btn-nav-back').addEventListener('click', goBack);
document.getElementById('btn-nav-forward').addEventListener('click', goForward);
document.getElementById('btn-nav-last').addEventListener('click', goToEnd);
document.getElementById('btn-flip').addEventListener('click', () => {
    board.flipBoard();
    handleBoardMove();
});

// Frecce da tastiera, tranne mentre si sta davvero scrivendo/scegliendo in un
// campo. Non basta guardare il tag: un <input type="file"> o una checkbox
// restano focalizzati dopo essere stati usati (es. dopo aver scelto un corso
// dal tab FILE) ma non "consumano" le frecce — bloccarle lì significava
// perdere la navigazione da tastiera fino al primo click altrove.
const NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color'];
function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.includes((el.type || '').toLowerCase());
    return false;
}

document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
});

// --- Selettore di modalità (EDIT / PREVIEW), nell'header come nel reader ---
document.querySelectorAll('.mode-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!state.course.meta.editable) return;
        setMode(btn.dataset.mode);
    });
});

let lastMode = null;
let lastCourse = null;

/**
 * Traduce lo stato in cosa si vede a livello di pagina (classe sul body,
 * selettore di modalità, titolo nell'header) e reagisce ai due cambi "grossi":
 * - nuovo corso caricato: orienta la board e la porta sulla posizione salvata
 *   nel file (prima restava sulla posizione iniziale pur segnando l'indice);
 * - cambio di modalità: ricostruisce la posizione reale (scarta un'eventuale
 *   registrazione a metà) e, entrando in modalità studente, riparte lo skip.
 * Entrambi sono controllati sul CAMBIO, non ad ogni notifyChange, altrimenti
 * digitare nelle NOTES scatenerebbe navigazioni ad ogni tasto.
 */
function applyStateEffects() {
    document.body.className = 'mode-' + state.mode.toLowerCase();
    document.getElementById('header-course-title').textContent = state.course.meta.title || '';

    document.getElementById('mode-switch').hidden = !state.course.meta.editable;
    document.querySelectorAll('.mode-switch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });

    const courseChanged = state.course !== lastCourse;
    const modeChanged = state.mode !== lastMode;
    lastCourse = state.course;
    lastMode = state.mode;

    if (courseChanged) {
        applyCourseOrientation();
        if (!currentLine()) board.setPosition(state.course.meta.startingFen || 'start');
    }

    if (state.mode === 'STUDY' && modeChanged) {
        switchTab('analysis-tab', 'analysis');
    }

    if ((courseChanged || modeChanged) && currentLine()) {
        navigate(state.currentPath, state.currentIndex, { autoSkip: state.mode === 'STUDY' });
    }
}

onStateChange(applyStateEffects);
applyStateEffects();

// --- Silenzia/riattiva i suoni ---
const btnMute = document.getElementById('btn-mute');
btnMute.addEventListener('click', () => {
    setMuted(!isMuted());
    btnMute.textContent = isMuted() ? '🔇' : '🔊';
});

// --- Tema chiaro/scuro ---
// Stessa logica (e stessa chiave in localStorage) del reader principale:
// data-theme è già impostato dallo script inline in index.html PRIMA del
// primo paint, qui si sincronizza solo l'icona e si gestisce il click.
const btnTheme = document.getElementById('btn-theme');
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pgn-reader-theme', theme); } catch (e) { /* resta solo per questa sessione */ }
    btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Utile per debug/ispezione manuale dalla console del browser.
window.PAGE_GLOBALS = state;
window.PAGE_BOARD = board;
