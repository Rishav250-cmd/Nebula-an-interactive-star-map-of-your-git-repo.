import './App.css';
import { GraphCanvas } from './components/GraphCanvas';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { TopBar } from './components/TopBar';

export default function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <div className="workspace">
        <LeftPanel />
        <GraphCanvas />
        <RightPanel />
      </div>
    </div>
  );
}
