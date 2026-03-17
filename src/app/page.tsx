import ChatInterface from "@/components/ChatInterface";
import LoginGate from "@/components/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <ChatInterface />
    </LoginGate>
  );
}
