const AudioStreamer = require("./lib");

// Contoh penggunaan
async function main() {
  const streamer = new AudioStreamer({
    chunkSize: 2560,
    interval: 160,
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

    await streamer.call("08110123123"); //call ke nomor tujuan
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
