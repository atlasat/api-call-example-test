const fs = require("fs");
const WebSocket = require("ws");
const io = require("socket.io-client");
const axios = require("axios");
require("dotenv/config");

class AudioStreamer {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 1024; // 1024 atau 320
    this.interval = options.interval || 20; // 20ms atau 170ms
    this.io = null;
    this.isStreaming = false;
    this.audioBuffer = null;
    this.currentPosition = 0;
    this.sessionId = null;
  }

  async call(phoneNumber) {
    return axios.post(
      process.env.SOCKET_SERVER.replaceAll("wss", "https") + "/pbx/call",
      {
        phoneNumber: String(phoneNumber),
      },
      {
        headers: {
          Authorization: "Bearer " + process.env.API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
  }

  // Membaca file audio
  async readAudioFile(filePath) {
    try {
      this.audioBuffer = fs.readFileSync(filePath);
      this.currentPosition = 0;
      console.log(`Audio file loaded: ${this.audioBuffer.length} bytes`);
      return true;
    } catch (error) {
      console.error("Error reading audio file:", error);
      return false;
    }
  }

  // Koneksi ke WebSocket
  connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.io = io(process.env.SOCKET_SERVER, {
        reconnectionDelayMax: 10000,
        transports: ["websocket"],
        auth: {
          token: process.env.API_KEY,
        },
      });

      this.io.on("connect", () => {
        resolve();
      });

      this.io.on("newSession", (data) => {
        this.io.emit("joinRoom", { sessionId: data.sessionId });
        this.sessionId = data.sessionId;
      });

      this.io.on("error", (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      });

      this.io.on("connect_error", (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      });

      this.io.on("disconnect", () => {
        console.log("WebSocket disconnected");
        this.isStreaming = false;
      });

      this.io.on("checkPoint", (data) => {
        if (data.name === "stream end") {
          this.io.emit("hangup", { sessionId: this.sessionId });
        }
      });
    });
  }

  dialStatus(callback) {
    this.io.on("dialStatus", async (status) => {
      callback(status);
    });
  }

  // Streaming audio ke WebSocket
  startStreaming() {
    if (!this.audioBuffer || !this.io || !this.io.connected) {
      console.error("Audio buffer or WebSocket not ready");
      return;
    }

    this.isStreaming = true;
    this.currentPosition = 0;

    const streamInterval = setInterval(() => {
      if (!this.isStreaming || !this.io.connected) {
        clearInterval(streamInterval);
        return;
      }

      // Cek apakah masih ada data untuk dikirim
      if (this.currentPosition >= this.audioBuffer.length) {
        console.log("Streaming completed");
        this.io.emit("checkPoint", {
          sessionId: this.sessionId,
          name: "stream end",
        });
        clearInterval(streamInterval);
        this.isStreaming = false;
        return;
      }

      // Ambil chunk data
      const endPosition = Math.min(
        this.currentPosition + this.chunkSize,
        this.audioBuffer.length
      );

      const chunk = this.audioBuffer.subarray(
        this.currentPosition,
        endPosition
      );

      // Kirim chunk ke WebSocket
      //this.ws.send(chunk);

      this.io.emit(
        "audio",
        {
          sessionId: this.sessionId,
          audioData: chunk,
          audioFormat: "pcm16",
        },
        (ack) => {
          if (ack.success) {
            console.log(
              `Sent chunk: ${chunk.length} bytes (pos: ${this.currentPosition})`
            );
          }
        }
      );

      this.currentPosition = endPosition;
    }, this.interval);
  }

  // Stop streaming
  stopStreaming() {
    this.isStreaming = false;
    this.io.emit("hangup", { sessionId: this.sessionId });
    console.log("Streaming stopped");
  }

  // Tutup koneksi
  close() {
    this.stopStreaming();
    if (this.io) {
      this.io.disconnect();
    }
  }

  // Set chunk size
  setChunkSize(size) {
    this.chunkSize = size;
    console.log(`Chunk size set to: ${size}`);
  }

  // Set interval timing
  setInterval(ms) {
    this.interval = ms;
    console.log(`Interval set to: ${ms}ms`);
  }
}

module.exports = AudioStreamer;
