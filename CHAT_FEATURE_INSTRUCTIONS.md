# Chat Feature Backend Implementation Guide

## Overview
Add chat functionality to the pythia-api backend to support persistent conversation history with privacy controls.

---

## Database Changes

### Step 1: Create Migration Script

**File**: `/Users/dominiquemb/dev/pythia-api/scripts/003_chat_messages_table.sql`

```sql
-- Chat Messages Table
-- Stores conversation history grouped by session keys (event selections)

CREATE TABLE IF NOT EXISTS chat_messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    session_key VARCHAR(255) NOT NULL,
    user_message TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    event_ids_used JSON NOT NULL,
    query_metadata JSON DEFAULT NULL,
    is_saved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_session (user_id, session_key),
    INDEX idx_created_at (created_at),
    INDEX idx_is_saved (is_saved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2: Run Migration

```bash
mysql -u root -p pythia < scripts/003_chat_messages_table.sql
```

---

## Session Key Format

Chat sessions are grouped by event selection combinations:

**Format**: `user_{userId}_events_{sortedEventIds}`

**Examples**:
- Events 1, 3, 5 selected → `user_abc123_events_1-3-5`
- Events 2, 7 selected → `user_abc123_events_2-7`
- Single event 4 → `user_abc123_events_4`
- No events selected → `user_abc123_events_general` (general astrology questions)

**Logic**:
- Different event combinations = different chat sessions
- Same event combination = same chat session (history persists)
- Event IDs sorted numerically before creating key

---

## API Endpoints to Implement

### Endpoint 1: POST /api/chat

**Purpose**: Submit a chat message and get AI response, optionally save to database

**Location**: Add to `/Users/dominiquemb/dev/pythia-api/server.js` around line 981 (before `app.listen()`)

**Authentication**: Required (Supabase JWT)

**Rate Limiting**: Uses existing `user_query_stats` (5 queries/day)

**Request**:
```javascript
POST /api/chat
Headers: {
  "Authorization": "<supabase_jwt_token>",
  "Content-Type": "application/json"
}
Body: {
  "userId": "abc123",
  "sessionKey": "user_abc123_events_1-3-5",
  "userMessage": "What are my themes for this month?",
  "chartData": "[{\"event_id\":1,...},{\"event_id\":3,...}]",
  "saveToHistory": true,  // If false, don't persist to database
  "transitTimestamp": "2025-08-12T10:30:00Z" or null,
  "progressed": false,
  "progressedEventIds": [],
  "progressedTimezones": {}
}
```

**Response**:
```javascript
{
  "response": "Based on your chart...",
  "messageId": 123,  // Only if saved
  "saved": true      // Indicates if message was persisted
}
```

**Implementation**:

```javascript
app.post("/api/chat", async (req, res) => {
  let conn;
  const { authorization } = req.headers;
  const {
    userId,
    sessionKey,
    userMessage,
    chartData,
    saveToHistory = true,
    transitTimestamp,
    progressed,
    progressedEventIds,
    progressedTimezones,
    houseSystem = "P",
  } = req.body;

  try {
    // === 1. AUTHENTICATION ===
    if (!authorization) {
      return res.status(400).json({
        error: "Missing JWT token in Authorization header."
      });
    }

    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({ error: "Invalid JWT token" });
    }

    if (verified.data.user.id !== userId) {
      return res.status(403).json({
        error: "Forbidden: You can only request your own data."
      });
    }

    // === 2. VALIDATION ===
    if (!userMessage || !userMessage.trim()) {
      return res.status(400).json({ error: "userMessage is required" });
    }

    if (!sessionKey) {
      return res.status(400).json({ error: "sessionKey is required" });
    }

    // === 3. RATE LIMITING (existing pattern from /api/query) ===
    conn = await pool.getConnection();

    const checkQuery = `SELECT queries_today, last_query_timestamp FROM user_query_stats WHERE user_id = ?`;
    const userStats = await conn.query(checkQuery, [userId]);

    if (userStats.length > 0) {
      const lastQueryTimestamp = userStats[0].last_query_timestamp;
      const lastQueryDay = new Date(lastQueryTimestamp).toDateString();
      const today = new Date().toDateString();

      if (today === lastQueryDay && userStats[0].queries_today >= 5) {
        conn.release();
        return res.status(429).json({
          error: "Query limit of 5 per day reached. Please try again tomorrow."
        });
      }
    }

    // === 4. PARSE CHART DATA ===
    let parsedChartData = [];
    let eventIdsUsed = [];

    // Chart data is optional - allow general astrology questions without charts
    if (chartData) {
      try {
        parsedChartData = typeof chartData === "string"
          ? JSON.parse(chartData)
          : chartData;
        eventIdsUsed = parsedChartData.map(event => event.event_id);
      } catch (err) {
        conn.release();
        return res.status(400).json({ error: "Invalid chartData JSON" });
      }
    }

    // === 5. BUILD ASTROLOGICAL CONTEXT (reuse logic from /api/query) ===
    // This section should mirror lines 791-950 from existing /api/query endpoint

    let chartContext = "";
    if (parsedChartData.length > 0) {
      for (const event of parsedChartData) {
        chartContext += `\n\n--- ${event.label} ---\n`;
        chartContext += JSON.stringify(event.event_data, null, 2);
      }
    } else {
      chartContext = "\n\nNo specific birth charts provided. This is a general astrology question.\n";
    }

    // Handle progressed charts if requested
    let progressedContext = "";
    if (progressed && progressedEventIds?.length > 0) {
      // Reuse progressed chart calculation logic from /api/query (lines 800-850)
      // ... (copy implementation from existing endpoint)
    }

    // Handle transits if requested
    let transitContext = "";
    if (transitTimestamp) {
      // Reuse transit calculation logic from /api/query (lines 851-900)
      // ... (copy implementation from existing endpoint)
    }

    // === 6. CALL GEMINI API ===
    const systemPrompt = parsedChartData.length > 0
      ? `You are Pythia, an expert astrologer. Answer the user's question based on the following astrological data:

${chartContext}
${progressedContext}
${transitContext}

User Question: ${userMessage}

Provide a detailed, insightful astrological interpretation.`
      : `You are Pythia, an expert astrologer. Answer the user's general astrology question:

${userMessage}

Provide a detailed, insightful astrological interpretation. Since no specific birth charts are provided, give general astrological wisdom and insights.`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const geminiResponse = await axios.post(apiUrl, {
      contents: [
        {
          parts: [{ text: systemPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8000,
      },
    });

    const text = geminiResponse?.data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("No response from Gemini API");
    }

    // === 7. SAVE TO DATABASE (if requested) ===
    let messageId = null;
    if (saveToHistory) {
      const insertQuery = `
        INSERT INTO chat_messages
        (user_id, session_key, user_message, assistant_response, event_ids_used, query_metadata, is_saved)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const metadata = {
        transitTimestamp,
        progressed,
        progressedEventIds,
        progressedTimezones,
        houseSystem
      };

      const insertResult = await conn.query(insertQuery, [
        userId,
        sessionKey,
        userMessage,
        text,
        JSON.stringify(eventIdsUsed),
        JSON.stringify(metadata),
        true
      ]);

      messageId = insertResult.insertId;
    }

    // === 8. UPDATE RATE LIMIT STATS ===
    const lastQueryDay = userStats.length > 0
      ? new Date(userStats[0].last_query_timestamp).toDateString()
      : null;
    const today = new Date().toDateString();

    if (lastQueryDay === today) {
      await conn.query(
        `UPDATE user_query_stats SET queries_today = queries_today + 1, last_query_timestamp = NOW() WHERE user_id = ?`,
        [userId]
      );
    } else {
      await conn.query(
        `INSERT INTO user_query_stats (user_id, queries_today, last_query_timestamp) VALUES (?, 1, NOW())
         ON DUPLICATE KEY UPDATE queries_today = 1, last_query_timestamp = NOW()`,
        [userId]
      );
    }

    // === 9. RETURN RESPONSE ===
    res.json({
      response: text,
      messageId: messageId,
      saved: saveToHistory
    });

  } catch (err) {
    console.error("Chat endpoint error:", err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  } finally {
    if (conn) conn.release();
  }
});
```

---

### Endpoint 2: GET /api/chat/:userId/:sessionKey

**Purpose**: Retrieve all messages for a specific chat session

**Authentication**: Required

**Request**:
```
GET /api/chat/abc123/user_abc123_events_1-3-5?limit=50&offset=0
Headers: {
  "Authorization": "<supabase_jwt_token>"
}
```

**Response**:
```javascript
{
  "messages": [
    {
      "messageId": 1,
      "userMessage": "What are my themes?",
      "assistantResponse": "Your chart shows...",
      "eventIdsUsed": [1, 3, 5],
      "createdAt": "2025-08-12T10:30:00Z"
    },
    {
      "messageId": 2,
      "userMessage": "Tell me more about Venus",
      "assistantResponse": "Venus in your chart...",
      "eventIdsUsed": [1, 3, 5],
      "createdAt": "2025-08-12T10:35:00Z"
    }
  ],
  "total": 2
}
```

**Implementation**:

```javascript
app.get("/api/chat/:userId/:sessionKey", async (req, res) => {
  let conn;
  const { authorization } = req.headers;
  const { userId, sessionKey } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  try {
    // === AUTHENTICATION ===
    if (!authorization) {
      return res.status(400).json({ error: "Missing JWT token" });
    }

    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({ error: "Invalid JWT token" });
    }

    if (verified.data.user.id !== userId) {
      return res.status(403).json({
        error: "Forbidden: You can only access your own chat history."
      });
    }

    // === FETCH MESSAGES ===
    conn = await pool.getConnection();

    const messagesQuery = `
      SELECT
        message_id as messageId,
        user_message as userMessage,
        assistant_response as assistantResponse,
        event_ids_used as eventIdsUsed,
        created_at as createdAt
      FROM chat_messages
      WHERE user_id = ? AND session_key = ? AND is_saved = TRUE
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?
    `;

    const messages = await conn.query(messagesQuery, [userId, sessionKey, limit, offset]);

    // Parse JSON fields
    const formattedMessages = messages.map(msg => ({
      ...msg,
      eventIdsUsed: JSON.parse(msg.eventIdsUsed)
    }));

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM chat_messages
      WHERE user_id = ? AND session_key = ? AND is_saved = TRUE
    `;
    const countResult = await conn.query(countQuery, [userId, sessionKey]);
    const total = countResult[0]?.total || 0;

    res.json({
      messages: formattedMessages,
      total: total
    });

  } catch (err) {
    console.error("Get chat history error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
```

---

### Endpoint 3: GET /api/chat-sessions/:userId

**Purpose**: List all unique chat sessions for a user

**Authentication**: Required

**Request**:
```
GET /api/chat-sessions/abc123
Headers: {
  "Authorization": "<supabase_jwt_token>"
}
```

**Response**:
```javascript
{
  "sessions": [
    {
      "sessionKey": "user_abc123_events_1-3",
      "eventIds": [1, 3],
      "messageCount": 5,
      "lastMessageAt": "2025-08-12T10:30:00Z"
    },
    {
      "sessionKey": "user_abc123_events_2-7",
      "eventIds": [2, 7],
      "messageCount": 3,
      "lastMessageAt": "2025-08-11T15:20:00Z"
    }
  ]
}
```

**Implementation**:

```javascript
app.get("/api/chat-sessions/:userId", async (req, res) => {
  let conn;
  const { authorization } = req.headers;
  const { userId } = req.params;

  try {
    // === AUTHENTICATION ===
    if (!authorization) {
      return res.status(400).json({ error: "Missing JWT token" });
    }

    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({ error: "Invalid JWT token" });
    }

    if (verified.data.user.id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // === FETCH SESSIONS ===
    conn = await pool.getConnection();

    const sessionsQuery = `
      SELECT
        session_key as sessionKey,
        event_ids_used as eventIds,
        COUNT(*) as messageCount,
        MAX(created_at) as lastMessageAt
      FROM chat_messages
      WHERE user_id = ? AND is_saved = TRUE
      GROUP BY session_key
      ORDER BY lastMessageAt DESC
    `;

    const sessions = await conn.query(sessionsQuery, [userId]);

    // Parse event IDs and format
    const formattedSessions = sessions.map(session => {
      // Get event IDs from first message in each session
      const eventIds = JSON.parse(session.eventIds);

      return {
        sessionKey: session.sessionKey,
        eventIds: eventIds,
        messageCount: session.messageCount,
        lastMessageAt: session.lastMessageAt
      };
    });

    res.json({ sessions: formattedSessions });

  } catch (err) {
    console.error("Get sessions error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
```

---

### Endpoint 4: DELETE /api/chat/:messageId

**Purpose**: Delete a single message from chat history

**Authentication**: Required (verify user owns the message)

**Request**:
```
DELETE /api/chat/123
Headers: {
  "Authorization": "<supabase_jwt_token>"
}
```

**Response**:
```javascript
{
  "success": true,
  "message": "Message deleted successfully"
}
```

**Implementation**:

```javascript
app.delete("/api/chat/:messageId", async (req, res) => {
  let conn;
  const { authorization } = req.headers;
  const { messageId } = req.params;

  try {
    // === AUTHENTICATION ===
    if (!authorization) {
      return res.status(400).json({ error: "Missing JWT token" });
    }

    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({ error: "Invalid JWT token" });
    }

    const userId = verified.data.user.id;

    // === DELETE MESSAGE ===
    conn = await pool.getConnection();

    // First verify the message belongs to this user
    const checkQuery = `SELECT user_id FROM chat_messages WHERE message_id = ?`;
    const checkResult = await conn.query(checkQuery, [messageId]);

    if (checkResult.length === 0) {
      conn.release();
      return res.status(404).json({ error: "Message not found" });
    }

    if (checkResult[0].user_id !== userId) {
      conn.release();
      return res.status(403).json({ error: "Forbidden: Not your message" });
    }

    // Delete the message
    const deleteQuery = `DELETE FROM chat_messages WHERE message_id = ?`;
    await conn.query(deleteQuery, [messageId]);

    res.json({
      success: true,
      message: "Message deleted successfully"
    });

  } catch (err) {
    console.error("Delete message error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
```

---

### Endpoint 5: DELETE /api/chat-session/:userId/:sessionKey

**Purpose**: Clear entire chat session (delete all messages in that session)

**Authentication**: Required

**Request**:
```
DELETE /api/chat-session/abc123/user_abc123_events_1-3-5
Headers: {
  "Authorization": "<supabase_jwt_token>"
}
```

**Response**:
```javascript
{
  "success": true,
  "deletedCount": 5,
  "message": "Chat session cleared successfully"
}
```

**Implementation**:

```javascript
app.delete("/api/chat-session/:userId/:sessionKey", async (req, res) => {
  let conn;
  const { authorization } = req.headers;
  const { userId, sessionKey } = req.params;

  try {
    // === AUTHENTICATION ===
    if (!authorization) {
      return res.status(400).json({ error: "Missing JWT token" });
    }

    const verified = await supabase.auth.getUser(authorization);
    if (!verified?.data?.user) {
      return res.status(400).json({ error: "Invalid JWT token" });
    }

    if (verified.data.user.id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // === DELETE SESSION ===
    conn = await pool.getConnection();

    const deleteQuery = `
      DELETE FROM chat_messages
      WHERE user_id = ? AND session_key = ?
    `;
    const result = await conn.query(deleteQuery, [userId, sessionKey]);

    res.json({
      success: true,
      deletedCount: result.affectedRows,
      message: "Chat session cleared successfully"
    });

  } catch (err) {
    console.error("Delete session error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});
```

---

## Testing Checklist

### 1. Database Migration
```bash
# Run migration
mysql -u root -p pythia < scripts/003_chat_messages_table.sql

# Verify table created
mysql -u root -p pythia -e "DESCRIBE chat_messages;"
```

### 2. POST /api/chat (with save)
```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_JWT_TOKEN" \
  -d '{
    "userId": "test-user-123",
    "sessionKey": "user_test-user-123_events_1-3",
    "userMessage": "What are my themes?",
    "chartData": "[{\"event_id\":1,\"label\":\"Me\",\"event_data\":{}}]",
    "saveToHistory": true
  }'
```

Expected: `{ "response": "...", "messageId": 1, "saved": true }`

### 3. POST /api/chat (without save)
```bash
curl -X POST http://localhost:3002/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_JWT_TOKEN" \
  -d '{
    "userId": "test-user-123",
    "sessionKey": "user_test-user-123_events_1-3",
    "userMessage": "Tell me more",
    "chartData": "[{\"event_id\":1,\"label\":\"Me\",\"event_data\":{}}]",
    "saveToHistory": false
  }'
```

Expected: `{ "response": "...", "messageId": null, "saved": false }`

### 4. GET /api/chat/:userId/:sessionKey
```bash
curl -X GET "http://localhost:3002/api/chat/test-user-123/user_test-user-123_events_1-3" \
  -H "Authorization: YOUR_JWT_TOKEN"
```

Expected: `{ "messages": [...], "total": 1 }`

### 5. GET /api/chat-sessions/:userId
```bash
curl -X GET "http://localhost:3002/api/chat-sessions/test-user-123" \
  -H "Authorization: YOUR_JWT_TOKEN"
```

Expected: `{ "sessions": [{...}] }`

### 6. DELETE /api/chat-session/:userId/:sessionKey
```bash
curl -X DELETE "http://localhost:3002/api/chat-session/test-user-123/user_test-user-123_events_1-3" \
  -H "Authorization: YOUR_JWT_TOKEN"
```

Expected: `{ "success": true, "deletedCount": 1, "message": "..." }`

---

## Error Handling

All endpoints should follow the existing error handling pattern:

```javascript
try {
  // endpoint logic
} catch (err) {
  console.error("Endpoint error:", err.message);
  res.status(500).json({ error: err.message });
} finally {
  if (conn) conn.release();
}
```

---

## Security Considerations

1. **Authentication**: All endpoints verify Supabase JWT
2. **Authorization**: Users can only access their own data
3. **SQL Injection**: Use parameterized queries (already implemented with `conn.query`)
4. **Rate Limiting**: Reuse existing `user_query_stats` table
5. **Input Validation**: Validate required fields, sanitize user input

---

## Performance Notes

- Add index on `(user_id, session_key)` for fast session lookups
- Add index on `created_at` for chronological ordering
- Add index on `is_saved` for filtering saved messages
- Consider pagination for large chat histories (already implemented with limit/offset)

---

## Future Optimizations

- Add `updated_at` timestamp for message edits
- Add `deleted_at` for soft deletes (instead of hard deletes)
- Add message reactions/favorites
- Add full-text search on user_message and assistant_response
- Cache frequently accessed sessions in Redis
