const AudioStreamer = require("./wslib");

const sessions = new Map();

// Contoh penggunaan
async function main() {
  const streamer = new AudioStreamer({
    chunkSize: 320, //2732
    interval: 20,
  });

  try {
    // Baca file audio
    const success = await streamer.readAudioFile("chandra.alaw"); // ganti dengan path file audio
    if (!success) {
      console.error("Failed to read audio file");
      return;
    }

    await streamer.startWebsocketServer();

    //await streamer.call("1000"); //call ke nomor tujuan 1000 205002 08118448401 8990 08960865796 ->> production lama: 8990
    //await streamer.call("1000"); //call ke nomor tujuan 1000 205002 08118448401 8990 08960865796 ->> production lama: 8990

    for (let i = 0; i < 1; i++) {
      streamer.call("1000");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

for (let i = 0; i < 10; i++) {
  //main();
}

main();
//main();
