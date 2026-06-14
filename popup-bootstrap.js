(function(){
  try {
    if(typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync){
      console.warn('[YSS] chrome.storage not available');
      return;
    }

    var LOADED_LOCALE = null;

    function applyUILang(code){
      if(!code) code = 'en';
      if(!chrome.runtime || !chrome.runtime.getURL){
        console.warn('[YSS] chrome.runtime.getURL not available');
        return;
      }
      var url = chrome.runtime.getURL('_locales/' + code + '/messages.json');
      fetch(url).then(function(r){
        if(!r.ok) throw new Error('No locale for ' + code);
        return r.json();
      }).then(function(msgs){
        LOADED_LOCALE = code;
        var els = document.querySelectorAll('[data-lang-field]');
        for(var i = 0; i < els.length; i++){
          var el = els[i];
          var field = el.getAttribute('data-lang-field');
          if(msgs[field] && msgs[field].message){
            el.textContent = msgs[field].message;
          }
        }
      }).catch(function(){
        if(code !== 'en') applyUILang('en');
      });
    }

    function initEnableToggle(){
      var cb = document.getElementById('enable');
      if(!cb) return;
      try {
        chrome.storage.sync.get(['enable'], function(d){
          if(d && d.enable === false){
            cb.checked = false;
          } else {
            cb.checked = true;
          }
        });
      } catch(e){}
      cb.addEventListener('change', function(){
        try { chrome.storage.sync.set({enable: cb.checked}); } catch(e){}
      });
    }

    function initUILang(){
      var sel = document.getElementById('ui_lang');
      if(!sel) return;
      try {
        chrome.storage.sync.get(['ui_lang'], function(d){
          var code = (d && d.ui_lang) || 'en';
          sel.value = code;
          applyUILang(code);
        });
      } catch(e){}
      sel.addEventListener('change', function(){
        try { chrome.storage.sync.set({ui_lang: sel.value}); } catch(e){}
        applyUILang(sel.value);
      });
    }

    function triggerTranslateLang(){
      var sel = document.getElementById('translate_lang');
      if(!sel) return;
      var o = document.createElement('option');
      o.value = '';
      o.textContent = '...';
      sel.appendChild(o);
    }

    document.addEventListener('DOMContentLoaded', function(){
      initEnableToggle();
      initUILang();
      triggerTranslateLang();
    });
  } catch(e){
    console.warn('[YSS] bootstrap error:', e);
  }
})();
