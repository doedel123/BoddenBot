"use client";

import React, { memo, useCallback } from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import SaveMemoryButton from "./SaveMemoryButton";

interface ChatMessageProps {
  message: {
    role: "user" | "assistant";
    content: string;
  };
  previousQuestion?: string;
  onSaveClick: (question: string, answer: string) => void;
}

const ChatMessage = memo(function ChatMessage({
  message,
  previousQuestion = "",
  onSaveClick,
}: ChatMessageProps) {
  const handleSave = useCallback(() => {
    onSaveClick(previousQuestion, message.content);
  }, [previousQuestion, message.content, onSaveClick]);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl px-5 py-3 bg-amber-600 text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl px-5 py-3 bg-gray-800 border border-gray-700/50 relative">
        <MarkdownRenderer content={message.content} />
        <SaveMemoryButton
          question={previousQuestion}
          answer={message.content}
          onSaveClick={handleSave}
        />
      </div>
    </div>
  );
});

export default ChatMessage;
