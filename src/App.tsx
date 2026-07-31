import { Routes, Route, Link } from "react-router-dom";
import { EngineProvider } from "./contexts/EngineContext";
import { TracksProvider } from "./contexts/TrackContext";
import LibraryPage from "./pages/LibraryPage";
import PlayerPage from "./pages/PlayerPage";

export default function App() {
  return (
    <EngineProvider>
      <TracksProvider>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/play/:id" element={<PlayerPage />} />
          <Route
            path="*"
            element={
              <div style={{ padding: 24 }}>
                <p>ページが見つかりません。</p>
                <Link to="/">トップへ戻る</Link>
              </div>
            }
          />
        </Routes>
      </TracksProvider>
    </EngineProvider>
  );
}
