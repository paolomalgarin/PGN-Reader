import { state, onStateChange, currentLine, currentMove } from "../state.js";
import { renderMoveText } from "../courseText.js";
import { startPreview, stopPreview } from "../studyPlayback.js";
import { rebuildToIndex } from "../lineNav.js";

let board = null;
let els = {};
let onBackToLine = null; // iniettata da main.js: ricostruisce la board sulla posizione reale

export function initAnalysisTab(chessboard, backToLineFn) {
    board = chessboard;
    onBackToLine = backToLineFn;

    els = {
        text: document.getElementById('move-text'),
        lineTitle: document.getElementById('current-line-title'),
        previewBanner: document.getElementById('preview-banner'),
        previewLabel: document.getElementById('preview-banner-label'),
        btnBackToLine: document.getElementById('btn-back-to-line'),
    };

    els.text.addEventListener('click', onTextClick);
    els.btnBackToLine.addEventListener('click', onBackToLineClick);

    onStateChange(render);
    render();
}

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
        els.previewLabel.textContent = state.preview.label
            + (state.preview.playing ? ' …' : '');
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
