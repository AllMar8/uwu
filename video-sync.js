(function(){
  try {
    if(window.YSS && window.YSS._dubbingInited) return;
    var _origPlay = HTMLVideoElement.prototype.play;
    if(typeof window.__YSS_BLOCK_PLAY === 'undefined'){
      window.__YSS_BLOCK_PLAY = true;
      window.__YSS_ALLOW_PLAY = false;
      HTMLVideoElement.prototype.play = function() {
        if(window.__YSS_BLOCK_PLAY && !window.__YSS_ALLOW_PLAY) {
          this.muted = true;
          this.volume = 0;
        }
        return _origPlay.apply(this, arguments);
      };
      window.__YSS_allowPlay = function(){
        window.__YSS_ALLOW_PLAY = true;
        var v = document.querySelector('video');
        if(v && v.paused && !v.ended) _origPlay.call(v).catch(function(){});
      };
      window.__YSS_blockPlay = function(){
        window.__YSS_ALLOW_PLAY = false;
        var v = document.querySelector('video');
        if(v){
          if(!v.paused) v.pause();
          v.muted = true; v.volume = 0;
        }
      };
      // [YSS-FIX-BUG-A3] Timer 25s removido — ya existe en video-block.js para evitar duplicado
    }
  } catch(e){}

  if (location.hostname.indexOf('youtube.com') !== -1) return;

  var state = {
    initialized: false,
    video: null,
    readyToPlay: false,
    subtitlesReady: false,
    translationInProgress: false,
    sourceLang: '',
    targetLang: 'es',
    autoTranslate: true,
    translationEndpoint: '',
    translationProvider: 'libre',
    overlay: null,
    observer: null,
    customTrack: null,
    cancelPlayInterceptor: false
  };

  function log() {
    if (window.console && window.console.log) {
      window.console.log.apply(window.console, ['[BraveVideoSync]'].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function normalizeLang(lang) {
    if (!lang || typeof lang !== 'string') return 'und';
    lang = lang.trim().toLowerCase();
    if (!lang) return 'und';
    if (lang.indexOf('-') !== -1) lang = lang.split('-')[0];
    if (lang.indexOf('_') !== -1) lang = lang.split('_')[0];
    if (lang.indexOf('spanish') !== -1 || lang.indexOf('español') !== -1 || lang === 'es') return 'es';
    if (lang.indexOf('english') !== -1 || lang === 'en') return 'en';
    if (lang.indexOf('portuguese') !== -1 || lang === 'pt') return 'pt';
    if (lang.indexOf('french') !== -1 || lang === 'fr') return 'fr';
    if (lang.indexOf('german') !== -1 || lang === 'de') return 'de';
    if (lang.indexOf('italian') !== -1 || lang === 'it') return 'it';
    if (lang.indexOf('japanese') !== -1 || lang === 'ja') return 'ja';
    if (lang.indexOf('korean') !== -1 || lang === 'ko') return 'ko';
    if (lang.indexOf('chinese') !== -1 || lang.indexOf('mandarin') !== -1 || lang === 'zh') return 'zh';
    if (lang.indexOf('russian') !== -1 || lang === 'ru') return 'ru';
    return lang;
  }

  function createOverlay() {
    if (state.overlay) return;
    var overlay = document.createElement('div');
    overlay.id = 'brave-video-sync-overlay';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '2147483647';
    overlay.style.top = '12px';
    overlay.style.right = '12px';
    overlay.style.maxWidth = '280px';
    overlay.style.padding = '10px 14px';
    overlay.style.borderRadius = '12px';
    overlay.style.background = 'rgba(0,0,0,0.72)';
    overlay.style.color = '#fff';
    overlay.style.fontFamily = 'Arial, Helvetica, sans-serif';
    overlay.style.fontSize = '13px';
    overlay.style.lineHeight = '1.4';
    overlay.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    overlay.style.pointerEvents = 'none';
    overlay.innerHTML = '<strong style="display:block;margin-bottom:6px">Video sync</strong><div id="brave-video-sync-text">Waiting for video...</div>';
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
  }

  function updateOverlay(title, detail) {
    createOverlay();
    var textEl = document.getElementById('brave-video-sync-text');
    if (!textEl) return;
    textEl.innerHTML = '<span style="font-weight:600">' + title + '</span>' + (detail ? '<div style="margin-top:4px;color:#b8dfff;font-size:12px">' + detail + '</div>' : '');
  }

  function loadSettings() {
    chrome.storage.sync.get(['translate_lang', 'options', 'translation_endpoint', 'translation_provider'], function(data) {
      if (data && data.translate_lang) {
        state.targetLang = data.translate_lang;
      } else if (data && data.options && data.options.translate_lang) {
        state.targetLang = data.options.translate_lang;
      }
      if (data && typeof data.translate_enabled !== 'undefined') {
        state.autoTranslate = !!data.translate_enabled;
      }
      if (data && data.translation_endpoint) {
        state.translationEndpoint = data.translation_endpoint;
      }
      if (data && data.translation_provider) {
        state.translationProvider = data.translation_provider;
      }
      if (!state.targetLang) state.targetLang = 'es';
      log('Loaded settings', state.targetLang, state.autoTranslate, state.translationEndpoint, state.translationProvider);
    });
  }

  function onPlayIntercept(event) {
    if (state.readyToPlay || state.cancelPlayInterceptor) return;
    var video = event.target;
    if (video !== state.video) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    video.pause();
    updateOverlay('Waiting for subtitles...', 'Playback is blocked until captions are ready');
  }

  function attachVideo(video) {
    if (!video || state.video === video || video.dataset.braveVideoSyncAttached) return;
    state.video = video;
    video.dataset.braveVideoSyncAttached = 'true';
    log('Attached to video');

    loadSettings();
    createOverlay();
    video.muted = true;
    video.volume = 0;
    video.pause();

    if (video.readyState > 0) {
      safeSeekZero(video);
    }
    video.addEventListener('loadedmetadata', function() {
      safeSeekZero(video);
      if (!state.readyToPlay) video.pause();
    });
    video.addEventListener('play', onPlayIntercept, true);
    video.addEventListener('canplay', function() {
      if (!state.readyToPlay) {
        video.pause();
      }
    });
    video.addEventListener('emptied', resetState);
    video.addEventListener('ended', resetState);

    updateOverlay('Detected video', 'Waiting for subtitles or captions');
    waitForSubtitles(video);
  }

  function safeSeekZero(video) {
    try {
      if (video.currentTime > 0.05) {
        video.currentTime = 0;
      }
    } catch (e) {
      log('safeSeekZero failed', e);
    }
  }

  function resetState() {
    if (state.customTrack) {
      try { state.customTrack.mode = 'disabled'; } catch (e) {}
      state.customTrack = null;
    }
    state.video = null;
    state.readyToPlay = false;
    state.subtitlesReady = false;
    state.translationInProgress = false;
    state.sourceLang = '';
    state.cancelPlayInterceptor = false;
    updateOverlay('Waiting for video...', 'Awaiting a playable HTML5 element');
  }

  function waitForSubtitles(video) {
    var check = function() {
      if (!state.video || state.video.ended) return;
      var tracks = Array.prototype.slice.call(video.textTracks || []);
      if (tracks.length) {
        handleTextTracks(video, tracks);
        return;
      }
      setTimeout(check, 500);
    };
    updateOverlay('Detecting subtitles...', 'Waiting for native caption tracks');
    check();
  }

  function handleTextTracks(video, tracks) {
    var captions = tracks.filter(function(track) {
      return track.kind === 'subtitles' || track.kind === 'captions';
    });
    if (!captions.length) {
      updateOverlay('No subtitles found', 'Enable captions or add a <track> element');
      return;
    }

    var primary = captions[0];
    for (var i = 0; i < captions.length; i++) {
      captions[i].mode = 'hidden';
    }
    primary.mode = 'hidden';
    primary.addEventListener('cuechange', function() {
      if (!state.subtitlesReady && primary.cues && primary.cues.length) {
        maybeTranslateTrack(primary);
      }
    });

    if (primary.cues && primary.cues.length) {
      maybeTranslateTrack(primary);
    } else {
      updateOverlay('Loading subtitles...', 'Waiting for cues to become available');
    }
  }

  function maybeTranslateTrack(track) {
    var lang = normalizeLang(track.language || track.label || 'und');
    if (!lang || lang === 'und') {
      updateOverlay('Subtitles ready', 'Language not identified');
      activateVideo();
      return;
    }

    state.sourceLang = lang;
    var target = normalizeLang(state.targetLang);
    var translating = state.autoTranslate && target && lang !== target;
    var isSpanish = lang === 'es';

    if (isSpanish) {
      updateOverlay('Subtitles ready', 'Spanish subtitles detected');
      activateVideo(track);
      return;
    }

    if (!translating) {
      updateOverlay('Subtitles ready', 'Language: ' + lang);
      activateVideo(track);
      return;
    }

    if (!track.cues || !track.cues.length) {
      updateOverlay('Subtitles ready', 'No cues to translate');
      activateVideo(track);
      return;
    }

    state.translationInProgress = true;
    updateOverlay('AI Translating...', lang + ' → ' + target);
    var cues = Array.prototype.slice.call(track.cues || []);
    var sourceText = cues.map(function(cue) { return cue.text; }).join('\n--\n');

    chrome.runtime.sendMessage({
      action: 'translate_text',
      text: sourceText,
      sourceLang: lang,
      targetLang: target
    }, function(response) {
      if (!response || response.error) {
        state.translationInProgress = false;
        log('Translation failed', response && response.error);
        updateOverlay('Subtitles ready', 'Using original captions');
        activateVideo(track);
        return;
      }
      applyTranslatedTrack(cues, response.translatedText || '', target);
    });
  }

  function applyTranslatedTrack(cues, translatedText, targetLang) {
    if (!state.video) return;
    if (state.customTrack) {
      try { state.customTrack.mode = 'disabled'; } catch (e) {}
      state.customTrack = null;
    }

    var translatedLines = translatedText.split('\n--\n');
    var newTrack = state.video.addTextTrack('subtitles', 'Translated', targetLang);
    newTrack.mode = 'showing';
    newTrack.language = targetLang;
    for (var i = 0; i < cues.length; i++) {
      var originalCue = cues[i];
      var translation = translatedLines[i] || translatedLines[translatedLines.length - 1] || originalCue.text;
      try {
        newTrack.addCue(new VTTCue(originalCue.startTime, originalCue.endTime, translation));
      } catch (e) {
        log('Failed to add translated cue', e);
      }
    }
    state.customTrack = newTrack;
    state.translationInProgress = false;
    state.subtitlesReady = true;
    updateOverlay('Subtitles ready', 'Translated subtitles loaded');
    activateVideo();
  }

  function activateVideo(track) {
    if (!state.video) return;
    state.subtitlesReady = true;
    state.readyToPlay = true;
    if (track && !state.customTrack) {
      try { track.mode = 'showing'; } catch (e) {}
    }

    try {
      if (state.video.currentTime > 0.05) {
        state.video.currentTime = 0;
      }
    } catch (e) {}

    state.video.muted = false;
    state.video.volume = 1;
    state.cancelPlayInterceptor = true;
    var promise = state.video.play();
    if (promise && promise.catch) {
      promise.catch(function(err) {
        log('Autoplay blocked', err);
        updateOverlay('Subtitles ready', 'Tap play to start synchronized playback');
      });
    } else {
      updateOverlay('Subtitles ready', 'Playback started');
    }
  }

  function findVideo() {
    var video = document.querySelector('video');
    if (video) {
      attachVideo(video);
      return true;
    }
    return false;
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    loadSettings();
    createOverlay();

    if (findVideo()) return;
    var observer = new MutationObserver(function(muts) {
      if (findVideo()) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    state.observer = observer;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
