// --- Engine Logic ---
var DubbingEngine = (function() {
  var _video = null;
  var _state = 'IDLE';
  var _mode = 'soft_dub';
  var _drift = 0;
  var _latency = 0;
  var _clients = { ollama: null, xtts: null, edgeTts: null, whisper: null };
  var _config = { primary_tts: 'EdgeTTS' };

  function _notifyUI() {
    try {
      chrome.runtime.sendMessage({
        type: 'SYNC_STATE',
        data: { state: _state, mode: _mode, drift: _drift, latency: _latency }
      });
    } catch(e){}
  }

  return {
    get video(){ return _video; },
    get mode(){ return _mode; },

    init: function(video){
      _video = video;
      _state = 'IDLE';
      console.log('[DubbingEngine] init, video:', !!video);
    },

    setClient: function(name, client){
      _clients[name] = client;
      console.log('[DubbingEngine] client set:', name);
    },

    setMode: function(mode){
      _mode = mode || 'soft_dub';
      _notifyUI();
    },

    getState: function(){
      return {
        state: _state,
        mode: _mode,
        drift: _drift,
        latency: _latency,
        ollama: (_clients.ollama && _clients.ollama.state) || 'N/A',
        whisper: (_clients.whisper && _clients.whisper.state) || 'N/A',
        tts: (_clients.xtts && _clients.xtts.ready) ? 'XTTS' :
             (_clients.edgeTts && _clients.edgeTts.ready) ? 'EdgeTTS' : 'Browser'
      };
    },

    onSubtitle: function(sub){
      if(!sub || !sub.text) return;
      // Hook para futuras extensiones del engine
    },

    speak: function(text, lang, callback) {
      var self = this;
      _state = 'SPEAKING';
      _notifyUI();

      var targetClient = null;
      if(_config.primary_tts === 'XTTS' && _clients.xtts && _clients.xtts.ready){
        targetClient = _clients.xtts;
      } else if(_clients.edgeTts && _clients.edgeTts.ready){
        targetClient = _clients.edgeTts;
      }

      if(targetClient){
        try {
          targetClient.speak(text, lang || 'es', function(){
            _state = 'IDLE';
            _notifyUI();
            if(callback) callback();
          });
        } catch(e){
          console.error('[DubbingEngine] speak error:', e);
          _state = 'IDLE';
          _notifyUI();
        }
      } else {
        // Fallback: Web Speech API nativa
        var ut = new SpeechSynthesisUtterance(text);
        ut.lang = lang || 'es-ES';
        ut.onend = function(){
          _state = 'IDLE';
          _notifyUI();
          if(callback) callback();
        };
        window.speechSynthesis.speak(ut);
      }
    },

    destroy: function(){
      _video = null;
      _state = 'IDLE';
      _clients = { ollama: null, xtts: null, edgeTts: null, whisper: null };
      console.log('[DubbingEngine] destroyed');
    }
  };
})();

window.YSS.DubbingEngine = DubbingEngine;
