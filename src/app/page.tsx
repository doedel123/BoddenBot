import ChatInterface from "@/components/ChatInterface";
import LoginGate from "@/components/LoginGate";
import { MemoryProvider } from "@/contexts/MemoryContext";

export default function Home() {
  return (
    <LoginGate>
      <MemoryProvider>
        <ChatInterface />
      </MemoryProvider>
    </LoginGate>
  );
}
