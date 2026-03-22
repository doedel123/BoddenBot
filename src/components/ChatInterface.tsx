"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import AgentActivityPanel from "./AgentActivityPanel";
import ThinkingAnimation from "./ThinkingAnimation";
import VectorStoreManager from "./VectorStoreManager";
import MemoryDialog from "./MemoryDialog";
import SaveMemoryButton from "./SaveMemoryButton";
import MemorySelector from "./MemorySelector";
import MemoryViewer from "./MemoryViewer";
import { useToast } from "./Toast";
import { SubQuestion, Source, PageIndexDocument } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [subQuestions, setSubQuestions] = useState<SubQuestion[]>([]);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [subAnswers, setSubAnswers] = useState<Record<string, string>>({});
  const [uploadedFiles, setUploadedFiles] = useState<
    { name: string; content: string }[]
  >([]);
  const [showSubAnswers, setShowSubAnswers] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [showVectorStore, setShowVectorStore] = useState(false);
  const [pageIndexDocs, setPageIndexDocs] = useState<PageIndexDocument[]>([]);
  const [selectedPageIndexDoc, setSelectedPageIndexDoc] = useState<string>("");
  const [loadingPageIndexDocs, setLoadingPageIndexDocs] = useState(false);
  const isSingleQuestionRef = useRef(false);
  const finalAnswerRef = useRef("");

  // Memory feature state
  const [showMemoryDialog, setShowMemoryDialog] = useState(false);
  const [showMemoryViewer, setShowMemoryViewer] = useState(false);
  const [memoryViewerCollectionId, setMemoryViewerCollectionId] = useState("");
  const [currentMemoryQuestion, setCurrentMemoryQuestion] = useState("");
  const [currentMemoryAnswer, setCurrentMemoryAnswer] = useState("");
  const { showToast, ToastComponent } = useToast();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load PageIndex documents on mount
  useEffect(() => {
    async function loadPageIndexDocs() {
      setLoadingPageIndexDocs(true);
      try {
        const res = await fetch("/api/pageindex/documents");
        const data = await res.json();
        if (data.documents) {
          setPageIndexDocs(
            data.documents.filter((d: PageIndexDocument) => d.status === "completed")
          );
        }
      } catch {
        // PageIndex not available - that's fine
      } finally {
        setLoadingPageIndexDocs(false);
      }
    }
    loadPageIndexDocs();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.error) {
          alert(data.error);
        } else {
          setUploadedFiles((prev) => [
            ...prev,
            { name: data.filename, content: data.content },
          ]);
        }
      } catch {
        alert("Upload fehlgeschlagen");
      }
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);
    setStatus("");
    setSubQuestions([]);
    setAllSources([]);
    setStreamingContent("");
    setSubAnswers({});
    setShowSubAnswers(false);
    setIsSynthesizing(false);
    isSingleQuestionRef.current = false;
    finalAnswerRef.current = "";

    const context = uploadedFiles.map((f) => `--- ${f.name} ---\n${f.content}`).join("\n\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          context,
          pageIndexDocId: selectedPageIndexDoc || undefined,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);
              handleStreamEvent(event);
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Fehler";
      setStreamingContent(`Fehler: ${msg}`);
    } finally {
      setIsLoading(false);
      setStatus("");
      // Move final answer to messages
      const answer = finalAnswerRef.current;
      if (answer) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer },
        ]);
      }
      setStreamingContent("");
      finalAnswerRef.current = "";
    }
  };

  const handleStreamEvent = (event: { type: string; data: Record<string, unknown> }) => {
    switch (event.type) {
      case "status":
        setStatus(event.data.message as string);
        break;

      case "sub_questions": {
        const sqs = event.data.subQuestions as SubQuestion[];
        setSubQuestions(sqs);
        isSingleQuestionRef.current = sqs.length === 1;
        break;
      }

      case "sub_question_start":
        setSubQuestions((prev) =>
          prev.map((sq) =>
            sq.id === event.data.id ? { ...sq, status: "running" } : sq
          )
        );
        break;

      case "sub_question_delta": {
        const delta = event.data.delta as string;
        setSubAnswers((prev) => ({
          ...prev,
          [event.data.id as string]: (prev[event.data.id as string] || "") + delta,
        }));
        // For single questions, stream directly to main content
        if (isSingleQuestionRef.current) {
          finalAnswerRef.current += delta;
          setStreamingContent((prev) => prev + delta);
        }
        break;
      }

      case "sub_question_done":
        setSubQuestions((prev) =>
          prev.map((sq) =>
            sq.id === event.data.id
              ? { ...sq, status: (event.data as Record<string, unknown>).error ? "error" : "done" }
              : sq
          )
        );
        break;

      case "sub_question_sources":
        setAllSources((prev) => [...prev, ...((event.data.sources as Source[]) || [])]);
        setSubQuestions((prev) =>
          prev.map((sq) =>
            sq.id === event.data.id
              ? { ...sq, sources: (event.data.sources as Source[]) || [] }
              : sq
          )
        );
        break;

      case "synthesis_start":
        setIsSynthesizing(true);
        setShowSubAnswers(true);
        break;

      case "synthesis_delta": {
        const synthDelta = event.data.delta as string;
        finalAnswerRef.current += synthDelta;
        setStreamingContent((prev) => prev + synthDelta);
        break;
      }

      case "synthesis_done": {
        setIsSynthesizing(false);
        break;
      }

      case "error":
        setStreamingContent(`Fehler: ${event.data.message}`);
        setStatus("");
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Bodden-Bot</h1>
            <p className="text-xs text-gray-500">Claude Opus 4.6 &middot; StGB &middot; StPO &middot; Agentic RAG</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* PageIndex Document Selector */}
            {pageIndexDocs.length > 0 && (
              <div className="relative">
                <select
                  value={selectedPageIndexDoc}
                  onChange={(e) => setSelectedPageIndexDoc(e.target.value)}
                  className="appearance-none pl-8 pr-8 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700/50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 cursor-pointer"
                >
                  <option value="">PageIndex: Kein Dokument</option>
                  {pageIndexDocs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} ({doc.pageNum} S.)
                    </option>
                  ))}
                </select>
                <svg className="w-4 h-4 text-amber-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <svg className="w-3 h-3 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}
            {loadingPageIndexDocs && (
              <span className="text-xs text-gray-500">PageIndex laden...</span>
            )}
            <button
              onClick={() => setShowVectorStore(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-emerald-400 transition-colors border border-gray-700/50 text-sm"
              title="Vector Store verwalten"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              Vector Store
            </button>
            <MemorySelector
              onViewMemories={(collectionId) => {
                setMemoryViewerCollectionId(collectionId);
                setShowMemoryViewer(true);
              }}
            />
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center mb-6">
                <svg className="w-10 h-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Strafrechts-Analyse</h2>
              <p className="text-gray-500 max-w-md">
                Stellen Sie komplexe Fragen zum deutschen Strafrecht. Der Agent
                teilt Ihre Frage in Teilfragen auf und durchsucht StGB/StPO-Kommentare
                sowie aktuelle Rechtsprechung.
              </p>
              <div className="mt-6 flex gap-2 flex-wrap justify-center">
                {[
                  "Welche Voraussetzungen hat der Betrug gem. § 263 StGB?",
                  "Erkläre die Rechtswidrigkeit bei Notwehr nach § 32 StGB",
                  "Welche Beweisverwertungsverbote gibt es in der StPO?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="text-xs px-3 py-2 rounded-lg bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300 transition-colors border border-gray-700/50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  msg.role === "user"
                    ? "bg-amber-600 text-white"
                    : "bg-gray-800 border border-gray-700/50 relative"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <MarkdownRenderer content={msg.content} />
                    <SaveMemoryButton
                      question={messages[i - 1]?.content || ""}
                      answer={msg.content}
                      onSaveClick={() => {
                        setCurrentMemoryQuestion(messages[i - 1]?.content || "");
                        setCurrentMemoryAnswer(msg.content);
                        setShowMemoryDialog(true);
                      }}
                    />
                  </>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Sub-answers (shown during synthesis) */}
          {showSubAnswers && Object.keys(subAnswers).length > 1 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Teilantworten</p>
              {subQuestions.map((sq) => (
                <details key={sq.id} className="group">
                  <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300 flex items-center gap-2">
                    <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {sq.question}
                  </summary>
                  <div className="mt-2 ml-6 p-3 bg-gray-800/50 rounded-lg border border-gray-700/30">
                    <MarkdownRenderer content={subAnswers[sq.id] || ""} />
                  </div>
                </details>
              ))}
            </div>
          )}

          {/* Streaming response */}
          {streamingContent && isLoading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-5 py-3 bg-gray-800 border border-gray-700/50">
                <MarkdownRenderer content={streamingContent} />
                {isSynthesizing && (
                  <span className="inline-block w-2 h-5 bg-amber-400 animate-pulse ml-0.5" />
                )}
              </div>
            </div>
          )}

          {/* Thinking animation */}
          {isLoading && !streamingContent && (
            <ThinkingAnimation text={status || "Denke nach..."} />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-800 px-6 py-4 shrink-0">
          {/* Uploaded files */}
          {uploadedFiles.length > 0 && (
            <div className="flex gap-2 mb-3 flex-wrap">
              {uploadedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg border border-gray-700/50 text-sm"
                >
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-gray-300">{f.name}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 p-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-amber-400 transition-colors border border-gray-700/50"
              title="PDF oder MD hochladen"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.txt"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Stellen Sie Ihre strafrechtliche Frage..."
                rows={1}
                className="w-full resize-none rounded-xl bg-gray-800 border border-gray-700/50 px-4 py-3 text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 max-h-40 overflow-y-auto"
                style={{ minHeight: "48px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = Math.min(target.scrollHeight, 160) + "px";
                }}
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading || !input.trim()}
              className="shrink-0 p-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Vector Store Manager Modal */}
      <VectorStoreManager
        open={showVectorStore}
        onClose={() => setShowVectorStore(false)}
      />

      {/* Memory Dialog */}
      <MemoryDialog
        open={showMemoryDialog}
        onClose={() => setShowMemoryDialog(false)}
        question={currentMemoryQuestion}
        answer={currentMemoryAnswer}
        onSaved={() => showToast("Zu Memory gespeichert ✓", "success")}
      />

      {/* Memory Viewer */}
      <MemoryViewer
        open={showMemoryViewer}
        onClose={() => setShowMemoryViewer(false)}
        collectionId={memoryViewerCollectionId}
      />

      {/* Toast Notifications */}
      {ToastComponent}

      {/* Right Side Panel */}
      <div
        className={`border-l border-gray-800 bg-gray-900/50 transition-all duration-300 overflow-hidden ${
          subQuestions.length > 0 || status ? "w-80" : "w-0"
        }`}
      >
        <AgentActivityPanel
          subQuestions={subQuestions}
          allSources={allSources}
          status={status}
        />
      </div>
    </div>
  );
}
