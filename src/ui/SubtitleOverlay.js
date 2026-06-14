(function(){
  if(!window.YSS) window.YSS = {};

  var escapeHtml = function(str){
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  };

  window.YSS.SubtitleOverlay = {
    _el: null,
    _currentText: '',
    _currentLang: '',
    _timeout: null,
    _visible: false,

    init: function(){
      if(this._el) return;
      var el = document.createElement('div');
      el.id = 'yss-dub-overlay';
      el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'z-index:999999;color:#fff;font-family:Arial,sans-serif;font-size:24px;' +
        'text-align:center;text-shadow:2px 2px 4px rgba(0,0,0,0.8);' +
        'background:rgba(0,0,0,0.5);padding:8px 20px;border-radius:8px;' +
        'max-width:80%;line-height:1.4;transition:opacity 0.2s;opacity:0;' +
        'pointer-events:none;';
      document.body.appendChild(el);
      this._el = el;
    },

    show: function(text, lang, durationMs){
      this.init();
      this._currentText = text;
      this._currentLang = lang || 'es';
      if(this._timeout) clearTimeout(this._timeout);
      this._el.textContent = text;
      this._el.style.opacity = '1';
      this._visible = true;
      this._timeout = setTimeout(this.hide.bind(this), durationMs || 4000);
    },

    showBilingual: function(original, translated, durationMs){
      this.init();
      var el = this._el;
      if(el) {
        el.innerHTML = '<div style="color:#aaa;font-size:16px;margin-bottom:4px;line-height:1.2">' + escapeHtml(original) + '</div>' +
                       '<div style="color:#fff;font-size:24px;line-height:1.4">' + escapeHtml(translated) + '</div>';
        el.style.background = 'rgba(0,0,0,0.75)';
      }
      this._visible = true;
      if(this._timeout) clearTimeout(this._timeout);
      this._timeout = setTimeout(this.hide.bind(this), durationMs || 4000);
    },

    update: function(text, lang){
      this.init();
      this._currentText = text;
      this._currentLang = lang || 'es';
      if(this._timeout) clearTimeout(this._timeout);
      this._el.textContent = text;
      this._el.style.opacity = '1';
      this._visible = true;
    },

    hide: function(){
      if(!this._el) return;
      this._el.style.opacity = '0';
      this._visible = false;
      this._currentText = '';
    },

    clear: function(){
      if(this._timeout) clearTimeout(this._timeout);
      this.hide();
    },

    destroy: function(){
      this.clear();
      if(this._el && this._el.parentNode){
        this._el.parentNode.removeChild(this._el);
      }
      this._el = null;
    }
  };
})();
