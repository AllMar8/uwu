(function(){
  if (typeof window === 'undefined' || !document) return;
  if (!window.speechSynthesis) return;
  if(window.YSS && window.YSS._dubbingInited) return;

  var DEFAULTS = {
    enabled: true,
    minLength: 2,
    maxLength: 300,
    dedupeWindowMs: 1300,
    scanIntervalMs: 3000
  };

  var opts = { enabled: true };
  var lastText = '';
  var lastTime = 0;

  function loadOptions(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['rate', 'pitch', 'volume', 'speech_voice', 'enable', 'translate_lang'], function(items) {
        if (chrome.runtime.lastError) return;
        opts.enabled = typeof items.enable !== 'undefined' ? Boolean(items.enable) : true;
        opts.rate = items.rate;
        opts.pitch = items.pitch;
        opts.volume = items.volume;
        opts.speech_voice = items.speech_voice;
        opts.translate_lang = items.translate_lang;
        if (typeof cb === 'function') cb();
      });
    }
  }

  loadOptions();

  function cleanSubtitle(text) {
    if (!text) return '';
    text = text.replace(/\u200B/g, '');
    text = text.replace(/\[[^\]]*\]|\([^\)]*\)|\{[^}]*\}/g, '');
    text = text.replace(/^\s*[-–—]\s*/, '');
    text = text.replace(/^[A-Z0-9_.\-]{2,20}[:\-]\s*/, '');
    text = text.replace(/\b\d{1,2}:\d{2}:?\d{0,2}\b/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    var style = window.getComputedStyle(el);
    if (!style || style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity || '1') === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isCaptionElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return el.matches('.ytp-caption-window, .ytp-caption-segment, .caption-window, .captions-text, .vjs-text-track-display, .subtitle, .subtitles');
  }

  function findCaptionContainer(node) {
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.nodeType === Node.ELEMENT_NODE && isCaptionElement(node)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function getCaptionText(node) {
    var container = findCaptionContainer(node);
    if (!container) return '';
    return cleanSubtitle((container.innerText || container.textContent || '').trim());
  }

  function speakText(text, originalText) {
    if (!opts.enabled) return;
    if (!text) return;
    text = text.trim();
    if (!text || text.length < DEFAULTS.minLength || text.length > DEFAULTS.maxLength) return;
    var now = Date.now();
    if (text === lastText && (now - lastTime) < DEFAULTS.dedupeWindowMs) return;
    lastText = text;
    lastTime = now;

    // Check for Ollama translation
    if ((typeof window.YSS !== 'undefined' && 
         typeof window.YSS.OllamaTranslator !== 'undefined' && 
         window.YSS._dubbingEnabled !== true) ||
        (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync)) {
      
      var refreshOptionsTimer = setInterval(function() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(['ollama_enabled'], function(items) {
            if (items.ollama_enabled === true && 
                typeof window.YSS !== 'undefined' && 
                typeof window.YSS.OllamaTranslator !== 'undefined' && 
                window.YSS._dubbingEnabled !== true) {
              clearInterval(refreshOptionsTimer);
              
              function translateWithRetry() {
                if (typeof window.YSS.OllamaTranslator.translate === 'function') {
                  window.YSS.OllamaTranslator.translate(originalText || text).then(function(translated) {
                    var overlay = window.YSS.SubtitleOverlay;
                    if (overlay && typeof overlay.showBilingual === 'function' && !window.YSS._dubbingEnabled) {
                      overlay.showBilingual(originalText || text, translated, 4000);
                    } else {
                      speakText(text, originalText);
                    }
                  }).catch(function(err) {
                    // Error translating, fallback to speaking
                    speakText(text, originalText);
                  });
                } else {
                  setTimeout(translateWithRetry, 500);
                }
              }
              translateWithRetry();
            }
          });
        }
      }, 10000);
    }

    var utterance = new SpeechSynthesisUtterance(text);
    try {
      var voices = window.speechSynthesis.getVoices() || [];
      if (typeof opts.speech_voice !== 'undefined' && voices[opts.speech_voice]) utterance.voice = voices[opts.speech_voice];
      if (typeof opts.rate !== 'undefined') utterance.rate = opts.rate;
      if (typeof opts.pitch !== 'undefined') utterance.pitch = opts.pitch;
      if (typeof opts.volume !== 'undefined') utterance.volume = opts.volume;
      if (typeof opts.translate_lang !== 'undefined') utterance.lang = opts.translate_lang;
    } catch (e) {}

    try { window.speechSynthesis.speak(utterance); } catch (e) {}
  }

  function handleNodeUpdate(node) {
    var text = getCaptionText(node);
    if (text) speakText(text);
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'characterData' && m.target && m.target.nodeType === Node.TEXT_NODE) {
        handleNodeUpdate(m.target);
      }
      if (m.addedNodes && m.addedNodes.length) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var added = m.addedNodes[j];
          if (added.nodeType === Node.TEXT_NODE) {
            handleNodeUpdate(added);
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            var container = findCaptionContainer(added) || added.querySelector('.ytp-caption-window, .ytp-caption-segment, .caption-window, .captions-text, .vjs-text-track-display, .subtitle, .subtitles');
            if (container) handleNodeUpdate(container);
          }
        }
      }
    }
  });

  var root = document.body || document.documentElement;
  if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });

  function scanExisting() {
    var selectors = ['.ytp-caption-window', '.ytp-caption-segment', '.caption-window', '.captions-text', '.vjs-text-track-display', '.subtitle', '.subtitles'];
    for (var k = 0; k < selectors.length; k++) {
      var els = document.querySelectorAll(selectors[k]);
      for (var n = 0; n < els.length; n++) {
        var el = els[n];
        if (!el || !isVisible(el)) continue;
        var text = cleanSubtitle((el.innerText || el.textContent || '').trim());
        if (text) speakText(text);
      }
    }
  }

  setTimeout(scanExisting, 800);
  setInterval(scanExisting, DEFAULTS.scanIntervalMs);
})();