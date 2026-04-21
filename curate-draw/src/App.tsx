import { Tldraw } from "tldraw";

function App() {
  return (
    <div className="tldraw-root">
      <Tldraw persistenceKey="curate-draw" />
    </div>
  );
}

export default App;
