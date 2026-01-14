const { spawn } = require("child_process");
const { PassThrough } = require("stream");

// Supported audio formats configuration
const AUDIO_FORMATS = {
  pcm_s16le: {
    ffmpegInput: ["-f", "s16le", "-ar", "8000", "-ac", "1"],
    ffmpegOutput: [
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "-ar",
      "8000",
      "-ac",
      "1",
    ],
    inputBufferSize: 320, // 320 bytes (160 samples)
    outputBufferSize: 160, // 160 bytes (80 samples)
  },
  g711_ulaw: {
    ffmpegInput: ["-f", "mulaw", "-ar", "8000", "-ac", "1"],
    ffmpegOutput: [
      "-c:a",
      "pcm_mulaw",
      "-f",
      "mulaw",
      "-ar",
      "8000",
      "-ac",
      "1",
    ],
    inputBufferSize: 80, // Reduced from 160 to 80 μ-law samples
    outputBufferSize: 80, // Reduced from 160 to 80 μ-law samples
  },
  g711_alaw: {
    ffmpegInput: ["-f", "alaw", "-ar", "8000", "-ac", "1"],
    ffmpegOutput: ["-c:a", "pcm_alaw", "-f", "alaw", "-ar", "8000", "-ac", "1"],
    inputBufferSize: 80, // Reduced from 160 to 80 A-law samples
    outputBufferSize: 80, // Reduced from 160 to 80 A-law samples
  },
  opus: {
    ffmpegInput: ["-f", "ogg", "-c:a", "libopus"],
    ffmpegOutput: [
      "-c:a",
      "libopus",
      "-f",
      "ogg",
      "-ar",
      "8000",
      "-ac",
      "1",
      "-b:a",
      "16k",
    ],
    inputBufferSize: null, // Variable size for Opus
    outputBufferSize: null, // Variable size for Opus
  },
  mp3: {
    ffmpegInput: ["-f", "mp3"],
    ffmpegOutput: [
      "-c:a",
      "mp3",
      "-f",
      "mp3",
      "-ar",
      "8000",
      "-ac",
      "1",
      "-b:a",
      "32k",
    ],
    inputBufferSize: null, // Variable size for MP3
    outputBufferSize: null, // Variable size for MP3
  },
};

class AsteriskFullDuplexTranscoder {
  constructor(inputFormat = "pcm_s16le", outputFormat = "pcm_s16le") {
    this.inputFormat = inputFormat;
    this.outputFormat = outputFormat;

    // Decoder: inputFormat -> PCM16LE (untuk Asterisk audioSocket)
    this.decoderProcess = null;
    this.decoderInput = new PassThrough();
    this.asteriskOutput = new PassThrough(); // Always PCM16LE 320 byte

    // Encoder: PCM16LE -> outputFormat (dari Asterisk audioSocket)
    this.encoderProcess = null;
    this.asteriskInput = new PassThrough(); // Always expects PCM16LE 320 byte
    this.encoderOutput = new PassThrough();

    this.isRunning = false;
    this.inputConfig = AUDIO_FORMATS[inputFormat];
    this.outputConfig = AUDIO_FORMATS[outputFormat];

    if (!this.inputConfig || !this.outputConfig) {
      throw new Error(
        `Unsupported format. Supported: ${Object.keys(AUDIO_FORMATS).join(
          ", "
        )}`
      );
    }
  }

  start() {
    if (this.isRunning) return;
    console.log(
      `Starting transcoder: ${this.inputFormat} -> PCM16LE -> ${this.outputFormat}`
    );

    this._startDecoder();
    this._startEncoder();

    this.isRunning = true;
  }

  _startDecoder() {
    // Decoder: inputFormat -> PCM16LE for Asterisk
    const decoderArgs = [
      ...this.inputConfig.ffmpegInput,
      "-i",
      "pipe:0",

      // Always output PCM16LE @ 8kHz mono for Asterisk
      "-c:a",
      "pcm_s16le",
      "-f",
      "s16le",
      "-ar",
      "8000",
      "-ac",
      "1",

      // Real-time optimizations untuk mengurangi delay
      "-flush_packets",
      "1",
      "-fflags",
      "+nobuffer+flush_packets+genpts",
      "-flags",
      "+low_delay",
      "-avoid_negative_ts",
      "make_zero",
      "-max_delay",
      "0",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-bufsize",
      "64",
      "-max_muxing_queue_size",
      "1",

      "pipe:1",
    ];

    console.log("Decoder command:", decoderArgs.join(" "));

    this.decoderProcess = spawn("ffmpeg", decoderArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.decoderInput.pipe(this.decoderProcess.stdin);
    this.decoderProcess.stdout.pipe(this.asteriskOutput);

    this.decoderProcess.on("error", (err) => {
      console.error("Decoder FFmpeg error:", err);
    });

    this.decoderProcess.stderr.on("data", (data) => {
      console.log("Decoder stderr:", data.toString());
    });
  }

  _startEncoder() {
    // Encoder: PCM16LE from Asterisk -> outputFormat
    const encoderArgs = [
      "-f",
      "s16le",
      "-ar",
      "8000",
      "-ac",
      "1",
      "-i",
      "pipe:0",

      ...this.outputConfig.ffmpegOutput,

      // Real-time optimizations untuk mengurangi delay
      "-flush_packets",
      "1",
      "-fflags",
      "+nobuffer+flush_packets+genpts",
      "-flags",
      "+low_delay",
      "-avoid_negative_ts",
      "make_zero",
      "-max_delay",
      "0",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-bufsize",
      "64",
      "-max_muxing_queue_size",
      "1",

      "pipe:1",
    ];

    console.log("Encoder command:", encoderArgs.join(" "));

    this.encoderProcess = spawn("ffmpeg", encoderArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.asteriskInput.pipe(this.encoderProcess.stdin);
    this.encoderProcess.stdout.pipe(this.encoderOutput);

    this.encoderProcess.on("error", (err) => {
      console.error("Encoder FFmpeg error:", err);
    });

    this.encoderProcess.stderr.on("data", (data) => {
      console.log("Encoder stderr:", data.toString());
    });
  }

  // Input: External format -> untuk di-decode ke PCM16LE (ke Asterisk)
  writeInput(buffer) {
    if (!this.isRunning) return false;

    try {
      this.decoderInput.write(buffer);
      return true;
    } catch (err) {
      console.error("Error writing input:", err);
      return false;
    }
  }

  // Input: PCM16LE dari Asterisk -> untuk di-encode ke external format
  writeFromAsterisk(pcmBuffer) {
    if (!this.isRunning) return false;

    // Validate PCM buffer size (should be 320 bytes for 20ms @ 8kHz)
    if (pcmBuffer.length !== 320) {
      console.warn(
        `PCM buffer size mismatch: ${pcmBuffer.length}, expected: 320`
      );
    }

    try {
      this.asteriskInput.write(pcmBuffer);
      return true;
    } catch (err) {
      console.error("Error writing from Asterisk:", err);
      return false;
    }
  }

  // Output stream: PCM16LE untuk Asterisk audioSocket
  getAsteriskOutputStream() {
    return this.asteriskOutput;
  }

  // Output stream: External format hasil encoding
  getExternalOutputStream() {
    return this.encoderOutput;
  }

  stop() {
    if (!this.isRunning) return;

    this.decoderInput.end();
    this.asteriskInput.end();

    if (this.decoderProcess) {
      this.decoderProcess.kill("SIGTERM");
    }

    if (this.encoderProcess) {
      this.encoderProcess.kill("SIGTERM");
    }

    this.isRunning = false;
    console.log("Transcoder stopped");
  }

  // Get supported formats
  static getSupportedFormats() {
    return Object.keys(AUDIO_FORMATS);
  }

  // Get buffer size for specific format
  static getBufferSize(format, direction = "input") {
    const config = AUDIO_FORMATS[format];
    if (!config) return null;

    return direction === "input"
      ? config.inputBufferSize
      : config.outputBufferSize;
  }
}

// Buffer manager untuk timing dan queue management
class AsteriskBufferManager {
  constructor(transcoder) {
    this.transcoder = transcoder;
    this.externalInputQueue = []; // External format input queue
    this.asteriskInputQueue = []; // PCM from Asterisk queue
    this.inputTimer = null;
    this.outputTimer = null;

    // Callbacks
    this.onAsteriskData = null; // PCM16LE data untuk Asterisk audioSocket
    this.onExternalData = null; // External format data untuk network/file

    // Buffer sizes
    this.expectedPCMSize = 320; // 320 bytes (20ms @ 8kHz mono PCM16LE)
    
    // Optimasi untuk mengurangi delay
    this.processingImmediate = true; // Process immediately instead of waiting for timer
  }

  start() {
    this.transcoder.start();

    // Timer untuk external input processing (5ms untuk mengurangi delay lebih lanjut)
    this.inputTimer = setInterval(() => {
      if (this.externalInputQueue.length > 0) {
        const buffer = this.externalInputQueue.shift();
        this.transcoder.writeInput(buffer);
      }
    }, 5); // Reduced from 10ms to 5ms

    // Timer untuk Asterisk input processing (5ms untuk mengurangi delay lebih lanjut)
    this.outputTimer = setInterval(() => {
      if (this.asteriskInputQueue.length > 0) {
        const pcmBuffer = this.asteriskInputQueue.shift();
        this.transcoder.writeFromAsterisk(pcmBuffer);
      }
    }, 5); // Reduced from 10ms to 5ms

    // Setup output handlers
    this.transcoder.getAsteriskOutputStream().on("data", (pcmData) => {
      // Ensure 160-byte chunks for Asterisk audioSocket
      this._processPCMData(pcmData);
    });

    this.transcoder.getExternalOutputStream().on("data", (externalData) => {
      if (this.onExternalData) {
        this.onExternalData(externalData);
      }
    });
  }

  _processPCMData(pcmData) {
    // Split PCM data into 320-byte chunks for Asterisk
    let offset = 0;
    while (offset < pcmData.length) {
      const chunkSize = Math.min(320, pcmData.length - offset);
      const chunk = pcmData.slice(offset, offset + chunkSize);

      if (chunk.length === 320) {
        if (this.onAsteriskData) {
          this.onAsteriskData(chunk);
        }
      } else {
        console.warn(`PCM chunk size mismatch: ${chunk.length}, expected: 320`);
      }

      offset += chunkSize;
    }
  }

  // Add external format data untuk decode ke PCM (input direction)
  addExternalInput(buffer) {
    this.externalInputQueue.push(buffer);
    
    // Immediate processing untuk mengurangi delay
    if (this.processingImmediate && this.externalInputQueue.length > 0) {
      const buffer = this.externalInputQueue.shift();
      this.transcoder.writeInput(buffer);
    }
  }

  // Add PCM data dari Asterisk untuk encode ke external format (output direction)
  addAsteriskInput(pcmBuffer) {
    if (pcmBuffer.length === 320) { // 320 bytes
      this.asteriskInputQueue.push(pcmBuffer);
      
      // Immediate processing untuk mengurangi delay
      if (this.processingImmediate && this.asteriskInputQueue.length > 0) {
        const pcmBuffer = this.asteriskInputQueue.shift();
        this.transcoder.writeFromAsterisk(pcmBuffer);
      }
    } else {
      console.warn(
        `Asterisk PCM buffer size mismatch: ${pcmBuffer.length}, expected: 320`
      );
    }
  }

  // Set callbacks
  setOnAsteriskData(callback) {
    this.onAsteriskData = callback;
  }

  setOnExternalData(callback) {
    this.onExternalData = callback;
  }

  stop() {
    if (this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }

    if (this.outputTimer) {
      clearInterval(this.outputTimer);
      this.outputTimer = null;
    }

    this.transcoder.stop();
  }
}

module.exports = {
  AsteriskFullDuplexTranscoder,
  AsteriskBufferManager,
  AUDIO_FORMATS,
};
