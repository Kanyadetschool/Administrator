/**
 * Kanyadet School App — Photo Upload Backend
 * ─────────────────────────────────────────────────────────────────────
 * Drop this file (and package.json) in the ROOT folder of the project,
 * next to Results.html, Active-Students-Database.html, student_images/, etc.
 *
 * It does two things:
 *   1. Serves the whole root folder as a static site (so Results.html,
 *      student_images/{Grade}/{Name}.jpg etc. all work exactly as before).
 *   2. Exposes POST /api/upload-photo which writes an uploaded photo to
 *      ./student_images/{Grade}/{Name}.jpg — the exact convention the
 *      frontend's resolveStudentPhoto() already expects.
 *
 * Setup:
 *   npm install
 *   node server.js
 *
 * Optional: set UPLOAD_API_KEY in a .env file to require a shared secret
 * on upload/delete requests (recommended once this is live on a public host).
 * If left blank, uploads are unauthenticated — fine for local/LAN use only.
 */

require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.UPLOAD_API_KEY || '';

// Root of the whole project (this file lives at the project root)
const ROOT_DIR           = __dirname;
const STUDENT_IMAGES_DIR = path.join(ROOT_DIR, 'student_images');

if (!fs.existsSync(STUDENT_IMAGES_DIR)) fs.mkdirSync(STUDENT_IMAGES_DIR, { recursive: true });

// ── Seed-on-boot for persistent-disk hosts (Render, etc.) ───────────────
// Render-style platforms wipe the filesystem back to the Git checkout on every
// deploy UNLESS you attach a persistent Disk at this path — and the first time
// you attach a fresh disk, it mounts EMPTY over the folder, hiding any photos
// you already committed to the repo. Commit those existing photos to a sibling
// `student_images_seed/` folder (tracked in Git) instead of `student_images/`
// itself; on first boot with an empty live folder, we copy the seed over once.
// Harmless no-op on hosts with a normal persistent local disk (VPS, your own PC).
function seedIfEmpty(liveDir, seedDir) {
    if (!fs.existsSync(seedDir)) return;
    const isEmpty = fs.readdirSync(liveDir).length === 0;
    if (!isEmpty) return;
    fs.cpSync(seedDir, liveDir, { recursive: true });
    console.log(`🌱 Seeded ${liveDir} from ${seedDir} (first boot on a fresh disk).`);
}
seedIfEmpty(STUDENT_IMAGES_DIR, path.join(ROOT_DIR, 'student_images_seed'));

// ── Multer: receive the file into memory; we process & write it ourselves ──
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB cap
    fileFilter: (req, file, cb) => {
        if (!/^image\//.test(file.mimetype)) return cb(new Error('Only image files are allowed.'));
        cb(null, true);
    }
});

// ── Helpers ─────────────────────────────────────────────────────────────

// Strip anything that could escape the student_images folder or break a filename.
// Deliberately keeps spaces/apostrophes etc. so it matches names like "O'Brien John".
function sanitizeSegment(str) {
    return String(str || '')
        .normalize('NFC')
        .trim()
        .replace(/\.\./g, '')          // no traversal
        .replace(/[\/\\]/g, '')        // no path separators
        .replace(/[\0<>:"|?*]/g, '')   // illegal on Windows/most filesystems
        .trim();
}

// Mirrors the frontend's resolveStudentPhoto() grade-folder logic exactly:
// pull "Grade N" out of whatever grade string is stored, else fall back.
function resolveGradeFolder(grade) {
    const match = String(grade || '').match(/Grade\s*\d+/i);
    const folder = match ? match[0] : sanitizeSegment(grade);
    return folder || 'Unassigned';
}

function checkApiKey(req, res, next) {
    if (!API_KEY) return next(); // auth disabled — no key configured
    if (req.header('x-api-key') !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized — missing or invalid API key.' });
    }
    next();
}

// ── Static site ─────────────────────────────────────────────────────────
app.use(express.static(ROOT_DIR));
app.use(express.json());

// ── Upload endpoint ──────────────────────────────────────────────────────
// multipart/form-data fields: photo (file), name (string), grade (string)
app.post('/api/upload-photo', checkApiKey, upload.single('photo'), async (req, res) => {
    try {
        const name = sanitizeSegment(req.body.name);
        if (!name) return res.status(400).json({ error: 'Student name is required.' });
        if (!req.file) return res.status(400).json({ error: 'No photo file was uploaded.' });

        const gradeFolder = resolveGradeFolder(req.body.grade);
        const targetDir    = path.join(STUDENT_IMAGES_DIR, gradeFolder);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const targetPath = path.join(targetDir, `${name}.jpg`);

        // Defence-in-depth: confirm the resolved path is still inside student_images/
        if (!targetPath.startsWith(STUDENT_IMAGES_DIR)) {
            return res.status(400).json({ error: 'Invalid student name or grade.' });
        }

        // Normalize every upload to a JPEG so it always matches the `${name}.jpg`
        // convention regardless of what format came off the phone/camera (HEIC/PNG/etc),
        // auto-orient using EXIF data, and keep file sizes sane for the table/PDF exports.
        await sharp(req.file.buffer)
            .rotate()
            .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(targetPath);

        const relPath = `./student_images/${gradeFolder}/${name}.jpg`;
        res.json({ success: true, path: relPath });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message || 'Upload failed.' });
    }
});

// ── Optional: delete a student's photo ──────────────────────────────────
app.delete('/api/photo', checkApiKey, (req, res) => {
    try {
        const name = sanitizeSegment(req.query.name);
        if (!name) return res.status(400).json({ error: 'Student name is required.' });
        const gradeFolder = resolveGradeFolder(req.query.grade);
        const targetPath  = path.join(STUDENT_IMAGES_DIR, gradeFolder, `${name}.jpg`);

        if (!targetPath.startsWith(STUDENT_IMAGES_DIR)) {
            return res.status(400).json({ error: 'Invalid student name or grade.' });
        }
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
            return res.json({ success: true, deleted: true });
        }
        res.json({ success: true, deleted: false, message: 'File did not exist.' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: err.message || 'Delete failed.' });
    }
});

// Friendly error message if multer rejects the file (e.g. too large / wrong type)
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message?.includes('image')) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`📁 Serving project root: ${ROOT_DIR}`);
    console.log(`🖼  Student images dir:  ${STUDENT_IMAGES_DIR}`);
    console.log(API_KEY ? '🔒 Upload API key required.' : '⚠️  No UPLOAD_API_KEY set — uploads are unauthenticated.');
});
