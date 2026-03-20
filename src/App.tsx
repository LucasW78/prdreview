import { useState } from 'react';
import Sidebar from './components/Sidebar';
import DataIngestion from './components/DataIngestion';
import ReviewWorkbench from './components/ReviewWorkbench';
import KnowledgeBase from './components/KnowledgeBase';

function App() {
  const [activeTab, setActiveTab] = useState<'ingestion' | 'workbench' | 'knowledge'>('ingestion');

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'ingestion' && <DataIngestion />}
        {activeTab === 'workbench' && <ReviewWorkbench />}
        {activeTab === 'knowledge' && <KnowledgeBase />}
      </main>
    </div>
  );
}

export default App;
