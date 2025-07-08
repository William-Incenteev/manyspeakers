const socket = io();

const peers = {};
const dataChannels = {};
const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const roomInfo = document.getElementById('room-info');
const hostControls = document.getElementById('host-controls');
const messageInput = document.getElementById('message-input');
const sendMessageBtn = document.getElementById('send-message-btn');
const youtubeUrlInput = document.getElementById('youtube-url-input');
const downloadBtn = document.getElementById('download-btn');
const audioPlayer = document.getElementById('audio-player');

let audioChunks = [];
const peersReady = new Set();

function setupDataChannelHandlers(dataChannel, targetSocketId) {
    dataChannel.onopen = () => {
        console.log(`[Client] Data channel with ${targetSocketId} is OPEN.`);
        dataChannels[targetSocketId] = dataChannel;
    };

    dataChannel.onclose = () => {
        console.log(`[Client] Data channel with ${targetSocketId} is CLOSED.`);
        delete dataChannels[targetSocketId];
        delete peers[targetSocketId];
    };

    dataChannel.onmessage = (event) => {
        if (event.data instanceof Blob) {
            console.log(`[Client] Received audio file from ${targetSocketId}`);
            const audioUrl = URL.createObjectURL(event.data);
            audioPlayer.src = audioUrl;
            roomInfo.textContent = 'Song received! Ready to play.';
            // Notify the host that we are ready
            dataChannel.send(JSON.stringify({ type: 'ready' }));
        } else {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'play') {
                    console.log('[Client] Received PLAY command.');
                    audioPlayer.play();
                } else if (message.type === 'ready') {
                    console.log(`[Client] Peer ${targetSocketId} is ready to play.`);
                    peersReady.add(targetSocketId);
                    // Check if all peers are ready
                    if (peersReady.size === Object.keys(dataChannels).length) {
                        console.log('[Client] All peers are ready. Broadcasting PLAY command.');
                        for (const id in dataChannels) {
                            dataChannels[id].send(JSON.stringify({ type: 'play' }));
                        }
                        // Also play on the host's machine
                        audioPlayer.play();
                    }
                }
            } catch (e) {
                // It's just a simple text message
                console.log(`[Client] Received message from ${targetSocketId}:`, event.data);
            }
        }
    };

    dataChannel.onerror = (error) => {
        console.error(`[Client] Data channel error with ${targetSocketId}:`, error);
    };
}

function createPeerConnection(targetSocketId, isInitiator) {
    console.log(`[Client] Creating peer connection to ${targetSocketId}, initiator: ${isInitiator}`);
    const pc = new RTCPeerConnection(STUN_SERVERS);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`[Client] Sending ICE candidate to ${targetSocketId}`);
            socket.emit('ice-candidate', {
                target: targetSocketId,
                candidate: event.candidate,
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`[Client] Connection state with ${targetSocketId} changed: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
            console.log(`[Client] PEER CONNECTION ESTABLISHED WITH ${targetSocketId}`);
        }
    };

    if (isInitiator) {
        console.log(`[Client] Creating data channel for ${targetSocketId}`);
        const dataChannel = pc.createDataChannel('data');
        setupDataChannelHandlers(dataChannel, targetSocketId);
        // If we are creating the connection, we are the host.
        hostControls.style.display = 'block';
    } else {
        pc.ondatachannel = (event) => {
            console.log(`[Client] Received data channel from ${targetSocketId}`);
            const dataChannel = event.channel;
            setupDataChannelHandlers(dataChannel, targetSocketId);
        };
    }

    peers[targetSocketId] = pc;
    return pc;
}

createRoomBtn.addEventListener('click', () => {
    console.log('[Client] "Create Room" button clicked.');
    socket.emit('create-room');
});

joinRoomBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value;
    console.log(`[Client] "Join Room" button clicked for room: ${roomId}`);
    if (roomId) {
        socket.emit('join-room', roomId);
    }
});

socket.on('connect', () => {
    console.log('Connected to server!');
});

socket.on('room-created', (roomId) => {
    console.log(`[Client] Received 'room-created' event with ID: ${roomId}`);
    roomInfo.textContent = `Room created! ID: ${roomId}`;
});

socket.on('room-joined', (roomId, otherUsers) => {
    console.log(`[Client] Received 'room-joined' event for room: ${roomId}`);
    console.log(`[Client] Other users in room: ${otherUsers}. Waiting for their offers.`);
    roomInfo.textContent = `Joined room: ${roomId}`;
    // The new user will now passively wait for offers from existing users.
    // The offer initiation logic that was here has been removed to prevent glare.
});

socket.on('room-not-found', () => {
    console.log("[Client] Received 'room-not-found' event.");
    roomInfo.textContent = 'Room not found.';
});

socket.on('error', (message) => {
    console.log(`[Client] Received 'error' event: ${message}`);
    roomInfo.textContent = `Error: ${message}`;
});

socket.on('user-joined', (socketId) => {
    console.log(`[Client] A new user has joined the room: ${socketId}. Initiating peer connection.`);
    const pc = createPeerConnection(socketId, true);
    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            console.log(`[Client] Sending offer to ${socketId}`);
            socket.emit('offer', {
                target: socketId,
                offer: pc.localDescription
            });
        })
        .catch(e => console.error("[Client] Error creating offer:", e));
});

socket.on('offer', (payload) => {
    console.log(`[Client] Received 'offer' from ${payload.from}`);
    const pc = createPeerConnection(payload.from, false);
    pc.setRemoteDescription(new RTCSessionDescription(payload.offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => {
            console.log(`[Client] Sending answer to ${payload.from}`);
            socket.emit('answer', {
                target: payload.from,
                answer: pc.localDescription
            });
        })
        .catch(e => console.error("[Client] Error handling offer:", e));
});

socket.on('answer', (payload) => {
    console.log(`[Client] Received 'answer' from ${payload.from}`);
    const pc = peers[payload.from];
    if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription(payload.answer))
            .catch(e => console.error("[Client] Error setting remote description for answer:", e));
    }
});

socket.on('ice-candidate', (payload) => {
    console.log(`[Client] Received 'ice-candidate' from ${payload.from}`);
    const pc = peers[payload.from];
    if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
            .catch(e => console.error("[Client] Error adding received ICE candidate:", e));
    }
});

sendMessageBtn.addEventListener('click', () => {
    const message = messageInput.value;
    if (message) {
        console.log(`[Client] Sending message to all peers: ${message}`);
        for (const socketId in dataChannels) {
            dataChannels[socketId].send(message);
        }
        messageInput.value = '';
    }
});

downloadBtn.addEventListener('click', () => {
    const url = youtubeUrlInput.value;
    if (url) {
        console.log(`[Client] Requesting download for URL: ${url}`);
        socket.emit('download-song', url);
        youtubeUrlInput.value = '';
        roomInfo.textContent = 'Downloading, please wait...';
    }
});

socket.on('song-downloaded', (base64Audio) => {
    console.log('[Client] Song downloaded. Decoding and sharing.');
    try {
        const byteCharacters = atob(base64Audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const audioBlob = new Blob([byteArray], { type: 'audio/mp4' });

        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioUrl;
        roomInfo.textContent = `Download Finished! Sharing with peers...`;

        console.log('[Client] Sharing audio file with all peers.');
        peersReady.clear(); 
        for (const socketId in dataChannels) {
            dataChannels[socketId].send(audioBlob);
        }
        
        if (Object.keys(dataChannels).length === 0) {
            roomInfo.textContent = 'Ready to play.';
        }
    } catch (e) {
        console.error('[Client] Error decoding or handling the downloaded song:', e);
        roomInfo.textContent = 'Error: Could not process the downloaded song.';
    }
});

socket.on('download-error', (message) => {
    console.error(`[Client] Download error: ${message}`);
    roomInfo.textContent = `Error: ${message}`;
});
