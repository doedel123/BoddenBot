"use client";

import { useState } from "react";

interface SaveMemoryButtonProps {
  question: string;
  answer: string;
  onSaveClick: () => void;
}

export default function SaveMemoryButton({
  question,
  answer,
  onSaveClick,
}: SaveMemoryButtonProps) {
  return (
    <button
      onClick={onSaveClick}
      className="absolute top-2 right-2 p-2 rounded-lg bg-gray-700/50 hover:bg-amber-600/20 text-gray-400 hover:text-amber-500 transition-all border border-gray-600/30 hover:border-amber-500/50"
      title="Zu Memory hinzufügen"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
        />
      </svg>
    </button>
  );
}
