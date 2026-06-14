var WHISPER_URL = 'http://127.0.0.1:8022';

/**
 * Whisper Client 
 * Note: To avoid CORS issues in content scripts, we route through background via chrome.runtime.sendMessage
 */
var WhisperClient = (function() {
  var _instance;
  function Whisper() {
    this._queue = [];
    this._playing = false;
    this.state = 'READY';
    this.ready = true;
  }

  Whisper.prototype.transcribe = function(text, lang, callback) {
    var self = this;
    if (!self.ready) {
      chrome.runtime.sendMessage({ type: 'WHISPER_TRANSCRIBE', text: text }, function(res) {
        if (callback) callback(res);
      });
      return;
    }
    self._queue.push({text: text, lang: lang || 'es', cb: callback});
    if (!self._playing) self._next();
  };

  Whisper.prototype._next = function() {
    var self = this;
    if (self._queue.length === 0) {
      self.state = 'IDLE';
      return;
    }
    var item = self._queue.shift();
    self._playing = true;
    self.state = 'PLAYING';
    // Internal processing logic...
  };

  Whisper.prototype.stop = function() {
    this._queue = [];
    this._playing = false;
    this.state = 'READY';
  };

  Whisper.prototype.destroy = function() {
    this.stop();
  };

  return {
    instance: new Whisper(),
    transcribe: function(text, lang, callback) {
      return this.instance.transcribe(text, lang, callback);
    },
    stop: function() {
      this.instance.stop();
    }
  };
})();

window.YSS.WhisperClient = WhisperClient;
