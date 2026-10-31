# Script Desk: learn your lines

A phone-friendly study app (PWA) for learning a role in a Broadway Junior show. It was built for Jack in *Newsies JR.*, but it works with any MTI actor's script PDF.

The app contains **no script text**. On first launch you load the PDF; it is read and parsed on the device and stored only in that browser.

## How it works
- **Path:** one lesson per 5–7 lines, scene by scene and song by song, plus a **Scene Run** checkpoint at the end of each scene or song.
- **Lesson steps:** Meet (hear and read) → Build (tap words in order) → Fill (pick the missing word) → Hint (first letters only) → Recall (cold, from the cue). Missed lines come back at the end.
- **Review:** spaced repetition brings lines back just before they're forgotten.
- **Rehearse:** a scene partner reads the other parts aloud and stops on your lines. Modes: Cue me, Read-through, Graded.
- **Script:** the full script with your lines highlighted; turn on "Hide mine" to self-test.
- **Mic check:** where the browser supports it, the app listens and scores your line word by word. Self-grading always works.

## Put it on a phone
It needs to be served over HTTPS. Any static host works, because the app is just these files:
1. **Netlify Drop:** drag this folder onto https://app.netlify.com/drop (free account).
2. **GitHub Pages:** push the folder to a repo and turn on Pages.

On the phone: open the URL → Share → **Add to Home Screen**. Then get the PDF onto the phone (AirDrop, email, or Files/Google Drive) and tap **Load script PDF**.

## Local testing
```
python -m http.server 5610
```
Then open http://localhost:5610.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `parser.js`: turns the PDF into scenes, songs, lines and cues (uses pdf.js from cdnjs, which is cached for offline use after the first load)
- `sw.js`, `manifest.webmanifest`, `icons/`: install and offline support
