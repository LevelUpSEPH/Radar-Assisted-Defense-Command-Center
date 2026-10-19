import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { useCommandSocket } from "./useCommandSocket";

export function App() {
  const cc = useCommandSocket();
  return (
    <div className="layout">
      <Sidebar cc={cc} />
      <main className="map-area">
        <MapView view={cc.state?.view ?? null} />
      </main>
    </div>
  );
}
