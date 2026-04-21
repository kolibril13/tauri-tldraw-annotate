import ScreenshotAnnotator from "./components/ScreenshotAnnotator";

function App() {
  return (
    <div className="page">
      <h1>Quick Screenshot Annotator</h1>
      <div className="annotator-frame">
        <ScreenshotAnnotator />
      </div>
    </div>
  );
}

export default App;
