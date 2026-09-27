import { state, onStateChange, setCourse, notifyChange } from "../state.js";
import { createEmptyCourse, parseCourse, serializeCourse } from "../Course.js";

let els = {};

export function initFileTab() {
    els = {
        fileInput: document.getElementById('pgnc-file-input'),
        error: document.getElementById('pgnc-import-error'),
        title: document.getElementById('course-title-input'),
        editable: document.getElementById('course-editable-toggle'),
        btnNew: document.getElementById('btn-new-course'),
        btnDownload: document.getElementById('btn-download-pgnc'),
    };

    els.fileInput.addEventListener('change', onFileChosen);
    els.title.addEventListener('input', onTitleInput);
    els.editable.addEventListener('change', onEditableToggle);
    els.btnNew.addEventListener('click', onNewCourse);
    els.btnDownload.addEventListener('click', onDownload);

    onStateChange(refresh);
    refresh();
}

function onFileChosen(e) {
    const file = e.target.files[0];
    if (!file) return;

    els.error.hidden = true;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const course = parseCourse(String(reader.result));
            setCourse(course);
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
}

function onTitleInput() {
    state.course.meta.title = els.title.value;
    notifyChange();
}

function onEditableToggle() {
    state.course.meta.editable = els.editable.checked;
    notifyChange();
}

function onDownload() {
    const json = serializeCourse(state.course);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = (state.course.meta.title || 'course').replace(/[^\w\- ]/g, '').trim() || 'course';

    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.pgnc';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function refresh() {
    if (document.activeElement !== els.title) els.title.value = state.course.meta.title || '';
    els.editable.checked = state.course.meta.editable !== false;
}
