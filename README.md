# 🛡️ WhatsApp Group Guard

An open-source, AI-assisted moderation bot for WhatsApp groups. It watches a group, removes messages you don't want (links, stickers, audio, abuse, etc.), and uses a **local AI model (Ollama)** to catch things a simple word list would miss, all running on your own machine, with no paid API.

> ⚠️ **Unofficial project.** This bot connects to WhatsApp through [Baileys](https://github.com/WhiskeySockets/Baileys), which is not an official WhatsApp API. Use a secondary number, not your main one. Automated accounts can be restricted by WhatsApp.

---

## 📑 Table of Contents

1. [Features](#-features)
2. [How it works](#-how-it-works)
3. [Requirements](#-requirements)
4. [Setup, step by step](#-setup-step-by-step)
   - [Step 1: Clone the repository](#step-1--clone-the-repository)
   - [Step 2: Install dependencies](#step-2--install-dependencies)
   - [Step 3: Install Ollama and download the AI models](#step-3--install-ollama-and-download-the-ai-models)
   - [Step 4: Configure the bot](#step-4--configure-the-bot)
   - [Step 5: Start the bot and link WhatsApp](#step-5--start-the-bot-and-link-whatsapp)
   - [Step 6: Add the bot to your group](#step-6--add-the-bot-to-your-group)
   - [Step 7: Test that it works](#step-7--test-that-it-works)
5. [Configuration reference](#-configuration-reference)
6. [Project structure](#-project-structure)
7. [Troubleshooting](#-troubleshooting)
8. [Updating and contributing (Git steps)](#-updating-and-contributing-git-steps)
9. [Disclaimer](#-disclaimer)

---

## ✨ Features

| Feature | What it does |
| --- | --- |
| **Message-type control** | Deletes message types you block: stickers, audio, documents, contacts, locations (configurable). |
| **Link blocking** | Removes any link posted in the group. Optionally catches bare domains like `example.com` and lets you allow-list trusted domains. |
| **Abuse / slur filter** | Deletes messages containing words from your `bannedWords` list. |
| **AI moderation** | A local Ollama model reads messages against your group rules and flags spam, harassment, bullying, hate speech, ads and adult content. |
| **Image checking** | A local vision model can look at images, so moderation isn't limited to text. |
| **Warning system** | Repeat offenders are warned, and after `maxWarnings` violations they are removed. |
| **Easy login** | Enter your phone number in the terminal, then link with a **QR code** or a **pairing code**. |
| **Fully local** | Your group's messages are never sent to a third-party AI service. |

---

## 🔍 How it works

```
WhatsApp group message
        │
        ▼
   Baileys (receives the message)
        │
        ├─► 1. Is the message type blocked?      → delete
        ├─► 2. Does it contain a link?           → delete
        ├─► 3. Does it contain a banned word?    → delete
        └─► 4. AI check with Ollama (rules)      → delete if it breaks a rule
                        │
                        ▼
              Warn the member → remove after maxWarnings
```

The checks run from cheapest to most expensive, so the AI model is only used when the fast rule-based checks have not already caught the message.

---

## 📋 Requirements

Before you begin, make sure you have:

- **Node.js 20 or newer** and **npm**. Download from [nodejs.org](https://nodejs.org). Check with `node -v`.
- **Git**. Download from [git-scm.com](https://git-scm.com). Check with `git --version`.
- **Ollama** for the local AI models. Download from [ollama.com](https://ollama.com).
- A **WhatsApp account for the bot**, ideally a spare number.
- A computer that stays **on and connected to the internet** while the bot runs.
- Roughly **6 to 8 GB of free disk space** for the two AI models, and a machine with enough RAM to run them (8 GB or more recommended).

---

## 🚀 Setup, step by step

### Step 1: Clone the repository

Open a terminal (PowerShell, Command Prompt, Git Bash or any shell) and run:

```bash
git clone https://github.com/Jayeshseervi/whatsapp-guard.git
cd whatsapp-guard
```

This downloads the project into a folder called `whatsapp-guard` and moves you into it.

### Step 2: Install dependencies

```bash
npm install
```

This reads `package.json` and installs everything the bot needs:

| Package | Purpose |
| --- | --- |
| `@whiskeysockets/baileys` | Connects to WhatsApp |
| `pino` | Logging |
| `qrcode-terminal` | Draws the login QR code in your terminal |

Wait until it finishes without errors. A `node_modules` folder will appear. That is normal and is not uploaded to GitHub.

### Step 3: Install Ollama and download the AI models

1. Install Ollama from [ollama.com](https://ollama.com) and make sure it is running. Test it with:

   ```bash
   ollama --version
   ```

2. Download the text model used for moderation:

   ```bash
   ollama pull llama3.2
   ```

3. Download the vision model used for images:

   ```bash
   ollama pull gemma3:4b
   ```

4. Confirm both are installed:

   ```bash
   ollama list
   ```

Ollama listens on `http://localhost:11434` by default, which matches the default in `config.json`.

> 💡 Don't want AI moderation? Skip this step and set `"aiModeration": false` in `config.json`. The rule-based filters will still work.

### Step 4: Configure the bot

Open `config.json` in any text editor. The defaults work out of the box, but you should review these:

```json
{
  "blockedTypes": ["sticker", "audio", "document", "contact", "location"],
  "blockLinks": true,
  "blockBareDomains": true,
  "allowedDomains": [],
  "blockAbuse": true,
  "bannedWords": ["add", "your", "own", "words"],
  "aiModeration": true,
  "groupRules": "No spam, no abuse or insults, no harassment or bullying, no slurs or hate speech, no advertising, no adult content.",
  "maxWarnings": 3,
  "ollamaUrl": "http://localhost:11434",
  "ollamaModel": "llama3.2",
  "ollamaVisionModel": "gemma3:4b"
}
```

Common changes:

- **Allow some message types:** remove them from `blockedTypes` (for example, delete `"sticker"` to allow stickers).
- **Allow trusted links:** add domains to `allowedDomains`, for example `["youtube.com", "github.com"]`.
- **Customise the rules the AI enforces:** edit `groupRules` in plain English.
- **Make it stricter or more relaxed:** change `maxWarnings`.

Save the file. Every option is explained in the [Configuration reference](#-configuration-reference) below.

### Step 5: Start the bot and link WhatsApp

Make sure Ollama is running, then start the bot:

```bash
npm start
```

Then follow the prompts:

1. **Enter the bot's phone number** when asked. Use the country code followed by the number, with no `+`, spaces or dashes (for example `91XXXXXXXXXX`).
2. The terminal shows **both a QR code and a pairing code**. Choose whichever is easier:

   **Option A: QR code**
   1. On the bot's phone, open WhatsApp → **Settings** → **Linked devices** → **Link a device**.
   2. Scan the QR code shown in the terminal.

   **Option B: Pairing code**
   1. On the bot's phone, open WhatsApp → **Settings** → **Linked devices** → **Link a device**.
   2. Tap **Link with phone number instead**.
   3. Type in the pairing code shown in the terminal.

3. When the terminal reports a successful connection, the bot is online. Your login is saved locally, so you won't need to link again on the next start.

### Step 6: Add the bot to your group

1. In WhatsApp, add the bot's number to the group you want to moderate.
2. **Make the bot a group admin.** WhatsApp only lets admins delete other people's messages and remove members, so without this step the bot can't act.

### Step 7: Test that it works

From a normal (non-admin) member's account, try:

- Sending a sticker or a voice note → should be deleted (if those types are blocked).
- Posting a link such as `https://example.com` → should be deleted.
- Posting a bare domain such as `example.com` → should be deleted if `blockBareDomains` is `true`.
- Sending a message containing one of your `bannedWords` → should be deleted.
- Repeating violations until `maxWarnings` is reached → the member should be removed.

If something doesn't behave as expected, check the [Troubleshooting](#-troubleshooting) section.

---

## ⚙️ Configuration reference

| Option | Type | Description |
| --- | --- | --- |
| `blockedTypes` | array | Message types to delete: `sticker`, `audio`, `document`, `contact`, `location`. |
| `blockLinks` | boolean | Delete messages containing links. |
| `blockBareDomains` | boolean | Also treat text like `example.com` (no `http://`) as a link. |
| `allowedDomains` | array | Domains that are **not** blocked even when `blockLinks` is on. |
| `blockAbuse` | boolean | Enable the banned-words filter. |
| `bannedWords` | array | Words or phrases that trigger deletion. |
| `aiModeration` | boolean | Enable AI checks through Ollama. |
| `groupRules` | string | Your rules in plain English. The AI judges messages against them. |
| `maxWarnings` | number | Warnings a member gets before being removed. |
| `ollamaUrl` | string | Address of your Ollama server. |
| `ollamaModel` | string | Text model used for moderation. |
| `ollamaVisionModel` | string | Vision model used for images. |

---

## 🗂️ Project structure

```
whatsapp-guard/
├── index.js            # Main bot logic (connection, filters, warnings)
├── config.json         # All settings you can customise
├── package.json        # Project info and dependencies
├── package-lock.json   # Exact dependency versions
├── .gitignore          # Files kept out of Git (node_modules, login session, etc.)
└── README.md           # This file
```

> 🔐 The login session folder the bot creates contains your WhatsApp credentials. **Never commit it or share it.** Make sure it is listed in `.gitignore`.

---

## 🧰 Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm install` fails | Update Node.js to version 20 or newer and try again. |
| QR code looks broken in the terminal | Use a wider terminal window, or use the **pairing code** instead. |
| Pairing code is rejected | Check that the phone number has the country code and no `+`. Codes expire quickly, so restart the bot and try again. |
| Bot connects but doesn't delete anything | Make sure the bot is an **admin** in the group. |
| AI moderation does nothing or errors | Check that Ollama is running (`ollama list`) and that `ollamaUrl` and the model names in `config.json` match. |
| First AI response is very slow | Normal. The model loads into memory on first use. A smaller model or a faster machine helps. |
| Bot logged out or session invalid | Delete the saved session folder and run `npm start` to link again. |
| Legitimate links get deleted | Add those domains to `allowedDomains`. |

---

## 🔄 Updating and contributing (Git steps)

**Get the latest version of the project:**

```bash
git pull
npm install
```

**Save and upload your own changes to GitHub:**

```bash
git status                       # see what changed
git add .                        # stage the changes
git commit -m "Describe your change"
git push
```

**Contribute to this project:**

1. Fork the repository on GitHub.
2. Create a branch: `git checkout -b my-feature`
3. Make your changes and commit them.
4. Push the branch and open a Pull Request.

Ideas for contributions: a Telegram version, more languages for the abuse filter, per-group configuration, and an admin command interface.

---

## ⚖️ Disclaimer

This project is not affiliated with, endorsed by, or connected to WhatsApp or Meta. It is provided as-is for educational and community-moderation purposes. You are responsible for how you use it and for complying with WhatsApp's Terms of Service and the privacy laws that apply to you. Always let group members know that a moderation bot is active.

---

## 👤 Author

Built by [Jayeshseervi](https://github.com/Jayeshseervi). If this project helps you, consider giving it a ⭐ on GitHub.
