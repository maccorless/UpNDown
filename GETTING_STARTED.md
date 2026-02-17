# Getting Started with Up-N-Down Card Game

## Project Status

✅ **Phase 1 Complete** - Basic project structure and core functionality implemented!

## What's Been Built

### Backend (Server)
- ✅ Node.js + Express + Socket.io server
- ✅ Firebase Realtime Database integration
- ✅ Complete game logic and validation
- ✅ Real-time multiplayer support
- ✅ Game state management
- ✅ Card play validation (including special ±10 rules)
- ✅ Turn management and game flow

### Frontend (Client)
- ✅ React + TypeScript with Vite
- ✅ Game lobby (create/join games)
- ✅ Real-time game board
- ✅ Card and pile components
- ✅ Player hand management
- ✅ Turn indicators
- ✅ Socket.io client integration
- ✅ Responsive UI with styled components

## Next Steps to Run the Game

### 1. Firebase Setup (Required)

You need to set up Firebase before the game can run:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable **Realtime Database**
4. Get your configuration:
   - Project Settings → Service Accounts → Generate New Private Key
   - Project Settings → General → Your apps → Web app config

### 2. Configure Environment Variables

#### Server Configuration
Create `server/.env`:
```env
PORT=3001
NODE_ENV=development

# Firebase Admin (from service account JSON)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

#### Client Configuration
Create `client/.env`:
```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001

# Firebase Client Config (from web app settings)
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 3. Run the Application

#### Terminal 1 - Start the Server
```bash
cd server
npm run dev
```

Server will start on http://localhost:3001

#### Terminal 2 - Start the Client
```bash
cd client
npm run dev
```

Client will start on http://localhost:5173

### 4. Play the Game!

1. Open http://localhost:5173 in your browser
2. Enter your name
3. Click "Create New Game" to host
4. Share the 6-character Game ID with friends
5. Friends can join by clicking "Join Existing Game"
6. Host starts the game when ready
7. Play cooperatively to win!

## Game Rules Quick Reference

- **Goal**: All players work together to play all cards
- **Foundation Piles**:
  - 2 Ascending (green) - play higher or exactly 10 lower
  - 2 Descending (red) - play lower or exactly 10 higher
- **Turn Structure**:
  - Must play minimum 2 cards (1 in final stage)
  - Draw replacement cards after turn ends
  - Game advances to next player
- **Win/Lose**:
  - Win: All players empty their hands
  - Lose: Current player has no valid plays

## Project Structure

```
UpNDown/
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── contexts/    # React contexts
│   │   ├── services/    # Socket.io service
│   │   ├── types/       # TypeScript types
│   │   ├── utils/       # Helper functions
│   │   └── styles/      # CSS styles
│   └── package.json
│
├── server/              # Node.js backend
│   ├── src/
│   │   ├── config/      # Firebase config
│   │   ├── services/    # Game logic
│   │   ├── types/       # TypeScript types
│   │   └── index.ts     # Server entry
│   └── package.json
│
├── GAME_MECHANICS.md    # Detailed game rules
├── requirements.md      # Full requirements
└── README.md           # Project overview
```

## Implemented Features

✅ Game creation and joining
✅ Real-time multiplayer synchronization
✅ Turn-based gameplay
✅ Card play validation
✅ Special ±10 rule
✅ Draw pile management
✅ Final stage detection
✅ Win/lose condition checking
✅ Player status display
✅ Responsive UI

## Features Still To Implement

From your requirements.md TODO list:
- [ ] Pile preference system (like/reallylike/love) - UI exists, needs backend hookup
- [ ] Undo functionality
- [ ] Game statistics tracking
- [ ] Solitaire mode
- [ ] Settings customization UI
- [ ] Chat system
- [ ] Player names/Google sign-in
- [ ] Special play visual effects
- [ ] Mid-game join capability
- [ ] Inactive player kick

## Troubleshooting

**Can't connect to server?**
- Check if server is running on port 3001
- Verify CORS settings in server/.env
- Check browser console for errors

**Firebase errors?**
- Verify .env files have correct credentials
- Check Firebase Realtime Database is enabled
- Ensure database rules allow read/write (for development)

**TypeScript errors?**
- Run `npm run build` to check for type errors
- Both client and server should compile successfully

## Development Commands

### Server
- `npm run dev` - Start development server
- `npm run build` - Build TypeScript
- `npm start` - Run production build
- `npm run lint` - Run ESLint

### Client
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Need Help?

- Review `GAME_MECHANICS.md` for game rules
- Check `requirements.md` for specifications
- Look at the reference repo: https://github.com/kencorless/UpNDown

## Ready to Push to GitHub?

```bash
# Create a new repository on GitHub first, then:
git remote add origin https://github.com/yourusername/UpNDown.git
git branch -M main
git push -u origin main
```

---

**Happy Gaming!** 🎮🃏
