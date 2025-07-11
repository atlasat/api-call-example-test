## API CALL EXAMPLE

Copy .env.example to .env

set API_KEY

install package

```bash
npm install
```

## Start example

```bash
node index.js
```

# Audio Packet Timing Table

## 8000 Hz, 320 byte per packet (20ms audio)

| Bytes | Paket | Durasi (ms) | Timing | Network Efficiency |
| ----- | ----- | ----------- | ------ | ------------------ |
| 320   | 1x    | 20ms        | 20ms   | High overhead      |
| 640   | 2x    | 40ms        | 40ms   | High overhead      |
| 960   | 3x    | 60ms        | 60ms   | Medium overhead    |
| 1280  | 4x    | 80ms        | 80ms   | Good balance       |
| 1600  | 5x    | 100ms       | 100ms  | Good balance       |
| 1920  | 6x    | 120ms       | 120ms  | Good efficiency    |
| 2240  | 7x    | 140ms       | 140ms  | Good efficiency    |
| 2560  | 8x    | 160ms       | 160ms  | **⭐ OPTIMAL**     |
| 2880  | 9x    | 180ms       | 180ms  | High efficiency    |

## Rekomendasi

- **Real-time VoIP**: 80-160ms
- **Streaming**: 160-180ms
- **Optimal untuk network latency**: **160ms (2560 bytes)**

## Catatan

- Basis: 320 byte = 20ms audio pada 8000 Hz
- Ratio: 16 byte per millisecond
- Timing yang pas = kelipatan 20ms tanpa gap

```javascript
const streamer = new AudioStreamer({
  chunkSize: 2560,
  interval: 160,
});
```
