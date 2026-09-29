# Desktop Avatar

A little character that lives on your Windows desktop. It walks along the tops of your windows, climbs their sides, swings on a grappling rope, dances to whatever your PC is playing, watches videos with you, and does things when you ask ("create a folder named Test Folder"). It can talk back, answer to its name, play fetch and hide and seek, and keep you company while you focus. The first time it starts, you give it a name.

Everything runs on your own PC. The brain is a local model in [Ollama](https://ollama.com) (`qwen3:4b-instruct` by default), speech-to-text uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp), and the natural voice uses [Piper](https://github.com/rhasspy/piper). There are no accounts, no cloud, and no cost.

## Install

Download **Desktop-Avatar-Setup-1.0.0.exe** from the [Releases page](https://github.com/cstout0/desktop-avatar/releases) and run it. It installs just for you (no admin needed), adds a Start menu entry and a desktop shortcut, and can be removed from Windows' **Installed apps** like any other program. The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC": click **More info → Run anyway**.

For the AI brain, install [Ollama](https://ollama.com/download) (free), then download the model from inside the app (**Settings → Brain**). Speech recognition and the natural voice are downloaded from **Settings → Voice**. Without them, the built-in commands still work.

**[The full installation guide](INSTALL.md)** walks through every step, plus updating, uninstalling and troubleshooting.

## Run from source

You need Windows 10 or 11 and [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm run setup:ai      # starts Ollama if needed, downloads qwen3:4b-instruct (~2.5 GB), says hello
npm run setup:voice   # downloads whisper.cpp and an English model (~150 MB)
npm run setup:tts     # optional: the Piper natural voice (~85 MB)
```

Then double-click **Start Desktop Avatar.vbs** (no console window), or run `npm start`. `npm run setup` runs the AI and voice steps. The model files and `node_modules` aren't in the repo; these commands download them.

## Playing with it

| | |
|---|---|
| Drag and throw | Grab it with the mouse and fling it. Click to poke it; rub the cursor over it to pet it. |
| Keyboard | Click it, then use ← → (or A D) to move and Space to jump (double jump and wall jump work). With wings on, every Space in the air is another flap, and holding it glides. Jump into the side of a window to climb it: ↑ ↓ climb, and it pulls itself up onto the title bar. **E** fires the rope at the cursor. **Esc** lets go. |
| Chat | Double-click it, or press **Ctrl+Alt+C**. |
| Voice | **Ctrl+Alt+V**, or the mic button in the chat box. Or turn on **Listen for my name** and just say "Pixel, …". |
| Hide or show | **Ctrl+Alt+H** |
| Menu | Right-click it, or use the tray icon (it wears the same hat as your buddy). |

If another app already uses one of these hotkeys, it picks a free fallback; the tray menu and **Settings → App** show the active ones.

### Things to ask

- "Pixel, create a folder named Test Folder" (use its name, or no name at all)
- "make a text file called ideas with the text buy milk"
- "open Spotify" · "go to youtube.com" · "search for pizza near me"
- "set a timer for 5 minutes" · "remind me at 5pm to call mom"
- "focus for 25 minutes" · "pause the timer" · "take a break"
- "let's play fetch" · "play hide and seek" · "let's box"
- "turn into a ghost" · "walk like a penguin" · "leave a trail of hearts" · "give yourself wings" · "fly around"
- "take a note: …" · "read my notes" · "remember that …"
- "pause the music" · "next song" · "turn it up"
- "what's on my desktop" · "how's my computer doing" · "take a screenshot"
- "dance" · "swing on your rope" · "climb the Spotify window" · "go to the other screen"

Common commands run instantly without the AI. Anything else goes to the local AI, which can chain actions ("make a folder for my Japan trip with a packing list in it"). It only creates and opens things inside your user folders. It deletes only by moving things to the Recycle Bin, and always asks first.

## Settings

Double-click the tray icon (or **Settings…** in its menu). There's a little room at the top where your buddy tries on whatever you change.

| Section | What's in it |
|---|---|
| Buddy | Name, size (0.01% to 500%), personality (cheerful, chill, sassy, pirate, shy, hype, or your own words), how chatty it is |
| Wardrobe | 10 body shapes (classic, mochi, bean, toast, pear, heart, star, ghost, slime, cloud), arms (nubby, noodle, tiny, cartoon gloves, paws, wings, none), legs (stubby, noodle, sneakers, boots, paws, stick, or hover), antenna tips, colors, 13 hats, glasses, neckwear, and ready-made outfits (or "Surprise me") |
| Moves | Walk style (natural, walk, hop, waddle, strut, tiptoe, float, roll, robot), what it does standing around (breathe, bob, sway, bounce, wiggle, still), a trail (sparkles, hearts, bubbles, music, stars, rainbow), how jiggly it is, and one-click whole characters ("Spooky ghost", "Bouncy slime", "Robo toast"…). Every tile is a live preview. |
| Voice | Talking back (off, only when you talk to it, or always) with a Windows voice or a natural Piper voice; pitch, speed and volume; hands-free "listen for my name"; speech recognition download |
| Senses | Dancing to music, watching videos, what it listens to (everything, everything but voice-chat apps, or just the video's app), and how it reacts to notifications (peek, walk over, or just say it) |
| Focus | Pomodoro timer (it works on a tiny laptop next to you), breaks, stretch/water/eye-rest reminders, distraction nudges, quiet hours, cheering when downloads finish |
| Play | Fetch, hide and seek, and boxing pop-ups, with your best scores |
| Brain | Local AI status and model, what it remembers about you (and forgetting it) |
| App | Hotkeys, start with Windows, open the settings/log/data folders, reset |

Settings are saved in `%APPDATA%\Desktop Avatar\settings.json`. Notes go to `Documents\Desktop Avatar Notes.txt`; remembered facts, focus stats and the log live next to the settings.

## What it does on its own

- **Music:** it listens to what your PC plays (analyzed locally, never recorded) and dances on the beat.
- **Watch-along:** when a video starts, the AI decides whether to grab popcorn and watch it with you, and reacts to what's said. With "just the video", a Discord call never ends up in its comments.
- **Notifications:** when an app flashes in the taskbar or its unread count goes up ("(3) Discord"), it peeks at it or walks over. It never reads your messages.
- **Free time:** every few minutes the AI picks what to do next, based on its personality, the time of day, and what you're doing.
- **Fullscreen:** when one monitor goes fullscreen, it moves to the other monitor and stays there, holds its notifications and reminders, and during games unloads the AI model to free your GPU.

## Games

- **Fetch:** a ball appears. Grab it with the mouse and throw it anywhere, even onto the other monitor; it runs, jumps, climbs and ropes up to catch it, then brings it back.
- **Hide and seek:** it hides behind the edge of one of your windows (only where that edge is really visible) or just off the edge of the screen, and peeks out. It giggles more the closer your cursor gets. Click it to win. Move the window and it moves with it; cover its spot and it sneaks somewhere else.
- **Boxing pop-ups:** pretend pop-up windows ("YOU WON!!!", "Something went wrong", "Installing update 3 of 999"…) drop onto the desktop and it punches them around until they break. Click one to throw a punch yourself. Only these fake windows get punched, never your real apps. It puts its cartoon gloves on to play, and with gloves on it sometimes shadow-boxes a pop-up on its own.

## Wings and gloves

Some arms change what it can do. **Wings** let it fly: it flaps up to window tops (even ones far too high to jump to), glides back down, and flies after the ball in fetch. **Cartoon gloves** make it a boxer (see above). Hover legs let any body float like the ghost.

## Development

```
npm test                          # unit tests: parser, actions, physics, games, focus, listening, wake word...
node test-e2e/ai.e2e.mjs          # live test of the command brain against the local model
npx electron . --harness          # start with the localhost test harness, then for example:
node test-e2e/overlay.e2e.mjs     # drag/throw, keyboard, rope, windows, monitors, fullscreen
npm run dist                      # build the installer into dist/
powershell -ExecutionPolicy Bypass -File tools\installer-test\run.ps1
                                  # click through that installer on a hidden desktop: install, reinstall, uninstall
```

To run a throwaway copy with its own settings, set `AVATAR_USER_DATA=<folder>` along with `--harness`. `AVATAR_FAKE_MIC=<file.wav>` plays a recording as the microphone (for the voice and wake-word tests), and `AVATAR_DOWNLOADS=<folder>` points the download cheer at a scratch folder. `node tools/h.js state` shows what the harness sees.

| Folder | What's in it |
|---|---|
| `src/main` | Electron main process: an overlay per monitor, window tracking (Win32 via koffi), the command engine, the AI director, voice, speech, focus, games, notifications, what the ears listen to |
| `src/main/native` | `AppLoopback.cs`, the per-app audio capture helper (built on first use by the C# compiler that comes with Windows) |
| `src/renderer/overlay` | The character: platformer physics, behavior, procedural Canvas art, outfits, props, speech bubbles |
| `src/renderer/settings` | The Settings window and its live preview room |
| `src/renderer/chat` | The chat box and the naming prompt |
| `src/renderer/services` | The hidden "ears": system-audio analysis, the wake-word listener, speaking, icon drawing |
| `personalities` | Preset personalities (plain English) |
