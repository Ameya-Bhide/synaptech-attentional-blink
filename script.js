/**
 * Synaptech Attentional Blink Experiment
 *
 * Static browser experiment: RSVP of letters with two digit targets (T1, T2).
 * Independent variable: lag between T1 and T2.
 * Key DV: P(T2 correct | T1 correct).
 */

// =============================================================================
// Configuration — tune these before club testing
// =============================================================================

/** Duration each RSVP item is shown (ms). */
const ITEM_DURATION_MS = 100;

/** Fixation cross duration before RSVP (ms). */
const FIXATION_DURATION_MS = 500;

/**
 * Lag = number of RSVP positions from T1 to T2 (inclusive of T2, standard AB).
 *
 * Lag 1: T1, T2                 (adjacent)
 * Lag 2: T1, letter, T2         (one intervening item)
 * Lag 3: T1, letter, letter, T2
 * ...
 *
 * Internally: index(T2) - index(T1) === lag
 * Number of intervening distractors between T1 and T2 = lag - 1.
 */
const LAGS = [1, 2, 3, 5, 7];

/** Experimental trials per lag condition. */
const TRIALS_PER_LAG = 10;

/** Practice trials before the main experiment (not exported). */
const PRACTICE_TRIALS = 5;

/**
 * Fixed RSVP stream length (items). Typical AB streams are ~18–20.
 * With T1 at positions 7–9 and max lag 7, T2 lands by position 16,
 * leaving several trailing distractors.
 */
const STREAM_LENGTH = 20;

/**
 * T1 serial positions (1-indexed), chosen randomly per trial.
 * Randomizing T1 location reduces temporal predictability.
 */
const T1_POSITIONS = [7, 8, 9];

/**
 * Letter distractors — uppercase, excluding I/O (resemble 1/0).
 */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

/**
 * Digit targets — exclude 0/1 (resemble O/I).
 */
const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9];

/** Brief pause after practice feedback before next trial (ms). */
const PRACTICE_FEEDBACK_MS = 1200;

/** Total experimental trials (lags × trials per lag). */
const TOTAL_EXPERIMENTAL_TRIALS = LAGS.length * TRIALS_PER_LAG;

/**
 * Google Apps Script web app URL (/exec).
 * Paste the deployed web app URL here before club use.
 */
const RESULTS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwTmNb_JB9YQulvXDy44qNKH4_gnz_2f0xKm0I0juOlZq9vnYoRsRE9L4V1fdEktsvMCw/exec";

/** Bumped when the exported data schema or paradigm changes. */
const EXPERIMENT_VERSION = "1.0";

const LOCAL_STORAGE_KEY = "attentionalBlinkResults";

// =============================================================================
// Experiment state
// =============================================================================

/** @type {'instructions'|'practice'|'practice-complete'|'experiment'|'finished'} */
let state = "instructions";

let participantId = "";
let practiceTrials = [];
let experimentalTrials = [];
let results = [];
let currentTrialIndex = 0;
let experimentRunning = false;
let submitting = false;
let focusLostDuringTrial = false;
let resultsSubmitted = false;
let submissionInProgress = false;

// =============================================================================
// DOM references
// =============================================================================

const screens = {
  instructions: document.getElementById("screen-instructions"),
  rsvp: document.getElementById("screen-rsvp"),
  response: document.getElementById("screen-response"),
  practiceComplete: document.getElementById("screen-practice-complete"),
  finished: document.getElementById("screen-finished"),
};

const stimulusEl = document.getElementById("stimulus");
const participantIdDisplay = document.getElementById("participant-id-display");
const finishedParticipantId = document.getElementById("finished-participant-id");
const btnBeginPractice = document.getElementById("btn-begin-practice");
const btnBeginExperiment = document.getElementById("btn-begin-experiment");
const responseForm = document.getElementById("response-form");
const responseT1 = document.getElementById("response-t1");
const responseT2 = document.getElementById("response-t2");
const responseError = document.getElementById("response-error");
const progressEl = document.getElementById("progress");
const practiceFeedback = document.getElementById("practice-feedback");
const summaryTable = document.getElementById("summary-table");
const resultsFallback = document.getElementById("results-fallback");
const btnCopy = document.getElementById("btn-copy");
const btnDownload = document.getElementById("btn-download");
const btnSubmit = document.getElementById("btn-submit-results");
const copyStatus = document.getElementById("copy-status");
const submitStatus = document.getElementById("submit-status");
const trialsRecordedEl = document.getElementById("trials-recorded");

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Auto-assign a participant ID that is unique across concurrent browsers.
 * Combines a timestamp fragment with random bits (no names, no manual entry).
 * Example: P-M5K2XQ-A7F3
 */
function generateParticipantId() {
  const timePart = Date.now().toString(36).toUpperCase();
  let randPart = "";
  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(3);
    window.crypto.getRandomValues(bytes);
    randPart = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
      .slice(0, 4);
  } else {
    randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  return `P-${timePart}-${randPart}`;
}

function assignParticipantId() {
  participantId = generateParticipantId();
  if (participantIdDisplay) {
    participantIdDisplay.textContent = participantId;
  }
  return participantId;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fisher–Yates shuffle (in place). Returns the same array. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickUniqueDigits() {
  const shuffled = shuffleArray([...DIGITS]);
  return [shuffled[0], shuffled[1]];
}

function randomLetter(used) {
  let letter;
  do {
    letter = randomChoice(LETTERS);
  } while (used.has(letter));
  used.add(letter);
  return letter;
}

// =============================================================================
// Stimulus generation
// =============================================================================

/**
 * Build one trial for a given lag.
 *
 * Stream is STREAM_LENGTH items. T1 is placed at a random 1-indexed
 * serial position from T1_POSITIONS (e.g. 7, 8, or 9). T2 follows at
 * the selected lag.
 *
 * Lag definition (unchanged): T2 index - T1 index === lag
 *   Lag 1 → T1 immediately followed by T2
 *   Lag 2 → one letter between T1 and T2
 *   …intervening distractors between T1 and T2 = lag - 1
 */
function generateTrial(lag) {
  const t1Position = randomChoice(T1_POSITIONS); // 1-indexed
  const t1Index = t1Position - 1; // 0-indexed
  const t2Index = t1Index + lag;

  if (t2Index >= STREAM_LENGTH) {
    console.error("T2 exceeds stream length", { lag, t1Position, STREAM_LENGTH });
  }

  const [t1, t2] = pickUniqueDigits();
  const usedLetters = new Set();
  const sequence = new Array(STREAM_LENGTH);

  sequence[t1Index] = String(t1);
  sequence[t2Index] = String(t2);

  for (let i = 0; i < STREAM_LENGTH; i++) {
    if (sequence[i] === undefined) {
      sequence[i] = randomLetter(usedLetters);
    }
  }

  // Sanity: lag placement
  if (t2Index - t1Index !== lag) {
    console.error("Lag placement error", { lag, t1Index, t2Index, sequence });
  }

  return {
    lag,
    t1,
    t2,
    t1_position: t1Position,
    t1Index,
    t2Index,
    stream_length: STREAM_LENGTH,
    sequence,
  };
}

/**
 * Build full experimental set: TRIALS_PER_LAG for each lag, then shuffle.
 */
function generateTrials() {
  const trials = [];
  for (const lag of LAGS) {
    for (let i = 0; i < TRIALS_PER_LAG; i++) {
      trials.push(generateTrial(lag));
    }
  }
  return shuffleArray(trials);
}

function generatePracticeTrials() {
  // Mix of lags so practice feels like the real task
  const practiceLags = [1, 2, 3, 5, 7];
  const trials = [];
  for (let i = 0; i < PRACTICE_TRIALS; i++) {
    trials.push(generateTrial(practiceLags[i % practiceLags.length]));
  }
  return shuffleArray(trials);
}

// =============================================================================
// UI helpers
// =============================================================================

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.add("hidden");
  }
  screens[name].classList.remove("hidden");
}

function clearStimulus() {
  stimulusEl.textContent = "";
}

function setStimulus(text) {
  stimulusEl.textContent = text;
}

function hideResponseControls() {
  practiceFeedback.classList.add("hidden");
  practiceFeedback.textContent = "";
  practiceFeedback.classList.remove("correct", "incorrect");
  responseError.classList.add("hidden");
  responseT1.value = "";
  responseT2.value = "";
  responseForm.querySelectorAll("input, button").forEach((el) => {
    el.disabled = false;
  });
}

function parseDigit(value) {
  const trimmed = String(value).trim();
  if (!/^[0-9]$/.test(trimmed)) return null;
  return Number(trimmed);
}

// =============================================================================
// RSVP / trial runner
// =============================================================================

async function showRSVP(sequence) {
  clearStimulus();
  for (const item of sequence) {
    // Replace (never stack) — only one character visible at a time
    setStimulus(item);
    await sleep(ITEM_DURATION_MS);
  }
  clearStimulus();
}

/**
 * Run a single trial: fixation → RSVP → collect response → score.
 * @param {object} trial
 * @param {{ isPractice: boolean, trialNumber: number, totalTrials: number }} opts
 * @returns {Promise<object|null>} scored result for experimental trials; null for practice
 */
async function runTrial(trial, opts) {
  focusLostDuringTrial = false;
  experimentRunning = true;

  // 1. Fixation
  showScreen("rsvp");
  setStimulus("+");
  await sleep(FIXATION_DURATION_MS);

  // 2–4. RSVP stream, then clear
  await showRSVP(trial.sequence);

  experimentRunning = false;

  // 5–8. Response
  const response = await collectResponse(opts);

  const scored = scoreTrial(trial, response, opts);

  if (opts.isPractice) {
    await showPracticeFeedback(scored);
    return null;
  }

  return scored;
}

function collectResponse(opts) {
  return new Promise((resolve) => {
    hideResponseControls();

    if (opts.isPractice) {
      progressEl.textContent = `Practice ${opts.trialNumber} of ${opts.totalTrials}`;
    } else {
      progressEl.textContent = `Trial ${opts.trialNumber} of ${opts.totalTrials}`;
    }

    showScreen("response");
    submitting = false;

    // Focus first field after paint
    requestAnimationFrame(() => {
      responseT1.focus();
    });

    const onSubmit = (event) => {
      event.preventDefault();
      if (submitting) return;

      const r1 = parseDigit(responseT1.value);
      const r2 = parseDigit(responseT2.value);

      if (r1 === null || r2 === null) {
        responseError.classList.remove("hidden");
        return;
      }

      responseError.classList.add("hidden");
      submitting = true;

      // Prevent double submission
      responseForm.querySelectorAll("input, button").forEach((el) => {
        el.disabled = true;
      });

      responseForm.removeEventListener("submit", onSubmit);

      resolve({
        response_t1: r1,
        response_t2: r2,
        focus_lost: focusLostDuringTrial ? 1 : 0,
        timestamp: new Date().toISOString(),
      });
    };

    responseForm.addEventListener("submit", onSubmit);
  });
}

function scoreTrial(trial, response, opts) {
  const r1 = response.response_t1;
  const r2 = response.response_t2;

  // Strict ordered scoring (report slot must match target identity)
  const t1_correct = r1 === trial.t1 ? 1 : 0;
  const t2_correct = r2 === trial.t2 ? 1 : 0;

  // Identity / order-robust scoring (useful when same-category targets reverse)
  const order_reversed = r1 === trial.t2 && r2 === trial.t1 ? 1 : 0;
  const both_targets_identified =
    (t1_correct === 1 && t2_correct === 1) || order_reversed === 1 ? 1 : 0;
  const response_order_correct =
    t1_correct === 1 && t2_correct === 1 ? 1 : 0;

  return {
    participant_id: participantId,
    trial: opts.trialNumber,
    lag: trial.lag,
    t1: trial.t1,
    t2: trial.t2,
    t1_position: trial.t1_position,
    stream_length: trial.stream_length,
    response_t1: r1,
    response_t2: r2,
    t1_correct,
    t2_correct,
    response_order_correct,
    both_targets_identified,
    order_reversed,
    item_duration_ms: ITEM_DURATION_MS,
    focus_lost: response.focus_lost,
    timestamp: response.timestamp,
    experiment_version: EXPERIMENT_VERSION,
    // Full RSVP stream for this trial (array; Apps Script stringifies for Sheets)
    sequence: [...trial.sequence],
  };
}

async function showPracticeFeedback(scored) {
  practiceFeedback.classList.remove("hidden", "correct", "incorrect");

  if (scored.response_order_correct === 1) {
    practiceFeedback.textContent = "Correct";
    practiceFeedback.classList.add("correct");
  } else if (scored.order_reversed === 1) {
    practiceFeedback.textContent =
      `Both numbers seen, but order was reversed (targets were ${scored.t1} then ${scored.t2})`;
    practiceFeedback.classList.add("incorrect");
  } else {
    practiceFeedback.textContent = `Targets were ${scored.t1} and ${scored.t2}`;
    practiceFeedback.classList.add("incorrect");
  }

  await sleep(PRACTICE_FEEDBACK_MS);
}

// =============================================================================
// Phase runners
// =============================================================================

async function runPracticePhase() {
  state = "practice";
  practiceTrials = generatePracticeTrials();

  for (let i = 0; i < practiceTrials.length; i++) {
    await runTrial(practiceTrials[i], {
      isPractice: true,
      trialNumber: i + 1,
      totalTrials: practiceTrials.length,
    });
  }

  state = "practice-complete";
  const countEl = document.getElementById("experiment-trial-count");
  if (countEl) countEl.textContent = String(TOTAL_EXPERIMENTAL_TRIALS);
  showScreen("practiceComplete");
}

async function runExperimentPhase() {
  state = "experiment";
  experimentalTrials = generateTrials();
  results = [];
  currentTrialIndex = 0;

  // Verify lag counts (dev check)
  const lagCounts = {};
  for (const t of experimentalTrials) {
    lagCounts[t.lag] = (lagCounts[t.lag] || 0) + 1;
  }
  console.log("Experimental lag counts:", lagCounts);

  for (let i = 0; i < experimentalTrials.length; i++) {
    currentTrialIndex = i;
    const scored = await runTrial(experimentalTrials[i], {
      isPractice: false,
      trialNumber: i + 1,
      totalTrials: experimentalTrials.length,
    });
    if (scored) results.push(scored);
  }

  finishExperiment();
}

function finishExperiment() {
  state = "finished";
  resultsSubmitted = false;
  submissionInProgress = false;

  const summary = calculateSummary(results);
  renderSummary(summary);

  const tsv = formatResultsForSheets(results);
  resultsFallback.value = tsv;

  if (trialsRecordedEl) {
    trialsRecordedEl.textContent = `${results.length} / ${TOTAL_EXPERIMENTAL_TRIALS} trials recorded`;
  }
  if (finishedParticipantId) {
    finishedParticipantId.textContent = participantId;
  }

  resetSubmitButtonUI();

  try {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        experiment_version: EXPERIMENT_VERSION,
        participant_id: participantId,
        saved_at: new Date().toISOString(),
        trials: results,
      })
    );
  } catch (err) {
    console.warn("localStorage backup failed:", err);
  }

  showScreen("finished");
}

// =============================================================================
// Scoring / summary / export
// =============================================================================

/**
 * For each lag (ordered scoring — the on-screen summary DV):
 *   - n trials
 *   - T1 accuracy = mean(t1_correct)
 *   - T2 | T1 = mean(t2_correct) among trials where t1_correct === 1
 *     (T1-wrong trials excluded from the denominator)
 *   - usable = count of T1-correct trials contributing to T2|T1
 */
function calculateSummary(trialResults) {
  const byLag = {};

  for (const lag of LAGS) {
    byLag[lag] = {
      lag,
      n: 0,
      t1Correct: 0,
      t2GivenT1: 0,
      t1CorrectCount: 0,
    };
  }

  for (const row of trialResults) {
    const bucket = byLag[row.lag];
    if (!bucket) continue;
    bucket.n += 1;
    bucket.t1Correct += row.t1_correct;
    if (row.t1_correct === 1) {
      bucket.t1CorrectCount += 1;
      bucket.t2GivenT1 += row.t2_correct;
    }
  }

  return LAGS.map((lag) => {
    const b = byLag[lag];
    const t1Accuracy = b.n > 0 ? b.t1Correct / b.n : null;
    const t2GivenT1Accuracy =
      b.t1CorrectCount > 0 ? b.t2GivenT1 / b.t1CorrectCount : null;
    return {
      lag: b.lag,
      n: b.n,
      t1Accuracy,
      t2GivenT1Accuracy,
      t1CorrectCount: b.t1CorrectCount,
    };
  });
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function renderSummary(summary) {
  const rows = summary
    .map(
      (s) => `
      <tr>
        <td>${s.lag}</td>
        <td>${s.n}</td>
        <td>${formatPercent(s.t1Accuracy)}</td>
        <td>${formatPercent(s.t2GivenT1Accuracy)}</td>
        <td>${s.t1CorrectCount}/${s.n}</td>
      </tr>`
    )
    .join("");

  summaryTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Lag</th>
          <th>Trials</th>
          <th>T1 accuracy</th>
          <th>T2 | T1 correct</th>
          <th>Usable (T1 correct)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

const EXPORT_HEADERS = [
  "participant_id",
  "trial",
  "lag",
  "t1",
  "t2",
  "t1_position",
  "stream_length",
  "response_t1",
  "response_t2",
  "t1_correct",
  "t2_correct",
  "response_order_correct",
  "both_targets_identified",
  "order_reversed",
  "item_duration_ms",
  "focus_lost",
  "timestamp",
  "experiment_version",
  "sequence",
];

/** Serialize a field for TSV/CSV (arrays → JSON string). */
function exportCellValue(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  return value ?? "";
}

function formatResultsForSheets(trialResults) {
  const lines = [EXPORT_HEADERS.join("\t")];
  for (const row of trialResults) {
    lines.push(EXPORT_HEADERS.map((h) => exportCellValue(row[h])).join("\t"));
  }
  return lines.join("\n");
}

function formatResultsCSV(trialResults) {
  const lines = [EXPORT_HEADERS.join(",")];
  for (const row of trialResults) {
    lines.push(
      EXPORT_HEADERS.map((h) => {
        const s = String(exportCellValue(row[h]));
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      }).join(",")
    );
  }
  return lines.join("\n");
}

async function copyResults() {
  const text = formatResultsForSheets(results);
  resultsFallback.value = text;

  try {
    await navigator.clipboard.writeText(text);
    const original = btnCopy.textContent;
    btnCopy.textContent = "Copied!";
    copyStatus.textContent = "Results copied to clipboard.";
    copyStatus.classList.remove("hidden");
    setTimeout(() => {
      btnCopy.textContent = original;
    }, 2000);
  } catch (err) {
    copyStatus.textContent =
      "Clipboard blocked — select the text below and copy manually.";
    copyStatus.classList.remove("hidden");
    resultsFallback.focus();
    resultsFallback.select();
  }
}

function downloadCSV() {
  const csv = formatResultsCSV(results);
  const safeId = (participantId || "unknown").replace(/[^\w.-]/g, "_");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attentional-blink-${safeId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// Google Sheets submission (Apps Script web app)
// =============================================================================

function resetSubmitButtonUI() {
  if (!btnSubmit) return;
  btnSubmit.textContent = "Submit Results";
  btnSubmit.disabled = false;
  if (submitStatus) {
    submitStatus.textContent = "";
    submitStatus.classList.add("hidden");
    submitStatus.classList.remove("ok", "error");
  }
}

function setSubmitStatus(message, kind) {
  if (!submitStatus) return;
  submitStatus.textContent = message;
  submitStatus.classList.remove("hidden", "ok", "error");
  if (kind) submitStatus.classList.add(kind);
}

async function submitResults() {
  if (resultsSubmitted || submissionInProgress) return;
  if (!results.length) {
    setSubmitStatus("No results to submit.", "error");
    return;
  }

  if (
    !RESULTS_ENDPOINT ||
    RESULTS_ENDPOINT === "PASTE_WEB_APP_URL_HERE"
  ) {
    console.error("RESULTS_ENDPOINT is not configured.");
    btnSubmit.textContent = "Submission failed";
    setSubmitStatus(
      "Submission is not configured yet. Your results are still available on this page. Please use Copy Results or Download CSV as a backup.",
      "error"
    );
    return;
  }

  submissionInProgress = true;
  btnSubmit.disabled = true;
  btnSubmit.textContent = "Submitting...";
  setSubmitStatus("Sending results…", null);

  const payload = {
    experiment_version: EXPERIMENT_VERSION,
    trials: results,
  };

  console.log("Submitting results...", payload);

  try {
    const response = await fetch(RESULTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log("Submission response:", responseText);

    let parsed = null;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      console.warn("Could not parse submission response as JSON:", parseErr);
    }

    const ok =
      response.ok &&
      parsed &&
      parsed.success === true;

    if (!ok) {
      throw new Error(
        (parsed && parsed.error) ||
          `Submission failed (HTTP ${response.status})`
      );
    }

    resultsSubmitted = true;
    btnSubmit.textContent = "Results submitted ✓";
    btnSubmit.disabled = true;
    const rows =
      typeof parsed.rows_added === "number"
        ? ` (${parsed.rows_added} rows)`
        : "";
    setSubmitStatus(
      `Your results were added to the class dataset${rows}.`,
      "ok"
    );
  } catch (err) {
    console.error("Submission failed:", err);
    resultsSubmitted = false;
    submissionInProgress = false;
    btnSubmit.textContent = "Submission failed";
    btnSubmit.disabled = false;
    setSubmitStatus(
      "Your results are still available on this page. Please use Copy Results or Download CSV as a backup.",
      "error"
    );
    // After a brief moment, restore the default label for retry clarity
    setTimeout(() => {
      if (!resultsSubmitted && !submissionInProgress) {
        btnSubmit.textContent = "Submit Results";
      }
    }, 2000);
    return;
  }

  submissionInProgress = false;
}

// =============================================================================
// Input guards
// =============================================================================

// Ignore keystrokes during RSVP (except we don't need to do much —
// response form is hidden). Block form autofill noise during stream.
document.addEventListener(
  "keydown",
  (event) => {
    if (experimentRunning) {
      // Prevent accidental browser shortcuts / scrolling during RSVP
      if (event.key === " " || event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
      }
    }
  },
  true
);

// Digit-only inputs: keep only first digit typed
function restrictToDigit(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "");
    input.value = digits.slice(0, 1);
  });
}

restrictToDigit(responseT1);
restrictToDigit(responseT2);

// Auto-advance to T2 after entering T1
responseT1.addEventListener("input", () => {
  if (responseT1.value.length === 1) {
    responseT2.focus();
  }
});

// Flag focus loss during a trial (fixation/RSVP or while answering)
window.addEventListener("blur", () => {
  if (state === "practice" || state === "experiment") {
    focusLostDuringTrial = true;
  }
});

document.addEventListener("visibilitychange", () => {
  if (
    document.hidden &&
    (state === "practice" || state === "experiment")
  ) {
    focusLostDuringTrial = true;
  }
});

// =============================================================================
// Entry points
// =============================================================================

btnBeginPractice.addEventListener("click", () => {
  if (!participantId) assignParticipantId();
  btnBeginPractice.disabled = true;
  runPracticePhase();
});

btnBeginExperiment.addEventListener("click", () => {
  btnBeginExperiment.disabled = true;
  runExperimentPhase();
});

btnCopy.addEventListener("click", () => {
  copyResults();
});

btnDownload.addEventListener("click", () => {
  downloadCSV();
});

if (btnSubmit) {
  btnSubmit.addEventListener("click", () => {
    submitResults();
  });
}

// Initial screen — assign ID immediately so concurrent participants diverge
assignParticipantId();
showScreen("instructions");
