const fs = require("fs");
const WebSocket = require("ws");
const io = require("socket.io-client");
const axios = require("axios");
require("dotenv/config");
const {
  AsteriskFullDuplexTranscoder,
  AsteriskBufferManager,
} = require("./transcoding");

const https = require("https");

const path = require("path");

function createWavHeader({
  sampleRate = 8000,
  numChannels = 1,
  bitsPerSample = 16,
  dataLength = 0, // bisa 0 dulu, nanti diperbarui
} = {}) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  header.write("RIFF", 0); // ChunkID
  header.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  header.write("WAVE", 8); // Format
  header.write("fmt ", 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  header.write("data", 36); // Subchunk2ID
  header.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return header;
}

function createWavWriteStream(outputPath) {
  const ws = fs.createWriteStream(outputPath);
  const header = createWavHeader(); // dummy header
  ws.write(header); // tulis header di awal

  let dataLength = 0;

  return {
    write: (chunk) => {
      dataLength += chunk.length;
      return ws.write(chunk);
    },
    end: () => {
      ws.end(() => {
        // Buka kembali dan perbarui header
        const fd = fs.openSync(outputPath, "r+");
        const realHeader = createWavHeader({ dataLength });
        fs.writeSync(fd, realHeader, 0, 44, 0);
        fs.closeSync(fd);
        console.log(`WAV file complete: ${outputPath}`);
      });
    },
  };
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // 🚫 Abaikan validasi sertifikat (hanya untuk dev!)
});

class AudioStreamer {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 1024; // 1024 atau 320
    this.interval = options.interval || 20; // 20ms atau 170ms
    this.io = null;
    this.isStreaming = false;
    this.audioBuffer = null;
    this.currentPosition = 0;
    //this.sessionId = null;
    this.lastSentTimeStamp = 0;
    this.filePath = null;
    this.ws = null;
    this.wsClient = new Map();
  }

  async call(phoneNumber) {
    const server = process.env.SOCKET_SERVER.match(/^wss/gi)
      ? process.env.SOCKET_SERVER.replaceAll(/^(wss)/gi, "https")
      : process.env.SOCKET_SERVER.replaceAll(/^(ws)/gi, "http");
    const data = await axios.post(
      server + "/pbx/call",
      {
        phoneNumber: String(phoneNumber),
        websocketUrl: "ws://158.140.178.178:4145",
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
      //this.sessionId = data.data.data.sessionId;
      // console.log(this.sessionId);
    }
    return data.data;
  }

  // Membaca file audio
  async readAudioFile(filePath) {
    filePath = this.filePath ? this.filePath : filePath;
    try {
      this.filePath = filePath;
      this.audioBuffer = fs.readFileSync(filePath);
      this.currentPosition = 0;
      //console.log(`Audio file loaded: ${this.audioBuffer.length} bytes`);
      return true;
    } catch (error) {
      console.error("Error reading audio file:", error);
      return false;
    }
  }

  // Koneksi ke WebSocket
  startWebsocketServer() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket.Server({ port: 4145 }, () => {
        console.log("WebSocket Server running at ws://localhost:4145");
      });

      this.ws.on("connection", (ws, req) => {
        console.log("Client connected", req.headers.sessionid);

        // this.wsClient.set(this.sessionId, ws);

        ws.on("message", (message) => {
          const json = JSON.parse(message.toString());
          if (json.event === "dialStatus") {
            console.log("Dial status:", json);
          }
        });

        this.startStreaming(ws, req.headers.sessionid);
        return;

        // Kirim pesan ke client
        //this.ws.send("Welcome to the WebSocket server!");
        const writer = createWavWriteStream(Date.now() + ".wav");

        const g711Transcoder = new AsteriskFullDuplexTranscoder(
          "g711_ulaw",
          "g711_ulaw"
        );
        const g711BufferManager = new AsteriskBufferManager(g711Transcoder);

        g711BufferManager.start();

        g711BufferManager.setOnAsteriskData((pcm) => {
          //console.log("pcm", pcm);
          // Kirim data segera tanpa delay
          //return;

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                event: "audio",
                sessionId: req.headers.sessionid,
                audioData: pcm.toString("base64"),
                audioFormat: "pcm16",
              })
            );
          }
        });

        g711BufferManager.setOnExternalData((g711Data) => {
          // console.log(
          //   `[G.711] μ-law data for network: ${g711Data.length} bytes`
          // );

          g711BufferManager.addExternalInput(g711Data);

          // Send over network or save to file

          // Echo test - send back as input
          // setTimeout(() => {
          //   g711BufferManager.addExternalInput(g711Data);
          // }, 50);
        });

        // setTimeout(() => {
        //   ws.send(
        //     JSON.stringify({
        //       event: "hangup",
        //       sessionId: req.headers.sessionid,
        //     })
        //   );
        // }, 1000 * Math.random() * 100);

        // Saat menerima pesan dari client
        ws.on("message", (message, isBinary) => {
          //console.log("Received:", isBinary ? message : message.toString());
          // Kirim balik pesan
          //this.ws.send(isBinary ? message : `Echo: ${message}`);

          const json = JSON.parse(message.toString());
          switch (json.event) {
            case "audio":
              //ws.send(message.toString());
              g711BufferManager.addAsteriskInput(
                Buffer.from(json.audioData, "base64")
              );
              writer.write(Buffer.from(json.audioData, "base64"));
              break;
            case "hangup":
              writer.end();
              break;
            default:
              console.log(json);
              break;
          }
        });

        // Saat client putus
        ws.on("close", () => {
          console.log("Client disconnected");
        });

        // Tangani error
        ws.on("error", (err) => {
          console.error("WebSocket error:", err);
        });
      });
      resolve();
    });
  }

  hangup() {}

  // Streaming audio ke WebSocket
  async startStreaming(ws, sessionId) {
    if (!this.audioBuffer && ws.readyState !== WebSocket.OPEN) {
      console.error("Audio buffer or WebSocket not ready");
      return;
    }

    this.isStreaming = true;
    this.currentPosition = 0;

    const streamInterval = setInterval(() => {
      if (!this.isStreaming) {
        clearInterval(streamInterval);
        return;
      }

      // Cek apakah masih ada data untuk dikirim
      if (this.currentPosition >= this.audioBuffer.length) {
        console.log("Streaming completed");
        // this.io.emit("checkPoint", {
        //   sessionId: this.sessionId,
        //   name: "stream end",
        // });
        clearInterval(streamInterval);
        this.isStreaming = false;
        this.readAudioFile(this.filePath);
        this.startStreaming(ws, sessionId);
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

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            event: "audio",
            sessionId: sessionId,
            audioFormat: "alaw",
            audioData: chunk.toString("base64"),
          })
        );
      }

      // this.io.emit(
      //   "audio",
      //   {
      //     sessionId: this.sessionId,
      //     audioData: chunk,
      //     audioFormat: "pcm16",
      //   },
      //   (ack) => {
      //     if (ack.success) {
      //       /*console.log(
      //         `Sent chunk: ${this.sessionId} ${chunk.length} bytes (pos: ${
      //           this.currentPosition
      //         }) drift: (latency: ${Math.abs(
      //           Math.abs(this.lastSentTimeStamp - Date.now()) - this.interval
      //         )} ms)`
      //       );*/
      //       //this.lastSentTimeStamp = Date.now();
      //     }
      //   }
      // );

      this.currentPosition = endPosition;
    }, this.interval);
  }

  // Stop streaming
  stopStreaming() {
    this.isStreaming = false;
    //this.io.emit("hangup", { sessionId: this.sessionId });
    console.log("Streaming stopped");
  }

  // Tutup koneksi
  close() {
    this.stopStreaming();
    // if (this.io) {
    //   this.io.disconnect();
    // }
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
