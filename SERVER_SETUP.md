# Server Setup Guide — YSS Read Dubbing Engine

The dubbing pipeline requires four local servers. This guide covers all of them.

## Quick Start (tl;dr)

```powershell
# Terminal 1 — XTTS v2 (primary TTS, port 8020)
docker run -d --gpus all -p 8020:8020 ghcr.io/erew123/alltalk_tts:latest

# Terminal 2 — Edge TTS (fallback, port 8021)
docker run -d -p 8021:8021 ghcr.io/nalzok/edge-tts-server:latest

# Terminal 3 — Whisper (STT, port 8022)
docker run -d --gpus all -p 8022:9000 ghcr.io/ggerganov/whisper.cpp:server -m ggml-large-v3.bin --port 8022

# Terminal 4 — Ollama (translation, port 11434)
ollama pull gemma3:4b
ollama serve
```

---

## 1. XTTS v2 (Port 8020)

**Role:** Primary text-to-speech. High-quality neural voice synthesis.

### API Endpoints
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/health` | GET | — | `200 OK` |
| `/tts` | POST | `{"text":"...", "language":"es", "speaker_wav":"", "speed":1.0}` | audio/wav blob |

### Docker (recommended)

```powershell
# With GPU
docker run -d --gpus all -p 8020:8020 --name xtts ghcr.io/erew123/alltalk_tts:latest

# CPU only (slower)
docker run -d -p 8020:8020 --name xtts ghcr.io/erew123/alltalk_tts:latest
```

### Python (manual)

```powershell
git clone https://github.com/erew123/AllTalk_TTS
cd AllTalk_TTS

# Install
python -m venv venv
.\venv\Scripts\Activate
pip install -r requirements.txt

# Run
python alltalk.py --port 8020
```

### Test
```powershell
curl -X POST http://127.0.0.1:8020/tts -H "Content-Type: application/json" -d '{"text":"Hola mundo","language":"es","speaker_wav":"","speed":1.0}' --output test.wav
```

---

## 2. Edge TTS (Port 8021)

**Role:** Fallback text-to-speech. Microsoft Edge voices via edge-tts.

### API Endpoints
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/voices` | GET | — | JSON list of voices |
| `/synthesize` | POST | `{"text":"...", "voice":"es-ES-AlvaroNeural", "rate":0}` | audio/wav blob |

### Docker

```powershell
docker run -d -p 8021:8021 --name edgetts ghcr.io/nalzok/edge-tts-server:latest
```

### Python (manual)

```powershell
pip install edge-tts fastapi uvicorn

```python
# server.py
from fastapi import FastAPI
from fastapi.responses import Response
import edge_tts
import json

app = FastAPI()

@app.get("/voices")
async def get_voices():
    voices = await edge_tts.list_voices()
    return voices

@app.post("/synthesize")
async def synthesize(data: dict):
    text = data.get("text", "")
    voice = data.get("voice", "es-ES-AlvaroNeural")
    rate = data.get("rate", 0)
    tts = edge_tts.Communicate(text, voice, rate=str(rate))
    audio = b""
    async for chunk in tts.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
    return Response(content=audio, media_type="audio/wav")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8021)
```
```powershell
python server.py
```
```

### Test
```powershell
curl -X POST http://127.0.0.1:8021/synthesize -H "Content-Type: application/json" -d '{"text":"Hola mundo","voice":"es-ES-AlvaroNeural","rate":0}' --output test.wav
```

---

## 3. Whisper (Port 8022)

**Role:** Speech-to-text. Captures original audio for Full Dub mode.

### API Endpoints
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| `/ready` | GET | — | `200 OK` |
| `/inference` | POST | FormData: `audio_file` (wav), `language`, `response_format` | JSON `{text, segments, language}` |

### Docker (whisper.cpp server)

```powershell
# Pull model first
docker run --rm -v %USERPROFILE%\.cache\whisper:/models ghcr.io/ggerganov/whisper.cpp:latest --model large-v3 --download

# Run server
docker run -d --gpus all -p 8022:9000 --name whisper -v %USERPROFILE%\.cache\whisper:/models ghcr.io/ggerganov/whisper.cpp:server -m /models/ggml-large-v3.bin --host 0.0.0.0 --port 8022
```

### Docker (faster-whisper with REST API)

```powershell
docker run -d --gpus all -p 8022:8022 --name whisper-api onerahmet/openai-whisper-asr-webservice:latest-gpu --model large-v3
```

### Python (manual, faster-whisper)

```powershell
pip install faster-whisper fastapi uvicorn python-multipart

```python
# server.py
from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel
import tempfile, os

app = FastAPI()
model = WhisperModel("large-v3", device="cuda", compute_type="float16")

@app.get("/ready")
async def ready():
    return {"status": "ok"}

@app.post("/inference")
async def inference(audio_file: UploadFile = File(...), language: str = Form("auto"), response_format: str = Form("json")):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        content = await audio_file.read()
        tmp.write(content)
        tmp_path = tmp.name
    segments, info = model.transcribe(tmp_path, language=None if language == "auto" else language)
    text = " ".join([s.text for s in segments])
    os.unlink(tmp_path)
    return {"text": text, "segments": [{"text": s.text, "start": s.start, "end": s.end} for s in segments], "language": info.language}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8022)
```
```powershell
python server.py
```
```

### Test
```powershell
# Create a test audio file first, then:
curl -X POST http://127.0.0.1:8022/inference -F "audio_file=@test.wav" -F "language=auto"
```

---

## 4. Ollama (Port 11434)

**Role:** Subtitle translation. Runs translation models locally.

### API Endpoints
| Endpoint | Method | Body | Response |
|----------|--------|------|----------|
| POST `/api/generate` | POST | `{"model":"gemma3:4b", "prompt":"...", "stream":false}` | `{"response":"..."}` |

### Windows Install

```powershell
# Download from https://ollama.com/download/windows
# Or via winget:
winget install Ollama.Ollama

# Pull the recommended model
ollama pull gemma3:4b

# Start server (it runs as a background service on Windows by default)
ollama serve
```

### Test
```powershell
curl -X POST http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" -d "{\"model\":\"gemma3:4b\",\"prompt\":\"Translate to Spanish: Hello world\",\"stream\":false}"
```

---

## Architecture Flow

```
YouTube Video
     │
     ▼
┌─────────────┐    ┌──────────────────┐
│  Whisper    │◄───│  Video audio     │
│  :8022      │    │  (captureStream) │
└──────┬──────┘    └──────────────────┘
       │ text
       ▼
┌─────────────┐
│  Ollama     │  ← gemma3:4b (translation)
│  :11434     │
└──────┬──────┘
       │ translated text
       ▼
┌─────────────┐    ┌──────────────────┐
│  XTTS :8020 │───►│  Audio element   │
│  (primary)  │    │  playback        │
└─────────────┘    └──────────────────┘
       │ fallback
       ▼
┌─────────────┐
│  Edge TTS   │
│  :8021      │
│  (fallback) │
└─────────────┘
```

## Verifying All Servers

```powershell
# Quick health check script
$ports = @(8020, 8021, 8022, 11434)
$names = @("XTTS", "EdgeTTS", "Whisper", "Ollama")
for($i=0; $i -lt $ports.Length; $i++){
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$($ports[$i])" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "$($names[$i]) :$($ports[$i]) — OK"
    } catch {
        Write-Host "$($names[$i]) :$($ports[$i]) — DOWN"
    }
}
```
