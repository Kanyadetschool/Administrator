/* ============================================================
   image-popup.js  — Kanyadet Premium Popup System v2.0
   Glass morphism · Navy/Gold · Cinematic micro-interactions
   ============================================================ */

(function () {
  'use strict';

  /* ── Guard ── */
  if (typeof Swal === 'undefined') {
    console.error('[Popup] SweetAlert2 not found. Add <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>');
    return;
  }

  /* ── Config ── */
  const CFG = {
    BACKDROP_BLUR : '12px',
    BACKDROP_COLOR: 'rgba(4, 8, 28, 0.72)',
    POPUP_BG      : 'rgba(255,255,255,0.07)',
    BORDER_COLOR  : 'rgba(255,255,255,0.14)',
    GOLD          : '#c9a84c',
    GOLD_LIGHT    : '#f0d080',
    NAVY          : '#0a0e2e',
    ANIM_MS       : 320,
    IMG_RADIUS    : '16px',
    POPUP_RADIUS  : '24px',
  };

  /* ── Inject global styles once ── */
  if (!document.getElementById('kps-popup-styles')) {
    const s = document.createElement('style');
    s.id = 'kps-popup-styles';
    s.textContent = `
      /* ── Keyframes ── */
      @keyframes kps-drop-in {
        from { opacity:0; transform: translateY(-18px) scale(0.96); }
        to   { opacity:1; transform: translateY(0)     scale(1);    }
      }
      @keyframes kps-fade-out {
        from { opacity:1; transform: scale(1);    }
        to   { opacity:0; transform: scale(0.95); }
      }
      @keyframes kps-shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }
      @keyframes kps-corner-pulse {
        0%,100% { opacity: 0.5; }
        50%      { opacity: 1;   }
      }

      /* ── Backdrop ── */
      .kps-backdrop.swal2-backdrop-show {
        background: ${CFG.BACKDROP_COLOR} !important;
        backdrop-filter: blur(${CFG.BACKDROP_BLUR}) !important;
        -webkit-backdrop-filter: blur(${CFG.BACKDROP_BLUR}) !important;
      }

      /* ── Popup shell ── */
      .kps-popup {
        background: ${CFG.POPUP_BG} !important;
        border: 1px solid ${CFG.BORDER_COLOR} !important;
        border-radius: ${CFG.POPUP_RADIUS} !important;
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.04),
          0 32px 64px rgba(0,0,0,0.55),
          0 0 80px rgba(201,168,76,0.06) !important;
        backdrop-filter: blur(28px) saturate(160%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(160%) !important;
        overflow: hidden !important;
        padding: 0 !important;
        color: #fff !important;
        font-family: "Galano Grotesque", "Poppins", "Montserrat", sans-serif !important;
        animation: kps-drop-in ${CFG.ANIM_MS}ms cubic-bezier(.22,.68,0,1.2) !important;
      }
      .kps-popup.swal2-hide {
        animation: kps-fade-out ${CFG.ANIM_MS * 0.7}ms ease forwards !important;
      }

      /* Gold top bar */
      .kps-popup::before {
        content: '';
        display: block;
        height: 3px;
        width: 100%;
        background: linear-gradient(90deg, transparent, ${CFG.GOLD}, ${CFG.GOLD_LIGHT}, ${CFG.GOLD}, transparent);
      }

      /* ── Close button ── */
      .kps-close {
        width: 32px !important;
        height: 32px !important;
        background: rgba(255,255,255,0.08) !important;
        border-radius: 50% !important;
        border: 1px solid rgba(255,255,255,0.12) !important;
        color: rgba(255,255,255,0.6) !important;
        font-size: 18px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: background 0.2s, color 0.2s, transform 0.15s !important;
        cursor: pointer !important;
        margin: 12px 12px 0 auto !important;
      }
      .kps-close:hover {
        background: rgba(201,168,76,0.18) !important;
        color: ${CFG.GOLD_LIGHT} !important;
        transform: rotate(90deg) scale(1.1) !important;
      }
      .kps-close:focus { outline: none !important; }

      /* ── Image wrapper ── */
      .kps-img-container {
        position: relative;
        margin: 0;
        padding: 0;
      }

      /* ── Image itself ── */
      .kps-image {
        max-width: 100% !important;
        max-height: 72vh !important;
        width: auto !important;
        height: auto !important;
        object-fit: contain !important;
        display: block !important;
        margin: 0 auto !important;
        border-radius: 0 !important;
        transition: transform 0.35s cubic-bezier(.22,.68,0,1.15) !important;
        cursor: zoom-in !important;
      }
      .kps-image.zoomed {
        transform: scale(1.9) !important;
        cursor: zoom-out !important;
        z-index: 2 !important;
      }

      /* Corner brackets */
      .kps-corner {
        position: absolute;
        width: 22px;
        height: 22px;
        border-color: ${CFG.GOLD};
        border-style: solid;
        animation: kps-corner-pulse 2.4s ease-in-out infinite;
        pointer-events: none;
        z-index: 3;
      }
      .kps-corner-tl { top:12px; left:12px; border-width:2px 0 0 2px; border-radius:5px 0 0 0; }
      .kps-corner-tr { top:12px; right:12px; border-width:2px 2px 0 0; border-radius:0 5px 0 0; animation-delay:0.6s; }
      .kps-corner-bl { bottom:12px; left:12px; border-width:0 0 2px 2px; border-radius:0 0 0 5px; animation-delay:1.2s; }
      .kps-corner-br { bottom:12px; right:12px; border-width:0 2px 2px 0; border-radius:0 0 5px 0; animation-delay:1.8s; }

      /* Shimmer loading state */
      .kps-img-loading {
        height: 300px;
        background: linear-gradient(
          90deg,
          rgba(255,255,255,0.04) 0%,
          rgba(201,168,76,0.1) 45%,
          rgba(255,255,255,0.04) 100%
        );
        background-size: 200% 100%;
        animation: kps-shimmer 1.6s linear infinite;
        border-radius: 0;
      }

      /* ── Info strip ── */
      .kps-info {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 16px 14px;
        border-top: 1px solid rgba(255,255,255,0.07);
        background: rgba(0,0,0,0.18);
      }
      .kps-info-left {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(255,255,255,0.45);
        font-size: 12px;
      }
      .kps-info-left span { color: rgba(255,255,255,0.75); }
      .kps-zoom-hint {
        font-size: 11px;
        color: rgba(201,168,76,0.7);
        display: flex;
        align-items: center;
        gap: 4px;
        letter-spacing: 0.03em;
      }

      /* ── Tooltip on img hover ── */
      .kps-tooltip {
        position: absolute;
        bottom: 48px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.7);
        color: rgba(255,255,255,0.85);
        font-size: 11px;
        padding: 4px 10px;
        border-radius: 99px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
        white-space: nowrap;
        z-index: 10;
        border: 1px solid rgba(255,255,255,0.08);
      }

      /* ── Responsive ── */
      @media (max-width: 600px) {
        .kps-popup { border-radius: 20px !important; }
        .kps-image { max-height: 60vh !important; }
        .kps-info { padding: 8px 12px 12px; }
        .kps-info-left { font-size: 11px; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Build HTML content ── */
  function buildContent(img) {
    const src  = img.src  || '';
    const alt  = img.alt  || 'Student Photo';
    const name = img.dataset.name  || alt;
    const grade = img.dataset.grade || img.dataset.class || '';
    const admNo = img.dataset.admNo || img.dataset.assessmentNumber || '';

    const metaHtml = (grade || admNo) ? `
      <div class="kps-info">
        <div class="kps-info-left">
          ${name !== 'Student Photo' ? `<span>${name}</span>` : ''}
          ${grade ? `<span style="opacity:0.45">·</span><span style="opacity:0.7">${grade}</span>` : ''}
          ${admNo ? `<span style="opacity:0.45">·</span><span style="color:${CFG.GOLD};opacity:0.85">#${admNo}</span>` : ''}
        </div>
        <div class="kps-zoom-hint">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          tap to zoom
        </div>
      </div>` : '';

    return `
      <div class="kps-img-container" id="kps-ic">
        <div class="kps-img-loading" id="kps-shimmer"></div>
        <img
          id="kps-mainimg"
          src="${src}"
          alt="${alt}"
          class="kps-image"
          style="display:none;"
          draggable="false"
        />
        <div class="kps-corner kps-corner-tl" aria-hidden="true"></div>
        <div class="kps-corner kps-corner-tr" aria-hidden="true"></div>
        <div class="kps-corner kps-corner-bl" aria-hidden="true"></div>
        <div class="kps-corner kps-corner-br" aria-hidden="true"></div>
      </div>
      ${metaHtml}
    `;
  }

  /* ── Fire the popup ── */
  function openPopup(img) {
    Swal.fire({
      html            : buildContent(img),
      showCloseButton : true,
      showConfirmButton: false,
      background      : 'transparent',
      padding         : '0',
      width           : 'min(92vw, 560px)',
      customClass: {
        container: 'kps-backdrop',
        popup    : 'kps-popup',
        closeButton: 'kps-close',
      },
      didOpen: () => {
        const mainImg = document.getElementById('kps-mainimg');
        const shimmer = document.getElementById('kps-shimmer');
        if (!mainImg || !shimmer) return;

        /* Reveal image after load */
        const revealImage = () => {
          shimmer.style.display = 'none';
          mainImg.style.display = 'block';
        };

        if (mainImg.complete && mainImg.naturalWidth) {
          revealImage();
        } else {
          mainImg.addEventListener('load', revealImage);
          mainImg.addEventListener('error', () => {
            shimmer.style.background = 'rgba(255,255,255,0.04)';
            shimmer.style.animation  = 'none';
            shimmer.innerHTML = `
              <div style="height:100%;display:flex;flex-direction:column;align-items:center;
                          justify-content:center;color:rgba(255,255,255,0.3);gap:8px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="1.5" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span style="font-size:13px;">Photo unavailable</span>
              </div>`;
          });
        }

        /* Tap-to-zoom */
        let zoomed = false;
        mainImg.addEventListener('click', (e) => {
          e.stopPropagation();
          zoomed = !zoomed;
          mainImg.classList.toggle('zoomed', zoomed);
        });
      },
    });
  }

  /* ── Event delegation — catches any image click ── */
  document.body.addEventListener('click', (e) => {
    if (!e.target.matches('img')) return;
    e.preventDefault();
    e.stopPropagation(); // stops tr onclick / parent handlers from firing
    openPopup(e.target);
  });

  /* ── Keyboard: Escape closes (SweetAlert2 handles this, but guard anyway) ── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && Swal.isVisible()) Swal.close();
  });

  console.info('[Kanyadet Popup] Premium system v2.0 ready ✓');
})();
