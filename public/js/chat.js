(function () {
  const STORAGE_KEY = 'safer_chat_session';
  const widget = document.getElementById('chat-widget');
  const toggle = document.getElementById('chat-toggle');
  const close = document.getElementById('chat-close');
  const messages = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const form = document.getElementById('chat-form');
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

  if (!widget || !toggle || !messages || !input || !form) return;

  let session = loadSession();
  let isOpen = false;

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSession() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'chat-message chat-message--' + role;
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function ensureIdentity() {
    if (!session.name) {
      const n = window.prompt('Your name (for our support team):') || '';
      session.name = n.trim();
    }
    if (!session.email) {
      const e = window.prompt('Your email (so we can reply):') || '';
      session.email = e.trim();
    }
    saveSession();
  }

  async function sendMessage(text) {
    ensureIdentity();
    appendMessage('user', text);
    input.value = '';

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          message: text,
          sessionId: session.id,
          userName: session.name,
          userEmail: session.email,
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.sessionId && !session.id) {
          session.id = data.sessionId;
          saveSession();
        }
      } else {
        appendMessage('bot', data.error || 'Sorry, something went wrong.');
      }
    } catch (err) {
      appendMessage('bot', 'Sorry, I could not connect. Please try again.');
    }
  }

  toggle.addEventListener('click', function () {
    isOpen = !isOpen;
    widget.classList.toggle('open', isOpen);
    if (isOpen) input.focus();
  });

  if (close) {
    close.addEventListener('click', function () {
      isOpen = false;
      widget.classList.remove('open');
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendMessage(text);
  });

  if (messages.children.length === 0) {
    appendMessage('bot', 'Send your question here. Our team will review it and respond by email.');
  }
})();
