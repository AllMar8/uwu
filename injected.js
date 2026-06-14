(function(){
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    try {
      var parsedUrl = new URL(url, location.origin);
      var pot = parsedUrl.searchParams.get('pot');
      if (pot) {
        window.dispatchEvent(new CustomEvent('__YSS_POT', { detail: pot }));
      }
    } catch(e) {}
    return origOpen.apply(this, arguments);
  };
})();
