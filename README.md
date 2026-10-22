# Synaptech Attentional Blink Experiment

A browser-based **attentional blink** experiment for Synaptech club meetings.

Participants watch a rapid serial visual presentation (RSVP) of letters. Two digits (T1 and T2) appear in the stream. After each trial, they report both digits. The independent variable is the **lag** between T1 and T2. The main dependent variable is:

**P(T2 correct | T1 correct)**

All stimulus generation, timing, scoring, and result formatting run locally in the browser. No backend is required for version 1.

## Flow

1. Enter a participant ID (e.g. `P01`)
2. Read instructions
3. Complete ~5 practice trials (with brief feedback)
4. Complete 50 randomized experimental trials
5. View a summary by lag (including usable T1-correct trial counts)
6. **Copy Raw Results** and paste into a shared Google Sheet  
   (optional: **Download CSV**)

Practice trials are **not** included in the exported dataset.

## Local testing

Serve the folder over HTTP (opening `index.html` via `file://` may block clipboard access in some browsers):

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

Any static file server works (`npx serve`, VS Code Live Server, etc.).

## Deployment (Vercel)

1. Push this repository to GitHub.
2. In [Vercel](https://vercel.com), **Import** the repository.
3. Deploy with default **static site** settings.
4. No build command, no output directory override, and **no environment variables** are needed.

The deploy URL can be shared or turned into a QR code for the club meeting.

## Experiment design

| Setting | Value |
| --- | --- |
| Lags | 1, 2, 3, 5, 7 |
| Trials per lag | 10 |
| Experimental trials | 50 (shuffled; not blocked by lag) |
| Practice trials | 5 |
| Item duration | 100 ms |
| Fixation | 500 ms (`+`) |
| RSVP length | 20 items |
| T1 position | randomly 7, 8, or 9 (1-indexed) |

### Lag definition

Lag is the number of RSVP positions from T1 to T2 (standard attentional-blink sense):

- **Lag 1:** `T1`, `T2` (adjacent)
- **Lag 2:** `T1`, letter, `T2`
- **Lag 3:** `T1`, letter, letter, `T2`
- …and so on

In code: `index(T2) - index(T1) === lag`. Intervening distractors between T1 and T2 = `lag - 1`.

### Stimuli

- Distractors: uppercase letters, excluding `I` and `O`
- Targets: digits `2–9` (different for T1 and T2)
- Fixed 20-item stream; T1 randomly at serial positions 7–9; T2 by lag

### Scoring

Participants still report first and second number (order preserved).

Exported fields include:

| Field | Meaning |
| --- | --- |
| `t1_correct` / `t2_correct` | Strict ordered match (slot must be correct) |
| `response_order_correct` | Both slots correct in order |
| `both_targets_identified` | Both digits reported (any order) |
| `order_reversed` | Response was exactly T2 then T1 |

The on-screen summary still shows ordered **P(T2 correct \| T1 correct)** plus usable trial counts (`T1-correct / n` per lag). Identity / reversal fields are for later Colab analysis.

## Configuration

Important constants live at the top of [`script.js`](script.js):

```js
const ITEM_DURATION_MS = 100;
const FIXATION_DURATION_MS = 500;
const LAGS = [1, 2, 3, 5, 7];
const TRIALS_PER_LAG = 10;
const PRACTICE_TRIALS = 5;
const STREAM_LENGTH = 20;
const T1_POSITIONS = [7, 8, 9];
```

Adjust these after pilot testing; refresh the page to reset the experiment.

## Exported data

Tab-separated rows suitable for pasting into Google Sheets. Correctness fields use `1` / `0`.

CSV download filename: `attentional-blink-P07.csv`.

## Version 1 notes

- No automatic Google Sheets submission — copy/paste only.
- Refreshing the page resets the experiment cleanly.
- Files: `index.html`, `style.css`, `script.js`, `README.md`.
