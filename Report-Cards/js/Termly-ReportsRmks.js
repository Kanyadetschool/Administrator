/**
 * upper Primary Automated Remarks and Report Card Generator
 * Advanced Student Missing Data Reporter
 * Enhanced with search, pagination, powerful editing features, and REPORT CARD GENERATION
 */

// ── JsBarcode CDN auto-loader (free library, no API key) ─────────────────
(function loadJsBarcode() {
    if (typeof JsBarcode === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
        s.async = true;
        document.head.appendChild(s);
    }
})();
// ─────────────────────────────────────────────────────────────────────────

// Global variables for Firebase imports and application state
let firebaseImports;
let studentsData = [];
let db;
let auth;
let editingCells = new Map();
let pendingUpdates = new Map();

// Pagination and search state
let currentPage = 1;
let itemsPerPage = 10;
let filteredAndSearchedStudents = [];
let searchQuery = '';

// ── GRADE SELECTION STATE FOR REPORT CARDS ──────────────────────────────────
// Holds the set of full Grade field values the user has selected for report
// card generation (e.g. "Grade 9/2026/MDT1/G9ASO1", "Grade 9-2026-End-Term 1")
// Min 1 selection required. When multiple grades are selected, scores are averaged
// per learning area so each student appears once with combined results.
let selectedGrades = new Set();   // populated by buildGradeSelector()


// Configuration for grade filtering
const GRADE_FILTER_CONFIG = {
    enabled: false,  // Set to false to show all grades
    allowedGrades: ['Grade 7', 'Grade 8', 'Grade 9']  // Modify this array as needed
};

// Report card configuration
const REPORT_CARD_CONFIG = {
    gradeScale: [
        { min: 90, max: 100, grade: '8.0', comment: 'Exceeding Expectation EE1' },
        { min: 75, max: 89, grade: '7.0', comment: 'Exceeding Expectation EE2' },
        { min: 58, max: 74, grade: '6.0', comment: 'Meeting Expectation ME1' },
        { min: 41, max: 57, grade: '5.0', comment: 'Meeting Expectation ME2' },
        { min: 31, max: 40, grade: '4.0', comment: 'Approaching Expectation AE1' },
        { min: 21, max: 30, grade: '3.0', comment: 'Approaching Expectation AE2' },
        { min: 11, max: 20, grade: '2.0', comment: 'Below Expectation BE1' },
        { min:  0, max: 10, grade: '1.0', comment: 'Below Expectation BE2' },
    ]
};


// Fields that are never learning areas — used by getSubjects()
const META_KEYS = new Set([
    'id', 'Term', 'Grade', 'Class', 'Gender', 'UPI',
    'Official Student Name', 'Assessment No', 'Position',
    'Stream', 'Year', 'School', 'Remarks', 'Class Teacher',
    'Opening Date', 'Closing Date', 'Total', 'Average', 'Points', 'Level'
]);

/**
 * Dynamically derive learning areas from a student record.
 * Returns only keys whose values are numeric scores.
 */
function getSubjects(student) {
    if (!student) return [];
    return Object.keys(student).filter(k => {
        if (META_KEYS.has(k)) return false;
        if (k.startsWith('_') || k === 'id') return false;
        const v = student[k];
        if (v === null || v === undefined || v === '') return false;
        return !isNaN(parseFloat(v));
    });
}

// Teacher remarks configuration based on Kenyan CBC system
const TEACHER_REMARKS_CONFIG = {
    ranges: [
        { 
            min: 90, 
            max: 100, 
            remarks: [
                "You have demonstrated exceptional competence across all learning areas this term! Your curiosity, creativity and commitment are a true inspiration. Keep nurturing these wonderful strengths!",
                "Outstanding performance this term! You have shown mastery of key competencies and a deep love for learning. Your positive energy lights up every learning space — keep soaring higher!",
                "What a remarkable term! You have excelled in both knowledge and skills, showing exactly the kind of holistic growth the CBC journey celebrates. We are incredibly proud of you!",
                "You have shown exceptional understanding and application of concepts this term. Your self-drive and enthusiasm are qualities that will carry you far. The best is still ahead of you!",
                "Superb achievement this term! You approached every learning area with passion and determination. You are a wonderful example of what hard work and a positive attitude can achieve!"
            ]
        },
        { 
            min: 75, 
            max: 89, 
            remarks: [
                "Excellent work this term! You have shown strong competence and a genuine love for learning. Keep nurturing your talents and building on this wonderful foundation — great things await you!",
                "You have had a truly impressive term! Your effort, focus and growth mindset are shining through beautifully. Keep pushing forward with confidence — even greater achievements are within your reach!",
                "Well done on a brilliant term! You tackled your learning areas with dedication and resilience. Your commitment to growth is admirable and your progress speaks volumes. Keep it up!",
                "You have demonstrated great skill and understanding this term. Your positive attitude and consistent effort are your greatest assets. Believe in yourself — you are on a wonderful path!",
                "Impressive performance this term! You have shown real mastery and enthusiasm across learning areas. Stay motivated, keep asking questions, and your journey of excellence will only get better!"
            ]
        },
        { 
            min: 58, 
            max: 74, 
            remarks: [
                "Good progress this term! You have shown real effort and growing competence across your learning areas. With continued focus and self-belief, even greater achievements are just around the corner!",
                "You have worked hard this term and your growth is clear to see! Keep nurturing your strengths and facing challenges with courage — the CBC journey rewards those who persist. Keep going!",
                "A solid term of learning and growth! You demonstrated good understanding and a positive attitude. Stay curious, keep practising, and your confidence and skills will continue to blossom beautifully!",
                "Well done on a productive term! You are developing key competencies and showing real determination. Channel your energy and creativity into your studies and wonderful progress will follow next term!",
                "You have shown good effort and commitment this term and that is something to celebrate! Every step forward counts. Keep exploring, keep asking questions, and keep believing in your abilities!"
            ]
        },
        { 
            min: 41, 
            max: 57, 
            remarks: [
                "You have shown real determination and courage this term and that is the foundation of all great learning! With extra practice and the support around you, wonderful improvement is very much on the way!",
                "Every great learner grows at their own pace and you are on your way! You took important steps forward this term. Stay positive, seek help when needed, and bright days are absolutely ahead!",
                "You have so much wonderful potential and this term you have begun to show it! The CBC journey is about growing your whole self — keep nurturing your unique strengths and great things will come!",
                "Your effort and resilience this term are truly commendable! Learning is a journey and you are moving forward. Channel your energy and creativity into your studies and the results will follow!",
                "You are capable of amazing things and we see that in you! This term showed your fighting spirit. Keep nurturing that strength, embrace the support available, and you will shine very brightly!"
            ]
        },
        { 
            min: 31, 
            max: 40, 
            remarks: [
                "We believe in your potential wholeheartedly! This term has been a valuable learning experience and next term is a wonderful fresh opportunity to show the world what you are truly made of. Keep going!",
                "You have unique strengths and talents that are ready to shine! Let this term inspire you to reach out for support, engage actively in class, and watch yourself grow and transform next term!",
                "Every great learner faces challenges and uses them as stepping stones — and you are no different! Use this term as motivation to rise higher. With support and a positive spirit, great things await!",
                "You are stronger and more capable than you realise! This term has built important lessons and resilience in you. Embrace the support of your teachers, stay positive, and a much brighter term is ahead!",
                "We see your potential and we are fully in your corner every step of the way! Let this term fuel your hunger to grow. With the right support, effort and attitude, you will absolutely surprise everyone!"
            ]
        },
        { 
            min: 0, 
            max: 30, 
            remarks: [
                "We care deeply about your success and we see untapped potential in you that is ready to shine! Let next term be your turning point — with support, determination and a fresh start, great change is absolutely possible!",
                "Every learner's journey has its own timeline and yours is just beginning to unfold! You are valued, capable and full of promise. Embrace every opportunity for support and let next term be your wonderful comeback!",
                "You have gifts and strengths that are yet to fully emerge and we have not given up on you — not even close! Let this term inspire a fresh commitment. With courage, support and effort, a much brighter term is within reach!",
                "This term is not the end of your story — it is the beginning of a powerful comeback! You are capable of remarkable growth. Reach out to your teachers, work hard, and next term will show your true and wonderful strength!",
                "We see the very best in you and we know with absolute certainty that you can rise above any challenge! Let this term ignite your determination. With extra effort and the wonderful support around you, amazing progress is on its way!"
            ]
        }
    ]
};


// --- Firebase Configuration ---
const appId = 'default-app-id'; 
const sanitizedAppId = appId.replace(/\./g, '_');
const customFirebaseConfig = {
    apiKey: "AIzaSyA_41WpdMjHJOU5s3gQ9aieIayZRvUoRLE",
    authDomain: "kanyadet-school-admin.firebaseapp.com",
    projectId: "kanyadet-school-admin",
    databaseURL: "https://kanyadet-school-admin-default-rtdb.firebaseio.com",
    storageBucket: "kanyadet-school-admin.firebasestorage.app",
    messagingSenderId: "409708360032",
    appId: "1:409708360032:web:a21d63e8cb5fa1ecabee05",
    measurementId: "G-Y4C0ZRRL52"
};

// --- DOM Elements ---
const gradeFilter = document.getElementById('grade-filter');
const fieldFilter = document.getElementById('field-filter');
const searchInput = document.getElementById('search-input');
const itemsPerPageSelect = document.getElementById('items-per-page');
const tableBody = document.querySelector('#missing-data-table tbody');
const missingFieldHeader = document.getElementById('missing-field-header');
const reportSummary = document.getElementById('report-summary');
const paginationInfo = document.getElementById('pagination-info');
const paginationControls = document.getElementById('pagination-controls');
const loader = document.getElementById('loader');
const signInBtn = document.getElementById('google-sign-in-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const userInfo = document.getElementById('user-info');
const controlsDiv = document.querySelector('.controls');
const printAreaDiv = document.getElementById('print-area');




// Auto-clear on focus for all inputs
searchInput.addEventListener('input', handleSearch);

document.addEventListener('focus', function(e) {
    if (e.target.tagName === 'INPUT' && 
        (e.target.type === 'text' || e.target.type === 'search')) {
        if (e.target.value) {
            e.target.value = '';
            e.target.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
}, true);

// --- Enhanced Notification System ---
const NotificationManager = {
    container: null,
    
    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'notification-container';
            this.container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 400px;
            `;
            document.body.appendChild(this.container);
        }
    },
    
    show(message, type = 'success', duration = 4000) {
        this.init();
        
        const notification = document.createElement('div');
        const id = `notif-${Date.now()}`;
        notification.id = id;
        
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        const colors = {
            success: { bg: '#27ae60', border: '#229954', shadow: 'rgba(39, 174, 96, 0.3)' },
            error: { bg: '#e74c3c', border: '#c0392b', shadow: 'rgba(231, 76, 60, 0.3)' },
            warning: { bg: '#f39c12', border: '#d68910', shadow: 'rgba(243, 156, 18, 0.3)' },
            info: { bg: '#3498db', border: '#2980b9', shadow: 'rgba(52, 152, 219, 0.3)' }
        };
        
        const color = colors[type] || colors.info;
        
        notification.style.cssText = `
            background: linear-gradient(135deg, ${color.bg} 0%, ${color.border} 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            margin-bottom: 12px;
            box-shadow: 0 8px 24px ${color.shadow};
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            border-left: 4px solid ${color.border};
            backdrop-filter: blur(10px);
            cursor: pointer;
            transition: all 0.3s ease;
        `;
        
        notification.innerHTML = `
            <div style="
                font-size: 24px;
                font-weight: bold;
                min-width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 50%;
            ">${icons[type]}</div>
            <div style="flex: 1; font-size: 14px; line-height: 1.5;">${message}</div>
            <div style="
                font-size: 20px;
                opacity: 0.7;
                cursor: pointer;
                padding: 0 4px;
            " onclick="this.parentElement.remove()">×</div>
        `;
        
        notification.onmouseenter = () => {
            notification.style.transform = 'translateX(-4px)';
            notification.style.boxShadow = `0 12px 32px ${color.shadow}`;
        };
        notification.onmouseleave = () => {
            notification.style.transform = 'translateX(0)';
            notification.style.boxShadow = `0 8px 24px ${color.shadow}`;
        };
        
        this.container.insertBefore(notification, this.container.firstChild);
        
        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.4s ease-in-out';
                setTimeout(() => notification.remove(), 400);
            }, duration);
        }
        
        return id;
    },
    
    success(message, duration) {
        return this.show(message, 'success', duration);
    },
    
    error(message, duration) {
        return this.show(message, 'error', duration);
    },
    
    warning(message, duration) {
        return this.show(message, 'warning', duration);
    },
    
    info(message, duration) {
        return this.show(message, 'info', duration);
    }
};

// Add animation styles
if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        @keyframes shimmer {
            0% { background-position: -1000px 0; }
            100% { background-position: 1000px 0; }
        }
    `;
    document.head.appendChild(style);
}

// --- REPORT CARD FUNCTIONS ---

function getGradeFromScore(score) {
    const numScore = parseFloat(score);
    if (isNaN(numScore)) return { grade: 'N/A', comment: 'Not Assessed' };
    
    if (numScore >= 90) return { grade: '8.0', comment: 'Exceeding Expectation EE1' };
    if (numScore >= 75) return { grade: '7.0', comment: 'Exceeding Expectation EE2' };
    if (numScore >= 58) return { grade: '6.0', comment: 'Meeting Expectation ME1' };
    if (numScore >= 41) return { grade: '5.0', comment: 'Meeting Expectation ME2' };
    if (numScore >= 31) return { grade: '4.0', comment: 'Approaching Expectation AE1' };
    if (numScore >= 21) return { grade: '3.0', comment: 'Approaching Expectation AE2' };
    if (numScore >= 11) return { grade: '2.0', comment: 'Below Expectation BE1' };
    return              { grade: '1.0', comment: 'Below Expectation BE2' };
}

function calculateStudentStats(student) {
    const subjects = getSubjects(student);
    const scores = subjects.map(subject => {
        const score = parseFloat(student[subject]);
        return isNaN(score) ? null : score;
    }).filter(s => s !== null);
    
    if (scores.length === 0) {
        return {
            total: 0,
            average: 0,
            grade: 'N/A',
            assessedSubjects: 0,
            maxPossible: 0,
            comment: 'Not Assessed'
        };
    }
    
    const total = scores.reduce((sum, score) => sum + score, 0);
    const average = total / scores.length;
    const gradeInfo = getGradeFromScore(average);

    const totalPoints = subjects
        .map(subj => parseFloat(getGradeFromScore(student[subj]).grade))
        .filter(p => !isNaN(p))
        .reduce((sum, p) => sum + p, 0);
    const maxPoints = scores.length * 8;
    
    return {
        total: total.toFixed(2),
        average: average.toFixed(2),
        grade: gradeInfo.grade,
        comment: gradeInfo.comment,
        assessedSubjects: scores.length,
        maxPossible: scores.length * 100,
        totalPoints: totalPoints.toFixed(1),
        maxPoints
    };
}


function generateTeacherRemark(student) {
    const stats = calculateStudentStats(student);
    const average = parseFloat(stats.average);
    
    if (isNaN(average)) {
        return "Not assessed this term.";
    }
    
    for (let range of TEACHER_REMARKS_CONFIG.ranges) {
        if (average >= range.min && average <= range.max) {
            const randomIndex = Math.floor(Math.random() * range.remarks.length);
            return range.remarks[randomIndex];
        }
    }
    
    return "Keep working hard.";
}


// ═══════════════════════════════════════════════════════════
//  SHARED CBC SUMMARY DRAWER  — COMPACT ONE-PAGE VERSION
//  BOX_H reduced from 62 → 44, all internal Y offsets tightened
// ═══════════════════════════════════════════════════════════
function drawSummary(doc, student, stats) {
    const pageWidth = doc.internal.pageSize.width;
    const subjects  = getSubjects(student);

    // --- derive best / weakest learning area ---
    let best = null, worst = null;
    subjects.forEach(subj => {
        const sc = parseFloat(student[subj]);
        if (isNaN(sc)) return;
        if (!best  || sc > parseFloat(student[best]))  best  = subj;
        if (!worst || sc < parseFloat(student[worst])) worst = subj;
    });

    // --- count subjects per CBC band ---
    let ee = 0, me = 0, ae = 0, be = 0;
    subjects.forEach(subj => {
        const sc = parseFloat(student[subj]);
        if (isNaN(sc)) return;
        if (sc >= 75)      ee++;
        else if (sc >= 58) me++;
        else if (sc >= 31) ae++;
        else               be++;
    });

    // --- colour for performance level ---
    const avg = parseFloat(stats.average);
    let lvlR, lvlG, lvlB;
    if      (avg >= 75) { lvlR = 39;  lvlG = 174; lvlB = 96;  }
    else if (avg >= 58) { lvlR = 41;  lvlG = 128; lvlB = 185; }
    else if (avg >= 31) { lvlR = 243; lvlG = 156; lvlB = 18;  }
    else                { lvlR = 231; lvlG = 76;  lvlB = 60;  }

    const shortCode = stats.comment.match(/\b(EE|ME|AE|BE)\d\b/)?.[0] || '';
    const levelDesc = stats.comment.replace(/\b(EE|ME|AE|BE)\d\b/, '').trim();
    const levelText = shortCode ? `${shortCode}  —  ${levelDesc}` : stats.comment;

    // ── COMPACT: BOX_H reduced from 62 → 44 ──
    const BOX_H = 44;
    const yPos  = doc.lastAutoTable.finalY + 3;  // reduced gap from table (was 5)

    // background + border
    doc.setFillColor(240, 248, 255);
    doc.rect(15, yPos, pageWidth - 30, BOX_H, 'F');
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(0.4);
    doc.rect(15, yPos, pageWidth - 30, BOX_H);

    // coloured left accent bar
    doc.setFillColor(lvlR, lvlG, lvlB);
    doc.rect(15, yPos, 3, BOX_H, 'F');

    // --- TITLE ---
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(41, 128, 185);
    doc.text('OVERALL PERFORMANCE SUMMARY', 22, yPos + 5);

    // divider line
    doc.setDrawColor(200, 220, 240);
    doc.setLineWidth(0.3);
    doc.line(22, yPos + 6.5, pageWidth - 16, yPos + 6.5);

    // --- ROW 1: Mean Score | Total Points ---
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Perc rating', 22, yPos + 12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`${stats.average}%`, 55, yPos + 12);

    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Total Points (CBC):', pageWidth / 2, yPos + 12);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`${stats.totalPoints} / ${stats.maxPoints}`, pageWidth / 2 + 38, yPos + 12);

    // --- ROW 2: Performance Level ---
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(8);
    doc.text('Performance Level:', 22, yPos + 19);

    doc.setFillColor(lvlR, lvlG, lvlB);
    doc.roundedRect(55, yPos + 14.5, pageWidth - 75, 6, 1.2, 1.2, 'F');
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(levelText, pageWidth / 2, yPos + 19, { align: 'center' });

    // divider
    doc.setDrawColor(200, 220, 240);
    doc.setLineWidth(0.3);
    doc.line(22, yPos + 22.5, pageWidth - 16, yPos + 22.5);

    // --- ROW 3: Subjects Assessed | Position ---
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Learning Areas Assessed:', 22, yPos + 28);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`${stats.assessedSubjects}`, 75, yPos + 28);

    doc.setFont(undefined, 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('Position in Class:', pageWidth / 2, yPos + 28);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`${student['Position'] || 'N/A'}`, pageWidth / 2 + 36, yPos + 28);

    // --- ROW 4: Best | Weakest (inline, same row) ---
    if (best || worst) {
        doc.setFont(undefined, 'normal');
        doc.setTextColor(80, 80, 80);
        doc.setFontSize(7.5);
        if (best) {
            doc.text('Best:', 22, yPos + 34);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(39, 174, 96);
            doc.text(`${best}  (${student[best]}%)`, 35, yPos + 34);
        }
        if (worst && worst !== best) {
            doc.setFont(undefined, 'normal');
            doc.setTextColor(80, 80, 80);
            doc.text('Needs Attention:', pageWidth / 2, yPos + 34);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(231, 76, 60);
            doc.text(`${worst}  (${student[worst]}%)`, pageWidth / 2 + 34, yPos + 34);
        }
    }

    // divider
    doc.setDrawColor(200, 220, 240);
    doc.setLineWidth(0.3);
    doc.line(22, yPos + 36.5, pageWidth - 16, yPos + 36.5);

    // --- ROW 5: Band breakdown pills ---
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    const bands = [
        { label: `EE: ${ee}`, r: 39,  g: 174, b: 96  },
        { label: `ME: ${me}`, r: 41,  g: 128, b: 185 },
        { label: `AE: ${ae}`, r: 243, g: 156, b: 18  },
        { label: `BE: ${be}`, r: 231, g: 76,  b: 60  },
    ];
    const bandW = (pageWidth - 44) / 4;
    bands.forEach((band, i) => {
        const bx = 22 + i * bandW;
        doc.setFillColor(band.r, band.g, band.b);
        doc.roundedRect(bx, yPos + 38, bandW - 3, 5, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(band.label, bx + (bandW - 3) / 2, yPos + 42, { align: 'center' });
    });

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(41, 128, 185);
    doc.setLineWidth(0.4);

    return yPos + BOX_H; // caller uses this to know where box ends
}


// ═══════════════════════════════════════════════════════════
// GLOBAL HELPERS
// ═══════════════════════════════════════════════════════════

function extractGrade(gradeString) {
    const match = (gradeString || '').match(/^Grade\s*\d+/i);
    return match ? match[0] : gradeString;
}


// ═══════════════════════════════════════════════════════════
//  MINISTRY OF EDUCATION IMAGE WATERMARK
//  Loads ../images/kenya_ministry_education.png (same folder
//  convention as the HTML file) and stamps it centred on the
//  page at 8 % opacity using jsPDF GState — identical to the
//  approach used in aaResults_final.html.
//  Returns a Promise so callers can await it.
// ═══════════════════════════════════════════════════════════
function _loadMinistryLogo() {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        setTimeout(()  => resolve(null), 3000);
        img.src = './imgs/kenya_ministry_education.png';
    });
}

// Cache so we only load once per session
let _ministryLogoCache = undefined;

async function addMinistryWatermark(doc) {
    // Load & cache the ministry logo on first call
    if (_ministryLogoCache === undefined) {
        _ministryLogoCache = await _loadMinistryLogo();
    }
    const ministryLogoImg = _ministryLogoCache;
    if (!ministryLogoImg) return;   // image unavailable — skip silently

    const pageWidth  = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    try {
        const watermarkSize = 100;                              // mm
        const watermarkX    = (pageWidth  - watermarkSize) / 2;
        const watermarkY    = (pageHeight - watermarkSize) / 2;

        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.08 }));      // 8 % opacity
        doc.addImage(ministryLogoImg, 'PNG', watermarkX, watermarkY, watermarkSize, watermarkSize);
        doc.restoreGraphicsState();
    } catch (e) {
        console.warn('Ministry watermark skipped:', e);
    }
}

function loadImg(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => resolve({ loaded: true,  ok: true,  img });
        img.onerror = () => resolve({ loaded: false, ok: false, img: null });
        setTimeout(()  => resolve({ loaded: false, ok: false, img: null }), 2500);
        img.src = src;
    });
}

async function loadLogo() {
    return loadImg('./imgs/logo.png');
}

async function loadStudentImage(studentName, grade) {
    const g    = extractGrade(grade);
    const name = (studentName || '').trim();
    let r = await loadImg(`./student_images/${g}/${name}.jpg`);
    if (r.loaded) return r;
    r = await loadImg(`./student_images/${g}/${encodeURIComponent(name)}.jpg`);
    if (r.loaded) return r;
    return loadImg('./student_images/default.jpg');
}

function addQrCode(doc, student, x, y, size) {
    const stats = calculateStudentStats(student);
    const subjects = getSubjects(student);
    const subjectLines = subjects.map(subj => {
        const sc = student[subj];
        const gi = getGradeFromScore(sc);
        return `${subj}:${isNaN(parseFloat(sc)) ? 'N/A' : sc}(${gi.grade}pts)`;
    }).join(' ');
    const data = [
        `KANYADET PRI & JUNIOR SCHOOL`,
        `Name:${student['Official Student Name'] || ''}`,
        `Adm:${student['Assessment No'] || ''}`,
        `Grade:${student['Grade'] || ''}  Term:${student['Term'] || ''}`,
        `Results: ${subjectLines}`,
        `Avg:${stats.average}%  Points:${stats.totalPoints}/${stats.maxPoints}`,
        `Level:${stats.comment}`
    ].join(' | ');
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try { doc.addImage(img, 'PNG', x, y, size, size); } catch(e) {}
            resolve();
        };
        img.onerror = () => resolve();
        setTimeout(() => resolve(), 4000);
        img.src = url;
    });
}

// ── Barcode helper (uses free JsBarcode library loaded from CDN) ──────────
// Renders a vertical CODE128 barcode on the left edge of the page
function addBarcode(doc, student, pageHeight) {
    try {
        const barcodeValue = student['UPI'] || student['Assessment No'] || 'KANYADET';
        if (typeof JsBarcode === 'undefined') return;
        const cvs = document.createElement('canvas');
        JsBarcode(cvs, String(barcodeValue), {
            format: 'CODE128', width: 1.8, height: 55,
            displayValue: false, background: '#ffffff',
            lineColor: '#1a1a1a', margin: 4,
        });
        const rotCanvas = document.createElement('canvas');
        rotCanvas.width  = cvs.height;
        rotCanvas.height = cvs.width;
        const ctx = rotCanvas.getContext('2d');
        ctx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(cvs, -cvs.width / 2, -cvs.height / 2);
        const bcDataURL = rotCanvas.toDataURL('image/png');
        const bcW = 10, bcH = 52;
        const bcX = 1;
        const bcY = pageHeight / 2 - bcH / 2;
        doc.addImage(bcDataURL, 'PNG', bcX, bcY, bcW, bcH);
        doc.setFontSize(5);
        doc.setTextColor(140, 140, 140);
        doc.text(String(barcodeValue), bcX + bcW + 2.5, bcY + bcH / 2, { angle: 90, align: 'center' });
    } catch (e) { console.warn('Barcode add failed:', e); }
}
// ─────────────────────────────────────────────────────────────────────────

// ─── SHARED: draw remarks + parent ack + signatures + QR safely ──────────
// COMPACT VERSION: tighter spacing throughout
async function drawBottomSection(d, yPos, student, pageWidth, pageHeight) {
    const FOOTER_TOP    = pageHeight - 38;
    const SIG_Y         = pageHeight - 20;
    const FOOTER_TEXT_Y = pageHeight - 5;
    const BOTTOM_SAFE   = FOOTER_TOP - 4;

    // Teacher remarks — auto-generated CBC remark printed on the report card
    d.setFont(undefined, 'bold'); d.setFontSize(9);
    d.setTextColor(0, 0, 0);
    d.text('CLASS TEACHER REMARKS', 20, yPos);

    // Generate and print the automated CBC remark
    const autoRemark = generateTeacherRemark(student);
    // Remark box: leave right margin clear for QR code (QR sits at pageWidth-26, width 20)
    const remarkBoxX = 15;
    const remarkBoxW = pageWidth - 30 - 8;    // stop just before QR code area
    const remarkBoxY = yPos + 3;
    const remarkBoxH = 18;                    // slightly taller for 3 lines

    // Remark text — no background or border, just italic text
    d.setFont(undefined, 'italic'); d.setFontSize(7.5);
    d.setTextColor(30, 60, 100);
    const wrappedRemark = d.splitTextToSize(autoRemark, remarkBoxW - 9);
    // Print up to 3 lines
    wrappedRemark.slice(0, 3).forEach((line, i) => {
        d.text(line, remarkBoxX + 5, remarkBoxY + 5.5 + i * 4.5);
    });

    d.setTextColor(0, 0, 0);
    d.setFont(undefined, 'normal');
    d.setDrawColor(200, 200, 200);
    d.setLineWidth(0.3);

    let remarkY = yPos + 22;

    // // Parent acknowledgement
    // d.setFontSize(7.5); d.setFont(undefined,'bold'); d.setTextColor(0,0,0);
    // d.text('Parent/Guardian Acknowledgement:', 20, FOOTER_TOP);
    // d.setFont(undefined,'normal');
    // d.line(78, FOOTER_TOP, pageWidth - 20, FOOTER_TOP);
    // d.setFontSize(6.5); d.setTextColor(100,100,100);
    // d.text('Signature: ____________________   Date: ________________   Contact: ____________________',
    //     20, FOOTER_TOP + 4.5);

    // Signatures
    d.setFontSize(8.5); d.setFont(undefined,'bold'); d.setTextColor(0,0,0);
    d.text('Class Teacher:', 20, SIG_Y);
    d.line(20, SIG_Y + 4, 80, SIG_Y + 4);
    d.setFontSize(6.5); d.setFont(undefined,'normal');
    d.text('Signature & Date', 20, SIG_Y + 8);

    d.setFontSize(8.5); d.setFont(undefined,'bold');
    d.text('Head Teacher:', pageWidth / 2 + 20, SIG_Y);
    d.line(pageWidth/2 + 20, SIG_Y + 4, pageWidth/2 + 65, SIG_Y + 4);
    d.setFontSize(6.5); d.setFont(undefined,'normal');
    d.text('Signature & Stamp', pageWidth / 2 + 20, SIG_Y + 8);

    // Footer text
    d.setFontSize(6.5); d.setTextColor(128,128,128);
    d.text(`Generated: ${new Date().toLocaleDateString()}  |  https://kanyadet-school-portal.web.app/`,
        pageWidth / 2, FOOTER_TEXT_Y, { align: 'center' });

    // QR code — bottom-right corner
    await addQrCode(d, student, pageWidth - 26, SIG_Y - 10, 20);  // slightly smaller QR

    // Vertical barcode — left edge, middle of page
    addBarcode(d, student, pageHeight);
}

// ═══════════════════════════════════════════════════════════
//  SINGLE REPORT CARD — COMPACT ONE-PAGE LAYOUT
// ═══════════════════════════════════════════════════════════
async function generateStudentReportCard(student, includeWatermark = true) {
    if (!window.jspdf) {
        alert('PDF library not loaded. Please refresh the page.');
        return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('portrait');
    const pageWidth  = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const stats = calculateStudentStats(student);

    const [logoRes, studentImageData] = await Promise.all([
        loadLogo(),
        loadStudentImage(student['Official Student Name'], student['Grade'])
    ]);

    // Header
    doc.setFillColor(41, 128, 185);
    doc.rect(0, 0, pageWidth, 35, 'F');
    if (logoRes.loaded) {
        try { doc.addImage(logoRes.img, 'PNG', 15, 5, 25, 25); } catch(e) {}
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('KANYADET PRI & JUNIOR SCHOOL', pageWidth / 2, 10, { align: 'center' });
    doc.setFontSize(12);
    doc.text('P O BOX 45 40139 AKALA,KENYA', pageWidth / 2, 16, { align: 'center' });
    doc.text('STUDENT PERFORMANCE REPORT', pageWidth / 2, 22, { align: 'center' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    const _termLabel1 = [...selectedGrades].join(' + ');
    doc.text(`${_termLabel1}  |  Academic Year: ${new Date().getFullYear()}`,
        pageWidth / 2, 30, { align: 'center' });

    // Student info section
    let yPos = 45;
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(240, 240, 240);
    doc.rect(15, yPos, pageWidth - 30, 40, 'F');

    if (studentImageData.loaded) {
        try {
            const imgW = 30, imgH = 35;
            doc.addImage(studentImageData.img, 'JPEG', pageWidth - 20 - imgW, yPos + 2.5, imgW, imgH);
        } catch(e) {}
    }

    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('STUDENT INFORMATION', 20, yPos + 8);
    doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    const studentInfo = [
        [`Name: ${student['Official Student Name'] || 'N/A'}`, `Assessment No: ${student['Assessment No'] || 'N/A'}`],
        [`UPI: ${student['UPI'] || 'N/A'}`, `${student['Grade'] || 'N/A'}`],
        [`Gender: ${student['Gender'] || 'N/A'}`, `Class: ${student['Class'] || 'N/A'}`]
    ];
    let infoY = yPos + 16;
    studentInfo.forEach(([left, right]) => {
        doc.text(left, 20, infoY);
        doc.text(right, pageWidth / 2 + 5, infoY);
        infoY += 7;
    });

    // Academic performance table
    yPos = 95;
    doc.setFont(undefined, 'bold'); doc.setFontSize(11);
    doc.text('ACADEMIC PERFORMANCE', 20, yPos);
    // Closing / Opening date — same line, right-aligned, auto-picked from DB
    doc.setFont(undefined, 'bold'); doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const _closingDate = student['Closing Date'] || student['Closing'] || '...............';
    const _openingDate = student['Opening Date'] || student['Opening'] || '...............';
    doc.text(`CLOSING: ${_closingDate}   OPENING: ${_openingDate}`, pageWidth - 15, yPos, { align: 'right' });

    const tableData = [];
    getSubjects(student).forEach(subject => {
        const score = student[subject];
        const numScore = parseFloat(score);
        const gradeInfo = getGradeFromScore(score);
        tableData.push([
            subject,
            isNaN(numScore) ? 'Not Assessed' : numScore.toString(),
            gradeInfo.grade,
            gradeInfo.comment
        ]);
    });

    const headers = [['Learning Area', 'Score', 'Points', 'Comment']];
    doc.autoTable({
        head: headers, body: tableData,
        startY: yPos + 5,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [41,128,185], textColor: [255,255,255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245,245,245] },
        columnStyles: { 0:{cellWidth:60}, 1:{cellWidth:30}, 2:{cellWidth:30}, 3:{cellWidth:60} }
    });

    // Summary (compact box)
    const summaryBottom = drawSummary(doc, student, stats);
    yPos = summaryBottom;

    // Remarks + parent ack + signatures + QR
    await drawBottomSection(doc, summaryBottom + 4, student, pageWidth, pageHeight);  // gap reduced from +6

    // Ministry of Education image watermark (centred, 8% opacity)
    if (includeWatermark !== false) {
        await addMinistryWatermark(doc);
    }

    return doc;
}


// ═══════════════════════════════════════════════════════════
//  MULTI-TERM REPORT PAGE RENDERER
//  Draws one report card page merging scores from multiple
//  selected grade nodes for a single student (matched by Adm No).
//  - Grade chip labels & report header = raw DB Grade field values
//  - Last column = Avg across selected grades + CBC Rubric code
//  - Summary box = full drawSummary approach on averaged scores
// ═══════════════════════════════════════════════════════════
async function _drawMultiTermReportPage(doc, mergedStudent, logoRes, studentImageData, pageWidth, pageHeight) {
    const gradeList   = [...selectedGrades];
    // ── Use raw DB Grade values as labels ─────────────────────
    const gradeLabels = gradeList.map(g => g);   // exact DB string
    const termHeader  = gradeLabels.join('  |  ');

    // ── HEADER ──────────────────────────────────────────────
    doc.setFillColor(41, 128, 185);
    doc.rect(0, 0, pageWidth, 38, 'F');
    if (logoRes && logoRes.loaded) {
        try { doc.addImage(logoRes.img, 'PNG', 15, 5, 25, 25); } catch(e) {}
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17); doc.setFont(undefined, 'bold');
    doc.text('KANYADET PRI & JUNIOR SCHOOL', pageWidth / 2, 10, { align: 'center' });
    doc.setFontSize(11);
    doc.text('P O BOX 45 40139 AKALA, KENYA', pageWidth / 2, 17, { align: 'center' });
    doc.text('STUDENT PERFORMANCE REPORT', pageWidth / 2, 23, { align: 'center' });
    // Show each selected DB grade on its own line if needed
    doc.setFontSize(7); doc.setFont(undefined, 'normal');
    const hLines = gradeLabels.length > 2
        ? [gradeLabels.slice(0,2).join('  |  '), gradeLabels[2] + `  |  ${new Date().getFullYear()}`]
        : [termHeader + `  |  ${new Date().getFullYear()}`];
    hLines.forEach((line, i) => doc.text(line, pageWidth / 2, 30 + i * 5, { align: 'center' }));

    // ── STUDENT INFO ─────────────────────────────────────────
    let yPos = 38 + hLines.length * 2;
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(240, 240, 240);
    doc.rect(15, yPos, pageWidth - 30, 34, 'F');
    if (studentImageData && studentImageData.loaded) {
        try { doc.addImage(studentImageData.img, 'JPEG', pageWidth - 50, yPos + 2, 30, 30); } catch(e) {}
    }
    doc.setFontSize(9); doc.setFont(undefined, 'bold');
    doc.text('STUDENT INFORMATION', 20, yPos + 7);
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.5);
    // Pick dates from the LAST selected grade (most recent term)
    const lastGrade  = gradeList[gradeList.length - 1];
    const lastRec    = mergedStudent[`__grade_${lastGrade}`] || mergedStudent;
    const baseRec    = gradeList.map(g => mergedStudent[`__grade_${g}`]).find(Boolean) || mergedStudent;
    const closingDate  = lastRec['Closing Date']  || lastRec['Closing']  || '...............';
    const openingDate  = lastRec['Opening Date']  || lastRec['Opening']  || '...............';
    const infoRows = [
        [`Name: ${mergedStudent['Official Student Name'] || 'N/A'}`,   `Assessment No: ${mergedStudent['Assessment No'] || 'N/A'}`],
        [`UPI:  ${mergedStudent['UPI'] || 'N/A'}`,                     `Gender: ${mergedStudent['Gender'] || 'N/A'}`],
        [`Class: ${baseRec['Class'] || mergedStudent['Class'] || 'N/A'}`, ``],
    ];
    let iy = yPos + 14;
    infoRows.forEach(([l, r]) => {
        doc.text(l, 20, iy);
        if (r) doc.text(r, pageWidth / 2 - 5, iy);
        iy += 7;
    });

    // ── PERFORMANCE TABLE ────────────────────────────────────
    yPos = iy + 5;
    doc.setFont(undefined, 'bold'); doc.setFontSize(10);
    doc.text('ACADEMIC PERFORMANCE', 20, yPos);
    // Closing / Opening date — same line, right-aligned
    doc.setFont(undefined, 'bold'); doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(`CLOSING: ${closingDate}   OPENING: ${openingDate}`, pageWidth - 15, yPos, { align: 'right' });
    yPos += 4;

    // Collect all subjects across all selected grades (union, ordered by first appearance)
    const allSubjects = [];
    gradeList.forEach(g => {
        const rec = mergedStudent[`__grade_${g}`];
        if (rec) getSubjects(rec).forEach(s => { if (!allSubjects.includes(s)) allSubjects.push(s); });
    });

    // Table header:  Learning Area | [Grade DB Name Score] | [Grade DB Name Score] | … | Avg | Rubric
    const headRow = ['Learning Area'];
    gradeLabels.forEach(lbl => headRow.push(lbl));    // one score column per grade (raw DB name)
    headRow.push('Average');
    headRow.push('Rubric');

    const bodyRows = allSubjects.map(subj => {
        const row = [subj];
        const validScores = [];
        gradeList.forEach(g => {
            const rec = mergedStudent[`__grade_${g}`];
            const raw = rec ? rec[subj] : undefined;
            const num = parseFloat(raw);
            if (!isNaN(num)) { validScores.push(num); row.push(num.toString()); }
            else              { row.push('N/A'); }
        });
        // Average across selected grades for this subject
        if (validScores.length > 0) {
            const avg = validScores.reduce((a,b)=>a+b,0) / validScores.length;
            const rubric = getGradeFromScore(avg);
            // Short rubric code: EE1, EE2, ME1, ME2, AE1, AE2, BE1, BE2
            const code = rubric.comment.match(/\b(EE|ME|AE|BE)\d\b/)?.[0] || rubric.comment.substring(0,4);
            row.push(avg.toFixed(1));
            row.push(code);
        } else {
            row.push('N/A');
            row.push('-');
        }
        return row;
    });

    // Column widths: subject | one per grade | avg | rubric
    const subjectW  = 42;
    const rubricW   = 14;
    const avgW      = 14;
    const remaining = pageWidth - 30 - subjectW - rubricW - avgW;
    const scoreW    = remaining / gradeList.length;
    const colStyles = { 0: { cellWidth: subjectW } };
    gradeList.forEach((_, i) => { colStyles[1 + i] = { cellWidth: scoreW, halign: 'center' }; });
    colStyles[1 + gradeList.length]     = { cellWidth: avgW,    halign: 'center' };
    colStyles[1 + gradeList.length + 1] = { cellWidth: rubricW, halign: 'center' };

    doc.autoTable({
        head: [headRow],
        body: bodyRows,
        startY: yPos + 2,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 7.5, cellPadding: 1.8, overflow: 'linebreak' },
        headStyles: { fillColor: [41,128,185], textColor: [255,255,255], fontStyle: 'bold', fontSize: 6.5, halign: 'center' },
        alternateRowStyles: { fillColor: [245,245,245] },
        columnStyles: colStyles,
        didParseCell(data) {
            if (data.section === 'body' && data.column.index >= 1) {
                const v = parseFloat(data.cell.raw);
                if (!isNaN(v)) {
                    let r,g,b;
                    if      (v >= 75) { r=39; g=174; b=96;  }
                    else if (v >= 58) { r=41; g=128; b=185; }
                    else if (v >= 31) { r=243;g=156; b=18;  }
                    else              { r=231;g=76;  b=60;  }
                    data.cell.styles.textColor = [r,g,b];
                    data.cell.styles.fontStyle = 'bold';
                }
                // Rubric column — colour the code text
                if (data.column.index === 1 + gradeList.length + 1) {
                    const code = String(data.cell.raw||'');
                    if      (code.startsWith('EE')) data.cell.styles.textColor = [39,174,96];
                    else if (code.startsWith('ME')) data.cell.styles.textColor = [41,128,185];
                    else if (code.startsWith('AE')) data.cell.styles.textColor = [243,156,18];
                    else if (code.startsWith('BE')) data.cell.styles.textColor = [231,76,60];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        }
    });

    const tableEndY = doc.lastAutoTable.finalY;

    // ── PERFORMANCE CHART ────────────────────────────────────
    const chartEndY = _drawPerformanceChart(doc, mergedStudent, allSubjects, gradeList, tableEndY + 4, pageWidth);

    return chartEndY;
}

// ═══════════════════════════════════════════════════════════
//  PERFORMANCE BAR + LINE CHART
//  Drawn with pure jsPDF primitives — no extra library needed.
//  For each subject: one bar per selected grade, coloured by
//  CBC band. A dashed line connects the average scores.
//  Compact height: ~52mm so it fits on the page.
// ═══════════════════════════════════════════════════════════
function _drawPerformanceChart(doc, mergedStudent, allSubjects, gradeList, startY, pageWidth) {
    if (!allSubjects.length) return startY;

    // ── layout constants ──────────────────────────────────────
    const CHART_L    = 22;                          // left margin
    const CHART_R    = pageWidth - 18;              // right margin
    const CHART_W    = CHART_R - CHART_L;
    const CHART_H    = 34;                          // total chart height (mm)
    const LABEL_H    = 10;                          // bottom subject label area
    const LEGEND_H   = 6;                           // top legend area
    const PLOT_TOP   = startY + LEGEND_H + 4;       // top of plot area
    const PLOT_BOT   = PLOT_TOP + CHART_H - LABEL_H;
    const PLOT_H     = PLOT_BOT - PLOT_TOP;         // actual bar plot height

    // ── CBC band colour helper ────────────────────────────────
    function bandColor(v) {
        if (v >= 75) return [39,174,96];
        if (v >= 58) return [41,128,185];
        if (v >= 31) return [243,156,18];
        return [231,76,60];
    }

    // ── background + border ───────────────────────────────────
    doc.setFillColor(248, 250, 255);
    doc.rect(CHART_L - 4, startY, CHART_W + 8, CHART_H + LEGEND_H + 2, 'F');
    doc.setDrawColor(180, 210, 240); doc.setLineWidth(0.3);
    doc.rect(CHART_L - 4, startY, CHART_W + 8, CHART_H + LEGEND_H + 2);

    // ── chart title ───────────────────────────────────────────
    doc.setFontSize(7.5); doc.setFont(undefined, 'bold');
    doc.setTextColor(41,128,185);
    doc.text('PERFORMANCE TREND CHART', CHART_L, startY + 4);

    // ── legend ────────────────────────────────────────────────
    const legendColors = [[39,174,96],[41,128,185],[243,156,18]];
    gradeList.forEach((g, i) => {
        const lx = CHART_L + 50 + i * 48;
        const ly = startY + 3;
        const [r,gv,b] = legendColors[i % legendColors.length];
        doc.setFillColor(r,gv,b);
        doc.rect(lx, ly - 2.5, 4, 3, 'F');
        doc.setFontSize(5.5); doc.setFont(undefined, 'normal');
        doc.setTextColor(60,60,60);
        // Truncate long DB names for legend
        const short = g.length > 22 ? g.substring(0,20)+'…' : g;
        doc.text(short, lx + 5, ly);
    });
    // Average line legend
    const avgLx = CHART_L + 50 + gradeList.length * 48;
    doc.setDrawColor(80,80,80); doc.setLineWidth(0.5);
    doc.setLineDash([1,0.8], 0);
    doc.line(avgLx, startY + 1.5, avgLx + 6, startY + 1.5);
    doc.setLineDash([], 0);
    doc.setFontSize(5.5); doc.setTextColor(60,60,60);
    doc.text('Average', avgLx + 7, startY + 3);

    // ── horizontal grid lines at 25%, 50%, 75%, 100% ─────────
    doc.setDrawColor(210,220,235); doc.setLineWidth(0.2);
    [25,50,75,100].forEach(v => {
        const gy = PLOT_BOT - (v / 100) * PLOT_H;
        doc.line(CHART_L, gy, CHART_R, gy);
        doc.setFontSize(5); doc.setTextColor(160,160,160);
        doc.text(`${v}`, CHART_L - 6, gy + 1, { align: 'right' });
    });

    // ── axes ──────────────────────────────────────────────────
    doc.setDrawColor(100,130,160); doc.setLineWidth(0.4);
    doc.line(CHART_L, PLOT_TOP, CHART_L, PLOT_BOT);     // Y-axis
    doc.line(CHART_L, PLOT_BOT, CHART_R, PLOT_BOT);     // X-axis

    // ── bars + average line ───────────────────────────────────
    const n         = allSubjects.length;
    const groupW    = CHART_W / n;
    const barW      = Math.min((groupW / (gradeList.length + 1)) * 0.85, 8);
    const groupPad  = (groupW - barW * gradeList.length) / 2;

    const avgPoints = [];    // collect (cx, cy) for dashed avg line

    allSubjects.forEach((subj, si) => {
        const gx   = CHART_L + si * groupW;
        const cx   = gx + groupW / 2;   // center of group

        const validScores = [];
        gradeList.forEach((g, gi) => {
            const rec = mergedStudent[`__grade_${g}`];
            const v   = rec ? parseFloat(rec[subj]) : NaN;
            if (isNaN(v)) return;
            validScores.push(v);

            const barX = gx + groupPad + gi * barW;
            const barH = (v / 100) * PLOT_H;
            const barY = PLOT_BOT - barH;
            const [r,gv,b] = legendColors[gi % legendColors.length];

            // Bar fill — semi-transparent look via lighter shade first
            doc.setFillColor(
                Math.min(255, r + 60),
                Math.min(255, gv + 60),
                Math.min(255, b + 60)
            );
            doc.rect(barX, barY, barW, barH, 'F');
            // Bar border in full colour
            doc.setDrawColor(r,gv,b); doc.setLineWidth(0.3);
            doc.rect(barX, barY, barW, barH);

            // Score label on top of bar if bar tall enough
            if (barH > 5) {
                doc.setFontSize(4.5); doc.setFont(undefined,'bold');
                doc.setTextColor(r,gv,b);
                doc.text(`${v}`, barX + barW/2, barY - 1, { align:'center' });
            }
        });

        // Average point for this subject
        if (validScores.length > 0) {
            const avg = validScores.reduce((a,b)=>a+b,0) / validScores.length;
            const ay  = PLOT_BOT - (avg / 100) * PLOT_H;
            avgPoints.push({ x: cx, y: ay, avg });
        }

        // Subject label on X-axis — short name
        doc.setFontSize(4.8); doc.setFont(undefined,'normal');
        doc.setTextColor(50,50,50);
        const shortSubj = subj.length > 10 ? subj.substring(0,9)+'.' : subj;
        doc.text(shortSubj, cx, PLOT_BOT + 4, { align:'center' });
    });

    // ── dashed average trend line ─────────────────────────────
    if (avgPoints.length > 1) {
        doc.setDrawColor(60,60,60); doc.setLineWidth(0.6);
        doc.setLineDash([1.2,0.8], 0);
        for (let i = 1; i < avgPoints.length; i++) {
            doc.line(avgPoints[i-1].x, avgPoints[i-1].y, avgPoints[i].x, avgPoints[i].y);
        }
        doc.setLineDash([], 0);

        // Average dots + value labels
        avgPoints.forEach(({ x, y, avg }) => {
            const [r,gv,b] = bandColor(avg);
            doc.setFillColor(r,gv,b);
            doc.ellipse(x, y, 1.2, 1.2, 'F');
            doc.setFontSize(4.5); doc.setFont(undefined,'bold');
            doc.setTextColor(r,gv,b);
            doc.text(`${avg.toFixed(0)}`, x, y - 2.2, { align:'center' });
        });
    }

    doc.setTextColor(0,0,0); doc.setFont(undefined,'normal');
    doc.setLineDash([], 0);

    return PLOT_BOT + LABEL_H + 2;   // return Y position after chart
}

// ═══════════════════════════════════════════════════════════
//  BUILD AVERAGED STUDENT RECORD
//  Creates a synthetic student object where each subject's
//  score is the average across all selected grade nodes.
//  Used to feed drawSummary() for the multi-term overview.
// ═══════════════════════════════════════════════════════════
function _buildAveragedStudent(mergedStudent) {
    const gradeList = [...selectedGrades];

    // Collect all subjects
    const allSubjects = [];
    gradeList.forEach(g => {
        const rec = mergedStudent[`__grade_${g}`];
        if (rec) getSubjects(rec).forEach(s => { if (!allSubjects.includes(s)) allSubjects.push(s); });
    });

    // Base record — copy meta fields from first available grade record
    const base = gradeList.map(g => mergedStudent[`__grade_${g}`]).find(Boolean) || {};
    const averaged = {
        ...base,
        id:                        mergedStudent.id,
        'Assessment No':           mergedStudent['Assessment No'],
        'Official Student Name':   mergedStudent['Official Student Name'],
        'UPI':                     mergedStudent['UPI'],
        'Gender':                  mergedStudent['Gender'],
        'Grade':                   mergedStudent['Grade'],
        'Class':                   mergedStudent['Class'],
    };

    // For each subject, compute average score across all selected grades
    allSubjects.forEach(subj => {
        const vals = gradeList
            .map(g => { const rec = mergedStudent[`__grade_${g}`]; return rec ? parseFloat(rec[subj]) : NaN; })
            .filter(v => !isNaN(v));
        averaged[subj] = vals.length > 0
            ? parseFloat((vals.reduce((a,b)=>a+b,0) / vals.length).toFixed(2))
            : null;
    });

    return averaged;
}

// ═══════════════════════════════════════════════════════════
//  MULTI-TERM SUMMARY — uses full drawSummary approach
//  but computed on averaged scores across all selected grades
// ═══════════════════════════════════════════════════════════
function _drawMultiTermSummary(doc, mergedStudent, tableEndY, pageWidth) {
    // Build a synthetic student with averaged scores, then run drawSummary on it
    const avgStudent = _buildAveragedStudent(mergedStudent);
    const avgStats   = calculateStudentStats(avgStudent);

    // Temporarily patch lastAutoTable.finalY so drawSummary positions itself correctly
    const origFinalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : tableEndY;
    if (doc.lastAutoTable) doc.lastAutoTable.finalY = tableEndY;

    const summaryBottom = drawSummary(doc, avgStudent, avgStats);

    // Restore
    if (doc.lastAutoTable) doc.lastAutoTable.finalY = origFinalY;

    return summaryBottom;
}


// ═══════════════════════════════════════════════════════════
//  BULK REPORT CARDS — multi-term merged layout
// ═══════════════════════════════════════════════════════════
async function generateBulkReportCards() {
    if (selectedGrades.size < 1) {
        NotificationManager.warning(
            '⚠️ Please select <strong>at least 1 grade</strong> in the Grade Selector above before generating report cards.',
            4000
        );
        return;
    }

    // Single-grade path: use original single-term report card generator
    if (selectedGrades.size === 1) {
        const gradeVal = [...selectedGrades][0];
        const pool = studentsData.filter(s => s['Grade'] === gradeVal);
        if (pool.length === 0) {
            NotificationManager.warning('No students found for the selected grade.');
            return;
        }
        const progressNotif = NotificationManager.info(
            `Generating <strong>${pool.length}</strong> single-term report cards (${gradeVal})...<br/>` +
            `<div style="width:100%;background:rgba(255,255,255,0.3);height:8px;border-radius:4px;margin-top:8px;">` +
            `<div id="bulk-progress" style="width:0%;background:white;height:100%;border-radius:4px;transition:width 0.3s;"></div></div>`,
            0
        );
        try {
            const { jsPDF } = window.jspdf;
            const combinedDoc = new jsPDF('portrait');
            let isFirstPage = true;
            for (let i = 0; i < pool.length; i++) {
                const student = pool[i];
                const progress = ((i + 1) / pool.length * 100).toFixed(0);
                const pb = document.getElementById('bulk-progress');
                if (pb) pb.style.width = `${progress}%`;
                if (!isFirstPage) combinedDoc.addPage();
                const tempDoc = await generateStudentReportCard(student, false);
                if (tempDoc) {
                    // merge pages from tempDoc into combinedDoc
                    const totalP = tempDoc.internal.getNumberOfPages();
                    for (let p = 1; p <= totalP; p++) {
                        if (!isFirstPage || p > 1) combinedDoc.addPage();
                        // Re-render by drawing on combinedDoc directly
                    }
                }
                // Simpler: just regenerate directly on combinedDoc
                // Use _drawCompactReportPage approach
                const pw = combinedDoc.internal.pageSize.width;
                const ph = combinedDoc.internal.pageSize.height;
                const logoRes = await loadLogo();
                const studentImageData = await loadStudentImage(student['Official Student Name'], student['Grade']);
                const stats = calculateStudentStats(student);
                if (!isFirstPage) { /* already added page */ } 
                _drawCompactReportPage(combinedDoc, student, stats, studentImageData, logoRes, pw, ph);
                const summaryBottom = drawSummary(combinedDoc, student, stats);
                await drawBottomSection(combinedDoc, summaryBottom + 4, student, pw, ph);
                await addMinistryWatermark(combinedDoc);
                isFirstPage = false;
                await new Promise(r => setTimeout(r, 50));
            }
            const filename = `Report_Cards_${gradeVal.replace(/\s+/g,'')}_${new Date().toISOString().split('T')[0]}.pdf`;
            combinedDoc.save(filename);
            document.getElementById(progressNotif)?.remove();
            NotificationManager.success(
                `<strong>Report Cards Complete!</strong><br/>${pool.length} students · ${gradeVal}<br/><span style="font-size:11px;">${filename}</span>`,
                5000
            );
        } catch (error) {
            console.error('Bulk generation error:', error);
            document.getElementById(progressNotif)?.remove();
            NotificationManager.error(`Generation failed: ${error.message}`);
        }
        return;
    }

    // Multi-grade path
    const mergedStudents = getMergedStudents();

    if (mergedStudents.length === 0) {
        NotificationManager.warning('No students matched across the selected grade nodes. Check that Assessment Numbers are consistent.');
        return;
    }

    const gradeLabels = [...selectedGrades];
    const termHeader  = gradeLabels.join(' + ');

    const progressNotif = NotificationManager.info(
        `Generating <strong>${mergedStudents.length}</strong> multi-term report cards (${termHeader})...<br/>` +
        `<div style="width:100%;background:rgba(255,255,255,0.3);height:8px;border-radius:4px;margin-top:8px;">` +
        `<div id="bulk-progress" style="width:0%;background:white;height:100%;border-radius:4px;transition:width 0.3s;"></div></div>`,
        0
    );

    try {
        const { jsPDF } = window.jspdf;
        const logoRes = await loadLogo();
        const combinedDoc = new jsPDF('portrait');
        let isFirstPage = true;

        for (let i = 0; i < mergedStudents.length; i++) {
            const ms = mergedStudents[i];
            const progress = ((i + 1) / mergedStudents.length * 100).toFixed(0);
            const pb = document.getElementById('bulk-progress');
            if (pb) pb.style.width = `${progress}%`;

            if (!isFirstPage) combinedDoc.addPage();
            const pw = combinedDoc.internal.pageSize.width;
            const ph = combinedDoc.internal.pageSize.height;
            const studentImageData = await loadStudentImage(ms['Official Student Name'], ms['Grade']);

            const tableEnd = await _drawMultiTermReportPage(combinedDoc, ms, logoRes, studentImageData, pw, ph);
            const summaryEnd = _drawMultiTermSummary(combinedDoc, ms, tableEnd, pw);
            await drawBottomSection(combinedDoc, summaryEnd + 4, _buildAveragedStudent(ms), pw, ph);
            await addMinistryWatermark(combinedDoc);

            isFirstPage = false;
            await new Promise(r => setTimeout(r, 50));
        }

        const gradePart = `_${gradeLabels.map(l=>l.replace(/\s+/g,'')).join('_')}`;
        const filename = `Report_Cards${gradePart}_${new Date().toISOString().split('T')[0]}.pdf`;
        combinedDoc.save(filename);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.success(
            `<strong>Report Cards Complete!</strong><br/>` +
            `${mergedStudents.length} students  ·  ${termHeader}<br/>` +
            `<span style="font-size:11px;">${filename}</span>`,
            5000
        );

    } catch (error) {
        console.error('Bulk generation error:', error);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.error(`Generation failed: ${error.message}`);
    }
}


// ═══════════════════════════════════════════════════════════
//  SHARED COMPACT PAGE RENDERER
//  Draws header + student info + performance table on combinedDoc
//  Returns after autoTable so caller can run drawSummary / drawBottomSection
// ═══════════════════════════════════════════════════════════
function _drawCompactReportPage(doc, student, stats, studentImageData, logoRes, pageWidth, pageHeight) {
    // ── HEADER ──
    doc.setFillColor(41, 128, 185);
    doc.rect(0, 0, pageWidth, 35, 'F');
    if (logoRes && logoRes.loaded) {
        try { doc.addImage(logoRes.img, 'PNG', 15, 5, 25, 25); } catch(e) {}
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('KANYADET PRI & JUNIOR SCHOOL', pageWidth / 2, 10, { align: 'center' });
    doc.setFontSize(12);
    doc.text('P O BOX 45 40139 AKALA,KENYA', pageWidth / 2, 16, { align: 'center' });
    doc.text('STUDENT PERFORMANCE REPORT', pageWidth / 2, 22, { align: 'center' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    const _termLabel2 = [...selectedGrades].join(' + ');
    doc.text(`${_termLabel2}  |  Academic Year: ${new Date().getFullYear()}`,
        pageWidth / 2, 30, { align: 'center' });

    // ── STUDENT INFO ──
    let yPos = 45;
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(240, 240, 240);
    doc.rect(15, yPos, pageWidth - 30, 40, 'F');

    if (studentImageData && studentImageData.loaded) {
        try {
            const imgW = 30, imgH = 35;
            doc.addImage(studentImageData.img, 'JPEG', pageWidth - 20 - imgW, yPos + 2.5, imgW, imgH);
        } catch(e) {}
    }

    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text('STUDENT INFORMATION', 20, yPos + 8);
    doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    const studentInfo = [
        [`Name: ${student['Official Student Name'] || 'N/A'}`, `Assessment No: ${student['Assessment No'] || 'N/A'}`],
        [`UPI: ${student['UPI'] || 'N/A'}`, `${student['Grade'] || 'N/A'}`],
        [`Gender: ${student['Gender'] || 'N/A'}`, `Class: ${student['Class'] || 'N/A'}`]
    ];
    let infoY = yPos + 16;
    studentInfo.forEach(([left, right]) => {
        doc.text(left, 20, infoY);
        doc.text(right, pageWidth / 2 - 10, infoY);
        infoY += 7;
    });

    // ── PERFORMANCE TABLE ──
    yPos = 95;
    doc.setFont(undefined, 'bold'); doc.setFontSize(11);
    doc.text('ACADEMIC PERFORMANCE', 20, yPos);
    // Closing / Opening date — same line, right-aligned, auto-picked from DB
    doc.setFont(undefined, 'bold'); doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    const _closingDate = student['Closing Date'] || student['Closing'] || '...............';
    const _openingDate = student['Opening Date'] || student['Opening'] || '...............';
    doc.text(`CLOSING: ${_closingDate}   OPENING: ${_openingDate}`, pageWidth - 15, yPos, { align: 'right' });

    const tableData = [];
    getSubjects(student).forEach(subject => {
        const score = student[subject];
        const numScore = parseFloat(score);
        const gradeInfo = getGradeFromScore(score);
        tableData.push([
            subject,
            isNaN(numScore) ? 'N/A' : numScore.toString(),
            gradeInfo.grade,
            gradeInfo.comment
        ]);
    });

    doc.autoTable({
        head: [['Learning Area', 'Score', 'Points', 'Comment']],
        body: tableData,
        startY: yPos + 5,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [41,128,185], textColor: [255,255,255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245,245,245] },
        columnStyles: { 0:{cellWidth:50}, 1:{cellWidth:30}, 2:{cellWidth:30}, 3:{cellWidth:70} }
    });
}

// ══════════════════════════════════════════════════════════════════════════
//  GRADE SELECTOR FOR REPORT CARDS
//  Replaces the old term-chip system.
//  User picks 2–3 full Grade values (e.g. "Grade 9/2026/MDT1/G9ASO1").
//  Report cards then merge matching students across those grades by Assessment No.
// ══════════════════════════════════════════════════════════════════════════

function buildGradeSelector() {
    const bar   = document.getElementById('term-selector-bar');
    const chips = document.getElementById('term-chips');
    const badge = document.getElementById('term-count-badge');
    const warn  = document.getElementById('term-validation-msg');
    if (!bar || !chips) return;

    // Collect all unique full Grade values from loaded data
    const allGrades = [...new Set(studentsData.map(s => s['Grade']).filter(Boolean))].sort();

    selectedGrades = new Set();   // start with none selected — user must choose

    chips.innerHTML = '';

    // Cycled per-chip accent color so each grade is visually distinct
    const _chipPalette = ['#2980b9','#27ae60','#e67e22','#8e44ad','#16a085','#c0392b','#f39c12','#2d3436'];

    allGrades.forEach((gradeVal, _idx) => {
        const chip = document.createElement('label');
        chip.className = 'term-chip';           // NOT tc-active — start unselected
        chip.dataset.grade = gradeVal;

        // Color is keyed to the grade LEVEL (e.g. "Grade 4"), not the full
        // unique value, so every chip belonging to the same grade matches.
        const _gradeMatch = gradeVal.match(/grade\s*(\d+)/i);
        const _paletteIdx = _gradeMatch
            ? parseInt(_gradeMatch[1], 10) % _chipPalette.length
            : _idx % _chipPalette.length;
        chip.style.setProperty('--chip-color', _chipPalette[_paletteIdx]);

        // ── Display the raw DB Grade value on the chip ───────────────────
        chip.innerHTML = `
            <span class="chip-label" style="font-size:11px;word-break:break-word;max-width:160px">${gradeVal}</span>
            <span class="chip-tick">✓</span>
        `;

        chip.addEventListener('click', () => {
            const isActive = chip.classList.contains('tc-active');

            if (isActive) {
                // Enforce minimum of 1
                if (selectedGrades.size <= 1) {
                    warn.textContent = '⚠️ Minimum 1 grade selection required for report cards.';
                    warn.style.display = 'block';
                    setTimeout(() => { warn.style.display = 'none'; }, 2800);
                    return;
                }
                chip.classList.remove('tc-active');
                selectedGrades.delete(gradeVal);
            } else {
                // No maximum limit — select as many grades as needed
                chip.classList.add('tc-active');
                selectedGrades.add(gradeVal);
            }

            warn.style.display = 'none';
            _updateGradeBadge(badge);
            NotificationManager.info(
                selectedGrades.size < 1
                    ? `Select at least <strong>1 grade</strong> to enable report cards.`
                    : `<strong>${selectedGrades.size} grade${selectedGrades.size > 1 ? 's' : ''} selected</strong> — ready to generate report cards.`,
                2000
            );
        });

        chips.appendChild(chip);
    });

    _updateGradeBadge(badge);
    bar.style.display = allGrades.length > 0 ? 'flex' : 'none';

    // Update the bar label text to match new purpose
    const labelDiv = bar.querySelector('div > div:first-child');
    if (labelDiv) labelDiv.textContent = 'Report Card Grades';
    const subDiv = bar.querySelector('div > div:last-child');
    if (subDiv) subDiv.textContent = 'Select 1 or more grade nodes to generate report cards';
}

// Keep legacy name as alias so old call-sites don't break
const buildTermSelector = buildGradeSelector;

function _updateGradeBadge(badge) {
    if (!badge) return;
    const n = selectedGrades.size;
    if (n === 0) {
        badge.textContent = 'None Selected';
        badge.style.background = 'linear-gradient(135deg,#7f8c8d,#636e72)';
    } else {
        badge.textContent = `${n} Grade${n > 1 ? 's' : ''} Selected ✓`;
        badge.style.background = 'linear-gradient(135deg,#27ae60,#1e8449)';
    }
}

/**
 * Returns the friendly short label for a full Grade value.
 * Used in report card headers and filenames.
 */
function gradeToLabel(gradeVal) {
    return gradeVal
        .replace(/^(Grade\s*\d+)[\/\-]\d{4}[\/\-]?/i, '$1 ')
        .replace(/MDT(\d+)/i, 'Mid-Term $1')
        .replace(/EDT(\d+)/i, 'End-Term $1')
        .replace(/[\/\-][A-Z0-9]+$/i, '')
        .replace(/\s{2,}/g, ' ').trim();
}

/**
 * Given the selected grade nodes, groups ALL studentsData by Assessment No.
 * Returns an array of merged student objects, one per unique Assessment No,
 * with scores from each grade node stored under a namespaced key:
 *   student['__grade_<gradeVal>'] = { <subject>: score, ... , __gradeVal, __label }
 * The base student info (Name, UPI, Gender etc.) is taken from the first matched record.
 */
function getMergedStudents() {
    if (selectedGrades.size < 1) return [];

    const gradeList = [...selectedGrades];

    // Single grade — return each student wrapped in the merged format
    if (gradeList.length === 1) {
        const g = gradeList[0];
        return studentsData
            .filter(s => s['Grade'] === g)
            .map(s => {
                const ms = {
                    id: s.id,
                    'Assessment No':           s['Assessment No'],
                    'Official Student Name':   s['Official Student Name'],
                    'UPI':                     s['UPI'],
                    'Gender':                  s['Gender'],
                    'Class':                   s['Class'],
                    'Grade':                   s['Grade'],
                };
                ms[`__grade_${g}`] = s;
                return ms;
            })
            .sort((a, b) => {
                const na = parseFloat(String(a['Assessment No']).replace(/\D/g,'')) || Infinity;
                const nb = parseFloat(String(b['Assessment No']).replace(/\D/g,'')) || Infinity;
                return na - nb;
            });
    }

    // Group studentsData by Assessment No, then by Grade
    const byAssessment = {};   // { assessmentNo: { gradeVal: studentRecord } }

    studentsData.forEach(s => {
        if (!gradeList.includes(s['Grade'])) return;
        const adm = String(s['Assessment No'] || '').trim().replace(/\s+/g,'');
        if (!adm) return;
        if (!byAssessment[adm]) byAssessment[adm] = {};
        byAssessment[adm][s['Grade']] = s;
    });

    // Only include students that appear in at least 2 selected grades
    const merged = [];
    Object.entries(byAssessment).forEach(([adm, gradeMap]) => {
        const presentIn = gradeList.filter(g => gradeMap[g]);
        if (presentIn.length < 2) return;   // must appear in at least 2

        // Base info from first available record
        const base = gradeMap[gradeList.find(g => gradeMap[g])];
        const mergedStudent = {
            id: base.id,
            'Assessment No':           base['Assessment No'],
            'Official Student Name':   base['Official Student Name'],
            'UPI':                     base['UPI'],
            'Gender':                  base['Gender'],
            'Class':                   base['Class'],
            'Grade':                   base['Grade'],
        };

        // Attach per-grade score bundles
        gradeList.forEach(g => {
            mergedStudent[`__grade_${g}`] = gradeMap[g] || null;
        });

        merged.push(mergedStudent);
    });

    merged.sort((a, b) => {
        const na = parseFloat(String(a['Assessment No']).replace(/\D/g,'')) || Infinity;
        const nb = parseFloat(String(b['Assessment No']).replace(/\D/g,'')) || Infinity;
        return na - nb;
    });

    return merged;
}

// ──────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════
//  TERM FILTER HELPER
//  Filters an array of student records to only those whose
//  Grade field is one of the currently selectedGrades.
//  If selectedGrades is empty (nothing chosen) the full pool
//  is returned unchanged so the UI keeps working normally.
// ═══════════════════════════════════════════════════════════
function _filterPoolBySelectedGrades(pool) {
    if (!selectedGrades || selectedGrades.size === 0) return pool;
    return pool.filter(s => selectedGrades.has(s['Grade']));
}

// --- Main Application Flow ---

/**
 * TIMING FIX:
 * Firebase is loaded via  <script type="module">  which is always deferred and
 * runs *after* classic scripts even if placed earlier in the HTML.
 * We therefore listen for the custom 'firebaseImportsReady' event that the
 * module script dispatches once window.firebaseImports has been populated,
 * instead of relying on DOMContentLoaded (which fires before the module runs).
 *
 * Safety net: if for any reason the event was already fired before this
 * listener registered (shouldn't happen with classic scripts, but just in case)
 * we also poll window.firebaseImports once on DOMContentLoaded.
 */
function _bootApp() {
    firebaseImports = window.firebaseImports;
    if (firebaseImports) {
        initializeAppAndSetListeners();
    } else {
        userInfo.textContent = "Error: Firebase modules failed to load.";
        loader.style.display = 'none';
        NotificationManager.error('Failed to initialize Firebase modules. Please refresh the page.');
    }
}

// Primary trigger — fired by the module script as soon as exports are ready
window.addEventListener('firebaseImportsReady', _bootApp, { once: true });

// Fallback — in case the event already fired before this script ran
document.addEventListener('DOMContentLoaded', () => {
    if (window.firebaseImports && !firebaseImports) {
        _bootApp();
    }
});

function initializeAppAndSetListeners() {
    const { initializeApp, getDatabase, getAuth, onAuthStateChanged } = firebaseImports;
    try {
        const app = initializeApp(customFirebaseConfig);
        db = getDatabase(app);
        auth = getAuth(app);
        
        controlsDiv.style.display = 'none';
        printAreaDiv.style.display = 'none';
        reportSummary.textContent = 'Please sign in to load the data.';

        onAuthStateChanged(auth, (user) => {
            if (user) {
                handleSignIn(user);
            } else {
                handleSignOut();
            }
        });

        gradeFilter.addEventListener('change', () => {
            currentPage = 1;
            applyFilters();
        });
        fieldFilter.addEventListener('change', () => {
            currentPage = 1;
            applyFilters();
        });
        searchInput.addEventListener('input', handleSearch);
        itemsPerPageSelect.addEventListener('change', handleItemsPerPageChange);
        signInBtn.addEventListener('click', signInWithGoogle);
        signOutBtn.addEventListener('click', signOutUser);
        

    } catch (e) {
        console.error("Firebase Initialization Error:", e);
        userInfo.textContent = `Error initializing Firebase: ${e.message}`;
        loader.style.display = 'none';
        NotificationManager.error(`Firebase initialization failed: ${e.message}`);
    }
}

// --- Authentication Functions ---

async function signInWithGoogle() {
    const { GoogleAuthProvider, signInWithPopup } = firebaseImports;
    const provider = new GoogleAuthProvider();
    try {
        await signInWithPopup(auth, provider);
        NotificationManager.success('Successfully signed in! Welcome aboard.');
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        userInfo.textContent = `Sign-in failed: ${error.message}`;
        NotificationManager.error(`Sign-in failed: ${error.message}`);
    }
}

async function signOutUser() {
    const { signOut } = firebaseImports;
    try {
        await signOut(auth);
        NotificationManager.info('Signed out successfully. See you next time!');
    } catch (error) {
        console.error("Sign-Out Error:", error);
        NotificationManager.error('Sign-out failed. Please try again.');
    }
}

function handleSignIn(user) {
    userInfo.textContent = `Welcome, ${user.displayName || user.email}!`;
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'inline-block';
    controlsDiv.style.display = 'flex';
    printAreaDiv.style.display = 'block';
    
    fetchStudentsData();
    setTimeout(() => {
        window.addReportCardControls ? window.addReportCardControls() : addReportCardControls();
    }, 1200);
}

function handleSignOut() {
    userInfo.textContent = "Please sign in to view the student data.";
    signInBtn.style.display = 'inline-block';
    signOutBtn.style.display = 'none';
    loader.style.display = 'none'; 
    
    studentsData = [];
    filteredAndSearchedStudents = [];
    searchQuery = '';
    currentPage = 1;
    searchInput.value = '';
    tableBody.innerHTML = '';
    reportSummary.textContent = 'Please sign in to load the data.';
    paginationInfo.textContent = '';
    paginationControls.innerHTML = '';
    controlsDiv.style.display = 'none';
    printAreaDiv.style.display = 'none';
    
    const reportControls = document.getElementById('report-card-controls');
    if (reportControls) reportControls.remove();

    const termBar = document.getElementById('term-selector-bar');
    if (termBar) termBar.style.display = 'none';
    const termChips = document.getElementById('term-chips');
    if (termChips) termChips.innerHTML = '';
    selectedGrades = new Set();
}

// --- Search and Pagination Handlers ---

function handleSearch() {
    searchQuery = searchInput.value.toLowerCase().trim();
    currentPage = 1;
    applyFilters();
    
    const searchReportBtn = document.getElementById('search-report-btn');
    if (searchReportBtn) {
        if (searchQuery && filteredAndSearchedStudents.length > 0) {
            searchReportBtn.style.display = 'inline-block';
            searchReportBtn.innerHTML = `🔍 Generate Reports (${filteredAndSearchedStudents.length} found)`;
        } else {
            searchReportBtn.style.display = 'none';
        }
    }
    
    if (searchQuery) {
        NotificationManager.info(`Searching for: "${searchQuery}"`, 2000);
    }
}

function handleItemsPerPageChange() {
    itemsPerPage = parseInt(itemsPerPageSelect.value);
    currentPage = 1;
    renderCurrentPage();
}

function goToPage(page) {
    const totalPages = Math.ceil(filteredAndSearchedStudents.length / itemsPerPage);
    if (page < 1 || page > totalPages) return;
    
    currentPage = page;
    renderCurrentPage();
    
    document.querySelector('#missing-data-table').scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start' 
    });
}

// --- Data Fetching and Filtering Functions ---


async function generateSearchReportCards() {
    if (!searchQuery) {
        NotificationManager.warning('No active search query');
        return;
    }
    if (selectedGrades.size < 1) {
        NotificationManager.warning('⚠️ Please select <strong>at least 1 grade</strong> in the Grade Selector above.', 4000);
        return;
    }

    // Filter merged students by the current search query
    const q = searchQuery.toLowerCase();
    const studentsToProcess = getMergedStudents().filter(ms =>
        [ms['Official Student Name'], ms['Assessment No'], ms['UPI'], ms['Grade']]
            .some(f => String(f||'').toLowerCase().includes(q))
    );

    if (studentsToProcess.length === 0) {
        NotificationManager.warning('No matched students found for this search across the selected grades.');
        return;
    }

    const gradeLabels = [...selectedGrades];
    const termHeader  = gradeLabels.join(' + ');

    const progressNotif = NotificationManager.info(
        `Generating <strong>${studentsToProcess.length}</strong> report cards for "<strong>${searchQuery}</strong>" — ${termHeader}...<br/>` +
        `<div style="width:100%;background:rgba(255,255,255,0.3);height:8px;border-radius:4px;margin-top:8px;">` +
        `<div id="search-progress" style="width:0%;background:white;height:100%;border-radius:4px;transition:width 0.3s;"></div></div>`,
        0
    );

    try {
        const { jsPDF } = window.jspdf;
        const logoRes = await loadImg('./imgs/logo.png');
        const combinedDoc = new jsPDF('portrait');
        let isFirstPage = true;

        for (let i = 0; i < studentsToProcess.length; i++) {
            const ms = studentsToProcess[i];
            const progress = ((i + 1) / studentsToProcess.length * 100).toFixed(0);
            const pb = document.getElementById('search-progress');
            if (pb) pb.style.width = `${progress}%`;

            if (!isFirstPage) combinedDoc.addPage();
            const pw = combinedDoc.internal.pageSize.width;
            const ph = combinedDoc.internal.pageSize.height;
            const studentImageData = await loadStudentImage(ms['Official Student Name'], ms['Grade']);

            const tableEnd   = await _drawMultiTermReportPage(combinedDoc, ms, logoRes, studentImageData, pw, ph);
            const summaryEnd = _drawMultiTermSummary(combinedDoc, ms, tableEnd, pw);
            await drawBottomSection(combinedDoc, summaryEnd + 4, _buildAveragedStudent(ms), pw, ph);
            await addMinistryWatermark(combinedDoc);

            isFirstPage = false;
            await new Promise(r => setTimeout(r, 50));
        }

        const searchPart  = searchQuery.replace(/\s+/g,'_').substring(0,20);
        const gradePart   = `_${gradeLabels.map(l=>l.replace(/\s+/g,'')).join('_')}`;
        const filename = `Report_Cards_Search_${searchPart}${gradePart}_${new Date().toISOString().split('T')[0]}.pdf`;
        combinedDoc.save(filename);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.success(
            `<strong>Search Reports Complete!</strong> ${studentsToProcess.length} students · ${termHeader}`,
            5000
        );

    } catch (error) {
        console.error('Search report generation error:', error);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.error(`Generation failed: ${error.message}`);
    }
}

function fetchStudentsData() {
    loader.style.display = 'flex'; 

    const { ref, onValue } = firebaseImports;
    const studentsRef = ref(db, `Results/${sanitizedAppId}/students`);
    
    onValue(studentsRef, (snapshot) => {
        const students = [];
        const data = snapshot.val();
        
        if (data) {
            for (let key in data) {
                const student = { id: key, ...data[key] };
                
                const gradeMatch = student['Grade']?.match(/^Grade\s+\d+/);
                const extractedGrade = gradeMatch ? gradeMatch[0] : null;
                
                if (!GRADE_FILTER_CONFIG.enabled || 
                    (extractedGrade && GRADE_FILTER_CONFIG.allowedGrades.includes(extractedGrade))) {
                    students.push(student);
                }
            }
        }
        
        students.sort((a, b) => {
            const assessmentNoA = parseFloat(a['Assessment No']) || Infinity;
            const assessmentNoB = parseFloat(b['Assessment No']) || Infinity;
            return assessmentNoA - assessmentNoB;
        });

        studentsData = students;
        populateFilters(students);
        buildTermSelector();   // ← rebuild term chips now that we have real data
        applyFilters(); 
        loader.style.display = 'none';
        
        const totalRecords = Object.keys(data || {}).length;
        if (GRADE_FILTER_CONFIG.enabled) {
            NotificationManager.success(
                `Loaded ${students.length} student records from ${GRADE_FILTER_CONFIG.allowedGrades.join(', ')} (${totalRecords} total records in database)`
            );
        } else {
            NotificationManager.success(`Loaded ${students.length} student records successfully`);
        }
    }, (error) => {
        console.error("Error fetching students:", error);
        reportSummary.textContent = `Error fetching data: ${error.message}. Please check your Firebase Security Rules.`;
        loader.style.display = 'none';
        NotificationManager.error(`Failed to fetch data: ${error.message}`);
    });
}

function populateFilters(students) {
    const grades = new Set();
    const allKeys = new Set();

    students.forEach(student => {
        if (student['Grade']) {
            grades.add(student['Grade']);
        }
        Object.keys(student).forEach(key => allKeys.add(key));
    });

    gradeFilter.innerHTML = '<option value="">All Grades</option>';
    Array.from(grades).sort().forEach(grade => {
        const option = document.createElement('option');
        option.value = grade;
        option.textContent = `Grade ${grade}`;
        gradeFilter.appendChild(option);
    });

    const excludedFields = [
        'id', 'Assessment No', 'Official Student Name', 'Gender', 
         'Class', 'Grade'
    ]; 
    
    fieldFilter.innerHTML = '<option value="">Select Field...</option>';
    Array.from(allKeys)
        .filter(key => !excludedFields.includes(key))
        .sort()
        .forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            fieldFilter.appendChild(option);
        });
}

function applyFilters() {
    const selectedGrade = gradeFilter.value;
    const selectedField = fieldFilter.value;
    let filtered = studentsData;

    if (selectedGrade) {
        filtered = filtered.filter(student => student['Grade'] === selectedGrade);
    }

    if (selectedField) {
        missingFieldHeader.textContent = `Missing: ${selectedField}`;
        filtered = filtered.filter(student => {
            const value = student[selectedField];
            if (value === undefined || value === null || value === "") {
                return true;
            }
            if (typeof value === 'string' && (value.toUpperCase() === 'NA' || value.toUpperCase() === 'N/A'|| value.toUpperCase() === '---'|| value.toUpperCase() === '-')) {
                return true;
            }
            return false;
        });
    } else {
        missingFieldHeader.textContent = "Missing Field Value";
    }

    if (searchQuery) {
        filtered = filtered.filter(student => {
            const searchableFields = [
                student['Official Student Name'],
                student['Assessment No'],
                student['UPI'],
                student['Grade'],
                student['Term']
            ].map(field => String(field || '').toLowerCase());
            
            return searchableFields.some(field => field.includes(searchQuery));
        });
    }

    filteredAndSearchedStudents = filtered;
    currentPage = 1;
    renderCurrentPage();
}

// --- Advanced Rendering with Pagination ---

function renderCurrentPage() {
    const selectedField = fieldFilter.value;
    const totalStudents = filteredAndSearchedStudents.length;
    const totalPages = Math.ceil(totalStudents / itemsPerPage);
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalStudents);
    const studentsToRender = filteredAndSearchedStudents.slice(startIndex, endIndex);

    let summaryText = `Report Summary: <b style="color: #2980b9;">${totalStudents}</b> students found`;
    if (gradeFilter.value) {
        summaryText += ` in <b style="color: #2980b9;">${gradeFilter.value}</b>`;
    }
    if (selectedField) {
        summaryText += ` with missing value for <b style="color: #2980b9;">${selectedField}</b>`;
    }
    if (searchQuery) {
        summaryText += ` matching <b style="color: #2980b9;">"${searchQuery}"</b>`;
    }
    reportSummary.innerHTML = summaryText + '.';

    if (totalStudents > 0) {
        paginationInfo.textContent = `Showing ${startIndex + 1}-${endIndex} of ${totalStudents} students`;
    } else {
        paginationInfo.textContent = 'No students found';
    }

    tableBody.innerHTML = ''; 

    if (studentsToRender.length === 0) {
        const row = tableBody.insertRow();
        const cell = row.insertCell(0);
        cell.colSpan = 7;
        cell.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #7f8c8d;">
                <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">No students found</div>
                <div style="font-size: 14px;">Try adjusting your filters or search query</div>
            </div>
        `;
        paginationControls.innerHTML = '';
        return;
    }

    studentsToRender.forEach((student, index) => {
        const row = tableBody.insertRow();
        row.dataset.studentId = student.id;
        row.dataset.rowIndex = startIndex + index;
        
        const indexCell = row.insertCell(0);
        indexCell.textContent = (startIndex + index + 1).toString();
        
        row.insertCell(1).textContent = student['Grade'] || 'N/A';
        row.insertCell(2).textContent = student['Official Student Name'] || 'N/A'; 
        row.insertCell(3).textContent = student['Assessment No'] || student.id || 'N/A'; 
        row.insertCell(4).textContent = student['UPI'] || student.id || 'N/A'; 
        row.insertCell(5).textContent = student['Term'] || 'N/A';
        
        const missingValueCell = row.insertCell(6);
        if (selectedField) {
            createEditableCell(missingValueCell, student, selectedField, row);
        } else {
            missingValueCell.textContent = '-'; 
        }
        
        const actionCell = row.insertCell(7);
        createActionButtons(actionCell, student, selectedField, row);
    });

    renderPaginationControls(totalPages);
}

function renderPaginationControls(totalPages) {
    paginationControls.innerHTML = '';
    
    if (totalPages <= 1) return;

    const buttonStyle = `
        padding: 8px 12px;
        margin: 0 4px;
        border: 2px solid #3498db;
        background: white;
        color: #3498db;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        transition: all 0.3s ease;
    `;

    const activeButtonStyle = `
        padding: 8px 12px;
        margin: 0 4px;
        border: 2px solid #3498db;
        background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
        color: white;
        border-radius: 6px;
        cursor: default;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
    `;

    const disabledButtonStyle = `
        padding: 8px 12px;
        margin: 0 4px;
        border: 2px solid #bdc3c7;
        background: #ecf0f1;
        color: #95a5a6;
        border-radius: 6px;
        cursor: not-allowed;
        font-weight: 600;
        font-size: 14px;
    `;

    const firstBtn = document.createElement('button');
    firstBtn.innerHTML = '⟨⟨';
    firstBtn.title = 'First page';
    firstBtn.style.cssText = currentPage === 1 ? disabledButtonStyle : buttonStyle;
    firstBtn.disabled = currentPage === 1;
    firstBtn.onclick = () => goToPage(1);
    paginationControls.appendChild(firstBtn);

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '⟨ Previous';
    prevBtn.style.cssText = currentPage === 1 ? disabledButtonStyle : buttonStyle;
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => goToPage(currentPage - 1);
    paginationControls.appendChild(prevBtn);

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.cssText = 'margin: 0 8px; color: #7f8c8d;';
        paginationControls.appendChild(ellipsis);
    }

    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.style.cssText = i === currentPage ? activeButtonStyle : buttonStyle;
        
        if (i !== currentPage) {
            pageBtn.onmouseenter = () => {
                pageBtn.style.background = '#3498db';
                pageBtn.style.color = 'white';
            };
            pageBtn.onmouseleave = () => {
                pageBtn.style.background = 'white';
                pageBtn.style.color = '#3498db';
            };
            pageBtn.onclick = () => goToPage(i);
        }
        
        paginationControls.appendChild(pageBtn);
    }

    if (endPage < totalPages) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.cssText = 'margin: 0 8px; color: #7f8c8d;';
        paginationControls.appendChild(ellipsis);
    }

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'Next ⟩';
    nextBtn.style.cssText = currentPage === totalPages ? disabledButtonStyle : buttonStyle;
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => goToPage(currentPage + 1);
    paginationControls.appendChild(nextBtn);

    const lastBtn = document.createElement('button');
    lastBtn.innerHTML = '⟩⟩';
    lastBtn.title = 'Last page';
    lastBtn.style.cssText = currentPage === totalPages ? disabledButtonStyle : buttonStyle;
    lastBtn.disabled = currentPage === totalPages;
    lastBtn.onclick = () => goToPage(totalPages);
    paginationControls.appendChild(lastBtn);
}

function createEditableCell(cell, student, fieldName, row) {
    const value = student[fieldName];
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: relative; display: flex; align-items: center; gap: 8px;';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input-advanced';
    input.placeholder = 'Enter value...';
    input.dataset.originalValue = value || '';
    
    input.style.cssText = `
        flex: 1;
        padding: 8px 12px;
        border: 2px solid #bdc3c7;
        border-radius: 6px;
        font-size: 14px;
        transition: all 0.3s ease;
        background: white;
    `;
    
    if (value === undefined || value === null || value === "") {
        input.value = '';
        cell.classList.add('missing-value-indicator');
    } else if (typeof value === 'string' && (value.toUpperCase() === 'NA' || value.toUpperCase() === 'N/A')) {
        input.value = '';
        cell.classList.add('missing-value-indicator');
    } else {
        input.value = value;
    }
    
    input.addEventListener('focus', () => {
        input.style.borderColor = '#3498db';
        input.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
        input.style.transform = 'scale(1.02)';
    });
    
    input.addEventListener('blur', () => {
        input.style.borderColor = '#bdc3c7';
        input.style.boxShadow = 'none';
        input.style.transform = 'scale(1)';
    });
    
    input.addEventListener('input', () => {
        const hasChanged = input.value.trim() !== input.dataset.originalValue;
        const isEmpty = input.value.trim() === '';
        
        if (hasChanged && !isEmpty) {
            input.style.borderColor = '#f39c12';
            input.style.background = '#fff9e6';
        } else if (isEmpty) {
            input.style.borderColor = '#e74c3c';
            input.style.background = '#ffebee';
        } else {
            input.style.borderColor = '#bdc3c7';
            input.style.background = 'white';
        }
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const saveBtn = row.cells[7].querySelector('.save-btn-advanced');
            if (saveBtn) saveBtn.click();
        }
    });
    
    wrapper.appendChild(input);
    cell.appendChild(wrapper);
}

function createActionButtons(actionCell, student, fieldName, row) {
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;';
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.className = 'save-btn-advanced';
    saveBtn.style.cssText = `
        display: none;
        padding: 8px 16px;
        background: linear-gradient(135deg, #27ae60 0%, #229954 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(39, 174, 96, 0.3);
    `;
    
    saveBtn.onmouseenter = () => {
        saveBtn.style.transform = 'translateY(-2px)';
        saveBtn.style.boxShadow = '0 4px 12px rgba(39, 174, 96, 0.4)';
    };
    saveBtn.onmouseleave = () => {
        saveBtn.style.transform = 'translateY(0)';
        saveBtn.style.boxShadow = '0 2px 8px rgba(39, 174, 96, 0.3)';
    };
    
    saveBtn.onclick = () => updateStudentFieldAdvanced(student.id, fieldName, row);
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '↺';
    clearBtn.className = 'clear-btn-advanced';
    clearBtn.title = 'Reset to original value';
    clearBtn.style.cssText = `
        display: none;
        padding: 8px 12px;
        background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 16px;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(149, 165, 166, 0.3);
    `;
    
    clearBtn.onmouseenter = () => {
        clearBtn.style.transform = 'rotate(180deg) scale(1.1)';
    };
    clearBtn.onmouseleave = () => {
        clearBtn.style.transform = 'rotate(0deg) scale(1)';
    };
    
    clearBtn.onclick = () => {
        const input = row.cells[6].querySelector('input');
        if (input) {
            input.value = input.dataset.originalValue;
            input.style.borderColor = '#bdc3c7';
            input.style.background = 'white';
            saveBtn.style.display = 'none';
            clearBtn.style.display = 'none';
            NotificationManager.info('Value reset to original');
        }
    };
    
    const reportBtn = document.createElement('button');
    reportBtn.textContent = '📄';
    reportBtn.title = 'Generate Report Card';
    reportBtn.style.cssText = `
        padding: 8px 12px;
        background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 16px;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(155, 89, 182, 0.3);
    `;
    
    reportBtn.onmouseenter = () => {
        reportBtn.style.transform = 'translateY(-2px) scale(1.1)';
        reportBtn.style.boxShadow = '0 4px 12px rgba(155, 89, 182, 0.4)';
    };
    reportBtn.onmouseleave = () => {
        reportBtn.style.transform = 'translateY(0) scale(1)';
        reportBtn.style.boxShadow = '0 2px 8px rgba(155, 89, 182, 0.3)';
    };
    
    reportBtn.onclick = async () => {
        reportBtn.disabled = true;
        reportBtn.textContent = '⏳';
        
        const doc = await generateStudentReportCard(student, false);
        if (doc) {
            const filename = `Report_Card_${student['Official Student Name']?.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(filename);
            NotificationManager.success(`Report card generated for ${student['Official Student Name']}`);
        }
        
        reportBtn.disabled = false;
        reportBtn.textContent = '📄';
    };
    
    buttonContainer.appendChild(saveBtn);
    buttonContainer.appendChild(clearBtn);
    buttonContainer.appendChild(reportBtn);
    actionCell.appendChild(buttonContainer);
    
    const input = row.cells[6].querySelector('input');
    if (input) {
        input.addEventListener('input', () => {
            const hasChanged = input.value.trim() !== input.dataset.originalValue;
            if (hasChanged) {
                saveBtn.style.display = 'block';
                clearBtn.style.display = 'block';
            } else {
                saveBtn.style.display = 'none';
                clearBtn.style.display = 'none';
            }
        });
    }
}

// --- Advanced Update Function with Rich Feedback ---

async function updateStudentFieldAdvanced(studentId, fieldName, row) {
    const { ref, update } = firebaseImports;
    const input = row.cells[6].querySelector('input');
    const newValue = input.value.trim();
    
    if (!newValue) {
        NotificationManager.warning('Please enter a value before saving');
        input.focus();
        input.style.animation = 'pulse 0.5s ease-in-out';
        setTimeout(() => input.style.animation = '', 500);
        return;
    }
    
    const saveBtn = row.cells[7].querySelector('.save-btn-advanced');
    const clearBtn = row.cells[7].querySelector('.clear-btn-advanced');
    const originalBtnContent = saveBtn.innerHTML;
    const studentGrade = row.cells[1].textContent;
    const studentName = row.cells[2].textContent;
    const AssessmentNo = row.cells[3].textContent;
    
    try {
        saveBtn.disabled = true;
        clearBtn.disabled = true;
        saveBtn.innerHTML = '⏳ Saving...';
        saveBtn.style.background = 'linear-gradient(90deg, #3498db, #2980b9, #3498db)';
        saveBtn.style.backgroundSize = '200% 100%';
        saveBtn.style.animation = 'shimmer 1.5s infinite';
        
        input.disabled = true;
        input.style.opacity = '0.6';

        const studentRef = ref(db, `Results/${sanitizedAppId}/students/${studentId}`);
        await update(studentRef, {
            [fieldName]: newValue
        });
        
        saveBtn.innerHTML = '✓ Saved!';
        saveBtn.style.background = 'linear-gradient(135deg, #27ae60 0%, #229954 100%)';
        saveBtn.style.animation = '';
        input.style.borderColor = '#27ae60';
        input.style.background = '#e8f8f5';
        
        const student = studentsData.find(s => s.id === studentId);
        if (student) {
            student[fieldName] = newValue;
        }
        
        NotificationManager.success(
            `<strong>${studentName}  ${studentGrade} Assessment No ${AssessmentNo} </strong><br/>` +
            `<span style="font-size: 12px; opacity: 0.9;">✓ ${fieldName} updated successfully</span>`,
            10000
        );
        
        setTimeout(() => {
            row.style.transition = 'all 0.5s ease';
            row.style.transform = 'translateX(100%)';
            row.style.opacity = '0';
            
            setTimeout(() => {
                applyFilters();
                NotificationManager.info(
                    `Student removed from Assessment Otcome Data Report  list`,
                    2000
                );
            }, 500);
        }, 1500);
        
    } catch (error) {
        console.error('Error updating student:', error);
        
        saveBtn.innerHTML = '✕ Failed';
        saveBtn.style.background = 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)';
        saveBtn.style.animation = '';
        input.style.borderColor = '#e74c3c';
        
        NotificationManager.error(
            `<strong>Update Failed</strong><br/>` +
            `<span style="font-size: 12px;">${error.message}</span>`,
            5000
        );
        
        setTimeout(() => {
            saveBtn.innerHTML = originalBtnContent;
            saveBtn.style.background = 'linear-gradient(135deg, #27ae60 0%, #229954 100%)';
            saveBtn.disabled = false;
            clearBtn.disabled = false;
            input.disabled = false;
            input.style.opacity = '1';
        }, 2000);
    }
}

// --- Add Report Card Controls to UI ---

function addReportCardControls() {
    if (document.getElementById('report-card-controls')) return;
    
    const controlsDiv = document.querySelector('.controls');
    if (!controlsDiv) return;
    
    const reportControlsDiv = document.createElement('div');
    reportControlsDiv.id = 'report-card-controls';
    reportControlsDiv.style.cssText = `
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 16px;
        border-radius: 12px;
        margin: 26px;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    `;
    
    reportControlsDiv.innerHTML = `
    <button id="bulk-report-btn" style="
        padding: 10px 20px;
        background: #3498db;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
    ">
        📚 Print All Report Cards
    </button>
    
    <button id="class-report-btn" style="
        padding: 10px 20px;
        background: #f39c12;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
    ">
        📋 Print Reports for Current Grade
    </button>

    <button id="search-report-btn" style="
        padding: 10px 20px;
        background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(231, 76, 60, 0.3);
        display: none;
    ">
        🔍 Print Reports for Search Results
    </button>
`;
    
    controlsDiv.parentElement.insertBefore(reportControlsDiv, controlsDiv.nextSibling);
    
    document.getElementById('bulk-report-btn').addEventListener('click', generateBulkReportCards);
    document.getElementById('class-report-btn').addEventListener('click', generateClassReportCards);
    document.getElementById('search-report-btn').addEventListener('click', generateSearchReportCards);
}


async function generateClassReportCards() {
    if (selectedGrades.size < 1) {
        NotificationManager.warning('⚠️ Please select <strong>at least 1 grade</strong> in the Grade Selector above before generating report cards.', 4000);
        return;
    }

    // Filter merged students to match the currently selected grade in the table filter
    const tableGrade = gradeFilter.value;
    let studentsToProcess = getMergedStudents();

    if (tableGrade) {
        // Keep students whose base Grade starts with the same "Grade N" prefix
        const prefix = (tableGrade.match(/^Grade\s*\d+/i) || [tableGrade])[0];
        studentsToProcess = studentsToProcess.filter(s =>
            (s['Grade'] || '').startsWith(prefix)
        );
    }

    if (studentsToProcess.length === 0) {
        NotificationManager.warning('No matched students found for the selected grades.');
        return;
    }

    const gradeLabels = [...selectedGrades];
    const termHeader  = gradeLabels.join(' + ');

    const progressNotif = NotificationManager.info(
        `Generating <strong>${studentsToProcess.length}</strong> report cards — ${termHeader}...<br/>` +
        `<div style="width:100%;background:rgba(255,255,255,0.3);height:8px;border-radius:4px;margin-top:8px;">` +
        `<div id="class-progress" style="width:0%;background:white;height:100%;border-radius:4px;transition:width 0.3s;"></div></div>`,
        0
    );

    try {
        const { jsPDF } = window.jspdf;
        const logoRes = await loadImg('./imgs/logo.png');
        const combinedDoc = new jsPDF('portrait');
        let isFirstPage = true;

        for (let i = 0; i < studentsToProcess.length; i++) {
            const ms = studentsToProcess[i];
            const progress = ((i + 1) / studentsToProcess.length * 100).toFixed(0);
            const pb = document.getElementById('class-progress');
            if (pb) pb.style.width = `${progress}%`;

            if (!isFirstPage) combinedDoc.addPage();
            const pw = combinedDoc.internal.pageSize.width;
            const ph = combinedDoc.internal.pageSize.height;
            const studentImageData = await loadStudentImage(ms['Official Student Name'], ms['Grade']);

            const tableEnd   = await _drawMultiTermReportPage(combinedDoc, ms, logoRes, studentImageData, pw, ph);
            const summaryEnd = _drawMultiTermSummary(combinedDoc, ms, tableEnd, pw);
            await drawBottomSection(combinedDoc, summaryEnd + 4, _buildAveragedStudent(ms), pw, ph);
            await addMinistryWatermark(combinedDoc);

            isFirstPage = false;
            await new Promise(r => setTimeout(r, 50));
        }

        const gradePart = `_${gradeLabels.map(l=>l.replace(/\s+/g,'')).join('_')}`;
        const filename = `Report_Cards${gradePart}_${new Date().toISOString().split('T')[0]}.pdf`;
        combinedDoc.save(filename);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.success(
            `<strong>Reports Complete!</strong> ${studentsToProcess.length} students · ${termHeader}`,
            5000
        );
    } catch (error) {
        console.error('Class report generation error:', error);
        document.getElementById(progressNotif)?.remove();
        NotificationManager.error(`Generation failed: ${error.message}`);
    }
}


// --- PDF Export Function ---

async function exportMissingDataToPdf() {
    if (!window.jspdf) {
        alert('PDF library not loaded. Please refresh the page and try again.');
        return;
    }

    // Pre-load ministry watermark image (uses cache if already loaded)
    if (_ministryLogoCache === undefined) {
        _ministryLogoCache = await _loadMinistryLogo();
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape');

    const selectedGrade = gradeFilter.value;
    const selectedField = fieldFilter.value;

    const termLabel  = selectedGrades.size > 0 ? [...selectedGrades].join(' + ') : 'All Terms';
    const title      = `Assessment Outcome Data Report`;

    // Derive actual grade label from the selected grade chips (e.g. "Grade 9")
    // Extract the "Grade N" prefix from each selected grade value, deduplicate
    const gradeLabelsFromSelection = [...new Set(
        [...selectedGrades].map(g => {
            const m = g.match(/^Grade\s*\d+/i);
            return m ? m[0] : g;
        })
    )];
    const gradeInfo = gradeLabelsFromSelection.length > 0
        ? gradeLabelsFromSelection.join(', ')
        : (selectedGrade ? `Grade: ${selectedGrade}` : 'All Grades');

    // ── Build one averaged record per Assessment No across selected terms ────
    // Step 1: get the raw pool filtered by selected grades and current filters
    let rawPool = _filterPoolBySelectedGrades([...filteredAndSearchedStudents]);

    // Step 2: group by Assessment No
    const byAdm = {};
    rawPool.forEach(s => {
        const adm = String(s['Assessment No'] || s.id || '').trim();
        if (!adm) return;
        if (!byAdm[adm]) byAdm[adm] = [];
        byAdm[adm].push(s);
    });

    // Step 3: for each student, average numeric subject scores across all their records
    const allSubjectsSet = new Set(rawPool.flatMap(s => getSubjects(s)));
    const allSubjectsList = [...allSubjectsSet];

    let dataToExport = Object.values(byAdm).map(records => {
        // Use first record for meta fields
        const base = records[0];
        const averaged = {
            'Assessment No':         base['Assessment No'],
            'Official Student Name': base['Official Student Name'],
            'Gender':                base['Gender'],
            'Grade':                 base['Grade'],
            'Term':                  records.length > 1
                                        ? [...new Set(records.map(r => r['Term']).filter(Boolean))].join(' + ')
                                        : (base['Term'] || 'N/A'),
        };
        // Average each subject across all term records for this student
        allSubjectsList.forEach(subj => {
            const vals = records
                .map(r => parseFloat(r[subj]))
                .filter(v => !isNaN(v));
            averaged[subj] = vals.length > 0
                ? parseFloat((vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(2))
                : null;
        });
        return averaged;
    });

    // Sort by average score descending
    dataToExport = dataToExport
        .sort((a, b) => parseFloat(calculateStudentStats(b).average) - parseFloat(calculateStudentStats(a).average)); // sort by average descending

    if (dataToExport.length === 0) {
        alert(selectedGrades.size > 0
            ? 'No data to export for the selected terms. Try adjusting the Grade Selector or other filters.'
            : 'No data to export. Please adjust your filters.');
        return;
    }

    const totalStudents = dataToExport.length;
    
    let logoImg = null;
    const _logoRes = await (new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => resolve(img);
        img.onerror = () => resolve(null);
        setTimeout(() => resolve(null), 2000);
        img.src = './imgs/logo.png';
    }));

    if (_logoRes) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width  = _logoRes.width;
            canvas.height = _logoRes.height;
            ctx.drawImage(_logoRes, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const gray = data[i] * 0.3 + data[i+1] * 0.59 + data[i+2] * 0.11;
                const lightened = gray + (255 - gray) * 0.6;
                data[i] = data[i+1] = data[i+2] = lightened;
            }
            ctx.putImageData(imageData, 0, 0);
            logoImg = new Image();
            logoImg.src = canvas.toDataURL();
            await new Promise(r => { logoImg.onload = r; logoImg.onerror = r; setTimeout(r, 1000); });
        } catch(e) {
            console.warn('Logo filter failed:', e);
            logoImg = _logoRes;
        }
    }
    
    const PRIORITY_SUBJECTS = ['Mathematics', 'English', 'Kiswahili'];

    // Build subject list: priority subjects first (in order), then remaining alphabetically
    const rawSubjects = [...new Set(dataToExport.flatMap(s => getSubjects(s)))];
    const dynamicSubjects = [
        ...PRIORITY_SUBJECTS.filter(p => rawSubjects.some(s => s.toLowerCase().includes(p.toLowerCase())
            || p.toLowerCase().includes(s.toLowerCase()) || s === p)),
        ...rawSubjects.filter(s => !PRIORITY_SUBJECTS.some(p =>
            s.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(s.toLowerCase()) || s === p))
            .sort()
    ];
    // Fallback: ensure no subject is lost (use raw set order for any that didn't match above)
    const finalSubjects = [
        ...dynamicSubjects,
        ...rawSubjects.filter(s => !dynamicSubjects.includes(s))
    ];

    // Short level code extractor: "Meeting Expectation ME1" → "ME1"
    function shortLevel(comment) {
        const code = String(comment || '').match(/\b(EE|ME|AE|BE)\d\b/)?.[0];
        if (code) return code;
        if (String(comment).toLowerCase().includes('not assessed')) return 'N/A';
        return String(comment).substring(0, 4);
    }

    const headers = [
        'No.',
        'Photo',
        'Official Student Name',
        'Assessment No',
        'Gender',
        ...finalSubjects,
        'Avg %',
        'Points',
        'Level',
    ];

    // Pre-load student passport photos for the PDF table
    const studentImages = await Promise.all(
        dataToExport.map(student =>
            loadStudentImage(
                student['Official Student Name'] || '',
                student['Grade'] || ''
            ).catch(() => ({ loaded: false, img: null }))
        )
    );

    const body = dataToExport.map((student, index) => {
        const stats = calculateStudentStats(student);
        const row = [
            String(index + 1),
            '',                                                    // Photo — image drawn in didDrawCell
            String(student['Official Student Name'] || 'N/A'),
            String(student['Assessment No'] || 'N/A'),
            String(student['Gender'] || 'N/A'),
            ...finalSubjects.map(subj => {
                const v = student[subj];
                return (v === null || v === undefined) ? 'N/A' : String(v);
            }),
            String(stats.average),
            String(stats.totalPoints),
            shortLevel(stats.comment),
        ];
        return row;
    });

    const addHeader = () => {
        const pageWidth  = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;

        // Ministry of Education image watermark — drawn first so header sits on top
        try {
            if (_ministryLogoCache && _ministryLogoCache.complete && _ministryLogoCache.naturalHeight !== 0) {
                const watermarkSize = 100;
                const watermarkX = (pageWidth  - watermarkSize) / 2;
                const watermarkY = (pageHeight - watermarkSize) / 2;
                doc.saveGraphicsState();
                doc.setGState(new doc.GState({ opacity: 0.08 }));
                doc.addImage(_ministryLogoCache, 'PNG', watermarkX, watermarkY, watermarkSize, watermarkSize);
                doc.restoreGraphicsState();
            }
        } catch (e) {
            console.warn('Ministry watermark skipped:', e);
        }

        doc.setFillColor(41, 128, 185);
        doc.rect(0, 0, pageWidth, 22, 'F');
        
        if (logoImg && logoImg.complete && logoImg.naturalHeight !== 0) {
            try {
                doc.addImage(logoImg, 'PNG', 14, 2.5, 15, 15);
            } catch (e) {
                console.warn('Could not add logo to PDF:', e);
            }
        }
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('KANYADET PRI & JUNIOR SCHOOL', 34, 9);
        
        doc.setFontSize(11);
        doc.text(title, 34, 15);

        // Term label line — only say "Averaged across" when multiple terms are selected
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
        const termLineText = selectedGrades.size > 1
            ? `Averaged across: ${termLabel}`
            : `Term: ${termLabel}`;
        doc.text(termLineText, 34, 21);
        
        doc.setFontSize(9);
        const dateText = `Date: ${new Date().toLocaleDateString()}`;
        doc.text(dateText, pageWidth - 14, 6, { align: 'right' });
        doc.text(gradeInfo, pageWidth - 14, 12, { align: 'right' });
        doc.text(`Total Students: ${totalStudents}`, pageWidth - 14, 18, { align: 'right' });
        
        if (searchQuery) {
            doc.setFontSize(7.5);
            doc.text(`Search: "${searchQuery}"`, pageWidth - 14, 24, { align: 'right' });
        }
        
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.5);
        doc.line(0, 22, pageWidth, 22);
    };

    const addFooter = (data, totalPages) => {
        const pageWidth = doc.internal.pageSize.width;
        const pageHeight = doc.internal.pageSize.height;
        const footerY = pageHeight - 15;
        
        doc.setFillColor(245, 245, 245);
        doc.rect(0, footerY - 5, pageWidth, 20, 'F');
        
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.3);
        doc.line(0, footerY - 5, pageWidth, footerY - 5);
        
        doc.setTextColor(60, 60, 60);
        doc.setFontSize(8);
        
        doc.setFont(undefined, 'bold');
        doc.text('Prepared by:', 14, footerY);
        doc.setFont(undefined, 'normal');
        doc.text('_________________', 14, footerY + 4);
        doc.setFontSize(7);
        doc.text('Signature & Date', 14, footerY + 8);
        
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        const pageText = `Page ${data.pageNumber} of ${totalPages}`;
        doc.text(pageText, pageWidth / 2, footerY + 2, { align: 'center' });
        
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.text('Verified by:', pageWidth - 14, footerY, { align: 'right' });
        doc.setFont(undefined, 'normal');
        doc.text('_________________', pageWidth - 14, footerY + 4, { align: 'right' });
        doc.setFontSize(7);
        doc.text('Signature & Stamp', pageWidth - 14, footerY + 8, { align: 'right' });
        
        doc.setDrawColor(41, 128, 185);
        doc.setLineWidth(0.2);
        doc.rect(pageWidth - 85, footerY - 3, 28, 10);
        doc.setFontSize(6);
        doc.setTextColor(150, 150, 150);
        doc.text('OFFICIAL', pageWidth - 71, footerY + 2, { align: 'center' });
        doc.text('STAMP', pageWidth - 71, footerY + 5, { align: 'center' });
    };

    doc.autoTable({
        head: [headers],
        body: body,
        startY: 27,
        styles: { 
            fontSize: 7,
            cellPadding: 2,
            overflow: 'linebreak',
            cellWidth: 'auto'
        },
        columnStyles: {
            0: { cellWidth: 8 },   // No.
            1: { cellWidth: 18 },  // Photo
            2: { cellWidth: 42 },  // Official Student Name
            3: { cellWidth: 22 },  // Assessment No
            4: { cellWidth: 14 },  // Gender
        },
        headStyles: { 
            fillColor: [41, 128, 185], 
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7
        },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { top: 27, right: 5, bottom: 20, left: 5 },
        didDrawPage: function(data) {
            addHeader();
        },
        didDrawCell: function(data) {
            // Draw student passport photo in the Photo column (index 1)
            if (data.section === 'body' && data.column.index === 1) {
                const rowIdx = data.row.index;
                const imgData = studentImages[rowIdx];
                if (imgData && imgData.loaded && imgData.img) {
                    const padding = 1;
                    const imgSize = Math.min(data.cell.height - padding * 2, data.cell.width - padding * 2);
                    const imgX = data.cell.x + (data.cell.width  - imgSize) / 2;
                    const imgY = data.cell.y + (data.cell.height - imgSize) / 2;
                    try {
                        doc.addImage(imgData.img, 'JPEG', imgX, imgY, imgSize, imgSize);
                    } catch(e) {
                        // Silently skip if image can't be drawn
                    }
                }
            }
        },
        didParseCell: function(data) {
            if (data.section !== 'body') return;
            const META_COLS = 5; // No, Photo, Name, Adm, Gender
            const lastCol = headers.length - 1; // Level col
            const thirdLastCol = headers.length - 3; // Avg % col index

            // Colour subject score columns
            if (data.column.index >= META_COLS && data.column.index < thirdLastCol) {
                const v = parseFloat(data.cell.raw);
                if (!isNaN(v)) {
                    let r, g, b;
                    if      (v >= 75) { r=39;  g=174; b=96;  }
                    else if (v >= 58) { r=41;  g=128; b=185; }
                    else if (v >= 31) { r=243; g=156; b=18;  }
                    else              { r=231; g=76;  b=60;  }
                    data.cell.styles.textColor = [r, g, b];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
            // Colour Level column by short code
            if (data.column.index === lastCol) {
                const v = String(data.cell.raw || '');
                if      (v.startsWith('EE')) data.cell.styles.textColor = [39,174,96];
                else if (v.startsWith('ME')) data.cell.styles.textColor = [41,128,185];
                else if (v.startsWith('AE')) data.cell.styles.textColor = [243,156,18];
                else if (v.startsWith('BE')) data.cell.styles.textColor = [231,76,60];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    const totalPages = doc.internal.getNumberOfPages();
    
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        addFooter({ pageNumber: i }, totalPages);
    }

    const fieldPart  = selectedField ? `_${selectedField.replace(/\s+/g, '_')}` : '';
    const gradePart  = gradeLabelsFromSelection.length > 0
        ? `_${gradeLabelsFromSelection.map(g => g.replace(/\s/g,'')).join('_')}`
        : (selectedGrade ? `_${selectedGrade.replace(/\s/g,'')}` : '_AllGrades');
    const termPart   = selectedGrades.size > 0
        ? `_${[...selectedGrades].map(g => g.replace(/[^a-zA-Z0-9]/g,'_')).join('_')}`
        : '';
    const searchPart = searchQuery ? `_search_${searchQuery.replace(/\s+/g, '_')}` : '';
    const filename = `Assessment_Outcome_Report${fieldPart}${gradePart}${termPart}${searchPart}_${new Date().toISOString().split('T')[0]}.pdf`;
    
    doc.save(filename);
    
    NotificationManager.success(
        `<strong>PDF Export Complete!</strong><br/>` +
        `<span style="font-size: 12px;">Downloaded: ${filename}<br/>${totalStudents} students (averaged across selected terms)  ·  ${termLabel}</span>`,
        4000
    );
}

window.exportMissingDataToPdf = exportMissingDataToPdf;

// ═══════════════════════════════════════════════════════════════════════════
//  NEW FEATURES  — Kanyadet School Report System
// ═══════════════════════════════════════════════════════════════════════════

window.generateStudentReportCard = generateStudentReportCard;

// ─── 3. CLASS LEAGUE TABLE PDF ────────────────────────────────────────────
async function generateLeagueTable() {
    if (!window.jspdf) { alert('PDF library not loaded.'); return; }
    const { jsPDF } = window.jspdf;

    const selectedGrade = gradeFilter.value;
    let pool = selectedGrade
        ? studentsData.filter(s => s['Grade'] === selectedGrade)
        : studentsData;

    // ── Apply term filter ──────────────────────────────────────────────────
    pool = _filterPoolBySelectedGrades(pool);

    if (pool.length === 0) {
        NotificationManager.warning('No students found for the selected terms. Adjust the Term Selector above.');
        return;
    }

    const termLabel = [...selectedGrades].join(' + ');

    const ranked = [...pool]
        .map(s => ({ s, stats: calculateStudentStats(s) }))
        .sort((a, b) => parseFloat(b.stats.average) - parseFloat(a.stats.average));

    const doc = new jsPDF('landscape');
    const pageWidth  = doc.internal.pageSize.width;
    const logoRes    = await loadLogo();

    const drawPageHeader = () => {
        doc.setFillColor(41, 128, 185);
        doc.rect(0, 0, pageWidth, 18, 'F');
        if (logoRes.ok) { try { doc.addImage(logoRes.img, 'PNG', 5, 2, 14, 14); } catch(e) {} }
        doc.setTextColor(255,255,255);
        doc.setFontSize(13); doc.setFont(undefined, 'bold');
        doc.text('KANYADET PRI & JUNIOR SCHOOL', pageWidth/2, 8, { align: 'center' });
        doc.setFontSize(9); doc.setFont(undefined, 'normal');
        const gradeLabel = selectedGrade ? `Grade: ${selectedGrade}` : 'All Grades';
        doc.text(`CLASS LEAGUE TABLE  —  ${gradeLabel}  |  ${termLabel}  |  ${new Date().toLocaleDateString()}`, pageWidth/2, 14, { align: 'center' });
    };

    const dynamicSubjects = [...new Set(ranked.flatMap(({s}) => getSubjects(s)))];

    const headers = [['#', 'Name', 'Adm No', 'Gender', ...dynamicSubjects, 'Total Pts', 'Avg %', 'Level']];
    const body = ranked.map(({s, stats}, i) => [
        String(i + 1),
        s['Official Student Name'] || 'N/A',
        s['Assessment No'] || 'N/A',
        s['Gender'] || 'N/A',
        ...dynamicSubjects.map(subj => String(s[subj] ?? '-')),
        stats.totalPoints,
        stats.average,
        (stats.comment.match(/\b(EE|ME|AE|BE)\d\b/)?.[0] || stats.comment)
    ]);

    drawPageHeader();
    doc.autoTable({
        head: headers, body,
        startY: 22,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [41,128,185], textColor: [255,255,255], fontStyle: 'bold' },
        columnStyles: { 0:{cellWidth:8}, 1:{cellWidth:38}, 2:{cellWidth:20}, 3:{cellWidth:12} },
        alternateRowStyles: { fillColor: [245,245,245] },
        margin: { left: 5, right: 5, top: 22, bottom: 12 },
        didDrawPage: () => drawPageHeader(),
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === headers[0].length - 1) {
                const v = String(data.cell.raw);
                if (v.startsWith('EE'))      data.cell.styles.textColor = [39,174,96];
                else if (v.startsWith('ME')) data.cell.styles.textColor = [41,128,185];
                else if (v.startsWith('AE')) data.cell.styles.textColor = [243,156,18];
                else                         data.cell.styles.textColor = [231,76,60];
                data.cell.styles.fontStyle = 'bold';
            }
            if (data.section === 'body' && data.column.index === 0 && data.row.index < 3) {
                const colours = [[184,134,11],[120,120,120],[139,90,43]];
                data.cell.styles.textColor = colours[data.row.index];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7); doc.setTextColor(150,150,150);
        doc.text(`Page ${i} of ${totalPages}  |  Generated: ${new Date().toLocaleString()}`, pageWidth/2, doc.internal.pageSize.height - 4, { align: 'center' });
    }

    const grade = selectedGrade ? `_${selectedGrade.replace(/\s/g,'')}` : '_AllGrades';
    const termFilePart = `_${[...selectedGrades].map(g=>g.replace(/[^a-zA-Z0-9]/g,'_')).join('_')}`;
    doc.save(`League_Table${grade}${termFilePart}_${new Date().toISOString().split('T')[0]}.pdf`);
    NotificationManager.success(`<strong>League Table exported!</strong> (${termLabel})`, 3000);
}
window.generateLeagueTable = generateLeagueTable;

// ─── 4. SUBJECT ANALYSIS REPORT PDF ──────────────────────────────────────
async function generateSubjectAnalysis() {
    if (!window.jspdf) { alert('PDF library not loaded.'); return; }
    const { jsPDF } = window.jspdf;

    const selectedGrade = gradeFilter.value;
    let pool = selectedGrade
        ? studentsData.filter(s => s['Grade'] === selectedGrade)
        : studentsData;

    // ── Apply term filter ──────────────────────────────────────────────────
    pool = _filterPoolBySelectedGrades(pool);

    if (pool.length === 0) { NotificationManager.warning('No students found for the selected terms.'); return; }

    const termLabel = [...selectedGrades].join(' + ');
    const allSubjects = [...new Set(pool.flatMap(s => getSubjects(s)))];
    const logoRes = await loadLogo();
    const doc = new jsPDF('portrait');
    const pageWidth = doc.internal.pageSize.width;

    doc.setFillColor(41,128,185);
    doc.rect(0,0,pageWidth,20,'F');
    if (logoRes.ok) { try { doc.addImage(logoRes.img,'PNG',5,3,14,14); } catch(e) {} }
    doc.setTextColor(255,255,255);
    doc.setFontSize(13); doc.setFont(undefined,'bold');
    doc.text('SUBJECT ANALYSIS REPORT', pageWidth/2, 9, { align:'center' });
    doc.setFontSize(9); doc.setFont(undefined,'normal');
    const gradeLabel = selectedGrade || 'All Grades';
    doc.text(`${gradeLabel}  |  ${termLabel}  |  ${pool.length} students  |  ${new Date().toLocaleDateString()}`, pageWidth/2, 16, { align:'center' });

    const tableData = allSubjects.map(subj => {
        const scores = pool.map(s => parseFloat(s[subj])).filter(v => !isNaN(v));
        if (scores.length === 0) return { row: [subj, '-', '-', '-', '-', '-', '-'], avg: -1 };
        const avg   = scores.reduce((a,b)=>a+b,0) / scores.length;
        const high  = Math.max(...scores);
        const low   = Math.min(...scores);
        const pass  = scores.filter(v => v >= 41).length;
        const passRate = ((pass / scores.length) * 100).toFixed(0) + '%';
        const ee = scores.filter(v=>v>=75).length;
        const me = scores.filter(v=>v>=58&&v<75).length;
        const ae = scores.filter(v=>v>=31&&v<58).length;
        const be = scores.filter(v=>v<31).length;
        return { row: [subj, scores.length, avg.toFixed(1), high, low, passRate, `EE:${ee} ME:${me} AE:${ae} BE:${be}`], avg };
    })
    .sort((a, b) => b.avg - a.avg)
    .map(item => item.row);

    doc.autoTable({
        head: [['Learning Area','Assessed','Avg','Highest','Lowest','Pass Rate','Band Distribution']],
        body: tableData,
        startY: 24,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor:[41,128,185], textColor:[255,255,255], fontStyle:'bold' },
        columnStyles: {
            0:{cellWidth:55}, 1:{cellWidth:18}, 2:{cellWidth:15},
            3:{cellWidth:18}, 4:{cellWidth:15}, 5:{cellWidth:20}, 6:{cellWidth:45}
        },
        alternateRowStyles: { fillColor:[245,245,245] },
        margin: { left:10, right:10 },
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 5) {
                const v = parseInt(data.cell.raw);
                if (v >= 75)      data.cell.styles.textColor = [39,174,96];
                else if (v >= 50) data.cell.styles.textColor = [243,156,18];
                else              data.cell.styles.textColor = [231,76,60];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    doc.setFontSize(7); doc.setTextColor(150,150,150);
    doc.text(`Generated: ${new Date().toLocaleString()}  |  https://kanyadet-school-portal.web.app/`,
        pageWidth/2, doc.internal.pageSize.height - 5, { align:'center' });

    const grade = selectedGrade ? `_${selectedGrade.replace(/\s/g,'')}` : '_AllGrades';
    const termFilePart2 = `_${[...selectedGrades].map(g=>g.replace(/[^a-zA-Z0-9]/g,'_')).join('_')}`;
    doc.save(`Subject_Analysis${grade}${termFilePart2}_${new Date().toISOString().split('T')[0]}.pdf`);
    NotificationManager.success(`<strong>Subject Analysis exported!</strong> (${termLabel})`, 3000);
}
window.generateSubjectAnalysis = generateSubjectAnalysis;

// ─── 5. MISSING DATA HIGHLIGHTER ─────────────────────────────────────────
function highlightMissingScores(doc, student, tableStartY) {
    const subjects = getSubjects(student);
    const missing = subjects.filter(s => {
        const v = student[s];
        return v === null || v === undefined || v === '' || isNaN(parseFloat(v));
    });
    return missing;
}
window.highlightMissingScores = highlightMissingScores;

// ─── 6. DUPLICATE STUDENT DETECTOR ───────────────────────────────────────
function detectDuplicates() {
    if (studentsData.length === 0) {
        NotificationManager.warning('No data loaded yet.');
        return;
    }

    const byName = {};
    const byAdm  = {};
    const dupes  = [];

    studentsData.forEach(s => {
        const name = (s['Official Student Name'] || '').toLowerCase().trim();
        const adm  = (s['Assessment No'] || '').toLowerCase().trim();

        if (name) {
            if (!byName[name]) byName[name] = [];
            byName[name].push(s);
        }
        if (adm) {
            if (!byAdm[adm]) byAdm[adm] = [];
            byAdm[adm].push(s);
        }
    });

    Object.values(byName).filter(arr => arr.length > 1).forEach(arr => {
        dupes.push({ type: 'Duplicate Name', students: arr });
    });
    Object.values(byAdm).filter(arr => arr.length > 1).forEach(arr => {
        dupes.push({ type: 'Duplicate Adm No', students: arr });
    });

    if (dupes.length === 0) {
        NotificationManager.success('<strong>No duplicates found!</strong> All student records are unique.', 4000);
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'dupe-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center`;
    let rows = dupes.map(d => `
        <tr style="background:#fff3cd">
            <td style="padding:6px 10px;font-weight:bold;color:#856404">${d.type}</td>
            <td style="padding:6px 10px">${d.students.map(s => s['Official Student Name']).join(' / ')}</td>
            <td style="padding:6px 10px">${d.students.map(s => s['Assessment No'] || 'N/A').join(' / ')}</td>
            <td style="padding:6px 10px">${d.students.map(s => s['Grade'] || 'N/A').join(' / ')}</td>
        </tr>`).join('');

    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:24px;max-width:700px;width:95%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;color:#e74c3c">⚠️ ${dupes.length} Duplicate Issue(s) Found</h3>
                <button onclick="document.getElementById('dupe-modal').remove()" style="border:none;background:#e74c3c;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer">✕ Close</button>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#3498db;color:#fff">
                    <th style="padding:8px 10px;text-align:left">Issue</th>
                    <th style="padding:8px 10px;text-align:left">Names</th>
                    <th style="padding:8px 10px;text-align:left">Adm Numbers</th>
                    <th style="padding:8px 10px;text-align:left">Grades</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}
window.detectDuplicates = detectDuplicates;

// ─── 7. PER-GRADE PERFORMANCE DASHBOARD ──────────────────────────────────
function showGradeDashboard() {
    if (studentsData.length === 0) { NotificationManager.warning('No data loaded.'); return; }

    const selectedGrade = gradeFilter.value;
    let pool = selectedGrade
        ? studentsData.filter(s => s['Grade'] === selectedGrade)
        : studentsData;

    // ── Apply term filter ──────────────────────────────────────────────────
    pool = _filterPoolBySelectedGrades(pool);

    if (pool.length === 0) { NotificationManager.warning('No students found for the selected terms.'); return; }

    const termLabel = [...selectedGrades].join(' + ');

    let ee=0,me=0,ae=0,be=0, totalAvg=0;
    const gradeGroups = {};
    pool.forEach(s => {
        const stats = calculateStudentStats(s);
        const avg   = parseFloat(stats.average);
        totalAvg += avg;
        if (avg >= 75) ee++;
        else if (avg >= 58) me++;
        else if (avg >= 31) ae++;
        else be++;

        const g = extractGrade(s['Grade'] || '');
        if (!gradeGroups[g]) gradeGroups[g] = [];
        gradeGroups[g].push(avg);
    });
    const overallAvg = (totalAvg / pool.length).toFixed(1);
    const total = pool.length;

    const allSubjects = [...new Set(pool.flatMap(s => getSubjects(s)))];
    const subjAvgs = allSubjects.map(subj => {
        const sc = pool.map(s => parseFloat(s[subj])).filter(v => !isNaN(v));
        return { subj, avg: sc.length ? (sc.reduce((a,b)=>a+b,0)/sc.length).toFixed(1) : 0 };
    }).sort((a,b) => b.avg - a.avg);

    const bandBar = (count, tot, colour) => {
        const pct = tot ? ((count/tot)*100).toFixed(0) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0">
            <div style="width:80px;text-align:right;font-size:12px;color:#555">${pct}% (${count})</div>
            <div style="flex:1;background:#eee;border-radius:4px;height:14px">
                <div style="width:${pct}%;background:${colour};height:100%;border-radius:4px;transition:width .4s"></div>
            </div>
        </div>`;
    };

    const subjRows = subjAvgs.map(({subj, avg}) => {
        const col = avg>=75?'#27ae60':avg>=58?'#2980b9':avg>=31?'#f39c12':'#e74c3c';
        const band = avg>=75?'EE':avg>=58?'ME':avg>=31?'AE':'BE';
        return `<tr>
            <td style="padding:5px 10px;font-size:12px">${subj}</td>
            <td style="padding:5px 10px;text-align:center;font-weight:bold;color:${col}">${avg}%</td>
            <td style="padding:5px 10px;text-align:center">
                <span style="background:${col};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:bold">${band}</span>
            </td>
            <td style="padding:5px 10px">
                <div style="background:#eee;border-radius:4px;height:10px;width:100%">
                    <div style="width:${avg}%;background:${col};height:100%;border-radius:4px"></div>
                </div>
            </td>
        </tr>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id = 'dashboard-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px`;
    modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:28px;max-width:760px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.35)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div>
                    <h2 style="margin:0;color:#2c3e50">📊 Performance Dashboard</h2>
                    <p style="margin:4px 0 0;color:#777;font-size:13px">${selectedGrade || 'All Grades'}  ·  ${termLabel}  ·  ${total} students  ·  Overall Avg: <strong>${overallAvg}%</strong></p>
                </div>
                <button onclick="document.getElementById('dashboard-modal').remove()" style="border:none;background:#e74c3c;color:#fff;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:14px">✕ Close</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
                ${[['EE','Exceeding',ee,'#27ae60'],['ME','Meeting',me,'#2980b9'],['AE','Approaching',ae,'#f39c12'],['BE','Below',be,'#e74c3c']]
                    .map(([code,label,count,col]) => `
                    <div style="background:${col}15;border:1.5px solid ${col};border-radius:10px;padding:12px;text-align:center">
                        <div style="font-size:22px;font-weight:800;color:${col}">${count}</div>
                        <div style="font-size:11px;font-weight:700;color:${col}">${code}</div>
                        <div style="font-size:10px;color:#666">${label}</div>
                        <div style="font-size:10px;color:#888">${total?((count/total)*100).toFixed(0):0}%</div>
                    </div>`).join('')}
            </div>
            <div style="background:#f8f9fa;border-radius:10px;padding:16px;margin-bottom:20px">
                <h4 style="margin:0 0 10px;color:#2c3e50;font-size:13px">BAND DISTRIBUTION</h4>
                <div style="display:grid;grid-template-columns:60px 1fr;align-items:center;gap:4px;font-size:12px">
                    <span style="color:#27ae60;font-weight:bold">EE</span>${bandBar(ee,total,'#27ae60')}
                    <span style="color:#2980b9;font-weight:bold">ME</span>${bandBar(me,total,'#2980b9')}
                    <span style="color:#f39c12;font-weight:bold">AE</span>${bandBar(ae,total,'#f39c12')}
                    <span style="color:#e74c3c;font-weight:bold">BE</span>${bandBar(be,total,'#e74c3c')}
                </div>
            </div>
            <div>
                <h4 style="margin:0 0 10px;color:#2c3e50;font-size:13px">SUBJECT AVERAGES</h4>
                <div style="max-height:260px;overflow-y:auto;border:1px solid #eee;border-radius:8px">
                    <table style="width:100%;border-collapse:collapse">
                        <thead style="position:sticky;top:0;background:#3498db;color:#fff">
                            <tr><th style="padding:8px 10px;text-align:left;font-size:12px">Subject</th>
                            <th style="padding:8px 10px;font-size:12px">Average</th>
                            <th style="padding:8px 10px;font-size:12px">Band</th>
                            <th style="padding:8px 10px;font-size:12px;width:30%">Bar</th></tr>
                        </thead>
                        <tbody>${subjRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}
window.showGradeDashboard = showGradeDashboard;

// ─── 8. EXPORT TO EXCEL ───────────────────────────────────────────────────
function exportToExcel() {
    if (!window.XLSX) {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = () => _doExportToExcel();
        document.head.appendChild(s);
    } else {
        _doExportToExcel();
    }
}

function _doExportToExcel() {
    const selectedGrade = gradeFilter.value;
    let pool = selectedGrade
        ? studentsData.filter(s => s['Grade'] === selectedGrade)
        : studentsData;

    // ── Apply term filter ──────────────────────────────────────────────────
    pool = _filterPoolBySelectedGrades(pool);

    if (pool.length === 0) { NotificationManager.warning('No data to export for the selected terms.'); return; }

    const termLabel = [...selectedGrades].join(' + ');

    const sorted = [...pool].sort((a,b) =>
        parseFloat(calculateStudentStats(b).average) - parseFloat(calculateStudentStats(a).average)
    );

    const dynSubjects = [...new Set(sorted.flatMap(s => getSubjects(s)))];

    const headers = ['#','Name','Adm No','UPI','Gender','Grade','Term',
        ...dynSubjects, 'Total Marks','Avg %','Total Points','Max Points','Level'];

    const rows = sorted.map((s, i) => {
        const st = calculateStudentStats(s);
        return [
            i+1,
            s['Official Student Name'] || '',
            s['Assessment No'] || '',
            s['UPI'] || '',
            s['Gender'] || '',
            s['Grade'] || '',
            s['Term'] || '',
            ...dynSubjects.map(subj => {
                const v = parseFloat(s[subj]);
                return isNaN(v) ? '' : v;
            }),
            parseFloat(st.total),
            parseFloat(st.average),
            parseFloat(st.totalPoints),
            st.maxPoints,
            st.comment
        ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
        {wch:5},{wch:30},{wch:15},{wch:12},{wch:10},{wch:25},{wch:20},
        ...dynSubjects.map(()=>({wch:14})),
        {wch:12},{wch:10},{wch:12},{wch:12},{wch:30}
    ];

    const wb = XLSX.utils.book_new();
    const sheetName = selectedGrade ? selectedGrade.replace(/[^a-zA-Z0-9]/g,'').substring(0,28) : 'AllStudents';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const grade   = selectedGrade ? `_${selectedGrade.replace(/\s/g,'')}` : '_AllGrades';
    const termPart = `_${[...selectedGrades].map(g=>g.replace(/[^a-zA-Z0-9]/g,'_')).join('_')}`;
    XLSX.writeFile(wb, `Kanyadet_Results${grade}${termPart}_${new Date().toISOString().split('T')[0]}.xlsx`);
    NotificationManager.success(`<strong>Excel exported!</strong> (${termLabel})`, 3000);
}
window.exportToExcel = exportToExcel;

// ─── 9. PREVIEW BEFORE PRINT ─────────────────────────────────────────────
async function previewReportCard(studentId) {
    const student = studentsData.find(s => s.id === studentId);
    if (!student) { NotificationManager.error('Student not found.'); return; }

    NotificationManager.info('Generating preview...', 2000);
    const doc = await generateStudentReportCard(student, true);
    if (!doc) return;

    const blob   = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);

    const modal = document.createElement('div');
    modal.id = 'preview-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px`;
    modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:100%;max-width:820px;height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.4)">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid #eee">
                <strong style="color:#2c3e50">📄 Report Card Preview — ${student['Official Student Name'] || ''}</strong>
                <div style="display:flex;gap:8px">
                    <button onclick="window.open('${blobUrl}','_blank')" style="border:none;background:#27ae60;color:#fff;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:13px">⬇ Download</button>
                    <button onclick="document.getElementById('preview-modal').remove();URL.revokeObjectURL('${blobUrl}')" style="border:none;background:#e74c3c;color:#fff;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:13px">✕ Close</button>
                </div>
            </div>
            <iframe src="${blobUrl}" style="flex:1;border:none;border-radius:0 0 12px 12px"></iframe>
        </div>`;
    document.body.appendChild(modal);
}
window.previewReportCard = previewReportCard;

// ─── 10. BULK WHATSAPP/SMS SHARE ─────────────────────────────────────────
function generateWhatsAppText(student) {
    const stats = calculateStudentStats(student);
    const subjects = getSubjects(student);
    const termLabel = [...selectedGrades].join(' + ');
    const lines = subjects.map(subj => {
        const sc = student[subj];
        const gi = getGradeFromScore(sc);
        return `  • ${subj}: ${sc} (${gi.grade}pts — ${(gi.comment.match(/\b(EE|ME|AE|BE)\d\b/)?.[0] || gi.comment)})`;
    });

    return [
        `🏫 *KANYADET PRI & JUNIOR SCHOOL*`,
        `📋 *Student Report — ${termLabel}*`,
        ``,
        `👤 *${student['Official Student Name'] || 'N/A'}*`,
        `🆔 Adm: ${student['Assessment No'] || 'N/A'}  |  ${student['Grade'] || 'N/A'}`,
        ``,
        `📚 *ACADEMIC PERFORMANCE*`,
        ...lines,
        ``,
        `📊 *SUMMARY*`,
        `  Perc rating ${stats.average}%`,
        `  Total Points: ${stats.totalPoints} / ${stats.maxPoints}`,
        `  Performance Level: ${stats.comment}`,
        `  Position: ${student['Position'] || 'N/A'}`,
        ``,
        `_Generated by Kanyadet School System_`
    ].join('\n');
}

function showWhatsAppShare(studentId) {
    const student = studentsData.find(s => s.id === studentId);
    if (!student) { NotificationManager.error('Student not found.'); return; }

    const text = generateWhatsAppText(student);
    const encoded = encodeURIComponent(text);

    const modal = document.createElement('div');
    modal.id = 'whatsapp-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px`;
    modal.innerHTML = `
        <div style="background:#fff;border-radius:14px;padding:24px;max-width:560px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h3 style="margin:0;color:#25D366">📲 Share via WhatsApp / SMS</h3>
                <button onclick="document.getElementById('whatsapp-modal').remove()" style="border:none;background:#e74c3c;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer">✕</button>
            </div>
            <textarea readonly style="width:100%;height:200px;border:1px solid #ddd;border-radius:8px;padding:10px;font-size:12px;font-family:monospace;resize:none">${text}</textarea>
            <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
                <a href="https://wa.me/?text=${encoded}" target="_blank"
                   style="flex:1;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;padding:10px;text-align:center;font-weight:bold;font-size:13px">
                   💬 Open in WhatsApp
                </a>
                <button onclick="navigator.clipboard.writeText(document.querySelector('#whatsapp-modal textarea').value).then(()=>NotificationManager.success('Copied!',2000))"
                   style="flex:1;background:#3498db;color:#fff;border:none;border-radius:8px;padding:10px;cursor:pointer;font-weight:bold;font-size:13px">
                   📋 Copy Text
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}
window.showWhatsAppShare = showWhatsAppShare;

function bulkWhatsAppExport() {
    const selectedGrade = gradeFilter.value;
    let pool = selectedGrade
        ? studentsData.filter(s => s['Grade'] === selectedGrade)
        : studentsData;

    // ── Apply term filter ──────────────────────────────────────────────────
    pool = _filterPoolBySelectedGrades(pool);

    if (pool.length === 0) { NotificationManager.warning('No students found for the selected terms.'); return; }

    const termLabel = [...selectedGrades].join(' + ');
    pool = [...pool].sort((a,b) => parseFloat(calculateStudentStats(b).average) - parseFloat(calculateStudentStats(a).average));
    const allText = pool.map(s => generateWhatsAppText(s)).join('\n\n' + '─'.repeat(50) + '\n\n');
    const blob = new Blob([allText], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const grade = selectedGrade ? `_${selectedGrade.replace(/\s/g,'')}` : '_AllGrades';
    const termPart = `_${[...selectedGrades].map(g=>g.replace(/[^a-zA-Z0-9]/g,'_')).join('_')}`;
    a.download = `WhatsApp_Messages${grade}${termPart}_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    NotificationManager.success(`<strong>${pool.length} WhatsApp messages exported!</strong> (${termLabel})`, 3000);
}
window.bulkWhatsAppExport = bulkWhatsAppExport;

// ─── INJECT NEW BUTTONS INTO UI ───────────────────────────────────────────
function addNewFeatureButtons() {
    if (document.getElementById('new-features-controls')) return;

    const container = document.getElementById('report-card-controls') || document.querySelector('.controls');
    if (!container) return;

    const div = document.createElement('div');
    div.id = 'new-features-controls';
    div.style.cssText = `
        display:flex;flex-wrap:wrap;gap:10px;align-items:center;
        padding:14px 16px;border-radius:12px;margin:0 26px 16px;
        background:linear-gradient(135deg,#f8f9fa,#e9ecef);
        border:1px solid #dee2e6;box-shadow:0 2px 8px rgba(0,0,0,.08)`;

    div.innerHTML = `
        <span style="font-size:12px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.05em;width:100%;margin-bottom:2px">⚡ Advanced Tools</span>
        <button onclick="generateLeagueTable()" style="padding:9px 16px;background:#8e44ad;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(142,68,173,.3)">
            🏆 League Table
        </button>
        <button onclick="generateSubjectAnalysis()" style="padding:9px 16px;background:#16a085;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(22,160,133,.3)">
            📈 Subject Analysis
        </button>
        <button onclick="showGradeDashboard()" style="padding:9px 16px;background:#2980b9;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(41,128,185,.3)">
            📊 Grade Dashboard
        </button>
        <button onclick="exportToExcel()" style="padding:9px 16px;background:#27ae60;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(39,174,96,.3)">
            📥 Export Excel
        </button>
        <button onclick="bulkWhatsAppExport()" style="padding:9px 16px;background:#25D366;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(37,211,102,.3)">
            💬 Bulk WhatsApp
        </button>
        <button onclick="detectDuplicates()" style="padding:9px 16px;background:#e74c3c;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;box-shadow:0 3px 8px rgba(231,76,60,.3)">
            🔍 Find Duplicates
        </button>
    `;

    const refNode = document.getElementById('report-card-controls') || container;
    refNode.parentElement.insertBefore(div, refNode.nextSibling);
}

const _origAddReportCardControls = addReportCardControls;
window.addReportCardControls = function() {
    _origAddReportCardControls();
    addNewFeatureButtons();
};

document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-preview-id]');
    if (btn) { previewReportCard(btn.dataset.previewId); return; }
    const wbtn = e.target.closest('[data-whatsapp-id]');
    if (wbtn) { showWhatsAppShare(wbtn.dataset.whatsappId); }
});
