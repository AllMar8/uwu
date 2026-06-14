(function(){
  try {
    var _origPlay = HTMLVideoElement.prototype.play;
    window.__YSS_BLOCK_PLAY = true;
    window.__YSS_ALLOW_PLAY = false;

    HTMLVideoElement.prototype.play = function() {
      if(window.__YSS_BLOCK_PLAY && !window.__YSS_ALLOW_PLAY) {
        this.muted = true;
        this.volume = 0;
      }
      return _origPlay.apply(this, arguments);
    };

    window.__YSS_allowPlay = function() {
      window.__YSS_ALLOW_PLAY = true;
      var v = document.querySelector('video');
      if(v && v.paused && !v.ended) {
        _origPlay.call(v).catch(function(){});
      }
    };

    window.__YSS_blockPlay = function() {
      window.__YSS_ALLOW_PLAY = false;
      var v = document.querySelector('video');
      if(v) {
        if(!v.paused) v.pause();
        v.muted = true;
        v.volume = 0;
      }
    };

    // [YSS-FIX-BUG-C1] Patch speechSynthesis.speak early to block YSS bundle utterances
    var _patchSpeak = function() {
      if(typeof speechSynthesis === 'undefined') { setTimeout(_patchSpeak, 50); return; }
      var _origSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function(u) {
        if(u && !u.__yss_custom) {
          return; // Block non-custom utterances (YSS bundle)
        }
        return _origSpeak(u);
      };
      speechSynthesis.cancel();
    };
    _patchSpeak();

    // [YSS-FIX-BUG-C1] Safety timer: solo desbloquea si YSS nunca se inicializó correctamente
    // Guardamos el ID para que subtitle_fixer.js lo cancele cuando arranque
    window.__YSS_safetyTimerId = setTimeout(function(){
      if(!window.YSS || !window.YSS._customReaderRunning){
        console.log('[YSS-BLOCK] Safety unlock: YSS did not initialize in 25s');
        window.__YSS_ALLOW_PLAY = true;
      }
      // Si YSS sí arrancó, NO desbloqueamos — el audio sigue silenciado
    }, 25000);

  } catch(e) {
    console.warn('[YSS-BLOCK] init error:', e);
  }
})();
