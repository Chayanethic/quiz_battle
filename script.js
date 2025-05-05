const socket = io();
let localStream;
let peerConnections = {};
let youtubePlayer;
let currentSong = null;
let isHost = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    // Screen navigation
    const screens = document.querySelectorAll('.screen');
    const showScreen = (screenId) => {
        screens.forEach(screen => screen.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
    };

    // Home screen buttons
    document.getElementById('create-room-btn').addEventListener('click', () => showScreen('create-screen'));
    document.getElementById('join-room-btn').addEventListener('click', () => showScreen('join-screen'));

    // Back buttons
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => showScreen('home-screen'));
    });

    // Create room
    document.getElementById('create-form').addEventListener('click', (e) => {
        e.preventDefault();
        const topic = document.getElementById('quiz-topic').value;
        const numQuestions = parseInt(document.getElementById('num-questions').value);
        const playerName = document.getElementById('host-name').value || 'Host';
        socket.emit('create-room', { topic, numQuestions, playerName });
    });

    // Join room
    document.getElementById('join-form').addEventListener('click', (e) => {
        e.preventDefault();
        const roomCode = document.getElementById('room-code').value.toUpperCase();
        const playerName = document.getElementById('player-name').value || 'Player';
        socket.emit('join-room', { roomCode, playerName });
    });

    // Copy room code
    document.getElementById('copy-btn').addEventListener('click', () => {
        const roomCode = document.getElementById('room-code-display').textContent;
        navigator.clipboard.writeText(roomCode).then(() => showNotification('Room code copied!'));
    });

    // Start game
    document.getElementById('start-game-btn').addEventListener('click', () => {
        socket.emit('start-game');
    });

    // Cancel game
    document.getElementById('cancel-game-btn').addEventListener('click', () => {
        socket.emit('cancel-game');
    });

    // Chat input
    document.getElementById('chat-form').addEventListener('click', (e) => {
        e.preventDefault();
        const message = document.getElementById('chat-input').value.trim();
        if (message) {
            socket.emit('chat-message', {
                roomCode: socket.roomCode,
                message,
                sender: socket.playerName,
                isEmoji: false
            });
            document.getElementById('chat-input').value = '';
        }
    });

    // Emoji reactions
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.textContent;
            socket.emit('chat-message', {
                roomCode: socket.roomCode,
                message: emoji,
                sender: socket.playerName,
                isEmoji: true
            });
        });
    });

    // Voice controls
    const micBtn = document.getElementById('mic-btn');
    const camBtn = document.getElementById('cam-btn');
    let isMicOn = false;
    let isCamOn = false;

    micBtn.addEventListener('click', toggleMic);
    camBtn.addEventListener('click', toggleCam);

    function toggleMic() {
        if (!localStream) return;
        isMicOn = !isMicOn;
        localStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
        micBtn.classList.toggle('active', isMicOn);
        micBtn.classList.toggle('muted', !isMicOn);
        updateMediaStatus();
    }

    function toggleCam() {
        if (!localStream) return;
        isCamOn = !isCamOn;
        localStream.getVideoTracks().forEach(track => track.enabled = isCamOn);
        camBtn.classList.toggle('active', isCamOn);
        updateMediaStatus();
    }

    function updateMediaStatus() {
        socket.emit('media-status', {
            roomCode: socket.roomCode,
            isSpeaking: isMicOn && !micBtn.classList.contains('muted'),
            isVideoOn: isCamOn,
            isMuted: !isMicOn
        });
    }

    // Mute all
    document.getElementById('mute-all-btn').addEventListener('click', () => {
        socket.emit('mute-all', { roomCode: socket.roomCode, muted: true });
    });

    // Music controls
    document.getElementById('music-form').addEventListener('click', (e) => {
        e.preventDefault();
        const query = document.getElementById('music-search').value.trim();
        if (query) {
            socket.emit('search-song', { roomCode: socket.roomCode, query });
            document.getElementById('music-search').value = '';
        }
    });

    document.getElementById('stop-song-btn').addEventListener('click', () => {
        socket.emit('stop-song', { roomCode: socket.roomCode });
    });

    // Socket.io event handlers
    socket.on('room-created', (data) => {
        socket.roomCode = data.roomCode;
        socket.playerName = document.getElementById('host-name').value || 'Host';
        isHost = true;
        document.getElementById('room-code-display').textContent = data.roomCode;
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('cancel-game-btn').style.display = 'block';
        document.getElementById('mute-all-btn').style.display = isHost ? 'block' : 'none';
        document.getElementById('music-controls').style.display = isHost ? 'block' : 'none';
        updatePlayerList(data.players);
        showScreen('waiting-screen');
        startMediaChat();
    });

    socket.on('room-joined', (data) => {
        socket.roomCode = data.roomCode;
        socket.playerName = document.getElementById('player-name').value || 'Player';
        isHost = false;
        document.getElementById('room-code-display').textContent = data.roomCode;
        document.getElementById('mute-all-btn').style.display = isHost ? 'block' : 'none';
        document.getElementById('music-controls').style.display = isHost ? 'block' : 'none';
        updatePlayerList(data.players);
        showScreen('waiting-screen');
        if (data.currentSong) {
            playSong(data.currentSong);
        }
        startMediaChat();
    });

    socket.on('player-joined', (data) => {
        updatePlayerList(data.players);
    });

    socket.on('player-left', (data) => {
        updatePlayerList(data.players);
        const peerId = Object.keys(peerConnections).find(id => !data.players.some(p => p.id === id));
        if (peerId && peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
            const videoFeed = document.querySelector(`.video-feed[data-peer-id="${peerId}"]`);
            if (videoFeed) videoFeed.remove();
        }
    });

    socket.on('new-question', (data) => {
        document.getElementById('question-counter').textContent = `Question ${data.questionIndex + 1} of ${data.totalQuestions}`;
        document.getElementById('question-text').textContent = data.question;
        const optionsContainer = document.getElementById('options-container');
        optionsContainer.innerHTML = '';
        data.options.forEach((option, index) => {
            const btn = document.createElement('button');
            btn.classList.add('option');
            btn.textContent = option;
            btn.addEventListener('click', () => submitAnswer(index, data));
            optionsContainer.appendChild(btn);
        });
        startTimer(data.timeLimit, data.serverTime);
        document.getElementById('music-controls').style.display = isHost ? 'block' : 'none';
        showScreen('quiz-screen');
    });

    socket.on('score-update', (data) => {
        updateLiveScores(data.players);
    });

    socket.on('question-results', (data) => {
        const options = document.querySelectorAll('.option');
        options.forEach((btn, index) => {
            btn.disabled = true;
            if (index === data.correctAnswer) {
                btn.classList.add('correct');
            } else if (data.players.find(p => p.id === socket.id)?.answers[data.questionIndex] === index) {
                btn.classList.add('incorrect');
            }
        });
        updateLiveScores(data.players);
    });

    socket.on('quiz-ended', (data) => {
        const finalScores = document.getElementById('final-scores');
        finalScores.innerHTML = '';
        data.players.forEach(player => {
            const div = document.createElement('div');
            div.classList.add('player-score');
            if (player.score === Math.max(...data.players.map(p => p.score))) {
                div.classList.add('winner');
            }
            div.innerHTML = `<span>${player.name}</span><span>${player.score} points</span>`;
            finalScores.appendChild(div);
        });
        showScreen('results-screen');
        stopMediaChat();
        if (youtubePlayer) youtubePlayer.stopVideo();
    });

    socket.on('game-cancelled', (data) => {
        showNotification(data.message);
        showScreen('home-screen');
        stopMediaChat();
        if (youtubePlayer) youtubePlayer.stopVideo();
    });

    socket.on('chat-message', (data) => {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message');
        if (data.isEmoji) {
            messageDiv.classList.add('emoji-message');
            messageDiv.textContent = data.message;
        } else {
            messageDiv.innerHTML = `<span class="sender">${data.sender}</span>: ${data.message} <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>`;
        }
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on('start-media-chat', (data) => {
        createPeerConnection(data.from);
    });

    socket.on('offer', async (data) => {
        const peerConnection = createPeerConnection(data.from);
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', { roomCode: socket.roomCode, answer, to: data.from });
        } catch (error) {
            console.error(`Failed to handle offer from ${data.from}:`, error);
        }
    });

    socket.on('answer', async (data) => {
        const peerConnection = peerConnections[data.from];
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (error) {
                console.error(`Failed to set answer from ${data.from}:`, error);
            }
        }
    });

    socket.on('ice-candidate', (data) => {
        const peerConnection = peerConnections[data.from];
        if (peerConnection) {
            try {
                peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                    .catch(error => console.error(`Failed to add ICE candidate from ${data.from}:`, error));
            } catch (error) {
                console.error(`Error processing ICE candidate from ${data.from}:`, error);
            }
        }
    });

    socket.on('media-status', (data) => {
        const playerLi = document.querySelector(`#connected-players li[data-player-id="${data.playerId}"] .player-status`);
        if (playerLi) {
            playerLi.classList.toggle('speaking', data.isSpeaking);
            playerLi.classList.toggle('video-on', data.isVideoOn);
            playerLi.classList.toggle('muted', data.isMuted);
        }
        const videoFeed = document.querySelector(`.video-feed[data-peer-id="${data.playerId}"] video`);
        if (videoFeed) {
            videoFeed.muted = data.isMuted;
        }
    });

    socket.on('mute-all', (data) => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => track.enabled = !data.muted);
            micBtn.classList.toggle('active', !data.muted);
            micBtn.classList.toggle('muted', data.muted);
            updateMediaStatus();
        }
    });

    socket.on('song-results', (data) => {
        const songResults = document.getElementById('song-results');
        songResults.innerHTML = '';
        data.songs.forEach(song => {
            const songDiv = document.createElement('div');
            songDiv.classList.add('song-result');
            songDiv.innerHTML = `
                <img src="${song.thumbnail}" alt="${song.title}">
                <span>${song.title}</span>
                <button class="music-btn">Play</button>
            `;
            songDiv.querySelector('button').addEventListener('click', () => {
                socket.emit('play-song', { roomCode: socket.roomCode, song });
            });
            songResults.appendChild(songDiv);
        });
        document.getElementById('current-song').textContent = currentSong ? `Playing: ${currentSong.title}` : 'No song playing';
    });

    socket.on('play-song', (data) => {
        playSong(data.song);
    });

    socket.on('stop-song', () => {
        if (youtubePlayer) {
            youtubePlayer.stopVideo();
            currentSong = null;
            document.getElementById('current-song').textContent = 'No song playing';
        }
    });

    socket.on('error', (data) => {
        showNotification(data.message);
    });

    // Helper functions
    function updatePlayerList(players) {
        const playerList = document.getElementById('connected-players');
        playerList.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.dataset.playerId = player.id;
            li.innerHTML = `
                <span class="player-status ${player.isSpeaking ? 'speaking' : ''} ${player.isVideoOn ? 'video-on' : ''} ${player.isMuted ? 'muted' : ''}"></span>
                ${player.name}
            `;
            playerList.appendChild(li);
        });
    }

    function updateLiveScores(players) {
        const scoreList = document.getElementById('live-player-scores');
        scoreList.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${player.name}</span><span>${player.score} points</span>`;
            scoreList.appendChild(li);
        });
    }

    function submitAnswer(index, questionData) {
        const responseTime = (Date.now() - (questionData.serverTime + (Date.now() - performance.now()))) / 1000;
        socket.emit('submit-answer', { answer: index, responseTime });
        document.querySelectorAll('.option').forEach(btn => btn.disabled = true);
        document.querySelectorAll('.option')[index].classList.add('selected');
    }

    function startTimer(timeLimit, serverTime) {
        const timerText = document.querySelector('.timer-text');
        const timerProgress = document.getElementById('timer-progress');
        const startTime = Date.now();
        const serverOffset = Date.now() - serverTime;

        const updateTimer = () => {
            const elapsed = (Date.now() - startTime + serverOffset) / 1000;
            const remaining = Math.max(0, timeLimit - elapsed);
            timerText.textContent = Math.ceil(remaining);
            const progress = (remaining / timeLimit) * 283;
            timerProgress.style.strokeDasharray = `${progress}, 283`;
            if (remaining <= 5) {
                document.getElementById('timer').classList.add('warning');
            } else {
                document.getElementById('timer').classList.remove('warning');
            }
            if (remaining > 0) {
                requestAnimationFrame(updateTimer);
            } else {
                document.querySelectorAll('.option').forEach(btn => btn.disabled = true);
            }
        };
        requestAnimationFrame(updateTimer);
    }

    function showNotification(message) {
        const notification = document.createElement('div');
        notification.classList.add('notification');
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.classList.add('show');
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }, 100);
    }

    async function startMediaChat() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            console.log('Local stream acquired:', localStream.id);
            isMicOn = true;
            isCamOn = true;
            micBtn.classList.add('active');
            camBtn.classList.add('active');
            updateMediaStatus();

            const localVideo = document.createElement('video');
            localVideo.srcObject = localStream;
            localVideo.autoplay = true;
            localVideo.muted = true;
            localVideo.classList.add('local-video');
            const videoFeed = document.createElement('div');
            videoFeed.classList.add('video-feed');
            videoFeed.dataset.peerId = socket.id;
            videoFeed.innerHTML = `<span class="player-name">${socket.playerName}</span>`;
            videoFeed.appendChild(localVideo);
            document.getElementById('video-container').appendChild(videoFeed);

            socket.emit('start-media-chat', { roomCode: socket.roomCode });
        } catch (error) {
            console.error('Failed to get user media:', error);
            if (error.name === 'NotAllowedError') {
                showNotification('Camera/microphone access denied. Please allow access.');
            } else {
                showNotification('Failed to start video chat. Check camera/microphone.');
            }
        }
    }

    function stopMediaChat() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        document.getElementById('video-container').innerHTML = '';
        isMicOn = false;
        isCamOn = false;
        micBtn.classList.remove('active');
        camBtn.classList.remove('active');
    }

    function createPeerConnection(peerId) {
        if (peerConnections[peerId]) return peerConnections[peerId];

        const peerConnection = new RTCPeerConnection(configuration);
        peerConnections[peerId] = peerConnection;

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    roomCode: socket.roomCode,
                    candidate: event.candidate,
                    to: peerId
                });
            }
        };

        peerConnection.ontrack = (event) => {
            console.log(`Received remote stream from ${peerId}:`, event.streams[0].id);
            let videoFeed = document.querySelector(`.video-feed[data-peer-id="${peerId}"]`);
            if (!videoFeed) {
                videoFeed = document.createElement('div');
                videoFeed.classList.add('video-feed');
                videoFeed.dataset.peerId = peerId;
                const playerName = document.querySelector(`#connected-players li[data-player-id="${peerId}"]`)?.textContent.trim() || 'Unknown';
                videoFeed.innerHTML = `<span class="player-name">${playerName}</span>`;
                document.getElementById('video-container').appendChild(videoFeed);
            }

            let video = videoFeed.querySelector('video');
            if (!video) {
                video = document.createElement('video');
                video.autoplay = true;
                videoFeed.appendChild(video);
            }

            if (video.srcObject !== event.streams[0]) {
                video.srcObject = event.streams[0];
                console.log(`Attached remote stream to video element for ${peerId}`);
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`Peer connection state for ${peerId}: ${peerConnection.connectionState}`);
            if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
                console.warn(`Peer connection to ${peerId} failed or disconnected`);
                peerConnection.close();
                delete peerConnections[peerId];
                const videoFeed = document.querySelector(`.video-feed[data-peer-id="${peerId}"]`);
                if (videoFeed) videoFeed.remove();
            }
        };

        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
                console.log(`Added track to peer connection for ${peerId}:`, track.kind);
            });
        }

        if (!Object.keys(peerConnections).includes(peerId)) {
            createOffer(peerConnection, peerId);
        }

        return peerConnection;
    }

    async function createOffer(peerConnection, peerId) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { roomCode: socket.roomCode, offer, to: peerId });
            console.log(`Sent offer to ${peerId}`);
        } catch (error) {
            console.error(`Failed to create offer for ${peerId}:`, error);
        }
    }

    function playSong(song) {
        if (!youtubePlayer) {
            youtubePlayer = new YT.Player('youtube-player', {
                height: '0',
                width: '0',
                events: {
                    'onReady': () => {
                        playSong(song);
                    }
                }
            });
            return;
        }

        currentSong = song;
        const videoId = song.url.match(/(?:v=)([^&]+)/)[1];
        youtubePlayer.loadVideoById(videoId);
        document.getElementById('current-song').textContent = `Playing: ${song.title}`;
    }

    // Load YouTube IFrame API
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
});
