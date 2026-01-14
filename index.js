const AudioStreamer = require("./lib");

const sessions = new Map();

// Contoh penggunaan
async function main(phoneNumber = "0817208401") {
  const streamer = new AudioStreamer({
    chunkSize: 1920, //2732 2560
    interval: 120,
  });

  try {
    // Baca file audio
    const success = await streamer.readAudioFile("chandra.pcm"); // ganti dengan path file audio
    if (!success) {
      console.error("Failed to read audio file");
      return;
    }

    await streamer.connectWebSocket(
      (session) => {
        //sessions.set(session, []);
      },
      (sessionId) => {
        console.log(sessions.entries());
      }
    ); // ganti dengan URL WebSocket server

    streamer.dialStatus(async (status, socket) => {
      console.log("dial status", status);

      sessions.set(status.sessionId, [
        ...(sessions.has(status.sessionId)
          ? sessions.get(status.sessionId)
          : []),
        status.status,
      ]);

      if (status.status === "Ringing") {
        console.log("Call is ringing...");

        //streamer.recordAudio();
        //streamer.sendEcho(true);
        console.log("2️⃣  Initializing Voice Bot...");
        await streamer.startVoiceBot();

        // setTimeout(() => {
        //   streamer.hangup();
        // }, 5000);
      }

      if (status.status === "Connected") {
        // Mulai streaming
        console.log("Starting audio streaming...");
        // streamer.sendGreeting(
        //   "Halo, selamat datang. Ada yang bisa saya bantu hari ini?"
        // );
        //streamer.startStreaming();

        // setTimeout(() => {
        //   socket.emit("dtmf", {
        //     sessionId: status.sessionId,
        //     digit: "1",
        //     duration: 500,
        //   });
        // }, 5000); // stop after 20 seconds

        // setTimeout(() => {
        //   streamer.hangup();
        // }, 5000);
      }
    });

    await streamer.call(phoneNumber); //call ke nomor tujuan 1000 205002 08118448401 8990 089608675796 089608675796 ->> production lama: 8990
  } catch (error) {
    console.error("Error:", error);
  }
}

/**
 * invalid number test
 * 081384889101
 * 081384889101
 */

for (let i = 0; i < 30; i++) {
  //main(8000);
  //main("8000");
  //main("8000");
  setTimeout(() => {
    //main("8089");
  }, i * 2000);
}

main("8000");

//main();
