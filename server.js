const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const ytdl = require('@distube/ytdl-core');

// Use the cookie if it's provided in the environment variables
if (process.env.YOUTUBE_COOKIE && process.env.YOUTUBE_COOKIE.length > 0) {
    console.log('[Server] YouTube cookie found in environment variables. Applying it to ytdl-core.');
    ytdl.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
} else {
    console.log('[Server] WARNING: No YouTube cookie found. Downloads will likely fail on the live server.');
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, can be restricted later
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('a user connected:', socket.id);

    socket.on('create-room', () => {
        console.log(`[Server] User ${socket.id} is creating a room.`);
        const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        console.log(`[Server] Generated Room ID: ${roomId}`);
        socket.join(roomId);
        socket.emit('room-created', roomId);
        console.log(`[Server] User ${socket.id} created and joined room ${roomId}`);
    });

    socket.on('join-room', (roomId) => {
        console.log(`[Server] User ${socket.id} is attempting to join room ${roomId}`);
        const room = io.sockets.adapter.rooms.get(roomId);

        if (room) {
            const otherUsers = Array.from(room);
            socket.join(roomId);

            socket.emit('room-joined', roomId, otherUsers);
            console.log(`[Server] User ${socket.id} joined ${roomId}. Notified of users: ${otherUsers}`);

            socket.to(roomId).emit('user-joined', socket.id);
            console.log(`[Server] Notified room ${roomId} that ${socket.id} has joined.`);
        } else {
            socket.emit('room-not-found');
            console.log(`[Server] User ${socket.id} failed to join room ${roomId} (not found).`);
        }
    });

    socket.on('download-song', async ({ url }) => {
        console.log(`[Server] Received request to download: ${url}`);
        if (!ytdl.validateURL(url)) {
            return socket.emit('download-error', 'Invalid YouTube URL');
        }

        try {
            const info = await ytdl.getInfo(url);
            const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
            
            socket.emit('download-start', { title: info.videoDetails.title });
            console.log(`[Server] Streaming "${info.videoDetails.title}" to host ${socket.id}`);

            const stream = ytdl(url, { format: format });

            stream.on('data', (chunk) => {
                socket.emit('audio-chunk', chunk);
            });

            stream.on('end', () => {
                console.log(`[Server] Finished streaming to host ${socket.id}.`);
                socket.emit('download-complete');
            });

            stream.on('error', (err) => {
                 console.error('[Server] Stream error:', err);
                 socket.emit('download-error', 'Failed to process video.');
            });
        } catch (err) {
            console.error('[Server] Error getting YouTube info:', err);
            socket.emit('download-error', 'Failed to get video info.');
        }
    });

    // WebRTC Signaling Relays
    socket.on('offer', (payload) => {
        console.log(`[Server] Relaying offer from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('offer', { from: socket.id, offer: payload.offer });
    });

    socket.on('answer', (payload) => {
        console.log(`[Server] Relaying answer from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('answer', { from: socket.id, answer: payload.answer });
    });

    socket.on('ice-candidate', (payload) => {
        console.log(`[Server] Relaying ICE candidate from ${socket.id} to ${payload.target}`);
        io.to(payload.target).emit('ice-candidate', { from: socket.id, candidate: payload.candidate });
    });

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
