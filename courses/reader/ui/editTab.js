import { state, onStateChange, notifyChange, setRecording } from "../state.js";
import { renderMoveText, insertPreviewToken, generatePreviewId } from "../courseText.js";
import { playSound } from "../../../reader/sound.js";

let board = null;
let els = {};

/**
 * @param {Chessboard} chessboard
 * @param {Function} getCurrentLine - () => Line|null attualmente aperta
 */
export function initEditTab(chessboard, getCurrentLine, stopRecordingFn) {
    board = chessboard;

    els = {
        panel: document.getElementById('edit'),
        empty: document.getElementById('edit-empty'),
        form: document.getElementById('edit-form'),
        textInput: document.getElementById('move-text-editor'),
        skipToggle: document.getElementById('move-skip-toggle'),
        nagPalette: document.getElementById('nag-palette'),
        btnInsertPreview: document.getElementById('btn-insert-preview'),
        recordingBanner: document.getElementById('recording-banner'),
        recordingLabel: document.getElementById('recording-banner-label'),
        btnStopRecording: document.getElementById('btn-stop-recording'),
    };

    getLine = getCurrentLine;

    els.textInput.addEventListener('input', onTextInput);
    els.skipToggle.addEventListener('change', onSkipToggle);
    els.btnInsertPreview.addEventListener('click', onInsertPreviewClick);
    els.btnStopRecording.addEventListener('click', () => stopRecordingFn());

    buildNagPalette();
    onStateChange(refresh);
    refresh();
}

let getLine = () => null;

/**
 * @returns {Object|null} il MoveEntry attualmente selezionato: quello che si
 *          sta registrando (se recording) o l'ultima mossa giocata nella linea
 */
function currentTarget() {
    if (state.recording) {
        const line = getLine();
        const move = line && line.moves[state.recording.moveIndex];
        return move ? move.previews[state.recording.id] : null;
    }
    const line = getLine();
    if (!line || state.currentIndex === 0) return null;
    return line.moves[state.currentIndex - 1];
}

function refresh() {
    const recording = state.recording;
    els.recordingBanner.hidden = !recording;
    if (recording) els.recordingLabel.textContent = `Recording preview: "${recording.label}"`;

    if (recording) {
        // Durante la registrazione si edita la PREVIEW stessa (etichetta a
        // parte, già fissata all'avvio) — qui si può ancora marcare skip/testo
        // sull'ultima mossa registrata, se ce n'è già una.
        const line = getLine();
        const holder = line.moves[recording.moveIndex].previews[recording.id];
        const lastMove = holder.moves[holder.moves.length - 1] || null;
        renderForm(lastMove, true);
        return;
    }

    const move = currentTarget();
    renderForm(move, false);
}

function renderForm(move, isPreviewMove) {
    const hasTarget = !!move;
    els.empty.hidden = hasTarget;
    els.form.hidden = !hasTarget;
    if (!hasTarget) return;

    if (document.activeElement !== els.textInput) {
        els.textInput.value = move.text || '';
    }
    els.skipToggle.checked = !!move.skip;

    // Le preview non possono a loro volta contenere un'altra preview: tiene
    // la UI di registrazione a un solo livello, senza rami dentro ai rami.
    els.btnInsertPreview.disabled = isPreviewMove;
    els.btnInsertPreview.title = isPreviewMove
        ? "A preview move can't contain another preview"
        : "Insert a button that shows a short optional digression";

    refreshNagPaletteSelection(move);
}

function onTextInput() {
    const move = currentTarget();
    if (!move) return;
    move.text = els.textInput.value;
    notifyChange();
}

function onSkipToggle() {
    const move = currentTarget();
    if (!move) return;
    move.skip = els.skipToggle.checked;
    playSound('nag');
    notifyChange();
}

// --- NAG ---

function buildNagPalette() {
    els.nagPalette.innerHTML = '';
    Object.keys(window.Chessboard.DEFAULT_NAG_INFO).forEach(code => {
        const visual = board.getNagVisual(code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nag-btn';
        btn.dataset.nag = code;
        btn.title = code;
        btn.style.setProperty('--nag-color', visual.color);
        btn.innerHTML = `<img src="${visual.image}" alt="${code}" />`;
        btn.addEventListener('click', () => onNagClick(code));
        els.nagPalette.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'nag-btn nag-btn-clear';
    clearBtn.title = 'Remove NAG from this move';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => onNagClick(null));
    els.nagPalette.appendChild(clearBtn);
}

function onNagClick(code) {
    const move = currentTarget();
    if (!move) return;
    move.nag = code ? [code] : [];
    board.setNag(code || null);
    playSound('nag');
    notifyChange();
}

function refreshNagPaletteSelection(move) {
    const activeNag = move.nag && move.nag[0];
    els.nagPalette.querySelectorAll('.nag-btn').forEach(btn => {
        btn.classList.toggle('selected', !!activeNag && btn.dataset.nag === activeNag);
    });
}

// --- Inserimento/registrazione di una line preview ---
// Flusso: si preme "Insert line preview" -> si chiede subito l'etichetta del
// bottone -> il token va nel testo alla posizione del cursore -> si entra in
// modalità "recording": ogni mossa giocata sulla board da qui in poi finisce
// dentro preview.moves invece che nella linea principale, finché non si
// preme "Stop recording" (vedi banner). onInsertPreviewClick si occupa SOLO
// di creare il contenitore e aggiornare il testo; è main.js (che controlla
// il flusso reale delle mosse) a leggere state.recording per instradarle.

function onInsertPreviewClick() {
    const move = currentTarget();
    if (!move || state.recording) return;

    const label = prompt('Button label shown to the student (e.g. "What if 1...c5 instead?"):', '');
    if (label === null || !label.trim()) return;

    const id = generatePreviewId();
    move.previews[id] = { label: label.trim(), moves: [] };

    const cursorPos = els.textInput.selectionStart ?? move.text.length;
    move.text = insertPreviewToken(move.text || '', cursorPos, id, label.trim());
    els.textInput.value = move.text;

    setRecording({ id, label: label.trim(), moveIndex: state.currentIndex - 1 });
}

export { renderMoveText }; // re-esportato per comodità di chi importa solo questo modulo
