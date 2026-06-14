(function(){
  try{
    const info = {
      probe: 'yss-debug-probe',
      extensionId: chrome && chrome.runtime && chrome.runtime.id ? chrome.runtime.id : 'unknown',
      time: new Date().toISOString()
    };
    console.log('YSS debug probe injected', info);
    // visible banner for quick confirmation
    const b = document.createElement('div');
    b.id = 'yss-debug-probe-banner';
    b.style.position='fixed'; b.style.right='8px'; b.style.bottom='8px'; b.style.zIndex=2147483647;
    b.style.background='rgba(0,0,0,0.8)'; b.style.color='white'; b.style.padding='6px 8px'; b.style.borderRadius='6px'; b.style.fontSize='12px';
    b.style.boxShadow='0 2px 8px rgba(0,0,0,0.4)';
    b.textContent = `YSS probe: ${info.extensionId}`;
    b.title = 'Speak Subtitles (Fork) debug probe';
    document.documentElement.appendChild(b);
    setTimeout(()=>{ try{ b.remove(); }catch(e){} }, 15000);
  }catch(e){ console.warn('debug_probe failed', e); }
})();
