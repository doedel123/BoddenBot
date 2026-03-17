"use client";

export default function ThinkingAnimation({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="flex gap-1">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:0ms]" />
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:150ms]" />
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-sm text-gray-400 animate-pulse">{text}</span>
    </div>
  );
}
