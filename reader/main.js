import { state, notifyChange, onStateChange, setExploring, setMode } from "./state.js";
import { attachKeyboardNavigation, goBack, goForward, jumpToNode } from "./navigation.js";
import { syncBoardToCurrentNode, setMoveArrowsEnabled, areMoveArrowsEnabled } from "./boardSync.js";
import { saveArrowsAndHighlights } from "./commentFormat.js";
import { playMoveSound, playMoveSoundForNode, playSound, setMuted, isMuted } from "./sound.js";
import { confettiBurst } from "./confetti.js";
import { initModeHandling, needsPgnGate } from "./mode.js";
import { setHumanColor, maybePlayComputerMove, cancelPendingComputerMove, setAfterMoveCallback, recordHumanMove, getStreak, resetStreak } from "./drill.js";
import { showPgnGate, hidePgnGate } from "./ui/pgnGate.js";
import { initTabs, switchTab } from "./ui/tabs.js";
import { initAnalysisTab, handleBoardMove, flipBoard } from "./ui/analysisTab.js";
import { initMoveList } from "./ui/moveList.js";
import { initEditTab } from "./ui/editTab.js";
import { initExportTab } from "./ui/exportTab.js";

// Chessboard.js resta uno script classico (vedi il commento in fondo a quel
// file) e si registra esplicitamente su window per un accesso affidabile qui.
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
        bp: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg'
    }
};

const board = new Chessboard('#board-container', {
    images: myImages,
    showSuggestions: true,
    colors: {
        selected: 'rgba(124, 47, 34, 0.4)',
        lastMove: 'rgba(163, 121, 47, 0.4)',
        suggestion: 'rgba(43, 32, 19, 0.28)',
        customHighlight: 'rgba(107, 61, 92, 0.45)'
    },
});

/**
 * Coda comune eseguita dopo QUALSIASI cambiamento di posizione che non sia
 * passato per una mossa "vera" (drag&drop): frecce sx/dx da tastiera, click
 * su una mossa nella move-list, mossa del pc in modalità drill, reset di
 * un'esplorazione temporanea. In tutti questi casi state.tree.current è già
 * stato aggiornato da chi ha chiamato questa funzione (navigation.js) — qui
 * ci si limita a farlo sapere al resto dell'app. Essendo sempre e solo una
 * posizione REALMENTE tracciata dall'albero, chiude anche un'eventuale
 * esplorazione temporanea in corso.
 */
function afterNavigate() {
    setExploring(false);
    syncBoardToCurrentNode(board);
    playMoveSoundForNode(state.tree.isAtRoot() ? null : state.tree.current);
    notifyChange();
    handleBoardMove();

    if (state.mode === 'DRILL') {
        maybePlayComputerMove(board);
    }
}

// Il pc, in drill, avanza anche lui tramite goForward (navigation.js) — gli
// passiamo la stessa coda "afterNavigate" di tastiera/move-list.
setAfterMoveCallback(afterNavigate);

// --- Wiring centrale: ogni mossa "vera" (drag&drop) sincronizza l'albero ---
// Chessboard.js notifica con `move` valorizzato per una mossa vera e propria,
// con `null` per un passo indietro (che però qui non usiamo più: undoMove()
// non è più la via per tornare indietro nell'albero — vedi navigation.js).
//
// In READ le mosse sono pura esplorazione: restano sulla board (con relativo
// suono e aggiornamento del motore) ma non toccano mai l'albero, quindi non
// finiscono mai nel PGN salvato — state.isExploring segna che si è "fuori"
// dalla linea tracciata, e un pulsante dedicato permette di scartarla.
// In DRILL una mossa fuori repertorio viene invece rifiutata subito (si torna
// alla posizione di prima, un lampo rosso sulla casella e un suono di errore
// segnalano il tentativo sbagliato) invece di essere aggiunta all'albero.
board.setOnMoveCallback((move) => {
    if (move && move.san) {
        if (state.mode === 'READ') {
            const knownChild = state.tree.current.getMoveChild(move.san);

            if (knownChild) {
                // La mossa coincide esattamente con la prossima mossa del PGN:
                // è navigazione vera, non esplorazione — prima di questo fix
                // qualunque mossa fatta a mano in READ veniva sempre trattata
                // come temporanea, anche quando ricalcava il PGN alla lettera.
                state.tree.addMove(move.san); // riusa knownChild, non ne crea uno nuovo
                syncBoardToCurrentNode(board);
                playMoveSoundForNode(state.tree.current);
                setExploring(false);
                notifyChange();
                handleBoardMove();
                return;
            }

            // Mossa fuori dal PGN: resta pura esplorazione temporanea sulla
            // board, mai aggiunta all'albero (comportamento invariato).
            board.clearAvailableMoveArrows(); // non più valide per questa posizione temporanea
            playMoveSound(move);
            handleBoardMove();
            setExploring(true);
            return;
        }

        let isDrillCorrectMove = false;
        if (state.mode === 'DRILL') {
            const wasOnBook = state.tree.current.hasMoveChild(move.san);
            recordHumanMove(move.san); // aggiorna lo streak comunque (incrementa o azzera)

            if (!wasOnBook) {
                const wrongSquare = move.to;
                board.undoSilently();
                board.flashSquareError(wrongSquare);
                playSound('error');
                notifyChange(); // riflette subito lo streak azzerato nella UI
                return;
            }
            isDrillCorrectMove = true;
        }

        state.tree.addMove(move.san);

        // In drill una mossa "a libro" merita il chirp premiante invece del
        // generico suono di mossa — ma scacco/matto/cattura restano quelli,
        // sono informazioni sulla scacchiera, non solo un feedback del drill.
        if (isDrillCorrectMove && !move.san.includes('#') && !move.san.includes('+') && !move.captured) {
            syncBoardToCurrentNode(board);
            playSound('correct');
            notifyChange();
            handleBoardMove();
            if (state.mode === 'DRILL') maybePlayComputerMove(board);
            return;
        }
    } else {
        state.tree.moveUp();
    }

    syncBoardToCurrentNode(board);
    playMoveSoundForNode(move ? state.tree.current : null);
    notifyChange();
    handleBoardMove();

    if (state.mode === 'DRILL') {
        maybePlayComputerMove(board);
    }
});

// Frecce/evidenziazioni disegnate a mano dall'utente (tasto destro) vengono
// salvate come metadati nel commento della mossa corrente, così tornando su
// questa posizione in futuro (syncBoardToCurrentNode) ricompaiono da sole.
board.setOnAnnotationChange(() => {
    const arrows = board.getArrows();
    const highlights = board.getCustomHighlights();
    const updated = saveArrowsAndHighlights(state.tree.current.comment, arrows, highlights);
    state.tree.current.setComment(updated);
    notifyChange();
});

attachKeyboardNavigation(board, afterNavigate);

initTabs();
initAnalysisTab(board);
initMoveList(board, afterNavigate);
initEditTab(board);
initExportTab(board);
initModeHandling();

// --- Chess.com-style navigation arrows (handy on mobile) ---
document.getElementById('btn-nav-back').addEventListener('click', () => {
    goBack(board, afterNavigate);
});
document.getElementById('btn-nav-forward').addEventListener('click', () => {
    goForward(board, afterNavigate);
});
document.getElementById('btn-nav-first').addEventListener('click', () => {
    while (!state.tree.isAtRoot()) {
        if (!goBack(board, null)) break; // salta afterNavigate ad ogni passo: si sincronizza una sola volta alla fine
    }
    afterNavigate();
});
document.getElementById('btn-nav-last').addEventListener('click', () => {
    // Avanza sulla mainline (children[0], mai dentro le varianti) finché ci
    // sono continuazioni note, fermandosi in fondo alla linea corrente.
    while (goForward(board, null)) { /* salta afterNavigate ad ogni passo */ }
    afterNavigate();
});

// --- Toggle per le frecce delle mosse disponibili (a qualcuno danno fastidio) ---
const btnToggleArrows = document.getElementById('btn-toggle-move-arrows');
function refreshToggleArrowsLabel() {
    btnToggleArrows.classList.toggle('active', areMoveArrowsEnabled());
    btnToggleArrows.textContent = areMoveArrowsEnabled() ? '➜ move arrows' : '➜ move arrows (hidden)';
}
btnToggleArrows.addEventListener('click', () => {
    setMoveArrowsEnabled(!areMoveArrowsEnabled());
    refreshToggleArrowsLabel();
    syncBoardToCurrentNode(board); // riapplica subito la nuova scelta
});
refreshToggleArrowsLabel();

// --- Reset dell'esplorazione temporanea (READ) ---
// Scarta le mosse "di prova" fatte in READ, tornando alla posizione
// realmente tracciata dall'albero (jumpToNode su state.tree.current, che non
// è mai cambiato durante l'esplorazione, ricostruisce esattamente quella
// posizione ignorando qualsiasi mossa temporanea giocata sopra di essa).
document.getElementById('btn-reset-exploration').addEventListener('click', () => {
    jumpToNode(board, state.tree.current, afterNavigate);
});

// --- Selettore di modalità: tre pulsanti espliciti (Prepara/Studia/Allena)
// invece dell'unico pulsante "a ciclo" di prima — si vede sempre dove si è e
// si arriva ovunque in un tocco. Ogni pulsante porta direttamente al proprio
// state.mode (vedi state.js) tramite setMode(); lo streak si azzera uscendo
// dal drill, esattamente come faceva il vecchio pulsante unico.
document.querySelectorAll('.mode-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const targetMode = btn.dataset.mode;
        if (state.mode === targetMode) return;
        if (state.mode === 'DRILL') resetStreak();
        setMode(targetMode);
    });
});

function refreshModeSwitch() {
    document.querySelectorAll('.mode-switch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });
}

/**
 * Riflette lo stato corrente (modalità, albero vuoto o meno...) sul layout
 * generale della pagina: classe sul body (la usa index.css per mostrare/
 * nascondere tab ed eval bar a seconda della modalità), selettore di
 * modalità, tab forzato in READ, gate PGN quando serve, avvio/stop della
 * modalità drill. Unico punto che traduce "stato" in "cosa si vede sullo
 * schermo" a livello di pagina — i singoli tab si occupano solo del proprio
 * contenuto interno tramite le proprie sottoscrizioni a onStateChange().
 */
function applyStateEffects() {
    document.body.className = 'mode-' + state.mode.toLowerCase();
    document.body.classList.toggle('exploring', state.isExploring);
    refreshModeSwitch();

    if (state.mode === 'READ') {
        switchTab('analysis-tab', 'analysis');
    }

    if (needsPgnGate()) {
        showPgnGate(board);
        cancelPendingComputerMove();
        return;
    }
    hidePgnGate();

    if (state.mode === 'DRILL') {
        // Si riparte sempre assumendo che l'utente giochi il bianco (può
        // cambiarlo flippando la scacchiera); se a questo punto tocca comunque
        // al pc (es. si rientra in drill a metà di una linea), gioca subito.
        setHumanColor(!board.isFlipped);
        maybePlayComputerMove(board);
    } else {
        cancelPendingComputerMove();
    }
}

onStateChange(applyStateEffects);
applyStateEffects();

document.getElementById('btn-flip-drill').addEventListener('click', flipBoard);

// --- Streak della modalità drill (piccola gamification) ---
const streakEl = document.getElementById('drill-streak');
const streakCountEl = document.getElementById('drill-streak-count');
let lastShownStreak = -1;
onStateChange(() => {
    const streak = getStreak();
    if (streak !== lastShownStreak) {
        const increased = streak > lastShownStreak;
        lastShownStreak = streak;
        streakCountEl.textContent = streak;
        streakEl.classList.toggle('lit', streak > 0);
        streakEl.classList.remove('wobble');
        void streakEl.offsetWidth; // forza il replay dell'animazione
        streakEl.classList.add('wobble');

        // Milestone ogni 5 mosse a libro consecutive: piccola festa dorata,
        // il momento "premiante" del drill che invoglia a continuare.
        if (increased && streak > 0 && streak % 5 === 0) {
            playSound('milestone');
            confettiBurst(streakEl);
        }
    }
});

// --- Silenzia/riattiva i suoni ---
const btnMute = document.getElementById('btn-mute');
btnMute.addEventListener('click', () => {
    setMuted(!isMuted());
    btnMute.textContent = isMuted() ? '🔇' : '🔊';
});

// --- Tema chiaro/scuro ---
// L'attributo data-theme è già impostato PRIMA di questo script (vedi lo
// script inline in index.html, che legge localStorage/preferenza di sistema
// senza aspettare il modulo) — qui ci si limita a sincronizzare l'icona e a
// gestire il click.
const btnTheme = document.getElementById('btn-theme');
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pgn-reader-theme', theme); } catch (e) { /* ok, resta solo per questa sessione */ }
    btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
}
applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
btnTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

// Utile per debug/ispezione manuale dalla console del browser.
window.PAGE_GLOBALS = state;
