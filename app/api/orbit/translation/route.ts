import { NextRequest } from 'next/server';

/**
 * WebSocket Translation Server
 *
 * This route handles WebSocket connections for real-time two-way translation.
 * It broadcasts transcriptions to all connected users and tracks their language preferences.
 *
 * Note: Next.js App Router doesn't natively support WebSocket in API routes.
 * For production, consider using:
 * 1. Socket.io with a custom server
 * 2. Pusher, Ably, or similar hosted WebSocket service
 * 3. Server-Sent Events (SSE) for one-way streaming
 *
 * This implementation uses Server-Sent Events as the primary method
 * with WebSocket documentation for future implementation.
 */

// In-memory storage for connected users (use Redis in production)
const connectedUsers = new Map<string, Map<string, any>>();

/**
 * Server-Sent Events Handler
 * GET /api/orbit/translation/stream
 *
 * Query params:
 * - meetingId: The meeting/room ID
 * - userId: The user's unique ID
 * - userName: The user's display name
 * - language: The user's target language
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const meetingId = searchParams.get('meetingId');
  const userId = searchParams.get('userId');
  const userName = searchParams.get('userName') || 'Anonymous';
  const language = searchParams.get('language') || 'English';

  if (!meetingId || !userId) {
    return new Response('Missing meetingId or userId', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Add user to connected users
      if (!connectedUsers.has(meetingId)) {
        connectedUsers.set(meetingId, new Map());
      }

      const meetingUsers = connectedUsers.get(meetingId)!;
      meetingUsers.set(userId, {
        userId,
        userName,
        language,
        controller,
        role: 'idle',
      });

      // Notify all users about new participant
      broadcastToMeeting(
        meetingId,
        {
          type: 'user-joined',
          userId,
          userName,
          language,
          role: 'idle',
        },
        userId,
      );

      // Send current users list to new user
      const usersList = Array.from(meetingUsers.values()).map((u) => ({
        userId: u.userId,
        userName: u.userName,
        selectedLanguage: u.language,
        role: u.role,
      }));

      sendToUser(userId, {
        type: 'users-list',
        users: usersList,
      });

      // Send welcome message
      sendToUser(userId, {
        type: 'connected',
        message: 'Connected to translation stream',
      });

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        meetingUsers.delete(userId);

        // Notify others
        broadcastToMeeting(
          meetingId,
          {
            type: 'user-left',
            userId,
          },
          userId,
        );

        // Clean up empty meetings
        if (meetingUsers.size === 0) {
          connectedUsers.delete(meetingId);
        }

        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * POST /api/orbit/translation/broadcast
 *
 * Body:
 * - meetingId: The meeting ID
 * - userId: Sender's user ID
 * - type: Message type ('transcription', 'role-change', 'translation-complete')
 * - ...other data depending on type
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { meetingId, userId, type, ...payload } = data;

    if (!meetingId || !userId || !type) {
      return new Response('Missing required fields', { status: 400 });
    }

    const meetingUsers = connectedUsers.get(meetingId);
    if (!meetingUsers) {
      return new Response('Meeting not found', { status: 404 });
    }

    switch (type) {
      case 'transcription':
        // Broadcast transcription to all listeners
        broadcastToMeeting(
          meetingId,
          {
            type: 'transcription',
            messageId: payload.messageId,
            speakerId: userId,
            speakerName: payload.speakerName,
            text: payload.text,
            timestamp: payload.timestamp,
            targetLanguages: payload.targetLanguages,
          },
          null,
        ); // Broadcast to all
        break;

      case 'role-change':
        // Update user's role
        const user = meetingUsers.get(userId);
        if (user) {
          user.role = payload.role;
          broadcastToMeeting(
            meetingId,
            {
              type: 'user-updated',
              userId,
              role: payload.role,
            },
            null,
          );
        }
        break;

      case 'translation-complete':
        // Notify speaker that translation is ready
        broadcastToMeeting(
          meetingId,
          {
            type: 'translation-complete',
            messageId: payload.messageId,
            userId: payload.userId,
            language: payload.language,
            translation: payload.translation,
          },
          null,
        );
        break;
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('[Translation API] Error:', error);
    return new Response('Internal error', { status: 500 });
  }
}

// Helper functions
function sendToUser(userId: string, data: any) {
  // Find user in all meetings
  for (const [meetingId, users] of connectedUsers) {
    const user = users.get(userId);
    if (user) {
      try {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        user.controller.enqueue(new TextEncoder().encode(message));
      } catch (error) {
        console.error(`[Translation API] Failed to send to user ${userId}:`, error);
        users.delete(userId);
      }
      return;
    }
  }
}

function broadcastToMeeting(meetingId: string, data: any, excludeUserId: string | null) {
  const users = connectedUsers.get(meetingId);
  if (!users) return;

  const message = `data: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(message);

  for (const [userId, user] of users) {
    if (excludeUserId && userId === excludeUserId) continue;

    try {
      user.controller.enqueue(encoded);
    } catch (error) {
      console.error(`[Translation API] Failed to broadcast to ${userId}:`, error);
      users.delete(userId);
    }
  }
}

/**
 * WebSocket Implementation (for reference)
 *
 * For production use, implement WebSocket using one of these methods:
 *
 * 1. Socket.io with Custom Server:
 *    - Create a custom server.js that wraps Next.js
 *    - Initialize Socket.io on the server
 *    - Handle bidirectional communication
 *
 * 2. Hosted WebSocket Service (Recommended):
 *    - Use Pusher, Ably, or PubNub
 *    - Better scalability and reliability
 *    - Less infrastructure to maintain
 *
 * 3. Server-Sent Events (Current Implementation):
 *    - One-way streaming (server to client)
 *    - Use POST for client to server communication
 *    - Good enough for most translation use cases
 *
 * Example Socket.io implementation:
 *
 * ```typescript
 * // server.js
 * const { createServer } = require('http');
 * const { parse } = require('url');
 * const next = require('next');
 * const { Server } = require('socket.io');
 *
 * const dev = process.env.NODE_ENV !== 'production';
 * const app = next({ dev });
 * const handle = app.getRequestHandler();
 *
 * app.prepare().then(() => {
 *   const server = createServer((req, res) => {
 *     const parsedUrl = parse(req.url, true);
 *     handle(req, res, parsedUrl);
 *   });
 *
 *   const io = new Server(server);
 *
 *   io.on('connection', (socket) => {
 *     socket.on('join-meeting', ({ meetingId, userId, userName, language }) => {
 *       socket.join(meetingId);
 *       socket.to(meetingId).emit('user-joined', { userId, userName, language });
 *     });
 *
 *     socket.on('transcription', (data) => {
 *       socket.to(data.meetingId).emit('transcription', data);
 *     });
 *   });
 *
 *   server.listen(3000);
 * });
 * ```
 */
