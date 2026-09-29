# Installing Desktop Avatar

This guide takes you from nothing to a buddy on your desktop that talks, listens, and thinks with its own AI, all running on your own PC. The basics take about two minutes. Each optional extra (AI brain, voice) adds a few more.

## What you need

| | |
|---|---|
| Windows | Windows 10 (version 2004 or newer) or Windows 11, 64-bit |
| Disk space | About 370 MB for the app. Optional extras: about 2.5 GB for the AI brain, 150 MB for speech recognition, 85 MB for the natural voice |
| Memory | 8 GB of RAM is enough for the app. For the AI brain, 16 GB is comfortable |
| Graphics card | Not required. With one (like an RTX 3070), the AI answers much faster |
| Internet | Only for the downloads below. After that, everything works offline |

Everything is free: no accounts, no subscriptions, and nothing you say or do leaves your PC.

## 1. Download the installer

1. Open the project's **Releases** page on GitHub: <https://github.com/cstout0/desktop-avatar/releases> (the repository is private, so sign in to GitHub with an account that has access).
2. Under **Desktop Avatar 1.0**, click **Desktop-Avatar-Setup-1.0.0.exe** (about 110 MB) to download it. If your browser warns that the file isn't commonly downloaded, choose **Keep**.

## 2. Run the installer

1. Double-click **Desktop-Avatar-Setup-1.0.0.exe** in your Downloads folder.
2. Windows SmartScreen may say **"Windows protected your PC"**. The installer isn't code-signed (a signing certificate costs money), so Windows doesn't recognize it yet. Click **More info**, then **Run anyway**.
3. On **Choose Install Location**, the default folder is fine. If you change it, keep the path short: very long folder paths can break the install. Click **Install**.
4. When it says **Completing Desktop Avatar Setup**, leave **Run Desktop Avatar** ticked and click **Finish**.

It installs just for you, so it doesn't need administrator rights. It adds **Desktop Avatar** to the Start menu and a shortcut on your desktop.

## 3. Meet your buddy

1. The character drops onto your desktop and says hi.
2. A little box asks for its **name**. Type one (or press 🎲 for ideas) and press **Enter**. Its name is also its "wake word" for voice commands later.
3. Look for its icon in the **system tray** (bottom-right, next to the clock; you may need to click **^** to see it). The icon wears the same outfit as your buddy.

Things to try right away:

- **Drag** it around and **throw** it. **Click** to poke it; rub the cursor over it to pet it.
- **Double-click** it (or press **Ctrl+Alt+C**) to chat: "dance", "open Spotify", "set a timer for 5 minutes", "create a folder named Test".
- **Double-click the tray icon** to open **Settings**. Dress it up in **Wardrobe**, change how it walks in **Moves**, and play games in **Play**.

At this point the built-in commands work. Give it the AI brain next so it can chat about anything.

## 4. Give it a brain (optional, recommended)

The AI runs in **Ollama**, a free app that runs AI models on your own PC.

1. Open **Settings → Brain** and click **Open ollama.com** (or go to <https://ollama.com/download>).
2. Download **Ollama for Windows**, run its installer, and let it start.
3. Back in **Settings → Brain**, click **Check**. The status now says the model isn't downloaded.
4. Click **Download** next to **Download the AI model**. It's a one-time download of about 2.5 GB; the bar shows the progress.
5. When the status says **Ready · qwen3:4b-instruct**, you're done. Chat with it about anything, and it picks its own activities during the day.

You don't need to keep Ollama open: Desktop Avatar starts it when needed. While you play a fullscreen game, it unloads the model so your graphics card is free for the game.

## 5. Voice (optional)

### Talk to it

1. Open **Settings → Voice** and click **Download speech recognition** (about 150 MB). It uses Whisper, running on your PC.
2. Make sure Windows lets desktop apps use your microphone: **Windows Settings → Privacy & security → Microphone**, turn on **Microphone access** and **Let desktop apps access your microphone**.
3. Press **Ctrl+Alt+V** (or the mic button in the chat box), speak, and pause when you're done.

For hands-free use, turn on **Listen for my name** in **Settings → Voice**. Then just say "Pixel, what time is it?" (with its name). Saying only its name gets a "Yes?" and then it listens for the request. It pauses during fullscreen games unless you turn on **Also during fullscreen**.

### Let it talk back

In **Settings → Voice**, choose when it speaks (**When I talk to it** or **Always**) and a voice:

- **Windows voice** works right away.
- **Natural voice** sounds more human: click **Download** (about 85 MB) the first time.

Use **Test voice** to hear it, and the sliders to change pitch, speed and volume.

## 6. Make it yours

| Where | What |
|---|---|
| Settings → Buddy | Name, size (0.01% to 500%), personality, how chatty it is |
| Settings → Wardrobe | Body shape, arms, legs, antenna, colors, hats, glasses, neckwear, outfits |
| Settings → Moves | Walk style, idle style, trails, jiggle, one-click characters |
| Settings → Senses | Dancing to music, watching videos with you, what it listens to, notification reactions |
| Settings → Focus | Pomodoro timer, stretch/water/eye-rest reminders, quiet hours |
| Settings → Play | Fetch, hide and seek, boxing pop-ups |
| Settings → App | Hotkeys, **Start with Windows**, open the log and data folders, reset |

Turn on **Settings → App → Start with Windows** to have your buddy there every time you sign in.

Default hotkeys: **Ctrl+Alt+C** chat, **Ctrl+Alt+V** voice, **Ctrl+Alt+H** hide or show. If another app already uses one, it picks a free fallback; **Settings → App** shows the active ones and lets you change them.

## Updating

1. Quit Desktop Avatar: right-click its tray icon and choose **Quit**.
2. Download the newer installer from the Releases page and run it. Your current folder is already filled in, so click **Install**, then **Finish**.

Your buddy's name, look, memories and settings are kept.

## Uninstalling

1. Quit Desktop Avatar: right-click its tray icon and choose **Quit**.
2. Open **Windows Settings → Apps → Installed apps**.
3. Find **Desktop Avatar**, click **⋯ → Uninstall**, and confirm.
4. In the uninstaller, click **Next**, then **Finish**.

The uninstaller removes the program and its shortcuts but keeps your buddy's data in `%APPDATA%\Desktop Avatar` (settings, memories, focus stats, downloaded voice files), so reinstalling brings it back. To remove that too, delete that folder yourself. Your notes file is `Documents\Desktop Avatar Notes.txt`.

Ollama is a separate app: uninstall it the same way if you don't want it anymore. Its models are in `%USERPROFILE%\.ollama`.

## Troubleshooting

| Problem | What to do |
|---|---|
| "Windows protected your PC" | Click **More info → Run anyway** (see step 2). |
| I can't see the character | Press **Ctrl+Alt+H**, or right-click the tray icon and choose **Show** (followed by its name). It stays off a monitor that has a fullscreen game or video and moves to your other monitor. |
| "Ollama isn't running" | Press **Check** in **Settings → Brain** (it starts Ollama), or open **Ollama** from the Start menu. If it isn't installed, see step 4. |
| "The model isn't downloaded" | **Settings → Brain → Download the AI model**. |
| It doesn't hear me | Check the microphone privacy setting (step 5), and that the right microphone is the default in **Windows Settings → System → Sound → Input**. |
| It dances to my voice calls | **Settings → Senses → Listen to → All but calls** or **Just the video**. |
| A hotkey doesn't work | Another app has it: pick a different one in **Settings → App**. |
| The app won't start after installing to a custom folder | Reinstall to the default folder (a very long path can break the install). |
| Something else is odd | **Settings → App → Log file** opens `app.log`. **Reset settings** there puts everything back (it keeps the name). |

## Building it yourself (for developers)

You need Windows 10 or 11, [Node.js](https://nodejs.org) 20 or newer, and Git.

```
git clone https://github.com/cstout0/desktop-avatar.git
cd desktop-avatar
npm install
npm run setup      # optional: Ollama model + speech recognition (setup:tts adds the natural voice)
npm start          # run it from source (or double-click "Start Desktop Avatar.vbs")
npm test           # unit tests
npm run dist       # build dist\Desktop-Avatar-Setup-<version>.exe
```

See the [README](README.md) for how the code is organized and how the end-to-end tests work.
