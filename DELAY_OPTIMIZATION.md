# Optimasi Delay pada Proses Transcoding

## Masalah yang Ditemukan

Delay sekitar 2 detik pada proses transcoding disebabkan oleh beberapa faktor:

### 1. Timer Interval yang Terlalu Lama
- **Sebelum**: Timer berjalan setiap 20ms
- **Setelah**: Timer berjalan setiap 10ms
- **Dampak**: Mengurangi latency dari 20ms menjadi 10ms

### 2. Buffer Queue Processing
- Data terakumulasi di queue sebelum diproses
- Menunggu timer untuk memproses data

### 3. FFmpeg Process Startup
- Waktu yang dibutuhkan untuk spawn FFmpeg process
- Initialize codec dan setup buffers

## Optimasi yang Dilakukan

### 1. Buffer Size Reduction
```javascript
// Buffer size dikurangi untuk mengurangi delay
pcm_s16le: {
  inputBufferSize: 160, // Reduced from 320 to 160 bytes
  outputBufferSize: 80, // Reduced from 160 to 80 bytes
}
```

### 2. Timer Interval Optimization
```javascript
// Timer interval dikurangi dari 10ms ke 5ms
setInterval(() => {
  // Process audio data
}, 5); // Reduced from 10ms to 5ms
```

### 3. PCM Chunk Size Reduction
```javascript
// PCM chunk size dikurangi dari 320 ke 160 bytes
this.expectedPCMSize = 160; // 10ms @ 8kHz mono PCM16LE
```

### 4. FFmpeg Buffer Optimization
```javascript
// Parameter tambahan untuk mengurangi buffer
"-bufsize", "64",
"-max_muxing_queue_size", "1",
```

### 3. WebSocket Processing
```javascript
// Kirim data segera tanpa delay
if (ws.readyState === WebSocket.OPEN) {
  ws.send(JSON.stringify({
    event: "audio",
    sessionId: req.headers.sessionid,
    audioData: pcm.toString("base64"),
    audioFormat: "pcm16",
  }));
}
```

## Hasil Optimasi

1. **Buffer Size**: 320 bytes → 160 bytes (50% pengurangan)
2. **Timer Interval**: 20ms → 5ms (75% pengurangan)
3. **PCM Chunk Size**: 320 bytes → 160 bytes (50% pengurangan)
4. **FFmpeg Buffer**: Ditambahkan `-bufsize 64` dan `-max_muxing_queue_size 1`
5. **Expected Delay**: Dari ~2000ms menjadi ~50-200ms

## Monitoring Delay

Untuk memantau delay, tambahkan logging:

```javascript
const startTime = Date.now();
// ... proses transcoding ...
const endTime = Date.now();
console.log(`Transcoding delay: ${endTime - startTime}ms`);
```

## Tips Tambahan

1. **Gunakan WebSocket Compression** jika memungkinkan
2. **Implementasi Jitter Buffer** untuk menstabilkan delay
3. **Monitor CPU Usage** FFmpeg process
4. **Optimasi Buffer Size** sesuai kebutuhan 