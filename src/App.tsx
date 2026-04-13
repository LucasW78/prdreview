import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ReviewWorkbench from './components/ReviewWorkbench';
import KnowledgeBase from './components/KnowledgeBase';
import KnowledgeChat from './components/KnowledgeChat';
import PromptManagement from './components/PromptManagement';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceDoc[];
}

interface SourceDoc {
  id?: number;
  filename: string;
  content: string;
  score: number;
  module: string;
}

function App() {
  const [activeTab, setActiveTab] = useState<'workbench' | 'knowledge' | 'chat' | 'prompt'>('workbench');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className={activeTab === 'workbench' ? 'h-full' : 'hidden'}>
          <ReviewWorkbench />
        </div>
        <div className={activeTab === 'knowledge' ? 'h-full' : 'hidden'}>
          <KnowledgeBase />
        </div>
        <div className={activeTab === 'chat' ? 'h-full' : 'hidden'}>
          <KnowledgeChat
            history={chatHistory}
            setHistory={setChatHistory}
          />
        </div>
        <div className={activeTab === 'prompt' ? 'h-full' : 'hidden'}>
          <PromptManagement />
        </div>
      </main>
    </div>
  );
}

export default App;
