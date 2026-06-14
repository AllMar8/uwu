document.addEventListener('DOMContentLoaded', () => {
  const namesList = document.getElementById('names_list');
  const newNameInput = document.getElementById('new_name_input');
  const newPronInput = document.getElementById('new_name_pronunciation');
  const btnAdd = document.getElementById('btn_add_name');
  const fixesList = document.getElementById('translation_fixes_list');
  const newBadInput = document.getElementById('new_bad_text');
  const newFixInput = document.getElementById('new_fix_text');
  const btnAddFix = document.getElementById('btn_add_fix');

  let currentNames = {};
  let currentFixes = {};

  function renderNames() {
    namesList.innerHTML = '';
    for (const [name, pron] of Object.entries(currentNames)) {
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML = `<span class="name-text">${name}</span>` +
        (pron ? `<span class="name-pron">→ ${pron}</span>` : '') +
        `<button class="btn-remove" data-name="${name}">&times;</button>`;
      namesList.appendChild(row);
    }
    namesList.querySelectorAll('.btn-remove').forEach(btn => {
      btn.onclick = () => {
        delete currentNames[btn.dataset.name];
        saveNames();
        renderNames();
      };
    });
  }

  function renderFixes() {
    fixesList.innerHTML = '';
    for (const [bad, fix] of Object.entries(currentFixes)) {
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML = `<span class="name-text">"${bad}"</span><span class="name-pron">→ "${fix}"</span>` +
        `<button class="btn-remove" data-bad="${bad}">&times;</button>`;
      fixesList.appendChild(row);
    }
    fixesList.querySelectorAll('.btn-remove').forEach(btn => {
      btn.onclick = () => {
        delete currentFixes[btn.dataset.bad];
        saveFixes();
        renderFixes();
      };
    });
  }

  function saveNames() {
    chrome.storage.sync.set({ yss_custom_names: currentNames });
  }

  function saveFixes() {
    chrome.storage.sync.set({ yss_translation_fixes: currentFixes });
  }

  chrome.storage.sync.get({ yss_custom_names: {}, yss_translation_fixes: {} }, data => {
    currentNames = data.yss_custom_names;
    currentFixes = data.yss_translation_fixes;
    renderNames();
    renderFixes();
  });

  btnAdd.addEventListener('click', () => {
    const name = newNameInput.value.trim();
    if (!name) return;
    const pron = newPronInput.value.trim();
    currentNames[name] = pron || '';
    newNameInput.value = '';
    newPronInput.value = '';
    saveNames();
    renderNames();
  });

  function addNameFromInputs() {
    btnAdd.click();
  }

  function addFixFromInputs() {
    btnAddFix.click();
  }

  newNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addNameFromInputs();
  });

  newPronInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addNameFromInputs();
  });

  btnAddFix.addEventListener('click', () => {
    const bad = newBadInput.value.trim();
    const fix = newFixInput.value.trim();
    if (!bad || !fix) return;
    currentFixes[bad] = fix;
    newBadInput.value = '';
    newFixInput.value = '';
    saveFixes();
    renderFixes();
  });

  newBadInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addFixFromInputs();
  });

  newFixInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addFixFromInputs();
  });
});
