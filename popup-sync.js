(function(){
  var slider = document.getElementById('sync_offset');
  var display = document.getElementById('sync_offset_value');
  if (!slider || !display) return;

  function loadOffset() {
    chrome.storage.sync.get('options', function(result) {
      var opts = result.options || {};
      var val = opts.sync_offset_ms || 0;
      slider.value = val;
      display.textContent = val + 'ms';
    });
  }

  function saveOffset(val) {
    chrome.storage.sync.get('options', function(result) {
      var opts = result.options || {};
      opts.sync_offset_ms = parseInt(val) || 0;
      chrome.storage.sync.set({options: opts});
    });
  }

  slider.addEventListener('input', function() {
    var val = parseInt(this.value) || 0;
    display.textContent = val + 'ms';
    saveOffset(val);
  });

  loadOffset();
})();
