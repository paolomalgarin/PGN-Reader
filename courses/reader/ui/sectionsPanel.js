import { state, onStateChange, notifyChange } from "../state.js";
import { flattenOutline, createSection, createLine, resolvePath } from "../Course.js";

let container = null;
let onNavigate = null; // iniettata da main.js: (path, index) => void, gestisce anche l'autoplay skip
let addButtons = null;
const collapsed = new Set(); // path.join('.') delle Section chiuse

export function initSectionsPanel(navigateFn) {
    container = document.getElementById('sections-panel');
    onNavigate = navigateFn;
    addButtons = document.getElementById('sections-add-buttons');

    document.getElementById('btn-add-root-section').addEventListener('click', () => {
        state.course.sections.push(createSection('New section'));
        notifyAndRender();
    });
    document.getElementById('btn-add-root-line').addEventListener('click', () => {
        state.course.sections.push(createLine('New line'));
        notifyAndRender();
    });

    onStateChange(render);
    render();
}

function notifyAndRender() {
    // Modifica diretta di state.course: nessun setter dedicato per la
    // struttura dell'outline (sarebbe solo boilerplate) — basta notificare.
    notifyChange();
}

function render() {
    if (!container) return;
    if (addButtons) addButtons.hidden = state.mode !== 'EDIT';
    container.innerHTML = '';

    const entries = flattenOutline(state.course);
    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'outline-empty';
        empty.textContent = 'No sections yet.';
        container.appendChild(empty);
        return;
    }

    let hiddenUnderCollapsedPath = null;

    entries.forEach(entry => {
        const key = entry.path.join('.');

        if (hiddenUnderCollapsedPath && key.startsWith(hiddenUnderCollapsedPath + '.')) return;
        hiddenUnderCollapsedPath = null;

        const row = document.createElement('div');
        row.className = 'outline-row ' + (entry.isLine ? 'outline-line' : 'outline-section');
        row.style.paddingLeft = (entry.depth * 16) + 'px';

        if (!entry.isLine) {
            const isCollapsed = collapsed.has(key);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'outline-toggle';
            toggle.textContent = isCollapsed ? '▸' : '▾';
            toggle.addEventListener('click', () => {
                if (isCollapsed) collapsed.delete(key); else collapsed.add(key);
                render();
            });
            row.appendChild(toggle);
            if (isCollapsed) hiddenUnderCollapsedPath = key;
        } else {
            const bullet = document.createElement('span');
            bullet.className = 'outline-bullet';
            bullet.textContent = '♟';
            row.appendChild(bullet);
        }

        const label = document.createElement('span');
        label.className = 'outline-label';
        label.textContent = entry.node.title || (entry.isLine ? 'Untitled line' : 'Untitled section');
        row.appendChild(label);

        if (entry.isLine && samePath(entry.path, state.currentPath)) {
            row.classList.add('active');
        }

        if (entry.isLine) {
            row.addEventListener('click', () => onNavigate(entry.path, 0));
        }

        if (state.mode === 'EDIT') {
            row.appendChild(buildEditControls(entry));
        }

        container.appendChild(row);
    });
}

function buildEditControls(entry) {
    const box = document.createElement('span');
    box.className = 'outline-edit-controls';

    const siblings = siblingsOf(entry.path);
    const idx = entry.path[entry.path.length - 1];

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'outline-icon-btn';
    up.title = 'Move up';
    up.textContent = '▲';
    up.disabled = idx === 0;
    up.addEventListener('click', (e) => {
        e.stopPropagation();
        reorder(entry.path, -1);
    });
    box.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'outline-icon-btn';
    down.title = 'Move down';
    down.textContent = '▼';
    down.disabled = idx === siblings.length - 1;
    down.addEventListener('click', (e) => {
        e.stopPropagation();
        reorder(entry.path, 1);
    });
    box.appendChild(down);

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'outline-icon-btn';
    rename.title = 'Rename';
    rename.textContent = '✎';
    rename.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = prompt('Title:', entry.node.title || '');
        if (value === null) return;
        entry.node.title = value.trim() || entry.node.title;
        notifyAndRender();
    });
    box.appendChild(rename);

    if (!entry.isLine) {
        const addSection = document.createElement('button');
        addSection.type = 'button';
        addSection.className = 'outline-icon-btn';
        addSection.title = 'Add sub-section';
        addSection.textContent = '+§';
        addSection.addEventListener('click', (e) => {
            e.stopPropagation();
            entry.node.children.push(createSection('New section'));
            notifyAndRender();
        });
        box.appendChild(addSection);

        const addLine = document.createElement('button');
        addLine.type = 'button';
        addLine.className = 'outline-icon-btn';
        addLine.title = 'Add line';
        addLine.textContent = '+♟';
        addLine.addEventListener('click', (e) => {
            e.stopPropagation();
            entry.node.children.push(createLine('New line'));
            notifyAndRender();
        });
        box.appendChild(addLine);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'outline-icon-btn outline-icon-danger';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
        e.stopPropagation();
        const label = entry.isLine ? 'this line' : 'this section and everything inside it';
        if (!confirm(`Delete ${label}?`)) return;
        removeAtPath(entry.path);
        notifyAndRender();
    });
    box.appendChild(del);

    return box;
}

function parentChildrenOf(path) {
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length ? resolvePath(state.course, parentPath) : { children: state.course.sections };
    return parent ? parent.children : null;
}

function siblingsOf(path) {
    return parentChildrenOf(path) || [];
}

/**
 * Scambia il nodo puntato da `path` con quello immediatamente prima (-1) o
 * dopo (+1) tra i suoi fratelli. Niente cambio di livello (non si può
 * "spostare dentro/fuori" una sezione da qui, solo riordinare tra pari) —
 * per spostare qualcosa in un'altra sezione, per ora, cancella e ricrea.
 *
 * @param {number[]} path
 * @param {-1|1} delta
 */
function reorder(path, delta) {
    const siblings = parentChildrenOf(path);
    if (!siblings) return;

    const idx = path[path.length - 1];
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;

    [siblings[idx], siblings[targetIdx]] = [siblings[targetIdx], siblings[idx]];
    notifyAndRender();
}

function removeAtPath(path) {
    const siblings = parentChildrenOf(path);
    if (siblings) siblings.splice(path[path.length - 1], 1);
}

function samePath(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}
