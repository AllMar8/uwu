(function() {
  // Populate translate_lang with full language list after the bundle runs
  var translateSelect = document.getElementById('translate_lang');
  if (!translateSelect) return;

  var translateLangs = {
    "af":"AF - Afrikaans - Afrikaans","am":"AM - አማርኛ - Amharic","ar":"AR - العربية - Arabic",
    "az":"AZ - Azərbaycan dili - Azerbaijani","be":"BE - Беларуская - Belarusian","bg":"BG - Български - Bulgarian",
    "bn":"BN - বাংলা - Bengali","bs":"BS - Bosanski - Bosnian","ca":"CA - Català - Catalan",
    "ceb":"CEB - Cebuano - Cebuano","co":"CO - Corsu - Corsican","cs":"CS - Čeština - Czech",
    "cy":"CY - Cymraeg - Welsh","da":"DA - Dansk - Danish","de":"DE - Deutsch - German",
    "el":"EL - Ελληνικά - Greek","en":"EN - English - English","eo":"EO - Esperanto - Esperanto",
    "es":"ES - Español - Spanish","et":"ET - Eesti - Estonian","eu":"EU - Euskara - Basque",
    "fa":"FA - فارسی - Persian","fi":"FI - Suomi - Finnish","fr":"FR - Français - French",
    "fy":"FY - Frysk - Frisian","ga":"GA - Gaeilge - Irish","gd":"GD - Gàidhlig - Scottish Gaelic",
    "gl":"GL - Galego - Galician","gu":"GU - ગુજરાતી - Gujarati","ha":"HA - Hausa - Hausa",
    "haw":"HAW - ʻŌlelo Hawaiʻi - Hawaiian","hi":"HI - हिन्दी - Hindi","hmn":"HMN - Hmoob - Hmong",
    "hr":"HR - Hrvatski - Croatian","ht":"HT - Kreyòl Ayisyen - Haitian Creole","hu":"HU - Magyar - Hungarian",
    "hy":"HY - Հայերեն - Armenian","id":"ID - Bahasa Indonesia - Indonesian","ig":"IG - Igbo - Igbo",
    "is":"IS - Íslenska - Icelandic","it":"IT - Italiano - Italian","iw":"IW - עברית - Hebrew",
    "ja":"JA - 日本語 - Japanese","jw":"JW - Basa Jawa - Javanese","ka":"KA - ქართული - Georgian",
    "kk":"KK - Қазақ тілі - Kazakh","km":"KM - ភាសាខ្មែរ - Khmer","kn":"KN - ಕನ್ನಡ - Kannada",
    "ko":"KO - 한국어 - Korean","ku":"KU - Kurdî - Kurdish","ky":"KY - Кыргызча - Kyrgyz",
    "la":"LA - Latina - Latin","lb":"LB - Lëtzebuergesch - Luxembourgish","lo":"LO - ລາວ - Lao",
    "lt":"LT - Lietuvių - Lithuanian","lv":"LV - Latviešu - Latvian","mg":"MG - Malagasy - Malagasy",
    "mi":"MI - Māori - Maori","mk":"MK - Македонски - Macedonian","ml":"ML - മലയാളം - Malayalam",
    "mn":"MN - Монгол - Mongolian","mr":"MR - मराठी - Marathi","ms":"MS - Bahasa Melayu - Malay",
    "mt":"MT - Malti - Maltese","my":"MY - မြန်မာ - Myanmar (Burmese)","ne":"NE - नेपाली - Nepali",
    "nl":"NL - Nederlands - Dutch","no":"NO - Norsk - Norwegian","ny":"NY - Chichewa - Chichewa",
    "or":"OR - ଓଡ଼ିଆ - Odia","pa":"PA - ਪੰਜਾਬੀ - Punjabi","pl":"PL - Polski - Polish",
    "ps":"PS - پښتو - Pashto","pt":"PT - Português - Portuguese","ro":"RO - Română - Romanian",
    "ru":"RU - Русский - Russian","rw":"RW - Kinyarwanda - Kinyarwanda","sd":"SD - سنڌي - Sindhi",
    "si":"SI - සිංහල - Sinhala","sk":"SK - Slovenčina - Slovak","sl":"SL - Slovenščina - Slovenian",
    "sm":"SM - Gagana Samoa - Samoan","sn":"SN - chiShona - Shona","so":"SO - Soomaali - Somali",
    "sq":"SQ - Shqip - Albanian","sr":"SR - Српски - Serbian","st":"ST - Sesotho - Sesotho",
    "su":"SU - Basa Sunda - Sundanese","sv":"SV - Svenska - Swedish","sw":"SW - Kiswahili - Swahili",
    "ta":"TA - தமிழ் - Tamil","te":"TE - తెలుగు - Telugu","tg":"TG - Тоҷикӣ - Tajik",
    "th":"TH - ไทย - Thai","tk":"TK - Türkmen - Turkmen","tl":"TL - Filipino - Filipino",
    "tr":"TR - Türkçe - Turkish","tt":"TT - Татар - Tatar","ug":"UG - ئۇيغۇرچە - Uyghur",
    "uk":"UK - Українська - Ukrainian","ur":"UR - اردو - Urdu","uz":"UZ - Oʻzbek - Uzbek",
    "vi":"VI - Tiếng Việt - Vietnamese","xh":"XH - isiXhosa - Xhosa","yi":"YI - ייִדיש - Yiddish",
    "yo":"YO - Yorùbá - Yoruba","zh":"ZH - 中文 - Chinese","zu":"ZU - isiZulu - Zulu"
  };

  function populateFullList() {
    var codes = Object.keys(translateLangs).sort(function(a, b) {
      return translateLangs[a].localeCompare(translateLangs[b]);
    });
    codes.forEach(function(code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = translateLangs[code];
      translateSelect.appendChild(opt);
    });
  }

  function getDefaultLang() {
    return navigator.language ? navigator.language.split('-')[0] : 'en';
  }

  var busy = false;
  var fixObserver = new MutationObserver(function() {
    if (busy) return;
    busy = true;
    Promise.resolve().then(function() {
      busy = false;
      var curLen = translateSelect.options.length;
      if (curLen <= 2) {
        var curVal = translateSelect.value;
        while (translateSelect.firstChild) {
          translateSelect.removeChild(translateSelect.firstChild);
        }
        populateFullList();
        translateSelect.value = translateLangs[curVal] ? curVal : getDefaultLang();
      }
      fixObserver.disconnect();
    });
  });
  fixObserver.observe(translateSelect, { childList: true });

  // Sync voice by NAME (not index) so popup and YSS button stay in sync
  var voiceSelect = document.getElementById('speech_voice');
  if(!voiceSelect) return;

  function saveVoiceName(name){
    if(!name) return;
    try{ chrome.storage.sync.set({yss_voice_name: name}); }catch(e){}
    try{ chrome.storage.local.set({yss_voice_name: name}); }catch(e){}
  }

  function setVoiceByName(name){
    if(!name || !window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    for(var i=0;i<voices.length;i++){
      if(voices[i].name === name){
        var value = i.toString();
        if(Array.prototype.some.call(voiceSelect.options, function(opt){ return opt.value === value; } )){
          voiceSelect.value = value;
        } else if(voiceSelect.options[i]) {
          voiceSelect.selectedIndex = i;
        }
        voiceSelect.dispatchEvent(new Event('change'));
        return;
      }
    }
  }

  function saveVoiceToYSSformat(idx){
    // YSS bundle reads from chrome.storage.sync key "options" with .speech_voice
    try {
      chrome.storage.sync.get("options", function(d){
        var opts = d && d.options ? JSON.parse(JSON.stringify(d.options)) : {};
        opts.speech_voice = idx;
        chrome.storage.sync.set({options: opts});
      });
    }catch(e){}
  }

  voiceSelect.addEventListener('change', function(){
    var idx = parseInt(voiceSelect.value);
    if(isNaN(idx)) idx = voiceSelect.selectedIndex;
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if(voices && voices[idx]){
      var vname = voices[idx].name;
      saveVoiceName(vname);
      try{ chrome.storage.sync.set({speech_voice: idx}); }catch(e){}
      try{ chrome.storage.local.set({speech_voice: idx}); }catch(e){}
      saveVoiceToYSSformat(idx);
      // Send voice directly to YouTube tabs
      try {
        chrome.tabs.query({url: 'https://www.youtube.com/*'}, function(tabs){
          for(var i=0;i<tabs.length;i++){
            chrome.tabs.sendMessage(tabs[i].id, {action:'setVoice', name:vname}, function(){ if(chrome.runtime.lastError){} });
          }
        });
      }catch(e){}  // sync error only, async handled by callback
    }
  });

  // When dropdown populated, set voice by saved name & save current name
  var voiceObserver = new MutationObserver(function(){
    if(voiceSelect.options.length > 1 && window.speechSynthesis){
      try {
        chrome.storage.sync.get(['yss_voice_name','options'], function(d){
          if(d && d.yss_voice_name) setVoiceByName(d.yss_voice_name);
          else if(d && d.options && d.options.speech_voice !== undefined){
            var voices = window.speechSynthesis.getVoices();
            var oidx = parseInt(d.options.speech_voice);
            if(voices && voices[oidx]) setVoiceByName(voices[oidx].name);
          }
        });
      }catch(e){}
      var idx = parseInt(voiceSelect.value);
      if(isNaN(idx)) idx = voiceSelect.selectedIndex;
      var voices = window.speechSynthesis.getVoices();
      if(voices && voices[idx]) saveVoiceName(voices[idx].name);
      voiceObserver.disconnect();
    }
  });
  voiceObserver.observe(voiceSelect, { childList: true, subtree: true });
})();
