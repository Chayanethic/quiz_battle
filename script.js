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

// Game state
let currentQuestionTimer;
let playerName = '';
let selectedAnswer = null;
let timerInterval;
let currentRoomCode = '';
let allPlayers = [];
let serverTimeOffset = 0;
let questionStartTime = 0;
let questionDuration = 30; // Changed from 20 to 30 seconds

// Show a specific screen
function showScreen(screenName) {
    // Hide all screens
    Object.values(screens).forEach(screen => {
        screen.classList.remove('active');
    });
    
    // Show the requested screen
    screens[screenName].classList.add('active');
    
    // Clear any active timers when changing screens
    if (currentQuestionTimer) {
        clearInterval(currentQuestionTimer);
    }
    
    if (timerInterval) {
        clearInterval(timerInterval);
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
    
    // Show loading state
    document.getElementById('generate-quiz-btn').textContent = 'Generating...';
    document.getElementById('generate-quiz-btn').disabled = true;
    
    // Send request to create room
    socket.emit('create-room', {
        topic,
        numQuestions,
        playerName
    });
}

// Join an existing quiz
function joinQuiz() {
    // Check if we have a room code in the URL
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
    
    // Send request to join room
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
        .then(() => {
            showNotification('Room code copied to clipboard!');
        })
        .catch(err => {
            console.error('Failed to copy room code:', err);
        });
}

// Copy share URL to clipboard
function copyShareUrl() {
    const shareUrl = document.getElementById('share-url').value;
    navigator.clipboard.writeText(shareUrl)
        .then(() => {
            showNotification('Share URL copied to clipboard!');
        })
        .catch(err => {
            console.error('Failed to copy share URL:', err);
        });
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

// Submit an answer
function submitAnswer(answerIndex) {
    if (selectedAnswer !== null) return; // Already answered
    
    selectedAnswer = answerIndex;
    
    // Calculate response time
    const responseTime = (Date.now() - questionStartTime) / 1000;
    
    // Highlight selected answer
    document.querySelectorAll('.option').forEach((option, index) => {
        if (index === answerIndex) {
            option.classList.add('selected');
        }
    });
    
    // Send answer to server
    socket.emit('submit-answer', {
        answer: answerIndex,
        responseTime: responseTime
    });
    
    // Show notification
    showNotification('Answer submitted!');
}

// Update the waiting room player list
function updatePlayersList(players) {
    allPlayers = players;
    const playersList = document.getElementById('connected-players');
    playersList.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <span class="player-status"></span>
                ${player.name}
            </div>
            <div>${player.score || 0} points</div>
        `;
        playersList.appendChild(li);
    });
    
    // Also update live scores if on quiz screen
    updateLiveScores(players);
}

// Update live scores during the quiz
function updateLiveScores(players) {
    const liveScores = document.getElementById('live-player-scores');
    if (!liveScores) return;
    
    liveScores.innerHTML = '';
    
    // Sort players by score
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    
    sortedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${player.name}</span>
            <span>${player.score || 0} points</span>
        `;
        
        // Highlight current player
        if (player.id === socket.id) {
            li.style.fontWeight = 'bold';
        }
        
        liveScores.appendChild(li);
    });
}

// Display a new question
function displayQuestion(data) {
    const { questionIndex, totalQuestions, question, options, serverTime, timeLimit } = data;
    
    // Reset selected answer
    selectedAnswer = null;
    
    // Calculate server time offset
    const clientTime = Date.now();
    serverTimeOffset = serverTime - clientTime;
    
    // Set question start time
    questionStartTime = clientTime;
    
    // Update question duration from server if provided
    if (timeLimit) {
        questionDuration = timeLimit;
    }
    
    // Update question counter
    document.getElementById('current-question').textContent = questionIndex + 1;
    document.getElementById('total-questions').textContent = totalQuestions;
    
    // Set question text
    document.getElementById('question-text').textContent = question;
    
    // Create option buttons
    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';
    
    options.forEach((option, index) => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        optionElement.textContent = option;
        optionElement.addEventListener('click', () => submitAnswer(index));
        optionsContainer.appendChild(optionElement);
    });
    
    // Start timer with visual feedback
    startTimer(questionDuration);
    
    // Update live scores
    updateLiveScores(allPlayers);
}

// Start timer with visual feedback
function startTimer(duration) {
    // Set initial timer text
    const timerTextElement = document.getElementById('time-left');
    timerTextElement.textContent = duration;
    
    // Reset timer circle
    const timerProgress = document.getElementById('timer-progress');
    const circumference = 2 * Math.PI * 15; // 2πr where r=15
    timerProgress.style.strokeDasharray = circumference;
    timerProgress.style.strokeDashoffset = '0';
    
    // Clear any existing timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    if (currentQuestionTimer) {
        clearInterval(currentQuestionTimer);
    }
    
    // Calculate exact end time based on server time
    const endTime = questionStartTime + (duration * 1000);
    
    // Function to update timer display
    function updateTimerDisplay() {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const timeLeft = Math.ceil(remaining / 1000);
        
        // Force update the timer text
        document.getElementById('time-left').textContent = timeLeft;
        
        // Update timer circle
        const progress = 1 - (remaining / (duration * 1000));
        const dashOffset = circumference * progress;
        timerProgress.style.strokeDashoffset = dashOffset;
        
        // Add warning class when time is running out
        if (timeLeft <= 5) {
            document.getElementById('timer').classList.add('warning');
        } else {
            document.getElementById('timer').classList.remove('warning');
        }
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            
            // Auto-submit if no answer selected
            if (selectedAnswer === null) {
                submitAnswer(-1); // -1 indicates no answer
            }
        }
    }
    
    // Initial update
    updateTimerDisplay();
    
    // Update timer every 100ms for smoother countdown
    timerInterval = setInterval(updateTimerDisplay, 100);
}

// Show question results
function showQuestionResults(data) {
    const { correctAnswer, players } = data;
    
    // Highlight correct and incorrect answers
    document.querySelectorAll('.option').forEach((option, index) => {
        if (index === correctAnswer) {
            option.classList.add('correct');
        } else if (index === selectedAnswer && selectedAnswer !== correctAnswer) {
            option.classList.add('incorrect');
        }
    });
    
    // Clear timer
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    // Update player scores
    allPlayers = players;
    updateLiveScores(players);
    
    // Show notification
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
    
    // Display final scores
    const finalScores = document.getElementById('final-scores');
    finalScores.innerHTML = '<h3>Final Scores:</h3>';
    
    players.forEach((player, index) => {
        const playerScore = document.createElement('div');
        playerScore.className = 'player-score';
        
        if (index === 0) {
            playerScore.classList.add('winner');
        }
        
        // Highlight current player
        if (player.id === socket.id) {
            playerScore.style.fontWeight = 'bold';
        }
        
        playerScore.innerHTML = `
            <span>${index + 1}. ${player.name}</span>
            <span>${player.score} points</span>
        `;
        
        finalScores.appendChild(playerScore);
    });
    
    // Show results screen
    showScreen('results');
    
    // Create confetti effect for winner
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
        
        // Remove confetti after animation
        setTimeout(() => {
            confetti.remove();
        }, 5000);
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
    console.log('Connected to server');
    
    // Check if we have a room code in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    if (roomCode) {
        // Auto-navigate to join screen
        showScreen('join');
        document.getElementById('room-code').value = roomCode;
    }
    
    // Sync time with server
    socket.emit('sync-time');
});

socket.on('time-sync', (data) => {
    const clientTime = Date.now();
    const serverTime = data.serverTime;
    serverTimeOffset = serverTime - clientTime;
    console.log('Time synchronized with server. Offset:', serverTimeOffset, 'ms');
});

socket.on('error', (data) => {
    alert(data.message);
    
    // Reset loading state if needed
    document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
    document.getElementById('generate-quiz-btn').disabled = false;
});

socket.on('room-created', (data) => {
    const { roomCode, players } = data;
    currentRoomCode = roomCode;
    
    // Display room code
    document.getElementById('display-room-code').textContent = roomCode;
    
    // Generate and display share URL
    const shareUrl = generateShareUrl(roomCode);
    document.getElementById('share-url').value = shareUrl;
    
    // Update players list
    updatePlayersList(players);
    
    // Reset loading state
    document.getElementById('generate-quiz-btn').textContent = 'Generate Quiz';
    document.getElementById('generate-quiz-btn').disabled = false;
    
    // Show waiting screen
    showScreen('waiting');
});

socket.on('room-joined', (data) => {
    const { roomCode, players } = data;
    currentRoomCode = roomCode;
    
    // Display room code
    document.getElementById('display-room-code').textContent = roomCode;
    
    // Generate and display share URL
    const shareUrl = generateShareUrl(roomCode);
    document.getElementById('share-url').value = shareUrl;
    
    // Update players list
    updatePlayersList(players);
    
    // Show waiting screen
    showScreen('waiting');
    
    // Hide start game button for non-hosts
    document.getElementById('start-game-btn').style.display = 'none';
});

socket.on('player-joined', (data) => {
    updatePlayersList(data.players);
    showNotification('New player joined!');
});

socket.on('player-left', (data) => {
    updatePlayersList(data.players);
    showNotification('A player left the game');
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
    // Update player scores in real-time
    allPlayers = data.players;
    updateLiveScores(data.players);
});

// Check for URL parameters on page load
window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    if (roomCode) {
        // Auto-navigate to join screen
        showScreen('join');
        document.getElementById('room-code').value = roomCode;
    }
}); 