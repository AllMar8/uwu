(function(){
  if(!window.YSS) window.YSS = {};

  window.YSS.EngineStatus = {
    _el: null,
    _interval: null,

    init: function(){
      if(this._el) return;
      var el = document.createElement('div');
      el.id = 'yss-engine-status';
      el.style.cssText = 'position:fixed;top:60px;right:12px;z-index:999999;' +
        'background:rgba(0,0,0,0.75);color:#fff;font-family:monospace;font-size:11px;' +
        'padding:8px 12px;border-radius:8px;line-height:1.5;min-width:160px;' +
        'pointer-events:none;border:1px solid rgba(255,255,255,0.1);';
      document.body.appendChild(el);
      this._el = el;
      var self = this;
      this._interval = setInterval(function(){ self._render(); }, 500);
    },

    _render: function(){
      if(!this._el) return;
      var s = window.YSS.DubbingEngine ? window.YSS.DubbingEngine.getState() : {};
      var el = this._el;
      el.textContent = '';
      var rows = [
        {label: 'Dubbing Engine', bold: true, color: '#8cf'},
        {label: 'State', value: s.state || 'N/A', color: this._color(s.state)},
        {label: 'Mode', value: s.mode || 'soft_dub'},
        {label: 'Drift', value: (s.drift || 0) + 'ms'},
        {label: 'Latency', value: (s.latency || 0) + 'ms'},
        {label: 'STT', value: s.whisper || 'N/A', color: this._color(s.whisper)},
        {label: 'Ollama', value: s.ollama || 'N/A', color: this._color(s.ollama)},
        {label: 'TTS', value: s.tts || 'N/A'}
      ];
      for(var i = 0; i < rows.length; i++){
        var r = rows[i];
        var d = document.createElement('div');
        if(r.bold){ d.style.fontWeight = 'bold'; d.style.marginBottom = '4px'; }
        if(r.color) d.style.color = r.color;
        d.textContent = r.value ? (r.label + ': ' + r.value) : r.label;
        el.appendChild(d);
      }
    },

    _color: function(val){
      if(!val || val === 'N/A' || val === 'DISCONNECTED' || val === 'ERROR') return '#f66';
      if(val === 'CONNECTED' || val === 'READY' || val === 'IDLE') return '#6f6';
      if(val === 'PROCESSING' || val === 'SPEAKING' || val === 'TRANSCRIBING') return '#ff6';
      return '#fff';
    },

    destroy: function(){
      if(this._interval) clearInterval(this._interval);
      if(this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._el = null;
    }
  };
})();
