<template>
  <Teleport to="body">
    <!-- Collapsed bar -->
    <v-slide-y-reverse-transition>
      <v-card v-if="chatStore.open && chatStore.collapsed" class="chatbot-collapsed" elevation="4"
        @click="chatStore.expand()">
        <v-card-text class="d-flex align-center pa-2 px-3">
          <v-icon class="mr-2" color="primary">mdi-robot</v-icon>
          <span class="text-body-2 font-weight-medium">MCP 助手</span>
          <v-spacer />
          <v-btn icon="mdi-chevron-up" variant="text" size="x-small" class="ml-1"
            @click.stop="chatStore.expand()" />
          <v-btn icon="mdi-close" variant="text" size="x-small"
            @click.stop="chatStore.close()" />
        </v-card-text>
      </v-card>
    </v-slide-y-reverse-transition>

    <!-- Expanded panel -->
    <v-slide-y-reverse-transition>
      <v-card v-if="chatStore.open && !chatStore.collapsed" ref="panelRef"
        :class="['chatbot-panel', { 'chatbot-panel--expanded': chatStore.expanded }]"
        :style="panelStyle" elevation="6">
        <div class="resize-handle resize-handle--tl" @mousedown.prevent="startResize('tl', $event)" />
        <div class="resize-handle resize-handle--t" @mousedown.prevent="startResize('t', $event)" />
        <div class="resize-handle resize-handle--l" @mousedown.prevent="startResize('l', $event)" />
        <v-card-title class="d-flex align-center py-2 px-3">
          <v-icon class="mr-2" size="small" color="primary">mdi-robot</v-icon>
          <span class="text-body-1 font-weight-medium">MCP 助手</span>
          <v-spacer />
          <v-btn icon="mdi-delete-outline" variant="text" size="x-small"
            :disabled="chatStore.messages.length === 0" @click="chatStore.clearMessages()" />
          <v-btn :icon="chatStore.expanded ? 'mdi-arrow-collapse' : 'mdi-arrow-expand'" variant="text" size="x-small"
            @click="chatStore.toggleExpanded()" />
          <v-btn icon="mdi-chevron-down" variant="text" size="x-small"
            @click="chatStore.collapse()" />
          <v-btn icon="mdi-close" variant="text" size="x-small"
            @click="chatStore.close()" />
        </v-card-title>
        <v-divider />

        <div ref="chatContainer" class="chatbot-messages">
          <!-- Empty state -->
          <div v-if="chatStore.messages.length === 0 && !chatStore.loading"
            class="d-flex flex-column align-center justify-center fill-height text-medium-emphasis">
            <v-icon size="48" class="mb-3">mdi-robot-happy-outline</v-icon>
            <p class="text-subtitle-1">需要查询哪个平台工具？</p>
            <p class="text-body-2 text-center px-4">
              可询问已接入的 MCP 工具，例如逆合成、正向预测和条件推荐。
            </p>
          </div>

          <!-- Message history -->
          <div v-for="(msg, i) in chatStore.messages" :key="i" class="mb-3">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="d-flex justify-end">
              <v-sheet color="primary" class="pa-3 rounded-lg text-white" max-width="85%">
                <span class="text-body-2" style="white-space: pre-wrap;">{{ msg.content }}</span>
              </v-sheet>
              <v-avatar size="28" color="secondary" class="ml-2 mt-1">
                <v-icon size="16" color="white">mdi-account</v-icon>
              </v-avatar>
            </div>

            <!-- Assistant message (hide if only tool-call with no visible content) -->
            <div v-else-if="msg.role === 'assistant' && (msg.content || msg.thinking)" class="d-flex justify-start">
              <v-avatar size="28" color="primary" class="mr-2 mt-1 flex-shrink-0">
                <v-icon size="16" color="white">mdi-robot</v-icon>
              </v-avatar>
              <div class="d-flex flex-column" style="max-width: 85%; min-width: 0;">
                <!-- Thinking (collapsible) -->
                <v-expansion-panels v-if="msg.thinking" variant="accordion" class="mb-1 thinking-panels">
                  <v-expansion-panel>
                    <v-expansion-panel-title class="pa-2 text-caption">
                      <v-icon size="14" class="mr-1">mdi-head-cog-outline</v-icon>
                      推理过程
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <span class="text-caption text-medium-emphasis" style="white-space: pre-wrap;">{{ msg.thinking }}</span>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
                <!-- Response (markdown) -->
                <v-sheet v-if="msg.content" class="pa-3 rounded-lg chat-assistant-bubble" elevation="1">
                  <div class="chat-md text-body-2" v-html="renderMarkdown(msg.content)"></div>
                </v-sheet>
              </div>
            </div>
          </div>

          <!-- Live streaming -->
          <div v-if="chatStore.loading" class="d-flex justify-start mb-3">
            <v-avatar size="28" color="primary" class="mr-2 mt-1 flex-shrink-0">
              <v-icon size="16" color="white">mdi-robot</v-icon>
            </v-avatar>
            <div class="d-flex flex-column" style="max-width: 85%; min-width: 0;">
              <!-- Live thinking -->
              <v-expansion-panels v-if="chatStore.streamingThinking" variant="accordion"
                class="mb-1 thinking-panels" :model-value="liveThinkingPanelModel">
                <v-expansion-panel>
                  <v-expansion-panel-title class="pa-2 text-caption">
                    <v-icon size="14" class="mr-1"
                      :class="{ 'thinking-spin': chatStore.phase === 'thinking' }">mdi-head-cog-outline</v-icon>
                    {{ chatStore.phase === 'thinking' ? '思考中...' : '推理过程' }}
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <span class="text-caption text-medium-emphasis" style="white-space: pre-wrap;">{{ chatStore.streamingThinking }}</span>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>

              <!-- Live response text or waiting indicator -->
              <v-sheet class="pa-3 rounded-lg chat-assistant-bubble" elevation="1">
                <template v-if="chatStore.streamingContent">
                  <div v-if="rateLimited" class="d-flex align-center">
                    <span class="text-body-2">{{ chatStore.streamingContent }}</span>
                    <v-progress-circular indeterminate size="14" width="2" color="primary" class="ml-2 flex-shrink-0" />
                  </div>
                  <div v-else class="chat-md text-body-2" v-html="renderMarkdown(chatStore.streamingContent)"></div>
                </template>
                <template v-else>
                  <v-progress-linear indeterminate color="primary" height="3" rounded class="mb-1"
                    style="width: 100px;" />
                  <span class="text-body-2 text-medium-emphasis">
                    {{ phaseLabel }}
                  </span>
                </template>
              </v-sheet>
            </div>
          </div>
        </div>

        <v-divider />
        <div class="d-flex align-center pa-2">
          <v-text-field v-model="userInput" placeholder="输入你要查询的平台工具或任务..." variant="outlined" density="compact"
            hide-details rounded class="mr-2" @keydown.enter.prevent="sendMessage"
            :disabled="chatStore.loading" />
          <v-btn icon="mdi-send" color="primary" variant="tonal" size="small"
            :disabled="!userInput.trim() || chatStore.loading" @click="sendMessage" />
        </div>
      </v-card>
    </v-slide-y-reverse-transition>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, watch, computed } from "vue";
import { useChatbotStore } from "@/store/chatbot";
import { API } from "@/common/api";
import { marked } from "marked";

// Markdown and model settings
marked.setOptions({ breaks: true, gfm: true });

const THINKING_BUDGET = 8000;
const MAX_TOOL_ROUNDS = 6;

// Shared state refs
const chatStore = useChatbotStore();
const userInput = ref("");
const chatContainer = ref(null);
const panelRef = ref(null);
const rateLimited = ref(false);
const TOOL_BLOCK_RE = /<tool_call>[\s\S]*?<\/tool_call>\s*|<tool_response>[\s\S]*?<\/tool_response>\s*/g;

// Computed UI labels
const phaseLabel = computed(() => {
  const labels = { thinking: "思考中...", responding: "生成回复中...", tool: "调用工具中..." };
  return labels[chatStore.phase] || "准备开始...";
});
const liveThinkingPanelModel = computed(() => {
  return chatStore.streamingContent ? [] : [0]; // Auto-collapse
});

// Markdown rendering helper
function renderMarkdown(text) {
  const cleaned = text.replace(TOOL_BLOCK_RE, "").trim();
  if (!cleaned) return "<em>处理中...</em>";
  return marked.parse(cleaned);
}

// MCP session state
const MCP_ENDPOINT = "/mcp";
let mcpSessionId = null;
let mcpTools = null;

// MCP API helpers
function mcpExtraHeaders() {
  const h = { Accept: "application/json, text/event-stream" };
  if (mcpSessionId) h["Mcp-Session-Id"] = mcpSessionId;
  return h;
}

async function mcpRpc(method, params = {}) {
  return API.jsonRpc(MCP_ENDPOINT, method, params, mcpExtraHeaders());
}

async function ensureMcpSession() {
  if (mcpSessionId) return true;

  const { response } = await mcpRpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "askcos-chatbot", version: "1.0" },
  }).catch(() => ({ response: null }));

  if (!response?.ok) return false;
  const sessionHeader = response.headers.get("mcp-session-id");
  if (sessionHeader) mcpSessionId = sessionHeader;
  return !!mcpSessionId;
}

async function fetchMcpToolList() {
  if (mcpTools) return mcpTools;
  if (!(await ensureMcpSession())) return [];

  const { data } = await mcpRpc("tools/list").catch(() => ({ data: null }));
  if (!data) return [];

  mcpTools = (data.result?.tools || []).map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema || { type: "object", properties: {} },
  }));
  return mcpTools;
}

async function callMcpTool(toolName, args) {
  if (!(await ensureMcpSession())) return { error: "MCP 会话初始化失败" };

  const { response, data } = await mcpRpc("tools/call", {
    name: toolName, arguments: args,
  }).catch((err) => {
    console.error("MCP 工具调用错误：", err);
    return { response: null, data: null };
  });

  if (!response?.ok) {
    mcpSessionId = null;
    return { error: `MCP 服务返回 HTTP ${response?.status || "网络错误"}` };
  }
  if (data.error) {
    if (data.error.message?.includes("session")) mcpSessionId = null;
    return { error: data.error.message || JSON.stringify(data.error) };
  }
  return data.result || data;
}

// Model message builders
function buildClaudeMessages() {
  return chatStore.messages
    .filter((msg) => msg.role !== "tool_hidden")
    .map((msg) => {
      if (msg.role === "user") return { role: "user", content: msg.content };
      if (msg.role === "tool_result") return { role: "user", content: msg.content };

      const blocks = [];
      if (msg.thinking) {
        blocks.push({ type: "thinking", thinking: msg.thinking, signature: msg.thinkingSignature });
      }
      if (msg.content) {
        blocks.push({ type: "text", text: msg.content });
      }
      if (msg.toolUseBlocks?.length) {
        for (const tu of msg.toolUseBlocks) {
          blocks.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
        }
      }
      if (!blocks.length) {
        blocks.push({ type: "text", text: "" });
      }
      return { role: "assistant", content: blocks };
    });
}

// Conversation loop actions
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || chatStore.loading) return;

  chatStore.addMessage("user", text);
  userInput.value = "";
  await runConversationLoop();
}

async function countdownWait(totalSec, label) {
  const endTime = Date.now() + totalSec * 1000;
  let remaining = totalSec;
  while (remaining > 0) {
    chatStore.streamingContent = `${label}，${remaining}s 后重试...`;
    scrollToBottom();
    const tick = Math.min(1000, endTime - Date.now());
    if (tick <= 0) break;
    await new Promise((r) => setTimeout(r, tick));
    remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  }
  chatStore.streamingContent = `${label}，正在重试...`;
  scrollToBottom();
}

function resetPhase(phase) {
  chatStore.phase = phase;
  chatStore.streamingContent = "";
  chatStore.streamingThinking = "";
  scrollToBottom();
}

async function runConversationLoop() {
  chatStore.loading = true;
  resetPhase("thinking");

  const tools = await fetchMcpToolList();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response = null;
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      response = await fetch("/api/chatbot/messages", {
        method: "POST",
        headers: API.getHeaders({}),
        body: JSON.stringify({
          max_tokens: 16000,
          stream: true,
          thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
          tools,
          messages: buildClaudeMessages(),
        }),
      }).catch((err) => {
        console.error("Claude API fetch error:", err);
        return null;
      });

      if (response?.status === 429 || response?.status === 529) {
        const retryAfter = response.headers.get("retry-after");
        const waitSec = retryAfter ? parseInt(retryAfter, 10) : (attempt + 1) * 5;
        rateLimited.value = true;
        await countdownWait(waitSec, response.status === 429 ? "Rate limited" : "Server overloaded");
        rateLimited.value = false;
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      const detail = response ? `(HTTP ${response.status})` : "(network error)";
      chatStore.addMessage("assistant", `抱歉，无法处理该请求 ${detail}。`);
      break;
    }

    const result = await processStream(response);

    const content = result.toolCalls.length ? result.contentText : (result.contentText || "No response.");
    chatStore.addMessage("assistant", content, result.thinkingText, result.thinkingSignature, result.toolCalls);
    if (!result.toolCalls.length) break;

    resetPhase("tool");

    const toolResults = [];
    for (const tc of result.toolCalls) {
      chatStore.streamingContent = `正在调用 **${tc.name}**...`;
      scrollToBottom();

      const toolResult = await callMcpTool(tc.name, tc.input);
      const resultStr = JSON.stringify(toolResult, null, 2);
      const truncated = resultStr.length > 20000 ? resultStr.slice(0, 20000) + "\n...(truncated)" : resultStr;

      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: truncated,
      });
    }

    chatStore.addMessage("tool_result", toolResults);

    resetPhase("thinking");
  }

  chatStore.resetStreaming();
  scrollToBottom();
}

// Stream parsing
async function processStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let thinkingText = "";
  let thinkingSignature = "";
  let contentText = "";
  const toolCalls = [];
  let currentToolCall = null;
  let toolInputJson = "";

  let scrollCounter = 0;
  const maybeScroll = () => { if (++scrollCounter % 5 === 0) scrollToBottom(); };

  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      let event;
      try { event = JSON.parse(jsonStr); }
      catch { continue; }

      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block?.type === "text") {
          chatStore.phase = "responding";
        } else if (block?.type === "tool_use") {
          chatStore.phase = "tool";
          currentToolCall = { id: block.id, name: block.name, input: {} };
          toolInputJson = "";
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta?.type === "thinking_delta") {
          thinkingText += event.delta.thinking;
          chatStore.streamingThinking = thinkingText;
          maybeScroll();
        } else if (event.delta?.type === "signature_delta") {
          thinkingSignature += event.delta.signature;
        } else if (event.delta?.type === "text_delta") {
          contentText += event.delta.text;
          chatStore.streamingContent = contentText;
          maybeScroll();
        } else if (event.delta?.type === "input_json_delta") {
          toolInputJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (currentToolCall) {
          try { currentToolCall.input = JSON.parse(toolInputJson); }
          catch { currentToolCall.input = {}; }
          toolCalls.push(currentToolCall);
          currentToolCall = null;
          toolInputJson = "";
        }
      } else if (event.type === "message_stop") {
        streamDone = true;
        break;
      }
    }
  }

  return { thinkingText, thinkingSignature, contentText, toolCalls };
}

// Panel sizing state
const panelWidth = ref(400);
const panelHeight = ref(520);
const BASE_WIDTH = 400;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 350;
function getMaxPanelWidth() {
  return window.innerWidth - 32;
}
function getMaxPanelHeight() {
  return window.innerHeight - 32;
}
function getPanelElement() {
  return panelRef.value?.$el || panelRef.value;
}

const fontScale = computed(() => {
  const scale = panelWidth.value / BASE_WIDTH;
  return Math.max(0.75, Math.min(scale, 1.6));
});

const panelStyle = computed(() => {
  if (chatStore.expanded) return {};
  return {
    width: `${panelWidth.value}px`,
    height: `${panelHeight.value}px`,
    fontSize: `${fontScale.value}em`,
  };
});

// Panel resize handlers
function startResize(edge, e) {
  const startX = e.clientX;
  const startY = e.clientY;
  // Use rendered Vuetify root size.
  const panelEl = getPanelElement();
  const startW = panelEl?.clientWidth || panelWidth.value;
  const startH = panelEl?.clientHeight || panelHeight.value;
  panelWidth.value = startW;
  panelHeight.value = startH;

  const onMove = (ev) => {
    const dx = startX - ev.clientX;
    const dy = startY - ev.clientY;
    const maxWidth = getMaxPanelWidth();
    const maxHeight = getMaxPanelHeight();

    if (edge.includes("l")) {
      panelWidth.value = Math.min(maxWidth, Math.max(MIN_WIDTH, startW + dx));
    }
    if (edge.includes("t")) {
      panelHeight.value = Math.min(maxHeight, Math.max(MIN_HEIGHT, startH + dy));
    }

    // Exit expanded mode when shrinking.
    if (chatStore.expanded && (panelWidth.value < maxWidth || panelHeight.value < maxHeight)) {
      chatStore.expanded = false;
    }
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// Scroll and lifecycle watchers
async function scrollToBottom() {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}

watch(
  () => chatStore.open && !chatStore.collapsed,
  (expanded) => {
    if (expanded) scrollToBottom();
  },
);
</script>

<style scoped>
.chatbot-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.chatbot-panel--expanded {
  width: calc(100vw - 100px) !important;
  height: calc(100vh - 32px) !important;
  font-size: 1em !important;
  transition: all 0.3s ease;
}

.resize-handle {
  position: absolute;
  z-index: 10;
}

.resize-handle--tl {
  top: 0;
  left: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}

.resize-handle--t {
  top: 0;
  left: 14px;
  right: 0;
  height: 5px;
  cursor: ns-resize;
}

.resize-handle--l {
  top: 14px;
  left: 0;
  bottom: 0;
  width: 5px;
  cursor: ew-resize;
}

.chatbot-collapsed {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 280px;
  z-index: 1100;
  border-radius: 12px;
  cursor: pointer;
}

.chatbot-messages {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}

.chat-assistant-bubble {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  max-width: 100%;
  min-width: 0;
}

.chat-md { max-width: 100%; overflow-x: auto; }
.chat-md :deep(p) { margin-bottom: 0.4em; }
.chat-md :deep(p:last-child) { margin-bottom: 0; }
.chat-md :deep(h1), .chat-md :deep(h2), .chat-md :deep(h3) { font-size: 0.95em; font-weight: 600; margin: 0.6em 0 0.3em; }
.chat-md :deep(h3) { font-size: 0.875em; }
.chat-md :deep(ul), .chat-md :deep(ol) { padding-left: 1.4em; margin: 0.3em 0; }
.chat-md :deep(li) { margin-bottom: 0.15em; }
.chat-md :deep(code) { background: rgba(var(--v-theme-on-surface), 0.08); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.85em; word-break: break-all; }
.chat-md :deep(pre) { background: rgba(var(--v-theme-on-surface), 0.06); padding: 0.6em; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; font-size: 0.8em; }
.chat-md :deep(pre code) { background: none; padding: 0; }
.chat-md :deep(table) { border-collapse: collapse; width: max-content; min-width: 100%; margin: 0.5em 0; font-size: 0.8em; }
.chat-md :deep(th), .chat-md :deep(td) { border: 1px solid rgba(var(--v-border-color), 0.3); padding: 0.3em 0.5em; text-align: left; white-space: nowrap; }
.chat-md :deep(th) { background: rgba(var(--v-theme-primary), 0.08); font-weight: 600; }
.chat-md :deep(blockquote) { border-left: 3px solid rgb(var(--v-theme-primary)); padding-left: 0.6em; margin: 0.4em 0; opacity: 0.85; }
.chat-md :deep(hr) { border: none; border-top: 1px solid rgba(var(--v-border-color), 0.3); margin: 0.6em 0; }
.chat-md :deep(strong) { font-weight: 600; }
.chat-md :deep(a) { color: rgb(var(--v-theme-primary)); text-decoration: none; }
.chat-md :deep(a:hover) { text-decoration: underline; }

.thinking-panels :deep(.v-expansion-panel) { border-radius: 8px !important; }
.thinking-panels :deep(.v-expansion-panel-title) { min-height: 32px; font-size: 0.75rem; }
.thinking-panels :deep(.v-expansion-panel-text__wrapper) { padding: 8px 12px; max-height: 150px; overflow-y: auto; }
.thinking-spin { animation: spin 1.5s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
