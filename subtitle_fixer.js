(function(){
  try{
    if(!window.speechSynthesis) return;
    window.YSS = window.YSS || {};
    // If DubbingEngine active, skip TTS parts (still download subs and manage UI)
    function _dubEngineActive(){ return window.YSS && window.YSS._dubbingEnabled === true; }

    // --- SAFETY NET: catch <video> the instant it appears, zero volume before any audio plays ---
    try {
      var _mo = new MutationObserver(function(muts){
        for(var _i=0;_i<muts.length;_i++){
          var _added = muts[_i].addedNodes;
          for(var _j=0;_j<_added.length;_j++){
            if(_added[_j].tagName === 'VIDEO'){ _added[_j].volume = 0; _mo.disconnect(); return; }
            if(_added[_j].querySelectorAll){
              var _vids = _added[_j].querySelectorAll('video');
              for(var _k=0;_k<_vids.length;_k++){ _vids[_k].volume = 0; _mo.disconnect(); return; }
            }
          }
        }
      });
      var _target = document.body || document.documentElement || document;
      if(_target) _mo.observe(_target, { childList: true, subtree: true });
    } catch(e){}
    // Also check if video already exists
    try {
      var _zv = document.querySelector('video');
      if(_zv) _zv.volume = 0;
    } catch(e){}

    // --- MUST run FIRST: Patch speechSynthesis.speak() to block YSS bundle speech ---
    try {
      window.YSS._browserSpeak = SpeechSynthesis.prototype.speak.bind(window.speechSynthesis);
      window.YSS._origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.YSS._lastSpeakTime = 0;
      window.speechSynthesis.speak = function(utterance){
        try{
          if(utterance && utterance.text && !utterance.__yss_custom){
            return;
          }
          if(utterance && utterance.text){
            window.YSS._lastSpeakTime = Date.now();
            if(utterance.voice) window.YSS._cachedVoice = utterance.voice;
            if(typeof utterance.rate !== 'undefined' && utterance.rate !== 1) window.YSS._cachedRate = utterance.rate;
            if(typeof utterance.pitch !== 'undefined' && utterance.pitch !== 1) window.YSS._cachedPitch = utterance.pitch;
            if(typeof utterance.volume !== 'undefined' && utterance.volume !== 1) window.YSS._cachedVolume = utterance.volume;
          }
        }catch(e){}
        return (window.YSS._browserSpeak || window.speechSynthesis.speak)(utterance);
      };
      // Clear any bundled YSS utterances that were queued before our override
      window.speechSynthesis.cancel();
    }catch(e){}
    // Init tracking counters
    window.YSS._yssSpokenTexts = {};
    window.YSS._yssSpokenCount = 0;
    window.YSS._yssLastSpeakTime = 0;
    window.YSS._yss_spokenRegistry = new Map();
    window.YSS._yss_safeSpeak = function(text, cooldownMs){
      if(typeof cooldownMs === 'undefined') cooldownMs = 30000;
      var last = window.YSS._yss_spokenRegistry.get(text);
      var now = Date.now();
      if(last && now - last < cooldownMs) return false;
      window.YSS._yss_spokenRegistry.set(text, now);
      return true;
    };
    window.YSS._poToken = null;
    window.YSS._inAd = false;
    window.YSS._firstTtsCompleted = false;

    // Listen for POT token from injected.js (needed for YouTube subtitle API)
    window.addEventListener('__YSS_POT', function(e){
      window.YSS._poToken = e.detail;
    });

    // --- Ad detection: pause TTS during ads ---
    function _checkAd(){
      var ad = document.querySelector('.video-ads.ytp-ad-module');
      if(ad && ad.children.length > 0){
        if(!window.YSS._inAd){
          window.YSS._inAd = true;
          window.speechSynthesis.cancel();
          window.YSS._pausedForAd = true;
        }
      } else {
        if(window.YSS._inAd){
          window.YSS._inAd = false;
        }
      }
    }
    setInterval(_checkAd, 1000);

    // --- Safe storage helpers ---
    function safeStorageSync(){
      if(typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return null;
      return chrome.storage.sync;
    }
    function safeStorageSyncGet(keys, callback){
      var store = safeStorageSync();
      if(store && typeof store.get === 'function'){
        try { store.get(keys, callback); return true; } catch(e){}
      }
      if(typeof callback === 'function') callback({});
      return false;
    }
    function safeStorageSyncSet(items){
      var store = safeStorageSync();
      if(store && typeof store.set === 'function'){
        try { store.set(items); return true; } catch(e){}
      }
      return false;
    }

    // --- Detect user's target language from YSS options ---
    window.YSS._targetLang = 'es'; // default
    try {
      safeStorageSyncGet(['translate_lang', 'options'], function(d){
        if(d && d.translate_lang) window.YSS._targetLang = d.translate_lang;
        else if(d && d.options && d.options.translate_lang) window.YSS._targetLang = d.options.translate_lang;
        console.log('[YSS] Target language:', window.YSS._targetLang);
      });
    }catch(e){}
    // Also listen for storage changes to update target language
    try {
      chrome.storage.onChanged.addListener(function(c,a){
        if(a==='sync' || a==='local'){
          if(c.translate_lang) window.YSS._targetLang = c.translate_lang.newValue;
          if(c.options && c.options.newValue && c.options.newValue.translate_lang) window.YSS._targetLang = c.options.newValue.translate_lang;
        }
      });
    }catch(e){}

    // --- Block YSS bundle's timedtext retries once we have subs ---
    // The YSS bundle repeatedly fetches /api/timedtext. Once we have our own
    // subtitles (bundled or InnerTube), block these to stop the 429 flood.
    // Block XHR requests to the deprecated timedtext API once we have subs loaded
    if(!window.YSS._xhrPatched){
      window.YSS._xhrPatched = true;
      var _origXhrOpen = XMLHttpRequest.prototype.open;
      var _origXhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url){
        this.__yss_timedtext = typeof url === 'string' && url.indexOf('/api/timedtext') !== -1;
        return _origXhrOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body){
        if(this.__yss_timedtext && (window.YSS._subsDownloaded || (window.YSS.customSubs && window.YSS.customSubs.length > 10))){
          if(window.YSS._debugTTS) console.log('[YSS] Blocked XHR to timedtext');
          return;
        }
        return _origXhrSend.apply(this, arguments);
      };
    }

    if(!window.YSS._timedtextPatched){
      window.YSS._timedtextPatched = true;
      var _origFetch = window.fetch.bind(window);
      window.YSS._origFetch = _origFetch;
      window.YSS._timedtextBlocked = false;
      window.fetch = function(url, opts){
        if(typeof url === 'string' && url.indexOf('/api/timedtext') !== -1){
          var _isTypeList = typeof url === 'string' && url.indexOf('type=list') !== -1;
          // Block once we have our own subs loaded
          if(window.YSS._subsDownloaded || (window.YSS.customSubs && window.YSS.customSubs.length > 10)){
            return Promise.reject(new Error('Blocked'));
          }
          // Rate limit: prevent rapid retries (cooldown 10s after first attempt, skip for ?type=list)
          if(!_isTypeList && window.YSS._timedtextCooldown && Date.now() < window.YSS._timedtextCooldown){
            return Promise.reject(new Error('Cooldown'));
          }
          if(!_isTypeList) window.YSS._timedtextCooldown = Date.now() + 10000;
          // Only rewrite URL for sub fetches, not for ?type=list
          if(!_isTypeList){
            try {
              var u = new URL(url);
              var origLang = u.searchParams.get('lang');
              var hasTlang = u.searchParams.has('tlang');
              // If tlang is already set, keep original lang (it's the source language for translation)
              if(!hasTlang){
                u.searchParams.set('lang', 'en');
                if(origLang && origLang !== 'en'){
                  u.searchParams.set('tlang', origLang);
                }
              }
              return _origFetch(u.toString(), opts);
            } catch(e){}
          }
        }
        try{ return _origFetch(url, opts); }catch(e){ return Promise.reject(e); }
      };
    }

    // --- State machine: LOADING → FETCHING_SUBS → READY → PLAYING ---
    window.YSS._state = null;
    window.YSS._abortController = null;
    window.YSS._overlayEl = null;
    window.YSS._overlaySteps = {};

    window.YSS._setOverlayStep = function(key, done, label){
      var el = window.YSS._overlaySteps[key];
      if(!el) return;
      if(done){
        el.textContent = '\u2713 ' + label;
        el.style.color = '#4caf50';
      } else {
        el.textContent = '\u25E6 ' + label;
        el.style.color = '#bbb';
      }
    };

    window.YSS._createOverlay = function(){
      if(window.YSS._overlayEl) return;
      var o = document.createElement('div');
      o.id = 'yss-loading-overlay';
      o.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.75);border-radius:10px;padding:10px 14px;z-index:999999;font-family:Arial,sans-serif;display:flex;align-items:center;gap:10px;backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.08);pointer-events:none';
      // Spinner
      var s = document.createElement('div');
      s.style.cssText = 'width:18px;height:18px;border:2px solid rgba(255,255,255,0.15);border-top:2px solid #4fc3f7;border-radius:50%;animation:yss-spin2 .8s linear infinite;flex-shrink:0';
      o.appendChild(s);
      // Style
      var st = document.createElement('style');
      st.textContent = '@keyframes yss-spin2{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes yss-loading01{0%{opacity:1;}100%{opacity:0;}}';
      o.appendChild(st);
      // Steps container (inline)
      var c = document.createElement('div');
      c.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:12px;letter-spacing:.2px;color:#ccc;white-space:nowrap';
      var steps = [
        { key: 'pause', label: 'Silenciando video' },
        { key: 'subs', label: 'Descargando subt\u00EDtulos' },
        { key: 'voice', label: 'Preparando voz' }
      ];
      for(var i=0;i<steps.length;i++){
        var r = document.createElement('div');
        r.style.cssText = 'transition:color .3s';
        r.textContent = '\u25E6 ' + steps[i].label;
        r.style.color = '#555';
        c.appendChild(r);
        window.YSS._overlaySteps[steps[i].key] = r;
      }
      var loadingText = document.createElement('div');
      loadingText.style.cssText = 'display:flex;gap:0;margin-top:6px;font-size:12px;color:#fff;letter-spacing:0.08em;align-items:center';
      var loadingLabel = 'CARGANDO';
      for(var j=0;j<loadingLabel.length;j++){
        var span = document.createElement('span');
        span.textContent = loadingLabel[j];
        span.style.cssText = 'display:inline-block;margin:0 -0.05em;animation:yss-loading01 1.4s infinite alternate;animation-delay:' + (j * 0.1).toFixed(1) + 's';
        loadingText.appendChild(span);
      }
      c.appendChild(loadingText);
      o.appendChild(c);
      document.body.appendChild(o);
      window.YSS._overlayEl = o;
    };

    window.YSS._removeOverlay = function(){
      // Always remove by DOM id as safety net
      var _domEl = document.getElementById('yss-loading-overlay');
      if(_domEl) _domEl.remove();
      var o = window.YSS._overlayEl;
      if(o && o !== _domEl) o.remove();
      window.YSS._overlayEl = null;
      window.YSS._overlaySteps = {};
    };

    window.YSS._showMuteIndicator = function(){
      if(window.YSS._muteIndicatorEl) return;
      var el = document.createElement('div');
      el.id = 'yss-mute-indicator';
      el.textContent = 'Lector activo — audio original silenciado';
      el.style.cssText = 'position:fixed;top:16px;left:16px;background:rgba(0,0,0,0.78);color:#fff;padding:8px 12px;font-size:13px;border-radius:8px;z-index:999999;pointer-events:none;font-family:Arial,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,0.25);transition:opacity .2s ease;opacity:0.98;';
      document.body.appendChild(el);
      window.YSS._muteIndicatorEl = el;
    };

    window.YSS._hideMuteIndicator = function(){
      if(!window.YSS._muteIndicatorEl) return;
      window.YSS._muteIndicatorEl.remove();
      window.YSS._muteIndicatorEl = null;
    };

    window.YSS._startupReady = false;

    window.YSS._freezeApplied = false;
    window.YSS._freezeTimer = null;
    window.YSS._safetyUnfreezeTimer = null;

    window.YSS._freezeVideo = function(){
      var v = document.querySelector('video');
      if(!v || v.ended) return;
      window.YSS._startupReady = false;
      if(window.YSS._freezeApplied) return;
      window.YSS._freezeApplied = true;
      window.YSS._savedVolume = v.volume;
      window.YSS._savedTime = v.currentTime;
      window.YSS._wasPaused = v.paused;
      window.YSS._wasMuted = v.muted;
      if(typeof window.__YSS_blockPlay === 'function'){
        window.__YSS_blockPlay();
      } else {
        v.pause();
        v.muted = true;
        v.volume = 0;
      }
      // Keep video paused until ready
      if(window.YSS._freezeTimer) clearInterval(window.YSS._freezeTimer);
      window.YSS._freezeTimer = setInterval(function(){
        var _fv = document.querySelector('video');
        if(!_fv) return;
        if(window.YSS._state !== 'PLAYING' && !_fv.paused) _fv.pause();
      }, 100);
      // Safety unfreeze after 25s
      if(window.YSS._safetyUnfreezeTimer) clearTimeout(window.YSS._safetyUnfreezeTimer);
      window.YSS._safetyUnfreezeTimer = setTimeout(function(){
        if(window.YSS._freezeApplied && window.YSS._state !== 'PLAYING'){
          console.warn('[YSS] Safety unfreeze after timeout');
          window.YSS._freezeApplied = true;
          window.YSS._unfreezeVideo();
          window.YSS._state = null;
          window.YSS._removeOverlay();
        }
      }, 25000);
    };

    window.YSS._unfreezeVideo = function(){
      var v = document.querySelector('video');
      if(!v) return;
      if(!window.YSS._freezeApplied) return;
      window.YSS._freezeApplied = false;
      if(window.YSS._freezeTimer){ clearInterval(window.YSS._freezeTimer); window.YSS._freezeTimer = null; }
      if(window.YSS._safetyUnfreezeTimer){ clearTimeout(window.YSS._safetyUnfreezeTimer); window.YSS._safetyUnfreezeTimer = null; }
      v.volume = window.YSS._savedVolume ?? 1;
      // Keep muted if reader will start — controlVideoMute handles unmute timing
      if(window.YSS._customReaderRunning || window.YSS._gapReaderActive || window.YSS._subsIncompleteActive){
        v.muted = true;
      } else if(!window.YSS._wasMuted) {
        v.muted = false;
      }
      if(typeof window.__YSS_allowPlay === 'function'){
        window.__YSS_allowPlay();
      } else {
        v.play().catch(function(){});
      }
    };

    window.YSS._transitionTo = function(newState){
      if(window.YSS._state === newState) return;
      var prev = window.YSS._state;
      window.YSS._state = newState;
      console.log('[YSS] State: '+(prev||'null')+' → '+newState);

      if(newState === 'LOADING'){
        window.YSS._createOverlay();
        window.YSS._setOverlayStep('pause', true, 'Silenciando video');
        window.YSS._freezeVideo();
      }
      if(newState === 'FETCHING_SUBS'){
        if(!window.YSS._overlayEl) window.YSS._createOverlay();
        window.YSS._setOverlayStep('pause', true, 'Silenciando video');
        window.YSS._setOverlayStep('subs', true, 'Descargando subt\u00EDtulos');
        window.YSS._freezeVideo();
        // Fallback: force PLAYING after 15s if subs still not loaded
        if(window.YSS._fetchTimeout) clearTimeout(window.YSS._fetchTimeout);
        window.YSS._fetchTimeout = setTimeout(function(){
          if(window.YSS._state === 'FETCHING_SUBS' && !window.YSS._subsDownloaded && window.YSS.customSubs && window.YSS.customSubs.length > 10){
            console.log('[YSS] Subs fetch timeout, using bundled subtitles');
            window.YSS._subsDownloaded = true;
            window.YSS._transitionTo('PLAYING');
          }
        }, 15000);
      }
      if(newState === 'READY'){
        window.YSS._setOverlayStep('subs', true, 'Descargando subt\u00EDtulos');
        window.YSS._setOverlayStep('voice', true, 'Preparando voz');
        window.YSS._subsDownloaded = true;
      }
      if(newState === 'PLAYING'){
        window.YSS._startupReady = true;
        if(window.YSS._fetchTimeout){ clearTimeout(window.YSS._fetchTimeout); window.YSS._fetchTimeout = null; }
        window.YSS._removeOverlay();
        if(!window.YSS._customReaderRunning && !window.YSS._gapReaderActive && window.YSS._customSubsEnabled){
          window.YSS.startCustomReader();
        }
        window.YSS._unfreezeVideo();
      }
    };

    // --- SPA navigation detection ---
    window.YSS._initComplete = false;
    window.YSS._onNavigate = function(){
      // Ignore during initial page load (events fire before we finish setup)
      if(!window.YSS._initComplete) return;
      // Ignore spurious navigation events for the same video when reader is already active
      var _navId = getVideoId();
      if(window.YSS._lastVideoId === _navId && (window.YSS._gapReaderActive || window.YSS._customReaderRunning || window.YSS._subsIncompleteActive)){
        return;
      }
      window.YSS._lastVideoId = _navId;
      // Immediately mute/pause to prevent audio leak during transition
      var _navVideo = document.querySelector('video');
      if(_navVideo && !_navVideo.ended){
        _navVideo.pause();
        _navVideo.muted = true;
        _navVideo.volume = 0;
      }
      if(typeof window.__YSS_blockPlay === 'function') window.__YSS_blockPlay();
      if(window.YSS._abortController){
        window.YSS._abortController.abort();
        window.YSS._abortController = null;
      }
      // BUG-A4: Cancel pending XHRs
      if(window.YSS._pendingXhr){
        try{ window.YSS._pendingXhr.abort(); }catch(e){}
        window.YSS._pendingXhr = null;
      }
      if(window.YSS._pendingXhr2){
        try{ window.YSS._pendingXhr2.abort(); }catch(e){}
        window.YSS._pendingXhr2 = null;
      }
      if(window.YSS._fetchTimeout){ clearTimeout(window.YSS._fetchTimeout); window.YSS._fetchTimeout = null; }
      if(window.YSS._safetyUnfreezeTimer){ clearTimeout(window.YSS._safetyUnfreezeTimer); window.YSS._safetyUnfreezeTimer = null; }
      window.YSS._removeOverlay();
      if(window.YSS._freezeTimer){
        clearInterval(window.YSS._freezeTimer);
        window.YSS._freezeTimer = null;
      }
      window.YSS._freezeApplied = false;
      window.YSS._state = null;
      window.YSS._subsDownloaded = false;
      window.YSS.customSubs = null;
      window.YSS._customSubsEnabled = false;
      window.YSS._gapReaderActive = false;
      window.YSS._subsIncompleteActive = false;
      window.YSS._innertubeDownloading = false;
      window.YSS._subDownloadCooldown = 0;
      window.YSS._startupReady = false;
      window.YSS._firstTtsCompleted = false;
      if(window.YSS._yss_spokenRegistry) window.YSS._yss_spokenRegistry.clear(); // BUG-A3
      window.speechSynthesis.cancel();
      // Re-init after navigation
      setTimeout(function(){
        if(!window.YSS._subsDownloaded && getVideoId()){
          window.YSS._transitionTo('LOADING');
          autoDownloadSubs();
        }
      }, 100);
    };
    try { document.addEventListener('yt-navigate-start', window.YSS._onNavigate); } catch(e){}
    // Note: yt-navigate-finish and yt-page-data-updated fire during initial page load
    // and would reset bundled subs. Only yt-navigate-start is sufficient for SPA navigation.
    // Fallback for non-SPA: detect page unload
    try {
      window.addEventListener('beforeunload', function(){
        if(window.YSS._abortController) window.YSS._abortController.abort();
      });
    } catch(e){}

    window.YSS._cleanupLoading = function(forceUnfreeze){
      if(window.YSS._fetchTimeout){ clearTimeout(window.YSS._fetchTimeout); window.YSS._fetchTimeout = null; }
      window.YSS._removeOverlay();
      if(window.YSS._state === 'PLAYING' || forceUnfreeze){
        window.YSS._unfreezeVideo();
      }
      if(window.YSS._state !== 'PLAYING' && typeof window.__YSS_allowPlay === 'function'){
        window.__YSS_allowPlay();
      }
      window.YSS._state = null;
    };
    window.YSS._getAbortSignal = function(){
      if(window.YSS._abortController) window.YSS._abortController.abort();
      window.YSS._abortController = new AbortController();
      return window.YSS._abortController.signal;
    };

    // --- Translation fix map ---
    if(!window.YSS.translationFixes){
      window.YSS.translationFixes = {};
      var defaults = {'el zapato':'Da Shu','el calzado':'Da Shu','zapato':'Da Shu','terreno de juego':'Tono','discapacitado':'Desactivado','ahorrar':'Guardar','hanfong':'Han Feng','hanfen':'Han Feng','hanfang':'Han Feng','hanfo':'Han Feng'};
      for(var k in defaults) window.YSS.translationFixes[k] = defaults[k];
    }
    window.YSS.addTranslationFix = function(b,c){ window.YSS.translationFixes[b.toLowerCase()]=c; };
    window.YSS.removeTranslationFix = function(b){ delete window.YSS.translationFixes[b.toLowerCase()]; };
    window.YSS.getTranslationFixes = function(){ return Object.assign({},window.YSS.translationFixes); };

    // --- Names ---
    if(!window.YSS.customNames) window.YSS.customNames = {'Da Shu':'Dashú','Han Feng':'Han Feng','Hanfeng':'Han Feng','Hanfong':'Han Feng','hanfong':'Han Feng','hanfen':'Han Feng','hanfang':'Han Feng'};
    window.YSS.addName = function(n,p){ window.YSS.customNames[n]=p||''; };
    window.YSS.removeName = function(n){ delete window.YSS.customNames[n]; };
    window.YSS.hasName = function(n){ return n in window.YSS.customNames; };
    window.YSS.getNames = function(){ return Object.assign({},window.YSS.customNames); };

    // --- Phonetic map ---
    if(!window.YSS.phoneticMap) window.YSS.phoneticMap = {'Da Shu':'Dashú','Xiao Ming':'Shiao Ming','Zhang':'Chang','Zhao':'Chao','Chen':'Chen','Wang':'Guang','Liu':'Lio','Yang':'Yang','Huang':'Guang','Zhu':'Chu','Lin':'Lin','Gao':'Gao','Xiao':'Shiao','Feng':'Feng','Wei':'Wéi','Jiang':'Chiang','Shen':'Shen','Zhou':'Chou','Zheng':'Cheng','Xu':'Shu','Fang':'Fang','Lei':'Léi','Da':'Da','Han':'Han'};
    window.YSS.addPhonetic = function(n,p){ window.YSS.phoneticMap[n]=p; };
    window.YSS.getPhoneticMap = function(){ return Object.assign({},window.YSS.phoneticMap); };

    // --- Load saved data from storage ---
    try {
      chrome.storage.sync.get(['yss_custom_names','yss_translation_fixes','yss_phonetic_map'], function(d){
        if(d&&d.yss_custom_names) Object.assign(window.YSS.customNames,d.yss_custom_names);
        if(d&&d.yss_translation_fixes) Object.assign(window.YSS.translationFixes,d.yss_translation_fixes);
        if(d&&d.yss_phonetic_map) Object.assign(window.YSS.phoneticMap,d.yss_phonetic_map);
      });
    }catch(e){}
    try {
      chrome.storage.onChanged.addListener(function(c,a){
        if(a!=='sync')return;
        if(c.yss_custom_names) Object.assign(window.YSS.customNames,c.yss_custom_names.newValue||{});
        if(c.yss_translation_fixes) Object.assign(window.YSS.translationFixes,c.yss_translation_fixes.newValue||{});
        if(c.yss_phonetic_map) Object.assign(window.YSS.phoneticMap,c.yss_phonetic_map.newValue||{});
      });
    }catch(e){}

    // --- Listen for popup enable/disable toggle ---
    try {
      chrome.storage.onChanged.addListener(function(c,a){
        if(a !== 'sync') return;
        var enabled;
        if('enable' in c){
          enabled = !!c.enable.newValue;
        } else if(c.options && c.options.newValue && typeof c.options.newValue.enable !== 'undefined'){
          enabled = !!c.options.newValue.enable;
        }
        if(typeof enabled === 'undefined') return;
        window.YSS._extensionEnabled = enabled;

        if(!enabled && window.YSS._customSubsEnabled){
          window.YSS._customSubsEnabled = false;
          if(window.YSS.stopCustomReader) window.YSS.stopCustomReader();
          else {
            window.YSS._customReaderRunning = false;
            window.YSS._gapReaderActive = false;
            window.YSS._subsIncompleteActive = false;
            window.YSS._spokenSubTimes = {};
            controlVideoMute();
          }
          window.speechSynthesis.cancel();
          if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
          window.YSS._ttsActive = false;
          window.YSS._cachedDynamicRate = null;

          // Update button icon to OFF
          var btn = document.querySelector('.yss-control-button');
          if(btn){
            setControlButtonIcon(false);
          }
        }
        if(enabled && !window.YSS._customSubsEnabled){
          window.YSS._customSubsEnabled = true;
          window.YSS._userCustomSubsActive = true;
          if(!window.YSS._customReaderRunning && !window.YSS._gapReaderActive){
            window.YSS.startCustomReader();
          }
          var btn = document.querySelector('.yss-control-button');
          if(btn){
            setControlButtonIcon(true);
          }
        }
      });
    }catch(e){}

    // --- Custom Subtitles ---
    window.YSS._lastCustomSubTime = 0;
    window.YSS._lastCustomSpeakTime = 0;
    window.YSS._speakingControl = 'voice';
    window.YSS._subsVideoId = '';
    window.YSS._ttsActive = false;
    window.YSS._batchPauseEnd = 0;
    window.YSS._interBatchPauseMs = 500;
    window.YSS._ttsProvider = 'browser';
    window.YSS._extensionEnabled = true;
    window.YSS._controlIconOn = '<svg height="100%" viewBox="0 0 36 36" width="100%"><path class="ytp-svg-fill" d="M8,21 L12,21 L17,26 L17,10 L12,15 L8,15 L8,21 Z M19,14 L19,22 C20.48,21.32 21.5,19.77 21.5,18 C21.5,16.26 20.48,14.74 19,14 ZM19,11.29 C21.89,12.15 24,14.83 24,18 C24,21.17 21.89,23.85 19,24.71 L19,26.77 C23.01,25.86 26,22.28 26,18 C26,13.72 23.01,10.14 19,9.23 L19,11.29 Z" fill="#1e90ff"></path></svg>';
    window.YSS._controlIconOff = '<svg height="100%" viewBox="0 0 36 36" width="100%"><path class="ytp-svg-fill" d="m 21.48,17.98 c 0,-1.77 -1.02,-3.29 -2.5,-4.03 v 2.21 l 2.45,2.45 c .03,-0.2 .05,-0.41 .05,-0.63 z m 2.5,0 c 0,.94 -0.2,1.82 -0.54,2.64 l 1.51,1.51 c .66,-1.24 1.03,-2.65 1.03,-4.15 0,-4.28 -2.99,-7.86 -7,-8.76 v 2.05 c 2.89,.86 5,3.54 5,6.71 z M 9.25,8.98 l -1.27,1.26 4.72,4.73 H 7.98 v 6 H 11.98 l 5,5 v -6.73 l 4.25,4.25 c -0.67,.52 -1.42,.93 -2.25,1.18 v 2.06 c 1.38,-0.31 2.63,-0.95 3.69,-1.81 l 2.04,2.05 1.27,-1.27 -9,-9 -7.72,-7.72 z m 7.72,.99 -2.09,2.08 2.09,2.09 V 9.98 z" fill="#666"></path></svg>';
    window.YSS.setControlButtonIcon = function(enabled){
      var btn = document.querySelector('.yss-control-button');
      if(!btn) return;
      var useTrusted = typeof YSStrustedHTML === 'function';
      var markup = enabled ? window.YSS._controlIconOn : window.YSS._controlIconOff;
      btn.innerHTML = useTrusted ? YSStrustedHTML(markup) : markup;
    };
    window.YSS._elevenLabsApiKey = '';
    window.YSS._elevenLabsVoiceId = '21m00Tcm4TlvDq8ikWAM';
    window.YSS._elevenLabsModelId = 'eleven_multilingual_v2';
    window.YSS._ollamaEnabled = false;
    window.YSS._ollamaModel = 'gemma3:4b';
    window.YSS._ollamaUrl = 'http://127.0.0.1:11434/api/generate';
    window.YSS.aiCache = {};
    window.YSS._ollamaQueue = [];
    window.YSS._ollamaProcessing = false;
    try {
      chrome.storage.sync.get(['enable','options'], function(d){
        if(d){
          if(d.enable === 0 || d.enable === false || (d.options && (d.options.enable === 0 || d.options.enable === false))){
            window.YSS._customSubsEnabled = false;
            window.YSS._extensionEnabled = false;
          }
        }
      });
    }catch(e){}

    // Define getVideoId helper used throughout the code
    if(typeof getVideoId === 'undefined'){
      window.getVideoId = function(){
        var params = new URLSearchParams(window.location.search);
        var v = params.get('v');
        if(v) return v;
        var m = window.location.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
        if(m) return m[1];
        return null;
      };
    }

    function stripOverlap(segs){
      if(!segs || !segs.length) return segs || [];
      var result = [{time:segs[0].time, dDurationMs:segs[0].dDurationMs, text:segs[0].text}];
      var spoken = segs[0].text;
      for(var i=1;i<segs.length;i++){
        var cur = segs[i].text;
        if(!cur) continue;
        var newStart = 0;
        // Exact suffix/prefix match against spoken buffer
        var maxCheck = Math.min(spoken.length, cur.length, 120);
        for(var len = Math.min(maxCheck, 80); len >= 8; len--){
          if(spoken.substring(spoken.length - len) === cur.substring(0, len)){ newStart = len; break; }
        }
        // Word-level suffix/prefix match against spoken buffer
        if(newStart === 0){
          var pw = spoken.split(/\s+/);
          var cw = cur.split(/\s+/);
          var maxW = Math.min(pw.length, cw.length, 20);
          for(var w = maxW; w >= 3; w--){
            if(pw.slice(-w).join(' ').toLowerCase() === cw.slice(0, w).join(' ').toLowerCase()){
              newStart = cw.slice(0,w).join(' ').length; break;
            }
          }
        }
        // Common word prefix between cur and previous segment's original text
        if(newStart === 0 && i >= 1){
          var prevOrig = segs[i-1].text;
          var pw2 = prevOrig.split(/\s+/);
          var cw2 = cur.split(/\s+/);
          var commonW = 0;
          var maxW2 = Math.min(pw2.length, cw2.length, 20);
          for(var w=0; w<maxW2; w++){
            if(pw2[w].toLowerCase() === cw2[w].toLowerCase()) commonW = w+1;
            else break;
          }
          if(commonW >= 5) newStart = cw2.slice(0, commonW).join(' ').length;
        }
        var newText = newStart > 0 ? cur.substring(newStart).trim() : cur;
        if(newText.length > 0){
          result.push({time:segs[i].time, dDurationMs:segs[i].dDurationMs, text:newText});
          spoken = (spoken + ' ' + newText).slice(-500);
        }
      }
      return result;
    }

    function tryBundledSubs(){
      if(window.YSS_BUNDLED_SUBS && window.YSS_BUNDLED_SUBS.length){
        var vid = getVideoId();
        // Only use bundled subs if they match current video (or if no video ID available)
        if(window.YSS_BUNDLED_VIDEO_ID && vid && vid !== window.YSS_BUNDLED_VIDEO_ID){
          if(!window.YSS._bundledSubsRejected){
            window.YSS._bundledSubsRejected = true;
            console.log('[YSS] Bundled subs are for different video ('+window.YSS_BUNDLED_VIDEO_ID+'), ignoring');
          }
          return false;
        }
        var raw = window.YSS_BUNDLED_SUBS;
        var filtered = [];
        for(var i=0;i<raw.length;i++){
          if(raw[i].dDurationMs >= 100) filtered.push({time:raw[i].time, dDurationMs:raw[i].dDurationMs, text:raw[i].text});
        }
        window.YSS.customSubs = stripOverlap(filtered);
        window.YSS._customSubsEnabled = true;
        window.YSS._subsVideoId = window.YSS_BUNDLED_VIDEO_ID || vid || '';
        window.YSS._subsDownloaded = true; // Mark as available so gap-filler can use bundled subs
        console.log('[YSS] Bundled subtitles:', window.YSS_BUNDLED_SUBS.length, 'segments');
        return true;
      }
      return false;
    }

    window.YSS._subsIncompleteActive = false;
    window.YSS._subsIncompleteChecked = false;
    window.YSS._cachedRate = 1;
    window.YSS._cachedPitch = 1;
    window.YSS._cachedVolume = 1;
    window.YSS._lastVideoTime = 0;
    window.YSS._seekDetected = false;
    window.YSS._recentSubs = [];
    window.YSS._recentSubTimes = [];
    window.YSS._customReaderRunning = false;

    // Define reader controls early — called by auto-start code below
    window.YSS._spokenSubTimes = {};
    window.YSS.startCustomReader = function(){
      if(!window.YSS._extensionEnabled || !window.YSS._customSubsEnabled) return;
      // BUG-C4: Init lastCustomSubTime from video position (mid-video navigation)
      var _v = document.querySelector('video');
      if(_v && _v.currentTime > 1) window.YSS._lastCustomSubTime = (_v.currentTime * 1000) - 2000;
      window.YSS._customReaderRunning = true;
      // [YSS-FIX-BUG-C1] Cancelar el safety timer de video-block.js — YSS está activo
      if(window.__YSS_safetyTimerId){ clearTimeout(window.__YSS_safetyTimerId); window.__YSS_safetyTimerId = null; }
      // [FIX-STATE-NULL] Transicionar a PLAYING si state es null (bundled subs path)
      if(!window.YSS._state || window.YSS._state === 'READY'){
        window.YSS._transitionTo('PLAYING');
      }
      window.YSS._gapReaderActive = true;
      window.YSS._subsIncompleteActive = true;
      window.YSS._spokenSubTimes = window.YSS._spokenSubTimes || {};
      // Allow video to play since we have subs ready to read
      if(typeof window.__YSS_allowPlay === 'function') window.__YSS_allowPlay();
      controlVideoMute();
      gapReaderLoop();
    };
    window.YSS.stopCustomReader = function(){
      window.YSS._customReaderRunning = false;
      window.YSS._gapReaderActive = false;
      window.YSS._subsIncompleteActive = false;
      window.YSS._spokenSubTimes = {};
      controlVideoMute();
    };

    if(!window.YSS.customSubs || !window.YSS.customSubs.length){
      window.YSS.customSubs = [];
      window.YSS._customSubsEnabled = false;
      var bundled = tryBundledSubs();
      if(bundled && window.YSS.customSubs && window.YSS.customSubs.length > 10){
        window.YSS._customSubsEnabled = true;
        window.YSS.startCustomReader();
      } else {
        // subtitles-data.js might not have loaded yet — retry a few times
        var _bundledRetries = 0;
        var _bundledTimer = setInterval(function(){
          if(window.YSS.customSubs && window.YSS.customSubs.length > 10) { clearInterval(_bundledTimer); return; }
          _bundledRetries++;
          if(_bundledRetries > 15) { clearInterval(_bundledTimer); return; }
          var b2 = tryBundledSubs();
          if(b2 && window.YSS.customSubs && window.YSS.customSubs.length > 10){
            window.YSS._customSubsEnabled = true;
            window.YSS.startCustomReader();
            clearInterval(_bundledTimer);
          }
        }, 1000);
      }
    }

    try {
      chrome.storage.local.get('yss_custom_subs', function(d){
        if(d&&d.yss_custom_subs&&d.yss_custom_subs.length){
          // Don't overwrite bundled subs if they're already loaded for current video
          if(window.YSS._subsVideoId && window.YSS._subsVideoId === getVideoId() && window.YSS.customSubs && window.YSS.customSubs.length > 10){
            console.log('[YSS] Bundled subs already loaded for this video, skipping storage subs');
            return;
          }
          window.YSS.customSubs = stripOverlap(d.yss_custom_subs);
          window.YSS._customSubsEnabled = true;
          window.YSS._userCustomSubsActive = true;
          console.log('[YSS] Storage subtitles:', d.yss_custom_subs.length,'segments');
          setTimeout(function(){ checkForActivation(); }, 500);
        }
      });
    }catch(e){}
    try {
      chrome.storage.onChanged.addListener(function(c,a){
        if(a==='local'){
          if(c.yss_custom_subs){
            var v=c.yss_custom_subs.newValue;
            if(v&&v.length){ window.YSS.customSubs=v; window.YSS._customSubsEnabled=true; window.YSS._userCustomSubsActive=true; }
            else { window.YSS.customSubs=[]; window.YSS._customSubsEnabled=false; window.YSS._userCustomSubsActive=false; }
          }
          if(c.yss_voice_name && c.yss_voice_name.newValue){
            var name = c.yss_voice_name.newValue;
            window.YSS._savedVoiceName = name;
            var voices = window.speechSynthesis.getVoices();
            for(var i=0;i<voices.length;i++){ if(voices[i].name===name){ cacheVoice(voices[i]); break; } }
          }
        }
        // Sync flat speech_voice index -> yss_voice_name name
        if(c.speech_voice && c.speech_voice.newValue !== undefined){
          var idx = parseInt(c.speech_voice.newValue);
          var voices = window.speechSynthesis.getVoices();
          if(voices && voices[idx]){
            var ename = voices[idx].name;
            window.YSS._savedVoiceName = ename;
            cacheVoice(voices[idx]);
            try{ chrome.storage.local.set({yss_voice_name: ename}); }catch(e){}
            safeStorageSyncSet({yss_voice_name: ename});
          }
        }
        // Sync YSS bundle format: options.speech_voice -> yss_voice_name
        if(c.options && c.options.newValue){
          var opts = c.options.newValue;
          if(opts && opts.speech_voice !== undefined){
            var idx = parseInt(opts.speech_voice);
            var voices = window.speechSynthesis.getVoices();
            if(voices && voices[idx]){
              var ename = voices[idx].name;
              window.YSS._savedVoiceName = ename;
              cacheVoice(voices[idx]);
              try{ chrome.storage.local.set({yss_voice_name: ename}); }catch(e){}
              safeStorageSyncSet({yss_voice_name: ename});
              persistVoiceName(ename);
            }
          }
        }
      });
    }catch(e){}

    // --- Message listener for popup ---
    try {
      chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
        if(msg.action === 'getVideoId'){
          sendResponse({ videoId: getVideoId() });
        }
        if(msg.action === 'downloadSubsFromPopup'){
          autoDownloadSubs();
          sendResponse({ downloading: true });
        }
      });
    } catch(e){}

    // --- Voice settings ---
    // Cache voice from YSS's own utterances (most reliable), fallback to storage
    window.YSS._cachedVoice = null;
    window.YSS._cachedVoiceLang = 'es-ES';
    window.YSS._voiceReady = false;
    window.YSS._savedVoiceName = '';

    function cacheVoice(voice, lang){
      if(!voice && !lang) return;
      if(voice){ window.YSS._cachedVoice = voice; window.YSS._cachedVoiceLang = voice.lang || lang || 'es-ES'; }
      else { window.YSS._cachedVoiceLang = lang || 'es-ES'; }
      window.YSS._voiceReady = true;
      if(window.YSS._debugTTS) console.log('[YSS] Voice:', voice ? voice.name : lang);
    }

    function loadVoiceFromStorage(){
      function tryLoad(name){
        if(!name) return false;
        window.YSS._savedVoiceName = name;
        var voices = window.speechSynthesis.getVoices();
        if(window.YSS._debugTTS) console.log('[YSS] tryLoad name="'+name+'" voices='+voices.length);
        for(var i=0;i<voices.length;i++){ if(voices[i].name===name){ cacheVoice(voices[i]); return true; } }
        if(window.YSS._debugTTS) console.log('[YSS] tryLoad FAILED for name="'+name+'"');
        return false;
      }
      // 1) Try localStorage first (fastest, persists from popup message)
      try { var ls = localStorage.getItem('yss_voice_name'); if(ls && tryLoad(ls)){ if(window.YSS._debugTTS) console.log('[YSS] loaded from localStorage'); return; } } catch(e){}
      // 2) Try reading from chrome.storage (works in content scripts)
      try {
        chrome.storage.sync.get(['speech_voice','yss_voice_name','options'], function(d2){
          if(window.YSS._cachedVoice) return;
          // Check yss_voice_name first
          var n = d2 && d2.yss_voice_name ? d2.yss_voice_name : '';
          if(tryLoad(n)){ persistVoiceName(n); return; }
          // Check options.speech_voice (YSS bundle format)
          var idx = -1;
          if(d2 && d2.speech_voice !== undefined) idx = parseInt(d2.speech_voice);
          else if(d2 && d2.options && d2.options.speech_voice !== undefined) idx = parseInt(d2.options.speech_voice);
          var voices = window.speechSynthesis.getVoices();
          if(idx >= 0 && voices && voices[idx]){
            if(window.YSS._debugTTS) console.log('[YSS] loaded from storage idx='+idx+' name="'+voices[idx].name+'"');
            cacheVoice(voices[idx]);
            persistVoiceName(voices[idx].name);
          }
          window.YSS._voiceReady = true;
        });
      } catch(e){
        if(window.YSS._debugTTS) console.log('[YSS] storage fail:', e);
      }
      // 3) Try requesting options from service worker
      try {
        chrome.runtime.sendMessage(chrome.runtime.id, {options: true}, function(resp){
          if(!resp || window.YSS._cachedVoice) return;
          var opts = resp.options || resp;
          var idx = opts && opts.speech_voice !== undefined ? parseInt(opts.speech_voice) : -1;
          if(idx >= 0){
            var voices = window.speechSynthesis.getVoices();
            if(voices && voices[idx]){
              if(window.YSS._debugTTS) console.log('[YSS] got voice from SW options:', voices[idx].name);
              cacheVoice(voices[idx]);
              persistVoiceName(voices[idx].name);
            }
          }
        });
      } catch(e){}
      setTimeout(function(){
        if(!window.YSS._cachedVoice){
          window.YSS._voiceReady = true;
          try { var ls = localStorage.getItem('yss_voice_name'); if(ls) tryLoad(ls); } catch(e){}
        }
        // Apply any pending voice set from popup
        if(window.YSS._pendingVoiceName){
          var pv = window.YSS._pendingVoiceName;
          window.YSS._pendingVoiceName = null;
          var voices = window.speechSynthesis.getVoices();
          for(var i=0;i<voices.length;i++){ if(voices[i].name===pv){ cacheVoice(voices[i]); break; } }
          if(window.YSS._cachedVoice) persistVoiceName(pv);
        }
      }, 3000);
    }
    function persistVoiceName(name){
      if(!name) return;
      window.YSS._savedVoiceName = name;
      try{ localStorage.setItem('yss_voice_name', name); }catch(e){}
    }
    loadVoiceFromStorage();
    // Listen for popup sending voice name directly
    window.YSS._pendingVoiceName = null;
    try {
      chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
        if(msg.action === 'setVoice' && msg.name){
          if(window.YSS._voiceReady){
            persistVoiceName(msg.name);
            var voices = window.speechSynthesis.getVoices();
            for(var i=0;i<voices.length;i++){ if(voices[i].name===msg.name){ cacheVoice(voices[i]); break; } }
          } else {
            window.YSS._pendingVoiceName = msg.name;
          }
          if(sendResponse) sendResponse({ok:true});
        }
      });
    }catch(e){}
    // Re-load voice when Chrome finishes loading voice list
    try {
      window.speechSynthesis.addEventListener('voiceschanged', function(){
        if(!window.YSS._cachedVoice) loadVoiceFromStorage();
      });
    }catch(e){}

    // --- Normalize text ---
    window.YSS._debugTTS = false;
    window.YSS.enableDebug = function(){ window.YSS._debugTTS = true; console.log('[YSS] Debug ON'); };
    window.YSS.disableDebug = function(){ window.YSS._debugTTS = false; };

    function normalizeTextForTTS(text, lang){
      if(!text) return text;
      var fixKeys = Object.keys(window.YSS.translationFixes).sort(function(a,b){return b.length-a.length;});
      for(var i=0;i<fixKeys.length;i++){ text = text.replace(new RegExp(fixKeys[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), window.YSS.translationFixes[fixKeys[i]]); }
      var nameKeys = Object.keys(window.YSS.customNames).sort(function(a,b){return b.length-a.length;});
      for(var i=0;i<nameKeys.length;i++){ var n=nameKeys[i],p=window.YSS.customNames[n]; text = text.replace(new RegExp('\\b'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'), p||n); }
      var phonKeys = Object.keys(window.YSS.phoneticMap).sort(function(a,b){return b.length-a.length;});
      for(var i=0;i<phonKeys.length;i++){ if(window.YSS.customNames.hasOwnProperty(phonKeys[i]))continue; text = text.replace(new RegExp('\\b'+phonKeys[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'), window.YSS.phoneticMap[phonKeys[i]]); }
      var l=(lang||'').split('-')[0].toLowerCase();
      if(l==='es'){ text=text.replace(/¿/g,'').replace(/¡/g,''); }
      text = text.replace(/\.\s*\./g,'.').replace(/\s+([.,;:!?])/g,'$1').replace(/\.{3,}/g,'\u2026').replace(/-{2,}/g,'\u2013').replace(/\s{2,}/g,' ').trim();
      return text;
    }
    window.YSS.normalizeTextForTTS = normalizeTextForTTS;

    // --- Simple language detection from text content ---
    function detectTextLang(text){
      if(!text || text.length < 10) return null;
      var t = text.toLowerCase().replace(/[^a-zà-ÿ\s]/g,'');
      var esWords = ['el','la','los','las','un','una','que','de','en','por','con','para','es','son','del','como','mas','pero','sus','le','ya','este','esta','entre','era','muy','sin','sobre','tambien','habia','ser','sido','sea','han','fue','era','esta','estan','tiene','tienen','dice','dijo','casa','agua','hombre','mujer','tiempo','vida','dia','ano','cosa','mundo','familia','trabajo','pais','forma','caso','grupo','lugar','noche','dias','anos','cosas','personas','ninos','bien','mal','gran','misma','mismo','otra','otro','cada','tanto','poco','toda','todo','ella','ellos','nosotros','vosotros','nuestro','vuestro','puede','haber','hacer','decir','ir','ver','saber','poder','querer','llegar','pasar','deber','creer','hablar','dar','tener','estar','ser'];
      var enWords = ['the','a','an','is','are','was','were','be','been','has','have','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','this','that','these','those','you','he','she','it','we','they','your','his','her','its','our','their','and','or','but','if','because','so','than','as','at','by','for','with','about','against','between','into','through','during','before','after','above','below','from','up','down','to','in','out','on','off','over','under','again','further','then','once','here','there','when','where','why','how','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','too','very','just','also','well','now','even','still','much','many'];
      var ptWords = ['o','a','os','as','um','uma','de','do','da','dos','das','em','no','na','nos','nas','para','por','com','como','mais','mas','muito','bem','mal','ja','ainda','depois','antes','entre','era','foi','sao','esta','estao','tem','tem','diz','disse','casa','agua','homem','mulher','tempo','vida','mundo','coisa','pessoa','dia','ano','noite','lugar','familia','trabalho','pais','forma','caso','grupo','parte','cada','todo','toda','todos','todas','outro','outra','mesmo','mesma','grande','pouco','muita','muitos','muitas','tanto','tanta','nossa','nosso','nossos','nossas','sua','seu','suas','seus'];
      var frWords = ['le','la','les','un','une','des','du','de','en','a','au','aux','par','pour','avec','sur','dans','est','sont','etait','ete','etre','avoir','faire','dit','mais','donc','car','tres','bien','mal','comme','plus','moins','aussi','encore','deja','toujours','jamais','souvent','parfois','maintenant','apres','avant','pendant','chez','entre','depuis','jusque','cette','ce','cet','ces','mon','ton','son','ma','ta','sa','mes','tes','ses','notre','votre','leur','nos','vos','leurs','elle','ils','elles','nous','vous','lui','qui','que','quoi','dont','ou','comment','pourquoi','quand','quel','quelle','quels','quelles','peut','veut','doit','sait','fait','peuvent','veulent','doivent','savent','font'];
      var lang = {es:0, en:0, pt:0, fr:0};
      var words = t.split(/\s+/);
      for(var i=0;i<words.length;i++){
        var w = words[i];
        if(!w || w.length < 2) continue;
        if(esWords.indexOf(w) !== -1) lang.es++;
        if(enWords.indexOf(w) !== -1) lang.en++;
        if(ptWords.indexOf(w) !== -1) lang.pt++;
        if(frWords.indexOf(w) !== -1) lang.fr++;
      }
      var max = 'en', maxCount = 0;
      for(var l in lang){
        if(lang[l] > maxCount){ maxCount = lang[l]; max = l; }
      }
      return maxCount >= 3 ? max : null;
    }
    window.YSS.detectTextLang = detectTextLang;

    // Auto-select voice based on detected language from subtitle text
    function autoSelectVoiceForLang(lang){
      if(!lang || !window.speechSynthesis) return;
      var voices = window.speechSynthesis.getVoices();
      if(!voices || !voices.length) return;
      // Prefer voice matching the language code
      for(var i=0;i<voices.length;i++){
        if(voices[i].lang && voices[i].lang.indexOf(lang) === 0 && voices[i].name.indexOf('Google') === -1){
          cacheVoice(voices[i]);
          persistVoiceName(voices[i].name);
          return;
        }
      }
      // Fallback: any voice matching the language
      for(var i=0;i<voices.length;i++){
        if(voices[i].lang && voices[i].lang.indexOf(lang) === 0){
          cacheVoice(voices[i]);
          persistVoiceName(voices[i].name);
          return;
        }
      }
    }
    window.YSS.autoSelectVoiceForLang = autoSelectVoiceForLang;

    function findSubAtTime(timeMs){
      if(!window.YSS._customSubsEnabled || !window.YSS.customSubs.length) return null;
      var best = null;
      for(var i=0;i<window.YSS.customSubs.length;i++){
        var s=window.YSS.customSubs[i];
        if(s.dDurationMs < 100) continue;
        if(timeMs >= s.time && timeMs < s.time + s.dDurationMs){
          if(!best || s.dDurationMs > best.dDurationMs) best = s;
        }
      }
      if(best) return best;
      for(var i=0;i<window.YSS.customSubs.length;i++){
        var s=window.YSS.customSubs[i];
        if(s.dDurationMs < 100) continue;
        var dist = timeMs - s.time;
        if(dist >= -500 && dist < s.dDurationMs + 500) return s;
      }
      return null;
    }

    function findNextUnspokenSub(nowMs){
      if(!window.YSS._customSubsEnabled || !window.YSS.customSubs.length) return null;
      nowMs = nowMs || 0;
      var minTime = Math.max(0, (window.YSS._lastCustomSubTime || 0) - 2000);
      var maxTime = nowMs + 5000;
      for(var i=0;i<window.YSS.customSubs.length;i++){
        var s = window.YSS.customSubs[i];
        if(s.dDurationMs < 100) continue;
        if(s.time < minTime) continue;
        if(s.time > maxTime) break;
        if(!window.YSS._spokenSubTimes || !window.YSS._spokenSubTimes[s.time]) return s;
      }
      for(var i=0;i<window.YSS.customSubs.length;i++){
        var s = window.YSS.customSubs[i];
        if(s.dDurationMs < 100) continue;
        if(s.time >= nowMs && (!window.YSS._spokenSubTimes || !window.YSS._spokenSubTimes[s.time])) return s;
      }
      return null;
    }

    function getVoiceByName(name){
      var voices = window.speechSynthesis.getVoices();
      if(voices) for(var i=0;i<voices.length;i++){ if(voices[i].name === name) return voices[i]; }
      return null;
    }

    function collectBatch(startSub){
      var batch = [startSub];
      if(!window.YSS.customSubs || window.YSS.customSubs.length < 2) return batch;
      var startIdx = -1;
      for(var k=0;k<window.YSS.customSubs.length;k++){
        if(window.YSS.customSubs[k].time === startSub.time && window.YSS.customSubs[k].text === startSub.text){
          startIdx = k; break;
        }
      }
      if(startIdx < 0) return batch;
      var totalDur = startSub.dDurationMs || 2000;
      for(var k=startIdx+1;k<window.YSS.customSubs.length;k++){
        var s = window.YSS.customSubs[k];
        if(!s || !s.text) continue;
        // Gap between subs > 3s = new sentence
        var gap = s.time - (window.YSS.customSubs[k-1].time + window.YSS.customSubs[k-1].dDurationMs);
        if(gap > 3000) break;
        totalDur += s.dDurationMs || 2000;
        batch.push(s);
        // Stop at sentence-ending punctuation
        if(/[.!?…]$/.test(s.text.trim())) break;
        // Max 10s total duration
        if(totalDur > 10000) break;
        // Max 20 segments
        if(batch.length >= 20) break;
      }
      return batch;
    }

    function speakCustomSub(sub){
      if(!sub || !sub.text) return;
      if(_dubEngineActive()){ window.YSS.DubbingEngine.onSubtitle(sub); return; }
      var batch = collectBatch(sub);
      // [FIX-BATCH-JOIN] Unir segmentos con separación natural para evitar "hiena pecho"
      var fullText = batch.map(function(s){
        var t = s.text.trim();
        // Si el segmento no termina en puntuación, agregar coma para separar frases
        if(t && !/[.!?,;:…\-]$/.test(t)) t = t + ',';
        return t;
      }).join(' ');
      // Limpiar comas dobles o antes de puntuación fuerte
      fullText = fullText
        .replace(/,\s*([.!?…])/g, '$1')
        .replace(/,{2,}/g, ',')
        .replace(/\s+([.,;:!?…])/g,'$1')
        .replace(/\s{2,}/g,' ')
        .trim();
      // Quitar coma final si el batch termina con ella
      fullText = fullText.replace(/,$/, '');
      var lastSub = batch[batch.length-1];
      window.YSS._lastCustomSpeakTime = Date.now();
      if(!window.YSS._yss_safeSpeak(fullText)){ console.log('[YSS] SKIP repetitive sub'); return; }
      var lang = window.YSS._cachedVoiceLang || 'es-ES';
      var text = normalizeTextForTTS(fullText, lang);
      var u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      // Use cached voice or find one matching the language
      var voice = null;
      var savedName = window.YSS._savedVoiceName || '';
      console.log('[YSS] speakCustomSub savedName="'+savedName+'" cachedVoice='+(window.YSS._cachedVoice?window.YSS._cachedVoice.name:'null')+' voices='+window.speechSynthesis.getVoices().length);
      if(savedName){
        var fresh = getVoiceByName(savedName);
        console.log('[YSS] speakCustomSub getVoiceByName("'+savedName+'")=', fresh ? fresh.name : 'null');
        if(fresh) voice = fresh;
      }
      if(!voice && window.YSS._cachedVoice){
        var fresh = getVoiceByName(window.YSS._cachedVoice.name);
        if(fresh) window.YSS._cachedVoice = fresh;
        voice = window.YSS._cachedVoice;
      }
      if(!voice){
        var voices = window.speechSynthesis.getVoices();
        for(var i=0;i<voices.length;i++){
          if(voices[i].lang && voices[i].lang.indexOf(lang.split('-')[0]) === 0){ voice = voices[i]; break; }
        }
      }
      if(voice) u.voice = voice;
      u.rate = window.YSS._cachedRate !== undefined ? window.YSS._cachedRate : 1;
      u.pitch = window.YSS._cachedPitch !== undefined ? window.YSS._cachedPitch : 1;
      u.volume = window.YSS._cachedVolume !== undefined ? window.YSS._cachedVolume : 1;
      console.log('[YSS Reader] batch='+batch.length+' text="'+text.substring(0,80)+'"', voice ? voice.name : 'default', lang, 'rate='+u.rate+' pitch='+u.pitch+' vol='+u.volume);
      u.__yss_custom = true;
      u.onend = u.onerror = function(){
        window.YSS._lastCustomSubTime = lastSub.time + (lastSub.dDurationMs || 2000);
        window.YSS._spokenSubTimes = window.YSS._spokenSubTimes || {};
        for(var bi=0;bi<batch.length;bi++){ window.YSS._spokenSubTimes[batch[bi].time] = true; }
        window.YSS._ttsActive = false; window.YSS._batchPauseEnd = Date.now() + window.YSS._interBatchPauseMs; controlVideoMute();
      };
      window.YSS._ttsActive = true;
      controlVideoMute();
      window.speechSynthesis.speak(u);
    }

    // --- Audio queue player for sequential TTS playback (ElevenLabs or Browser) ---
    function createQueuePlayer(){
      var qp = {
        queue: [],
        currentIdx: -1,
        audioEl: null,
        playing: false,
        _pauseTimer: null,
        _paused: false,
        _volume: 1,
        init: function(){
          qp.audioEl = new Audio();
          qp.audioEl.volume = qp._volume;
          qp.audioEl.onended = function(){ qp.next(); };
          qp.audioEl.onerror = function(){ qp.next(); };
        },
        addBatch: function(text, callback){
          qp.queue.push({ text: text, done: callback, state: 'pending', audioUrl: null });
          if(!qp.playing) qp.next();
        },
        next: function(){
          if(qp._paused) return;
          if(qp._pauseTimer){ clearTimeout(qp._pauseTimer); qp._pauseTimer = null; }
          var prev = qp.queue[qp.currentIdx];
          if(prev){
            if(prev.done) prev.done();
            if(prev.audioUrl){ URL.revokeObjectURL(prev.audioUrl); prev.audioUrl = null; }
          }
          qp.currentIdx++;
          if(qp.currentIdx >= qp.queue.length){
            qp.playing = false;
            qp.currentIdx = qp.queue.length - 1;
            return;
          }
          qp.playing = true;
          var item = qp.queue[qp.currentIdx];
          if(window.YSS._ttsProvider === 'elevenlabs' && window.YSS._elevenLabsApiKey){
            qp.playElevenLabs(item);
          } else {
            qp.playBrowser(item);
          }
        },
        playBrowser: function(item){
          var u = new SpeechSynthesisUtterance(item.text);
          u.__yss_custom = true;
          u.lang = window.YSS._cachedVoiceLang || 'es-ES';
          var voice = null;
          var savedName = window.YSS._savedVoiceName || '';
          if(savedName){ var f = getVoiceByName(savedName); if(f) voice = f; }
          if(!voice && window.YSS._cachedVoice) voice = window.YSS._cachedVoice;
          if(!voice){
            var voices = window.speechSynthesis.getVoices();
            for(var i=0;i<voices.length;i++){ if(voices[i].lang && voices[i].lang.indexOf((window.YSS._cachedVoiceLang||'es-ES').split('-')[0]) === 0){ voice = voices[i]; break; } }
          }
          if(voice) u.voice = voice;
          var baseRate = window.YSS._cachedDynamicRate || (window.YSS._cachedRate !== undefined ? window.YSS._cachedRate : 1);
          u.rate = baseRate;
          u.pitch = window.YSS._cachedPitch !== undefined ? window.YSS._cachedPitch : 1;
          u.volume = window.YSS._cachedVolume !== undefined ? window.YSS._cachedVolume : 1;
          u.onend = function(){ qp.next(); };
          u.onerror = function(){ qp.next(); };
          if(window.YSS._browserSpeak){ window.YSS._browserSpeak(u); }else{ window.speechSynthesis.speak(u); }
        },
        playElevenLabs: function(item){
          var apiKey = window.YSS._elevenLabsApiKey;
          var voiceId = window.YSS._elevenLabsVoiceId;
          fetch('https://api.elevenlabs.io/v1/text-to-speech/' + voiceId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({
              text: item.text,
              model_id: window.YSS._elevenLabsModelId,
              voice_settings: { stability: 0.4, similarity_boost: 0.8 }
            })
          }).then(function(r){
            if(!r.ok) throw new Error('ElevenLabs HTTP '+r.status);
            return r.blob();
          }).then(function(blob){
            item.audioUrl = URL.createObjectURL(blob);
            qp.audioEl.src = item.audioUrl;
            qp.audioEl.volume = qp._volume;
            return qp.audioEl.play();
          }).catch(function(err){
            console.warn('[YSS] ElevenLabs error, falling back to browser TTS:', err.message);
            window.YSS._ttsProvider = 'browser';
            qp.playBrowser(item);
          });
        },
        pause: function(){ qp._paused = true; if(qp.audioEl) qp.audioEl.pause(); window.speechSynthesis.cancel(); },
        resume: function(){ qp._paused = false; if(qp.audioEl && qp.audioEl.src) qp.audioEl.play(); },
        clear: function(){
          var cur = qp.queue[qp.currentIdx];
          if(cur && cur.done) cur.done();
          qp.queue = [];
          qp.currentIdx = -1;
          qp.playing = false;
          if(qp._pauseTimer){ clearTimeout(qp._pauseTimer); qp._pauseTimer = null; }
          if(qp.audioEl){ qp.audioEl.pause(); qp.audioEl.src = ''; }
          window.speechSynthesis.cancel();
        },
        setVolume: function(v){ qp._volume = v; if(qp.audioEl) qp.audioEl.volume = v; },
        isEmpty: function(){ return qp.currentIdx >= qp.queue.length - 1 && !qp.playing; }
      };
      qp.init();
      return qp;
    }

    // --- Ollama local AI translation improvement (queue-based, background worker) ---
    function processOllamaQueue(){
      if(window.YSS._ollamaProcessing) return;
      if(!window.YSS._ollamaQueue || window.YSS._ollamaQueue.length === 0) return;
      window.YSS._ollamaProcessing = true;
      var item = window.YSS._ollamaQueue.shift();
      var prompt = 'You are an expert subtitle translator.\n\nRewrite the following subtitle into natural Latin American Spanish.\n\nPreserve meaning.\n\nUse context if available.\n\nFix literal translations.\n\nIf the sentence implies killing, death, execution, removal, hunting, extermination, or elimination, translate the intended meaning naturally according to context.\n\nDo not explain.\n\nReturn only the improved subtitle.\n\nSubtitle:\n' + item.text;
      var timeoutId = setTimeout(function(){
        console.warn('[YSS AI] timeout for "'+item.text.substring(0,40)+'" after 15s');
        window.YSS._ollamaProcessing = false;
        window.YSS.aiCache[item.text] = item.text;
        item.resolve(item.text);
        processOllamaQueue();
      }, 15000);
      chrome.runtime.sendMessage({
        action: 'ollama_generate',
        apiKey: window.YSS._ollamaApiKey || undefined,
        url: window.YSS._ollamaUrl,
        payload: { model: window.YSS._ollamaModel, prompt: prompt, stream: false, options: { temperature: 0.3 } }
      }, function(response){
        clearTimeout(timeoutId);
        if(chrome.runtime.lastError){
          console.warn('[YSS AI] runtime error:', chrome.runtime.lastError.message, 'falling back to original');
          window.YSS.aiCache[item.text] = item.text;
          window.YSS._ollamaProcessing = false;
          item.resolve(item.text);
          processOllamaQueue();
          return;
        }
        if(response && response.ok && response.response){
          window.YSS.aiCache[item.text] = response.response;
          console.log('[YSS AI] improved: "'+item.text.substring(0,40)+'" -> "'+response.response.substring(0,40)+'"');
          item.resolve(response.response);
        } else {
          var errMsg = response ? response.error : 'no response';
          console.warn('[YSS AI] error:', errMsg, 'falling back to original');
          window.YSS.aiCache[item.text] = item.text;
          item.resolve(item.text);
        }
        window.YSS._ollamaProcessing = false;
        processOllamaQueue();
      });
    }

    function callOllama(text){
      return new Promise(function(resolve){
        window.YSS._ollamaQueue = window.YSS._ollamaQueue || [];
        window.YSS._ollamaQueue.push({text: text, resolve: resolve});
        processOllamaQueue();
      });
    }

    function improveTranslation(text){
      if(!text || text.length < 10 || text.length > 400) return text;
      if(!window.YSS._ollamaEnabled) return text;
      window.YSS.aiCache = window.YSS.aiCache || {};
      if(window.YSS.aiCache[text] !== undefined) return window.YSS.aiCache[text];
      return callOllama(text);
    }

    // [FIX-2] Auto-detect whether to pause video during TTS (same language as audio)
    function _shouldPauseVideoDuringSpeech(){
      if(window.YSS._pauseVideoDuringTts === true) return true;
      if(window.YSS._pauseVideoDuringTts === false) return false;
      var voiceLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
      if(window.YSS._subsSourceLang && window.YSS._subsSourceLang === voiceLang) return true;
      return false;
    }

    // [FIX-2A+2B] Speak via queue with onEnd callback (no async/await, uses .then())
    // @param sub - subtitle object to speak
    // @param onEnd - optional callback invoked when ALL utterances in the batch finish
    function speakViaQueue(sub, onEnd){
      if(!sub || !sub.text) return;
      var batch = collectBatch(sub);
      var fullText = batch.map(function(s){ return s.text; }).join(' ');
      fullText = fullText.replace(/\s+([.,;:!?…])/g,'$1').replace(/\s{2,}/g,' ').trim();
      if(!window.YSS._yss_safeSpeak(fullText)){ console.log('[YSS Queue] SKIP repetitive'); return; }
      var lastSub = batch[batch.length-1];
      window.YSS._lastCustomSpeakTime = Date.now();
      // Auto-detect language from text and select appropriate voice
      var detected = detectTextLang(fullText);
      if(detected && detected !== window.YSS._cachedVoiceLang.split('-')[0]){
        autoSelectVoiceForLang(detected);
      }
      var lang = window.YSS._cachedVoiceLang || 'es-ES';
      var text = normalizeTextForTTS(fullText, lang);
      // Block gap reader immediately while AI processes and TTS plays
      window.YSS._ttsActive = true;
      controlVideoMute();
      // Pause video before TTS if audio language matches TTS language
      if(_shouldPauseVideoDuringSpeech()){
        var _sv = document.querySelector('video');
        if(_sv && !_sv.paused && !_sv.ended){
          _sv.pause();
          window.YSS._pausedForTts = true;
          console.log('[YSS] Paused video for speak-then-advance');
        }
      }
      // [FIX-2A] Replace await with .then() chain for callback-only code
      Promise.resolve(improveTranslation(text)).then(function(improvedText){
        text = improvedText;
        var qp = window.YSS._queuePlayer;
        if(!qp){ qp = createQueuePlayer(); window.YSS._queuePlayer = qp; }
        qp.addBatch(text, function(){
          window.YSS._lastCustomSubTime = lastSub.time + (lastSub.dDurationMs || 2000);
          window.YSS._spokenSubTimes = window.YSS._spokenSubTimes || {};
          for(var bi=0;bi<batch.length;bi++){ window.YSS._spokenSubTimes[batch[bi].time] = true; }
          window.YSS._ttsActive = false;
          window.YSS._firstTtsCompleted = true;
          window.YSS._batchPauseEnd = Date.now() + window.YSS._interBatchPauseMs;
          controlVideoMute();
          // [FIX-2B] Seek video to next subtitle position after speech ends
          if(window.YSS._pausedForTts){
            var _sv = document.querySelector('video');
            if(_sv && !_sv.ended){
              var seekTarget = (window.YSS._lastCustomSubTime) / 1000;
              if(seekTarget > 0 && seekTarget < _sv.duration){
                if(window.YSS._debugMode) console.log('[YSS] Seek after speech to '+seekTarget.toFixed(2)+'s');
                _sv.currentTime = seekTarget;
              }
            }
            window.YSS._pausedForTts = false;
          }
          // [FIX-2B] Fire external onEnd callback when ALL utterances finish
          if(typeof onEnd === 'function') onEnd();
        });
        console.log('[YSS Queue] batch='+batch.length+' text="'+text.substring(0,80)+'" provider='+(window.YSS._ttsProvider||'browser'));
      });
    }

    // --- Gap-filler loop: reads auto-downloaded subs when YSS runs out ---

    // [YSS-FIX-BUG-M4] SPA navigation: reset al cambiar de video en YouTube
    document.addEventListener('yt-navigate-finish', function(){
      window.YSS._bundledSubsRejected = false; // reset bundled subs flag for new video
      if(window.YSS && window.YSS._gapReaderActive){
        console.log('[YSS] SPA navigation — resetting reader for new video');
        window.YSS._gapReaderActive = false;
        window.YSS._customReaderRunning = false;
        window.YSS._lastCustomSubTime = 0;
        window.YSS._spokenSubTimes = {};
        window.YSS._recentSubs = [];
        window.YSS._recentSubTimes = [];
        if(window.YSS._yss_spokenRegistry) window.YSS._yss_spokenRegistry.clear();
        if(window.speechSynthesis) window.speechSynthesis.cancel();
        if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
        // Re-intentar descarga de subs para el nuevo video después de 1.5s
        setTimeout(function(){
          if(typeof autoDownloadSubs === 'function') autoDownloadSubs();
        }, 1500);
      }
    });

    var _gapLoopRunning = false;

    function gapReaderLoop(){
      // BUG-C3: Prevent concurrent instances
      if(_gapLoopRunning) return;
      _gapLoopRunning = true;
      try {
      _gapLoopBody();
      } finally { _gapLoopRunning = false; }
    }

    function _gapLoopBody(){
      if(_dubEngineActive()){ window.YSS._gapReaderActive = false; return; }
      if(!window.YSS._gapReaderActive){
        window.YSS._subsIncompleteActive = false;
        window.YSS._subsIncompleteChecked = false;
        return;
      }
      if(!window.YSS.customSubs || !window.YSS.customSubs.length){
        // Keep retrying — subs may arrive later from InnerTube download
        setTimeout(gapReaderLoop, 2000);
        return;
      }

      var video = document.querySelector('video');
      if(!video || !video.duration){
        setTimeout(gapReaderLoop, 500);
        return;
      }

      // Don't read before video actually starts playing
      if(video.currentTime < 1){
        setTimeout(gapReaderLoop, 500);
        return;
      }

      // Stop if video ended or near end (within 3s)
      if(video.ended || video.currentTime >= video.duration - 3){
        window.YSS._gapReaderActive = false;
        window.YSS._subsIncompleteActive = false;
        window.YSS._subsIncompleteChecked = false;
        console.log('[YSS] Gap-filler finished (video end)');
        return;
      }

      if(video.paused){
        // [FIX-2] If paused intentionally for speak-then-advance, don't fight it
        if(window.YSS._pausedForTts){
          setTimeout(gapReaderLoop, 500);
          return;
        }
        // [FIX-2D] If user paused manually, don't auto-resume
        if(window.YSS._userPaused){
          setTimeout(gapReaderLoop, 500);
          return;
        }
        // If the reader is active and we're still at the very beginning, resume playback.
        // Avoid forcing playback when the user intentionally paused or when the video is farther along.
        if(!window.YSS._freezeApplied && window.YSS._customReaderRunning && video.currentTime < 5 && !video.ended){
          console.log('[YSS GR] resuming early paused video ct='+video.currentTime.toFixed(2));
          video.play();
        }
        if(video.paused){
          setTimeout(gapReaderLoop, 500);
          return;
        }
      }

      // Detect seek: if video time jumped backward or forward >3s, reset and cancel speech
      if(Math.abs(video.currentTime - window.YSS._lastVideoTime) > 3 && window.YSS._lastVideoTime > 0){
        if(window.YSS._debugMode) console.log('[YSS GR] seek detected last='+window.YSS._lastVideoTime.toFixed(2)+' cur='+video.currentTime.toFixed(2));
        window.YSS._lastCustomSubTime = (video.currentTime * 1000) - 2000;
        window.YSS._recentSubs = [];
        window.YSS._recentSubTimes = [];
        window.YSS._spokenSubTimes = {};
        window.YSS._yss_spokenRegistry.clear();
        window.YSS._seekDetected = true;
        window.speechSynthesis.cancel();
        if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
      }

      // Detect playbackRate changes and sync speech rate
      if(window.YSS._lastPlaybackRate !== video.playbackRate){
        window.YSS._lastPlaybackRate = video.playbackRate;
        // Cancel current speech so next utterance picks up new rate
        if(window.YSS._ttsActive || window.speechSynthesis.speaking){
          window.speechSynthesis.cancel();
        }
      }
      window.YSS._lastVideoTime = video.currentTime;

      // Stop if YSS has spoken multiple segments recently (complete subs detected)
      if(window.YSS._yssSpokenCount > 5 && window.YSS._yssLastSpeakTime > 0 && Date.now() - window.YSS._yssLastSpeakTime < 10000){
        window.YSS._gapReaderActive = false;
        window.YSS._subsIncompleteActive = false;
        window.YSS._subsIncompleteChecked = false;
        console.log('[YSS] Gap-filler stopped (YSS resumed, '+window.YSS._yssSpokenCount+' segments)');
        return;
      }

      // Enforce inter-sentence pause between batches
      if(window.YSS._batchPauseEnd && Date.now() < window.YSS._batchPauseEnd){
        setTimeout(gapReaderLoop, 300);
        return;
      }

      var nowMs = (video.currentTime + (window.YSS.syncOffsetMs||0)/1000) * 1000;
      // Clean old entries from spokenSubTimes (older than 60s behind current time)
      window.YSS._spokenSubTimes = window.YSS._spokenSubTimes || {};
      window.YSS._gcCounter = (window.YSS._gcCounter||0) + 1;
      if(window.YSS._gcCounter % 50 === 0){
        var _cutoff = nowMs - 60000;
        for(var _st in window.YSS._spokenSubTimes){
          if(parseInt(_st) < _cutoff) delete window.YSS._spokenSubTimes[_st];
        }
      }
      if(window.YSS._lastCustomSubTime > video.duration * 1000){
        console.log('[YSS GR] reset lastCustomSubTime from '+window.YSS._lastCustomSubTime+' to '+ (nowMs-2000));
        window.YSS._lastCustomSubTime = nowMs - 2000;
      }

      // Sync catch-up: if TTS is >3s behind video time, skip ahead to current sub
      if(window.YSS._lastCustomSubTime > 0 && nowMs > window.YSS._lastCustomSubTime + 8000){ // [YSS-FIX-BUG-A1] umbral 3s→8s para no cancelar durante traducción Ollama
        console.log('[YSS GR] sync catch-up lastCustomSubTime='+window.YSS._lastCustomSubTime+' nowMs='+nowMs+' dt='+((nowMs-window.YSS._lastCustomSubTime)/1000).toFixed(1)+'s');
        window.YSS._lastCustomSubTime = nowMs - 2000;
        window.speechSynthesis.cancel();
      }
      if(window.YSS._debugMode) console.log('[YSS GR] loop nowMs='+nowMs.toFixed(0)+' last='+window.YSS._lastCustomSubTime+' gap='+((nowMs-window.YSS._lastCustomSubTime)/1000).toFixed(1)+'s'); // [YSS-FIX-BUG-L2]

      var sub = null;
      var exact = findSubAtTime(nowMs);
      if(exact && (!window.YSS._spokenSubTimes || !window.YSS._spokenSubTimes[exact.time])){
        sub = exact;
      } else {
        sub = findNextUnspokenSub(nowMs);
      }

      if(sub && sub.time < window.YSS._lastCustomSubTime){
        var next = findNextUnspokenSub(nowMs);
        if(next && next.time < nowMs + 5000){
          if(window.YSS._debugMode) if(window.YSS._debugMode) console.log('[YSS GR] already spoken sub='+sub.time+'ms -> next unspoken='+next.time+'ms');
          sub = next;
        } else {
          console.log('[YSS GR] already spoken sub='+sub.time+'ms, no next found within 5s (last='+window.YSS._lastCustomSubTime+'ms)');
          sub = null;
        }
      }

      if(!sub){
        var closest = null;
        if(window.YSS.customSubs && window.YSS.customSubs.length){
          for(var _kk=0;_kk<window.YSS.customSubs.length;_kk++){
            if(window.YSS.customSubs[_kk].time >= nowMs - 3000 && window.YSS.customSubs[_kk].time <= nowMs + 3000){
              closest = window.YSS.customSubs[_kk]; break;
            }
          }
        }
        if(window.YSS._debugMode) console.log('[YSS GR] no sub found, ct='+video.currentTime.toFixed(2)+'s nowMs='+nowMs.toFixed(0)+' last='+window.YSS._lastCustomSubTime+(closest?' closest='+closest.time+'ms diff='+(nowMs-closest.time).toFixed(0)+'ms':''));
        setTimeout(gapReaderLoop, 500);
        return;
      }

      if(sub && sub.time >= window.YSS._lastCustomSubTime){
        if(!window.YSS._recentSubs) window.YSS._recentSubs = [];
        if(!window.YSS._recentSubTimes) window.YSS._recentSubTimes = [];
        window.YSS._spokenSubTimes = window.YSS._spokenSubTimes || {};
        if(window.YSS._spokenSubTimes[sub.time]){
          if(window.YSS._debugMode) console.log('[YSS GR] SKIP already-spoken sub='+sub.time+'ms');
          setTimeout(gapReaderLoop, 250);
          return;
        }
        var skip = false;
        for(var si=0;si<window.YSS._recentSubs.length;si++){
          if(window.YSS._recentSubs[si] === sub.time && Date.now() - window.YSS._recentSubTimes[si] < 3000){ skip = true; break; }
        }
        if(!skip){
          console.log('[YSS GR] SPEAK sub='+sub.time+'ms text="'+sub.text.substring(0,30)+'" ct='+video.currentTime.toFixed(2)+'s lastCustom='+window.YSS._lastCustomSubTime);
          window.YSS._recentSubs.push(sub.time);
          window.YSS._recentSubTimes.push(Date.now());
          if(window.YSS._recentSubs.length > 20){ window.YSS._recentSubs.shift(); window.YSS._recentSubTimes.shift(); }

          // --- Speaking control: apply lag correction strategy ---
          var lagMs = nowMs - sub.time;
          if(lagMs > 300 && sub.dDurationMs > 0){
            var baseRate = window.YSS._cachedRate || 1;
            var maxRate = 2;
            var neededRate = baseRate * Math.min(2, Math.max(1, (lagMs + 300) / sub.dDurationMs));
            if(window.YSS._speakingControl === 'video'){
              var targetVideoRate = Math.max(0.25, video.playbackRate * (baseRate / neededRate));
              video.playbackRate = targetVideoRate;
              window.YSS._cachedDynamicRate = null;
              if(window.YSS._debugMode) console.log('[YSS GR] speaking_control=video lag='+lagMs+'ms videoRate='+targetVideoRate.toFixed(2));
            } else {
              window.YSS._cachedDynamicRate = neededRate;
              if(video.playbackRate < 0.99) video.playbackRate = 1;
              if(window.YSS._debugMode) console.log('[YSS GR] speaking_control=voice lag='+lagMs+'ms dynamicRate='+neededRate.toFixed(2));
            }
          } else {
            window.YSS._cachedDynamicRate = null;
            if(window.YSS._speakingControl === 'video' && video.playbackRate < 0.99){
              video.playbackRate = 1;
            }
          }

          // Wait for current speech to finish instead of canceling mid-batch
          if(window.YSS._ttsActive){
            setTimeout(gapReaderLoop, 250);
            return;
          }
          if(window.speechSynthesis.speaking) window.speechSynthesis.cancel();
          // [YSS-FIX-BUG-A2] No hablar si dubbing overlay está activo (evita doble overlay)
          if(window.YSS._dubbingOverlayActive){ setTimeout(gapReaderLoop, 500); return; }
          speakViaQueue(sub);
        } else {
          if(window.YSS._debugMode) console.log('[YSS GR] SKIP duplicate sub='+sub.time+'ms');
        }
      }
      setTimeout(gapReaderLoop, 250);

      // Start activation check only if user has uploaded custom subs
      if(window.YSS._userCustomSubsActive) setTimeout(checkForActivation, 1000);
      window.YSS._customReaderInited = true;
    }

    // Try loading YSS settings from storage
    try {
      chrome.storage.sync.get(['rate','pitch','volume'], function(d){
        if(d && typeof d.rate !== 'undefined') window.YSS._cachedRate = d.rate;
        if(d && typeof d.pitch !== 'undefined') window.YSS._cachedPitch = d.pitch;
        if(d && typeof d.volume !== 'undefined') window.YSS._cachedVolume = d.volume;
      });
    }catch(e){}
    // Load speaking_control setting
    try {
      chrome.storage.sync.get('speaking_control', function(d){
        if(d && d.speaking_control) window.YSS._speakingControl = d.speaking_control;
      });
    }catch(e){}
    // Also try YSS options format
    try {
      chrome.storage.sync.get('options', function(d){
        if(d && d.options){
          if(typeof d.options.rate !== 'undefined') window.YSS._cachedRate = d.options.rate;
          if(typeof d.options.pitch !== 'undefined') window.YSS._cachedPitch = d.options.pitch;
          if(typeof d.options.volume !== 'undefined') window.YSS._cachedVolume = d.options.volume;
          if(d.options.speaking_control) window.YSS._speakingControl = d.options.speaking_control;
        }
      });
    }catch(e){}
    // Load sync offset from storage
    try {
      chrome.storage.sync.get('sync_offset_ms', function(d){
        if(d && d.sync_offset_ms != null) window.YSS.syncOffsetMs = parseInt(d.sync_offset_ms) || 0;
      });
    }catch(e){}

    // Load ElevenLabs and TTS settings
    try {
      chrome.storage.sync.get(['tts_provider','eleven_api_key','eleven_voice_id','tts_lang','yss_voice_name'], function(d){
        if(d && d.tts_provider) window.YSS._ttsProvider = d.tts_provider;
        if(d && d.eleven_api_key) window.YSS._elevenLabsApiKey = d.eleven_api_key;
        if(d && d.eleven_voice_id) window.YSS._elevenLabsVoiceId = d.eleven_voice_id;
        if(d && d.tts_lang) window.YSS._cachedVoiceLang = d.tts_lang;
        if(d && d.yss_voice_name) window.YSS._savedVoiceName = d.yss_voice_name;
      });
    }catch(e){}

    // Load Ollama settings from storage
    try {
      chrome.storage.sync.get(['ollama_enabled','ollama_model','ollama_api_key'], function(d){
        if(d && d.ollama_enabled != null) window.YSS._ollamaEnabled = !!d.ollama_enabled;
        if(d && d.ollama_model) window.YSS._ollamaModel = d.ollama_model;
        if(d && d.ollama_api_key) window.YSS._ollamaApiKey = d.ollama_api_key;
      });
    }catch(e){}
    // Listen for live Ollama setting changes from popup
    try {
      chrome.storage.onChanged.addListener(function(c,a){
        if(a!=='sync')return;
        if('ollama_enabled' in c) window.YSS._ollamaEnabled = !!c.ollama_enabled.newValue;
        if('ollama_model' in c && c.ollama_model.newValue) window.YSS._ollamaModel = c.ollama_model.newValue;
        if('ollama_api_key' in c) window.YSS._ollamaApiKey = c.ollama_api_key.newValue || '';
      });
    }catch(e){}

    // --- Early pause + mute to prevent original audio leaking while subs load ---
    try {
      var _earlyVideo = document.querySelector('video');
      if(_earlyVideo && _earlyVideo.duration > 5 && getVideoId()){
        if(!_earlyVideo.paused && !window.YSS._subsDownloaded){
          window.YSS._transitionTo('LOADING');
        }
      }
    } catch(e){}

    // --- Subtitle completeness check & gap-filler ---
    if(!window.YSS._customReaderRunning) window.YSS._gapReaderActive = false;
    window.YSS._gapReaderLastSpeak = 0;

    // Track video playbackRate changes
    try {
      var _rateVideo = document.querySelector('video');
      if(_rateVideo){
        window.YSS._lastPlaybackRate = _rateVideo.playbackRate;
        _rateVideo.addEventListener('ratechange', function(){
          window.YSS._lastPlaybackRate = this.playbackRate;
        });
      }
    } catch(e){};

    // Auto-download subs via InnerTube API as background task
    if(!window.YSS._innertubeDownloading){
      setTimeout(autoDownloadSubs, 3000);
    }
    // Safety: reset stuck _innertubeDownloading after 30s
    setTimeout(function(){
      if(window.YSS._innertubeDownloading){
        window.YSS._innertubeDownloading = false;
      }
    }, 30000);

    // Periodic check: compare YSS vs auto-downloaded segment counts
    setInterval(function(){
      if(window.YSS._userCustomSubsActive) return; // Don't interfere with user's custom subs
      if(window.YSS._gapReaderActive || window.YSS._subsIncompleteActive) return;

      // Retry subtitle download if cooldown expired and no subs loaded
      var hasSubs = window.YSS.customSubs && window.YSS.customSubs.length > 0;
      if(!hasSubs && window.YSS._subDownloadCooldown && Date.now() >= window.YSS._subDownloadCooldown){
        window.YSS._subDownloadCooldown = 0;
        autoDownloadSubs();
        return;
      }

      if(window.YSS._subsIncompleteChecked) return; // Only check once

      var video = document.querySelector('video');

      // Skip YSS-never-spoke checks if our reader is already running
      if(window.YSS._customReaderRunning || window.YSS._gapReaderActive) return;

      // Fallback: if YSS silent while video plays, start gap-filler early
      var yssNeverSpoke = window.YSS._yssLastSpeakTime === 0 || window.YSS._yssLastSpeakTime === undefined;
      if(video && !video.ended && (video.currentTime > 3 || window.YSS._freezeApplied)){
        var silence = window.YSS._yssLastSpeakTime > 0 ? Date.now() - window.YSS._yssLastSpeakTime : 999999;
        if(yssNeverSpoke){
          if(window.YSS.customSubs && window.YSS.customSubs.length >= 3){
            startGapFiller('YSS never spoke');
            return;
          }
          return; // Wait for more subs
        }
        if(window.YSS._lastSpeakTime > 0 && silence > 8000){
          if(window.YSS.customSubs && window.YSS.customSubs.length >= 3){
            startGapFiller('YSS silent '+(silence/1000).toFixed(0)+'s');
            return;
          }
          return; // Try again next interval
        }
      }

      var autoCount = window.YSS.customSubs && window.YSS.customSubs.length ? window.YSS.customSubs.length : 0;
      if(video && !video.ended && (video.currentTime > 3 || window.YSS._freezeApplied) && autoCount >= 3 && !window.YSS._customReaderRunning && !window.YSS._gapReaderActive && !window.YSS._subsIncompleteActive){
        startGapFiller('auto subs available');
        return;
      }
      if(autoCount < 20) return; // Not enough auto-downloaded data yet
      if(video && video.currentTime < 20) return; // Need 20s+ of video for meaningful data

      var yssCount = window.YSS._yssSpokenCount || 0;
      // If auto has 2x+ more segments than YSS has spoken -> YSS is incomplete
      var ratio = autoCount / Math.max(yssCount, 1);
      if(ratio >= 2.0){
        console.log('[YSS] Incomplete subs: YSS='+yssCount+' auto='+autoCount+' ratio='+ratio.toFixed(1)+'x. Switching to auto.');
        startGapFiller('incomplete subs');
        return;
      }

      // Similar counts -> complete
      if(video && video.currentTime > 60){
        window.YSS._subsIncompleteChecked = true;
        console.log('[YSS] Subs appear complete: YSS='+yssCount+' auto='+autoCount+' ratio='+ratio.toFixed(1)+'x');
      }
    }, 5000);

    function startGapFiller(reason){
      window.YSS._subsIncompleteActive = true;
      // BUG-C4: Init lastCustomSubTime from video position (mid-video seek)
      var _v = document.querySelector('video');
      if(_v && _v.currentTime > 1 && (!window.YSS._lastCustomSubTime || window.YSS._lastCustomSubTime < 1000)){
        window.YSS._lastCustomSubTime = (_v.currentTime * 1000) - 2000;
      }
      window.YSS._gapReaderActive = true;
      window.YSS._customReaderRunning = true;
      window.YSS._subsIncompleteChecked = true;
      console.log('[YSS] Gap-filler ('+reason+')');
      // If we have bundled subs ready, transition to PLAYING (unfreeze + remove overlay)
      if(window.YSS._state !== 'PLAYING' && window.YSS.customSubs && window.YSS.customSubs.length > 0){
        window.YSS._transitionTo('PLAYING');
      }
      var video = document.querySelector('video');
      if(video && !video.paused){
        video.muted = true;
      }
      controlVideoMute();
      gapReaderLoop();
    }

    window.YSS.speakText = function(text,lang){ var f=normalizeTextForTTS(text,lang); var u=new SpeechSynthesisUtterance(f); u.lang=lang||'es-ES'; u.__yss_custom=true; window.speechSynthesis.speak(u); return f; };

    // Download subtitles using YouTube's InnerTube API (replaces deprecated timedtext)
    function autoDownloadSubs(){
      if(window.YSS._innertubeDownloading) return;
      if(window.YSS._subDownloadCooldown && Date.now() < window.YSS._subDownloadCooldown) return;
      // If bundled subs active and reader running, skip entirely
      if(window.YSS._customReaderRunning && window.YSS.customSubs && window.YSS.customSubs.length > 10){
        console.log('[YSS] Skipping autoDownloadSubs — bundled subs active');
        return;
      }
      window.YSS._innertubeDownloading = true;
      var vid = getVideoId();
      if(!vid){
        window.YSS._innertubeDownloading = false;
        return;
      }
      console.log('[YSS] Fetching subs via InnerTube API for video:', vid);

      // If gap-filler already running with bundled subs, skip freeze/overlay
      if(window.YSS._customReaderRunning && window.YSS.customSubs && window.YSS.customSubs.length > 10){
        console.log('[YSS] Skipping FETCHING_SUBS transition — gap-filler already active');
      } else {
        // Show loading overlay (pauses + mutes video to prevent original audio leak)
        window.YSS._transitionTo('FETCHING_SUBS');
      }

      // Extract INNERTUBE_API_KEY (try ytcfg first, then parse scripts)
      var _apiKey = null;
      try { if(window.ytcfg && window.ytcfg.get) _apiKey = window.ytcfg.get('INNERTUBE_API_KEY'); } catch(e){}
      if(!_apiKey){
        try {
          var _scripts = document.querySelectorAll('script');
          for(var _i=0;_i<_scripts.length;_i++){
            var _text = _scripts[_i].textContent || '';
            var _m = _text.match(/INNERTUBE_API_KEY["']:\s*["']([a-zA-Z0-9_-]+)["']/);
            if(_m && _m[1]){ _apiKey = _m[1]; break; }
          }
        } catch(e){}
      }

      // [FIX-1B] Using fetch() instead of XHR — MV3 content scripts block setRequestHeader('Referer')
      // fetch() has fewer restrictions and handles redirects transparently
      function fetchSubsUrl(url, cb, attempt){
        if(!url || typeof url !== 'string'){
          console.warn('[YSS] fetchSubsUrl: invalid URL:', url);
          cb(new Error('Invalid URL'));
          return;
        }
        attempt = attempt || 1;
        console.log('[YSS] fetchSubsUrl attempt='+attempt+' url='+url); // full URL for debug
        fetch(url)
          .then(function(response){
            var status = response.status;
            console.log('[YSS] fetchSubsUrl attempt='+attempt+' status='+status+' ok='+response.ok);
            if(!response.ok){
              console.warn('[YSS] fetchSubsUrl HTTP error: '+status);
              cb(new Error('HTTP '+status));
              return null;
            }
            return response.text();
          })
          .then(function(body){
            if(body === null) return;
            if(!body || body.length < 10){
              console.warn('[YSS] fetchSubsUrl empty body status=200 bytes=0 body=""');
              cb(new Error('Empty response'));
              return;
            }
            if(/^[\s\S]*?<html/i.test(body)){
              console.warn('[YSS] fetchSubsUrl HTML response (blocked/expired), first 200='+body.substring(0,200));
              cb(new Error('HTML response'), body);
              return;
            }
            console.log('[YSS] fetchSubsUrl OK: '+body.length+' bytes, preview="'+body.substring(0,150)+'"');
            cb(null, body);
          })
          .catch(function(err){
            console.warn('[YSS] fetchSubsUrl fetch error attempt='+attempt+': '+err.message);
            cb(new Error('Fetch failed'));
          });
      }

      function parsePlayerResponseFromHtml(html){
        if(!html || typeof html !== 'string') return null;
        var match = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
        if(!match) match = html.match(/window\[\s*['\"]ytInitialPlayerResponse['\"]\s*\]\s*=\s*({[\s\S]*?});/);
        if(!match) return null;
        try {
          return JSON.parse(match[1]);
        } catch(e){
          return null;
        }
      }

      function processCaptionTracks(captionTracks, retryCount){
        if(retryCount === undefined) retryCount = 0;
        function _resumeIfPaused(){
          window.YSS._cleanupLoading(true);
        }
        if(!captionTracks || !captionTracks.length){
          console.warn('[YSS] No caption tracks found, trying timedtext type=list');
          tryTranscriptFallback(function(terr, transcriptSubs){
            if(!terr && transcriptSubs && transcriptSubs.length > 5){
              onSubsReady(transcriptSubs);
            } else {
              console.warn('[YSS] timedtext fallback also failed, giving up');
              window.YSS._innertubeDownloading = false;
              _resumeIfPaused();
            }
          });
          return false;
        }
        var track = null;
        var prefLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
        // 1) Exact match for preferred language
        for(var i=0;i<captionTracks.length;i++){
          if(captionTracks[i].languageCode === prefLang){ track = captionTracks[i]; break; }
        }
        // 2) If translating, prefer English as source (best translation quality)
        if(!track && prefLang !== 'en'){
          for(var i=0;i<captionTracks.length;i++){
            if(captionTracks[i].languageCode === 'en' && captionTracks[i].isTranslatable){ track = captionTracks[i]; break; }
          }
        }
        // 3) Fallback: any translatable track
        if(!track){
          for(var i=0;i<captionTracks.length;i++){
            if(captionTracks[i].isTranslatable){ track = captionTracks[i]; break; }
          }
        }
        // 4) Last resort: first track
        if(!track) track = captionTracks[0];
        var baseUrl = track.baseUrl;
        if(!baseUrl){
          window.YSS._innertubeDownloading = false;
          _resumeIfPaused();
          return false;
        }
        // If preferred lang not available and track is translatable, add tlang param
        if(track.languageCode !== prefLang && track.isTranslatable){
          var sep = baseUrl.indexOf('?') > -1 ? '&' : '?';
          baseUrl += sep + 'tlang=' + encodeURIComponent(prefLang);
          console.log('[YSS] Translating '+track.languageCode+' subs -> '+prefLang);
        } else {
          console.log('[YSS] Using '+track.languageCode+' subs');
        }
        // [FIX-2] Store source subtitle language for speak-then-advance detection
        window.YSS._subsSourceLang = track.languageCode;
        // [FIX-1A] Ensure URL has &lang= (YouTube returns empty without it)
        if(baseUrl.indexOf('&lang=') === -1 && baseUrl.indexOf('?lang=') === -1){
          baseUrl += '&lang=' + encodeURIComponent(track.languageCode);
        }
        // [FIX-1A] Ensure URL has &name= (some tracks require it)
        if(baseUrl.indexOf('&name=') === -1 && baseUrl.indexOf('?name=') === -1){
          var trackName = '';
          try{ trackName = track.name.simpleText || track.name || ''; }catch(e){ try{ trackName = track.name || ''; }catch(e){} }
          if(trackName) baseUrl += '&name=' + encodeURIComponent(trackName);
        }
        // [FIX-1A] Default to fmt=srv3 (XML format that regex parsers re1/re2 handle)
        if(baseUrl.indexOf('&fmt=') === -1 && baseUrl.indexOf('?fmt=') === -1){
          baseUrl += '&fmt=srv3';
        }

        // Build protobuf params for get_transcript: field 1 (string) = videoId
        function buildTranscriptParams(videoId){
          var tag = String.fromCharCode(0x0a);
          var len = String.fromCharCode(videoId.length);
          return btoa(tag + len + videoId);
        }

        function tryTranscriptFallback(cb){
          var _apiKeyInner = _apiKey || '';
          var _clientVerTranscript = '2.20260603.05.00';
          try{ if(window.ytcfg && window.ytcfg.get){ var _v = window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION'); if(_v) _clientVerTranscript = _v; } }catch(e){}
          if(_clientVerTranscript === '2.20260603.05.00'){
            try{ var _ss=document.querySelectorAll('script');for(var _i=0;_i<_ss.length;_i++){var _mc=_ss[_i].textContent.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/);if(_mc&&_mc[1]){_clientVerTranscript=_mc[1];break;}} }catch(e){}
          }
          var _hlTranscript = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
          var _glTranscript = 'EC';
          try{ _glTranscript = (navigator.language || 'es-EC').split('-')[1] || 'EC'; }catch(e){}

          // Step 1: try get_transcript (InnerTube API, avoids timedtext rate limiting)
          var _transcriptParams = buildTranscriptParams(vid);
          var _getTranscriptUrl = 'https://www.youtube.com/youtubei/v1/get_transcript';
          if(_apiKeyInner) _getTranscriptUrl += '?key=' + encodeURIComponent(_apiKeyInner);
          console.log('[YSS] Trying get_transcript (clientVer='+_clientVerTranscript+' url='+_getTranscriptUrl.replace(/\?key=.*$/, '?key=...')+')');
          // Match exact PowerShell request (no cookies, no extra headers)
          fetch(_getTranscriptUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            credentials: 'omit',
            body: JSON.stringify({
              context: {
                client: { clientName: 'WEB', clientVersion: _clientVerTranscript, hl: _hlTranscript, gl: _glTranscript },
                user: { lockedSafetyMode: false }
              },
              params: _transcriptParams,
              contentCheckOk: true,
              racyCheckOk: true
            })
          })
          .then(function(resp){
            console.log('[YSS] get_transcript response status='+resp.status+' len='+(resp.headers.get('content-length')||'?'));
            if(!resp.ok){
              return resp.text().then(function(body){
                throw new Error('HTTP '+resp.status+': '+(body||'').substring(0,300));
              });
            }
            return resp.json();
          })
          .then(function(data){
            var _segments = [];
            var _actions = data.actions;
            if(_actions){
              for(var _ai=0;_ai<_actions.length;_ai++){
                var _eng = _actions[_ai].updateEngagementPanelAction || _actions[_ai].appendContinuationItemsAction;
                if(!_eng || !_eng.items) continue;
                for(var _si=0;_si<_eng.items.length;_si++){
                  var _item = _eng.items[_si];
                  var _seg = _item.transcriptSegmentRenderer;
                  if(!_seg && _item.content && _item.content.transcriptSegmentRenderer){
                    _seg = _item.content.transcriptSegmentRenderer;
                  }
                  if(!_seg) continue;
                  var _startMs = parseInt(_seg.startMs) || 0;
                  var _endMs = parseInt(_seg.endMs) || 0;
                  var _text = '';
                  try{ _text = _seg.snippet.runs.map(function(r){return r.text;}).join(''); }catch(e){ try{ _text = _seg.snippet.simpleText || ''; }catch(e){} }
                  if(_text && _startMs && _endMs){
                    _segments.push({time: _startMs, dDurationMs: _endMs - _startMs, text: _text});
                  }
                }
              }
            }
            if(_segments.length > 5){
              console.log('[YSS] get_transcript OK: '+_segments.length+' segments');
              cb(null, _segments);
            } else {
              console.warn('[YSS] get_transcript too few segments: '+_segments.length+', trying timedtext type=list');
              attemptTimedtextList();
            }
          })
          .catch(function(err){
            console.warn('[YSS] get_transcript failed: '+err.message+', trying timedtext type=list');
            attemptTimedtextList();
          });

          // Step 2: fallback to timedtext?type=list if get_transcript fails
          function attemptTimedtextList(){
            console.log('[YSS] Trying timedtext?type=list fallback');
            var trackListUrl = 'https://www.youtube.com/api/timedtext?v='+encodeURIComponent(vid)+'&type=list';
            fetch(trackListUrl)
              .then(function(resp){
                if(!resp.ok){ throw new Error('HTTP '+resp.status); }
                return resp.text();
              })
              .then(function(xmlText){
                if(!xmlText || xmlText.length < 20 || /^[\s\S]*?<html/i.test(xmlText)){
                  throw new Error('Empty or HTML response');
                }
                var parser = new DOMParser();
                var xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                var trackEls = xmlDoc.getElementsByTagName('track');
                if(!trackEls || !trackEls.length){
                  throw new Error('No tracks in list');
                }
                var availableTracks = [];
                for(var _ti=0;_ti<trackEls.length;_ti++){
                  var langCode = trackEls[_ti].getAttribute('lang_code');
                  var name = trackEls[_ti].getAttribute('name');
                  var kind = trackEls[_ti].getAttribute('kind') || '';
                  if(langCode && name){
                    availableTracks.push({languageCode: langCode, name: {simpleText: name}, kind: kind});
                  }
                }
                if(!availableTracks.length){
                  throw new Error('No usable tracks from list');
                }
                console.log('[YSS] timedtext tracks: '+availableTracks.length+' ('+availableTracks.map(function(t){return t.languageCode+'/'+t.kind;}).join(',')+')');
                var prefLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
                var bestTrack = null;
                for(var _ti=0;_ti<availableTracks.length;_ti++){
                  if(availableTracks[_ti].languageCode === prefLang){ bestTrack = availableTracks[_ti]; break; }
                }
                if(!bestTrack && prefLang !== 'en'){
                  for(var _ti=0;_ti<availableTracks.length;_ti++){
                    if(availableTracks[_ti].languageCode === 'en' && availableTracks[_ti].kind === ''){ bestTrack = availableTracks[_ti]; break; }
                  }
                }
                if(!bestTrack){
                  for(var _ti=0;_ti<availableTracks.length;_ti++){
                    if(availableTracks[_ti].kind === ''){ bestTrack = availableTracks[_ti]; break; }
                  }
                }
                if(!bestTrack) bestTrack = availableTracks[0];
                var subUrl = 'https://www.youtube.com/api/timedtext?v='+encodeURIComponent(vid);
                subUrl += '&lang=' + encodeURIComponent(bestTrack.languageCode);
                var bestName = '';
                try{ bestName = bestTrack.name.simpleText || bestTrack.name || ''; }catch(e){ try{ bestName = bestTrack.name || ''; }catch(e){} }
                if(bestName) subUrl += '&name=' + encodeURIComponent(bestName);
                subUrl += '&fmt=srv3';
                if(bestTrack.kind === 'asr') subUrl += '&caps=asr';
                if(bestTrack.languageCode !== prefLang){
                  subUrl += '&tlang=' + encodeURIComponent(prefLang);
                }
                console.log('[YSS] timedtext sub URL: '+subUrl);
                fetch(subUrl)
                  .then(function(resp2){
                    if(!resp2.ok){ throw new Error('Sub HTTP '+resp2.status); }
                    return resp2.text();
                  })
                  .then(function(subBody){
                    if(!subBody || subBody.length < 10 || /^[\s\S]*?<html/i.test(subBody)){
                      throw new Error('Sub body empty or HTML');
                    }
                    var subs = parseSubsBody(subBody);
                    if(subs && subs.length > 5){
                      console.log('[YSS] timedtext fallback OK: '+subs.length+' segments');
                      cb(null, subs);
                    } else {
                      throw new Error('Too few subs: '+(subs?subs.length:'0'));
                    }
                  })
                  .catch(function(subErr){
                    console.warn('[YSS] timedtext sub fetch failed: '+subErr.message);
                    var jsonUrl = subUrl.replace(/fmt=srv3/g, 'fmt=json3');
                    fetch(jsonUrl)
                      .then(function(resp3){
                        if(!resp3.ok) throw new Error('json3 HTTP '+resp3.status);
                        return resp3.text();
                      })
                      .then(function(jsonBody){
                        if(!jsonBody || jsonBody.length < 10) throw new Error('json3 empty');
                        var subs = parseSubsBody(jsonBody);
                        if(subs && subs.length > 5){
                          console.log('[YSS] timedtext json3 fallback OK: '+subs.length+' segments');
                          cb(null, subs);
                        } else {
                          throw new Error('Too few subs from json3');
                        }
                      })
                      .catch(function(jsonErr){
                        console.warn('[YSS] timedtext all formats failed: '+jsonErr.message);
                        cb(new Error('Timedtext fallback failed'));
                      });
                  });
              })
              .catch(function(err){
                console.warn('[YSS] timedtext type=list failed: '+err.message);
                cb(new Error('Track list fetch failed'));
              });
          }
        }

        function tryFetchSubsWithRetry(fetchUrl, attempt){
          attempt = attempt || 1;
          console.log('[YSS] Sub fetch attempt '+attempt+'/4');
          fetchSubsUrl(fetchUrl, function(err, body){
            // On ANY failure, retry with different strategy
            var failed = err || !body || body.length < 10 || /^[\s\S]*?<html/i.test(body || '');
            if(failed){
              // Try to parse ytInitialPlayerResponse from HTML body anyway
              if(body && /^[\s\S]*?<html/i.test(body)){
                var pr = parsePlayerResponseFromHtml(body);
                if(pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks){
                  console.warn('[YSS] HTML body contained ytInitialPlayerResponse, re-parsing tracks');
                  return processCaptionTracks(pr.captions.playerCaptionsTracklistRenderer.captionTracks, retryCount + 1);
                }
              }
              // Attempt 2: get fresh caption URLs from InnerTube API
              if(attempt < 2 && _apiKey){
                console.warn('[YSS] Attempt 2/4: fetching fresh URLs from InnerTube API');
                // Extract actual client version from page ytcfg if available
                var _clientVer = '2.20260603.05.00';
                try{ if(window.ytcfg && window.ytcfg.get){ var _v = window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION'); if(_v) _clientVer = _v; } }catch(e){}
                if(_clientVer === '2.20260603.05.00'){
                  try{ var _ss2=document.querySelectorAll('script');for(var _i2=0;_i2<_ss2.length;_i2++){var _mc2=_ss2[_i2].textContent.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/);if(_mc2&&_mc2[1]){_clientVer=_mc2[1];break;}} }catch(e){}
                }
                var xhr2 = new XMLHttpRequest();
                window.YSS._pendingXhr2 = xhr2; // BUG-A4: store for cancellation
                xhr2.open('POST', 'https://www.youtube.com/youtubei/v1/player?key='+encodeURIComponent(_apiKey), true);
                xhr2.setRequestHeader('Content-Type', 'application/json');
                xhr2.onload = function(){
                  window.YSS._pendingXhr2 = null;
                  console.log('[YSS] InnerTube player response status='+xhr2.status+' len='+(xhr2.responseText?xhr2.responseText.length:0));
                  try {
                    var data = JSON.parse(xhr2.responseText);
                    if(window.YSS._debugMode || true){
                      var _topKeys2 = Object.keys(data).join(',');
                      var _play2 = data.playabilityStatus ? data.playabilityStatus.status + '|' + (data.playabilityStatus.reason||'') : 'N/A';
                      var _cap2 = data.captions ? JSON.stringify(data.captions).substring(0,400) : 'undefined';
                      console.log('[YSS] player2 keys: '+_topKeys2+' | playability: '+_play2);
                      console.log('[YSS] player2 captions: '+_cap2);
                    }
                    var ct = null;
                    try{ ct = data.captions.playerCaptionsTracklistRenderer.captionTracks; }catch(e){}
                    if(ct && ct.length){
                      var freshTrack = findBestTrack(ct);
                      if(freshTrack && freshTrack.baseUrl){
                        var freshUrl = freshTrack.baseUrl;
                        if(freshUrl.indexOf('&lang=') === -1 && freshUrl.indexOf('?lang=') === -1){
                          freshUrl += '&lang=' + encodeURIComponent(freshTrack.languageCode);
                        }
                        if(freshUrl.indexOf('&name=') === -1 && freshUrl.indexOf('?name=') === -1){
                          var _tn = '';
                          try{ _tn = freshTrack.name.simpleText || freshTrack.name || ''; }catch(e){ try{ _tn = freshTrack.name || ''; }catch(e){} }
                          if(_tn) freshUrl += '&name=' + encodeURIComponent(_tn);
                        }
                        if(freshUrl.indexOf('&fmt=') === -1 && freshUrl.indexOf('?fmt=') === -1){
                          freshUrl += '&fmt=srv3';
                        }
                        if(freshTrack.languageCode !== prefLang && freshTrack.isTranslatable){
                          var sep = freshUrl.indexOf('?') > -1 ? '&' : '?';
                          freshUrl += sep + 'tlang=' + encodeURIComponent(prefLang);
                        }
                        console.log('[YSS] Fresh URL: '+freshUrl);
                        tryFetchSubsWithRetry(freshUrl, attempt + 1);
                        return;
                      }
                    }
                  }catch(e){
                    console.warn('[YSS] InnerTube player parse failed:', e.message, 'response='+(xhr2.responseText||'').substring(0,300));
                  }
                  console.warn('[YSS] InnerTube returned no tracks, trying timedtext type=list');
                  tryTranscriptFallback(function(terr, transcriptSubs){
                    if(!terr && transcriptSubs && transcriptSubs.length > 5){
                      onSubsReady(transcriptSubs);
                    } else {
                      failAll();
                    }
                  });
                };
                xhr2.onerror = function(){
                  window.YSS._pendingXhr2 = null;
                  console.warn('[YSS] InnerTube API error, trying timedtext type=list');
                  tryTranscriptFallback(function(terr, transcriptSubs){
                    if(!terr && transcriptSubs && transcriptSubs.length > 5){
                      onSubsReady(transcriptSubs);
                    } else {
                      failAll();
                    }
                  });
                };
                var _userLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
                var _userRegion = 'EC';
                try{ _userRegion = (navigator.language || 'es-EC').split('-')[1] || 'EC'; }catch(e){}
                xhr2.send(JSON.stringify({
                  context: {
                    client: { clientName: 'WEB', clientVersion: _clientVer, hl: _userLang, gl: _userRegion },
                    user: { lockedSafetyMode: false }
                  },
                  videoId: vid,
                  contentCheckOk: true,
                  racyCheckOk: true
                }));
                return;
              }
              // Attempt 3: timedtext type=list fallback
              if(attempt < 3){
                console.warn('[YSS] Attempt 3/4: trying timedtext type=list');
                tryTranscriptFallback(function(terr, transcriptSubs){
                  if(!terr && transcriptSubs && transcriptSubs.length > 5){
                    onSubsReady(transcriptSubs);
                  } else {
                    console.warn('[YSS] Attempt 4/4: trying fmt=srv3');
                    tryWithFmtSrv3(fetchUrl, attempt);
                  }
                });
                return;
              }
              // Attempt 4: strip all fmt params and add fmt=srv3 explicitly
              if(attempt < 4){
                console.warn('[YSS] Attempt 4/4: trying with fmt=srv3');
                tryWithFmtSrv3(fetchUrl, attempt);
                return;
              }
              // All 4 attempts exhausted
              failAll();
              return;
            }
            // --- Success: parse subs from body ---
            var subs = parseSubsBody(body);
            if(subs && subs.length > 10){
              onSubsReady(subs);
            } else {
              console.warn('[YSS] Too few subs: '+(subs?subs.length:'0')+' — retrying with fmt=srv3');
              if(attempt < 4){
                tryWithFmtSrv3(fetchUrl, attempt);
                return;
              }
              failAll();
            }
          }); // end fetchSubsUrl
        } // end tryFetchSubsWithRetry

        // [FIX-1E] Shared helpers for the retry chain
        function parseSubsBody(body){
          var subs = [];
          try {
            var data = JSON.parse(body);
            if(data && data.events && data.events.length){
              for(var i=0;i<data.events.length;i++){
                var ev = data.events[i];
                if(!ev.segs || !ev.segs.length) continue;
                var text = '';
                for(var j=0;j<ev.segs.length;j++) text += ev.segs[j].utf8 || '';
                if(!text.trim()) continue;
                subs.push({time: ev.tStartMs||0, dDurationMs: ev.dDurationMs||0, text: text.trim()});
              }
            }
          } catch(e){
            var re1 = /<p\s[^>]*t="(\d+)"[^>]*d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
            var re2 = /<text\s[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
            var m;
            while((m = re1.exec(body)) !== null){
              var text = m[3].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
              if(text) subs.push({time: parseInt(m[1])||0, dDurationMs: parseInt(m[2])||2000, text: text});
            }
            while((m = re2.exec(body)) !== null){
              var text = m[3].replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
              if(text) subs.push({time: Math.round(parseFloat(m[1])*1000)||0, dDurationMs: Math.round(parseFloat(m[2])*1000)||2000, text: text});
            }
          }
          return subs;
        }

        function onSubsReady(subs){
          var processed = stripOverlap(subs);
          if(!window.YSS._userCustomSubsActive){
            window.YSS.customSubs = processed;
            window.YSS._customSubsEnabled = true;
            window.YSS._subsDownloaded = true;
            window.YSS._subsVideoId = vid;
            console.log('[YSS] Subs ready: '+processed.length+' segments');
            var video = document.querySelector('video');
            window.YSS._transitionTo('READY');
            window.YSS._transitionTo('PLAYING');
            if(video && !video.paused && video.currentTime > 1 && !window.YSS._gapReaderActive && !window.YSS._customReaderRunning){
              window.YSS.startCustomReader();
            }
          }
          window.YSS._innertubeDownloading = false;
        }

        function failAll(){
          console.warn('[YSS] Sub fetch failed after 4 attempts, giving up. Cooldown 5min');
          window.YSS._subDownloadCooldown = Date.now() + 300000;
          window.YSS._innertubeDownloading = false;
          _resumeIfPaused();
        }

        function tryWithFmtSrv3(origUrl, attempt){
          var srv3Url = origUrl;
          srv3Url = srv3Url.replace(/[?&]fmt=srv3|fmt=json3|fmt=[^&]*/g, '');
          var sep = srv3Url.indexOf('?') > -1 ? '&' : '?';
          srv3Url += sep + 'fmt=srv3';
          console.log('[YSS] fmt=srv3 URL: '+srv3Url);
          tryFetchSubsWithRetry(srv3Url, attempt + 1);
        }

        function findBestTrack(tracks){
          if(!tracks || !tracks.length) return null;
          // Same selection logic as above
          for(var i=0;i<tracks.length;i++){
            if(tracks[i].languageCode === prefLang) return tracks[i];
          }
          if(prefLang !== 'en'){
            for(var i=0;i<tracks.length;i++){
              if(tracks[i].languageCode === 'en' && tracks[i].isTranslatable) return tracks[i];
            }
          }
          for(var i=0;i<tracks.length;i++){
            if(tracks[i].isTranslatable) return tracks[i];
          }
          return tracks[0];
        }

        // Start the fetch with retry (delay 3s to avoid timedtext rate limiting)
        var _retryTimer = setTimeout(function(){ tryFetchSubsWithRetry(baseUrl); }, 3000);
        return true;
      }

      // Try page-embedded ytInitialPlayerResponse first (no network request)
      try {
        var scripts = document.querySelectorAll('script');
        for(var i=0;i<scripts.length;i++){
          var text = scripts[i].textContent || '';
          var pr = parsePlayerResponseFromHtml(text);
          if(pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks){
            console.log('[YSS] Caption tracks from ytInitialPlayerResponse');
            processCaptionTracks(pr.captions.playerCaptionsTracklistRenderer.captionTracks);
            return;
          }
        }
      } catch(e){
        console.warn('[YSS] Error parsing page data:', e.message);
      }

      // Fallback: extract INNERTUBE_API_KEY and make API call
      var apiKey = null;
      try {
        var scripts = document.querySelectorAll('script');
        for(var i=0;i<scripts.length;i++){
          var text = scripts[i].textContent || '';
          var m = text.match(/INNERTUBE_API_KEY["']:\s*["']([a-zA-Z0-9_-]+)["']/);
          if(m && m[1]){ apiKey = m[1]; break; }
        }
      } catch(e){}

      if(apiKey){
        console.log('[YSS] Making InnerTube API call');
        var xhr = new XMLHttpRequest();
        window.YSS._pendingXhr = xhr; // BUG-A4: store for cancellation on navigation
        xhr.open('POST', 'https://www.youtube.com/youtubei/v1/player?key='+encodeURIComponent(apiKey), true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function(){
          window.YSS._pendingXhr = null;
          console.log('[YSS] InnerTube fallback response status='+xhr.status+' len='+(xhr.responseText?xhr.responseText.length:0));
          try {
            var data = JSON.parse(xhr.responseText);
            // Log detailed response structure for debugging
            if(window.YSS._debugMode || true){
              var _topKeys = Object.keys(data).join(',');
              var _playability = data.playabilityStatus ? data.playabilityStatus.status + '|' + (data.playabilityStatus.reason||'') : 'N/A';
              var _captionsPreview = data.captions ? JSON.stringify(data.captions).substring(0,400) : 'undefined';
              console.log('[YSS] player keys: '+_topKeys+' | playability: '+_playability);
              console.log('[YSS] captions structure: '+_captionsPreview);
            }
            var ct = null;
            try{ ct = data.captions.playerCaptionsTracklistRenderer.captionTracks; }catch(e){}
            if(ct && ct.length){
              console.log('[YSS] Found '+ct.length+' caption tracks from InnerTube');
              processCaptionTracks(ct);
            } else {
              // No tracks from player — video has ASR-only or no subs at all
              console.log('[YSS] No captionTracks in player response, trying timedtext fallback');
              processCaptionTracks(null);
            }
            return;
          } catch(e){
            console.warn('[YSS] InnerTube parse error:', e.message);
            window.YSS._innertubeDownloading = false;
          }
          window.YSS._cleanupLoading();
        };
        xhr.onerror = function(){
          window.YSS._pendingXhr = null;
          console.warn('[YSS] InnerTube API error');
          window.YSS._innertubeDownloading = false;
          window.YSS._cleanupLoading();
        };
        var _innerFallbackVer = '2.20260603.05.00';
        try{ if(window.ytcfg && window.ytcfg.get){ var _v = window.ytcfg.get('INNERTUBE_CONTEXT_CLIENT_VERSION'); if(_v) _innerFallbackVer = _v; } }catch(e){}
        if(_innerFallbackVer === '2.20260603.05.00'){
          try{ var _ss3=document.querySelectorAll('script');for(var _i3=0;_i3<_ss3.length;_i3++){var _mc3=_ss3[_i3].textContent.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/);if(_mc3&&_mc3[1]){_innerFallbackVer=_mc3[1];break;}} }catch(e){}
        }
        var _innerFallbackLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
        var _innerFallbackRegion = 'EC';
        try{ _innerFallbackRegion = (navigator.language || 'es-EC').split('-')[1] || 'EC'; }catch(e){}
        xhr.send(JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: _innerFallbackVer, hl: _innerFallbackLang, gl: _innerFallbackRegion } },
          videoId: vid,
          contentCheckOk: true,
          racyCheckOk: true
        }));
      } else {
        console.warn('[YSS] Could not find INNERTUBE_API_KEY on page');
        window.YSS._innertubeDownloading = false;
        window.YSS._cleanupLoading();
      }
    }

    // Check if custom subs should be activated and start reader
    function checkForActivation(){
      if(window.YSS._userCustomSubsActive && window.YSS.customSubs && window.YSS.customSubs.length > 0){
        if(!window.YSS._customReaderRunning && !window.YSS._gapReaderActive){
          window.YSS.startCustomReader();
        }
      }
    }

    // Mute/unmute video when reader is active (prevent original audio + TTS overlap)
    window.YSS._readerMutedVideo = null;
    function controlVideoMute(){
      var video = document.querySelector('video');
      if(!video) return;
      var readerActive = window.YSS._customReaderRunning || window.YSS._gapReaderActive || window.YSS._subsIncompleteActive;
      var loadingState = window.YSS._state === 'LOADING' || window.YSS._state === 'FETCHING_SUBS';
      // [FIX-2] Keep muted also during speak-then-advance (video paused for TTS)
      var muteNeeded = loadingState || window.YSS._pausedForTts || window.YSS._ttsActive || readerActive;
      if(window.YSS._debugMode) console.log('[YSS MUTE] muteNeeded='+muteNeeded+' state='+window.YSS._state+' readerActive='+readerActive+' paused='+video.paused+' muted='+video.muted+' vol='+video.volume);
      if(muteNeeded){
        if(!window.YSS._readerMutedVideo){
          window.YSS._readerMutedVideo = { wasMuted: video.muted, wasVolume: video.volume };
        }
        if(!video.muted) video.muted = true;
        if(video.volume !== 0) video.volume = 0;
        window.YSS._showMuteIndicator();
        return;
      }
      if(window.YSS._readerMutedVideo){
        var was = window.YSS._readerMutedVideo;
        window.YSS._readerMutedVideo = null;
        if(video.muted && !was.wasMuted) video.muted = false;
        if(video.volume === 0 && typeof was.wasVolume === 'number') video.volume = was.wasVolume;
        window.YSS._hideMuteIndicator();
        return;
      }
      // If muted by freeze/unfreeze but TTS is not active, unmute (only after first TTS batch)
      if(video.muted && !loadingState && !window.YSS._pausedForTts && !window.YSS._ttsActive && window.YSS._firstTtsCompleted){
        video.muted = false;
      }
      if(!readerActive){
        window.YSS._hideMuteIndicator();
      }
    }

    // Pause monitor: stop speech when video pauses, mute/unmute, reset reader on resume + seek
    var _lastPauseState = false;
    setInterval(function(){
      var video = document.querySelector('video');
      if(!video) return;
      var isPaused = video.paused || video.ended;

      // Seek detection: if currentTime jumped, reset readers
      if(window.YSS._lastVideoTime > 0 && Math.abs(video.currentTime - window.YSS._lastVideoTime) > 3){
        window.YSS._lastCustomSubTime = (video.currentTime * 1000) - 2000;
        window.YSS._recentSubs = [];
        window.YSS._recentSubTimes = [];
        window.YSS._yss_spokenRegistry.clear();
        window.YSS._seekDetected = true;
        window.YSS._userPaused = false; // re-engage reader after seek
        window.YSS._pausedForTts = false; // clear TTS pause state
        if(window.YSS._customReaderRunning) window.speechSynthesis.cancel();
      }
      window.YSS._lastVideoTime = video.currentTime;

      if(isPaused && !_lastPauseState){
        // [FIX-2] Don't cancel speech if we paused video intentionally for speak-then-advance
        if(!window.YSS._pausedForTts){
          _lastPauseState = true;
          window.YSS._wasPaused = true;
          window.YSS._userPaused = true;
          window.speechSynthesis.cancel();
          try{ window.speechSynthesis.pause(); window.speechSynthesis.resume(); }catch(e){}
          if(window.YSS._customReaderRunning){
            window.YSS._lastCustomSubTime = (video.currentTime * 1000) - 2000;
          }
          if(window.YSS._debugTTS) console.log('[YSS] Paused');
        }
        controlVideoMute();
      }

      if(!isPaused && _lastPauseState){
        _lastPauseState = false;
        window.YSS._wasPaused = false;
        window.YSS._userPaused = false;
        if(window.YSS._customReaderRunning){
          window.YSS._lastCustomSubTime = (video.currentTime * 1000) - 2000;
          controlVideoMute();
          if(window.YSS._debugTTS) console.log('[YSS] Resumed');
        } else if(window.YSS._subsIncompleteActive && window.YSS.customSubs && window.YSS.customSubs.length > 10){
          window.YSS.startCustomReader();
        }
      }

      // Continuous mute enforcement while reader is active (also during speak-then-advance pause)
      if((window.YSS._customReaderRunning || window.YSS._gapReaderActive || window.YSS._pausedForTts) && !isPaused){
        controlVideoMute();
      }
      // Also enforce mute when paused for TTS (isPaused=true but still need mute)
      if(window.YSS._pausedForTts && isPaused){
        controlVideoMute();
      }
    }, 500);

    // --- Global panel positioning (works even if createControlButton guard blocks) ---
    (function(){
      var posPanel = function(force){
        var pnl = document.querySelector('.yss-menu-panel');
        var gear = document.querySelector('.ytp-settings-button') || document.querySelector('.yss-control-button');
        var ply = document.querySelector('#movie_player');
        if(pnl && gear && ply){
          if(!force && pnl.getAttribute('yss-panel-active') === 'false') return;
          var gr = gear.getBoundingClientRect();
          var pr = ply.getBoundingClientRect();
          var pw = pnl.offsetWidth || pnl.getBoundingClientRect().width || 300;
          if(pw < 50){ setTimeout(function(){ posPanel(true); }, 50); return; }
          var rl = gr.right - pr.left - pw - 4;
          rl = Math.max(8, Math.min(rl, pr.width - pw - 8));
          pnl.style.left = rl + 'px';
          pnl.style.right = 'auto';
          pnl.style.bottom = (pr.bottom - gr.top + 4) + 'px';
        }
      };
      var posObs = new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var m = muts[i];
          if(m.type==='attributes' && m.attributeName==='yss-panel-active'){
            if(m.target.getAttribute('yss-panel-active') !== 'false') setTimeout(function(){ posPanel(true); }, 30);
          }
        }
      });
      posObs.observe(document.documentElement || document.body, { attributes: true, subtree: true, attributeFilter: ['yss-panel-active'] });
      setInterval(function(){ posPanel(true); }, 5000);
    })();

    // --- Create control button with menu panel ---
    function createControlButton(){
      var controls = document.querySelector('.ytp-right-controls') || document.querySelector('.ytp-chrome-controls') || document.querySelector('.ytp-left-controls');
      if(!controls){
        if(!window.YSS._buttonCreateObserved){
          window.YSS._buttonCreateObserved = true;
          console.log('[YSS BTN] No controls found, setting up observer');
          var _bcTarget = document.querySelector('#movie_player') || document.querySelector('.html5-video-player') || document.body;
          var _bcObs = new MutationObserver(function(){
            var _c = document.querySelector('.ytp-right-controls') || document.querySelector('.ytp-chrome-controls') || document.querySelector('.ytp-left-controls');
            if(_c){ console.log('[YSS BTN] Controls appeared'); _bcObs.disconnect(); createControlButton(); }
          });
          if(_bcTarget){
            console.log('[YSS BTN] Observing:', _bcTarget.tagName + (_bcTarget.id ? '#'+_bcTarget.id : '') + (_bcTarget.className ? '.'+_bcTarget.className.substring(0,30) : ''));
            _bcObs.observe(_bcTarget, { childList: true, subtree: true });
          } else {
            console.log('[YSS BTN] No target for observer');
          }
        }
        return;
      }
      console.log('[YSS BTN] Controls found:', controls.tagName + (controls.className ? '.'+controls.className.substring(0,40) : ''));
      if(controls.querySelector('.yss-control-button')){ window.YSS._buttonCreated = true; positionPanel(); return; }
      // Allow button creation even before subs loaded
      if(!document.querySelector('#yss-button-style')){
        var s = document.createElement('style');
        s.id = 'yss-button-style';
        s.textContent = '.yss-control-button { display:flex;align-items:center;justify-content:center;width:36px;height:36px;transition:all .2s;border-radius:50%;position:relative } .yss-control-button:hover { background:rgba(255,255,255,0.15) } .yss-control-button .ytp-svg-fill { fill:#fff;transition:fill .2s } .yss-control-button:hover .ytp-svg-fill { fill:#4fc3f7 } .yss-reader-panel { position:absolute;z-index:9999;background:linear-gradient(180deg,#1e1e2e 0%,#181825 100%);border:1px solid rgba(79,195,247,0.2);border-radius:12px;padding:16px;min-width:290px;max-width:330px;height:auto;max-height:320px;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;font-size:13px;color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(79,195,247,0.1);backdrop-filter:blur(8px) } .yss-reader-panel[yss-panel-active=false] { display:none } .yss-reader-panel .yssp-header { display:flex;align-items:center;justify-content:space-between;padding:0 0 12px 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:12px } .yss-reader-panel .yssp-title { font-size:14px;font-weight:700;color:#4fc3f7;letter-spacing:.3px } .yss-reader-panel .yssp-close { background:rgba(255,255,255,0.06);border:none;color:#888;font-size:16px;cursor:pointer;width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all .2s;line-height:1 } .yss-reader-panel .yssp-close:hover { background:rgba(255,255,255,0.12);color:#fff } .yss-reader-panel .yssp-row { display:flex;align-items:center;justify-content:space-between;padding:6px 0 } .yss-reader-panel .yssp-label { color:#999;font-size:12px;font-weight:500;min-width:65px } .yss-reader-panel .yssp-toggle { background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#ccc;padding:4px 16px;cursor:pointer;font-size:12px;font-weight:600;transition:all .2s;text-transform:uppercase;letter-spacing:.5px } .yss-reader-panel .yssp-toggle:hover { background:rgba(255,255,255,0.12) } .yss-reader-panel .yssp-toggle.on { background:linear-gradient(135deg,#4fc3f7,#2196f3);border-color:#4fc3f7;color:#fff;box-shadow:0 2px 8px rgba(79,195,247,0.3) } .yss-reader-panel .yssp-info { color:#666;font-size:11px;padding:2px 0;line-height:1.4 } .yss-reader-panel .yssp-info:last-of-type { padding-bottom:4px } .yss-reader-panel input[type=range] { -webkit-appearance:none;appearance:none;background:rgba(255,255,255,0.1);height:3px;border-radius:2px;outline:none;width:85px;transition:background .2s } .yss-reader-panel input[type=range]:hover { background:rgba(255,255,255,0.15) } .yss-reader-panel input[type=range]::-webkit-slider-thumb { -webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#4fc3f7,#2196f3);cursor:pointer;border:2px solid #1e1e2e;box-shadow:0 1px 4px rgba(0,0,0,0.3) } .yss-reader-panel .yssp-rval { color:#4fc3f7;font-size:11px;font-weight:600;min-width:34px;text-align:right } .yss-reader-panel select, .yss-reader-panel input[type=password], .yss-reader-panel input[type=number] { background:rgba(255,255,255,0.06);color:#e0e0e0;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;max-width:175px;width:100%;transition:border-color .2s } .yss-reader-panel select:hover, .yss-reader-panel input:hover { border-color:rgba(255,255,255,0.2) } .yss-reader-panel select:focus, .yss-reader-panel input:focus { outline:0;border-color:#4fc3f7;background:rgba(79,195,247,0.06) } .yss-reader-panel .yssp-divider { border:0;border-top:1px solid rgba(255,255,255,0.06);margin:10px 0 8px 0 }';
        document.head.appendChild(s);
      }
      var btn = document.createElement('button');
      btn.className = 'ytp-button yss-control-button';
      btn.title = 'YSS Reader';
      btn.setAttribute('aria-label', 'YSS Reader');
      var useTrusted = typeof YSStrustedHTML === 'function';
      function setControlButtonIcon(enabled){
        window.YSS.setControlButtonIcon(enabled);
      }
      setControlButtonIcon(!!window.YSS._customSubsEnabled);
      controls.insertBefore(btn, controls.firstChild);
      window.YSS._buttonCreated = true;

      var langCodes = [
        {code:'es',label:'Espanol'},{code:'en',label:'English'},{code:'pt',label:'Portugues'},
        {code:'fr',label:'Francais'},{code:'de',label:'Deutsch'},{code:'it',label:'Italiano'},
        {code:'ja',label:'日本語'},{code:'ko',label:'한국어'},{code:'zh',label:'中文'},
        {code:'ru',label:'Русский'},{code:'ar',label:'العربية'},{code:'hi',label:'हिन्दी'}
      ];

      function getVoicesForLang(langCode){
        var voices = window.speechSynthesis.getVoices();
        var result = [];
        for(var i=0;i<voices.length;i++){
          if(voices[i].lang && voices[i].lang.indexOf(langCode) === 0) result.push(voices[i]);
        }
        return result;
      }

      var panel = document.createElement('div');
      panel.className = 'yss-reader-panel yss-menu-panel';
      panel.setAttribute('yss-panel-active', 'false');

      function updatePanel(){
        var on = window.YSS._customSubsEnabled;
        var provider = window.YSS._ttsProvider || 'browser';
        var elevenKey = window.YSS._elevenLabsApiKey || '';
        var curLang = (window.YSS._cachedVoiceLang || 'es-ES').split('-')[0];
        var curVoiceName = window.YSS._savedVoiceName || (window.YSS._cachedVoice ? window.YSS._cachedVoice.name : '');
        var voices = getVoicesForLang(curLang);

        var langOpts = '';
        for(var i=0;i<langCodes.length;i++){
          langOpts += '<option value="'+langCodes[i].code+'"'+(langCodes[i].code===curLang?' selected':'')+'>'+langCodes[i].label+'</option>';
        }
        var voiceOpts = '<option value="">default</option>';
        for(var i=0;i<voices.length;i++){
          var sel = voices[i].name === curVoiceName ? ' selected' : '';
          voiceOpts += '<option value="'+voices[i].name+'"'+sel+'>'+voices[i].name+' ('+voices[i].lang+')</option>';
        }
        var voiceInfo = provider==='elevenlabs' ? (elevenKey ? 'ElevenLabs AI' : 'No API key') : (curVoiceName || 'default');
        var rate = window.YSS._cachedRate !== undefined ? window.YSS._cachedRate : 1;
        var pitch = window.YSS._cachedPitch !== undefined ? window.YSS._cachedPitch : 1;
        var vol = window.YSS._cachedVolume !== undefined ? window.YSS._cachedVolume : 1;
        var syncOff = window.YSS.syncOffsetMs !== undefined ? window.YSS.syncOffsetMs : 0;

        var html = '<div class="yssp-header"><span class="yssp-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>Reader</span><button class="yssp-close" data-action="close">&times;</button></div>'+
          '<div class="yssp-row"><span class="yssp-label">Reader</span><button class="yssp-toggle'+(on?' on':'')+'" data-action="toggle">'+(on?'ON':'OFF')+'</button></div>'+
          '<div class="yssp-row"><span class="yssp-label">Engine</span><select data-action="provider"><option value="browser"'+(provider==='browser'?' selected':'')+'>Browser TTS</option><option value="elevenlabs"'+(provider==='elevenlabs'?' selected':'')+'>ElevenLabs</option></select></div>'+
          '<div class="yssp-row"><span class="yssp-label">Language</span><select data-action="language">'+langOpts+'</select></div>'+
          '<div class="yssp-row"><span class="yssp-label">Voice</span><select data-action="voice">'+voiceOpts+'</select></div>'+
          (provider==='elevenlabs'?'<div class="yssp-row"><span class="yssp-label">API Key</span><input type="password" data-action="apikey" value="'+elevenKey+'" placeholder="sk_..."></div>':'')+
          '<hr class="yssp-divider">'+
          '<div class="yssp-row"><span class="yssp-label">Rate</span><input type="range" data-action="rate" min="0.5" max="2" step="0.1" value="'+rate+'"><span class="yssp-rval">'+rate.toFixed(1)+'x</span></div>'+
          '<div class="yssp-row"><span class="yssp-label">Pitch</span><input type="range" data-action="pitch" min="0.5" max="2" step="0.1" value="'+pitch+'"><span class="yssp-rval">'+pitch.toFixed(1)+'x</span></div>'+
          '<div class="yssp-row"><span class="yssp-label">Volume</span><input type="range" data-action="volume" min="0" max="1" step="0.1" value="'+vol+'"><span class="yssp-rval">'+(vol*100).toFixed(0)+'%</span></div>'+
          '<div class="yssp-row"><span class="yssp-label">Sync</span><button data-action="syncoffset" data-value="-500" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#ccc;cursor:pointer;padding:2px 8px;font-size:11px">&minus;500</button><input type="range" data-action="syncoffset" min="-3000" max="3000" step="100" value="'+syncOff+'" style="width:70px"><button data-action="syncoffset" data-value="500" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#ccc;cursor:pointer;padding:2px 8px;font-size:11px">+500</button><span class="yssp-rval" data-syncval="1">'+syncOff+'ms</span></div>'+
          '<hr class="yssp-divider">'+
          '<div class="yssp-info">Voice: '+voiceInfo+'</div>'+
          '<div class="yssp-info">Subs: '+(window.YSS.customSubs?window.YSS.customSubs.length:0)+'</div>'+
          '<div class="yssp-row" style="gap:8px;margin-top:4px">'+
          '<button data-action="speedup-voice" style="flex:1;background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.3);border-radius:6px;color:#81c784;padding:5px 8px;cursor:pointer;font-size:11px;font-weight:600;transition:all .2s;letter-spacing:.3px">'+(window.YSS._speakingControl==='voice'?'✓ ':'')+'Acelerar voz</button>'+
          '<button data-action="slowdown-video" style="flex:1;background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.3);border-radius:6px;color:#ffb74d;padding:5px 8px;cursor:pointer;font-size:11px;font-weight:600;transition:all .2s;letter-spacing:.3px">'+(window.YSS._speakingControl==='video'?'✓ ':'')+'Ralentizar video</button>'+
          '</div>'+
          '<div class="yssp-info" style="font-size:11px;color:#888;margin-top:2px">Cuando la voz se atrasa: <b>'+(window.YSS._speakingControl==='voice'?'Acelera la voz':'Ralentiza el video')+'</b></div>';

        if(useTrusted){ panel.innerHTML = YSStrustedHTML(html); } else { panel.innerHTML = html; }
      }
      function _yss_onvoiceschanged(){
        updatePanel();
        setTimeout(positionPanel, 10);
      }
      updatePanel();
      window.speechSynthesis.removeEventListener('voiceschanged', _yss_onvoiceschanged);
      window.speechSynthesis.addEventListener('voiceschanged', _yss_onvoiceschanged);

      panel.addEventListener('click', function(e){
        var closeBtn = e.target.closest('[data-action="close"]');
        if(closeBtn){
          var pnl = document.querySelector('.yss-menu-panel');
          var bt = document.querySelector('.yss-control-button');
          if(pnl) pnl.__yss_click_open = false;
          if(bt) bt.__yss_click_open = false;
          if(pnl) pnl.setAttribute('yss-panel-active', 'false');
          return;
        }
        var toggle = e.target.closest('[data-action="toggle"]');
        if(toggle){
          window.YSS._customSubsEnabled = !window.YSS._customSubsEnabled;
          window.YSS._extensionEnabled = window.YSS._customSubsEnabled;
          window.YSS._userCustomSubsActive = window.YSS._customSubsEnabled;
          setControlButtonIcon(window.YSS._customSubsEnabled);
          safeStorageSyncSet({enable: window.YSS._customSubsEnabled});
          try { chrome.storage.sync.get('options', function(d){ var _opts = (d && d.options) ? Object.assign({}, d.options) : {}; _opts.enable = window.YSS._customSubsEnabled; safeStorageSyncSet({options: _opts}); }); }catch(e){}
          if(window.YSS._customSubsEnabled){
            if(window.YSS.customSubs && window.YSS.customSubs.length > 10){
              if(!window.YSS._customReaderRunning && !window.YSS._gapReaderActive){
                window.YSS.startCustomReader();
              }
            }
          } else {
            if(window.YSS.stopCustomReader) window.YSS.stopCustomReader();
            else {
              window.YSS._customReaderRunning = false;
              window.YSS._gapReaderActive = false;
              window.YSS._subsIncompleteActive = false;
              window.YSS._spokenSubTimes = {};
              controlVideoMute();
            }
            window.speechSynthesis.cancel();
            if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
            window.YSS._ttsActive = false;
            window.YSS._cachedDynamicRate = null;
          }
          updatePanel();
          if(window.YSS._customSubsEnabled) setTimeout(positionPanel, 10);
        }
        var speedBtn = e.target.closest('[data-action="speedup-voice"]');
        if(speedBtn){
          window.YSS._speakingControl = 'voice';
          safeStorageSyncSet({speaking_control: 'voice'});
          safeStorageSyncSet({options: {speaking_control: 'voice'}});
          var video = document.querySelector('video');
          if(video) video.playbackRate = 1;
          if(window.speechSynthesis.speaking) window.speechSynthesis.cancel();
          if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
          window.YSS._ttsActive = false;
          window.YSS._cachedDynamicRate = null;
          if(window.YSS._gapReaderActive) gapReaderLoop();
          updatePanel();
          setTimeout(positionPanel, 10);
        }
        var slowBtn = e.target.closest('[data-action="slowdown-video"]');
        if(slowBtn){
          window.YSS._speakingControl = 'video';
          safeStorageSyncSet({speaking_control: 'video'});
          safeStorageSyncSet({options: {speaking_control: 'video'}});
          var video = document.querySelector('video');
          if(video && video.currentTime && window.YSS._lastCustomSubTime > 0){
            var lagMs = (video.currentTime * 1000) - window.YSS._lastCustomSubTime;
            if(lagMs > 300) video.playbackRate = Math.max(0.25, 1 - (lagMs / 10000));
          }
          if(window.speechSynthesis.speaking) window.speechSynthesis.cancel();
          if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
          window.YSS._ttsActive = false;
          if(window.YSS._gapReaderActive) gapReaderLoop();
          updatePanel();
          setTimeout(positionPanel, 10);
        }
        e.stopPropagation();
      });

      panel.addEventListener('change', function(e){
        var providerSel = e.target.closest('[data-action="provider"]');
        if(providerSel){
          window.YSS._ttsProvider = providerSel.value;
          safeStorageSyncSet({tts_provider: providerSel.value});
          updatePanel();
          setTimeout(positionPanel, 10);
        }
        var langSel = e.target.closest('[data-action="language"]');
        if(langSel){
          var newLang = langSel.value;
          window.YSS._cachedVoiceLang = newLang + '-' + (newLang === 'pt' ? 'BR' : (newLang === 'zh' ? 'CN' : newLang.toUpperCase()));
          window.YSS._savedVoiceName = '';
          window.YSS._cachedVoice = null;
          safeStorageSyncSet({tts_lang: window.YSS._cachedVoiceLang});
          safeStorageSyncSet({yss_voice_name: ''});
          try{ localStorage.removeItem('yss_voice_name'); }catch(e){}
          var freshVoices = getVoicesForLang(newLang);
          if(freshVoices.length > 0){
            window.YSS._cachedVoice = freshVoices[0];
            window.YSS._savedVoiceName = freshVoices[0].name;
            safeStorageSyncSet({yss_voice_name: freshVoices[0].name});
            try{ localStorage.setItem('yss_voice_name', freshVoices[0].name); }catch(e){}
          }
          // Re-download subtitles for new language and restart reader
          console.log('[YSS LANG] switching language to '+newLang+' state='+window.YSS._state+' customReader='+window.YSS._customReaderRunning+' gapReader='+window.YSS._gapReaderActive+' subsIncomplete='+window.YSS._subsIncompleteActive);
          if(window.YSS._state !== 'LOADING' && window.YSS._state !== 'FETCHING_SUBS'){
            window.YSS._transitionTo('LOADING');
          }
          window.speechSynthesis.cancel();
          if(window.YSS._queuePlayer) window.YSS._queuePlayer.clear();
          window.YSS._customReaderRunning = false;
          window.YSS._gapReaderActive = false;
          window.YSS._subsIncompleteActive = false;
          window.YSS._subsIncompleteChecked = false;
          window.YSS._subDownloadCooldown = 0;
          window.YSS._innertubeDownloading = false;
          updatePanel();
          setTimeout(positionPanel, 10);
          var langChangeTime = Date.now();
          if(window.YSS.customSubs && window.YSS.customSubs.length > 10){
            var video = document.querySelector('video');
            if(video && !video.paused && video.currentTime > 1){
    window.YSS._lastCustomSubTime = 0;
              window.YSS._recentSubs = [];
              window.YSS._recentSubTimes = [];
            }
          }
          setTimeout(function(){
            autoDownloadSubs();
          }, 200);
          // Fallback: restart reader with existing subs if re-download times out
          setTimeout(function(){
            var video = document.querySelector('video');
            if(window.YSS.customSubs && window.YSS.customSubs.length > 10 && video && !video.paused && video.currentTime > 1 && !window.YSS._customReaderRunning && !window.YSS._gapReaderActive){
              window.YSS.startCustomReader();
            }
          }, 5000);
        }
        var voiceSel = e.target.closest('[data-action="voice"]');
        if(voiceSel){
          var vName = voiceSel.value;
          window.YSS._savedVoiceName = vName;
          window.YSS._cachedVoice = null;
          if(vName){
            var voices = window.speechSynthesis.getVoices();
            for(var i=0;i<voices.length;i++){ if(voices[i].name === vName){ window.YSS._cachedVoice = voices[i]; window.YSS._cachedVoiceLang = voices[i].lang || window.YSS._cachedVoiceLang; break; } }
          }
          safeStorageSyncSet({yss_voice_name: vName});
          try{ localStorage.setItem('yss_voice_name', vName); }catch(e){}
          updatePanel();
          setTimeout(positionPanel, 10);
        }
        var rateSel = e.target.closest('[data-action="rate"]');
        if(rateSel){
          window.YSS._cachedRate = parseFloat(rateSel.value) || 1;
          safeStorageSyncSet({rate: window.YSS._cachedRate});
          safeStorageSyncSet({options: {rate: window.YSS._cachedRate}});
        }
        var pitchSel = e.target.closest('[data-action="pitch"]');
        if(pitchSel){
          window.YSS._cachedPitch = parseFloat(pitchSel.value) || 1;
          safeStorageSyncSet({pitch: window.YSS._cachedPitch});
          safeStorageSyncSet({options: {pitch: window.YSS._cachedPitch}});
        }
        var volSel = e.target.closest('[data-action="volume"]');
        if(volSel){
          window.YSS._cachedVolume = parseFloat(volSel.value) || 1;
          safeStorageSyncSet({volume: window.YSS._cachedVolume});
          safeStorageSyncSet({options: {volume: window.YSS._cachedVolume}});
        }
        var syncSel = e.target.closest('[data-action="syncoffset"]');
        if(syncSel){
          var newVal = syncSel.hasAttribute('data-value') ? parseInt(syncSel.getAttribute('data-value')) : (parseInt(syncSel.value) || 0);
          if(syncSel.hasAttribute('data-value')){
            var rng = syncSel.parentElement.querySelector('input[type="range"]');
            if(rng) newVal = Math.max(-3000, Math.min(3000, (parseInt(rng.value)||0) + newVal));
          }
          window.YSS.syncOffsetMs = newVal;
          var rng = syncSel.parentElement.querySelector('input[type="range"]');
          if(rng) rng.value = newVal;
          var valSpan = syncSel.parentElement.querySelector('[data-syncval]');
          if(valSpan) valSpan.textContent = newVal+'ms';
          safeStorageSyncSet({sync_offset_ms: window.YSS.syncOffsetMs});
        }
      });

      function _applyTtsSettings(){
        if(window.YSS._ttsActive || window.speechSynthesis.speaking){
          window.speechSynthesis.cancel();
        }
        if(window.YSS._customReaderRunning || window.YSS._gapReaderActive){
          // The next gapReaderLoop iteration will create new utterances with updated values
        }
      }

      panel.addEventListener('input', function(e){
        var rateRng = e.target.closest('[data-action="rate"]');
        if(rateRng){
          var val = parseFloat(rateRng.value) || 1;
          var next = rateRng.parentElement.querySelector('.yssp-rval');
          if(next) next.textContent = val.toFixed(1)+'x';
          window.YSS._cachedRate = val;
          _applyTtsSettings();
        }
        var pitchRng = e.target.closest('[data-action="pitch"]');
        if(pitchRng){
          var val = parseFloat(pitchRng.value) || 1;
          var next = pitchRng.parentElement.querySelector('.yssp-rval');
          if(next) next.textContent = val.toFixed(1)+'x';
          window.YSS._cachedPitch = val;
          _applyTtsSettings();
        }
        var volRng = e.target.closest('[data-action="volume"]');
        if(volRng){
          var val = parseFloat(volRng.value) || 1;
          var next = volRng.parentElement.querySelector('.yssp-rval');
          if(next) next.textContent = (val*100).toFixed(0)+'%';
          window.YSS._cachedVolume = val;
          _applyTtsSettings();
        }
        var syncRng = e.target.closest('input[data-action="syncoffset"]');
        if(syncRng){
          var newVal = parseInt(syncRng.value) || 0;
          var valSpan = syncRng.parentElement.querySelector('[data-syncval]');
          if(valSpan) valSpan.textContent = newVal+'ms';
          window.YSS.syncOffsetMs = newVal;
        }
      });

      panel.addEventListener('keyup', function(e){
        var keyInput = e.target.closest('[data-action="apikey"]');
        if(keyInput && (e.key === 'Enter' || e.keyCode === 13)){
          window.YSS._elevenLabsApiKey = keyInput.value;
          safeStorageSyncSet({eleven_api_key: keyInput.value});
          updatePanel();
          setTimeout(positionPanel, 10);
        }
      });

      panel.addEventListener('mousedown', function(e){ e.stopPropagation(); });

      function positionPanel(){
        var gear = document.querySelector('.ytp-settings-button') || document.querySelector('.yss-control-button');
        var pnl = document.querySelector('.yss-reader-panel');
        var ply = document.querySelector('#movie_player') || document.querySelector('.html5-video-player') || document.querySelector('video');
        if(gear && pnl && ply){
          var gr = gear.getBoundingClientRect();
          var pr = ply.getBoundingClientRect();
          if(pr.width === 0 && pr.height === 0 && ply.tagName === 'VIDEO'){
            // Video element without dimensions - fallback to viewport
            pr = {left:0, top:0, width:window.innerWidth, height:window.innerHeight, bottom:window.innerHeight, right:window.innerWidth};
          }
          var pw = pnl.offsetWidth || 300;
          var rl = gr.right - pr.left - pw - 4;
          rl = Math.max(8, Math.min(rl, pr.width - pw - 8));
          pnl.style.left = rl + 'px';
          pnl.style.right = 'auto';
          pnl.style.bottom = (pr.bottom - gr.top + 4) + 'px';
        }
      }
      var player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      if(player) player.appendChild(panel);
      positionPanel();
      var panelVisObs = new MutationObserver(function(){
        if(panel.getAttribute('yss-panel-active') !== 'false') setTimeout(positionPanel, 10);
      });
      panelVisObs.observe(panel, { attributes: true, attributeFilter: ['yss-panel-active'] });
    }

    // Try to create button immediately and also periodically
    createControlButton();
    var _btnInterval = setInterval(function(){
      if(window.YSS._buttonCreated){ clearInterval(_btnInterval); return; }
      createControlButton();
    }, 3000);

    // Respond to popup state queries
    try {
      chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
        if(msg.action === 'YSS_GET_STATE'){
          sendResponse({
            ok: true,
            state: window.YSS._state,
            customReaderRunning: !!window.YSS._customReaderRunning,
            gapReaderActive: !!window.YSS._gapReaderActive,
            ttsActive: !!window.YSS._ttsActive,
            extensionEnabled: window.YSS._extensionEnabled !== false,
            customSubsEnabled: !!window.YSS._customSubsEnabled,
            ttsProvider: window.YSS._ttsProvider || 'browser',
            ollamaEnabled: !!window.YSS._ollamaEnabled,
            freezeApplied: !!window.YSS._freezeApplied
          });
        }
      });
    }catch(e){}

    window.YSS._initComplete = true;
    console.log('[YSS] subtitle_fixer.js loaded.');

  }catch(e){ console.error('[YSS] Error:', e); }
})();
