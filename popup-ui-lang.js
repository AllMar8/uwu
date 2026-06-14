(function(){
  try {
    document.addEventListener('DOMContentLoaded', function() {
      var selectUILang = document.getElementById('ui_lang');
      if (!selectUILang) return;

      var availableLanguages = [
        {code: 'af', name: 'Afrikaans'},
        {code: 'am', name: 'Amharic'},
        {code: 'ar', name: 'العربية'},
        {code: 'az', name: 'Azərbaycanca'},
        {code: 'be', name: 'Беларусь'},
        {code: 'bg', name: 'Български'},
        {code: 'bn', name: 'Bengali'},
        {code: 'bs', name: 'Bosanski'},
        {code: 'ca', name: 'Català'},
        {code: 'ceb', name: 'Cebuano'},
        {code: 'co', name: 'Corsican'},
        {code: 'cs', name: 'Čeština'},
        {code: 'cy', name: 'Cymraeg'},
        {code: 'da', name: 'Dansk'},
        {code: 'de', name: 'Deutsch'},
        {code: 'el', name: 'Ελληνικά'},
        {code: 'en', name: 'English'},
        {code: 'eo', name: 'Esperanto'},
        {code: 'es', name: 'Español'},
        {code: 'et', name: 'Eesti'},
        {code: 'eu', name: 'Euskara'},
        {code: 'fa', name: 'فارسی'},
        {code: 'fi', name: 'Suomi'},
        {code: 'fr', name: 'Français'},
        {code: 'fy', name: 'Frisian'},
        {code: 'ga', name: 'Gaeilge'},
        {code: 'gd', name: 'Gàidhlig'},
        {code: 'gl', name: 'Galego'},
        {code: 'gu', name: 'Gujarati'},
        {code: 'ha', name: 'Hausa'},
        {code: 'haw', name: 'Hawaiian'},
        {code: 'hi', name: 'हिन्दी'},
        {code: 'hmn', name: 'Hmong'},
        {code: 'hr', name: 'Hrvatski'},
        {code: 'ht', name: 'Kreyòl'},
        {code: 'hu', name: 'Magyar'},
        {code: 'hy', name: 'Հայերեն'},
        {code: 'id', name: 'Bahasa Indonesia'},
        {code: 'ig', name: 'Igbo'},
        {code: 'is', name: 'Íslenska'},
        {code: 'it', name: 'Italiano'},
        {code: 'iw', name: 'עברית'},
        {code: 'ja', name: '日本語'},
        {code: 'jw', name: 'Basa Jawa'},
        {code: 'ka', name: 'ქართული'},
        {code: 'kk', name: 'Қазақ'},
        {code: 'km', name: 'ខ្មែរ'},
        {code: 'kn', name: 'Kannada'},
        {code: 'ko', name: '한국어'},
        {code: 'ku', name: 'Kurdî'},
        {code: 'ky', name: 'Кыргызча'},
        {code: 'la', name: 'Latina'},
        {code: 'lb', name: 'Luxembourgish'},
        {code: 'lo', name: 'ລາວ'},
        {code: 'lt', name: 'Lietuvių'},
        {code: 'lv', name: 'Latviešu'},
        {code: 'mg', name: 'Malagasy'},
        {code: 'mi', name: 'Māori'},
        {code: 'mk', name: 'Македонски'},
        {code: 'ml', name: 'Malayalam'},
        {code: 'mn', name: 'Монгол'},
        {code: 'mr', name: 'Marathi'},
        {code: 'ms', name: 'Bahasa Melayu'},
        {code: 'mt', name: 'Malti'},
        {code: 'my', name: 'Myanmar'},
        {code: 'ne', name: 'Nepali'},
        {code: 'nl', name: 'Nederlands'},
        {code: 'no', name: 'Norsk'},
        {code: 'ny', name: 'Chichewa'},
        {code: 'or', name: 'Oriya'},
        {code: 'pa', name: 'Punjabi'},
        {code: 'pl', name: 'Polski'},
        {code: 'ps', name: 'Pashto'},
        {code: 'pt', name: 'Português'},
        {code: 'ro', name: 'Română'},
        {code: 'ru', name: 'Русский'},
        {code: 'rw', name: 'Kinyarwanda'},
        {code: 'sd', name: 'Sindhi'},
        {code: 'si', name: 'Sinhala'},
        {code: 'sk', name: 'Slovenčina'},
        {code: 'sl', name: 'Slovenščina'},
        {code: 'sm', name: 'Samoa'},
        {code: 'sn', name: 'Shona'},
        {code: 'so', name: 'Somali'},
        {code: 'sq', name: 'Shqip'},
        {code: 'sr', name: 'Српски'},
        {code: 'st', name: 'Sotho'},
        {code: 'su', name: 'Sundanese'},
        {code: 'sv', name: 'Svenska'},
        {code: 'sw', name: 'Swahili'},
        {code: 'ta', name: 'Tamil'},
        {code: 'te', name: 'Telugu'},
        {code: 'tg', name: 'Tajik'},
        {code: 'th', name: 'ไทย'},
        {code: 'tk', name: 'Turkmen'},
        {code: 'tl', name: 'Tagalog'},
        {code: 'tr', name: 'Türkçe'},
        {code: 'tt', name: 'Tatar'},
        {code: 'ug', name: 'Uyghur'},
        {code: 'uk', name: 'Українська'},
        {code: 'ur', name: 'Urdu'},
        {code: 'uz', name: 'Uzbek'},
        {code: 'vi', name: 'Tiếng Việt'},
        {code: 'xh', name: 'Xhosa'},
        {code: 'yi', name: 'Yiddish'},
        {code: 'yo', name: 'Yoruba'},
        {code: 'zh', name: '中文'},
        {code: 'zu', name: 'Zulu'}
      ];

      function populateLanguages() {
        if (selectUILang.options.length > 0) return;

        availableLanguages.forEach(function(lang) {
          var option = document.createElement('option');
          option.value = lang.code;
          option.textContent = lang.name;
          selectUILang.appendChild(option);
        });

        chrome.storage.sync.get(['ui_lang'], function(items) {
          if (items && items.ui_lang) {
            selectUILang.value = items.ui_lang;
          } else {
            selectUILang.value = chrome.i18n.getUILanguage().split('-')[0] || 'en';
          }
        });
      }

      populateLanguages();

      selectUILang.addEventListener('change', function() {
        chrome.storage.sync.set({ui_lang: selectUILang.value});
      });
    });
  } catch(e) {}
})();