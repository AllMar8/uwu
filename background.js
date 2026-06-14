// ─── Default Options ────────────────────────────────────────────────
var YSS_DEFAULTS = {
  enable: 1,
  speech_voice: 0,
  translate_lang: (navigator.language || 'en').split('-')[0],
  rate: 1.2,
  max_rate: 1.4,
  volume: 1,
  pitch: 1,
  speaking_control: 'voice',
  custom_translate_lang: { name: '', code: '' },
  ui_lang: (navigator.language || 'en').split('-')[0],
  voices_map: {}
};

var YSS_options = {};
var YSS_nowPlaying = '';
var _timedtextUrl = null;
var _timedtextHeaders = null;

// ─── Console Debug Helpers ──────────────────────────────────────────
console.clear_storage = function(){
  chrome.storage.sync.clear().then(function(){ console.log('storage clear'); });
};
console.show_storage = function(){
  new Promise(function(resolve, reject){
    chrome.storage.sync.get(null, function(items){
      if(chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(items);
    });
  }).then(function(items){ console.log(items); });
};

// ─── Options Load + Watch ───────────────────────────────────────────
function loadOptions(cb){
  chrome.storage.sync.get('options', function(data){
    if(chrome.runtime.lastError) { console.warn('storage error:', chrome.runtime.lastError); return; }
    var saved = data && data.options ? data.options : {};
    var changed = false;
    for(var k in YSS_DEFAULTS){
      if(saved.hasOwnProperty(k)) { YSS_options[k] = saved[k]; }
      else { YSS_options[k] = YSS_DEFAULTS[k]; changed = true; }
    }
    // ensure keys not in defaults are removed
    for(var k2 in saved){
      if(!YSS_DEFAULTS.hasOwnProperty(k2)) changed = true;
    }
    if(changed){
      chrome.storage.sync.set({options: YSS_options});
    }
    if(cb) cb(YSS_options);
  });
}

chrome.storage.onChanged.addListener(function(changes, areaName){
  if(areaName !== 'sync') return;
  if(changes.options){
    loadOptions();
  }
});

// ─── webRequest: capture timedtext URL + headers ────────────────────
chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details){
    if(!details.tabId) return;
    if(details.url.indexOf('/api/timedtext') !== -1){
      _timedtextUrl = details.url;
      var hdrs = {};
      if(details.requestHeaders){
        for(var i = 0; i < details.requestHeaders.length; i++){
          var name = details.requestHeaders[i].name.toLowerCase();
          if(name.indexOf('x-') === 0){
            hdrs[name] = details.requestHeaders[i].value;
          }
        }
      }
      _timedtextHeaders = hdrs;
    }
  },
  { urls: ['*://*.youtube.com/api/timedtext*'] },
  ['requestHeaders', 'extraHeaders']
);

// ─── External Message Handler (popup ↔ service worker) ──────────────
chrome.runtime.onMessageExternal.addListener(function(msg, sender, sendResponse){
  // badge update
  if(msg && msg.hasOwnProperty('badge')){
    var b = { text: msg.badge };
    if(b.text){
      chrome.action.setBadgeText(b);
      if(['On','Off'].indexOf(b.text) !== -1){
        chrome.action.setBadgeBackgroundColor({ color: [0,0,0,b.text === 'On' ? 0 : 1] });
      }
    }
  }
  // title
  if(msg && msg.hasOwnProperty('title')){
    YSS_nowPlaying = msg.title;
  }
  // options request
  if(msg && (msg.hasOwnProperty('options') || msg === 'options')){
    sendResponse({ options: YSS_options });
  }
  // timedtext request
  if(msg && msg.hasOwnProperty('timedtext')){
    sendResponse({ timedtext: _timedtextUrl, headers: _timedtextHeaders });
    _timedtextUrl = null;
  }
  // update options
  if(msg && msg.hasOwnProperty('update')){
    var updates = msg.update;
    for(var key in updates){
      if(YSS_options.hasOwnProperty(key)){
        YSS_options[key] = updates[key];
      }
    }
    chrome.storage.sync.set({options: YSS_options}, function(){
      loadOptions();
    });
  }
});

// ─── Internal Message Handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){
  // now_playing query
  if(msg && msg.question === 'now_playing'){
    sendResponse({ answer: 'now_playing', msg: YSS_nowPlaying });
    return true;
  }

  if(msg.action === 'tts_speak'){
    if(typeof chrome.tts !== 'undefined' && chrome.tts.speak){
      chrome.tts.speak(msg.text, {
        lang: msg.lang || 'en-US',
        rate: msg.rate || 1.0,
        pitch: msg.pitch || 1.0,
        volume: msg.volume || 1.0,
        voiceName: msg.voiceName || '',
        onEvent: function(evt){
          if(['end','interrupted','cancelled','error'].indexOf(evt.type) !== -1){
            try { chrome.tabs.sendMessage(sender.tab.id, { action: 'tts_done', id: msg.id }); } catch(e){}
          }
        }
      });
      sendResponse({ok: true});
    } else {
      sendResponse({ok: false, error: 'chrome.tts not available'});
    }
    return true;
  }

  if(msg.action === 'ollama_generate'){
    var primaryUrl = msg.url || 'http://127.0.0.1:11434/api/generate';
    var headers = { 'Content-Type': 'application/json' };
    var bodyStr = JSON.stringify(msg.payload);
    var TOTAL_TIMEOUT_MS = 20000;
    var startTimeTimer = Date.now();
    var mainController = new AbortController();
    var failSafeTimeout = setTimeout(function(){ mainController.abort(); }, TOTAL_TIMEOUT_MS);

    doOllamaFetch(primaryUrl, headers, bodyStr, function(err, res){
      if(err && primaryUrl.indexOf('127.0.0.1') !== -1){
        var elapsed = Date.now() - startTimeTimer;
        var remaining = TOTAL_TIMEOUT_MS - elapsed - 500;
        if(remaining <= 0){
          clearTimeout(failSafeTimeout);
          sendResponse({ok: false, error: 'Ollama total timeout exceeded'});
          return;
        }
        var fallbackUrl = primaryUrl.replace('127.0.0.1', 'localhost');
        console.log('[Ollama] Primary failed, switching to:', fallbackUrl, 'Remaining:', remaining);
        var secondCtrl = new AbortController();
        var secondRetryTimeout = setTimeout(function(){ secondCtrl.abort(); }, remaining);
        doOllamaFetch(fallbackUrl, headers, bodyStr, function(err2, res2){
          clearTimeout(failSafeTimeout);
          clearTimeout(secondRetryTimeout);
          sendResponse(err2 ? {ok: false, error: err2.message} : res2);
        }, secondCtrl.signal);
      } else {
        clearTimeout(failSafeTimeout);
        sendResponse(err ? {ok: false, error: err.message || 'Unknown'} : res);
      }
    }, mainController.signal);
    return true;
  }

  if(msg.action === 'YSS_GET_STATE'){
    try {
      chrome.tabs.sendMessage(sender.tab.id, { action: 'YSS_GET_STATE' }, function(response){
        sendResponse(response || {ok: false, error: 'no response from content script'});
      });
    } catch(e) {
      sendResponse({ok: false, error: e.message});
    }
    return true;
  }

  if(msg.action === 'YSS_SET_MODE'){
    try {
      chrome.tabs.sendMessage(sender.tab.id, { action: 'YSS_SET_MODE', mode: msg.mode }, function(response){
        sendResponse(response || {ok: true});
      });
    } catch(e) {
      sendResponse({ok: false, error: e.message});
    }
    return true;
  }

  if(msg.action === 'YSS_PING_TTS_SERVER'){
    var ttsUrl = msg.url || 'http://127.0.0.1:8020/health';
    fetch(ttsUrl, { signal: AbortSignal.timeout(3000) })
      .then(function(r){
        sendResponse({ok: r.ok, status: r.status});
      })
      .catch(function(e){
        sendResponse({ok: false, error: e.message});
      });
    return true;
  }

  if(msg.action === 'translate_text'){
    translateText(msg.text, msg.sourceLang, msg.targetLang, msg.endpoint).then(function(result){
      sendResponse({translatedText: result});
    }).catch(function(err){
      sendResponse({error: err.message || 'Translation failed'});
    });
    return true;
  }
});

// ─── Health Checks ──────────────────────────────────────────────────
var HEALTH_CHECK_INTERVAL = 30000;
var HEALTH_SERVICES = {
  xtts:     { url: 'http://127.0.0.1:8020/health',   state: 'unknown' },
  edgetts:  { url: 'http://127.0.0.1:8021/voices',   state: 'unknown' },
  whisper:  { url: 'http://127.0.0.1:8022/ready',    state: 'unknown' },
  ollama:   { url: 'http://127.0.0.1:11434/api/tags', state: 'unknown' }
};

function runHealthChecks(){
  var results = {};
  var pending = 0;
  for(var key in HEALTH_SERVICES){
    (function(k){
      pending++;
      var svc = HEALTH_SERVICES[k];
      fetch(svc.url, { signal: AbortSignal.timeout(3000) })
        .then(function(r){ svc.state = r.ok ? 'connected' : 'error'; })
        .catch(function(){ svc.state = 'disconnected'; })
        .finally(function(){
          results[k] = svc.state;
          pending--;
          if(pending === 0){
            try { chrome.storage.local.set({yss_health: results}); } catch(e){}
          }
        });
    })(key);
  }
}

// ─── Init ───────────────────────────────────────────────────────────
loadOptions();
chrome.runtime.onInstalled.addListener(function(){
  runHealthChecks();
  loadOptions();
});
setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL);

// ─── Helpers ────────────────────────────────────────────────────────
function doOllamaFetch(url, headers, bodyStr, onDone, signal){
  console.log('[Ollama] URL:', url);
  var opts = { method: 'POST', headers: headers, body: bodyStr };
  if(signal) opts.signal = signal;
  fetch(url, opts).then(function(r){
    console.log('[Ollama] Response status:', r.status);
    return r.text().then(function(txt){
      console.log('[Ollama] Response text:', txt.substring(0,500));
      if(!r.ok) throw new Error('HTTP ' + r.status + ' :: ' + (txt || r.statusText));
      try { return JSON.parse(txt); } catch(e){ throw new Error('Invalid JSON: ' + txt.substring(0,200)); }
    });
  }).then(function(data){
    console.log('[Ollama] Success, response:', (data.response || '').trim().substring(0,200));
    onDone(null, {ok: true, response: (data.response || '').trim()});
  }).catch(function(err){
    console.log('[Ollama] Error:', err.message);
    onDone(err, null);
  });
}

function translateText(text, sourceLang, targetLang, endpoint) {
  var payload = {
    q: text,
    source: sourceLang || 'auto',
    target: targetLang,
    format: 'text'
  };
  if (endpoint) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(response){
      if(!response.ok) throw new Error('Translation endpoint error ' + response.status);
      return response.json();
    }).then(function(data){
      return data.translatedText || data.result || data.translation || '';
    });
  }
  var url = 'https://libretranslate.de/translate';
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function(response){
    if(!response.ok) throw new Error('LibreTranslate error ' + response.status);
    return response.json();
  }).then(function(data){
    return data.translatedText || '';
  });
}

// ─── Boot log ───────────────────────────────────────────────────────
console.log('[YSS SW] initialized, lang=' + YSS_DEFAULTS.ui_lang);
