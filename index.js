const AudioStreamer = require("./lib");

// Contoh penggunaan
async function main() {
  const streamer = new AudioStreamer({
    chunkSize: 2732,
    interval: 170, // jika 2732 biasanya timing 170ms
  });

  try {
    // Baca file audio
    const success = await streamer.readAudioFile("chandra.pcm"); // ganti dengan path file audio
    if (!success) {
      console.error("Failed to read audio file");
      return;
    }

    await streamer.connectWebSocket(); // ganti dengan URL WebSocket server

    streamer.dialStatus(async (status) => {
      if (status.status === "Connected") {
        // Mulai streaming
        console.log("Starting audio streaming...");
        streamer.startStreaming();
      }
    });

    await streamer.call("0811123124"); //call ke nomor tujuan
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
