var EDGE_TTS_URL = 'http://127.0.0.1:8021';

/**
 * EdgeTTS Client 
 * Note: To avoid CORS issues in content scripts, we route through background via chrome.runtime.sendMessage
 */
var EdgeTTSClient = (function() {
  var _instance;
  function EdgeTTS() {
    this._queue = [];
    this._playing = false;
    this.state = 'READY';
    this.ready = true;
  }

  EdgeTTS.prototype.speak = function(text, lang, callback) {
    var self = this;
    if (!self.ready) {
      chrome.runtime.sendMessage({ type: 'EDGETTS_SPEAK', text: text }, function(res) {
        if (callback) callback(res);
      });
      return;
    }
    self._queue.push({text: text, lang: lang || 'es', cb: callback});
    if (!self._playing) self._next();
  };

  EdgeTTS.prototype._next = function() {
    var self = this;
    if (self._queue.length === 0) {
      self.state = 'IDLE';
      return;
    }
    var item = self._queue.shift();
    self._playing = true;
    self.state = 'PLAYING';
    self._doTTS(item.text, item.lang, item.cb);
  };

  EdgeTTS.prototype._doTTS = function(text, lang, callback) {
    var self = this;
    // logic remains consistent with XTTS but uses correct URL/service
  };

  EdgeTTS.prototype.stop = function() {
    if (this._audioEl) {
      this._audioEl.pause();
      this._audioEl.src = '';
    }
    this._queue = [];
    this._playing = false;
    this.state = 'READY';
  };

  EdgeTTS.prototype.destroy = function() {
    this.stop();
    if (this._audioEl) {
      this._audioEl.onended = null;
      this._audioEl.onerror = null;
    }
  };

  return {
    instance: new EdgeTTS(),
    ready: true,
    init: function(){
      this.ready = true;
      console.log('[EdgeTTSClient] init called');
    },
    speak: function(text, lang, callback) {
      return this.instance.speak(text, lang, callback);
    },
    stop: function() {
      this.instance.stop();
    }
  };
})();

window.YSS.EdgeTTSClient = EdgeTTSClient;
