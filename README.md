# Up-N-Down Card Game

A cooperative multiplayer card game where players work together to play all their cards on four foundation piles. Players must coordinate their moves and communicate strategically to win together.

## Game Overview

Up-N-Down is a unique cooperative card game featuring:
- **2-8 players** in multiplayer mode
- **Solitaire mode** for single-player practice
- Four foundation piles: 2 ascending (starting at 1), 2 descending (starting at 100)
- Special "backward-10" rule: Cards can be played exactly 10 higher/lower in opposite direction
- Cooperative gameplay: All players win or lose together
- Real-time multiplayer synchronization via Socket.IO
- Comprehensive statistics tracking

## Technology Stack

- **Frontend**: React with TypeScript, Vite
- **Backend**: Node.js with Express, Socket.IO
- **Database**: Firebase Realtime Database
- **Styling**: CSS with custom variables (dark theme)
- **Real-time Communication**: Socket.IO for instant game updates

## Project Structure

```
UpNDown/
├── client/              # React TypeScript frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   │   ├── card/    # Card display component
│   │   │   ├── game/    # Game board and statistics
│   │   │   ├── lobby/   # Game lobby and setup
│   │   │   ├── pile/    # Foundation pile component
│   │   │   └── settings/# Game settings editor
│   │   ├── contexts/    # React context providers
│   │   ├── services/    # API communication layer
│   │   ├── styles/      # Global styles and variables
│   │   └── types/       # TypeScript type definitions
│   └── public/
│       └── USER_GUIDE.html  # Comprehensive game guide
├── server/              # Node.js backend
│   └── src/
│       ├── services/    # Game logic and Firebase integration
│       ├── types/       # TypeScript type definitions
│       └── index.ts     # Server entry point with Socket.IO
├── GAME_MECHANICS.md    # Detailed game rules
├── requirements.md      # Feature specifications
└── GameModuleView.md    # Architecture overview
```

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Firebase project with Realtime Database enabled

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/maccorless/up-n-down.git
   cd up-n-down
   ```

2. **Install client dependencies**
   ```bash
   cd client
   npm install
   ```

3. **Install server dependencies**
   ```bash
   cd ../server
   npm install
   ```

4. **Set up environment variables**

   Create `.env` file in the `server` directory based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

   Add your Firebase configuration:
   ```
   PORT=3001
   NODE_ENV=development

   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-client-email
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com

   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
   ```

   Create `.env` file in the `client` directory (optional):
   ```bash
   cp .env.example .env
   ```

   Configure Socket.IO server URL if needed:
   ```
   # Leave empty to use http://localhost:3001 in development
   VITE_SOCKET_URL=
   ```

### Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com/
2. Enable **Realtime Database** (not Firestore)
3. Set database rules for development:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   **Note**: Update rules for production deployment with proper authentication
4. Generate a service account key:
   - Go to Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file securely
5. Copy credentials to `.env` file in server directory

### Running the Application

**Development Mode:**

Open two terminal windows:

```bash
# Terminal 1 - Start server (runs on port 3001)
cd server
npm run dev

# Terminal 2 - Start client (runs on port 5173)
cd client
npm run dev
```

Access the application at `http://localhost:5173`

**Production Build:**

```bash
# Build client
cd client
npm run build

# Build server
cd ../server
npm run build

# Start production server
npm start
```

## Game Rules

### Quick Start
1. **Create or Join a Game**: Enter your name, create a new game (get a 6-character game ID), or join an existing game
2. **Game Setup**: Host can configure settings before starting (card range, hand size, etc.)
3. **Play Cards**: On your turn, play at least 2 cards (or 1 when draw pile is empty)
4. **Win Together**: All players must empty their hands to win

### Foundation Piles
- **Ascending piles (1↑)**: Play higher cards OR play a card exactly 10 lower (backward-10 rule)
- **Descending piles (100↓)**: Play lower cards OR play a card exactly 10 higher (backward-10 rule)

### Turn Structure (Multiplayer)
- Must play minimum 2 cards per turn (1 card minimum in final stage when draw pile is empty)
- Auto-refill hand after each card played (if enabled in settings)
- Click "End Turn" to pass to next player
- Players without cards are skipped automatically

### Solitaire Mode
- No turn restrictions - play as many cards as possible
- Auto-refill is always enabled
- Perfect for learning the game mechanics

See [USER_GUIDE.html](client/public/USER_GUIDE.html) for complete rules and strategy tips.

## Features

### Implemented Features
- ✅ Multiplayer mode (2-8 players) with real-time synchronization
- ✅ Solitaire mode for single-player
- ✅ Customizable game settings (card range, hand size, player limits, etc.)
- ✅ Auto-refill hand option
- ✅ Game statistics tracking (cards played, movement, special plays, averages)
- ✅ Player-specific statistics display
- ✅ Backward-10 special move rule
- ✅ Turn-based gameplay with minimum card requirements
- ✅ Automatic win/loss detection
- ✅ Game ID system for easy multiplayer joining
- ✅ Unique game ID collision detection
- ✅ Comprehensive user guide
- ✅ Dark theme UI with visual card highlighting
- ✅ Player hand visibility (own cards only)

### Future Enhancements
- 🔄 Undo last card played (UI exists, needs implementation)
- 🔄 Foundation pile preference system (like/really like/love)
- 🔄 In-game chat system
- 🔄 Separate Firebase databases for dev and prod environments
- 🔄 Display game ID in UI during gameplay
- 🔄 Display turn sequence in UI
- 🔄 Visual indicators for special plays (backward-10 moves)
- 🔄 Peek at other players' hands (with permission)
- 🔄 Player kick/timeout for inactive players
- 🔄 Drag-and-drop card movement
- 🔄 Mobile-responsive design
- 🔄 Achievement system
- 🔄 Game history and replay

## Game Settings

Customizable via the settings menu in the lobby:

- **Card Range**: Min/max card values (default: 2-99)
- **Hand Size**: Starting cards per player (default: 7)
- **Player Limits**: Min/max players (default: 2-8)
- **Min Cards Per Turn**: Required plays per turn (default: 2)
- **Auto-Refill Hand**: Draw cards immediately vs. at turn end
- **Allow Undo**: Enable/disable undo functionality (future)

## Architecture

### Client Architecture
- **React Context**: Centralized game state management
- **Socket.IO Client**: Real-time server communication
- **Component-based**: Modular, reusable UI components
- **Type-safe**: Full TypeScript implementation

### Server Architecture
- **Express**: HTTP server and REST endpoints
- **Socket.IO**: WebSocket connections for real-time updates
- **Firebase Admin SDK**: Database operations
- **Game Service**: Core game logic and validation

### Data Flow
1. Client emits action via Socket.IO (e.g., `game:playCard`)
2. Server validates action in GameService
3. Server updates Firebase Realtime Database
4. Server responds with callback (synchronous acknowledgment)
5. Server broadcasts update to other players via Socket.IO
6. All clients receive updated game state

## Development

### Code Structure
- All game logic resides in `server/src/services/game.service.ts`
- Client-side game state managed through `client/src/contexts/GameContext.tsx`
- Type definitions shared between client and server
- Defensive programming patterns for Firebase null-safety

### Building for Production
```bash
# Client build
cd client
npm run build
# Output in client/dist/

# Server build
cd server
npm run build
# Output in server/dist/
```

### Testing
- Manual testing currently
- Test both solitaire and multiplayer modes
- Verify statistics tracking
- Test game end conditions (win/loss)
- Test reconnection scenarios

## Contributing

This is a private project. For issues or feature requests, please contact the repository owner.

## Deployment

### Production Deployment to Dreamhost VPS

This application is deployed at **https://upndown.online**

For complete deployment instructions, see:
- **[DREAMHOST_DEPLOYMENT.md](./DREAMHOST_DEPLOYMENT.md)** - Complete step-by-step deployment guide
- **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** - Pre/post deployment checklist
- **[FIREBASE_SECURITY.md](./FIREBASE_SECURITY.md)** - Firebase security configuration

#### Quick Deployment

If you have already set up your Dreamhost VPS server (NVM, Node.js, PM2):

```bash
# 1. Configure the deployment script (one-time)
# Edit deploy.sh and set your VPS username and paths

# 2. Make script executable
chmod +x deploy.sh

# 3. Deploy
./deploy.sh
# Choose: 1) Full deployment 2) Server only 3) Client only

# Or deploy manually:
# Server: ssh into VPS, pull code, npm run build, pm2 restart upndown-server
# Client: build locally, rsync client/dist/ to web directory
```

#### Environment Variables for Production

**Server** (`server/.env`):
```env
PORT=3001
NODE_ENV=production
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-email
FIREBASE_PRIVATE_KEY="your-private-key-with-\n"
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
ALLOWED_ORIGINS=https://upndown.online
```

**Client** (`client/.env`):
```env
VITE_SOCKET_URL=https://upndown.online
```

See `.env.production.example` files in both directories for templates.

## License

Private - All rights reserved

## Documentation

### Game Documentation
- [GAME_MECHANICS.md](./GAME_MECHANICS.md) - Detailed game rules and implementation
- [requirements.md](./requirements.md) - Feature specifications and requirements
- [GameModuleView.md](./GameModuleView.md) - Project architecture overview
- [USER_GUIDE.html](./client/public/USER_GUIDE.html) - Player-facing game guide

### Deployment Documentation
- [DREAMHOST_DEPLOYMENT.md](./DREAMHOST_DEPLOYMENT.md) - Complete Dreamhost VPS deployment guide
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - Pre/post deployment checklist
- [FIREBASE_SECURITY.md](./FIREBASE_SECURITY.md) - Firebase security rules and configuration

### Project Documentation
- [CHANGES_SUMMARY.md](./CHANGES_SUMMARY.md) - Recent changes and bug fixes
- [FUTURE_IMPROVEMENTS.md](./FUTURE_IMPROVEMENTS.md) - Planned optimizations and features
- [GETTING_STARTED.md](./GETTING_STARTED.md) - Development setup guide

## Acknowledgments

Built with React, TypeScript, Node.js, Express, Socket.IO, and Firebase.
