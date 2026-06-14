(function(){
  try {
    document.addEventListener('DOMContentLoaded', function() {
      var selectVoice = document.getElementById('speech_voice');
      var sampleInput = document.getElementById('sample_text');
      var btnTest = document.getElementById('btn_test_voice');
      var btnStop = document.getElementById('btn_stop_voice');
      if (!selectVoice || !btnTest || !btnStop || !sampleInput) return;

      var SAMPLE = sampleInput.placeholder || 'Hello, this is a voice test.';

      function getVoices() {
        var v = window.speechSynthesis.getVoices();
        if (v && v.length) return Promise.resolve(v);
        if (window.YSS && typeof window.YSS.getVoicesAsync === 'function') {
          return window.YSS.getVoicesAsync(3000);
        }
        return new Promise(function(resolve) {
          var handler = function() {
            window.speechSynthesis.removeEventListener('voiceschanged', handler);
            resolve(window.speechSynthesis.getVoices() || []);
          };
          window.speechSynthesis.addEventListener('voiceschanged', handler);
          setTimeout(function() { resolve(window.speechSynthesis.getVoices() || []); }, 1500);
        });
      }

      function populateVoices(voices) {
        if (selectVoice.options.length > 0) return;
        voices.forEach(function(voice, idx) {
          var o = document.createElement('option');
          o.value = idx;
          o.textContent = voice.name + (voice.lang ? ' (' + voice.lang + ')' : '');
          selectVoice.appendChild(o);
        });
        chrome.storage.sync.get(['speech_voice'], function(items) {
          if (items && typeof items.speech_voice !== 'undefined') {
            selectVoice.value = items.speech_voice;
          }
        });
      }

      getVoices().then(populateVoices);

      window.speechSynthesis.addEventListener('voiceschanged', function() {
        getVoices().then(populateVoices);
      });

      btnTest.addEventListener('click', function() {
        var text = (sampleInput.value || SAMPLE).trim();
        if (!text) return;

        chrome.storage.sync.get(['speech_voice', 'rate', 'pitch', 'volume', 'translate_lang'], function(items) {
          var u = new SpeechSynthesisUtterance(text);
          var voices = window.speechSynthesis.getVoices() || [];
          if (items) {
            if (typeof items.speech_voice !== 'undefined' && voices[items.speech_voice]) u.voice = voices[items.speech_voice];
            if (typeof items.rate !== 'undefined') u.rate = items.rate;
            if (typeof items.pitch !== 'undefined') u.pitch = items.pitch;
            if (typeof items.volume !== 'undefined') u.volume = items.volume;
            if (typeof items.translate_lang !== 'undefined') u.lang = items.translate_lang;
          }
          var selIdx = parseInt(selectVoice.value);
          var v = voices[selIdx];
          if (v) u.voice = v;

          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        });
      });

      btnStop.addEventListener('click', function() { window.speechSynthesis.cancel(); });

      selectVoice.addEventListener('change', function() {
        chrome.storage.sync.set({speech_voice: parseInt(selectVoice.value)});
      });
    });
  } catch(e) {}
})();