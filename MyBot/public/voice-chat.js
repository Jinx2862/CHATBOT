/**
 * voice-chat.js
 * ─────────────────────────────────────────────────────────────
 * Handles:
 *   - Microphone recording using MediaRecorder API
 *   - Sending audio to the backend voice pipeline
 *   - Playing back the audio response
 *   - Updating the chat UI with transcripts
 * ─────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ── Config ───────────────────────────────────────────────────────────────
  const API_BASE = "/api/voice";
  const MAX_RECORDING_SECONDS = 60;

  // ── State ────────────────────────────────────────────────────────────────
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingTimer = null;
  let recordingSeconds = 0;
  let isRecording = false;
  let currentAudio = null;
  let selectedLanguage = null; // null = auto-detect

  // ── DOM refs (populated after DOMContentLoaded) ──────────────────────────
  let micBtn, micIcon, micLabel, timerDisplay;
  let chatMessages, typingIndicator;
  let langSelector, textInput, sendTextBtn;

  // ── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    micBtn = document.getElementById("mic-btn");
    micIcon = document.getElementById("mic-icon");
    micLabel = document.getElementById("mic-label");
    timerDisplay = document.getElementById("mic-timer");
    chatMessages = document.getElementById("chat-messages");
    typingIndicator = document.getElementById("typing-indicator");
    langSelector = document.getElementById("language-selector");
    textInput = document.getElementById("text-input");
    sendTextBtn = document.getElementById("send-text-btn");

    if (micBtn) micBtn.addEventListener("click", toggleRecording);
    if (langSelector) langSelector.addEventListener("change", onLanguageChange);
    if (sendTextBtn) sendTextBtn.addEventListener("click", sendTextMessage);
    if (textInput) {
      textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendTextMessage();
        }
      });
    }

    // Load supported languages into selector
    loadSupportedLanguages();

    // Greet user
    appendBotMessage(
      "नमस्कार! मी मैत्री पोर्टलचा सहाय्यक आहे. तुम्ही मराठी, हिंदी किंवा इंग्रजी मध्ये बोलू शकता.",
      "Namaste! I am the Maitri portal assistant. You can speak in Marathi, Hindi, or English.",
      "mr"
    );
  });

  // ── Language selector ─────────────────────────────────────────────────────
  function onLanguageChange(e) {
    selectedLanguage = e.target.value || null;
  }

  async function loadSupportedLanguages() {
    try {
      const res = await fetch(`${API_BASE}/languages`);
      const data = await res.json();

      if (langSelector && data.languages) {
        // Clear existing options (except first "Auto-detect")
        langSelector.innerHTML =
          '<option value="">🌐 Auto-detect language</option>';
        data.languages.forEach((lang) => {
          const opt = document.createElement("option");
          opt.value = lang.code;
          opt.textContent = lang.name;
          langSelector.appendChild(opt);
        });
      }
    } catch (err) {
      console.warn("Could not load languages:", err);
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  async function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    // Check browser support
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Your browser does not support microphone access.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      // Pick the best supported MIME type
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType } : {};

      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      });

      mediaRecorder.addEventListener("stop", () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunks, {
          type: mimeType || "audio/webm",
        });
        processAudioBlob(blob, mimeType || "audio/webm");
      });

      mediaRecorder.start(250); // Collect data every 250ms
      isRecording = true;

      setMicState("recording");
      startTimer();

      // Auto-stop after MAX_RECORDING_SECONDS
      setTimeout(() => {
        if (isRecording) stopRecording();
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        showError(
          "Microphone permission denied. Please allow microphone access and try again."
        );
      } else {
        showError(`Could not start recording: ${err.message}`);
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      stopTimer();
      setMicState("processing");
    }
  }

  function getSupportedMimeType() {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
  }

  // ── Send audio to backend ─────────────────────────────────────────────────
  async function processAudioBlob(blob, mimeType) {
    // Show user's "voice bubble" in chat
    appendUserVoiceMessage();

    try {
      const formData = new FormData();
      const extension = mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("mp4")
        ? "mp4"
        : "webm";
      formData.append("audio", blob, `recording.${extension}`);
      if (selectedLanguage) {
        formData.append("language", selectedLanguage);
      }

      showTyping(true);

      const res = await fetch(`${API_BASE}/`, {
        method: "POST",
        body: formData,
      });

      showTyping(false);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      handleVoiceResponse(data);
    } catch (err) {
      showTyping(false);
      showError(`Voice processing failed: ${err.message}`);
    } finally {
      setMicState("idle");
    }
  }

  // ── Send text message ─────────────────────────────────────────────────────
  async function sendTextMessage() {
    if (!textInput) return;
    const text = textInput.value.trim();
    if (!text) return;

    textInput.value = "";
    appendUserTextMessage(text);

    try {
      showTyping(true);

      const res = await fetch(`${API_BASE}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language: selectedLanguage || null,
        }),
      });

      showTyping(false);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      handleVoiceResponse(data);
    } catch (err) {
      showTyping(false);
      showError(`Request failed: ${err.message}`);
    }
  }

  // ── Handle response from backend ─────────────────────────────────────────
  function handleVoiceResponse(data) {
    const {
      audio_base64,
      original_transcript,
      translated_answer,
      english_answer,
      detected_language,
      detected_language_name,
      stt_confidence,
    } = data;

    // Update the user's voice bubble with transcript
    updateLastUserBubbleTranscript(
      original_transcript,
      detected_language_name
    );

    // Show bot's response in chat
    const displayText =
      translated_answer !== english_answer ? translated_answer : english_answer;

    appendBotMessage(displayText, english_answer, detected_language);

    // Play audio response
    if (audio_base64) {
      playBase64Audio(audio_base64);
    }
  }

  // ── Audio playback ────────────────────────────────────────────────────────
  function playBase64Audio(base64String) {
    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audioSrc = `data:audio/mpeg;base64,${base64String}`;
    currentAudio = new Audio(audioSrc);

    currentAudio.addEventListener("ended", () => {
      currentAudio = null;
    });

    currentAudio.play().catch((err) => {
      console.warn("Audio autoplay blocked:", err);
      // Show a play button in the last bot message as fallback
      showPlayButtonFallback(base64String);
    });
  }

  function showPlayButtonFallback(base64String) {
    const messages = chatMessages.querySelectorAll(".message.bot");
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    const existingBtn = lastMsg.querySelector(".play-btn");
    if (existingBtn) return;

    const btn = document.createElement("button");
    btn.className = "play-btn";
    btn.innerHTML = "▶ Play Response";
    btn.addEventListener("click", () => {
      playBase64Audio(base64String);
      btn.remove();
    });
    lastMsg.querySelector(".message-content").appendChild(btn);
  }

  // ── Chat UI helpers ───────────────────────────────────────────────────────
  function appendUserTextMessage(text) {
    const msg = createMessageEl("user");
    msg.querySelector(".message-content").innerHTML = `
      <p>${escapeHtml(text)}</p>
    `;
    appendMessage(msg);
  }

  function appendUserVoiceMessage() {
    const msg = createMessageEl("user");
    msg.dataset.voicePending = "true";
    msg.querySelector(".message-content").innerHTML = `
      <p class="voice-pending">
        <span class="mic-pulse">🎙️</span>
        <em>Processing your voice...</em>
      </p>
    `;
    appendMessage(msg);
  }

  function updateLastUserBubbleTranscript(transcript, langName) {
    const pending = chatMessages.querySelector("[data-voice-pending='true']");
    if (!pending) return;
    pending.removeAttribute("data-voice-pending");
    pending.querySelector(".message-content").innerHTML = `
      <p>${escapeHtml(transcript)}</p>
      <span class="lang-tag">🎙️ ${langName}</span>
    `;
  }

  function appendBotMessage(displayText, englishText, langCode) {
    const msg = createMessageEl("bot");
    const isEnglish = langCode === "en";

    msg.querySelector(".message-content").innerHTML = `
      <p>${escapeHtml(displayText)}</p>
      ${
        !isEnglish && englishText && englishText !== displayText
          ? `<details class="english-translation">
               <summary>View in English</summary>
               <p>${escapeHtml(englishText)}</p>
             </details>`
          : ""
      }
    `;
    appendMessage(msg);
  }

  function createMessageEl(role) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = `
      <div class="message-avatar">${role === "bot" ? "🏛️" : "👤"}</div>
      <div class="message-content"></div>
    `;
    return div;
  }

  function appendMessage(el) {
    if (typingIndicator) {
      chatMessages.insertBefore(el, typingIndicator);
    } else {
      chatMessages.appendChild(el);
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTyping(show) {
    if (typingIndicator) {
      typingIndicator.style.display = show ? "flex" : "none";
    }
    if (chatMessages)
      chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showError(message) {
    const msg = createMessageEl("bot");
    msg.querySelector(".message-content").innerHTML = `
      <p class="error-msg">⚠️ ${escapeHtml(message)}</p>
    `;
    msg.querySelector(".message-avatar").textContent = "⚠️";
    appendMessage(msg);
    setMicState("idle");
  }

  // ── Mic button states ─────────────────────────────────────────────────────
  function setMicState(state) {
    if (!micBtn) return;
    micBtn.className = `mic-btn mic-${state}`;

    const states = {
      idle: { icon: "🎙️", label: "Tap to speak" },
      recording: { icon: "⏹️", label: "Recording... tap to stop" },
      processing: { icon: "⏳", label: "Processing..." },
    };

    const s = states[state] || states.idle;
    if (micIcon) micIcon.textContent = s.icon;
    if (micLabel) micLabel.textContent = s.label;
    micBtn.disabled = state === "processing";
  }

  // ── Timer ────────────────────────────────────────────────────────────────
  function startTimer() {
    recordingSeconds = 0;
    updateTimerDisplay();
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(recordingTimer);
    if (timerDisplay) timerDisplay.textContent = "";
  }

  function updateTimerDisplay() {
    if (!timerDisplay) return;
    const remaining = MAX_RECORDING_SECONDS - recordingSeconds;
    timerDisplay.textContent = `${recordingSeconds}s / ${MAX_RECORDING_SECONDS}s`;
    if (remaining <= 10) {
      timerDisplay.style.color = "var(--color-danger, #e53e3e)";
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str || ""));
    return div.innerHTML;
  }

  // Expose for debugging
  window._voiceChat = { stopRecording, playBase64Audio };
})();
