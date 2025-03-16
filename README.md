# Quiz Battle

A real-time multiplayer quiz game that uses the Gemini API to generate custom quizzes on any topic.

## Features

- Create custom quizzes on any topic using Google's Gemini API
- Real-time multiplayer gameplay with Socket.io
- Share room codes or direct URLs to invite friends
- Timed questions with visual countdown and scoring
- Live score updates during gameplay
- Animations and visual effects for an engaging experience
- Confetti celebration for winners
- Mobile-responsive design

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Get a Gemini API key from [Google AI Studio](https://makersuite.google.com/)
4. Set your API key:
   - Option 1: Replace the API key in server.js with your actual API key
   - Option 2: Set an environment variable: `export GEMINI_API_KEY=your_api_key_here`

## Running the Application

Start the server:
```
npm start
```

For development with auto-restart:
```
npm run dev
```

Then open your browser and navigate to `http://localhost:3000`

## How to Play

### Creating a Quiz
1. Click "Create Quiz"
2. Enter a topic and select the number of questions
3. Enter your name when prompted
4. Share the room code or URL with friends (copy buttons provided)
5. Click "Start Game" when everyone has joined

### Joining a Quiz
1. Click "Join Quiz" or use a shared URL
2. Enter the room code (if not using a shared URL)
3. Enter your name
4. Wait for the host to start the game

### During the Game
- Each question has a 30-second timer with visual countdown
- Select your answer by clicking on it
- Points are awarded for correct answers (faster answers earn more points)
- Live scores are displayed during the game
- Results are shown after each question
- Final scores and rankings are displayed at the end
- The winner gets a special confetti celebration!

## Enhanced Features

- **Improved Timing**: Visual countdown timer with color changes
- **Real-time Score Updates**: See scores change in real-time as players answer
- **URL Sharing**: Easily share quiz rooms via direct URLs
- **Copy Buttons**: One-click copying of room codes and URLs
- **Animations**: Smooth transitions, pulse effects, and confetti
- **Notifications**: Toast notifications for game events
- **Time-based Scoring**: Faster answers earn more points
- **Visual Feedback**: Correct/incorrect answer animations

## Technologies Used

- HTML, CSS, JavaScript
- Node.js and Express
- Socket.io for real-time communication
- Google's Gemini API for quiz generation 