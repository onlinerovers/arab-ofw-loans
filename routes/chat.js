const express = require('express');
const { body, validationResult } = require('express-validator');
const chatbot = require('../services/chatbot');
const { run } = require('../db');
const { sendAdminNewChat } = require('../services/email');

const router = express.Router();

const messageValidation = [
  body('message').trim().notEmpty().withMessage('Message is required.').escape(),
  body('sessionId').optional().trim(),
  body('userName').optional().trim().escape(),
  body('userEmail').optional().trim().isEmail().normalizeEmail(),
];

router.post('/message', messageValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, error: errors.array().map((e) => e.msg).join(' ') });
  }

  const { message, sessionId, userName, userEmail } = req.body;

  try {
    const { one } = require('../db');
    const existingSession = sessionId
      ? await one('SELECT id FROM chat_sessions WHERE session_id = $1', [sessionId])
      : null;
    const isNewSession = !existingSession;

    const session = await chatbot.getOrCreateSession(sessionId, userName, userEmail);
    await chatbot.saveMessage(session.session_id, 'user', message);

    if (isNewSession) {
      const preview = message.length > 80 ? message.slice(0, 80) + '…' : message;
      await run(
        `INSERT INTO notifications (type, title, body, link) VALUES ($1, $2, $3, $4)`,
        ['new_chat', `New chat from ${userName || 'visitor'}`, `"${preview}"`, '/admin/chat-logs']
      );
      sendAdminNewChat(session.session_id, message, userName, userEmail).catch(() => {});
    }

    const reply = await chatbot.getResponse(message, session.session_id);
    await chatbot.saveMessage(session.session_id, 'bot', reply);

    res.json({ success: true, reply, sessionId: session.session_id });
  } catch (err) {
    console.error('[chat] Error:', err);
    res.status(500).json({ success: false, error: 'Unable to process your message. Please try again.' });
  }
});

router.get('/history', async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId) return res.status(400).json({ success: false, error: 'Session ID required.' });
  try {
    const history = await chatbot.getHistory(sessionId);
    res.json({ success: true, history });
  } catch (err) {
    console.error('[chat] Error:', err);
    res.status(500).json({ success: false, error: 'Unable to load chat history.' });
  }
});

module.exports = router;
