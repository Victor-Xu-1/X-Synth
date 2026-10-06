"""Framework-independent constants for the authenticated private child channel."""

NATIVE_SEARCH_KEY_ENV = "X_SYNTH_NATIVE_SEARCH_KEY"
SEARCH_KEY_VARIABLE = NATIVE_SEARCH_KEY_ENV
NATIVE_SEARCH_HEADER = "X-X-Synth-Native-Key"
NATIVE_SEARCH_PREFIX = "/api/search-jobs"
NATIVE_SEARCH_READY_PATH = NATIVE_SEARCH_PREFIX + "/ready"
NATIVE_SEARCH_PROTOCOL = "x_synth_native_search"
NATIVE_SEARCH_PROTOCOL_VERSION = 1
