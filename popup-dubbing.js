(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var modeSelect = document.getElementById('dubbing_mode');
    var statusDiv = document.getElementById('dubbing_status');
    var modeSpan = document.getElementById('dubbing_mode_value');
    if(!modeSpan){
      modeSpan = {textContent: ''};
      var parent = statusDiv.parentNode;
      var span = document.createElement('span');
      span.id = 'dubbing_mode_value';
      span.style.display = 'none';
      parent.appendChild(span);
      modeSpan = span;
    }
    var statusDot = document.getElementById('dubbing_engine_dot');
    var driftSpan = document.getElementById('engine_drift');
    var latencySpan = document.getElementById('engine_latency');
    var whisperSpan = document.getElementById('engine_whisper');
    var ollamaSpan = document.getElementById('engine_ollama');
    var ttsSpan = document.getElementById('engine_tts');
    var whisperBlock = document.getElementById('whisper_block');
    var ollamaBlock = document.getElementById('ollama_block');
    var ttsBlock = document.getElementById('tts_block');
    if(!modeSelect || !statusDiv) return;

    function setDot(state){
      if(!statusDot) return;
      statusDot.className = 'status-dot';
      if(!state || state === 'IDLE' || state === 'N/A') statusDot.classList.add('idle');
      else if(state === 'READY') statusDot.classList.add('ready');
      else if(state === 'SPEAKING' || state === 'PROCESSING' || state === 'TRANSCRIBING') statusDot.classList.add('speaking');
      else statusDot.classList.add('error');
    }

    function setServiceVal(span, status){
      if(!span) return;
      var val = (status || 'N/A').toUpperCase();
      span.textContent = val;
      span.style.color = '';
      if(val === 'CONNECTED' || val === 'IDLE' || val === 'READY' || val === 'OK') span.style.color = '#44c97d';
      else if(val === 'PROCESSING' || val === 'SPEAKING' || val === 'TRANSCRIBING') span.style.color = '#d9a83b';
      else if(val === 'DISCONNECTED' || val === 'ERROR' || val === 'N/A') span.style.color = '#e55555';
    }

    function pollState(){
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
        if(!tabs || !tabs[0] || !tabs[0].url || !tabs[0].url.includes('youtube.com/watch')){
          statusDiv.textContent = 'Not on YouTube';
          setDot('IDLE');
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, {action: 'YSS_GET_STATE'}, function(resp){
          if(chrome.runtime.lastError || !resp || !resp.ok){
            statusDiv.textContent = 'Engine not detected';
            setDot('IDLE');
            return;
          }
          var s = resp.engineState || {};
          var state = s.state || 'N/A';
          statusDiv.textContent = state;
          setDot(state);
          if(modeSpan) modeSpan.textContent = resp.dubbingMode || 'soft_dub';
          if(driftSpan) driftSpan.textContent = (s.drift || 0) + '';
          if(latencySpan) latencySpan.textContent = (s.latency || 0) + '';
          setServiceVal(whisperSpan, s.whisper);
          setServiceVal(ollamaSpan, s.ollama);
          setServiceVal(ttsSpan, s.tts);
        });
      });
    }

    modeSelect.addEventListener('change', function(){
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
        if(!tabs || !tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, {action: 'YSS_SET_MODE', mode: modeSelect.value}, function(){
          if(chrome.runtime.lastError){}
        });
      });
    });

    pollState();
    setInterval(pollState, 2000);
  });
})();
