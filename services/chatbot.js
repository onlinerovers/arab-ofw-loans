const { one, all, run } = require('../db');
const crypto = require('crypto');
const OpenAI = require('openai');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const systemPrompt = `You are a helpful assistant for Arab OFW Loans & Partners.
Help applicants with: applying for a loan, checking status, requirements, repayment, contacting support.
Keep answers concise (2-4 sentences). Reply in the same language the user writes in.
Do not promise loan approval or specific amounts. Do not ask for passwords.`;

const faq = [
  { keywords: ['apply','application','how to apply'], response: 'You can apply on our homepage. Click "Apply Now", fill in your details, and you\'ll receive a reference number to track your application.' },
  { keywords: ['status','track','check','reference','pending','approved','collected','rejected'], response: 'Log in to your dashboard to track your application status in real time, or check the public waitlist on the homepage.' },
  { keywords: ['amount','maximum','minimum','how much','loan limit'], response: 'You can apply for any amount starting from $1. The final approved amount depends on your profile and review by our admin team.' },
  { keywords: ['interest','rate','repayment','pay back','installment'], response: 'Repayment terms are agreed upon approval. You can choose your preferred loan term in months when applying.' },
  { keywords: ['requirement','eligible','qualify','documents'], response: 'You need your full name, contact details, employment status, monthly income, and a valid ID. You can also upload supporting documents.' },
  { keywords: ['time','long','how long','when','approval time'], response: 'Applications are reviewed as soon as possible. You\'ll receive an email update on approval, rejection, or disbursement.' },
  { keywords: ['contact','support','help','human','agent'], response: 'For further help, contact our support team via the details on this site or ask to speak with an admin.' },
  { keywords: ['hello','hi','hey','good morning','good afternoon','good evening'], response: 'Hello! Welcome to Arab OFW Loans & Partners. How can I help you today?' },
  { keywords: ['reject','rejected','declined','why'], response: 'If your application is rejected, it did not meet our current lending criteria. You can contact support for more details or reapply in the future.' },
];

function generateSessionId() {
  return crypto.randomUUID();
}

async function getOrCreateSession(sessionId, userName, userEmail) {
  let session = await one('SELECT * FROM chat_sessions WHERE session_id = $1', [sessionId]);
  if (!session) {
    const newId = sessionId || generateSessionId();
    const r = await run(
      'INSERT INTO chat_sessions (session_id, user_name, user_email) VALUES ($1, $2, $3) RETURNING *',
      [newId, userName || null, userEmail || null]
    );
    session = r.rows[0];
  }
  return session;
}

async function saveMessage(sessionId, role, message) {
  await run('INSERT INTO chat_messages (session_id, role, message) VALUES ($1, $2, $3)', [sessionId, role, message]);
  await run('UPDATE chat_sessions SET updated_at = NOW() WHERE session_id = $1', [sessionId]);
}

async function getHistory(sessionId, limit = 50) {
  return all(
    'SELECT role, message, created_at FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
    [sessionId, limit]
  );
}

function getFAQResponse(userMessage) {
  const lower = userMessage.toLowerCase();
  for (const item of faq) {
    if (item.keywords.some((kw) => lower.includes(kw))) return item.response;
  }
  return null;
}

async function getAIResponse(userMessage, history) {
  if (!openai) return null;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.message })),
    { role: 'user', content: userMessage },
  ];
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages,
      max_tokens: 250,
      temperature: 0.7,
    });
    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[chatbot] OpenAI error:', err.message);
    return null;
  }
}

async function getResponse(userMessage, sessionId) {
  const history = sessionId ? await getHistory(sessionId) : [];
  const aiReply = await getAIResponse(userMessage, history);
  if (aiReply) return aiReply;
  const faqReply = getFAQResponse(userMessage);
  if (faqReply) return faqReply;
  return "I'm not sure I understand. You can ask about applying, checking your status, loan requirements, repayment, or contact support.";
}

async function getRecentSessions(limit = 50) {
  return all(
    `SELECT cs.*, COUNT(cm.id)::int AS message_count
     FROM chat_sessions cs
     LEFT JOIN chat_messages cm ON cm.session_id = cs.session_id
     GROUP BY cs.id
     ORDER BY cs.updated_at DESC
     LIMIT $1`,
    [limit]
  );
}

async function getSessionMessages(sessionId) {
  return all(
    'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
}

module.exports = {
  generateSessionId,
  getOrCreateSession,
  saveMessage,
  getHistory,
  getResponse,
  getRecentSessions,
  getSessionMessages,
};
