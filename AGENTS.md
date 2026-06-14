# YSS Read — forkv2

## Project

Brave/Chrome extension that reads YouTube subtitles aloud via TTS while muting the original video audio.
Supports AI translation through Ollama (local), ElevenLabs, and browser speechSynthesis.

- **Manifest:** V3
- **Root:** `C:\Users\alexis\Desktop\extension\forkv2`

---

## File Map

### Content Scripts
| File | Role |
|------|------|
| `subtitle_fixer.js` | Core engine — 2454 lines. Subtitle parsing, TTS dispatch, gap detection, timing logic |
| `video-block.js` | Video mute enforcement. Intercepts `volume`/`muted` setters at `HTMLMediaElement.prototype` level + MutationObserver |
| `video-sync.js` | Sync between subtitle timing and TTS playback |
| `dubbing-init.js` | Initializes DubbingEngine on page load |

### Background
| File | Role |
|------|------|
| `background.js` | Service worker (MV3). Handles all localhost fetch routing, message passing, and cross-origin requests |

### Popup (7 files)
- Popup UI files live in the `popup/` directory
- Do not modify popup files unless the task explicitly targets them

### Translation
| File | Role |
|------|------|
| `OllamaTranslator.js` | AI translation via Ollama — must route fetch through background.js, never direct |

---

## Architecture Rules

### MV3 Constraints
- Content scripts **cannot** fetch `localhost` directly — always route through `background.js` via `chrome.runtime.sendMessage`
- If unsure about any MV3 restriction, check `developer.chrome.com` before implementing
- Service workers (background.js) cannot use persistent state — use `chrome.storage` for persistence

### Audio Muting
- Muting is enforced at `HTMLMediaElement.prototype` level (setter interception)
- A `MutationObserver` handles DOM-inserted video elements
- After every fix, verify: no audio bleed, video mute logic still intact

### TTS Stack Priority
1. ElevenLabs (external API, routed through background.js)
2. Ollama (local, `localhost:11434`, routed through background.js)
3. Browser `speechSynthesis` (fallback, direct in content script)

---

## Debugging

- **Brave remote debugging port:** `localhost:9222`
- Open `brave://inspect` → inspect the extension's content script context
- Verify fixes by checking DevTools console for errors after each change
- Test subtitle gap behavior by scrubbing the video timeline

---

## Known Bug History

| ID | File | Description | Status |
|----|------|-------------|--------|
| BUG-C1 | `video-block.js` | 25-second timer auto-re-enabling original audio | Fixed v1.3.1 |
| BUG-C2 | `dubbing-init.js` | DubbingEngine initializing on every page load, constant failed network calls | Fixed v1.3.1 |
| BUG-C3 | `OllamaTranslator.js` | Direct `fetch()` to localhost causing CORS failures | Fixed v1.3.1 |
| BUG-S1 | `subtitle_fixer.js` | `_lastCustomSubTime` drifts ahead of playback — reset when drift > 2s | Fixed |

Update this table when new bugs are found or fixed.

---

## Output Rules

- **Diff-only output** — show only the changed lines, never the full file
- **Never touch code unrelated to the task**
- **No patch commands** — use direct string replacement only (see SOUL.md)
- After modifying any file, re-read the changed section to confirm correctness

---

## Verification Checklist

After every fix, confirm:

- [ ] No audio bleed from original video
- [ ] Video mute logic still active (check `HTMLMediaElement.prototype` override)
- [ ] TTS plays correctly for current subtitle
- [ ] No console errors in content script context (`localhost:9222`)
- [ ] Subtitle gap detection not broken (`_lastCustomSubTime` drift check)