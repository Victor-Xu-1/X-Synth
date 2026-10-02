import { defineStore } from "pinia";

export const useChatbotStore = defineStore("chatbot", {
  state: () => ({
    open: false,
    collapsed: false,
    expanded: false,
    messages: [],
    loading: false,
    phase: "",
    streamingThinking: "",
    streamingContent: "",
  }),
  actions: {
    toggle() {
      if (this.open && !this.collapsed) {
        this.open = false;
      } else {
        this.open = true;
        this.collapsed = false;
      }
    },
    collapse() {
      this.collapsed = true;
    },
    expand() {
      this.collapsed = false;
    },
    close() {
      this.open = false;
      this.collapsed = false;
      this.expanded = false;
    },
    toggleExpanded() {
      this.expanded = !this.expanded;
    },
    addMessage(role, content, thinking = "", thinkingSignature = "", toolUseBlocks = []) {
      this.messages.push({ role, content, thinking, thinkingSignature, toolUseBlocks });
    },
    clearMessages() {
      this.messages = [];
    },
    resetStreaming() {
      this.streamingThinking = "";
      this.streamingContent = "";
      this.phase = "";
      this.loading = false;
    },
  },
});
