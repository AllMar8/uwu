(function(){
  var fileInput = document.getElementById('sub_file_input');
  var btnLoad = document.getElementById('btn_load_sub');
  var btnClear = document.getElementById('btn_clear_sub');
  var btnDownload = document.getElementById('btn_download_sub');
  var downloadStatus = document.getElementById('download_status');

  function parseVTT(text){
    var segs = [];
    var lines = text.split('\n');
    var i = 0;
    while(i < lines.length && !lines[i].includes('-->')) i++;
    while(i < lines.length){
      var line = lines[i];
      if(line.includes('-->')){
        var times = line.split('-->');
        var start = parseFloat(times[0].trim().split(':').reduce(function(a,b){return a*60+parseFloat(b);},0));
        var endStr = times[1].trim().split(' ')[0];
        var end = parseFloat(endStr.split(':').reduce(function(a,b){return a*60+parseFloat(b);},0));
        i++;
        var t = '';
        while(i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')){
          var c = lines[i].replace(/<[^>]+>/g,'').trim();
          if(c) t += c + ' ';
          i++;
        }
        t = t.trim();
        if(t && start >= 0 && end > start){
          segs.push({ time: start * 1000, dDurationMs: (end - start) * 1000, text: t });
        }
      } else { i++; }
    }
    return segs;
  }

  function parseSRT(text){
    var segs = [];
    var blocks = text.trim().split(/\n\s*\n/);
    for(var b=0;b<blocks.length;b++){
      var lines = blocks[b].split('\n');
      var timeLine = null;
      for(var i=0;i<lines.length;i++){
        if(lines[i].includes('-->')){ timeLine = lines[i]; break; }
      }
      if(!timeLine) continue;
      var times = timeLine.split('-->');
      var startStr = times[0].trim().replace(',','.');
      var endStr = times[1].trim().replace(',','.');
      var start = parseFloat(startStr.split(':').reduce(function(a,b){return a*60+parseFloat(b);},0));
      var end = parseFloat(endStr.split(':').reduce(function(a,b){return a*60+parseFloat(b);},0));
      var text = '';
      for(i++;i<lines.length;i++){
        var c = lines[i].replace(/<[^>]+>/g,'').trim();
        if(c) text += c + ' ';
      }
      text = text.trim();
      if(text && start >= 0 && end > start){
        segs.push({ time: start * 1000, dDurationMs: (end - start) * 1000, text: text });
      }
    }
    return segs;
  }

  function parseJSON(text){
    try { return JSON.parse(text); } catch(e){ return null; }
  }

  function dedupeSegs(arr){
    var r = [];
    for(var i=0;i<arr.length;i++){
      if(r.length && r[r.length-1].text === arr[i].text) continue;
      r.push(arr[i]);
    }
    return r;
  }

  function saveSubs(segs, statusMsg){
    segs = dedupeSegs(segs);
    chrome.storage.local.set({ yss_custom_subs: segs }, function(){
      downloadStatus.textContent = statusMsg + ' (' + segs.length + ' segments)';
    });
  }

  function loadStatus(){
    chrome.storage.local.get('yss_custom_subs', function(d){
      if(d && d.yss_custom_subs && d.yss_custom_subs.length){
        downloadStatus.textContent = d.yss_custom_subs.length + ' segments loaded';
      } else {
        downloadStatus.textContent = 'No custom subtitles';
      }
    });
  }

  function getYouTubeTab(cb){
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs){
      if(!tabs || !tabs[0]){ downloadStatus.textContent = 'No active tab'; return; }
      var tab = tabs[0];
      if(!tab.url || !tab.url.includes('youtube.com/watch')){
        downloadStatus.textContent = 'Not a YouTube video page';
        return;
      }
      cb(tab);
    });
  }

  btnLoad.addEventListener('click', function(){
    var file = fileInput.files[0];
    if(!file){ downloadStatus.textContent = 'Select a file first'; return; }
    var reader = new FileReader();
    reader.onload = function(e){
      var text = e.target.result;
      var segs = null;
      if(file.name.endsWith('.json')){
        segs = parseJSON(text);
      } else if(file.name.endsWith('.srt')){
        segs = parseSRT(text);
      } else {
        segs = parseVTT(text);
      }
      if(segs && segs.length > 0){
        saveSubs(segs, 'Loaded from file');
      } else {
        downloadStatus.textContent = 'No valid subtitles found in file';
      }
    };
    reader.readAsText(file);
  });

  btnClear.addEventListener('click', function(){
    chrome.storage.local.remove('yss_custom_subs', function(){
      downloadStatus.textContent = 'Custom subtitles cleared';
    });
  });

  btnDownload.addEventListener('click', function(){
    downloadStatus.textContent = 'Getting video ID...';
    getYouTubeTab(function(tab){
      // Try content script first for video ID
      try {
        chrome.tabs.sendMessage(tab.id, { action: 'getVideoId' }, function(response){
          if(chrome.runtime.lastError || !response || !response.videoId){
            var m = tab.url.match(/[?&]v=([^&]+)/);
            if(m) triggerDownload(tab.id, m[1]);
            else downloadStatus.textContent = 'Could not get video ID';
            return;
          }
          triggerDownload(tab.id, response.videoId);
        });
      } catch(e){
        var m = tab.url.match(/[?&]v=([^&]+)/);
        if(m) triggerDownload(tab.id, m[1]);
        else downloadStatus.textContent = 'Could not get video ID';
      }
    });
  });

  function triggerDownload(tabId, videoId){
    downloadStatus.textContent = 'Downloading... check video page for status';
    chrome.tabs.sendMessage(tabId, { action: 'downloadSubsFromPopup' });
    // Monitor storage for completion
    var checkInterval = setInterval(function(){
      chrome.storage.local.get('yss_custom_subs', function(d){
        if(d && d.yss_custom_subs && d.yss_custom_subs.length > 0){
          downloadStatus.textContent = 'Downloaded ' + d.yss_custom_subs.length + ' segments';
          clearInterval(checkInterval);
        }
      });
    }, 1500);
    // Timeout after 30s
    setTimeout(function(){ clearInterval(checkInterval); }, 30000);
  }

  loadStatus();
})();