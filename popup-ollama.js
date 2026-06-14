document.addEventListener('DOMContentLoaded', function() {
  var cb = document.getElementById('ollama_enabled');
  var modelInput = document.getElementById('ollama_model');
  var apiKeyInput = document.getElementById('ollama_api_key');
  var statusEl = document.getElementById('ollama_status');
  var testBtn = document.getElementById('btn_test_ollama');
  var resultEl = document.getElementById('ollama_test_result');
  var origSpan = document.getElementById('ollama_original_text');
  var imprSpan = document.getElementById('ollama_improved_text');
  if (!cb || !modelInput || !apiKeyInput || !statusEl || !testBtn || !resultEl || !origSpan || !imprSpan) return;

  function updateStatus(message, type) {
    var baseText = 'Ollama Translation: ' + (cb.checked ? 'ON' : 'OFF');
    statusEl.textContent = baseText + (message ? ' — ' + message : '');
    statusEl.classList.remove('ollama-status--success', 'ollama-status--error');
    if (type === 'success') statusEl.classList.add('ollama-status--success');
    else if (type === 'error') statusEl.classList.add('ollama-status--error');
  }

  function loadSettings() {
    chrome.storage.sync.get(['ollama_enabled', 'ollama_model', 'ollama_api_key'], function(d) {
      if (d.ollama_enabled != null) cb.checked = !!d.ollama_enabled;
      if (d.ollama_model) modelInput.value = d.ollama_model;
      else modelInput.value = 'gemma3:4b';
      if (d.ollama_api_key) apiKeyInput.value = d.ollama_api_key;
      updateStatus();
    });
  }

  cb.addEventListener('change', function() {
    var val = cb.checked;
    chrome.storage.sync.set({ ollama_enabled: val });
    updateStatus();
  });

  modelInput.addEventListener('change', function() {
    var val = modelInput.value.trim();
    if (val) chrome.storage.sync.set({ ollama_model: val });
  });

  apiKeyInput.addEventListener('change', function() {
    var val = apiKeyInput.value.trim();
    if (val) chrome.storage.sync.set({ ollama_api_key: val });
    else chrome.storage.sync.remove('ollama_api_key');
  });

  testBtn.addEventListener('click', function() {
    var text = 'The rabbits would definitely get him removed.';
    var model = modelInput.value.trim() || 'gemma3:4b';
    origSpan.textContent = text;
    imprSpan.textContent = 'Processing...';
    resultEl.classList.remove('d-none');
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    updateStatus('Running Ollama test...', '');

    var prompt = 'You are an expert subtitle translator.\n\nRewrite the following subtitle into natural Latin American Spanish.\n\nPreserve meaning.\n\nUse context if available.\n\nFix literal translations.\n\nIf the sentence implies killing, death, execution, removal, hunting, extermination, or elimination, translate the intended meaning naturally according to context.\n\nDo not explain.\n\nReturn only the improved subtitle.\n\nSubtitle:\n' + text;

    chrome.runtime.sendMessage({
      action: 'ollama_generate',
      apiKey: apiKeyInput.value.trim() || undefined,
      payload: { model: model, prompt: prompt, stream: false, options: { temperature: 0.3 } }
    }, function(response) {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Ollama';
      if (chrome.runtime.lastError) {
        var errMsg = 'Error: ' + chrome.runtime.lastError.message;
        imprSpan.textContent = errMsg;
        updateStatus('Last test failed', 'error');
      } else if (response && response.ok && response.response) {
        imprSpan.textContent = response.response;
        updateStatus('Last test OK', 'success');
      } else {
        var errorText = response ? 'Error: ' + response.error : 'No response from Ollama. Is it running?';
        imprSpan.textContent = errorText;
        updateStatus('Last test failed', 'error');
      }
    });
  });

  loadSettings();
});
