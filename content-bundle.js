const YSScreateTrustedElementFromString = (() => {
  const escapeHTMLPolicy = trustedTypes.createPolicy("YSSTrustedHTML", {
    createHTML: (string) => string,
    createScript: (string) => string,
    createScriptURL: (string) => string,
  });
  return {
    trustedHTML: (elementString) => escapeHTMLPolicy.createHTML(elementString),
    trustedScript: (elementString) => escapeHTMLPolicy.createScript(elementString),
    trustedScriptURL: (elementString) => escapeHTMLPolicy.createScriptURL(elementString),
  };
})();
const YSStrustedHTML = YSScreateTrustedElementFromString.trustedHTML;
const YSStrustedScript = YSScreateTrustedElementFromString.trustedScript;
const YSStrustedScriptURL = YSScreateTrustedElementFromString.trustedScriptURL;
