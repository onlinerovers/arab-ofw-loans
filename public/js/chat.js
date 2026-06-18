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

  function setTyping(show) {
    let typing = document.getElementById('chat-typing');
    if (show) {
      if (!typing) {
        typing = document.createElement('div');
        typing.id = 'chat-typing';
        typing.className = 'chat-message chat-message--bot chat-typing';
        typing.textContent = 'Typing...';
        messages.appendChild(typing);
        messages.scrollTop = messages.scrollHeight;
      }
    } else if (typing) {
      typing.remove();
    }
  }

  async function sendMessage(text) {
    appendMessage('user', text);
    input.value = '';
    setTyping(true);

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
      setTyping(false);

      if (data.success) {
        if (data.sessionId && !session.id) {
          session.id = data.sessionId;
          saveSession();
        }
        appendMessage('bot', data.reply);
      } else {
        appendMessage('bot', data.error || 'Sorry, something went wrong.');
      }
    } catch (err) {
      setTyping(false);
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

  // Initial greeting if empty
  if (messages.children.length === 0) {
    appendMessage('bot', 'Hi there! 👋 How can I help you with SafeLoans today?');
  }
})();
