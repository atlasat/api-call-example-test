const { SpeechClient } = require("@google-cloud/speech").v1;
const { EventEmitter } = require("node:events");
//import * as googleTTS from "google-tts-api";
require("dotenv/config");

class GoogleSpeech extends EventEmitter {
  speechClient = null;
  request = {
    config: {
      encoding: "LINEAR16", //MULAW LINEAR16
      sampleRateHertz: 8000,
      languageCode: "id-ID",
      //languageCode: "en-US",
      useEnhanced: true,
      //model: "phone_call",
    },
    interimResults: true,
    // streamingFeatures: {
    //   voiceActivityTimeout: {
    //     speechStartTimeout: { seconds: 30 }, // Tunggu 30 detik sebelum bicara dimulai
    //     speechEndTimeout: { seconds: 10 }, // Tunggu 10 detik setelah bicara berhenti
    //   },
    // },
    //singleUtterance: true,
  };
  constructor() {
    super();
    this.request.config = {
      ...this.request.config,
      //encoding: encoding,
      //sampleRateHertz: sampleRateHertz,
    };
    this.speechClient = new SpeechClient();
  }

  getClient() {
    return this.speechClient;
  }

  async recognationManual(data) {
    const audio = {
      content: data.toString("base64"),
    };
    this.request = {
      ...this.request,
      audio: audio,
    };
    const [response] = await this.speechClient.recognize(this.request);
    const transcription = response.results
      .map((result) => result.alternatives[0].transcript)
      .join("\n");

    return transcription;
  }

  async recognation() {
    const stream = await this.speechClient.streamingRecognize(this.request);
    //stream.write(this.request);
    stream.on("error", console.error).on("data", (data) => {
      //console.log("data", data);
      if (data.results[0] && data.results[0].alternatives[0]) {
        this.emit("transcription", {
          transcript: data.results[0].alternatives[0].transcript,
          isFinal: data.results[0].isFinal,
        });
      }
    });
    return stream;
  }
}

module.exports = { GoogleSpeech };
