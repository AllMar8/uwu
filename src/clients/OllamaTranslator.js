// [YSS-FIX-BUG-C3] OllamaTranslator — usa background.js como proxy en vez de fetch directo
// Esto evita CORS intermitente en content scripts
(function(){
  if(!window.YSS) window.YSS = {};

  window.YSS.OllamaTranslator = {
    state: 'IDLE',
    ready: true,
    queue: [],
    processing: false,
    cache: {},
    model: 'gemma3:4b',

    TRANSLATE_PROMPT: 'Translate the following subtitle into natural Latin American Spanish. ' +
      'Do NOT repeat words. Keep the tone natural and conversational. ' +
      'Use context if available. Fix literal translations. ' +
      'Preserve character names as-is. ' +
      'Return ONLY the translated subtitle, no explanations.',

    loadSettings: function(){
      var self = this;
      try {
        chrome.storage.sync.get(['ollama_enabled','ollama_model'], function(d){
          if(d && d.ollama_model) self.model = d.ollama_model;
        });
      } catch(e){}
    },

    translate: function(text){
      var self = this;
      return new Promise(function(resolve){
        if(!text || text.length < 2){ resolve(text); return; }
        if(self.cache[text] !== undefined){ resolve(self.cache[text]); return; }
        self.queue.push({text: text, resolve: resolve});
        self._process();
      });
    },

    _process: function(){
      var self = this;
      if(self.processing || self.queue.length === 0) return;
      self.processing = true;
      self.state = 'PROCESSING';
      var item = self.queue.shift();
      var prompt = self.TRANSLATE_PROMPT + '\n\nSubtitle:\n' + item.text;
      var timedOut = false;

      // [YSS-FIX-BUG-C3] Usar el proxy de background.js en vez de fetch directo
      var timeoutId = setTimeout(function(){
        timedOut = true;
        self.cache[item.text] = item.text;
        item.resolve(item.text);
        self.processing = false;
        self.state = 'IDLE';
        self._process();
      }, 15000);

      try {
        chrome.runtime.sendMessage({
          action: 'ollama_generate',
          url: 'http://127.0.0.1:11434/api/generate',
          payload: {
            model: self.model,
            prompt: prompt,
            stream: false,
            options: { temperature: 0.3 }
          }
        }, function(response){
          if(timedOut) return;
          clearTimeout(timeoutId);
          if(chrome.runtime.lastError || !response || !response.ok){
            var errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : (response && response.error) || 'Unknown';
            console.warn('[OllamaTranslator] Error via background:', errMsg);
            self.cache[item.text] = item.text;
            item.resolve(item.text);
          } else {
            var result = (response.response || item.text).trim();
            // Validar que la respuesta no sea idéntica al input (fallo silencioso de Ollama)
            if(result === item.text.trim() || result.length < 2) result = item.text;
            self.cache[item.text] = result;
            item.resolve(result);
          }
          self.processing = false;
          self.state = 'IDLE';
          self._process();
        });
      } catch(e) {
        clearTimeout(timeoutId);
        console.warn('[OllamaTranslator] sendMessage failed:', e.message);
        self.cache[item.text] = item.text;
        item.resolve(item.text);
        self.processing = false;
        self.state = 'IDLE';
        self._process();
      }
    },

    clearCache: function(){
      this.cache = {};
    }
  };
})();
