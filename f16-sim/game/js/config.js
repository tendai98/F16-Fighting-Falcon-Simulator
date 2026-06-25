/* ===================================================================== */
/*  CONFIG  — runtime constants resolved before the engine boots         */
/* ===================================================================== */

/* Path to the neon F-16 silhouette used on the SMS page.
   Relative to index.html. Swap this file in assets/ to re-skin the jet. */
const F16_SILHOUETTE_SRC = 'assets/f16_silhouette.png';

/* Client replay/API logging.
   Default keeps only errors in the browser console.
   Set localStorage.f16_client_log_level to silent/error/warn/info/debug,
   or set localStorage.f16_replay_debug_logs=true for replay upload diagnostics. */
window.F16_CLIENT_LOG_LEVEL = window.F16_CLIENT_LOG_LEVEL || 'error';
window.F16_REPLAY_DEBUG_LOGS = window.F16_REPLAY_DEBUG_LOGS || false;
