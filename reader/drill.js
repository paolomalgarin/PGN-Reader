import { state } from "./state.js";
import { goForward } from "./navigation.js";

const RESPONSE_DELAY_MS = 500;

let humanIsWhite = true; // colore giocato dall'utente; l'altro lo gioca il pc
let pendingTimeoutId = null;
let afterMoveFn = null; // iniettato da main.js: sync + suono + notifyChange + motore (+ ricontrollo turno pc)

let streak = 0;
let bestStreak = 0;

/**
 * Registra la funzione da richiamare dopo ogni mossa del pc (la stessa
 * "coda comune" usata per tastiera/move-list in main.js) — iniettata invece
 * che importata direttamente per evitare un giro di dipendenze circolari
 * (main.js già importa da qui per pilotare il drill).
 *
 * @param {Function} fn
 */
export function setAfterMoveCallback(fn) {
    afterMoveFn = fn;
}

/**
 * Imposta quale colore gioca l'utente (l'altro lo gioca il pc). Da richiamare
 * quando si entra in drill e ogni volta che si flippa la scacchiera.
 *
 * @param {boolean} isWhite
 */
export function setHumanColor(isWhite) {
    humanIsWhite = isWhite;
}

/**
 * @param {Chessboard} board
 * @returns {boolean} true se in questo momento tocca al pc muovere
 */
function isComputerTurn(board) {
    if (!board.game) return false;
    const turnIsWhite = board.game.turn() === 'w';
    return turnIsWhite !== humanIsWhite;
}

/**
 * Da richiamare dopo OGNI mossa in modalità drill (dell'utente o del pc):
 * se la posizione corrente non ha continuazioni note, la linea è finita — si
 * festeggia lo streak e si riparte da capo (chiamando di nuovo questa stessa
 * funzione, per il caso in cui a quel punto tocchi subito al pc, es. l'utente
 * gioca il nero). Solo se la linea NON è finita si controlla se è il turno
 * del pc e, in caso, gli si fa giocare una risposta a caso dopo un breve
 * ritardo.
 *
 * Il controllo di fine linea va fatto PRIMA di quello sul turno: una linea
 * può finire proprio con la mossa del pc, lasciando il turno all'utente senza
 * che ci sia nulla di noto da giocare — se si guardasse solo "tocca al pc?"
 * questo caso non verrebbe mai rilevato e la modalità resterebbe bloccata.
 *
 * @param {Chessboard} board
 */
export function maybePlayComputerMove(board) {
    cancelPendingComputerMove();

    if (!state.tree.isAtRoot() && state.tree.current.children.length === 0) {
        registerLineEnd();
        board.clearPremoves(); // erano pianificate per la linea appena finita
        board.setPosition(state.tree.startingFen || 'start');
        state.tree.goToRoot();
        if (afterMoveFn) afterMoveFn();
        return;
    }

    if (!isComputerTurn(board)) return;

    pendingTimeoutId = setTimeout(() => {
        pendingTimeoutId = null;

        const children = state.tree.current.children;
        if (children.length === 0) return; // già gestito sopra, guardia di sicurezza

        const chosen = children[Math.floor(Math.random() * children.length)];
        goForward(board, afterMoveFn, chosen.move);
    }, RESPONSE_DELAY_MS);
}

/**
 * Annulla una risposta del pc già programmata ma non ancora giocata (es. si
 * sta uscendo dalla modalità drill nel frattempo).
 */
export function cancelPendingComputerMove() {
    if (pendingTimeoutId) {
        clearTimeout(pendingTimeoutId);
        pendingTimeoutId = null;
    }
}

// --- STREAK (piccola gamification per rendere il drill più coinvolgente) ---
// Ogni mossa dell'utente che risulta già presente nell'albero (cioè "a
// libro") allunga lo streak; una mossa fuori repertorio lo azzera. Va
// richiamata da main.js PRIMA di sincronizzare l'albero con la mossa appena
// giocata (altrimenti il figlio esisterebbe già sempre, essendo stato appena
// creato) e solo per le mosse dell'UTENTE, non per quelle del pc.

/**
 * @param {String} san - mossa appena giocata dall'utente
 */
export function recordHumanMove(san) {
    const wasOnBook = state.tree.current.hasMoveChild(san);
    if (wasOnBook) {
        streak++;
        if (streak > bestStreak) bestStreak = streak;
    } else {
        streak = 0;
    }
}

function registerLineEnd() {
    if (streak > bestStreak) bestStreak = streak;
    streak = 0;
}

export function getStreak() {
    return streak;
}

export function getBestStreak() {
    return bestStreak;
}

/**
 * Azzera lo streak (es. entrando in una nuova sessione di drill).
 */
export function resetStreak() {
    streak = 0;
}
