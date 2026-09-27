import { state, onStateChange, setCourse, notifyChange } from "../state.js";
import { createEmptyCourse, parseCourse, serializeCourse } from "../Course.js";

let els = {};
let onSideChange = null; // iniettata da main.js: applica subito l'orientamento della board

/**
 * @param {Function} onSideChangeFn - richiamata dopo un cambio di "Studying as"
 */
export function initFileTab(onSideChangeFn) {
    onSideChange = onSideChangeFn;

    els = {
        fileInput: document.getElementById('pgnc-file-input'),
        error: document.getElementById('pgnc-import-error'),
        title: document.getElementById('course-title-input'),
        side: document.getElementById('course-side-select'),
        editableBadge: document.getElementById('course-editable-badge'),
        btnNew: document.getElementById('btn-new-course'),
        btnDownloadEditable: document.getElementById('btn-download-pgnce'),
        btnDownloadStudent: document.getElementById('btn-download-pgnc'),
    };

    els.fileInput.addEventListener('change', onFileChosen);
    els.title.addEventListener('input', onTitleInput);
    els.side.addEventListener('change', onSideSelect);
    els.btnNew.addEventListener('click', onNewCourse);
    els.btnDownloadEditable.addEventListener('click', () => onDownload(true));
    els.btnDownloadStudent.addEventListener('click', () => onDownload(false));

    onStateChange(refresh);
    refresh();
}

// L'estensione del file è l'unica fonte di verità per "editabile o no": un
// file .pgnce (Course Editable) si apre pronto per essere modificato, un
// .pgnc "chiuso" forza lo Study mode qualunque cosa dica il suo contenuto —
// così uno studente non può accidentalmente entrare in edit su un corso che
// gli è stato consegnato per essere studiato e basta.
function isEditableFilename(filename) {
    return filename.toLowerCase().endsWith('.pgnce');
}

function onFileChosen(e) {
    const file = e.target.files[0];
    if (!file) return;

    els.error.hidden = true;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const course = parseCourse(String(reader.result));
            course.meta.editable = isEditableFilename(file.name);
            setCourse(course);
            if (onSideChange) onSideChange();
        } catch (err) {
            els.error.textContent = err.message;
            els.error.hidden = false;
        }
    };
    reader.onerror = () => {
        els.error.textContent = 'Could not read the file.';
        els.error.hidden = false;
    };
    reader.readAsText(file);
    e.target.value = '';
}

function onNewCourse() {
    if (!confirm('Start a new, empty course? Anything unsaved will be lost.')) return;
    setCourse(createEmptyCourse());
    if (onSideChange) onSideChange();
}

function onTitleInput() {
    state.course.meta.title = els.title.value;
    notifyChange();
}

function onSideSelect() {
    state.course.meta.side = els.side.value;
    notifyChange();
    if (onSideChange) onSideChange();
}

/**
 * @param {boolean} editable - true: esporta come .pgnce (editabile),
 *        false: esporta come .pgnc "chiuso" per lo studente. Non tocca lo
 *        stato di editing in corso: è solo un flag dentro la COPIA esportata.
 */
function onDownload(editable) {
    const exported = JSON.parse(serializeCourse(state.course));
    exported.meta.editable = editable;

    const json = JSON.stringify(exported, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = (state.course.meta.title || 'course').replace(/[^\w\- ]/g, '').trim() || 'course';

    const a = document.createElement('a');
    a.href = url;
    a.download = filename + (editable ? '.pgnce' : '.pgnc');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function refresh() {
    if (document.activeElement !== els.title) els.title.value = state.course.meta.title || '';
    els.side.value = state.course.meta.side === 'black' ? 'black' : 'white';
    els.editableBadge.textContent = state.course.meta.editable
        ? 'Editable (.pgnce)'
        : 'Locked for students (.pgnc)';
    els.editableBadge.classList.toggle('locked', !state.course.meta.editable);
}
