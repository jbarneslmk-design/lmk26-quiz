// ===================================================================
//  LMK 26 — settings
// ===================================================================
window.QUIZ_CONFIG = {
  // Must match the game created in Neon with quiz.setup('lmk26', ...).
  gameId: "lmk26",

  // ---- LIVE: your separate Neon quiz project ----
  // Connection string for the restricted "quiz_web" login (see neon/README).
  // It's safe to be public: that login can only call the quiz functions,
  // and every call is checked against the quiz password / host PIN inside Neon.
  // While this still says PASTE..., the quiz runs in LOCAL TEST MODE
  // (tabs in one browser), handy for rehearsing on your own.
  neon: {
    connectionString: "PASTE_QUIZ_WEB_CONNECTION_STRING"
  },

  // Local test mode only (never used live — the real PIN/password live in Neon):
  localHostPin: "2512",
  localPassword: ""
};
