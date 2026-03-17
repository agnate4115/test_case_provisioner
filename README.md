# ⚡ TestForge

> AI-Powered Selenium Test Environment Provisioner

---

## 🚀 How to Run

### Step 1 — Prerequisites

Make sure you have these installed:
```bash
python3 --version   # 3.9+
node --version      # 16+
npm --version       # 8+
```

### Step 2 — Unzip & Start

```bash
unzip testforge.zip
cd testforge
chmod +x start.bash
./start.bash
```

That's it. `start.bash` will:
1. Load your `.env` (Azure OpenAI credentials pre-filled ✅)
2. Create a Python virtual environment for the backend
3. Install all Python + Node dependencies automatically
4. Start 3 servers simultaneously

### Step 3 — Open the Dashboard

| Service | URL |
|---------|-----|
| 🖥️ Dashboard | http://localhost:3000 |
| 🔧 Backend API | http://localhost:8000 |
| 🧪 Demo App | http://localhost:3001 |
| 📖 API Docs | http://localhost:8000/docs |

---

## 🔑 Azure OpenAI (Pre-Configured)

Your `.env` is already filled with your Azure credentials:

```env
AZURE_OPENAI_API_KEY=YOUR_AZURE_API_KEY_HERE
AZURE_OPENAI_ENDPOINT=https://argusllm.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_MODEL_DEPLOYMENT_NAME=gpt-4o
```

The backend auto-loads `.env` on startup — no manual config needed.
When you click "Generate Tests", it automatically uses your GPT-4o deployment.

---

## 🎯 Usage Workflow

1. **Create Environment** → Environments page → fill name → Provision
2. **Generate Tests** → Test Suite → Generate tab → click Generate Tests (uses GPT-4o)
3. **Add Manual Tests** → Test Suite → Manual tab
4. **Run Tests** → Test Suite → Run tab → pick browsers → Run
5. **Browser Compare** → Test Suite → Browser Compare tab
6. **Download Report** → Reports page → View Report / Download ZIP

---

## 🧪 Demo App Credentials

URL: http://localhost:3001

| Field    | Value            |
|----------|------------------|
| Email    | demo@test.com    |
| Password | password123      |

---

## ❓ Troubleshooting

Port already in use:
```bash
lsof -ti:8000 | xargs kill -9 && lsof -ti:3000 | xargs kill -9
```

View logs:
```bash
tail -f /tmp/testforge_backend.log
tail -f /tmp/testforge_frontend.log
```
