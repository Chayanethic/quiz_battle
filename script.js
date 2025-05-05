// Connect to Socket.io server
const socket = io();

// DOM Elements
const screens = {
    home: document.getElementById('home-screen'),
    create: document.getElementById('create-screen'),
    join: document.getElementById('join-screen'),
    waiting: document.getElementById('waiting-screen'),
    quiz: document.getElementById('quiz-screen'),
    results: document.getElementById('results-screen')
};

// Navigation buttons
document.getElementById('create-quiz-btn').addEventListener('click', () => showScreen('create'));
document.getElementById('join-quiz-btn').addEventListener('click', () => showScreen('join'));
document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen('home'));
});

// Create quiz
document.getElementById('generate-quiz-btn').addEventListener('click', createQuiz);

// Join quiz
document.getElementById('join-room-btn').addEventListener('click', joinQuiz);

// Start game
document.getElementById('start-game-btn').addEventListener('click', startGame);

// Cancel game
document.getElementById('cancel-game-btn').addEventListener('click', cancelGame);

// Play again
document.getElementById('play-again-btn').addEventListener('click', () => showScreen('home'));
document.getElementById('home-btn').addEventListener('click', () => showScreen('home'));

// Copy buttons
document.getElementById('copy-code-btn').addEventListener('click', copyRoomCode);
document.getElementById('copy-url-btn').addEventListener('click', copyShareUrl);

// Chat buttons
document.getElementById('send-chat').addEventListener('click', sendChatMessage);
document.getElementById('send-chat-waiting').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});
document.getElementById('chat-input-waiting').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// Emoji reaction buttons
document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        sendEmojiReaction(emoji);
    });
});

// Voice and video chat buttons
const micButtons = [
    document.getElementById('toggle-mic'),
    document.getElementById('toggle-mic-waiting')
];
const videoButtons = [
    document.getElementById('toggle-video'),
    document.getElementById('toggle-video-waiting')
];
const muteAllButtons = [
    document.getElementById('mute-all'),
    document.getElementById('mute-all-waiting')
];
micButtons.forEach(btn => {
    btn.addEventListener('click', toggleMicrophone);
});
videoButtons.forEach(btn => {
    btn.addEventListener('click', toggleVideo);
});
muteAllButtons.forEach(btn => {
    btn.addEventListener('click', toggleMuteAll);
});

// WebRTC setup
let localStream = null;
const peerConnections = {};
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
        // Add TURN servers if needed (requires credentials)
    ]
};
let isMicOn = false;
let isVideoOn = false;
let isMuted = false;

// Game state
let currentQuestionTimer;
let playerName = '';
let selectedAnswer = null;
let timerInterval;
let currentRoomCode = '';
let allPlayers = [];
let serverTimeOffset = 0;
let questionStartTime = 0;
let questionDuration = 30;
let isHost = false;

// Show a specific screen
function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    screens[screenName].classList.add('active');
    if (currentQuestionTimer) {
        clearInterval(currentQuestionTimer);
    }
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    // Clear chat messages and video feeds when leaving quiz or waiting screen
    if (screenName !== 'quiz' && screenName !== 'waiting') {
        document.getElementById('chat-messages').innerHTML = '';
        document.getElementById('chat-messages-waiting').innerHTML = '';
        document.querySelectorAll('.video-container').forEach(container => {
            container.innerHTML = '';
        });
        stopMediaChat();
    } else {
        // Show/hide mute-all button for host
        muteAllButtons.forEach(btn => {
            btn.style.display = isHost ? 'inline-block' : 'none';
        });
        // Initialize local video feed if media is active
        if (isMicOn || isVideoOn) {
            setupLocalVideo();
        }
    }
}

// Create a new quiz
function createQuiz() {
    const topic = document.getElementById('topic').value.trim();
    const numQuestions = parseInt(document.getElementById('num-questions').value);
    playerName = prompt('Enter your name:') || 'Host';
    
    if (!topic) {
        alert('Please enter a topic for the quiz.');
        return;
    }
    
    if (isNaN(numQuestions) || numQuestions < 5 || numQuestions > 20) {
        alert('Please enter a valid number of questions (5-20).');
        return;
    }
    
    document.getElementById('generate-quiz-btn').textContent = 'Generating...';
    document.getElementById('generate-quiz-btn').disabled = true;
    
    socket.emit('create-room', {
        topic,
        numQuestions,
        playerName
    });
}

// Join an existing quiz
function joinQuiz() {
    const urlParams = new URLSearchParams(window.location.search);
    let roomCode = urlParams.get('room');
    
    if (!roomCode) {
        roomCode = document.getElementById('room-code').value.trim().toUpperCase();
    } else {
        document.getElementById('room-code').value = roomCode;
    }
    
    playerName = document.getElementById('player-name').value.trim();
    
    if (!roomCode) {
        alert('Please enter a room code.');
        return;
    }
    
    if (!playerName) {
        alert('Please enter your name.');
        return;
    }
    
    socket.emit('join-room', {
        roomCode,
        playerName
    });
}

// Start the game
function startGame() {
    socket.emit('start-game');
}

// Cancel the game
function cancelGame() {
    socket.emit('cancel-game');
    showScreen('home');
}

// Copy room code to clipboard
function copyRoomCode() {
    const roomCode = document.getElementById('display-room-code').textContent;
    navigator.clipboard.writeText(roomCode)
        .then(() => showNotification('Room code copied to clipboard!'))
        .catch(() => showNotification('Failed to copy room code.', 5000));
}

// Copy share URL to clipboard
function copyShareUrl() {
    const shareUrl = document.getElementById('share-url').value;
    navigator.clipboard.writeText(shareUrl)
        .then(() => showNotification('Share URL copied to clipboard!'))
        .catch(() => showNotification('Failed to copy share URL.', 5000));
}

// Show notification
function showNotification(message, duration = 3000) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => {
        notification.classList.remove('show');
    }, duration);
}

// Send chat message
function sendChatMessage() {
    const chatInput = screens.quiz.classList.contains('active') 
        ? document.getElementById('chat-input')
        : document.getElementById('chat-input-waiting');
    const message = chatInput.value.trim();
    
    if (message) {
        socket.emit('chat-message', {
            roomCode: currentRoomCode,
            message,
            sender: playerName,
            isEmoji: false
        });
        chatInput.value = '';
    }
}

// Send emoji reaction
function sendEmojiReaction(emoji) {
    socket.emit('chat-message', {
        roomCode: currentRoomCode,
        message: emoji,
        sender: playerName,
        isEmoji: true
    });
}

// Display chat message
function displayChatMessage(data) {
    const { sender, message, timestamp, isEmoji } = data;
    const chatMessages = screens.quiz.classList.contains('active') 
        ? document.getElementById('chat-messages')
        : document.getElementById('chat-messages-waiting');
    
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${isEmoji ? 'emoji-message' : ''}`;
    if (isEmoji) {
        messageElement.textContent = message;
    } else {
        messageElement.innerHTML = `
            <span class="sender">${sender}</span>
            <span class="timestamp">[${new Date(timestamp).toLocaleTimeString()}]</span>: 
            ${message}
        `;
    }
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// Submit an answer
function submitAnswer(answerIndex) {
    if (selectedAnswer !== null) return;
    
    selectedAnswer = answerIndex;
    const responseTime = (Date.now() - questionStartTime) / 1000;
    
    document.querySelectorAll('.option').forEach((option, index) => {
        if (index === answerIndex) {
            option.classList.add('selected');
        }
    });
    
    socket.emit('submit-answer', {
        answer: answerIndex,
        responseTime: responseTime
    });
    
    showNotification('Answer submitted!');
}

// Media chat functions (voice and video)
async function startMediaChat() {
    try {
        // Check permissions
        const micPermission = await navigator.permissions.query({ name: 'microphone' });
        const camPermission = await navigator.permissions.query({ name: 'camera' });
        if (micPermission.state === 'denied' && camPermission.state === 'denied') {
            showNotification('Microphone and camera access denied. Please enable in browser settings.', 5000);
            return;
        }

        // Request both audio and video
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        isMicOn = true;
        isVideoOn = true;
        updateMicButton();
        updateVideoButton();
        setupLocalVideo();
        socket.emit('media-status', {
            roomCode: currentRoomCode,
            isSpeaking: isMicOn,
            isVideoOn: isVideoOn,
            isMuted: false
        });
        // Notify other players to start WebRTC connection
        socket.emit('start-media-chat', { roomCode: currentRoomCode });
        showNotification('Voice and video chat started!');
    } catch (err) {
        showNotification('Failed to access microphone or camera. Please check permissions.', 5000);
        // Try audio only as fallback
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isMicOn = true;
            updateMicButton();
            socket.emit('media-status', {
                roomCode: currentRoomCode,
                isSpeaking: isMicOn,
                isVideoOn: false,
                isMuted: false
            });
            socket.emit('start-media-chat', { roomCode: currentRoomCode });
            showNotification('Voice chat started (video unavailable).');
        } catch (audioErr) {
            showNotification('Failed to access microphone. Please check permissions.', 5000);
        }
    }
}

function stopMediaChat() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    isMicOn = false;
    isVideoOn = false;
    isMuted = false;
    updateMicButton();
    updateVideoButton();
    updateMuteAllButton();
    Object.values(peerConnections).forEach(pc => {
        pc.close();
    });
    Object.keys(peerConnections).forEach(id => {
        delete peerConnections[id];
        const audio = document.getElementById(`audio-${id}`);
        const videoFeed = document.getElementById(`video-feed-${id}`);
        if (audio) audio.remove();
        if (videoFeed) videoFeed.remove();
    });
    document.querySelectorAll('.video-container').forEach(container => {
        container.innerHTML = '';
    });
    socket.emit('media-status', {
        roomCode: currentRoomCode,
        isSpeaking: false,
        isVideoOn: false,
        isMuted: false
    });
    showNotification('Voice and video chat stopped.');
}

function stopAudioOnly() {
    if (localStream && isMicOn) {
        localStream.getAudioTracks().forEach(track => track.stop());
        isMicOn = false;
        updateMicButton();
        socket.emit('media-status', {
            roomCode: currentRoomCode,
            isSpeaking: false,
            isVideoOn: isVideoOn,
            isMuted: isMuted
        });
        showNotification('Audio muted.');
    }
}

async function toggleMicrophone() {
    if (!isMicOn && !isVideoOn) {
        await startMediaChat();
    } else {
        stopMediaChat();
    }
}

async function toggleVideo() {
    if (!isVideoOn && !isMicOn) {
        await startMediaChat();
    } else if (isVideoOn) {
        isVideoOn = false;
        localStream.getVideoTracks().forEach(track => track.stop());
        updateVideoButton();
        socket.emit('media-status', {
            roomCode: currentRoomCode,
            isSpeaking: isMicOn,
            isVideoOn: false,
            isMuted: isMuted
        });
        showNotification('Video stopped.');
        document.querySelectorAll('.video-container').forEach(container => {
            const localFeed = container.querySelector(`#video-feed-${socket.id}`);
            if (localFeed) localFeed.remove();
        });
    } else if (isMicOn) {
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoStream.getVideoTracks().forEach(track => localStream.addTrack(track));
            isVideoOn = true;
            updateVideoButton();
            setupLocalVideo();
            Object.values(peerConnections).forEach(pc => {
                videoStream.getVideoTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });
            });
            socket.emit('media-status', {
                roomCode: currentRoomCode,
                isSpeaking: isMicOn,
                isVideoOn: true,
                isMuted: isMuted
            });
            showNotification('Video started.');
        } catch (err) {
            showNotification('Failed to access camera.', 5000);
        }
    }
}

function toggleMuteAll() {
    isMuted = !isMuted;
    updateMuteAllButton();
    socket.emit('mute-all', {
        roomCode: currentRoomCode,
        muted: isMuted
    });
    showNotification(isMuted ? 'All players muted.' : 'All players unmuted.');
}

function updateMicButton() {
    micButtons.forEach(btn => {
        btn.classList.toggle('active', isMicOn);
        btn.querySelector('i').className = isMicOn ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    });
}

function updateVideoButton() {
    videoButtons.forEach(btn => {
        btn.classList.toggle('active', isVideoOn);
        btn.querySelector('i').className = isVideoOn ? 'fas fa-video' : 'fas fa-video-slash';
    });
}

function updateMuteAllButton() {
    muteAllButtons.forEach(btn => {
        btn.classList.toggle('muted', isMuted);
        btn.querySelector('i').className = isMuted ? 'fas fa-volume-off' : 'fas fa-volume-mute';
    });
}

function setupLocalVideo() {
    if (!isVideoOn || !localStream) return;
    document.querySelectorAll('.video-container').forEach(container => {
        let localFeed = container.querySelector(`#video-feed-${socket.id}`);
        if (!localFeed) {
            localFeed = document.createElement('div');
            localFeed.id = `video-feed-${socket.id}`;
            localFeed.className = 'video-feed';
            const video = document.createElement('video');
            video.srcObject = localStream;
            video.autoplay = true;
            video.muted = true; // Mute local video to avoid feedback
            const nameLabel = document.createElement('div');
            nameLabel.className = 'player-name';
            nameLabel.textContent = playerName;
            localFeed.appendChild(video);
            localFeed.appendChild(nameLabel);
            container.appendChild(localFeed);
        }
    });
}

async function createPeerConnection(playerId) {
    try {
        const pc = new RTCPeerConnection(configuration);
        peerConnections[playerId] = pc;

        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        // Handle incoming stream
        pc.ontrack = (event) => {
            const stream = event.streams[0];
            if (event.track.kind === 'audio') {
                const audio = document.createElement('audio');
                audio.id = `audio-${playerId}`;
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.muted = false;
                document.body.appendChild(audio);
            } else if (event.track.kind === 'video') {
                document.querySelectorAll('.video-container').forEach(container => {
                    let videoFeed = container.querySelector(`#video-feed-${playerId}`);
                    if (!videoFeed) {
                        videoFeed = document.createElement('div');
                        videoFeed.id = `video-feed-${playerId}`;
                        videoFeed.className = 'video-feed';
                        const video = document.createElement('video');
                        video.srcObject = stream;
                        video.autoplay = true;
                        const nameLabel = document.createElement('div');
                        nameLabel.className = 'player-name';
                        nameLabel.textContent = allPlayers.find(p => p.id === playerId)?.name || 'Unknown';
                        videoFeed.appendChild(video);
                        videoFeed.appendChild(nameLabel);
                        container.appendChild(videoFeed);
                    }
                });
            }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    roomCode: currentRoomCode,
                    candidate: event.candidate,
                    to: playerId
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                showNotification('Voice/video chat connection failed. Using text chat instead.', 5000);
            }
        };

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', {
            roomCode: currentRoomCode,
            offer,
            to: playerId
        });
    } catch (err) {
        showNotification('Failed to establish voice/video chat connection.', 5000);
    }
}

// Update the waiting room player list
function updatePlayersList(players) {
    allPlayers = players;
    const playersList = document.getElementById('connected-players');
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        const statusClass = player.isSpeaking ? 'speaking' : player.isVideoOn ? 'video-on' : player.isMuted ? 'muted' : '';
        li.innerHTML = `
            <div>
                <span class="player-status ${statusClass}"></span>
                ${player.name}
            </div>
            <div>${player.score || 0} points</div>
        `;
        playersList.appendChild(li);
    });
    
    updateLiveScores(players);
}

// Update live scores during the quiz
function updateLiveScores(players) {
    const liveScores = document.getElementById('live-player-scores');
    if (!liveScores) return;
    
    liveScores.innerHTML = '';
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    
    sortedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${player.name}</span>
            <span>${player.score || 0} points</span>
        `;
        if (player.id === socket.id) {
            li.style.fontWeight = 'bold';
        }
        liveScores.appendChild(li);
    });
}

// Display a new question
function displayQuestion(data) {
    const { questionIndex, totalQuestions, question, options, serverTime, timeLimit } = data;
    selectedAnswer = null;
    const clientTime = Date.now();
    serverTimeOffset = serverTime - clientTime;
    questionStartTime = clientTime;
    
    if (timeLimit) {
        questionDuration = timeLimit;
    }
    
    document.getElementById('current-question').textContent = questionIndex + 1;
    document.getElementById('total-questions').textContent = totalQuestions;
    document.getElementById('question-text').textContent = question;
    
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';
    
    options.forEach((option, index) => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.textContent = option;
        optionElement.addEventListener('click', () => submitAnswer(index));
        optionsContainer.appendChild(optionElement);
    });
    
    startTimer(questionDuration);
    updateLiveScores(allPlayers);
}

// Start timer with visual feedback
function startTimer(duration) {
    const timerTextElement = document.getElementById('time-left');
    timerTextElement.textContent = duration;
    
    const timerProgress = document.getElementById('timer-progress');
    const circumference = 2 * Math.PI * 15;
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = '0';
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    if (currentQuestionTimer) {
        clearInterval(currentQuestionTimer);
    }
    
    const endTime = questionStartTime + (duration * 1000);
    
    function updateTimerDisplay() {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const timeLeft = Math.ceil(remaining / 1000);
        
        document.getElementById('time-left').textContent = timeLeft;
        const progress = 1 - (remaining / (duration * 1000));
        const dashOffset = circumference * progress;
        timerProgress.style.strokeDashoffset = dashOffset;
        
        if (timeLeft <= 5) {
            document.getElementById('timer').classList.add('warning');
        } else {
            document.getElementById('timer').classList.remove('warning');
        }
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (selectedAnswer === null) {
                submitAnswer(-1);
            }
        }
    }
    
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 100);
}

// Show question results
function showQuestionResults(data) {
    const { correctAnswer, players } = data;
    
    document.querySelectorAll('.option').forEach((option, index) => {
        if (index === correctAnswer) {
            option.classList.add('correct');
        } else if (index === selectedAnswer && selectedAnswer !== correctAnswer) {
            option.classList.add('incorrect');
        }
    });
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    allPlayers = players;
    updateLiveScores(players);
    
    if (selectedAnswer === correctAnswer) {
        showNotification('Correct answer! +10 points', 2000);
    } else {
        showNotification('Wrong answer!', 2000);
    }
}

// Show final results with confetti animation
function showFinalResults(data) {
    const { players } = data;
    allPlayers = players;
    
    const finalScores = document.getElementById('final-scores');
    finalScores.innerHTML = '<h3>Final Scores:</h3>';
    
    players.forEach((player, index) => {
        const playerScore = document.createElement('div');
        playerScore.className = 'player-score';
        if (index === 0) {
            playerScore.classList.add('winner');
        }
        if (player.id === socket.id) {
            playerScore.style.fontWeight = 'bold';
        }
        playerScore.innerHTML = `
            <span>${index + 1}. ${player.name}</span>
            <span>${player.score} points</span>
        `;
        finalScores.appendChild(playerScore);
    });
    
    showScreen('results');
    
    if (players.length > 0 && players[0].id === socket.id) {
        createConfetti();
    }
}

// Create confetti animation
function createConfetti() {
    const colors = ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590'];
    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = Math.random() * 10 + 5 + 'px';
        confetti.style.height = Math.random() * 10 + 5 + 'px';
        confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
        confetti.style.animationDelay = Math.random() * 2 + 's';
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 5000);
    }
}

// Generate share URL
function generateShareUrl(roomCode) {
    const url = new URL(window.location.href);
    url.search = `?room=${roomCode}`;
    return url.href;
}

// Socket.io event handlers
socket.on('connect', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        showScreen('join');
        document.getElementById('room-code').value = roomCode;
    }
    socket.emit('sync-time');
});

socket.on('time-sync', (data) => {
    const clientTime = Date.now();
    const serverTime = data.serverTime;
    serverTimeOffset = serverTime - clientTime;
});

socket.on('error', (data) => {
    alert(data.message);
    document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
    document.getElementById('generate-quiz-btn').disabled = false;
});

socket.on('room-created', (data) => {
    const { roomCode, players } = data;
    currentRoomCode = roomCode;
    isHost = true;
    document.getElementById('display-room-code').textContent = roomCode;
    const shareUrl = generateShareUrl(roomCode);
    document.getElementById('share-url').value = shareUrl;
    updatePlayersList(players);
    document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
    document.getElementById('generate-quiz-btn').disabled = false;
    showScreen('waiting');
});

socket.on('room-joined', (data) => {
    const { roomCode, players } = data;
    currentRoomCode = roomCode;
    isHost = false;
    document.getElementById('display-room-code').textContent = roomCode;
    const shareUrl = generateShareUrl(roomCode);
    document.getElementById('share-url').value = shareUrl;
    updatePlayersList(players);
    showScreen('waiting');
    document.getElementById('start-game-btn').style.display = 'none';
});

socket.on('player-joined', async (data) => {
    updatePlayersList(data.players);
    showNotification('New player joined!');
    if (isMicOn || isVideoOn) {
        // Start media chat with new player
        const newPlayer = data.players.find(p => !peerConnections[p.id] && p.id !== socket.id);
        if (newPlayer) {
            await createPeerConnection(newPlayer.id);
        }
    }
});

socket.on('player-left', (data) => {
    updatePlayersList(data.players);
    showNotification('A player left the game');
    // Clean up peer connection
    const playerId = Object.keys(peerConnections).find(id => !data.players.some(p => p.id === id));
    if (playerId) {
        peerConnections[playerId].close();
        delete peerConnections[playerId];
        const audio = document.getElementById(`audio-${playerId}`);
        const videoFeed = document.getElementById(`video-feed-${playerId}`);
        if (audio) audio.remove();
        if (videoFeed) videoFeed.remove();
    }
});

socket.on('start-media-chat', async (data) => {
    const { from } = data;
    if (!peerConnections[from] && from !== socket.id) {
        await createPeerConnection(from);
    }
});

socket.on('offer', async (data) => {
    const { offer, from } = data;
    if (!peerConnections[from]) {
        const pc = new RTCPeerConnection(configuration);
        peerConnections[from] = pc;

        pc.ontrack = (event) => {
            const stream = event.streams[0];
            if (event.track.kind === 'audio') {
                const audio = document.createElement('audio');
                audio.id = `audio-${from}`;
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.muted = false;
                document.body.appendChild(audio);
            } else if (event.track.kind === 'video') {
                document.querySelectorAll('.video-container').forEach(container => {
                    let videoFeed = container.querySelector(`#video-feed-${from}`);
                    if (!videoFeed) {
                        videoFeed = document.createElement('incorporated');
                        videoFeed.id = `video-feed-${from}`;
                        videoFeed.className = 'video-feed';
                        const video = document.createElement('video');
                        video.srcObject = stream;
                        video.autoplay = true;
                        const nameLabel = document.createElement('div');
                        nameLabel.className = 'player-name';
                        nameLabel.textContent = allPlayers.find(p => p.id === from)?.name || 'Unknown';
                        videoFeed.appendChild(video);
                        videoFeed.appendChild(nameLabel);
                        container.appendChild(videoFeed);
                    }
                });
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    roomCode: currentRoomCode,
                    candidate: event.candidate,
                    to: from
                });
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                showNotification('Voice/video chat connection failed. Using text chat instead.', 5000);
            }
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', {
                roomCode: currentRoomCode,
                answer,
                to: from
            });
        } catch (err) {
            showNotification('Failed to connect voice/video chat.', 5000);
        }
    }
});

socket.on('answer', async (data) => {
    const { answer, from } = data;
    const pc = peerConnections[from];
    if (pc && pc.signalingState !== 'closed') {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            showNotification('Failed to connect voice/video chat.', 5000);
        }
    }
});

socket.on('ice-candidate', async (data) => {
    const { candidate, from } = data;
    const pc = peerConnections[from];
    if (pc && pc.signalingState !== 'closed') {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            showNotification('Failed to connect voice/video chat.', 5000);
        }
    }
});

socket.on('media-status', (data) => {
    const player = allPlayers.find(p => p.id === data.playerId);
    if (player) {
        player.isSpeaking = data.isSpeaking;
        player.isVideoOn = data.isVideoOn;
        player.isMuted = data.isMuted;
        updatePlayersList(allPlayers);
        // Remove video feed if video is turned off
        if (!data.isVideoOn) {
            document.querySelectorAll('.video-container').forEach(container => {
                const videoFeed = container.querySelector(`#video-feed-${data.playerId}`);
                if (videoFeed) videoFeed.remove();
            });
        }
    }
});

socket.on('mute-all', (data) => {
    isMuted = data.muted;
    if (isMuted && isMicOn) {
        stopAudioOnly();
    }
    updateMuteAllButton();
});

socket.on('new-question', (data) => {
    displayQuestion(data);
    showScreen('quiz');
});

socket.on('question-results', (data) => {
    showQuestionResults(data);
});

socket.on('quiz-ended', (data) => {
    showFinalResults(data);
});

socket.on('game-cancelled', (data) => {
    if (data && data.message) {
        alert(data.message);
    }
    showScreen('home');
});

socket.on('score-update', (data) => {
    allPlayers = data.players;
    updateLiveScores(data.players);
});

socket.on('chat-message', (data) => {
    displayChatMessage(data);
});

// Check for URL parameters on page load
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        showScreen('join');
        document.getElementById('room-code').value = roomCode;
    }
});
// // Connect to Socket.io server
// const socket = io();

// // DOM Elements
// const screens = {
//     home: document.getElementById('home-screen'),
//     create: document.getElementById('create-screen'),
//     join: document.getElementById('join-screen'),
//     waiting: document.getElementById('waiting-screen'),
//     quiz: document.getElementById('quiz-screen'),
//     results: document.getElementById('results-screen')
// };

// // Navigation buttons
// document.getElementById('create-quiz-btn').addEventListener('click', () => showScreen('create'));
// document.getElementById('join-quiz-btn').addEventListener('click', () => showScreen('join'));
// document.querySelectorAll('.back-btn').forEach(btn => {
//     btn.addEventListener('click', () => showScreen('home'));
// });

// // Create quiz
// document.getElementById('generate-quiz-btn').addEventListener('click', createQuiz);

// // Join quiz
// document.getElementById('join-room-btn').addEventListener('click', joinQuiz);

// // Start game
// document.getElementById('start-game-btn').addEventListener('click', startGame);

// // Cancel game
// document.getElementById('cancel-game-btn').addEventListener('click', cancelGame);

// // Play again
// document.getElementById('play-again-btn').addEventListener('click', () => showScreen('home'));
// document.getElementById('home-btn').addEventListener('click', () => showScreen('home'));

// // Copy buttons
// document.getElementById('copy-code-btn').addEventListener('click', copyRoomCode);
// document.getElementById('copy-url-btn').addEventListener('click', copyShareUrl);

// // Chat buttons
// document.getElementById('send-chat').addEventListener('click', sendChatMessage);
// document.getElementById('send-chat-waiting').addEventListener('click', sendChatMessage);
// document.getElementById('chat-input').addEventListener('keypress', (e) => {
//     if (e.key === 'Enter') sendChatMessage();
// });
// document.getElementById('chat-input-waiting').addEventListener('keypress', (e) => {
//     if (e.key === 'Enter') sendChatMessage();
// });

// // Game state
// let currentQuestionTimer;
// let playerName = '';
// let selectedAnswer = null;
// let timerInterval;
// let currentRoomCode = '';
// let allPlayers = [];
// let serverTimeOffset = 0;
// let questionStartTime = 0;
// let questionDuration = 30;

// // Show a specific screen
// function showScreen(screenName) {
//     Object.values(screens).forEach(screen => {
//         screen.classList.remove('active');
//     });
//     screens[screenName].classList.add('active');
//     if (currentQuestionTimer) {
//         clearInterval(currentQuestionTimer);
//     }
//     if (timerInterval) {
//         clearInterval(timerInterval);
//     }
//     // Clear chat messages when leaving quiz or waiting screen
//     if (screenName !== 'quiz' && screenName !== 'waiting') {
//         document.getElementById('chat-messages').innerHTML = '';
//         document.getElementById('chat-messages-waiting').innerHTML = '';
//     }
// }

// // Create a new quiz
// function createQuiz() {
//     const topic = document.getElementById('topic').value.trim();
//     const numQuestions = parseInt(document.getElementById('num-questions').value);
//     playerName = prompt('Enter your name:') || 'Host';
    
//     if (!topic) {
//         alert('Please enter a topic for the quiz.');
//         return;
//     }
    
//     if (isNaN(numQuestions) || numQuestions < 5 || numQuestions > 20) {
//         alert('Please enter a valid number of questions (5-20).');
//         return;
//     }
    
//     document.getElementById('generate-quiz-btn').textContent = 'Generating...';
//     document.getElementById('generate-quiz-btn').disabled = true;
    
//     socket.emit('create-room', {
//         topic,
//         numQuestions,
//         playerName
//     });
// }

// // Join an existing quiz
// function joinQuiz() {
//     const urlParams = new URLSearchParams(window.location.search);
//     let roomCode = urlParams.get('room');
    
//     if (!roomCode) {
//         roomCode = document.getElementById('room-code').value.trim().toUpperCase();
//     } else {
//         document.getElementById('room-code').value = roomCode;
//     }
    
//     playerName = document.getElementById('player-name').value.trim();
    
//     if (!roomCode) {
//         alert('Please enter a room code.');
//         return;
//     }
    
//     if (!playerName) {
//         alert('Please enter your name.');
//         return;
//     }
    
//     socket.emit('join-room', {
//         roomCode,
//         playerName
//     });
// }

// // Start the game
// function startGame() {
//     socket.emit('start-game');
// }

// // Cancel the game
// function cancelGame() {
//     socket.emit('cancel-game');
//     showScreen('home');
// }

// // Copy room code to clipboard
// function copyRoomCode() {
//     const roomCode = document.getElementById('display-room-code').textContent;
//     navigator.clipboard.writeText(roomCode)
//         .then(() => showNotification('Room code copied to clipboard!'))
//         .catch(err => console.error('Failed to copy room code:', err));
// }

// // Copy share URL to clipboard
// function copyShareUrl() {
//     const shareUrl = document.getElementById('share-url').value;
//     navigator.clipboard.writeText(shareUrl)
//         .then(() => showNotification('Share URL copied to clipboard!'))
//         .catch(err => console.error('Failed to copy share URL:', err));
// }

// // Show notification
// function showNotification(message, duration = 3000) {
//     const notification = document.getElementById('notification');
//     notification.textContent = message;
//     notification.classList.add('show');
//     setTimeout(() => {
//         notification.classList.remove('show');
//     }, duration);
// }

// // Send chat message
// function sendChatMessage() {
//     const chatInput = screens.quiz.classList.contains('active') 
//         ? document.getElementById('chat-input')
//         : document.getElementById('chat-input-waiting');
//     const message = chatInput.value.trim();
    
//     if (message) {
//         socket.emit('chat-message', {
//             roomCode: currentRoomCode,
//             message,
//             sender: playerName
//         });
//         chatInput.value = '';
//     }
// }

// // Display chat message
// function displayChatMessage(data) {
//     const { sender, message, timestamp } = data;
//     const chatMessages = screens.quiz.classList.contains('active') 
//         ? document.getElementById('chat-messages')
//         : document.getElementById('chat-messages-waiting');
    
//     const messageElement = document.createElement('div');
//     messageElement.className = 'chat-message';
//     messageElement.innerHTML = `
//         <span class="sender">${sender}</span>
//         <span class="timestamp">[${new Date(timestamp).toLocaleTimeString()}]</span>: 
//         ${message}
//     `;
//     chatMessages.appendChild(messageElement);
//     chatMessages.scrollTop = chatMessages.scrollHeight;
// }

// // Submit an answer
// function submitAnswer(answerIndex) {
//     if (selectedAnswer !== null) return;
    
//     selectedAnswer = answerIndex;
//     const responseTime = (Date.now() - questionStartTime) / 1000;
    
//     document.querySelectorAll('.option').forEach((option, index) => {
//         if (index === answerIndex) {
//             option.classList.add('selected');
//         }
//     });
    
//     socket.emit('submit-answer', {
//         answer: answerIndex,
//         responseTime: responseTime
//     });
    
//     showNotification('Answer submitted!');
// }

// // Update the waiting room player list
// function updatePlayersList(players) {
//     allPlayers = players;
//     const playersList = document.getElementById('connected-players');
//     playersList.innerHTML = '';
    
//     players.forEach(player => {
//         const li = document.createElement('li');
//         li.innerHTML = `
//             <div>
//                 <span class="player-status"></span>
//                 ${player.name}
//             </div>
//             <div>${player.score || 0} points</div>
//         `;
//         playersList.appendChild(li);
//     });
    
//     updateLiveScores(players);
// }

// // Update live scores during the quiz
// function updateLiveScores(players) {
//     const liveScores = document.getElementById('live-player-scores');
//     if (!liveScores) return;
    
//     liveScores.innerHTML = '';
//     const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    
//     sortedPlayers.forEach(player => {
//         const li = document.createElement('li');
//         li.innerHTML = `
//             <span>${player.name}</span>
//             <span>${player.score || 0} points</span>
//         `;
//         if (player.id === socket.id) {
//             li.style.fontWeight = 'bold';
//         }
//         liveScores.appendChild(li);
//     });
// }

// // Display a new question
// function displayQuestion(data) {
//     const { questionIndex, totalQuestions, question, options, serverTime, timeLimit } = data;
//     selectedAnswer = null;
//     const clientTime = Date.now();
//     serverTimeOffset = serverTime - clientTime;
//     questionStartTime = clientTime;
    
//     if (timeLimit) {
//         questionDuration = timeLimit;
//     }
    
//     document.getElementById('current-question').textContent = questionIndex + 1;
//     document.getElementById('total-questions').textContent = totalQuestions;
//     document.getElementById('question-text').textContent = question;
    
//     const optionsContainer = document.getElementById('options-container');
//     optionsContainer.innerHTML = '';
    
//     options.forEach((option, index) => {
//         const optionElement = document.createElement('div');
//         optionElement.className = 'option';
//         optionElement.textContent = option;
//         optionElement.addEventListener('click', () => submitAnswer(index));
//         optionsContainer.appendChild(optionElement);
//     });
    
//     startTimer(questionDuration);
//     updateLiveScores(allPlayers);
// }

// // Start timer with visual feedback
// function startTimer(duration) {
//     const timerTextElement = document.getElementById('time-left');
//     timerTextElement.textContent = duration;
    
//     const timerProgress = document.getElementById('timer-progress');
//     const circumference = 2 * Math.PI * 15;
//     timerProgress.style.strokeDasharray = circumference;
//     timerProgress.style.strokeDashoffset = '0';
    
//     if (timerInterval) {
//         clearInterval(timerInterval);
//     }
    
//     if (currentQuestionTimer) {
//         clearInterval(currentQuestionTimer);
//     }
    
//     const endTime = questionStartTime + (duration * 1000);
    
//     function updateTimerDisplay() {
//         const now = Date.now();
//         const remaining = Math.max(0, endTime - now);
//         const timeLeft = Math.ceil(remaining / 1000);
        
//         document.getElementById('time-left').textContent = timeLeft;
//         const progress = 1 - (remaining / (duration * 1000));
//         const dashOffset = circumference * progress;
//         timerProgress.style.strokeDashoffset = dashOffset;
        
//         if (timeLeft <= 5) {
//             document.getElementById('timer').classList.add('warning');
//         } else {
//             document.getElementById('timer').classList.remove('warning');
//         }
        
//         if (timeLeft <= 0) {
//             clearInterval(timerInterval);
//             if (selectedAnswer === null) {
//                 submitAnswer(-1);
//             }
//         }
//     }
    
//     updateTimerDisplay();
//     timerInterval = setInterval(updateTimerDisplay, 100);
// }

// // Show question results
// function showQuestionResults(data) {
//     const { correctAnswer, players } = data;
    
//     document.querySelectorAll('.option').forEach((option, index) => {
//         if (index === correctAnswer) {
//             option.classList.add('correct');
//         } else if (index === selectedAnswer && selectedAnswer !== correctAnswer) {
//             option.classList.add('incorrect');
//         }
//     });
    
//     if (timerInterval) {
//         clearInterval(timerInterval);
//     }
    
//     allPlayers = players;
//     updateLiveScores(players);
    
//     if (selectedAnswer === correctAnswer) {
//         showNotification('Correct answer! +10 points', 2000);
//     } else {
//         showNotification('Wrong answer!', 2000);
//     }
// }

// // Show final results with confetti animation
// function showFinalResults(data) {
//     const { players } = data;
//     allPlayers = players;
    
//     const finalScores = document.getElementById('final-scores');
//     finalScores.innerHTML = '<h3>Final Scores:</h3>';
    
//     players.forEach((player, index) => {
//         const playerScore = document.createElement('div');
//         playerScore.className = 'player-score';
//         if (index === 0) {
//             playerScore.classList.add('winner');
//         }
//         if (player.id === socket.id) {
//             playerScore.style.fontWeight = 'bold';
//         }
//         playerScore.innerHTML = `
//             <span>${index + 1}. ${player.name}</span>
//             <span>${player.score} points</span>
//         `;
//         finalScores.appendChild(playerScore);
//     });
    
//     showScreen('results');
    
//     if (players.length > 0 && players[0].id === socket.id) {
//         createConfetti();
//     }
// }

// // Create confetti animation
// function createConfetti() {
//     const colors = ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590'];
//     for (let i = 0; i < 100; i++) {
//         const confetti = document.createElement('div');
//         confetti.className = 'confetti';
//         confetti.style.left = Math.random() * 100 + 'vw';
//         confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
//         confetti.style.width = Math.random() * 10 + 5 + 'px';
//         confetti.style.height = Math.random() * 10 + 5 + 'px';
//         confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
//         confetti.style.animationDelay = Math.random() * 2 + 's';
//         document.body.appendChild(confetti);
//         setTimeout(() => confetti.remove(), 5000);
//     }
// }

// // Generate share URL
// function generateShareUrl(roomCode) {
//     const url = new URL(window.location.href);
//     url.search = `?room=${roomCode}`;
//     return url.href;
// }

// // Socket.io event handlers
// socket.on('connect', () => {
//     console.log('Connected to server');
//     const urlParams = new URLSearchParams(window.location.search);
//     const roomCode = urlParams.get('room');
//     if (roomCode) {
//         showScreen('join');
//         document.getElementById('room-code').value = roomCode;
//     }
//     socket.emit('sync-time');
// });

// socket.on('time-sync', (data) => {
//     const clientTime = Date.now();
//     const serverTime = data.serverTime;
//     serverTimeOffset = serverTime - clientTime;
//     console.log('Time synchronized with server. Offset:', serverTimeOffset, 'ms');
// });

// socket.on('error', (data) => {
//     alert(data.message);
//     document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
//     document.getElementById('generate-quiz-btn').disabled = false;
// });

// socket.on('room-created', (data) => {
//     const { roomCode, players } = data;
//     currentRoomCode = roomCode;
//     document.getElementById('display-room-code').textContent = roomCode;
//     const shareUrl = generateShareUrl(roomCode);
//     document.getElementById('share-url').value = shareUrl;
//     updatePlayersList(players);
//     document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
//     document.getElementById('generate-quiz-btn').disabled = false;
//     showScreen('waiting');
// });

// socket.on('room-joined', (data) => {
//     const { roomCode, players } = data;
//     currentRoomCode = roomCode;
//     document.getElementById('display-room-code').textContent = roomCode;
//     const shareUrl = generateShareUrl(roomCode);
//     document.getElementById('share-url').value = shareUrl;
//     updatePlayersList(players);
//     showScreen('waiting');
//     document.getElementById('start-game-btn').style.display = 'none';
// });

// socket.on('player-joined', (data) => {
//     updatePlayersList(data.players);
//     showNotification('New player joined!');
// });

// socket.on('player-left', (data) => {
//     updatePlayersList(data.players);
//     showNotification('A player left the game');
// });

// socket.on('new-question', (data) => {
//     displayQuestion(data);
//     showScreen('quiz');
// });

// socket.on('question-results', (data) => {
//     showQuestionResults(data);
// });

// socket.on('quiz-ended', (data) => {
//     showFinalResults(data);
// });

// socket.on('game-cancelled', (data) => {
//     if (data && data.message) {
//         alert(data.message);
//     }
//     showScreen('home');
// });

// socket.on('score-update', (data) => {
//     allPlayers = data.players;
//     updateLiveScores(data.players);
// });

// socket.on('chat-message', (data) => {
//     displayChatMessage(data);
// });

// // Check for URL parameters on page load
// window.addEventListener('load', () => {
//     const urlParams = new URLSearchParams(window.location.search);
//     const roomCode = urlParams.get('room');
//     if (roomCode) {
//         showScreen('join');
//         document.getElementById('room-code').value = roomCode;
//     }
// });
