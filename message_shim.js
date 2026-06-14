(function(){
  try{
    if(!window.chrome||!window.chrome.runtime||!window.chrome.runtime.sendMessage) return;
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    const wrapped = function(){
      try{
        // Detect form: (extensionId, message, options, callback)
        if(typeof arguments[0]==='string' && typeof arguments[1]==='object'){
          const extensionId = arguments[0];
          const message = arguments[1];
          const options = arguments[2];
          const cb = typeof arguments[3]==='function'?arguments[3]:typeof arguments[2]==='function'?arguments[2]:undefined;
          orig(extensionId, message, options, function(resp){
            if(chrome.runtime.lastError){
              // Retry without explicit target (send to own extension)
              try{ orig(message, cb); }catch(e){}
            }else{
              if(typeof cb==='function') cb(resp);
            }
          });
          return;
        }
        return orig.apply(null, arguments);
      }catch(e){
        try{ return orig.apply(null, arguments); }catch(_){}
      }
    };
    window.chrome.runtime.sendMessage = wrapped;
  }catch(e){/* ignore */}
})();
