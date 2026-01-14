const fs = require("fs");
const WebSocket = require("ws");
const io = require("socket.io-client");
const axios = require("axios");
const { GoogleSpeech } = require("./google");
const { Transform } = require("stream");
require("dotenv/config");

const https = require("https");

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

class AudioStreamer {
  googlespeech = null;
  transformStream = null;
  ws = null;
  audioFormat = "l16-8k";

  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 1024;
    this.interval = options.interval || 20;
    this.io = null;
    this.isStreaming = false;
    this.audioBuffer = null;
    this.currentPosition = 0;
    this.sessionId = null;
    this.lastSentTimeStamp = 0;
    this.filePath = null;
    this.saveAudio = null;
    this.googlespeech = null;
    this.transformStream = null;
    this.ttsConnected = false;
    this.isSpeaking = false;
    this.isReconnecting = false;
    this.lastTranscript = "";
    this.lastTranscriptTime = 0;
    this.ttsQueue = [];
    this.isProcessingQueue = false;
    this.shouldAutoReconnect = true;
    this.reconnectPromise = null; // NEW: Track ongoing reconnection
  }

  async initTTS() {
    const API_KEY = process.env.ELEVENLABS_API_KEY;
    const VOICE_ID = process.env.VOICE_ID;

    return new Promise((resolve, reject) => {
      // Close existing connection if any
      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {
          // Ignore close errors
        }
        this.ws = null;
      }

      console.log("🔌 Connecting to TTS...");

      this.ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?output_format=pcm_8000`,
        {
          headers: {
            "xi-api-key": API_KEY,
          },
        }
      );

      this.ws.on("open", () => {
        console.log("✅ TTS connected");
        this.ttsConnected = true;
        this.isReconnecting = false;

        // Send initial config
        this.ws.send(
          JSON.stringify({
            text: " ",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
            xi_api_key: API_KEY,
          })
        );

        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          if (msg.audio) {
            const audioBuffer = Buffer.from(msg.audio, "base64");

            // Send audio to FreeSWITCH via socket
            if (this.io && this.io.connected && this.sessionId) {
              this.io.emit(
                "audio",
                {
                  sessionId: this.sessionId,
                  audioFormat: this.audioFormat,
                  audioData: audioBuffer,
                },
                (ack) => {
                  // Audio chunk sent
                }
              );
            }
          }

          // Detect when TTS finished speaking
          if (msg.isFinal) {
            console.log("🎤 TTS finished speaking");
            this.isSpeaking = false;

            // Reconnect akan terjadi otomatis di event 'close'
            // Kita tidak perlu panggil reconnect di sini
          }

          // Detect alignment (timing info)
          if (msg.alignment) {
            console.log("⏱️  Audio alignment received");
          }
        } catch (err) {
          console.error("❌ Error parsing TTS message:", err);
        }
      });

      this.ws.on("error", (error) => {
        console.error("❌ TTS WebSocket error:", error.message);
        this.ttsConnected = false;
      });

      this.ws.on("close", (code, reason) => {
        console.log(
          `🔌 TTS disconnected (code: ${code}, reason: ${reason || "none"})`
        );
        this.ttsConnected = false;

        // Auto-reconnect jika:
        // 1. Code 1000 (normal) DAN ada queue
        // 2. Code bukan 1000 (error) DAN shouldAutoReconnect = true
        const shouldReconnect =
          (code === 1000 && this.ttsQueue.length > 0) ||
          (code !== 1000 && this.shouldAutoReconnect);

        if (shouldReconnect && !this.isReconnecting) {
          console.log(
            `🔄 Auto-reconnecting (queue: ${this.ttsQueue.length})...`
          );
          setTimeout(() => {
            this.reconnectAndProcess();
          }, 500); // Delay sedikit untuk stabilitas
        }
      });

      // Timeout jika tidak connect dalam 10 detik
      setTimeout(() => {
        if (!this.ttsConnected) {
          reject(new Error("TTS connection timeout"));
        }
      }, 10000);
    });
  }

  // FIX: Reconnect dengan promise tracking untuk avoid race condition
  async reconnectAndProcess() {
    // Jika sudah ada reconnection yang berjalan, tunggu itu selesai
    if (this.reconnectPromise) {
      console.log("⏳ Waiting for existing reconnection...");
      try {
        await this.reconnectPromise;
      } catch (err) {
        console.error("❌ Previous reconnection failed:", err);
      }
      return;
    }

    if (this.isReconnecting) {
      console.log("⏳ Already reconnecting...");
      return;
    }

    this.isReconnecting = true;

    // Buat promise yang bisa di-track
    this.reconnectPromise = (async () => {
      try {
        console.log("🔄 Reconnecting TTS...");
        await this.initTTS();
        console.log("✅ Reconnection successful");

        // Tunggu sebentar sebelum process queue
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Process queue jika ada
        if (this.ttsQueue.length > 0) {
          console.log(`📤 Processing queue (${this.ttsQueue.length} items)...`);
          this.processQueue();
        }
      } catch (err) {
        console.error("❌ Reconnection failed:", err);
        this.isReconnecting = false;

        // Retry setelah delay jika masih ada queue
        if (this.ttsQueue.length > 0 && this.shouldAutoReconnect) {
          console.log("🔁 Retrying in 2 seconds...");
          setTimeout(() => {
            this.reconnectPromise = null;
            this.reconnectAndProcess();
          }, 2000);
        }
      } finally {
        this.reconnectPromise = null;
        this.isReconnecting = false;
      }
    })();

    return this.reconnectPromise;
  }

  async sendTextToTTS(text) {
    // Deduplicate lebih ketat
    const now = Date.now();
    const cleanText = text.trim();

    if (!cleanText) {
      console.log("⏭️  Skipping empty text");
      return;
    }

    if (
      cleanText === this.lastTranscript &&
      now - this.lastTranscriptTime < 3000
    ) {
      console.log("⏭️  Skipping duplicate transcript");
      return;
    }

    this.lastTranscript = cleanText;
    this.lastTranscriptTime = now;

    // Add to queue
    this.ttsQueue.push(cleanText);
    console.log(
      `📥 Added to queue: "${cleanText}" (queue: ${this.ttsQueue.length})`
    );

    // Process queue
    this.processQueue();
  }

  async processQueue() {
    // Already processing or no items
    if (this.isProcessingQueue || this.ttsQueue.length === 0) {
      return;
    }

    // Still speaking
    if (this.isSpeaking) {
      console.log("⏸️  TTS busy, queued: " + this.ttsQueue.length);
      return;
    }

    // Check if WebSocket is ready
    const wsReady =
      this.ws && this.ws.readyState === WebSocket.OPEN && this.ttsConnected;

    if (!wsReady) {
      console.log("❌ TTS not ready, reconnecting...");

      // Trigger reconnect jika belum ada
      if (!this.isReconnecting && !this.reconnectPromise) {
        this.reconnectAndProcess();
      }
      return;
    }

    this.isProcessingQueue = true;
    const text = this.ttsQueue.shift();

    console.log(
      `💬 Sending to TTS: "${text}" (remaining: ${this.ttsQueue.length})`
    );
    this.isSpeaking = true;

    try {
      // Send text to ElevenLabs
      this.ws.send(
        JSON.stringify({
          text: text,
          try_trigger_generation: true,
        })
      );

      // Flush - tell ElevenLabs to start generation
      this.ws.send(JSON.stringify({ text: "" }));
    } catch (err) {
      console.error("❌ Error sending to TTS:", err);
      this.isSpeaking = false;
      this.ttsConnected = false;

      // Put back in queue
      this.ttsQueue.unshift(text);

      // Trigger reconnect
      if (!this.isReconnecting) {
        this.reconnectAndProcess();
      }
    }

    this.isProcessingQueue = false;
  }

  async initSpeechRecognition() {
    const googlespeech = new GoogleSpeech();

    this.transformStream = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk);
      },
    });

    const asr = await googlespeech.recognation();
    this.transformStream.pipe(asr);

    // Event handler for final transcription
    googlespeech.on("transcription", ({ transcript, isFinal }) => {
      const cleanTranscript = transcript.trim();
      console.log(`🗣️  User said: "${cleanTranscript}" (final: ${isFinal})`);

      if (isFinal && cleanTranscript) {
        console.log(`✅ Processing final: "${cleanTranscript}"`);
        this.sendTextToTTS(cleanTranscript);
      }
    });

    // Event handler for interim results (optional)
    googlespeech.on("interim", (interim) => {
      // Don't log interim to reduce noise
    });

    // Handle errors
    googlespeech.on("error", (error) => {
      console.error("❌ Speech recognition error:", error);
    });

    this.googlespeech = googlespeech;
    return googlespeech;
  }

  async call(phoneNumber) {
    const server = process.env.SOCKET_SERVER.match(/^wss/gi)
      ? process.env.SOCKET_SERVER.replaceAll(/^(wss)/gi, "https")
      : process.env.SOCKET_SERVER.replaceAll(/^(ws)/gi, "http");

    const data = await axios.post(
      server + "/pbx/call",
      {
        phoneNumber: String(phoneNumber),
        audioFormat: this.audioFormat,
      },
      {
        httpsAgent,
        headers: {
          Authorization: "Bearer " + process.env.API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    if (data.data.data.sessionId) {
      this.sessionId = data.data.data.sessionId;
      console.log(`📞 Call initiated: ${this.sessionId}`);
    }

    return data.data;
  }

  async readAudioFile(filePath) {
    filePath = this.filePath ? this.filePath : filePath;
    try {
      this.filePath = filePath;
      this.audioBuffer = fs.readFileSync(filePath);
      this.currentPosition = 0;
      return true;
    } catch (error) {
      console.error("Error reading audio file:", error);
      return false;
    }
  }

  recordAudio() {
    this.saveAudio = fs.createWriteStream(`./${Date.now()}.raw`);
  }

  connectWebSocket(callback, cdrCallback) {
    return new Promise((resolve, reject) => {
      this.io = io(process.env.SOCKET_SERVER, {
        reconnectionDelayMax: 10000,
        transports: ["websocket"],
        rejectUnauthorized: false,
        auth: {
          token: process.env.API_KEY,
        },
      });

      this.io.on("connect", () => {
        console.log("🔗 Socket connected:", this.io.id);
        resolve();
      });

      this.io.on("newSession", (data) => {
        console.log("🆕 New session:", data);
        this.io.emit("joinRoom", { sessionId: this.sessionId });

        if (callback && typeof callback === "function") {
          callback(this.sessionId);
        }
      });

      this.io.on("roomJoined", (room) => {
        console.log("🚪 Room joined:", room);
      });

      this.io.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
        reject(error);
      });

      this.io.on("connect_error", (error) => {
        console.error("❌ Connection error:", error);
        reject(error);
      });

      this.io.on("hangup", (status) => {
        console.log("📴 Call hangup:", status);

        // Stop auto-reconnect
        this.shouldAutoReconnect = false;

        if (this.saveAudio) {
          this.saveAudio.end();
        }

        if (this.transformStream) {
          try {
            this.transformStream.unpipe();
            this.transformStream.end();
          } catch (e) {
            // Ignore
          }
        }

        if (this.googlespeech) {
          try {
            this.googlespeech.removeAllListeners();
            this.googlespeech.getClient().close();
          } catch (e) {
            // Ignore errors
          }
        }

        if (this.ws) {
          try {
            this.ws.close(1000, "Normal closure");
          } catch (e) {
            // Ignore errors
          }
        }

        // Clear queue
        this.ttsQueue = [];
        this.isSpeaking = false;
        this.isProcessingQueue = false;
        this.reconnectPromise = null;
      });

      this.io.on("disconnect", () => {
        console.log("🔌 Socket disconnected");
        this.isStreaming = false;
      });

      this.io.on("cdr", (cdr) => {
        console.log("📊 CDR received:", cdr);
        if (cdrCallback && typeof cdrCallback === "function") {
          cdrCallback(cdr.sessionId);
        }
        this.io.disconnect();
      });

      // Handler for incoming audio from FreeSWITCH
      this.io.on("audio", (audio) => {
        // Send audio to Google Speech Recognition only if not speaking
        if (this.transformStream && !this.isSpeaking) {
          this.transformStream.write(audio.audioData);
        }

        // Optional: save audio for debugging
        if (this.saveAudio) {
          this.saveAudio.write(audio.audioData);
        }
      });

      this.io.on("checkPoint", (data) => {
        if (data.name === "stream end") {
          console.log("📍 Stream checkpoint:", data.name);
        }
      });
    });
  }

  dialStatus(callback) {
    this.io.on("dialStatus", async (status) => {
      callback(status, this.io);
    });
  }

  hangup() {
    console.log("📴 Hanging up...");

    if (this.io && this.io.connected) {
      this.io.emit("hangup", { sessionId: this.sessionId });
    }
  }

  // Method to start voice bot with full integration
  async startVoiceBot() {
    try {
      console.log("🤖 Starting Voice Bot...");

      // Enable auto-reconnect
      this.shouldAutoReconnect = true;

      // 1. Init TTS connection
      await this.initTTS();

      // 2. Init Speech Recognition
      await this.initSpeechRecognition();

      console.log("✅ Voice Bot ready!");

      return true;
    } catch (error) {
      console.error("❌ Failed to start Voice Bot:", error);
      return false;
    }
  }

  // Method to send greeting when call connected
  async sendGreeting(greetingText = "Halo, ada yang bisa saya bantu?") {
    // Wait a bit to ensure call is connected
    setTimeout(() => {
      this.sendTextToTTS(greetingText);
    }, 1000);
  }

  sendEcho(log = false) {
    this.io.on("audio", (audio) => {
      if (this.saveAudio) {
        this.saveAudio.write(audio.audioData);
      }
      this.io.emit("audio", audio, (ack) => {
        if (log) {
          console.log(
            "🔊 Audio length:",
            audio.audioData.length,
            JSON.stringify(audio.audioData)
          );
        }
      });
    });
  }

  async startStreaming(codec = "l16-8k") {
    if (!this.audioBuffer || !this.io || !this.io.connected) {
      console.error("❌ Audio buffer or WebSocket not ready");
      return;
    }

    this.isStreaming = true;
    this.currentPosition = 0;

    const streamInterval = setInterval(() => {
      if (!this.isStreaming || !this.io.connected) {
        clearInterval(streamInterval);
        return;
      }

      if (this.currentPosition >= this.audioBuffer.length) {
        console.log("✅ Streaming completed");
        this.io.emit("checkPoint", {
          sessionId: this.sessionId,
          name: "stream end",
        });
        clearInterval(streamInterval);
        this.isStreaming = false;
        this.readAudioFile(this.filePath);
        this.startStreaming(codec);
        return;
      }

      const endPosition = Math.min(
        this.currentPosition + this.chunkSize,
        this.audioBuffer.length
      );

      const chunk = this.audioBuffer.subarray(
        this.currentPosition,
        endPosition
      );

      this.io.emit(
        "audio",
        {
          sessionId: this.sessionId,
          audioData: chunk,
          audioFormat: codec,
        },
        (ack) => {
          if (ack.success) {
            // Chunk sent successfully
          }
        }
      );

      this.currentPosition = endPosition;
    }, this.interval);
  }

  stopStreaming() {
    this.isStreaming = false;
    if (this.io && this.io.connected) {
      this.io.emit("hangup", { sessionId: this.sessionId });
    }
    console.log("⏹️  Streaming stopped");
  }

  close() {
    this.shouldAutoReconnect = false;
    this.stopStreaming();
    if (this.io) {
      this.io.disconnect();
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "Normal closure");
      } catch (e) {
        // Ignore
      }
    }
  }

  setChunkSize(size) {
    this.chunkSize = size;
    console.log(`📦 Chunk size set to: ${size}`);
  }

  setInterval(ms) {
    this.interval = ms;
    console.log(`⏱️  Interval set to: ${ms}ms`);
  }

  // Get connection status
  getStatus() {
    return {
      ttsConnected: this.ttsConnected,
      socketConnected: this.io?.connected || false,
      isSpeaking: this.isSpeaking,
      queueLength: this.ttsQueue.length,
      sessionId: this.sessionId,
      isReconnecting: this.isReconnecting,
    };
  }
}

module.exports = AudioStreamer;
