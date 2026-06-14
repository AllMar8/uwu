// [YSS-FIX-BUG-A4] popup-tabs.js — usa chrome.storage.local en vez de localStorage
// localStorage del popup no persiste correctamente en MV3
(function(){
  try {
    var STORAGE_KEY = 'yss_active_tab';
    var tabs = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');

    if(!tabs.length || !panels.length) return;

    function activateTab(tabId){
      tabs.forEach(function(btn){
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });
      panels.forEach(function(panel){
        panel.classList.toggle('active', panel.id === 'tab-' + tabId);
      });
      // [YSS-FIX-BUG-A4] chrome.storage.local en vez de localStorage
      try { chrome.storage.local.set({[STORAGE_KEY]: tabId}); } catch(e){}
    }

    tabs.forEach(function(btn){
      btn.addEventListener('click', function(){
        activateTab(btn.dataset.tab);
      });
    });

    // [YSS-FIX-BUG-A4] Leer tab guardado desde chrome.storage.local
    try {
      chrome.storage.local.get([STORAGE_KEY], function(result){
        var saved = result && result[STORAGE_KEY];
        var initialTab = saved && document.querySelector('.tab-btn[data-tab="' + saved + '"]')
          ? saved
          : 'voice';
        activateTab(initialTab);
      });
    } catch(e){
      activateTab('voice'); // fallback si chrome.storage no disponible
    }
  } catch(e){}
})();
