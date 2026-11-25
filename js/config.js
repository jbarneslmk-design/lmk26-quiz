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
    connectionString: "postgresql://quiz_web:VLtFq6GO0c3b44i0EqmfdyG6l4xv1akr@ep-shy-shape-bj5y1ikk-pooler.c-3.eu-west-2.aws.neon.tech/neondb?sslmode=require"
  },

  // Local test mode only (never used live — the real PIN/password live in Neon):
  localHostPin: "2512",
  localPassword: ""
};
