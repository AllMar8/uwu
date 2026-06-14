(function(){
  if (window.__yss_fallback_installed) return;
  window.__yss_fallback_installed = true;

  try {
    var inject = function(p) {
      try {
        var s = document.createElement('script');
        s.src = chrome.runtime.getURL(p);
        s.async = true;
        (document.head || document.documentElement || document.body).appendChild(s);
      } catch(e) {}
    };
    inject('message_shim.js');
    inject('voices_helper.js');
    inject('debug_probe.js');
  } catch(e) {}

  // Patch YSS button: click toggles panel, hover does nothing
  try {
    function patchYSSButton() {
      var btn = document.querySelector('.yss-control-button');
      if (!btn || btn.getAttribute('data-yss-patched')) return;
      btn.setAttribute('data-yss-patched', '1');

      // Prevent hover from showing the panel; only allow via click
      btn.addEventListener('mouseover', function(e) {
        if (e.target !== btn) return;
        if (window.__yss_allow_mouseover) { window.__yss_allow_mouseover = false; return; }
        e.stopImmediatePropagation();
      }, true);
      // When panel is open by click, block all mouseout from button/subtree
      btn.addEventListener('mouseout', function(e) {
        if (btn.__yss_click_open) { e.stopImmediatePropagation(); return; }
        if (e.target !== btn) return;
        e.stopImmediatePropagation();
      }, true);

      function setClickOpen(v){
        btn.__yss_click_open = v;
        var panel = document.querySelector('.yss-menu-panel');
        if(panel) panel.__yss_click_open = v;
      }

      btn.addEventListener('click', function(e) {
        if (e.target !== btn && !btn.contains(e.target)) return; // let panel children clicks pass through
        e.stopImmediatePropagation();
        var panel = document.querySelector('.yss-menu-panel');
        if (panel) {
          var isHidden = panel.getAttribute('yss-panel-active') === 'false';
          if (isHidden) {
            setClickOpen(true);
            panel.removeAttribute('yss-panel-active');
          } else {
            setClickOpen(false);
            panel.setAttribute('yss-panel-active', 'false');
          }
        } else {
          window.__yss_allow_mouseover = true;
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          var p = document.querySelector('.yss-menu-panel');
          if (p) {
            setClickOpen(true);
          }
        }
      }, true);
    }

    // Intercept YSS panel visibility changes: only allow click-driven toggles
    function watchPanel() {
      var panel = document.querySelector('.yss-menu-panel');
      if (panel && !panel.getAttribute('data-yss-panel-watched')) {
        panel.setAttribute('data-yss-panel-watched', '1');
        var panelObs = new MutationObserver(function(muts) {
          muts.forEach(function(mut) {
            if (mut.type !== 'attributes' || mut.attributeName !== 'yss-panel-active') return;
            var val = mut.target.getAttribute('yss-panel-active');
            if (val === 'false' && mut.target.__yss_click_open) {
              // YSS tries to hide panel opened by click → revert
              mut.target.removeAttribute('yss-panel-active');
              if (window.YSS && window.YSS._debugTTS) console.log('[YSS] Blocked hide');
            } else if (val !== 'false' && !mut.target.__yss_click_open) {
              // YSS tries to show panel without click → hide
              mut.target.setAttribute('yss-panel-active', 'false');
              if (window.YSS && window.YSS._debugTTS) console.log('[YSS] Blocked show');
            }
          });
        });
        panelObs.observe(panel, { attributes: true, attributeFilter: ['yss-panel-active'] });
      }
    }

    patchYSSButton();
    watchPanel();
    var obs = new MutationObserver(function() { patchYSSButton(); watchPanel(); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  } catch(e) {}

  // --- YSS Menu Locale Override ---
  try {
    var localeOverrides = {
      'Terreno de juego': 'Tono',
      'Discapacitado': 'Desactivado',
      'Ahorrar': 'Guardar'
    };
    function fixLocale() {
      document.querySelectorAll('.ytp-menuitem .ytp-menuitem-label span').forEach(function(el) {
        var fixed = localeOverrides[el.textContent];
        if (fixed) el.textContent = fixed;
      });
    }
    var localeObs = new MutationObserver(fixLocale);
    if (document.body) localeObs.observe(document.body, { childList: true, subtree: true });
  } catch(e) {}

  // --- Sync Offset Management ---
  try {
    window.YSS = window.YSS || {};
    window.YSS.syncOffsetMs = 0;

    var offsetFetchTimer = null;

    function fetchSyncOffset() {
      try {
        var id = chrome && chrome.runtime && chrome.runtime.id;
        if (id) {
          chrome.runtime.sendMessage(id, {options: true}, {}, function(r) {
            if (r && r.options && r.options.sync_offset_ms != null) {
              window.YSS.syncOffsetMs = parseInt(r.options.sync_offset_ms) || 0;
            }
          });
        }
      } catch(e) {}
      offsetFetchTimer = setTimeout(fetchSyncOffset, 3000);
    }

    function wrapPlayerTime() {
      var p = document.querySelector('#movie_player');
      if (!p || typeof p.getCurrentTime !== 'function') {
        setTimeout(wrapPlayerTime, 500);
        return;
      }

      if (p.getCurrentTime && !p.getCurrentTime.__yss_wrapped) {
        var origCT = p.getCurrentTime.bind(p);
        p.getCurrentTime = function() {
          var off = window.YSS.syncOffsetMs || 0;
          return (origCT() || 0) + off / 1000;
        };
        p.getCurrentTime.__yss_wrapped = true;
      }

      if (p.getMediaReferenceTime && !p.getMediaReferenceTime.__yss_wrapped) {
        var origMRT = p.getMediaReferenceTime.bind(p);
        p.getMediaReferenceTime = function() {
          var off = window.YSS.syncOffsetMs || 0;
          return (origMRT() || 0) + off / 1000;
        };
        p.getMediaReferenceTime.__yss_wrapped = true;
      }
    }

    setTimeout(fetchSyncOffset, 1000);
    setTimeout(wrapPlayerTime, 1500);

    var playerWatchObs = new MutationObserver(function() {
      wrapPlayerTime();
    });
    if (document.body) {
      playerWatchObs.observe(document.body, { childList: true, subtree: true });
    }
  } catch(e) {}
})();