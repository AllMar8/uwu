(function(){
  try{
    if(!window.speechSynthesis) return;
    if(window.YSS && window.YSS._dubbingInited) return;
    function notify(){
      try{
        window.__YSS_VOICES_READY__ = true;
        window.__YSS_VOICES__ = window.speechSynthesis.getVoices();
        window.dispatchEvent(new CustomEvent('YSSVoicesReady',{detail:{voices:window.__YSS_VOICES__}}));
      }catch(e){}
    }
    // If voices already present
    const v = window.speechSynthesis.getVoices();
    if(v && v.length){ notify(); }
    // Listen for change
    window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', notify);
    // Provide helper
    window.YSS = window.YSS || {};
    window.YSS.getVoicesAsync = function(timeoutMs=3000){
      return new Promise((resolve)=>{
        if(window.__YSS_VOICES__ && window.__YSS_VOICES__.length) return resolve(window.__YSS_VOICES__);
        const on = (e)=>{ window.removeEventListener('YSSVoicesReady', on); resolve(e.detail.voices); };
        window.addEventListener('YSSVoicesReady', on);
        setTimeout(()=>{ window.removeEventListener('YSSVoicesReady', on); resolve(window.speechSynthesis.getVoices()||[]); }, timeoutMs);
      });
    }
  }catch(e){}
})();

/* Enhanced TTS wrapper: improves voice selection and segments long texts for more natural prosody */
(function(){
  try{
    if(!window.speechSynthesis) return;
    if(window.YSS && window.YSS._dubbingInited) return;
    window.YSS = window.YSS || {};
    // default options
    const defaultOptions = {
      enabled: true,
      preferNeural: true,
      preferredVoices: [], // array of voice.name strings
      rate: 1.05,
      pitch: 1.0,
      volume: 1.0,
      splitLongText: true,
      splitMaxLen: 220,
      pauseBetweenSegmentsMs: 60
    };
    window.YSS._options = Object.assign({}, defaultOptions, window.YSS._options || {});
    window.YSS.setOptions = function(opts){ window.YSS._options = Object.assign({}, window.YSS._options, opts); }
    window.YSS.getOptions = function(){ return Object.assign({}, window.YSS._options); }

    // Custom names list (user can add names here)
    window.YSS.customNames = window.YSS.customNames || [];

    // Build a lowercase lookup map for case-insensitive matching
    var KNOWN_NAMES_LOWER = new Map();
    function buildNameLookup(){
      KNOWN_NAMES_LOWER.clear();
      KNOWN_NAMES.forEach(function(n){
        KNOWN_NAMES_LOWER.set(n.toLowerCase(), n);
      });
      window.YSS.customNames.forEach(function(n){
        KNOWN_NAMES_LOWER.set(n.toLowerCase(), n);
      });
    }
    buildNameLookup();

    // Add a name to the preservation list
    window.YSS.addName = function(name){
      if(name && typeof name === 'string'){
        var trimmed = name.trim();
        if(trimmed && !KNOWN_NAMES.has(trimmed)){
          KNOWN_NAMES.add(trimmed);
          KNOWN_NAMES_LOWER.set(trimmed.toLowerCase(), trimmed);
          window.YSS.customNames.push(trimmed);
          try {
            if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
              chrome.storage.sync.set({yss_custom_names: window.YSS.customNames});
            }
          } catch(e) {}
        }
      }
    };

    // Add multiple names at once
    window.YSS.addNames = function(names){
      if(Array.isArray(names)){
        names.forEach(function(n){ window.YSS.addName(n); });
      }
    };

    // Remove a custom name
    window.YSS.removeName = function(name){
      var idx = window.YSS.customNames.indexOf(name);
      if(idx !== -1){
        window.YSS.customNames.splice(idx, 1);
      }
      KNOWN_NAMES.delete(name);
      KNOWN_NAMES_LOWER.delete(name.toLowerCase());
      try {
        if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
          chrome.storage.sync.set({yss_custom_names: window.YSS.customNames});
        }
      } catch(e) {}
    };

    // Get all custom names
    window.YSS.getNames = function(){
      return window.YSS.customNames.slice();
    };

    // Check if a name is in the list (case-insensitive)
    window.YSS.hasName = function(name){
      return KNOWN_NAMES.has(name) || KNOWN_NAMES_LOWER.has(name.toLowerCase());
    };

    // Clear all custom names (keeps built-in names)
    window.YSS.clearCustomNames = function(){
      window.YSS.customNames = [];
      buildNameLookup();
      try {
        if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
          chrome.storage.sync.set({yss_custom_names: []});
        }
      } catch(e) {}
    };

    // Export names as JSON string
    window.YSS.exportNames = function(){
      return JSON.stringify(window.YSS.customNames);
    };

    // Import names from JSON string
    window.YSS.importNames = function(json){
      try {
        var names = JSON.parse(json);
        if(Array.isArray(names)){
          names.forEach(function(n){ window.YSS.addName(n); });
        }
      } catch(e) {}
    };

    // Debug: test name detection on text
    window.YSS.debugNames = function(text){
      var result = preserveNames(text);
      console.log('Original:', text);
      console.log('Processed:', result);
      console.log('Names in list:', Array.from(KNOWN_NAMES).slice(0, 20));
      console.log('Custom names:', window.YSS.customNames);
      return result;
    };

    // Load custom names from storage if available
    try {
      if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
        chrome.storage.sync.get('yss_custom_names', function(data){
          if(data && data.yss_custom_names && Array.isArray(data.yss_custom_names)){
            data.yss_custom_names.forEach(function(n){
              KNOWN_NAMES.add(n);
              KNOWN_NAMES_LOWER.set(n.toLowerCase(), n);
            });
            window.YSS.customNames = data.yss_custom_names;
          }
        });
      }
    } catch(e) {}

    // --- Phonetic map: name -> spelling so TTS pronounces it right ---
    window.YSS.phoneticMap = {
      'Da Shu': 'Dashú',
      'Hanfong': 'Hanfong',
      'Xiao Ming': 'Shiao Ming',
      'Da Wei': 'Da Wéi',
      'Da Peng': 'Da Péng',
      'Da Yong': 'Da Yong',
      'Da Jun': 'Da Chun',
      'Zhang': 'Chang',
      'Zhao': 'Chao',
      'Chen': 'Chen',
      'Wang': 'Guang',
      'Liu': 'Lio',
      'Yang': 'Yang',
      'Huang': 'Guang',
      'Zhu': 'Chu',
      'Lin': 'Lin',
      'Gao': 'Gao',
      'Luo': 'Luo',
      'Liang': 'Liang',
      'Xie': 'Shié',
      'Song': 'Song',
      'Tang': 'Tang',
      'Xiao': 'Shiao',
      'Cai': 'Tsai',
      'Pan': 'Pan',
      'Xia': 'Shia',
      'Feng': 'Feng',
      'Wei': 'Wéi',
      'Jiang': 'Chiang',
      'Shen': 'Shen',
      'Sun': 'Sun',
      'Qian': 'Chian',
      'Zhou': 'Chou',
      'Zheng': 'Cheng',
      'Shi': 'Shi',
      'Xu': 'Shu',
      'Guo': 'Guo',
      'Ma': 'Ma',
      'Fang': 'Fang',
      'Lei': 'Léi',
      'Xin': 'Sin',
      'Ting': 'Ting',
      'Da': 'Da',
      'Li': 'Li',
      'Wu': 'Wu',
      'Han': 'Han'
    };

    window.YSS.addPhonetic = function(name, phonetic){
      window.YSS.phoneticMap[name] = phonetic;
    };

    window.YSS.getPhoneticMap = function(){
      return Object.assign({}, window.YSS.phoneticMap);
    };

    function applyPhonetics(text){
      if(!text) return text;
      var result = text;
      var keys = Object.keys(window.YSS.phoneticMap).sort(function(a,b){ return b.length - a.length; });
      for(var i = 0; i < keys.length; i++){
        var name = keys[i];
        var phonetic = window.YSS.phoneticMap[name];
        var regex = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        result = result.replace(regex, phonetic);
      }
      return result;
    }

    // Save/load phonetic map from storage
    try {
      if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
        chrome.storage.sync.get('yss_phonetic_map', function(data){
          if(data && data.yss_phonetic_map && typeof data.yss_phonetic_map === 'object'){
            Object.assign(window.YSS.phoneticMap, data.yss_phonetic_map);
          }
        });
      }
    } catch(e) {}

    var origAddPhonetic = window.YSS.addPhonetic;
    window.YSS.addPhonetic = function(name, phonetic){
      window.YSS.phoneticMap[name] = phonetic;
      try {
        if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
          chrome.storage.sync.set({yss_phonetic_map: window.YSS.phoneticMap});
        }
      } catch(e) {}
    };

    // --- Translation fix map: bad translation -> correct text ---
    window.YSS.translationFixes = {
      'el zapato': 'Da Shu',
      'el calzado': 'Da Shu',
      'la zapato': 'Da Shu',
      'el shoe': 'Da Shu',
      'el pie': 'Da Shu',
      'zapato': 'Da Shu',
      'calzado': 'Da Shu',
      'terreno de juego': 'Tono',
      'discapacitado': 'Desactivado',
      'ahorrar': 'Guardar'
    };

    window.YSS.addTranslationFix = function(bad, correct){
      window.YSS.translationFixes[bad.toLowerCase()] = correct;
      try {
        if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
          chrome.storage.sync.set({yss_translation_fixes: window.YSS.translationFixes});
        }
      } catch(e) {}
    };

    window.YSS.removeTranslationFix = function(bad){
      delete window.YSS.translationFixes[bad.toLowerCase()];
      try {
        if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
          chrome.storage.sync.set({yss_translation_fixes: window.YSS.translationFixes});
        }
      } catch(e) {}
    };

    window.YSS.getTranslationFixes = function(){
      return Object.assign({}, window.YSS.translationFixes);
    };

    // Debug mode for TTS
    window.YSS._debugTTS = false;
    window.YSS.enableDebug = function(){ window.YSS._debugTTS = true; console.log('[YSS] Debug mode enabled. Subtitles will be logged.'); };
    window.YSS.disableDebug = function(){ window.YSS._debugTTS = false; };

    // Load translation fixes from storage
    try {
      if(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync){
        chrome.storage.sync.get('yss_translation_fixes', function(data){
          if(data && data.yss_translation_fixes && typeof data.yss_translation_fixes === 'object'){
            Object.assign(window.YSS.translationFixes, data.yss_translation_fixes);
          }
        });
      }
    } catch(e) {}

    function applyTranslationFixes(text){
      if(!text) return text;
      var result = text;
      var keys = Object.keys(window.YSS.translationFixes).sort(function(a,b){ return b.length - a.length; });
      for(var i = 0; i < keys.length; i++){
        var bad = keys[i];
        var correct = window.YSS.translationFixes[bad];
        var regex = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        result = result.replace(regex, correct);
      }
      return result;
    }

    // Punctuation pause rules (ms)
    const PAUSE_STRONG = 300;   // . ? !
    const PAUSE_MEDIUM = 150;   // , ; :
    const PAUSE_WEAK   = 100;   // — - ...
    const PAUSE_GAP    = 60;    // normal segment gap

    // --- Name preservation system ---
    const KNOWN_NAMES = new Set([
      // English
      'John','Mary','James','Patricia','Robert','Jennifer','Michael','Linda',
      'William','Elizabeth','David','Barbara','Richard','Susan','Joseph','Jessica',
      'Thomas','Sarah','Charles','Karen','Christopher','Lisa','Daniel','Nancy',
      'Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley',
      'Steven','Dorothy','Paul','Kimberly','Andrew','Emily','Joshua','Donna',
      'Kenneth','Michelle','Kevin','Carol','Brian','Amanda','George','Melissa',
      'Timothy','Deborah','Ronald','Stephanie','Edward','Rebecca','Jason','Sharon',
      'Jeffrey','Laura','Ryan','Cynthia','Jacob','Kathleen','Gary','Amy',
      'Nicholas','Angela','Eric','Shirley','Jonathan','Anna','Stephen','Brenda',
      'Larry','Pamela','Justin','Emma','Scott','Nicole','Brandon','Helen',
      'Benjamin','Samantha','Samuel','Katherine','Raymond','Christine','Gregory','Debra',
      'Frank','Rachel','Alexander','Carolyn','Patrick','Janet','Jack','Catherine',
      'Dennis','Maria','Jerry','Heather','Tyler','Diane','Aaron','Ruth',
      'Jose','Julie','Adam','Olivia','Nathan','Joyce','Henry','Virginia',
      // Spanish
      'Juan','María','Carlos','Ana','Pedro','Rosa','Luis','Carmen',
      'Miguel','Teresa','Antonio','Isabel','Francisco','Pilar','Javier','Laura',
      'Manuel','Cristina','Alejandro','María','Diego','Lucía','Pablo','Sara',
      'Sergio','Paula','Andrés','Elena','Daniel','Sofía','Jorge','Daniela',
      'Rafael','Almudena','Fernando','Raquel','Roberto','Marta','Enrique','Beatriz',
      // Portuguese
      'João','Maria','José','Ana','Pedro','Marta','Francisco','Sofia',
      'Carlos','Mariana','Paulo','Teresa','Miguel','Carolina','Ricardo','Inês',
      // French
      'Jean','Marie','Pierre','Sophie','Jacques','Isabelle','Philippe','Catherine',
      'Michel','Nathalie','François','Valérie','Nicole','Sylvie','Alain','Martine',
      // German
      'Hans','Uwe','Jürgen','Wolfgang','Thomas','Michael','Peter','Andrea',
      'Stefan','Claudia','Thomas','Monika','Martin','Brigitte','Werner','Susanne',
      // Italian
      'Marco','Laura','Giovanni','Anna','Giuseppe','Maria','Antonio','Giulia',
      'Francesco','Sara','Paolo','Francesca','Roberto','Elena','Alessandro','Valentina',
      // Japanese
      'Yuki','Takeshi','Akira','Sakura','Hiroshi','Yui','Kenji','Hana',
      'Takashi','Mei','Shota','Rin','Ryo','Mio','Haruto','Aoi',
      // Korean
      'Min-jun','Seo-yeon','Ji-hoon','Eun-bi','Do-yoon','Ha-na','Jun-seo','Da-hee',
      // Chinese
      'Wei','Mei','Li','Xiao','Chen','Jing','Zhang','Yong',
      'Liu','Fang','Wang','Lei','Huang','Ting','Zhao','Xin',
      'Da Shu','Xiao Ming','Xiao Hong','Da Wei','Xiao Hua','Da Chao',
      'Ming','Hong','Hua','Chao','Fang','Lei','Xin','Ting',
      'Da Shu','Da Ming','Da Qiang','Da Peng','Da Yong','Da Jun',
      'Xiao Mei','Xiao Li','Xiao Zhang','Xiao Wang','Xiao Liu',
      'Lao Zhang','Lao Wang','Lao Li','Lao Liu','Lao Chen',
      'Zhang Wei','Wang Wei','Li Wei','Liu Wei','Chen Wei',
      'Zhang Lei','Wang Lei','Li Lei','Liu Lei','Chen Lei',
      'Zhang Jun','Wang Jun','Li Jun','Liu Jun','Chen Jun',
      'Zhang Ming','Wang Ming','Li Ming','Liu Ming','Chen Ming',
      'Zhang Peng','Wang Peng','Li Peng','Liu Peng','Chen Peng',
      // Historical Chinese
      'Hanfong','Han','Fong','Da Shu','Da Ming','Da Qiang',
      'Zhao','Qian','Sun','Li','Zhou','Wu','Zheng','Wang',
      'Feng','Chen','Chu','Wei','Jiang','Shen','Han','Yang',
      'Huang','Zhu','Lin','He','Gao','Luo','Zheng','Liang',
      'Xie','Song','Tang','Xiao','Cai','Pan','Xia','Yu',
      // Compound names (first + last)
      'Jean-Pierre','Jean-Luc','Jean-Michel','Marie-Claire','Marie-Anne',
      'Anna-Marie','Mary-Jane','Bethany','Katherine','Elizabeth',
      // Common nicknames
      'Alex','Sam','Chris','Pat','Jordan','Taylor','Casey','Morgan',
      'Jamie','Robin','Drew','Quinn','Skyler','Dakota','Reese','Peyton'
    ]);

    // Detect if a word looks like a person name
    function looksLikeName(word, prevWord, nextWord, posInSentence){
      if(!word || word.length < 2) return false;
      var lower = word.toLowerCase();
      var clean = word.replace(/[.,!?;:'"()\[\]{}]/g, '');
      if(clean.length < 2) return false;

      // Common words to skip (expandable)
      var commonWords = new Set([
        'the','and','but','for','are','not','you','all','can','had','her','was','one','our','out',
        'has','how','its','may','new','now','old','see','way','who','did','get','let','say','she',
        'too','use','que','por','con','una','los','las','del','como','más','pero','sus','le','ya',
        'este','ha','si','por','sin','sobre','ser','tiene','todo','esta','entre','cuando','muy',
        'sin','han','eso','ni','el','la','lo','es','en','un','una','al','se','lo','me','te','nos',
        'os','mi','tu','su','nuestro','nuestra','este','esta','estos','estas','aquel','aquella',
        'yo','nosotros','vosotros','ellos','ellas','usted','ustedes','mío','tuyo','suyo',
        'this','that','these','those','here','there','where','when','what','which','who','whom',
        'why','how','each','every','both','few','more','most','other','some','such','than',
        'then','also','just','about','into','over','after','before','between','under','above',
        'if','or','because','as','until','while','of','at','by','to','from','with','in','on',
        'is','am','are','was','were','be','been','being','have','has','had','having','do','does',
        'did','doing','would','could','should','may','might','shall','will','can','need','dare',
        'ought','used','going','got','make','made','come','came','take','took','give','gave',
        'go','went','see','saw','know','knew','think','thought','say','said','tell','told',
        'want','like','look','use','find','found','give','given','call','called','try','tried',
        'ask','asked','need','feel','felt','become','became','leave','left','put','keep','kept',
        'let','begin','began','show','showed','hear','heard','play','played','run','ran','move',
        'moved','live','lived','believe','believed','hold','held','bring','brought','happen',
        'happened','write','wrote','provide','provided','sit','sat','stand','stood','lose','lost',
        'pay','paid','meet','met','include','included','continue','continued','set','learn',
        'learned','change','changed','lead','led','understand','understood','watch','watched',
        'follow','followed','stop','stopped','create','created','speak','spoke','read','read',
        'allow','allowed','add','added','spend','spent','grow','grew','open','opened','walk',
        'walked','win','won','offer','offered','remember','remembered','love','loved','consider',
        'considered','appear','appeared','buy','bought','wait','waited','serve','served','die',
        'died','send','sent','expect','expected','build','built','stay','stayed','fall','fell',
        'cut','reach','reached','kill','killed','remain','remained','suggest','suggested','raise',
        'raised','pass','passed','sell','sold','require','required','report','reported','decide',
        'decided','pull','pulled','develop','developed','eat','ate','plan','planned',
        'terreno','juego','playground','playing','field','cancha','campo','jugar','deporte',
        'hablar','decir','cosa','cosas','bien','malo','ahora','después','antes','siempre',
        'nunca','aquí','allí','entonces','mientras','durante','según','contra','hacia',
        'about','again','also','another','back','been','before','being','between','both',
        'came','come','could','does','down','each','even','every','first','found','from',
        'going','good','great','hand','have','head','help','here','high','home','house',
        'idea','just','keep','kind','know','last','left','less','let','life','like','line',
        'little','long','look','made','make','many','may','men','might','more','most','much',
        'must','name','need','next','only','open','over','part','place','point','right',
        'same','said','should','show','small','sound','still','take','tell','than','that',
        'them','then','there','these','they','thing','think','those','thought','three',
        'through','time','turn','under','upon','very','want','water','well','what','when',
        'where','which','while','will','with','word','work','world','would','year','your'
      ]);
      if(commonWords.has(lower)) return false;

      // Check if it's a title prefix
      var titles = new Set(['mr','mrs','ms','dr','prof','sr','sra','srta','dr','dra','ing','arq']);
      if(prevWord && titles.has(prevWord.replace(/[.:]/g,'').toLowerCase())) return true;

      // Capitalized and not at sentence start
      if(clean[0] === clean[0].toUpperCase() && clean[0] !== clean[0].toLowerCase()){
        if(posInSentence > 0) return true;
        // At sentence start but check if prev word ended with punctuation
        if(prevWord && /[.!?,;:]$/.test(prevWord)) return true;
      }

      // Check for common name patterns (e.g., "de la", "van", "von", "bin", "al")
      var namePrefixes = new Set(['de','van','von','bin','bin','al','el','ibn','da','di','del','della']);
      if(prevWord && namePrefixes.has(prevWord.toLowerCase())) return true;

      return false;
    }

    // Preserve names in translated text
    function preserveNames(text){
      if(!text) return text;
      var words = text.split(/(\s+)/);
      var result = [];
      var inSentence = 0;
      var i = 0;
      while(i < words.length){
        var w = words[i];
        if(/^\s+$/.test(w)){ result.push(w); i++; continue; }
        var clean = w.replace(/[.,!?;:'"()\[\]{}]/g, '');
        var cleanLower = clean.toLowerCase();

        // Check for compound name (e.g., "Da Shu", "Xiao Ming")
        var foundName = false;
        if(i + 2 < words.length){
          var next1 = words[i + 1] || '';
          var next2 = words[i + 2] || '';
          if(/^\s+$/.test(next1)){
            var cleanNext = next2.replace(/[.,!?;:'"()\[\]{}]/g, '');
            var compound = clean + ' ' + cleanNext;
            var compoundLower = compound.toLowerCase();
            if(KNOWN_NAMES_LOWER.has(compoundLower)){
              result.push(w + next1 + next2);
              i += 3;
              foundName = true;
            }
          }
        }

        if(!foundName){
          // Check single word name (case-insensitive)
          if(KNOWN_NAMES_LOWER.has(cleanLower)){
            result.push(w);
          }else if(looksLikeName(clean, words[i-1], words[i+1], inSentence)){
            result.push(w);
          }else{
            // NOT a name - keep the word as-is
            result.push(w);
          }
          if(/[.!?]$/.test(w)) inSentence = 0;
          else inSentence++;
          i++;
        }
      }
      return result.join('');
    }

    function normalizeTextForTTS(text, lang){
      if(!text) return text;
      var l = (lang || '').split('-')[0].toLowerCase();

      // Debug: log original text
      if(window.YSS._debugTTS){
        console.log('[YSS TTS Original]', text);
      }

      // Fix bad translations first (e.g., "el zapato" -> "Da Shu")
      text = applyTranslationFixes(text);

      // Debug: log after fixes
      if(window.YSS._debugTTS){
        console.log('[YSS TTS After Fixes]', text);
      }

      // Apply phonetic spelling so names pronounce correctly
      text = applyPhonetics(text);

      // Preserve person names before any processing
      text = preserveNames(text);

      // Spanish: remove inverted punctuation that confuses TTS
      if(l === 'es'){
        text = text.replace(/¿/g, '').replace(/¡/g, '');
      }

      // Normalize ellipsis
      text = text.replace(/\.{3,}/g, '\u2026');
      text = text.replace(/…{2,}/g, '\u2026');

      // Normalize dashes
      text = text.replace(/-{2,}/g, '\u2013');
      text = text.replace(/—{2,}/g, '\u2014');

      // Collapse multiple spaces
      text = text.replace(/\s{2,}/g, ' ').trim();

      return text;
    }

    function splitByPunctuation(text){
      if(!text) return [];
      var result = [];
      // Match: sentence-ending, commas, semicolons, colons, dashes, ellipsis
      var re = /([^.!?,;:\-\u2026]+[.!?,;:\-\u2026]*)/g;
      var m;
      while((m = re.exec(text)) !== null){
        var chunk = m[1].trim();
        if(chunk) result.push(chunk);
      }
      return result.length ? result : [text];
    }

    function splitText(text, maxLen){
      if(!text) return [];
      text = text.replace(/\s+/g,' ').trim();
      if(!text) return [];

      var rawChunks = splitByPunctuation(text);

      // Merge small chunks respecting maxLen
      var segments = [];
      var cur = '';
      for(var i = 0; i < rawChunks.length; i++){
        var chunk = rawChunks[i];
        if(!chunk) continue;
        if((cur + ' ' + chunk).trim().length <= maxLen){
          cur = (cur + ' ' + chunk).trim();
        }else{
          if(cur) segments.push(cur);
          if(chunk.length <= maxLen) cur = chunk;
          else{
            // hard split long chunk
            var start = 0;
            while(start < chunk.length){
              segments.push(chunk.slice(start, start + maxLen));
              start += maxLen;
            }
            cur = '';
          }
        }
      }
      if(cur) segments.push(cur);
      return segments;
    }

    function pauseMsForSegment(seg){
      var trimmed = seg.replace(/\s+$/, '');
      var last = trimmed.charAt(trimmed.length - 1);
      if(last === '.' || last === '!' || last === '?') return PAUSE_STRONG;
      if(last === ',' || last === ';' || last === ':') return PAUSE_MEDIUM;
      if(last === '\u2026' || last === '-') return PAUSE_WEAK;
      return PAUSE_GAP;
    }

    function findBestVoice(utterance){
      const voices = window.speechSynthesis.getVoices() || [];
      // If utterance already has a voice, use it
      if(utterance && utterance.voice) return utterance.voice;
      const opts = window.YSS._options;
      // try preferred voices
      for(const pref of opts.preferredVoices || []){
        const v = voices.find(x => x.name === pref);
        if(v) return v;
      }
      // match by lang
      const lang = (utterance && utterance.lang) || (navigator.language || 'en').split('-')[0];
      // prefer neural/wavenet voices if requested
      const neuralRe = /(neural|wavenet|waveNet|google|microsoft|azure)/i;
      if(opts.preferNeural){
        let v = voices.find(x => neuralRe.test(x.name) && (x.lang||'').startsWith(lang));
        if(v) return v;
        v = voices.find(x => neuralRe.test(x.name));
        if(v) return v;
      }
      // fallback to same language
      let v = voices.find(x => (x.lang||'').startsWith(lang));
      if(v) return v;
      // final fallback
      return voices[0] || null;
    }

    // Replace speak with an enhanced version that splits long texts and applies better voice selection
    if(!window.YSS._patchedSpeak){
      const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = function(utterance){
        try{
          if(!window.YSS._options.enabled || !(utterance instanceof SpeechSynthesisUtterance)){
            return originalSpeak(utterance);
          }
          const text = normalizeTextForTTS(utterance.text || '', utterance.lang);
          const segments = splitText(text, window.YSS._options.splitMaxLen);
          const opts = window.YSS._options;
          let i = 0;
          let cancelled = false;
          let prebuilt = null;

          const origOnStart = utterance.onstart;
          const origOnEnd = utterance.onend;
          const origOnError = utterance.onerror;

          function buildUtterance(idx){
            if(idx >= segments.length) return null;
            var segText = normalizeTextForTTS(segments[idx], utterance.lang);
            var u = new SpeechSynthesisUtterance(segText);
            u.lang = utterance.lang || u.lang;
            u.rate = utterance.rate || opts.rate;
            u.pitch = utterance.pitch || opts.pitch;
            u.volume = utterance.volume || opts.volume;
            const chosen = findBestVoice(utterance);
            if(chosen) u.voice = chosen;
            return u;
          }

          function prebuildNext(idx){
            prebuilt = buildUtterance(idx);
          }

          function speakNext(){
            if(cancelled) return;
            if(i >= segments.length){
              if(typeof origOnEnd === 'function') try{ origOnEnd(); }catch(e){}
              return;
            }
            var u = prebuilt;
            prebuilt = null;
            if(!u){
              u = buildUtterance(i);
            }
            prebuildNext(i + 1);
            u.onstart = function(e){
              if(i === 0 && typeof origOnStart === 'function'){
                try{ origOnStart(e); }catch(err){}
              }
            };
            u.onend = function(e){
              i++;
              if(i < segments.length){
                var nextPause = pauseMsForSegment(segments[i - 1] || '');
                setTimeout(speakNext, nextPause);
              }else{
                if(typeof origOnEnd === 'function'){
                  try{ origOnEnd(e); }catch(err){}
                }
              }
            };
            u.onerror = function(e){
              cancelled = true;
              if(typeof origOnError === 'function'){
                try{ origOnError(e); }catch(err){}
              }
            };
            originalSpeak(u);
          }
          // start chain
          speakNext();
        }catch(err){
          try{ originalSpeak(utterance); }catch(e){}
        }
      };
      window.YSS._patchedSpeak = true;
    }
  }catch(e){}
})();
