/**
 * Student photo loading — same approach as index.html / teachers.html.
 * Looks for photos on disk at Report-Cards/student_images/{Grade}/{Name}.jpg
 * (with a few encoding/casing variants), then falls back to default.jpg.
 *
 * Library system pages live one directory below repo root, so paths use ../
 */

const IMG_CACHE = {};
const DEFAULT_STUDENT_IMAGE = 'images/default-student.png';
const PHOTO_BASES = ['../Report-Cards/student_images', '../student_images'];

function loadImg(src) {
    return new Promise(resolve => {
        if (IMG_CACHE[src] !== undefined) {
            resolve(IMG_CACHE[src]);
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => {
            IMG_CACHE[src] = null;
            resolve(null);
        }, 2500);
        img.onload = () => {
            clearTimeout(timer);
            IMG_CACHE[src] = img.src;
            resolve(img.src);
        };
        img.onerror = () => {
            clearTimeout(timer);
            IMG_CACHE[src] = null;
            resolve(null);
        };
        img.src = src;
    });
}

function resolveStudentFields(nameOrStudent, grade) {
    if (nameOrStudent && typeof nameOrStudent === 'object') {
        const s = nameOrStudent;
        return {
            name: (s.name || s.fullName || s['Official Student Name'] || '').trim(),
            grade: (s.grade || s['Grade'] || '').trim()
        };
    }
    return {
        name: (nameOrStudent || '').trim(),
        grade: (grade || '').trim()
    };
}

async function loadStudentPhoto(name, grade) {
    const g = (grade || '').match(/Grade\s*\d+/i)?.[0] || grade || '';
    const cleanName = (name || '').trim();
    if (!cleanName) {
        const def = await loadImg('../Report-Cards/student_images/default.jpg');
        return def || DEFAULT_STUDENT_IMAGE;
    }

    const encGrade = encodeURIComponent(g);
    const encName = encodeURIComponent(cleanName);
    const paths = [];
    for (const base of PHOTO_BASES) {
        paths.push(
            `${base}/${g}/${cleanName}.jpg`,
            `${base}/${encGrade}/${encName}.jpg`,
            `${base}/${g}/${encName}.jpg`
        );
    }

    for (const p of paths) {
        const src = await loadImg(p);
        if (src) return src;
    }

    const def = await loadImg('../Report-Cards/student_images/default.jpg');
    return def || DEFAULT_STUDENT_IMAGE;
}

function ensurePhotoLightbox() {
    let lb = document.getElementById('student-photo-lightbox');
    if (lb) return lb;

    lb = document.createElement('div');
    lb.id = 'student-photo-lightbox';
    lb.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);align-items:center;justify-content:center;flex-direction:column;gap:12px;cursor:pointer;';
    lb.innerHTML = `
        <div style="position:relative;max-width:90vw;" onclick="event.stopPropagation()">
            <button onclick="closeStudentPhotoLightbox()" title="Close" style="position:absolute;top:-16px;right:-16px;width:34px;height:34px;border-radius:50%;border:none;background:#fff;color:#111;font-size:16px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);z-index:1">✕</button>
            <img id="student-photo-lightbox-img" src="" alt="" style="max-width:100%;max-height:78vh;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);object-fit:contain;background:#fff">
            <div id="student-photo-lightbox-name" style="color:#fff;font-size:14px;font-weight:700;text-align:center"></div>
            <div id="student-photo-lightbox-meta" style="color:rgba(255,255,255,.75);font-size:12px;font-weight:600;text-align:center;letter-spacing:.3px"></div>
        </div>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', closeStudentPhotoLightbox);
    return lb;
}

function openStudentPhotoLightbox(src, name, grade) {
    const lb = ensurePhotoLightbox();
    document.getElementById('student-photo-lightbox-img').src = src;
    document.getElementById('student-photo-lightbox-img').alt = name || '';
    document.getElementById('student-photo-lightbox-name').textContent = name || '';
    document.getElementById('student-photo-lightbox-meta').textContent = grade || '';
    lb.style.display = 'flex';
    document.addEventListener('keydown', photoLightboxEscHandler);
}

function closeStudentPhotoLightbox() {
    const lb = document.getElementById('student-photo-lightbox');
    if (lb) lb.style.display = 'none';
    document.removeEventListener('keydown', photoLightboxEscHandler);
}

function photoLightboxEscHandler(e) {
    if (e.key === 'Escape') closeStudentPhotoLightbox();
}

class StudentImageManager {
    static loadStudentPhoto(name, grade) {
        const { name: resolvedName, grade: resolvedGrade } = resolveStudentFields(name, grade);
        return loadStudentPhoto(resolvedName, resolvedGrade);
    }

    /** @deprecated Use loadStudentPhoto(name, grade) — kept for call-site compatibility */
    static getStudentImage(name, grade) {
        return this.loadStudentPhoto(name, grade);
    }

    static renderStudentImage(name, grade, element, status = '') {
        if (!element) return null;

        const { name: resolvedName, grade: resolvedGrade } = resolveStudentFields(name, grade);

        element.innerHTML = '';

        const img = document.createElement('img');
        img.alt = resolvedName || 'Student Photo';
        img.className = 'student-image';
        img.loading = 'lazy';
        img.src = DEFAULT_STUDENT_IMAGE;
        img.onerror = () => {
            img.src = DEFAULT_STUDENT_IMAGE;
        };

        element.appendChild(img);

        if (status) {
            const statusElement = document.createElement('div');
            statusElement.className = `student-status status-${String(status).toLowerCase().replace(/\s+/g, '-')}`;
            statusElement.textContent = status;
            element.appendChild(statusElement);
        }

        loadStudentPhoto(resolvedName, resolvedGrade).then(src => {
            if (src && element.isConnected) {
                img.src = src;
                img.classList.add('has-photo');
                img.title = (resolvedName ? `${resolvedName} — ` : '') + 'click to view photo';
                img.style.cursor = 'pointer';
                img.onclick = (e) => {
                    e.stopPropagation();
                    openStudentPhotoLightbox(src, resolvedName, resolvedGrade);
                };
            }
        });

        return element;
    }
}

window.StudentImageManager = StudentImageManager;
window.openStudentPhotoLightbox = openStudentPhotoLightbox;
window.closeStudentPhotoLightbox = closeStudentPhotoLightbox;
