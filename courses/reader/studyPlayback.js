// Le due forme di "riproduzione automatica" dello Study mode:
//
// 1. Skip-block: una o più mosse consecutive della linea principale marcate
//    skip:true (autore le ha segnate perché "non contano" ai fini della
//    spiegazione, es. una sequenza forzata prima del vero bivio) vengono
//    giocate da sole, un tot ogni STEP_DELAY_MS, senza mostrare alcun testo,
//    finché non si arriva a una mossa non-skip o alla fine della linea.
//    Può succedere sia entrando in una linea da capo sia a metà linea.
//
// 2. Line preview: un bottone dentro il testo di una mossa (vedi
//    courseText.js) apre una breve digressione — le sue mosse vengono
//    giocate in automatico sopra alla posizione corrente, poi resta "in
//    pausa" sull'ultima mostrando un banner "Back to line" (gestito da
//    analysisTab.js) finché l'utente non torna indietro. È sempre e solo
//    visualizzazione: non tocca mai currentIndex/currentPath.

import { state, setPreview } from "./state.js";
import { rebuildToIndex } from "./lineNav.js";
import { applyMoveAnnotations } from "./boardSync.js";
import { playMoveSoundForSan } from "../../reader/sound.js";

const STEP_DELAY_MS = 300;

let pendingTimeoutId = null;

function clearPending() {
    if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
    }
}

/**
 * Da richiamare in STUDY subito dopo essere arrivati a `index` in `line`
 * (ingresso nella linea, o dopo una mossa manuale): se la mossa in quella
 * posizione è marcata skip, la esegue e richiama sé stessa sulla successiva.
 *
 * @param {Chessboard} board
 * @param {Object} line
 * @param {number} index
 * @param {Function} onStep - richiamata ad ogni avanzamento automatico col nuovo index
 */
export function autoAdvanceSkipBlock(board, line, index, onStep) {
    clearPending();

    const next = line.moves[index];
    if (!next || !next.skip) return;

    pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;
        const ok = rebuildToIndex(board, line, state.course.meta.startingFen, index + 1);
        if (!ok) return;
        playMoveSoundForSan(next.move);
        onStep(index + 1);
        autoAdvanceSkipBlock(board, line, index + 1, onStep);
    }, STEP_DELAY_MS);
}

export function cancelAutoAdvance() {
    clearPending();
}

// --- PREVIEW ---

/**
 * Avvia la riproduzione di una preview agganciata alla mossa corrente.
 *
 * @param {Chessboard} board
 * @param {Object} previewDef - { label, moves: [MoveEntry, ...] }
 */
export function startPreview(board, previewDef) {
    clearPending();
    setPreview({ label: previewDef.label, moves: previewDef.moves, stepIndex: 0, playing: true });
    stepPreview(board, previewDef.moves, 0);
}

function stepPreview(board, moves, index) {
    if (index >= moves.length) {
        setPreview({ ...state.preview, playing: false });
        return;
    }

    pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;

        // Rigioca solo il passo `index` SOPRA alla posizione attuale della
        // board (non dall'inizio partita): una preview parte sempre dalla
        // mossa a cui è agganciata nel testo.
        const scratch = new window.Chess(board.game.fen());
        const result = scratch.move(moves[index].move);
        if (result) {
            board.setPosition(scratch.fen(), { from: result.from, to: result.to });
            applyMoveAnnotations(board, moves[index]);
            playMoveSoundForSan(moves[index].move);
        }

        setPreview({ ...state.preview, stepIndex: index + 1 });
        stepPreview(board, moves, index + 1);
    }, STEP_DELAY_MS);
}

/**
 * Interrompe una preview in corso (l'utente ha premuto "Back to line", o è
 * navigato altrove). Il chiamante si occupa di ricostruire la board sulla
 * posizione reale (rebuildToIndex sulla linea principale) — questa funzione
 * pulisce solo il timer pendente e lo stato.
 */
export function stopPreview() {
    clearPending();
    setPreview(null);
}
