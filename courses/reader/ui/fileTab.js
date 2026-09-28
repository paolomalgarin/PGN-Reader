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
    // Il campo file resta focalizzato dopo la scelta: lo si rilascia così le
    // frecce da tastiera tornano subito a scorrere la linea.
    e.target.blur();
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
    els.side.blur(); // altrimenti le frecce da tastiera cambierebbero l'opzione invece di muovere la linea
}

/**
 * Nome file dal titolo del corso: si tolgono solo i caratteri che nessun
 * filesystem accetta (\ / : * ? " < > | e i caratteri di controllo). Parentesi
 * quadre, accenti, ecc. restano: "Def [ITA]" deve esportarsi come "Def [ITA]".
 */
function safeFilename(title) {
    const cleaned = String(title || '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'course';
}

/**
 * @param {boolean} editable - true: esporta come .pgnce (editabile),
 *        false: esporta come .pgnc "chiuso". Non tocca lo stato in corso: le
 *        modifiche valgono solo per la COPIA esportata.
 *
 * Il progresso (dove si era arrivati) ha senso solo per chi STUDIA: da una
 * sessione editabile si esporta sempre "dall'inizio" (altrimenti il file si
 * aprirebbe sull'ultima mossa scritta), mentre uno studente che salva il suo
 * corso chiuso mantiene il punto raggiunto.
 */
function onDownload(editable) {
    const exported = JSON.parse(serializeCourse(state.course));
    exported.meta.editable = editable;
    if (state.course.meta.editable) {
        exported.progress = { sectionPath: [], moveIndex: 0 };
    }

    const json = JSON.stringify(exported, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename(state.course.meta.title) + (editable ? '.pgnce' : '.pgnc');
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

    // In un corso chiuso lo studente può solo salvare il proprio progresso.
    const locked = !state.course.meta.editable;
    els.btnDownloadEditable.hidden = locked;
    els.btnDownloadStudent.textContent = locked ? 'Save my progress (.pgnc)' : 'Export for students (.pgnc)';
}
